/**
 * tests/review/compliance-off.test.ts
 *
 * #648 phase C: the compliance-off builds of /code-review and /bug-analysis keep their results in local files.
 *
 *   AC-13  The off builds hold no post-review-summary spawn, no publication step, no test-plan block render
 *          and no PR_TEST_PLAN_BLOCK input. The same text is in the on builds, so the scan is not empty.
 *   AC-18  Each off build records the one fixed local line under `required`, before the PR-opening spawn,
 *          and the report carries it. (The once-per-build count is the posting-absence guard's.)
 *   AC-23  /code-review keeps the review summary of Step 3a and reports `Review summary: <path> (local;
 *          not posted)`. Phase 3 spawns the Synthesize agent and nothing else.
 *   AC-24  The reviewed-head and analysis-head writes are the on builds' lines, byte for byte. /bug-analysis
 *          joins the local merge-check list: it posts nothing and keeps its summary file.
 *
 * Both off builds are read: compliance off with curation on, and both off. Every guard has a named collector,
 * a non-empty-corpus assertion and a known-bad probe run through the same collector.
 */

import { describe, it, expect } from 'vitest'

import { collectOrderViolations, countOf, isAgentBlock, parseFences, requireDistFile, resolveCurationOffSource, resolveVariantOffSource, type OrderRule } from '../helpers.js'
import { seedOnce } from '../guards/level-guard-helpers.js'

type OffKey = 'compliance-off' | 'both-off'

/** The compliance-off builds, by label. */
const OFF_KEYS: ReadonlyArray<readonly [string, OffKey]> = [
  ['compliance off', 'compliance-off'],
  ['curation and compliance off', 'both-off'],
]

function offBuild(key: OffKey, name: string): string {
  const off = resolveVariantOffSource(key, 'commands', name)
  if (off === null) throw new Error(`the ${key} build of /${name} is absent: run \`npm run build:mds\``)
  return off
}

/** The compliance-on build with the same curation switch as an off key: dist/commands, or dist/curation-off/commands. */
function onVariant(key: OffKey, name: string): string {
  if (key === 'compliance-off') return requireDistFile(`${name}.md`)
  const curationOff = resolveCurationOffSource('commands', name)
  if (curationOff === null) throw new Error(`the curation-off build of /${name} is absent: run \`npm run build:mds\``)
  return curationOff
}

const OFF_POLICY_LINE = 'TRACEABILITY: DEGRADED (compliance off on this machine; the repository requires evidence)'
const SUMMARY_REPORT_LINE = 'Review summary: `.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (local; not posted)'

/** The text from a heading up to the next one of `until` (or the end), or null when the heading is absent. */
function sectionOf(md: string, from: string, until: string): string | null {
  const at = md.indexOf(from)
  if (at === -1) return null
  const end = md.indexOf(until, at + from.length)
  return end === -1 ? md.slice(at) : md.slice(at, end)
}

/** The lines of a text that hold `needle`. */
const linesWith = (md: string, needle: string): string[] => md.split('\n').filter(l => l.includes(needle))

// ── /code-review ─────────────────────────────────────────────────────────────────────────────────────

/** The posting text an off build of /code-review names nowhere: [what it is, the text]. */
const REVIEW_ABSENT: ReadonlyArray<readonly [string, string]> = [
  ['the post-review-summary operation', 'post-review-summary'],
  ['the publication step', 'Step 0f'],
  ['the publication input an op takes', 'REVIEW_PUBLICATION: {REVIEW_PUBLICATION}'],
  ['the publication resolution', '**Resolve `REVIEW_PUBLICATION` per worktree:**'],
  ['the test-plan block input', 'PR_TEST_PLAN_BLOCK'],
  ['the test-plan render call', 'verify-evidence.cjs" render'],
  ['the review comment status line', 'Review comment status'],
  ['the publication status line', 'Publication status'],
  ['the posted-comment edge case', 'Review comment already posted'],
  ['the publication-off edge case', '`reviewPublication: off`'],
  ['the posted-comment output', 'PR_COMMENT'],
]

/** Named collector: what an off build of /code-review still names that a non-posting machine must not. */
function collectReviewAbsenceDefects(md: string): string[] {
  return REVIEW_ABSENT.filter(([, text]) => md.includes(text)).map(([what, text]) => `the off build names ${what}: ${text}`)
}

const REVIEW_PHASE3 = '### Phase 3: Synthesis → Review Summary (Sequential)'
const REVIEW_PHASE4 = '### Phase 4: Write Review Head Marker & Report'
const REVIEW_STEP0C = '#### Step 0c: Per-Worktree Pre-Flight (Git Agent)'
const REVIEW_STEP0B2 = '#### Step 0b-ii: Resolve the evidence policy'
const HEAD_WRITE = '`M="$(git -C "{worktree_path}" rev-parse --absolute-git-dir)/devflow/reviews/{branch-slug}" && mkdir -p "$M" && git -C "{worktree_path}" rev-parse HEAD > "$M/.last-review-head"`'

/** The order the off build keeps: the policy, its line, the PR-opening spawn, the synthesis, the report. */
const REVIEW_ORDER: readonly OrderRule[] = [
  { label: 'the policy resolves before the line is recorded', before: REVIEW_STEP0B2, after: OFF_POLICY_LINE },
  { label: 'the line is recorded before the PR-opening spawn', before: OFF_POLICY_LINE, after: REVIEW_STEP0C },
  { label: 'the PR-opening spawn precedes the synthesis', before: 'OPERATION: ensure-pr-ready', after: REVIEW_PHASE3 },
  { label: 'the synthesis precedes the report', before: REVIEW_PHASE3, after: REVIEW_PHASE4 },
]

/**
 * Named collector: how an off /code-review keeps the review summary local — Phase 3 spawns the Synthesize agent
 * alone, the report names the file as not posted, the head marker is the on build's line, and the PR-opening
 * spawn keeps its plain inputs and gains no block.
 */
function collectReviewLocalDefects(md: string, onMd: string): string[] {
  const out: string[] = []
  const phase3 = sectionOf(md, REVIEW_PHASE3, REVIEW_PHASE4)
  const phase4 = sectionOf(md, REVIEW_PHASE4, '\n## Architecture')
  if (phase3 === null || phase4 === null) return ['Phase 3 or Phase 4 is not found']
  const spawns = parseFences(phase3).filter(f => f.includes('Agent('))
  if (spawns.length !== 1) out.push(`Phase 3 holds ${spawns.length} spawns, expected the one Synthesize spawn`)
  else if (!isAgentBlock(spawns[0], 'Synthesize')) out.push('the one Phase 3 spawn is not the Synthesize agent')
  else if (!spawns[0].includes('Output: {worktree_path}/.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md')) out.push('the Synthesize spawn does not write review-summary.md')
  if (!md.includes('**Step 3a — Synthesize agent** per worktree:')) out.push('Step 3a is not kept')
  if (countOf(phase4, SUMMARY_REPORT_LINE) !== 1) out.push('the report does not name the review summary as local and not posted exactly once')
  if (!phase4.includes('the compliance-off line of Step 0b-ii')) out.push('the report does not carry the Step 0b-ii line')
  if (countOf(md, HEAD_WRITE) !== 1 || !phase4.includes(HEAD_WRITE)) out.push('the reviewed-head write is not in Phase 4 once')
  if (countOf(onMd, HEAD_WRITE) !== 1) out.push('the on build does not hold the reviewed-head write the off build is compared with')
  const pre = parseFences(sectionOf(md, REVIEW_STEP0C, '#### Step 0d') ?? '').filter(f => f.includes('OPERATION: ensure-pr-ready'))
  if (pre.length !== 1) out.push(`Step 0c holds ${pre.length} ensure-pr-ready spawns, expected 1`)
  else {
    for (const input of ['PR_DESCRIPTION_GUIDANCE: {pr_description_guidance}', 'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}']) {
      if (!pre[0].includes(input)) out.push(`the ensure-pr-ready spawn drops ${input.split(':')[0]}`)
    }
    if (/PR_[A-Z_]*BLOCK|PR_EXCEPTIONS/.test(pre[0])) out.push('the ensure-pr-ready spawn passes a caller block')
  }
  if (!md.includes('synthesizing results into a local review summary')) out.push('the opening line still says PR comments')
  return out
}

describe('#648 AC-13, AC-23, AC-24: the compliance-off builds of /code-review keep the review summary local', () => {
  const on = requireDistFile('code-review.md')

  it('both off builds hold the local flow in order and none of the posting text', () => {
    for (const [label, key] of OFF_KEYS) {
      const md = offBuild(key, 'code-review')
      expect(md, `${label}: the off build is the on build, so this proves nothing`).not.toBe(on)
      expect(sectionOf(md, REVIEW_PHASE3, REVIEW_PHASE4)?.length ?? 0, `${label}: Phase 3 is empty`).toBeGreaterThan(300)
      expect(collectOrderViolations('code-review.md', md, REVIEW_ORDER), label).toEqual([])
      expect(collectReviewAbsenceDefects(md), label).toEqual([])
      expect(collectReviewLocalDefects(md, on), label).toEqual([])
    }
  })

  it('the on build keeps each posting text, so the absence guard is not vacuous', () => {
    expect(REVIEW_ABSENT.length, 'the absence table is empty').toBeGreaterThanOrEqual(10)
    const silent = REVIEW_ABSENT.filter(([, text]) => !on.includes(text)).map(([what]) => what)
    expect(silent, 'a text the on build does not name proves nothing about an off one').toEqual([])
    expect(on, 'the on build never prints the local line').not.toContain(OFF_POLICY_LINE)
    expect(on, 'the on build never prints the local report line').not.toContain('(local; not posted)')
  })

  it('the diff and review phases (1 and 2) are the text of the on build of the same curation variant', () => {
    const phases12 = (md: string): string => md.slice(md.indexOf('### Phase 1: Analyze Changed Files'), md.indexOf('### Phase 3: Synthesis'))
    for (const [label, key] of OFF_KEYS) {
      const off = phases12(offBuild(key, 'code-review'))
      expect(off.length, `${label}: Phases 1 and 2 are empty, so this proves nothing`).toBeGreaterThan(5_000)
      expect(off, `${label}: Phases 1 and 2 differ from the on build's`).toBe(phases12(onVariant(key, 'code-review')))
    }
  })

  it('known-bad probes: a restored post spawn, a restored render, a lost report line and a lost marker are each reported', () => {
    const md = offBuild('compliance-off', 'code-review')
    expect(collectReviewLocalDefects(md, on)).toEqual([])
    expect(collectReviewAbsenceDefects(`${md}\n"OPERATION: post-review-summary`)).toEqual(['the off build names the post-review-summary operation: post-review-summary'])
    expect(collectReviewAbsenceDefects(`${md}\nPR_TEST_PLAN_BLOCK: x`)).toEqual(['the off build names the test-plan block input: PR_TEST_PLAN_BLOCK'])
    expect(collectReviewLocalDefects(seedOnce(md, SUMMARY_REPORT_LINE, 'Review summary: posted'), on)).toContain('the report does not name the review summary as local and not posted exactly once')
    expect(collectReviewLocalDefects(seedOnce(md, '> "$M/.last-review-head"`', '> /dev/null`'), on)).toContain('the reviewed-head write is not in Phase 4 once')
    expect(collectReviewLocalDefects(seedOnce(md, 'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}\nValidate branch', 'PR_TEST_PLAN_BLOCK: x\nAPPLY_CONVENTIONS: {APPLY_CONVENTIONS}\nValidate branch'), on)).toContain('the ensure-pr-ready spawn passes a caller block')
    expect(collectReviewLocalDefects(md.replace('Agent(subagent_type="Synthesize", run_in_background=false)', 'Agent(subagent_type="Git", run_in_background=false)'), on)).toContain('the one Phase 3 spawn is not the Synthesize agent')
  })

  it('the fixed local line is recorded under the required policy before the PR-opening spawn, in both off builds', () => {
    for (const [label, key] of OFF_KEYS) {
      const md = offBuild(key, 'code-review')
      expect(countOf(md, OFF_POLICY_LINE), label).toBe(1)
      expect(linesWith(md, OFF_POLICY_LINE), label).toEqual([`When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_POLICY_LINE}\` once, for the Phase 4 report.`])
    }
  })
})

// ── /bug-analysis ────────────────────────────────────────────────────────────────────────────────────

/** The posting text an off build of /bug-analysis names nowhere: [what it is, the text]. */
const BUG_ABSENT: ReadonlyArray<readonly [string, string]> = [
  ['the test-plan block input', 'PR_TEST_PLAN_BLOCK'],
  ['the test-plan render call', 'verify-evidence.cjs" render'],
  ['the test-plan block step', 'Render the test-plan block'],
]

/** Named collector: what an off build of /bug-analysis still names that a non-posting machine must not. */
function collectBugAbsenceDefects(md: string): string[] {
  return BUG_ABSENT.filter(([, text]) => md.includes(text)).map(([what, text]) => `the off build names ${what}: ${text}`)
}

const BUG_PHASE1 = '### Phase 1: Pre-flight'
const BUG_PHASE2 = '### Phase 2: Static Analysis'
const BUG_PHASE7 = '### Phase 7: Finalize'
const BUG_HEAD_WRITE = '`M="$(git -C "{worktree}" rev-parse --absolute-git-dir)/devflow/bug-analysis/{branch-slug}" && mkdir -p "$M" && git -C "{worktree}" rev-parse HEAD > "$M/.last-analysis-head"`'

/**
 * Named collector: how an off /bug-analysis keeps its flow local — the one Phase 1 spawn is the plain
 * ensure-pr-ready with APPLY_CONVENTIONS and no block, the head write is the on build's line, and the report
 * carries the summary path and the Phase 1 lines.
 */
function collectBugLocalDefects(md: string, onMd: string): string[] {
  const out: string[] = []
  const phase1 = sectionOf(md, BUG_PHASE1, BUG_PHASE2)
  const phase7 = sectionOf(md, BUG_PHASE7, '\n## Architecture')
  if (phase1 === null || phase7 === null) return ['Phase 1 or Phase 7 is not found']
  const spawns = parseFences(phase1).filter(f => f.includes('Agent('))
  if (spawns.length !== 1) out.push(`Phase 1 holds ${spawns.length} spawns, expected the one Git spawn`)
  else {
    if (!isAgentBlock(spawns[0], 'Git') || !spawns[0].includes('"OPERATION: ensure-pr-ready')) out.push('the one Phase 1 spawn is not ensure-pr-ready')
    if (!spawns[0].includes('APPLY_CONVENTIONS: {APPLY_CONVENTIONS}')) out.push('the ensure-pr-ready spawn drops APPLY_CONVENTIONS')
    if (/PR_[A-Z_]*BLOCK|PR_EXCEPTIONS/.test(spawns[0])) out.push('the ensure-pr-ready spawn passes a caller block')
  }
  if (!phase1.includes(`When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_POLICY_LINE}\` once, for the Phase 7 report.`)) out.push('the fixed line is not recorded only under `required`, for the Phase 7 report')
  if (countOf(md, OFF_POLICY_LINE) !== 1) out.push(`the build holds the fixed line ${countOf(md, OFF_POLICY_LINE)} times, expected 1`)
  if (!phase7.includes('and the compliance-off line of Phase 1}')) out.push('the report does not carry the Phase 1 line')
  if (!phase7.includes('- Bug report: {ANALYSIS_DIR}/bug-analysis-summary.md')) out.push('the report does not name the local bug report')
  if (countOf(md, BUG_HEAD_WRITE) !== 1 || !phase7.includes(BUG_HEAD_WRITE)) out.push('the analysis-head write is not in Phase 7 once')
  if (countOf(onMd, BUG_HEAD_WRITE) !== 1) out.push('the on build does not hold the analysis-head write the off build is compared with')
  return out
}

describe('#648 AC-13, AC-24: the compliance-off builds of /bug-analysis post nothing and keep the local flow', () => {
  const on = requireDistFile('bug-analysis.md')

  it('both off builds hold the local flow and none of the posting text', () => {
    for (const [label, key] of OFF_KEYS) {
      const md = offBuild(key, 'bug-analysis')
      expect(md, `${label}: the off build is the on build, so this proves nothing`).not.toBe(on)
      expect(sectionOf(md, BUG_PHASE1, BUG_PHASE2)?.length ?? 0, `${label}: Phase 1 is empty`).toBeGreaterThan(400)
      expect(collectBugAbsenceDefects(md), label).toEqual([])
      expect(collectBugLocalDefects(md, on), label).toEqual([])
    }
  })

  it('the on build keeps each posting text, so the absence guard is not vacuous', () => {
    const silent = BUG_ABSENT.filter(([, text]) => !on.includes(text)).map(([what]) => what)
    expect(silent, 'a text the on build does not name proves nothing about an off one').toEqual([])
    expect(on, 'the on build never prints the local line').not.toContain(OFF_POLICY_LINE)
  })

  it('Phases 2 to 6 are the text of the on build of the same curation variant: the analysis flow is unchanged', () => {
    const middle = (md: string): string => md.slice(md.indexOf(BUG_PHASE2), md.indexOf(BUG_PHASE7))
    for (const [label, key] of OFF_KEYS) {
      const off = middle(offBuild(key, 'bug-analysis'))
      expect(off.length, `${label}: the analysis phases are empty, so this proves nothing`).toBeGreaterThan(5_000)
      expect(off, `${label}: the analysis phases differ from the on build`).toBe(middle(onVariant(key, 'bug-analysis')))
    }
  })

  it('known-bad probes: a restored block, a restored render, a lost line and a lost marker are each reported', () => {
    const md = offBuild('compliance-off', 'bug-analysis')
    expect(collectBugLocalDefects(md, on)).toEqual([])
    expect(collectBugAbsenceDefects(`${md}\nPR_TEST_PLAN_BLOCK: x`)).toEqual(['the off build names the test-plan block input: PR_TEST_PLAN_BLOCK'])
    expect(collectBugAbsenceDefects(`${md}\nnode verify-evidence.cjs" render --plan x`)).toEqual(['the off build names the test-plan render call: verify-evidence.cjs" render'])
    expect(collectBugLocalDefects(seedOnce(md, 'once, for the Phase 7 report.', 'once.'), on)).toContain('the fixed line is not recorded only under `required`, for the Phase 7 report')
    expect(collectBugLocalDefects(seedOnce(md, '> "$M/.last-analysis-head"`', '> /dev/null`'), on)).toContain('the analysis-head write is not in Phase 7 once')
    expect(collectBugLocalDefects(seedOnce(md, 'APPLY_CONVENTIONS: {APPLY_CONVENTIONS}\nValidate branch', 'PR_TEST_PLAN_BLOCK: x\nAPPLY_CONVENTIONS: {APPLY_CONVENTIONS}\nValidate branch'), on)).toContain('the ensure-pr-ready spawn passes a caller block')
  })
})

// ── The local merge-check list (AC-24) ───────────────────────────────────────────────────────────────

/** Each command's local result files, named in both builds, and what an off build reports as not posted. */
describe('#648 AC-24: the local merge-check files of /code-review and /bug-analysis', () => {
  const FILES: ReadonlyArray<readonly [command: string, files: readonly string[]]> = [
    ['code-review', ['review-summary.md', '.last-review-head']],
    ['bug-analysis', ['bug-analysis-summary.md', '.last-analysis-head']],
  ]

  it('every off build names each local file its command writes, and no evidence or readiness file', () => {
    for (const [command, files] of FILES) {
      for (const [label, key] of OFF_KEYS) {
        const md = offBuild(key, command)
        for (const file of files) expect(md, `${label}: /${command} names ${file}`).toContain(file)
        expect(md, `${label}: /${command} names a merge-check file the list does not hold`).not.toMatch(/\.devflow\/docs\/(?:evidence|readiness)-/)
      }
    }
  })

  it('known-bad probe: a named evidence file is reported by the same pattern', () => {
    const md = offBuild('compliance-off', 'code-review')
    expect(`${md}\n.devflow/docs/evidence-{branch_slug}.md`).toMatch(/\.devflow\/docs\/(?:evidence|readiness)-/)
    expect(md).not.toMatch(/\.devflow\/docs\/(?:evidence|readiness)-/)
  })
})
