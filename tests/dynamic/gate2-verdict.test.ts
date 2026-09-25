/**
 * SDLC-evidence PR2 (#360), phase P3 — /dynamic-build's Gate 2 in SINGLE mode.
 *
 * Two defects in the authored workflow skeleton:
 *
 * 1. `args.testPlan` never reached the Test agent. /devflow:dynamic-plan writes a
 *    test plan for Gate 2, but the skeleton declared no constant for it, gated
 *    the Test spawn on criteria alone and put nothing of the plan in its prompt.
 * 2. `overallVerdict` ignored Gate 2. A `FAIL-FIXED` verdict — issues found,
 *    fixes applied, never re-evaluated or re-run — was reported as **PASS**.
 *    The run now reports it as `UNVERIFIED`; surviving findings, coverage gaps
 *    and an escalated final gate still report `PARTIAL`.
 *
 * WAVE mode's merge rule (`_wave.mds`: "On engine PASS: merge") is untouched, and
 * the wave skeleton merges an UNVERIFIED ticket exactly as it merged the PASS that
 * a FAIL-FIXED Gate 2 used to report (plan delta 11; section 5 executes it).
 *
 * Every guard has the three parts PF-064 asks of an absence-based check: a NAMED
 * collector, an assertion that the text it read is the text it claims to read,
 * and known-bad probes that drive the SAME collector over the `d09da34`
 * spellings — the verdict block quoted verbatim, and one seed per guarded site
 * restoring its d09da34 wording, so probe cardinality equals arm cardinality.
 *
 * The verdict and the Gate 2 routing are checked by EXECUTING the shipped
 * skeleton's own text with stubbed `phase`/`agent`/`parallel`: a wording pin
 * would stay green over an expression that computes the wrong answer.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

import { PR_EVIDENCE_SCRIPT } from '../evidence/seam.js'
import {
  collectOrderViolations,
  parseFences,
  requireDistFile,
  resolveAgentSource,
  type OrderRule,
} from '../helpers.js'

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

/** Replace the single occurrence of `from`; throws when there is none or several — an inert seed proves nothing. */
function seedOnce(text: string, from: string, to: string): string {
  const hits = offsetsOf(text, from).length
  if (hits !== 1) throw new Error(`seedOnce: expected exactly one "${from}", found ${hits} — the seed is inert`)
  return text.replace(from, () => to)
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

// ---------------------------------------------------------------------------
// 3. TEST_PLAN reaches the Test agent (AC-11)
// ---------------------------------------------------------------------------
//
// Since #365 (PR6 AC-3) TEST_PLAN is the plan's checked TP lines, one string, and
// the spawn key carries it as it is: the `test-spawn key` site's shipped spelling
// moved from the d9d1c8e `JSON.stringify` form, which section 4 keeps as a probe.

const TEST_PLAN_DECLARATION = 'const TEST_PLAN = args.testPlan'
const GATE2_OPEN = 'const gate2 = await phase("gate2", async () => {'
const REVIEW_OPEN = 'const reviewResult = await phase("review"'
const TEST_SPAWN_CLOSE = '{ agentType: "Test" })'
const TEST_PLAN_KEY = 'TEST_PLAN: ${'
const TEST_PLAN_COVERAGE = 'cover every TEST_PLAN scenario'
/** Gate 2's early return: the code the skip guard governs. */
const GATE2_SKIP_RETURN = 'return { evaluateVerdict: "SKIPPED", testVerdict: "SKIPPED"'

/** The `const gate2 = await phase("gate2", …)` statement, up to the review phase; null unless both anchors are unique. */
function gate2Statement(script: string): string | null {
  const open = offsetsOf(script, GATE2_OPEN)
  const close = offsetsOf(script, REVIEW_OPEN)
  if (open.length !== 1 || close.length !== 1 || close[0] < open[0]) return null
  return script.slice(open[0], close[0])
}

/** Every Test agent call in `text`, from its `agent(\`` to its options object. */
function testSpawnCalls(text: string): Array<{ call: string; at: number }> {
  return offsetsOf(text, TEST_SPAWN_CLOSE).map(end => {
    const at = text.lastIndexOf('agent(`', end)
    return { call: text.slice(at === -1 ? 0 : at, end + TEST_SPAWN_CLOSE.length), at }
  })
}

/** The last `if (` line before `offset`: the condition that governs the code at `offset`. */
function governingCondition(text: string, offset: number): string | null {
  const conditions = text
    .slice(0, offset)
    .split('\n')
    .filter(l => l.trimStart().startsWith('if ('))
  return conditions.length === 0 ? null : conditions[conditions.length - 1].trim()
}

/**
 * Named collector: the sites where the SINGLE skeleton stops a test plan short
 * of the Test agent. Five sites: the declaration (before Gate 2 reads it), the
 * Gate 2 skip guard, the Test gate, the spawn's `TEST_PLAN:` key, and its
 * instruction to cover every scenario.
 */
export function collectTestPlanWiringViolations(script: string | null): string[] {
  if (script === null) return ['script: the SINGLE-mode workflow fence was not found']
  const order: readonly OrderRule[] = [
    { label: 'TEST_PLAN is bound before Gate 2 reads it', before: TEST_PLAN_DECLARATION, after: GATE2_OPEN },
  ]
  const out = collectOrderViolations('dynamic-build.md', script, order).map(v => `declaration: ${v}`)
  const gate2 = gate2Statement(script)
  if (gate2 === null) return [...out, 'gate2: the phase("gate2") statement was not found']

  const skipReturn = gate2.indexOf(GATE2_SKIP_RETURN)
  const skipGuard = skipReturn === -1 ? null : governingCondition(gate2, skipReturn)
  if (skipGuard === null || !skipGuard.includes('!TEST_PLAN')) {
    out.push(`skip-guard: Gate 2 is skipped while a test plan is present (${skipGuard})`)
  }

  const spawns = testSpawnCalls(gate2)
  if (spawns.length === 0) return [...out, 'test-spawn: no Test agent call inside phase("gate2")']
  for (const { call, at } of spawns) {
    const gate = governingCondition(gate2, at)
    if (gate === null || !gate.includes('TEST_PLAN')) out.push(`test-gate: the Test agent runs only on criteria (${gate})`)
    if (!call.includes(TEST_PLAN_KEY)) out.push('test-spawn key: the Test prompt carries no TEST_PLAN:')
    if (!call.includes(TEST_PLAN_COVERAGE)) out.push(`test-spawn coverage: the Test prompt does not say "${TEST_PLAN_COVERAGE}"`)
  }
  return out
}

/**
 * One reverse seed per guarded site: the shipped spelling and its `d09da34`
 * spelling, quoted verbatim. Applied together they restore the d09da34 shape
 * of every guarded site.
 */
const D09DA34_WIRING_SEEDS: ReadonlyArray<{ readonly site: string; readonly shipped: string; readonly d09da34: string }> = [
  {
    site: 'declaration',
    shipped: 'const TEST_PLAN = args.testPlan || null;  // the plan\'s checked TP lines, one string (Pre-authoring step 4)\n',
    d09da34: '',
  },
  { site: 'skip-guard', shipped: '  if (!PLAN && !CRITERIA && !TEST_PLAN) {', d09da34: '  if (!PLAN && !CRITERIA) {' },
  { site: 'test-gate', shipped: '  if (CRITERIA || TEST_PLAN) {', d09da34: '  if (CRITERIA) {' },
  {
    site: 'test-spawn key',
    // #365: the key carries the checked TP lines as they are — a string, never JSON.
    shipped: '\nTEST_PLAN: ${TEST_PLAN || "(none)"}\n',
    d09da34: '\n',
  },
  {
    site: 'test-spawn coverage',
    shipped: 'Cover: functionality, API contracts, performance, and cover every TEST_PLAN scenario. Report: PASS or FAIL per scenario.',
    d09da34: 'Cover: functionality, API contracts, performance. Report: PASS or FAIL per scenario.',
  },
]

/** The shipped script with every reverse seed applied. */
function d09da34Wiring(script: string): string {
  return D09DA34_WIRING_SEEDS.reduce((text, s) => seedOnce(text, s.shipped, s.d09da34), script)
}

describe('TEST_PLAN — /devflow:dynamic-plan\'s test plan reaches the Test agent', () => {
  it('every wiring site is present in the shipped skeleton', () => {
    expect(collectTestPlanWiringViolations(SCRIPT)).toEqual([])
  })

  it('the Test spawn inside phase("gate2") is found — the per-call checks are not vacuous', () => {
    const gate2 = gate2Statement(SCRIPT!)
    expect(gate2, 'the phase("gate2") statement must be extractable').not.toBeNull()
    expect(testSpawnCalls(gate2!)).toHaveLength(1)
  })

  it('probe cardinality equals site cardinality: one reverse seed per guarded site', () => {
    const sites = D09DA34_WIRING_SEEDS.map(s => s.site)
    expect(sites).toEqual(['declaration', 'skip-guard', 'test-gate', 'test-spawn key', 'test-spawn coverage'])
  })

  for (const seed of D09DA34_WIRING_SEEDS) {
    it(`known-bad probe: the d09da34 ${seed.site} alone is reported, exactly once`, () => {
      const seeded = seedOnce(SCRIPT!, seed.shipped, seed.d09da34)
      const violations = collectTestPlanWiringViolations(seeded)
      expect(violations, violations.join('\n')).toHaveLength(1)
      expect(violations[0].startsWith(seed.site)).toBe(true)
    })
  }

  it('known-bad probe: all five d09da34 sites together are all reported, and carry no TEST_PLAN at all', () => {
    const d09 = d09da34Wiring(SCRIPT!)
    expect(gate2Statement(d09), 'd09da34 Gate 2 never named a test plan').not.toContain('TEST_PLAN')
    expect(collectTestPlanWiringViolations(d09).map(v => v.split(':')[0])).toEqual([
      'declaration',
      'skip-guard',
      'test-gate',
      'test-spawn key',
      'test-spawn coverage',
    ])
  })

  it('the Test agent declares TEST_PLAN in its Input Context', () => {
    const test = resolveAgentSource('test').content
    const inputs = test.slice(test.indexOf('## Input Context'), test.indexOf('## Responsibilities'))
    expect(inputs.length, 'the Input Context section must be found').toBeGreaterThan(100)
    expect(inputs).toContain('- **TEST_PLAN**:')
  })
})

// ---------------------------------------------------------------------------
// 4. Gate 2 routing, executed
// ---------------------------------------------------------------------------

interface Spawn {
  readonly agentType: string
  readonly prompt: string
}

interface Gate2Result {
  readonly evaluateVerdict: string
  readonly testVerdict: string
}

interface Gate2Inputs {
  readonly plan: string | null
  readonly criteria: string | null
  /** The plan's checked TP lines, one string (#365). */
  readonly testPlan: string | null
}

type AsyncFn = (...args: unknown[]) => Promise<unknown>
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...params: string[]) => AsyncFn

/**
 * Run the shipped `phase("gate2")` statement with stub agents. Evaluate agents
 * pass; the Test agent returns `testVerdict`; every spawn is recorded.
 */
async function runGate2(
  statement: string,
  inputs: Gate2Inputs,
  testVerdict: 'PASS' | 'FAIL',
): Promise<{ gate2: Gate2Result; spawns: Spawn[] }> {
  const spawns: Spawn[] = []
  const agent = async (prompt: string, opts: { agentType: string }): Promise<object> => {
    spawns.push({ agentType: opts.agentType, prompt })
    if (opts.agentType === 'Test') return { verdict: testVerdict, failures: 'TP-1 failed' }
    return { verdict: 'PASS', status: 'fixed' }
  }
  const phase = async (_name: string, fn: () => Promise<unknown>): Promise<unknown> => fn()
  const parallel = async (thunks: Array<() => Promise<unknown>>): Promise<unknown[]> => Promise.all(thunks.map(t => t()))
  const run = new AsyncFunction(
    'phase', 'agent', 'parallel', 'BRANCH', 'PLAN', 'CRITERIA', 'TEST_PLAN', 'ISSUE_NUMBER', 'ISSUE_PR_LINK',
    `${statement}\nreturn gate2;`,
  )
  const gate2 = (await run(
    phase, agent, parallel, 'ticket/p3', inputs.plan, inputs.criteria, inputs.testPlan, '(none)', '(none)',
  )) as Gate2Result
  return { gate2, spawns }
}

/**
 * A checked test plan as /devflow:dynamic-build passes it since #365: the plan's
 * `## Test Plan` TP lines, one string. The first routing arm below holds that the
 * script's own grammar admits it.
 */
const TEST_PLAN_FIXTURE = [
  '- [ ] TP-1 (AC-1) a cycle-2 run posts its summary — method:ci',
  '- [ ] TP-2 (AC-2) a repeated run posts nothing new — method:local [files: src/**]',
].join('\n')

interface RoutingCase {
  readonly label: string
  readonly inputs: Gate2Inputs
  readonly testVerdict: 'PASS' | 'FAIL'
  readonly check: (r: { gate2: Gate2Result; spawns: Spawn[] }) => string | null
}

const testSpawns = (spawns: Spawn[]): Spawn[] => spawns.filter(s => s.agentType === 'Test')

/** Gate 2's routing over its inputs: which agents run, what the Test agent is told, what Gate 2 records. */
const ROUTING_TABLE: readonly RoutingCase[] = [
  {
    label: 'a test plan alone runs the Test agent with the plan',
    inputs: { plan: null, criteria: null, testPlan: TEST_PLAN_FIXTURE },
    testVerdict: 'PASS',
    check: ({ gate2, spawns }) => {
      const tests = testSpawns(spawns)
      if (tests.length !== 1) return `expected one Test spawn, got ${tests.length} (testVerdict ${gate2.testVerdict})`
      if (!tests[0].prompt.includes(`TEST_PLAN: ${TEST_PLAN_FIXTURE}\n`)) return 'the Test prompt does not carry the TP lines as they are'
      return gate2.testVerdict === 'PASS' ? null : `testVerdict ${gate2.testVerdict}`
    },
  },
  {
    label: 'criteria alone run the Test agent and name no test plan',
    inputs: { plan: null, criteria: '1. posts on cycle 2', testPlan: null },
    testVerdict: 'PASS',
    check: ({ spawns }) => {
      const tests = testSpawns(spawns)
      if (tests.length !== 1) return `expected one Test spawn, got ${tests.length}`
      if (!tests[0].prompt.includes('1. posts on cycle 2')) return 'the Test prompt lost the criteria'
      return tests[0].prompt.includes('TEST_PLAN: (none)') ? null : 'the Test prompt does not say TEST_PLAN: (none)'
    },
  },
  {
    label: 'no plan, criteria or test plan skips Gate 2 entirely',
    inputs: { plan: null, criteria: null, testPlan: null },
    testVerdict: 'PASS',
    check: ({ gate2, spawns }) =>
      spawns.length === 0 && gate2.evaluateVerdict === 'SKIPPED' && gate2.testVerdict === 'SKIPPED'
        ? null
        : `expected no spawns and SKIPPED/SKIPPED, got ${spawns.length} spawns and ${gate2.evaluateVerdict}/${gate2.testVerdict}`,
  },
  {
    label: 'a failing test-plan run is fixed and recorded FAIL-FIXED',
    inputs: { plan: null, criteria: null, testPlan: TEST_PLAN_FIXTURE },
    testVerdict: 'FAIL',
    check: ({ gate2, spawns }) =>
      gate2.testVerdict === 'FAIL-FIXED' && spawns.some(s => s.agentType === 'Code')
        ? null
        : `expected FAIL-FIXED after a Code fix, got ${gate2.testVerdict}`,
  },
]

/** Named collector: every routing row the Gate 2 statement gets wrong. */
export async function collectGate2RoutingViolations(statement: string | null): Promise<string[]> {
  if (statement === null) return ['the phase("gate2") statement was not found']
  const out: string[] = []
  for (const row of ROUTING_TABLE) {
    const problem = row.check(await runGate2(statement, row.inputs, row.testVerdict))
    if (problem !== null) out.push(`${row.label}: ${problem}`)
  }
  return out
}

describe('Gate 2 routing, executed over the shipped statement', () => {
  it('the test-plan fixture is a real TP plan: pr-evidence.cjs parsePlan admits it', () => {
    const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as { parsePlan(text: unknown): { ok: boolean } }
    expect(PE.parsePlan(TEST_PLAN_FIXTURE).ok).toBe(true)
  })

  it('every routing row holds', async () => {
    expect(await collectGate2RoutingViolations(gate2Statement(SCRIPT!))).toEqual([])
  })

  it('end to end: a test plan whose run fails and is fixed makes the run UNVERIFIED, not PASS', async () => {
    const { gate2 } = await runGate2(gate2Statement(SCRIPT!)!, ROUTING_TABLE[0].inputs, 'FAIL')
    const block = extractVerdictBlock(SCRIPT!)!
    const run = new Function('reviewResult', 'gate1Final', 'gate2', `${block}\nreturn overallVerdict;`) as (
      ...args: unknown[]
    ) => unknown
    expect(run({ survivingFindings: [], fixedFindings: [], coverageGaps: [] }, { verdict: 'PASS' }, gate2)).toBe('UNVERIFIED')
  })

  it('known-bad probe: the d9d1c8e key JSON-encodes the TP lines instead of passing them', async () => {
    const statement = gate2Statement(SCRIPT!)!
    const d9d1c8e = seedOnce(statement, 'TEST_PLAN: ${TEST_PLAN || "(none)"}', 'TEST_PLAN: ${TEST_PLAN ? JSON.stringify(TEST_PLAN) : "(none)"}')
    expect(await collectGate2RoutingViolations(d9d1c8e)).toEqual([
      'a test plan alone runs the Test agent with the plan: the Test prompt does not carry the TP lines as they are',
    ])
  })

  it('known-bad probe: the d09da34 Gate 2 drops a test plan and never tells the Test agent about one', async () => {
    const d09 = gate2Statement(d09da34Wiring(SCRIPT!))
    expect((await collectGate2RoutingViolations(d09)).map(v => v.split(':')[0])).toEqual([
      'a test plan alone runs the Test agent with the plan',
      'criteria alone run the Test agent and name no test plan',
      'a failing test-plan run is fixed and recorded FAIL-FIXED',
    ])
  })
})

// ---------------------------------------------------------------------------
// 5. WAVE mode merges exactly what it merged before (plan delta 11)
// ---------------------------------------------------------------------------
//
// The wave loop reads the SINGLE skeleton's `overallVerdict` alias, so the new
// UNVERIFIED reaches its merge check. Before #360 a FAIL-FIXED Gate 2 reported
// PASS and merged; a `=== "PASS"` check over the new alias would quarantine it
// instead — and cascade-block its dependents under the reason "engine
// fail/escalated". Whether an UNVERIFIED ticket should merge is the wave merge
// rule's decision, not this PR's, so the wave keeps merging it.

const WAVE_ENGINE_CALL = 'const engineResult = await runSingleTicketEngine('

/** The wave skeleton's merge condition — the first `if (…) {` after the engine call — or null. */
export function extractWaveMergeCondition(built: string): string | null {
  const fences = parseFences(built).filter(f => f.includes(WAVE_ENGINE_CALL))
  if (fences.length !== 1) return null
  const lines = fences[0].split('\n')
  const at = lines.findIndex(l => l.includes(WAVE_ENGINE_CALL))
  const test = lines.slice(at + 1).find(l => /^\s*if \(/.test(l))
  return test?.match(/^\s*if \((.*)\) \{\s*$/)?.[1] ?? null
}

interface WaveMergeCase {
  readonly label: string
  readonly engineResult: Readonly<Record<string, string>>
  readonly merge: boolean
}

const WAVE_MERGE_TABLE: readonly WaveMergeCase[] = [
  { label: 'schema verdict PASS', engineResult: { verdict: 'PASS' }, merge: true },
  { label: 'SINGLE alias PASS', engineResult: { overallVerdict: 'PASS' }, merge: true },
  { label: 'SINGLE alias UNVERIFIED (a FAIL-FIXED Gate 2)', engineResult: { overallVerdict: 'UNVERIFIED' }, merge: true },
  { label: 'SINGLE alias PARTIAL', engineResult: { overallVerdict: 'PARTIAL' }, merge: false },
  { label: 'schema verdict FAIL', engineResult: { verdict: 'FAIL' }, merge: false },
  { label: 'schema verdict ESCALATED', engineResult: { verdict: 'ESCALATED' }, merge: false },
  { label: 'no verdict at all', engineResult: {}, merge: false },
]

/** Named collector: every row the wave's merge condition decides wrongly (or cannot decide). */
export function collectWaveMergeViolations(condition: string | null): string[] {
  if (condition === null) return ['wave merge condition not found (the first if after runSingleTicketEngine)']
  const decide = new Function('engineResult', `return (${condition});`) as (engineResult: unknown) => unknown
  return WAVE_MERGE_TABLE.flatMap(row =>
    Boolean(decide(row.engineResult)) === row.merge ? [] : [`${row.label}: expected ${row.merge ? 'merge' : 'quarantine'}`])
}

/** The `d09da34` merge condition, verbatim. */
const D09DA34_WAVE_CONDITION = '(engineResult.verdict || engineResult.overallVerdict) === "PASS"'

describe('WAVE mode — a FAIL-FIXED ticket still merges (plan delta 11)', () => {
  it('the shipped merge condition is found and decides every row', () => {
    const condition = extractWaveMergeCondition(BUILT)
    expect(condition, 'exactly one wave skeleton with a merge condition').not.toBeNull()
    expect(collectWaveMergeViolations(condition)).toEqual([])
  })

  it('known-bad probe: the d09da34 condition quarantines the UNVERIFIED alias, and only it', () => {
    expect(collectWaveMergeViolations(D09DA34_WAVE_CONDITION)).toEqual([
      'SINGLE alias UNVERIFIED (a FAIL-FIXED Gate 2): expected merge',
    ])
  })

  it('known-bad probe: a skeleton the collector cannot read is reported, not passed', () => {
    expect(collectWaveMergeViolations(extractWaveMergeCondition('no fences here'))).toHaveLength(1)
  })
})
