/**
 * tests/tracked-area-memory.test.ts
 *
 * The memory hooks (session-start-memory, pre-compact-memory and the memory-worker Stop
 * hook) read and write nothing in a memory folder that git tracks, and nothing when a
 * `.git` entry stands and git did not answer. The session start says so once, with one
 * fixed notice as a systemMessage, on a session that starts, resumes or is cleared.
 * Memory is decided at the toplevel of the checkout the hook runs in. Every test runs
 * the real hook against a real repository. The detached worker (background-memory-update)
 * is covered by S36 in tests/eager-memory-refresh.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { git, snapshotTree, trackInGit } from './decisions/curation-fixtures.js';
import { AREA_PAUSE_NOTICE } from '../src/core/area-pause-notice.js';
import { HOOKS_DIR, HOOK_RUN_ALLOWANCE_MS, NODE_EXEC_STALL_MS, answersVersion, runHook } from './shell-hooks-helpers.js';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';

const SESSION_START = path.join(HOOKS_DIR, 'session-start-memory');
const PRE_COMPACT = path.join(HOOKS_DIR, 'pre-compact-memory');
const MEMORY_WORKER = path.join(HOOKS_DIR, 'memory-worker');
const TEST_BUDGET_MS = 3 * (HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS);
const MEMORY = '.devflow/memory';
const NOTE = `${MEMORY}/tracked-note.txt`;
const CANARY = 'WORKING-MEMORY-CANARY';

interface Envelope {
  hookSpecificOutput?: { additionalContext?: string };
  systemMessage?: string;
}

describe('the memory hooks and a memory folder that git tracks', { timeout: TEST_BUDGET_MS }, () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let base: string;
  let home: string;
  let main: string;
  let shimBin: string;
  let callLog: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-memory-')));
    home = path.join(base, 'home');
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
    main = repo(path.join(base, 'main'));
    shimBin = path.join(base, 'shim');
    callLog = path.join(base, 'calls.log');
    fs.mkdirSync(shimBin);
    // git and node log each call and run the real program; nohup logs and starts nothing, so a
    // Stop hook that would spawn the worker leaves a line. claude answers the worker's version probe.
    for (const name of ['git', 'node']) {
      const real = name === 'node' ? process.execPath : spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      writeFakeExecutable(path.join(shimBin, name), `#!/bin/bash\necho "${name} $*" >> "${callLog}"\nexec "${real}" "$@"\n`);
    }
    writeFakeExecutable(path.join(shimBin, 'nohup'), `#!/bin/bash\necho "nohup $*" >> "${callLog}"\n`);
    writeFakeExecutable(path.join(shimBin, 'claude'), answersVersion('#!/bin/bash\nexit 0\n'));
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

  const write = (dir: string, rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  const recordingPath = (): string => `${shimBin}:${process.env.PATH ?? '/usr/bin:/bin'}`;

  /** Make git fail for `ls-files` only: every other call still runs, so the hook gets as far as the check. */
  function makeListingFail(): void {
    const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFakeExecutable(
      path.join(shimBin, 'git'),
      `#!/bin/bash\necho "git $*" >> "${callLog}"\nfor a in "$@"; do\n  if [ "$a" = ls-files ]; then exit 2; fi\ndone\nexec "${real}" "$@"\n`,
    );
  }

  /**
   * Working memory with a stale batch and a worker notice in `dir`: a session start that reads
   * the folder shows the memory, warns that the refresh may be failing, moves the batch back to
   * the queue and shows the notice. There is no queue, so the batch is what the cold path moves.
   */
  function seedMemory(dir: string): void {
    const head = git(dir, ['rev-parse', 'HEAD']);
    write(dir, `${MEMORY}/WORKING-MEMORY.md`, `<!-- memory-head: ${head} branch: main -->\n## Now\n- ${CANARY}\n`);
    write(dir, `${MEMORY}/.worker-notice-path`, 'path\n');
    const batch = path.join(dir, MEMORY, '.pending-turns.processing');
    fs.writeFileSync(batch, '{"role":"user","content":"a stale batch","ts":1}\n');
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(batch, past, past);
  }

  const trackNote = (dir: string, opts: { commit?: boolean } = { commit: true }): void => trackInGit(dir, [NOTE], opts);

  /** The logged calls of `prefix` (git or node) that carry `word` as one argument. */
  const calls = (prefix: string, word: string): string[] =>
    (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8').split('\n') : []).filter(line => line.startsWith(`${prefix} `) && line.split(' ').includes(word));

  const hookLog = (): string => {
    const logs = path.join(home, '.devflow', 'logs');
    return fs.readdirSync(logs).flatMap(slug => {
      const dir = path.join(logs, slug);
      return fs.readdirSync(dir).filter(name => name.endsWith('.log')).map(name => fs.readFileSync(path.join(dir, name), 'utf8'));
    }).join('\n');
  };

  function start(source: string, { cwd = main, env = {} }: { cwd?: string; env?: Record<string, string> } = {}): { raw: string; envelope: Envelope; context: string; message: string } {
    const res = runHook(SESSION_START, { cwd, source }, home, { PATH: recordingPath(), ...env });
    expect({ exitCode: res.exitCode, stderr: res.stderr }).toEqual({ exitCode: 0, stderr: '' });
    const envelope = res.stdout.trim() === '' ? {} : (JSON.parse(res.stdout) as Envelope);
    return { raw: res.stdout, envelope, context: envelope.hookSpecificOutput?.additionalContext ?? '', message: envelope.systemMessage ?? '' };
  }

  describe('session start', () => {
    it('control: an untracked memory folder reaches the context with its memory and warning, moves the stale batch and shows the worker notice', () => {
      seedMemory(main);

      const { context, message } = start('startup');

      expect(context).toContain(CANARY);
      expect(context).toContain('MEMORY REFRESH MAY BE FAILING');
      expect(message).toContain('working memory is not updating');
      expect(fs.existsSync(path.join(main, MEMORY, '.pending-turns.jsonl')), 'the cold path moved the stale batch').toBe(true);
      expect(fs.existsSync(path.join(main, MEMORY, '.worker-notice-path.shown'))).toBe(true);
    });

    describe.each(['startup', 'resume', 'clear'])('a session that %s, git tracks a file of the memory folder', (source) => {
      it('sends the memory notice as a systemMessage alone, and reads and writes nothing in the folder', () => {
        seedMemory(main);
        trackNote(main);
        const before = snapshotTree(path.join(main, MEMORY), { stat: true });

        const { raw, envelope, context } = start(source);

        expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.memory.tracked });
        expect(context).toBe('');
        expect(raw).not.toContain(CANARY);
        expect(raw).not.toContain('MEMORY REFRESH');
        expect(raw).not.toContain('working memory is not updating');
        expect(snapshotTree(path.join(main, MEMORY), { stat: true }), 'bytes, modes and mtimes are as they were').toEqual(before);
        expect(fs.existsSync(path.join(main, MEMORY, '.worker-notice-path')), 'the worker notice stays where it was').toBe(true);
        expect(fs.existsSync(path.join(main, MEMORY, '.pending-turns.processing')), 'no batch was renamed').toBe(true);
        expect(fs.existsSync(path.join(main, MEMORY, '.pending-turns.jsonl'))).toBe(false);
      });
    });

    it.each(['startup', 'resume', 'clear'])('a session that %s, git does not answer: the other notice goes out and the folder is as it was', (source) => {
      seedMemory(main);
      makeListingFail();
      const before = snapshotTree(path.join(main, MEMORY), { stat: true });

      const { envelope } = start(source);

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.memory.unknown });
      expect(calls('git', 'ls-files'), 'non-vacuity: git was asked and did not answer').toHaveLength(1);
      expect(snapshotTree(path.join(main, MEMORY), { stat: true })).toEqual(before);
    });

    it('a compaction sends nothing at all, and still reads and writes nothing in the folder', () => {
      seedMemory(main);
      trackNote(main);
      const before = snapshotTree(path.join(main, MEMORY), { stat: true });

      const { raw } = start('compact');

      expect(raw.trim()).toBe('');
      expect(snapshotTree(path.join(main, MEMORY), { stat: true })).toEqual(before);
    });

    it('a staged file counts as tracked, as does one git deleted from the work tree', () => {
      seedMemory(main);
      trackNote(main, { commit: false });
      expect(start('startup').message).toBe(AREA_PAUSE_NOTICE.memory.tracked);

      git(main, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'add note']);
      fs.rmSync(path.join(main, NOTE));
      expect(start('startup').message).toBe(AREA_PAUSE_NOTICE.memory.tracked);
    });

    it('asks git once: one node-mode call, and the notice words hold no path or git output', () => {
      seedMemory(main);
      trackNote(main);

      const { message } = start('startup');

      expect(calls('node', 'tracked-area')).toHaveLength(1);
      expect(calls('git', 'ls-files')).toHaveLength(1);
      expect(message).not.toContain(base);
    });

    it('logs one fixed line, with the reason as one word', () => {
      trackNote(main);
      start('startup');
      expect(hookLog().split('\n').filter(line => line.includes('Memory paused: git tracks files in the memory folder, or did not answer (tracked); nothing read or written'))).toHaveLength(1);
    });

    it('looks again at every start: once the files are untracked the memory comes back and the notice stops', () => {
      seedMemory(main);
      trackNote(main);
      expect(start('startup').message).toBe(AREA_PAUSE_NOTICE.memory.tracked);

      git(main, ['rm', '-q', '--cached', '--', NOTE]);
      const { context, message } = start('startup');

      expect(context).toContain(CANARY);
      expect(message).not.toBe(AREA_PAUSE_NOTICE.memory.tracked);
      expect(message).not.toContain('paused');
    });

    it('memory switched off: no check is made and nothing is sent', () => {
      trackNote(main);
      fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({ version: '2.0.0', features: { memory: false } }));

      const { raw } = start('startup');

      expect(raw.trim()).toBe('');
      expect(calls('node', 'tracked-area')).toEqual([]);
      expect(calls('git', 'ls-files')).toEqual([]);
    });

    it('a directory with no .git entry runs as before and makes no listing call', () => {
      const plain = path.join(base, 'plain');
      write(plain, `${MEMORY}/WORKING-MEMORY.md`, `<!-- memory-head: abc1234 branch: main -->\n## Now\n- ${CANARY}\n`);

      const { context, message } = start('startup', { cwd: plain });

      expect(context).toContain(CANARY);
      expect(message).toBe('');
      expect(calls('git', 'ls-files')).toEqual([]);
      expect(calls('node', 'tracked-area')).toEqual([]);
    });

    it('a linked worktree is decided at its own toplevel: a tracked memory file there pauses it and not the main checkout', () => {
      seedMemory(main);
      const linked = path.join(base, 'linked');
      git(main, ['worktree', 'add', '-q', linked, '-b', 'linked-branch']);
      seedMemory(linked);
      trackNote(linked, { commit: false });

      expect(start('startup', { cwd: linked }).message).toBe(AREA_PAUSE_NOTICE.memory.tracked);
      expect(start('startup', { cwd: main }).context).toContain(CANARY);
    });

    it('a tracked memory file of the main checkout does not pause a linked worktree that does not track one', () => {
      const linked = path.join(base, 'linked');
      git(main, ['worktree', 'add', '-q', linked, '-b', 'linked-branch']);
      seedMemory(linked);
      trackNote(main, { commit: false });

      const { context, message } = start('startup', { cwd: linked });

      expect(context).toContain(CANARY);
      expect(message).not.toBe(AREA_PAUSE_NOTICE.memory.tracked);
    });
  });

  describe('pre-compact', () => {
    const compact = (cwd: string, env: Record<string, string> = {}): void => {
      const res = runHook(PRE_COMPACT, { cwd, session_id: 't' }, home, { PATH: recordingPath(), ...env });
      expect({ exitCode: res.exitCode, stderr: res.stderr }).toEqual({ exitCode: 0, stderr: '' });
    };

    it('control: an untracked project gets its backup and its bootstrapped working memory', () => {
      fs.mkdirSync(path.join(main, MEMORY), { recursive: true });

      compact(main);

      expect(fs.existsSync(path.join(main, MEMORY, 'backup.json'))).toBe(true);
      expect(fs.existsSync(path.join(main, MEMORY, 'WORKING-MEMORY.md'))).toBe(true);
    });

    it('git tracks a file of the memory folder: no backup, no working memory, and the folder is as it was', () => {
      trackNote(main);
      const before = snapshotTree(path.join(main, MEMORY), { stat: true });

      compact(main);

      expect(snapshotTree(path.join(main, MEMORY), { stat: true })).toEqual(before);
      expect(fs.existsSync(path.join(main, MEMORY, 'backup.json'))).toBe(false);
      expect(fs.existsSync(path.join(main, MEMORY, 'WORKING-MEMORY.md'))).toBe(false);
      expect(calls('node', 'tracked-area')).toHaveLength(1);
      expect(hookLog()).toContain('Memory paused: git tracks files in the memory folder, or did not answer; no backup or working memory written');
    });

    it('git does not answer: no folder is made, and no backup or working memory is written', () => {
      expect(fs.existsSync(path.join(main, '.devflow'))).toBe(false);
      makeListingFail();

      compact(main);

      expect(calls('git', 'ls-files'), 'non-vacuity: git was asked and did not answer').toHaveLength(1);
      expect(fs.existsSync(path.join(main, '.devflow')), 'no .devflow folder was made').toBe(false);
    });
  });

  describe('the Stop hook', () => {
    const stop = (cwd: string, env: Record<string, string> = {}): void => {
      const res = runHook(MEMORY_WORKER, { cwd, session_id: 't' }, home, { PATH: recordingPath(), ...env });
      expect({ exitCode: res.exitCode, stderr: res.stderr }).toEqual({ exitCode: 0, stderr: '' });
    };
    const stamp = (): string => path.join(main, MEMORY, '.working-memory-last-trigger');
    const spawns = (): string[] => (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8').split('\n') : []).filter(line => line.startsWith('nohup '));

    /** The worker is started in the background, so its record may land a moment after the hook ends. */
    function waitForSpawn(): void {
      const deadline = Date.now() + 5_000;
      while (spawns().length === 0 && Date.now() < deadline) spawnSync('sleep', ['0.05']);
    }

    it('control: an untracked project stamps the trigger and spawns the worker', () => {
      fs.mkdirSync(path.join(main, MEMORY), { recursive: true });

      stop(main);
      waitForSpawn();

      expect(fs.existsSync(stamp())).toBe(true);
      expect(spawns()).toHaveLength(1);
    });

    it('git tracks a file of the memory folder: no trigger stamp, no worker, and the folder is as it was', () => {
      trackNote(main);
      const before = snapshotTree(path.join(main, MEMORY), { stat: true });

      stop(main);

      expect(fs.existsSync(stamp())).toBe(false);
      expect(snapshotTree(path.join(main, MEMORY), { stat: true })).toEqual(before);
      expect(spawns()).toEqual([]);
      expect(hookLog()).toContain('Memory paused: git tracks files in the memory folder, or did not answer; trigger not stamped, worker not spawned');
    });

    it('git does not answer: no trigger stamp and no worker', () => {
      fs.mkdirSync(path.join(main, MEMORY), { recursive: true });
      makeListingFail();

      stop(main);

      expect(calls('git', 'ls-files'), 'non-vacuity: git was asked and did not answer').toHaveLength(1);
      expect(fs.existsSync(stamp())).toBe(false);
      expect(spawns()).toEqual([]);
    });

    it('a throttled event asks nothing: the trigger stamp is fresh, so no listing call is made', () => {
      fs.mkdirSync(path.join(main, MEMORY), { recursive: true });
      fs.writeFileSync(stamp(), '');

      stop(main);

      expect(calls('git', 'ls-files')).toEqual([]);
      expect(spawns()).toEqual([]);
    });

    it('looks again at the next event: once the files are untracked the worker is spawned', () => {
      trackNote(main);
      stop(main);
      expect(spawns()).toEqual([]);

      git(main, ['rm', '-q', '--cached', '--', NOTE]);
      stop(main);
      waitForSpawn();

      expect(spawns()).toHaveLength(1);
    });
  });
});
