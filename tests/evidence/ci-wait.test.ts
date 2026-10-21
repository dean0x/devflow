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
 *   D-CI-CLASSIFIER      AC-14: the classifier agrees with check-ci-status step 5 over
 *                        `bucket`. That parity case lives in merge-readiness.test.ts,
 *                        beside the prose interpreter; this suite holds the classifier's
 *                        own rows.
 *   D-CI-WORKFLOW-RULE   PASSING needs a passing check that is a GitHub Actions job (a
 *                        non-empty `workflow`). Passes from external checks alone are
 *                        PENDING through the settle window, then INDETERMINATE
 *                        (no-workflow-check). The window is the empty list's own clock,
 *                        which a pending or failing row clears.
 *   D-CI-MERGE-STATE     `mergeable` CONFLICTING on the named head is INDETERMINATE
 *                        (merge-conflict) at once. NO_CI and PASSING need MERGEABLE in
 *                        the same poll; UNKNOWN, absent or any other value keeps the wait
 *                        open, and the deadline gives INDETERMINATE (deadline), never
 *                        PENDING. mergeGate and matchedStep hold the rule as pure
 *                        functions, tested as tables.
 *   D-CI-WORKFLOWS       An empty check list reads NO_CI only when the settle window is
 *                        done, GitHub reports the PR MERGEABLE, and one read-only probe of
 *                        the repository's workflow list finds no active workflow file under
 *                        `.github/workflows/`. An active one ends the window as INDETERMINATE
 *                        (no-workflow-check); a probe that fails or cannot be read never
 *                        gives NO_CI. The probe is made at most once, and only on that path.
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
 * checks --json` fields are transcribed from probes on gh 2.88.1 (2026-10-09); the
 * workflow list's `total_count`, `path` and `state` fields from a probe on 2026-10-22.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { CI_WAIT_SCRIPT } from './seam.js'
import { WARM_HOOK_TIMEOUT_MS, buildScriptedShim, createFakeBin, scopedEnv, warmFakeBin, type FakeBin, type ScriptedShim } from '../evidence-policy/scripted-shim.js'

// ---------------------------------------------------------------------------
// The .cjs seam — transcribed from the module's JSDoc; open it before changing
// ---------------------------------------------------------------------------

interface Check { name: string; bucket: string; workflow?: string }
interface Classification { status: string; reason: string | null; failing: string[]; pending: string[] }
type MergeGateResult = 'keep' | 'open' | 'conflict'
type MatchedStep =
  | { state: 'pending'; pending: string[] }
  | { state: 'open' }
  | { state: 'probe' }
  | { state: 'done'; status: string; reason: string | null; failing: string[]; pending: string[] }
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
  readonly WORKFLOWS_ARGS: readonly string[]
  parseArgs(args: readonly string[]): { pr: string; head: string } | null
  sanitizeName(name: unknown): string
  formatNames(names: readonly string[]): string
  classifyChecks(checks: readonly Check[]): Classification
  mergeGate(status: string | null, mergeable: unknown, workflowsActive?: boolean | null): MergeGateResult
  matchedStep(verdict: Classification | null, mergeable: unknown, windowDone: boolean, workflowsActive?: boolean | null): MatchedStep
  parseActiveWorkflows(stdout: string): boolean | null
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

/** How long a fake gh call takes when its reply names no `took`. */
const DEFAULT_CALL_MS = 1000

/** What the fake gh does with one call. `took` is the call's duration; `hang` runs out its timeout. */
interface Reply { status?: number | null; stdout?: string; stderr?: string; error?: { code: string }; took?: number; hang?: boolean }
/** A `gh api` call is the workflows probe; it has its own script, so the scripts of the other two stay as they are. */
type Kind = 'view' | 'checks' | 'workflows'
type Script = (call: { kind: 'view' | 'checks'; nth: number; elapsed: number }) => Reply
type WorkflowsScript = (call: { nth: number; elapsed: number }) => Reply

/**
 * The default workflows reply: a repository with no workflow at all. It takes no virtual
 * time, so the window tests keep their pinned `waited`; the probe-timing tests name `took`.
 */
const NO_WORKFLOWS: Reply = { stdout: JSON.stringify({ total_count: 0, workflows: [] }), took: 0 }

interface Recorded { file: string; args: string[]; timeout: number; elapsedBefore: number; shell: unknown }

class World {
  t = 1_000_000
  readonly start = this.t
  readonly calls: Recorded[] = []
  readonly sleeps: number[] = []
  readonly violations: string[] = []
  private readonly counts: Record<Kind, number> = { view: 0, checks: 0, workflows: 0 }

  constructor(
    private readonly script: Script,
    private readonly moves = true,
    private readonly workflows: WorkflowsScript = () => NO_WORKFLOWS,
  ) {}

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
    let kind: Kind = 'checks'
    if (args[0] === 'api') kind = 'workflows'
    else if (args[1] === 'view') kind = 'view'
    const reply = kind === 'workflows'
      ? this.workflows({ nth: this.counts.workflows++, elapsed: this.elapsed })
      : this.script({ kind, nth: this.counts[kind]++, elapsed: this.elapsed })
    const took = reply.hang === true ? timeout : Math.min(reply.took ?? DEFAULT_CALL_MS, timeout)
    if (this.moves) this.t += took
    if (reply.hang === true) return { status: null, error: { code: 'ETIMEDOUT' } }
    if (reply.error !== undefined) return { status: null, error: reply.error }
    return { status: reply.status ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
  }

  readonly clock: Clock = {
    now: () => this.t,
    sleep: async ms => { this.sleeps.push(ms); if (this.moves) this.t += ms },
  }

  of(kind: Kind): Recorded[] { return this.calls.filter(c => (kind === 'workflows' ? c.args[0] === 'api' : c.args[1] === kind)) }
}

/** The view reply; `mergeable` null omits the key, as gh does when it has no answer to give. */
const viewOk = (head = HEAD, mergeable: string | null = 'MERGEABLE'): Reply => ({
  stdout: JSON.stringify(mergeable === null ? { headRefOid: head } : { headRefOid: head, mergeable }),
})
/** One check row: a GitHub Actions job names its workflow; an external status or app check has an empty one. */
type Spec = readonly [bucket: string, workflow: string]
const specRows = (...specs: Spec[]): string => JSON.stringify(specs.map(([bucket, workflow], i) => ({ name: `check-${i + 1}`, state: bucket.toUpperCase(), bucket, workflow })))
const specsOk = (...specs: Spec[]): Reply => ({ stdout: specRows(...specs), status: specs.some(([bucket]) => bucket === 'pending') ? 8 : 0 })
const actions = (...buckets: string[]): Spec[] => buckets.map(bucket => [bucket, 'CI'] as const)
const external = (...buckets: string[]): Spec[] => buckets.map(bucket => [bucket, ''] as const)
const rows = (...buckets: string[]): string => specRows(...actions(...buckets))
const checksOk = (...buckets: string[]): Reply => specsOk(...actions(...buckets))
const externalOk = (...buckets: string[]): Reply => specsOk(...external(...buckets))
const argvOf = (head = HEAD, pr = PR): string[] => ['node', 'ci-wait.cjs', '--pr', pr, '--head', head]

interface Ran { line: string; stdout: string; code: number; world: World }

/** Run main() over a world; asserts the contract every case shares. */
async function run(script: Script, opts: { moves?: boolean; argv?: string[]; workflows?: WorkflowsScript } = {}): Promise<Ran> {
  const world = new World(script, opts.moves ?? true, opts.workflows)
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
    expect(CW.REASONS).toEqual(['gh-failed', 'unparseable', 'unrecognised-bucket', 'head-mismatch', 'deadline', 'usage', 'no-workflow-check', 'merge-conflict'])
    expect(CW.BUCKETS).toEqual(['pass', 'fail', 'pending', 'skipping', 'cancel'])
  })

  it('ends the reasons with the two workflow and merge-state reasons, which only an INDETERMINATE line may carry', () => {
    expect(CW.REASONS.slice(-2)).toEqual(['no-workflow-check', 'merge-conflict'])
    const indeterminate = 'CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=2'
    for (const reason of ['no-workflow-check', 'merge-conflict']) {
      expect(CW.LINE_RE.test(`${indeterminate} reason=${reason}`), reason).toBe(true)
      expect(CW.checkLine(`${indeterminate} reason=${reason}`), reason).toBe(true)
      expect(CW.checkLine(`CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=2 reason=${reason}`), `${reason} on PASSING`).toBe(false)
      expect(CW.checkLine(`CI NO_CI pr=12 head=aaaaaaa failing=- pending=- waited=2 reason=${reason}`), `${reason} on NO_CI`).toBe(false)
    }
    for (const unlisted of ['no-workflow', 'merge-conflicts', 'no-workflow-check-x', 'Merge-Conflict']) {
      expect(CW.checkLine(`${indeterminate} reason=${unlisted}`), unlisted).toBe(false)
    }
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
// The settle windows: a head mismatch and an empty check list each keep their own clock
// ---------------------------------------------------------------------------

describe('the settle windows: a head mismatch and an empty check list each keep their own 90 s clock', () => {
  const SETTLE_MS = 90_000
  const BAD_GH: Reply = { status: 1, stderr: 'HTTP 502: Bad Gateway\n' }

  it('empty, pending, empty: the pending poll resets the empty clock, so two short empty stretches are not NO_CI', async () => {
    // Each gh checks call takes 25 s, so the two empty results are 92 s apart: one clock would settle.
    const r = await run(({ kind, nth }) => {
      if (kind === 'view') return viewOk()
      if (nth === 0 || nth === 2) return { stdout: '[]', took: 25_000 }
      if (nth === 1) return { ...checksOk('pending'), took: 25_000 }
      return checksOk('pass')
    })
    const checks = r.world.of('checks')
    expect(statusOf(r.line)).toBe('PASSING')
    expect(checks).toHaveLength(4)
    expect(checks[2].elapsedBefore - checks[0].elapsedBefore, 'the empty results are further apart than the window').toBeGreaterThan(SETTLE_MS)
  })

  it('a mismatch for 80 s, then a match with no checks: NO_CI comes 90 s after the first empty result, not sooner', async () => {
    // The view takes no time, so the five mismatch polls fall at 0, 20, 40, 60 and 80 s.
    const r = await run(({ kind, nth }) => (kind === 'view'
      ? { ...viewOk(nth < 5 ? OLD_HEAD : HEAD), took: 0 }
      : { stdout: '[]' }))
    const views = r.world.of('view')
    const checks = r.world.of('checks')
    expect(views[4].elapsedBefore - views[0].elapsedBefore).toBe(80_000)
    expect(statusOf(r.line)).toBe('NO_CI')
    // The empty reply names no `took`, so the first empty result lands one default call after its call began.
    const firstEmptyAt = checks[0].elapsedBefore + DEFAULT_CALL_MS
    expect(r.world.elapsed - firstEmptyAt).toBeGreaterThanOrEqual(SETTLE_MS)
    expect(checks, 'the fifth empty result is still inside the window').toHaveLength(6)
  })

  it('a failed poll between two mismatches leaves the mismatch clock where it was', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? (nth === 2 ? BAD_GH : viewOk(OLD_HEAD)) : checksOk('pass')))
    expect(field(r.line, 'reason')).toBe('head-mismatch')
    // Reads at 0, 21, (failed), 63, 84 and 105 s after the first mismatch: the sixth is the first past 90 s.
    expect(r.world.of('view')).toHaveLength(6)
    expect(r.world.of('checks')).toHaveLength(0)
  })

  it('a failed poll between two empty results leaves the empty clock where it was', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth === 2 ? BAD_GH : { stdout: '[]' }))
    expect(statusOf(r.line)).toBe('NO_CI')
    // Reads at 0, 22, (failed), 66, 88 and 110 s after the first empty result: the sixth is the first past 90 s.
    expect(r.world.of('checks')).toHaveLength(6)
  })

  describe('the boundary: a window settles at exactly 90,000 ms and not at 89,999 ms', () => {
    // Mismatch path: a view takes 10 s, so polls fall 30 s apart and the fourth read is 90 s after the first.
    const mismatch = (lastTook: number): Script => ({ kind, nth }) => (kind === 'view'
      ? { ...viewOk(OLD_HEAD), took: nth === 3 ? lastTook : 10_000 }
      : checksOk('pass'))
    // Empty path: a view and a checks call take 5 s each, so polls fall 30 s apart as well.
    // The head reads MERGEABLE: NO_CI needs it, and the boundary is the window alone.
    const empty = (lastTook: number): Script => ({ kind, nth }) => (kind === 'view'
      ? { ...viewOk(HEAD, 'MERGEABLE'), took: 5_000 }
      : { stdout: '[]', took: nth === 3 ? lastTook : 5_000 })

    it('mismatch path: 90,000 ms settles at the fourth read', async () => {
      const r = await run(mismatch(10_000))
      expect(field(r.line, 'reason')).toBe('head-mismatch')
      expect(r.world.of('view')).toHaveLength(4)
      expect(r.world.sleeps).toEqual([20_000, 20_000, 20_000])
      expect(waitedOf(r.line)).toBe(100)
    })

    it('mismatch path: 89,999 ms does not settle, and the fifth read does', async () => {
      const r = await run(mismatch(9_999))
      expect(field(r.line, 'reason')).toBe('head-mismatch')
      expect(r.world.of('view')).toHaveLength(5)
      expect(r.world.sleeps).toEqual([20_000, 20_000, 20_000, 20_000])
      expect(waitedOf(r.line)).toBe(130)
    })

    it('empty path: 90,000 ms settles at the fourth read', async () => {
      const r = await run(empty(5_000))
      expect(statusOf(r.line)).toBe('NO_CI')
      expect(r.world.of('checks')).toHaveLength(4)
      expect(r.world.sleeps).toEqual([20_000, 20_000, 20_000])
      expect(waitedOf(r.line)).toBe(100)
    })

    it('empty path: 89,999 ms does not settle, and the fifth read does', async () => {
      const r = await run(empty(4_999))
      expect(statusOf(r.line)).toBe('NO_CI')
      expect(r.world.of('checks')).toHaveLength(5)
      expect(r.world.sleeps).toEqual([20_000, 20_000, 20_000, 20_000])
      expect(waitedOf(r.line)).toBe(130)
    })
  })
})

// ---------------------------------------------------------------------------
// The workflow rule through the wait: PASSING needs a GitHub Actions job that passed
// ---------------------------------------------------------------------------

describe('the workflow rule: a pass from an external check alone is no CI verdict', () => {
  it('external-only passing checks: PENDING through the 90 s window, then no-workflow-check, never PASSING', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : externalOk('pass', 'pass')))
    expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=no-workflow-check$/)
    // Each poll is 22 s: the window opens after the first checks call (2 s), and the sixth read (112 s) is the first past 90 s.
    expect(r.world.of('checks')).toHaveLength(6)
    expect(waitedOf(r.line)).toBeGreaterThanOrEqual(90)
    expect(waitedOf(r.line)).toBeLessThan(150)
  })

  it('a skipped workflow job beside a passing external check ends no-workflow-check', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : specsOk(['skipping', 'CI'], ['pass', ''])))
    expect(statusOf(r.line)).toBe('INDETERMINATE')
    expect(field(r.line, 'reason')).toBe('no-workflow-check')
  })

  it('a workflow pass beside an external pass on a mergeable head is PASSING, with the exact line pinned', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : specsOk(['pass', 'CI'], ['pass', ''])))
    expect(r.line).toBe('CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=2')
    expect(r.world.sleeps).toEqual([])
  })

  it('external-only, then a pending workflow row, then external-only again: the window restarts at the second stretch', async () => {
    // Each checks call takes 25 s. One clock for the whole run would settle at the third read (118 s after
    // the first external-only result at 26 s); a restart needs 90 s after the third read's result.
    const r = await run(({ kind, nth }) => {
      if (kind === 'view') return viewOk()
      return { ...(nth === 1 ? specsOk(['pass', ''], ['pending', 'CI']) : externalOk('pass')), took: 25_000 }
    })
    const checks = r.world.of('checks')
    expect(field(r.line, 'reason')).toBe('no-workflow-check')
    const secondStretchStart = checks[2].elapsedBefore + 25_000
    expect(r.world.elapsed - secondStretchStart, 'no verdict before 90 s of the second stretch').toBeGreaterThanOrEqual(90_000)
    expect(checks[checks.length - 2].elapsedBefore + 25_000 - secondStretchStart, 'the read before the last is still inside the window').toBeLessThan(90_000)
    expect(checks).toHaveLength(5)
  })

  it('an empty list that turns external-only keeps the window from the first empty poll', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth < 2 ? { stdout: '[]' } : externalOk('pass')))
    expect(field(r.line, 'reason')).toBe('no-workflow-check')
    expect(r.world.of('checks'), 'the sixth read is the first past 90 s from the first empty poll').toHaveLength(6)
  })

  it('a pending workflow row beside a passing external check is PENDING to the deadline', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : specsOk(['pass', ''], ['pending', 'CI'])))
    expect(r.line).toMatch(/^CI PENDING pr=12 head=aaaaaaa failing=- pending=check-2 waited=\d+$/)
  })

  it('a failing external check beside a workflow pass is FAILING at once', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : specsOk(['fail', ''], ['pass', 'CI'])))
    expect(r.line).toBe('CI FAILING pr=12 head=aaaaaaa failing=check-1 pending=- waited=2')
    expect(r.world.sleeps).toEqual([])
  })

  it('a workflow field that is absent or not a string does not break the reply, and counts as external', async () => {
    const odd = JSON.stringify([{ name: 'a', state: 'SUCCESS', bucket: 'pass' }, { name: 'b', state: 'SUCCESS', bucket: 'pass', workflow: 7 }, { name: 'c', state: 'SUCCESS', bucket: 'pass', workflow: null }])
    const r = await run(({ kind }) => (kind === 'view' ? viewOk() : { stdout: odd }))
    expect(field(r.line, 'reason')).toBe('no-workflow-check')
  })
})

// ---------------------------------------------------------------------------
// The merge state: a conflicting head ends at once; an unknown one never passes
// ---------------------------------------------------------------------------

describe('the merge state: CONFLICTING ends at once, and anything but MERGEABLE never reads NO_CI or PASSING', () => {
  it('CONFLICTING with no checks: merge-conflict at once, with no checks call and no sleep', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'CONFLICTING') : { stdout: '[]' }))
    expect(r.line).toBe('CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=1 reason=merge-conflict')
    expect(r.world.calls).toHaveLength(1)
    expect(r.world.of('checks')).toHaveLength(0)
    expect(r.world.sleeps).toEqual([])
  })

  it('CONFLICTING with a passing workflow check, or with external-only checks, is still merge-conflict', async () => {
    for (const reply of [checksOk('pass'), externalOk('pass'), specsOk(['pass', 'CI'], ['pass', ''])]) {
      const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'CONFLICTING') : reply))
      expect(field(r.line, 'reason')).toBe('merge-conflict')
      expect(r.world.of('checks'), 'the rows are not read').toHaveLength(0)
    }
  })

  it('CONFLICTING with an empty check list is merge-conflict, never NO_CI', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'CONFLICTING') : { status: 1, stderr: NO_CHECKS_STDERR }))
    expect(statusOf(r.line)).toBe('INDETERMINATE')
    expect(field(r.line, 'reason')).toBe('merge-conflict')
  })

  it('a head mismatch while CONFLICTING stays head-mismatch after the window: the merge state is not used', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(OLD_HEAD, 'CONFLICTING') : checksOk('pass')))
    expect(field(r.line, 'reason')).toBe('head-mismatch')
    expect(waitedOf(r.line)).toBeGreaterThanOrEqual(90)
    expect(r.world.of('checks')).toHaveLength(0)
  })

  it('a conflict that appears on a later poll ends the wait at that poll', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk(HEAD, nth < 2 ? 'MERGEABLE' : 'CONFLICTING') : checksOk('pending')))
    expect(field(r.line, 'reason')).toBe('merge-conflict')
    expect(r.world.of('checks')).toHaveLength(2)
  })

  it('MERGEABLE on every poll with an empty list still settles into NO_CI', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'MERGEABLE') : { stdout: '[]' }))
    expect(statusOf(r.line)).toBe('NO_CI')
  })

  it('UNKNOWN on every poll with an empty list never prints NO_CI: INDETERMINATE (deadline) inside 570 s', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'UNKNOWN') : { stdout: '[]' }))
    expect(statusOf(r.line)).toBe('INDETERMINATE')
    expect(field(r.line, 'reason')).toBe('deadline')
    expect(waitedOf(r.line)).toBeGreaterThan(500)
    expect(waitedOf(r.line)).toBeLessThanOrEqual(570)
  })

  it('an absent, null, empty, non-string or unlisted mergeable value behaves as UNKNOWN and is never unparseable', async () => {
    const replies: ReadonlyArray<string> = [
      JSON.stringify({ headRefOid: HEAD }),
      JSON.stringify({ headRefOid: HEAD, mergeable: null }),
      JSON.stringify({ headRefOid: HEAD, mergeable: '' }),
      JSON.stringify({ headRefOid: HEAD, mergeable: 7 }),
      JSON.stringify({ headRefOid: HEAD, mergeable: ['MERGEABLE'] }),
      JSON.stringify({ headRefOid: HEAD, mergeable: 'mergeable' }),
      JSON.stringify({ headRefOid: HEAD, mergeable: 'SOMETHING_NEW' }),
    ]
    for (const stdout of replies) {
      const r = await run(({ kind }) => (kind === 'view' ? { stdout } : { stdout: '[]' }))
      expect(statusOf(r.line), stdout).toBe('INDETERMINATE')
      expect(field(r.line, 'reason'), stdout).toBe('deadline')
    }
  })

  it('UNKNOWN on the early polls, then MERGEABLE with an empty list: NO_CI as soon as the window has passed', async () => {
    // Polls are 22 s apart: the window (opened at 2 s) is done at the sixth read (112 s), so the first MERGEABLE read after it settles.
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk(HEAD, nth < 6 ? 'UNKNOWN' : 'MERGEABLE') : { stdout: '[]' }))
    expect(statusOf(r.line)).toBe('NO_CI')
    expect(r.world.of('checks')).toHaveLength(7)
  })

  it('MERGEABLE inside the window does not shorten it: NO_CI waits for the 90 s from the first empty result', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk(HEAD, nth === 0 ? 'UNKNOWN' : 'MERGEABLE') : { stdout: '[]' }))
    expect(statusOf(r.line)).toBe('NO_CI')
    expect(r.world.of('checks')).toHaveLength(6)
  })

  it('UNKNOWN beside a passing workflow check is not PASSING on that poll; MERGEABLE on a later poll is', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk(HEAD, nth < 2 ? 'UNKNOWN' : 'MERGEABLE') : checksOk('pass')))
    expect(r.line).toMatch(/^CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=\d+$/)
    expect(r.world.of('checks')).toHaveLength(3)
    expect(r.world.sleeps).toEqual([20_000, 20_000])
  })

  it('UNKNOWN or an absent value beside a passing workflow check to the deadline: INDETERMINATE (deadline), never PENDING or PASSING', async () => {
    for (const mergeable of ['UNKNOWN', null]) {
      const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, mergeable) : checksOk('pass')))
      expect(statusOf(r.line), String(mergeable)).toBe('INDETERMINATE')
      expect(field(r.line, 'reason'), String(mergeable)).toBe('deadline')
    }
  })

  it('an open poll resets the failed-poll count: failures separated by an open poll never reach three in a row', async () => {
    const r = await run(({ kind, nth }) => {
      if (kind === 'checks') return checksOk('pass')
      if (nth === 0 || nth === 1 || nth === 3 || nth === 4) return { status: 1, stderr: 'HTTP 502\n' }
      return viewOk(HEAD, 'UNKNOWN')
    })
    expect(field(r.line, 'reason')).toBe('deadline')
  })

  it('PENDING and FAILING do not wait on the merge state', async () => {
    const failing = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'UNKNOWN') : checksOk('pass', 'fail')))
    expect(statusOf(failing.line)).toBe('FAILING')
    expect(failing.world.sleeps).toEqual([])
    const pending = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, null) : checksOk('pass', 'pending')))
    expect(statusOf(pending.line)).toBe('PENDING')
  })

  it('external-only checks on an UNKNOWN head still end no-workflow-check after the window', async () => {
    const r = await run(({ kind }) => (kind === 'view' ? viewOk(HEAD, 'UNKNOWN') : externalOk('pass')))
    expect(field(r.line, 'reason')).toBe('no-workflow-check')
  })
})

// ---------------------------------------------------------------------------
// D-CI-WORKFLOWS: an empty list is no CI only when the repository has no active workflow file
// ---------------------------------------------------------------------------

/** The probe's argv: gh fills `{owner}/{repo}` from the repository of the working directory. */
const WORKFLOWS_ARGV = ['api', 'repos/{owner}/{repo}/actions/workflows?per_page=100']
const CI_YML = { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }
const DYNAMIC_ROW = { id: 7, name: 'Copilot code review', path: 'dynamic/copilot-pull-request-reviewer/copilot-pull-request-reviewer', state: 'active' }
const inactiveRows = (count: number): object[] => Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `w${i}`, path: `.github/workflows/w${i}.yml`, state: 'disabled_manually' }))
/** The list gh returns for the probe; `total` defaults to the number of rows given. */
const workflowJson = (workflowRows: ReadonlyArray<unknown>, total: number = workflowRows.length): string => JSON.stringify({ total_count: total, workflows: workflowRows })
const workflowList = (workflowRows: ReadonlyArray<unknown>, total?: number): Reply => ({ stdout: workflowJson(workflowRows, total), took: 0 })
const BAD_PROBE: Reply = { status: 1, stderr: 'HTTP 502: Bad Gateway\n' }
const emptyList: Script = ({ kind }) => (kind === 'view' ? viewOk() : { stdout: '[]' })

/** Replies that are not the whole workflow list: bad JSON, a bad row, or a page that is not all of it. */
const UNREADABLE: ReadonlyArray<readonly [string, string]> = [
  ['empty stdout', ''],
  ['text that is not JSON', 'not json'],
  ['an array', '[]'],
  ['an object without the list', '{}'],
  ['a total that is not a number', JSON.stringify({ total_count: '0', workflows: [] })],
  ['a negative total', workflowJson([], -1)],
  ['no total', JSON.stringify({ workflows: [] })],
  ['a list that is not an array', JSON.stringify({ total_count: 0, workflows: {} })],
  ['a row that is null', workflowJson([null], 1)],
  ['a row without a path', workflowJson([{ state: 'disabled_manually' }])],
  ['a row whose path is not a string', workflowJson([{ path: 7, state: 'disabled_manually' }])],
  ['a row without a state', workflowJson([{ path: 'dynamic/x' }])],
  ['a row whose state is not a string', workflowJson([{ path: 'dynamic/x', state: true }])],
  ['a malformed row beside an active one', workflowJson([CI_YML, { state: 'active' }])],
  ['a first page of 100 inactive rows out of 150', workflowJson(inactiveRows(100), 150)],
  ['no rows out of a total of 1', workflowJson([], 1)],
  ['more rows than the total', workflowJson(inactiveRows(2), 1)],
  ['a list of 101 rows, one more than a page', workflowJson(inactiveRows(101))],
  ['a list of 150 rows whose total says 150', workflowJson(inactiveRows(150))],
  ['a string total beside an active row', JSON.stringify({ total_count: '1', workflows: [CI_YML] })],
  ['a fractional total beside an active row', workflowJson([CI_YML], 1.5)],
  ['a negative total beside an active row', workflowJson([CI_YML], -1)],
]

describe('parseActiveWorkflows: the workflow list as a pure function', () => {
  it('is true when a row is active and its path is a file under .github/workflows/', () => {
    expect(CW.parseActiveWorkflows(workflowJson([CI_YML]))).toBe(true)
    expect(CW.parseActiveWorkflows(workflowJson([DYNAMIC_ROW, ...inactiveRows(2), CI_YML]))).toBe(true)
  })

  it('is true for an incomplete page that already shows an active workflow file', () => {
    expect(CW.parseActiveWorkflows(workflowJson([CI_YML, ...inactiveRows(99)], 150))).toBe(true)
  })

  it('is false for a complete list with no active workflow file: empty, dynamic paths, disabled, deleted, or a path that only looks like one', () => {
    const looksLike = ['.github/workflows', 'github/workflows/ci.yml', '.github/workflow/ci.yml', 'docs/.github/workflows/ci.yml', ' .github/workflows/ci.yml']
      .map((path, i) => ({ id: 20 + i, name: 'x', path, state: 'active' }))
    const deleted = { ...CI_YML, id: 3, state: 'deleted' }
    const inactiveStates = ['disabled_manually', 'disabled_inactivity', 'disabled_fork', 'Active', 'active ', ''].map((state, i) => ({ ...CI_YML, id: 30 + i, state }))
    for (const complete of [[], [DYNAMIC_ROW], inactiveRows(3), [deleted], looksLike, inactiveStates]) {
      expect(CW.parseActiveWorkflows(workflowJson(complete)), JSON.stringify(complete)).toBe(false)
    }
  })

  it('is false for a complete page of 100 rows, none of them active', () => {
    expect(CW.parseActiveWorkflows(workflowJson(inactiveRows(100)))).toBe(false)
  })

  for (const [label, stdout] of UNREADABLE) {
    it(`is null for ${label}`, () => {
      expect(CW.parseActiveWorkflows(stdout)).toBeNull()
    })
  }

  it('is null for a value that is not text', () => {
    for (const odd of [undefined, null, 7, {}] as unknown as string[]) expect(CW.parseActiveWorkflows(odd)).toBeNull()
  })
})

describe('D-CI-WORKFLOWS: an empty check list is NO_CI only when the repository has no active workflow file', () => {
  it('an active workflow file: PENDING through the window, then no-workflow-check, never NO_CI', async () => {
    const r = await run(emptyList, { workflows: () => workflowList([CI_YML]) })
    expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=no-workflow-check$/)
    const checks = r.world.of('checks')
    const firstEmptyAt = checks[0].elapsedBefore + DEFAULT_CALL_MS
    expect(checks, 'the sixth read is the first past 90 s, as it is for NO_CI').toHaveLength(6)
    expect(r.world.sleeps).toEqual([20_000, 20_000, 20_000, 20_000, 20_000])
    expect(checks[4].elapsedBefore + DEFAULT_CALL_MS - firstEmptyAt, 'the fifth read is still inside the window').toBeLessThan(90_000)
    const probes = r.world.of('workflows')
    expect(probes, 'one probe, made once the window is done').toHaveLength(1)
    expect(probes[0].elapsedBefore - firstEmptyAt).toBeGreaterThanOrEqual(90_000)
    expect(waitedOf(r.line)).toBeGreaterThanOrEqual(90)
    expect(waitedOf(r.line)).toBeLessThan(150)
  })

  describe('no active workflow file: NO_CI at 90,000 ms after the first empty result and not at 89,999 ms', () => {
    // A view and a checks call take 5 s each, so polls fall 30 s apart and the fourth read is 90 s after the first result.
    const slowEmpty = (lastTook: number): Script => ({ kind, nth }) => (kind === 'view'
      ? { ...viewOk(), took: 5_000 }
      : { stdout: '[]', took: nth === 3 ? lastTook : 5_000 })
    const NONE: ReadonlyArray<readonly [string, Reply]> = [
      ['an empty list of workflows', workflowList([])],
      ['only dynamic paths', workflowList([DYNAMIC_ROW, { ...DYNAMIC_ROW, id: 8, path: 'dynamic/dependabot/dependabot-updates' }])],
      ['only disabled or deleted rows', workflowList([{ ...CI_YML, state: 'disabled_manually' }, { ...CI_YML, id: 2, state: 'disabled_inactivity' }, { ...CI_YML, id: 3, state: 'deleted' }])],
      ['only paths outside .github/workflows/', workflowList([{ ...CI_YML, path: 'docs/.github/workflows/ci.yml' }, { ...CI_YML, id: 2, path: '.github/workflow/ci.yml' }])],
    ]
    for (const [label, reply] of NONE) {
      it(`${label}: 90,000 ms settles at the fourth read, with one probe`, async () => {
        const r = await run(slowEmpty(5_000), { workflows: () => reply })
        expect(statusOf(r.line)).toBe('NO_CI')
        expect(r.world.of('checks')).toHaveLength(4)
        expect(r.world.of('workflows')).toHaveLength(1)
        expect(waitedOf(r.line)).toBe(100)
      })

      it(`${label}: 89,999 ms does not settle, so the probe waits for the fifth read`, async () => {
        const r = await run(slowEmpty(4_999), { workflows: () => reply })
        expect(statusOf(r.line)).toBe('NO_CI')
        expect(r.world.of('checks')).toHaveLength(5)
        expect(r.world.of('workflows')).toHaveLength(1)
        expect(waitedOf(r.line)).toBe(130)
      })
    }
  })

  it('an empty list that turns into rows inside the window makes no probe: the late workflow check decides', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk() : nth < 2 ? { stdout: '[]' } : checksOk('pass')), { workflows: () => workflowList([CI_YML]) })
    expect(statusOf(r.line)).toBe('PASSING')
    expect(r.world.of('workflows')).toHaveLength(0)
  })

  it('UNKNOWN, then MERGEABLE after the window: the probe waits for MERGEABLE and is made once', async () => {
    const r = await run(({ kind, nth }) => (kind === 'view' ? viewOk(HEAD, nth < 6 ? 'UNKNOWN' : 'MERGEABLE') : { stdout: '[]' }), { workflows: () => workflowList([CI_YML]) })
    expect(field(r.line, 'reason')).toBe('no-workflow-check')
    expect(r.world.of('checks')).toHaveLength(7)
    expect(r.world.of('workflows')).toHaveLength(1)
  })

  it('PASSING, FAILING, PENDING, CONFLICTING, a head mismatch, UNKNOWN to the deadline and rows with no Actions pass make no probe', async () => {
    const cases: ReadonlyArray<readonly [string, Script]> = [
      ['PASSING', ({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass'))],
      ['FAILING', ({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass', 'fail'))],
      ['PENDING', ({ kind }) => (kind === 'view' ? viewOk() : checksOk('pass', 'pending'))],
      ['CONFLICTING with no checks', ({ kind }) => (kind === 'view' ? viewOk(HEAD, 'CONFLICTING') : { stdout: '[]' })],
      ['a head mismatch with no checks', ({ kind }) => (kind === 'view' ? viewOk(OLD_HEAD) : { stdout: '[]' })],
      ['UNKNOWN to the deadline with no checks', ({ kind }) => (kind === 'view' ? viewOk(HEAD, 'UNKNOWN') : { stdout: '[]' })],
      ['external-only rows', ({ kind }) => (kind === 'view' ? viewOk() : externalOk('pass'))],
      ['a workflow pass beside an external pass', ({ kind }) => (kind === 'view' ? viewOk() : specsOk(['pass', 'CI'], ['pass', '']))],
    ]
    for (const [label, script] of cases) {
      const r = await run(script, { workflows: () => workflowList([CI_YML]) })
      expect(r.world.of('workflows'), label).toHaveLength(0)
    }
  })

  it('the probe argv is exact and read-only: no flag, no PR number, no head, a timeout of at most 30 s, no shell', async () => {
    const r = await run(emptyList)
    expect(CW.WORKFLOWS_ARGS).toEqual(WORKFLOWS_ARGV)
    expect(Object.isFrozen(CW.WORKFLOWS_ARGS)).toBe(true)
    const [probe] = r.world.of('workflows')
    expect(probe.file).toBe('gh')
    expect(probe.args).toEqual(WORKFLOWS_ARGV)
    expect(probe.args.filter(arg => arg.startsWith('-')), 'no -f, -F, -X, --method or --input').toEqual([])
    expect(probe.args.join(' ')).not.toContain(HEAD)
    expect(probe.args).not.toContain(PR)
    expect(probe.timeout).toBeLessThanOrEqual(30_000)
    expect(probe.shell).toBe(false)
  })

  describe('a failed probe is a failed poll', () => {
    it('three in a row are INDETERMINATE (gh-failed), never NO_CI', async () => {
      const r = await run(emptyList, { workflows: () => BAD_PROBE })
      expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=gh-failed$/)
      expect(r.world.of('workflows')).toHaveLength(3)
    })

    it('a probe that hangs, errors or exits non-zero counts the same', async () => {
      const failures: Reply[] = [{ hang: true }, { error: { code: 'ENOENT' } }, { status: 4, stderr: 'gh: not found\n' }, { status: 1, stderr: 'HTTP 403: Resource not accessible\n' }]
      for (const failure of failures) {
        const r = await run(emptyList, { workflows: () => failure })
        expect(field(r.line, 'reason'), JSON.stringify(failure)).toBe('gh-failed')
        expect(r.world.of('workflows'), JSON.stringify(failure)).toHaveLength(3)
      }
    })

    it('one failed probe, then an answer: the next poll reads the view and the checks again, and the answer decides', async () => {
      const callKeys = (world: World): string[] => world.calls.map(c => (c.args[0] === 'api' ? 'api' : c.args[1]))
      const noActive = await run(emptyList, { workflows: ({ nth }) => (nth === 0 ? BAD_PROBE : workflowList([])) })
      expect(statusOf(noActive.line)).toBe('NO_CI')
      expect(callKeys(noActive.world).slice(-6)).toEqual(['view', 'checks', 'api', 'view', 'checks', 'api'])
      expect(noActive.world.of('workflows')).toHaveLength(2)
      const active = await run(emptyList, { workflows: ({ nth }) => (nth === 0 ? BAD_PROBE : workflowList([CI_YML])) })
      expect(field(active.line, 'reason')).toBe('no-workflow-check')
      expect(active.world.of('workflows')).toHaveLength(2)
    })

    it('two failed probes, then an answer: the failures were not three in a row', async () => {
      const r = await run(emptyList, { workflows: ({ nth }) => (nth < 2 ? BAD_PROBE : workflowList([])) })
      expect(statusOf(r.line)).toBe('NO_CI')
      expect(r.world.of('workflows')).toHaveLength(3)
    })
  })

  describe('a reply that cannot be read, or is only a page of the list, never gives NO_CI', () => {
    for (const [label, stdout] of UNREADABLE) {
      it(`${label}: INDETERMINATE (unparseable) after one probe`, async () => {
        const r = await run(emptyList, { workflows: () => ({ stdout, took: 0 }) })
        expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=unparseable$/)
        expect(r.world.of('workflows')).toHaveLength(1)
      })
    }
  })

  describe('the probe is bounded by the deadline like every other gh call', () => {
    // The view reads UNKNOWN until 560 s on a clock that the view does not move; the polls fall 20 s apart.
    const lateMergeable = (checksTook: number): Script => ({ kind, elapsed }) => (kind === 'view'
      ? { ...viewOk(HEAD, elapsed < 560_000 ? 'UNKNOWN' : 'MERGEABLE'), took: 0 }
      : { stdout: '[]', took: elapsed < 560_000 ? 0 : checksTook })

    it('no time left: no call is made, and the run ends INDETERMINATE (deadline), never NO_CI', async () => {
      const r = await run(lateMergeable(10_000), { workflows: () => workflowList([]) })
      expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=570 reason=deadline$/)
      expect(r.world.of('workflows')).toHaveLength(0)
    })

    it('10 s left: the probe is given those 10 s, and a probe that hangs ends INDETERMINATE (deadline)', async () => {
      const r = await run(lateMergeable(0), { workflows: () => ({ hang: true }) })
      expect(r.line).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=570 reason=deadline$/)
      const probes = r.world.of('workflows')
      expect(probes).toHaveLength(1)
      expect(probes[0].timeout).toBe(10_000)
    })
  })
})

describe('mergeGate: one pure rule maps a classifier status, a mergeable value and the workflow probe to keep, open or conflict', () => {
  const MERGEABLES: ReadonlyArray<string | null> = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN', null]
  // Columns follow MERGEABLES. For NO_CI the rows read as if the repository had no active workflow (workflowsActive false).
  const TABLE: ReadonlyArray<readonly [string, readonly MergeGateResult[]]> = [
    ['PASSING', ['keep', 'conflict', 'open', 'open']],
    ['NO_CI', ['keep', 'conflict', 'open', 'open']],
    ['FAILING', ['keep', 'conflict', 'keep', 'keep']],
    ['PENDING', ['keep', 'conflict', 'keep', 'keep']],
    ['INDETERMINATE', ['keep', 'conflict', 'keep', 'keep']],
  ]
  // What the probe answered, or did not: true and false are answers, null and an omitted argument are not one.
  const PROBES: ReadonlyArray<readonly [string, boolean | null | undefined]> = [['false', false], ['true', true], ['null', null], ['omitted', undefined]]

  for (const [status, expected] of TABLE) {
    MERGEABLES.forEach((mergeable, i) => {
      it(`${status} on ${String(mergeable)} with no active workflow is ${expected[i]}`, () => {
        expect(CW.mergeGate(status, mergeable, false)).toBe(expected[i])
      })
    })
  }

  it('the probe answer changes nothing but NO_CI: every other status reads the same under true, false, null and omitted', () => {
    for (const [status, expected] of TABLE.filter(([status]) => status !== 'NO_CI')) {
      MERGEABLES.forEach((mergeable, i) => {
        for (const [label, probe] of PROBES) expect(CW.mergeGate(status, mergeable, probe), `${status} on ${String(mergeable)}, probe ${label}`).toBe(expected[i])
      })
    }
  })

  it('NO_CI stands only on MERGEABLE with no active workflow: true, null and an omitted value are open', () => {
    expect(CW.mergeGate('NO_CI', 'MERGEABLE', false)).toBe('keep')
    for (const probe of [true, null, undefined]) expect(CW.mergeGate('NO_CI', 'MERGEABLE', probe), String(probe)).toBe('open')
    expect(CW.mergeGate('NO_CI', 'MERGEABLE'), 'the argument omitted altogether').toBe('open')
  })

  it('a conflict is a conflict whatever the probe said, and an unsettled merge state stays open under every probe answer', () => {
    for (const [label, probe] of PROBES) {
      expect(CW.mergeGate('NO_CI', 'CONFLICTING', probe), label).toBe('conflict')
      expect(CW.mergeGate('NO_CI', 'UNKNOWN', probe), label).toBe('open')
      expect(CW.mergeGate('NO_CI', null, probe), label).toBe('open')
    }
  })

  it('a probe answer that is not a boolean never lets NO_CI through', () => {
    for (const odd of ['false', 0, '', {}, []] as unknown as Array<boolean | null>) expect(CW.mergeGate('NO_CI', 'MERGEABLE', odd), String(odd)).toBe('open')
  })

  it('a status not read yet (null) is a conflict on CONFLICTING and kept otherwise', () => {
    expect(CW.mergeGate(null, 'CONFLICTING')).toBe('conflict')
    for (const mergeable of ['MERGEABLE', 'UNKNOWN', null]) expect(CW.mergeGate(null, mergeable)).toBe('keep')
  })

  it('a value that is not one of the three is not a conflict and lets neither PASSING nor NO_CI through', () => {
    for (const odd of [undefined, '', 'mergeable', 'SOMETHING_NEW', 7, {}, ['MERGEABLE']]) {
      expect(CW.mergeGate('PASSING', odd)).toBe('open')
      expect(CW.mergeGate('NO_CI', odd, false)).toBe('open')
      expect(CW.mergeGate('FAILING', odd)).toBe('keep')
    }
  })
})

describe('matchedStep: the outcome of a poll on the named head, as a pure function', () => {
  const verdict = (specs: Spec[]): Classification => CW.classifyChecks(specs.map(([bucket, workflow], i) => ({ name: `check-${i + 1}`, bucket, workflow })))
  const done = (status: string, reason: string | null, failing: string[] = [], pending: string[] = []): MatchedStep => ({ state: 'done', status, reason, failing, pending })

  it('an empty list: pending inside the window, whatever the probe said; open after it on anything but MERGEABLE; a conflict ends it', () => {
    for (const probe of [undefined, null, true, false]) {
      expect(CW.matchedStep(null, 'MERGEABLE', false, probe)).toEqual({ state: 'pending', pending: [] })
      expect(CW.matchedStep(null, 'UNKNOWN', false, probe)).toEqual({ state: 'pending', pending: [] })
      expect(CW.matchedStep(null, 'UNKNOWN', true, probe)).toEqual({ state: 'open' })
      expect(CW.matchedStep(null, null, true, probe)).toEqual({ state: 'open' })
      expect(CW.matchedStep(null, 'CONFLICTING', true, probe)).toEqual(done('INDETERMINATE', 'merge-conflict'))
      expect(CW.matchedStep(null, 'CONFLICTING', false, probe)).toEqual(done('INDETERMINATE', 'merge-conflict'))
    }
  })

  it('an empty list after the window on MERGEABLE: NO_CI only for a probe that found no active workflow, no-workflow-check for one that did, a probe request otherwise', () => {
    expect(CW.matchedStep(null, 'MERGEABLE', true, false)).toEqual(done('NO_CI', null))
    expect(CW.matchedStep(null, 'MERGEABLE', true, true)).toEqual(done('INDETERMINATE', 'no-workflow-check'))
    expect(CW.matchedStep(null, 'MERGEABLE', true, null)).toEqual({ state: 'probe' })
    expect(CW.matchedStep(null, 'MERGEABLE', true, undefined)).toEqual({ state: 'probe' })
    expect(CW.matchedStep(null, 'MERGEABLE', true), 'the argument omitted altogether').toEqual({ state: 'probe' })
  })

  it('external-only rows: pending inside the window, no-workflow-check after it, whatever the merge state but CONFLICTING', () => {
    const v = verdict(external('pass'))
    expect(CW.matchedStep(v, 'MERGEABLE', false)).toEqual({ state: 'pending', pending: [] })
    for (const mergeable of ['MERGEABLE', 'UNKNOWN', null]) expect(CW.matchedStep(v, mergeable, true)).toEqual(done('INDETERMINATE', 'no-workflow-check'))
    expect(CW.matchedStep(v, 'CONFLICTING', true)).toEqual(done('INDETERMINATE', 'merge-conflict'))
  })

  it('rows never ask for the probe and ignore its answer: only an empty list depends on the repository\'s workflow files', () => {
    const rowsets = [verdict(external('pass')), verdict(actions('pass')), verdict([['pass', 'CI'], ['pending', 'CI']]), verdict([['pass', 'CI'], ['fail', 'CI']]), verdict([['pass', 'CI'], ['neutral', 'CI']])]
    for (const v of rowsets) {
      for (const windowDone of [false, true]) {
        const base = CW.matchedStep(v, 'MERGEABLE', windowDone)
        expect(base.state).not.toBe('probe')
        for (const probe of [null, true, false]) expect(CW.matchedStep(v, 'MERGEABLE', windowDone, probe)).toEqual(base)
      }
    }
  })

  it('a workflow pass: PASSING on MERGEABLE at any window state; open on UNKNOWN or absent; merge-conflict on CONFLICTING', () => {
    const v = verdict(actions('pass'))
    for (const windowDone of [false, true]) {
      expect(CW.matchedStep(v, 'MERGEABLE', windowDone)).toEqual(done('PASSING', null))
      expect(CW.matchedStep(v, 'UNKNOWN', windowDone)).toEqual({ state: 'open' })
      expect(CW.matchedStep(v, null, windowDone)).toEqual({ state: 'open' })
      expect(CW.matchedStep(v, 'CONFLICTING', windowDone)).toEqual(done('INDETERMINATE', 'merge-conflict'))
    }
  })

  it('pending and failing rows do not depend on the merge state', () => {
    const pending = verdict([['pass', 'CI'], ['pending', 'CI']])
    const failing = verdict([['pass', 'CI'], ['fail', 'CI']])
    for (const mergeable of ['MERGEABLE', 'UNKNOWN', null]) {
      expect(CW.matchedStep(pending, mergeable, true)).toEqual({ state: 'pending', pending: ['check-2'] })
      expect(CW.matchedStep(failing, mergeable, true)).toEqual(done('FAILING', null, ['check-2']))
    }
  })

  it('an unrecognised bucket is a verdict at once, and a window state does not change it', () => {
    const v = verdict([['pass', 'CI'], ['neutral', 'CI']])
    for (const windowDone of [false, true]) expect(CW.matchedStep(v, 'MERGEABLE', windowDone)).toEqual(done('INDETERMINATE', 'unrecognised-bucket'))
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
      ['gh', 'pr', 'view', PR, '--json', 'headRefOid,mergeable'],
      ['gh', 'pr', 'checks', PR, '--json', 'name,state,bucket,workflow'],
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
  const c = (...buckets: string[]): Check[] => buckets.map((bucket, i) => ({ name: `n${i}`, bucket, workflow: 'CI' }))
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

  describe('the workflow rule: PASSING needs a passing check that is a GitHub Actions job', () => {
    const row = (bucket: string, workflow?: unknown): Check => ({ name: 'n', bucket, ...(workflow === undefined ? {} : { workflow: workflow as string }) })

    it('a lone external pass is INDETERMINATE (no-workflow-check)', () => {
      expect(CW.classifyChecks([row('pass', '')])).toEqual({ status: 'INDETERMINATE', reason: 'no-workflow-check', failing: [], pending: [] })
    })

    it('a pass whose workflow is absent, null or not a string counts as external', () => {
      for (const workflow of [undefined, null, 7, {}, ['CI']]) {
        expect(CW.classifyChecks([row('pass', workflow)]).reason, JSON.stringify(workflow)).toBe('no-workflow-check')
      }
    })

    it('a skipped workflow job beside an external pass is no-workflow-check', () => {
      expect(CW.classifyChecks([row('skipping', 'CI'), row('pass', '')]).reason).toBe('no-workflow-check')
    })

    it('one workflow pass is enough, beside external passes and skips', () => {
      expect(CW.classifyChecks([row('pass', ''), row('pass', 'CI'), row('skipping', 'CI')]).status).toBe('PASSING')
    })

    it('pending and failing still outrank the workflow rule, and an unrecognised bucket outranks no-workflow-check', () => {
      expect(CW.classifyChecks([row('pass', ''), row('pending', 'CI')]).status).toBe('PENDING')
      expect(CW.classifyChecks([row('pass', ''), row('pending', '')]).status).toBe('PENDING')
      expect(CW.classifyChecks([row('pass', 'CI'), row('fail', '')]).status).toBe('FAILING')
      expect(CW.classifyChecks([row('pass', ''), row('neutral', 'CI')]).reason).toBe('unrecognised-bucket')
    })

    it('all-skipping rows keep their own reason, whatever the workflow', () => {
      expect(CW.classifyChecks([row('skipping', 'CI')]).reason).toBe('unrecognised-bucket')
      expect(CW.classifyChecks([row('skipping', '')]).reason).toBe('unrecognised-bucket')
    })
  })

  it('reads its input in bounded steps', () => {
    const many = Array.from({ length: 5000 }, () => ({ name: 'n', bucket: 'pass', workflow: 'CI' }))
    expect(CW.classifyChecks(many).status).toBe('PASSING')
  })
})

// ---------------------------------------------------------------------------
// The real script, as a process
// ---------------------------------------------------------------------------

/**
 * A preload for the real script: a timer's wait is added to the clock instead of being
 * slept, so the 90 s settle window passes at once. The gh calls stay real spawns of the fake.
 */
const VIRTUAL_TIME = [
  "'use strict';",
  'const realNow = Date.now.bind(Date);',
  'const realSetTimeout = global.setTimeout;',
  'let skipped = 0;',
  'Date.now = () => realNow() + skipped;',
  'global.setTimeout = (fn, ms, ...rest) => { skipped += Number(ms) || 0; return realSetTimeout(fn, 0, ...rest); };',
  '',
].join('\n')

describe('the script as a process: the usage line, and a scripted gh', () => {
  let root: string
  let bin: FakeBin
  let virtualTime: string

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ci-wait-'))
    bin = createFakeBin(root, ['gh'])
    virtualTime = path.join(root, 'virtual-time.cjs')
    fs.writeFileSync(virtualTime, VIRTUAL_TIME)
    // macOS scans a newly written executable on its first run; pay it here, once.
    warmFakeBin(bin, root)
  }, WARM_HOOK_TIMEOUT_MS)
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

  function runScript(args: string[], extra: Record<string, string> = {}, nodeArgs: string[] = []): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, [...nodeArgs, CI_WAIT_SCRIPT, ...args], {
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
      { tool: 'gh', args: ['pr', 'view', '12', '--json', 'headRefOid,mergeable'], stdout: JSON.stringify({ headRefOid: HEAD, mergeable: 'MERGEABLE' }) },
      { tool: 'gh', args: ['pr', 'checks', '12', '--json', 'name,state,bucket,workflow'], stdout: rows('pass', 'skipping') },
    ])
    const r = runScript(['--pr', '12', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env })
    expect(r.stdout).toMatch(/^CI PASSING pr=12 head=aaaaaaa failing=- pending=- waited=\d+\n$/)
    expect(r.status).toBe(0)
    expect(shim.readLog()).toEqual([
      ['gh', 'pr', 'view', '12', '--json', 'headRefOid,mergeable'],
      ['gh', 'pr', 'checks', '12', '--json', 'name,state,bucket,workflow'],
    ])
  })

  it('a conflicting PR through the real spawnSync is merge-conflict after one call, the view asking headRefOid,mergeable', () => {
    const shim = buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '12', '--json', 'headRefOid,mergeable'], stdout: JSON.stringify({ headRefOid: HEAD, mergeable: 'CONFLICTING' }) },
    ])
    const r = runScript(['--pr', '12', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env })
    expect(r.stdout).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=merge-conflict\n$/)
    expect(r.status).toBe(0)
    expect(shim.readLog()).toEqual([['gh', 'pr', 'view', '12', '--json', 'headRefOid,mergeable']])
  })

  describe('an empty check list through the real spawnSync, the settle window passed on a virtual clock', () => {
    const emptyListShim = (workflows: object): ScriptedShim => buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '12', '--json', 'headRefOid,mergeable'], stdout: JSON.stringify({ headRefOid: HEAD, mergeable: 'MERGEABLE' }) },
      { tool: 'gh', args: ['pr', 'checks', '12', '--json', 'name,state,bucket,workflow'], exit: 1, stderr: NO_CHECKS_STDERR },
      { tool: 'gh', args: WORKFLOWS_ARGV, stdout: JSON.stringify(workflows) },
    ])
    const runEmpty = (shim: ScriptedShim): { status: number | null; stdout: string; stderr: string } =>
      runScript(['--pr', '12', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env }, ['-r', virtualTime])

    it('an active workflow file: the no-workflow-check line, and the log shows the one probe with its exact argv', () => {
      const shim = emptyListShim({ total_count: 1, workflows: [CI_YML] })
      const r = runEmpty(shim)
      expect(r.stdout).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=no-workflow-check\n$/)
      expect(r.status).toBe(0)
      const log = shim.readLog()
      expect(log.filter(call => call[1] === 'api')).toEqual([['gh', ...WORKFLOWS_ARGV]])
      expect(log.filter(call => call[1] === 'pr' && call[2] === 'checks'), 'the window was read through').toHaveLength(6)
      expect(log[log.length - 1], 'the probe is the last call').toEqual(['gh', ...WORKFLOWS_ARGV])
    })

    it('no workflow at all: the NO_CI line, after the same probe', () => {
      const shim = emptyListShim({ total_count: 0, workflows: [] })
      const r = runEmpty(shim)
      expect(r.stdout).toMatch(/^CI NO_CI pr=12 head=aaaaaaa failing=- pending=- waited=\d+\n$/)
      expect(shim.readLog().filter(call => call[1] === 'api')).toEqual([['gh', ...WORKFLOWS_ARGV]])
    })

    it('an unscripted probe (gh exits non-zero) is never NO_CI: gh-failed after three failed polls', () => {
      const shim = buildScriptedShim(bin, root, [
        { tool: 'gh', args: ['pr', 'view', '12', '--json', 'headRefOid,mergeable'], stdout: JSON.stringify({ headRefOid: HEAD, mergeable: 'MERGEABLE' }) },
        { tool: 'gh', args: ['pr', 'checks', '12', '--json', 'name,state,bucket,workflow'], exit: 1, stderr: NO_CHECKS_STDERR },
      ])
      const r = runEmpty(shim)
      expect(r.stdout).toMatch(/^CI INDETERMINATE pr=12 head=aaaaaaa failing=- pending=- waited=\d+ reason=gh-failed\n$/)
      expect(shim.readLog().filter(call => call[1] === 'api')).toHaveLength(3)
    })
  })

  it('a missing pull request through the real spawnSync is NO_PR', () => {
    const shim = buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '999999999', '--json', 'headRefOid,mergeable'], exit: 1, stderr: NO_PR_STDERR },
    ])
    const r = runScript(['--pr', '999999999', '--head', HEAD], { PATH: `${shim.dir}${path.delimiter}${process.env.PATH ?? ''}`, ...shim.env })
    expect(r.stdout).toMatch(/^CI NO_PR pr=999999999 head=aaaaaaa failing=- pending=- waited=\d+\n$/)
    expect(shim.readLog()).toHaveLength(1)
  })

  it('failing checks through the real spawnSync name the failing check on the one line, sanitized', () => {
    const shim = buildScriptedShim(bin, root, [
      { tool: 'gh', args: ['pr', 'view', '7', '--json', 'headRefOid,mergeable'], stdout: JSON.stringify({ headRefOid: HEAD, mergeable: 'MERGEABLE' }) },
      { tool: 'gh', args: ['pr', 'checks', '7', '--json', 'name,state,bucket,workflow'], stdout: JSON.stringify([{ name: 'lint\u001b[0m', state: 'FAILURE', bucket: 'fail', workflow: 'CI' }]) },
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

/** The settle comparisons in code lines, and the clock each settle() call inside waitForCi is given. */
function collectSettleSites(source: string): { comparisons: number; windows: string[] } {
  const code = codeLines(source).join('\n')
  const start = code.indexOf('async function waitForCi(')
  const wait = start < 0 ? '' : code.slice(start, code.indexOf('\n}\n', start))
  return {
    comparisons: [...code.matchAll(/>=\s*settleMs\b/g)].length,
    windows: [...wait.matchAll(/\bsettle\(\s*(\w+)\s*,/g)].map(m => m[1]),
  }
}

/** Quoted flags that make `gh api` send a body or change its method; the one probe has none. */
function collectApiWriteFlags(source: string): string[] {
  return [...codeLines(source).join('\n').matchAll(/['"`](?:-f|-F|-X|--field|--raw-field|--method|--input)['"`]/g)].map(m => m[0])
}

/** Quoted `api` words in code lines: each is a `gh api` call site. */
function collectApiSites(source: string): string[] {
  return [...codeLines(source).join('\n').matchAll(/['"`]api['"`]/g)].map(m => m[0])
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
      'D-CI-WORKFLOW-RULE', 'D-CI-MERGE-STATE', 'D-CI-WORKFLOWS',
    ]) {
      expect(SOURCE, `${marker} missing`).toContain(marker)
    }
  })

  it('the one gh api call is the workflows probe: a single site, read-only, through the bounded gh call', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(collectApiSites(SOURCE)).toHaveLength(1)
    expect(collectApiWriteFlags(SOURCE)).toEqual([])
    expect([...codeLines(SOURCE).join('\n').matchAll(/\bgh\(\s*WORKFLOWS_ARGS\s*\)/g)]).toHaveLength(1)
    const probe = `${SOURCE}\nconst bad = ['api', 'x', '-X', 'POST', "--method", 'DELETE', \`-f\`, '-F', '--input', '--field']`
    expect(collectApiSites(probe)).toHaveLength(2)
    expect(collectApiWriteFlags(probe)).toHaveLength(6)
  })

  it('the settle comparison appears once, in the helper, and each window calls the helper once on its own clock', () => {
    const sites = collectSettleSites(SOURCE)
    expect(sites.comparisons).toBe(1)
    expect(sites.windows).toEqual(['firstMismatchAt', 'firstEmptyAt'])
    const probe = [
      'async function waitForCi(i) {',
      '  settle(firstMismatchAt, 1, 2); settle(firstMismatchAt, 1, 2);',
      '}',
      'function settle(f, n, s) { return n - f >= settleMs }',
      'const z = 1 >= settleMs',
      '',
    ].join('\n')
    expect(collectSettleSites(probe)).toEqual({ comparisons: 2, windows: ['firstMismatchAt', 'firstMismatchAt'] })
  })

  it('pins the ratchet constant exactly once, as the manifest spells it', () => {
    expect(SOURCE.split('const CI_WAIT_MAX_SECONDS = 570;').length - 1).toBe(1)
  })
})
