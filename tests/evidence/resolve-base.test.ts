/**
 * tests/evidence/resolve-base.test.ts
 *
 * Suite for src/assets/scripts/resolve-base.cjs, the plumbing that picks the base for a
 * branch diff (#495: use a fresh base for branch diffs, tighten branch-name validation).
 * It fetches the base branch once, chooses the tip by the local or the PR rule, and prints
 * ONE line: BASE_REF (a verified commit id, or none), TIP, FETCH, REASON, NOTE.
 *
 *   AC-1  A stale local base: BASE_REF lists only the files the branch changed.
 *   AC-2  The local rule (fork point) over fresh, stale, diverged, local-ahead, local-absent
 *         and origin-absent bases, slash names included.
 *   AC-3  The PR rule: origin whenever it resolves (fresh or cached), otherwise local.
 *   AC-5  Fetch outcomes: no origin, missing remote branch, failure with and without a
 *         cached ref, a held lock (no retry), a cross-repository PR (no fetch).
 *   AC-6  One line matching the exported LINE_RE, exit 0, a verified 40- or 64-hex BASE_REF.
 *   AC-7  The strict name class, then check-ref-format: invalid-name, no fetch, no name echoed.
 *   AC-11 The local branch, HEAD, index and worktree stay unchanged; no FETCH_HEAD, tag,
 *         promisor setting or shallow file appears.
 *   AC-12/13/14 live in resolve-base-process.test.ts (argv, environment, process group).
 *   The name on standard input (--name-stdin): the read, its cap and its refusals, the checks that
 *         run before any other git call, and the argument form that never reads, are tested below
 *         through an injected descriptor and over real git.
 *
 * Scenario letters used by the tables below (the local rule):
 *   A fresh         local base and origin base are the same commit
 *   B stale         the branch was cut from origin's tip while the local base stayed behind
 *   C diverged      the local base and origin each hold commits the other lacks
 *   D local-ahead   the local base holds commits origin lacks
 *   E local-absent  only origin has the base branch
 *   F origin-absent only the local repository has the base branch
 *
 * Two harnesses drive the same module: main() in-process over real git in temporary
 * repositories (a bare origin plus clones), and the real script under process.execPath.
 * Every spawn is scoped to a temporary HOME and names its cwd; the real repository's refs
 * are never touched. Most of the matrix runs against the pure select() over observed facts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { RESOLVE_BASE_SCRIPT, SUBPROCESS_TIMEOUT_MS } from './seam.js'
import { realGit, scopedEnv } from '../evidence-policy/scripted-shim.js'

// ---------------------------------------------------------------------------
// The .cjs seam: transcribed from the module's JSDoc; open it before changing
// ---------------------------------------------------------------------------

type Mode = 'local' | 'pr'
type FetchState = 'ok' | 'failed' | 'skipped'
type TipName = 'origin' | 'local' | 'none'
type Reason =
  | 'fresh' | 'kept-local-ahead' | 'no-remote-branch'
  | 'fork-origin' | 'no-origin'
  | 'fetch-failed' | 'timeout'
  | 'invalid-name' | 'no-merge-base' | 'no-ref' | 'usage' | 'resolver-unavailable'
type Note = 'none' | 'info' | 'degraded' | 'stop'

interface Side { readonly base: string | null }
interface Facts {
  readonly mode: Mode
  readonly skip: null | 'no-origin' | 'fork-origin'
  readonly fetch: { readonly state: FetchState; readonly reason: null | 'fetch-failed' | 'timeout' | 'no-remote-branch' }
  readonly local: Side | null
  readonly remote: Side | null
  readonly localBehind: boolean | null
}
interface Selection { baseRef: string; tip: TipName; fetch: FetchState; reason: Reason }
interface SpawnResult {
  status: number | null
  stdout?: string | Buffer
  stderr?: string | Buffer
  error?: { code?: string }
  pid?: number
}
type SpawnFn = (file: string, args: string[], opts: Record<string, unknown>) => SpawnResult
/** The three operations on file descriptor 0 that the script performs; each is replaceable in a test. */
interface StdinPort {
  isatty(): boolean
  read(buf: Buffer, offset: number, length: number): number
  wait(ms: number): void
}
interface Deps {
  spawn?: SpawnFn
  env?: NodeJS.ProcessEnv
  cwd?: string
  fetchTimeoutMs?: number
  now?: () => number
  stdin?: Partial<StdinPort>
  formatLine?: (r: Selection) => string
}
interface ResolveBase {
  readonly STRICT_NAME_RE: RegExp
  readonly LINE_RE: RegExp
  readonly FALLBACK_LINE: string
  readonly FETCH_TIMEOUT_MS: number
  readonly RUN_BUDGET_MS: number
  readonly REASON_NOTES: Readonly<Record<Reason, Note>>
  isStrictName(name: unknown): boolean
  parseArgs(args: readonly string[]):
    | { kind: 'ok'; mode: Mode; name: string; cross: boolean }
    | { kind: 'stdin'; mode: Mode; cross: boolean }
    | { kind: 'usage' }
  select(facts: Facts): Selection
  formatLine(r: Selection): string
  checkLine(line: unknown): boolean
  main(argv: readonly string[], deps?: Deps): { code: number; line: string }
}

const req = createRequire(import.meta.url)
const RB = req(RESOLVE_BASE_SCRIPT) as ResolveBase

const SPAWN_BUDGET = { timeout: SUBPROCESS_TIMEOUT_MS } as const

const HEX_A = 'a'.repeat(40)
const HEX_B = 'b'.repeat(40)
const HEX_C = 'c'.repeat(40)

// ---------------------------------------------------------------------------
// The pure parts: grammar, name class, argv, selection
// ---------------------------------------------------------------------------

/** Mirrors REASON_NOTES in the script; the grammar test below fails when the two differ. */
const NOTE_TABLE: Readonly<Record<Note, readonly Reason[]>> = {
  none: ['fresh', 'kept-local-ahead', 'no-remote-branch'],
  info: ['fork-origin', 'no-origin'],
  degraded: ['fetch-failed', 'timeout'],
  stop: ['invalid-name', 'no-merge-base', 'no-ref', 'usage', 'resolver-unavailable'],
}

const ALL_REASONS: readonly Reason[] = Object.values(NOTE_TABLE).flat()

describe('the output grammar (AC-6)', () => {
  const ok = (over: Partial<Record<string, string>> = {}): string => {
    const f = { BASE_REF: HEX_A, TIP: 'origin', FETCH: 'ok', REASON: 'fresh', NOTE: 'none', ...over }
    return `BASE_REF=${f.BASE_REF} TIP=${f.TIP} FETCH=${f.FETCH} REASON=${f.REASON} NOTE=${f.NOTE}`
  }

  it('accepts a 40-hex and a 64-hex BASE_REF and the literal none, and nothing else', () => {
    expect(RB.LINE_RE.test(ok())).toBe(true)
    expect(RB.LINE_RE.test(ok({ BASE_REF: 'f'.repeat(64) }))).toBe(true)
    expect(RB.LINE_RE.test(ok({ BASE_REF: 'none', TIP: 'none', REASON: 'no-ref', NOTE: 'stop' }))).toBe(true)
    for (const bad of ['a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'A'.repeat(40), 'g'.repeat(40), '', 'None', 'main']) {
      expect(RB.LINE_RE.test(ok({ BASE_REF: bad })), `BASE_REF=${bad}`).toBe(false)
    }
  })

  it('is anchored: extra text, a second line, a missing field or an unknown word is refused', () => {
    expect(RB.LINE_RE.test(`${ok()} `)).toBe(false)
    expect(RB.LINE_RE.test(` ${ok()}`)).toBe(false)
    expect(RB.LINE_RE.test(`${ok()}\n`)).toBe(false)
    expect(RB.LINE_RE.test(`${ok()}\n${ok()}`)).toBe(false)
    expect(RB.LINE_RE.test(ok().replace(' NOTE=none', ''))).toBe(false)
    expect(RB.LINE_RE.test(ok({ TIP: 'remote' }))).toBe(false)
    expect(RB.LINE_RE.test(ok({ FETCH: 'cached' }))).toBe(false)
    expect(RB.LINE_RE.test(ok({ REASON: 'stale' }))).toBe(false)
    expect(RB.LINE_RE.test(ok({ NOTE: 'warn' }))).toBe(false)
  })

  it('has the REASON to NOTE table of the contract, and a grammar word for every reason', () => {
    for (const [note, reasons] of Object.entries(NOTE_TABLE)) {
      for (const reason of reasons) expect(RB.REASON_NOTES[reason], reason).toBe(note)
    }
    expect(Object.keys(RB.REASON_NOTES).sort()).toEqual([...ALL_REASONS].sort())
    for (const reason of ALL_REASONS) {
      const stop = RB.REASON_NOTES[reason] === 'stop'
      const line = ok({
        BASE_REF: stop ? 'none' : HEX_A,
        TIP: stop ? 'none' : 'origin',
        REASON: reason,
        NOTE: RB.REASON_NOTES[reason],
        FETCH: reason === 'fresh' || reason === 'kept-local-ahead' ? 'ok'
          : ['fetch-failed', 'timeout', 'no-remote-branch'].includes(reason) ? 'failed' : 'skipped',
      })
      expect(RB.LINE_RE.test(line), reason).toBe(true)
      expect(RB.checkLine(line), reason).toBe(true)
    }
  })

  it('is checked for consistency before it is printed: a freshness claim needs an ok fetch', () => {
    expect(RB.checkLine(ok())).toBe(true)
    expect(RB.checkLine(ok({ FETCH: 'skipped' }))).toBe(false)
    expect(RB.checkLine(ok({ FETCH: 'failed' }))).toBe(false)
    expect(RB.checkLine(ok({ NOTE: 'degraded' }))).toBe(false)
    expect(RB.checkLine(ok({ BASE_REF: 'none' }))).toBe(false)
    expect(RB.checkLine(ok({ REASON: 'no-ref', NOTE: 'stop' }))).toBe(false)
    expect(RB.checkLine(ok({ BASE_REF: 'none', TIP: 'none', REASON: 'no-ref', NOTE: 'stop', FETCH: 'failed' }))).toBe(true)
    expect(RB.checkLine(ok({ BASE_REF: 'none', TIP: 'origin', REASON: 'no-ref', NOTE: 'stop' }))).toBe(false)
    expect(RB.checkLine(undefined)).toBe(false)
    expect(RB.checkLine(42)).toBe(false)
  })

  it('exports the fallback literal, which is itself a conforming stop', () => {
    expect(RB.FALLBACK_LINE).toBe('BASE_REF=none TIP=none FETCH=skipped REASON=resolver-unavailable NOTE=stop')
    expect(RB.LINE_RE.test(RB.FALLBACK_LINE)).toBe(true)
    expect(RB.checkLine(RB.FALLBACK_LINE)).toBe(true)
  })
})

/** Names the strict class admits, and names it refuses. */
const ACCEPTED = [
  'main', 'master', 'develop', 'release/1.2', 'feature/a-b_c', 'fix/495-x', 'user/jane+tag', 'v1.0.0',
  'a,b', 'a#b', 'x@y', 'a.b', 'A', '0', 'a/b/c', 'origin', 'originx/y', 'HEADx', 'xHEAD', 'FETCH_HEADS',
  'a'.repeat(200),
]
const REFUSED = [
  '', '-x', '--help', '-', '#x', '#', 'origin/main', 'origin/', 'a..b', '..', 'a/../b', '@', 'HEAD', 'FETCH_HEAD',
  'ORIG_HEAD', 'MERGE_HEAD', 'a b', 'a\tb', 'a\nb', 'a\rb', 'a\0b', 'a;b', 'a|b', 'a&b', 'a$b', '$(id)', '`id`',
  'a"b', "a'b", 'a\\b', 'a*b', 'a?b', 'a[b', 'a{b}', 'a:b', 'a~b', 'a^b', 'a!b', 'a<b', 'a>b', 'a(b', 'a)b',
  'a=b', 'a%b', 'é', 'a\u202eb', 'a'.repeat(201), 'main\n',
]

describe('the strict name class (AC-7)', () => {
  it('admits the closed set: ASCII letters, digits and ._/+@,#-, at most 200', () => {
    for (const name of ACCEPTED) expect(RB.STRICT_NAME_RE.test(name), JSON.stringify(name)).toBe(true)
    for (const name of ACCEPTED) expect(RB.isStrictName(name), JSON.stringify(name)).toBe(true)
  })

  it('refuses a leading - or #, an origin/ prefix, "..", the lone names @ and HEAD, and every other character', () => {
    for (const name of REFUSED) expect(RB.STRICT_NAME_RE.test(name), JSON.stringify(name)).toBe(false)
    for (const name of REFUSED) expect(RB.isStrictName(name), JSON.stringify(name)).toBe(false)
  })

  it('refuses a value that is not a string', () => {
    for (const value of [null, undefined, 12, true, ['main'], { toString: () => 'main' }]) {
      expect(RB.isStrictName(value)).toBe(false)
    }
  })

  it('is one literal with the documented source', () => {
    expect(RB.STRICT_NAME_RE.source).toBe(
      String.raw`^(?![-#]|origin\/|(?:@|(?:FETCH_|ORIG_|MERGE_)?HEAD)$)(?!.*\.\.)[A-Za-z0-9._\/+@,#-]{1,200}$`,
    )
    expect(RB.STRICT_NAME_RE.flags).toBe('')
  })
})

describe('the arguments (usage)', () => {
  it('reads <local|pr> <name> and an optional --cross <true|false>', () => {
    expect(RB.parseArgs(['local', 'main'])).toEqual({ kind: 'ok', mode: 'local', name: 'main', cross: false })
    expect(RB.parseArgs(['pr', 'release/1.2', '--cross', 'true'])).toEqual({ kind: 'ok', mode: 'pr', name: 'release/1.2', cross: true })
    expect(RB.parseArgs(['pr', 'main', '--cross', 'false'])).toEqual({ kind: 'ok', mode: 'pr', name: 'main', cross: false })
  })

  it('hands any name to the later checks, including an empty one and one that looks like an option', () => {
    expect(RB.parseArgs(['local', ''])).toMatchObject({ kind: 'ok', name: '' })
    expect(RB.parseArgs(['local', '--cross'])).toMatchObject({ kind: 'ok', name: '--cross' })
  })

  it('is a usage result for every other shape', () => {
    const bad: string[][] = [
      [], ['local'], ['fork', 'main'], ['LOCAL', 'main'], ['local', 'main', 'extra'], ['local', 'main', '--cross'],
      ['local', 'main', '--cross', 'yes'], ['local', 'main', '--cross', 'true', 'x'], ['local', 'main', '--other', 'true'],
    ]
    for (const args of bad) expect(RB.parseArgs(args), JSON.stringify(args)).toEqual({ kind: 'usage' })
  })

  it('reads <local|pr> --name-stdin and an optional --cross <true|false> as the standard-input form', () => {
    expect(RB.parseArgs(['local', '--name-stdin'])).toEqual({ kind: 'stdin', mode: 'local', cross: false })
    expect(RB.parseArgs(['pr', '--name-stdin'])).toEqual({ kind: 'stdin', mode: 'pr', cross: false })
    expect(RB.parseArgs(['pr', '--name-stdin', '--cross', 'true'])).toEqual({ kind: 'stdin', mode: 'pr', cross: true })
    expect(RB.parseArgs(['local', '--name-stdin', '--cross', 'false'])).toEqual({ kind: 'stdin', mode: 'local', cross: false })
  })

  it('is a usage result when --name-stdin is mixed with a positional name or any other shape', () => {
    const bad: string[][] = [
      ['--name-stdin'], ['local', 'main', '--name-stdin'], ['local', '--name-stdin', 'main'], ['pr', 'main', '--name-stdin', 'true'],
      ['local', '--name-stdin', '--cross'], ['local', '--name-stdin', '--cross', 'yes'], ['local', '--name-stdin', '--cross', 'true', 'x'],
      ['local', 'main', '--cross', '--name-stdin'], ['local', '--name-stdin', '--name-stdin'], ['fork', '--name-stdin'],
      ['LOCAL', '--name-stdin'], ['local', '--name-stdin', '--other', 'true'], ['local', '--name-stdin', 'main', '--cross', 'true'],
    ]
    for (const args of bad) expect(RB.parseArgs(args), JSON.stringify(args)).toEqual({ kind: 'usage' })
  })
})

describe('select(): the rule over observed facts (AC-2, AC-3, AC-5)', () => {
  const okFetch = { state: 'ok', reason: null } as const
  const failed = (reason: 'fetch-failed' | 'timeout' | 'no-remote-branch') => ({ state: 'failed', reason }) as const
  const none = { state: 'skipped', reason: null } as const
  const facts = (over: Partial<Facts>): Facts => ({
    mode: 'local', skip: null, fetch: okFetch, local: { base: HEX_A }, remote: { base: HEX_A }, localBehind: true, ...over,
  })

  interface Row { readonly name: string; readonly facts: Facts; readonly want: Selection }
  const pick = (baseRef: string, tip: TipName, fetch: FetchState, reason: Reason): Selection => ({ baseRef, tip, fetch, reason })
  const stop = (fetch: FetchState, reason: Reason): Selection => pick('none', 'none', fetch, reason)

  const LOCAL_ROWS: readonly Row[] = [
    { name: 'A fresh: same fork point on both sides', facts: facts({}), want: pick(HEX_A, 'origin', 'ok', 'fresh') },
    { name: 'B stale: the local fork point is an ancestor of origin\'s', facts: facts({ remote: { base: HEX_B }, localBehind: true }), want: pick(HEX_B, 'origin', 'ok', 'fresh') },
    { name: 'C diverged: the local fork point is not an ancestor of origin\'s', facts: facts({ local: { base: HEX_B }, remote: { base: HEX_A }, localBehind: false }), want: pick(HEX_B, 'local', 'ok', 'kept-local-ahead') },
    { name: 'D local-ahead: keeps the local tip and says so quietly', facts: facts({ local: { base: HEX_C }, remote: { base: HEX_A }, localBehind: false }), want: pick(HEX_C, 'local', 'ok', 'kept-local-ahead') },
    { name: 'E local-absent: origin alone', facts: facts({ local: null, localBehind: null }), want: pick(HEX_A, 'origin', 'ok', 'fresh') },
    { name: 'F origin-absent (the remote has no such branch): the local tip, silent', facts: facts({ fetch: failed('no-remote-branch'), remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'failed', 'no-remote-branch') },
    { name: 'F a cached origin ref is ignored when the remote reports no such branch', facts: facts({ fetch: failed('no-remote-branch'), remote: { base: HEX_B }, localBehind: true }), want: pick(HEX_A, 'local', 'failed', 'no-remote-branch') },
    { name: 'both refs absent after an ok fetch: no-ref', facts: facts({ local: null, remote: null, localBehind: null }), want: stop('ok', 'no-ref') },
    { name: 'both refs absent after a missing remote branch: no-ref', facts: facts({ fetch: failed('no-remote-branch'), local: null, remote: null, localBehind: null }), want: stop('failed', 'no-ref') },
    { name: 'the ancestry is unknown: no-merge-base, never a guess', facts: facts({ localBehind: null }), want: stop('ok', 'no-merge-base') },
    { name: 'the local side has no merge base with HEAD: no-merge-base', facts: facts({ local: { base: null }, localBehind: null }), want: stop('ok', 'no-merge-base') },
    { name: 'the origin side has no merge base with HEAD: no-merge-base', facts: facts({ remote: { base: null }, localBehind: null }), want: stop('ok', 'no-merge-base') },
    { name: 'only a local ref, and it has no merge base: no-merge-base', facts: facts({ fetch: failed('no-remote-branch'), remote: null, local: { base: null }, localBehind: null }), want: stop('failed', 'no-merge-base') },
    { name: 'a failed fetch with a cached ref applies the rule to the cached ref (behind)', facts: facts({ fetch: failed('fetch-failed'), remote: { base: HEX_B }, localBehind: true }), want: pick(HEX_B, 'origin', 'failed', 'fetch-failed') },
    { name: 'a failed fetch with a cached ref applies the rule to the cached ref (ahead)', facts: facts({ fetch: failed('fetch-failed'), local: { base: HEX_C }, localBehind: false }), want: pick(HEX_C, 'local', 'failed', 'fetch-failed') },
    { name: 'a timed-out fetch is reported as timeout', facts: facts({ fetch: failed('timeout'), remote: { base: HEX_B }, localBehind: true }), want: pick(HEX_B, 'origin', 'failed', 'timeout') },
    { name: 'a failed fetch with no cached ref uses the local tip', facts: facts({ fetch: failed('fetch-failed'), remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'failed', 'fetch-failed') },
    { name: 'a failed fetch with nothing to use: no-ref', facts: facts({ fetch: failed('timeout'), local: null, remote: null, localBehind: null }), want: stop('failed', 'no-ref') },
    { name: 'no origin remote: the local tip, info', facts: facts({ skip: 'no-origin', fetch: none, remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'skipped', 'no-origin') },
    { name: 'no origin remote and no local ref: no-ref', facts: facts({ skip: 'no-origin', fetch: none, local: null, remote: null, localBehind: null }), want: stop('skipped', 'no-ref') },
    { name: 'a cross-repository PR: the local tip, fork-origin, no fetch', facts: facts({ skip: 'fork-origin', fetch: none, remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'skipped', 'fork-origin') },
    { name: 'a cross-repository PR with no local ref: no-ref', facts: facts({ skip: 'fork-origin', fetch: none, local: null, remote: null, localBehind: null }), want: stop('skipped', 'no-ref') },
  ]

  const PR_ROWS: readonly Row[] = [
    { name: 'origin when it resolves, even if the local fork point is newer', facts: facts({ mode: 'pr', local: { base: HEX_C }, remote: { base: HEX_A }, localBehind: false }), want: pick(HEX_A, 'origin', 'ok', 'fresh') },
    { name: 'origin when the local ref is absent', facts: facts({ mode: 'pr', local: null, localBehind: null }), want: pick(HEX_A, 'origin', 'ok', 'fresh') },
    { name: 'a cached origin ref after a failed fetch is still origin', facts: facts({ mode: 'pr', fetch: failed('fetch-failed'), remote: { base: HEX_B } }), want: pick(HEX_B, 'origin', 'failed', 'fetch-failed') },
    { name: 'a timed-out fetch with a cached ref is origin, reported as timeout', facts: facts({ mode: 'pr', fetch: failed('timeout'), remote: { base: HEX_B } }), want: pick(HEX_B, 'origin', 'failed', 'timeout') },
    { name: 'local when origin does not resolve', facts: facts({ mode: 'pr', fetch: failed('fetch-failed'), remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'failed', 'fetch-failed') },
    { name: 'local when the remote has no such branch', facts: facts({ mode: 'pr', fetch: failed('no-remote-branch'), remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'failed', 'no-remote-branch') },
    { name: 'a cached origin ref is ignored when the remote reports no such branch', facts: facts({ mode: 'pr', fetch: failed('no-remote-branch'), remote: { base: HEX_B } }), want: pick(HEX_A, 'local', 'failed', 'no-remote-branch') },
    { name: 'neither ref: no-ref', facts: facts({ mode: 'pr', local: null, remote: null, localBehind: null }), want: stop('ok', 'no-ref') },
    { name: 'origin without a merge base does not fall back to local', facts: facts({ mode: 'pr', remote: { base: null }, localBehind: null }), want: stop('ok', 'no-merge-base') },
    { name: 'no origin remote: local, info', facts: facts({ mode: 'pr', skip: 'no-origin', fetch: none, remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'skipped', 'no-origin') },
    { name: 'a cross-repository PR: local, fork-origin', facts: facts({ mode: 'pr', skip: 'fork-origin', fetch: none, remote: null, localBehind: null }), want: pick(HEX_A, 'local', 'skipped', 'fork-origin') },
  ]

  it.each(LOCAL_ROWS.map(r => [r.name, r] as const))('local rule: %s', (_name, row) => {
    expect(RB.select(row.facts)).toEqual(row.want)
  })

  it.each(PR_ROWS.map(r => [r.name, r] as const))('pr rule: %s', (_name, row) => {
    expect(RB.select(row.facts)).toEqual(row.want)
  })

  it('never yields a selection whose formatted line fails the consistency check', () => {
    for (const row of [...LOCAL_ROWS, ...PR_ROWS]) {
      expect(RB.checkLine(RB.formatLine(RB.select(row.facts))), row.name).toBe(true)
    }
  })

  it('derives NOTE from REASON in the formatted line', () => {
    for (const row of [...LOCAL_ROWS, ...PR_ROWS]) {
      const want = row.want
      expect(RB.formatLine(want), row.name).toBe(
        `BASE_REF=${want.baseRef} TIP=${want.tip} FETCH=${want.fetch} REASON=${want.reason} NOTE=${RB.REASON_NOTES[want.reason]}`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Fixtures: a bare origin, clones and an advancing seed (real git)
// ---------------------------------------------------------------------------

let tmp: string
let baseRemote: string
let sha256Supported = false

const env0 = (home: string): NodeJS.ProcessEnv => scopedEnv(home)

function git(cwd: string, home: string, ...args: string[]): string {
  return realGit(cwd, home, args).trim()
}

function put(dir: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}

/** Commit one new file; returns the new commit id. */
function commitFile(dir: string, home: string, rel: string): string {
  put(dir, rel, `${rel}\n`)
  git(dir, home, 'add', '--', rel)
  git(dir, home, 'commit', '-q', '-m', `add ${rel}`)
  return git(dir, home, 'rev-parse', 'HEAD')
}

/** Exit status of a git command that is expected to fail or to answer "absent". */
function gitStatus(cwd: string, home: string, args: readonly string[]): number | null {
  return spawnSync('git', [...args], { cwd, env: scopedEnv(home), stdio: 'ignore', timeout: SUBPROCESS_TIMEOUT_MS }).status
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-resolve-base-'))
  const home = path.join(tmp, 'base-home')
  fs.mkdirSync(home)
  baseRemote = path.join(tmp, 'base-remote.git')
  const seed = path.join(tmp, 'base-seed')
  git(tmp, home, 'init', '-q', '--bare', '-b', 'main', baseRemote)
  git(tmp, home, 'init', '-q', '-b', 'main', seed)
  put(seed, 'README.md', 'readme\n')
  put(seed, 'base.txt', 'base\n')
  git(seed, home, 'add', '--', 'README.md', 'base.txt')
  git(seed, home, 'commit', '-q', '-m', 'm0')
  git(seed, home, 'remote', 'add', 'origin', baseRemote)
  git(seed, home, 'push', '-q', 'origin', 'main')
  git(seed, home, 'push', '-q', 'origin', 'HEAD:refs/heads/release/1.x')
  const probe = path.join(tmp, 'sha256-probe')
  fs.mkdirSync(probe)
  sha256Supported = gitStatus(probe, home, ['init', '-q', '--object-format=sha256']) === 0
  // the first node start after a burst of git processes can take seconds: pay it here, not in a test
  spawnSync(process.execPath, ['-e', '0'], { cwd: tmp, env: scopedEnv(home), stdio: 'ignore', timeout: SUBPROCESS_TIMEOUT_MS })
}, 90_000)

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

interface World { readonly root: string; readonly home: string; readonly remote: string; readonly work: string }

/** A private copy of the base origin plus a clone of it. */
function newWorld(): World {
  const root = fs.mkdtempSync(path.join(tmp, 'w-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home)
  const remote = path.join(root, 'remote.git')
  fs.cpSync(baseRemote, remote, { recursive: true })
  git(root, home, 'clone', '-q', remote, 'work')
  return { root, home, remote, work: path.join(root, 'work') }
}

/** Add one commit to a branch of the origin (through a private seed clone); returns its id. */
function advanceOrigin(w: World, rel: string, branch = 'main'): string {
  const seed = path.join(w.root, 'seed')
  if (!fs.existsSync(seed)) git(w.root, w.home, 'clone', '-q', w.remote, 'seed')
  git(seed, w.home, 'checkout', '-q', '-B', branch, `origin/${branch}`)
  const sha = commitFile(seed, w.home, rel)
  git(seed, w.home, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`)
  return sha
}

type Kind = 'fresh' | 'stale' | 'diverged' | 'local-ahead' | 'local-absent' | 'origin-absent'

interface Want { readonly tip: TipName; readonly reason: Reason; readonly note: Note; readonly fetch: FetchState; readonly base: string }
interface Scenario {
  readonly w: World
  readonly base: string
  readonly feat: string
  readonly shas: Readonly<Record<string, string>>
  readonly want: Readonly<Record<Mode, Want>>
}

/**
 * The work clone ends on branch `feat`, cut from the base the scenario describes, with one
 * commit (feature.txt). `base` is the name of the base branch.
 */
function buildScenario(kind: Kind, base: string, o: { keepCachedRef?: boolean } = {}): Scenario {
  const w = newWorld()
  const g = (...args: string[]): string => git(w.work, w.home, ...args)
  const cut = (from: string): string => { g('checkout', '-q', '-b', 'feat', from); return commitFile(w.work, w.home, 'feature.txt') }
  const wanted = (tip: TipName, reason: Reason, b: string, fetch: FetchState = 'ok'): Want =>
    ({ tip, reason, note: RB.REASON_NOTES[reason], fetch, base: b })
  const shas: Record<string, string> = {}
  if (kind !== 'origin-absent' && base !== 'main') g('branch', '-q', base, `origin/${base}`)
  shas.M0 = g('rev-parse', kind === 'origin-absent' ? 'origin/main' : `origin/${base}`)

  switch (kind) {
    case 'fresh': {
      shas.F1 = cut(base)
      return { w, base, feat: 'feat', shas, want: { local: wanted('origin', 'fresh', shas.M0), pr: wanted('origin', 'fresh', shas.M0) } }
    }
    case 'stale': {
      shas.M1 = advanceOrigin(w, 'm1.txt', base)
      shas.M2 = advanceOrigin(w, 'm2.txt', base)
      g('fetch', '-q', 'origin')
      shas.F1 = cut(`origin/${base}`)
      if (o.keepCachedRef !== true) g('update-ref', '-d', `refs/remotes/origin/${base}`)
      return { w, base, feat: 'feat', shas, want: { local: wanted('origin', 'fresh', shas.M2), pr: wanted('origin', 'fresh', shas.M2) } }
    }
    case 'diverged':
    case 'local-ahead': {
      g('checkout', '-q', base)
      shas.L1 = commitFile(w.work, w.home, 'local.txt')
      shas.F1 = cut(base)
      if (kind === 'diverged') shas.M1 = advanceOrigin(w, 'm1.txt', base)
      return { w, base, feat: 'feat', shas, want: { local: wanted('local', 'kept-local-ahead', shas.L1), pr: wanted('origin', 'fresh', shas.M0) } }
    }
    case 'local-absent': {
      shas.F1 = cut(`origin/${base}`)
      g('branch', '-q', '-D', base)
      return { w, base, feat: 'feat', shas, want: { local: wanted('origin', 'fresh', shas.M0), pr: wanted('origin', 'fresh', shas.M0) } }
    }
    case 'origin-absent': {
      g('checkout', '-q', '-b', base, 'origin/main')
      shas.S1 = commitFile(w.work, w.home, 'stack.txt')
      shas.F1 = cut(base)
      const f = (): Want => wanted('local', 'no-remote-branch', shas.S1, 'failed')
      return { w, base, feat: 'feat', shas, want: { local: f(), pr: f() } }
    }
    default: {
      const unhandled: never = kind
      throw new Error(`scenario kind without a world: ${String(unhandled)}`)
    }
  }
}

interface Run { readonly line: string; readonly f: Readonly<Record<string, string>> }

function fieldsOf(line: string): Record<string, string> {
  return Object.fromEntries(line.split(' ').map(kv => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))
}

function countingSpawn(home: string): { spawn: SpawnFn; calls: string[][] } {
  const calls: string[][] = []
  const spawn: SpawnFn = (file, args, opts) => {
    calls.push([file, ...args])
    // the script's own environment is the scoped one plus its additions, so scoping it again keeps it whole
    const { cwd, env } = opts as { cwd: string; env: Record<string, string> }
    return spawnSync(file, args, { ...(opts as object), cwd, env: scopedEnv(home, env) }) as unknown as SpawnResult
  }
  return { spawn, calls }
}

const isFetchCall = (call: readonly string[]): boolean => call.includes('fetch')

/** The contract every path owes (AC-6): exit 0 and one conforming line. */
function checkedRun(out: { code: number; line: string }): Run {
  expect(out.code).toBe(0)
  expect(out.line).toMatch(RB.LINE_RE)
  expect(RB.checkLine(out.line)).toBe(true)
  expect(out.line).not.toContain('\n')
  return { line: out.line, f: fieldsOf(out.line) }
}

/** One in-process run over real git; asserts the contract every path owes (AC-6). */
function runBase(w: World, mode: Mode, name: string, o: { cross?: boolean; spawn?: SpawnFn; env?: Record<string, string> } = {}): Run {
  const argv = ['node', 'resolve-base.cjs', mode, name, ...(o.cross === undefined ? [] : ['--cross', String(o.cross)])]
  return checkedRun(RB.main(argv, { cwd: w.work, env: scopedEnv(w.home, o.env ?? {}), spawn: o.spawn }))
}

/** A fake file descriptor 0: hands `input` out in reads of at most `chunk` bytes, then reports the end. */
interface FakeStdin {
  readonly port: StdinPort
  /** The length each read asked for, in order. */
  readonly asked: number[]
  /** The ms of each wait, in order. */
  readonly waits: number[]
  readonly handed: () => number
  readonly ttyChecks: () => number
}

function fakeStdin(
  input: string | Buffer,
  o: { tty?: boolean; chunk?: number; eagainFirst?: number; failWith?: string; clock?: { t: number } } = {},
): FakeStdin {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  let pos = 0
  let eagain = o.eagainFirst ?? 0
  let ttyChecks = 0
  const asked: number[] = []
  const waits: number[] = []
  const port: StdinPort = {
    isatty: () => { ttyChecks += 1; return o.tty === true },
    read: (buf, offset, length) => {
      asked.push(length)
      if (o.failWith !== undefined) throw Object.assign(new Error('read failed'), { code: o.failWith })
      if (eagain > 0) {
        eagain -= 1
        throw Object.assign(new Error('try again'), { code: 'EAGAIN' })
      }
      const n = Math.min(length, o.chunk ?? length, bytes.length - pos)
      bytes.copy(buf, offset, pos, pos + n)
      pos += n
      return n
    },
    wait: ms => { waits.push(ms); if (o.clock !== undefined) o.clock.t += ms },
  }
  return { port, asked, waits, handed: () => pos, ttyChecks: () => ttyChecks }
}

/** One in-process run of the standard-input form over real git. */
function runStdin(w: World, mode: Mode, input: string | Buffer, o: { cross?: boolean; spawn?: SpawnFn } = {}): Run {
  const argv = ['node', 'resolve-base.cjs', mode, '--name-stdin', ...(o.cross === undefined ? [] : ['--cross', String(o.cross)])]
  return checkedRun(RB.main(argv, { cwd: w.work, env: scopedEnv(w.home), spawn: o.spawn, stdin: fakeStdin(input).port }))
}

/** A git that records every call and answers exit 1 (check-ref-format refuses; nothing else is reached). */
function refusingGit(): { spawn: SpawnFn; calls: string[][] } {
  const calls: string[][] = []
  const spawn: SpawnFn = (file, args) => {
    calls.push([file, ...args])
    return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('') }
  }
  return { spawn, calls }
}

function expectWant(r: Run, want: Want): void {
  expect({ BASE_REF: r.f.BASE_REF, TIP: r.f.TIP, FETCH: r.f.FETCH, REASON: r.f.REASON, NOTE: r.f.NOTE }).toEqual({
    BASE_REF: want.base, TIP: want.tip, FETCH: want.fetch, REASON: want.reason, NOTE: want.note,
  })
}

// ---------------------------------------------------------------------------
// AC-6: the real script, one line, nothing else
//
// These tests start a node process. They run before the git-heavy blocks below, and the
// first node start is paid in beforeAll: on macOS a node launch that follows a burst of git
// processes can stall for tens of seconds, the same effect verify-evidence.test.ts warns of.
// ---------------------------------------------------------------------------

describe('the script under process.execPath (AC-6, AC-7)', SPAWN_BUDGET, () => {
  function runScript(w: World, args: readonly string[], envExtra: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [RESOLVE_BASE_SCRIPT, ...args], {
      cwd: w.work, env: scopedEnv(w.home, envExtra), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SUBPROCESS_TIMEOUT_MS,
    })
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status }
  }

  it('prints exactly one newline-terminated conforming line, exits 0 and writes nothing to stderr', () => {
    const s = buildScenario('stale', 'main')
    const r = runScript(s.w, ['local', 'main'])
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(r.stdout.endsWith('\n')).toBe(true)
    expect(r.stdout.split('\n')).toHaveLength(2)
    expect(r.stdout.slice(0, -1)).toMatch(RB.LINE_RE)
    expect(fieldsOf(r.stdout.trim()).BASE_REF).toBe(s.shas.M2)
  })

  it('keeps git\'s own messages, which name the branch, off stdout and stderr', () => {
    const s = buildScenario('origin-absent', 'zz-marker-base')
    const r = runScript(s.w, ['local', 'zz-marker-base'])
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe(`BASE_REF=${s.shas.S1} TIP=local FETCH=failed REASON=no-remote-branch NOTE=none\n`)
  })

  // The refused names, the usage cases and the git calls of a refusal are held in process by the
  // blocks below; these two tests launch node once each for the process contract.
  it('prints only the refusal line for a name that holds shell syntax, and runs none of it', () => {
    const w = newWorld()
    const marker = path.join(w.root, 'created-by-name')
    expect(runScript(w, ['local', `$(touch ${marker})`]))
      .toEqual({ stdout: 'BASE_REF=none TIP=none FETCH=skipped REASON=invalid-name NOTE=stop\n', stderr: '', status: 0 })
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('prints the fallback literal, as one line with exit 0, when git cannot be started', () => {
    const w = newWorld()
    expect(runScript(w, ['local', 'main'], { PATH: path.join(w.root, 'no-such-dir') }))
      .toEqual({ stdout: `${RB.FALLBACK_LINE}\n`, stderr: '', status: 0 })
  })

  /**
   * Runs the script on its usage path, which makes no git call, with a preload that breaks the
   * stdout write in one way, so the only failure in the run is the stdout one.
   */
  function runWithStdoutFault(preloadSource: string): { stderr: string; status: number | null } {
    const dir = fs.mkdtempSync(path.join(tmp, 'no-stdout-'))
    const preload = path.join(dir, 'stdout-fault.cjs')
    fs.writeFileSync(preload, preloadSource)
    const r = spawnSync(process.execPath, ['--require', preload, RESOLVE_BASE_SCRIPT, 'local'], {
      cwd: dir, env: scopedEnv(dir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SUBPROCESS_TIMEOUT_MS,
    })
    return { stderr: r.stderr ?? '', status: r.status }
  }

  it('sets exit 3 and writes nothing to stderr when stdout cannot be opened', () => {
    const r = runWithStdoutFault("Object.defineProperty(process, 'stdout', { configurable: true, get() { throw new Error('stdout unavailable') } })\n")
    expect(r).toEqual({ stderr: '', status: 3 })
  })

  it('sets exit 3 and writes nothing to stderr when the stdout write calls back with an error', () => {
    const r = runWithStdoutFault([
      'process.stdout.write = (chunk, ...rest) => {',
      "  const done = rest.find(a => typeof a === 'function')",
      "  if (typeof done === 'function') process.nextTick(done, new Error('stdout write failed'))",
      '  return true',
      '}',
      '',
    ].join('\n'))
    expect(r).toEqual({ stderr: '', status: 3 })
  })
})

// ---------------------------------------------------------------------------
// AC-2, AC-3: the scenarios in both modes, over real git
// ---------------------------------------------------------------------------

describe('the scenarios over real git, in both modes (AC-2, AC-3)', SPAWN_BUDGET, () => {
  const ROWS: ReadonlyArray<readonly [Kind, string]> = [
    ['fresh', 'main'], ['stale', 'main'], ['diverged', 'main'], ['local-ahead', 'main'], ['local-absent', 'main'], ['origin-absent', 'stack'],
    ['fresh', 'release/1.x'], ['stale', 'release/1.x'], ['diverged', 'release/1.x'], ['local-ahead', 'release/1.x'],
    ['local-absent', 'release/1.x'], ['origin-absent', 'stack/base'],
  ]

  it.each(ROWS)('%s, base "%s": the local rule follows the fork point and the PR rule follows origin', (kind, base) => {
    const s = buildScenario(kind, base)
    expectWant(runBase(s.w, 'local', base), s.want.local)
    expectWant(runBase(s.w, 'pr', base), s.want.pr)
  })
})

// ---------------------------------------------------------------------------
// AC-1: a stale local base
// ---------------------------------------------------------------------------

describe('a stale local base (AC-1)', SPAWN_BUDGET, () => {
  it('lists only the files the branch changed, where the local base name would list the base\'s own', () => {
    const s = buildScenario('stale', 'main')
    const { w, shas } = s
    const names = (range: string): string[] => git(w.work, w.home, 'diff', '--name-only', range).split('\n').filter(Boolean).sort()

    // control: the old base (the local name) is stale, so its three-dot list carries origin's files
    expect(names('main...HEAD')).toEqual(['feature.txt', 'm1.txt', 'm2.txt'])

    const r = runBase(w, 'local', 'main')
    expect(r.f.BASE_REF).toBe(shas.M2)
    expect(names(`${r.f.BASE_REF}...HEAD`)).toEqual(['feature.txt'])
    // the name-only diff equals the chosen tip's own three-dot diff
    expect(names(`${r.f.BASE_REF}...HEAD`)).toEqual(names('refs/remotes/origin/main...HEAD'))
    // its log has no base-only commits
    const log = git(w.work, w.home, 'log', '--format=%H', `${r.f.BASE_REF}..HEAD`).split('\n').filter(Boolean)
    expect(log).toEqual([shas.F1])
  })

  it('needs the fetch: with no cached origin ref the run restores it and reads origin\'s tip', () => {
    const s = buildScenario('stale', 'main')
    expect(gitStatus(s.w.work, s.w.home, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).toBe(1)
    const r = runBase(s.w, 'pr', 'main')
    expect(r.f).toMatchObject({ BASE_REF: s.shas.M2, FETCH: 'ok', REASON: 'fresh', NOTE: 'none' })
    expect(git(s.w.work, s.w.home, 'rev-parse', 'refs/remotes/origin/main')).toBe(s.shas.M2)
  })
})

// ---------------------------------------------------------------------------
// AC-5: fetch outcomes
// ---------------------------------------------------------------------------

describe('fetch outcomes (AC-5)', SPAWN_BUDGET, () => {
  it('no origin remote: no fetch, the local tip, REASON no-origin', () => {
    const s = buildScenario('fresh', 'main')
    git(s.w.work, s.w.home, 'remote', 'remove', 'origin')
    const { spawn, calls } = countingSpawn(s.w.home)
    const r = runBase(s.w, 'local', 'main', { spawn })
    expectWant(r, { tip: 'local', reason: 'no-origin', note: 'info', fetch: 'skipped', base: s.shas.M0 })
    expect(calls.filter(isFetchCall)).toHaveLength(0)
  })

  it('a missing remote branch is silent (NOTE none) even under a non-English parent locale', () => {
    const s = buildScenario('origin-absent', 'stack')
    const r = runBase(s.w, 'local', 'stack', { env: { LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', LC_MESSAGES: 'de_DE.UTF-8', LANGUAGE: 'de' } })
    expectWant(r, s.want.local)
    expect(r.f.NOTE).toBe('none')
  })

  it('both refs absent gives no-ref (stop), with BASE_REF none', () => {
    const w = newWorld()
    const r = runBase(w, 'local', 'nowhere')
    expect(r.line).toBe('BASE_REF=none TIP=none FETCH=failed REASON=no-ref NOTE=stop')
  })

  it('a failed fetch with a cached ref applies the rule to the cached ref (REASON fetch-failed, degraded)', () => {
    const s = buildScenario('stale', 'main', { keepCachedRef: true })
    git(s.w.work, s.w.home, 'remote', 'set-url', 'origin', path.join(s.w.root, 'missing.git'))
    const local = runBase(s.w, 'local', 'main')
    expectWant(local, { tip: 'origin', reason: 'fetch-failed', note: 'degraded', fetch: 'failed', base: s.shas.M2 })
    const pr = runBase(s.w, 'pr', 'main')
    expectWant(pr, { tip: 'origin', reason: 'fetch-failed', note: 'degraded', fetch: 'failed', base: s.shas.M2 })
  })

  it('a failed fetch with no cached ref uses the local tip (REASON fetch-failed, degraded)', () => {
    const s = buildScenario('stale', 'main')
    git(s.w.work, s.w.home, 'remote', 'set-url', 'origin', path.join(s.w.root, 'missing.git'))
    for (const mode of ['local', 'pr'] as const) {
      expectWant(runBase(s.w, mode, 'main'), { tip: 'local', reason: 'fetch-failed', note: 'degraded', fetch: 'failed', base: s.shas.M0 })
    }
  })

  it('a held ref lock gives fetch-failed on the cached ref, and the fetch is not retried', () => {
    const s = buildScenario('fresh', 'main')
    advanceOrigin(s.w, 'm1.txt')
    fs.writeFileSync(path.join(s.w.work, '.git', 'refs', 'remotes', 'origin', 'main.lock'), '')
    const { spawn, calls } = countingSpawn(s.w.home)
    const r = runBase(s.w, 'pr', 'main', { spawn })
    expectWant(r, { tip: 'origin', reason: 'fetch-failed', note: 'degraded', fetch: 'failed', base: s.shas.M0 })
    expect(calls.filter(isFetchCall)).toHaveLength(1)
  })

  it('a cross-repository PR runs no fetch, uses the local base and says fork-origin', () => {
    const s = buildScenario('stale', 'main', { keepCachedRef: true })
    git(s.w.work, s.w.home, 'remote', 'set-url', 'origin', path.join(s.w.root, 'missing.git'))
    const { spawn, calls } = countingSpawn(s.w.home)
    for (const mode of ['pr', 'local'] as const) {
      const r = runBase(s.w, mode, 'main', { cross: true, spawn })
      // the cached origin ref is not used: it belongs to the other repository
      expectWant(r, { tip: 'local', reason: 'fork-origin', note: 'info', fetch: 'skipped', base: s.shas.M0 })
    }
    expect(calls.filter(isFetchCall)).toHaveLength(0)
  })

  it('--cross false still fetches', () => {
    const s = buildScenario('fresh', 'main')
    const { spawn, calls } = countingSpawn(s.w.home)
    expectWant(runBase(s.w, 'pr', 'main', { cross: false, spawn }), s.want.pr)
    expect(calls.filter(isFetchCall)).toHaveLength(1)
  })

  it('unrelated histories give no-merge-base (stop)', () => {
    const s = buildScenario('fresh', 'main')
    const g = (...a: string[]): string => git(s.w.work, s.w.home, ...a)
    g('checkout', '-q', '--orphan', 'island')
    g('rm', '-rq', '--cached', '.')
    commitFile(s.w.work, s.w.home, 'island.txt')
    for (const mode of ['local', 'pr'] as const) {
      expect(runBase(s.w, mode, 'main').line).toBe('BASE_REF=none TIP=none FETCH=ok REASON=no-merge-base NOTE=stop')
    }
  })

  it('a shallow clone whose fork point is cut off gives no-merge-base (stop)', () => {
    const w = newWorld()
    advanceOrigin(w, 'm1.txt')
    // a feature branch on the origin, cut from the first commit; the shallow clone keeps one commit per tip
    const seed = path.join(w.root, 'seed')
    git(seed, w.home, 'checkout', '-q', '-b', 'topic', 'origin/main~1')
    commitFile(seed, w.home, 'topic.txt')
    git(seed, w.home, 'push', '-q', 'origin', 'topic')
    const shallow = path.join(w.root, 'shallow')
    git(w.root, w.home, 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${w.remote}`, shallow)
    git(shallow, w.home, 'checkout', '-q', 'topic')
    const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: shallow, env: env0(w.home) })
    expect(out.line).toBe('BASE_REF=none TIP=none FETCH=ok REASON=no-merge-base NOTE=stop')
  })
})

// ---------------------------------------------------------------------------
// AC-7: names
// ---------------------------------------------------------------------------

describe('names that fail a check (AC-7)', SPAWN_BUDGET, () => {
  const stopLine = 'BASE_REF=none TIP=none FETCH=skipped REASON=invalid-name NOTE=stop'

  it('a name outside the closed class stops before any git call and is not echoed', () => {
    const w = newWorld()
    const marker = path.join(w.root, 'created-by-name')
    const names = [`$(touch ${marker})`, `\`touch ${marker}\``, `a;touch ${marker}`, '-x', '#x', 'origin/main', 'a..b', 'HEAD', '', 'a b']
    for (const name of names) {
      const { spawn, calls } = countingSpawn(w.home)
      const out = RB.main(['node', 'resolve-base.cjs', 'local', name], { cwd: w.work, env: env0(w.home), spawn })
      expect(out, JSON.stringify(name)).toEqual({ code: 0, line: stopLine })
      expect(calls, JSON.stringify(name)).toEqual([])
    }
    expect(fs.existsSync(marker), 'a refused name must create no file').toBe(false)
  })

  it('a name the class admits but check-ref-format refuses stops with invalid-name and runs no fetch', () => {
    const w = newWorld()
    for (const name of ['a.lock', 'a/', '/a', 'a//b', '.a', 'a.', 'a/.b', 'a/b.lock/c', 'x/y.lock']) {
      expect(RB.isStrictName(name), `class admits ${name}`).toBe(true)
      const { spawn, calls } = countingSpawn(w.home)
      const out = RB.main(['node', 'resolve-base.cjs', 'pr', name], { cwd: w.work, env: env0(w.home), spawn })
      expect(out, name).toEqual({ code: 0, line: stopLine })
      expect(calls.filter(isFetchCall), name).toEqual([])
      expect(calls, name).toHaveLength(1)
      expect(calls[0].slice(0, 4), name).toEqual(['git', '-c', 'core.fsmonitor=false', 'check-ref-format'])
    }
  })

  it('a usage error makes no git call and prints the usage stop', () => {
    const w = newWorld()
    for (const args of [[], ['local'], ['fork', 'main'], ['local', 'main', 'extra'], ['local', 'main', '--cross', 'maybe']]) {
      const { spawn, calls } = countingSpawn(w.home)
      const out = RB.main(['node', 'resolve-base.cjs', ...args], { cwd: w.work, env: env0(w.home), spawn })
      expect(out, JSON.stringify(args)).toEqual({ code: 0, line: 'BASE_REF=none TIP=none FETCH=skipped REASON=usage NOTE=stop' })
      expect(calls, JSON.stringify(args)).toEqual([])
    }
  })

  it('accepted names (slash, plus, comma, at) reach the fetch with the full refspec', () => {
    const w = newWorld()
    for (const name of ['release/1.x', 'feature/a+b', 'v1.0@x', 'a,b#c']) {
      const { spawn, calls } = countingSpawn(w.home)
      const out = RB.main(['node', 'resolve-base.cjs', 'pr', name], { cwd: w.work, env: env0(w.home), spawn })
      expect(out.code).toBe(0)
      const fetch = calls.find(isFetchCall)
      expect(fetch?.at(-1), name).toBe(`+refs/heads/${name}:refs/remotes/origin/${name}`)
    }
  })
})

// ---------------------------------------------------------------------------
// The name on standard input
// ---------------------------------------------------------------------------

describe('the name on standard input', () => {
  const NODE_CWD = '/work/tree'
  const ENV = {}
  const INVALID = 'BASE_REF=none TIP=none FETCH=skipped REASON=invalid-name NOTE=stop'
  const UNAVAILABLE = 'BASE_REF=none TIP=none FETCH=skipped REASON=resolver-unavailable NOTE=stop'
  const USAGE = 'BASE_REF=none TIP=none FETCH=skipped REASON=usage NOTE=stop'
  const STDIN_ARGV = ['node', 'resolve-base.cjs', 'pr', '--name-stdin']

  /** Run the stdin form against a recording git that refuses; returns the outcome, the git calls and the fake descriptor. */
  function viaStdin(input: string | Buffer, o: { tty?: boolean; chunk?: number; failWith?: string } = {}): { out: { code: number; line: string }; calls: string[][]; fd: FakeStdin } {
    const { spawn, calls } = refusingGit()
    const fd = fakeStdin(input, o)
    return { out: RB.main(STDIN_ARGV, { cwd: NODE_CWD, env: ENV, spawn, stdin: fd.port }), calls, fd }
  }

  describe('the read', () => {
    it('strips exactly one trailing LF or CRLF, or none, and never trims', () => {
      for (const text of ['main', 'main\n', 'main\r\n']) {
        const { calls } = viaStdin(text)
        expect(calls[0]?.slice(-2), JSON.stringify(text)).toEqual(['check-ref-format', 'refs/heads/main'])
      }
      for (const text of [' main', 'main ', 'main\t', '\tmain', 'main\n ', 'main \n']) {
        const { out, calls } = viaStdin(text)
        expect(out, JSON.stringify(text)).toEqual({ code: 0, line: INVALID })
        expect(calls, JSON.stringify(text)).toEqual([])
      }
    })

    it('reads a name delivered in several short reads', () => {
      const { calls, fd } = viaStdin('release/1.x\r\n', { chunk: 3 })
      expect(calls[0]?.slice(-2)).toEqual(['check-ref-format', 'refs/heads/release/1.x'])
      expect(fd.handed()).toBe(13)
    })

    it('treats empty input as resolver-unavailable, with no git call', () => {
      const { out, calls } = viaStdin('')
      expect(out).toEqual({ code: 0, line: UNAVAILABLE })
      expect(calls).toEqual([])
    })

    it('treats a lone newline as an empty name, which the strict class refuses', () => {
      for (const text of ['\n', '\r\n']) {
        const { out, calls } = viaStdin(text)
        expect(out, JSON.stringify(text)).toEqual({ code: 0, line: INVALID })
        expect(calls, JSON.stringify(text)).toEqual([])
      }
    })

    it('treats a failed read as resolver-unavailable, with no git call', () => {
      for (const code of ['EIO', 'EBADF', 'EISDIR', 'EINVAL']) {
        const { out, calls } = viaStdin('main\n', { failWith: code })
        expect(out, code).toEqual({ code: 0, line: UNAVAILABLE })
        expect(calls, code).toEqual([])
      }
    })

    it('refuses a terminal without reading it', () => {
      const { out, calls, fd } = viaStdin('main\n', { tty: true })
      expect(out).toEqual({ code: 0, line: UNAVAILABLE })
      expect(calls).toEqual([])
      expect(fd.asked, 'a terminal is never read').toEqual([])
      expect(fd.ttyChecks()).toBe(1)
    })

    it('checks for a terminal before the first read', () => {
      const { fd } = viaStdin('main\n')
      expect(fd.ttyChecks()).toBe(1)
      expect(fd.asked.length).toBeGreaterThan(0)
    })

    it('treats a descriptor whose terminal check throws as unreadable', () => {
      const { spawn, calls } = refusingGit()
      const port: Partial<StdinPort> = { isatty: () => { throw new Error('no such descriptor') }, read: () => { throw new Error('must not be read') } }
      expect(RB.main(STDIN_ARGV, { cwd: NODE_CWD, env: ENV, spawn, stdin: port })).toEqual({ code: 0, line: UNAVAILABLE })
      expect(calls).toEqual([])
    })

    it('gives invalid-name for input over 256 bytes and never truncates it', () => {
      for (const text of ['a'.repeat(257), 'a'.repeat(256) + '\n', 'main\n' + 'x'.repeat(300), 'main' + ' '.repeat(260)]) {
        const { out, calls, fd } = viaStdin(text)
        expect(out, text.slice(0, 20)).toEqual({ code: 0, line: INVALID })
        expect(calls, text.slice(0, 20)).toEqual([])
        expect(fd.handed(), 'the read stops one byte past the cap').toBeLessThanOrEqual(257)
        expect(Math.max(...fd.asked), 'no read asks for more than cap + 1').toBeLessThanOrEqual(257)
      }
    })

    it('reads at most 257 bytes however long the input is', () => {
      const { fd } = viaStdin('b'.repeat(100_000), { chunk: 100 })
      expect(fd.handed()).toBe(257)
      expect(Math.max(...fd.asked)).toBeLessThanOrEqual(257)
    })

    it('gives invalid-name for NUL, CR, non-ASCII bytes and a second line', () => {
      const bad: Array<string | Buffer> = [
        'ma\0in', 'main\0', 'main\0\n', 'ma\rin', 'main\r', 'main\r\r\n',
        Buffer.from('mäin\n', 'utf8'), Buffer.from([0x6d, 0xff, 0x0a]), Buffer.from('main\u202E\n', 'utf8'),
        'main\nother\n', 'main\n\n', 'main\r\n\r\n', 'main\nmain', '\nmain', 'a\nb',
      ]
      for (const text of bad) {
        const { out, calls } = viaStdin(text)
        expect(out, JSON.stringify(Buffer.from(text).toString('latin1'))).toEqual({ code: 0, line: INVALID })
        expect(calls, JSON.stringify(Buffer.from(text).toString('latin1'))).toEqual([])
      }
    })
  })

  describe('the checks run before any other git call', () => {
    it('a name outside the strict class makes no git call and creates nothing', () => {
      const marker = path.join(os.tmpdir(), `devflow-rb-stdin-${process.pid}-created`)
      const hostile = [`$(touch ${marker})`, `\`touch ${marker}\``, `a;touch ${marker}`, '-x', '#x', 'origin/main', 'a..b', 'HEAD', 'a b', '--name-stdin']
      for (const name of hostile) {
        const { out, calls } = viaStdin(name + '\n')
        expect(out, name).toEqual({ code: 0, line: INVALID })
        expect(calls, name).toEqual([])
      }
      expect(fs.existsSync(marker)).toBe(false)
    })

    it('a name the class admits but check-ref-format refuses stops after exactly that one call', () => {
      for (const name of ['a.lock', 'a/', '/a', 'a//b', '.a', 'a.', 'a/.b', 'x/y.lock']) {
        const { out, calls } = viaStdin(name + '\n')
        expect(out, name).toEqual({ code: 0, line: INVALID })
        expect(calls, name).toHaveLength(1)
        expect(calls[0].slice(0, 4), name).toEqual(['git', '-c', 'core.fsmonitor=false', 'check-ref-format'])
      }
    })

    it('hands every name the class admits to check-ref-format unchanged', () => {
      for (const name of ACCEPTED) {
        const { calls } = viaStdin(name + '\n')
        expect(calls, name).toEqual([['git', '-c', 'core.fsmonitor=false', 'check-ref-format', 'refs/heads/' + name]])
      }
    })

    it('gives the same refusal for the same name by argument and by standard input', () => {
      for (const name of [...ACCEPTED, ...REFUSED.filter(n => !/[\r\n\0]/.test(n))]) {
        const fromStdin = refusingGit()
        const fromArgs = refusingGit()
        const a = RB.main(STDIN_ARGV, { cwd: NODE_CWD, env: ENV, spawn: fromStdin.spawn, stdin: fakeStdin(Buffer.from(name + '\n', 'utf8')).port })
        const b = RB.main(['node', 'resolve-base.cjs', 'pr', name], { cwd: NODE_CWD, env: ENV, spawn: fromArgs.spawn })
        if (name === '') expect(a.line, 'an empty name read from a lone newline').toBe(INVALID)
        expect(a, JSON.stringify(name)).toEqual(b)
        expect(fromStdin.calls, JSON.stringify(name)).toEqual(fromArgs.calls)
      }
    })
  })

  describe('the argument form and usage never read', () => {
    const watching = (): { port: Partial<StdinPort>; touched: () => number } => {
      let touched = 0
      const trip = (): never => { touched += 1; throw new Error('standard input must not be touched') }
      return { port: { isatty: trip, read: trip, wait: trip }, touched: () => touched }
    }

    it('the argument form reads nothing', () => {
      const { port, touched } = watching()
      const { spawn, calls } = refusingGit()
      const out = RB.main(['node', 'resolve-base.cjs', 'pr', 'main'], { cwd: NODE_CWD, env: ENV, spawn, stdin: port })
      expect(out).toEqual({ code: 0, line: INVALID })
      expect(calls).toHaveLength(1)
      expect(touched()).toBe(0)
    })

    it('a positional name next to --name-stdin is a usage stop that reads nothing and runs no git call', () => {
      const shapes = [
        ['pr', 'main', '--name-stdin'], ['pr', '--name-stdin', 'main'], ['pr', 'main', '--name-stdin', '--cross', 'true'],
        ['pr', '--name-stdin', 'main', '--cross', 'true'], ['pr', 'main', '--cross', 'true', '--name-stdin'], ['--name-stdin'],
        ['pr', '--name-stdin', '--cross'], ['pr', '--name-stdin', '--cross', 'maybe'], ['fork', '--name-stdin'],
      ]
      for (const args of shapes) {
        const { port, touched } = watching()
        const { spawn, calls } = refusingGit()
        const out = RB.main(['node', 'resolve-base.cjs', ...args], { cwd: NODE_CWD, env: ENV, spawn, stdin: port })
        expect(out, JSON.stringify(args)).toEqual({ code: 0, line: USAGE })
        expect(calls, JSON.stringify(args)).toEqual([])
        expect(touched(), JSON.stringify(args)).toBe(0)
      }
    })
  })

  describe('a wait for input counts inside the run budget', () => {
    it('gives resolver-unavailable, with no git call, when a descriptor never has input', () => {
      const clock = { t: 0 }
      const fd = fakeStdin('', { eagainFirst: Infinity, clock })
      const { spawn, calls } = refusingGit()
      const out = RB.main(STDIN_ARGV, { cwd: NODE_CWD, env: ENV, spawn, now: () => clock.t, stdin: fd.port })
      expect(out).toEqual({ code: 0, line: UNAVAILABLE })
      expect(calls).toEqual([])
      expect(fd.waits.length).toBeGreaterThan(0)
      expect(fd.waits.reduce((a, b) => a + b, 0), 'the waits never pass the run budget').toBeLessThanOrEqual(RB.RUN_BUDGET_MS)
      expect(fd.asked.length, 'the number of reads is bounded').toBeLessThanOrEqual(RB.RUN_BUDGET_MS)
    })

    it('waits out a descriptor that has no input yet, then reads the name', () => {
      const clock = { t: 0 }
      const fd = fakeStdin('main\n', { eagainFirst: 5, clock })
      const { spawn, calls } = refusingGit()
      const out = RB.main(STDIN_ARGV, { cwd: NODE_CWD, env: ENV, spawn, now: () => clock.t, stdin: fd.port })
      expect(out).toEqual({ code: 0, line: INVALID })
      expect(fd.waits).toHaveLength(5)
      expect(calls[0]?.slice(-2)).toEqual(['check-ref-format', 'refs/heads/main'])
    })

    it('starts no git call when the read has used the whole budget', () => {
      const clock = { t: 0 }
      let reads = 0
      const port: Partial<StdinPort> = {
        isatty: () => false,
        read: (buf, offset) => {
          reads += 1
          if (reads > 1) return 0
          clock.t += RB.RUN_BUDGET_MS
          return buf.write('main\n', offset, 'latin1')
        },
      }
      const { spawn, calls } = refusingGit()
      const out = RB.main(['node', 'resolve-base.cjs', 'pr', '--name-stdin'], { cwd: NODE_CWD, env: ENV, spawn, now: () => clock.t, stdin: port })
      expect(out).toEqual({ code: 0, line: UNAVAILABLE })
      expect(calls).toEqual([])
    })
  })

  describe('over real git', SPAWN_BUDGET, () => {
    it('gives the same line as the argument form in both modes, for a name with and without its line end', () => {
      const s = buildScenario('stale', 'main')
      for (const mode of ['local', 'pr'] as const) {
        const viaArg = runBase(s.w, mode, 'main')
        expectWant(viaArg, s.want[mode])
        for (const text of ['main', 'main\n', 'main\r\n']) {
          const viaFd = runStdin(s.w, mode, text)
          expect(viaFd.line, `${mode} ${JSON.stringify(text)}`).toBe(viaArg.line)
        }
      }
    })

    it('reads a slash name and honours --cross', () => {
      const w = newWorld()
      git(w.work, w.home, 'branch', '-q', 'release/1.x', 'origin/release/1.x')
      git(w.work, w.home, 'checkout', '-q', '-b', 'feat', 'release/1.x')
      commitFile(w.work, w.home, 'feature.txt')
      const viaFd = runStdin(w, 'pr', 'release/1.x\n')
      expect(viaFd.line).toBe(runBase(w, 'pr', 'release/1.x').line)
      expect(viaFd.f.REASON).toBe('fresh')
      const cross = runStdin(w, 'pr', 'release/1.x\n', { cross: true })
      expect(cross.line).toBe(runBase(w, 'pr', 'release/1.x', { cross: true }).line)
      expect(cross.f).toMatchObject({ FETCH: 'skipped', REASON: 'fork-origin', NOTE: 'info' })
    })

    it('makes no fetch for a refused name, whatever the way it arrived', () => {
      const w = newWorld()
      for (const text of ['a.lock\n', '$(id)\n', 'main\nmain\n', '']) {
        const { spawn, calls } = countingSpawn(w.home)
        const r = runStdin(w, 'pr', text, { spawn })
        expect(r.f.NOTE, JSON.stringify(text)).toBe('stop')
        expect(calls.filter(isFetchCall), JSON.stringify(text)).toEqual([])
      }
    })
  })
})

describe('the fallback (AC-6)', SPAWN_BUDGET, () => {
  it('prints the fallback literal when the work throws, and when the composed line fails its own check', () => {
    const w = newWorld()
    const boom: SpawnFn = () => { throw new Error('spawn failed') }
    expect(RB.main(['node', 'resolve-base.cjs', 'local', 'main'], { cwd: w.work, env: env0(w.home), spawn: boom }))
      .toEqual({ code: 0, line: RB.FALLBACK_LINE })
    const garbage = (): string => 'BASE_REF=main'
    expect(RB.main(['node', 'resolve-base.cjs', 'local', 'main'], { cwd: w.work, env: env0(w.home), formatLine: garbage }))
      .toEqual({ code: 0, line: RB.FALLBACK_LINE })
  })

  it('treats a git that cannot be started as resolver-unavailable, with the fetch state of the run', () => {
    const w = newWorld()
    const { spawn: real } = countingSpawn(w.home)
    let fetched = false
    // the real git answers up to and including the fetch; every call after it cannot be started
    const missingAfterFetch: SpawnFn = (file, args, opts) => {
      if (fetched) return { status: null, error: { code: 'ENOENT' } }
      fetched = isFetchCall([file, ...args])
      return real(file, args, opts)
    }
    const out = RB.main(['node', 'resolve-base.cjs', 'local', 'main'], { cwd: w.work, env: env0(w.home), spawn: missingAfterFetch })
    expect(fetched, 'the fetch ran').toBe(true)
    expect(out).toEqual({ code: 0, line: 'BASE_REF=none TIP=none FETCH=ok REASON=resolver-unavailable NOTE=stop' })
    expect(out.line).not.toBe(RB.FALLBACK_LINE)
  })
})

// ---------------------------------------------------------------------------
// AC-11: the local state
// ---------------------------------------------------------------------------

describe('local state (AC-11)', SPAWN_BUDGET, () => {
  function fileHash(p: string): string | null {
    try { return createHash('sha256').update(fs.readFileSync(p)).digest('hex') } catch { return null }
  }

  function worktreeFiles(dir: string): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else out[path.relative(dir, p)] = fileHash(p)
      }
    }
    walk(dir)
    return out
  }

  function snapshot(w: World): Record<string, unknown> {
    const gd = path.join(w.work, '.git')
    const refs = git(w.work, w.home, 'for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter(l => !l.startsWith('refs/remotes/origin/main ') && !l.startsWith('refs/remotes/origin/HEAD '))
    return {
      head: fs.readFileSync(path.join(gd, 'HEAD'), 'utf8'),
      headSha: git(w.work, w.home, 'rev-parse', 'HEAD'),
      refsExceptOriginMain: refs,
      index: fileHash(path.join(gd, 'index')),
      worktree: worktreeFiles(w.work),
    }
  }

  it('changes only refs/remotes/origin/<base>: no branch, HEAD, index, worktree, tag, FETCH_HEAD, promisor or shallow file', () => {
    const s = buildScenario('stale', 'main')
    const { w } = s
    // origin gains a tag the resolver must not follow
    const seed = path.join(w.root, 'seed')
    git(seed, w.home, 'tag', 'v-new')
    git(seed, w.home, 'push', '-q', 'origin', 'v-new')
    fs.writeFileSync(path.join(w.work, 'scratch-untracked.txt'), 'untracked\n')
    // the fixture's own plain fetch wrote one; the resolver must not write another
    fs.rmSync(path.join(w.work, '.git', 'FETCH_HEAD'), { force: true })
    const before = snapshot(w)
    const tagsBefore = git(w.work, w.home, 'tag', '--list')

    expect(runBase(w, 'local', 'main').f.REASON).toBe('fresh')

    expect(snapshot(w)).toEqual(before)
    expect(git(w.work, w.home, 'tag', '--list')).toBe(tagsBefore)
    expect(git(w.work, w.home, 'tag', '--list')).not.toContain('v-new')
    const gd = path.join(w.work, '.git')
    expect(fs.existsSync(path.join(gd, 'FETCH_HEAD'))).toBe(false)
    expect(fs.existsSync(path.join(gd, 'shallow'))).toBe(false)
    expect(gitStatus(w.work, w.home, ['config', '--get-regexp', '^remote\\.origin\\.(promisor|partialclonefilter)$'])).toBe(1)
    expect(gitStatus(w.work, w.home, ['config', '--get', 'extensions.partialclone'])).toBe(1)
    expect(git(w.work, w.home, 'rev-parse', 'refs/remotes/origin/main')).toBe(s.shas.M2)
  })

  it('writes no FETCH_HEAD when the fetch fails either', () => {
    const s = buildScenario('fresh', 'main')
    const gd = path.join(s.w.work, '.git')
    expect(fs.existsSync(path.join(gd, 'FETCH_HEAD'))).toBe(false)
    git(s.w.work, s.w.home, 'remote', 'set-url', 'origin', path.join(s.w.root, 'missing.git'))
    runBase(s.w, 'local', 'main')
    expect(fs.existsSync(path.join(gd, 'FETCH_HEAD'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SHA-256 repositories
// ---------------------------------------------------------------------------

describe('a SHA-256 repository (AC-6)', SPAWN_BUDGET, () => {
  it('verifies and prints a 64-hex BASE_REF', ctx => {
    if (!sha256Supported) { ctx.skip(); return }
    const root = fs.mkdtempSync(path.join(tmp, 'w256-'))
    const home = path.join(root, 'home')
    fs.mkdirSync(home)
    const remote = path.join(root, 'remote.git')
    const seed = path.join(root, 'seed')
    git(root, home, 'init', '-q', '--bare', '--object-format=sha256', '-b', 'main', remote)
    git(root, home, 'init', '-q', '--object-format=sha256', '-b', 'main', seed)
    commitFile(seed, home, 'm0.txt')
    git(seed, home, 'remote', 'add', 'origin', remote)
    git(seed, home, 'push', '-q', 'origin', 'main')
    git(root, home, 'clone', '-q', remote, 'work')
    const work = path.join(root, 'work')
    commitFile(seed, home, 'm1.txt')
    const m1 = git(seed, home, 'rev-parse', 'HEAD')
    git(seed, home, 'push', '-q', 'origin', 'main')
    git(work, home, 'fetch', '-q', 'origin')
    git(work, home, 'checkout', '-q', '-b', 'feat', 'origin/main')
    commitFile(work, home, 'feature.txt')
    git(work, home, 'update-ref', '-d', 'refs/remotes/origin/main')

    const out = RB.main(['node', 'resolve-base.cjs', 'local', 'main'], { cwd: work, env: env0(home) })
    expect(out.line).toMatch(RB.LINE_RE)
    const f = fieldsOf(out.line)
    expect(f.BASE_REF).toHaveLength(64)
    expect(f.BASE_REF).toBe(m1)
    expect(f).toMatchObject({ TIP: 'origin', FETCH: 'ok', REASON: 'fresh', NOTE: 'none' })
  })
})
