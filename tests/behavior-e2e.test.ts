/**
 * End-to-end: the behavior rule is an OPT-IN machine switch (D-BEHAVIOR-OPT-IN).
 * `features.behavior` in ~/.devflow/manifest.json is off by default; the rule file
 * ~/.claude/rules/devflow/behavior.md exists only while the install includes rules AND
 * the switch is on.
 *
 * These drive the REAL compiled CLI under a temp HOME. Every spawn gets its env from
 * `sandboxEnv(tmpHome)`, which asserts HOME is not a real home before a run can start.
 * Requires a build (`npm run build`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();
const SOURCE = path.join(import.meta.dirname, '..', 'src', 'assets', 'rules', 'behavior.md');

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 60_000;
/** Tests that chain several runs get a budget of several spawns. */
const CHAIN_TIMEOUT_MS = 5 * SPAWN_TIMEOUT_MS;

let tmpHome: string;
let cwd: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const rulesDir = (): string => path.join(tmpHome, '.claude', 'rules', 'devflow');
const ruleFile = (): string => path.join(rulesDir(), 'behavior.md');

function run(...args: string[]): { status: number | null; out: string } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(tmpHome),
    // stdin closed: the run never prompts.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function runOk(...args: string[]): string {
  const { status, out } = run(...args);
  expect(status, `devflow ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function features(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(devflowDir(), 'manifest.json'), 'utf-8');
  return (JSON.parse(raw) as { features: Record<string, unknown> }).features;
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-behavior-e2e-'));
  cwd = path.join(tmpHome, 'work');
  await fs.mkdir(cwd, { recursive: true });
  // init refuses a machine where Claude Code is not detected.
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('init: the switch defaults off', () => {
  it('a fresh install records behavior false, installs the other rules and not this one', async () => {
    runOk('init', '--recommended');
    expect((await features()).behavior).toBe(false);
    expect(await exists(path.join(rulesDir(), 'security.md'))).toBe(true);
    expect(await exists(ruleFile())).toBe(false);
  }, CHAIN_TIMEOUT_MS);
});

describe('init --behavior / --no-behavior', () => {
  it('--behavior installs the one-bullet rule, and a plain re-init keeps it', async () => {
    runOk('init', '--recommended', '--behavior');
    expect((await features()).behavior).toBe(true);
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));

    runOk('init', '--recommended');
    expect((await features()).behavior).toBe(true);
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
  }, CHAIN_TIMEOUT_MS);

  it('--no-behavior turns a recorded true off and removes the file', async () => {
    runOk('init', '--recommended', '--behavior');
    runOk('init', '--recommended', '--no-behavior');
    expect((await features()).behavior).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
    expect(await exists(path.join(rulesDir(), 'security.md'))).toBe(true);
  }, CHAIN_TIMEOUT_MS);

  it('--reset returns the switch to its default off', async () => {
    runOk('init', '--recommended', '--behavior');
    runOk('init', '--recommended', '--reset');
    expect((await features()).behavior).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  }, CHAIN_TIMEOUT_MS);

  it('with --no-rules the switch is recorded but no file installs', async () => {
    runOk('init', '--recommended', '--no-rules', '--behavior');
    expect((await features()).behavior).toBe(true);
    expect((await features()).rules).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  }, CHAIN_TIMEOUT_MS);

  it('a malformed recorded value heals to off, and init still reads the manifest', async () => {
    runOk('init', '--recommended', '--behavior');
    const manifestPath = path.join(devflowDir(), 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as { features: Record<string, unknown> };
    manifest.features.behavior = 'yes';
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

    runOk('init', '--recommended');
    expect((await features()).behavior).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
    // The manifest was not treated as missing: the prior plugin selection and the other switches survive.
    expect((await features()).knowledge).toBe(true);
  }, CHAIN_TIMEOUT_MS);

  it('a re-init leaves no stale plain-english.md in the rules directory', async () => {
    runOk('init', '--recommended', '--behavior');
    await fs.writeFile(path.join(rulesDir(), 'plain-english.md'), 'stale', 'utf-8');
    runOk('init', '--recommended');
    expect(await exists(path.join(rulesDir(), 'plain-english.md'))).toBe(false);
    expect(await exists(ruleFile())).toBe(true);
  }, CHAIN_TIMEOUT_MS);
});

describe('devflow behavior', () => {
  it('--status, --enable, --disable converge the file and report it', async () => {
    runOk('init', '--recommended');
    expect(runOk('behavior', '--status')).toMatch(/disabled/i);
    expect(await exists(ruleFile())).toBe(false);

    expect(runOk('behavior', '--enable')).toMatch(/enabled/i);
    expect((await features()).behavior).toBe(true);
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
    const on = runOk('behavior', '--status');
    expect(on).toMatch(/enabled/i);
    expect(on).toMatch(/installed/i);

    expect(runOk('behavior', '--disable')).toMatch(/disabled/i);
    expect((await features()).behavior).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  }, CHAIN_TIMEOUT_MS);

  it('--enable on a machine without devflow exits 1 and writes nothing', async () => {
    const { status, out } = run('behavior', '--enable');
    expect(status).toBe(1);
    expect(out).toMatch(/devflow init/);
    expect(await exists(path.join(devflowDir(), 'manifest.json'))).toBe(false);
  });
});

describe('rules --disable / --enable with the switch on', () => {
  it('removes the file with the rules directory and brings it back with the rules', async () => {
    runOk('init', '--recommended', '--behavior');
    runOk('rules', '--disable');
    expect(await exists(ruleFile())).toBe(false);
    expect((await features()).behavior).toBe(true);

    runOk('rules', '--enable');
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
  }, CHAIN_TIMEOUT_MS);
});

describe('uninstall', () => {
  it('a selective uninstall of another plugin keeps the rule', async () => {
    runOk('init', '--recommended', '--behavior');
    const { status, out } = run('uninstall', '--plugin=devflow-plan');
    expect(status, out).toBe(0);
    expect(await exists(ruleFile())).toBe(true);
  }, CHAIN_TIMEOUT_MS);

  it('a full uninstall removes the rule with the other devflow rules', async () => {
    runOk('init', '--recommended', '--behavior');
    expect(await exists(ruleFile())).toBe(true);
    const { status, out } = run('uninstall', '--scope=user');
    expect([0, 1], out).toContain(status);
    expect(await exists(ruleFile())).toBe(false);
    expect(await exists(rulesDir())).toBe(false);
  }, CHAIN_TIMEOUT_MS);
});
