/**
 * Tests for src/targets/claude-code/tracker-install.ts and the installer's
 * provider-scoped reference overlay.
 *
 * Two artifacts converge with the tracker provider, and they belong to different
 * owners on purpose (design review M2):
 *   - the Tracker AGENT file — `convergeTrackerArtifacts`, which owns it alone
 *     and carries no overlay mode flag;
 *   - the generated REFERENCE subtree — `overlayInstalledReferences`, the
 *     installer's export, because it is the installer's one overlay spelling.
 * `devflow tracker --set` calls both, explicitly, in the fixed order.
 *
 * Both directions of every biconditional are tested: an artifact that installs
 * under jira and never leaves under github is the drifted state this file
 * exists to make impossible (applies PF-015).
 *
 * HOME safety (applies PF-060): every test injects an mkdtemp claudeDir. No test
 * reads or writes the real ~/.claude, and no test shells out to dist/cli.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

import { convergeTrackerArtifacts, type ConvergeTrackerArtifactsResult } from '../src/targets/claude-code/tracker-install.js';
import { overlayInstalledReferences, type OverlayFailure } from '../src/targets/claude-code/installer.js';
import {
  runTrackerSet,
  buildTrackerSetIO,
  readTrackerMechanics,
  formatTrackerMechanics,
  type TrackerSetIO,
} from '../src/cli/commands/tracker.js';
import type { TrackerProvider, TrackerResult, TrackerTransition } from '../src/core/tracker.js';
import { installedReferenceManifest } from '../src/core/mds-variants.js';
import { compiledSkillRefsDir } from '../src/core/assets.js';

let claudeDir: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };
const agentFile = (): string => path.join(claudeDir, 'agents', 'devflow', 'tracker.md');
const refsTarget = (): string => path.join(claudeDir, 'skills', 'devflow:git', 'references');

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

beforeEach(async () => {
  claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-install-'));
  warnings = [];
});

afterEach(async () => {
  await fs.rm(claudeDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// convergeTrackerArtifacts — the agent file, biconditional in both directions
// ---------------------------------------------------------------------------

describe('convergeTrackerArtifacts: the Tracker agent file', () => {
  it.each(['jira', 'linear'] as const)('installs the agent under %s', async (provider) => {
    const result = await convergeTrackerArtifacts({ claudeDir, provider, warn });
    expect(result.converged).toBe(true);
    expect(result.agent).toBe('installed');
    expect(await exists(agentFile())).toBe(true);
    const body = await fs.readFile(agentFile(), 'utf-8');
    expect(body.length, 'the copy must carry the agent, not an empty file').toBeGreaterThan(0);
    expect(warnings).toEqual([]);
  });

  it('removes a stale agent when the provider returns to github (the other direction)', async () => {
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(await exists(agentFile())).toBe(true);

    const result = await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    expect(result.converged).toBe(true);
    expect(result.agent).toBe('removed');
    expect(
      await exists(agentFile()),
      'a github user must not be left carrying an agent no directive can spawn',
    ).toBe(false);
  });

  it('is idempotent in both states — a second run reports unchanged', async () => {
    await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    const githubAgain = await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    expect(githubAgain.agent).toBe('unchanged');
    expect(await exists(agentFile())).toBe(false);

    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    const jiraAgain = await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(jiraAgain.agent, 'a re-copy that changes nothing is still a converged state').toBe('installed');
    expect(await exists(agentFile())).toBe(true);
  });

  it('self-heals a corrupted agent file rather than trusting its presence', async () => {
    await fs.mkdir(path.dirname(agentFile()), { recursive: true });
    await fs.writeFile(agentFile(), 'truncated\n', 'utf-8');
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    const body = await fs.readFile(agentFile(), 'utf-8');
    expect(body).not.toBe('truncated\n');
    expect(body.length).toBeGreaterThan(100);
  });

  it('a relative claudeDir is refused, not resolved (precondition)', async () => {
    const result = await convergeTrackerArtifacts({ claudeDir: 'relative/path', provider: 'jira', warn });
    expect(result.converged).toBe(false);
    expect(warnings.join('\n')).toMatch(/absolute/);
  });

  it('reports converged=false when the copy cannot be made (warn-not-throw)', async () => {
    // The agents directory exists as a FILE, so mkdir and copyFile both fail.
    await fs.mkdir(path.join(claudeDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'agents', 'devflow'), 'not a directory\n', 'utf-8');

    const result = await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(result.converged, 'a failed convergence must not report success').toBe(false);
    expect(
      result.agentPresent,
      'nothing was ever copied there, so there is no agent any directive could spawn',
    ).toBe(false);
    expect(warnings.length, 'the failure must be reported, not swallowed').toBeGreaterThan(0);
  });

  // ── agentPresent: what a caller may advertise, as distinct from what this run did ──

  it('agentPresent reports the file, not this run — a successful copy is present', async () => {
    const result = await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(result.agentPresent).toBe(true);
  });

  it('agentPresent is false once the agent is removed for github', async () => {
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    const result = await convergeTrackerArtifacts({ claudeDir, provider: 'github', warn });
    expect(result.agentPresent).toBe(false);
  });

  it('a failed re-copy over a still-present agent reports agentPresent (PRESENCE, not success)', async () => {
    // The distinction the sentinel gate rides on: this run did not converge, but a
    // previous one left a copy that can still be spawned. A caller that reads
    // `converged` alone disables a working provider on a transient I/O failure.
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn });
    expect(await exists(agentFile())).toBe(true);

    const result = await convergeTrackerArtifacts({
      claudeDir,
      provider: 'jira',
      warn,
      agentSourceDirs: [path.join(claudeDir, 'no-such-source-dir')],
    });
    expect(result.converged, 'no source to copy from — this run converged nothing').toBe(false);
    expect(
      result.agentPresent,
      'the previously installed copy is still spawnable, so the provider stays advertisable',
    ).toBe(true);
  });

  it('a relative claudeDir reports agentPresent=false (fail closed — it cannot look)', async () => {
    const result = await convergeTrackerArtifacts({ claudeDir: 'relative/path', provider: 'jira', warn });
    expect(result.converged).toBe(false);
    expect(result.agentPresent).toBe(false);
  });

  it('never throws — callers gate on converged, they do not catch', async () => {
    await expect(
      convergeTrackerArtifacts({ claudeDir: path.join(claudeDir, 'nope'), provider: 'github', warn }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// overlayInstalledReferences — the provider-scoped reference subtree
// ---------------------------------------------------------------------------

describe('overlayInstalledReferences: the provider-scoped subtree', () => {
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

  it.each(['github', 'jira', 'linear'] as const)('installs exactly the %s manifest', async (provider) => {
    const result = await overlayInstalledReferences({ claudeDir, provider, warn });
    expect(result.overlayFailures).toEqual([]);
    const manifest = installedReferenceManifest({ provider });
    expect([...result.overlaidRefs].sort()).toEqual([...manifest].sort());
    expect(await listRefs()).toEqual([...manifest].sort());
  });

  it('every installed file is byte-equal to the generated source', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'jira', warn });
    for (const rel of installedReferenceManifest({ provider: 'jira' })) {
      const installed = await fs.readFile(path.join(refsTarget(), ...rel.split('/')));
      const generated = await fs.readFile(path.join(compiledSkillRefsDir(), ...rel.split('/')));
      expect(installed.equals(generated), `${rel} must be byte-equal`).toBe(true);
    }
  });

  it('a provider swap removes the previous provider and keeps the github floor', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'jira', warn });
    expect((await listRefs()).some(r => r.startsWith('tracker/jira/'))).toBe(true);

    await overlayInstalledReferences({ claudeDir, provider: 'linear', warn });
    const after = await listRefs();
    expect(after.some(r => r.startsWith('tracker/jira/')), 'the old provider must be pruned').toBe(false);
    expect(after.some(r => r.startsWith('tracker/linear/'))).toBe(true);
    expect(
      after.filter(r => r.startsWith('tracker/github/')).length,
      'github is the floor under every provider — PR hosting does not move',
      ).toBe(installedReferenceManifest({ provider: 'github' }).filter(r => r.startsWith('tracker/github/')).length);
  });

  it('narrowing to github prunes _mcp.md and both provider trees', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'linear', warn });
    expect(await listRefs()).toContain('tracker/_mcp.md');

    await overlayInstalledReferences({ claudeDir, provider: 'github', warn });
    const after = await listRefs();
    expect(after).not.toContain('tracker/_mcp.md');
    expect(after.some(r => r.startsWith('tracker/linear/'))).toBe(false);
    expect(after).toEqual([...installedReferenceManifest({ provider: 'github' })].sort());
  });

  it('throws — rather than degrading — when the generated tree is absent (PF-013 seam)', async () => {
    // The injectable root is what makes this arm provable without deleting dist/.
    await expect(
      overlayInstalledReferences({
        claudeDir,
        provider: 'github',
        warn,
        referencesRoot: path.join(claudeDir, 'no-such-generated-tree'),
      }),
    ).rejects.toThrow(/Generated skill references not found/);
    expect(
      await exists(refsTarget()),
      'the refusal must come before the target is touched — nothing installed, nothing abandoned',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `devflow tracker --set` — the step order, and the two abort branches
// ---------------------------------------------------------------------------

describe('runTrackerSet: the convergence order is the invariant', () => {
  /**
   * Recording IO. Every call appends a labelled entry, so assertions read the
   * real call ORDER rather than a per-step boolean.
   */
  function makeRecorder(opts: {
    gitSkill?: boolean;
    overlayThrows?: Error;
    overlayFailures?: OverlayFailure[];
    overlaid?: string[];
    unchanged?: string[];
    pruned?: string[];
    transition?: TrackerTransition;
    artifacts?: ConvergeTrackerArtifactsResult;
    rearm?: TrackerResult<void>;
    sentinel?: TrackerResult<void>;
  } = {}) {
    const calls: string[] = [];
    const io: TrackerSetIO = {
      gitSkillInstalled: async () => {
        calls.push('probe');
        return opts.gitSkill ?? true;
      },
      overlayReferences: async (_claudeDir, provider) => {
        calls.push(`overlay:${provider}`);
        if (opts.overlayThrows) throw opts.overlayThrows;
        return {
          overlaidRefs: opts.overlaid ?? ['tracker/github/setup-task.md'],
          // A run that wrote nothing found everything already converged; it did not find
          // an empty manifest. The recorder keeps the two halves consistent so the
          // `(unchanged)` arm below models the shape the REAL overlay returns — which the
          // real-IO arm at the end of this file proves is reachable.
          unchangedRefs: opts.unchanged ?? (opts.overlaid?.length === 0 ? ['tracker/github/setup-task.md'] : []),
          overlayFailures: opts.overlayFailures ?? [],
          pruned: { scanned: 0, removed: opts.pruned ?? [], failed: [] },
        };
      },
      renameStaleConventions: async (_dir, previous, resolved) => {
        calls.push(`rename:${previous}->${resolved}`);
        return opts.transition ?? { kind: 'none' };
      },
      syncManifest: async (_dir, state) => { calls.push(`manifest:${state.provider}`); },
      convergeArtifacts: async (_claudeDir, provider) => {
        calls.push(`agent:${provider}`);
        return opts.artifacts ?? {
          converged: true,
          agentPresent: provider !== 'github',
          agent: provider === 'github' ? 'removed' : 'installed',
        };
      },
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
      claudeDir: '/tmp/claude-not-touched',
      current: { provider: current },
      requested,
      io,
    });

  it('converges in the fixed order: probe, overlay, rename, manifest, agent, rearm, sentinel', async () => {
    const { calls, io } = makeRecorder();
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(calls).toEqual([
      'probe',
      'overlay:jira',
      'rename:github->jira',
      'manifest:jira',
      'agent:jira',
      'rearm',
      'sentinel:jira',
    ]);
  });

  it('the overlay precedes the manifest write; the agent file follows it', async () => {
    // The asymmetry, asserted as an ordering rather than as prose: the
    // reference subtree is inert until a spawn resolves a provider, and
    // resolving a provider reads the manifest. The agent file advertises one.
    const { calls, io } = makeRecorder();
    await run(io, 'github', 'linear');
    expect(calls.indexOf('overlay:linear')).toBeLessThan(calls.indexOf('manifest:linear'));
    expect(calls.indexOf('agent:linear')).toBeGreaterThan(calls.indexOf('manifest:linear'));
  });

  it('an absent devflow:git aborts before anything is written (design review C3)', async () => {
    const { calls, io } = makeRecorder({ gitSkill: false });
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode).toBe(1);
    expect(outcome.provider, 'the selection in force is unchanged').toBe('github');
    expect(calls, 'nothing beyond the probe may run').toEqual(['probe']);
    const text = outcome.messages.map(m => m.text).join('\n');
    expect(text).toContain('devflow:git is not installed');
    expect(text).toContain('devflow init --tracker jira');
    expect(text, 'no husk, and no half-applied selection').toContain('unchanged');
  });

  it('an overlay failure aborts before the manifest write, and says what DID move (H1)', async () => {
    const failure: OverlayFailure = {
      unit: { kind: 'provider', dir: 'tracker/jira', files: ['tracker/jira/setup-task.md'] },
      state: { kind: 'installed-unchanged' },
      error: new Error('EACCES'),
    } as unknown as OverlayFailure;

    const { calls, io } = makeRecorder({ overlayFailures: [failure] });
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode).toBe(1);
    expect(calls).toEqual(['probe', 'overlay:jira']);
    const text = outcome.messages.map(m => m.text).join('\n');
    expect(text).toContain('Tracker: not changed');
    expect(text).toContain('manifest, sentinel and conventions file are unchanged');
    expect(
      text,
      'the overlay is atomic per unit, so "nothing else changed" would be the false sentence',
    ).toContain('atomic per unit');
  });

  it('an absent generated tree aborts with the same end state, never a throw', async () => {
    const { calls, io } = makeRecorder({
      overlayThrows: new Error('Generated skill references not found: dist/skills/git/references'),
    });
    const outcome = await run(io, 'jira', 'linear');

    expect(outcome.exitCode).toBe(1);
    expect(outcome.provider).toBe('jira');
    expect(calls).toEqual(['probe', 'overlay:linear']);
    expect(outcome.messages.map(m => m.text).join('\n')).toContain('Generated skill references not found');
  });

  it('repeating the current provider still runs the overlay and reports (unchanged)', async () => {
    const { calls, io } = makeRecorder({ overlaid: [], pruned: [], artifacts: { converged: true, agent: 'unchanged' } });
    const outcome = await run(io, 'jira', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(
      calls,
      'an equality check would early-return on a claim about the manifest, not about disk',
    ).toContain('overlay:jira');
    expect(outcome.messages.at(-1)?.text).toBe('Tracker: jira (unchanged)');
  });

  it('reports the asset delta when something moved', async () => {
    const { io } = makeRecorder({
      overlaid: ['a.md', 'b.md'],
      pruned: ['tracker/jira/setup-task.md'],
    });
    const outcome = await run(io, 'jira', 'linear');
    expect(outcome.messages.at(-1)?.text)
      .toBe('Tracker: linear — 2 installed, 1 removed, tracker agent installed');
  });

  // ── C2: both directions of the sentinel ──────────────────────────────────

  it('an unconverged agent suppresses the sentinel WRITE', async () => {
    const { calls, io } = makeRecorder({
      artifacts: { converged: false, agentPresent: false, agent: 'unchanged' },
    });
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode, 'the selection stuck; only the advertising artifact did not').toBe(0);
    expect(calls).not.toContain('sentinel:jira');
    expect(outcome.messages.map(m => m.text).join('\n')).toContain('sentinel removed');
  });

  it('an unconverged agent does NOT suppress the sentinel REMOVAL', async () => {
    const { calls, io } = makeRecorder({ artifacts: { converged: false, agent: 'unchanged' } });
    await run(io, 'jira', 'github');

    expect(
      calls,
      'a stale sentinel costs every future session a fork for a provider the user has left',
    ).toContain('sentinel:github');
  });

  it('an unconverged agent with NO copy on disk REMOVES the sentinel a prior provider left', async () => {
    // The hole the github→jira arm above cannot see: on that transition the
    // sentinel is absent anyway, so "suppress the write" and "leave nothing
    // advertising" coincide. On jira→linear they do not — jira's sentinel is
    // already on disk, and suppressing the write leaves it advertising a
    // provider whose agent is missing, which is the exact state the suppression
    // exists to prevent.
    const { calls, io } = makeRecorder({
      artifacts: { converged: false, agentPresent: false, agent: 'unchanged' },
    });
    const outcome = await run(io, 'jira', 'linear');

    expect(outcome.exitCode, 'the selection stuck; only the advertising artifact did not').toBe(0);
    expect(calls, 'the write must not happen').not.toContain('sentinel:linear');
    expect(
      calls,
      'the previous provider\'s sentinel must be removed, not left advertising a missing agent',
    ).toContain('sentinel:github');
    expect(outcome.messages.map(m => m.text).join('\n')).toContain('sentinel removed');
  });

  it('a failed re-copy over a still-present agent WRITES the sentinel (no false disable)', async () => {
    // converged=false with a copy still on disk is a transient I/O failure over a
    // working install. Removing the sentinel there would disable a provider that
    // can be spawned, so the gate is presence, not "did this run write it".
    const { calls, io } = makeRecorder({
      artifacts: { converged: false, agentPresent: true, agent: 'unchanged' },
    });
    const outcome = await run(io, 'jira', 'linear');

    expect(outcome.exitCode).toBe(0);
    expect(
      calls,
      'an agent that is present can be spawned, so the provider stays advertised',
    ).toContain('sentinel:linear');
  });

  it('a failed rename, rearm or sentinel warns without aborting (applies PF-009)', async () => {
    const { calls, io } = makeRecorder({
      transition: { kind: 'failed', error: 'could not move the previous conventions aside' },
      rearm: { ok: false, error: 'could not reset the attempt counter' },
      sentinel: { ok: false, error: 'could not update the sentinel' },
    });
    const outcome = await run(io, 'github', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(calls).toHaveLength(7);
    const warnings = outcome.messages.filter(m => m.level === 'warn').map(m => m.text);
    expect(warnings).toEqual([
      'could not move the previous conventions aside',
      'could not reset the attempt counter',
      'could not update the sentinel',
    ]);
  });
});

// ---------------------------------------------------------------------------
// `devflow tracker --set` through the REAL adapter — AC-23
// ---------------------------------------------------------------------------

/**
 * The recorder above can assert the ORDER of the convergence and nothing about disk. This
 * describe asserts the one property the order cannot reach: that `(unchanged)` is a state
 * the shipped I/O actually produces.
 *
 * It was not. `overlayGeneratedReferences` pushed every promoted unit's files into
 * `overlaidRefs` on every call, so `moved` was true on every run and the `(unchanged)`
 * branch was dead code that only a stub could enter (AC-23).
 *
 * HOME safety (applies PF-060): both directories are mkdtemp'd here and passed in
 * explicitly. `buildTrackerSetIO()` touches nothing it is not handed.
 */
describe('runTrackerSet through buildTrackerSetIO: (unchanged) is reachable', () => {
  let devflowDir: string;

  const lastLine = (outcome: { messages: { text: string }[] }): string =>
    String(outcome.messages.at(-1)?.text);

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tracker-set-home-'));
    // The probe step refuses without it, and the references have nowhere to land.
    await fs.mkdir(path.join(claudeDir, 'skills', 'devflow:git'), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'skills', 'devflow:git', 'SKILL.md'), '# git\n', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  const set = (current: TrackerProvider, requested: TrackerProvider) =>
    runTrackerSet({ devflowDir, claudeDir, current: { provider: current }, requested, io: buildTrackerSetIO() });

  it('repeating the current provider over a converged tree prints (unchanged)', async () => {
    const first = await set('github', 'github');
    expect(first.exitCode).toBe(0);
    expect(
      lastLine(first),
      'the seeding run must really install the github manifest, or the second run proves nothing',
    ).toBe(`Tracker: github — ${installedReferenceManifest({ provider: 'github' }).length} installed, 0 removed`);

    const second = await set('github', 'github');

    expect(second.exitCode).toBe(0);
    expect(lastLine(second)).toBe('Tracker: github (unchanged)');
  });

  it('known-bad probe: a reference edited on disk is re-installed, not reported unchanged', async () => {
    await set('github', 'github');

    // Drift inside the installed tree — the state "unchanged" must never cover for.
    const drifted = path.join(refsTarget(), 'tracker', 'github', 'setup-task.md');
    await fs.appendFile(drifted, '\n<!-- hand-edited -->\n');

    const outcome = await set('github', 'github');

    expect(lastLine(outcome)).not.toBe('Tracker: github (unchanged)');
    expect(lastLine(outcome)).toContain(' installed, 0 removed');
    expect(
      await fs.readFile(drifted, 'utf-8'),
      'the generated bytes must be restored over the hand edit',
    ).not.toContain('<!-- hand-edited -->');
  });

  it('a provider CHANGE over a converged github tree still reports what moved', async () => {
    await set('github', 'github');

    const outcome = await set('github', 'jira');

    expect(outcome.exitCode).toBe(0);
    expect(
      lastLine(outcome),
      'the github floor is already converged, so only the jira units and the agent may be reported',
    ).toBe(
      `Tracker: jira — ${
        installedReferenceManifest({ provider: 'jira' }).length
          - installedReferenceManifest({ provider: 'github' }).length
      } installed, 0 removed, tracker agent installed`,
    );
  });
});

// ---------------------------------------------------------------------------
// `devflow tracker --status` — the mechanics arm
// ---------------------------------------------------------------------------

describe('readTrackerMechanics / formatTrackerMechanics', () => {
  it('reports MISSING when nothing is installed', async () => {
    const state = await readTrackerMechanics(claudeDir, 'github');
    expect(state).toEqual({ kind: 'missing' });
    expect(formatTrackerMechanics(state)).toBe('MISSING — run devflow init');
  });

  it('counts the installed files for the resolved provider', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'jira', warn });
    const state = await readTrackerMechanics(claudeDir, 'jira');
    expect(state).toEqual({ kind: 'installed', count: installedReferenceManifest({ provider: 'jira' }).length });
    expect(formatTrackerMechanics(state)).toContain('installed (');
  });

  it('counts against the manifest for the provider, so a jira tree reads short under linear', async () => {
    await overlayInstalledReferences({ claudeDir, provider: 'jira', warn });
    const asLinear = await readTrackerMechanics(claudeDir, 'linear');
    expect(asLinear.kind).toBe('installed');
    expect(
      asLinear.kind === 'installed' && asLinear.count,
      'the github floor and _mcp.md are there; the linear tree is not',
    ).toBeLessThan(installedReferenceManifest({ provider: 'linear' }).length);
  });

  it('distinguishes "could not look" from "nothing there"', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    await overlayInstalledReferences({ claudeDir, provider: 'github', warn });
    const blocked = path.join(refsTarget(), 'tracker');
    await fs.chmod(blocked, 0o000);
    try {
      const state = await readTrackerMechanics(claudeDir, 'github');
      expect(state.kind).toBe('unreadable');
      expect(formatTrackerMechanics(state)).toContain('unreadable (');
      expect(formatTrackerMechanics(state)).not.toContain('run devflow init');
    } finally {
      await fs.chmod(blocked, 0o755).catch(() => undefined);
    }
  });
});
