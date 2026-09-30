/**
 * D-HOOKS-TOPLEVEL-ONLY — the hooks scaffold `.devflow/` and the root `.gitignore`
 * carve-out only at a directory that holds its own `.git`, never below one.
 *
 * The defect this pins (#406 item 9): when `git rev-parse` fails from a
 * subdirectory of a checkout — the repository has "dubious ownership", or
 * GIT_CEILING_DIRECTORIES stops git's upward search — df_resolve_roots falls back
 * to the raw cwd, while the project gate's marker walk (df_has_git_marker) still
 * finds the ancestor `.git`. The two disagreed, so ensure-devflow-init and
 * session-start-context wrote `.devflow/` and a `.gitignore` into the SUBDIRECTORY.
 *
 * Every run gets its own HOME (a temp dir, never the real one — PF-060), so no
 * global git config (`safe.directory`) and no machine `~/.devflow` leak in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HOOKS_DIR, HOOK_RUN_ALLOWANCE_MS, runHook } from './shell-hooks-helpers.js';

const ENSURE_DEVFLOW = path.join(HOOKS_DIR, 'ensure-devflow-init');
const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');
const GIT_MARKER = path.join(HOOKS_DIR, 'git-marker');

/** How git is told to refuse the subdirectory's checkout, as extra environment. */
interface Refusal {
  readonly label: string;
  readonly env: (repo: string) => Record<string, string>;
}

const REFUSALS: readonly Refusal[] = [
  // Git will not chdir up INTO a ceiling directory, so from <repo>/sub the search
  // stops before it reaches <repo>/.git.
  { label: 'GIT_CEILING_DIRECTORIES', env: repo => ({ GIT_CEILING_DIRECTORIES: repo }) },
  // git's own switch for its safe.directory check (setup.c): every repository reads
  // as owned by someone else, exactly as a checkout on a shared mount does.
  { label: 'dubious ownership', env: () => ({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }) },
];

describe('hooks scaffold only at a toplevel (D-HOOKS-TOPLEVEL-ONLY)', () => {
  let tmp: string;
  let home: string;
  let repo: string;
  let sub: string;

  beforeEach(() => {
    // Physical paths: GIT_CEILING_DIRECTORIES is compared against git's resolved
    // cwd, and on macOS the temp tree sits behind /var → /private/var.
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-toplevel-')));
    home = path.join(tmp, 'home');
    repo = path.join(tmp, 'repo');
    sub = path.join(repo, 'sub');
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
    fs.mkdirSync(sub, { recursive: true });
    const init = spawnSync('git', ['init', '-q', repo], { env: { ...process.env, HOME: home }, encoding: 'utf-8' });
    expect(init.status, init.stderr).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A clean environment for one hook run: the temp HOME, plus the refusal's variables. */
  const envFor = (extra: Record<string, string>): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...extra };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    return env;
  };

  /** Whether git itself refuses `dir` under `extra` — the precondition each refusal case needs. */
  const gitRefuses = (dir: string, extra: Record<string, string>): boolean =>
    spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { env: envFor(extra), encoding: 'utf-8' }).status !== 0;

  /** Source ensure-devflow-init for `cwd` and report its return status. */
  const ensureInit = (cwd: string, extra: Record<string, string> = {}): string => {
    const run = spawnSync('bash', ['-c', 'source "$1" "$2"; echo "rc=$?"', '_', ENSURE_DEVFLOW, cwd], {
      env: envFor(extra),
      encoding: 'utf-8',
    });
    return run.stdout.trim();
  };

  const scaffolded = (dir: string): string[] =>
    ['.devflow', '.gitignore'].filter(name => fs.existsSync(path.join(dir, name)));

  for (const refusal of REFUSALS) {
    it(`ensure-devflow-init writes nothing when git refuses a subdirectory (${refusal.label})`, (ctx) => {
      const extra = refusal.env(repo);
      if (!gitRefuses(sub, extra)) ctx.skip(); // this git does not honour the switch
      expect(gitRefuses(sub, extra)).toBe(true);

      expect(ensureInit(sub, extra)).toBe('rc=1');

      expect(scaffolded(sub), 'nothing may be scaffolded in the subdirectory').toEqual([]);
      expect(scaffolded(repo), 'nor at a toplevel git did not name').toEqual([]);
    }, HOOK_RUN_ALLOWANCE_MS * 2);

    it(`session-start-context writes no carve-out when git refuses a subdirectory (${refusal.label})`, (ctx) => {
      const extra = refusal.env(repo);
      if (!gitRefuses(sub, extra)) ctx.skip();

      const { exitCode } = runHook(CONTEXT_HOOK, { cwd: sub, source: 'startup' }, home, extra);

      expect(exitCode).toBe(0);
      expect(scaffolded(sub), 'nothing may be scaffolded in the subdirectory').toEqual([]);
      expect(scaffolded(repo), 'nor at a toplevel git did not name').toEqual([]);
    }, HOOK_RUN_ALLOWANCE_MS * 2);
  }

  it('a subdirectory git DOES resolve scaffolds at the toplevel, never at the subdirectory', () => {
    expect(ensureInit(sub)).toBe('rc=0');

    expect(scaffolded(repo)).toEqual(['.devflow', '.gitignore']);
    expect(scaffolded(sub)).toEqual([]);
  }, HOOK_RUN_ALLOWANCE_MS * 2);

  it('a directory holding its own `.git` marker is still a project root when git cannot read it', () => {
    // The zero-fork marker contract (D-HOOKS-GIT-ONLY): an empty `.git` directory is a
    // marker, not a repository to `git rev-parse`, and the root stays where it is.
    const marker = path.join(tmp, 'marker-only');
    fs.mkdirSync(path.join(marker, '.git'), { recursive: true });

    expect(ensureInit(marker)).toBe('rc=0');

    expect(scaffolded(marker)).toEqual(['.devflow', '.gitignore']);
  }, HOOK_RUN_ALLOWANCE_MS * 2);

  it('df_is_project_root accepts a toplevel (`.git` directory or file) and refuses a directory below one', () => {
    const worktree = path.join(tmp, 'linked');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /some/path/.git\n');
    const nested = path.join(sub, 'deeper');
    fs.mkdirSync(nested);
    fs.mkdirSync(path.join(home, '.git'));

    const gate = spawnSync('bash', ['-c', [
      'source "$1"',
      'df_is_project_root "$2"; echo "toplevel=$?"',
      'df_is_project_root "$3"; echo "worktree=$?"',
      'df_is_project_root "$4"; echo "sub=$?"',
      'df_is_project_root "$5"; echo "nested=$?"',
      'df_is_project_root "$6"; echo "home=$?"',
    ].join('\n'), '_', GIT_MARKER, repo, worktree, sub, nested, home], { env: envFor({}), encoding: 'utf-8' });

    // HOME gets a `.git` of its own first, so its refusal is the HOME rule's, not the marker's.
    expect(gate.stdout.trim().split('\n')).toEqual(['toplevel=0', 'worktree=0', 'sub=1', 'nested=1', 'home=1']);
  });
});
