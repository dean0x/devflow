/**
 * D-NO-FSMONITOR — the memory hooks read a repository's index without running
 * its `core.fsmonitor` command. (The HUD's case lives with its real-repo tests
 * in tests/integration/hud-git.test.ts; json-helper's in
 * tests/decisions/ledger-ops.test.ts.)
 *
 * git runs the command a repository's config names in `core.fsmonitor`
 * whenever it reads the index — `status`, `diff` and `ls-files` included — so
 * an index read inside a cloned repository is code execution chosen by that
 * repository. Each site that reads the index passes `-c core.fsmonitor=false`.
 *
 * Every test arms a real repository with a hook that records its own run, runs
 * the site, and asserts both halves: the hook never ran, and the git state the
 * site reports is still correct. A known-bad probe then runs the same index
 * read without the override and sees the hook fire, so a green run cannot come
 * from a hook git never calls. Temp dirs only; every spawn gets a temp HOME.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runHook } from './shell-hooks-helpers.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');
const PRE_COMPACT_HOOK = path.join(HOOKS_DIR, 'pre-compact-memory');
const BACKGROUND_UPDATER = path.join(HOOKS_DIR, 'background-memory-update');
/** Each case spawns a full hook plus several git calls; slow under a loaded suite. */
const HOOK_TIMEOUT_MS = 30_000;

/** A sandbox: the repository, a HOME, and the fsmonitor hook's run marker. */
interface Sandbox {
  base: string;
  repo: string;
  home: string;
  marker: string;
  env: NodeJS.ProcessEnv;
}

function makeSandbox(prefix: string): Sandbox {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@test.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@test.com',
  };
  return { base, repo, home, marker: path.join(base, 'fsmonitor-ran'), env };
}

function git(sb: Sandbox, args: string[]): void {
  execFileSync('git', args, { cwd: sb.repo, env: sb.env, stdio: 'ignore' });
}

/**
 * One commit, then an untracked file and a modified tracked file, then the
 * hook — armed last so the fixture's own commit never runs it.
 */
function armRepo(sb: Sandbox): void {
  git(sb, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(sb.repo, 'tracked.txt'), 'one\n');
  git(sb, ['add', 'tracked.txt']);
  git(sb, ['commit', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(sb.repo, 'tracked.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(sb.repo, 'untracked-probe.txt'), 'new\n');
  const hook = path.join(sb.base, 'fsmonitor-hook.sh');
  fs.writeFileSync(hook, `#!/bin/sh\necho ran >> '${sb.marker}'\nexit 1\n`);
  fs.chmodSync(hook, 0o755);
  git(sb, ['config', 'core.fsmonitor', hook]);
}

/** Known-bad probe: an unguarded index read in the same repository runs the hook. */
function expectUnguardedReadRunsHook(sb: Sandbox): void {
  expect(fs.existsSync(sb.marker)).toBe(false);
  git(sb, ['status', '--porcelain']);
  expect(fs.existsSync(sb.marker), 'the fixture hook is live').toBe(true);
}

describe('D-NO-FSMONITOR: index reads never run the repository\'s fsmonitor hook', () => {
  let sb: Sandbox;

  beforeEach(() => {
    sb = makeSandbox('df-fsmonitor');
    armRepo(sb);
  });

  afterEach(() => {
    fs.rmSync(sb.base, { recursive: true, force: true });
  });

  it('pre-compact-memory records git status and diff without running the hook', () => {
    fs.mkdirSync(path.join(sb.repo, '.devflow', 'memory'), { recursive: true });
    const run = runHook(PRE_COMPACT_HOOK, { cwd: sb.repo, session_id: 'fsmonitor-test' }, sb.home, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    });
    expect(run.exitCode, run.stderr).toBe(0);

    const backup = JSON.parse(
      fs.readFileSync(path.join(sb.repo, '.devflow', 'memory', 'backup.json'), 'utf-8'),
    ) as { git: { status: string; diff_stat: string } };
    expect(fs.existsSync(sb.marker), 'pre-compact-memory ran the fsmonitor hook').toBe(false);
    expect(backup.git.status).toContain('untracked-probe.txt');
    expect(backup.git.diff_stat).toContain('tracked.txt');

    expectUnguardedReadRunsHook(sb);
  }, HOOK_TIMEOUT_MS);

  it('background-memory-update puts git status and diff in the prompt without running the hook', () => {
    const memoryDir = path.join(sb.repo, '.devflow', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(memoryDir, '.pending-turns.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'implement the feature', ts }),
        JSON.stringify({ role: 'assistant', content: 'Sure, implementing now...', ts: ts + 1 }),
      ].join('\n') + '\n',
    );
    // A fake claude that captures the prompt and writes the staged memory file.
    const shimDir = path.join(sb.base, 'shim');
    fs.mkdirSync(shimDir);
    const captured = path.join(sb.base, 'prompt.txt');
    const staged = path.join(memoryDir, 'WORKING-MEMORY.md.new');
    fs.writeFileSync(
      path.join(shimDir, 'claude'),
      `#!/bin/bash\ncat > '${captured}'\necho "<!-- memory-head: testsha branch: main -->" > '${staged}'\nexit 0\n`,
    );
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);

    execSync(`bash "${BACKGROUND_UPDATER}" "${sb.repo}"`, {
      env: { ...sb.env, PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}` },
      // The worker's watchdog inherits fds; 'ignore' keeps node from waiting on it.
      stdio: 'ignore',
    });

    const prompt = fs.readFileSync(captured, 'utf-8');
    expect(fs.existsSync(sb.marker), 'background-memory-update ran the fsmonitor hook').toBe(false);
    expect(prompt).toContain('untracked-probe.txt');
    expect(prompt).toMatch(/Diff summary:\n.*tracked\.txt/);

    expectUnguardedReadRunsHook(sb);
  }, HOOK_TIMEOUT_MS);
});
