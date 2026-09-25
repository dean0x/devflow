/**
 * SDLC-evidence PR2 (#360), phase P3 — /dynamic-build's Gate 2 in SINGLE mode.
 *
 * `overallVerdict` ignored Gate 2. A `FAIL-FIXED` verdict — issues found, fixes
 * applied, never re-evaluated or re-run — was reported as **PASS**. The run now
 * reports it as `UNVERIFIED`; surviving findings, coverage gaps and an escalated
 * final gate still report `PARTIAL`.
 *
 * WAVE mode's merge rule (`_wave.mds`: "On engine PASS: merge") is untouched —
 * whether an UNVERIFIED ticket merges is decided later (plan delta 11).
 *
 * Every guard has the three parts PF-064 asks of an absence-based check: a NAMED
 * collector, an assertion that the text it read is the text it claims to read,
 * and known-bad probes that drive the SAME collector over the `d09da34`
 * spellings — the verdict block quoted verbatim, and one seed per report site
 * restoring its d09da34 wording, so probe cardinality equals arm cardinality.
 *
 * The verdict is checked by EXECUTING the shipped skeleton's own text: a
 * wording pin would stay green over an expression that computes the wrong
 * answer.
 */

import { describe, it, expect } from 'vitest'

import { parseFences, requireDistFile } from '../helpers.js'

// ---------------------------------------------------------------------------
// Shared text utilities
// ---------------------------------------------------------------------------

/** Every start offset of a non-empty `needle` in `text`. */
function offsetsOf(text: string, needle: string): number[] {
  const out: number[] = []
  // Bounded: each hit moves the cursor past a non-empty needle.
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) out.push(at)
  return out
}

// ---------------------------------------------------------------------------
// The shipped SINGLE-mode workflow skeleton
// ---------------------------------------------------------------------------

const BUILT = requireDistFile('dynamic-build.md')

/** Only the SINGLE-mode skeleton declares this workflow name. */
const SINGLE_SCRIPT_MARKER = 'name: "devflow-dynamic-build"'

/** The SINGLE-mode workflow fence, or null when it is not exactly one fence. */
function singleModeScript(built: string): string | null {
  const hits = parseFences(built).filter(f => f.includes(SINGLE_SCRIPT_MARKER))
  return hits.length === 1 ? hits[0] : null
}

const SCRIPT = singleModeScript(BUILT)

describe('the SINGLE-mode skeleton this suite reads', () => {
  it('is exactly one fence and reaches from the meta block to the report phase', () => {
    expect(SCRIPT, `exactly one fence must carry ${SINGLE_SCRIPT_MARKER}`).not.toBeNull()
    // parseFences stops at the first ``` — a fence cut short would silently drop
    // the verdict block and the report prompt this suite checks.
    expect(SCRIPT).toContain('return phase("report"')
    expect(SCRIPT!.length).toBeGreaterThan(10_000)
  })
})

// ---------------------------------------------------------------------------
// 1. FAIL-FIXED ⇒ UNVERIFIED (AC-11)
// ---------------------------------------------------------------------------

const VERDICT_BLOCK_START = 'const coverageGaps = reviewResult.coverageGaps'
const VERDICT_BLOCK_END = 'const overallVerdict = '

/**
 * The top-level verdict block: from the `coverageGaps` binding through the
 * `overallVerdict` line, whole lines, or null unless each anchor opens exactly
 * one line. (The review phase binds its own `coverageGaps = []`, which the
 * `reviewResult.` suffix excludes.)
 */
export function extractVerdictBlock(script: string): string | null {
  const lines = script.split('\n')
  const starts = lines.flatMap((l, i) => (l.startsWith(VERDICT_BLOCK_START) ? [i] : []))
  const ends = lines.flatMap((l, i) => (l.startsWith(VERDICT_BLOCK_END) ? [i] : []))
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) return null
  return lines.slice(starts[0], ends[0] + 1).join('\n')
}

type Gate2Verdict = 'PASS' | 'FAIL-FIXED' | 'SKIPPED'
type OverallVerdict = 'PASS' | 'UNVERIFIED' | 'PARTIAL'

interface VerdictCase {
  readonly label: string
  readonly evaluateVerdict: Gate2Verdict
  readonly testVerdict: Gate2Verdict
  readonly surviving: number
  readonly coverageGaps: readonly string[]
  readonly gate1Final: 'PASS' | 'ESCALATED'
  readonly expected: OverallVerdict
}

const clean = { surviving: 0, coverageGaps: [], gate1Final: 'PASS' } as const

/** The run's verdict over every Gate 2 outcome, crossed with the conditions that already block PASS. */
const VERDICT_TABLE: readonly VerdictCase[] = [
  { label: 'both gates passed', evaluateVerdict: 'PASS', testVerdict: 'PASS', ...clean, expected: 'PASS' },
  { label: 'Gate 2 skipped', evaluateVerdict: 'SKIPPED', testVerdict: 'SKIPPED', ...clean, expected: 'PASS' },
  { label: 'Evaluate passed, Test skipped', evaluateVerdict: 'PASS', testVerdict: 'SKIPPED', ...clean, expected: 'PASS' },
  { label: 'Evaluate FAIL-FIXED', evaluateVerdict: 'FAIL-FIXED', testVerdict: 'PASS', ...clean, expected: 'UNVERIFIED' },
  { label: 'Test FAIL-FIXED', evaluateVerdict: 'PASS', testVerdict: 'FAIL-FIXED', ...clean, expected: 'UNVERIFIED' },
  { label: 'both FAIL-FIXED', evaluateVerdict: 'FAIL-FIXED', testVerdict: 'FAIL-FIXED', ...clean, expected: 'UNVERIFIED' },
  { label: 'Evaluate skipped, Test FAIL-FIXED', evaluateVerdict: 'SKIPPED', testVerdict: 'FAIL-FIXED', ...clean, expected: 'UNVERIFIED' },
  { label: 'a surviving finding', evaluateVerdict: 'PASS', testVerdict: 'PASS', ...clean, surviving: 1, expected: 'PARTIAL' },
  { label: 'a surviving finding outranks FAIL-FIXED', evaluateVerdict: 'FAIL-FIXED', testVerdict: 'PASS', ...clean, surviving: 1, expected: 'PARTIAL' },
  { label: 'a review coverage gap', evaluateVerdict: 'PASS', testVerdict: 'PASS', ...clean, coverageGaps: ['security'], expected: 'PARTIAL' },
  { label: 'final Gate 1 escalated', evaluateVerdict: 'PASS', testVerdict: 'PASS', ...clean, gate1Final: 'ESCALATED', expected: 'PARTIAL' },
  { label: 'final Gate 1 escalated outranks FAIL-FIXED', evaluateVerdict: 'PASS', testVerdict: 'FAIL-FIXED', ...clean, gate1Final: 'ESCALATED', expected: 'PARTIAL' },
]

/** Run the shipped verdict block as a function of the three results it reads. */
function computeVerdict(block: string, c: VerdictCase): unknown {
  const run = new Function('reviewResult', 'gate1Final', 'gate2', `${block}\nreturn overallVerdict;`) as (
    reviewResult: unknown,
    gate1Final: unknown,
    gate2: unknown,
  ) => unknown
  return run(
    {
      survivingFindings: Array.from({ length: c.surviving }, (_, i) => ({ description: `finding ${i}` })),
      fixedFindings: [],
      coverageGaps: [...c.coverageGaps],
    },
    { verdict: c.gate1Final },
    { evaluateVerdict: c.evaluateVerdict, testVerdict: c.testVerdict },
  )
}

/** Named collector: every row of `table` the verdict block computes wrongly (or cannot compute). */
export function collectVerdictTableViolations(block: string | null, table: readonly VerdictCase[]): string[] {
  if (block === null) return ['verdict block not found (coverageGaps … overallVerdict)']
  return table.flatMap(c => {
    let got: unknown
    try {
      got = computeVerdict(block, c)
    } catch (err) {
      return [`${c.label}: the block threw ${String(err)}`]
    }
    return got === c.expected ? [] : [`${c.label}: expected ${c.expected}, got ${String(got)}`]
  })
}

/** The `d09da34` verdict block, verbatim: it never reads `gate2`. */
const D09DA34_VERDICT_BLOCK = [
  'const coverageGaps = reviewResult.coverageGaps || [];',
  'const overallVerdict = (reviewResult.survivingFindings?.length || 0) === 0 && coverageGaps.length === 0 && gate1Final.verdict !== "ESCALATED" ? "PASS" : "PARTIAL";',
].join('\n')

describe('overallVerdict — a FAIL-FIXED Gate 2 verdict reports UNVERIFIED, never PASS', () => {
  const block = SCRIPT === null ? null : extractVerdictBlock(SCRIPT)

  it('the verdict block is found and still carries the C2 PASS condition', () => {
    expect(block, 'the coverageGaps … overallVerdict block must be extractable').not.toBeNull()
    expect(block, 'build-mds C2 pins this substring; the fix keeps it').toContain('coverageGaps.length === 0')
    expect(block, 'the verdict must read Gate 2').toContain('gate2')
  })

  it('the table covers every verdict the run can report', () => {
    expect(new Set(VERDICT_TABLE.map(c => c.expected))).toEqual(new Set(['PASS', 'UNVERIFIED', 'PARTIAL']))
    expect(VERDICT_TABLE.filter(c => c.expected === 'UNVERIFIED').length).toBeGreaterThanOrEqual(4)
  })

  it('the shipped block computes every row of the table', () => {
    expect(collectVerdictTableViolations(block, VERDICT_TABLE)).toEqual([])
  })

  it('known-bad probe: the d09da34 block reports PASS for every FAIL-FIXED row, and only those', () => {
    const unverifiedRows = VERDICT_TABLE.filter(c => c.expected === 'UNVERIFIED')
    expect(collectVerdictTableViolations(D09DA34_VERDICT_BLOCK, VERDICT_TABLE)).toEqual(
      unverifiedRows.map(c => `${c.label}: expected UNVERIFIED, got PASS`),
    )
  })

  it('known-bad probe: a block the collector cannot find is reported, not passed', () => {
    expect(collectVerdictTableViolations(null, VERDICT_TABLE)).toHaveLength(1)
    expect(extractVerdictBlock(`${D09DA34_VERDICT_BLOCK}\n${D09DA34_VERDICT_BLOCK}`), 'a duplicated block is ambiguous').toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Where the run reports UNVERIFIED
// ---------------------------------------------------------------------------

/** The Report prompt's Gate 2 instruction, in the SINGLE skeleton. */
const REPORT_RULE = 'render FAIL-FIXED as "UNVERIFIED (fixes applied, not re-run)", never PASS'

/** The sentence both FAIL-FIXED paths of the gate2_acceptance doctrine end with. */
const DOCTRINE_RULE = 'In SINGLE mode the run reports it as `UNVERIFIED`, never PASS.'

/** The rendered gate2_acceptance doctrine: from its heading to the next `### `. */
function gate2Doctrine(built: string): string {
  const at = built.indexOf('### GATE 2 — Acceptance gate')
  if (at === -1) return ''
  const end = built.indexOf('\n### ', at + 1)
  return end === -1 ? built.slice(at) : built.slice(at, end)
}

/** The doctrine's two FAIL-FIXED paths, each named by the bullet that opens it. */
const DOCTRINE_FAIL_FIXED_PATHS = [
  ['doctrine Evaluate', '- If any critical lens returns MISALIGNED'],
  ['doctrine Test', '- FAIL → fix-and-continue'],
] as const

/**
 * Named collector: the report sites that do not say FAIL-FIXED is UNVERIFIED.
 * Three sites: the Report prompt, and the Evaluate and Test FAIL-FIXED paths
 * of the rendered Gate 2 doctrine (each must be exactly one bullet).
 */
export function collectUnverifiedReportViolations(built: string): string[] {
  const out: string[] = []
  const script = singleModeScript(built)
  const reportAt = script === null ? -1 : script.indexOf('return phase("report"')
  if (reportAt === -1 || !script!.slice(reportAt).includes(REPORT_RULE)) {
    out.push('report prompt: FAIL-FIXED is not rendered as UNVERIFIED')
  }
  const doctrineLines = gate2Doctrine(built).split('\n')
  for (const [site, bullet] of DOCTRINE_FAIL_FIXED_PATHS) {
    const paths = doctrineLines.filter(l => l.startsWith(bullet))
    if (paths.length !== 1 || !paths[0].includes(DOCTRINE_RULE)) {
      out.push(`${site}: its FAIL-FIXED path does not report UNVERIFIED (${paths.length} bullet(s) found)`)
    }
  }
  return out
}

describe('the run report — FAIL-FIXED is presented as UNVERIFIED', () => {
  it('the Report prompt and both doctrine FAIL-FIXED paths say so', () => {
    expect(gate2Doctrine(BUILT).length, 'the rendered Gate 2 doctrine must be found').toBeGreaterThan(500)
    expect(collectUnverifiedReportViolations(BUILT)).toEqual([])
  })

  for (const [site, rule] of [
    ['report prompt', REPORT_RULE],
    ['doctrine Evaluate', DOCTRINE_RULE],
    ['doctrine Test', DOCTRINE_RULE],
  ] as const) {
    it(`known-bad probe: removing the rule from the ${site} is reported, exactly once`, () => {
      // Seed a copy: drop the rule from this site only. The doctrine rule occurs
      // twice (Evaluate first, Test second), so pick the occurrence by site.
      const hits = offsetsOf(BUILT, rule)
      expect(hits, `the ${site} rule must occur where the collector looks`).toHaveLength(rule === REPORT_RULE ? 1 : 2)
      const at = site === 'doctrine Test' ? hits[1] : hits[0]
      const seeded = BUILT.slice(0, at) + BUILT.slice(at + rule.length)
      const violations = collectUnverifiedReportViolations(seeded)
      expect(violations, violations.join('\n')).toEqual([expect.stringMatching(new RegExp(`^${site}:`))])
    })
  }
})
