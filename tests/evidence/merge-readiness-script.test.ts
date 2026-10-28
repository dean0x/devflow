/**
 * tests/evidence/merge-readiness-script.test.ts
 *
 * #455 — `check-merge-readiness` as a script: `verify-evidence.cjs readiness`.
 *
 *   AC-204  the script prints exactly the contract's `## Merge Readiness` block in
 *           every scenario it can reach, reads the PR and writes nothing, and says
 *           DEGRADED (exit 2) when it cannot establish the PR, its review decision
 *           or its thread count. The ladder itself is held to the prose and to a
 *           model in tests/evidence/merge-readiness.test.ts; this suite runs the
 *           whole script under a `gh` fake on PATH.
 *   Parity  the block's lines are the contract's Output template, line for line, and
 *           the statuses the template names are the ones the script prints.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe. Every reader reads BUILT artifacts.
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import { readFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { makeFifo, realGit } from '../evidence-policy/scripted-shim.js'
import { extractOpSectionFromCorpus, gitOperationReferenceCorpus, prHostRel } from '../helpers.js'
import { cleanShimRoots, runScript, SHIM_HEAD, warmGhShim, type ScriptRun, type ShimScenario } from './pr-shim.js'
import { PR_EVIDENCE_SCRIPT, SUBPROCESS_TIMEOUT_MS, trackedCheckAnswer, VERIFY_EVIDENCE_SCRIPT } from './seam.js'

interface ReadinessBlock {
  pr: number
  status: 'READY' | 'NOT_READY' | 'DEGRADED'
  reason: string | null
  threads: string
  decision: string
  ci: string
  plan: string
  approval: string
}
interface VerifyApi {
  main(argv: readonly string[], deps?: object): { code: number; stdout: string }
  settleOutcome(outcome: unknown): { code: number; stdout: string }
  parseReadinessBlock(text: string): ReadinessBlock | null
  renderReadinessBlock(block: ReadinessBlock): string
  bindCiHead(ci: CiRead, viewHead: unknown, evidenceHead: unknown): CiRead
  writeReadinessOut(
    io: { stderr(text: string): void },
    file: string,
    pr: number,
    outcome: { code: number; stdout: string },
    head: string | null,
    source: string | undefined,
  ): { code: number; stdout: string }
}
interface CiRead {
  status: string
  failing: string
}
interface EvidenceApi {
  exception(line: string): { ok: boolean; value?: unknown }
  render(plan: { tps: readonly unknown[] }, ev: object, mode: string): { ok: boolean; value: { text: string } }
}

const req = createRequire(import.meta.url)
/** The module object the scripts load: a spy on it reaches their file calls, which the `import * as fs` namespace cannot give. */
const nodeFs = req('fs') as typeof fs
const VE = req(VERIFY_EVIDENCE_SCRIPT) as VerifyApi
const PE = req(PR_EVIDENCE_SCRIPT) as EvidenceApi

const OP = 'check-merge-readiness'
/** Each test spawns node a dozen times (the script, the scrubber, the gh fake): generous under a loaded full-suite run. */
const SPAWN_BUDGET = { timeout: 120_000 } as const
const EM = '—'

beforeAll(warmGhShim, SUBPROCESS_TIMEOUT_MS)
afterAll(cleanShimRoots)

// ---------------------------------------------------------------------------
// Scenario building blocks
// ---------------------------------------------------------------------------

/** An evidence comment by the viewer carrying a `test-plan` exception: it makes the plan's absence deliberate. */
function exceptionRecord(): string {
  const exc = PE.exception('- `test-plan` self-attested by @octocat at 2026-09-25T10:00:00Z: no plan for a docs-only change')
  if (!exc.ok) throw new Error('the exception fixture no longer parses')
  const rendered = PE.render({ tps: [] }, { head: SHIM_HEAD, key: '0123456789ab', htmlUrl: '', records: [], exceptions: [exc.value] }, 'full')
  if (!rendered.ok) throw new Error('the record fixture no longer renders')
  return rendered.value.text
}

const RECORD_COMMENT = { author: { login: 'devflow-bot' }, authorAssociation: 'OWNER', body: exceptionRecord(), viewerDidAuthor: true }
const PASSING = [{ name: 'unit', state: 'SUCCESS', bucket: 'pass', workflow: 'CI' }, { name: 'lint', state: 'SUCCESS', bucket: 'pass', workflow: 'CI' }]
const RESOLVED = { totalCount: 2, nodes: [{ isResolved: true }, { isResolved: true }] }

/** Everything green, so each scenario spoils exactly one thing. */
function green(over: ShimScenario = {}): ShimScenario {
  return { reviewDecision: 'APPROVED', checks: PASSING, threads: RESOLVED, comments: [RECORD_COMMENT], ...over }
}

function run(
  scenario: ShimScenario,
  require: 'true' | 'false' | null = 'false',
  extra: readonly string[] = [],
  mutate?: (source: string) => string,
): ScriptRun {
  const args = ['readiness', '--pr', '7', ...(require === null ? [] : ['--require-non-author-approval', require]), ...extra]
  return runScript({ scenario, args, mutate })[0]
}

function block(r: ScriptRun): ReadinessBlock {
  const parsed = VE.parseReadinessBlock(r.stdout)
  if (parsed === null) throw new Error(`stdout is not a readiness block (exit ${r.code}): ${JSON.stringify(r.stdout)} ${r.stderr}`)
  return parsed
}

const status = (r: ScriptRun): string => {
  const b = block(r)
  return b.reason === null ? b.status : `${b.status} (${b.reason})`
}

// ---------------------------------------------------------------------------
// AC-204 — the script, run for real
// ---------------------------------------------------------------------------

describe('AC-204: readiness prints the contract block and reads without writing', () => {
  it('1. every input green: READY, exit 0, the details say what was read', SPAWN_BUDGET, () => {
    const r = run(green())
    expect(r.code, r.stderr).toBe(0)
    expect(status(r)).toBe('READY')
    expect(block(r)).toEqual({
      pr: 7, status: 'READY', reason: null, threads: '0', decision: 'APPROVED', ci: 'PASSING',
      plan: '0/0 (VERIFIED-CI 0, ATTESTED-LOCAL 0)', approval: 'not required',
    })
    expect(r.stdout.split('\n').slice(0, 5)).toEqual(['## Merge Readiness', '**PR**: #7', '**Status**: READY', '', '### Details'])
    expect(r.stdout).not.toContain('TRACEABILITY')
  })

  it('2. unresolved threads decide first, and the count is the unresolved ones', SPAWN_BUDGET, () => {
    const r = run(green({ threads: { totalCount: 3, nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] }, reviewDecision: 'CHANGES_REQUESTED' }))
    expect(r.code, r.stderr).toBe(0)
    expect(status(r)).toBe('NOT_READY (unresolved threads: 2)')
    expect(block(r).threads).toBe('2')
  })

  it('3. more than 100 threads is an approximate count, shown with its note, and never READY on its own', SPAWN_BUDGET, () => {
    const hundred = Array.from({ length: 100 }, () => ({ isResolved: true }))
    const quiet = run(green({ threads: { totalCount: 150, nodes: hundred } }))
    expect(status(quiet)).toBe('NOT_READY (status unknown)')
    expect(block(quiet).threads).toBe('>0 (count approximate — PR has more than 100 threads)')
    const open = run(green({ threads: { totalCount: 150, nodes: [{ isResolved: false }, ...hundred.slice(1)] } }))
    expect(status(open)).toBe('NOT_READY (unresolved threads: >1)')
  })

  it('4. changes requested, no approving review and an unrecognised decision are each their own arm', SPAWN_BUDGET, () => {
    expect(status(run(green({ reviewDecision: 'CHANGES_REQUESTED' })))).toBe('NOT_READY (changes requested)')
    expect(status(run(green({ reviewDecision: 'REVIEW_REQUIRED' })))).toBe('NOT_READY (no approving review)')
    for (const reviewDecision of [null, '']) {
      const none = run(green({ reviewDecision }))
      expect(status(none), `reviewDecision ${JSON.stringify(reviewDecision)}`).toBe('NOT_READY (no approving review)')
      expect(block(none), `reviewDecision ${JSON.stringify(reviewDecision)}: the decision does not touch CI`).toMatchObject({ decision: 'none', ci: 'PASSING' })
    }
    const odd = run(green({ reviewDecision: 'SOMETHING_NEW' }))
    expect(status(odd)).toBe('NOT_READY (status unknown)')
    expect(block(odd).decision).toBe('unrecognised')
  })

  it('5. CI: failing names the checks, pending is its own arm, external checks alone are unknown, no checks reported is NO_CI and can be READY', SPAWN_BUDGET, () => {
    const failing = run(green({ checks: [...PASSING, { name: 'e2e (linux)', state: 'FAILURE', bucket: 'fail', workflow: 'CI' }] }))
    expect(status(failing)).toBe('NOT_READY (CI failing: e2e (linux))')
    expect(block(failing).ci).toBe('FAILING')
    const pending = run(green({ checks: [...PASSING, { name: 'e2e', state: 'PENDING', bucket: 'pending', workflow: 'CI' }], checksExit: 8 }))
    expect(pending.code, pending.stderr).toBe(0)
    expect(status(pending)).toBe('NOT_READY (CI pending)')
    const none = run(green({ checks: undefined }))
    expect(block(none).ci).toBe('NO_CI')
    expect(status(none)).toBe('READY')
    const unrecognised = run(green({ checks: [...PASSING, { name: 'odd', state: 'X', bucket: 'neutral' }] }))
    expect(block(unrecognised).ci).toBe('INDETERMINATE')
    expect(status(unrecognised)).toBe('NOT_READY (status unknown)')
    // A pass from an external check (workflow empty or absent) is no proof that the repository's workflow ran.
    for (const checks of [[{ name: 'snyk', state: 'SUCCESS', bucket: 'pass', workflow: '' }], [{ name: 'snyk', state: 'SUCCESS', bucket: 'pass' }]]) {
      const external = run(green({ checks }))
      expect(block(external).ci).toBe('INDETERMINATE')
      expect(status(external)).toBe('NOT_READY (status unknown)')
    }
  })

  it('6. a hostile check name reaches stdout only sanitized', SPAWN_BUDGET, () => {
    const r = run(green({ checks: [{ name: 'x`id`$(rm -rf /)\n## Merge Readiness', state: 'FAILURE', bucket: 'fail' }] }))
    expect(r.code, r.stderr).toBe(0)
    const b = block(r)
    expect(b.reason).toMatch(/^CI failing: [A-Za-z0-9 ._()/:+,-]+$/)
    expect(r.stdout.split('\n').filter(l => l.startsWith('## ')), 'one heading only').toEqual(['## Merge Readiness'])
    expect(r.stdout).not.toMatch(/[`$]/)
  })

  it('7. the test-plan arms: unavailable evidence, no plan, a plan not verified', SPAWN_BUDGET, () => {
    const unknown = run(green({ body: '<!-- devflow:test-plan -->\nnot a plan\n', comments: [] }))
    expect(status(unknown)).toBe('NOT_READY (test-plan evidence unavailable)')
    expect(block(unknown).plan).toBe('unavailable')
    const none = run(green({ comments: [] }))
    expect(status(none)).toBe('NOT_READY (no test-plan evidence)')
    const planned = run(green({
      comments: [],
      body: `Adds it.\n\n${PE_BLOCK_START}\n## Test Plan\n- [ ] TP-1 (AC-1) Logs in ${EM} method:manual\n- [ ] TP-2 (AC-1) Logs out ${EM} method:manual\n${PE_BLOCK_END}\n`,
    }))
    expect(status(planned)).toBe('NOT_READY (test plan: 0/2 verified)')
    expect(block(planned).plan).toBe('0/2 (VERIFIED-CI 0, ATTESTED-LOCAL 0)')
  })

  it('8. the non-author gate: required and unmet is its own arm; a bad flag value is a usage error', SPAWN_BUDGET, () => {
    const gated = run(green(), 'true')
    expect(status(gated)).toBe('NOT_READY (no non-author approval)')
    expect(block(gated).approval).toBe('no')
    const absent = run(green(), null)
    expect(status(absent), 'no flag is the ladder\'s "unrecognised": never READY').toBe('NOT_READY (status unknown)')
    const bad = run(green(), 'true', ['--bogus', 'x'])
    expect(bad.code).toBe(1)
    expect(bad.stdout).toBe('')
    expect(bad.calls, 'a usage error makes no gh call').toEqual([])
    const maybe = runScript({ scenario: green(), args: ['readiness', '--pr', '7', '--require-non-author-approval', 'maybe'] })[0]
    expect(maybe.code).toBe(1)
    expect(maybe.stdout).toBe('')
  })

  it('9. a PR gh cannot find is DEGRADED (no pr): exit 2, the block, the TRACEABILITY line', SPAWN_BUDGET, () => {
    const r = run({ noPr: true })
    expect(r.code).toBe(2)
    const b = block(r)
    expect(b).toMatchObject({ status: 'DEGRADED', reason: 'no pr', threads: 'unavailable', decision: 'unavailable', ci: 'unavailable', plan: 'unavailable' })
    expect(r.stdout.trimEnd().split('\n').pop()).toBe('TRACEABILITY: DEGRADED (no pr)')
  })

  it('10. threads that cannot be counted are DEGRADED, never zero', SPAWN_BUDGET, () => {
    const unscripted = run(green({ threads: undefined }))
    expect(unscripted.code).toBe(2)
    expect(block(unscripted)).toMatchObject({ status: 'DEGRADED', reason: 'gh unavailable', decision: 'APPROVED', threads: 'unavailable' })
    const malformed = run(green({ threads: { totalCount: 1, nodes: [{ isResolved: 'yes' }] } }))
    expect(malformed.code).toBe(2)
    expect(block(malformed).reason).toBe('review threads unreadable')
    const lying = run(green({ threads: { totalCount: 0, nodes: [{ isResolved: false }] } }))
    expect(lying.code, 'a total below the nodes it came with is unreadable').toBe(2)
  })

  it('11. it only reads: no write verb, a query and not a mutation, and a fixed number of calls', SPAWN_BUDGET, () => {
    for (const scenario of [green(), green({ threads: { totalCount: 1, nodes: [{ isResolved: false }] } }), green({ reviewDecision: 'CHANGES_REQUESTED' })]) {
      const r = run(scenario)
      expect(r.writes).toEqual([])
      expect(r.calls.length, 'a readiness run makes at least its three reads').toBeGreaterThanOrEqual(4)
      expect(r.calls.length, 'and at most those plus verify\'s').toBeLessThanOrEqual(8)
      const verbs = new Set(r.calls.map(c => c.args.slice(0, 2).join(' ')))
      expect([...verbs].sort()).toEqual(['api graphql', 'pr checks', 'pr view'])
      const graphql = r.calls.filter(c => c.args[0] === 'api').map(c => c.args.find(a => a.startsWith('query=')) ?? '')
      expect(graphql).toHaveLength(1)
      expect(graphql[0]).toMatch(/^query=query\(/)
      expect(graphql[0]).not.toMatch(/mutation/i)
      expect(graphql[0], 'the PR number is a variable, not query text').not.toMatch(/number: 7/)
    }
  })

  it('12. the run leaves no work file and every run ends with exactly the block and its newline', SPAWN_BUDGET, () => {
    for (const r of [run(green()), run({ noPr: true })]) {
      expect(r.leftovers).toEqual([])
      expect(r.stdout.endsWith('\n')).toBe(true)
      expect(r.stdout.endsWith('\n\n')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// The shared CI gate and the head rule — readiness reads CI like the wait does
// ---------------------------------------------------------------------------

const VIEW_ARGV = ['pr', 'view', '7', '--json', 'reviewDecision,mergeable,headRefOid']
const CHECKS_ARGV = ['pr', 'checks', '7', '--json', 'name,state,bucket,workflow']
const WORKFLOWS_ARGV = ['api', 'repos/{owner}/{repo}/actions/workflows?per_page=100']
const OTHER_HEAD = 'd'.repeat(40)
const WORKFLOW_FILE = { path: '.github/workflows/ci.yml', state: 'active' }
const FAILED_ROW = { name: 'e2e', state: 'FAILURE', bucket: 'fail', workflow: 'CI' }
const PENDING_ROW = { name: 'e2e', state: 'PENDING', bucket: 'pending', workflow: 'CI' }
const NOT_A_PLAN = { body: '<!-- devflow:test-plan -->\nnot a plan\n', comments: [] }
const UNKNOWN_CI = { status: 'NOT_READY', reason: 'status unknown', ci: 'INDETERMINATE' } as const
/** The two ways an empty check list reaches the script: gh's "no checks reported" error, and a reply of `[]`. */
const EMPTY_LISTS = [['no checks reported', undefined], ['an empty array', []]] as const

const verbs = (r: ScriptRun): string[] => r.calls.map(c => c.args.slice(0, 2).join(' '))
const callsTo = (r: ScriptRun, argv: readonly string[]): ScriptRun['calls'][number][] =>
  r.calls.filter(c => argv.every((a, i) => c.args[i] === a))

describe('readiness reads CI through the shared merge gate', () => {
  it('13. a workflow pass on a MERGEABLE PR reads PASSING and READY; the first read asks the decision, the merge state and the head', SPAWN_BUDGET, () => {
    const r = run(green())
    expect(r.code, r.stderr).toBe(0)
    expect(block(r).ci).toBe('PASSING')
    expect(status(r)).toBe('READY')
    expect(r.calls[0].args).toEqual(VIEW_ARGV)
    expect(callsTo(r, ['pr', 'checks']).map(c => c.args)).toEqual([CHECKS_ARGV])
    expect(callsTo(r, WORKFLOWS_ARGV), 'rows make no workflow probe').toEqual([])
    expect(r.writes).toEqual([])
  })

  it('14. a CONFLICTING PR reads unknown whatever the rows say, makes no checks call, and still shows the decision', SPAWN_BUDGET, () => {
    const cases: ReadonlyArray<readonly [string, ShimScenario]> = [
      ['passing rows', {}],
      ['an empty list', { checks: undefined }],
      ['a failing row', { checks: [...PASSING, FAILED_ROW] }],
    ]
    for (const [label, over] of cases) {
      const r = run(green({ ...over, mergeable: 'CONFLICTING' }))
      expect(r.code, `${label}: ${r.stderr}`).toBe(0)
      expect(block(r), label).toMatchObject({ ...UNKNOWN_CI, decision: 'APPROVED' })
      expect(callsTo(r, ['pr', 'checks']), `${label}: no checks call`).toEqual([])
      expect(callsTo(r, WORKFLOWS_ARGV), `${label}: no workflow probe`).toEqual([])
    }
  })

  const NOT_MERGEABLE: ReadonlyArray<readonly [string, string | null]> = [['UNKNOWN', 'UNKNOWN'], ['absent', null], ['odd', 'SOMETHING_NEW']]
  it.each(NOT_MERGEABLE)('15. a merge state that is not MERGEABLE (%s) is never PASSING or NO_CI and never DEGRADED', SPAWN_BUDGET, (label, mergeable) => {
    for (const [rows, over] of [['passing rows', {}], ['no checks reported', { checks: undefined }], ['an empty array', { checks: [] }]] as const) {
      const r = run(green({ ...over, mergeable }))
      expect(r.code, `${label}, ${rows}: ${r.stderr}`).toBe(0)
      expect(block(r), `${label}, ${rows}`).toMatchObject({ ...UNKNOWN_CI, decision: 'APPROVED' })
      expect(callsTo(r, WORKFLOWS_ARGV), `${label}, ${rows}: no probe unless MERGEABLE`).toEqual([])
    }
  })

  it('15. FAILING and PENDING do not depend on the merge state', SPAWN_BUDGET, () => {
    expect(status(run(green({ mergeable: 'UNKNOWN', checks: [...PASSING, FAILED_ROW] })))).toBe('NOT_READY (CI failing: e2e)')
    expect(status(run(green({ mergeable: null, checks: [...PASSING, PENDING_ROW], checksExit: 8 })))).toBe('NOT_READY (CI pending)')
  })

  it('16. with check rows, a PR that does not conflict makes the same calls as before the merge rules; a conflict drops the checks call', SPAWN_BUDGET, () => {
    const clean = run(green())
    expect(verbs(clean)).toEqual(['pr view', 'api graphql', 'pr checks', 'pr view'])
    expect(clean.writes).toEqual([])
    const conflicting = run(green({ mergeable: 'CONFLICTING' }))
    expect(verbs(conflicting)).toEqual(verbs(clean).filter(v => v !== 'pr checks'))
  })
})

describe('an empty list asks the workflow list; CI counts for the head the evidence was read at', () => {
  it.each(EMPTY_LISTS)('17. an empty list (%s) on a MERGEABLE PR is NO_CI and READY only when no workflow file is active', SPAWN_BUDGET, (_form, checks) => {
    const none = run(green({ checks }))
    expect(block(none).ci).toBe('NO_CI')
    expect(status(none)).toBe('READY')
    expect(callsTo(none, ['api']).filter(c => c.args[1] !== 'graphql').map(c => c.args), 'one fixed read-only call, no PR number or head').toEqual([WORKFLOWS_ARGV])

    const notFiles = run(green({
      checks,
      workflows: [{ path: 'dynamic/copilot-pull-request-reviewer/x', state: 'active' }, { path: '.github/workflows/old.yml', state: 'disabled_manually' }],
    }))
    expect(block(notFiles).ci, 'a dynamic path and a disabled file are no workflow that could still start').toBe('NO_CI')
    expect(status(notFiles)).toBe('READY')

    const active = run(green({ checks, workflows: [WORKFLOW_FILE] }))
    expect(active.code, active.stderr).toBe(0)
    expect(block(active)).toMatchObject(UNKNOWN_CI)
  })

  it.each(EMPTY_LISTS)('18. a probe that fails, cannot be read or is one page of many reads unknown, not DEGRADED (%s)', SPAWN_BUDGET, (_form, checks) => {
    const withoutProbe = run(green({ checks, mergeable: 'UNKNOWN' }))
    const failed = run(green({ checks, failures: [{ match: WORKFLOWS_ARGV, times: 3, stderr: 'gh: Bad Gateway (HTTP 502)\n' }] }))
    expect(failed.code, failed.stderr).toBe(0)
    expect(block(failed)).toMatchObject(UNKNOWN_CI)
    expect(callsTo(failed, WORKFLOWS_ARGV).map(c => c.failed), 'one call, no retry').toEqual([true])
    expect(failed.calls.length, 'the failed probe adds one call').toBe(withoutProbe.calls.length + 1)
    for (const workflowsReply of ['not json', '{"total_count":150,"workflows":[]}']) {
      const r = run(green({ checks, workflowsReply }))
      expect(r.code, `${workflowsReply}: ${r.stderr}`).toBe(0)
      expect(block(r), workflowsReply).toMatchObject(UNKNOWN_CI)
    }
  })

  it('19. a head that moved between the decision read and the evidence read turns PASSING and NO_CI into unknown, not DEGRADED', SPAWN_BUDGET, () => {
    for (const [label, over] of [['PASSING', {}], ['NO_CI', { checks: undefined }]] as const) {
      const r = run(green({ ...over, heads: [SHIM_HEAD, OTHER_HEAD] }))
      expect(r.code, `${label}: ${r.stderr}`).toBe(0)
      expect(block(r), label).toMatchObject(UNKNOWN_CI)
    }
  })

  it('20. the same head on both reads keeps READY; FAILING and PENDING keep their arms when the head moved', SPAWN_BUDGET, () => {
    const same = run(green({ heads: [SHIM_HEAD, SHIM_HEAD] }))
    expect(block(same).ci).toBe('PASSING')
    expect(status(same)).toBe('READY')
    const moved = { heads: [SHIM_HEAD, OTHER_HEAD] }
    const failing = run(green({ ...moved, checks: [...PASSING, FAILED_ROW] }))
    expect(block(failing).ci).toBe('FAILING')
    expect(status(failing)).toBe('NOT_READY (CI failing: e2e)')
    const pending = run(green({ ...moved, checks: [...PASSING, PENDING_ROW], checksExit: 8 }))
    expect(block(pending).ci).toBe('PENDING')
    expect(status(pending)).toBe('NOT_READY (CI pending)')
  })

  it('21. a head that cannot be read, or evidence that is unknown, leaves CI unknown and never DEGRADED', SPAWN_BUDGET, () => {
    const noHead = run(green({ heads: ['not-a-sha', SHIM_HEAD] }))
    expect(noHead.code, noHead.stderr).toBe(0)
    expect(block(noHead)).toMatchObject(UNKNOWN_CI)
    for (const over of [{}, { checks: undefined }]) {
      const r = run(green({ ...NOT_A_PLAN, ...over }))
      expect(r.code, r.stderr).toBe(0)
      expect(block(r), 'with the evidence unknown CI is never PASSING or NO_CI').toMatchObject({ status: 'NOT_READY', reason: 'test-plan evidence unavailable', ci: 'INDETERMINATE' })
    }
  })
})

describe('readiness reads the check rows through ci-wait\'s one parser', () => {
  /** Rows the typed scenario would not allow: the fake serves them as given. */
  const rowsOf = (rows: readonly unknown[]) => rows as unknown as NonNullable<ShimScenario['checks']>
  /** Short rows: the fake writes its reply and exits, which cuts a pipe at 64 KB, and 1001 rows must reach the script whole. */
  const manyPassing = (n: number) => rowsOf(Array.from({ length: n }, (_, i) => ({ name: `j${i}`, bucket: 'pass', workflow: 'C' })))

  it('22. one unreadable row, or more than 1000 rows, reads unknown and makes no workflow probe', SPAWN_BUDGET, () => {
    const cases: ReadonlyArray<readonly [string, ShimScenario['checks']]> = [
      ['a row without a name', rowsOf([...PASSING, { bucket: 'pass', workflow: 'CI' }])],
      ['a row without a bucket', rowsOf([...PASSING, { name: 'e2e', workflow: 'CI' }])],
      ['a row that is not an object', rowsOf([...PASSING, 'row'])],
      ['1001 rows', manyPassing(1001)],
    ]
    for (const [label, checks] of cases) {
      const r = run(green({ checks }))
      expect(r.code, `${label}: ${r.stderr}`).toBe(0)
      expect(block(r), label).toMatchObject({ ...UNKNOWN_CI, decision: 'APPROVED' })
      expect(callsTo(r, WORKFLOWS_ARGV), `${label}: no workflow probe`).toEqual([])
    }
  })

  it('23. exactly 1000 passing rows still read PASSING and READY', SPAWN_BUDGET, () => {
    const r = run(green({ checks: manyPassing(1000) }))
    expect(r.code, r.stderr).toBe(0)
    expect(block(r).ci).toBe('PASSING')
    expect(status(r)).toBe('READY')
  })

  it('24. a passing row whose workflow is not a string is no workflow job, so it never reads PASSING', SPAWN_BUDGET, () => {
    const r = run(green({ checks: rowsOf([{ name: 'external', state: 'SUCCESS', bucket: 'pass', workflow: 7 }]) }))
    expect(r.code, r.stderr).toBe(0)
    expect(block(r).ci).not.toBe('PASSING')
    expect(status(r)).not.toBe('READY')
  })

  it('25. the script holds no row parser of its own: it calls ci-wait\'s parseChecks once', () => {
    const source = readFileSync(VERIFY_EVIDENCE_SCRIPT, 'utf-8')
    expect(source.split('CW.parseChecks(')).toHaveLength(2)
    expect(source, 'the row bound lives in ci-wait only').not.toContain('READINESS_MAX_CHECKS')
  })
})

describe('bindCiHead: CI counts only for the head the evidence was read at', () => {
  const A = 'a'.repeat(40)
  const B = 'b'.repeat(40)
  const UNKNOWN = { status: 'INDETERMINATE', failing: '-' }
  const heads: ReadonlyArray<readonly [unknown, unknown]> = [
    [A, B], [A, null], [null, A], [null, null], [A, undefined], [undefined, A],
    [A, 'a'.repeat(39)], ['a'.repeat(39), 'a'.repeat(39)], [A.toUpperCase(), A.toUpperCase()], [1, 1],
  ]

  it('keeps PASSING and NO_CI only when both heads are 40 hex and equal', () => {
    for (const status of ['PASSING', 'NO_CI']) {
      const ci = { status, failing: '-' }
      expect(VE.bindCiHead(ci, A, A)).toEqual(ci)
      for (const [view, evidence] of heads) expect(VE.bindCiHead(ci, view, evidence), `${status} ${String(view)} ${String(evidence)}`).toEqual(UNKNOWN)
      expect(ci, 'the input is not changed').toEqual({ status, failing: '-' })
    }
  })

  it('leaves every other status as it is, whatever the heads', () => {
    for (const ci of [{ status: 'FAILING', failing: 'unit' }, { status: 'PENDING', failing: '-' }, UNKNOWN, { status: 'NO_PR', failing: '-' }]) {
      for (const [view, evidence] of [[A, A], ...heads] as const) expect(VE.bindCiHead(ci, view, evidence)).toEqual(ci)
    }
  })
})

describe('known-bad probes: a readiness script that drops one rule reads READY where the real one does not', () => {
  /** One source text replaced; it must appear exactly once, or the probe tests nothing. */
  const seed = (find: string, replacement: string) => (source: string): string => {
    expect(source.split(find), `the seed "${find}" must land once`).toHaveLength(2)
    return source.replace(find, replacement)
  }
  const both = (...seeds: Array<(source: string) => string>) => (source: string): string => seeds.reduce((text, one) => one(text), source)
  const PASSING_GATE = "CW.mergeGate(c.status, mergeable, null) !== 'keep'"
  const CONFLICT_GATE = 'CW.isConflicting(mergeable)'

  const probes: ReadonlyArray<{ name: string; scenario: ShimScenario; mutate: (source: string) => string }> = [
    {
      name: 'the NO_CI gate',
      scenario: green({ checks: undefined, mergeable: 'UNKNOWN' }),
      mutate: seed("gate === 'keep' ? { status: 'NO_CI'", "true ? { status: 'NO_CI'"),
    },
    {
      name: 'the PASSING gate',
      scenario: green({ mergeable: 'UNKNOWN' }),
      mutate: seed(PASSING_GATE, "CW.mergeGate(c.status, mergeable, null) === 'conflict'"),
    },
    {
      name: 'the CONFLICTING gate',
      scenario: green({ mergeable: 'CONFLICTING' }),
      mutate: both(seed(CONFLICT_GATE, 'false'), seed(PASSING_GATE, "CW.mergeGate(c.status, mergeable, null) === 'await-merge-state'")),
    },
    {
      name: 'the head comparison',
      scenario: green({ heads: [SHIM_HEAD, OTHER_HEAD] }),
      mutate: seed('&& viewHead === evidenceHead', '&& true'),
    },
    {
      name: 'the workflows rule',
      scenario: green({ checks: undefined, workflows: [WORKFLOW_FILE] }),
      mutate: seed("CW.mergeGate('NO_CI', mergeable, probeWorkflows(io))", "CW.mergeGate('NO_CI', mergeable, false)"),
    },
    {
      name: 'the empty-array arm',
      scenario: green({ checks: [], workflows: [WORKFLOW_FILE] }),
      mutate: seed('if (checks.length === 0) return readEmptyCi(io, mergeable);', "if (checks.length === 0) return { status: 'NO_CI', failing: '-' };"),
    },
  ]

  it('gives each probe its own name', () => {
    const names = probes.map(probe => probe.name)
    expect(new Set(names).size, `a repeated name hides one probe behind another: ${names.join(', ')}`).toBe(names.length)
  })

  for (const { name, scenario, mutate } of probes) {
    it(`${name}: dropped, a PR that is not ready reads READY`, SPAWN_BUDGET, () => {
      expect(status(run(scenario)), `${name} in force`).toBe('NOT_READY (status unknown)')
      const bad = run(scenario, 'false', [], mutate)
      expect(bad.code, bad.stderr).toBe(0)
      expect(status(bad), `${name} dropped`).toBe('READY')
    })
  }
})

const PE_BLOCK_START = '<!-- devflow:test-plan -->'
const PE_BLOCK_END = '<!-- /devflow:test-plan -->'

// ---------------------------------------------------------------------------
// Local evidence and the out file — a machine that keeps merge evidence in files
// ---------------------------------------------------------------------------

const localDirs: string[] = []
afterAll(() => {
  for (const dir of localDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function localDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-local-'))
  localDirs.push(dir)
  return dir
}

const LOCAL_TP = `- [ ] TP-1 (AC-1) Logs in ${EM} method:local`
const LOCAL_CLAIM = `- TP-1 PASS sha:${SHIM_HEAD} by:test exit:0`
const LOCAL_EXCEPTION = '- `test-plan` self-attested by @octocat at 2026-09-25T10:00:00Z: docs only'

/** An evidence file's text: the plan lines, the claims and, when given, the exceptions. */
function evidenceText(plan: readonly string[], claims: readonly string[] = [], exceptions: readonly string[] = []): string {
  const lines = ['## Test Plan', ...plan, '', '## Claims', ...claims]
  if (exceptions.length > 0) lines.push('', '## Evidence Exceptions', ...exceptions)
  return `${lines.join('\n')}\n`
}

function writeEvidence(text: string): string {
  const file = path.join(localDir(), 'evidence.md')
  fs.writeFileSync(file, text)
  return file
}

interface TwinResult { readonly status: number; readonly stdout: Buffer; readonly stderr: Buffer }
const twinAnswer = (stdout: string, status = 0): TwinResult => ({ status, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) })

/**
 * An in-process exec for a PR whose every read is green and whose head is `SHIM_HEAD`: the
 * readiness reads, the evidence read's PR view, and the git calls of a clean full clone. An argv
 * it does not know answers 97 and is recorded in `misses`. The tracked-file check on a path is not a
 * read of the PR: it is recorded in `checks`, and answered "not tracked", or by the real git with `realGit`.
 */
function greenTwin(realGit = false): { exec: (file: string, args: string[]) => TwinResult; calls: string[][]; misses: string[]; checks: string[][] } {
  const calls: string[][] = []
  const misses: string[] = []
  const checks: string[][] = []
  const base = 'b'.repeat(40)
  const exec = (file: string, args: string[]): TwinResult => {
    const tracked = trackedCheckAnswer(file, args, realGit)
    if (tracked !== null) {
      checks.push([file, ...args])
      return { ...tracked, status: tracked.status ?? 97 }
    }
    calls.push([file, ...args])
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      const fields = args[args.indexOf('--json') + 1]
      if (fields === 'reviewDecision,mergeable,headRefOid') {
        return twinAnswer(JSON.stringify({ reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', headRefOid: SHIM_HEAD }))
      }
      return twinAnswer(JSON.stringify({
        number: 7, headRefOid: SHIM_HEAD, baseRefOid: base, body: '', author: { login: 'alice' },
        isCrossRepository: false, comments: [], reviews: [],
      }))
    }
    if (file === 'gh' && args[0] === 'api' && args[1] === 'graphql') return twinAnswer(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: RESOLVED } } } }))
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'checks') return twinAnswer(JSON.stringify(PASSING))
    if (file === 'git') {
      const git = args.slice(2)
      if (git[0] === 'fetch') return twinAnswer('')
      if (git[0] === 'rev-parse' && git[1] === '--is-shallow-repository') return twinAnswer('false\n')
      if (git[0] === 'rev-parse' && git[1] === '--verify') return twinAnswer(`${git[3].replace('^{commit}', '')}\n`)
      if (git[0] === 'merge-base' && git[1] === '--is-ancestor') return twinAnswer('', git[3] === base ? 1 : 0)
    }
    misses.push([file, ...args].join(' '))
    return { status: 97, stdout: Buffer.alloc(0), stderr: Buffer.from('twin: unscripted\n') }
  }
  return { exec, calls, misses, checks }
}

function runInProcess(args: readonly string[], exec: (file: string, args: string[]) => TwinResult): { code: number; stdout: string; stderr: string } {
  let stderr = ''
  const out = VE.main(['node', 'verify-evidence.cjs', ...args], { exec, cwd: localDir(), stderr: (t: string) => { stderr += t } })
  return { ...out, stderr }
}

/** An in-process `readiness` run for PR 7 with `extra` flags appended: the shared head of every argv below. */
function runReadiness(extra: readonly string[], exec: (file: string, args: string[]) => TwinResult): { code: number; stdout: string; stderr: string } {
  return runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', ...extra], exec)
}

/** The gh calls of a twin that change the PR: `pr edit`, `pr comment` and the comment edit (`api --method`). */
function ghWrites(calls: readonly string[][]): string[][] {
  return calls.filter(c => c[0] === 'gh' && ((c[1] === 'pr' && (c[2] === 'edit' || c[2] === 'comment')) || (c[1] === 'api' && c[2] === '--method')))
}

/** The "not tracked" answer to the tracked-file check, for an exec whose every other call fails. */
function checkOr(file: string, args: string[], otherwise: () => TwinResult): TwinResult {
  const tracked = trackedCheckAnswer(file, args)
  return tracked === null ? otherwise() : { ...tracked, status: tracked.status ?? 97 }
}

/** An exec for which `gh` cannot find the PR. */
const unreadablePr = (file: string, args: string[]): TwinResult =>
  checkOr(file, args, () => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('no such pr\n') }))

/** An exec that fails after the tracked-file check: the run is an internal failure that the script survives. */
const explodingExec = (file: string, args: string[]): TwinResult =>
  checkOr(file, args, () => { throw new Error('exec exploded') })

describe('TP-14: readiness --evidence reads the plan and the claims from a local evidence file', () => {
  it('a file that has no plan and carries a test-plan exception is READY; the same PR without the file has no test-plan evidence', SPAWN_BUDGET, () => {
    const scenario = green({ comments: [] })
    expect(status(run(scenario))).toBe('NOT_READY (no test-plan evidence)')
    const r = run(scenario, 'false', ['--evidence', writeEvidence(evidenceText([], [], [LOCAL_EXCEPTION]))])
    expect(r.code, r.stderr).toBe(0)
    expect(status(r)).toBe('READY')
    expect(block(r).plan).toBe('0/0 (VERIFIED-CI 0, ATTESTED-LOCAL 0)')
    expect(r.writes).toEqual([])
  })

  it('a passing local claim in the file reaches READY: the plan and the claim are the file\'s, the PR body has neither', () => {
    const twin = greenTwin()
    const file = writeEvidence(evidenceText([LOCAL_TP], [LOCAL_CLAIM]))
    const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', file], twin.exec)
    expect(twin.misses, 'the script made a call the twin did not script').toEqual([])
    expect(r.code, r.stderr).toBe(0)
    const parsed = VE.parseReadinessBlock(r.stdout)
    expect(parsed).toMatchObject({ status: 'READY', plan: '1/1 (VERIFIED-CI 0, ATTESTED-LOCAL 1)', ci: 'PASSING', decision: 'APPROVED' })
    expect(twin.calls.filter(c => c[0] === 'gh' && ['edit', 'comment'].includes(c[2])), 'no gh write').toEqual([])
  })

  it('the same plan with no claim is not verified: the claim is what moves it', () => {
    const twin = greenTwin()
    const file = writeEvidence(evidenceText([LOCAL_TP]))
    const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', file], twin.exec)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'NOT_READY', reason: 'test plan: 0/1 verified', plan: '0/1 (VERIFIED-CI 0, ATTESTED-LOCAL 0)' })
  })

  it('the plan is the file\'s, whatever the PR body holds', SPAWN_BUDGET, () => {
    const body = `Adds it.\n\n${PE_BLOCK_START}\n## Test Plan\n- [ ] TP-1 (AC-1) Logs in ${EM} method:manual\n- [ ] TP-2 (AC-1) Logs out ${EM} method:manual\n${PE_BLOCK_END}\n`
    const scenario = green({ comments: [], body })
    expect(block(run(scenario, 'false')).plan).toBe('0/2 (VERIFIED-CI 0, ATTESTED-LOCAL 0)')
    const r = run(scenario, 'false', ['--evidence', writeEvidence(evidenceText([LOCAL_TP]))])
    expect(r.code, r.stderr).toBe(0)
    expect(block(r).plan).toBe('0/1 (VERIFIED-CI 0, ATTESTED-LOCAL 0)')
  })

  it('an evidence file that cannot be read leaves the test-plan evidence unavailable, never READY', SPAWN_BUDGET, () => {
    const missing = path.join(localDir(), 'absent.md')
    const r = run(green(), 'false', ['--evidence', missing])
    expect(r.code, r.stderr).toBe(0)
    expect(status(r)).toBe('NOT_READY (test-plan evidence unavailable)')
    expect(block(r).plan).toBe('unavailable')
    expect(r.writes).toEqual([])
  })
})

type FileState = 'committed' | 'staged' | 'untracked'

/** A real repository that holds each file in the given state: committed, only staged, or not added at all. */
function gitRepo(files: Readonly<Record<string, { text: string; state: FileState }>>): string {
  const dir = localDir()
  const home = localDir()
  realGit(dir, home, ['init', '-q'])
  const names = Object.keys(files)
  for (const name of names) fs.writeFileSync(path.join(dir, name), files[name].text)
  const committed = names.filter(n => files[n].state === 'committed')
  if (committed.length > 0) {
    realGit(dir, home, ['add', '--', ...committed])
    realGit(dir, home, ['commit', '-q', '-m', 'seed'])
  }
  const staged = names.filter(n => files[n].state === 'staged')
  if (staged.length > 0) realGit(dir, home, ['add', '--', ...staged])
  return dir
}

/** `twin.exec`, except that the tracked-file check gets `answer` instead of the real git's. */
function withCheckAnswer(twin: ReturnType<typeof greenTwin>, answer: unknown): (file: string, args: string[]) => TwinResult {
  return (file, args) => (args.includes('ls-files') ? (answer as TwinResult) : twin.exec(file, args))
}

describe('a git-tracked evidence file counts as absent, like a tracked config.json', () => {
  // With no plan and a test-plan exception, the file reads READY. Without it the PR has no evidence.
  const READY_FILE = evidenceText([], [], [LOCAL_EXCEPTION])
  const lineOne = (out: string): string => fs.readFileSync(out, 'utf8').split('\n')[0]

  it.each(['committed', 'staged'] as const)('a %s evidence file is not read: the plan is the PR\'s and the out file says source=pr', state => {
    const repo = gitRepo({ 'evidence.md': { text: READY_FILE, state } })
    const out = path.join(localDir(), 'readiness.txt')
    const twin = greenTwin(true)
    const r = runReadiness(['--evidence', path.join(repo, 'evidence.md'), '--out', out], twin.exec)
    expect(twin.misses, 'the script made a call the twin did not script').toEqual([])
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'NOT_READY', reason: 'no test-plan evidence' })
    expect(lineOne(out)).toBe(`READINESS pr:7 head:${SHIM_HEAD} status:NOT_READY source=pr`)
    expect(r.stderr).toContain('verify-evidence: notes: evidence-ignored')
    expect(twin.checks.length, 'git was asked').toBeGreaterThan(0)
  })

  it('control: the same file, not added to git, is read', () => {
    const repo = gitRepo({ 'evidence.md': { text: READY_FILE, state: 'untracked' } })
    const out = path.join(localDir(), 'readiness.txt')
    const r = runReadiness(['--evidence', path.join(repo, 'evidence.md'), '--out', out], greenTwin(true).exec)
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'READY' })
    expect(lineOne(out)).toBe(`READINESS pr:7 head:${SHIM_HEAD} status:READY source=local`)
    expect(r.stderr).not.toContain('evidence-ignored')
  })

  it('an untracked link to a tracked evidence file is not read either', () => {
    const repo = gitRepo({ 'evidence.md': { text: READY_FILE, state: 'committed' } })
    fs.symlinkSync(path.join(repo, 'evidence.md'), path.join(repo, 'alias.md'))
    const r = runReadiness(['--evidence', path.join(repo, 'alias.md')], greenTwin(true).exec)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'NOT_READY', reason: 'no test-plan evidence' })
  })

  const NO_ANSWER: ReadonlyArray<readonly [string, unknown]> = [
    ['git refuses the repository', { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('fatal: detected dubious ownership in repository at x\n') }],
    ['git exits 1', { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }],
    ['git cannot start', { status: null, error: { code: 'ENOENT' } }],
    ['git answers with a path (it tracks the file)', { status: 0, stdout: Buffer.from('evidence.md\0'), stderr: Buffer.alloc(0) }],
  ]

  it.each(NO_ANSWER)('no clear "not tracked" answer reads as absent: %s', (_label, answer) => {
    const file = writeEvidence(READY_FILE)
    const twin = greenTwin()
    const r = runReadiness(['--evidence', file], withCheckAnswer(twin, answer))
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'NOT_READY', reason: 'no test-plan evidence' })
  })

  it.each([
    ['git answers with nothing', { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }],
    ['the file is outside any repository', { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('fatal: not a git repository (or any of the parent directories): .git\n') }],
  ])('control: a clear "not tracked" answer reads the file: %s', (_label, answer) => {
    const file = writeEvidence(READY_FILE)
    const r = runReadiness(['--evidence', file], withCheckAnswer(greenTwin(), answer))
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'READY' })
  })
})

describe('a git-tracked out path is not written and not removed', () => {
  const PLANTED = 'READINESS pr:7 head:none status:READY source=pr\nplanted\n'

  it.each(['committed', 'staged'] as const)('a %s out path: exit 3, nothing on stdout, no read, the file keeps its text', state => {
    const repo = gitRepo({ 'readiness.md': { text: PLANTED, state } })
    const out = path.join(repo, 'readiness.md')
    const twin = greenTwin(true)
    const r = runReadiness(['--out', out], twin.exec)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('verify-evidence: an output file could not be written')
    expect(fs.readFileSync(out, 'utf8')).toBe(PLANTED)
    expect(twin.calls, 'no read was made').toEqual([])
  })

  it('control: an out path in the same repository that git does not track is written', () => {
    const repo = gitRepo({ 'seed.md': { text: 'seed\n', state: 'committed' } })
    const out = path.join(repo, 'readiness.md')
    const r = runReadiness(['--out', out], greenTwin(true).exec)
    expect(r.code, r.stderr).toBe(0)
    expect(fs.readFileSync(out, 'utf8').split('\n')[0]).toBe(`READINESS pr:7 head:${SHIM_HEAD} status:NOT_READY source=pr`)
  })

  it('an out path git cannot answer for is not written', () => {
    const out = path.join(localDir(), 'readiness.txt')
    const answer = { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('fatal: detected dubious ownership in repository at x\n') }
    const r = runReadiness(['--out', out], withCheckAnswer(greenTwin(), answer))
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(fs.existsSync(out)).toBe(false)
  })
})

// The out-file cases that depend only on files run in-process. Two of them spawn the real script to
// hold its process boundary: the READY run below and the missing-directory run in TP-16.
describe('TP-15: readiness --out writes the READINESS line, then the block', () => {
  const lineOf = (head: string, state: string, source: 'local' | 'pr' = 'pr'): string =>
    `READINESS pr:7 head:${head} status:${state} source=${source}\n`

  it('READY: line 1 names the PR, the 40-hex head, the status and the plan source, the rest is the block, and stdout and the calls are what they were without --out', SPAWN_BUDGET, () => {
    const out = path.join(localDir(), 'readiness.txt')
    const plain = run(green())
    const r = run(green(), 'false', ['--out', out])
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toBe(plain.stdout)
    expect(fs.readFileSync(out, 'utf8')).toBe(lineOf(SHIM_HEAD, 'READY') + r.stdout)
    expect(r.calls.map(c => c.args)).toEqual(plain.calls.map(c => c.args))
    expect(r.writes).toEqual([])
    expect(r.leftovers).toEqual([])
  })

  it('NOT_READY and DEGRADED carry their own status on line 1, and the block after it is the printed one', SPAWN_BUDGET, () => {
    const notReady = path.join(localDir(), 'not-ready.txt')
    const a = run(green({ reviewDecision: 'CHANGES_REQUESTED' }), 'false', ['--out', notReady])
    expect(a.code, a.stderr).toBe(0)
    expect(fs.readFileSync(notReady, 'utf8')).toBe(lineOf(SHIM_HEAD, 'NOT_READY') + a.stdout)
    const degraded = path.join(localDir(), 'degraded.txt')
    const b = run({ noPr: true }, 'false', ['--out', degraded])
    expect(b.code).toBe(2)
    expect(fs.readFileSync(degraded, 'utf8')).toBe(lineOf('none', 'DEGRADED') + b.stdout)
  })

  it('a threads read that fails is DEGRADED with the head the PR view already gave', SPAWN_BUDGET, () => {
    const out = path.join(localDir(), 'degraded.txt')
    const r = run(green({ threads: undefined }), 'false', ['--out', out])
    expect(r.code).toBe(2)
    expect(fs.readFileSync(out, 'utf8')).toBe(lineOf(SHIM_HEAD, 'DEGRADED') + r.stdout)
  })

  it('a head that is not 40 hex reads `none`', SPAWN_BUDGET, () => {
    const out = path.join(localDir(), 'readiness.txt')
    const r = run(green({ heads: ['not-a-head'] }), 'false', ['--out', out])
    expect(r.code, r.stderr).toBe(0)
    const text = fs.readFileSync(out, 'utf8')
    expect(text.split('\n')[0]).toBe('READINESS pr:7 head:none status:NOT_READY source=pr')
    expect(text.slice(text.indexOf('\n') + 1)).toBe(r.stdout)
  })

  it('line 1 ends with source=local when the plan comes from the --evidence file', () => {
    const file = writeEvidence(evidenceText([LOCAL_TP], [LOCAL_CLAIM]))
    const out = path.join(localDir(), 'readiness.txt')
    const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', file, '--out', out], greenTwin().exec)
    expect(r.code, r.stderr).toBe(0)
    const text = fs.readFileSync(out, 'utf8')
    expect(text.split('\n')[0]).toBe(`READINESS pr:7 head:${SHIM_HEAD} status:READY source=local`)
    expect(text).toBe(lineOf(SHIM_HEAD, 'READY', 'local') + r.stdout)
  })

  it('line 1 ends with source=pr when no --evidence file is given, whatever the status', () => {
    const out = path.join(localDir(), 'readiness.txt')
    const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--out', out], greenTwin().exec)
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'NOT_READY', reason: 'no test-plan evidence' })
    expect(fs.readFileSync(out, 'utf8').split('\n')[0]).toBe(`READINESS pr:7 head:${SHIM_HEAD} status:NOT_READY source=pr`)
  })

  it('line 1 names the requested plan source on every status: an unreadable evidence file, an unreadable PR and an internal failure read source=local when --evidence is given', () => {
    const file = writeEvidence(evidenceText([LOCAL_TP], [LOCAL_CLAIM]))
    const missing = path.join(localDir(), 'absent.md')
    const exploding = explodingExec
    const cases = [
      { label: 'an unreadable evidence file', evidence: missing, exec: greenTwin().exec, state: 'NOT_READY', head: SHIM_HEAD },
      { label: 'an unreadable PR', evidence: file, exec: unreadablePr, state: 'DEGRADED', head: 'none' },
      { label: 'an internal failure', evidence: file, exec: exploding, state: 'DEGRADED', head: 'none' },
    ]
    for (const c of cases) {
      const out = path.join(localDir(), 'readiness.txt')
      runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', c.evidence, '--out', out], c.exec)
      expect(fs.readFileSync(out, 'utf8').split('\n')[0], c.label).toBe(`READINESS pr:7 head:${c.head} status:${c.state} source=local`)
    }
  })

  it('the writer takes the two sources and no other: any other value is the output-gate refusal and leaves no file', () => {
    const block = VE.renderReadinessBlock({
      pr: 7, status: 'READY', reason: null, threads: '0', decision: 'APPROVED', ci: 'PASSING',
      plan: '0/0 (VERIFIED-CI 0, ATTESTED-LOCAL 0)', approval: 'not required',
    })
    const outcome = { code: 0, stdout: block }
    for (const source of ['local', 'pr']) {
      const out = path.join(localDir(), 'readiness.txt')
      expect(VE.writeReadinessOut({ stderr: () => {} }, out, 7, outcome, SHIM_HEAD, source)).toEqual(outcome)
      expect(fs.readFileSync(out, 'utf8')).toBe(lineOf(SHIM_HEAD, 'READY', source as 'local' | 'pr') + block)
    }
    for (const source of ['', 'Local', 'remote', 'pr extra', 'local\nREADY', undefined]) {
      const out = path.join(localDir(), 'readiness.txt')
      fs.writeFileSync(out, lineOf(SHIM_HEAD, 'READY'))
      expect(VE.writeReadinessOut({ stderr: () => {} }, out, 7, outcome, SHIM_HEAD, source), String(source)).toEqual({ code: 5, stdout: '' })
      expect(fs.existsSync(out), String(source)).toBe(false)
    }
  })

  it('an existing regular file is replaced whole', () => {
    const out = path.join(localDir(), 'readiness.txt')
    fs.writeFileSync(out, `${'old line\n'.repeat(400)}`)
    const file = writeEvidence(evidenceText([LOCAL_TP], [LOCAL_CLAIM]))
    const r = runReadiness(['--evidence', file, '--out', out], greenTwin().exec)
    expect(r.code, r.stderr).toBe(0)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'READY' })
    expect(fs.readFileSync(out, 'utf8')).toBe(lineOf(SHIM_HEAD, 'READY', 'local') + r.stdout)
  })

  it('a symlinked out path is refused and never followed: exit 3, no block, the target untouched', () => {
    const dir = localDir()
    const target = path.join(dir, 'target.txt')
    fs.writeFileSync(target, 'keep\n')
    const link = path.join(dir, 'link.txt')
    fs.symlinkSync(target, link)
    const twin = greenTwin()
    const r = runReadiness(['--out', link], twin.exec)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('output file could not be written')
    expect(fs.readFileSync(target, 'utf8')).toBe('keep\n')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(ghWrites(twin.calls)).toEqual([])
  })

  it('a dangling symlink is refused too: the file it names is never created', () => {
    const dir = localDir()
    const target = path.join(dir, 'never.txt')
    const link = path.join(dir, 'dangling.txt')
    fs.symlinkSync(target, link)
    const r = runReadiness(['--out', link], greenTwin().exec)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(fs.existsSync(target)).toBe(false)
  })

  it('--out and --evidence naming one path is a usage error that makes no call', () => {
    const file = writeEvidence(evidenceText([LOCAL_TP]))
    const twin = greenTwin()
    const r = runReadiness(['--evidence', file, '--out', file], twin.exec)
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('')
    expect(twin.calls).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(evidenceText([LOCAL_TP]))
  })

  it('one path spelled two ways is the same usage error: the evidence file is never replaced', () => {
    const file = writeEvidence(evidenceText([LOCAL_TP]))
    const twin = greenTwin()
    const aliases = [path.relative(process.cwd(), file), [path.dirname(file), '.', path.basename(file)].join(path.sep)]
    for (const alias of aliases) {
      expect(alias, 'the alias must be spelled differently, or the case is the one above').not.toBe(file)
      const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', file, '--out', alias], twin.exec)
      expect(r.code, alias).toBe(1)
      expect(r.stdout).toBe('')
    }
    expect(twin.calls, 'a usage error makes no call').toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(evidenceText([LOCAL_TP]))
  })

  it('a second name of the evidence file, a hard link or a symlink, is the same usage error in either position: the evidence file is never replaced', () => {
    const file = writeEvidence(evidenceText([LOCAL_TP]))
    const hard = path.join(path.dirname(file), 'hard.md')
    const soft = path.join(path.dirname(file), 'soft.md')
    fs.linkSync(file, hard)
    fs.symlinkSync(file, soft)
    const twin = greenTwin()
    const pairs = [[file, hard], [hard, file], [file, soft], [soft, file]]
    for (const [evidence, out] of pairs) {
      const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', evidence, '--out', out], twin.exec)
      expect(r.code, `${evidence} ${out}`).toBe(1)
      expect(r.stdout).toBe('')
    }
    expect(twin.calls, 'a usage error makes no call').toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(evidenceText([LOCAL_TP]))
  })

  it('an out file that does not exist yet beside an evidence file is not a clash', () => {
    const file = writeEvidence(evidenceText([LOCAL_TP], [LOCAL_CLAIM]))
    const out = path.join(path.dirname(file), 'fresh.txt')
    const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--evidence', file, '--out', out], greenTwin().exec)
    expect(r.code, r.stderr).toBe(0)
    expect(fs.existsSync(out)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe(evidenceText([LOCAL_TP], [LOCAL_CLAIM]))
  })

  it('a flag missing its value, or given twice, is a usage error', () => {
    for (const extra of [['--out'], ['--evidence'], ['--out', 'a.txt', '--out', 'b.txt'], ['--evidence', 'a.md', '--evidence', 'b.md']]) {
      const twin = greenTwin()
      const r = runReadiness(extra, twin.exec)
      expect(r.code, extra.join(' ')).toBe(1)
      expect(r.stdout).toBe('')
      expect(twin.calls).toEqual([])
    }
  })

  it('an internal failure still leaves a DEGRADED line behind, so an old READY file cannot outlive the run', () => {
    const out = path.join(localDir(), 'readiness.txt')
    fs.writeFileSync(out, lineOf(SHIM_HEAD, 'READY'))
    const r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--out', out], explodingExec)
    expect(r.code).toBe(2)
    expect(VE.parseReadinessBlock(r.stdout)).toMatchObject({ status: 'DEGRADED', reason: 'internal error' })
    expect(fs.readFileSync(out, 'utf8')).toBe(lineOf('none', 'DEGRADED') + r.stdout)
  })

  it('an out file from an earlier run is removed before the first read, so a run that stops partway leaves none', () => {
    const out = path.join(localDir(), 'readiness.txt')
    fs.writeFileSync(out, lineOf(SHIM_HEAD, 'READY'))
    const twin = greenTwin()
    const present: boolean[] = []
    runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--out', out], (file, args) => {
      // The tracked-file check on the out path comes first, by design: it decides whether the file may be removed.
      if (!args.includes('ls-files')) present.push(fs.existsSync(out))
      return twin.exec(file, args)
    })
    expect(present.length, 'the run read the PR').toBeGreaterThan(0)
    expect(present.filter(Boolean), 'the earlier file was still there at a read').toEqual([])
  })

  it('a block that does not parse is the output-gate refusal and leaves no out file', () => {
    const out = path.join(localDir(), 'readiness.txt')
    fs.writeFileSync(out, lineOf(SHIM_HEAD, 'READY'))
    let stderr = ''
    const r = VE.writeReadinessOut({ stderr: t => { stderr += t } }, out, 7, { code: 0, stdout: 'not a readiness block\n' }, SHIM_HEAD, 'pr')
    expect(r).toEqual({ code: 5, stdout: '' })
    expect(stderr).toContain('verify-evidence: ')
    expect(fs.existsSync(out)).toBe(false)
  })

  it('an out path that is not a regular file is left alone: a FIFO is refused, never opened or removed', () => {
    const dir = localDir()
    const out = path.join(dir, 'readiness.fifo')
    if (!makeFifo(out, dir)) return
    const r =runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--out', out], greenTwin().exec)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(fs.lstatSync(out).isFIFO()).toBe(true)
  })
})

describe('TP-16: an out file that cannot be written prints no block and exits non-zero', () => {
  it('a missing directory: exit 3, stdout empty, a closed reason on stderr, no file', SPAWN_BUDGET, () => {
    const out = path.join(localDir(), 'no-such-dir', 'readiness.txt')
    const r = run(green(), 'false', ['--out', out])
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('verify-evidence: an output file could not be written')
    expect(fs.existsSync(out)).toBe(false)
    expect(r.writes).toEqual([])
  })

  it('a directory in the out file\'s place: exit 3, stdout empty', () => {
    const out = localDir()
    const r = runReadiness(['--out', out], greenTwin().exec)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
  })

  it('a DEGRADED answer is held to the same rule: no block when its out file fails', () => {
    const out = path.join(localDir(), 'no-such-dir', 'readiness.txt')
    const r = runReadiness(['--out', out], unreadablePr)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
  })

  it('an internal failure with an unwritable out file prints no block either', () => {
    const out = path.join(localDir(), 'no-such-dir', 'readiness.txt')
    const r = runInProcess(['readiness', '--pr', '7', '--out', out], explodingExec)
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
  })

  it('a write that fails partway leaves no out file, on a decided answer and on an internal failure alike', () => {
    for (const [label, exec] of [['a decided answer', greenTwin().exec], ['an internal failure', explodingExec]] as const) {
      const out = path.join(localDir(), 'readiness.txt')
      fs.writeFileSync(out, 'READINESS pr:7 head:none status:READY source=pr\n')
      const write = nodeFs.writeFileSync
      const spy = vi.spyOn(nodeFs, 'writeFileSync').mockImplementation(((target: number) => {
        write(target, 'READINESS pr:7 head:none status:READY source=pr\n')
        throw Object.assign(new Error('disk failure'), { code: 'EIO' })
      }) as typeof nodeFs.writeFileSync)
      let r: ReturnType<typeof runInProcess>
      try {
        r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--out', out], exec)
      } finally {
        spy.mockRestore()
      }
      expect(r.code, label).toBe(3)
      expect(r.stdout, label).toBe('')
      expect(fs.existsSync(out), `${label}: no file may be left`).toBe(false)
    }
  })

  it('an earlier out file that cannot be removed is a write failure before any read', () => {
    const out = path.join(localDir(), 'readiness.txt')
    fs.writeFileSync(out, 'READINESS pr:7 head:none status:READY source=pr\n')
    const twin = greenTwin()
    const spy = vi.spyOn(nodeFs, 'unlinkSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    let r: ReturnType<typeof runInProcess>
    try {
      r = runInProcess(['readiness', '--pr', '7', '--require-non-author-approval', 'false', '--out', out], twin.exec)
    } finally {
      spy.mockRestore()
    }
    expect(r.code).toBe(3)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('verify-evidence: an output file could not be written')
    expect(twin.calls, 'no read was made').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Contract parity — the Output template and the script print the same block
// ---------------------------------------------------------------------------

function contractSection(): string {
  return extractOpSectionFromCorpus(gitOperationReferenceCorpus(), OP, { mode: 'sole' }).content
}

function requireReference(): string {
  const file = path.join(compiledSkillRefsDir(), ...prHostRel(OP).split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${prHostRel(OP)} is absent — run \`npm run build\` first (this suite reads the built reference)`)
  }
}

/** The Output template's fenced lines: from `## Merge Readiness` to the closing fence. */
function outputTemplate(section: string): string[] {
  const lines = section.split('\n')
  const at = lines.indexOf('## Merge Readiness')
  if (at === -1) return []
  const end = lines.indexOf('```', at)
  return lines.slice(at, end === -1 ? undefined : end)
}

/** The fixed text each template line starts with, up to its first placeholder. */
function linePrefix(line: string): string {
  const open = line.indexOf('{')
  return open === -1 ? line : line.slice(0, open)
}

const READY_BLOCK: ReadinessBlock = {
  pr: 7, status: 'READY', reason: null, threads: '0', decision: 'APPROVED', ci: 'PASSING',
  plan: '3/3 (VERIFIED-CI 2, ATTESTED-LOCAL 1)', approval: 'yes',
}

/** Named collector: where the script's block and the contract's Output template part. */
export function collectParityDefects(template: readonly string[], rendered: readonly string[]): string[] {
  const out: string[] = []
  if (template.length !== rendered.length) out.push(`the template has ${template.length} lines, the script prints ${rendered.length}`)
  template.forEach((line, i) => {
    // The Status line is the one line whose alternatives come before any placeholder.
    const want = line.startsWith('**Status**:') ? '**Status**: ' : linePrefix(line)
    const got = rendered[i] ?? ''
    if (!got.startsWith(want)) out.push(`line ${i + 1}: the script prints ${JSON.stringify(got.slice(0, 40))}, the template starts ${JSON.stringify(want)}`)
  })
  const statusLine = template.find(l => l.startsWith('**Status**:')) ?? ''
  for (const printed of ['READY', 'NOT_READY (', 'DEGRADED (']) {
    if (!statusLine.includes(printed.replace(' (', ''))) out.push(`the Status line does not list ${printed}`)
  }
  const planLine = template.find(l => l.startsWith('- Test plan:')) ?? ''
  for (const approval of ['yes', 'no', 'not required']) {
    if (!planLine.includes(approval)) out.push(`the Test plan line does not list the approval value "${approval}"`)
  }
  if (!planLine.includes('unavailable')) out.push('the Test plan line does not list "unavailable"')
  return out
}

describe('contract parity: the script prints the Output template, line for line', () => {
  const template = outputTemplate(contractSection())
  const rendered = VE.renderReadinessBlock(READY_BLOCK).split('\n').slice(0, -1)

  it('reads a real template: nine lines, a heading first', () => {
    expect(template.length, 'no Output template parsed').toBe(9)
    expect(template[0]).toBe('## Merge Readiness')
  })

  it('has no defect', () => {
    expect(collectParityDefects(template, rendered)).toEqual([])
  })

  it('the DEGRADED form is the same block plus one TRACEABILITY line', () => {
    const degraded = VE.renderReadinessBlock({ ...READY_BLOCK, status: 'DEGRADED', reason: 'no pr', threads: 'unavailable', decision: 'unavailable', ci: 'unavailable', plan: 'unavailable' })
    expect(degraded.split('\n').slice(0, 9)).toHaveLength(9)
    expect(collectParityDefects(template, degraded.split('\n').slice(0, 9))).toEqual([])
    expect(degraded.trimEnd().split('\n').pop()).toBe('TRACEABILITY: DEGRADED (no pr)')
  })

  it('known-bad probes: a reordered line, a dropped line and a renamed detail are each reported', () => {
    const swapped = [...template]
    ;[swapped[5], swapped[6]] = [swapped[6], swapped[5]]
    expect(collectParityDefects(swapped, rendered).length).toBeGreaterThan(0)
    expect(collectParityDefects(template.slice(0, -1), rendered)).toContain('the template has 8 lines, the script prints 9')
    const renamed = template.map(l => l.replace('- CI status:', '- CI state:'))
    expect(collectParityDefects(renamed, rendered)).toEqual(['line 8: the script prints "- CI status: PASSING", the template starts "- CI state: "'])
    const narrowed = template.map(l => l.replace(' | unavailable', '').replace('not required', 'n/a'))
    expect(collectParityDefects(narrowed, rendered)).toEqual([
      'the Test plan line does not list the approval value "not required"',
      'the Test plan line does not list "unavailable"',
    ])
  })
})

describe('the reference points at the script and keeps its specification', () => {
  const reference = requireReference()

  it('runs the script once, prints its stdout, and leaves the steps to it', () => {
    expect(reference).toContain('verify-evidence.cjs" readiness --pr {PR_NUMBER}')
    expect(reference.split('verify-evidence.cjs" readiness').length - 1, 'one readiness run').toBe(1)
    expect(reference).toContain('run none of them yourself')
    expect(reference).toContain('`TRACEABILITY: DEGRADED (readiness unavailable)`')
    expect(reference).toContain('Never take action on the PR')
  })

  it('known-bad probe: a reference that no longer says the script decides is reported', () => {
    const seeded = reference.replace('run none of them yourself', 'run them')
    expect(seeded, 'the seed must land').not.toBe(reference)
    expect(seeded).not.toContain('run none of them yourself')
  })
})

describe('the boundary prints a readiness block only when it parses back to itself (D-OP-BLOCK-GATE)', () => {
  const good = VE.renderReadinessBlock(READY_BLOCK)
  const notReady = VE.renderReadinessBlock({ ...READY_BLOCK, status: 'NOT_READY', reason: 'CI failing: unit,+2', ci: 'FAILING' })

  it('accepts rendered blocks and refuses tampered ones', () => {
    expect(VE.settleOutcome({ code: 0, stdout: good })).toEqual({ code: 0, stdout: good })
    expect(VE.settleOutcome({ code: 0, stdout: notReady })).toEqual({ code: 0, stdout: notReady })
    const refused = { code: 4, stdout: '' }
    for (const bad of [
      good.replace('READY', 'Ready'),
      good.replace('- CI status: PASSING', '- CI status: GREEN'),
      good.replace('**PR**: #7', '**PR**: #07'),
      notReady.replace('CI failing: unit,+2', 'CI failing: `id`'),
      notReady.replace('NOT_READY (CI failing: unit,+2)', 'NOT_READY ()'),
      `${good}extra\n`,
      good.slice(0, -1),
      good.replace('### Details', '### Detail'),
    ]) {
      expect(VE.settleOutcome({ code: 0, stdout: bad }), JSON.stringify(bad)).toEqual(refused)
    }
  })

  it('a DEGRADED block goes with exit 2 and a decided one with exit 0, never the other way', () => {
    const degraded = VE.renderReadinessBlock({ ...READY_BLOCK, status: 'DEGRADED', reason: 'no pr', threads: 'unavailable', decision: 'unavailable', ci: 'unavailable', plan: 'unavailable' })
    expect(VE.settleOutcome({ code: 2, stdout: degraded })).toEqual({ code: 2, stdout: degraded })
    expect(VE.settleOutcome({ code: 0, stdout: degraded })).toEqual({ code: 4, stdout: '' })
    expect(VE.settleOutcome({ code: 2, stdout: good })).toEqual({ code: 4, stdout: '' })
    expect(fs.existsSync(VERIFY_EVIDENCE_SCRIPT)).toBe(true)
  })
})
