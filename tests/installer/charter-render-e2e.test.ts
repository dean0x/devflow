/**
 * Sandbox end-to-end for the install-time orchestrator charter render and the implement sentinel
 * (src/targets/claude-code/charter-render.ts, D-CHARTER-INSTALL-RENDER).
 *
 * tests/installer/charter-render.test.ts holds the pure render and the writer. This file drives the BUILT
 * CLI (`init`, `init --hud-only`, `uninstall --plugin`) in a D-SNAPSHOT-SANDBOX home and reads back what a
 * user's machine holds: the charter under ~/.devflow/scripts/hooks/assets, the sentinel beside it, and
 * what the INSTALLED preamble hook emits for a plan-handoff prompt.
 *
 * Expected charters come from `renderCharter(source, ...charterInventory(<manifest plugins>))`, never from
 * hand-written charter text. A few short, hand-written probes sit beside the exact comparison so a wrong
 * span table cannot agree with its own render: the workflow names in the list, the plan-handoff bullet,
 * the Fix clause and the debug sentence.
 *
 * HOME safety: every sandbox home is an mkdtemp under os.tmpdir(), checked on creation and again by
 * `sandboxEnv` on every spawn. Nothing here reads or writes the real ~/.claude or ~/.devflow. The tests
 * of one group share one sandbox and run in order, because each builds on the install before it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync, realpathSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ROOT, requireBuiltCli } from '../helpers.js';
import {
  CHARTER_RELPATH,
  HANDOFF_SENTINEL_RELPATH,
  charterInventory,
  renderCharter,
} from '../../src/targets/claude-code/charter-render.js';
import { HANDOFF_TEMPLATE, REMINDER_TEMPLATE } from '../fixtures/ambient-templates.js';
import {
  SUBPROCESS_TIMEOUT_MS,
  createSandbox,
  removeSandbox,
  runCliOk,
  sandboxChildEnv,
  type Sandbox,
} from '../install-snapshot-helpers.js';

requireBuiltCli();

const PACKAGED_SCRIPTS = path.join(ROOT, 'src', 'assets', 'scripts');
const SOURCE = readFileSync(path.join(PACKAGED_SCRIPTS, CHARTER_RELPATH), 'utf-8');
const SENTINEL_SOURCE = readFileSync(path.join(PACKAGED_SCRIPTS, HANDOFF_SENTINEL_RELPATH), 'utf-8');

/** One init or uninstall spawn runs up to SUBPROCESS_TIMEOUT_MS; a group runs a handful of them. */
const GROUP_TIMEOUT_MS = 5 * SUBPROCESS_TIMEOUT_MS;

const FULL_INIT = ['init', '--recommended', '--security', 'user'] as const;
const FOUNDER_INIT = ['init', '--plugin=code-review,implement,plan,release,resolve', '--security', 'user'] as const;
/** The only workflow-less selection the CLI takes: core-skills alone, with the ambient plugin switched off. */
const NO_WORKFLOW_INIT = ['init', '--plugin=core-skills', '--no-ambient', '--security', 'user'] as const;
const BUG_ANALYSIS_INIT = ['init', '--plugin=bug-analysis', '--no-ambient', '--security', 'user'] as const;

/** The debug fallback the render drops while devflow:debug is installed (decision A6). It occurs once in the source. */
const DEBUG_FALLBACK = ', else Explore investigates and Code fixes';
/**
 * What the debug sentence says once the debug command is absent. The span `devflow:debug, else ` overlaps the
 * fallback on `, else `, so the render removes the shared words once and keeps this text.
 */
const DEBUG_FALLBACK_TEXT = 'Explore investigates and Code fixes';
const WORKFLOW_BULLET = '- Real-scale work matching a workflow:';
const BUG_FIX_BULLET = '- Bug fix:';
const HANDOFF_BULLET = '- Plan handoff:';
const HANDOFF_PROMPT = 'Implement the following plan:\n\n# Add caching\n\n1. Add Redis\n2. Write tests';

// ── Sandboxes ───────────────────────────────────────────────────────────────

const created: Sandbox[] = [];

/** A sandbox whose HOME is proven to be a temp dir that is not the real home. */
function makeSandbox(): Sandbox {
  const sb = createSandbox();
  created.push(sb);
  const home = realpathSync(sb.home);
  if (!home.startsWith(realpathSync(os.tmpdir())) || home === realpathSync(os.homedir())) {
    throw new Error(`sandbox HOME is not a temp dir: ${home}`);
  }
  return sb;
}

afterAll(() => {
  for (const sb of created) removeSandbox(sb);
});

// ── Reading the install back ────────────────────────────────────────────────

interface FileState {
  readonly bytes: Buffer;
  readonly mtimeMs: number;
}

interface CharterState {
  readonly charter: FileState | null;
  readonly sentinel: FileState | null;
}

function readFileState(file: string): FileState | null {
  try {
    return { bytes: readFileSync(file), mtimeMs: statSync(file).mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const scriptsDirOf = (sb: Sandbox): string => path.join(sb.home, '.devflow', 'scripts');

function installedState(sb: Sandbox): CharterState {
  return {
    charter: readFileState(path.join(scriptsDirOf(sb), CHARTER_RELPATH)),
    sentinel: readFileState(path.join(scriptsDirOf(sb), HANDOFF_SENTINEL_RELPATH)),
  };
}

/** The installed charter as text; a missing charter fails the test that asks. */
function charterOf(state: CharterState): string {
  expect(state.charter, 'the charter is installed').not.toBeNull();
  return state.charter!.bytes.toString('utf-8');
}

function manifestPlugins(sb: Sandbox): string[] {
  const manifest: unknown = JSON.parse(readFileSync(path.join(sb.home, '.devflow', 'manifest.json'), 'utf-8'));
  const plugins = (manifest as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins) || !plugins.every((name): name is string => typeof name === 'string')) {
    throw new Error('the manifest does not list its plugins');
  }
  return plugins;
}

/** The charter the source renders for `plugins`: the oracle every installed charter is held to. */
function renderFor(plugins: readonly string[]): string {
  const inventory = charterInventory(plugins);
  const rendered = renderCharter(SOURCE, inventory.commands, inventory.agents);
  if (!rendered.ok) throw new Error(`the packaged charter does not render: ${rendered.reason} (${rendered.span})`);
  return rendered.content;
}

const lineStartingWith = (text: string, prefix: string): string | undefined =>
  text.split('\n').find(line => line.startsWith(prefix));

/** The `devflow:<name>` tokens of the workflow bullet, in order; null when the bullet is not there. */
function workflowNames(text: string): string[] | null {
  const line = lineStartingWith(text, WORKFLOW_BULLET);
  return line === undefined ? null : (line.match(/devflow:[a-z-]+/g) ?? []);
}

/** Every line of `text` except those that start with `prefix`. */
const linesWithout = (text: string, prefix: string): string[] => text.split('\n').filter(line => !line.startsWith(prefix));

/** What the INSTALLED preamble hook emits as additional context for `prompt`; '' when it emits nothing. */
function preambleContext(sb: Sandbox, prompt: string): string {
  const hook = path.join(scriptsDirOf(sb), 'hooks', 'preamble');
  const result = spawnSync('bash', [hook], {
    cwd: sb.repo,
    env: sandboxChildEnv(sb),
    input: JSON.stringify({ cwd: sb.repo, prompt }),
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  expect(result.status, `preamble stderr: ${result.stderr}`).toBe(0);
  if (result.stdout === '') return '';
  return (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;
}

// Non-vacuity: the source this file renders has the shape the probes below look for.
describe('the packaged charter the e2e renders', () => {
  it('has one workflow bullet, one bug-fix bullet, one handoff bullet and one debug fallback', () => {
    expect(workflowNames(SOURCE)).toEqual([
      'devflow:implement', 'devflow:plan', 'devflow:research', 'devflow:explore',
      'devflow:code-review', 'devflow:resolve', 'devflow:bug-analysis',
    ]);
    expect(SOURCE.split(DEBUG_FALLBACK).length - 1).toBe(1);
    expect(SOURCE.split('\n').filter(line => line.startsWith(BUG_FIX_BULLET))).toHaveLength(1);
    expect(SOURCE.split('\n').filter(line => line.startsWith(HANDOFF_BULLET))).toHaveLength(1);
    expect(SENTINEL_SOURCE.length).toBeGreaterThan(0);
  });
});

// ── 1 and 7: the full recommended set, a second init, then uninstall --plugin=implement ──

describe('a full recommended install', () => {
  let sb: Sandbox;
  let plugins: string[];
  let first: CharterState;

  beforeAll(() => {
    sb = makeSandbox();
    runCliOk(sb, FULL_INIT);
    plugins = manifestPlugins(sb);
    first = installedState(sb);
  }, GROUP_TIMEOUT_MS);

  it('installs the charter the source renders for the manifest plugins', () => {
    for (const name of ['devflow-implement', 'devflow-plan', 'devflow-resolve', 'devflow-debug', 'devflow-bug-analysis']) {
      expect(plugins, `${name} is in the recommended set`).toContain(name);
    }
    expect(charterOf(first)).toBe(renderFor(plugins));
  });

  it('keeps the source whole except for the debug fallback, because devflow:debug is installed', () => {
    expect(charterOf(first)).toBe(SOURCE.replace(DEBUG_FALLBACK, ''));
  });

  it('names every workflow and the plan handoff', () => {
    const charter = charterOf(first);
    expect(workflowNames(charter)).toEqual(workflowNames(SOURCE));
    expect(lineStartingWith(charter, HANDOFF_BULLET)).toBeDefined();
  });

  it('installs the sentinel with the packaged content', () => {
    expect(first.sentinel, 'the implement sentinel is installed').not.toBeNull();
    expect(first.sentinel!.bytes.toString('utf-8')).toBe(SENTINEL_SOURCE);
  });

  it('gives a plan-handoff prompt the handoff directive from the installed preamble', () => {
    expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(HANDOFF_TEMPLATE);
  });

  it('leaves the charter and the sentinel unchanged, bytes and mtime, when init runs again', () => {
    runCliOk(sb, FULL_INIT);
    const second = installedState(sb);
    expect(second.charter!.bytes.equals(first.charter!.bytes)).toBe(true);
    expect(second.sentinel!.bytes.equals(first.sentinel!.bytes)).toBe(true);
    expect(second.charter!.mtimeMs).toBe(first.charter!.mtimeMs);
    expect(second.sentinel!.mtimeMs).toBe(first.sentinel!.mtimeMs);
  }, GROUP_TIMEOUT_MS);

  describe('then uninstall --plugin=implement', () => {
    let after: CharterState;
    let remaining: string[];

    beforeAll(() => {
      runCliOk(sb, ['uninstall', '--plugin=implement']);
      after = installedState(sb);
      remaining = plugins.filter(name => name !== 'devflow-implement');
    }, GROUP_TIMEOUT_MS);

    it('drops implement from the manifest', () => {
      expect(manifestPlugins(sb)).not.toContain('devflow-implement');
    });

    it('renders the charter for the plugins that stay', () => {
      expect(charterOf(after)).toBe(renderFor(remaining));
    });

    it('removes the plan-handoff line and the implement workflow, and removes the sentinel', () => {
      const charter = charterOf(after);
      expect(lineStartingWith(charter, HANDOFF_BULLET)).toBeUndefined();
      expect(workflowNames(charter)).not.toContain('devflow:implement');
      expect(workflowNames(charter)).toContain('devflow:resolve');
      expect(after.sentinel).toBeNull();
    });

    it('keeps the Fix clause, because resolve and dynamic still declare the Fix agent', () => {
      expect(remaining).toContain('devflow-resolve');
      expect(charterOf(after)).toMatch(/\bFix \(/);
    });

    it('gives a plan-handoff prompt the generic reminder from the installed preamble', () => {
      expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(REMINDER_TEMPLATE);
    });
  });
});

// ── 2, 5 and 8: the founder set, --hud-only, then init --plugin=debug ──

describe('the founder set', () => {
  let sb: Sandbox;
  let plugins: string[];
  let installed: CharterState;

  beforeAll(() => {
    sb = makeSandbox();
    runCliOk(sb, FOUNDER_INIT);
    plugins = manifestPlugins(sb);
    installed = installedState(sb);
  }, GROUP_TIMEOUT_MS);

  it('installs the charter the source renders for the manifest plugins', () => {
    for (const name of ['devflow-code-review', 'devflow-implement', 'devflow-plan', 'devflow-release', 'devflow-resolve']) {
      expect(plugins, `${name} was selected`).toContain(name);
    }
    for (const name of ['devflow-debug', 'devflow-bug-analysis', 'devflow-research', 'devflow-explore']) {
      expect(plugins, `${name} was not selected`).not.toContain(name);
    }
    expect(charterOf(installed)).toBe(renderFor(plugins));
  });

  it('lists only the installed workflows, and keeps the debug fallback and the Fix clause', () => {
    const charter = charterOf(installed);
    expect(workflowNames(charter)).toEqual([
      'devflow:implement', 'devflow:plan', 'devflow:code-review', 'devflow:resolve',
    ]);
    expect(lineStartingWith(charter, BUG_FIX_BULLET)).toContain(DEBUG_FALLBACK_TEXT);
    expect(charter).not.toContain('devflow:debug');
    expect(charter).not.toContain('never the Debug agent');
    expect(charter).toMatch(/\bFix \(/);
  });

  it('writes the plan-handoff line and the sentinel, because implement is installed', () => {
    expect(lineStartingWith(charterOf(installed), HANDOFF_BULLET)).toBeDefined();
    expect(installed.sentinel!.bytes.toString('utf-8')).toBe(SENTINEL_SOURCE);
  });

  it('gives a plan-handoff prompt the handoff directive from the installed preamble', () => {
    expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(HANDOFF_TEMPLATE);
  });

  it('keeps the render byte for byte when init --hud-only runs', () => {
    runCliOk(sb, ['init', '--hud-only']);
    const afterHud = installedState(sb);
    expect(afterHud.charter!.bytes.equals(installed.charter!.bytes)).toBe(true);
    expect(afterHud.sentinel!.bytes.equals(installed.sentinel!.bytes)).toBe(true);
    expect(manifestPlugins(sb)).toEqual(plugins);
  }, GROUP_TIMEOUT_MS);

  it('adds only the debug sentence when init --plugin=debug follows', () => {
    runCliOk(sb, ['init', '--plugin=debug', '--security', 'user']);
    const withDebug = installedState(sb);
    const nowPlugins = manifestPlugins(sb);
    expect(nowPlugins).toContain('devflow-debug');
    expect(nowPlugins).toEqual(expect.arrayContaining(plugins));

    const before = charterOf(installed);
    const charter = charterOf(withDebug);
    expect(charter).toBe(renderFor(nowPlugins));

    // The sentence names devflow:debug and drops the fallback; the Debug agent clause follows bug-analysis.
    const bugFix = lineStartingWith(charter, BUG_FIX_BULLET);
    expect(bugFix).toContain('devflow:debug');
    expect(bugFix).not.toContain(DEBUG_FALLBACK_TEXT);
    expect(bugFix?.includes('never the Debug agent')).toBe(nowPlugins.includes('devflow-bug-analysis'));
    expect(lineStartingWith(before, BUG_FIX_BULLET)).not.toContain('devflow:debug');
    expect(lineStartingWith(before, BUG_FIX_BULLET)).toContain(DEBUG_FALLBACK_TEXT);

    // Every other line stays, the plan handoff and the sentinel with them.
    expect(linesWithout(charter, BUG_FIX_BULLET)).toEqual(linesWithout(before, BUG_FIX_BULLET));
    expect(withDebug.sentinel!.bytes.equals(installed.sentinel!.bytes)).toBe(true);
    expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(HANDOFF_TEMPLATE);
  }, GROUP_TIMEOUT_MS);
});

// ── 3: no workflow plugin ──

describe('an install with no workflow plugin', () => {
  let sb: Sandbox;
  let plugins: string[];
  let installed: CharterState;

  beforeAll(() => {
    sb = makeSandbox();
    runCliOk(sb, NO_WORKFLOW_INIT);
    plugins = manifestPlugins(sb);
    installed = installedState(sb);
  }, GROUP_TIMEOUT_MS);

  it('installs the charter the source renders for the manifest plugins', () => {
    expect(plugins).toEqual(['devflow-core-skills']);
    expect(charterOf(installed)).toBe(renderFor(plugins));
  });

  it('names no workflow, no Fix agent, no Debug agent and no plan handoff', () => {
    const charter = charterOf(installed);
    expect(workflowNames(charter)).toBeNull();
    expect(charter).not.toContain('devflow:');
    expect(charter).not.toMatch(/\bFix \(/);
    expect(charter).not.toContain('never the Debug agent');
    expect(lineStartingWith(charter, HANDOFF_BULLET)).toBeUndefined();
  });

  it('writes no sentinel, so a plan-handoff prompt gets the generic reminder', () => {
    expect(installed.sentinel).toBeNull();
    expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(REMINDER_TEMPLATE);
  });
});

// ── 4: bug-analysis only ──

describe('an install of bug-analysis alone', () => {
  let sb: Sandbox;
  let plugins: string[];
  let installed: CharterState;

  beforeAll(() => {
    sb = makeSandbox();
    runCliOk(sb, BUG_ANALYSIS_INIT);
    plugins = manifestPlugins(sb);
    installed = installedState(sb);
  }, GROUP_TIMEOUT_MS);

  it('installs the charter the source renders for the manifest plugins', () => {
    expect(plugins).toEqual(['devflow-core-skills', 'devflow-bug-analysis']);
    expect(charterOf(installed)).toBe(renderFor(plugins));
  });

  it('lists only bug-analysis, and keeps the Debug agent clause and the debug fallback', () => {
    const charter = charterOf(installed);
    expect(workflowNames(charter)).toEqual(['devflow:bug-analysis']);
    // The Debug agent ships with bug-analysis; the debug command does not, so the fallback stays.
    const bugFix = lineStartingWith(charter, BUG_FIX_BULLET);
    expect(bugFix).toContain('never the Debug agent');
    expect(bugFix).toContain(DEBUG_FALLBACK_TEXT);
    expect(bugFix).not.toContain('devflow:debug');
    expect(charter).not.toMatch(/\bFix \(/);
  });

  it('writes no plan handoff and no sentinel', () => {
    expect(lineStartingWith(charterOf(installed), HANDOFF_BULLET)).toBeUndefined();
    expect(installed.sentinel).toBeNull();
    expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(REMINDER_TEMPLATE);
  });
});

// ── 6: --hud-only with no manifest ──

describe('init --hud-only on a machine with no manifest', () => {
  let sb: Sandbox;
  let installed: CharterState;

  beforeAll(() => {
    sb = makeSandbox();
    runCliOk(sb, ['init', '--hud-only']);
    installed = installedState(sb);
  }, GROUP_TIMEOUT_MS);

  it('renders the charter for the empty set', () => {
    const charter = charterOf(installed);
    expect(charter).toBe(renderFor([]));
    expect(charter).not.toContain('devflow:');
    expect(workflowNames(charter)).toBeNull();
    expect(lineStartingWith(charter, HANDOFF_BULLET)).toBeUndefined();
  });

  it('writes no sentinel', () => {
    expect(installed.sentinel).toBeNull();
    expect(preambleContext(sb, HANDOFF_PROMPT)).toBe(REMINDER_TEMPLATE);
  });
});
