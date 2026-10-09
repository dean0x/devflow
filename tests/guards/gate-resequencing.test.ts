/**
 * Gate-resequencing guards (#421, t04): the pieces of the gate rework that no
 * single command suite owns.
 *
 *   D-SCRUTINIZE-STATUS      Scrutinize reports `PASS | FIXED | BLOCKED` and every
 *                            file that states or reads the status uses that word set:
 *                            its own Output, the quality-gates skill and report
 *                            template, /implement Phase 4, /self-review Phase 2 and
 *                            both dynamic-build Gate 1 passes. READY is not a status
 *                            of Scrutinize or quality-gates, and no Scrutinize output
 *                            lists Naming or Consistency as PASS or FIXED: those two
 *                            belong to Simplify and are reported as SKIP.
 *   D-GATE-DUTY-OWNERSHIP    Each duty that Evaluate, Scrutinize and Simplify once
 *                            repeated has one owner: stub and wiring detection and the
 *                            FEATURE_KNOWLEDGE pattern judgment belong to Scrutinize;
 *                            the naming and consistency standard belongs to Simplify.
 *   D-VALIDATE-ONCE          /self-review records HEAD_BEFORE before Simplify and runs
 *                            a changed-only Validate whenever HEAD moved, so a
 *                            Simplify-only commit is validated too.
 *   D-CI-WAIT-INLINE         /resolve no longer claims one push path: its CI gate pushes
 *                            with its own command, and its test-plan refresh and its
 *                            Report cover any successful push of the run.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad probe
 * run through the same collector. The absence guards (no READY, no stub judgment in
 * Evaluate, no single-push claim) pass vacuously on missing text, so each probe seeds the
 * defect and each test asserts the corpus it read.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, requireDistFile, resolveAgentSource } from '../helpers.js'

const skill = (rel: string): string => readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'quality-gates', rel), 'utf-8')

// ---------------------------------------------------------------------------
// D-SCRUTINIZE-STATUS
// ---------------------------------------------------------------------------

interface StatusFiles {
  readonly scrutinize: string
  readonly skillMd: string
  readonly template: string
  readonly implement: string
  readonly selfReview: string
  readonly dynamicBuild: string
}

function statusFiles(): StatusFiles {
  return {
    scrutinize: resolveAgentSource('scrutinize').content,
    skillMd: skill('SKILL.md'),
    template: skill(path.join('references', 'report-template.md')),
    implement: requireDistFile('implement.md'),
    selfReview: requireDistFile('self-review.md'),
    dynamicBuild: requireDistFile('dynamic-build.md'),
  }
}

/** Naming or Consistency rendered as a PASS or FIXED verdict, in a bullet or a table row. */
const SIMPLIFY_PILLAR_AS_VERDICT = /^\s*(?:[-*]\s*(?:Naming|Consistency):|\|\s*(?:Naming|Consistency)\s*\|)[^\n]*\b(?:PASS|FIXED)\b/m

/**
 * Named collector: where the three-word status is missing from a file that states or
 * reads it, where READY is still a status, and where Scrutinize still grades a pillar
 * Simplify owns.
 */
function collectStatusDefects(f: StatusFiles): string[] {
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('scrutinize.md: Output does not declare `### Status: PASS | FIXED | BLOCKED`', f.scrutinize.includes('### Status: PASS | FIXED | BLOCKED'))
  need('scrutinize.md: the workflow return is not pinned', f.scrutinize.includes('{"status": "PASS" | "FIXED" | "BLOCKED"}'))
  need('scrutinize.md: the exempt fields are not the Status line and the status return field', /Exempt, inline in full: the `### Status` line and the `status` return field/.test(f.scrutinize))
  need('scrutinize.md: the three statuses are not defined', /PASS when no change was needed, FIXED when you committed fixes and every P0 and P1 is fixed, and BLOCKED when a P0 cannot be fixed in scope/.test(f.scrutinize))
  need('quality-gates SKILL.md: the overall status is not PASS / FIXED / BLOCKED', f.skillMd.includes('Status: PASS / FIXED / BLOCKED'))
  need('report-template.md: the overall status is not PASS / FIXED / BLOCKED', f.template.includes('**Status**: PASS / FIXED / BLOCKED'))
  const definitions = f.template.slice(f.template.indexOf('## Status Definitions'), f.template.indexOf('## Report Checklist'))
  for (const status of ['PASS', 'FIXED', 'BLOCKED']) {
    need(`report-template.md: the Status Definitions table has no overall meaning for ${status}`, new RegExp(`^\\| ${status} \\|[^|]*\\|[^|]*\\S[^|]*\\|$`, 'm').test(definitions))
  }
  need('/implement Phase 4 does not read PASS | FIXED | BLOCKED', /Scrutinize agent reports `### Status: PASS \| FIXED \| BLOCKED`/.test(f.implement))
  need('/self-review does not read STATUS (PASS|FIXED|BLOCKED)', f.selfReview.includes('Extract: STATUS (PASS|FIXED|BLOCKED)'))
  need('dynamic-build does not pin the Scrutinize return in both passes', f.dynamicBuild.split('Return: {"status": "PASS" | "FIXED" | "BLOCKED"}').length - 1 === 2)
  for (const [name, text] of [['scrutinize.md', f.scrutinize], ['quality-gates SKILL.md', f.skillMd], ['report-template.md', f.template]] as const) {
    if (/\bREADY\b/.test(text)) out.push(`${name}: READY is still a status`)
    if (SIMPLIFY_PILLAR_AS_VERDICT.test(text)) out.push(`${name}: Naming or Consistency is graded PASS or FIXED`)
  }
  return out
}

describe('D-SCRUTINIZE-STATUS (#421 AC-23/24): one status vocabulary across the six files', () => {
  it('every file states or reads PASS | FIXED | BLOCKED, READY is gone, and Naming and Consistency are SKIP', () => {
    const f = statusFiles()
    for (const [name, text] of Object.entries(f)) expect(text.length, `${name}: nothing read`).toBeGreaterThan(500)
    expect(collectStatusDefects(f)).toEqual([])
  })

  it('known-bad probes: READY restored, a lost FIXED, a graded Naming row and a lost pin are each reported', () => {
    const f = statusFiles()
    expect(collectStatusDefects({ ...f, skillMd: f.skillMd.replace('Status: PASS / FIXED / BLOCKED', 'Status: READY / BLOCKED') })).toEqual([
      'quality-gates SKILL.md: the overall status is not PASS / FIXED / BLOCKED',
      'quality-gates SKILL.md: READY is still a status',
    ])
    expect(collectStatusDefects({ ...f, scrutinize: f.scrutinize.replace('### Status: PASS | FIXED | BLOCKED', '### Status: PASS | BLOCKED') })).toEqual([
      'scrutinize.md: Output does not declare `### Status: PASS | FIXED | BLOCKED`',
    ])
    expect(collectStatusDefects({ ...f, template: f.template.replace('| Naming | SKIP | Simplify agent |', '| Naming | PASS | Clear names |') })).toEqual([
      'report-template.md: Naming or Consistency is graded PASS or FIXED',
    ])
    expect(collectStatusDefects({ ...f, scrutinize: f.scrutinize.replace('- Naming: SKIP (Simplify agent)', '- Naming: PASS | FIXED (description)') })).toEqual([
      'scrutinize.md: Naming or Consistency is graded PASS or FIXED',
    ])
    expect(collectStatusDefects({ ...f, dynamicBuild: f.dynamicBuild.replace('Return: {"status": "PASS" | "FIXED" | "BLOCKED"}', 'Report any code you changed.') })).toEqual([
      'dynamic-build does not pin the Scrutinize return in both passes',
    ])
    expect(collectStatusDefects({ ...f, template: f.template.replace('| FIXED | Issue found and resolved | Fixes were committed and every P0 and P1 is fixed |', '| FIXED | Issue found and resolved | |') })).toEqual([
      'report-template.md: the Status Definitions table has no overall meaning for FIXED',
    ])
  })
})

// ---------------------------------------------------------------------------
// D-GATE-DUTY-OWNERSHIP
// ---------------------------------------------------------------------------

type Body = 'scrutinize' | 'evaluate' | 'simplify'

/** One duty: the phrases that state it, and the one body that may hold them. */
const DUTIES: ReadonlyArray<{ readonly label: string; readonly owner: Body; readonly phrase: RegExp }> = [
  { label: 'stub and wiring detection', owner: 'scrutinize', phrase: /\bstubs?\b|\bwir(?:ed|ing)\b|Artifact Depth/i },
  { label: 'FEATURE_KNOWLEDGE pattern and anti-pattern judgment', owner: 'scrutinize', phrase: /anti-patterns?\b/i },
  { label: 'the naming and consistency standard', owner: 'simplify', phrase: /consistent naming conventions/i },
]

/** Named collector: a duty phrase held by a body that does not own it, or by no body at all. */
function collectDutyOwnershipDefects(bodies: Readonly<Record<Body, string>>): string[] {
  const out: string[] = []
  for (const duty of DUTIES) {
    const holders = (Object.keys(bodies) as Body[]).filter(b => duty.phrase.test(bodies[b]))
    if (holders.length === 0) out.push(`${duty.label}: no body states it`)
    else if (holders.length !== 1 || holders[0] !== duty.owner) out.push(`${duty.label}: held by ${holders.join(', ')}, owned by ${duty.owner}`)
  }
  if (/before handoff to Simplify agent/.test(bodies.scrutinize)) out.push('scrutinize.md still says it hands off to Simplify')
  return out
}

const dutyBodies = (): Record<Body, string> => ({
  scrutinize: resolveAgentSource('scrutinize').content,
  evaluate: resolveAgentSource('evaluate').content,
  simplify: resolveAgentSource('simplify').content,
})

describe('D-GATE-DUTY-OWNERSHIP (#421 AC-25): each duty has one owner among Scrutinize, Evaluate and Simplify', () => {
  it('stubs and wiring and pattern judgment are Scrutinize\'s alone; the naming standard is Simplify\'s alone', () => {
    const bodies = dutyBodies()
    for (const [name, text] of Object.entries(bodies)) expect(text.length, `${name}: nothing read`).toBeGreaterThan(500)
    expect(collectDutyOwnershipDefects(bodies)).toEqual([])
  })

  it('Evaluate lost its Artifact Depth step and table, its Wired boundary and its stub misalignment line', () => {
    const evaluate = dutyBodies().evaluate
    for (const gone of ['Artifact Depth', 'Wired', '| stub |', 'Stubs or placeholders', 'incomplete` ', 'Exists | Substantive']) expect(evaluate, gone).not.toContain(gone)
    expect(evaluate).toContain('| incomplete |')
  })

  it('known-bad probes: a stub judgment re-added to Evaluate, a lost owner and a restored hand-off are each reported', () => {
    const bodies = dutyBodies()
    const stubbed = bodies.evaluate.replace('| intent_drift |', '| stub | {placeholder, not real logic} | {file paths} | {what real implementation needs} |\n| intent_drift |')
    expect(stubbed, 'the seed must land').not.toBe(bodies.evaluate)
    expect(collectDutyOwnershipDefects({ ...bodies, evaluate: stubbed })).toEqual(['stub and wiring detection: held by scrutinize, evaluate, owned by scrutinize'])
    const patterned = bodies.evaluate.replace('Check completeness', 'Check the code against documented anti-patterns and completeness')
    expect(collectDutyOwnershipDefects({ ...bodies, evaluate: patterned })).toEqual(['FEATURE_KNOWLEDGE pattern and anti-pattern judgment: held by scrutinize, evaluate, owned by scrutinize'])
    const orphan = bodies.scrutinize.replace('**Detect stubs and wiring gaps**', '**Detect gaps**').replace('See `references/stub-detection.md` for patterns. ', '').replace('placeholder implementations', 'placeholders').replace('not wired into the running app', 'not connected')
    expect(collectDutyOwnershipDefects({ ...bodies, scrutinize: orphan })).toEqual(['stub and wiring detection: no body states it'])
    expect(collectDutyOwnershipDefects({ ...bodies, scrutinize: `${bodies.scrutinize}\nfix issues before handoff to Simplify agent` })).toEqual(['scrutinize.md still says it hands off to Simplify'])
  })
})

// ---------------------------------------------------------------------------
// D-VALIDATE-ONCE — /self-review
// ---------------------------------------------------------------------------

/** What one /self-review run committed, and whether its Phase 3 runs. */
interface SelfReviewCase {
  readonly label: string
  readonly simplifyCommitted: boolean
  readonly scrutinize: 'PASS' | 'FIXED'
  readonly scrutinizeCommitted: boolean
}

const SELF_REVIEW_CASES: readonly SelfReviewCase[] = [
  { label: 'Simplify committed, Scrutinize PASS', simplifyCommitted: true, scrutinize: 'PASS', scrutinizeCommitted: false },
  { label: 'Scrutinize FIXED, Simplify clean', simplifyCommitted: false, scrutinize: 'FIXED', scrutinizeCommitted: true },
  { label: 'both committed', simplifyCommitted: true, scrutinize: 'FIXED', scrutinizeCommitted: true },
  { label: 'nothing committed', simplifyCommitted: false, scrutinize: 'PASS', scrutinizeCommitted: false },
]

/** Phase 3's own text: from its heading to the report phase. */
function selfReviewPhase3(md: string): string | null {
  const at = md.indexOf('### Phase 3: Conditional Validation')
  const end = md.indexOf('### Phase 4: Report')
  return at === -1 || end === -1 ? null : md.slice(at, end)
}

/**
 * The trigger Phase 3 states, read as a predicate over a run: keyed on HEAD having
 * moved, or (before #421) on Scrutinize's FIXED status; null when it states neither.
 */
function phase3Triggers(phase3: string, c: SelfReviewCase): boolean | null {
  if (/only if HEAD moved/.test(phase3) && /differs from `HEAD_BEFORE`/.test(phase3)) return c.simplifyCommitted || c.scrutinizeCommitted
  if (/STATUS == FIXED/.test(phase3)) return c.scrutinize === 'FIXED'
  return null
}

/** Named collector: runs whose commits Phase 3 leaves unvalidated (or validates for nothing), plus its structural parts. */
function collectSelfReviewDefects(md: string): string[] {
  const phase3 = selfReviewPhase3(md)
  if (phase3 === null) return ['no Phase 3 section']
  const out: string[] = []
  for (const c of SELF_REVIEW_CASES) {
    const triggers = phase3Triggers(phase3, c)
    const committed = c.simplifyCommitted || c.scrutinizeCommitted
    if (triggers === null) out.push(`${c.label}: Phase 3 states no trigger`)
    else if (committed && !triggers) out.push(`${c.label}: the commit is unvalidated`)
    else if (!committed && triggers) out.push(`${c.label}: Phase 3 validates a run that committed nothing`)
  }
  const at = (anchor: string): number => md.indexOf(anchor)
  if (at('Record `HEAD_BEFORE` (`git rev-parse HEAD`)') === -1 || at('Record `HEAD_BEFORE` (`git rev-parse HEAD`)') > at('Agent(subagent_type="Simplify"')) out.push('HEAD_BEFORE is not recorded before Simplify')
  if (!phase3.includes('git diff --name-only HEAD_BEFORE..HEAD') || !phase3.includes('VALIDATION_SCOPE: changed-only')) out.push('Phase 3 is not changed-only over HEAD_BEFORE..HEAD')
  if (!phase3.includes('**If FAIL:** Report validation failures to user and halt')) out.push('Phase 3 has no FAIL arm that halts')
  if (!phase3.includes('If STATUS is BLOCKED, skip this phase')) out.push('BLOCKED does not halt before Phase 3')
  if (/changes_made|SCRUTINIZE_CHANGES/.test(md)) out.push('a command still parses changes_made')
  return out
}

describe('D-VALIDATE-ONCE (#421 AC-15): /self-review validates whenever HEAD moved, Simplify-only commits included', () => {
  it('Phase 3 keys on HEAD, and HEAD_BEFORE precedes Simplify', () => {
    const md = requireDistFile('self-review.md')
    expect(selfReviewPhase3(md)?.length, 'no Phase 3 read').toBeGreaterThan(200)
    expect(collectSelfReviewDefects(md)).toEqual([])
  })

  it('known-bad probe: the Phase 3 text before #421, with a Simplify-only commit and a PASS Scrutinize, reports the commit unvalidated', () => {
    const md = requireDistFile('self-review.md')
    const phase3 = selfReviewPhase3(md)!
    const before = md.replace(phase3, '### Phase 3: Conditional Validation\n\nIf Scrutinize agent made changes (STATUS == FIXED):\n\nAgent(subagent_type="Validate"):\n"FILES_CHANGED: {scrutinize_modified_files}\nVALIDATION_SCOPE: changed-only"\n\n**If FAIL:** Report validation failures to user and halt\n\n')
    expect(before, 'the seed must land').not.toBe(md)
    const defects = collectSelfReviewDefects(before)
    expect(defects).toContain('Simplify committed, Scrutinize PASS: the commit is unvalidated')
    expect(defects).toContain('Phase 3 is not changed-only over HEAD_BEFORE..HEAD')
  })

  it('known-bad probes: HEAD_BEFORE recorded after Simplify and a lost BLOCKED skip are reported', () => {
    const md = requireDistFile('self-review.md')
    const late = md.replace('Record `HEAD_BEFORE` (`git rev-parse HEAD`)', 'Note the head (`git rev-parse HEAD`)')
    expect(collectSelfReviewDefects(late)).toContain('HEAD_BEFORE is not recorded before Simplify')
    expect(collectSelfReviewDefects(md.replace('If STATUS is BLOCKED, skip this phase', 'If STATUS is BLOCKED, continue'))).toEqual(['BLOCKED does not halt before Phase 3'])
  })
})

// ---------------------------------------------------------------------------
// D-CI-WAIT-INLINE — /resolve's pushes
// ---------------------------------------------------------------------------

const RESOLVE_PUSH = 'git -C {worktree} push; echo "exit=$?"'

/** Named collector: /resolve claiming one push path, or its gate, 9b-0 and Report not covering the gate's push. */
function collectResolvePushDefects(md: string): string[] {
  const out: string[] = []
  if (/the one way \/resolve moves the PR head/.test(md)) out.push('9b-0 still claims Phase 7\'s push is the one way /resolve moves the PR head')
  const phase8 = md.slice(md.indexOf('### Phase 8: CI Status Gate'), md.indexOf('### Phase 9: Manage Debt'))
  if (!phase8.includes(RESOLVE_PUSH)) out.push('Phase 8 names no push of its own')
  if (phase8.split(RESOLVE_PUSH).length - 1 !== 1) out.push('Phase 8 does not spell its push exactly once')
  if (/--force|\bpush -f\b/.test(phase8)) out.push('the Phase 8 push may force')
  if (!phase8.includes('`TRACEABILITY: DEGRADED (ci push failed)`')) out.push('Phase 8 has no ci push failed arm')
  if (!phase8.includes('never forced, and no retry')) out.push('the Phase 8 push does not say never forced, no retry')
  const step = md.slice(md.indexOf('**Step 9b-0: Re-verify stale test-plan items**'), md.indexOf('**Step 9b-1: Resolve external threads**'))
  if (!step.includes("Run this step only when a push of this run succeeded — Phase 7's, or the push of Phase 8's gate")) out.push('9b-0 does not cover a Phase 8 push')
  if (!/- Push: \{pushed \(Phase 7, a CI-fix push, or both\) \|/.test(md)) out.push('the Report\'s Push line does not cover any successful push')
  return out
}

describe('D-CI-WAIT-INLINE (#421): /resolve no longer claims a single push path', () => {
  it('Phase 8 pushes with its own command, 9b-0 and the Report cover any push of the run', () => {
    const md = requireDistFile('resolve.md')
    expect(md.length, 'nothing read').toBeGreaterThan(5000)
    expect(collectResolvePushDefects(md)).toEqual([])
  })

  it('known-bad probes: the single-push claim, a missing gate push and a narrowed Report line are each reported', () => {
    const md = requireDistFile('resolve.md')
    const single = md.replace("Run this step only when a push of this run succeeded — Phase 7's, or the push of Phase 8's gate — and a PR is known;", "Run this step only when this run's Phase 7 push succeeded — the one way /resolve moves the PR head — and a PR is known;")
    expect(single, 'the seed must land').not.toBe(md)
    expect(collectResolvePushDefects(single)).toEqual([
      '9b-0 still claims Phase 7\'s push is the one way /resolve moves the PR head',
      '9b-0 does not cover a Phase 8 push',
    ])
    expect(collectResolvePushDefects(md.replace(RESOLVE_PUSH, 'git status'))).toEqual(expect.arrayContaining(['Phase 8 names no push of its own']))
    expect(collectResolvePushDefects(md.replace('- Push: {pushed (Phase 7, a CI-fix push, or both) |', '- Push: {pushed |'))).toEqual(['the Report\'s Push line does not cover any successful push'])
  })
})
