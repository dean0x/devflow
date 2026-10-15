/**
 * The stdin-EPIPE race in the hook harness, pinned deterministically.
 *
 * A hook guard (DEVFLOW_BG_UPDATER=1, for one) may exit 0 before it reads stdin.
 * When that exit beats Node's write of `input`, the write fails with EPIPE and
 * `execSync` throws — although the child did exactly what the test asserts. On
 * a JSON event of a few hundred bytes that is a timing race (release CI run
 * 36301721937). Here the input is 8 MiB: far past any pipe buffer, so a child
 * that never reads stdin ALWAYS leaves the parent's write to fail with EPIPE,
 * and every case below is decided by the rule, never by scheduling.
 *
 * The file also holds the memory-permission helper's tests (the last describe blocks):
 * the CI job that runs the hooks under bash 3.2 runs this file.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FIFO_RUN_BOUND_MS,
  HOOKS_DIR,
  classifyStdinRun,
  execHook,
  makeFifo,
  releaseFifo,
  runHook,
  spawnWithStdin,
} from './shell-hooks-helpers.js';

/** Several MiB: larger than any pipe buffer, so an unread write cannot complete. */
const BIG = 'x'.repeat(8 * 1024 * 1024);

let dir: string;
/** Exits 0 without reading stdin, after writing to both streams. */
let exitsCleanEarly: string;
/** Exits 3 without reading stdin: a genuinely failing child. */
let failsEarly: string;
/** Reads all of stdin, then reports how many bytes arrived. */
let readsAll: string;

function script(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-stdin-epipe-'));
  exitsCleanEarly = script('exits-clean-early', 'echo early-out\necho early-err >&2\nexit 0');
  failsEarly = script('fails-early', 'echo fail-out\necho fail-err >&2\nexit 3');
  readsAll = script('reads-all', 'wc -c | tr -d " "');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the race the helper exists for', () => {
  it('execSync throws EPIPE although the child exited 0 (the old pattern)', () => {
    let thrown: unknown;
    try {
      execSync(`bash "${exitsCleanEarly}"`, { input: BIG, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { code?: string; status?: number | null; signal?: string | null };
    expect(err, 'execSync must throw on the unread 8 MiB write').toBeDefined();
    expect(err.code).toBe('EPIPE');
    // The child itself succeeded: the throw is about the stdin write alone.
    expect(err.status).toBe(0);
    expect(err.signal).toBeNull();
  });
});

describe('spawnWithStdin', () => {
  it('reports a clean exit, with both streams, when the child exits 0 before reading stdin', () => {
    const run = spawnWithStdin('bash', [exitsCleanEarly], { input: BIG });
    expect(run).toEqual({
      kind: 'clean',
      stdout: 'early-out\n',
      stderr: 'early-err\n',
      status: 0,
      signal: null,
      stdinEpipe: true,
    });
  });

  it('reports a non-zero exit as a failure, even when that child also left stdin unread', () => {
    const run = spawnWithStdin('bash', [failsEarly], { input: BIG });
    expect(run).toEqual({
      kind: 'failed',
      stdout: 'fail-out\n',
      stderr: 'fail-err\n',
      status: 3,
      signal: null,
      stdinEpipe: true,
    });
  });

  it('delivers the whole input to a child that reads it (no EPIPE on the normal path)', () => {
    const run = spawnWithStdin('bash', [readsAll], { input: BIG });
    expect(run.kind).toBe('clean');
    expect(run.stdinEpipe).toBe(false);
    expect(run.stdout.trim()).toBe(String(BIG.length));
  });

  it('throws a harness failure that is not the child exiting: a missing executable', () => {
    expect(() => spawnWithStdin(path.join(dir, 'no-such-binary'), [], { input: 'x' })).toThrow(/ENOENT/);
  });

  it('throws a harness failure that is not the child exiting: a timeout', () => {
    expect(() => spawnWithStdin('bash', ['-c', 'sleep 5'], { input: 'x', timeout: 100 })).toThrow(/ETIMEDOUT/);
  });
});

describe('execHook — execSync semantics minus the race', () => {
  it('returns stdout when the hook exits 0 before reading stdin', () => {
    expect(execHook(exitsCleanEarly, BIG)).toBe('early-out\n');
  });

  it('throws, naming the exit status and stderr, when the hook exits non-zero', () => {
    expect(() => execHook(failsEarly, BIG)).toThrow(/status 3[\s\S]*fail-err/);
  });
});

describe('runHook — exit code as a value, unchanged by the race', () => {
  const bigEvent = { payload: BIG };

  it('reports exit 0 and stdout when the hook exits 0 before reading stdin', () => {
    expect(runHook(exitsCleanEarly, bigEvent, dir)).toEqual({ stdout: 'early-out\n', stderr: '', exitCode: 0 });
  });

  it('reports the real non-zero exit, with stdout and stderr, when the hook fails before reading stdin', () => {
    expect(runHook(failsEarly, bigEvent, dir)).toEqual({ stdout: 'fail-out\n', stderr: 'fail-err\n', exitCode: 3 });
  });
});

describe('classifyStdinRun — the rule, on every shape', () => {
  const epipe = Object.assign(new Error('spawnSync bash EPIPE'), { code: 'EPIPE' });
  const base = { stdout: 'o', stderr: 'e' };

  it('EPIPE with status 0 and no signal is benign: clean', () => {
    expect(classifyStdinRun({ ...base, error: epipe, status: 0, signal: null }).kind).toBe('clean');
  });

  it('EPIPE with a non-zero status is a failure', () => {
    expect(classifyStdinRun({ ...base, error: epipe, status: 1, signal: null }).kind).toBe('failed');
  });

  it('EPIPE with a signal is a failure, even though no status was recorded', () => {
    expect(classifyStdinRun({ ...base, error: epipe, status: null, signal: 'SIGTERM' }).kind).toBe('failed');
  });

  it('a signal without any spawn error is a failure', () => {
    expect(classifyStdinRun({ ...base, status: null, signal: 'SIGKILL' }).kind).toBe('failed');
  });

  it('any other spawn error is a harness error, whatever the status', () => {
    const enoent = Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' });
    const verdict = classifyStdinRun({ ...base, error: enoent, status: 0, signal: null });
    expect(verdict).toEqual({ kind: 'harness-error', error: enoent });
  });

  it('no error, status 0, no signal: clean, and no EPIPE recorded', () => {
    expect(classifyStdinRun({ ...base, status: 0, signal: null })).toEqual({
      kind: 'clean', stdout: 'o', stderr: 'e', status: 0, signal: null, stdinEpipe: false,
    });
  });
});

// =============================================================================
// memory-permission — the worker's write is limited to its staged file
//
// background-memory-update and session-start-memory share one sourced helper for the
// staged-path check, the settings JSON that carries the Edit rule, the fixed result
// line and the one-time notice. The macos-bash32-hooks CI job runs this file but not
// tests/eager-memory-refresh.test.ts, so the pattern work is pinned here, under the
// bash that job puts first on PATH. Every run sources the helpers the way the hooks do
// and runs under `set -e`, so a helper that ends in a failing status aborts the run.
// =============================================================================

const PERMISSION_HELPER = path.join(HOOKS_DIR, 'memory-permission');

/** What one bash run printed; the body sees the helpers sourced and `$1...` as `args`. */
function inHook(body: string, args: string[] = [], env: Record<string, string> = {}) {
  const run = spawnSync('bash', [
    '-e', '-c',
    'source "$1"; source "$2"; source "$3"; shift 3\n' + body,
    '_',
    path.join(HOOKS_DIR, 'resolve-project-root'),
    path.join(HOOKS_DIR, 'json-parse'),
    PERMISSION_HELPER,
    ...args,
  ], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe('memory-permission: staged_path_safe', () => {
  const safe = (...paths: string[]): string[] =>
    inHook(
      'for p in "$@"; do if staged_path_safe "$p"; then echo "ok:$STAGED_PATH_REFUSAL"; else echo "refused:$STAGED_PATH_REFUSAL"; fi; done',
      paths,
    ).stdout.trim().split('\n');

  const REFUSED_CHARS: ReadonlyArray<readonly [string, string]> = [
    ['an empty path', ''],
    ['a relative path', 'rel/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a leading double slash', '//p/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a double slash inside', '/p//.devflow/memory/WORKING-MEMORY.md.new'],
    ['a dot segment', '/p/./.devflow/memory/WORKING-MEMORY.md.new'],
    ['a dot-dot segment', '/p/../.devflow/memory/WORKING-MEMORY.md.new'],
    ['a trailing dot segment', '/p/x/.'],
    ['a trailing dot-dot segment', '/p/x/..'],
    ['an asterisk', '/p/a*b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a question mark', '/p/a?b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['an opening bracket', '/p/a[b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a closing bracket', '/p/a]b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a backslash', '/p/a\\b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['an opening parenthesis', '/p/a(b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a closing parenthesis', '/p/a)b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a double quote', '/p/a"b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['an opening brace', '/p/a{b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a closing brace', '/p/a}b/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a newline', '/p/a\nb/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a tab', '/p/a\tb/.devflow/memory/WORKING-MEMORY.md.new'],
    ['a DEL character', '/p/a\x7fb/.devflow/memory/WORKING-MEMORY.md.new'],
  ];

  it.each(REFUSED_CHARS)('refuses a path with %s, with the chars reason', (_label, p) => {
    expect(safe(p)).toEqual(['refused:chars']);
  });

  it('refuses a project inside a .claude or .git folder, with the protected reason', () => {
    expect(safe(
      '/p/.claude/worktrees/w/.devflow/memory/WORKING-MEMORY.md.new',
      '/p/.git/modules/m/.devflow/memory/WORKING-MEMORY.md.new',
    )).toEqual(['refused:protected', 'refused:protected']);
  });

  it('accepts a normal path and the characters that stay inert in the rule and its JSON', () => {
    const accepted = [
      '/Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/proj with space/.devflow/memory/WORKING-MEMORY.md.new',
      "/Users/dev/it's/.devflow/memory/WORKING-MEMORY.md.new",
      '/Users/dev/a,b/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/$HOME/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/`x`/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/100%/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/a@b+c=d~e#f!g/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/café/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/.github/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/.claudex/my.git/.devflow/memory/WORKING-MEMORY.md.new',
    ];
    expect(safe(...accepted)).toEqual(accepted.map(() => 'ok:'));
  });
});

describe('memory-permission: memory_settings_json', () => {
  const build = (p: string) => inHook('memory_settings_json "$1"', [p]);

  it('builds the exact JSON: one Edit allow rule on the absolute staged path, a deny below it, no hooks', () => {
    const staged = '/Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new';
    const run = build(staged);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      '{"permissions":{"allow":["Edit(//Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new)"],'
      + '"deny":["Edit(//Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new/**)"]},"disableAllHooks":true}',
    );
  });

  it('stays valid JSON, and the rule path round-trips byte for byte, for every inert character', () => {
    for (const staged of [
      '/Users/dev/proj with space/.devflow/memory/WORKING-MEMORY.md.new',
      "/Users/dev/it's $HOME `x` 100% a,b/.devflow/memory/WORKING-MEMORY.md.new",
      '/Users/dev/café/.devflow/memory/WORKING-MEMORY.md.new',
    ]) {
      const parsed = JSON.parse(build(staged).stdout) as {
        permissions: { allow: string[]; deny: string[] }; disableAllHooks: boolean;
      };
      expect(parsed.permissions.allow, staged).toEqual([`Edit(/${staged})`]);
      expect(parsed.permissions.deny, staged).toEqual([`Edit(/${staged}/**)`]);
      expect(parsed.disableAllHooks).toBe(true);
    }
  });

  it('prints nothing and fails for a path the check refuses, so no rule is built for it', () => {
    const run = build('/Users/dev/pr*oj/.devflow/memory/WORKING-MEMORY.md.new');

    expect(run.stdout).toBe('');
    expect(run.status).not.toBe(0);
  });
});

describe('memory-permission: memory_result_summary', () => {
  const backends = [
    { name: 'jq', prelude: '', enabled: spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0 },
    { name: 'node fallback', prelude: '_HAS_JQ=false', enabled: true },
  ] as const;

  for (const backend of backends) {
    describe.skipIf(!backend.enabled)(`${backend.name} backend`, () => {
      let dir: string;
      beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-result-')); });
      afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

      const summarise = (content: string | null, prelude = backend.prelude) => {
        const file = path.join(dir, 'result.json');
        if (content !== null) fs.writeFileSync(file, content);
        else fs.rmSync(file, { force: true });
        const run = inHook(`${prelude}\nmemory_result_summary "$1"\nprintf '%s|%s\\n' "$MEMORY_RESULT_LINE" "$MEMORY_RESULT_DENIALS"`, [file]);
        expect(run.stderr, 'nothing on stderr').toBe('');
        expect(run.status).toBe(0);
        return run.stdout.trim().split('|');
      };

      it('reduces a result with two denials to the fixed line, and never reads the tool input or the result text', () => {
        const [line, denials] = summarise(JSON.stringify({
          type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'RESULTCANARY',
          permission_denials: [
            { tool_name: 'Write', tool_input: { file_path: '/x', content: 'BODYCANARY' } },
            { tool_name: 'Write', tool_input: { file_path: '/y', content: 'BODYCANARY' } },
          ],
        }));

        expect(line).toBe('Result: success, is_error=false, 2 turn(s), 2 permission denial(s)');
        expect(denials).toBe('2');
      }, 60_000);

      it('logs the error flag and the API status as digits', () => {
        const [line, denials] = summarise(JSON.stringify({
          subtype: 'error_during_execution', is_error: true, api_error_status: 429, num_turns: 1, permission_denials: [],
        }));

        expect(line).toBe('Result: error_during_execution, is_error=true, 1 turn(s), 0 permission denial(s), api_status=429');
        expect(denials).toBe('0');
      }, 60_000);

      it('reports a missing or non-array permission_denials as unknown, never 0', () => {
        for (const denials of [undefined, 'two', 2, null, { length: 2 }]) {
          const body: Record<string, unknown> = { subtype: 'success', is_error: false, num_turns: 1 };
          if (denials !== undefined) body.permission_denials = denials;
          const [line, count] = summarise(JSON.stringify(body));
          expect(line, JSON.stringify(denials)).toBe('Result: success, is_error=false, 1 turn(s), unknown permission denial(s)');
          expect(count, JSON.stringify(denials)).toBe('unknown');
        }
      }, 60_000);

      it('lets no text from the file into the line: a field of the wrong shape reads unknown, a bad status is left out', () => {
        const [line] = summarise(JSON.stringify({
          subtype: 'Success; touch /tmp/x', is_error: 'maybe', num_turns: '-1', api_error_status: 'FORBIDDEN',
          permission_denials: [],
        }));
        expect(line).toBe('Result: unknown, is_error=unknown, unknown turn(s), 0 permission denial(s)');

        const [longStatus] = summarise(JSON.stringify({
          subtype: 'success', is_error: true, num_turns: 1, api_error_status: 12345, permission_denials: [],
        }));
        expect(longStatus).toBe('Result: success, is_error=true, 1 turn(s), 0 permission denial(s)');
      }, 60_000);

      it('names a file with no content, one that does not parse, and a missing file apart', () => {
        expect(summarise('')[0]).toBe('Result: not reported (empty)');
        expect(summarise('not-json{{{')[0]).toBe('Result: not reported (unparseable)');
        expect(summarise(null)[0]).toBe('Result: not reported (empty)');
        expect(summarise('not-json{{{')[1], 'no count is invented').toBe('unknown');
      }, 60_000);
    });
  }

  it('with no JSON parser at all, logs the no parser line and an unknown count', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-result-noparser-'));
    try {
      const file = path.join(dir, 'result.json');
      fs.writeFileSync(file, JSON.stringify({ subtype: 'success', permission_denials: [{}, {}] }));
      const run = inHook(`_JSON_AVAILABLE=false\nmemory_result_summary "$1"\nprintf '%s|%s\\n' "$MEMORY_RESULT_LINE" "$MEMORY_RESULT_DENIALS"`, [file]);

      expect(run.stderr).toBe('');
      expect(run.stdout.trim()).toBe('Result: not reported (no parser)|unknown');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('memory-permission: the one-time notice', () => {
  let root: string;
  let memory: string;
  let logFile: string;
  const pending = (reason: string): string => path.join(memory, `.worker-notice-${reason}`);
  const shown = (reason: string): string => `${pending(reason)}.shown`;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-notice-'));
    memory = path.join(root, '.devflow', 'memory');
    fs.mkdirSync(memory, { recursive: true });
    logFile = path.join(root, 'hook.log');
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  /** Run `body` with `$MEM`, `$ROOT` and `$LOGF` set, and a log() that appends to the log file. */
  const run = (body: string) => {
    const result = inHook(`MEM="$1"; ROOT="$2"; LOGF="$3"; log() { printf '%s\\n' "$1" >> "$LOGF"; }\n${body}`, [memory, root, logFile]);
    expect(result.stderr, 'nothing on stderr').toBe('');
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };
  const read = (logPath = '/log/path'): string =>
    run(`memory_notice_read "$MEM" "$ROOT" "${logPath}"\nprintf '%s' "$MEMORY_NOTICE_MESSAGE"`);
  const logged = (): string => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '');

  it('writes a floor notice once, mode 0600, and a second write leaves it as it was', () => {
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269');
    expect(fs.readFileSync(pending('floor'), 'utf-8')).toBe('floor 2.1.250 2.1.269\n');
    expect(fs.statSync(pending('floor')).mode & 0o777).toBe(0o600);

    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.100 2.1.269');
    expect(fs.readFileSync(pending('floor'), 'utf-8')).toBe('floor 2.1.250 2.1.269\n');
  });

  it('shows the update remedy once: the read moves the notice to its shown marker, and a later write stays quiet', () => {
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269');

    const first = read();
    expect(first).toContain('Update Claude Code');
    expect(first).toContain('2.1.250');
    expect(first).toContain('2.1.269');
    expect(fs.existsSync(pending('floor')), 'moved').toBe(false);
    expect(fs.existsSync(shown('floor')), 'shown marker').toBe(true);

    expect(read(), 'not shown at the next start').toBe('');
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269');
    expect(fs.existsSync(pending('floor')), 'a shown reason is not raised again').toBe(false);
  });

  it('a clear removes the notice and its shown marker, so the reason can be raised again', () => {
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269');
    read();
    expect(fs.existsSync(shown('floor'))).toBe(true);

    run('memory_notice_clear "$MEM" "$ROOT" floor');
    expect(fs.existsSync(pending('floor'))).toBe(false);
    expect(fs.existsSync(shown('floor'))).toBe(false);

    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.251 2.1.269');
    expect(read()).toContain('2.1.251');
  });

  it('keeps each reason apart: a shown floor notice does not hide a path notice, and each has its own remedy', () => {
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269');
    expect(read()).toContain('Update Claude Code');

    run('memory_notice_write "$MEM" "$ROOT" path');
    const second = read('/home/u/.devflow/logs/p/.background-memory-update.log');
    expect(second).toContain('project path');
    expect(second).toContain('/home/u/.devflow/logs/p/.background-memory-update.log');
    expect(second).not.toContain('Update Claude Code');

    run('memory_notice_write "$MEM" "$ROOT" denied');
    expect(read()).toContain('refused the worker');
  });

  it('joins the messages when more than one reason is pending, and ignores a reason it does not know', () => {
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269\nmemory_notice_write "$MEM" "$ROOT" path\nmemory_notice_write "$MEM" "$ROOT" unknown');
    expect(fs.existsSync(pending('unknown'))).toBe(false);

    const message = read();
    expect(message).toContain('Update Claude Code');
    expect(message).toContain('project path');
  });

  it('moves a notice whose content does not fit its reason to the shown marker unshown, and logs it', () => {
    for (const [reason, content] of [
      ['floor', 'path - -\n'],
      ['floor', 'floor x.y.z 2.1.269\n'],
      ['floor', 'floor 2.1.250\n'],
      ['floor', 'floor 2.1.250 2.1.269 extra\n'],
      ['floor', 'floor 2.1..250 2.1.269\n'],
      ['path', 'denied - -\n'],
      ['denied', '\n'],
    ] as const) {
      fs.writeFileSync(pending(reason), content);
      expect(read(), `${reason}: ${JSON.stringify(content)}`).toBe('');
      expect(fs.existsSync(pending(reason)), 'moved aside').toBe(false);
      expect(fs.existsSync(shown(reason)), 'to the shown marker').toBe(true);
      fs.rmSync(shown(reason));
    }
    expect(logged()).toContain('ignored');
  });

  it('reads nothing through a link: a linked notice is left as it was and its target unread', () => {
    const target = path.join(root, 'outside.txt');
    fs.writeFileSync(target, 'floor 2.1.250 2.1.269\n');
    fs.symlinkSync(target, pending('floor'));

    expect(read()).toBe('');
    expect(fs.lstatSync(pending('floor')).isSymbolicLink(), 'the link is left in place').toBe(true);
    expect(fs.existsSync(shown('floor'))).toBe(false);
    expect(fs.readFileSync(target, 'utf-8')).toBe('floor 2.1.250 2.1.269\n');
  });

  it('writes nothing through a linked memory folder or onto a planted link', () => {
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const real = path.join(root, '.devflow', 'memory-real');
    fs.renameSync(memory, real);
    fs.symlinkSync(elsewhere, memory);

    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269');
    expect(fs.readdirSync(elsewhere), 'nothing written through the linked folder').toEqual([]);

    fs.rmSync(memory);
    fs.renameSync(real, memory);
    const target = path.join(root, 'victim.txt');
    fs.writeFileSync(target, 'keep');
    fs.symlinkSync(target, pending('path'));
    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(fs.readFileSync(target, 'utf-8'), 'a link at the name is not written through').toBe('keep');
  });

  it('leaves a FIFO at the notice name alone and does not wait on it', () => {
    makeFifo(pending('floor'));
    try {
      const result = spawnSync('bash', [
        '-e', '-c', 'source "$1"; source "$2"; source "$3"; memory_notice_write "$4" "$5" floor 2.1.250 2.1.269; echo done',
        '_', path.join(HOOKS_DIR, 'resolve-project-root'), path.join(HOOKS_DIR, 'json-parse'), PERMISSION_HELPER, memory, root,
      ], { encoding: 'utf8', timeout: FIFO_RUN_BOUND_MS });

      expect(result.status, 'not blocked on the FIFO').toBe(0);
      expect(result.stdout.trim()).toBe('done');
      expect(fs.statSync(pending('floor')).isFIFO(), 'the FIFO is left in place').toBe(true);
    } finally {
      releaseFifo(pending('floor'));
    }
  });

  it('raises the denied notice on the second denied run in a row, and a clear resets the count', () => {
    run('memory_denied_seen "$MEM" "$ROOT"');
    expect(fs.existsSync(pending('denied')), 'one denied run raises nothing').toBe(false);
    expect(fs.existsSync(path.join(memory, '.worker-denied-once')), 'it leaves its marker').toBe(true);

    run('memory_denied_seen "$MEM" "$ROOT"');
    expect(fs.existsSync(pending('denied')), 'the second raises the notice').toBe(true);
    expect(read()).toContain('refused the worker');

    run('memory_notice_clear "$MEM" "$ROOT" denied');
    expect(fs.existsSync(pending('denied'))).toBe(false);
    expect(fs.existsSync(shown('denied'))).toBe(false);
    expect(fs.existsSync(path.join(memory, '.worker-denied-once')), 'the count starts again').toBe(false);

    run('memory_denied_seen "$MEM" "$ROOT"');
    expect(fs.existsSync(pending('denied')), 'one denied run after the reset raises nothing').toBe(false);
  });

  it('writes nothing when the memory folder does not exist', () => {
    fs.rmSync(memory, { recursive: true });
    run('memory_notice_write "$MEM" "$ROOT" floor 2.1.250 2.1.269\nmemory_denied_seen "$MEM" "$ROOT"\nmemory_notice_clear "$MEM" "$ROOT" floor');
    expect(fs.existsSync(memory)).toBe(false);
  });
});
