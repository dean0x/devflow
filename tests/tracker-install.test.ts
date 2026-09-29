/**
 * Tests for src/targets/claude-code/tracker-install.ts, the installer's reference
 * overlay as every install now runs it, and `devflow tracker --set` / `--status`.
 *
 * D-INSTALL-ALL-PROVIDERS: every install carries every provider's mechanics, the
 * tool-call contract and the Tracker agent, whatever the machine selected — a
 * repository can select its own tracker in its committed project.json. So:
 *   - the Tracker AGENT file — `convergeTrackerArtifacts` — installs, always, and
 *     reports whether this run wrote it;
 *   - the generated REFERENCE subtree converges to ONE manifest, the full one;
 *   - `devflow tracker --set` writes only the manifest, the attempt counters and
 *     the sentinel (D-TRACKER-CONVERGE-SET) — it moves no reference and no agent.
 *
 * HOME safety (applies PF-060): every test injects an mkdtemp claudeDir. No test
 * reads or writes the real ~/.claude, and no test shells out to dist/cli.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

import { convergeTrackerArtifacts } from '../src/targets/claude-code/tracker-install.js';
import { overlayGeneratedReferences } from '../src/targets/claude-code/installer.js';
import {
  runTrackerSet,
  buildTrackerSetIO,
  readTrackerMechanics,
  formatTrackerMechanics,
  type TrackerSetIO,
} from '../src/cli/commands/tracker.js';
import {
  TRACKER_PROVIDER_IDS,
  trackerAttemptsPath,
  trackerEnabledSentinelPath,
  type TrackerProvider,
  type TrackerResult,
} from '../src/core/tracker.js';
import { installedReferenceManifest } from '../src/core/mds-variants.js';
import { compiledSkillRefsDir } from '../src/core/assets.js';
import { writeManifest, readManifest } from '../src/core/manifest.js';

let claudeDir: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };
const agentFile = (): string => path.join(claudeDir, 'agents', 'devflow', 'tracker.md');
const refsTarget = (): string => path.join(claudeDir, 'skills', 'devflow:git', 'references');

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** The one overlay every install runs, onto the full manifest. */
const overlayAll = () =>
  overlayGeneratedReferences({ referencesTarget: refsTarget(), manifest: installedReferenceManifest(), warn });

beforeEach(async () => {
  claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-install-'));
  warnings = [];
});

afterEach(async () => {
  await fs.rm(claudeDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// convergeTrackerArtifacts — the agent file, installed on every machine
// ---------------------------------------------------------------------------

describe('convergeTrackerArtifacts: the Tracker agent file', () => {
  it('installs the agent — it takes no provider, because every machine needs it', async () => {
    const result = await convergeTrackerArtifacts({ claudeDir, warn });
    expect(result).toEqual({ converged: true, agent: 'installed' });
    const body = await fs.readFile(agentFile(), 'utf-8');
    expect(body.length, 'the copy must carry the agent, not an empty file').toBeGreaterThan(100);
    expect(warnings).toEqual([]);
  });

  it('is idempotent — a second run over a byte-identical agent reports unchanged', async () => {
    await convergeTrackerArtifacts({ claudeDir, warn });
    const again = await convergeTrackerArtifacts({ claudeDir, warn });
    expect(
      again,
      'the file is byte-identical, so this run wrote nothing and must not claim it did',
    ).toEqual({ converged: true, agent: 'unchanged' });
    expect(await exists(agentFile())).toBe(true);
  });

  it('reports a hand-edited agent as INSTALLED — drift is converged, never hidden', async () => {
    await convergeTrackerArtifacts({ claudeDir, warn });
    const canonical = await fs.readFile(agentFile(), 'utf-8');
    await fs.writeFile(agentFile(), 'hand-edited\n', 'utf-8');

    const result = await convergeTrackerArtifacts({ claudeDir, warn });

    expect(await fs.readFile(agentFile(), 'utf-8')).toBe(canonical);
    expect(result.agent, 'this run DID write the file, so the summary has to say so').toBe('installed');
  });

  it('a relative claudeDir is refused, not resolved (precondition)', async () => {
    const result = await convergeTrackerArtifacts({ claudeDir: 'relative/path', warn });
    expect(result).toEqual({ converged: false, agent: 'unchanged' });
    expect(warnings.join('\n')).toMatch(/absolute/);
  });

  it('reports converged=false when the copy cannot be made (warn-not-throw)', async () => {
    // The agents directory exists as a FILE, so mkdir and copyFile both fail.
    await fs.mkdir(path.join(claudeDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'agents', 'devflow'), 'not a directory\n', 'utf-8');

    const result = await convergeTrackerArtifacts({ claudeDir, warn });
    expect(result.converged, 'a failed convergence must not report success').toBe(false);
    expect(warnings.length, 'the failure must be reported, not swallowed').toBeGreaterThan(0);
  });

  it('reports converged=false and names the build step when no source exists', async () => {
    const result = await convergeTrackerArtifacts({
      claudeDir,
      warn,
      agentSourceDirs: [path.join(claudeDir, 'no-such-source-dir')],
    });
    expect(result).toEqual({ converged: false, agent: 'unchanged' });
    expect(warnings.join('\n')).toContain('npm run build:mds');
  });

  it('never throws — callers read converged, they do not catch', async () => {
    await expect(
      convergeTrackerArtifacts({ claudeDir: path.join(claudeDir, 'nope'), warn }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The reference subtree — one manifest, every provider
// ---------------------------------------------------------------------------

async function listRefs(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), next);
      else out.push(next);
    }
  };
  await walk(refsTarget(), '');
  return out.sort();
}

describe('the reference overlay installs every provider (D-INSTALL-ALL-PROVIDERS)', () => {
  it('installs exactly the full manifest — every provider tree and _mcp.md', async () => {
    const result = await overlayAll();
    expect(result.overlayFailures).toEqual([]);
    const manifest = [...installedReferenceManifest()].sort();
    expect([...result.overlaidRefs].sort()).toEqual(manifest);
    expect(await listRefs()).toEqual(manifest);
    for (const provider of TRACKER_PROVIDER_IDS) {
      expect((await listRefs()).some(r => r.startsWith(`tracker/${provider}/`)), provider).toBe(true);
    }
    expect(await listRefs()).toContain('tracker/_mcp.md');
  });

  it('every installed file is byte-equal to the generated source', async () => {
    await overlayAll();
    for (const rel of installedReferenceManifest()) {
      const installed = await fs.readFile(path.join(refsTarget(), ...rel.split('/')));
      const generated = await fs.readFile(path.join(compiledSkillRefsDir(), ...rel.split('/')));
      expect(installed.equals(generated), `${rel} must be byte-equal`).toBe(true);
    }
  });

  it('still PRUNES what the manifest does not name (the prune is kept)', async () => {
    await overlayAll();
    const stray = path.join(refsTarget(), 'tracker', 'jira', 'retired-op.md');
    await fs.writeFile(stray, 'a generated document the registry dropped\n', 'utf-8');

    await overlayAll();

    // Converged away — by the provider unit's whole-directory swap or by the prune,
    // whichever the overlay takes; the property is that it is gone.
    expect(await exists(stray)).toBe(false);
    expect(await listRefs()).toEqual([...installedReferenceManifest()].sort());
  });
});

// ---------------------------------------------------------------------------
// `devflow tracker --set` — the manifest, the counters, the sentinel, and nothing else
// ---------------------------------------------------------------------------

describe('runTrackerSet: the convergence order is the invariant', () => {
  /**
   * Recording IO. Every call appends a labelled entry, so assertions read the
   * real call ORDER rather than a per-step boolean. The seam has exactly three
   * members: a fourth would be --set reaching for an artifact it no longer owns.
   */
  function makeRecorder(opts: {
    rearm?: TrackerResult<void>;
    sentinel?: TrackerResult<void>;
  } = {}) {
    const calls: string[] = [];
    const io: TrackerSetIO = {
      syncManifest: async (_dir, state) => { calls.push(`manifest:${state.provider}`); },
      rearmInference: async () => {
        calls.push('rearm');
        return opts.rearm ?? { ok: true, value: undefined };
      },
      applySentinel: async (_dir, provider) => {
        calls.push(`sentinel:${provider}`);
        return opts.sentinel ?? { ok: true, value: undefined };
      },
    };
    return { calls, io };
  }

  const run = (io: TrackerSetIO, current: TrackerProvider, requested: TrackerProvider) =>
    runTrackerSet({
      devflowDir: '/tmp/devflow-not-touched',
      current: { provider: current },
      requested,
      io,
    });

  it('writes in the fixed order: manifest, rearm, sentinel — and nothing else', async () => {
    const { calls, io } = makeRecorder();
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual(['manifest:jira', 'rearm', 'sentinel:jira']);
    expect(outcome.messages.at(-1)).toEqual({ level: 'success', text: 'Tracker: jira' });
  });

  it('the seam has exactly the three writers — no reference, agent or conventions step', () => {
    expect(Object.keys(buildTrackerSetIO()).sort()).toEqual(['applySentinel', 'rearmInference', 'syncManifest']);
  });

  it('returning to github converges the sentinel through the same owner (removal)', async () => {
    const { calls, io } = makeRecorder();
    await run(io, 'jira', 'github');
    expect(calls).toEqual(['manifest:github', 'rearm', 'sentinel:github']);
  });

  it('repeating the current provider still writes, and reports (unchanged)', async () => {
    const { calls, io } = makeRecorder();
    const outcome = await run(io, 'jira', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(calls, 'a repeat self-heals a missing sentinel rather than early-returning').toContain('sentinel:jira');
    expect(outcome.messages.at(-1)).toEqual({ level: 'info', text: 'Tracker: jira (unchanged)' });
  });

  it('a failed rearm or sentinel warns without aborting (applies PF-009)', async () => {
    const { calls, io } = makeRecorder({
      rearm: { ok: false, error: 'could not reset the attempt counter' },
      sentinel: { ok: false, error: 'could not update the sentinel' },
    });
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(calls).toHaveLength(3);
    const warned = outcome.messages.filter(m => m.level === 'warn').map(m => m.text);
    expect(warned).toEqual(['could not reset the attempt counter', 'could not update the sentinel']);
  });
});

/**
 * The recorder asserts the ORDER. This describe asserts what the shipped adapter
 * leaves on disk — and what it does NOT touch.
 *
 * HOME safety (applies PF-060): both directories are mkdtemp'd and passed in.
 */
describe('runTrackerSet through buildTrackerSetIO', () => {
  let devflowDir: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-set-home-'));
    await writeManifest(devflowDir, {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: false, memory: false, hud: false, knowledge: false, learning: false,
        rules: false, flags: {}, proxy: false,
        compliance: { enabled: false, frameworks: [] },
        tracker: { provider: 'github' },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Parameters<typeof writeManifest>[1]);
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  const set = (current: TrackerProvider, requested: TrackerProvider) =>
    runTrackerSet({ devflowDir, current: { provider: current }, requested, io: buildTrackerSetIO() });

  it('github → jira: the manifest and the named sentinel, every counter re-armed', async () => {
    for (const provider of TRACKER_PROVIDER_IDS) {
      await fs.writeFile(trackerAttemptsPath(devflowDir, provider), '5\n', 'utf-8');
    }

    const outcome = await set('github', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect((await readManifest(devflowDir))?.features.tracker.provider).toBe('jira');
    await expect(fs.readFile(trackerEnabledSentinelPath(devflowDir), 'utf-8')).resolves.toBe('jira\n');
    for (const provider of TRACKER_PROVIDER_IDS) {
      expect(await exists(trackerAttemptsPath(devflowDir, provider)), provider).toBe(false);
    }
  });

  it('jira → github removes the sentinel', async () => {
    await set('github', 'jira');
    await set('jira', 'github');
    expect(await exists(trackerEnabledSentinelPath(devflowDir))).toBe(false);
  });

  it('touches nothing under the Claude directory — no reference, no agent (AC-33)', async () => {
    await overlayAll();
    await convergeTrackerArtifacts({ claudeDir, warn });
    const before = await listRefs();

    await set('github', 'jira');
    await set('jira', 'github');

    expect(await listRefs(), 'tracker --set github deletes no reference').toEqual(before);
    expect(await exists(agentFile()), 'nor the agent').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `devflow tracker --status` — the mechanics arm
// ---------------------------------------------------------------------------

describe('readTrackerMechanics / formatTrackerMechanics', () => {
  it('reports MISSING when nothing is installed', async () => {
    const state = await readTrackerMechanics(claudeDir);
    expect(state).toEqual({ kind: 'missing' });
    expect(formatTrackerMechanics(state)).toBe('MISSING — run devflow init');
  });

  it('counts every installed reference against the one install manifest', async () => {
    await overlayAll();
    const state = await readTrackerMechanics(claudeDir);
    expect(state).toEqual({ kind: 'installed', count: installedReferenceManifest().length });
    expect(formatTrackerMechanics(state)).toContain('installed (');
  });

  it('counts what is PRESENT, so a damaged tree reads short', async () => {
    await overlayAll();
    await fs.rm(path.join(refsTarget(), 'tracker', 'linear'), { recursive: true });
    const state = await readTrackerMechanics(claudeDir);
    expect(state.kind).toBe('installed');
    expect(state.kind === 'installed' && state.count).toBeLessThan(installedReferenceManifest().length);
  });

  it('distinguishes "could not look" from "nothing there"', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    await overlayAll();
    const blocked = path.join(refsTarget(), 'tracker');
    await fs.chmod(blocked, 0o000);
    try {
      const state = await readTrackerMechanics(claudeDir);
      expect(state.kind).toBe('unreadable');
      expect(formatTrackerMechanics(state)).toContain('unreadable (');
      expect(formatTrackerMechanics(state)).not.toContain('run devflow init');
    } finally {
      await fs.chmod(blocked, 0o755).catch(() => undefined);
    }
  });
});
