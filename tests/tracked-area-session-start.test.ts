/**
 * tests/tracked-area-session-start.test.ts
 *
 * The session start hook (session-start-context) skips curation while git tracks files in
 * a curation data folder of the ledger root, or does not answer. Then no curation file is
 * read, no curation folder is made, no maintenance directive and no model name reach the
 * context, and one fixed notice goes to the user as a systemMessage on a session that
 * starts, resumes or is cleared. Every test runs the real hook against a real repository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { git, pathWithFailingGit, snapshotTree, trackInGit } from './decisions/curation-fixtures.js';
import { AREA_PAUSE_NOTICE } from '../src/core/area-pause-notice.js';
import { MOVE_SKIP_NOTICE } from '../src/core/curation-move-skip.js';
import { HOOK_RUN_ALLOWANCE_MS, NODE_EXEC_STALL_MS, runHook } from './shell-hooks-helpers.js';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';

const SESSION_CONTEXT = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'session-start-context');
const TEST_BUDGET_MS = 2 * (HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS);
const CURATION = '.devflow/curation';
const LEGACY = '.devflow/learning';

interface Envelope {
  hookSpecificOutput?: { additionalContext?: string };
  systemMessage?: string;
}

describe('session start with a tracked curation folder', { timeout: TEST_BUDGET_MS }, () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let base: string;
  let home: string;
  let main: string;
  let shimBin: string;
  let callLog: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-session-')));
    home = path.join(base, 'home');
    fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
    main = repo(path.join(base, 'main'));
    shimBin = path.join(base, 'shim');
    callLog = path.join(base, 'calls.log');
    fs.mkdirSync(shimBin);
    for (const name of ['git', 'node']) {
      const real = name === 'node' ? process.execPath : spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      writeFakeExecutable(path.join(shimBin, name), `#!/bin/bash\necho "${name} $*" >> "${callLog}"\nexec "${real}" "$@"\n`);
    }
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

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

  /** A rendered ledger below `folder` of `dir`, with a pending queue, a stale claim and a project tuning model. */
  function seedLedger(dir: string, folder = CURATION): void {
    write(dir, `${folder}/decisions.md`, '<!-- TL;DR: 3 decisions -->\n# Architectural Decisions\n');
    write(dir, `${folder}/pitfalls.md`, '<!-- TL;DR: 2 pitfalls -->\n# Known Pitfalls\n');
    write(dir, `${folder}/index.md`, 'Decisions (1):\n  A decision  [Accepted]\n');
    write(dir, `${folder}/.pending-turns.jsonl`, '{"role":"user","content":"a pending turn","ts":1}\n');
    write(dir, `${folder}/curation.json`, '{"model":"opus"}\n');
    const claim = path.join(dir, folder, '.pending-turns.processing');
    fs.writeFileSync(claim, '{"role":"user","content":"a stale batch","ts":1}\n');
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(claim, past, past);
  }

  const trackLedger = (dir: string, folder = CURATION): void => {
    trackInGit(dir, [`${folder}/decisions.md`, `${folder}/pitfalls.md`, `${folder}/index.md`, `${folder}/.pending-turns.jsonl`, `${folder}/curation.json`], { commit: true });
  };

  function start(source: string, { cwd = main, env = {} }: { cwd?: string; env?: Record<string, string> } = {}): { raw: string; envelope: Envelope; context: string; message: string } {
    const res = runHook(SESSION_CONTEXT, { cwd, source }, home, { PATH: `${shimBin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...env });
    expect({ exitCode: res.exitCode, stderr: res.stderr }).toEqual({ exitCode: 0, stderr: '' });
    const envelope = res.stdout.trim() === '' ? {} : (JSON.parse(res.stdout) as Envelope);
    return { raw: res.stdout, envelope, context: envelope.hookSpecificOutput?.additionalContext ?? '', message: envelope.systemMessage ?? '' };
  }

  /** The logged calls of `prefix` (git or node) that carry `word` as one argument. */
  const calls = (prefix: string, word: string): string[] =>
    (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8').split('\n') : []).filter(line => line.startsWith(`${prefix} `) && line.split(' ').includes(word));

  it('control: an untracked ledger reaches the context with its decisions, index and directive', () => {
    seedLedger(main);

    const { context, message } = start('startup');

    expect(context).toContain('--- PROJECT DECISIONS (TL;DR) ---');
    expect(context).toContain(`Index: ${path.join(main, CURATION, 'index.md')}`);
    expect(context).toContain('--- CURATION MAINTENANCE ---');
    expect(message).toBe('');
  });

  describe.each(['startup', 'resume', 'clear'])('a session that %s', (source) => {
    it('puts no curation text, index line, directive or model into the context, leaves the curation files as they were, and sends the notice as a systemMessage alone', () => {
      seedLedger(main);
      trackLedger(main);
      const before = snapshotTree(path.join(main, CURATION), { stat: true });

      const { raw, envelope, context } = start(source);

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.tracked });
      expect(context).toBe('');
      for (const word of ['TL;DR', 'Index:', 'CURATION MAINTENANCE', 'Curate', 'opus', 'decisions']) expect(raw).not.toContain(word);
      expect(snapshotTree(path.join(main, CURATION), { stat: true })).toEqual(before);
    });
  });

  it('a compaction reads nothing from the curation folder and sends no notice', () => {
    seedLedger(main);
    trackLedger(main);

    const { context, message } = start('compact');

    expect(message).toBe('');
    expect(context).not.toContain('PROJECT DECISIONS');
    expect(context).not.toContain('CURATION MAINTENANCE');
  });

  it('a stale claim batch and a project tuning model put no directive and no model name into the context', () => {
    seedLedger(main);
    trackLedger(main);
    const processing = path.join(main, CURATION, '.pending-turns.processing');
    expect(fs.existsSync(processing)).toBe(true);

    const { raw } = start('startup');

    expect(raw).not.toMatch(/Curate|opus|model=|CURATION MAINTENANCE|CURATION PAUSED/);
  });

  it('a paused area with no folder on disk gets no curation folder from the session start', () => {
    const sha = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: main, input: 'x\n', encoding: 'utf8' }).stdout.trim();
    git(main, ['update-index', '--add', '--cacheinfo', `100644,${sha},${CURATION}/decisions.md`]);
    expect(fs.existsSync(path.join(main, '.devflow', 'curation'))).toBe(false);

    const { message } = start('startup');

    expect(message).toBe(AREA_PAUSE_NOTICE.curation.tracked);
    expect(fs.existsSync(path.join(main, '.devflow', 'curation'))).toBe(false);
    expect(fs.existsSync(path.join(main, '.devflow', 'learning'))).toBe(false);
  });

  it('the old ledger folder and a backup folder pause curation too', () => {
    write(main, `${LEGACY}/notes.txt`, 'kept\n');
    trackInGit(main, [`${LEGACY}/notes.txt`], { commit: true });
    expect(start('startup').message).toBe(AREA_PAUSE_NOTICE.curation.tracked);

    git(main, ['rm', '-q', '--cached', '--', `${LEGACY}/notes.txt`]);
    git(main, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'untrack']);
    write(main, '.devflow/learning.backup-20261001T000001Z-00000001/notes.txt', 'kept\n');
    trackInGit(main, ['.devflow/learning.backup-20261001T000001Z-00000001/notes.txt']);
    expect(start('startup').message).toBe(AREA_PAUSE_NOTICE.curation.tracked);
  });

  it('git tracking only the memory folder leaves curation running', () => {
    seedLedger(main);
    trackInGit(main, ['.devflow/memory/WORKING-MEMORY.md'], { commit: true });

    const { context, message } = start('startup');

    expect(context).toContain('--- PROJECT DECISIONS (TL;DR) ---');
    expect(message).toBe('');
  });

  it('a start after the files are untracked reads the ledger again and sends no notice', () => {
    seedLedger(main);
    trackLedger(main);
    expect(start('startup').message).toBe(AREA_PAUSE_NOTICE.curation.tracked);

    git(main, ['rm', '-q', '--cached', '-r', '--', CURATION]);

    const { context, message } = start('startup');
    expect(message).toBe('');
    expect(context).toContain('--- PROJECT DECISIONS (TL;DR) ---');
  });

  describe('the answer of the move is reused', () => {
    it('a move that skipped for a tracked old folder gives the pause notice, and the check asks git no second time', () => {
      write(main, `${LEGACY}/notes.txt`, 'kept\n');
      trackInGit(main, [`${LEGACY}/notes.txt`], { commit: true });
      fs.rmSync(callLog, { force: true });

      const { envelope, raw } = start('startup');

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.tracked });
      expect(raw).not.toContain(MOVE_SKIP_NOTICE.tracked);
      expect(calls('node', 'tracked-area'), 'no second question to the area check').toEqual([]);
      expect(calls('node', 'move-ledger')).toHaveLength(1);
      expect(fs.existsSync(callLog) ? calls('git', 'ls-files') : [], 'git lists once: the move asked').toHaveLength(1);
    });

    it('with no old folder the check asks once, in node mode', () => {
      seedLedger(main);
      fs.rmSync(callLog, { force: true });

      start('startup');

      expect(calls('node', 'tracked-area')).toHaveLength(1);
      expect(calls('git', 'ls-files')).toHaveLength(1);
    });
  });

  describe('git does not answer', () => {
    it('a git that fails for every call: the unknown notice goes out and no curation text reaches the context', () => {
      seedLedger(main);

      const { envelope, raw } = start('startup', { env: { PATH: `${pathWithFailingGit(base)}:${process.env.PATH ?? '/usr/bin:/bin'}` } });

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.unknown });
      expect(raw).not.toMatch(/TL;DR|Index:|CURATION MAINTENANCE/);
    });

    it('an empty .git entry: git has no repository to answer from, so the unknown notice goes out', () => {
      const bare = path.join(base, 'bare');
      fs.mkdirSync(path.join(bare, '.git'), { recursive: true });
      seedLedger(bare);

      const { envelope } = start('startup', { cwd: bare });

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.unknown });
    });

    it('a git that does not finish listing is cut at the bound of the check and reads as unknown', () => {
      seedLedger(main);
      const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      const hang = path.join(base, 'hang');
      fs.mkdirSync(hang);
      writeFakeExecutable(path.join(hang, 'git'), `#!/bin/bash\nfor a in "$@"; do\n  if [ "$a" = ls-files ]; then exec sleep 60; fi\ndone\nexec "${real}" "$@"\n`);

      const started = Date.now();
      const { envelope } = start('startup', { env: { PATH: `${hang}:${process.env.PATH ?? '/usr/bin:/bin'}` } });

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.unknown });
      expect(Date.now() - started).toBeLessThan(30_000);
    }, 60_000);

    it('a git that fails only for the listing, with an old folder present: the unknown notice replaces the move notice', () => {
      write(main, `${LEGACY}/notes.txt`, 'kept\n');
      const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      const fail = path.join(base, 'fail');
      fs.mkdirSync(fail);
      writeFakeExecutable(path.join(fail, 'git'), `#!/bin/bash\nfor a in "$@"; do\n  if [ "$a" = ls-files ]; then exit 2; fi\ndone\nexec "${real}" "$@"\n`);

      const { envelope, raw } = start('startup', { env: { PATH: `${fail}:${process.env.PATH ?? '/usr/bin:/bin'}` } });

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.unknown });
      expect(raw).not.toContain(MOVE_SKIP_NOTICE.unknown);
    });
  });

  describe('a project with no .git entry', () => {
    it('runs as before, with no question to the area check', () => {
      const plain = path.join(base, 'plain');
      fs.mkdirSync(plain);

      const { raw } = start('startup', { cwd: plain });

      expect(raw).not.toContain('paused');
      expect(calls('node', 'tracked-area')).toEqual([]);
      expect(calls('git', 'ls-files')).toEqual([]);
    });
  });

  describe('a linked worktree', () => {
    function linkedWorktree(): string {
      const worktree = path.join(base, 'linked');
      git(main, ['worktree', 'add', '-q', '--detach', worktree]);
      return worktree;
    }

    it('the main checkout tracks curation, so a session in the worktree pauses curation', () => {
      seedLedger(main);
      trackLedger(main);
      const worktree = linkedWorktree();

      const { envelope } = start('startup', { cwd: worktree });

      expect(envelope).toEqual({ systemMessage: AREA_PAUSE_NOTICE.curation.tracked });
    });

    it('a worktree that tracks only its own memory leaves curation running at the main checkout', () => {
      seedLedger(main);
      const worktree = linkedWorktree();
      write(worktree, '.devflow/memory/WORKING-MEMORY.md', 'memory\n');
      git(worktree, ['add', '-f', '--', '.devflow/memory/WORKING-MEMORY.md']);

      const { context, message } = start('startup', { cwd: worktree });

      expect(context).toContain(`Index: ${path.join(main, CURATION, 'index.md')}`);
      expect(message).toBe('');
    });

    it('the worktree tracks curation files of its own while the main checkout does not: the ledger is the main checkout\'s, so curation runs', () => {
      seedLedger(main);
      const worktree = linkedWorktree();
      write(worktree, `${CURATION}/stray.txt`, 'stray\n');
      git(worktree, ['add', '-f', '--', `${CURATION}/stray.txt`]);

      const { context, message } = start('startup', { cwd: worktree });

      expect(context).toContain('--- PROJECT DECISIONS (TL;DR) ---');
      expect(message).toBe('');
    });
  });

  describe('the notice and the import audit share the systemMessage', () => {
    it('the pause notice leads, the audit finding follows, and neither enters the context', () => {
      seedLedger(main);
      trackLedger(main);
      write(home, '.claude/CLAUDE.md', '@~/big.md\n');
      fs.writeFileSync(path.join(home, 'big.md'), 'x'.repeat(10_001));

      const { message, context } = start('startup');

      const lines = message.split('\n');
      expect(lines[0]).toBe(AREA_PAUSE_NOTICE.curation.tracked);
      expect(lines.slice(1).join('\n')).toContain('CLAUDE.md import audit');
      expect(context).not.toContain('import audit');
    });
  });
});
