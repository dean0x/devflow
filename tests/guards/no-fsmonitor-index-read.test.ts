/**
 * no-fsmonitor-index-read — every git call in shipped code that reads the index
 * turns the repository's `core.fsmonitor` command off for itself (D-NO-FSMONITOR).
 *
 * git runs the command a repository's config names in `core.fsmonitor` whenever
 * it reads the index — `status`, `diff`, `ls-files` and every command that
 * stages, commits or checks out. devflow's hooks, resolvers and HUD run inside
 * arbitrary repositories, so an unguarded index read there executes code the
 * repository chose. The override is `-c core.fsmonitor=false` before the
 * subcommand. The behavioural tests (tests/memory-hooks-fsmonitor.test.ts,
 * tests/decisions/ledger-ops.test.ts, tests/integration/hud-git.test.ts,
 * tests/evidence-policy/settings-mode.test.ts) prove the override holds at run
 * time; this guard stops a new call from forgetting it.
 *
 * What it asserts
 * ---------------
 * Across `src/assets/scripts/**` and every code file under `src/`, each git call
 * spelled with an index-reading subcommand carries `core.fsmonitor=false` ahead
 * of that subcommand, in one of three spellings:
 *   - shell, and a quoted JS command string: `git [global options] <sub>` —
 *     a line that opens as a comment (`#` in shell; `*`, `//`, `/*` in JS)
 *     is prose and is skipped;
 *   - a JS argv literal handed to git: `'git', [ ..., '<sub>'` or a call to a
 *     git-named wrapper, `git(io, [ ..., '<sub>'` / `gitExec([ ..., '<sub>'`;
 *   - a call through a wrapper whose own body prepends the override
 *     (`'git', ['-c', 'core.fsmonitor=false', ...args]`), which covers every
 *     call made through that wrapper name in that file.
 *
 * What a green run does NOT prove (PF-064)
 * ----------------------------------------
 * The matcher reads calls as they are spelled. An argv assembled at run time
 * (`[sub, ...rest]`, an argv held in a named constant), a wrapper not named for
 * git, and `describe --dirty` (the one index read `describe` makes, and never
 * spelled in shipped code) are not matches.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** git subcommands that read the index, and so run a configured fsmonitor. */
const INDEX_READING_SUBCOMMANDS: readonly string[] = [
  'status', 'diff', 'ls-files', 'add', 'commit', 'stash', 'update-index', 'checkout',
  'reset', 'grep', 'restore', 'switch', 'rm', 'mv', 'apply', 'merge', 'rebase',
  'cherry-pick', 'revert', 'am',
];
const SUB = INDEX_READING_SUBCOMMANDS.join('|');

/** The override, as a shell/command-string global option. */
const SHELL_OVERRIDE = /-c\s+core\.fsmonitor=false(?!\S)/;
/** The override, as an argv element. */
const ARGV_OVERRIDE = /(['"])core\.fsmonitor=false\1/;

/**
 * `git`, its global options, then an index-reading subcommand, in a shell line
 * or a quoted JS command string. Group 1: the global options.
 */
const SHELL_CALL = new RegExp(
  String.raw`\bgit((?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*)\s+(?:${SUB})(?![\w-])`,
  'g',
);
/** The same call opening a quoted JS command string (`execSync('git status')`). */
const JS_COMMAND_STRING = new RegExp(String.raw`(['"\`])${SHELL_CALL.source}`, 'g');

/**
 * A JS argv literal handed to git — `'git', [` or a git-named callee's argument
 * list — whose leading string elements end in an index-reading subcommand.
 * Groups: 1 the git-named callee (absent for `'git', [`), 2 the elements before
 * the subcommand.
 */
const JS_ARGV_CALL = new RegExp(
  String.raw`(?:(['"])git\1\s*,\s*|\b(\w*[gG]it\w*)\s*\(\s*(?:[\w.]+\s*,\s*)*)` +
    String.raw`\[((?:\s*(['"])[^'"\n]*\4\s*,)*?)\s*(['"])(?:${SUB})\5`,
  'g',
);

/** A function whose body spawns git with the override prepended to its argv. */
const GUARDED_WRAPPER = /function\s+(\w+)\s*\([^)]*\)[^{]*\{(?:(?!\n\})[\s\S])*?(['"])git\2\s*,\s*\[\s*(['"])-c\3\s*,\s*(['"])core\.fsmonitor=false\4\s*,\s*\.\.\.\w+/g;

interface UnguardedRead {
  path: string;
  line: number;
  call: string;
}

const SHELL_FILE = (p: string): boolean => path.extname(p) === '' || p.endsWith('.sh');

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/** True when the match at `index` sits on a line that opens as a comment. */
function onCommentLine(content: string, index: number, opener: RegExp): boolean {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  return opener.test(content.slice(lineStart, index));
}

const SHELL_COMMENT = /^\s*#/;
const JS_COMMENT = /^\s*(?:\*|\/\/|\/\*)/;

/** Names of the wrappers in `content` that prepend the override themselves. */
function guardedWrappers(content: string): Set<string> {
  return new Set([...content.matchAll(GUARDED_WRAPPER)].map(m => m[1]));
}

/**
 * Every index-reading git call in `corpus` without the override. Pure — the
 * live arm and the seeded probes run this same function.
 */
function findUnguardedIndexReads(corpus: readonly CorpusEntry[]): UnguardedRead[] {
  const found: UnguardedRead[] = [];
  for (const entry of corpus) {
    const { content } = entry;
    const report = (index: number, call: string): void => {
      found.push({ path: entry.path, line: lineAt(content, index), call: call.trim().split('\n')[0] });
    };
    if (SHELL_FILE(entry.path)) {
      for (const m of content.matchAll(SHELL_CALL)) {
        if (onCommentLine(content, m.index, SHELL_COMMENT)) continue;
        if (!SHELL_OVERRIDE.test(m[1])) report(m.index, m[0]);
      }
      continue;
    }
    for (const m of content.matchAll(JS_COMMAND_STRING)) {
      if (onCommentLine(content, m.index, JS_COMMENT)) continue;
      if (!SHELL_OVERRIDE.test(m[2])) report(m.index, m[0]);
    }
    const wrappers = guardedWrappers(content);
    for (const m of content.matchAll(JS_ARGV_CALL)) {
      const callee = m[2];
      if (callee !== undefined && wrappers.has(callee)) continue;
      if (!ARGV_OVERRIDE.test(m[3])) report(m.index, m[0]);
    }
  }
  return found;
}

/** Every index-reading git call in `corpus`, guarded or not — the non-vacuity count. */
function countIndexReads(corpus: readonly CorpusEntry[]): number {
  let n = 0;
  for (const { path: p, content } of corpus) {
    n += SHELL_FILE(p)
      ? [...content.matchAll(SHELL_CALL)].length
      : [...content.matchAll(JS_COMMAND_STRING)].length + [...content.matchAll(JS_ARGV_CALL)].length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const SCRIPTS_DIR = path.join(ROOT, 'src', 'assets', 'scripts');

const corpus: CorpusEntry[] = walkFiles(
  path.join(ROOT, 'src'),
  file => file.startsWith(SCRIPTS_DIR + path.sep)
    ? CODE_EXTENSIONS.includes(path.extname(file)) || SHELL_FILE(file)
    : CODE_EXTENSIONS.includes(path.extname(file)),
).map(file => ({
  path: path.relative(ROOT, file).split(path.sep).join('/'),
  content: readFileSync(file, 'utf-8'),
}));

// ---------------------------------------------------------------------------
// Live arms
// ---------------------------------------------------------------------------

describe('every index-reading git call turns core.fsmonitor off (D-NO-FSMONITOR)', () => {
  it('reaches the shipped scripts, the HUD, and their index reads', () => {
    const paths = corpus.map(e => e.path);
    expect(paths).toContain('src/assets/scripts/hooks/json-helper.cjs');
    expect(paths).toContain('src/assets/scripts/hooks/pre-compact-memory');
    expect(paths).toContain('src/hud/git.ts');
    // json-helper ls-files, resolve-settings ls-files, verify-evidence diff,
    // two each in pre-compact-memory and background-memory-update, HUD status + diff.
    expect(countIndexReads(corpus)).toBeGreaterThanOrEqual(9);
  });

  it('no git call reads the index without -c core.fsmonitor=false', () => {
    expect(
      findUnguardedIndexReads(corpus).map(o => `${o.path}:${o.line}: \`${o.call}\` — add -c core.fsmonitor=false before the subcommand`),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seeded probes (PF-064): red on every spelling, green on prose and guards.
// ---------------------------------------------------------------------------

describe('no-fsmonitor-index-read guard: seeded probes', () => {
  const SH = 'src/assets/scripts/hooks/example-hook';
  const JS = 'src/assets/scripts/example.cjs';

  const KNOWN_BAD: ReadonlyArray<{ name: string; entry: CorpusEntry }> = [
    { name: 'a shell status', entry: { path: SH, content: 'S=$(git status --short 2>/dev/null)\n' } },
    { name: 'a shell diff after -C', entry: { path: SH, content: 'git -C "$d" diff --stat HEAD\n' } },
    { name: 'a shell ls-files with another -c', entry: { path: SH, content: 'git -c color.ui=never ls-files -z\n' } },
    { name: 'the override after the subcommand', entry: { path: SH, content: 'git status -c core.fsmonitor=false\n' } },
    { name: "a 'git', [...] argv", entry: { path: JS, content: "execFileSync('git', ['ls-files', '-z'], {});" } },
    { name: 'an argv with only other global options', entry: { path: JS, content: "execFile('git', ['--no-optional-locks', 'status'], cb);" } },
    { name: 'a git-named wrapper call', entry: { path: 'src/hud/x.ts', content: "await gitExec(['diff', '--shortstat', base], cwd);" } },
    { name: 'a wrapper call across lines', entry: { path: JS, content: "runGit(exec, root,\n  ['add', '--', file], MAX);" } },
    { name: 'a command string', entry: { path: 'src/core/x.ts', content: "execSync('git commit -m x');" } },
    {
      name: 'a call through an unguarded wrapper',
      entry: { path: JS, content: "function git(io, args) {\n  return run(io, 'git', [...args]);\n}\ngit(io, ['status']);" },
    },
  ];

  for (const probe of KNOWN_BAD) {
    it(`reports ${probe.name}`, () => {
      expect(findUnguardedIndexReads([probe.entry])).toHaveLength(1);
    });
  }

  it('names the line the call starts on', () => {
    const found = findUnguardedIndexReads([{ path: JS, content: "// header\n\nexecFileSync('git',\n  ['status']);" }]);
    expect(found.map(f => f.line)).toEqual([3]);
  });

  it('does not report guarded calls, non-index subcommands, or prose', () => {
    const clean: CorpusEntry[] = [
      { path: SH, content: 'S=$(git -c core.fsmonitor=false status --short)\n# git status is guarded above\n' },
      { path: SH, content: 'git rev-parse HEAD; git log --oneline -5; git merge-base --is-ancestor a b\n' },
      { path: SH, content: 'echo "not a git repo"\ndbg "git state captured"\n' },
      { path: JS, content: "execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z']);" },
      { path: JS, content: "runGit(exec, root, ['-c', 'core.fsmonitor=false', 'ls-files', '--error-unmatch'], MAX);" },
      {
        path: JS,
        content: "function git(io, args) {\n  return runCall(io, 'git', ['-c', 'core.fsmonitor=false', ...args]);\n}\ngit(io, ['diff', '--name-only']);",
      },
      { path: JS, content: "/** List tracked files via `git ls-files`. */\nexecFile('git', ['rev-parse', '--show-toplevel']);" },
      { path: 'src/cli/x.ts', content: "const ACTIONS = ['enable', 'disable', 'status'];\nexecFileSync('sudo', ['rm', p]);" },
    ];
    expect(findUnguardedIndexReads(clean)).toEqual([]);
  });
});
