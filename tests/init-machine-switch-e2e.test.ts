/**
 * End-to-end: memory, learning and knowledge are MACHINE-WIDE features (#378,
 * D-FEATURES-MACHINE-WIDE). `devflow init --[no-]<feature>` and `devflow
 * <feature> --enable/--disable` write the one switch — `features.<feature>` in
 * ~/.devflow/manifest.json — and every runtime gate reads that switch alone.
 *
 * The reported bug: `devflow init --no-learning` printed "Learning: disabled"
 * while every OTHER repo — one holding a stale `learning: true` an earlier init
 * wrote, one with no config, a non-git cwd — kept capturing and spawning the
 * Learning agent, because the runtime gates read the per-repo config. Those
 * per-repo keys are now retired: a stale value decides nothing either way, and
 * init's next config write drops it.
 *
 * These drive the REAL compiled CLI and the INSTALLED hook scripts (not the
 * source tree), so the assertion is about what a user's machine actually runs.
 *
 * PF-060: every spawn gets a temp HOME and an explicit DEVFLOW_DIR under it, and
 * the sandbox is asserted at the call site — a run against the real HOME never
 * starts. Requires a build (`npm run build`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { promises as fs, existsSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli } from './helpers.js';
import { hasMemoryHooks } from '../src/cli/commands/memory.js';
import { hasAmbientHook } from '../src/cli/commands/ambient.js';
import { hasHudStatusLine } from '../src/cli/commands/hud.js';
import { addProxyHooks, applyProxyEnv, hasProxyHooks } from '../src/cli/commands/proxy.js';
import { writeProxyState, buildProxyState, DEFAULT_PROXY_PORT } from '../src/core/proxy-state.js';
import type { Settings } from '../src/targets/claude-code/hooks.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;
/** Tests that chain several init runs get a budget of several spawns. */
const MULTI_RUN_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;

let tmpHome: string;
let repoA: string;
let repoB: string;
let nonGit: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const claudeDir = (): string => path.join(tmpHome, '.claude');
const installedHook = (name: string): string => path.join(devflowDir(), 'scripts', 'hooks', name);

function sandboxEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // PF-060: asserted, not trusted.
  expect(path.resolve(tmpHome), 'must never run against the real HOME').not.toBe(path.resolve(os.homedir()));
  return {
    ...process.env,
    HOME: tmpHome,
    DEVFLOW_DIR: devflowDir(),
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CI: '1',
    ...extra,
  };
}

function runCli(cwd: string, ...args: string[]): { status: number | null; out: string } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function runInit(cwd: string, ...args: string[]): string {
  const { status, out } = runCli(cwd, 'init', ...args);
  expect(status, `init ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

/** Run an INSTALLED hook with JSON stdin; the manifest resolves via $HOME. */
function runInstalledHook(name: string, input: object): { stdout: string; exitCode: number } {
  const hook = installedHook(name);
  expect(existsSync(hook), `init did not install ${name}`).toBe(true);
  try {
    const stdout = execFileSync('bash', [hook], {
      input: JSON.stringify(input),
      // An EMPTY DEVFLOW_DIR makes the hooks take the ~/.devflow default path.
      env: sandboxEnv({ DEVFLOW_DIR: '' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { stdout, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; status?: number };
    return { stdout: err.stdout?.toString() ?? '', exitCode: err.status ?? 1 };
  }
}

async function readManifestRaw(): Promise<string> {
  return fs.readFile(path.join(devflowDir(), 'manifest.json'), 'utf-8');
}

async function readManifestFeatures(): Promise<Record<string, unknown>> {
  return (JSON.parse(await readManifestRaw()) as { features: Record<string, unknown> }).features;
}

async function readRepoConfig(repo: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(repo, '.devflow', 'config.json'), 'utf-8')) as Record<string, unknown>;
}

async function writeRepoConfig(repo: string, body: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
  await fs.writeFile(path.join(repo, '.devflow', 'config.json'), JSON.stringify(body), 'utf-8');
}

const learningQueue = (dir: string): string => path.join(dir, '.devflow', 'learning', '.pending-turns.jsonl');
const learningProcessing = (dir: string): string => path.join(dir, '.devflow', 'learning', '.pending-turns.processing');

async function seedLearningQueue(dir: string): Promise<void> {
  await fs.mkdir(path.dirname(learningQueue(dir)), { recursive: true });
  await fs.writeFile(learningQueue(dir), '{"role":"user","content":"we chose X over Y","ts":1}\n', 'utf-8');
}

const memoryQueue = (dir: string): string => path.join(dir, '.devflow', 'memory', '.pending-turns.jsonl');

const linesOf = (file: string): number =>
  existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean).length : 0;
const queueLines = (dir: string): number => linesOf(learningQueue(dir));

/** Drive one prompt + one turn through the installed capture hooks in `dir`. */
function captureTurn(dir: string): void {
  runInstalledHook('capture-prompt', { cwd: dir, prompt: 'another turn' });
  runInstalledHook('capture-turn', { cwd: dir, session_id: 's', last_assistant_message: 'a reply' });
}

/** The retired per-repo switches, as a pre-#378 init or toggle left them. */
const STALE_OFF = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' } as const;
const STALE_ON = { memory: true, learning: true, knowledge: true, reviewPublication: 'auto' } as const;

/** The additionalContext session-start-context injects for `cwd` ('' when none). */
function sessionContext(cwd: string): string {
  const { stdout, exitCode } = runInstalledHook('session-start-context', { cwd, source: 'startup' });
  expect(exitCode).toBe(0);
  if (stdout.trim() === '') return '';
  return (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

async function readSettings(): Promise<string> {
  return fs.readFile(path.join(claudeDir(), 'settings.json'), 'utf-8');
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-home-'));
  repoA = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-repoA-'));
  repoB = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-repoB-'));
  nonGit = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-nongit-'));
  // init bails with "Claude Code not detected" without a ~/.claude dir
  await fs.mkdir(claudeDir(), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repoA });
  execFileSync('git', ['init', '-q'], { cwd: repoB });
});

afterEach(async () => {
  for (const dir of [tmpHome, repoA, repoB, nonGit]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// init is the machine-wide switch
// ─────────────────────────────────────────────────────────────────────────────

describe('init --no-<feature> switches the feature off in every project', () => {
  it('learning: silences a second repo and a non-git cwd, drains the cwd queue, and init --learning restores every repo', async () => {
    // Repo B carries the stale `true` an earlier init wrote — the reported case.
    await writeRepoConfig(repoB, STALE_ON);
    await seedLearningQueue(repoA);
    await fs.writeFile(learningProcessing(repoA), '{"role":"user","content":"claimed","ts":1}\n', 'utf-8');
    await seedLearningQueue(repoB);
    await seedLearningQueue(nonGit);

    const out = runInit(repoA, '--recommended', '--no-learning', '--no-knowledge');
    expect(out).toMatch(/Learning:\s+disabled/);
    expect(await readManifestFeatures()).toMatchObject({ learning: false, knowledge: false });

    // The cwd repo's pending learning queue (and a claimed batch) is drained.
    expect(existsSync(learningQueue(repoA))).toBe(false);
    expect(existsSync(learningProcessing(repoA))).toBe(false);

    // No Learning directive in the other repo or a non-git cwd…
    expect(sessionContext(repoB)).not.toContain('LEARNING MAINTENANCE');
    expect(sessionContext(nonGit)).not.toContain('LEARNING MAINTENANCE');
    // …and the capture hooks append nothing to their learning queues.
    for (const dir of [repoB, nonGit]) {
      const before = queueLines(dir);
      captureTurn(dir);
      expect(queueLines(dir), `learning captured in ${dir} after a machine-wide disable`).toBe(before);
    }

    // The status of a repo whose config still says true reports the truth.
    expect(runCli(repoB, 'learning', '--status').out).toContain('Learning: disabled');
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: disabled');

    // Turning it back on from ANOTHER directory restores every repo.
    runInit(nonGit, '--recommended', '--learning', '--knowledge');
    expect(await readManifestFeatures()).toMatchObject({ learning: true, knowledge: true });
    await seedLearningQueue(repoA);
    expect(sessionContext(repoA)).toContain('--- LEARNING MAINTENANCE ---');
    expect(sessionContext(repoB)).toContain('--- LEARNING MAINTENANCE ---');
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: enabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('memory: a second repo and a non-git cwd stop appending to the memory queue', async () => {
    await writeRepoConfig(repoB, STALE_ON);

    runInit(repoA, '--recommended', '--no-memory');
    expect(await readManifestFeatures()).toMatchObject({ memory: false });
    expect(hasMemoryHooks(await readSettings())).toBe(false);

    for (const dir of [repoB, nonGit]) {
      captureTurn(dir);
      expect(linesOf(memoryQueue(dir)), `memory captured in ${dir} after init --no-memory`).toBe(0);
      // Non-vacuity: the hooks ran and learning (still on) captured the turn.
      expect(queueLines(dir), `the capture hooks did not run in ${dir}`).toBe(2);
    }
    expect(runCli(repoB, 'memory', '--status').out).toContain('Working memory: disabled');

    // init --memory from another directory restores it everywhere.
    runInit(nonGit, '--recommended', '--memory');
    expect(hasMemoryHooks(await readSettings())).toBe(true);
    captureTurn(repoB);
    expect(linesOf(memoryQueue(repoB))).toBe(2);
  }, MULTI_RUN_TIMEOUT_MS);

  it('a re-init keeps the machine-wide choice even from a repo whose config says true (ADR-014)', async () => {
    runInit(repoA, '--recommended', '--no-learning', '--no-knowledge', '--no-memory');
    await writeRepoConfig(repoB, STALE_ON);

    // A plain re-init (an upgrade, say) from repo B must not flip the switch back.
    runInit(repoB, '--recommended');
    expect(await readManifestFeatures()).toMatchObject({ learning: false, knowledge: false, memory: false });
    expect(hasMemoryHooks(await readSettings())).toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);

  it('a stale repo config saying false switches nothing off, and init drops it', async () => {
    runInit(repoA, '--recommended');
    await writeRepoConfig(repoB, { ...STALE_OFF, tracker: 'jira' });

    // Every feature is on for repo B: the stale per-repo false decides nothing.
    captureTurn(repoB);
    expect(linesOf(memoryQueue(repoB))).toBe(2);
    expect(queueLines(repoB)).toBe(2);
    expect(sessionContext(repoB)).toContain('--- LEARNING MAINTENANCE ---');
    expect(runCli(repoB, 'learning', '--status').out).toContain('Learning: enabled');
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: enabled');

    // A re-init from repo B does not turn anything off machine-wide, and its
    // managed write drops the retired keys while keeping the repo's own facts.
    runInit(repoB, '--recommended');
    expect(await readManifestFeatures()).toMatchObject({ memory: true, learning: true, knowledge: true });
    expect(await readRepoConfig(repoB)).toEqual({ reviewPublication: 'auto', tracker: 'jira' });
  }, MULTI_RUN_TIMEOUT_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// The feature commands are the same machine-wide switch
// ─────────────────────────────────────────────────────────────────────────────

describe('devflow memory|learning|knowledge --enable/--disable are machine-wide', () => {
  it('learning --disable from one repo silences every repo and drains that repo; --enable from a non-git cwd restores', async () => {
    runInit(repoA, '--recommended');
    await seedLearningQueue(repoA);
    await seedLearningQueue(repoB);

    expect(runCli(repoB, 'learning', '--disable').status).toBe(0);
    expect((await readManifestFeatures()).learning).toBe(false);
    expect(existsSync(learningQueue(repoB)), 'the current repo queue is drained').toBe(false);
    expect(sessionContext(repoA)).not.toContain('LEARNING MAINTENANCE');
    expect(runCli(repoA, 'learning', '--status').out).toContain('Learning: disabled');

    // Never requires a git root: the switch is not a per-project setting.
    const enabled = runCli(nonGit, 'learning', '--enable');
    expect(enabled.status, enabled.out).toBe(0);
    expect((await readManifestFeatures()).learning).toBe(true);
    expect(sessionContext(repoA)).toContain('--- LEARNING MAINTENANCE ---');
  }, MULTI_RUN_TIMEOUT_MS);

  it('memory --disable converges settings.json exactly as init --no-memory does, and drains the repo queue', async () => {
    runInit(repoA, '--recommended', '--memory');
    await fs.mkdir(path.dirname(memoryQueue(repoA)), { recursive: true });
    await fs.writeFile(memoryQueue(repoA), '{"role":"user","content":"x","ts":1}\n');

    expect(runCli(repoA, 'memory', '--disable').status).toBe(0);
    const viaCommand = await readSettings();
    expect(hasMemoryHooks(viaCommand)).toBe(false);
    expect((await readManifestFeatures()).memory).toBe(false);
    expect(existsSync(memoryQueue(repoA))).toBe(false);
    captureTurn(repoB);
    expect(linesOf(memoryQueue(repoB))).toBe(0);

    // The same settings init itself produces for the same choice. Parsed, not
    // byte-compared: a re-init re-serialises its own top-level keys (flags, env)
    // in its own order; every hook array — order included — must match.
    runInit(repoA, '--recommended', '--no-memory');
    expect(JSON.parse(await readSettings())).toEqual(JSON.parse(viaCommand));
  }, MULTI_RUN_TIMEOUT_MS);

  it('memory --enable registers the hooks after capture-turn (append-before-spawn) and resumes capture', async () => {
    runInit(repoA, '--recommended', '--no-memory');

    const enabled = runCli(nonGit, 'memory', '--enable');
    expect(enabled.status, enabled.out).toBe(0);
    const settings = await readSettings();
    expect(hasMemoryHooks(settings)).toBe(true);
    expect((await readManifestFeatures()).memory).toBe(true);
    const stop = (JSON.parse(settings) as Settings).hooks?.Stop ?? [];
    const commands = stop.flatMap((m) => m.hooks.map((h) => h.command));
    const captureAt = commands.findIndex((c) => c.includes('capture-turn'));
    const workerAt = commands.findIndex((c) => c.includes('memory-worker'));
    expect(captureAt).toBeGreaterThanOrEqual(0);
    expect(workerAt, 'memory-worker must follow capture-turn in the Stop array').toBeGreaterThan(captureAt);
    expect(runCli(repoB, 'memory', '--status').out).toContain('Working memory: enabled');

    captureTurn(repoB);
    expect(linesOf(memoryQueue(repoB))).toBe(2);
  }, MULTI_RUN_TIMEOUT_MS);

  it('knowledge --disable / --enable flip the machine-wide switch from any repo', async () => {
    runInit(repoA, '--recommended');

    expect(runCli(repoB, 'knowledge', '--disable').status).toBe(0);
    expect((await readManifestFeatures()).knowledge).toBe(false);
    expect(runCli(repoA, 'knowledge', '--status').out).toContain('Status: disabled');

    expect(runCli(repoA, 'knowledge', '--enable').status).toBe(0);
    expect((await readManifestFeatures()).knowledge).toBe(true);
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: enabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('the commands never write a repo config', async () => {
    runInit(repoA, '--recommended');
    const body = JSON.stringify({ ...STALE_ON, tracker: 'linear' });
    await fs.mkdir(path.join(repoB, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(repoB, '.devflow', 'config.json'), body, 'utf-8');

    for (const args of [['learning', '--disable'], ['memory', '--disable'], ['knowledge', '--disable'], ['learning', '--enable']]) {
      expect(runCli(repoB, ...args).status).toBe(0);
    }
    expect(await fs.readFile(path.join(repoB, '.devflow', 'config.json'), 'utf-8')).toBe(body);
  }, MULTI_RUN_TIMEOUT_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Older manifests: absent keys and the legacy `decisions` key
// ─────────────────────────────────────────────────────────────────────────────

/** Rewrite the installed manifest's features: drop `remove`, then merge `set`. */
async function editManifestFeatures(remove: string[], set: Record<string, unknown> = {}): Promise<void> {
  const manifest = JSON.parse(await readManifestRaw()) as { features: Record<string, unknown> };
  const features = Object.fromEntries(Object.entries(manifest.features).filter(([k]) => !remove.includes(k)));
  await fs.writeFile(
    path.join(devflowDir(), 'manifest.json'),
    JSON.stringify({ ...manifest, features: { ...features, ...set } }, null, 2),
    'utf-8',
  );
}

describe('older manifests agree with the runtime gates', () => {
  it('a manifest without learning/knowledge keys: a plain re-init keeps both enabled (D-FEATURES-ABSENT-ON)', async () => {
    runInit(repoA, '--recommended');
    await editManifestFeatures(['learning', 'knowledge']);
    // The gates already read the absent keys as on…
    expect(runCli(repoA, 'learning', '--status').out).toContain('Learning: enabled');
    expect(runCli(repoA, 'knowledge', '--status').out).toContain('Status: enabled');

    // …so a plain re-init (an upgrade) must record them on, not seed them off.
    runInit(repoA, '--recommended');
    expect(await readManifestFeatures()).toMatchObject({ learning: true, knowledge: true });
    await seedLearningQueue(repoA);
    expect(sessionContext(repoA)).toContain('--- LEARNING MAINTENANCE ---');
  }, MULTI_RUN_TIMEOUT_MS);

  it('a manifest holding only the legacy decisions:false: learning is off in the hooks and the CLI status (D-LEARNING-LEGACY-DECISIONS)', async () => {
    runInit(repoA, '--recommended');
    await editManifestFeatures(['learning'], { decisions: false });
    await seedLearningQueue(repoB);

    expect(sessionContext(repoB)).not.toContain('LEARNING MAINTENANCE');
    const before = queueLines(nonGit);
    captureTurn(nonGit);
    expect(queueLines(nonGit), 'learning captured under a legacy decisions:false').toBe(before);
    // Non-vacuity: the capture hooks ran — memory (still on) captured the turn.
    expect(linesOf(memoryQueue(nonGit))).toBe(2);
    expect(runCli(repoA, 'learning', '--status').out).toContain('Learning: disabled');

    // An explicit learning value wins over the legacy key.
    await editManifestFeatures([], { learning: true });
    expect(sessionContext(repoB)).toContain('--- LEARNING MAINTENANCE ---');
    expect(runCli(repoA, 'learning', '--status').out).toContain('Learning: enabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('a manifest holding only the legacy kb:false: knowledge --status reports disabled (D-KNOWLEDGE-LEGACY-KB)', async () => {
    runInit(repoA, '--recommended');
    await editManifestFeatures(['knowledge'], { kb: false });
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: disabled');

    // An explicit knowledge value wins over the legacy key.
    await editManifestFeatures([], { knowledge: true });
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: enabled');
  }, MULTI_RUN_TIMEOUT_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// TP-7 — --hud-only over a full install
// ─────────────────────────────────────────────────────────────────────────────

describe('init --hud-only over a full install (D-HUD-ONLY-PRESERVE)', () => {
  it('keeps every prior manifest value and only turns the HUD on', async () => {
    runInit(repoA, '--recommended', '--no-hud');
    const prior = JSON.parse(await readManifestRaw()) as Record<string, unknown> & { features: Record<string, unknown> };
    expect(prior.features.hud).toBe(false);
    expect(prior.features.learning).toBe(true);

    runInit(repoA, '--hud-only');
    const after = JSON.parse(await readManifestRaw()) as Record<string, unknown> & { features: Record<string, unknown> };

    expect(after.features).toEqual({ ...prior.features, hud: true });
    expect(after.plugins).toEqual(prior.plugins);
    expect(after.version).toBe(prior.version);
    expect(after.installedAt).toBe(prior.installedAt);
    // With learning a machine-wide switch, a HUD install must not disable it.
    await seedLearningQueue(repoB);
    expect(sessionContext(repoB)).toContain('--- LEARNING MAINTENANCE ---');
  }, MULTI_RUN_TIMEOUT_MS);

  it('a fresh --hud-only install still records only the HUD', async () => {
    runInit(repoA, '--hud-only');
    const features = await readManifestFeatures();
    expect(features).toMatchObject({ hud: true, ambient: false, memory: false, rules: false, proxy: false });
    expect(JSON.parse(await readManifestRaw()).plugins).toEqual([]);
  }, MULTI_RUN_TIMEOUT_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// TP-9 — on→off re-init transitions converge every artifact (PF-015)
// ─────────────────────────────────────────────────────────────────────────────

describe('init on→off re-init transitions', () => {
  it('memory, ambient, HUD and rules all turn off on re-init', async () => {
    runInit(repoA, '--recommended', '--ambient', '--memory', '--hud', '--rules');
    const on = await readSettings();
    expect(hasMemoryHooks(on)).toBe(true);
    expect(hasAmbientHook(on)).toBe(true);
    expect(hasHudStatusLine(on)).toBe(true);
    expect(existsSync(path.join(claudeDir(), 'rules', 'devflow'))).toBe(true);
    // A pending memory queue that the memory-off re-init must drain.
    await fs.mkdir(path.join(repoA, '.devflow', 'memory'), { recursive: true });
    await fs.writeFile(path.join(repoA, '.devflow', 'memory', '.pending-turns.jsonl'), '{"role":"user","content":"x","ts":1}\n');

    runInit(repoA, '--recommended', '--no-ambient', '--no-memory', '--no-hud', '--no-rules');
    const off = await readSettings();
    expect(hasMemoryHooks(off)).toBe(false);
    expect(hasAmbientHook(off)).toBe(false);
    expect(hasHudStatusLine(off)).toBe(false);
    expect(existsSync(path.join(claudeDir(), 'rules', 'devflow'))).toBe(false);
    expect(await readManifestFeatures()).toMatchObject({ ambient: false, memory: false, hud: false, rules: false });
    // The per-repo config holds no feature switch (D-FEATURES-MACHINE-WIDE).
    expect(await readRepoConfig(repoA)).toEqual({ reviewPublication: 'auto' });
    expect(existsSync(path.join(repoA, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(JSON.parse(await fs.readFile(path.join(devflowDir(), 'hud.json'), 'utf-8')).enabled).toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);

  it('a plain `init --no-proxy` over a proxy-on install removes the hooks, the env and the manifest flag', async () => {
    runInit(repoA, '--recommended');
    // Seed the proxy-on state init would have written (the preflight cannot pass
    // in a sandbox): hooks + ANTHROPIC_BASE_URL + proxy.json + manifest flag.
    const settings = JSON.parse(await readSettings()) as Settings;
    addProxyHooks(settings, devflowDir());
    await fs.writeFile(
      path.join(claudeDir(), 'settings.json'),
      applyProxyEnv(JSON.stringify(settings), DEFAULT_PROXY_PORT),
      'utf-8',
    );
    const written = await writeProxyState(devflowDir(), buildProxyState({
      enabled: true, port: DEFAULT_PROXY_PORT, binPath: null, configPath: null, devflowVersion: null,
    }));
    expect(written.ok).toBe(true);
    const manifest = JSON.parse(await readManifestRaw()) as { features: Record<string, unknown> };
    manifest.features.proxy = true;
    await fs.writeFile(path.join(devflowDir(), 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    // Non-vacuous: the on state is really there.
    expect(hasProxyHooks(await readSettings())).toBe(true);
    expect(await readSettings()).toContain('ANTHROPIC_BASE_URL');

    runInit(repoA, '--no-proxy');
    const off = await readSettings();
    expect(hasProxyHooks(off)).toBe(false);
    expect(off).not.toContain('ANTHROPIC_BASE_URL');
    expect((await readManifestFeatures()).proxy).toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);
});
