/**
 * integration-spawn — no test starts `claude` unsandboxed or with permissions
 * skipped, and no integration test starts the built CLI without an explicit
 * environment and working directory (#486, #436).
 *
 * A live `claude` session that inherits the parent environment and runs in the
 * checkout can read and write the developer's real `~/.claude` and this
 * repository, and a session started with permission prompts skipped lets the
 * agents write without a gate. The live files build a temp HOME and a temp
 * repository (`createSpawnContext` in tests/integration/helpers.ts) and pass
 * both to every child. This guard stops a later spawn from leaving them out.
 *
 * What it asserts
 * ---------------
 * 1. Every call to `spawn`, `spawnSync`, `execFile` or `execFileSync` under
 *    `tests/` whose first argument is the literal `claude` (bare, or behind a
 *    path: `/usr/local/bin/claude`, `./node_modules/.bin/claude`,
 *    `~/.local/bin/claude`), and every call to `exec`, `execSync` or one of those
 *    four whose first argument is a string or template that runs `claude` as a
 *    command, passes an options object literal that has both an `env` and a `cwd`
 *    key, and carries neither the skip-permissions flag nor `bypassPermissions` in
 *    its text. A string runs `claude` as a command when the name, bare or behind a
 *    path and with or without quotes, sits:
 *    - at its start, or after `&&`, `&`, `||`, `|`, `;`, `(`, `$(`, a backtick or a
 *      `{` followed by a space, on the same line; and
 *    - behind any of these, each followed by whitespace: an assignment (`FOO=1`,
 *      `FOO="a b"`), the launchers `command`, `exec`, `nohup`, `time`, `npx`,
 *      `sudo`, `nice`, `xargs` and `env` (with flags that take no value, as in
 *      `env -i`), `timeout <seconds>`, and the shell keywords `!`, `if`, `elif`,
 *      `then`, `else`, `do`, `while` and `until`.
 *    For `spawn`, `spawnSync`, `execFile` and `execFileSync` the name must be
 *    followed by a space (`spawn('claude -p hi', { shell: true })`); the bare
 *    literal is the first sentence of this rule. One shell string is exempt: the
 *    exact `claude --version` availability probe in tests/integration/helpers.ts,
 *    which starts no session. `claude --version && claude -p …` is not that probe.
 * 2. Every call of those four whose first argument is `process.execPath` or the
 *    literal `node` — in these files always the built CLI — in a file under
 *    `tests/integration/` or in `tests/integration-spawn-context.test.ts` passes
 *    an options object literal with both keys.
 * 3. No file under `tests/integration/` spells the skip-permissions flag or
 *    `bypassPermissions`. The argument builders for the live spawns live there, so
 *    this closes the case where the flag sits in a builder and the call site only
 *    passes the built list.
 *
 * What a green run does NOT prove
 * -------------------------------
 * - Calls are matched by their literal first argument. A binary named by a
 *   variable (`spawn(CLAUDE_BIN, …)`), a wrapper (`execa`, a local `runClaude`,
 *   `promisify(exec)`), a renamed import and `fork` are not matches. Neither is a
 *   shell string whose command is built at run time (`exec(cmd)`,
 *   `` exec(`${bin} -p hi`) ``), one that reaches `claude` through a nested shell
 *   (`sh -c 'claude …'`, `spawn('sh', ['-c', …])`), or one whose `claude` sits on
 *   a later line of a template. The shell form is matched on the name alone, so a
 *   regular expression's `.exec('claude …')` is reported too: that fails closed.
 * - Inside a shell string, rule 1 reads only the forms it lists. These stay out:
 *   - a launcher it does not name (`setsid`, `caffeinate`), and an option of a
 *     named launcher that takes a separate value (`sudo -u root claude`,
 *     `xargs -n 1 claude`, `timeout -k 5 60 claude`, `env -u NAME claude`);
 *   - a binary named by a shell variable or a substitution (`$CLAUDE_BIN -p hi`,
 *     `$(which claude) -p hi`) and a Windows name (`claude.cmd`, `claude.exe`);
 *   - a launcher given as the program with `claude` in the argument array
 *     (`spawn('npx', ['claude', …])`, `spawnSync('sudo', ['claude', …])`).
 *   The probes in the "does not match" rows of the seeded probes show each one.
 * - `env` and `cwd` are checked as keys of the options object literal in the
 *   call, not for what they point to: `env: process.env` or `cwd: ROOT` passes.
 *   Options held in a variable or spread (`...base`) report both keys missing,
 *   and so does a quoted key (`'cwd': dir`): the scanner reads bare keys only.
 *   That the temp HOME and the temp repository are real and clean is proven by
 *   tests/integration-spawn-context.test.ts, not here.
 * - The refused words are matched as text inside the call and inside the
 *   `tests/integration/` files. A builder outside that directory that adds the
 *   flag and hands the list to a spawn through a variable is not seen.
 *   tests/fixtures/forbidden-argv.ts spells the flag in the list of argv forms
 *   the production worker must never pass. That is not a spawn and not under
 *   `tests/integration/`, so it does not match, and no allowlist entry exists.
 * - String, template and comment bodies are masked by a small scanner. A regular
 *   expression literal that holds a quote, or a template literal nested inside
 *   `${…}`, can desynchronise it.
 * - That a live file is left out of the default sweep is the job of
 *   tests/integration-config-gate.test.ts.
 *
 * The corpus is `tests/` code files minus this guard, whose seeded probes spell
 * the refused words on purpose.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** The options keys every guarded spawn must pass. */
const REQUIRED_OPTION_KEYS = ['env', 'cwd'] as const;

/** Spelled in pieces so no plain search for the words lands on this file. */
const REFUSED_WORDS: ReadonlyArray<{ name: string; needle: string }> = [
  { name: 'the skip-permissions flag', needle: 'dangerously' + '-skip-permissions' },
  { name: 'bypassPermissions', needle: 'bypass' + 'Permissions' },
];

const INTEGRATION_DIR = 'tests/integration/';
const SPAWN_CONTEXT_TEST = 'tests/integration-spawn-context.test.ts';
const HELPERS = 'tests/integration/helpers.ts';

/** Files whose node children must pass env and cwd. */
const inNodeScope = (file: string): boolean => file.startsWith(INTEGRATION_DIR) || file === SPAWN_CONTEXT_TEST;
/** Files in which the refused words may not appear at all. */
const inLiteralScope = (file: string): boolean => file.startsWith(INTEGRATION_DIR);

/** Longest call the scanner reads. A call that runs past it is reported, not skipped. */
const MAX_CALL_CHARS = 4000;
/** Most spawn sites one file may hold before the scan stops. */
const MAX_SITES_PER_FILE = 64;

type SpawnKind = 'claude' | 'claude-shell' | 'node';

/** A path in front of a program name: `/usr/local/bin/`, `./node_modules/.bin/`, `~/.local/bin/`, `${home}/bin/`. */
const PATH_PREFIX = String.raw`(?:[\w.~$/{}-]*\/)?`;

/** `spawn`, `spawnSync`, `execFile` or `execFileSync` whose first argument is exactly `claude`, bare or behind a path. */
const CLAUDE_SPAWN = new RegExp(
  String.raw`\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*(['"` + '`' + String.raw`])${PATH_PREFIX}claude\1`,
  'g',
);

// The command-string arms. Every piece is a non-capturing group: `\1` is the opening quote of
// the string, and the lazy prefix may not run past it.

/**
 * What ends one command and starts the next on the same line: `&&`, `&`, `||`, `|`, `;`, `(`
 * (so `$(` too), a backtick (escaped inside a template), and `{` when a space follows. A bare
 * `{` is not one, so a template placeholder such as `${claude}` is not read as a command.
 */
const SEPARATOR = String.raw`&&?|\|\|?|;|\(|\{(?=\s)|\\?` + '`';

/**
 * What may sit between a separator and the program, each followed by whitespace: an assignment
 * (`FOO=1`, `FOO="a b"`), the launchers `command`, `exec`, `nohup`, `time`, `npx`, `sudo`,
 * `nice`, `xargs` and `env` (each with flags that take no value: `env -i`, `sudo -E`),
 * `timeout <seconds>`, and the shell keywords that open a command (`!`, `then`, `do`, ...).
 */
const LAUNCHER = [
  String.raw`[A-Za-z_]\w*=(?:\\?"[^"]*\\?"|\\?'[^']*\\?'|\S*)`,
  String.raw`(?:command|exec|nohup|time|npx|sudo|nice|xargs|env)(?:\s+-\S+)*`,
  String.raw`timeout(?:\s+-\S+)*\s+\d\S*`,
  String.raw`!|if|elif|then|else|do|while|until`,
].join('|');

/** The program: `claude`, bare or behind a path, with or without quotes around it (`'claude'`). */
const PROGRAM = String.raw`(?:\\?["'])?${PATH_PREFIX}claude(?:\\?["'])?`;

/**
 * A call to one of `callNames` whose first argument is a string or template that runs `claude`
 * as a command: at the start of the string, or after a separator on the same line, behind any
 * launchers. `programEnd` says what may follow the name. `claude-code`, `claude.md` and
 * `~/.claude` are not the program.
 */
function commandStringCall(callNames: string, programEnd: string): RegExp {
  return new RegExp(
    String.raw`\b(?:${callNames})\s*\(\s*(['"` +
      '`' +
      String.raw`])(?:(?:(?!\1)[^\n])*?(?:${SEPARATOR}))?\s*(?:(?:${LAUNCHER})\s+)*${PROGRAM}${programEnd}`,
    'g',
  );
}

/** `exec` or `execSync`: a shell string, with `claude` followed by anything but a name character. */
const CLAUDE_SHELL_SPAWN = commandStringCall('exec|execSync', String.raw`(?![\w./=-])`);
/**
 * The argument-list calls given a command string (`spawn('claude -p hi', { shell: true })`).
 * `claude` must be followed by whitespace: the bare literal `'claude'` is {@link CLAUDE_SPAWN}.
 */
const CLAUDE_COMMAND_ARG_SPAWN = commandStringCall('spawn|spawnSync|execFile|execFileSync', String.raw`(?=\s)`);
const NODE_SPAWN = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*(?:process\.execPath\b|(['"`])node\1)/g;

/**
 * The one shell string that may name `claude` without `env` and `cwd`: the availability probe,
 * which asks for the version and starts no session. It is matched by file and by the exact text
 * of the first argument, so `claude --version && claude -p hi` is not exempt.
 */
const SHELL_EXEMPTIONS: ReadonlyArray<{ path: string; call: RegExp }> = [
  { path: HELPERS, call: /^\(\s*(['"`])claude --version\1\s*[,)]/ },
];

interface SpawnSite {
  path: string;
  line: number;
  kind: SpawnKind;
  /** True for a shell-string call that {@link SHELL_EXEMPTIONS} names. */
  exempt: boolean;
  /** Index of the call's opening parenthesis in the file. */
  start: number;
  /** The call text, from its opening parenthesis through the matching one. */
  call: string;
  /** Keys of the object literal arguments, top level only. */
  keys: readonly string[];
  /** False when no matching parenthesis was found within the bound. */
  readable: boolean;
}

const LABELS: Readonly<Record<SpawnKind, string>> = {
  claude: 'claude spawn',
  'claude-shell': 'claude shell command',
  node: 'node child',
};

interface SpawnViolation {
  path: string;
  line: number;
  what: string;
}

/** The 1-based line of `index` in `content`. */
function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * `text` with the bodies of strings, templates and comments replaced by spaces.
 * Quote characters and newlines stay, so every index and line number is the same
 * in both texts.
 */
function maskLiterals(text: string): string {
  const out: string[] = [];
  let quote: string | null = null;
  let comment: 'line' | 'block' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const next = i + 1 < text.length ? text.charAt(i + 1) : '';
    if (comment === 'line') {
      if (ch === '\n') {
        comment = null;
        out.push(ch);
      } else {
        out.push(' ');
      }
      continue;
    }
    if (comment === 'block') {
      if (ch === '*' && next === '/') {
        out.push(' ', ' ');
        i += 1;
        comment = null;
      } else {
        out.push(ch === '\n' ? '\n' : ' ');
      }
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') {
        out.push(' ');
        if (next !== '') {
          out.push(next === '\n' ? '\n' : ' ');
          i += 1;
        }
      } else if (ch === quote) {
        quote = null;
        out.push(ch);
      } else if (ch === '\n' && quote !== '`') {
        // An unterminated single-line string ends at the line: damage stays on this line.
        quote = null;
        out.push(ch);
      } else {
        out.push(ch === '\n' ? '\n' : ' ');
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      comment = 'line';
      out.push(' ', ' ');
      i += 1;
    } else if (ch === '/' && next === '*') {
      comment = 'block';
      out.push(' ', ' ');
      i += 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out.push(ch);
    } else {
      out.push(ch);
    }
  }
  return out.join('');
}

/** Index of the parenthesis that closes the one at `open` in masked text, or -1 past the bound. */
function matchingParen(masked: string, open: number): number {
  const limit = Math.min(masked.length, open + MAX_CALL_CHARS);
  let depth = 0;
  for (let i = open; i < limit; i += 1) {
    const ch = masked.charAt(i);
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The comma-separated parts one level inside a bracketed span of masked text. The
 * span starts at its opening bracket. Nested brackets of every kind are skipped.
 */
function topLevelParts(span: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 1;
  for (let i = 0; i < span.length; i += 1) {
    const ch = span.charAt(i);
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        parts.push(span.slice(start, i));
        break;
      }
    } else if (ch === ',' && depth === 1) {
      parts.push(span.slice(start, i));
      start = i + 1;
    }
  }
  return parts.map(part => part.trim()).filter(part => part !== '');
}

/** The keys of every object literal that is a direct argument of the masked call. */
function optionKeys(maskedCall: string): string[] {
  const keys: string[] = [];
  for (const arg of topLevelParts(maskedCall)) {
    if (!arg.startsWith('{')) continue;
    for (const member of topLevelParts(arg)) {
      const key = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(member)?.[1];
      if (key !== undefined) keys.push(key);
    }
  }
  return keys;
}

/**
 * Every claude spawn in the corpus (argument-list form and shell-string form), and every
 * node child in a file `nodeScope` accepts. Pure — the live arms and the seeded probes run
 * this same function.
 */
function collectSpawnSites(corpus: readonly CorpusEntry[], nodeScope: (file: string) => boolean = inNodeScope): SpawnSite[] {
  const sites: SpawnSite[] = [];
  for (const entry of corpus) {
    const masked = maskLiterals(entry.content);
    const claudeOpeners: ReadonlyArray<[SpawnKind, RegExp]> = [
      ['claude', CLAUDE_SPAWN],
      ['claude-shell', CLAUDE_SHELL_SPAWN],
      ['claude-shell', CLAUDE_COMMAND_ARG_SPAWN],
    ];
    const openers: ReadonlyArray<[SpawnKind, RegExp]> = nodeScope(entry.path) ? [...claudeOpeners, ['node', NODE_SPAWN]] : claudeOpeners;
    let inFile = 0;
    // A call that two openers both match is one site.
    const seen = new Set<number>();
    for (const [kind, opener] of openers) {
      for (const match of entry.content.matchAll(opener)) {
        const at = match.index ?? 0;
        // An opener inside a string or a comment is prose, not a call.
        if (masked.charAt(at) !== entry.content.charAt(at)) continue;
        if (seen.has(at)) continue;
        seen.add(at);
        inFile += 1;
        if (inFile > MAX_SITES_PER_FILE) {
          throw new Error(`${entry.path}: more than ${MAX_SITES_PER_FILE} spawn sites — bound exceeded, scan aborted`);
        }
        const start = at + match[0].indexOf('(');
        const end = matchingParen(masked, start);
        const readable = end !== -1;
        const stop = readable ? end + 1 : Math.min(entry.content.length, start + 200);
        const call = entry.content.slice(start, stop);
        sites.push({
          path: entry.path,
          line: lineAt(entry.content, at),
          kind,
          exempt: kind === 'claude-shell' && SHELL_EXEMPTIONS.some(e => e.path === entry.path && e.call.test(call)),
          start,
          call,
          keys: readable ? optionKeys(masked.slice(start, stop)) : [],
          readable,
        });
      }
    }
  }
  return sites;
}

/**
 * Every way a test starts `claude` or the built CLI without the sandbox the live
 * files build, plus every refused word under `tests/integration/`. Pure — the
 * live arm and the seeded probes run this same function.
 */
function findSpawnViolations(corpus: readonly CorpusEntry[], nodeScope: (file: string) => boolean = inNodeScope): SpawnViolation[] {
  const found: SpawnViolation[] = [];
  for (const site of collectSpawnSites(corpus, nodeScope)) {
    if (site.exempt) continue;
    const label = LABELS[site.kind];
    if (!site.readable) {
      found.push({ path: site.path, line: site.line, what: `${label} is not readable within ${MAX_CALL_CHARS} characters` });
      continue;
    }
    for (const key of REQUIRED_OPTION_KEYS) {
      if (!site.keys.includes(key)) {
        found.push({ path: site.path, line: site.line, what: `${label} passes no \`${key}\`` });
      }
    }
    if (site.kind !== 'node') {
      for (const word of REFUSED_WORDS) {
        if (site.call.includes(word.needle)) {
          found.push({ path: site.path, line: site.line, what: `${label} carries ${word.name}` });
        }
      }
    }
  }
  for (const entry of corpus) {
    if (!inLiteralScope(entry.path)) continue;
    for (const word of REFUSED_WORDS) {
      const at = entry.content.indexOf(word.needle);
      if (at !== -1) {
        found.push({ path: entry.path, line: lineAt(entry.content, at), what: `spells ${word.name}` });
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const SELF = 'tests/guards/integration-spawn.test.ts';
const CODE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

const corpus: CorpusEntry[] = walkFiles(path.join(ROOT, 'tests'), file => CODE_EXTENSIONS.includes(path.extname(file)))
  .map(file => ({
    path: path.relative(ROOT, file).split(path.sep).join('/'),
    content: readFileSync(file, 'utf-8'),
  }))
  .filter(entry => entry.path !== SELF);

// ---------------------------------------------------------------------------
// Live arms
// ---------------------------------------------------------------------------

describe('no test starts claude or the built CLI unsandboxed (#486)', () => {
  it('reaches the live spawn sites, and both scope members hold node children', () => {
    // Non-vacuity: the corpus holds the tests, the two claude spawns are found in
    // the one helper that makes them, and each named node-scope member has a child.
    expect(corpus.length).toBeGreaterThan(100);
    const sites = collectSpawnSites(corpus);
    const claudeSites = sites.filter(site => site.kind === 'claude');
    expect(claudeSites.length).toBeGreaterThanOrEqual(2);
    expect(claudeSites.filter(site => site.path === HELPERS).length).toBeGreaterThanOrEqual(2);
    // The shell-string collector reaches the corpus: it finds the availability probe.
    expect(sites.filter(site => site.kind === 'claude-shell').map(site => site.path)).toContain(HELPERS);
    const nodePaths = new Set(sites.filter(site => site.kind === 'node').map(site => site.path));
    expect(nodePaths.has(HELPERS)).toBe(true);
    expect(nodePaths.has(SPAWN_CONTEXT_TEST)).toBe(true);
    expect(sites.every(site => site.readable)).toBe(true);
  });

  it('every file the literal rule covers exists in the corpus', () => {
    expect(corpus.filter(entry => inLiteralScope(entry.path)).length).toBeGreaterThanOrEqual(3);
    expect(corpus.some(entry => entry.path === SPAWN_CONTEXT_TEST)).toBe(true);
  });

  it('every claude spawn and integration node child passes env and cwd, and no file spells a refused word', () => {
    const offenders = findSpawnViolations(corpus);
    expect(offenders.map(o => `${o.path}:${o.line}: ${o.what}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seeded probes: the finder goes red on every shape a spawn can take, and stays
// green on the sandboxed shapes the live files use.
// ---------------------------------------------------------------------------

describe('integration-spawn guard: seeded probes', () => {
  const INTEGRATION_FILE = 'tests/integration/example.test.ts';
  const OTHER_FILE = 'tests/example.test.ts';
  const FORBIDDEN_ARGV_FILE = 'tests/fixtures/forbidden-argv.ts';
  const SKIP_FLAG = REFUSED_WORDS[0]!.needle;
  const BYPASS = REFUSED_WORDS[1]!.needle;

  const KNOWN_BAD: ReadonlyArray<{ name: string; path: string; content: string; what: string[] }> = [
    { name: 'a claude spawn without env', path: OTHER_FILE, content: "spawn('claude', args, { cwd: dir });", what: ['claude spawn passes no `env`'] },
    { name: 'a claude spawn without cwd', path: OTHER_FILE, content: "spawn('claude', args, { env });", what: ['claude spawn passes no `cwd`'] },
    { name: 'a claude spawn with options in a variable', path: OTHER_FILE, content: "spawn('claude', args, opts);", what: ['claude spawn passes no `env`', 'claude spawn passes no `cwd`'] },
    { name: 'a claude spawn with no options', path: OTHER_FILE, content: "spawnSync('claude', ['--version']);", what: ['claude spawn passes no `env`', 'claude spawn passes no `cwd`'] },
    { name: 'spread-only options', path: OTHER_FILE, content: "spawn('claude', args, { ...base });", what: ['claude spawn passes no `env`', 'claude spawn passes no `cwd`'] },
    { name: 'a quoted key, which the scanner does not read', path: OTHER_FILE, content: "spawn('claude', args, { 'cwd': dir, env });", what: ['claude spawn passes no `cwd`'] },
    {
      name: 'a multi-line execFileSync with a template-literal name',
      path: OTHER_FILE,
      content: 'execFileSync(`claude`, [\n  \'-p\',\n  prompt,\n], {\n  cwd: dir,\n});',
      what: ['claude spawn passes no `env`'],
    },
    {
      name: 'env and cwd only inside a nested call',
      path: OTHER_FILE,
      content: "spawn('claude', buildArgs({ env, cwd }), {});",
      what: ['claude spawn passes no `env`', 'claude spawn passes no `cwd`'],
    },
    {
      name: 'env and cwd only in strings and comments',
      path: OTHER_FILE,
      content: "spawn('claude', ['--env', 'cwd'], {\n  // env and cwd go here\n  stdio: 'pipe',\n});",
      what: ['claude spawn passes no `env`', 'claude spawn passes no `cwd`'],
    },
    {
      name: 'the skip-permissions flag in the argument list',
      path: OTHER_FILE,
      content: `spawn('claude', ['-p', '${SKIP_FLAG}'], { cwd: dir, env });`,
      what: ['claude spawn carries the skip-permissions flag'],
    },
    {
      name: 'bypassPermissions in the argument list',
      path: OTHER_FILE,
      content: `spawn('claude', ['--permission-mode', '${BYPASS}'], { cwd: dir, env });`,
      what: ['claude spawn carries bypassPermissions'],
    },
    {
      name: 'a claude spawn that is not readable within the bound',
      path: OTHER_FILE,
      content: "spawn('claude', [",
      what: [`claude spawn is not readable within ${MAX_CALL_CHARS} characters`],
    },
    {
      name: 'a shell-string execSync of claude with no options',
      path: OTHER_FILE,
      content: "execSync('claude -p \"hi\"');",
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'a shell-string exec of claude with only a callback',
      path: OTHER_FILE,
      content: 'exec("claude -p hi", done);',
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'a shell-string execSync of claude without env',
      path: OTHER_FILE,
      content: "execSync('claude -p hi', { cwd: dir });",
      what: ['claude shell command passes no `env`'],
    },
    {
      name: 'a template-literal execSync of claude without cwd',
      path: OTHER_FILE,
      content: 'execSync(`claude -p hi`, { env });',
      what: ['claude shell command passes no `cwd`'],
    },
    {
      name: 'a shell string that starts claude after a separator',
      path: OTHER_FILE,
      content: "execSync('cd /tmp && claude -p hi', { stdio: 'pipe' });",
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'a shell string that starts claude behind an assignment',
      path: OTHER_FILE,
      content: "execSync('FOO=1 claude -p hi');",
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'a member-call execSync of claude',
      path: OTHER_FILE,
      content: "cp.execSync('claude -p hi', { cwd: dir });",
      what: ['claude shell command passes no `env`'],
    },
    {
      name: 'the skip-permissions flag in a shell string',
      path: OTHER_FILE,
      content: `execSync('claude -p ${SKIP_FLAG}', { cwd: dir, env });`,
      what: ['claude shell command carries the skip-permissions flag'],
    },
    {
      name: 'a regular expression exec of a string that starts with claude (fails closed, as the header says)',
      path: OTHER_FILE,
      content: "const m = /claude/.exec('claude -p hi');",
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'the availability probe outside the helper file',
      path: OTHER_FILE,
      content: "execSync('claude --version', { stdio: 'pipe' });",
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'a session started behind the availability probe in the helper file',
      path: HELPERS,
      content: "execSync('claude --version && claude -p hi', { stdio: 'pipe' });",
      what: ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'],
    },
    {
      name: 'a node child without env in an integration file',
      path: INTEGRATION_FILE,
      content: "spawnSync(process.execPath, [CLI, 'init'], { cwd: dir });",
      what: ['node child passes no `env`'],
    },
    {
      name: 'a node child without cwd in the spawn-context test',
      path: SPAWN_CONTEXT_TEST,
      content: "execFileSync('node', [CLI, 'init'], { env });",
      what: ['node child passes no `cwd`'],
    },
    {
      name: 'the skip flag spelled in an integration file with no spawn',
      path: INTEGRATION_FILE,
      content: `const FLAGS = ['${SKIP_FLAG}'];`,
      what: ['spells the skip-permissions flag'],
    },
    {
      name: 'the skip flag spelled in a comment in an integration file',
      path: INTEGRATION_FILE,
      content: `// never pass ${SKIP_FLAG}`,
      what: ['spells the skip-permissions flag'],
    },
    {
      name: 'bypassPermissions spelled in an integration file',
      path: HELPERS,
      content: `const MODE = '${BYPASS}';`,
      what: ['spells bypassPermissions'],
    },
  ];

  for (const probe of KNOWN_BAD) {
    it(`reports ${probe.name}`, () => {
      const found = findSpawnViolations([{ path: probe.path, content: probe.content }]);
      expect(found.map(f => f.what)).toEqual(probe.what);
    });
  }

  // One row per form of the command-string arms. Each call passes no options, so each is
  // reported once for `env` and once for `cwd`, as a shell command.
  const NO_OPTIONS = ['claude shell command passes no `env`', 'claude shell command passes no `cwd`'];
  const COMMAND_FORMS: ReadonlyArray<readonly [string, string]> = [
    ['a path-qualified binary (absolute)', "execSync('/usr/local/bin/claude -p hi');"],
    ['a path-qualified binary (relative)', "execSync('./node_modules/.bin/claude -p hi');"],
    ['a path-qualified binary (home)', "execSync('~/.local/bin/claude -p hi');"],
    ['a path-qualified binary after a separator', "execSync('cd /tmp && /opt/homebrew/bin/claude -p hi');"],
    ['a quoted path-qualified binary', "execSync('\"/usr/local/bin/claude\" -p hi');"],
    ['a path-qualified binary behind a template placeholder', 'execSync(`${home}/.local/bin/claude -p hi`);'],
    ['npx', "execSync('npx claude -p hi');"],
    ['npx with a flag', "execSync('npx -y claude -p hi');"],
    ['sudo', "execSync('sudo claude -p hi');"],
    ['sudo with a flag', "execSync('sudo -E claude -p hi');"],
    ['xargs after a pipe', "execSync('echo hi | xargs claude -p');"],
    ['timeout with a duration', "execSync('timeout 60 claude -p hi');"],
    ['nice', "execSync('nice claude -p hi');"],
    ['env with a flag', "execSync('env -i claude -p hi');"],
    ['env with a flag and an assignment', "execSync('env -i FOO=1 claude -p hi');"],
    ['an assignment with a quoted value', "execSync('FOO=\"a b\" claude -p hi');"],
    ['a launcher behind a launcher', "execSync('sudo -E timeout 60 npx claude -p hi');"],
    ['a single & separator', "execSync('sleep 1 & claude -p hi');"],
    ['a backtick command', "execSync('echo `claude -p hi`');"],
    ['an escaped backtick command in a template', 'execSync(`echo \\`claude -p hi\\``);'],
    ['a brace group', "execSync('{ claude -p hi; }');"],
    ['a negation', "execSync('! claude -p hi');"],
    ['a command after then', "execSync('if true; then claude -p hi; fi');"],
    ['a command after do', "execSync('while true; do claude -p hi; done');"],
    ['a single-quoted program name', 'execSync("\'claude\' -p hi");'],
    ['a double-quoted program name', "execSync('\"claude\" -p hi');"],
    ['spawn given a command string', "spawn('claude -p hi', { shell: true });"],
    ['spawnSync given a command string', 'spawnSync("claude -p hi", { shell: true });'],
    ['execFile given a command string', "execFile('claude -p hi', { shell: true }, done);"],
    ['execFileSync given a command string behind a launcher', "execFileSync('npx claude -p hi', { shell: true });"],
    ['spawn given a path-qualified command string', "spawn('/usr/local/bin/claude -p hi', { shell: true });"],
  ];
  for (const [name, content] of COMMAND_FORMS) {
    it(`reports ${name} as a claude command`, () => {
      const found = findSpawnViolations([{ path: OTHER_FILE, content }]);
      expect(found.map(f => f.what)).toEqual(NO_OPTIONS);
    });
  }

  const PATH_LITERALS: ReadonlyArray<{ name: string; content: string; what: string[] }> = [
    { name: 'spawn of an absolute path without env', content: "spawn('/opt/homebrew/bin/claude', args, { cwd: dir });", what: ['claude spawn passes no `env`'] },
    { name: 'execFileSync of a relative path without cwd', content: "execFileSync('./node_modules/.bin/claude', ['-p', 'hi'], { env });", what: ['claude spawn passes no `cwd`'] },
    { name: 'spawnSync of a home path with no options', content: "spawnSync('~/.local/bin/claude', ['--version']);", what: ['claude spawn passes no `env`', 'claude spawn passes no `cwd`'] },
  ];
  for (const probe of PATH_LITERALS) {
    it(`reports ${probe.name}`, () => {
      expect(findSpawnViolations([{ path: OTHER_FILE, content: probe.content }]).map(f => f.what)).toEqual(probe.what);
    });
  }

  it('reports the skip flag and a missing key in a command string given to spawn', () => {
    const content = `spawn('claude -p ${SKIP_FLAG}', { shell: true, cwd: dir });`;
    expect(findSpawnViolations([{ path: OTHER_FILE, content }]).map(f => f.what)).toEqual([
      'claude shell command passes no `env`',
      'claude shell command carries the skip-permissions flag',
    ]);
  });

  it('counts one command-string call once, even when two arms read it', () => {
    // The closing quote of 'claude' is followed by a space, so both argument-list arms match.
    const sites = collectSpawnSites([{ path: OTHER_FILE, content: "spawn('claude' , args, { cwd: dir, env });" }]);
    expect(sites.map(site => site.kind)).toEqual(['claude']);
  });

  it('names the line the spawn starts on', () => {
    const found = findSpawnViolations([{ path: OTHER_FILE, content: "// header\n\nconst proc = spawn('claude', args, {\n  cwd: dir,\n});" }]);
    expect(found.map(f => f.line)).toEqual([3]);
  });

  it('does not report a sandboxed spawn in any spelling the live files use', () => {
    const clean: CorpusEntry[] = [
      { path: OTHER_FILE, content: "spawn('claude', args, {\n  cwd: ctx.cwd,\n  env: ctx.env,\n  stdio: ['pipe', 'pipe', 'pipe'],\n});" },
      { path: OTHER_FILE, content: "const proc = spawn('claude', buildPreloadArgs(prompt, { model, allowedTools }), { cwd, env });" },
      { path: INTEGRATION_FILE, content: "spawnSync(process.execPath, [opts.cliPath, 'init'], {\n  cwd: opts.cwd,\n  encoding: 'utf-8',\n  env,\n});" },
      { path: OTHER_FILE, content: "execFile('claude', ['-p', 'hi'], { cwd: dir, env: sandbox }, done);" },
      { path: OTHER_FILE, content: "execSync('claude -p hi', { cwd: ctx.cwd, env: ctx.env, encoding: 'utf-8' });" },
      { path: OTHER_FILE, content: 'exec(`cd ${dir} && claude -p hi`, { env: ctx.env, cwd: ctx.cwd }, done);' },
      { path: OTHER_FILE, content: "execSync('/usr/local/bin/claude -p hi', { cwd: ctx.cwd, env: ctx.env });" },
      { path: OTHER_FILE, content: "execSync('timeout 60 npx claude -p hi', { cwd: ctx.cwd, env: ctx.env });" },
      { path: OTHER_FILE, content: "spawn('claude -p hi', { shell: true, cwd: ctx.cwd, env: ctx.env });" },
      { path: OTHER_FILE, content: "execFileSync('/opt/homebrew/bin/claude', ['-p', 'hi'], { cwd: ctx.cwd, env: ctx.env });" },
    ];
    expect(findSpawnViolations(clean)).toEqual([]);
  });

  it('does not report prose, other shell strings, fake-claude shims, or a node child outside the scope', () => {
    const clean: CorpusEntry[] = [
      { path: OTHER_FILE, content: "// spawn('claude', args) would be wrong here\nit(\"spawn('claude', args)\", () => {});" },
      { path: OTHER_FILE, content: "// execSync('claude -p hi') would be wrong here\nit(\"execSync('claude -p hi')\", () => {});" },
      { path: OTHER_FILE, content: "execSync('which claude', { stdio: 'pipe' });" },
      { path: OTHER_FILE, content: "execSync('ls ~/.claude && cat claude.md', { stdio: 'pipe' });" },
      { path: OTHER_FILE, content: "execSync('claude-code --help', { stdio: 'pipe' });" },
      { path: OTHER_FILE, content: "execSync('git commit -m \"claude: fix\"', { cwd: dir, env });" },
      { path: OTHER_FILE, content: "const bin = path.join(shimDir, 'claude');\nexpect(resolveOnPath('claude', p)).toBe(bin);" },
      { path: OTHER_FILE, content: "spawnSync(process.execPath, [CLI, 'init'], { timeout: 1 });" },
      { path: OTHER_FILE, content: "spawn(CLAUDE_BIN, args, {});" },
      { path: OTHER_FILE, content: 'execSync(`echo ${claude} done`);' },
      { path: OTHER_FILE, content: "execSync('curl http://localhost/?a=1&claude=2');" },
      { path: OTHER_FILE, content: "execSync('git log --grep claude');" },
      { path: OTHER_FILE, content: "execSync('ls /usr/local/bin/claude-code');" },
    ];
    expect(findSpawnViolations(clean)).toEqual([]);
  });

  // The forms the header lists under "What a green run does NOT prove". Each is a real limit of
  // the rule, shown here so a reader sees it as written down and a later widening shows up as a
  // change to this table.
  const NOT_MATCHED: ReadonlyArray<readonly [string, string]> = [
    ['a launcher option with a separate value (sudo -u)', "execSync('sudo -u root claude -p hi');"],
    ['a launcher option with a separate value (xargs -n)', "execSync('echo hi | xargs -n 1 claude');"],
    ['a launcher option with a separate value (timeout -k)', "execSync('timeout -k 5 60 claude -p hi');"],
    ['a launcher option with a separate value (env -u)', "execSync('env -u NAME claude -p hi');"],
    ['a launcher the rule does not name (setsid)', "execSync('setsid claude -p hi');"],
    ['a launcher the rule does not name (caffeinate)', "execSync('caffeinate claude -p hi');"],
    ['a launcher given as the program, with claude in the argument array', "spawn('npx', ['claude', '-p', 'hi'], {});"],
    ['sudo given as the program, with claude in the argument array', "spawnSync('sudo', ['claude', '-p', 'hi']);"],
    ['a binary named by a shell variable', "execSync('$CLAUDE_BIN -p hi');"],
    ['a binary named by a command substitution', "execSync('$(which claude) -p hi');"],
    ['a Windows name (claude.cmd)', "execSync('claude.cmd -p hi');"],
    ['a Windows name (claude.exe)', "execSync('claude.exe -p hi');"],
    ['a nested shell in a command string', "execSync('sh -c \"claude -p hi\"');"],
    ['a nested shell in an argument array', "spawn('sh', ['-c', 'claude -p hi'], {});"],
    ['a command string built at run time', 'exec(cmd);'],
    ['a template whose command is a placeholder', 'exec(`${bin} -p hi`);'],
    ['claude on a later line of a template', 'execSync(`echo hi\nclaude -p hi`);'],
    ['a wrapper function', "execa('claude', ['-p', 'hi']);"],
    ['a binary named by a variable', 'spawn(CLAUDE_BIN, args, {});'],
  ];
  for (const [name, content] of NOT_MATCHED) {
    it(`does not match ${name}`, () => {
      expect(collectSpawnSites([{ path: OTHER_FILE, content }])).toEqual([]);
    });
  }

  it('exempts only the exact availability probe in the helper file', () => {
    const probe: CorpusEntry = { path: HELPERS, content: "execSync('claude --version', { stdio: 'pipe', timeout: 5000 });" };
    expect(findSpawnViolations([probe])).toEqual([]);
    expect(collectSpawnSites([probe]).map(site => [site.kind, site.exempt])).toEqual([['claude-shell', true]]);
    // The same text in any other file is a shell-string spawn like the rest.
    const elsewhere = collectSpawnSites([{ path: OTHER_FILE, content: probe.content }]);
    expect(elsewhere.map(site => [site.kind, site.exempt])).toEqual([['claude-shell', false]]);
  });

  it('keeps the availability-probe exemption live: the real helper file still holds exactly that call', () => {
    const exempt = collectSpawnSites(corpus).filter(site => site.exempt);
    expect(exempt.map(site => `${site.path}:${site.kind}`)).toEqual([`${HELPERS}:claude-shell`]);
    expect(exempt[0]!.call).toMatch(/^\(\s*(['"`])claude --version\1\s*[,)]/);
  });

  it('does not report a list of forbidden argv literals: it is not a spawn and not under tests/integration', () => {
    const argvListing =
      "const lean = ['-p', '--model', model, '--effort', effort, '--safe-mode', '--tools', 'Write',\n" +
      `  '--max-turns', '3', '${SKIP_FLAG}', '--output-format', 'text'];\n` +
      `const legacy = ['-p', '--model', model, '--tools', 'Write', '${SKIP_FLAG}', '--output-format', 'text'];`;
    expect(findSpawnViolations([{ path: FORBIDDEN_ARGV_FILE, content: argvListing }])).toEqual([]);
  });

  it('does not report the real forbidden-argv fixture, which holds the literal', () => {
    // The probe above is only meaningful while that file spells the flag.
    const real = corpus.find(entry => entry.path === FORBIDDEN_ARGV_FILE);
    expect(real, `${FORBIDDEN_ARGV_FILE} is missing from the corpus`).toBeDefined();
    expect(real!.content.includes(SKIP_FLAG), 'the file does not spell the flag — the probe above is vacuous').toBe(true);
    expect(findSpawnViolations([real!])).toEqual([]);
  });

  it('masks string and comment bodies and keeps every index', () => {
    const text = "a('x(y', /* z( */ `t(${u})`); // q(\n\"w\\\"(\"";
    const masked = maskLiterals(text);
    expect(masked.length).toBe(text.length);
    expect(masked.split('\n').length).toBe(text.split('\n').length);
    expect(masked.includes('(y')).toBe(false);
    expect(masked.includes('z(')).toBe(false);
    expect(masked.includes('q(')).toBe(false);
    expect(masked.charAt(0)).toBe('a');
  });

  it('turns red when a real spawn site loses env or cwd', () => {
    // Mutate each real site of the real corpus, one key at a time. The probe loops
    // over the whole set the live arm ranges over, not one member of it.
    const sites = collectSpawnSites(corpus).filter(site => !site.exempt);
    expect(sites.length, 'the mutation loop has no site to range over').toBeGreaterThanOrEqual(2);
    for (const site of sites) {
      for (const key of REQUIRED_OPTION_KEYS) {
        const entry = corpus.find(e => e.path === site.path)!;
        const dropped = site.call.replace(new RegExp(`\\b${key}\\b(?::[^,\\n]+)?,`), '');
        expect(dropped, `${site.path}:${site.line}: no \`${key}\` option to drop`).not.toBe(site.call);
        const mutated = entry.content.slice(0, site.start) + dropped + entry.content.slice(site.start + site.call.length);
        const found = findSpawnViolations([{ path: entry.path, content: mutated }]);
        const missing = found.filter(f => f.what.endsWith(`passes no \`${key}\``));
        expect(missing.map(f => f.line), `${site.path}:${site.line}: dropping \`${key}\` must be reported`).toEqual([site.line]);
      }
    }
  });
});
