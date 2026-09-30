/**
 * Behavioral tests for Section 4 of the session-start-context hook — the one-line
 * notice for a retired project-local install (D-LEGACY-LOCAL-NOTICE, #406 item 18).
 *
 * `devflow init --scope local` is gone, but a repository it installed into still
 * registers devflow hooks in `<root>/.claude/settings.json`, so they run twice.
 * The hook recognises such an install by devflow's exact hook-ownership shape
 * (D-EXACT-HOOK-OWNER — a command ENDING in `/scripts/hooks/run-hook <marker>`, or
 * a v1 `.sh` hook) and points at `devflow uninstall --scope local`, once per fresh
 * session, never for the machine-wide directory itself.
 *
 * Every run gets its own temp HOME (PF-060) and a neutral CLAUDE_CONFIG_DIR, so
 * the developer's own install never decides an outcome.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HOOK_RUN_ALLOWANCE_MS, HOOKS_DIR, runHook } from './shell-hooks-helpers.js';

const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');
const REMEDY = '`devflow uninstall --scope local`';

/** A command as a project-local install registered it. */
const runHookCommand = (root: string, marker: string): string =>
  path.join(root, '.devflow', 'scripts', 'hooks', 'run-hook') + ' ' + marker;

function settingsWith(commands: readonly string[]): string {
  return JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: commands.map(command => ({ type: 'command', command, timeout: 10 })) }],
    },
  }, null, 2);
}

describe('session-start-context: legacy project-local install notice (Section 4)', () => {
  let tmp: string;
  let home: string;
  let repo: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-legacy-notice-'));
    home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    repo = path.join(tmp, 'repo');
    const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf-8' });
    expect(init.status, `git init failed: ${init.stderr}`).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeLegacySettings(root: string, body: string): void {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), body);
  }

  function run(cwd: string, source = 'startup', extraEnv: Record<string, string> = {}) {
    return runHook(CONTEXT_HOOK, { cwd, session_id: 'test-session', source }, home, { CLAUDE_CONFIG_DIR: '', ...extraEnv });
  }

  /** The injected context, or '' when the hook printed nothing. */
  function contextOf(stdout: string): string {
    return stdout.trim() === '' ? '' : JSON.parse(stdout).hookSpecificOutput.additionalContext;
  }

  /** The notice lines in a context — the collector every assertion reads. */
  function noticeLines(context: string): string[] {
    return context.split('\n').filter(line => line.includes(REMEDY));
  }

  it.each([
    ['session-start-context', 'session-start-context'],
    ['capture-turn', 'capture-turn'],
    ['a retired marker (stop-update-memory)', 'stop-update-memory'],
  ])('a settings.json registering run-hook %s ⇒ exactly one notice line', (_label, marker) => {
    writeLegacySettings(repo, settingsWith(['echo hello', runHookCommand(repo, marker)]));
    const { stdout, exitCode } = run(repo);
    expect(exitCode).toBe(0);
    const lines = noticeLines(contextOf(stdout));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Devflow notice: this repository still holds a retired project-local devflow install/);
  }, HOOK_RUN_ALLOWANCE_MS);

  it('a v1 direct .sh hook is recognised too', () => {
    writeLegacySettings(repo, settingsWith([path.join(repo, '.claude', 'scripts', 'hooks', 'session-start-memory.sh')]));
    expect(noticeLines(contextOf(run(repo).stdout))).toHaveLength(1);
  }, HOOK_RUN_ALLOWANCE_MS);

  it.each([
    ['a user hook that merely names a marker', '/opt/tools/run-hook preamble'],
    ['a marker word inside another command', 'echo capture-turn'],
    ['run-hook with a marker devflow never registered', '/home/me/scripts/hooks/run-hook my-own-hook'],
    ['a devflow marker that is not at the end of the command', '<ROOT>/.devflow/scripts/hooks/run-hook preamble --extra'],
  ])('no notice for %s (exact ownership, never a mention)', (_label, command) => {
    writeLegacySettings(repo, settingsWith([command.replace('<ROOT>', repo)]));
    expect(noticeLines(contextOf(run(repo).stdout))).toEqual([]);
  }, HOOK_RUN_ALLOWANCE_MS);

  it.each(['resume', 'compact'])('no notice on a %s — only a fresh session carries it', (source) => {
    writeLegacySettings(repo, settingsWith([runHookCommand(repo, 'session-start-context')]));
    expect(noticeLines(contextOf(run(repo, source).stdout))).toEqual([]);
    // Non-vacuity: the same fixture on startup and on clear does carry it.
    expect(noticeLines(contextOf(run(repo, 'startup').stdout))).toHaveLength(1);
    expect(noticeLines(contextOf(run(repo, 'clear').stdout))).toHaveLength(1);
  }, HOOK_RUN_ALLOWANCE_MS * 3);

  it('no notice when the repository\'s .claude IS the machine-wide one ($CLAUDE_CONFIG_DIR)', () => {
    writeLegacySettings(repo, settingsWith([runHookCommand(repo, 'session-start-context')]));
    expect(noticeLines(contextOf(run(repo, 'startup', { CLAUDE_CONFIG_DIR: path.join(repo, '.claude') }).stdout)))
      .toEqual([]);
  }, HOOK_RUN_ALLOWANCE_MS);

  it('no notice outside a git project, or in a repository rooted at HOME', () => {
    const plain = path.join(tmp, 'not-a-repo');
    writeLegacySettings(plain, settingsWith([runHookCommand(plain, 'session-start-context')]));
    expect(noticeLines(contextOf(run(plain).stdout))).toEqual([]);

    // A dotfiles repository at HOME: its .claude is the machine's own.
    const init = spawnSync('git', ['init', '-q', home], { encoding: 'utf-8' });
    expect(init.status).toBe(0);
    writeLegacySettings(home, settingsWith([runHookCommand(home, 'session-start-context')]));
    expect(noticeLines(contextOf(run(home).stdout))).toEqual([]);
  }, HOOK_RUN_ALLOWANCE_MS * 2);

  it('no notice without a settings.json, and none for one that registers no devflow hook', () => {
    expect(noticeLines(contextOf(run(repo).stdout))).toEqual([]);
    writeLegacySettings(repo, settingsWith(['npm run lint']));
    expect(noticeLines(contextOf(run(repo).stdout))).toEqual([]);
  }, HOOK_RUN_ALLOWANCE_MS * 2);

  it('a settings.json that registers no devflow hook costs a builtin read — no subprocess', () => {
    // Additive recording shim (PF-045): wrappers in FRONT of PATH that log, then
    // exec the real tool. The differential is a repo with no settings.json.
    const shimDir = fs.mkdtempSync(path.join(tmp, 'shim-'));
    const logPath = path.join(shimDir, 'invocations.log');
    const shimmed: string[] = [];
    for (const tool of ['node', 'jq', 'git', 'pwd', 'cat', 'grep', 'sed']) {
      const real = tool === 'node'
        ? process.execPath
        : ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].map(p => path.join(p, tool)).find(p => fs.existsSync(p));
      if (!real) continue;
      fs.writeFileSync(path.join(shimDir, tool),
        `#!/bin/bash\nprintf '%s\\n' ${tool} >> ${JSON.stringify(logPath)}\nexec ${JSON.stringify(real)} "$@"\n`);
      fs.chmodSync(path.join(shimDir, tool), 0o755);
      shimmed.push(tool);
    }
    expect(shimmed).toEqual(expect.arrayContaining(['node', 'git']));
    const withShim = { PATH: `${shimDir}:${process.env.PATH ?? ''}` };
    const invocations = (): string[] => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean) : []);

    // Warm-up: the first session also writes the .gitignore carve-out, which the
    // steady state never repeats; the baseline is the second session.
    run(repo, 'startup', withShim);
    fs.rmSync(logPath);
    run(repo, 'startup', withShim);
    const baseline = invocations();
    expect(baseline.length, 'the shim saw nothing — the wrappers are not on PATH').toBeGreaterThan(0);

    writeLegacySettings(repo, settingsWith(['npm run lint', '/opt/tools/run-hook preamble']));
    fs.rmSync(logPath);
    run(repo, 'startup', withShim);
    expect(invocations(), 'Section 4 forked for a settings.json with no devflow hook').toEqual(baseline);
  }, HOOK_RUN_ALLOWANCE_MS * 3);

  it('the notice interpolates nothing from the repository — no path, no marker', () => {
    const odd = path.join(tmp, 'repo-with-a-long-name');
    expect(spawnSync('git', ['init', '-q', odd], { encoding: 'utf-8' }).status).toBe(0);
    writeLegacySettings(odd, settingsWith([runHookCommand(odd, 'preamble')]));
    const [line] = noticeLines(contextOf(run(odd).stdout));
    expect(line).toBeDefined();
    expect(line).not.toContain(odd);
    expect(line).not.toContain('preamble');
  }, HOOK_RUN_ALLOWANCE_MS);
});
