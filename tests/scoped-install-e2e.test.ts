/**
 * End-to-end proof of the selection-scoped install bundle.
 *
 * Drives the REAL `node dist/cli.js` — init, tracker --set, uninstall --plugin —
 * against isolated temp HOMEs, because the unit tests all call
 * `installViaFileCopy` with hand-built maps and therefore cannot see a wiring
 * mistake between the CLI and the installer. Every claim this wave makes about
 * what a user ends up with is a claim about this path.
 *
 * HOME safety (applies PF-060): every invocation binds `HOME` to an mkdtemp
 * directory INSIDE the spawn env, and the working directory is os.tmpdir() so
 * no git root is discovered. A prior agent wiped a developer's real ~/.claude by
 * running init without this; nothing here may reach it.
 *
 * Lives in tests/ rather than tests/integration/ deliberately: the default
 * vitest config excludes `tests/integration/**`, and a proof nobody runs is not
 * a proof. It needs only the built CLI — no tarball, no network, no live model.
 *
 * Requires a build: these tests spawn dist/cli.js as a subprocess.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { requireBuiltCli } from './helpers.js';
import { installedReferenceManifest } from '../src/core/mds-variants.js';
import { DEVFLOW_PLUGINS, prefixSkillName, skillsOf, getAllSkillNames } from '../src/core/plugins.js';

const CLI_PATH = requireBuiltCli();
const SUBPROCESS_TIMEOUT_MS = 120_000;

let tmpHome: string;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: os.tmpdir(), // non-git dir → no project discovery
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    env: {
      ...process.env,
      HOME: tmpHome,
      DEVFLOW_HOOK_DEBUG: undefined,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** `devflow init --recommended`, with every background feature off. */
function init(extraArgs: string[] = []) {
  return run([
    'init', '--recommended',
    '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules',
    ...extraArgs,
  ]);
}

const claudeDir = (): string => path.join(tmpHome, '.claude');
const devflowDir = (): string => path.join(tmpHome, '.devflow');
const refsRoot = (): string => path.join(claudeDir(), 'skills', 'devflow:git', 'references');

async function listSkills(): Promise<string[]> {
  try { return (await fs.readdir(path.join(claudeDir(), 'skills'))).sort(); } catch { return []; }
}

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
  await walk(refsRoot(), '');
  return out.sort();
}

/**
 * The installed tracker subtree — the part of references/ the overlay OWNS.
 *
 * references/ also holds the git skill's own hand-authored documents, which the
 * overlay converges nothing about: outside the tracker/ subtree it may replace
 * but never delete. So the exact-set claim belongs to this subtree, and the flat
 * documents are covered by containment instead.
 */
async function listTrackerRefs(): Promise<string[]> {
  return (await listRefs()).filter(r => r.startsWith('tracker/'));
}

/** The manifest entries under tracker/, sorted. */
function trackerManifest(provider: string): string[] {
  return [...installedReferenceManifest({ provider })].filter(r => r.startsWith('tracker/')).sort();
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

const trackerAgent = (): string => path.join(claudeDir(), 'agents', 'devflow', 'tracker.md');
const sentinel = (): string => path.join(devflowDir(), '.tracker.enabled');

/** A scratch HOME that already looks like a Claude Code install. */
async function makeScratchHome(prefix: string): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  // init refuses a HOME with no ~/.claude — that detection is Claude Code's
  // presence check, not something this suite is testing.
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(home, '.devflow'), { recursive: true });
  return home;
}

beforeEach(async () => {
  tmpHome = await makeScratchHome('devflow-scoped-e2e-');
  // Prove the binding before anything runs: an install against the real HOME is
  // the one failure this file must make impossible.
  expect(tmpHome.startsWith(os.tmpdir())).toBe(true);
  expect(tmpHome).not.toBe(os.homedir());
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// init, per provider
// ---------------------------------------------------------------------------

describe('devflow init installs {github} ∪ {selected provider}', () => {
  it('the default install carries the github tree, no _mcp.md and no Tracker agent', async () => {
    const result = init();
    expect(result.status, `init failed:\n${result.stdout}\n${result.stderr}`).toBe(0);

    const installedGithub = await listRefs();
    for (const rel of installedReferenceManifest({ provider: 'github' })) {
      expect(installedGithub, rel + ' is generated for github and must be installed').toContain(rel);
    }
    expect(await listTrackerRefs()).toEqual(trackerManifest('github'));
    expect(await exists(path.join(refsRoot(), 'tracker', '_mcp.md'))).toBe(false);
    expect(await exists(trackerAgent()), 'github infers no conventions, so it needs no agent').toBe(false);
    expect(await exists(sentinel()), 'the sentinel is what costs a session a fork').toBe(false);
    expect(
      result.stdout,
      'nothing put an agent there, so nothing may report having taken one away',
    ).not.toContain('tracker agent');
  });

  it('a second github init still says nothing about the agent', () => {
    expect(init().status).toBe(0);
    const second = init();
    expect(second.status, `re-init failed:\n${second.stdout}\n${second.stderr}`).toBe(0);
    expect(
      second.stdout,
      'a steady-state github re-run has no agent to install and none to remove',
    ).not.toContain('tracker agent');
  });

  it.each(['jira', 'linear'] as const)('--tracker %s adds its tree, _mcp.md, the agent and the sentinel', async (provider) => {
    const result = init(['--tracker', provider]);
    expect(result.status, `init --tracker ${provider} failed:\n${result.stdout}\n${result.stderr}`).toBe(0);

    const installedProvider = await listRefs();
    for (const rel of installedReferenceManifest({ provider })) {
      expect(installedProvider, rel + ' must be installed').toContain(rel);
    }
    expect(await listTrackerRefs()).toEqual(trackerManifest(provider));
    expect(await exists(path.join(refsRoot(), 'tracker', '_mcp.md'))).toBe(true);
    expect(await exists(trackerAgent())).toBe(true);
    expect(await exists(sentinel())).toBe(true);
    expect(
      result.stdout,
      'the agent is installed by this run, so the summary has to say so',
    ).toContain('tracker agent installed');
  });

  it('the jira install differs from the github one by exactly the jira tree, _mcp.md and the agent', async () => {
    const github = init();
    expect(github.status).toBe(0);
    const githubRefs = await listTrackerRefs();

    // A second HOME, so the two installs are independent rather than sequential.
    const firstHome = tmpHome;
    tmpHome = await makeScratchHome('devflow-scoped-e2e-jira-');
    try {
      expect(init(['--tracker', 'jira']).status).toBe(0);
      const jiraRefs = await listTrackerRefs();

      const added = jiraRefs.filter(r => !githubRefs.includes(r));
      const removed = githubRefs.filter(r => !jiraRefs.includes(r));
      expect(removed, 'github is the floor under every provider').toEqual([]);
      expect(added.filter(r => !r.startsWith('tracker/jira/'))).toEqual(['tracker/_mcp.md']);
      expect(added.filter(r => r.startsWith('tracker/jira/')).length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpHome, { recursive: true, force: true });
      tmpHome = firstHome;
    }
  });

  it('the default install carries the non-optional closure, not every registry skill', async () => {
    expect(init().status).toBe(0);
    const expected = [...skillsOf(DEVFLOW_PLUGINS.filter(p => !p.optional))].map(prefixSkillName).sort();
    expect(await listSkills()).toEqual(expected);
    expect(expected.length, 'scoping must actually narrow something').toBeLessThan(getAllSkillNames().length);
  });

  /**
   * A re-init that changes nothing must SAY nothing.
   *
   * The unit arms prove the installer reports zero written references; this one proves
   * the wiring all the way out to what the user reads. Both summary lines are
   * movement-gated — `formatOverlaySummary` renders its line only when something was
   * written, and `formatTrackerAssetSummary` renders the delta only when something
   * moved — so a steady-state re-init is legible precisely by their ABSENCE (QA S2).
   */
  it('a second identical init writes nothing and reports no movement', () => {
    const first = init(['--tracker', 'jira']);
    expect(first.status, `init failed:\n${first.stdout}\n${first.stderr}`).toBe(0);
    expect(first.stdout).toContain('Installed 24 generated skill reference(s)');
    expect(first.stdout).toContain('+24 reference(s)');

    const second = init(['--tracker', 'jira']);
    expect(second.status, `re-init failed:\n${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.stdout, 'the provider is still named').toContain('Tracker: jira');
    expect(
      second.stdout,
      'nothing was written, so the install line must not claim a reference was',
    ).not.toContain('generated skill reference(s)');
    expect(
      second.stdout,
      'nothing moved, so the delta line is noise and is suppressed entirely',
    ).not.toContain('Tracker assets:');
    expect(
      second.stdout,
      'the agent was already converged by the first run and is unchanged by this one',
    ).not.toContain('tracker agent');
  });

  it('the summary names the active provider', () => {
    const result = init(['--tracker', 'linear']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Tracker: linear');
  });
});

// ---------------------------------------------------------------------------
// tracker --set, both directions
// ---------------------------------------------------------------------------

describe('devflow tracker --set converges the bundle both ways', () => {
  it('github → linear → github returns to exactly the fresh github install', async () => {
    expect(init().status).toBe(0);
    const fresh = await listTrackerRefs();

    const toLinear = run(['tracker', '--set', 'linear']);
    expect(toLinear.status, `--set linear failed:\n${toLinear.stdout}\n${toLinear.stderr}`).toBe(0);
    expect(await listTrackerRefs()).toEqual(trackerManifest('linear'));
    expect(await exists(trackerAgent())).toBe(true);
    expect(await exists(sentinel())).toBe(true);

    const back = run(['tracker', '--set', 'github']);
    expect(back.status, `--set github failed:\n${back.stdout}\n${back.stderr}`).toBe(0);
    expect(
      await listTrackerRefs(),
      'a round trip must leave no residue of the provider the user left',
    ).toEqual(fresh);
    expect(await exists(trackerAgent())).toBe(false);
    expect(await exists(sentinel())).toBe(false);
  });

  it('jira → linear swaps the provider tree and keeps the github floor', async () => {
    expect(init(['--tracker', 'jira']).status).toBe(0);

    const swap = run(['tracker', '--set', 'linear']);
    expect(swap.status, `--set linear failed:\n${swap.stdout}\n${swap.stderr}`).toBe(0);

    const refs = await listTrackerRefs();
    expect(refs.some(r => r.startsWith('tracker/jira/'))).toBe(false);
    expect(refs.some(r => r.startsWith('tracker/linear/'))).toBe(true);
    expect(refs.some(r => r.startsWith('tracker/github/'))).toBe(true);
    expect(refs).toEqual(trackerManifest('linear'));
  });

  it('--status reports the installed mechanics', () => {
    expect(init(['--tracker', 'jira']).status).toBe(0);
    const status = run(['tracker', '--status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('Mechanics:');
    expect(status.stdout).toContain('installed (');
    expect(status.stdout).not.toContain('MISSING');
  });
});

// ---------------------------------------------------------------------------
// --plugin: adds without subtracting; uninstall retains from the manifest
// ---------------------------------------------------------------------------

describe('partial install and selective uninstall', () => {
  it('--plugin adds a plugin\'s closure and removes nothing', async () => {
    expect(init().status).toBe(0);
    const before = await listSkills();
    expect(before.length).toBeGreaterThan(0);

    const partial = run([
      'init', '--recommended', '--plugin=devflow-typescript',
      '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules',
    ]);
    expect(partial.status, `--plugin install failed:\n${partial.stdout}\n${partial.stderr}`).toBe(0);

    const after = await listSkills();
    for (const skill of before) {
      expect(after, `${skill} must survive an add-one run`).toContain(skill);
    }
    expect(after).toContain(prefixSkillName('typescript'));
  });

  it('uninstall --plugin removes only what no remaining INSTALLED plugin needs', async () => {
    expect(init(['--plugin=devflow-core-skills,devflow-explore']).status).toBe(0);
    const before = await listSkills();
    expect(before).toContain(prefixSkillName('feature-knowledge'));

    const removed = run(['uninstall', '--plugin=devflow-explore']);
    expect(removed.status, `uninstall failed:\n${removed.stdout}\n${removed.stderr}`).toBe(0);

    const after = await listSkills();
    expect(
      after,
      'git is core-skills\' own, and core-skills is still installed',
    ).toContain(prefixSkillName('git'));
    expect(after.length).toBeLessThan(before.length);
  });
});
