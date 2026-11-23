import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';
import { gitIsolatedEnv, isolatedEnv } from './setup/home-isolation.js';
import {
  answersVersion,
  HOOK_RUN_ALLOWANCE_MS,
  HOOKS_DIR,
  makeFifo,
  NODE_EXEC_STALL_MS,
  resolveOnPath,
  runGitForFarm,
  spawnWithStdin,
} from './shell-hooks-helpers.js';

const WORKER = path.join(HOOKS_DIR, 'background-memory-update');
const SESSION_START = path.join(HOOKS_DIR, 'session-start-memory');
const PRE_COMPACT = path.join(HOOKS_DIR, 'pre-compact-memory');
const CAP_LINE = 'Working memory not loaded: over the 8,192-byte cap; the next update rewrites it.';
const FARM_TOOLS = [
  'bash', 'cat', 'chmod', 'cksum', 'cp', 'cut', 'date', 'dirname', 'echo', 'find',
  'git', 'grep', 'head', 'kill', 'ln', 'ls', 'mkdir', 'mkfifo', 'mktemp', 'mv', 'nohup', 'od',
  'printf', 'rm', 'rmdir', 'sed', 'sleep', 'stat', 'tail', 'touch', 'tr', 'wc',
] as const;
const writeFakeExecutable = useWarmFakeExecutables();
const INTERLEAVE_LOG = 'Queue rows interleave across sessions';
const NOTE_CAP = 8192;
const PLACEHOLDER = '<!-- memory-head: (set by devflow) -->';
const BODY = '## Now\nTest note\n## Progress\n';
const OLD_NOTE = '## Now\nPrior note\n## Progress\n';
const QUEUE = '.pending-turns.jsonl';
const QUEUE_LOCK = `${QUEUE}.lock`;
const BATCH = '.pending-turns.processing';
const SWAP = '.WORKING-MEMORY.md.swap';
const ONCE = '.worker-note-once';
const NOTICE = '.worker-notice-note';
const MARKER = '0123456789abcdef';

function nodeOnlyPath(binDir: string): string {
  for (const tool of FARM_TOOLS) {
    const git = tool === 'git' ? runGitForFarm() : undefined;
    const target = git ?? resolveOnPath(tool, '/usr/bin:/bin');
    if (target !== undefined) fs.symlinkSync(target, path.join(binDir, tool));
  }
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  return binDir;
}

function row(role: 'user' | 'assistant' | 'qa', content: string, session_id?: unknown): string {
  return JSON.stringify({ role, content, ts: 1, session_id });
}

const A = 'test-session_1';
const B = 'test-session_10';
const ONE_SESSION = [row('assistant', 'Reply', A)];

describe.each(['jq', 'node'] as const)('worker note with %s', (backend) => {
  let root: string;
  let project: string;
  let home: string;
  let bin: string;
  let memoryDir: string;
  let note: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-note-')));
    ({ project, home, bin } = makeFolders(root));
    memoryDir = path.join(project, '.devflow', 'memory');
    note = path.join(memoryDir, 'WORKING-MEMORY.md');
    fs.mkdirSync(memoryDir, { recursive: true });
    env = gitIsolatedEnv(isolatedEnv(process.env, home));
    git('init', '-q', '-b', 'note-test');
    const tools = path.join(root, 'tools');
    fs.mkdirSync(tools);
    const PATH = `${bin}:${backend === 'node' ? nodeOnlyPath(tools) : env.PATH ?? '/usr/bin:/bin'}`;
    env = { ...env, PATH };
    writeClaudeStub();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function git(...args: string[]): string {
    return execFileSync('git', ['-C', project, ...args], { env, encoding: 'utf8' }).trim();
  }

  function writeClaudeStub(text = `${PLACEHOLDER}\n${BODY}`, afterWrite = ''): void {
    fs.writeFileSync(path.join(root, 'model-note'), text);
    writeFakeExecutable(path.join(bin, 'claude'), answersVersion(`#!/bin/bash
cat > "$TEST_PROMPT" || exit 1
cp "$TEST_ROOT/model-note" "$TEST_MEMORY/WORKING-MEMORY.md.new" || exit 1
${afterWrite}
`));
  }

  function runWorker(rows?: readonly string[]): { prompt: string; log: string } {
    const promptFile = path.join(root, 'prompt');
    const { PATH } = env;
    expect(resolveOnPath('claude', PATH)).toBe(path.join(bin, 'claude'));
    if (backend === 'jq') expect(resolveOnPath('jq', PATH)).toBeDefined();
    else expect(resolveOnPath('jq', PATH)).toBeUndefined();
    if (rows) fs.writeFileSync(path.join(memoryDir, QUEUE), rows.join('\n') + '\n');
    fs.rmSync(promptFile, { force: true });

    execFileSync('/bin/bash', [WORKER, project], {
      env: { ...env, TEST_PROMPT: promptFile, TEST_MEMORY: memoryDir, TEST_ROOT: root },
      stdio: 'ignore',
    });

    const log = fs.readFileSync(path.join(home, '.devflow', 'logs', project.slice(1).replaceAll('/', '-'), '.background-memory-update.log'), 'utf8');
    return { log, prompt: fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '' };
  }

  function runQueue(rows: readonly string[]): { turns: string[]; prompt: string; log: string } {
    const { prompt, log } = runWorker(rows);
    expect(prompt, log).not.toBe('');
    const turns = [...prompt.matchAll(/^Turn \d+:\n([^\n]+(?:\nAssistant:[^\n]*)?)/gm)].map((match) => match[1] ?? '');
    return { turns, prompt, log };
  }

  const budget = HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS;

  it('keeps a queue that a trim holds, then claims it once after the trim', () => {
    const queue = path.join(memoryDir, QUEUE);
    const lock = path.join(memoryDir, QUEUE_LOCK);
    const trimCopy = `${queue}.tmp`;
    const rows = Array.from({ length: 201 }, (_, index) => row('assistant', `Reply ${index}`, A));
    const original = rows.join('\n') + '\n';
    // Pause the trim after it prepares the copy and before it replaces the queue.
    fs.mkdirSync(lock);
    fs.writeFileSync(trimCopy, rows.slice(-100).join('\n') + '\n', { mode: 0o600 });
    const { prompt, log } = runWorker(rows);
    expect(prompt).toBe('');
    expect(log.match(/SKIP: queue lock unavailable/g)).toHaveLength(1);
    expect(log.match(/Run: .*/g)).toEqual([expect.stringContaining('argv=none result=skip')]);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    expect(fs.existsSync(queue)).toBe(true);
    expect(fs.readFileSync(queue, 'utf8')).toBe(original);

    fs.renameSync(trimCopy, queue);
    fs.rmdirSync(lock);
    expect(runWorker().prompt).toContain('Assistant: Reply 200');
    expect(fs.existsSync(queue)).toBe(false);
    expect(fs.existsSync(lock)).toBe(false);
  }, budget);

  it('releases the queue lock when the claim move fails', () => {
    writeFakeExecutable(path.join(bin, 'mv'), `#!/bin/bash
if [ "$1" = "$TEST_MEMORY/${QUEUE}" ] && [ -d "$TEST_MEMORY/${QUEUE_LOCK}" ]; then exit 1; fi
exec /bin/mv "$@"
`);
    const { prompt, log } = runWorker(ONE_SESSION);
    expect(prompt).toBe('');
    expect(log).toContain('SKIP: failed to claim queue');
    expect(fs.existsSync(path.join(memoryDir, QUEUE))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, QUEUE_LOCK))).toBe(false);
  }, budget);

  it('holds the queue lock for the merge and releases it before the batch trim', () => {
    const rows = Array.from({ length: 200 }, (_, index) => row('assistant', `Prior reply ${index}`, A));
    fs.writeFileSync(path.join(memoryDir, BATCH), rows.join('\n') + '\n', { mode: 0o600 });
    writeFakeExecutable(path.join(bin, 'cat'), `#!/bin/bash
if [ "$1" = "$TEST_MEMORY/${QUEUE}" ] && [ ! -d "$TEST_MEMORY/${QUEUE_LOCK}" ]; then exit 1; fi
exec /bin/cat "$@"
`);
    writeFakeExecutable(path.join(bin, 'tail'), `#!/bin/bash
if [ "$1" = -100 ] && [ -d "$TEST_MEMORY/${QUEUE_LOCK}" ]; then exit 1; fi
exec /usr/bin/tail "$@"
`);
    const { prompt, log } = runWorker(ONE_SESSION);
    expect(log).toContain('Processing overflow: truncated from 201 to 100 lines');
    expect(prompt).toMatch(/^Assistant: Reply$/m);
    expect(fs.existsSync(path.join(memoryDir, QUEUE))).toBe(false);
  }, budget);

  it('leaves the queue in place when the lock path is a symbolic link', () => {
    const target = path.join(root, 'lock-target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(memoryDir, QUEUE_LOCK));
    const { prompt, log } = runWorker(ONE_SESSION);
    expect(prompt).toBe('');
    expect(log).toContain('a symbolic link sits on the path to the memory files');
    expect(fs.existsSync(path.join(memoryDir, QUEUE))).toBe(true);
  }, budget);

  it('pairs only matching sessions and keeps the current prompt across a different reply and a question', () => {
    const { turns, prompt, log } = runQueue([
      row('user', 'First prompt', A),
      row('user', 'Second prompt', B),
      row('assistant', 'First reply', A),
      row('qa', 'Q: Pick a color\nA: Blue', B),
      row('assistant', 'Second reply', B),
    ]);

    expect(turns).toEqual([
      'User: First prompt',
      'Assistant: First reply',
      'Q&A: Q: Pick a color A: Blue',
      'User: Second prompt\nAssistant: Second reply',
    ]);
    expect(log).toContain(INTERLEAVE_LOG);
    for (const id of [A, B]) {
      expect(prompt).not.toContain(id);
      expect(log).not.toContain(id);
    }
  }, budget);

  it('marks an interleave across the turn window but sends only the newest 20 rows', () => {
    const rows = [row('user', 'Outside window', A), row('assistant', 'Outside window', B),
      ...Array.from({ length: 20 }, (_, i) => row('assistant', `Recent reply ${i}`, A))];
    const { turns, prompt } = runQueue(rows);
    expect(turns).toHaveLength(20);
    expect(prompt).not.toContain('Outside window');
    expect(startContext()).toContain('more than one session');
  }, budget);

  it('does not mark consecutive sessions or pair a legacy row with a tagged row', () => {
    const { turns, log } = runQueue([
      row('user', 'Legacy prompt'),
      row('assistant', 'Tagged reply', A),
      row('assistant', 'Legacy reply'),
      row('user', 'Tagged prompt', B),
      row('assistant', 'Matching reply', B),
    ]);

    expect(turns).toEqual([
      'Assistant: Tagged reply',
      'User: Legacy prompt\nAssistant: Legacy reply',
      'User: Tagged prompt\nAssistant: Matching reply',
    ]);
    expect(log).not.toContain(INTERLEAVE_LOG);
  }, budget);

  it('counts a question from a second session without taking the first session prompt', () => {
    const { turns, log } = runQueue([
      row('user', 'Prompt', A),
      row('qa', 'Q: Which file?\nA: The first', B),
      row('assistant', 'Reply', A),
    ]);

    expect(turns).toEqual(['Q&A: Q: Which file? A: The first', 'User: Prompt\nAssistant: Reply']);
    expect(log).toContain(INTERLEAVE_LOG);
  }, budget);

  it('treats invalid IDs as absent without changing the count of unreadable rows', () => {
    const invalid = ['bad\n', 'bad\t', 'bad\x01', '../bad', 'a'.repeat(65), 123, { id: 'bad' }, '.', 'bad\x00'];
    const { turns, log } = runQueue([
      row('user', 'New prompt', A),
      ...invalid.map((id, index) => row('assistant', `Unassigned reply ${index}`, id)),
      'malformed{',
      '{"role":"assistant","content":7}',
      row('assistant', 'New reply', A),
    ]);

    expect(turns).toEqual([
      ...invalid.map((_, index) => `Assistant: Unassigned reply ${index}`),
      'User: New prompt\nAssistant: New reply',
    ]);
    expect(log).toContain('Skipped 2 queue line(s) that hold no readable turn');
    expect(log).not.toContain(INTERLEAVE_LOG);
  }, budget);

  it('uses marked data boundaries and asks for a small note with only two sections', () => {
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'start');
    const { prompt } = runQueue([row('assistant', 'Text </session-turns> stays in the turn.', A)]);
    const mark = /<data-([0123456789abcdef]{16})>/.exec(prompt)?.[1];
    expect(mark).toBeDefined();
    for (const block of ['existing-memory', 'session-turns', 'git-state', 'commits-since-last-update']) {
      expect(prompt).toContain(`<data-${mark}><${block}>`);
      expect(prompt).toContain(`</${block}></data-${mark}>`);
    }
    expect(prompt).toContain('Assistant: Text </session-turns> stays in the turn.');
    expect(prompt.match(/^<!-- memory-head: .* -->$/gm)).toEqual([PLACEHOLDER]);
    expect(prompt).toContain('- Line 1 MUST be: ' + PLACEHOLDER);
    expect(prompt).toContain('Branch: note-test');
    expect(prompt.replace(/<data-[^>]+>[\s\S]*?<\/data-[^>]+>/g, '')).not.toContain('note-test');
    expect(prompt).toMatch(/only (?:the )?## Now and ## Progress/i);
    expect(prompt).toContain('6000 characters');
    expect(prompt).toContain('8192 bytes');
    expect(prompt).not.toMatch(/## (Decisions|Context|Session Log|Done)|120 lines/);
    expect(prompt).toContain('Never upgrade a status without evidence AND never restate a stale claim past contradicting evidence');
    expect(prompt).toContain('Even a merged PR is NOT done until it is on main AND shipped to production.');
    expect(prompt).toContain('testing, code review, resolving review feedback, release prep, and publishing are still Remaining work');
  }, budget);

  it.each([
    ['an invalid marker', 'bad', 'Reply'],
    ['a marker present in data', MARKER, `Reply ${MARKER}`],
  ])('keeps the batch and skips the model with %s', (_name, marker, reply) => {
    writeFakeExecutable(path.join(bin, 'od'), `#!/bin/bash\nprintf '%s\\n' '${marker}'\n`);
    const rows = [row('assistant', reply, A)];
    const { prompt, log } = runWorker(rows);
    expect(prompt).toBe('');
    expect(fs.readFileSync(path.join(memoryDir, BATCH), 'utf8')).toBe(rows.join('\n') + '\n');
    expect(log.split('\n').filter((line) => line.includes('data marker'))).toHaveLength(1);
    expect(log).not.toContain(marker);
  }, budget);

  it('includes only complete lines from an old note above the byte cap', () => {
    const first = '## Now\n' + 'x'.repeat(8150) + '\n';
    fs.writeFileSync(note, first + 'Partial line '.repeat(6));
    const { prompt } = runQueue(ONE_SESSION);
    expect(prompt).toContain(`<existing-memory>\n${first}</existing-memory>`);
    expect(prompt).not.toContain('Partial line');
    expect(fs.readFileSync(note, 'utf8')).toContain(BODY);
  }, budget);

  it.each([
    ['8193 ASCII bytes', `${PLACEHOLDER}\n${BODY}${'x'.repeat(NOTE_CAP - PLACEHOLDER.length - BODY.length)}`],
    ['multibyte text above the cap', `${PLACEHOLDER}\n${BODY}${'é'.repeat(4100)}`],
    ['text that exceeds the cap only after the new stamp', `<!-- memory-head:\n${'x'.repeat(NOTE_CAP - 18)}`],
    ['an extra level-two heading', `${PLACEHOLDER}\n${BODY}## Extra\n`],
  ])('keeps the old note when the model writes %s', (_name, staged) => {
    fs.writeFileSync(note, OLD_NOTE);
    writeClaudeStub(staged);
    const { log } = runWorker(ONE_SESSION);
    expect(fs.readFileSync(note, 'utf8')).toBe(OLD_NOTE);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, 'WORKING-MEMORY.md.new'))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, SWAP))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, ONCE))).toBe(true);
    expect(log).not.toMatch(/## Extra|Test note|memory-head:/);
  }, budget);

  it('writes its own stamp, allows deeper headings, and accepts exactly 8192 bytes', () => {
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'start');
    const stamp = `<!-- memory-head: ${git('rev-parse', 'HEAD')} branch: note-test -->\n`;
    const body = `${BODY}### Detail\n`;
    const exactBody = body + 'x'.repeat(NOTE_CAP - stamp.length - body.length);
    writeClaudeStub(`<!-- memory-head: fake branch: other -->\n${exactBody}`);
    runQueue(ONE_SESSION);
    expect(fs.readFileSync(note, 'utf8')).toBe(stamp + exactBody);
    expect(fs.statSync(note).mode & 0o777).toBe(0o600);
  }, budget);

  it('swaps a valid note when the model also reports a denial', () => {
    fs.writeFileSync(note, OLD_NOTE);
    writeClaudeStub(`${PLACEHOLDER}\n${BODY}`, 'printf \'%s\\n\' \'{"permission_denials":[{}]}\'');
    const { log } = runWorker(ONE_SESSION);
    expect(fs.readFileSync(note, 'utf8')).toContain(BODY);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, '.worker-denied-once'))).toBe(false);
    expect(log).toMatch(/Run:.* result=updated denials=1 /);
  }, budget);

  it('drops only the twice-refused batch and keeps the note notice', () => {
    fs.writeFileSync(note, OLD_NOTE);
    writeClaudeStub('No stamp\n');
    runWorker(ONE_SESSION);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, ONCE))).toBe(true);
    const { log } = runWorker();
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, ONCE))).toBe(false);
    expect(fs.readFileSync(path.join(memoryDir, NOTICE), 'utf8')).toBe('note\n');
    expect(log.split('\n').filter((line) => line.includes('discarded after two note refusals'))).toHaveLength(1);
    expect(fs.readFileSync(note, 'utf8')).toBe(OLD_NOTE);
    writeClaudeStub();
    runWorker(ONE_SESSION);
    expect(fs.existsSync(path.join(memoryDir, NOTICE))).toBe(false);
  }, budget);

  it.each([
    ['a conflict', 'printf human > "$TEST_MEMORY/WORKING-MEMORY.md"', 'conflict'],
    ['a denial', 'printf \'%s\\n\' \'{"permission_denials":[{}]}\'', 'failed'],
    ['a non-zero exit', 'exit 1', 'failed'],
    ['a watchdog exit', 'exit 143', 'failed'],
  ])('does not drop a previously refused batch after %s', (_name, afterWrite, result) => {
    writeClaudeStub('No stamp\n');
    runWorker(ONE_SESSION);
    writeClaudeStub(result === 'conflict' ? `${PLACEHOLDER}\n${BODY}` : 'No stamp\n', afterWrite);
    const { log } = runWorker();
    expect(log.match(/Run:.* result=\S+/g)?.at(-1)).toMatch(new RegExp(`result=${result}$`));
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, NOTICE))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, ONCE))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, SWAP))).toBe(false);
    writeClaudeStub();
    runWorker();
    expect(fs.existsSync(path.join(memoryDir, ONCE))).toBe(false);
  }, budget);

  it.each([
    ['link', `ln -s "$TEST_ROOT/missing" "$TEST_MEMORY/${SWAP}"`],
    ['FIFO', `mkfifo "$TEST_MEMORY/${SWAP}"`],
    ['folder', `mkdir "$TEST_MEMORY/${SWAP}"`],
  ])('refuses a %s at the swap path after the model run', (_kind, afterWrite) => {
    fs.writeFileSync(note, OLD_NOTE);
    writeClaudeStub(`${PLACEHOLDER}\n${BODY}`, afterWrite);
    const { log } = runWorker(ONE_SESSION);
    expect(fs.readFileSync(note, 'utf8')).toBe(OLD_NOTE);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, ONCE))).toBe(false);
    expect(log).toMatch(/Run:.* result=failed/);
  }, budget);

  it('keeps a FIFO at the note path without a swap', () => {
    makeFifo(note);
    const { log } = runWorker(ONE_SESSION);
    expect(fs.lstatSync(note).isFIFO()).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, BATCH))).toBe(true);
    expect(log).toMatch(/Run:.* result=conflict/);
  }, budget);

  function runMemoryHook(hook: string): string {
    const run = spawnWithStdin('/bin/bash', [hook], {
      env, input: JSON.stringify({ cwd: project, source: 'compact' }),
    });
    expect(run.kind, run.stderr).toBe('clean');
    return run.stdout;
  }

  function startContext(): string {
    const output: unknown = JSON.parse(runMemoryHook(SESSION_START) || '{}');
    if (output === null || typeof output !== 'object' || !('hookSpecificOutput' in output)) return '';
    const { hookSpecificOutput: context } = output;
    if (context === null || typeof context !== 'object' || !('additionalContext' in context)) return '';
    return typeof context.additionalContext === 'string' ? context.additionalContext : '';
  }

  function startLog(): string {
    return fs.readFileSync(path.join(home, '.devflow', 'logs', project.slice(1).replaceAll('/', '-'), '.session-start-memory.log'), 'utf8');
  }

  it.each([
    ['a 9 KiB note', `unloaded ${'x'.repeat(9207)}`],
    ['multibyte text', `unloaded ${'é'.repeat(4093)}`],
    ['trailing newlines', `unloaded ${'x'.repeat(8181)}\n\n\n`],
  ])('does not load %s above the byte cap but keeps the refresh banner', (_name, text) => {
    fs.writeFileSync(note, text);
    fs.writeFileSync(path.join(memoryDir, QUEUE), `${ONE_SESSION[0]}\n`);

    const context = startContext();
    expect(context).toContain(CAP_LINE);
    expect(context).toContain('MEMORY REFRESH MAY BE FAILING');
    expect(context).not.toContain('unloaded');
    expect(startLog().match(/Working memory not loaded \(bytes=8193\)/g)).toHaveLength(1);
    expect(fs.readFileSync(note, 'utf8')).toBe(text);
  }, budget);

  it('loads all the text of a note exactly at the byte cap', () => {
    const stamp = `<!-- memory-head: ${'a'.repeat(40)} branch: note-test -->\n`;
    const prefix = BODY + 'é'.repeat(4000);
    const body = prefix + 'x'.repeat(NOTE_CAP - Buffer.byteLength(stamp + prefix) - 2) + '\n\n';
    expect(Buffer.byteLength(stamp + body)).toBe(NOTE_CAP);
    fs.writeFileSync(note, stamp + body);

    const context = startContext();
    expect(context.slice(context.indexOf('\n') + 1)).toBe(body);
  }, budget);

  it('does not load a partial read that failed', () => {
    fs.writeFileSync(note, BODY);
    writeFakeExecutable(path.join(bin, 'head'), `#!/bin/bash
if [ "\${3##*/}" = WORKING-MEMORY.md ]; then printf 'partial note'; exit 1; fi
exec /usr/bin/head "$@"
`);
    fs.writeFileSync(path.join(memoryDir, QUEUE), `${ONE_SESSION[0]}\n`);

    const context = startContext();
    expect(context).toContain(CAP_LINE);
    expect(context).toContain('MEMORY REFRESH MAY BE FAILING');
    expect(context).not.toContain('partial note');
    expect(startLog().match(/Working memory not loaded \(bytes=unknown\)/g)).toHaveLength(1);
  }, budget);

  it('does not open a FIFO at the note path on session start', () => {
    makeFifo(note);
    writeFakeExecutable(path.join(bin, 'head'), `#!/bin/bash
if [ "\${3##*/}" = WORKING-MEMORY.md ]; then touch "$HOME/note-read"; exit 1; fi
exec /usr/bin/head "$@"
`);

    expect(startContext()).toBe('');
    expect(fs.existsSync(path.join(home, 'note-read'))).toBe(false);
  }, budget);

  it('does not load a note with a null byte', () => {
    fs.writeFileSync(note, `${BODY}\0unloaded`);

    const context = startContext();
    expect(context).toContain(CAP_LINE);
    expect(context).not.toContain('unloaded');
  }, budget);

  it.each([
    ['a non-digit mark', 'note-test multi: invalid-mark'],
    ['extra stamp text', 'note-test extra-stamp-text'],
    ['a branch above the stamp limit', 'b'.repeat(201)],
  ])('does not show header advice or stamp text for %s', (_name, branchAndMark) => {
    fs.writeFileSync(note, `<!-- memory-head: ${'a'.repeat(40)} branch: ${branchAndMark} -->\n${BODY}`);

    const context = startContext();
    expect(context).toContain('Test note');
    expect(context).not.toContain('more than one session');
    expect(context).not.toContain(branchAndMark);
  }, budget);

  it('shows an unknown branch rather than a detached HEAD when the branch does not fit the stamp', () => {
    git('checkout', '-qb', 'b'.repeat(201));
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'start');
    fs.writeFileSync(note, BODY);

    expect(startContext().split('\n')[0]).toContain('on unknown');
  }, budget);

  it('bootstraps only a stamp and fixed text even with a long commit subject and branch', () => {
    const branch = `branch-${'a'.repeat(180)}`;
    git('checkout', '-qb', branch);
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'c'.repeat(20_000));
    fs.writeFileSync(path.join(project, 'file-not-in-note'), '');
    env = { ...env, BASH_ENV: path.join(root, 'umask') };
    fs.writeFileSync(path.join(root, 'umask'), 'umask 022\n');

    runMemoryHook(PRE_COMPACT);

    expect(fs.readFileSync(note, 'utf8')).toBe(
      `<!-- memory-head: ${git('rev-parse', 'HEAD')} branch: ${branch} -->\n\n` +
      '## Now\n- Session compacted before working memory was established\n\n## Progress\n- (no history yet)\n',
    );
    expect(fs.statSync(note).mode & 0o777).toBe(0o600);
    const backup = fs.readFileSync(path.join(memoryDir, 'backup.json'), 'utf8');
    expect(backup).toContain('c'.repeat(20_000));
    expect(backup).toContain('file-not-in-note');
  }, budget);

  it('keeps the original multi-session mark until its four-hour limit', () => {
    const epoch = 1_800_000_000;
    writeFakeExecutable(path.join(bin, 'date'), `#!/bin/bash
if [ "$1" = +%s ]; then echo "$TEST_EPOCH"; else exec /bin/date "$@"; fi
`);
    env = { ...env, TEST_EPOCH: String(epoch) };
    runQueue([row('user', 'Prompt', A), row('assistant', 'Other reply', B), row('assistant', 'Reply', A)]);
    expect(fs.readFileSync(note, 'utf8').split('\n')[0]).toContain(` multi: ${epoch} -->`);
    // A valid branch of fewer than 200 characters can make a stamp exceed 512 bytes.
    const branch = `${'界'.repeat(80)}/${'界'.repeat(80)}`;
    fs.writeFileSync(note, `<!-- memory-head: ${'a'.repeat(40)} branch: ${branch} multi: ${epoch} -->\n${BODY}`);
    env = { ...env, TEST_EPOCH: String(epoch + 14_399) };
    runQueue(ONE_SESSION);
    expect(fs.readFileSync(note, 'utf8').split('\n')[0]).toContain(` multi: ${epoch} -->`);
    const context = startContext();
    expect(context.split('\n')[0]).toContain('more than one session');
    expect(context).toContain('Confirm the task with the user. Use one worktree for each parallel session.');
    expect(context).not.toContain(String(epoch));
    expect(context).not.toContain(A);
    expect(context).not.toContain(B);
    env = { ...env, TEST_EPOCH: String(epoch + 14_400) };
    expect(startContext()).not.toContain('more than one session');
    runQueue(ONE_SESSION);
    expect(fs.readFileSync(note, 'utf8').split('\n')[0]).not.toContain(' multi: ');
  }, budget);
});

function makeFolders(root: string): { project: string; home: string; bin: string } {
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  for (const dir of [project, home, bin]) fs.mkdirSync(dir);
  return { project, home, bin };
}
