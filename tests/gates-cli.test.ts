/**
 * Tests for src/cli/commands/gates.ts
 *
 * Two halves:
 *   - in-process: the gather step over a stubbed resolver and manifest read, the pure
 *     renderer over every status outcome, the writer-result mapping, and the set
 *     path over a scratch devflow directory
 *   - spawned: the built CLI under a temp HOME and a temp repository, for what only a
 *     real run shows (exit codes, what `--set` writes, what `--status` reads, help)
 *
 * The spawned half needs a build (`npm run build`). Every spawn gets its env from
 * `sandboxEnv(tmpHome)`, so no real install is read or written.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stripVTControlCharacters } from 'util';

import { makeManifest, requireBuiltCli, sandboxEnv } from './helpers.js';
import {
  describeGateWrite,
  gatherGateStatus,
  gatesCommand,
  renderGateStatus,
  runGatesSet,
  type GateStatus,
  type GateStatusDeps,
} from '../src/cli/commands/gates.js';
import { GATE_LEVELS, readGateManifest, type GateManifestRead } from '../src/core/gate-level.js';
import { trackedConfigWarning, type RepoSettings, type RepoSettingsOptions, type SettingsLoad } from '../src/core/evidence-policy.js';

const CLI = requireBuiltCli();

/** One CLI spawn under a loaded suite runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;

// ── In-process fixtures ────────────────────────────────────────────────────────

const BASE_SETTINGS: RepoSettings = {
  ok: true,
  tracker: 'github',
  trackerSource: 'default',
  trackerWarn: 'none',
  site: null,
  key: null,
  reviewPublication: 'auto',
  compliance: { enabled: false, frameworks: [] },
  switches: {
    memory: { on: true, source: 'machine' },
    learning: { on: true, source: 'machine' },
    knowledge: { on: true, source: 'machine' },
  },
  gateLevel: 'standard',
  gateLevelSource: 'default',
  gateLevelInvalid: false,
  gateLevelMachine: null,
  repoCompliance: null,
  defaultBranchCompliance: null,
  personalTracked: false,
  retiredPolicyFile: false,
  unreadable: null,
};

const settings = (over: Partial<RepoSettings>): RepoSettings => ({ ...BASE_SETTINGS, ...over });

/** A resolver stub that records every resolve call. */
function stubResolver(result: () => RepoSettings): { load: () => SettingsLoad; calls: RepoSettingsOptions[] } {
  const calls: RepoSettingsOptions[] = [];
  const load = (): SettingsLoad => ({
    ok: true,
    value: {
      SETTINGS_LINE_RE: /^$/,
      SETTINGS_FAIL_CLOSED_LINE: '',
      resolveSettings: (opts) => {
        calls.push(opts);
        return result();
      },
      serializeProjectSuggestion: () => null,
    },
  });
  return { load, calls };
}

const ABSENT: GateManifestRead = { kind: 'absent' };
const objectManifest = (gateLevel?: unknown): GateManifestRead => ({
  kind: 'object',
  raw: { features: gateLevel === undefined ? {} : { gateLevel } },
});

function deps(over: Partial<GateStatusDeps> & Pick<GateStatusDeps, 'loadSettings'>): GateStatusDeps {
  return { devflowDir: '/home/me/.devflow', dir: '/work/repo', readManifest: async () => ABSENT, ...over };
}

// ── gather ─────────────────────────────────────────────────────────────────────

describe('gatherGateStatus', () => {
  it('returns a resolved result carrying the deciding layer, the invalid flag and the machine value', async () => {
    const r = stubResolver(() => settings({ gateLevel: 'lean', gateLevelSource: 'personal', gateLevelMachine: 'full' }));
    const status = await gatherGateStatus(deps({ loadSettings: r.load }));
    expect(status).toMatchObject({ kind: 'resolved', level: 'lean', source: 'personal', invalid: false, machine: 'full', trackedWarning: null });
  });

  it('resolves the settings once per run and feeds that one result to the tracked-config warning', async () => {
    const r = stubResolver(() => settings({ personalTracked: true }));
    const status = await gatherGateStatus(deps({ loadSettings: r.load }));
    expect(r.calls).toEqual([{ dir: '/work/repo' }]);
    expect(status.kind === 'resolved' && status.trackedWarning).toBe(trackedConfigWarning(settings({ personalTracked: true })));
    expect(status.kind === 'resolved' && status.trackedWarning).toContain('git rm --cached');
  });

  it('names an unreadable repository file as the reason a result failed closed', async () => {
    const r = stubResolver(() => settings({ ok: false, gateLevel: 'full', gateLevelSource: null, unreadable: 'personal', gateLevelMachine: 'lean' }));
    const status = await gatherGateStatus(deps({ loadSettings: r.load }));
    expect(status).toMatchObject({ kind: 'fail-closed', reason: '.devflow/config.json is unreadable', machine: 'lean' });
  });

  it('gives no reason when the resolver failed closed without naming one', async () => {
    const r = stubResolver(() => settings({ ok: false, gateLevel: 'full', gateLevelSource: null, unreadable: null }));
    const status = await gatherGateStatus(deps({ loadSettings: r.load }));
    expect(status).toMatchObject({ kind: 'fail-closed', reason: null, machine: null });
  });

  it('takes the TypeScript reader\'s machine value when the resolver failed closed without reading the manifest', async () => {
    const r = stubResolver(() => settings({ ok: false, gateLevel: 'full', gateLevelSource: null, unreadable: null, gateLevelMachine: null }));
    const status = await gatherGateStatus(deps({ loadSettings: r.load, readManifest: async () => objectManifest('lean') }));
    expect(status).toMatchObject({ kind: 'fail-closed', reason: null, machine: 'lean' });
  });

  it('keeps the resolver\'s machine value when it named an unreadable file and the manifest records none', async () => {
    const r = stubResolver(() => settings({ ok: false, gateLevel: 'full', gateLevelSource: null, unreadable: 'personal', gateLevelMachine: null }));
    const status = await gatherGateStatus(deps({ loadSettings: r.load, readManifest: async () => objectManifest() }));
    expect(status).toMatchObject({ kind: 'fail-closed', machine: null });
    expect(renderGateStatus(status).lines).toContain('Machine:   none');
  });

  it('reports the TypeScript reader\'s machine value when the resolver cannot be loaded', async () => {
    const load = (): SettingsLoad => ({ ok: false, error: { kind: 'not-found', path: '/x/resolve-settings.cjs' } });
    const status = await gatherGateStatus(deps({ loadSettings: load, readManifest: async () => objectManifest('lean') }));
    expect(status).toMatchObject({ kind: 'unloadable', machine: 'lean', manifest: 'readable' });
  });

  it('treats a resolver that throws as unusable and keeps the machine value', async () => {
    const r = stubResolver(() => { throw new Error('boom'); });
    const status = await gatherGateStatus(deps({ loadSettings: r.load, readManifest: async () => objectManifest('Lean') }));
    expect(status).toMatchObject({ kind: 'unloadable', machine: 'invalid' });
  });

  it('classifies the manifest: absent, readable, and corrupt or rejected as unreadable', async () => {
    const r = stubResolver(() => BASE_SETTINGS);
    const state = async (read: GateManifestRead): Promise<string> =>
      (await gatherGateStatus(deps({ loadSettings: r.load, readManifest: async () => read }))).manifest;
    expect(await state(ABSENT)).toBe('absent');
    expect(await state(objectManifest('lean'))).toBe('readable');
    expect(await state({ kind: 'corrupt' })).toBe('unreadable');
    expect(await state({ kind: 'rejected', raw: { features: {} } })).toBe('unreadable');
  });
});

// ── render ─────────────────────────────────────────────────────────────────────

const MANIFEST_PATH = '/home/me/.devflow/manifest.json';
const base = { manifest: 'readable', manifestPath: MANIFEST_PATH } as const;

describe('renderGateStatus', () => {
  it('prints the level and its source with the machine value', () => {
    const status: GateStatus = { ...base, kind: 'resolved', level: 'lean', source: 'personal', invalid: false, machine: null, trackedWarning: null };
    expect(renderGateStatus(status)).toEqual({ lines: ['Effective: lean (personal)', 'Machine:   none'], warnings: [] });
  });

  it('prints a machine level as the source when it decides', () => {
    const status: GateStatus = { ...base, kind: 'resolved', level: 'lean', source: 'machine', invalid: false, machine: 'lean', trackedWarning: null };
    expect(renderGateStatus(status).lines).toEqual(['Effective: lean (machine)', 'Machine:   lean']);
  });

  it('marks a malformed personal value invalid, names config.json and says full is in effect', () => {
    const status: GateStatus = { ...base, kind: 'resolved', level: 'full', source: 'personal', invalid: true, machine: 'lean', trackedWarning: null };
    const out = renderGateStatus(status);
    expect(out.lines[0]).toBe('Effective: full (personal, invalid)');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('.devflow/config.json');
    expect(out.warnings[0]).toContain('full is in effect');
  });

  it('shows a malformed machine value as invalid whichever layer decides', () => {
    const status: GateStatus = { ...base, kind: 'resolved', level: 'lean', source: 'personal', invalid: false, machine: 'invalid', trackedWarning: null };
    const out = renderGateStatus(status);
    expect(out.lines).toEqual(['Effective: lean (personal)', 'Machine:   invalid (manifest.json; reads as full)']);
    expect(out.warnings).toEqual([]);
  });

  it('prints the fail-closed level with its reason, and with reason unknown when there is none', () => {
    const named: GateStatus = { ...base, kind: 'fail-closed', reason: '.devflow/project.json is unreadable', machine: 'lean', trackedWarning: null };
    expect(renderGateStatus(named).lines).toEqual(['Effective: full (fail-closed: .devflow/project.json is unreadable)', 'Machine:   lean']);
    const unnamed: GateStatus = { ...base, kind: 'fail-closed', reason: null, machine: null, trackedWarning: null };
    expect(renderGateStatus(unnamed).lines).toEqual(['Effective: full (fail-closed: reason unknown)', 'Machine:   none']);
  });

  it('prints an unknown effective level when the resolver did not load', () => {
    const status: GateStatus = { ...base, kind: 'unloadable', machine: 'lean' };
    const out = renderGateStatus(status);
    expect(out.lines).toEqual(['Effective: level unknown', 'Machine:   lean']);
    expect(out.warnings).toHaveLength(1);
  });

  it('adds the tracked-config warning when it applies', () => {
    const status: GateStatus = { ...base, kind: 'resolved', level: 'standard', source: 'default', invalid: false, machine: null, trackedWarning: 'tracked!' };
    expect(renderGateStatus(status).warnings).toEqual(['tracked!']);
  });

  it('warns that init will replace an unreadable manifest, naming its path, and says nothing for an absent one', () => {
    const unreadable: GateStatus = { kind: 'resolved', manifest: 'unreadable', manifestPath: MANIFEST_PATH, level: 'standard', source: 'default', invalid: false, machine: null, trackedWarning: null };
    expect(renderGateStatus(unreadable).warnings).toEqual([
      `Manifest at ${MANIFEST_PATH} cannot be read as a manifest; devflow init will replace this file.`,
    ]);
    expect(renderGateStatus({ ...unreadable, manifest: 'absent' }).warnings).toEqual([]);
  });

  it('never prints a raw value for any outcome', () => {
    const canary = 'ZZ-raw-canary';
    const statuses: GateStatus[] = [
      { ...base, kind: 'resolved', level: 'full', source: 'personal', invalid: true, machine: 'invalid', trackedWarning: null },
      { ...base, kind: 'fail-closed', reason: null, machine: 'invalid', trackedWarning: null },
      { ...base, kind: 'unloadable', machine: 'invalid' },
    ];
    for (const status of statuses) {
      const out = renderGateStatus(status);
      expect([...out.lines, ...out.warnings].join('\n')).not.toContain(canary);
    }
  });
});

// ── set ────────────────────────────────────────────────────────────────────────

describe('describeGateWrite', () => {
  const file = '/home/me/.devflow/manifest.json';

  it('prints the level on a write and marks a repeat unchanged, both exiting 0', () => {
    expect(describeGateWrite({ kind: 'written' }, 'lean', file)).toEqual({ kind: 'success', message: 'Gate level: lean', exitCode: 0 });
    expect(describeGateWrite({ kind: 'unchanged' }, 'lean', file)).toEqual({ kind: 'info', message: 'Gate level: lean (unchanged)', exitCode: 0 });
  });

  it('names the manifest path when devflow is not installed, and exits 1', () => {
    const out = describeGateWrite({ kind: 'not-installed' }, 'lean', file);
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain(file);
    expect(out.message).toContain('devflow init');
  });

  it('says nothing changed for an unreadable manifest, naming the path and the remedy', () => {
    const out = describeGateWrite({ kind: 'unreadable', path: file }, 'lean', file);
    expect(out).toEqual({
      kind: 'error',
      message: `Manifest at ${file} exists but cannot be read; nothing changed. Move it aside, then run devflow init.`,
      exitCode: 1,
    });
  });

  it('names the path and the error code for a failed write', () => {
    const out = describeGateWrite({ kind: 'write-failed', path: file, reason: 'EACCES' }, 'lean', file);
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain(file);
    expect(out.message).toContain('EACCES');
  });

  it('names every valid level and echoes a bad one only in sanitized form, for an invalid level', () => {
    const out = describeGateWrite({ kind: 'invalid-level' }, 'le\u001b[31man' as never, file);
    expect(out.kind).toBe('error');
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain('nothing changed');
    for (const level of GATE_LEVELS) expect(out.message).toContain(level);
    // eslint-disable-next-line no-control-regex
    expect(out.message).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});

describe('runGatesSet over a scratch devflow directory', () => {
  let dir: string;
  const manifestFile = (): string => path.join(dir, 'manifest.json');
  const NOW = '2030-01-01T00:00:00.000Z';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gates-set-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes the level and the stamp, then leaves a repeat byte-identical', async () => {
    await fs.writeFile(manifestFile(), JSON.stringify(makeManifest(), null, 2) + '\n');
    expect(await runGatesSet(dir, 'lean', () => NOW)).toMatchObject({ kind: 'success', exitCode: 0 });
    const written = await fs.readFile(manifestFile(), 'utf-8');
    const parsed = JSON.parse(written) as { updatedAt: string; features: Record<string, unknown> };
    expect(parsed.features.gateLevel).toBe('lean');
    expect(parsed.updatedAt).toBe(NOW);
    expect(await runGatesSet(dir, 'lean', () => '2031-01-01T00:00:00.000Z')).toMatchObject({ kind: 'info', message: 'Gate level: lean (unchanged)' });
    expect(await fs.readFile(manifestFile(), 'utf-8')).toBe(written);
  });

  it('refuses without a manifest and creates none', async () => {
    expect(await runGatesSet(dir, 'lean')).toMatchObject({ kind: 'error', exitCode: 1 });
    await expect(fs.access(manifestFile())).rejects.toThrow();
  });

  it('refuses a level that is not one of the three words and leaves the manifest alone', async () => {
    const body = JSON.stringify(makeManifest(), null, 2) + '\n';
    await fs.writeFile(manifestFile(), body);
    const out = await runGatesSet(dir, 'Lean' as never, () => NOW);
    expect(out).toMatchObject({ kind: 'error', exitCode: 1 });
    expect(out.message).toContain('nothing changed');
    expect(await fs.readFile(manifestFile(), 'utf-8')).toBe(body);
  });

  it('refuses a corrupt manifest and leaves its bytes alone', async () => {
    await fs.writeFile(manifestFile(), '{not json');
    const out = await runGatesSet(dir, 'lean');
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain('nothing changed');
    expect(await fs.readFile(manifestFile(), 'utf-8')).toBe('{not json');
  });
});

// ── the command object ─────────────────────────────────────────────────────────

describe('gatesCommand', () => {
  it('defines --status and --set <level>', () => {
    expect(gatesCommand.name()).toBe('gates');
    expect(gatesCommand.options.map(o => o.long).sort()).toEqual(['--set', '--status']);
  });

  it('reads the manifest it shows with the gate reader and not the healing one', async () => {
    // The gate reader is the one the shell passes; an absent file reads as absent.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gates-read-'));
    try {
      expect(await readGateManifest(dir)).toEqual({ kind: 'absent' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── spawned: the built CLI ─────────────────────────────────────────────────────

let tmpHome: string;
let repo: string;
let outside: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const manifestPath = (): string => path.join(devflowDir(), 'manifest.json');

interface CliRun {
  readonly status: number | null;
  readonly out: string;
}

function runCli(args: readonly string[], cwd: string = repo): CliRun {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: stripVTControlCharacters(`${result.stdout ?? ''}${result.stderr ?? ''}`) };
}

/** A manifest the manifest reader accepts, with `features` extended by `gateLevel` when given. */
function manifestJson(gateLevel?: unknown): string {
  const m = makeManifest();
  const features: Record<string, unknown> = { ...m.features };
  if (gateLevel !== undefined) features.gateLevel = gateLevel;
  return JSON.stringify({ ...m, features }, null, 2) + '\n';
}

async function writeManifestText(text: string): Promise<void> {
  await fs.mkdir(devflowDir(), { recursive: true });
  await fs.writeFile(manifestPath(), text);
}

async function writePersonal(text: string): Promise<void> {
  await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
  await fs.writeFile(path.join(repo, '.devflow', 'config.json'), text);
}

/** Every file under `root` (not `.git`) with its bytes, so "writes nothing" is a comparison. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out[path.relative(root, abs)] = await fs.readFile(abs, 'utf-8');
    }
  };
  await walk(root);
  return out;
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gates-home-'));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gates-repo-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gates-outside-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(async () => {
  await fs.chmod(devflowDir(), 0o755).catch(() => undefined);
  for (const dir of [tmpHome, repo, outside]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('devflow gates --set', () => {
  it('changes only features.gateLevel and updatedAt, and touches no other file', async () => {
    await writeManifestText(manifestJson());
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(repo, '.devflow', 'project.json'), '{"version":1}\n');
    await writePersonal('{"reviewPublication":"auto"}\n');
    const homeBefore = await snapshot(tmpHome);
    const repoBefore = await snapshot(repo);
    const before = JSON.parse(homeBefore['.devflow/manifest.json']) as Record<string, unknown> & { features: Record<string, unknown> };

    const run = runCli(['gates', '--set', 'lean']);

    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Gate level: lean');
    const homeAfter = await snapshot(tmpHome);
    expect(Object.keys(homeAfter)).toEqual(Object.keys(homeBefore));
    const after = JSON.parse(homeAfter['.devflow/manifest.json']) as Record<string, unknown> & { features: Record<string, unknown>; updatedAt: string };
    const { features: afterFeatures, updatedAt, ...afterRest } = after;
    const { features: beforeFeatures, updatedAt: beforeUpdatedAt, ...beforeRest } = before;
    expect(afterRest).toEqual(beforeRest);
    expect(afterFeatures).toEqual({ ...beforeFeatures, gateLevel: 'lean' });
    expect(updatedAt).not.toBe(beforeUpdatedAt);
    expect(await snapshot(repo)).toEqual(repoBefore);
  }, SUBPROCESS_TIMEOUT_MS);

  it('marks a repeat unchanged and leaves the manifest bytes and mtime alone', async () => {
    await writeManifestText(manifestJson());
    expect(runCli(['gates', '--set', 'lean']).status).toBe(0);
    const bytes = await fs.readFile(manifestPath(), 'utf-8');
    const mtime = (await fs.stat(manifestPath())).mtimeMs;

    const repeat = runCli(['gates', '--set', 'lean']);

    expect(repeat.status, repeat.out).toBe(0);
    expect(repeat.out).toContain('Gate level: lean (unchanged)');
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(bytes);
    expect((await fs.stat(manifestPath())).mtimeMs).toBe(mtime);
  }, SUBPROCESS_TIMEOUT_MS);

  it('stores the last level typed', async () => {
    await writeManifestText(manifestJson());
    expect(runCli(['gates', '--set', 'full']).status).toBe(0);
    expect(runCli(['gates', '--set', 'lean']).status).toBe(0);
    const stored = JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as { features: { gateLevel: string } };
    expect(stored.features.gateLevel).toBe('lean');
  }, SUBPROCESS_TIMEOUT_MS);

  it('writes an explicit standard when the manifest records no level', async () => {
    await writeManifestText(manifestJson());
    const run = runCli(['gates', '--set', 'standard']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Gate level: standard');
    const stored = JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as { features: Record<string, unknown> };
    expect(stored.features.gateLevel).toBe('standard');
  }, SUBPROCESS_TIMEOUT_MS);

  it('writes into a manifest the manifest reader rejects, keeping its other keys', async () => {
    await writeManifestText('{"features":{"memory":true},"extra":1}\n');
    const run = runCli(['gates', '--set', 'lean']);
    expect(run.status, run.out).toBe(0);
    const stored = JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as { features: Record<string, unknown>; extra: number };
    expect(stored.features).toEqual({ memory: true, gateLevel: 'lean' });
    expect(stored.extra).toBe(1);
  }, SUBPROCESS_TIMEOUT_MS);

  it.skipIf(process.getuid?.() === 0)('exits 1 and leaves the manifest byte-identical when the devflow directory is read-only', async () => {
    await writeManifestText(manifestJson());
    const before = await fs.readFile(manifestPath(), 'utf-8');
    await fs.chmod(devflowDir(), 0o555);
    const run = runCli(['gates', '--set', 'lean']);
    await fs.chmod(devflowDir(), 0o755);
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain(manifestPath());
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it.each([
    ['a wrong-case level', 'Lean'],
    ['a level with a trailing space', 'lean '],
    ['an empty value', ''],
    ['an unknown word', 'strict'],
  ])('rejects %s with exit 1, names the valid levels and writes nothing', async (_label, value) => {
    await writeManifestText(manifestJson());
    const before = await snapshot(tmpHome);
    const run = runCli(['gates', '--set', value]);
    expect(run.status, run.out).toBe(1);
    for (const level of ['full', 'standard', 'lean']) expect(run.out).toContain(level);
    expect(await snapshot(tmpHome)).toEqual(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it('rejects --set with no value with exit 1, reports the missing argument and writes nothing', async () => {
    await writeManifestText(manifestJson());
    const before = await snapshot(tmpHome);
    const run = runCli(['gates', '--set']);
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain('argument missing');
    expect(run.out).not.toContain('Gate levels:');
    expect(await snapshot(tmpHome)).toEqual(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it('exits 1 with the manifest path and writes nothing when there is no manifest', async () => {
    const run = runCli(['gates', '--set', 'lean']);
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain(manifestPath());
    await expect(fs.access(manifestPath())).rejects.toThrow();
  }, SUBPROCESS_TIMEOUT_MS);

  it('exits 1 for a corrupt manifest, names the path, says nothing changed and keeps the bytes', async () => {
    await writeManifestText('{not json');
    const run = runCli(['gates', '--set', 'lean']);
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain(manifestPath());
    expect(run.out).toContain('nothing changed');
    expect(run.out).not.toContain('Run devflow init first');
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe('{not json');
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('devflow gates --status', () => {
  it('prints the default with no personal key, no machine level and no warning', async () => {
    await writeManifestText(manifestJson());
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).toContain('Machine:   none');
    expect(run.out).not.toContain('cannot be read');
  }, SUBPROCESS_TIMEOUT_MS);

  it('lets a personal level decide, and shows the machine value or none', async () => {
    await writePersonal('{"gateLevel":"lean"}\n');
    await writeManifestText(manifestJson());
    const none = runCli(['gates', '--status']);
    expect(none.out).toContain('Effective: lean (personal)');
    expect(none.out).toContain('Machine:   none');
    await writeManifestText(manifestJson('full'));
    const full = runCli(['gates', '--status']);
    expect(full.out).toContain('Effective: lean (personal)');
    expect(full.out).toContain('Machine:   full');
  }, SUBPROCESS_TIMEOUT_MS);

  it('shows the machine level as the source when no personal key exists', async () => {
    await writeManifestText(manifestJson('lean'));
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: lean (machine)');
    expect(run.out).toContain('Machine:   lean');
  }, SUBPROCESS_TIMEOUT_MS);

  it('warns about a git-tracked config.json and treats its level as absent', async () => {
    await writePersonal('{"gateLevel":"lean"}\n');
    execFileSync('git', ['add', '-f', '.devflow/config.json'], { cwd: repo });
    await writeManifestText(manifestJson());
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('git rm --cached');
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).not.toContain('(personal)');
  }, SUBPROCESS_TIMEOUT_MS);

  it('reports a malformed personal level as invalid, names config.json and never echoes the value', async () => {
    await writePersonal('{"gateLevel":"ZZ-raw-canary"}\n');
    await writeManifestText(manifestJson('lean'));
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: full (personal, invalid)');
    expect(run.out).toContain('.devflow/config.json');
    expect(run.out).toContain('full is in effect');
    expect(run.out).not.toContain('ZZ-raw-canary');
  }, SUBPROCESS_TIMEOUT_MS);

  it('reports an unreadable config.json as a fail-closed full naming the file, with no source', async () => {
    await writePersonal('[1]\n');
    await writeManifestText(manifestJson('lean'));
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: full (fail-closed: .devflow/config.json is unreadable)');
    expect(run.out).toContain('Machine:   lean');
  }, SUBPROCESS_TIMEOUT_MS);

  it('shows a malformed machine value as invalid behind a valid personal level, with no manifest warning', async () => {
    await writePersonal('{"gateLevel":"lean"}\n');
    await writeManifestText(manifestJson('Lean'));
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: lean (personal)');
    expect(run.out).toContain('Machine:   invalid (manifest.json; reads as full)');
    expect(run.out).not.toContain('cannot be read');
  }, SUBPROCESS_TIMEOUT_MS);

  it('prints the default with no warning and exits 0 when no manifest exists', async () => {
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).toContain('Machine:   none');
    expect(run.out).not.toContain('cannot be read');
  }, SUBPROCESS_TIMEOUT_MS);

  it('prints the machine value outside a git repository with no warning', async () => {
    await writeManifestText(manifestJson('lean'));
    const run = runCli(['gates', '--status'], outside);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: lean (machine)');
    expect(run.out).not.toContain('cannot be read');
  }, SUBPROCESS_TIMEOUT_MS);

  it('warns that init will replace an unparseable manifest, and reads it as the default', async () => {
    await writeManifestText('{not json');
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).toContain(`Manifest at ${manifestPath()} cannot be read as a manifest; devflow init will replace this file.`);
  }, SUBPROCESS_TIMEOUT_MS);

  it('warns for a directory at the manifest path', async () => {
    await fs.mkdir(manifestPath(), { recursive: true });
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).toContain('devflow init will replace this file');
  }, SUBPROCESS_TIMEOUT_MS);

  it('warns for a manifest over 1 MiB and reads it as the default', async () => {
    const m = JSON.parse(manifestJson('lean')) as Record<string, unknown>;
    await writeManifestText(JSON.stringify({ ...m, pad: 'x'.repeat(1_100_000) }));
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).toContain('devflow init will replace this file');
  }, SUBPROCESS_TIMEOUT_MS);

  it('warns for valid JSON the manifest reader rejects, and keeps its stored level', async () => {
    await writeManifestText('{"features":{"gateLevel":"lean"}}\n');
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: lean (machine)');
    expect(run.out).toContain('devflow init will replace this file');
  }, SUBPROCESS_TIMEOUT_MS);

  it('warns for a manifest with a leading byte-order mark, which the manifest reader rejects, and keeps its stored level', async () => {
    await writeManifestText('\ufeff' + manifestJson('lean'));
    const run = runCli(['gates', '--status']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: lean (machine)');
    expect(run.out).toContain('devflow init will replace this file');
  }, SUBPROCESS_TIMEOUT_MS);

  it('wins over --set, exits 0 and writes nothing, even over a manifest the manifest reader would heal', async () => {
    const m = JSON.parse(manifestJson()) as { features: Record<string, unknown> };
    delete m.features.knowledge;
    delete m.features.learning;
    m.features.kb = true;
    m.features.decisions = true;
    await writeManifestText(JSON.stringify(m, null, 2) + '\n');
    const before = await snapshot(tmpHome);
    const run = runCli(['gates', '--status', '--set', 'lean']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('Effective: standard (default)');
    expect(run.out).not.toContain('Gate level: lean');
    expect(await snapshot(tmpHome)).toEqual(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it.each([
    ['a wrong-case level', 'Lean'],
    ['an empty value', ''],
  ])('exits 1 for %s given to --set, even beside --status, and writes nothing', async (_label, value) => {
    await writeManifestText(manifestJson('lean'));
    const before = await snapshot(tmpHome);
    const run = runCli(['gates', '--status', '--set', value]);
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain('Valid levels: full, standard, lean');
    expect(run.out).not.toContain('Effective:');
    expect(await snapshot(tmpHome)).toEqual(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it('writes nothing under the home or the repository, and calls neither the tracker re-arm nor its sentinel', async () => {
    await writeManifestText(manifestJson('lean'));
    const homeBefore = await snapshot(tmpHome);
    const repoBefore = await snapshot(repo);
    expect(runCli(['gates', '--status']).status).toBe(0);
    expect(await snapshot(tmpHome)).toEqual(homeBefore);
    expect(await snapshot(repo)).toEqual(repoBefore);
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('devflow gates (help and usage)', () => {
  it('prints usage and exits 0 with no flag, writing nothing', async () => {
    await writeManifestText(manifestJson());
    const before = await snapshot(tmpHome);
    const run = runCli(['gates']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('devflow gates --status');
    expect(run.out).toContain('devflow gates --set <level>');
    expect(await snapshot(tmpHome)).toEqual(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it('lists the three levels with a meaning each, and says the level has no effect yet', () => {
    const run = runCli(['gates', '--help']);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toMatch(/full\s+the most checking/);
    expect(run.out).toMatch(/standard\s+the default/);
    expect(run.out).toMatch(/lean\s+the least checking/);
    expect(run.out).toContain('no effect until issues #473, #474 and #480 read it');
    expect(run.out).toContain('Set the machine\'s default gate level: full, standard, or lean');
  }, SUBPROCESS_TIMEOUT_MS);

  it('is listed in the top-level help', () => {
    const run = runCli(['--help']);
    expect(run.out).toMatch(/\n {2}gates /);
  }, SUBPROCESS_TIMEOUT_MS);
});
