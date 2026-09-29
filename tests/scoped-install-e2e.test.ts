/**
 * End-to-end proof of what an install carries, whatever the machine's tracker.
 *
 * D-INSTALL-ALL-PROVIDERS: every install carries every provider's mechanics, the
 * tool-call contract and the Tracker agent, because a repository selects its own
 * tracker in its committed `.devflow/project.json` and a machine therefore meets
 * more than one provider. So a github install and a jira install leave the SAME
 * tree under ~/.claude; only the machine provider — the manifest and its sentinel
 * under ~/.devflow — differs (TP-38, AC-33).
 *
 * Drives the REAL `node dist/cli.js` — init, tracker --set, uninstall --plugin —
 * against isolated temp HOMEs, because the unit tests all call
 * `installViaFileCopy` with hand-built maps and therefore cannot see a wiring
 * mistake between the CLI and the installer. Every claim this file makes about
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
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { requireBuiltCli } from './helpers.js';
import { assertTempHome } from './setup/home-isolation.js';
import { installedReferenceManifest } from '../src/core/mds-variants.js';
import { DEVFLOW_PLUGINS, prefixSkillName, skillsOf, getAllSkillNames } from '../src/core/plugins.js';

const CLI_PATH = requireBuiltCli();
/** One CLI spawn, well past 5 s under load. A test's budget is this times its spawns. */
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
const sentinel = (): string => path.join(devflowDir(), '.tracker.enabled');

/**
 * Paths under ~/.claude every install must carry, whatever its tracker, beyond the
 * generated reference manifest (which is asserted in full on its own). The one
 * list a new always-installed artifact is added to.
 */
const EVERY_INSTALL_CARRIES: readonly string[] = [
  'agents/devflow/tracker.md',
  'skills/devflow:git/references/tracker/_mcp.md',
];

async function listSkills(): Promise<string[]> {
  try { return (await fs.readdir(path.join(claudeDir(), 'skills'))).sort(); } catch { return []; }
}

/** Every file under `root`, as sorted relative paths. */
async function listFiles(root: string): Promise<string[]> {
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
  await walk(root, '');
  return out.sort();
}

/**
 * The ~/.claude tree as `path sha256`, one per file — the whole install as the
 * user's Claude Code sees it, so two installs compare by content, not by name.
 * The HOME each install ran under is written into the files that name hook
 * commands by absolute path, so it is normalised out first: two HOMEs are the
 * fixture, not a difference between the installs.
 */
async function claudeTree(): Promise<string[]> {
  const homes = [...new Set([tmpHome, await fs.realpath(tmpHome)])];
  const lines: string[] = [];
  for (const rel of await listFiles(claudeDir())) {
    let text = (await fs.readFile(path.join(claudeDir(), ...rel.split('/')))).toString('latin1');
    for (const home of homes) text = text.split(home).join('<HOME>');
    lines.push(`${rel} ${createHash('sha256').update(text, 'latin1').digest('hex')}`);
  }
  return lines;
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** A scratch HOME that already looks like a Claude Code install. */
async function makeScratchHome(prefix: string): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  // init refuses a HOME with no ~/.claude — that detection is Claude Code's
  // presence check, not something this suite is testing.
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(home, '.devflow'), { recursive: true });
  return home;
}

/** Run `body` against a second, independent HOME, then restore the first. */
async function inOtherHome<T>(prefix: string, body: () => Promise<T>): Promise<T> {
  const firstHome = tmpHome;
  tmpHome = await makeScratchHome(prefix);
  expect(() => assertTempHome(tmpHome)).not.toThrow();
  try {
    return await body();
  } finally {
    await fs.rm(tmpHome, { recursive: true, force: true });
    tmpHome = firstHome;
  }
}

beforeEach(async () => {
  tmpHome = await makeScratchHome('devflow-scoped-e2e-');
  // Prove the binding before anything runs: an install against the real HOME is
  // the one failure this file must make impossible.
  // `os.homedir()` is the setup file's temp HOME, so the real home comes from assertTempHome.
  expect(() => assertTempHome(tmpHome)).not.toThrow();
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// init — one tree, whatever the provider (TP-38)
// ---------------------------------------------------------------------------

describe('devflow init installs every provider (D-INSTALL-ALL-PROVIDERS)', () => {
  it('github, jira and linear installs leave byte-identical trees carrying every provider', async () => {
    const result = init();
    expect(result.status, `init failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    const githubTree = await claudeTree();
    expect(await exists(sentinel()), 'github is the sentinel-free machine').toBe(false);

    // The whole generated manifest — every provider tree, the PR-host tree, the
    // cross-cutting documents and the tool-call contract.
    const refs = await listFiles(refsRoot());
    for (const rel of installedReferenceManifest()) {
      expect(refs, `${rel} is generated and must be installed under github`).toContain(rel);
    }
    const installed = githubTree.map(line => line.slice(0, line.lastIndexOf(' ')));
    for (const rel of EVERY_INSTALL_CARRIES) {
      expect(installed, `${rel} must be installed under github`).toContain(rel);
    }

    for (const provider of ['jira', 'linear'] as const) {
      await inOtherHome(`devflow-scoped-e2e-${provider}-`, async () => {
        const other = init(['--tracker', provider]);
        expect(other.status, `init --tracker ${provider} failed:\n${other.stdout}\n${other.stderr}`).toBe(0);
        expect(
          await claudeTree(),
          `a ${provider} install must leave exactly the github install's tree — the provider is ` +
          'the machine default, not a property of what is installed',
        ).toEqual(githubTree);
        await expect(fs.readFile(sentinel(), 'utf-8')).resolves.toBe(`${provider}\n`);
      });
    }
  }, SUBPROCESS_TIMEOUT_MS * 3);

  it('a fresh install announces the agent it installed, whatever the provider', () => {
    const result = init();
    expect(result.status).toBe(0);
    expect(
      result.stdout,
      'the agent is installed by this run, so the summary has to say so',
    ).toContain('tracker agent installed');
  }, SUBPROCESS_TIMEOUT_MS);

  it('the default install carries the non-optional closure, not every registry skill', async () => {
    expect(init().status).toBe(0);
    const expected = [...skillsOf(DEVFLOW_PLUGINS.filter(p => !p.optional))].map(prefixSkillName).sort();
    expect(await listSkills()).toEqual(expected);
    expect(expected.length, 'scoping must actually narrow something').toBeLessThan(getAllSkillNames().length);
  }, SUBPROCESS_TIMEOUT_MS);

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
    // Derived from the registry, not typed: the install-set size moves whenever a
    // module joins, and a literal here would report that as an e2e regression in a
    // file whose subject is the STEADY-STATE re-init, not the count.
    const refs = installedReferenceManifest().length;
    expect(first.stdout).toContain(`Installed ${refs} generated skill reference(s)`);
    expect(first.stdout).toContain(`+${refs} reference(s)`);

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
  }, SUBPROCESS_TIMEOUT_MS * 2);

  it('the summary names the active provider', () => {
    const result = init(['--tracker', 'linear']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Tracker: linear');
  }, SUBPROCESS_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// tracker --set — the machine default, and nothing under ~/.claude
// ---------------------------------------------------------------------------

describe('devflow tracker --set moves the machine default and no installed file (AC-33)', () => {
  it('github → linear → github changes no file under ~/.claude, and converges the sentinel', async () => {
    expect(init().status).toBe(0);
    const fresh = await claudeTree();

    const toLinear = run(['tracker', '--set', 'linear']);
    expect(toLinear.status, `--set linear failed:\n${toLinear.stdout}\n${toLinear.stderr}`).toBe(0);
    expect(await claudeTree(), '--set installs nothing — every provider is already there').toEqual(fresh);
    await expect(fs.readFile(sentinel(), 'utf-8')).resolves.toBe('linear\n');

    const back = run(['tracker', '--set', 'github']);
    expect(back.status, `--set github failed:\n${back.stdout}\n${back.stderr}`).toBe(0);
    expect(await claudeTree(), 'tracker --set github deletes no reference and no agent').toEqual(fresh);
    expect(await exists(sentinel())).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS * 3);

  it('--status reports every installed reference', () => {
    expect(init(['--tracker', 'jira']).status).toBe(0);
    const status = run(['tracker', '--status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('Mechanics:');
    expect(status.stdout).toContain(`installed (${installedReferenceManifest().length} file(s))`);
    expect(status.stdout).not.toContain('MISSING');
  }, SUBPROCESS_TIMEOUT_MS * 2);
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
  }, SUBPROCESS_TIMEOUT_MS * 2);

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
  }, SUBPROCESS_TIMEOUT_MS * 2);
});
