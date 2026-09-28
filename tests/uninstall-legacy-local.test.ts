/**
 * Legacy repo-local uninstall (#389, D-LEGACY-LOCAL-CLEANUP).
 *
 * `init --scope local` is retired (D-SCOPE-RETIRED), but repos it installed into
 * still carry `<repo>/.claude` and `<repo>/.devflow` install artifacts, so
 * `uninstall` keeps detecting and removing them. What it must never do on that
 * path is reach the user's machine-wide state:
 *
 *   TP-14 (AC-11) — a seeded legacy install is detected by a plain `uninstall` and
 *                   cleaned (its commands, agents, skills, scripts, manifest and
 *                   settings hooks), leaving project data in place.
 *   TP-48 (AC-43) — `uninstall --scope local` leaves the HOME tree, the user's
 *                   settings.json included, byte-identical — even when HOME holds a
 *                   full machine-wide install, a deny list, a safe-delete block and
 *                   the legacy commands rule, and even when every prompt is answered
 *                   "yes" (the in-process arm below).
 *
 * The CLI arms spawn the built CLI (two spawns, SUBPROCESS_TIMEOUT_MS each) under
 * `sandboxEnv`, which asserts the HOME is a temp dir before anything runs (PF-060).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, readdirSync, readFileSync, lstatSync } from 'fs';
import { spawnSync, execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Every confirm is answered "yes" (the most destructive answer) except the
// security deny-list one, which could reach the system managed-settings file.
// Messages are recorded so the test can prove which prompts were never reached.
const confirmMessages: string[] = [];
vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();
  return {
    ...actual,
    confirm: vi.fn(async (opts: { message: string }) => {
      confirmMessages.push(opts.message);
      return !/deny list/i.test(opts.message);
    }),
  };
});

import { requireBuiltCli, sandboxEnv } from './helpers.js';
import { runCleanupPhase, runFullPhaseForScope, runSelectivePhaseForScope } from '../src/cli/commands/uninstall.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { DEVFLOW_HISTORICAL_DENY } from '../src/targets/claude-code/post-install.js';

const SUBPROCESS_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Every file under `root` with its bytes and mode, sorted — the byte-identity oracle. */
function treeState(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        out.push(`${r}/ ${st.mode.toString(8)}`);
        walk(abs, r);
      } else {
        out.push(`${r} ${st.mode.toString(8)} ${readFileSync(abs).toString('base64')}`);
      }
    }
  };
  walk(root, '');
  return out;
}

function hookEntry(command: string): { hooks: Array<{ type: string; command: string; timeout: number }> } {
  return { hooks: [{ type: 'command', command, timeout: 10 }] };
}

const SAFE_DELETE_BLOCK = '# >>> Devflow safe-delete >>>\nrm() { command rm "$@"; }\n# <<< Devflow safe-delete <<<\n';

/**
 * A HOME holding a complete machine-wide install and every piece of user state a
 * machine-wide step could touch: settings.json with devflow hooks and a devflow
 * deny entry, the legacy commands rule, a safe-delete block in both shell
 * profiles, and a ~/.devflow with a manifest and scripts.
 */
async function seedHome(home: string, opts: { withUserInstall: boolean }): Promise<void> {
  const claude = path.join(home, '.claude');
  const devflow = path.join(home, '.devflow');
  await fs.mkdir(path.join(claude, 'rules', 'devflow'), { recursive: true });
  await fs.writeFile(path.join(claude, 'rules', 'devflow', 'commands.md'), '# legacy commands rule\n');
  const deny = [...DEVFLOW_HISTORICAL_DENY][0];
  await fs.writeFile(path.join(claude, 'settings.json'), JSON.stringify({
    permissions: { deny: [deny] },
    hooks: {
      Stop: [hookEntry(`${devflow}/scripts/hooks/run-hook capture-turn`)],
      UserPromptSubmit: [hookEntry(`${devflow}/scripts/hooks/run-hook preamble`)],
    },
    model: 'opus',
  }, null, 2) + '\n');
  await fs.writeFile(path.join(home, '.zshrc'), `export A=1\n${SAFE_DELETE_BLOCK}`);
  await fs.writeFile(path.join(home, '.bashrc'), `export B=1\n${SAFE_DELETE_BLOCK}`);
  if (opts.withUserInstall) {
    await fs.mkdir(path.join(claude, 'commands', 'devflow'), { recursive: true });
    await fs.writeFile(path.join(claude, 'commands', 'devflow', 'implement.md'), '# implement\n');
    await fs.mkdir(path.join(claude, 'agents', 'devflow'), { recursive: true });
    await fs.writeFile(path.join(claude, 'agents', 'devflow', 'code.md'), '# code\n');
    await fs.mkdir(path.join(devflow, 'scripts', 'hooks'), { recursive: true });
    await fs.writeFile(path.join(devflow, 'scripts', 'hooks', 'run-hook'), '#!/bin/bash\n');
    await fs.writeFile(path.join(devflow, 'manifest.json'), JSON.stringify({
      version: '2.5.0', plugins: ['devflow-implement'], scope: 'user',
      features: { ambient: true, memory: true }, installedAt: 'x', updatedAt: 'x',
    }));
  }
}

/** A git repo carrying a retired repo-local install plus project data. */
async function seedLegacyRepo(repo: string): Promise<void> {
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const claude = path.join(repo, '.claude');
  const devflow = path.join(repo, '.devflow');
  await fs.mkdir(path.join(claude, 'commands', 'devflow'), { recursive: true });
  await fs.writeFile(path.join(claude, 'commands', 'devflow', 'implement.md'), '# implement\n');
  await fs.mkdir(path.join(claude, 'agents', 'devflow'), { recursive: true });
  await fs.writeFile(path.join(claude, 'agents', 'devflow', 'code.md'), '# code\n');
  await fs.mkdir(path.join(claude, 'skills', 'devflow:testing'), { recursive: true });
  await fs.writeFile(path.join(claude, 'skills', 'devflow:testing', 'SKILL.md'), '# testing\n');
  await fs.writeFile(path.join(claude, 'settings.json'), JSON.stringify({
    hooks: {
      Stop: [hookEntry(`${devflow}/scripts/hooks/run-hook capture-turn`)],
      SessionStart: [hookEntry(`${devflow}/scripts/hooks/run-hook session-start-memory`)],
      UserPromptSubmit: [hookEntry(`${devflow}/scripts/hooks/run-hook preamble`)],
    },
    model: 'sonnet',
  }, null, 2) + '\n');
  await fs.mkdir(path.join(devflow, 'scripts', 'hooks'), { recursive: true });
  await fs.writeFile(path.join(devflow, 'scripts', 'hooks', 'run-hook'), '#!/bin/bash\n');
  await fs.writeFile(path.join(devflow, 'manifest.json'), JSON.stringify({
    version: '2.0.0', plugins: ['devflow-implement'], scope: 'local',
    features: { ambient: true, memory: true }, installedAt: 'x', updatedAt: 'x',
  }));
  await fs.mkdir(path.join(devflow, 'memory'), { recursive: true });
  await fs.writeFile(path.join(devflow, 'memory', 'WORKING-MEMORY.md'), '## Now\nproject data\n');
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/** The legacy repo's install artifacts are gone; its settings keep only foreign keys; project data stays. */
async function expectLegacyInstallCleaned(repo: string): Promise<void> {
  const claude = path.join(repo, '.claude');
  const devflow = path.join(repo, '.devflow');
  expect(await exists(path.join(claude, 'commands', 'devflow'))).toBe(false);
  expect(await exists(path.join(claude, 'agents', 'devflow'))).toBe(false);
  expect(await exists(path.join(claude, 'skills', 'devflow:testing'))).toBe(false);
  expect(await exists(path.join(devflow, 'scripts'))).toBe(false);
  expect(await exists(path.join(devflow, 'manifest.json'))).toBe(false);
  const settings = JSON.parse(await fs.readFile(path.join(claude, 'settings.json'), 'utf-8')) as Record<string, unknown>;
  expect(JSON.stringify(settings)).not.toContain('run-hook');
  expect(settings.model, 'a foreign key proves the file was parsed and rewritten, not deleted').toBe('sonnet');
}

// ---------------------------------------------------------------------------
// In-process: the phases with every prompt answered "yes"
// ---------------------------------------------------------------------------

describe('legacy local uninstall phases never touch HOME (AC-43, in-process)', () => {
  let home: string;
  let repo: string;

  beforeEach(async () => {
    // The setup file's per-file temp HOME — the one every module-level path in
    // src (COMMANDS_RULE_PATH included) was resolved against at import.
    home = process.env.HOME!;
    expect(home.startsWith(os.tmpdir()) || home.startsWith(await fs.realpath(os.tmpdir()))).toBe(true);
    await seedHome(home, { withUserInstall: true });
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-repo-')));
    await seedLegacyRepo(repo);
    confirmMessages.length = 0;
    vi.stubEnv('SHELL', '/bin/zsh');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(repo, { recursive: true, force: true });
    for (const entry of await fs.readdir(home)) {
      await fs.rm(path.join(home, entry), { recursive: true, force: true });
    }
  });

  it('full + cleanup phases on the local scope, interactive and answered yes, leave HOME byte-identical', async () => {
    const before = treeState(home);

    await runFullPhaseForScope({
      scope: 'local',
      claudeDir: path.join(repo, '.claude'),
      devflowDir: path.join(repo, '.devflow'),
      devflowScriptsDir: path.join(repo, '.devflow', 'scripts'),
      verbose: false,
      keepDocs: false,
      isTTY: true,
    });
    await runCleanupPhase({ scopesToUninstall: ['local'], keepDocs: false, verbose: false, cwd: repo, isTTY: true });

    expect(treeState(home)).toEqual(before);
    // The machine-wide prompts were never reached (the gate, not the answer, spared HOME)...
    expect(confirmMessages.filter(m => /deny list|safe-delete/i.test(m))).toEqual([]);
    // ...while the repo-local prompts were, and the repo install is gone.
    expect(confirmMessages.some(m => m.includes('.devflow/'))).toBe(true);
    await expectLegacyInstallCleaned(repo);
  });

  it('the same cleanup phase over the user scope does reach the machine-wide prompts (non-vacuity)', async () => {
    await runCleanupPhase({ scopesToUninstall: ['user'], keepDocs: false, verbose: false, cwd: repo, isTTY: true });
    expect(confirmMessages.some(m => /deny list/i.test(m))).toBe(true);
    expect(confirmMessages.some(m => /safe-delete/i.test(m))).toBe(true);
  });

  it('a selective local uninstall of the ambient plugin never purges the legacy rule under HOME', async () => {
    const before = treeState(home);
    const ambient = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-ambient');
    expect(ambient).toHaveLength(1);

    await runSelectivePhaseForScope({
      claudeDir: path.join(repo, '.claude'),
      devflowDir: path.join(repo, '.devflow'),
      selectedPlugins: ambient,
      verbose: false,
      scope: 'local',
    });

    expect(treeState(home)).toEqual(before);
    const settings = await fs.readFile(path.join(repo, '.claude', 'settings.json'), 'utf-8');
    expect(settings, 'the ambient hook was stripped from the repo settings').not.toContain('run-hook preamble');
  });
});

// ---------------------------------------------------------------------------
// CLI: the built command, end to end
// ---------------------------------------------------------------------------

describe('legacy local uninstall through the CLI (TP-14, TP-48)', () => {
  let cli: string;
  let home: string;
  let repo: string;

  beforeAll(() => {
    cli = requireBuiltCli();
  });

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-home-'));
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-cli-repo-')));
    await seedLegacyRepo(repo);
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  function runUninstall(args: string[]): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, [cli, 'uninstall', ...args], {
      cwd: repo,
      env: sandboxEnv(home, { SHELL: '/bin/zsh' }),
      encoding: 'utf-8',
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
    if (r.error) throw r.error;
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  it('TP-48: `uninstall --scope local` leaves HOME — a full user install, settings.json included — byte-identical', async () => {
    await seedHome(home, { withUserInstall: true });
    const before = treeState(home);

    const run = runUninstall(['--scope', 'local']);
    expect(run.status, run.out).toBe(0);

    expect(treeState(home)).toEqual(before);
    await expectLegacyInstallCleaned(repo);
  });

  it('TP-14: a plain `uninstall` detects the legacy repo-local install and cleans it, keeping project data', async () => {
    // HOME holds user state but no user-scope install, so detection can only find the repo's.
    await seedHome(home, { withUserInstall: false });
    const before = treeState(home);

    const run = runUninstall([]);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('legacy local scope');

    await expectLegacyInstallCleaned(repo);
    expect(await fs.readFile(path.join(repo, '.devflow', 'memory', 'WORKING-MEMORY.md'), 'utf-8')).toContain('project data');
    expect(treeState(home)).toEqual(before);
  });
});
