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
 * D-CLI-NO-SYMLINK — a repository can commit `.devflow`, `.claude` or a folder in
 * either as a symbolic link, and enough of `.claude` to be detected as a legacy
 * install. The local-scope removal then deletes and rewrites nothing through a
 * link: whatever the link leads to stays byte-identical, the link stays, and the
 * skip is reported.
 *
 * The CLI arms spawn the built CLI (two spawns, SUBPROCESS_TIMEOUT_MS each) under
 * `sandboxEnv`, which asserts the HOME is a temp dir before anything runs.
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

import * as p from '@clack/prompts';
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
    // detectShell() answers `powershell` whenever PSModulePath is set (it is on
    // GitHub's Ubuntu runners), which would point the safe-delete step at a
    // profile this fixture never seeds and make the prompt assertions vacuous.
    vi.stubEnv('PSModulePath', '');
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
  }, SUBPROCESS_TIMEOUT_MS);

  it('AC-43: in a repository rooted at HOME, `uninstall --scope local` refuses and HOME stays byte-identical', async () => {
    // A dotfiles repo at HOME puts <gitRoot>/.claude and <gitRoot>/.devflow on the
    // machine-wide install: a "local" removal there would be a user uninstall.
    await seedHome(home, { withUserInstall: true });
    execFileSync('git', ['init', '-q'], { cwd: home });
    const before = treeState(home);

    const r = spawnSync(process.execPath, [cli, 'uninstall', '--scope', 'local'], {
      cwd: home, env: sandboxEnv(home, { SHELL: '/bin/zsh' }), encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
    });
    if (r.error) throw r.error;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    expect(r.status, out).toBe(1);
    expect(out).toContain('No legacy project-local install here');
    expect(treeState(home)).toEqual(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it('outside any git repository, `uninstall --scope local` refuses and HOME stays byte-identical', async () => {
    // With no repository there is no repo-local install to act on, and the cleanup
    // phase must never fall back to the cwd.
    await seedHome(home, { withUserInstall: true });
    const nonGit = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-nongit-')));
    try {
      await fs.mkdir(path.join(nonGit, '.claude'));
      await fs.mkdir(path.join(nonGit, '.devflow'));
      await fs.writeFile(path.join(nonGit, '.devflow', 'manifest.json'), '{}');
      const before = treeState(home);
      const cwdBefore = treeState(nonGit);

      const r = spawnSync(process.execPath, [cli, 'uninstall', '--scope', 'local'], {
        cwd: nonGit, env: sandboxEnv(home, { SHELL: '/bin/zsh' }), encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
      });
      if (r.error) throw r.error;
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

      expect(r.status, out).toBe(1);
      expect(out).toContain('No legacy project-local install here');
      expect(treeState(home)).toEqual(before);
      expect(treeState(nonGit)).toEqual(cwdBefore);
    } finally {
      await fs.rm(nonGit, { recursive: true, force: true });
    }
  }, SUBPROCESS_TIMEOUT_MS);

  it('in a repository rooted at HOME, auto-detection finds only the user install, never a "local" one', async () => {
    await seedHome(home, { withUserInstall: true });
    execFileSync('git', ['init', '-q'], { cwd: home });

    const r = spawnSync(process.execPath, [cli, 'uninstall', '--dry-run'], {
      cwd: home, env: sandboxEnv(home, { SHELL: '/bin/zsh' }), encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
    });
    if (r.error) throw r.error;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    expect(r.status, out).toBe(0);
    expect(out).toContain('Scope(s): user ');
    expect(out).not.toMatch(/Scope\(s\): [^\n]*local/);
  }, SUBPROCESS_TIMEOUT_MS);

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
  }, SUBPROCESS_TIMEOUT_MS);

  it('D-CLI-NO-SYMLINK: a plain `uninstall` in a repository that commits a linked .devflow deletes nothing where the link leads', async () => {
    // The repository commits just enough of .claude to be detected as a legacy
    // install, and its .devflow as a link to a folder outside it.
    await seedHome(home, { withUserInstall: false });
    const linked = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-linked-')));
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-outside-')));
    try {
      execFileSync('git', ['init', '-q'], { cwd: linked });
      await fs.mkdir(path.join(linked, '.claude', 'commands', 'devflow'), { recursive: true });
      await fs.writeFile(path.join(linked, '.claude', 'commands', 'devflow', 'implement.md'), '# implement\n');
      await fs.mkdir(path.join(outside, 'scripts'));
      await fs.writeFile(path.join(outside, 'scripts', 'x'), 'not devflow\'s\n');
      await fs.writeFile(path.join(outside, 'manifest.json'), '{"not":"devflow\'s"}\n');
      await fs.mkdir(path.join(outside, 'logs'));
      await fs.writeFile(path.join(outside, 'logs', 'y'), 'not devflow\'s either\n');
      await fs.symlink(outside, path.join(linked, '.devflow'));
      execFileSync('git', ['add', '-A'], { cwd: linked });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed'], { cwd: linked });
      const before = treeState(outside);

      const r = spawnSync(process.execPath, [cli, 'uninstall'], {
        cwd: linked, env: sandboxEnv(home, { SHELL: '/bin/zsh' }), encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
      });
      if (r.error) throw r.error;
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

      expect(r.status, out).toBe(0);
      expect(out, 'the legacy install was detected and acted on').toContain('legacy local scope');
      expect(await exists(path.join(linked, '.claude', 'commands', 'devflow')), 'the unlinked part is still removed').toBe(false);
      expect(treeState(outside), 'nothing is deleted where the link leads').toEqual(before);
      expect(lstatSync(path.join(linked, '.devflow')).isSymbolicLink(), 'the link is left as it was').toBe(true);
      expect(out).toContain(`${path.join(linked, '.devflow')} is a symbolic link, and devflow removes or changes nothing through one`);
    } finally {
      await fs.rm(linked, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  }, SUBPROCESS_TIMEOUT_MS);
});


describe('a symbolic link in a legacy local install is never deleted or written through (D-CLI-NO-SYMLINK, in-process)', () => {
  let repo: string;
  let outside: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-link-repo-')));
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-legacy-link-outside-')));
    await seedLegacyRepo(repo);
    confirmMessages.length = 0;
    warn = vi.spyOn(p.log, 'warn');
  });

  afterEach(async () => {
    warn.mockRestore();
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  /**
   * Turn `<repo>/<rel>` into a link to `outside`: whatever the repo held there moves
   * to `outside` first, so the link leads to devflow-named content a removal would
   * reach, plus `extra` files and a sentinel.
   */
  async function linkToOutside(rel: string, extra: Readonly<Record<string, string>> = {}): Promise<string> {
    const at = path.join(repo, rel);
    if (await exists(at)) {
      await fs.cp(at, outside, { recursive: true });
      await fs.rm(at, { recursive: true, force: true });
    }
    for (const [file, body] of Object.entries({ ...extra, 'sentinel.txt': 'outside the project\n' })) {
      await fs.mkdir(path.dirname(path.join(outside, file)), { recursive: true });
      await fs.writeFile(path.join(outside, file), body);
    }
    await fs.mkdir(path.dirname(at), { recursive: true });
    await fs.symlink(outside, at);
    return at;
  }

  function fullPhase(): Promise<void> {
    return runFullPhaseForScope({
      scope: 'local',
      claudeDir: path.join(repo, '.claude'),
      devflowDir: path.join(repo, '.devflow'),
      devflowScriptsDir: path.join(repo, '.devflow', 'scripts'),
      verbose: false,
      keepDocs: false,
      isTTY: true,
    });
  }

  function warned(): string[] {
    return warn.mock.calls.map(call => String(call[0]));
  }

  it.each([
    { rel: '.claude', extra: {} },
    { rel: path.join('.claude', 'commands'), extra: {} },
    { rel: path.join('.claude', 'agents'), extra: {} },
    { rel: path.join('.claude', 'skills'), extra: {} },
    { rel: path.join('.claude', 'rules'), extra: { 'devflow/old.md': '# a rule\n' } },
    { rel: '.devflow', extra: {} },
    { rel: path.join('.devflow', 'scripts'), extra: {} },
    { rel: path.join('.devflow', 'logs'), extra: { y: 'a log\n' } },
  ])('a linked $rel: the full local phase leaves its target byte-identical, keeps the link and names it once', async ({ rel, extra }) => {
    const link = await linkToOutside(rel, extra);
    const before = treeState(outside);

    await fullPhase();

    expect(treeState(outside), 'nothing is deleted or rewritten where the link leads').toEqual(before);
    expect(lstatSync(link).isSymbolicLink(), 'the link is left as it was').toBe(true);
    const named = warned().filter(line => line.includes(`${link} is a symbolic link`));
    expect(named, 'the skip is reported once, naming the link').toHaveLength(1);
  });

  it('the unlinked rest of the install is still removed around a linked folder', async () => {
    await linkToOutside(path.join('.claude', 'commands'));

    await fullPhase();

    expect(await exists(path.join(repo, '.claude', 'agents', 'devflow'))).toBe(false);
    expect(await exists(path.join(repo, '.claude', 'skills', 'devflow:testing'))).toBe(false);
    expect(await exists(path.join(repo, '.devflow', 'scripts'))).toBe(false);
    expect(await exists(path.join(repo, '.devflow', 'manifest.json'))).toBe(false);
  });

  it('a selective local uninstall deletes nothing through a linked .claude/commands', async () => {
    const link = await linkToOutside(path.join('.claude', 'commands'));
    const before = treeState(outside);
    const implement = DEVFLOW_PLUGINS.filter(plugin => plugin.name === 'devflow-implement');
    expect(implement).toHaveLength(1);

    await runSelectivePhaseForScope({
      claudeDir: path.join(repo, '.claude'),
      devflowDir: path.join(repo, '.devflow'),
      selectedPlugins: implement,
      verbose: false,
      scope: 'local',
    });

    expect(treeState(outside)).toEqual(before);
    expect(warned().filter(line => line.includes(`${link} is a symbolic link`))).toHaveLength(1);
  });

  it('a selective local uninstall rewrites no manifest.json through a linked .devflow (D-UNINSTALL-DROPS-PLUGIN)', async () => {
    const link = await linkToOutside('.devflow');
    const before = treeState(outside);
    const implement = DEVFLOW_PLUGINS.filter(plugin => plugin.name === 'devflow-implement');
    expect(implement).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(path.join(outside, 'manifest.json'), 'utf-8')).plugins, 'non-vacuity: the manifest lists the plugin').toContain('devflow-implement');

    await runSelectivePhaseForScope({
      claudeDir: path.join(repo, '.claude'),
      devflowDir: path.join(repo, '.devflow'),
      selectedPlugins: implement,
      verbose: false,
      scope: 'local',
    });

    expect(treeState(outside), 'the manifest the link leads to is not rewritten').toEqual(before);
    expect(lstatSync(link).isSymbolicLink(), 'the link is left as it was').toBe(true);
    expect(warned().filter(line => line.includes(`${link} is a symbolic link`)), 'the skip is reported once').toHaveLength(1);
  });

  it('a selective local uninstall over an unlinked .devflow drops the plugin from the repo manifest', async () => {
    const implement = DEVFLOW_PLUGINS.filter(plugin => plugin.name === 'devflow-implement');

    await runSelectivePhaseForScope({
      claudeDir: path.join(repo, '.claude'),
      devflowDir: path.join(repo, '.devflow'),
      selectedPlugins: implement,
      verbose: false,
      scope: 'local',
    });

    const manifest = JSON.parse(await fs.readFile(path.join(repo, '.devflow', 'manifest.json'), 'utf-8')) as { plugins: string[] };
    expect(manifest.plugins).toEqual([]);
  });

  it.each([
    { rel: '.claude' },
    { rel: path.join('.claude', 'settings.json') },
  ])('the local cleanup phase rewrites no settings.json through a linked $rel', async ({ rel }) => {
    let link: string;
    if (rel === '.claude') {
      link = await linkToOutside(rel);
    } else {
      link = path.join(repo, rel);
      await fs.rename(link, path.join(outside, 'settings.json'));
      await fs.symlink(path.join(outside, 'settings.json'), link);
    }
    const before = treeState(outside);

    await runCleanupPhase({ scopesToUninstall: ['local'], keepDocs: true, verbose: false, cwd: repo, isTTY: false });

    expect(treeState(outside), 'the settings.json the link leads to keeps its devflow hooks').toEqual(before);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(warned().filter(line => line.includes(`${link} is a symbolic link`))).toHaveLength(1);
  });
});
