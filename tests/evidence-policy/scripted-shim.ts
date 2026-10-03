/**
 * tests/evidence-policy/scripted-shim.ts
 *
 * The scripted gh/git fake and the ONE spawn-environment helper for the
 * resolve-evidence-policy.cjs suite.
 *
 * Why a new helper rather than tests/shell-hooks-tracker.test.ts buildRecordingShim:
 * that helper is describe-local, records only the tool NAME, and `exec`s the real
 * binary — so it can count forks but cannot answer for a remote that does not
 * exist. This file keeps its design and nothing else:
 *
 *   ADDITIVE PATH. The fake directory goes in FRONT of the inherited PATH
 *   and nothing is subtracted. "gh unavailable" is therefore a fake that exits 1
 *   with an auth error, never a PATH with gh removed — a farm that dropped a tool
 *   would change the environment instead of observing it, and would silently pick
 *   up whatever gh the machine happens to have.
 *
 *   SCRIPTED ANSWERS. Each fake logs its argv as one `printf '%q '` line and answers
 *   from a per-scenario table keyed on the EXACT argv. An argv the scenario did not
 *   script exits UNSCRIPTED_EXIT, so a resolver that invents a call fails loudly in
 *   the argv log instead of being fed a plausible answer. The fakes themselves are
 *   static (createFakeBin, once per file) and each scenario is a table directory
 *   (buildScriptedShim), named to the fake through $SCRIPTED_SHIM_TABLE.
 *
 * The same ScriptedCall table drives an in-process twin (scriptedExec) for the
 * resolver's injected `deps.exec`, so the fold matrix runs without a subprocess
 * per row while the argv/bounds tests still run the real spawnSync.
 *
 * Environment hygiene: every spawn in tests/evidence-policy/ takes its
 * env from scopedEnv(), which points HOME at a tmp dir — otherwise
 * the developer's real ~/.devflow/manifest.json decides the compliance default —
 * and names its cwd, so none inherits vitest's (the developer's repository). A
 * source guard in resolver.test.ts (collectUnscopedSpawns) fails any spawn call in
 * this directory that skips either.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** The resolver under test — the package's own copy, never ~/.devflow/scripts. */
export const RESOLVER_SCRIPT = path.resolve(
  import.meta.dirname,
  '../../src/assets/scripts/resolve-evidence-policy.cjs',
);

/** The local settings resolver — the package's own copy, never ~/.devflow/scripts. */
export const SETTINGS_SCRIPT = path.resolve(
  import.meta.dirname,
  '../../src/assets/scripts/resolve-settings.cjs',
);

/** The shared per-repo config parser both resolvers require (lib/project-config.cjs). */
export const PROJECT_CONFIG_LIB = path.resolve(
  import.meta.dirname,
  '../../src/assets/scripts/lib/project-config.cjs',
);

/** Exit status a fake returns for an argv no scenario scripted. */
export const UNSCRIPTED_EXIT = 97;

/** Commit identity for the real-git fixtures (git refuses to commit without one). */
const GIT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'devflow-test',
  GIT_AUTHOR_EMAIL: 'devflow-test@example.invalid',
  GIT_COMMITTER_NAME: 'devflow-test',
  GIT_COMMITTER_EMAIL: 'devflow-test@example.invalid',
};

/**
 * Variables the parent may carry that would point a child at the developer's own
 * account or repository. Dropped rather than overridden: a test that needs one
 * passes it explicitly through `extra`.
 */
const INHERITED_LEAKS = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'GH_REPO', 'GH_HOST', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
  'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
] as const;

/**
 * THE spawn environment for this suite. HOME (and so the devflow machine root,
 * `$HOME/.devflow`) and the git/gh config roots all point under `home`, a tmp dir
 * the test owns.
 */
export function scopedEnv(
  home: string,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of INHERITED_LEAKS) delete env[key];
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    ...GIT_IDENTITY,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The scripted call table
// ---------------------------------------------------------------------------

export type Tool = 'gh' | 'git';

/** One scripted answer: an exact argv and what the fake does when it sees it. */
export interface ScriptedCall {
  readonly tool: Tool;
  readonly args: readonly string[];
  readonly stdout?: string | Buffer;
  readonly stderr?: string;
  readonly exit?: number;
  /**
   * In-process twin only: a spawn-level failure (ENOENT, ETIMEDOUT) that no bash
   * fake can produce. buildScriptedShim refuses a table that carries one.
   */
  readonly spawnError?: string;
}

/**
 * The resolver's exact argv, written out here independently of the script. The
 * `*Project` entries read `.devflow/project.json`, which every source consults
 * first; the others probe the retired `.devflow/policy.json` for presence where
 * project.json has no `evidence` (D-POLICY-SOURCE-PRECEDENCE, D-POLICY-JSON-RETIRED).
 */
export const ARGV = {
  toplevel: ['rev-parse', '--show-toplevel'],
  probe: ['api', 'repos/{owner}/{repo}', '--jq', '.default_branch'],
  contents: (ref: string): string[] => [
    'api', '--method', 'GET', 'repos/{owner}/{repo}/contents/.devflow/policy.json',
    '-f', `ref=${ref}`, '-H', 'Accept: application/vnd.github.raw+json',
  ],
  contentsProject: (ref: string): string[] => [
    'api', '--method', 'GET', 'repos/{owner}/{repo}/contents/.devflow/project.json',
    '-f', `ref=${ref}`, '-H', 'Accept: application/vnd.github.raw+json',
  ],
  headBlob: ['cat-file', 'blob', 'HEAD:.devflow/policy.json'],
  headProjectBlob: ['cat-file', 'blob', 'HEAD:.devflow/project.json'],
  lsRemote: ['ls-remote', '--symref', 'origin', 'HEAD'],
  verifyTracking: (ref: string): string[] => ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}`],
  trackingBlob: (ref: string): string[] => ['cat-file', 'blob', `refs/remotes/origin/${ref}:.devflow/policy.json`],
  trackingProjectBlob: (ref: string): string[] => [
    'cat-file', 'blob', `refs/remotes/origin/${ref}:.devflow/project.json`,
  ],
} as const;

const FAKE_SHA = '0123456789abcdef0123456789abcdef01234567';

/** A git blob's scripted state: its bytes, or absent at that revision. */
export type Blob = { readonly bytes: string | Buffer } | 'absent';

/**
 * A remote/local layout, described in the resolver's own vocabulary.
 *
 * `defaultBranch` undefined ⇒ the gh probe fails like an unauthenticated gh.
 * `lsRemoteBranch` undefined ⇒ `git ls-remote` fails.
 *
 * The `*Project` fields are each source's `.devflow/project.json` — the file
 * that carries the evidence policy. The unsuffixed fields are the same sources'
 * retired `.devflow/policy.json`, which the resolver probes for presence only:
 * `remote` is its contents call's answer — bytes, `'absent'` (the verified gh 404
 * shape: JSON body on STDOUT, `(HTTP 404)` on stderr, exit 1) or `'forbidden'` (a
 * 403, which must read as unavailable, never absent — and which the project.json
 * call, made first, then answers too: a 403 is repository-wide). `tracking` is
 * refs/remotes/origin/<D>: a blob at an existing ref, or `'no-ref'`.
 *
 * Every file defaults to absent whenever its source is read: the default branch
 * answers a 404 for both files, and HEAD and the tracking ref hold neither blob.
 * A `trackingProject` alone therefore implies the tracking ref exists.
 */
export interface Scenario {
  readonly root: string;
  readonly defaultBranch?: string;
  readonly remote?: Blob | 'forbidden';
  readonly remoteProject?: Blob | 'forbidden';
  readonly head?: Blob;
  readonly headProject?: Blob;
  readonly lsRemoteBranch?: string;
  readonly tracking?: Blob | 'no-ref';
  readonly trackingProject?: Blob;
}

function blobAnswer(tool: Tool, args: readonly string[], blob: Blob): ScriptedCall {
  return blob === 'absent'
    ? { tool, args, exit: 128, stderr: "fatal: path '.devflow/policy.json' does not exist in 'HEAD'\n" }
    : { tool, args, stdout: blob.bytes, exit: 0 };
}

/** A contents call's scripted answer: bytes, the verified 404 shape, or a 403. */
function contentsAnswer(args: readonly string[], answer: Blob | 'forbidden'): ScriptedCall {
  if (answer === 'forbidden') return { tool: 'gh', args, exit: 1, stderr: 'gh: API rate limit exceeded (HTTP 403)\n' };
  if (answer === 'absent') {
    return {
      tool: 'gh', args, exit: 1,
      stdout: '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}',
      stderr: 'gh: Not Found (HTTP 404)\n',
    };
  }
  return { tool: 'gh', args, stdout: answer.bytes };
}

/** Expand a Scenario into the scripted calls the resolver may make against it. */
export function scenarioCalls(s: Scenario): ScriptedCall[] {
  const calls: ScriptedCall[] = [
    { tool: 'git', args: ARGV.toplevel, stdout: `${s.root}\n` },
    s.defaultBranch === undefined
      ? {
        tool: 'gh', args: ARGV.probe, exit: 1,
        stderr: 'To get started with GitHub CLI, please run:  gh auth login\n',
      }
      : { tool: 'gh', args: ARGV.probe, stdout: `${s.defaultBranch}\n` },
    s.lsRemoteBranch === undefined
      ? {
        tool: 'git', args: ARGV.lsRemote, exit: 128,
        stderr: "fatal: 'origin' does not appear to be a git repository\n",
      }
      : { tool: 'git', args: ARGV.lsRemote, stdout: `ref: refs/heads/${s.lsRemoteBranch}\tHEAD\n${FAKE_SHA}\tHEAD\n` },
  ];

  if (s.defaultBranch !== undefined) {
    const project = s.remoteProject ?? (s.remote === 'forbidden' ? 'forbidden' : 'absent');
    calls.push(contentsAnswer(ARGV.contentsProject(s.defaultBranch), project));
    calls.push(contentsAnswer(ARGV.contents(s.defaultBranch), s.remote ?? 'absent'));
  }

  if (s.head !== undefined || s.headProject !== undefined) {
    calls.push(blobAnswer('git', ARGV.headProjectBlob, s.headProject ?? 'absent'));
    calls.push(blobAnswer('git', ARGV.headBlob, s.head ?? 'absent'));
  }

  const trackedRef = s.defaultBranch ?? s.lsRemoteBranch;
  const tracking = s.tracking ?? (s.trackingProject !== undefined ? 'absent' : undefined);
  if (tracking !== undefined && trackedRef !== undefined) {
    if (tracking === 'no-ref') {
      calls.push({ tool: 'git', args: ARGV.verifyTracking(trackedRef), exit: 1 });
    } else {
      calls.push({ tool: 'git', args: ARGV.verifyTracking(trackedRef), stdout: `${FAKE_SHA}\n` });
      calls.push(blobAnswer('git', ARGV.trackingProjectBlob(trackedRef), s.trackingProject ?? 'absent'));
      calls.push(blobAnswer('git', ARGV.trackingBlob(trackedRef), tracking));
    }
  }
  return calls;
}

// ---------------------------------------------------------------------------
// The on-disk fake (bash) — for the subprocess tests
// ---------------------------------------------------------------------------

/** The env var through which a static fake finds its scenario table. */
const TABLE_ENV = 'SCRIPTED_SHIM_TABLE';

/** Most scripted answers per tool in one table — the fake's lookup loop is bounded by it. */
const MAX_TABLE_ROWS = 64;

/** A directory of static fake executables, to put in front of PATH. */
export interface FakeBin {
  readonly dir: string;
}

/**
 * Write the static `gh` and/or `git` fakes ONCE (per test file, in beforeAll).
 *
 * The fakes are fixed scripts that read their answers from the table directory
 * named by $SCRIPTED_SHIM_TABLE, so a scenario is data, never a new executable:
 * macOS scans every newly written executable on its first run (~0.4 s each),
 * which a per-test fake would pay on every call. `tools` limits which fakes
 * exist, so a real-git fixture can fake gh alone.
 *
 * Lookup: row i is `<tool>.<i>.key` (the argv joined by spaces), `.out`, `.err`
 * and `.code`; the first key equal to "$*" answers. Keys and codes are read with
 * the `read` builtin (no fork); the loop stops at the first missing row and never
 * runs past MAX_TABLE_ROWS. An argv no row matches exits UNSCRIPTED_EXIT.
 */
export function createFakeBin(base: string, tools: readonly Tool[] = ['gh', 'git']): FakeBin {
  const dir = fs.mkdtempSync(path.join(base, 'fake-bin-'));
  for (const tool of tools) {
    const script = [
      '#!/bin/bash',
      `T="\${${TABLE_ENV}:?scripted-shim: ${TABLE_ENV} is not set}"`,
      `LINE=$(printf '%q ' ${tool} "$@")`,
      `printf '%s\\n' "$LINE" >> "$T/argv.log"`,
      'KEY="$*"',
      'i=0',
      `while [ "$i" -lt ${MAX_TABLE_ROWS} ] && [ -f "$T/${tool}.$i.key" ]; do`,
      `  IFS= read -r K < "$T/${tool}.$i.key" || true`,
      '  if [ "$KEY" = "$K" ]; then',
      `    IFS= read -r C < "$T/${tool}.$i.code" || true`,
      `    cat "$T/${tool}.$i.out"`,
      `    cat "$T/${tool}.$i.err" >&2`,
      '    exit "$C"',
      '  fi',
      '  i=$((i + 1))',
      'done',
      `printf 'scripted-shim: unscripted ${tool} call\\n' >&2`,
      `exit ${UNSCRIPTED_EXIT}`,
    ].join('\n');
    const fake = path.join(dir, tool);
    fs.writeFileSync(fake, `${script}\n`);
    fs.chmodSync(fake, 0o755);
  }
  return { dir };
}

/**
 * Most one warm-up exec may take: the top of the measured syspolicyd stall
 * (NODE_EXEC_STALL_MS, 7 s) with room for a queue behind it. A test file's
 * beforeAll that warms passes WARM_HOOK_TIMEOUT_MS, which covers two fakes.
 */
const WARM_EXEC_TIMEOUT_MS = 15_000;
export const WARM_HOOK_TIMEOUT_MS = 40_000;

/**
 * Run every fake in `bin` once, against an empty table (each exits
 * UNSCRIPTED_EXIT), so the first-exec cost is paid here and never inside a
 * resolver call. macOS scans a newly written executable on its first run —
 * ~0.2 s alone, several seconds with syspolicyd queued under the full suite —
 * and the resolvers bound each git call at 5 s (GIT_LOCAL_TIMEOUT_MS,
 * GIT_TIMEOUT_MS), so an unwarmed first fake could time out, read as "git did
 * not answer" and fail the row closed (exit 4) though the resolver was right.
 * Throws (a setup failure) when a fake does not answer as scripted.
 */
export function warmFakeBin(bin: FakeBin, home: string): void {
  const empty = fs.mkdtempSync(path.join(bin.dir, '..', 'warm-table-'));
  for (const tool of fs.readdirSync(bin.dir)) {
    const r = spawnSync(path.join(bin.dir, tool), ['warm-up'], {
      cwd: home,
      env: scopedEnv(home, { [TABLE_ENV]: empty }),
      stdio: 'ignore',
      timeout: WARM_EXEC_TIMEOUT_MS,
    });
    if (r.status !== UNSCRIPTED_EXIT) {
      throw new Error(`scripted-shim: warm-up of ${tool} did not answer (${r.status}, ${r.error?.message ?? r.signal})`);
    }
  }
}

export interface ScriptedShim {
  /** Prepend this to PATH. */
  readonly dir: string;
  /** Merge this into the child env: it names the scenario table. */
  readonly env: Readonly<Record<string, string>>;
  readonly logPath: string;
  /** Every logged call as [tool, ...argv], decoded from the `%q` log. */
  readLog(): string[][];
}

/**
 * Write one scenario's table for the fakes in `bin` (first exact match wins, per
 * tool, in `calls` order).
 */
export function buildScriptedShim(bin: FakeBin, base: string, calls: readonly ScriptedCall[]): ScriptedShim {
  const table = fs.mkdtempSync(path.join(base, 'table-'));
  const logPath = path.join(table, 'argv.log');
  const rows: Record<Tool, number> = { gh: 0, git: 0 };

  for (const c of calls) {
    if (c.spawnError !== undefined) {
      throw new Error(`scripted-shim: spawnError (${c.spawnError}) is in-process only`);
    }
    const exit = c.exit ?? 0;
    if (!Number.isInteger(exit) || exit < 0 || exit > 255) {
      throw new Error(`scripted-shim: exit ${exit} is not a shell status`);
    }
    const key = c.args.join(' ');
    if (/[\n\r]/.test(key)) throw new Error('scripted-shim: an argv key cannot hold a line break');
    const i = rows[c.tool]++;
    if (i >= MAX_TABLE_ROWS) throw new Error(`scripted-shim: more than ${MAX_TABLE_ROWS} ${c.tool} rows`);
    const stem = path.join(table, `${c.tool}.${i}`);
    fs.writeFileSync(`${stem}.key`, key);
    fs.writeFileSync(`${stem}.code`, String(exit));
    fs.writeFileSync(`${stem}.out`, c.stdout ?? '');
    fs.writeFileSync(`${stem}.err`, c.stderr ?? '');
  }

  return {
    dir: bin.dir,
    env: { [TABLE_ENV]: table },
    logPath,
    readLog: () => (fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(decodeQuotedArgv)
      : []),
  };
}

/**
 * Decode one `printf '%q '` line back into argv. Handles the two forms bash emits
 * for the resolver's argv — backslash escapes and quoted segments (`''` for an
 * empty argument). `$'…'` (control characters) is refused: the resolver never puts
 * file or remote bytes into argv, so meeting one means something is badly wrong.
 */
export function decodeQuotedArgv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[i + 1];
      i++;
      inToken = true;
    } else if (ch === '$' && line[i + 1] === "'") {
      throw new Error(`scripted-shim: control-character argv in the log: ${line}`);
    } else if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) throw new Error(`scripted-shim: unterminated quote in the log: ${line}`);
      cur += line.slice(i + 1, end);
      i = end;
      inToken = true;
    } else if (ch === ' ') {
      if (inToken) out.push(cur);
      cur = '';
      inToken = false;
    } else {
      cur += ch;
      inToken = true;
    }
  }
  if (inToken) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// The in-process twin — for deps.exec
// ---------------------------------------------------------------------------

/** The spawnSync subset the resolver reads (transcribed from its ExecResult JSDoc). */
export interface ExecResult {
  readonly status: number | null;
  readonly stdout?: Buffer | string;
  readonly stderr?: Buffer | string;
  readonly error?: { readonly code?: string };
}

export type ExecFn = (file: string, args: string[], opts: Record<string, unknown>) => ExecResult;

export interface RecordedCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly opts: Readonly<Record<string, unknown>>;
}

/**
 * The same table as buildScriptedShim, answered in-process. Mirrors spawnSync on
 * the one bound the resolver relies on: stdout over `opts.maxBuffer` returns
 * ENOBUFS with a null status.
 */
export function scriptedExec(calls: readonly ScriptedCall[]): { exec: ExecFn; recorded: RecordedCall[] } {
  const recorded: RecordedCall[] = [];
  const exec: ExecFn = (file, args, opts) => {
    recorded.push({ file, args: [...args], opts });
    const hit = calls.find(c => c.tool === file
      && c.args.length === args.length
      && c.args.every((a, i) => a === args[i]));
    if (hit === undefined) {
      return { status: UNSCRIPTED_EXIT, stdout: Buffer.alloc(0), stderr: Buffer.from('scripted-shim: unscripted\n') };
    }
    if (hit.spawnError !== undefined) {
      return { status: null, error: { code: hit.spawnError } };
    }
    const stdout = Buffer.from(hit.stdout ?? '');
    const maxBuffer = typeof opts.maxBuffer === 'number' ? opts.maxBuffer : Number.POSITIVE_INFINITY;
    if (stdout.length > maxBuffer) {
      return { status: null, stdout, stderr: Buffer.alloc(0), error: { code: 'ENOBUFS' } };
    }
    return { status: hit.exit ?? 0, stdout, stderr: Buffer.from(hit.stderr ?? '') };
  };
  return { exec, recorded };
}

// ---------------------------------------------------------------------------
// Subprocess runners — every spawn passes through scopedEnv()
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** The tmp dir that becomes HOME (and holds the machine root, `.devflow`). */
  readonly home: string;
  /** Arguments after the script path. */
  readonly args: readonly string[];
  readonly cwd?: string;
  /** A scripted shim: its fake dir goes in front of PATH and its table env is merged in. */
  readonly shim?: Pick<ScriptedShim, 'dir' | 'env'>;
  /** Node options before the script, e.g. `['--require', preload]`. */
  readonly nodeArgs?: readonly string[];
  /** The script to run — defaults to the package copy; the install pin passes the installed one. */
  readonly script?: string;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

/** Run the resolver under process.execPath (PATH may be shimmed, so never a bare `node`). */
export function runResolver(o: RunOptions): RunResult {
  const shimEnv: Record<string, string> = o.shim === undefined
    ? {}
    : { ...o.shim.env, PATH: `${o.shim.dir}${path.delimiter}${process.env.PATH ?? ''}` };
  const r = spawnSync(process.execPath, [...(o.nodeArgs ?? []), o.script ?? RESOLVER_SCRIPT, ...o.args], {
    cwd: o.cwd ?? o.home,
    env: scopedEnv(o.home, { ...shimEnv, ...(o.extraEnv ?? {}) }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

/** Run a real git command for a fixture; throws (test-setup failure) on non-zero. */
export function realGit(cwd: string, home: string, args: readonly string[]): string {
  const r = spawnSync('git', [...args], {
    cwd,
    env: scopedEnv(home),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20_000,
  });
  if (r.status !== 0) throw new Error(`fixture: git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  return r.stdout;
}

// ---------------------------------------------------------------------------
// Spawn hygiene — the one collector both evidence suites run
// ---------------------------------------------------------------------------

const SPAWN_RE = /(?:spawnSync|execFileSync|execSync)\(/g;

/**
 * Named collector: every spawn call in a source whose argument list does not
 * pass through scopedEnv() or does not name a `cwd` (an inherited cwd is the
 * developer's repository). The argument list is taken paren-balanced from the
 * call site, bounded to 2000 characters; comment lines are stripped first.
 */
export function collectUnscopedSpawns(source: string): string[] {
  const code = source.split('\n')
    .map(l => (/^\s*(\*|\/\/|\/\*)/.test(l) ? '' : l))
    .join('\n');
  const offenders: string[] = [];
  for (const m of code.matchAll(SPAWN_RE)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length && i < open + 2000; i++) {
      if (code[i] === '(') depth++;
      if (code[i] === ')') depth--;
      if (depth === 0) { close = i; break; }
    }
    const call = code.slice(m.index, close === -1 ? open + 2000 : close + 1);
    if (!call.includes('scopedEnv(') || !/\bcwd\b/.test(call)) offenders.push(call.split('\n')[0].trim());
  }
  return offenders;
}

/** The spawn call sites in a source — the corpus the collector above reads. */
export function countSpawnSites(source: string): number {
  return [...source.matchAll(SPAWN_RE)].length;
}

/** Create a FIFO for the never-opened test; returns false where mkfifo is unavailable. */
export function makeFifo(fifoPath: string, home: string): boolean {
  const r = spawnSync('mkfifo', [fifoPath], {
    cwd: home,
    env: scopedEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  return r.status === 0;
}
