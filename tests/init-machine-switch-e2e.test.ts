/**
 * End-to-end: `devflow init` as the MACHINE-WIDE control for learning and
 * knowledge (#378, D-LEARNING-MASTER-SWITCH / D-KNOWLEDGE-MASTER-SWITCH), the
 * per-repo `devflow learning|knowledge` commands, and init's on→off re-init
 * transitions.
 *
 * The reported bug: `devflow init --no-learning` printed "Learning: disabled"
 * while every OTHER repo — one holding a stale `learning: true` an earlier init
 * wrote, one with no config, a non-git cwd — kept capturing and spawning the
 * Learning agent, because the runtime gates read only the per-repo config.
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

const queueLines = (dir: string): number =>
  existsSync(learningQueue(dir)) ? readFileSync(learningQueue(dir), 'utf-8').split('\n').filter(Boolean).length : 0;

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
// TP-1 / TP-2 / TP-3 / TP-6 — init is the machine-wide switch
// ─────────────────────────────────────────────────────────────────────────────

describe('init --no-learning / --no-knowledge switch the features off machine-wide', () => {
  it('silences learning in a second repo and a non-git cwd, drains the cwd queue, and init --learning restores every repo', async () => {
    // Repo B carries the stale `true` an earlier init wrote — the reported case.
    await writeRepoConfig(repoB, { memory: true, learning: true, knowledge: true, reviewPublication: 'auto' });
    await seedLearningQueue(repoA);
    await fs.writeFile(learningProcessing(repoA), '{"role":"user","content":"claimed","ts":1}\n', 'utf-8');
    await seedLearningQueue(repoB);
    await seedLearningQueue(nonGit);

    const out = runInit(repoA, '--recommended', '--no-learning', '--no-knowledge');
    // The summary says what init actually did: machine-wide.
    expect(out).toContain('disabled in every project');

    expect(await readManifestFeatures()).toMatchObject({ learning: false, knowledge: false });

    // TP-6: the cwd repo's pending learning queue (and a claimed batch) is drained.
    expect(existsSync(learningQueue(repoA))).toBe(false);
    expect(existsSync(learningProcessing(repoA))).toBe(false);

    // TP-1: no Learning directive in the other repo or a non-git cwd…
    expect(sessionContext(repoB)).not.toContain('LEARNING MAINTENANCE');
    expect(sessionContext(nonGit)).not.toContain('LEARNING MAINTENANCE');
    // …and the capture hooks append nothing to their learning queues.
    for (const dir of [repoB, nonGit]) {
      const before = queueLines(dir);
      runInstalledHook('capture-prompt', { cwd: dir, prompt: 'another turn' });
      runInstalledHook('capture-turn', { cwd: dir, session_id: 's', last_assistant_message: 'a reply' });
      expect(queueLines(dir), `learning captured in ${dir} after a machine-wide disable`).toBe(before);
    }

    // TP-2: the status of a repo whose config still says true reports the truth.
    const learningStatus = runCli(repoB, 'learning', '--status').out;
    expect(learningStatus).toContain('Learning: disabled');
    expect(learningStatus).toContain('Machine-wide: off');
    expect(learningStatus).toContain('This project: on');
    const knowledgeStatus = runCli(repoB, 'knowledge', '--status').out;
    expect(knowledgeStatus).toContain('Status: disabled');
    expect(knowledgeStatus).toContain('Machine-wide: off');

    // D-INIT-REPO-SWITCH-PRESERVE: init recorded the choice in the manifest and
    // left repo A's own per-repo value alone…
    expect(await readRepoConfig(repoA)).toMatchObject({ learning: true, knowledge: true });

    // …so turning it back on from ANOTHER directory restores every repo, repo A
    // included — nothing is left silently off by an earlier machine-wide disable.
    runInit(nonGit, '--recommended', '--learning', '--knowledge');
    expect(await readManifestFeatures()).toMatchObject({ learning: true, knowledge: true });
    await seedLearningQueue(repoA);
    expect(sessionContext(repoA)).toContain('--- LEARNING MAINTENANCE ---');
    expect(sessionContext(repoB)).toContain('--- LEARNING MAINTENANCE ---');
    expect(runCli(repoB, 'knowledge', '--status').out).toContain('Status: enabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('a re-init keeps the machine-wide choice even from a repo whose config says true (ADR-014)', async () => {
    runInit(repoA, '--recommended', '--no-learning', '--no-knowledge');
    await writeRepoConfig(repoB, { memory: true, learning: true, knowledge: true, reviewPublication: 'auto' });

    // A plain re-init (an upgrade, say) from repo B must not flip the switch back.
    runInit(repoB, '--recommended');
    expect(await readManifestFeatures()).toMatchObject({ learning: false, knowledge: false });
  }, MULTI_RUN_TIMEOUT_MS);

  it('a re-init from a repo that turned learning off for itself does not turn it off everywhere', async () => {
    runInit(repoA, '--recommended');
    const disabled = runCli(repoB, 'learning', '--disable');
    expect(disabled.status).toBe(0);

    runInit(repoB, '--recommended');
    expect((await readManifestFeatures()).learning).toBe(true);
    // Repo B's own choice survives the re-init.
    expect((await readRepoConfig(repoB)).learning).toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// TP-4 / TP-5 — the per-repo commands never write the manifest
// ─────────────────────────────────────────────────────────────────────────────

describe('devflow learning|knowledge --enable/--disable are per-repo', () => {
  it('--disable changes only the repo config and leaves the manifest byte-identical', async () => {
    runInit(repoA, '--recommended');
    const before = await readManifestRaw();

    expect(runCli(repoB, 'learning', '--disable').status).toBe(0);
    expect(runCli(repoB, 'knowledge', '--disable').status).toBe(0);

    expect(await readManifestRaw()).toBe(before);
    expect(await readRepoConfig(repoB)).toMatchObject({ learning: false, knowledge: false });
    // The switch is still on, so a third repo is unaffected.
    expect(runCli(repoA, 'learning', '--status').out).toContain('Learning: enabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('--enable under a machine-wide off enables the repo, warns, names init, and writes no manifest', async () => {
    runInit(repoA, '--recommended', '--no-learning', '--no-knowledge');
    const before = await readManifestRaw();

    const learning = runCli(repoB, 'learning', '--enable');
    expect(learning.status).toBe(0);
    expect(learning.out).toContain('disabled machine-wide');
    expect(learning.out).toContain('devflow init --learning');

    const knowledge = runCli(repoB, 'knowledge', '--enable');
    expect(knowledge.status).toBe(0);
    expect(knowledge.out).toContain('disabled machine-wide');
    expect(knowledge.out).toContain('devflow init --knowledge');

    expect(await readManifestRaw()).toBe(before);
    expect(await readRepoConfig(repoB)).toMatchObject({ learning: true, knowledge: true });
    // Still effectively off: the per-repo command cannot override the switch.
    expect(runCli(repoB, 'learning', '--status').out).toContain('Learning: disabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('--enable under a machine-wide on does not warn', async () => {
    runInit(repoA, '--recommended');
    const learning = runCli(repoB, 'learning', '--enable');
    expect(learning.status).toBe(0);
    expect(learning.out).not.toContain('disabled machine-wide');
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
    expect((await readRepoConfig(repoA)).memory).toBe(false);
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
