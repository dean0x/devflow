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

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { extractOpSectionFromCorpus, gitOperationReferenceCorpus, prHostRel } from '../helpers.js'
import { cleanShimRoots, runScript, SHIM_HEAD, warmGhShim, type ScriptRun, type ShimScenario } from './pr-shim.js'
import { PR_EVIDENCE_SCRIPT, SUBPROCESS_TIMEOUT_MS, VERIFY_EVIDENCE_SCRIPT } from './seam.js'

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
}
interface EvidenceApi {
  exception(line: string): { ok: boolean; value?: unknown }
  render(plan: { tps: readonly unknown[] }, ev: object, mode: string): { ok: boolean; value: { text: string } }
}

const req = createRequire(import.meta.url)
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
const PASSING = [{ name: 'unit', state: 'SUCCESS', bucket: 'pass' }, { name: 'lint', state: 'SUCCESS', bucket: 'pass' }]
const RESOLVED = { totalCount: 2, nodes: [{ isResolved: true }, { isResolved: true }] }

/** Everything green, so each scenario spoils exactly one thing. */
function green(over: ShimScenario = {}): ShimScenario {
  return { reviewDecision: 'APPROVED', checks: PASSING, threads: RESOLVED, comments: [RECORD_COMMENT], ...over }
}

function run(scenario: ShimScenario, require: 'true' | 'false' | null = 'false', extra: readonly string[] = []): ScriptRun {
  const args = ['readiness', '--pr', '7', ...(require === null ? [] : ['--require-non-author-approval', require]), ...extra]
  return runScript({ scenario, args })[0]
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
    expect(status(run(green({ reviewDecision: null })))).toBe('NOT_READY (no approving review)')
    expect(block(run(green({ reviewDecision: null }))).decision).toBe('none')
    const odd = run(green({ reviewDecision: 'SOMETHING_NEW' }))
    expect(status(odd)).toBe('NOT_READY (status unknown)')
    expect(block(odd).decision).toBe('unrecognised')
  })

  it('5. CI: failing names the checks, pending is its own arm, no checks reported is NO_CI and can be READY', SPAWN_BUDGET, () => {
    const failing = run(green({ checks: [...PASSING, { name: 'e2e (linux)', state: 'FAILURE', bucket: 'fail' }] }))
    expect(status(failing)).toBe('NOT_READY (CI failing: e2e (linux))')
    expect(block(failing).ci).toBe('FAILING')
    const pending = run(green({ checks: [...PASSING, { name: 'e2e', state: 'PENDING', bucket: 'pending' }], checksExit: 8 }))
    expect(pending.code, pending.stderr).toBe(0)
    expect(status(pending)).toBe('NOT_READY (CI pending)')
    const none = run(green({ checks: undefined }))
    expect(block(none).ci).toBe('NO_CI')
    expect(status(none)).toBe('READY')
    const unrecognised = run(green({ checks: [...PASSING, { name: 'odd', state: 'X', bucket: 'neutral' }] }))
    expect(block(unrecognised).ci).toBe('INDETERMINATE')
    expect(status(unrecognised)).toBe('NOT_READY (status unknown)')
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

const PE_BLOCK_START = '<!-- devflow:test-plan -->'
const PE_BLOCK_END = '<!-- /devflow:test-plan -->'

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
