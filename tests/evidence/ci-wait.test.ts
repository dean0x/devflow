/**
 * tests/evidence/ci-wait.test.ts
 *
 * Suite for src/assets/scripts/ci-wait.cjs, the plumbing /implement Phase 9 and
 * /resolve Phase 8 call inline to wait for the CI verdict of the pushed head
 * (Token Diet wave 2, #421; acceptance criteria 8 to 12 and 14).
 *
 * Design decisions held here, by the names the script's JSDoc carries:
 *
 *   D-CI-WAIT-INLINE     AC-8, AC-11: the script drives gh through an injected exec and
 *                        a clock whose sleep and gh calls advance a virtual time, so
 *                        no test uses a real gh or a real sleep. Stdout is exactly one
 *                        line in every case; a gate-failing argv makes no gh call and
 *                        no gh call goes through a shell.
 *   D-CI-WAIT-BOUNDS     AC-9: on the injected clock a run never passes 570 s, counting
 *                        every gh timeout and every sleep, and no gh call is given more
 *                        time than the deadline leaves. A clock that does not move is
 *                        stopped by MAX_POLLS. PASSING is never printed for a gh
 *                        failure, an unparseable reply, an unrecognised bucket, a head
 *                        mismatch or a still-pending check.
 *   D-CI-SANITIZE        AC-10: a check name reaches stdout only through the allowlist,
 *                        40 characters, 4 names per list, and the line stays under 400.
 *   D-CI-HEAD-BINDING    AC-12: only the head the caller named is classified. A
 *                        mismatched `headRefOid` is PENDING through the settle window,
 *                        then INDETERMINATE (head-mismatch); its checks are never read.
 *   D-CI-CLASSIFIER      AC-14: the classifier agrees with check-ci-status step 5. That
 *                        parity case lives in merge-readiness.test.ts, beside the prose
 *                        interpreter; this suite holds the classifier's own rows.
 *   D-CI-NO-EXIT /       The script never calls process.exit, runs gh through one
 *   D-CI-NO-LITERAL-     spawnSync with no shell, and waits inside node: Claude Code
 *   SLEEP                2.1.294 blocks a Bash command that starts with a literal
 *                        `sleep N`, so no script path may wait that way.
 *
 * Every source guard has a named collector, a non-empty corpus and a known-bad probe
 * run through the same collector. The two real-process groups (the usage line, and the
 * scripted gh) go through scopedEnv() and name their cwd.
 *
 * NOT covered: gh's behaviour itself. The `gh pr view` not-found text and the `gh pr
 * checks --json` fields are transcribed from probes on gh 2.88.1 (2026-10-09).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { CI_WAIT_SCRIPT } from './seam.js'
import { WARM_HOOK_TIMEOUT_MS, buildScriptedShim, createFakeBin, scopedEnv, warmFakeBin, type FakeBin } from '../evidence-policy/scripted-shim.js'

// ---------------------------------------------------------------------------
// The .cjs seam — transcribed from the module's JSDoc; open it before changing
// ---------------------------------------------------------------------------

interface Check { name: string; bucket: string }
interface Classification { status: string; reason: string | null; failing: string[]; pending: string[] }
interface CiResult { status: string; pr: string; head: string; failing: string[]; pending: string[]; waited: number; reason: string | null }
interface ExecResult { status: number | null; stdout?: string; stderr?: string; error?: { code?: string } }
type ExecFn = (file: string, args: string[], opts: Record<string, unknown>) => ExecResult
interface Clock { now: () => number; sleep: (ms: number) => Promise<void> }
interface CiWait {
  readonly STATUSES: readonly string[]
  readonly REASONS: readonly string[]
  readonly BUCKETS: readonly string[]
  readonly CI_WAIT_MAX_SECONDS: number
  readonly POLL_INTERVAL_SECONDS: number
  readonly SETTLE_WINDOW_SECONDS: number
  readonly GH_CALL_CAP_SECONDS: number
  readonly MAX_POLLS: number
  readonly MAX_CONSECUTIVE_GH_FAILURES: number
  readonly LINE_MAX: number
  readonly NAME_MAX: number
  readonly NAMES_LISTED: number
  readonly LINE_RE: RegExp
  readonly USAGE_LINE: string
  parseArgs(args: readonly string[]): { pr: string; head: string } | null
  sanitizeName(name: unknown): string
  formatNames(names: readonly string[]): string
  classifyChecks(checks: readonly Check[]): Classification
  renderLine(result: CiResult): string
  checkLine(line: string): boolean
  waitForCi(input: { pr: string; head: string; exec: ExecFn; clock: Clock }): Promise<CiResult>
  main(argv: readonly string[], deps?: { exec?: ExecFn; clock?: Clock }): Promise<{ code: number; stdout: string }>
}
const CW = createRequire(import.meta.url)(CI_WAIT_SCRIPT) as CiWait

const SOURCE = fs.readFileSync(CI_WAIT_SCRIPT, 'utf8')

const HEAD = 'a'.repeat(40)
const OLD_HEAD = 'b'.repeat(40)
const PR = '12'
/** The gh reply when the pull request does not exist (gh 2.88.1, probed). */
const NO_PR_STDERR = 'GraphQL: Could not resolve to a PullRequest with the number of 999999999. (repository.pullRequest)\n'
const NO_CHECKS_STDERR = "no checks reported on the 'feat/x' branch\n"
const MAX_MS = 570_000

// ---------------------------------------------------------------------------
// A virtual world: gh as a function of the call and the time, a clock that moves
// ---------------------------------------------------------------------------

/** What the fake gh does with one call. `took` is the call's duration; `hang` runs out its timeout. */
interface Reply { status?: number | null; stdout?: string; stderr?: string; error?: { code: string }; took?: number; hang?: boolean }
type Kind = 'view' | 'checks'
type Script = (call: { kind: Kind; nth: number; elapsed: number }) => Reply

interface Recorded { file: string; args: string[]; timeout: number; elapsedBefore: number; shell: unknown }

class World {
  t = 1_000_000
  readonly start = this.t
  readonly calls: Recorded[] = []
  readonly sleeps: number[] = []
  readonly violations: string[] = []
  private readonly counts: Record<Kind, number> = { view: 0, checks: 0 }

  constructor(private readonly script: Script, private readonly moves = true) {}

  get elapsed(): number { return this.t - this.start }

  readonly exec: ExecFn = (file, args, opts) => {
    const timeout = Number(opts.timeout)
    const rec: Recorded = { file, args: [...args], timeout, elapsedBefore: this.elapsed, shell: opts.shell }
    this.calls.push(rec)
    if (file !== 'gh') this.violations.push(`a non-gh file was spawned: ${file}`)
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) this.violations.push('argv is not an array of strings')
    if (opts.shell === true) this.violations.push('gh was run through a shell')
    if (!(timeout > 0 && timeout <= 30_000)) this.violations.push(`a gh timeout of ${timeout} ms is outside (0, 30000]`)
    if (this.elapsed + timeout > MAX_MS + 1) this.violations.push(`a gh call at ${this.elapsed} ms was given ${timeout} ms, past ${MAX_MS}`)
    const kind: Kind = args[1] === 'view' ? 'view' : 'checks'
    const reply = this.script({ kind, nth: this.counts[kind]++, elapsed: this.elapsed })
    const took = reply.hang === true ? timeout : Math.min(reply.took ?? 1000, timeout)
    if (this.moves) this.t += took
    if (reply.hang === true) return { status: null, error: { code: 'ETIMEDOUT' } }
    if (reply.error !== undefined) return { status: null, error: reply.error }
    return { status: reply.status ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
  }

  readonly clock: Clock = {
    now: () => this.t,
    sleep: async ms => { this.sleeps.push(ms); if (this.moves) this.t += ms },
  }

  of(kind: Kind): Recorded[] { return this.calls.filter(c => c.args[1] === kind) }
}

const viewOk = (head = HEAD): Reply => ({ stdout: JSON.stringify({ headRefOid: head }) })
const rows = (...buckets: string[]): string => JSON.stringify(buckets.map((bucket, i) => ({ name: `check-${i + 1}`, state: bucket.toUpperCase(), bucket })))
const checksOk = (...buckets: string[]): Reply => ({ stdout: rows(...buckets), status: buckets.includes('pending') ? 8 : 0 })
const argvOf = (head = HEAD, pr = PR): string[] => ['node', 'ci-wait.cjs', '--pr', pr, '--head', head]

interface Ran { line: string; stdout: string; code: number; world: World }

/** Run main() over a world; asserts the contract every case shares. */
async function run(script: Script, opts: { moves?: boolean; argv?: string[] } = {}): Promise<Ran> {
  const world = new World(script, opts.moves ?? true)
  const out = await CW.main(opts.argv ?? argvOf(), { exec: world.exec, clock: world.clock })
  expect(out.stdout, 'stdout is exactly one line').toMatch(/^[^\n]+\n$/)
  const line = out.stdout.slice(0, -1)
  expect(CW.LINE_RE.test(line), `the line matches the grammar: ${line}`).toBe(true)
  expect(CW.checkLine(line)).toBe(true)
  expect(line.length).toBeLessThanOrEqual(400)
  expect(out.code, 'exit 0 whenever a line was printed').toBe(0)
  expect(world.violations).toEqual([])
  expect(world.elapsed, 'virtual time never passes the 570 s deadline').toBeLessThanOrEqual(MAX_MS)
  return { line, stdout: out.stdout, code: out.code, world }
}

const statusOf = (line: string): string => line.split(' ')[1]
const field = (line: string, key: string): string | undefined => new RegExp(`(?:^| )${key}=(\\S*)`).exec(line)?.[1]
const waitedOf = (line: string): number => Number(field(line, 'waited'))

// ---------------------------------------------------------------------------
// The module's surface
// ---------------------------------------------------------------------------

describe('D-CI-WAIT-BOUNDS: the module carries its bounds and its vocabulary', () => {
  it('exports the six statuses in check-ci-status\'s order, the reasons and the documented buckets', () => {
    expect(CW.STATUSES).toEqual(['PASSING', 'FAILING', 'PENDING', 'NO_CI', 'NO_PR', 'INDETERMINATE'])
    expect(CW.REASONS).toEqual(['gh-failed', 'unparseable', 'unrecognised-bucket', 'head-mismatch', 'deadline', 'usage'])
    expect(CW.BUCKETS).toEqual(['pass', 'fail', 'pending', 'skipping', 'cancel'])
  })

  it('holds the constants the ticket pins', () => {
    expect(CW.CI_WAIT_MAX_SECONDS).toBe(570)
    expect(CW.POLL_INTERVAL_SECONDS).toBe(20)
    expect(CW.SETTLE_WINDOW_SECONDS).toBe(90)
    expect(CW.GH_CALL_CAP_SECONDS).toBe(30)
    expect(CW.MAX_POLLS).toBe(40)
    expect(CW.MAX_CONSECUTIVE_GH_FAILURES).toBe(3)
    expect(CW.CI_WAIT_MAX_SECONDS, 'under the Bash timeout of 600000 ms the callers pass').toBeLessThan(600)
  })
})

// ---------------------------------------------------------------------------
// AC-8: the verdicts, through injected exec and clock
// ---------------------------------------------------------------------------

describe('AC-8: waitForCi gives the expected verdict, in one line, with no real gh and no real sleep', () => {
  it('passing: every check passes on the named head', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass', 'pass', 'skipping')))
    expect(r.line).toBe('CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=2')
    expect(r.world.of('checks')).toHaveLength(1)
  })

  it('failing: the failing and cancelled names are listed, and nothing waits', async () => {
    const r = await run(({ kind }) => (kind === 'view'
      ? viewOk()
      : { stdout: JSON.stringify([{ name: 'build', bucket: 'pass' }, { name: 'lint', bucket: 'fail' }, { name: 'e2e (linux)', bucket: 'cancel' }]) }))
    expect(r.line).toBe('CI FAILING pr=12 head=aaaaaaa failing=lint,e2e (linux) pending=- waited=2')
    expect(r.world.sleeps).toEqual([])
  })

  it('pending then passing: it sleeps the poll interval between polls and returns PASSING', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth < 2 ? checksOk('pass', 'pending') : checksOk('pass', 'pass')))
    expect(statusOf(r.line)).toBe('PASSING')
    expect(r.world.sleeps).toEqual([20_000, 20_000])
    expect(waitedOf(r.line)).toBe(46)
  })

  it('pending past the deadline: PENDING with the pending names, inside 570 s', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { stdout: JSON.stringify([{ name: 'slow', bucket: 'pending' }, { name: 'ok', bucket: 'pass' }]), status: 8 }))
    expect(r.line).toMatch(/^CI PENDING pr=12 head=aaaaaaa failing=- pending=slow waited=\d+$/)
    expect(waitedOf(r.line)).toBeGreaterThan(500)
    expect(waitedOf(r.line)).toBeLessThanOrEqual(570)
    expect(r.world.elapsed).toBeLessThanOrEqual(MAX_MS)
  })

  it('no checks inside the settle window, then checks appear: the checks decide, not NO_CI', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth < 2 ? { stdout: '[]' } : checksOk('pass')))
    expect(statusOf(r.line)).toBe('PASSING')
    expect(r.world.sleeps).toHaveLength(2)
  })

  it('no checks after the settle window: NO_CI, after the window and well before the deadline', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { stdout: '[]' }))
    expect(statusOf(r.line)).toBe('NO_CI')
    expect(waitedOf(r.line)).toBeGreaterThanOrEqual(90)
    expect(waitedOf(r.line)).toBeLessThan(150)
  })

  it('"no checks reported" on exit 1 is no checks, not a gh failure', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { status: 1, stderr: NO_CHECKS_STDERR }))
    expect(statusOf(r.line)).toBe('NO_CI')
  })

  it('a gh failure: three failed polls in a row are INDETERMINATE (gh-failed), never PASSING', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? { status: 1, stderr: 'HTTP 502: Bad Gateway\n' } : checksOk('pass')))
    expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=gh-failed$/)
    expect(r.world.of('view')).toHaveLength(3)
    expect(r.world.of('checks'), 'checks are not read behind a failed view').toHaveLength(0)
  })

  it('a head mismatch: INDETERMINATE (head-mismatch) after the settle window, and the checks are never read', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(OLD_HEAD) : checksOk('pass', 'pass')))
    expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=head-mismatch$/)
    expect(r.world.of('checks')).toHaveLength(0)
  })

  it('a pull request that does not exist is NO_PR on exit 1, and nothing else is read', async () => {
    const r = await run(() => ({ status: 1, stderr: NO_PR_STDERR }))
    expect(r.line).toBe('CI NO_PR pr=12 head=aaaaaaa failing=- pending=- waited=1')
    expect(r.world.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// gh's exit codes and replies
// ---------------------------------------------------------------------------

describe('gh exit codes: 0 and 8 are results on `gh pr checks`, NO_PR needs exit 1 and its text', () => {
  it('exit 8 with a JSON body is a result: the pending check is read, not treated as a failure', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth === 0 ? { status: 8, stdout: rows('pending', 'pass') } : checksOk('pass', 'pass')))
    expect(statusOf(r.line)).toBe('PASSING')
    expect(r.world.sleeps).toEqual([20_000])
  })

  it('the not-found text on any exit but 1 is a gh failure, never NO_PR', async () => {
    for (const status of [2, 4, 8, 128]) {
      const r = await run(() => ({ status, stderr: NO_PR_STDERR }))
      expect(r.line, `exit ${status}`).toMatch(/reason=gh-failed$/)
    }
  })

  it('exit 1 with another message is a gh failure, never NO_PR', async () => {
    const r = await run(() => ({ status: 1, stderr: 'HTTP 401: Bad credentials\n' }))
    expect(r.line).toMatch(/^CI INDETERMINATE .* reason=gh-failed$/)
  })

  it('exit 1 on `gh pr checks` with another message is a gh failure, never NO_CI', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { status: 1, stderr: 'HTTP 403: rate limit exceeded\n' }))
    expect(r.line).toMatch(/^CI INDETERMINATE .* reason=gh-failed$/)
  })

  it('an exec that throws, errors or hangs is a gh failure', async () => {
    const thrown = new World(() => viewOk())
    const out = await CW.main(argvOf(), { exec: () => { throw new Error('spawn gh ENOENT') }, clock: thrown.clock })
    expect(out.stdout).toMatch(/^CI INDETERMINATE .* reason=gh-failed\n$/)
    const missing = await run(() => ({ error: { code: 'ENOENT' } }))
    expect(missing.line).toMatch(/reason=gh-failed$/)
    const hung = await run(() => ({ hang: true }))
    expect(hung.line).toMatch(/reason=gh-failed$/)
  })

  it('one failed poll is retried: a transient failure followed by a pass is PASSING', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? (nth === 0 ? { status: 1, stderr: 'HTTP 502\n' } : viewOk()) : checksOk('pass')))
    expect(statusOf(r.line)).toBe('PASSING')
  })

  it('failures must be consecutive: a success between them resets the count', async () => {
    const r = await run(({ kind, nth }) => {
      if (kind === 'checks') return checksOk('pending')
      return nth % 2 === 0 ? { status: 1, stderr: 'HTTP 502\n' } : viewOk()
    })
    expect(field(r.line, 'reason'), 'alternating failures never reach three in a row').not.toBe('gh-failed')
    expect(['PENDING', 'INDETERMINATE']).toContain(statusOf(r.line))
    expect(r.world.elapsed, 'the wait ran to the deadline').toBeGreaterThan(499_999)
  })
})

describe('AC-9: PASSING is never printed for what is not a pass', () => {
  const unknowns: ReadonlyArray<readonly [string, Script, string]> = [
    ['an unparseable view reply', ({ kind }) => (kind === 'view' ? { stdout: '<html>rate limited</html>' } : checksOk('pass')), 'unparseable'],
    ['a view reply with no headRefOid', ({ kind }) => (kind === 'view' ? { stdout: '{"number":12}' } : checksOk('pass')), 'unparseable'],
    ['a view reply with a short headRefOid', ({ kind }) => (kind === 'view' ? { stdout: '{"headRefOid":"aaaa"}' } : checksOk('pass')), 'unparseable'],
    ['an unparseable checks reply', ({ kind }) => (kind === 'view' ? viewOk() : { stdout: 'not json' }), 'unparseable'],
    ['a checks reply that is not a list', ({ kind }) => (kind === 'view' ? viewOk() : { stdout: '{"name":"x"}' }), 'unparseable'],
    ['a check row with no bucket', ({ kind }) => (kind === 'view' ? viewOk() : { stdout: '[{"name":"x"}]' }), 'unparseable'],
    ['a check row with a non-string name', ({ kind }) => (kind === 'view' ? viewOk() : { stdout: '[{"name":7,"bucket":"pass"}]' }), 'unparseable'],
    ['an unrecognised bucket beside a pass', ({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass', 'neutral')), 'unrecognised-bucket'],
    ['only skipping checks', ({ kind }) => (kind === 'view' ? viewOk() : checksOk('skipping', 'skipping')), 'unrecognised-bucket'],
    ['a head mismatch with passing checks on the old head', ({ kind }) => (kind === 'view' ? viewOk(OLD_HEAD) : checksOk('pass')), 'head-mismatch'],
  ]

  for (const [label, script, reason] of unknowns) {
    it(`${label}: INDETERMINATE (${reason})`, async () => {
      const r = await run(script)
      expect(statusOf(r.line)).toBe('INDETERMINATE')
      expect(field(r.line, 'reason')).toBe(reason)
    })
  }

  it('a still-pending check at the deadline is PENDING, not PASSING', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass', 'pending')))
    expect(statusOf(r.line)).toBe('PENDING')
  })

  it('a gh that fails every call until the deadline is never PASSING', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { status: 1, stderr: 'boom\n' }))
    expect(statusOf(r.line)).toBe('INDETERMINATE')
  })
})

// ---------------------------------------------------------------------------
// AC-9: the clock
// ---------------------------------------------------------------------------

describe('AC-9: on the injected clock, nothing waits past 570 s', () => {
  it('slow gh calls (29 s each) under a pending check stay inside the deadline, every timeout counted', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? { ...viewOk(), took: 29_000 } : { ...checksOk('pending'), took: 29_000 }))
    expect(statusOf(r.line)).toBe('PENDING')
    expect(r.world.elapsed).toBeLessThanOrEqual(MAX_MS)
    expect(r.world.calls.every(c => c.timeout <= 30_000)).toBe(true)
  })

  it('the last gh call is given only the time that remains', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? { ...viewOk(), took: 30_000 } : { ...checksOk('pending'), took: 30_000 }))
    const lastTimeouts = r.world.calls.slice(-3).map(c => c.timeout)
    expect(Math.min(...lastTimeouts)).toBeLessThan(30_000)
    expect(r.world.calls.every(c => c.elapsedBefore + c.timeout <= MAX_MS + 1)).toBe(true)
  })

  it('a gh that hangs on every call costs three timeouts and two sleeps, then gh-failed', async () => {
    const r = await run(() => ({ hang: true }))
    expect(r.line).toMatch(/reason=gh-failed$/)
    expect(r.world.calls).toHaveLength(3)
    expect(r.world.elapsed).toBe(3 * 30_000 + 2 * 20_000)
  })

  it('a gh that hangs on every other call still ends inside the deadline', async () => {
    const r = await run(({ kind, nth }) => (nth % 2 === 0 ? { hang: true } : kind === 'view' ? viewOk() : checksOk('pending')))
    expect(['PENDING', 'INDETERMINATE']).toContain(statusOf(r.line))
    expect(r.world.elapsed).toBeLessThanOrEqual(MAX_MS)
  })

  it('a clock that does not move is stopped by MAX_POLLS, with the last state', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : checksOk('pending')), { moves: false })
    expect(statusOf(r.line)).toBe('PENDING')
    expect(r.world.of('view')).toHaveLength(CW.MAX_POLLS)
    expect(r.world.sleeps).toHaveLength(CW.MAX_POLLS)
  })

  it('a clock that does not move and a gh that fails is still bounded', async () => {
    const r = await run(() => ({ status: 1, stderr: 'boom\n' }), { moves: false })
    expect(r.world.calls.length).toBeLessThanOrEqual(CW.MAX_POLLS * 2)
    expect(statusOf(r.line)).toBe('INDETERMINATE')
  })

  it('INDETERMINATE (deadline) is what an unknown state becomes when time runs out', async () => {
    // Two failed polls and then a pending one cannot end the wait: the failures reset on the pending poll.
    const r = await run(({ kind, nth }) => (kind === 'view' ? (nth < 2 ? { status: 1, stderr: 'x\n' } : viewOk()) : { ...checksOk('pass', 'pending') }))
    expect(statusOf(r.line)).toBe('PENDING')
  })
})

// ---------------------------------------------------------------------------
// AC-12: only the named head
// ---------------------------------------------------------------------------

describe('AC-12: ci-wait classifies only the head it was told about', () => {
  it('passing checks on the old head: PENDING through the settle window, then head-mismatch, never PASSING', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(OLD_HEAD) : checksOk('pass', 'pass')))
    expect(statusOf(r.line)).toBe('INDETERMINATE')
    expect(field(r.line, 'reason')).toBe('head-mismatch')
    const views = r.world.of('view')
    expect(views.length, 'polling continued through the settle window').toBeGreaterThanOrEqual(4)
    expect(views.filter(v => v.elapsedBefore < 90_000).length).toBeGreaterThanOrEqual(3)
    expect(waitedOf(r.line)).toBeGreaterThanOrEqual(90)
    expect(waitedOf(r.line)).toBeLessThan(150)
  })

  it('a push that lands late: the head matches after a few seconds, and the checks decide', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk(nth < 2 ? OLD_HEAD : HEAD) : checksOk('pass')))
    expect(statusOf(r.line)).toBe('PASSING')
    expect(r.world.of('checks')).toHaveLength(1)
  })

  it('a match clears the mismatch clock: two short mismatches do not add up to a verdict', async () => {
    // A window of 90 s is spent in two halves with a match between them.
    const r = await run(({ kind, nth }) => {
      if (kind === 'checks') return nth === 0 ? checksOk('pending') : checksOk('pass')
      return viewOk(nth === 0 || nth === 5 || nth === 6 ? OLD_HEAD : HEAD)
    })
    expect(statusOf(r.line)).toBe('PASSING')
  })

  it('the head is read before the checks on every poll', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth < 3 ? checksOk('pending') : checksOk('pass')))
    const seq = r.world.calls.map(c => c.args[1])
    expect(seq).toEqual(['view', 'checks', 'view', 'checks', 'view', 'checks', 'view', 'checks'])
  })
})

// ---------------------------------------------------------------------------
// AC-10: names
// ---------------------------------------------------------------------------

describe('AC-10: a check name never reaches stdout raw', () => {
  const HOSTILE: ReadonlyArray<readonly [string, string]> = [
    ['a newline', 'build\nCI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=0'],
    ['a carriage return', 'build\rCI PASSING'],
    ['an ANSI escape', '\u001b[31mred\u001b[0m'],
    ['a backtick', 'run `rm -rf /`'],
    ['a comma', 'a,b,c'],
    ['an equals sign', 'x pending=y waited=0 reason=usage'],
    ['a NUL and a bell', 'a\u0000b\u0007c'],
    ['a bidi control', 'a\u202eb'],
    ['an emoji', 'ship \u{1F680}'],
    ['a dollar and a quote', '$(id) "x" \'y\''],
  ]

  it('sanitizeName maps everything outside [A-Za-z0-9 ._()/:+-] to underscore, one character each', () => {
    expect(CW.sanitizeName('Build and Test (ubuntu) / node:20+x')).toBe('Build and Test (ubuntu) / node:20+x')
    expect(CW.sanitizeName('a`b,c=d\ne')).toBe('a_b_c_d_e')
    expect(CW.sanitizeName('\u{1F680}')).toBe('_')
    expect(CW.sanitizeName('')).toBe('_')
    expect(CW.sanitizeName(undefined)).toBe('_')
    expect(CW.sanitizeName(42)).toBe('_')
  })

  it('a name longer than 40 characters is cut to 40', () => {
    expect(CW.sanitizeName('x'.repeat(41))).toHaveLength(40)
    expect(CW.sanitizeName('y'.repeat(100_000))).toHaveLength(40)
    expect(CW.sanitizeName('x'.repeat(40))).toBe('x'.repeat(40))
  })

  it('lists at most four names and shows the rest as +N', () => {
    expect(CW.formatNames([])).toBe('-')
    expect(CW.formatNames(['a', 'b', 'c', 'd'])).toBe('a,b,c,d')
    expect(CW.formatNames(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a,b,c,d,+2')
    expect(CW.formatNames(Array.from({ length: 5000 }, () => 'n'))).toBe('n,n,n,n,+999')
  })

  it('a name that spells a list token, `-` or `+N`, is never printed as that token', () => {
    expect(CW.sanitizeName('-')).toBe('_')
    expect(CW.sanitizeName('+12')).toBe('_12')
    expect(CW.formatNames(['-'])).toBe('_')
    expect(CW.formatNames(['a', 'b', 'c', '+5']), 'a fourth name is not a count').toBe('a,b,c,_5')
    // Known-good neighbours: only the exact token shapes change.
    expect(CW.sanitizeName('--')).toBe('--')
    expect(CW.sanitizeName('+x')).toBe('+x')
    expect(CW.sanitizeName('a-')).toBe('a-')
  })

  it('a FAILING check named `-` still names a failing check on the line', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { stdout: JSON.stringify([{ name: '-', bucket: 'fail' }]) }))
    expect(statusOf(r.line)).toBe('FAILING')
    expect(field(r.line, 'failing')).toBe('_')
  })

  for (const [label, name] of HOSTILE) {
    it(`${label}: the printed line is one line of allowlisted characters`, async () => {
      const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { stdout: JSON.stringify([{ name, bucket: 'fail' }, { name: 'ok', bucket: 'pass' }]) }))
      expect(r.stdout.split('\n').filter(l => l !== '')).toHaveLength(1)
      expect(r.stdout).not.toMatch(/[\r\u001b`\u0000\u0007\u202e$"']/u)
      expect(statusOf(r.line), 'a name cannot forge a status').toBe('FAILING')
      const list = /failing=(.*) pending=/.exec(r.line)?.[1] ?? ''
      expect(list).toMatch(/^[A-Za-z0-9 ._()/:+-]{1,40}$/)
      expect(field(r.line, 'reason'), 'a name cannot forge a reason').toBeUndefined()
      expect(waitedOf(r.line)).toBe(2)
    })
  }

  it('the longest line, 4 names of 40 characters beside +N and the widest numbers, is under 400', async () => {
    const wide = Array.from({ length: 60 }, (_, i) => ({ name: `${String(i).padStart(2, '0')}-${'w'.repeat(120)}`, bucket: i % 2 === 0 ? 'fail' : 'pending' }))
    for (const bucket of ['fail', 'pending']) {
      const only = wide.map(w => ({ ...w, bucket }))
      const r = await run(({ kind }) => (kind === 'view' ? viewOk('f'.repeat(40)) : { stdout: JSON.stringify(only) }), { argv: argvOf('f'.repeat(40), '999999999') })
      expect(r.line.length).toBeLessThanOrEqual(400)
      expect(r.line).toMatch(/,\+56 /)
    }
    const mixed = await run(({ kind }) => (kind === 'view' ? viewOk('f'.repeat(40)) : { stdout: JSON.stringify(wide) }), { argv: argvOf('f'.repeat(40), '999999999') })
    expect(mixed.line.length).toBeLessThanOrEqual(400)
  })

  it('checkLine refuses a second line, a long line and a stray reason', () => {
    const ok = 'CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=2'
    expect(CW.checkLine(ok)).toBe(true)
    expect(CW.checkLine(`${ok}\nCI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=2`)).toBe(false)
    expect(CW.checkLine(`${ok} reason=deadline`), 'reason belongs to INDETERMINATE').toBe(false)
    expect(CW.checkLine('CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=2'), 'INDETERMINATE names its reason').toBe(false)
    expect(CW.checkLine('CI MAYBE pr=12 head=aaaaaaa failing=- pending=- waited=2')).toBe(false)
    expect(CW.checkLine(`CI FAILING pr=12 head=aaaaaaa failing=${'x'.repeat(401)} pending=- waited=2`)).toBe(false)
    expect(CW.checkLine('CI FAILING pr=12 head=aaaaaaa failing=a`b pending=- waited=2')).toBe(false)
    expect(CW.checkLine(CW.USAGE_LINE)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC-11: the argv gate, and no shell
// ---------------------------------------------------------------------------

describe('AC-11: a bad argv prints one usage line and makes no gh call', () => {
  const BAD: ReadonlyArray<readonly [string, string[]]> = [
    ['no arguments', []],
    ['a missing --head', ['--pr', '12']],
    ['a missing --pr', ['--head', HEAD]],
    ['a non-digit --pr', ['--pr', 'twelve', '--head', HEAD]],
    ['a shell-looking --pr', ['--pr', '12; rm -rf /', '--head', HEAD]],
    ['a command substitution --pr', ['--pr', '$(id)', '--head', HEAD]],
    ['a negative --pr', ['--pr', '-1', '--head', HEAD]],
    ['a --pr with a leading zero', ['--pr', '012', '--head', HEAD]],
    ['a zero --pr', ['--pr', '0', '--head', HEAD]],
    ['a ten-digit --pr', ['--pr', '1234567890', '--head', HEAD]],
    ['a short --head', ['--pr', '12', '--head', 'abc1234']],
    ['an uppercase --head', ['--pr', '12', '--head', 'A'.repeat(40)]],
    ['a non-hex --head', ['--pr', '12', '--head', 'g'.repeat(40)]],
    ['a 41-hex --head', ['--pr', '12', '--head', 'a'.repeat(41)]],
    ['a ref name for --head', ['--pr', '12', '--head', 'HEAD']],
    ['an option-looking --head', ['--pr', '12', '--head', '--version']],
    ['a repeated --pr', ['--pr', '12', '--pr', '13']],
    ['a repeated --head', ['--head', HEAD, '--head', HEAD]],
    ['an unknown flag', ['--pr', '12', '--repo', 'o/r']],
    ['an extra argument', ['--pr', '12', '--head', HEAD, '--force']],
    ['the = form', [`--pr=12`, `--head=${HEAD}`]],
    ['an empty value', ['--pr', '', '--head', HEAD]],
  ]

  for (const [label, args] of BAD) {
    it(`${label}`, async () => {
      const world = new World(() => viewOk())
      const out = await CW.main(['node', 'ci-wait.cjs', ...args], { exec: world.exec, clock: world.clock })
      expect(out).toEqual({ code: 0, stdout: 'CI INDETERMINATE pr=- head=- waited=0 reason=usage\n' })
      expect(world.calls, 'no gh call').toHaveLength(0)
      expect(world.sleeps).toEqual([])
      expect(CW.parseArgs(args)).toBeNull()
    })
  }

  it('accepts either flag order, and a pr of up to nine digits', () => {
    expect(CW.parseArgs(['--pr', '12', '--head', HEAD])).toEqual({ pr: '12', head: HEAD })
    expect(CW.parseArgs(['--head', HEAD, '--pr', '999999999'])).toEqual({ pr: '999999999', head: HEAD })
  })

  it('gh is spawned with an argv array, the file `gh`, no shell, and only the PR number and fixed words', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass')))
    expect(r.world.calls.map(c => [c.file, ...c.args])).toEqual([
      ['gh', 'pr', 'view', PR, '--json', 'headRefOid'],
      ['gh', 'pr', 'checks', PR, '--json', 'name,state,bucket'],
    ])
    expect(r.world.calls.every(c => c.shell === false)).toBe(true)
  })

  it('--head is never passed to gh: it is compared, not forwarded', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass')))
    expect(r.world.calls.flatMap(c => c.args)).not.toContain(HEAD)
  })
})

// ---------------------------------------------------------------------------
// The classifier's own rows (AC-14's prose parity lives in merge-readiness.test.ts)
// ---------------------------------------------------------------------------

describe('D-CI-CLASSIFIER: the bucket classifier', () => {
  const c = (...buckets: string[]): Check[] => buckets.map((bucket, i) => ({ name: `n${i}`, bucket }))
  const ROWS: ReadonlyArray<readonly [string[], string]> = [
    [['pass'], 'PASSING'],
    [['pass', 'skipping'], 'PASSING'],
    [['skipping'], 'INDETERMINATE'],
    [['skipping', 'skipping'], 'INDETERMINATE'],
    [['pass', 'pending'], 'PENDING'],
    [['fail', 'pending'], 'PENDING'],
    [['pass', 'fail'], 'FAILING'],
    [['pass', 'cancel'], 'FAILING'],
    [['cancel'], 'FAILING'],
    [['pass', 'neutral'], 'INDETERMINATE'],
    [['neutral'], 'INDETERMINATE'],
    [['neutral', 'pending'], 'PENDING'],
    [['neutral', 'fail'], 'FAILING'],
    [[], 'INDETERMINATE'],
  ]

  for (const [buckets, want] of ROWS) {
    it(`[${buckets.join(', ')}] is ${want}`, () => {
      expect(CW.classifyChecks(c(...buckets)).status).toBe(want)
    })
  }

  it('lists the failing and pending names, and carries a reason on INDETERMINATE only', () => {
    const v = CW.classifyChecks([{ name: 'a', bucket: 'pending' }, { name: 'b', bucket: 'fail' }, { name: 'c', bucket: 'cancel' }])
    expect(v).toEqual({ status: 'PENDING', reason: null, failing: ['b', 'c'], pending: ['a'] })
    expect(CW.classifyChecks(c('neutral')).reason).toBe('unrecognised-bucket')
    expect(CW.classifyChecks(c('pass')).reason).toBeNull()
  })

  it('reads its input in bounded steps', () => {
    const many = Array.from({ length: 5000 }, () => ({ name: 'n', bucket: 'pass' }))
    expect(CW.classifyChecks(many).status).toBe('PASSING')
  })
})

// ---------------------------------------------------------------------------
// The real script, as a process
// ---------------------------------------------------------------------------

describe('the script as a process: the usage line, and a scripted gh', () => {
  let root: string
  let bin: FakeBin

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ci-wait-'))
    bin = createFakeBin(root, ['gh'])
    // macOS scans a newly written executable on its first run; pay it here, once.
    warmFakeBin(bin, root)
  }, WARM_HOOK_TIMEOUT_MS)
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

  function runScript(args: string[], extra: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, [CI_WAIT_SCRIPT, ...args], {
      cwd: root, env: scopedEnv(root, extra), encoding: 'utf8', timeout: 60_000,
    })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }

  it('a bad argv prints the usage line and exits 0 without a gh on the path', () => {
    const r = runScript(['--pr', 'abc', '--head', 'nothex'], { PATH: '/nonexistent' })
    expect(r).toEqual({ status: 0, stdout: 'CI INDETERMINATE pr=- head=- waited=0 reason=usage\n', stderr: '' })
  })

  it('a passing PR through the real spawnSync: gh is called with the fixed argv and the line is PASSING', () => {
    const shim = buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '12', '--json', 'headRefOid'], stdout: JSON.stringify({ headRefOid: HEAD }) },
      { tool: 'gh', args: ['pr', 'checks', '12', '--json', 'name,state,bucket'], stdout: rows('pass', 'skipping') },
    ])
    const r = runScript(['--pr', '12', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env })
    expect(r.stdout).toMatch(/^CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=\d+\n$/)
    expect(r.status).toBe(0)
    expect(shim.readLog()).toEqual([
      ['gh', 'pr', 'view', '12', '--json', 'headRefOid'],
      ['gh', 'pr', 'checks', '12', '--json', 'name,state,bucket'],
    ])
  })

  it('a missing pull request through the real spawnSync is NO_PR', () => {
    const shim = buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '999999999', '--json', 'headRefOid'], exit: 1, stderr: NO_PR_STDERR },
    ])
    const r = runScript(['--pr', '999999999', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env })
    expect(r.stdout).toMatch(/^CI NO_PR pr=999999999 head=aaaaaaa failing=- pending=- waited=\d+\n$/)
    expect(shim.readLog()).toHaveLength(1)
  })

  it('failing checks through the real spawnSync name the failing check on the one line, sanitized', () => {
    const shim = buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '7', '--json', 'headRefOid'], stdout: JSON.stringify({ headRefOid: HEAD }) },
      { tool: 'gh', args: ['pr', 'checks', '7', '--json', 'name,state,bucket'], stdout: JSON.stringify([{ name: 'lint\u001b[0m', state: 'FAILURE', bucket: 'fail' }]) },
    ])
    const r = runScript(['--pr', '7', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env })
    expect(r.stdout).toMatch(/^CI FAILING pr=7 head=aaaaaaa failing=lint__0m pending=- waited=\d+\n$/)
  })
})

// ---------------------------------------------------------------------------
// Source guards — each: a named collector, a non-empty corpus, a known-bad probe
// ---------------------------------------------------------------------------

/** Source lines with comment-only lines blanked (line numbers kept). */
function codeLines(source: string): string[] {
  return source.split('\n').map(l => (/^\s*(\*|\/\/|\/\*)/.test(l) ? '' : l))
}

/** Every way to reach a shell, a second spawn path or a literal sleep. */
function collectShellAndSleep(source: string): string[] {
  const code = codeLines(source).join('\n')
  const out: string[] = []
  for (const m of code.matchAll(/shell:\s*true|\bexec(?:File)?Sync\s*\(|childProcess\.exec(?:File)?\s*\(|\bspawn\s*\(|['"`]sleep\b|\bsleep\s+\d/g)) out.push(m[0])
  if ([...code.matchAll(/childProcess\.spawnSync\s*\(/g)].length !== 1) out.push('spawnSync call sites ≠ 1')
  return out
}

/** `process.exit(` and `process.abort(` in code lines. */
function collectExits(source: string): string[] {
  return [...codeLines(source).join('\n').matchAll(/process\.(?:exit|abort|reallyExit)\s*\(/g)].map(m => m[0])
}

/** Unbounded loop forms: `while (true)`, `for (;;)`, `while (1)`. */
function collectUnboundedLoops(source: string): string[] {
  return [...codeLines(source).join('\n').matchAll(/while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\)/g)].map(m => m[0])
}

describe('source guards (ci-wait.cjs)', () => {
  it('no shell, no exec, no literal sleep, one production spawnSync', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(collectShellAndSleep(SOURCE)).toEqual([])
    const probe = `${SOURCE}\nfunction bad() { childProcess.${'exec'}Sync('gh pr view'); ${'spawn'}Sync('sleep', ['20'], { shell: true }); run('sleep 20') }`
    expect(collectShellAndSleep(probe).length).toBeGreaterThanOrEqual(3)
  })

  it('never calls process.exit, and writes stdout once, at the boundary', () => {
    expect(collectExits(SOURCE)).toEqual([])
    expect(collectExits(`${SOURCE}\nprocess.${'exit'}(0)`)).toHaveLength(1)
    const code = codeLines(SOURCE).join('\n')
    expect([...code.matchAll(/process\.stdout\.write\(/g)]).toHaveLength(1)
    expect(code).toMatch(/if \(require\.main === module\)/)
    expect(code).toMatch(/process\.exitCode = /)
  })

  it('every loop is bounded', () => {
    expect(collectUnboundedLoops(SOURCE)).toEqual([])
    expect(collectUnboundedLoops(`${SOURCE}\nwhile (true) {}`)).toHaveLength(1)
    expect(SOURCE).toMatch(/for \(let poll = 0; poll < MAX_POLLS; poll\+\+\)/)
  })

  it('requires only the node built-in it spawns through', () => {
    const requires = [...SOURCE.matchAll(/\brequire\(((?:[^()]|\([^()]*\))*)\)/g)].map(m => m[1])
    expect(requires).toEqual(["'child_process'"])
  })

  it('carries each design decision at its code site', () => {
    for (const marker of [
      'D-CI-WAIT-INLINE', 'D-CI-NO-LITERAL-SLEEP', 'D-CI-NO-EXIT', 'D-CI-WAIT-BOUNDS', 'D-CI-HEAD-BINDING',
      'D-CI-CLASSIFIER', 'D-CI-SANITIZE', 'D-CI-LINE', 'D-CI-ARGV', 'D-CI-STATUSES',
    ]) {
      expect(SOURCE, `${marker} missing`).toContain(marker)
    }
  })

  it('pins the ratchet constant exactly once, as the manifest spells it', () => {
    expect(SOURCE.split('const CI_WAIT_MAX_SECONDS = 570;').length - 1).toBe(1)
  })
})
