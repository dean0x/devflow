/**
 * tests/tracked-area-capture.test.ts
 *
 * The capture hooks (capture-prompt, capture-turn, capture-question) write nothing into a
 * folder that git tracks, and nothing when a `.git` entry stands and git did not answer.
 * The memory queue and the curation queue are asked apart: a paused queue gets no row and
 * no file, and the other queue goes on. The check runs before every write, whether or not
 * the queue's folder exists. Every test runs the real hook against a real repository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { git, pathWithFailingGit, snapshotTree, trackInGit } from './decisions/curation-fixtures.js';
import { HOOK_RUN_ALLOWANCE_MS, NODE_EXEC_STALL_MS, runHook } from './shell-hooks-helpers.js';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';

const HOOKS_DIR = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'scripts', 'hooks');
const QUEUE = '.pending-turns.jsonl';
const TEST_BUDGET_MS = 3 * (HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS);

type Hook = 'capture-prompt' | 'capture-turn' | 'capture-question';
const INPUTS: Readonly<Record<Hook, (cwd: string) => object>> = {
  'capture-prompt': cwd => ({ cwd, session_id: 't', prompt: 'implement feature X' }),
  'capture-turn': cwd => ({ cwd, session_id: 't', last_assistant_message: 'done with feature X' }),
  'capture-question': cwd => ({ cwd, session_id: 't', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] }, tool_response: { answers: { 'Q?': 'A' } } }),
};
const HOOKS = Object.keys(INPUTS) as Hook[];

describe('capture writes nothing into a folder that git tracks', { timeout: TEST_BUDGET_MS }, () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let base: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-capture-')));
    home = path.join(base, 'home');
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
    project = repo(path.join(base, 'project'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** A repository with one commit at `dir`. */
  function repo(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    return dir;
  }

  const queueOf = (dir: string, area: 'curation' | 'memory'): string => path.join(dir, '.devflow', area, QUEUE);
  const rowsOf = (file: string): string[] => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
  const SEED = '{"role":"user","content":"a row the repository holds","ts":1}\n';

  /** Track a queue in `dir`'s index (and commit it), holding one seed row. */
  function trackQueue(dir: string, area: string, { commit = true }: { commit?: boolean } = {}): string {
    const file = path.join(dir, '.devflow', area, QUEUE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SEED);
    trackInGit(dir, [path.relative(dir, file)], { commit });
    return file;
  }

  /** Every queue file below `dir`'s .devflow, relative. */
  function queueFiles(dir: string): string[] {
    const found: string[] = [];
    const walk = (current: string): void => {
      if (!fs.existsSync(current)) return;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.name === QUEUE) found.push(path.relative(dir, abs));
      }
    };
    walk(path.join(dir, '.devflow'));
    return found.sort();
  }

  const hookLogs = (): string => {
    const text: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (entry.isFile()) text.push(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      }
    };
    walk(path.join(home, '.devflow', 'logs'));
    return text.join('\n');
  };

  function capture(hook: Hook, cwd: string = project, env: Record<string, string> = {}): void {
    const res = runHook(path.join(HOOKS_DIR, hook), INPUTS[hook](cwd), home, env);
    expect({ exitCode: res.exitCode, stderr: res.stderr }).toEqual({ exitCode: 0, stderr: '' });
  }

  it.each(HOOKS)('%s: an untracked project takes a row in both queues', (hook) => {
    capture(hook);

    expect(rowsOf(queueOf(project, 'memory'))).toHaveLength(1);
    expect(rowsOf(queueOf(project, 'curation'))).toHaveLength(1);
  });

  describe.each(HOOKS)('%s', (hook) => {
    it('git tracks the curation queue: it keeps its bytes, mode and mtime, and the untracked memory queue takes the row', () => {
      const tracked = trackQueue(project, 'curation');
      const before = snapshotTree(path.dirname(tracked), { stat: true });

      capture(hook);

      expect(snapshotTree(path.dirname(tracked), { stat: true })).toEqual(before);
      expect(rowsOf(tracked)).toEqual([SEED.trim()]);
      expect(rowsOf(queueOf(project, 'memory'))).toHaveLength(1);
      expect(hookLogs()).toContain('Queue skipped: the curation area is paused');
    });

    it('git tracks the memory queue: it keeps its bytes, and the untracked curation queue takes the row', () => {
      const tracked = trackQueue(project, 'memory');
      const before = snapshotTree(path.dirname(tracked), { stat: true });

      capture(hook);

      expect(snapshotTree(path.dirname(tracked), { stat: true })).toEqual(before);
      expect(rowsOf(queueOf(project, 'curation'))).toHaveLength(1);
      expect(hookLogs()).toContain('Queue skipped: the memory area is paused');
    });

    it('git tracks both queues: no row is written and no queue file is made', () => {
      const curation = trackQueue(project, 'curation');
      const memory = trackQueue(project, 'memory');

      capture(hook);

      expect(rowsOf(curation)).toEqual([SEED.trim()]);
      expect(rowsOf(memory)).toEqual([SEED.trim()]);
      expect(queueFiles(project)).toEqual([path.relative(project, curation), path.relative(project, memory)].sort());
    });

    it('a tracked queue deleted from the work tree is not made again, and a paused area with no folder gets none', () => {
      trackQueue(project, 'curation');
      fs.rmSync(path.join(project, '.devflow', 'curation'), { recursive: true });

      capture(hook);

      expect(fs.existsSync(queueOf(project, 'curation')), 'the tracked queue is not written back').toBe(false);
      expect(rowsOf(queueOf(project, 'memory'))).toHaveLength(1);
    });

    it('an entry that is only in the index pauses the area before any folder exists', () => {
      const sha = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: project, input: SEED, encoding: 'utf8' }).stdout.trim();
      git(project, ['update-index', '--add', '--cacheinfo', `100644,${sha},.devflow/memory/${QUEUE}`]);
      expect(fs.existsSync(path.join(project, '.devflow', 'memory'))).toBe(false);

      capture(hook);

      expect(fs.existsSync(queueOf(project, 'memory'))).toBe(false);
      expect(rowsOf(queueOf(project, 'curation'))).toHaveLength(1);
    });

    it('git tracks the old ledger folder: curation is paused, memory is not', () => {
      const legacy = path.join(project, '.devflow', 'learning', 'notes.txt');
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, 'kept\n');
      trackInGit(project, ['.devflow/learning/notes.txt'], { commit: true });

      capture(hook);

      expect(queueFiles(project).filter(file => file.includes('learning') || file.includes('curation'))).toEqual([]);
      expect(rowsOf(queueOf(project, 'memory'))).toHaveLength(1);
    });

    it('git tracks a backup folder of the move: curation is paused, memory is not', () => {
      const backup = path.join(project, '.devflow', 'learning.backup-20261001T000001Z-00000001', 'notes.txt');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, 'kept\n');
      trackInGit(project, [path.relative(project, backup)], { commit: true });

      capture(hook);

      expect(fs.existsSync(queueOf(project, 'curation'))).toBe(false);
      expect(rowsOf(queueOf(project, 'memory'))).toHaveLength(1);
    });

    it('git did not answer: neither queue takes a row', () => {
      const failing = pathWithFailingGit(base);

      capture(hook, project, { PATH: `${failing}:${process.env.PATH ?? '/usr/bin:/bin'}` });

      expect(queueFiles(project)).toEqual([]);
      expect(hookLogs()).toContain('Queue skipped: the memory area is paused');
      expect(hookLogs()).toContain('Queue skipped: the curation area is paused');
    });

    it('an empty .git entry (git has no repository to answer from): neither queue takes a row', () => {
      const bare = path.join(base, 'bare');
      fs.mkdirSync(path.join(bare, '.git'), { recursive: true });

      capture(hook, bare);

      expect(queueFiles(bare)).toEqual([]);
    });

    it('a project that tracks other files of .devflow keeps capturing', () => {
      fs.mkdirSync(path.join(project, '.devflow'), { recursive: true });
      fs.writeFileSync(path.join(project, '.devflow', 'project.json'), '{}\n');
      trackInGit(project, ['.devflow/project.json'], { commit: true });

      capture(hook);

      expect(rowsOf(queueOf(project, 'memory'))).toHaveLength(1);
      expect(rowsOf(queueOf(project, 'curation'))).toHaveLength(1);
    });
  });

  describe('a linked worktree', () => {
    /** A linked worktree of `project`, with the main checkout's .devflow folder in place so it holds the ledger. */
    function linkedWorktree(): string {
      fs.mkdirSync(path.join(project, '.devflow'), { recursive: true });
      const worktree = path.join(base, 'linked');
      git(project, ['worktree', 'add', '-q', '--detach', worktree]);
      return worktree;
    }

    it.each(HOOKS)('%s: the main checkout tracks curation, so a session in the worktree pauses curation and not its own memory', (hook) => {
      const tracked = trackQueue(project, 'curation');
      const before = snapshotTree(path.dirname(tracked), { stat: true });
      const worktree = linkedWorktree();

      capture(hook, worktree);

      expect(snapshotTree(path.dirname(tracked), { stat: true }), 'the main checkout is untouched').toEqual(before);
      expect(rowsOf(queueOf(worktree, 'memory'))).toHaveLength(1);
    });

    it.each(HOOKS)('%s: a worktree that tracks its own memory pauses memory only there; the main checkout takes the curation row', (hook) => {
      const worktree = linkedWorktree();
      const tracked = path.join(worktree, '.devflow', 'memory', QUEUE);
      fs.mkdirSync(path.dirname(tracked), { recursive: true });
      fs.writeFileSync(tracked, SEED);
      git(worktree, ['add', '-f', '--', `.devflow/memory/${QUEUE}`]);

      capture(hook, worktree);

      expect(rowsOf(tracked)).toEqual([SEED.trim()]);
      expect(rowsOf(queueOf(project, 'curation')), 'the ledger of the main checkout takes the row').toHaveLength(1);
      expect(fs.existsSync(queueOf(worktree, 'curation')), 'no ledger beside the worktree').toBe(false);
    });
  });

  describe('no .git entry at the root', () => {
    it.each(HOOKS)('%s: writes nothing in a plain directory and makes no git call to list files', (hook) => {
      const plain = path.join(base, 'plain');
      fs.mkdirSync(plain);
      const shim = path.join(base, 'shim');
      const log = path.join(base, 'git-calls.log');
      fs.mkdirSync(shim);
      const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      writeFakeExecutable(path.join(shim, 'git'), `#!/bin/bash\necho "$@" >> "${log}"\nexec "${real}" "$@"\n`);

      capture(hook, plain, { PATH: `${shim}:${process.env.PATH ?? '/usr/bin:/bin'}` });

      expect(queueFiles(plain)).toEqual([]);
      expect(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').not.toContain('ls-files');
    });
  });
});
