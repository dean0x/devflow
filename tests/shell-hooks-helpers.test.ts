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
import { isolatedEnv } from './setup/home-isolation.js';

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
  script('claude', 'exit 99');
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
// staged-path check, the settings JSON that carries the Edit allow rule and the Edit deny
// rule, the fixed result line and the one-time notice. The macos-bash32-hooks CI job runs
// this file but not tests/eager-memory-refresh.test.ts, so the pattern work is pinned
// here, under the bash that job puts first on PATH. Every run sources the helpers the way
// the hooks do and runs under `set -e`, so a helper that ends in a failing status aborts
// the run.
// =============================================================================

const PERMISSION_HELPER = path.join(HOOKS_DIR, 'memory-permission');

/** What one bash run printed; the body sees the helpers sourced and `$1...` as `args`. */
function inHook(body: string, args: string[] = [], env = process.env, timeout = 60_000) {
  const run = spawnSync('bash', [
    '-e', '-c',
    'source "$1"; source "$2"; source "$3"; source "${1%/*}/is-hex-sha"; shift 3\n' + body,
    '_',
    path.join(HOOKS_DIR, 'resolve-project-root'),
    path.join(HOOKS_DIR, 'json-parse'),
    PERMISSION_HELPER,
    ...args,
  ], { encoding: 'utf8', env, timeout });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function noteEnv(): NodeJS.ProcessEnv {
  return isolatedEnv({ ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` }, dir);
}

describe('memory-permission: the note cap', () => {
  const measure = (files: string[]) => inHook(`for file in "$@"; do
  if memory_note_within_cap "$file"; then rc=0; else rc=$?; fi
  printf '%s:%s\\n' "$rc" "$MEMORY_NOTE_BYTES"
done`, files, noteEnv(), FIFO_RUN_BOUND_MS);

  it('counts bytes and accepts exactly 8192 bytes', () => {
    const notes = ['', 'x'.repeat(8192), 'x'.repeat(8193), 'é'.repeat(4096) + '\n'];
    const files = notes.map((note, index) => {
      const file = path.join(dir, `note-${index}`);
      fs.writeFileSync(file, note);
      return file;
    });

    expect(measure(files)).toEqual({ status: 0, stdout: '0:0\n0:8192\n1:8193\n1:8193\n', stderr: '' });
  });

  it('refuses a FIFO, a folder, a link, and a missing file before the size read (TP-13)', () => {
    const fifo = path.join(dir, 'note-fifo');
    const link = path.join(dir, 'note-link');
    const missing = path.join(dir, 'note-missing');
    fs.symlinkSync(exitsCleanEarly, link);
    makeFifo(fifo);

    expect(measure([fifo, dir, link, missing])).toEqual({
      status: 0, stdout: '1:unknown\n'.repeat(4), stderr: '',
    });
  }, FIFO_RUN_BOUND_MS + 5_000);

  it('refuses failed, empty, oversized digit counts and malformed size results (TP-13)', () => {
    const counts = inHook(String.raw`
wc() {
  printf ' %s\t\n' "$count"
  [ "$count" != 123 ] || { echo 'read failed' >&2; return 1; }
}
for count in 0 0008192 '' 00008192 '8 192' 8192x 123; do
  if memory_note_within_cap "$1"; then rc=0; else rc=$?; fi
  printf '%s:%s\n' "$rc" "$MEMORY_NOTE_BYTES"
done`, [exitsCleanEarly], noteEnv());

    expect(counts).toEqual({ status: 0, stdout: '0:0\n0:0008192\n' + '1:unknown\n'.repeat(5), stderr: '' });
  });
});

describe('memory-permission: the note stamp', () => {
  const sha = 'abcde09';
  const prefix = `<!-- memory-head: ${sha} branch: `;

  it('writes the old stamp without an epoch and keeps the branch token at its cap', () => {
    const branch = 'feat/' + 'a'.repeat(195);
    const result = inHook('memory_stamp_line "$1" "(detached)"; memory_stamp_line "$1" "$2" 1234567890', [sha, branch], noteEnv());

    expect(result).toEqual({
      status: 0, stdout: `${prefix}(detached) -->\n${prefix}${branch} multi: 1234567890 -->\n`, stderr: '',
    });
  });

  it('substitutes unknown for a bad SHA or branch and omits a bad epoch', () => {
    const branches = ['', 'two tokens', 'has\tTab', 'has\nLine', 'has\u007fDEL', 'a'.repeat(201)];
    const result = inHook('for branch in "$@"; do memory_stamp_line not-hex "$branch" 12345678901; done', branches, noteEnv());

    expect(result).toEqual({ status: 0, stdout: '<!-- memory-head: unknown branch: unknown -->\n'.repeat(branches.length), stderr: '' });
  });

  it('parses the old and new formats, clears previous fields, and refuses invalid fields', () => {
    const result = inHook(`for line in "$@"; do
  memory_stamp_parse "$line"
  printf '%s|%s|%s\\n' "$STAMP_SHA" "$STAMP_BRANCH" "$STAMP_MULTI"
done`, [
      `${prefix}feat/local multi: 00009 -->`, `${prefix}(detached) -->`,
      `${prefix}two tokens multi: 09 -->`, `${prefix}has\tTab multi: 9x -->`,
      `${prefix}${'a'.repeat(201)} -->`, '<!-- memory-head: bad branch: main -->',
      `${prefix}main --> extra`,
    ], noteEnv());

    expect(result).toEqual({
      status: 0, stdout: `${sha}|feat/local|00009\n${sha}|(detached)|\n${sha}||09\n${sha}||\n${sha}||\n|main|\n||\n`, stderr: '',
    });
  });

  it('carries a decimal mark for less than four hours and refuses expired or future marks', () => {
    const result = inHook(`for now in "$@"; do
  epoch=$(memory_multi_epoch_from_line "$STAMP" "$now")
  printf '[%s]\\n' "$epoch"
done`, ['00009', '14408', '14409', '00008', 'invalid'], {
      ...noteEnv(), STAMP: `${prefix}main multi: 00009 -->`,
    });

    expect(result).toEqual({ status: 0, stdout: '[00009]\n[00009]\n[]\n[]\n[]\n', stderr: '' });
  });
});

describe('json_extract_cwd_sid_field (TP-28)', () => {
  const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;

  for (const useJq of [true, false]) {
    const extract = (events: object[]) => inHook(`
_HAS_JQ="$1"; shift
for input in "$@"; do
  row=$(printf '%s' "$input" | json_extract_cwd_sid_field prompt && printf x) || exit 1
  printf '%s\\0' "\${row%x}"
done`, [String(useJq), ...events.map((event) => JSON.stringify(event))], noteEnv());

    describe.skipIf(useJq && !hasJq)(useJq ? 'jq' : 'node fallback', () => {
      it('keeps the path and value and emits only valid session IDs', () => {
        const cwd = '/project path';
        const prompt = 'tab\tbackslash\\ SOH\x01 DEL\x7f é\n';
        const limit = 'a'.repeat(64);
        const ids = [
          'Z', 'A-b_09', limit, undefined, '', null, false, 42, {}, ['A'],
          'a\n', 'a\t', 'a\x01b', 'a\x7fb', 'a\0b', '../a', 'é', 'a'.repeat(65),
        ];
        const result = extract(ids.map((session_id) => ({ cwd, prompt, session_id })));
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe('');
        const rows = result.stdout.split('\0').slice(0, -1).map((row) => {
          const [pathField, sid, ...value] = row.split('\x01');
          return [pathField, sid, value.join('\x01')];
        });

        expect(rows).toEqual(ids.map((_, i) => [cwd, ['Z', 'A-b_09', limit][i] ?? '', prompt]));
      }, 60_000);

      it('prints empty fields for an absent path or value', () => {
        expect(extract([{ session_id: 'a' }, { cwd: '/project', prompt: null }])).toEqual({
          status: 0, stdout: '\x01a\x01\0/project\x01\x01\0', stderr: '',
        });
      });

      it('refuses a path with a field delimiter or a NUL byte', () => {
        for (const cwd of ['/project\x01part', '/project\0part']) {
          expect(extract([{ cwd, session_id: 'a', prompt: 'turn' }])).toEqual({
            status: 1, stdout: '', stderr: '',
          });
        }
      });
    });
  }
});

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

  it('refuses a project inside a .git folder, with the protected reason', () => {
    expect(safe(
      '/p/.git/modules/m/.devflow/memory/WORKING-MEMORY.md.new',
      '/p/.git/worktrees/w/.devflow/memory/WORKING-MEMORY.md.new',
    )).toEqual(['refused:protected', 'refused:protected']);
  });

  it('accepts a project inside a .claude folder, such as a checkout in .claude/worktrees', () => {
    const accepted = [
      '/p/.claude/worktrees/w/.devflow/memory/WORKING-MEMORY.md.new',
      '/p/.claude/.devflow/memory/WORKING-MEMORY.md.new',
    ];
    expect(safe(...accepted)).toEqual(accepted.map(() => 'ok:'));
  });

  it('accepts a path with an opening or a closing parenthesis, or both, which the rule carries as they are', () => {
    const accepted = [
      '/Users/dev/obs ( )/proj/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/proj (copy)/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/a(b/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/a)b/.devflow/memory/WORKING-MEMORY.md.new',
      '/Users/dev/(x)/(y)/.devflow/memory/WORKING-MEMORY.md.new',
    ];
    expect(safe(...accepted)).toEqual(accepted.map(() => 'ok:'));
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

  it('builds the exact JSON: an Edit allow rule on the absolute staged path, an Edit deny rule on every path under it, no hooks', () => {
    const staged = '/Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new';
    const run = build(staged);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      '{"permissions":{"allow":["Edit(//Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new)"],'
      + '"deny":["Edit(//Users/dev/proj/.devflow/memory/WORKING-MEMORY.md.new/*)"]},"disableAllHooks":true}',
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
      expect(parsed.permissions.deny, staged).toEqual([`Edit(/${staged}/*)`]);
      expect(parsed.disableAllHooks).toBe(true);
    }
  });

  it('carries the parentheses of a path in both rules as they are: the exact allow and deny text, in valid JSON', () => {
    const staged = '/Users/dev/obs ( )/proj (copy)/.devflow/memory/WORKING-MEMORY.md.new';
    const run = build(staged);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      '{"permissions":{"allow":["Edit(//Users/dev/obs ( )/proj (copy)/.devflow/memory/WORKING-MEMORY.md.new)"],'
      + '"deny":["Edit(//Users/dev/obs ( )/proj (copy)/.devflow/memory/WORKING-MEMORY.md.new/*)"]},"disableAllHooks":true}',
    );
    const parsed = JSON.parse(run.stdout) as { permissions: { allow: string[]; deny: string[] } };
    expect(parsed.permissions.allow, 'one allow rule, for the staged file only').toEqual([`Edit(/${staged})`]);
    expect(parsed.permissions.deny, 'one deny rule, for every path under the staged file').toEqual([`Edit(/${staged}/*)`]);
  });

  it.each([
    ['an asterisk', '/Users/dev/pr*oj'],
    ['a question mark', '/Users/dev/pr?oj'],
    ['an opening bracket', '/Users/dev/pr[oj'],
    ['a closing bracket', '/Users/dev/pr]oj'],
    ['a backslash', '/Users/dev/pr\\oj'],
    ['a double quote', '/Users/dev/pr"oj'],
    ['an opening brace', '/Users/dev/pr{oj'],
    ['a closing brace', '/Users/dev/pr}oj'],
    ['a newline', '/Users/dev/pr\noj'],
  ])('prints nothing and fails for a path with %s, so no rule is built for it', (_label, project) => {
    const run = build(`${project}/.devflow/memory/WORKING-MEMORY.md.new`);

    expect(run.stdout).toBe('');
    expect(run.status).not.toBe(0);
  });

  it('prints nothing and fails for a path with parentheses and a refused character, so no rule is built for it', () => {
    const run = build('/Users/dev/obs ( )*/proj/.devflow/memory/WORKING-MEMORY.md.new');

    expect(run.stdout).toBe('');
    expect(run.status).not.toBe(0);
  });
});

describe('memory-permission: path_occupied', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-occupied-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  /** `occupied` or `free` for each path, from one call under `set -e`: the predicate is read inside an `if`. */
  const verdicts = (...paths: string[]): string[] =>
    inHook(
      'for p in "$@"; do if path_occupied "$p"; then echo occupied; else echo free; fi; done',
      paths,
    ).stdout.trim().split('\n');

  it('counts a file, a folder, and a link to either as occupied', () => {
    const file = path.join(tmp, 'file');
    const folder = path.join(tmp, 'folder');
    fs.writeFileSync(file, 'x');
    fs.mkdirSync(folder);
    fs.symlinkSync(file, path.join(tmp, 'link-to-file'));
    fs.symlinkSync(folder, path.join(tmp, 'link-to-folder'));

    expect(verdicts(file, folder, path.join(tmp, 'link-to-file'), path.join(tmp, 'link-to-folder')))
      .toEqual(['occupied', 'occupied', 'occupied', 'occupied']);
  });

  it('counts a dangling link as occupied: the name is taken although nothing stands behind it', () => {
    const dangling = path.join(tmp, 'dangling');
    fs.symlinkSync(path.join(tmp, 'absent'), dangling);

    expect(fs.existsSync(dangling), 'the link names nothing').toBe(false);
    expect(verdicts(dangling)).toEqual(['occupied']);
  });

  it('counts a missing path and an empty path as free', () => {
    expect(verdicts(path.join(tmp, 'absent'), '')).toEqual(['free', 'free']);
  });

  it('ends in a status the caller reads in an if, and does not abort a hook that runs under set -e', () => {
    const run = inHook('if path_occupied "$1"; then echo occupied; fi\nif ! path_occupied "$1"; then echo free; fi\necho after', [path.join(tmp, 'absent')]);

    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual(['free', 'after']);
  });
});

describe('memory-permission: memory_staged_remove', () => {
  const STAGED_NAME = 'WORKING-MEMORY.md.new';
  let tmp: string;
  let root: string;
  let memory: string;
  let outside: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-staged-')));
    root = path.join(tmp, 'proj');
    memory = path.join(root, '.devflow', 'memory');
    outside = path.join(tmp, 'outside');
    fs.mkdirSync(memory, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  /** One call: the status and the two variables it sets. `prelude` runs first, e.g. to shadow `rm`. */
  function remove(dir: string, rootArg: string, staged: string, prelude = ''): { rc: number; removed: string; refusal: string } {
    const run = inHook(
      `${prelude}\nif memory_staged_remove "$1" "$2" "$3"; then rc=0; else rc=$?; fi\nprintf 'rc=%s removed=%s refusal=%s\\n' "$rc" "$STAGED_REMOVED" "$STAGED_REMOVE_REFUSAL"`,
      [dir, rootArg, staged],
    );
    expect(run.status, run.stderr).toBe(0);
    const m = /^rc=(\d+) removed=(\S*) refusal=(\S*)$/.exec(run.stdout.trim());
    expect(m, run.stdout).not.toBeNull();
    return { rc: Number(m![1]), removed: m![2], refusal: m![3] };
  }
  const staged = (): string => path.join(memory, STAGED_NAME);
  const present = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };

  it('removes nothing and reports none when nothing stands at the staged path', () => {
    expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'none', refusal: '' });
  });

  it('leaves a regular file alone: the caller removes a stale staged file itself', () => {
    fs.writeFileSync(staged(), 'stale');

    expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'none', refusal: '' });
    expect(fs.readFileSync(staged(), 'utf-8')).toBe('stale');
  });

  it('removes an empty folder at the staged path', () => {
    fs.mkdirSync(staged());

    expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'dir', refusal: '' });
    expect(present(staged())).toBe(false);
  });

  it('removes a folder with nested folders and files, and only that folder', () => {
    fs.mkdirSync(path.join(staged(), 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(staged(), 'a', 'b', 'c'), 'x');
    fs.writeFileSync(path.join(staged(), '.hidden'), 'x');
    fs.writeFileSync(path.join(memory, 'WORKING-MEMORY.md'), 'memory');
    fs.writeFileSync(path.join(memory, '.pending-turns.jsonl'), 'queue');

    expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'dir', refusal: '' });
    expect(present(staged())).toBe(false);
    expect(fs.readdirSync(memory).sort(), 'its neighbours stay').toEqual(['.pending-turns.jsonl', 'WORKING-MEMORY.md']);
  });

  it('never follows a link inside the folder: the link goes, the folder it names stays', () => {
    fs.mkdirSync(staged());
    fs.symlinkSync(outside, path.join(staged(), 'to-outside'));

    expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'dir', refusal: '' });
    expect(present(staged())).toBe(false);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf-8')).toBe('keep');
  });

  it.each([
    ['a folder', () => outside],
    ['a file', () => path.join(outside, 'keep.txt')],
    ['nothing', () => path.join(outside, 'absent')],
  ] as const)('removes a link to %s as the link, and never follows it', (_label, target) => {
    fs.symlinkSync(target(), staged());

    expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'link', refusal: '' });
    expect(present(staged())).toBe(false);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf-8'), 'the target is untouched').toBe('keep');
  });

  describe('refuses, removes nothing and names the fact it could not prove', () => {
    it('path: the staged path is not exactly <memory dir>/WORKING-MEMORY.md.new', () => {
      const other = path.join(memory, 'OTHER');
      fs.mkdirSync(other);
      fs.mkdirSync(path.join(root, 'sub'));
      fs.mkdirSync(path.join(root, 'sub', STAGED_NAME));
      fs.mkdirSync(staged());

      expect(remove(memory, root, other)).toEqual({ rc: 1, removed: 'none', refusal: 'path' });
      expect(remove(memory, root, path.join(root, 'sub', STAGED_NAME))).toEqual({ rc: 1, removed: 'none', refusal: 'path' });
      expect(remove(memory, root, `${staged()}/`)).toEqual({ rc: 1, removed: 'none', refusal: 'path' });
      expect(present(other)).toBe(true);
      expect(present(path.join(root, 'sub', STAGED_NAME))).toBe(true);
      expect(present(staged()), 'a trailing slash is not the exact path').toBe(true);
    });

    it('parent: the memory dir does not resolve to <root>/.devflow/memory', () => {
      const elsewhere = path.join(root, 'elsewhere');
      fs.mkdirSync(path.join(elsewhere, STAGED_NAME), { recursive: true });
      fs.mkdirSync(path.join(outside, STAGED_NAME));

      expect(remove(elsewhere, root, path.join(elsewhere, STAGED_NAME))).toEqual({ rc: 1, removed: 'none', refusal: 'parent' });
      expect(remove(outside, root, path.join(outside, STAGED_NAME))).toEqual({ rc: 1, removed: 'none', refusal: 'parent' });
      expect(present(path.join(elsewhere, STAGED_NAME))).toBe(true);
      expect(present(path.join(outside, STAGED_NAME))).toBe(true);
    });

    it('link: a link sits on the way down from the root to the memory dir', () => {
      fs.rmSync(path.join(root, '.devflow'), { recursive: true });
      fs.mkdirSync(path.join(outside, 'memory', STAGED_NAME), { recursive: true });
      fs.symlinkSync(outside, path.join(root, '.devflow'));

      expect(remove(memory, root, staged())).toEqual({ rc: 1, removed: 'none', refusal: 'link' });
      expect(present(path.join(outside, 'memory', STAGED_NAME)), 'the folder the link names stays').toBe(true);
    });

    it('link: the memory dir itself is a link', () => {
      fs.rmSync(memory, { recursive: true });
      fs.mkdirSync(path.join(outside, STAGED_NAME));
      fs.symlinkSync(outside, memory);

      expect(remove(memory, root, staged())).toEqual({ rc: 1, removed: 'none', refusal: 'link' });
      expect(present(path.join(outside, STAGED_NAME))).toBe(true);
    });

    it.each([
      ['an empty root', ''],
      ['a relative root', 'proj'],
    ])('args: %s', (_label, rootArg) => {
      fs.mkdirSync(staged());

      expect(remove(memory, rootArg, staged())).toEqual({ rc: 1, removed: 'none', refusal: 'args' });
      expect(present(staged())).toBe(true);
    });

    it('args: an empty memory dir or staged path', () => {
      fs.mkdirSync(staged());

      expect(remove('', root, staged())).toEqual({ rc: 1, removed: 'none', refusal: 'args' });
      expect(remove(memory, root, '')).toEqual({ rc: 1, removed: 'none', refusal: 'args' });
      expect(present(staged())).toBe(true);
    });

    it('size: the folder lists more than 256 lines', () => {
      fs.mkdirSync(staged());
      for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(staged(), `f${i}`), 'x');

      expect(remove(memory, root, staged())).toEqual({ rc: 1, removed: 'none', refusal: 'size' });
      expect(fs.readdirSync(staged()), 'every file stays').toHaveLength(300);
    });

    it('size: a folder with 200 files is within the bound and is removed', () => {
      fs.mkdirSync(staged());
      for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(staged(), `f${i}`), 'x');

      expect(remove(memory, root, staged())).toEqual({ rc: 0, removed: 'dir', refusal: '' });
      expect(present(staged())).toBe(false);
    });

    it('rm: the delete itself fails and something still stands there', () => {
      fs.mkdirSync(staged());

      expect(remove(memory, root, staged(), 'rm() { return 1; }')).toEqual({ rc: 1, removed: 'none', refusal: 'rm' });
      expect(present(staged())).toBe(true);
    });

    it('rm: a link that cannot be removed', () => {
      fs.symlinkSync(outside, staged());

      expect(remove(memory, root, staged(), 'rm() { return 1; }')).toEqual({ rc: 1, removed: 'none', refusal: 'rm' });
      expect(fs.readlinkSync(staged())).toBe(outside);
      expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf-8')).toBe('keep');
    });
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

      it('keeps each field within its length cap: a value one character over the cap reads unknown or is left out', () => {
        const within = summarise(JSON.stringify({
          subtype: 'a'.repeat(40), is_error: true, num_turns: 999999, api_error_status: 599,
          permission_denials: [{}, {}, {}],
        }));
        expect(within[0]).toBe(`Result: ${'a'.repeat(40)}, is_error=true, 999999 turn(s), 3 permission denial(s), api_status=599`);

        const over = summarise(JSON.stringify({
          subtype: 'a'.repeat(41), is_error: true, num_turns: 1000000, api_error_status: 1000,
          permission_denials: [],
        }));
        expect(over[0]).toBe('Result: unknown, is_error=true, unknown turn(s), 0 permission denial(s)');
      }, 60_000);

      it('reads a file with no content and a missing file as empty, and a file that does not parse as unparseable, with no count invented', () => {
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

  /**
   * Run `body` with `$MEM`, `$ROOT` and `$LOGF` set, and a log() that appends to the log file.
   * The memory area reads `untracked`, as it does in a worker whose area check passed;
   * `area` sets it to another word, or leaves it unset with `null`.
   */
  const run = (body: string, area: string | null = 'untracked') => {
    const prelude = area === null ? '' : `DF_TRACKED_AREA_MEMORY='${area}'; `;
    const result = inHook(`${prelude}MEM="$1"; ROOT="$2"; LOGF="$3"; log() { printf '%s\\n' "$1" >> "$LOGF"; }\n${body}`, [memory, root, logFile], noteEnv());
    expect(result.stderr, 'nothing on stderr').toBe('');
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };
  const read = (logPath = '/log/path'): string =>
    run(`memory_notice_read "$MEM" "$ROOT" "${logPath}"\nprintf '%s' "$MEMORY_NOTICE_MESSAGE"`);
  const logged = (): string => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '');

  it('writes a path notice once, mode 0600, and a second write leaves it as it was', () => {
    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(fs.readFileSync(pending('path'), 'utf-8')).toBe('path\n');
    expect(fs.statSync(pending('path')).mode & 0o777).toBe(0o600);

    fs.appendFileSync(pending('path'), '');
    const before = fs.statSync(pending('path')).ino;
    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(fs.readFileSync(pending('path'), 'utf-8')).toBe('path\n');
    expect(fs.statSync(pending('path')).ino, 'the second write made no new file').toBe(before);
  });

  it('writes nothing for a reason it does not know', () => {
    run('memory_notice_write "$MEM" "$ROOT" unknown\nmemory_notice_write "$MEM" "$ROOT" ""');
    expect(fs.readdirSync(memory)).toEqual([]);
  });

  it('shows a notice once: the read moves it to its shown marker, and a later write stays quiet', () => {
    run('memory_notice_write "$MEM" "$ROOT" path');

    const first = read('/home/u/.devflow/logs/p/.background-memory-update.log');
    expect(first).toContain('a project path blocks the working memory update');
    expect(first).toContain('/home/u/.devflow/logs/p/.background-memory-update.log');
    expect(first, 'it names the folder the log sits in').toContain('under ~/.devflow/logs/, in the folder for the session that ran it');
    expect(fs.existsSync(pending('path')), 'moved').toBe(false);
    expect(fs.existsSync(shown('path')), 'shown marker').toBe(true);

    expect(read(), 'not shown at the next start').toBe('');
    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(fs.existsSync(pending('path')), 'a shown reason is not raised again').toBe(false);
  });

  it('a clear removes the notice and its shown marker, so the reason can be raised again', () => {
    run('memory_notice_write "$MEM" "$ROOT" path');
    read();
    expect(fs.existsSync(shown('path'))).toBe(true);

    run('memory_notice_clear "$MEM" "$ROOT" path');
    expect(fs.existsSync(pending('path'))).toBe(false);
    expect(fs.existsSync(shown('path'))).toBe(false);

    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(read()).toContain('project path');
  });

  it('keeps each reason apart: a shown path notice does not hide a denied notice, and each has its own message', () => {
    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(read()).toContain('project path');

    run('memory_notice_write "$MEM" "$ROOT" denied');
    const second = read('/home/u/.devflow/logs/p/.background-memory-update.log');
    expect(second).toContain('refused the worker');
    expect(second, 'it states the count as it is kept').toContain('two runs with no successful update between them');
    expect(second).toContain('/home/u/.devflow/logs/p/.background-memory-update.log');
    expect(second).not.toContain('project path');
  });

  it('joins the messages when more than one reason is pending', () => {
    run('memory_notice_write "$MEM" "$ROOT" path\nmemory_notice_write "$MEM" "$ROOT" denied');

    const message = read();
    expect(message).toContain('project path');
    expect(message).toContain('refused the worker');
  });

  it('moves a notice whose content does not fit its reason to the shown marker unshown, and logs it', () => {
    for (const [reason, content] of [
      ['path', 'denied\n'],
      ['path', 'path extra\n'],
      ['path', 'path - -\n'],
      ['path', '\n'],
      ['denied', 'path\n'],
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
    fs.writeFileSync(target, 'path\n');
    fs.symlinkSync(target, pending('path'));

    expect(read()).toBe('');
    expect(fs.lstatSync(pending('path')).isSymbolicLink(), 'the link is left in place').toBe(true);
    expect(fs.existsSync(shown('path'))).toBe(false);
    expect(fs.readFileSync(target, 'utf-8')).toBe('path\n');
  });

  it('writes nothing through a linked memory folder or onto a planted link', () => {
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const real = path.join(root, '.devflow', 'memory-real');
    fs.renameSync(memory, real);
    fs.symlinkSync(elsewhere, memory);

    run('memory_notice_write "$MEM" "$ROOT" path');
    expect(fs.readdirSync(elsewhere), 'nothing written through the linked folder').toEqual([]);

    // unlinkSync, not rmSync: rmSync on node 24.8 refuses a link to a directory.
    fs.unlinkSync(memory);
    fs.renameSync(real, memory);
    const target = path.join(root, 'victim.txt');
    fs.writeFileSync(target, 'keep');
    fs.symlinkSync(target, pending('denied'));
    run('memory_notice_write "$MEM" "$ROOT" denied');
    expect(fs.readFileSync(target, 'utf-8'), 'a link at the name is not written through').toBe('keep');
  });

  describe('a dangling link at a notice name is a name that is taken', () => {
    const dangling = (file: string): string => {
      const target = path.join(root, 'absent-target');
      fs.symlinkSync(target, file);
      return target;
    };

    it('memory_notice_write writes nothing through a dangling link at the notice, and none when its shown marker is one', () => {
      const target = dangling(pending('path'));
      run('memory_notice_write "$MEM" "$ROOT" path');
      expect(fs.existsSync(target), 'nothing is created through the link').toBe(false);
      expect(fs.lstatSync(pending('path')).isSymbolicLink(), 'the link is left in place').toBe(true);

      // unlinkSync, not rmSync: rmSync on node 24.8 leaves a dangling link in place.
      fs.unlinkSync(pending('path'));
      const shownTarget = dangling(shown('path'));
      run('memory_notice_write "$MEM" "$ROOT" path');
      expect(fs.existsSync(pending('path')), 'a shown marker, even a dangling link, keeps the reason quiet').toBe(false);
      expect(fs.existsSync(shownTarget)).toBe(false);
    });

    it('memory_notice_clear takes a dangling link at each name as present, and the link guard leaves it in place', () => {
      const targets = [pending('denied'), shown('denied'), path.join(memory, '.worker-denied-once')].map(dangling);

      run('memory_notice_clear "$MEM" "$ROOT" denied');

      expect(fs.readdirSync(memory).sort(), 'no link is followed or removed').toEqual(
        ['.worker-denied-once', '.worker-notice-denied', '.worker-notice-denied.shown'],
      );
      for (const target of targets) expect(fs.existsSync(target)).toBe(false);
    });

    it('memory_denied_seen counts a dangling link at the denied-once marker as the first denied run', () => {
      dangling(path.join(memory, '.worker-denied-once'));

      run('memory_denied_seen "$MEM" "$ROOT"');

      expect(fs.existsSync(pending('denied')), 'the second denied run raises the notice').toBe(true);
    });
  });

  it('leaves a FIFO at the notice name alone and does not wait on it', () => {
    makeFifo(pending('path'));
    try {
      const result = spawnSync('bash', [
        '-e', '-c', 'source "$1"; source "$2"; source "$3"; DF_TRACKED_AREA_MEMORY=untracked; memory_notice_write "$4" "$5" path; echo done',
        '_', path.join(HOOKS_DIR, 'resolve-project-root'), path.join(HOOKS_DIR, 'json-parse'), PERMISSION_HELPER, memory, root,
      ], { encoding: 'utf8', timeout: FIFO_RUN_BOUND_MS });

      expect(result.status, 'not blocked on the FIFO').toBe(0);
      expect(result.stdout.trim()).toBe('done');
      expect(fs.statSync(pending('path')).isFIFO(), 'the FIFO is left in place').toBe(true);
    } finally {
      releaseFifo(pending('path'));
    }
  });

  it('raises the denied notice on the second denied run with no update between, and a clear resets the count', () => {
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

  it('counts note refusals apart from denied runs and leaves the notice to the caller (TP-15)', () => {
    const marker = path.join(memory, '.worker-note-once');
    const noteRefusal = 'memory_refusal_seen "$MEM" "$ROOT" note; printf "%s" "$MEMORY_REFUSAL_COUNT"';
    run('memory_denied_seen "$MEM" "$ROOT"');

    expect(run(noteRefusal)).toBe('first');
    expect(fs.statSync(marker).mode & 0o777).toBe(0o600);
    expect(run(noteRefusal)).toBe('second');
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.existsSync(pending('note'))).toBe(false);

    run('memory_notice_write "$MEM" "$ROOT" note');
    expect(read()).toContain('The worker kept the previous note.');
    expect(read()).toBe('');
    run('memory_notice_clear "$MEM" "$ROOT" note');
    expect(fs.existsSync(shown('note'))).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    expect(run(noteRefusal)).toBe('first');
  });

  it('reports no count when the area is paused and a blocked count for a folder at the marker', () => {
    const marker = path.join(memory, '.worker-note-once');
    const noteRefusal = 'memory_refusal_seen "$MEM" "$ROOT" note; printf "%s" "$MEMORY_REFUSAL_COUNT"';

    expect(run(noteRefusal, 'tracked')).toBe('none');
    expect(fs.readdirSync(memory)).toEqual([]);
    fs.mkdirSync(marker);
    expect(run(noteRefusal)).toBe('blocked');
    expect(fs.statSync(marker).isDirectory()).toBe(true);
  });

  it('writes nothing when the memory folder does not exist', () => {
    fs.rmSync(memory, { recursive: true });
    run('memory_notice_write "$MEM" "$ROOT" path\nmemory_denied_seen "$MEM" "$ROOT"\nmemory_notice_clear "$MEM" "$ROOT" path');
    expect(fs.existsSync(memory)).toBe(false);
  });

  // The memory area answer is the gate: git tracks files in the memory folder, git did not
  // answer, or nothing asked. Only `untracked` lets the worker leave a notice or a marker.
  describe.each<readonly [string, string | null]>([
    ['tracked', 'tracked'],
    ['unknown', 'unknown'],
    ['unset', null],
    ['an unrecognised word', 'maybe'],
  ])('the memory area reads %s', (_name, area) => {
    it('leaves no notice and no denied-run marker, however often the worker asks', () => {
      run('memory_notice_write "$MEM" "$ROOT" path\nmemory_notice_write "$MEM" "$ROOT" denied\nmemory_denied_seen "$MEM" "$ROOT"\nmemory_denied_seen "$MEM" "$ROOT"', area);
      expect(fs.readdirSync(memory)).toEqual([]);
    });

    it('keeps the notice and its two markers', () => {
      const files = [pending('note'), shown('note'), path.join(memory, '.worker-note-once')];
      for (const file of files) fs.writeFileSync(file, 'x');

      run('memory_notice_clear "$MEM" "$ROOT" note\nmemory_notice_clear "$MEM" "$ROOT" denied', area);

      expect(fs.readdirSync(memory).sort()).toEqual(files.map((file) => path.basename(file)).sort());
    });
  });
});
