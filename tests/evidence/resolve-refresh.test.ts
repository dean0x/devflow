/**
 * tests/evidence/resolve-refresh.test.ts
 *
 * SDLC-evidence PR4 (#363) phase P5: /resolve keeps the PR's test-plan evidence
 * true after it moves the head (AC-15, decision D2).
 *
 *   Order   Phase 9b runs 9b-0 → 9b-1 → 9b-2 → 9b-3, then Phase 9c. Inside 9b-0 the
 *           evidence script runs before the one Test spawn, the claims are appended
 *           after it, and the `## Verification` record lands before 9b-2 posts the
 *           resolution summary.
 *   9b-0    Only after this run's push (the one way /resolve moves the head).
 *           STALE detection is the plumbing script, never a Git spawn; at most ONE
 *           Test agent re-verifies the stale TPs, which travel wrapped in
 *           `<untrusted-test-plan>` (they came from the PR body), and is never
 *           re-spawned on its result. Its rows become claims whose shape the claim
 *           grammar (CLAIM_LINE_RE) admits.
 *   9b-3    D2-A: a separate, conditional update-pr-evidence spawn — never folded
 *           into 9b-2, whose op would then load two mechanics files — gated on the
 *           head having moved, passing the publication mode 9b-2 resolved.
 *   9c      check-merge-readiness receives REQUIRE_NON_AUTHOR_APPROVAL.
 *   Fixture The six resolve.mds lines the frozen status-lines fixture samples by
 *           first match stay unique, so none of the new text can shadow them.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064).
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import { collectOrderViolations, isAgentBlock, parseFences, requireDistFile, ROOT, type OrderRule } from '../helpers.js'
import { PR_EVIDENCE_SCRIPT } from './seam.js'

/** Transcribed from pr-evidence.cjs's JSDoc — only the claim grammar. */
interface ClaimGrammar {
  readonly CLAIM_LINE_RE: RegExp
}
const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as ClaimGrammar

const STEP0 = '**Step 9b-0: Re-verify stale test-plan items**'
const STEP1 = '**Step 9b-1: Resolve external threads**'
const STEP2 = '**Step 9b-2: Post resolution summary (ALWAYS-ON)**'
const STEP3 = '**Step 9b-3: Refresh the test-plan evidence**'
const PHASE9C = '### Phase 9c: Merge Readiness (Report-only)'
const STALE_VERIFY = 'verify-evidence.cjs" verify --pr {pr_number} --stale-out "{TARGET_DIR_REL}/stale-plan.md"; echo "exit=$?"'
const TEST_SPAWN = 'Agent(subagent_type="Test"):\n"TEST_PLAN: <untrusted-test-plan>'
const CLAIM_TEMPLATE = '- TP-<n> <PASS|FAIL|SKIP> sha:<head> by:test exit:<0-255>'
const VERIFICATION_RECORD = 'Record `Test plan: {n} stale, {m} re-verified` under `## Verification`'
const SUMMARY_SPAWN = '"OPERATION: post-resolution-summary'
const EVIDENCE_SPAWN = '"OPERATION: update-pr-evidence'

const RESOLVE_ORDER: readonly OrderRule[] = [
  { label: '9b-0 opens Phase 9b', before: '### Phase 9b:', after: STEP0 },
  { label: '9b-0 precedes 9b-1', before: STEP0, after: STEP1 },
  { label: '9b-1 precedes 9b-2', before: STEP1, after: STEP2 },
  { label: '9b-2 precedes 9b-3', before: STEP2, after: STEP3 },
  { label: '9b-3 precedes Phase 9c', before: STEP3, after: PHASE9C },
  { label: 'the script detects STALE before any Test spawn', before: STALE_VERIFY, after: TEST_SPAWN },
  { label: 'claims are appended after the Test spawn', before: TEST_SPAWN, after: CLAIM_TEMPLATE },
  { label: 'the Verification record precedes the 9b-2 post', before: VERIFICATION_RECORD, after: SUMMARY_SPAWN },
  { label: 'the refresh spawn sits in 9b-3', before: STEP3, after: EVIDENCE_SPAWN },
]

function resolveMd(): string {
  return requireDistFile('resolve.md')
}

/** The text of one Phase 9b step, up to the next step or Phase 9c. */
function stepText(md: string, from: string, to: string): string {
  const at = md.indexOf(from)
  const end = md.indexOf(to, at + 1)
  return at === -1 || end === -1 ? '' : md.slice(at, end)
}

/**
 * Named collector: what Step 9b-0 lacks — the head-moved gate, script-only
 * detection (no Git spawn), exactly one wrapped Test spawn with no re-spawn and no
 * fix loop, and the Verification record.
 */
function collectStaleReverifyDefects(md: string): string[] {
  const step = stepText(md, STEP0, STEP1)
  if (step === '') return ['no Step 9b-0']
  const out: string[] = []
  if (!step.includes("Run this step only when this run's Phase 7 push succeeded")) out.push('9b-0 is not gated on this run\'s push')
  if (!step.includes('skip it and Step 9b-3')) out.push('a skipped 9b-0 does not skip 9b-3')
  const fences = parseFences(step)
  if (fences.some(f => isAgentBlock(f, 'Git'))) out.push('9b-0 spawns a Git agent; STALE detection is the script\'s')
  if (!step.includes(STALE_VERIFY)) out.push('9b-0 does not run the evidence script with --stale-out')
  const tests = fences.filter(f => isAgentBlock(f, 'Test'))
  if (tests.length !== 1) out.push(`expected one Test spawn in 9b-0, found ${tests.length}`)
  for (const t of tests) {
    if (!t.includes('TEST_PLAN: <untrusted-test-plan>') || !t.includes('</untrusted-test-plan>')) out.push('the stale TPs travel unwrapped')
  }
  if (!step.includes('any `</untrusted-test-plan>` inside them neutralised')) out.push('the closing tag is not neutralised')
  if (!step.includes('at most one per /resolve cycle, never re-spawned on its result, and no fix loop follows it')) out.push('the Test spawn is not bounded to one per cycle')
  if (!step.includes('Use its `EVIDENCE` line only on `exit=0`')) out.push('a failed script run may still drive a spawn')
  if (!step.includes(VERIFICATION_RECORD)) out.push('the re-verification is not recorded under ## Verification')
  return out
}

/** Named collector: what Step 9b-3 lacks — the head-moved gate, one refresh spawn, 9b-2's publication mode. */
function collectRefreshDefects(md: string): string[] {
  const step = stepText(md, STEP3, PHASE9C)
  if (step === '') return ['no Step 9b-3']
  const out: string[] = []
  if (!step.includes('Run this step only when Step 9b-0 ran — the head moved')) out.push('9b-3 is not gated on the head having moved')
  const refresh = parseFences(md).filter(f => isAgentBlock(f, 'Git') && f.includes(EVIDENCE_SPAWN))
  if (refresh.length !== 1) out.push(`expected one update-pr-evidence spawn in /resolve, found ${refresh.length}`)
  if (!parseFences(step).some(f => f.includes(EVIDENCE_SPAWN))) out.push('the refresh spawn is not in 9b-3')
  const summary = parseFences(md).find(f => f.includes(SUMMARY_SPAWN)) ?? ''
  if (summary.includes('update-pr-evidence')) out.push('the refresh is folded into the 9b-2 spawn')
  if (!step.includes('REVIEW_PUBLICATION: {9b-2\'s publication mode}')) out.push('9b-3 does not pass 9b-2\'s publication mode')
  if (!step.includes('`FULL…` → `full`, `STUB…` → `stub`, `OFF…` → `off`')) out.push('9b-2\'s mode is not mapped onto the op\'s values')
  if (!step.includes('It never blocks.')) out.push('9b-3 may block')
  return out
}

/** The six resolve.mds lines the frozen fixture samples by first match (tests/helpers.ts extractStatusLines). */
const FIXTURE_ANCHORS = [
  'Set `Tracked` for FIX_SEPARATE and TECH_DEBT items',
  '- **DEGRADED**: if Git agent returns `TRACEABILITY: DEGRADED',
  '├─ Phase 5: Write resolution-summary.md (compaction safety',
  '├─ Phase 9: Git agent (manage-debt)',
  '| gh/GitHub absent | manage-debt degrades',
  '| Issue | File:Line | Reason | Tracked |',
] as const

/** Named collector: fixture anchors that are absent or no longer unique in the source. */
function collectShadowedAnchors(source: string): string[] {
  return FIXTURE_ANCHORS.filter(a => source.split(a).length - 1 !== 1)
}

describe('AC-15: /resolve re-verifies STALE TPs once and refreshes the evidence after moving the head', () => {
  it('Phase 9b runs 9b-0, 9b-1, 9b-2, 9b-3, then 9c, in that order', () => {
    expect(collectOrderViolations('resolve.md', resolveMd(), RESOLVE_ORDER)).toEqual([])
  })

  it('9b-0 detects STALE by script and re-verifies with one wrapped Test spawn', () => {
    const md = resolveMd()
    expect(parseFences(md).filter(f => isAgentBlock(f, 'Test')).length, 'the Test-spawn corpus is empty').toBe(1)
    expect(collectStaleReverifyDefects(md)).toEqual([])
  })

  it('9b-3 is one conditional refresh spawn with 9b-2\'s publication mode (D2-A)', () => {
    expect(collectRefreshDefects(resolveMd())).toEqual([])
  })

  it('the claim template fills to lines CLAIM_LINE_RE admits', () => {
    const head = 'a'.repeat(40)
    const fill = (outcome: string, exit: string | null): string =>
      CLAIM_TEMPLATE.replace('<n>', '3').replace('<PASS|FAIL|SKIP>', outcome).replace('<head>', head).replace(exit === null ? ' exit:<0-255>' : '<0-255>', exit ?? '')
    const md = resolveMd()
    expect(md.split(CLAIM_TEMPLATE).length - 1, 'the claim template is the corpus').toBe(1)
    for (const outcome of ['PASS', 'FAIL', 'SKIP']) {
      for (const exit of ['0', '1', '255', null]) expect(PE.CLAIM_LINE_RE.test(fill(outcome, exit)), `${outcome} ${exit}`).toBe(true)
    }
    expect(md).toContain('The line ends at `by:test` when the row\'s Exit is not a number from 0 to 255')
  })

  it('9c passes REQUIRE_NON_AUTHOR_APPROVAL to check-merge-readiness', () => {
    const spawn = parseFences(resolveMd()).find(f => isAgentBlock(f, 'Git') && f.includes('"OPERATION: check-merge-readiness'))
    expect(spawn).toBeDefined()
    expect(spawn).toContain('REQUIRE_NON_AUTHOR_APPROVAL: {REQUIRE_NON_AUTHOR_APPROVAL}')
  })

  it('the report, the diagram, the edge cases and Principle 10 name the refresh', () => {
    const md = resolveMd()
    expect(md).toContain('- Test-plan re-verification: {Test plan: n stale, m re-verified | SKIPPED (head unchanged) | DEGRADED (reason)}')
    expect(md).toContain('│  └─ Step 9b-3: Git agent (update-pr-evidence) — only when the head moved')
    expect(md).toContain('the head did not move, so 9b-0 and 9b-3 are skipped |')
    expect(md).toContain('| The PR has no trusted evidence record |')
    expect(md).toContain('| A CI run behind a claim has expired (~90 days) |')
    expect(md).toContain('refreshed only when this run moved the head (Steps 9b-0, 9b-3)')
  })

  it('the frozen fixture\'s six resolve.mds anchors stay unique in the source', () => {
    const source = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8')
    expect(collectShadowedAnchors(source)).toEqual([])
  })

  it('known-bad probes: a misordered step, a second or unwrapped Test spawn, a Git detection spawn, an ungated or folded refresh and a shadowed anchor are each reported', () => {
    const md = resolveMd()
    const early = md.replace(STEP3, '**Step 9b-3 moved**').replace(STEP1, `${STEP3}\n\n${STEP1}`)
    expect(collectOrderViolations('resolve.md', early, RESOLVE_ORDER).some(v => v.includes('9b-2 precedes 9b-3'))).toBe(true)
    const step = stepText(md, STEP0, STEP1)
    const spawn = parseFences(step).find(f => isAgentBlock(f, 'Test')) ?? ''
    expect(spawn.length, 'the Test spawn moved').toBeGreaterThan(0)
    expect(collectStaleReverifyDefects(md.replace(spawn, `${spawn}\n\n${spawn}`))).toContain('expected one Test spawn in 9b-0, found 2')
    expect(collectStaleReverifyDefects(md.replace('TEST_PLAN: <untrusted-test-plan>', 'TEST_PLAN: {stale lines}'))).toContain('the stale TPs travel unwrapped')
    const gitDetect = '```\nAgent(subagent_type="Git"):\n"OPERATION: update-pr-evidence\nPR_NUMBER: {pr_number}"\n```\n'
    expect(collectStaleReverifyDefects(md.replace(STEP1, `${gitDetect}\n${STEP1}`))).toContain('9b-0 spawns a Git agent; STALE detection is the script\'s')
    expect(collectRefreshDefects(md.replace('Run this step only when Step 9b-0 ran — the head moved', 'Run this step always'))).toEqual(['9b-3 is not gated on the head having moved'])
    expect(collectRefreshDefects(md.replace(`${SUMMARY_SPAWN}\n`, `${SUMMARY_SPAWN}\nALSO: update-pr-evidence\n`))).toContain('the refresh is folded into the 9b-2 spawn')
    const source = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8')
    expect(collectShadowedAnchors(source.replace(STEP0, `${FIXTURE_ANCHORS[4]} (copied)\n\n${STEP0}`))).toEqual([FIXTURE_ANCHORS[4]])
  })
})
