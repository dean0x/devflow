/**
 * SDLC-evidence PR6 (#365), phase P1 — /devflow:dynamic-plan's test plan is TP lines.
 *
 * Before #365 the plan-challenge step returned `testPlan` as an array of
 * `{scenario, setup, …}` objects, /devflow:dynamic-build `JSON.stringify`d it into
 * the Test prompt, and test.md accepted "a scenario list" beside TP lines. Nothing
 * of it could reach the TP-line contract, so no wave test-plan block could exist.
 *
 *   AC-2  The challenger writes TP lines (`testPlan`) under the injected TP
 *         contract, and each TP's setup and outcome apart (`testScenarios`); Phase 6
 *         writes `## Test Plan` with those lines verbatim and nothing else, then
 *         `## Test Scenarios`; after the workflow each plan's `## Test Plan`
 *         SECTION is checked with `check tp` (a whole plan file cannot be — the
 *         arm below runs the real script to show why), and a failure names the
 *         plan `test plan malformed (<code>)`, unrepaired. The contract states the
 *         test plan IS TP lines. No JSON test-plan shape remains in dynamic-plan,
 *         dynamic-build or the Test agent.
 *   AC-3  /dynamic-build passes `testPlan` only after `check tp` exits 0, as one
 *         string (the Gate 2 wiring and routing guards live in gate2-verdict.test.ts).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064); each probe restores the d9d1c8e
 * spelling of the site it guards.
 *
 * NOT covered: whether a challenger at runtime obeys the injected contract — that
 * is what the post-workflow `check tp` exists for; this suite pins that the check
 * is there, and that nothing downstream accepts an unchecked plan.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { ROOT, parseFences, requireDistFile, resolveAgentSource } from '../helpers.js'
import { VERIFY_EVIDENCE_SCRIPT } from '../evidence/seam.js'

interface TextFile {
  readonly name: string
  readonly content: string
}

const PLAN_BUILT = requireDistFile('dynamic-plan.md')
const BUILD_BUILT = requireDistFile('dynamic-build.md')
const TEST_AGENT = resolveAgentSource('test').content
const CONTRACT_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_plan_contract.mds'), 'utf-8')

/** The one spelling every command uses to run the check (plan.mds and implement.mds share it). */
const CHECK_TP = 'node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/verify-evidence.cjs" check tp <that file>; echo "exit=$?"'

/** Every start offset of a non-empty `needle` in `text`. */
function offsetsOf(text: string, needle: string): number[] {
  const out: number[] = []
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) out.push(at)
  return out
}

/** Replace the single occurrence of `from`; throws when there is none or several — an inert seed proves nothing. */
function seedOnce(text: string, from: string, to: string): string {
  const hits = offsetsOf(text, from).length
  if (hits !== 1) throw new Error(`seedOnce: expected exactly one "${from.slice(0, 80)}", found ${hits} — the seed is inert`)
  return text.replace(from, () => to)
}

/** `text` from `start` up to (not including) `end`, or null unless each anchor occurs exactly once, in order. */
function between(text: string, start: string, end: string): string | null {
  const a = offsetsOf(text, start)
  const b = offsetsOf(text, end)
  if (a.length !== 1 || b.length !== 1 || b[0] < a[0]) return null
  return text.slice(a[0], b[0])
}

// ---------------------------------------------------------------------------
// AC-2 — no JSON test-plan shape survives in the three consumers
// ---------------------------------------------------------------------------

/**
 * The legacy shape's tokens: its two object keys only it ever had (`scenario` and
 * `setup` are ordinary words, and `setup` is still a testScenarios field), the
 * Test agent's old "scenario list" input, the stringify that fed it, and the
 * object-array type the challenger returned.
 */
const LEGACY_SHAPES = ['verificationMethod', 'expectedOutcome', 'scenario list', 'JSON.stringify(TEST_PLAN)', 'testPlan (array of {'] as const

/** Named collector: every legacy test-plan token in each file, as `file: token`. */
export function collectLegacyTestPlanShapes(files: readonly TextFile[]): string[] {
  return files.flatMap(f => LEGACY_SHAPES.filter(t => f.content.includes(t)).map(t => `${f.name}: ${t}`))
}

const CONSUMERS: readonly TextFile[] = [
  { name: 'dynamic-plan.md', content: PLAN_BUILT },
  { name: 'dynamic-build.md', content: BUILD_BUILT },
  { name: 'agents/test.md', content: TEST_AGENT },
]

/** Each consumer's d9d1c8e spelling of its legacy site, and what it says now. */
const D9D1C8E_LEGACY_SITES: ReadonlyArray<{ readonly file: string; readonly shipped: string; readonly d9d1c8e: string }> = [
  {
    file: 'dynamic-plan.md',
    shipped: 'testPlan (array of TP-line strings, TP-1 first), testScenarios (array of {tp, setup, outcome})',
    d9d1c8e: 'testPlan (array of {scenario, setup, expectedOutcome, verificationMethod})',
  },
  {
    file: 'dynamic-build.md',
    shipped: 'TEST_PLAN: ${TEST_PLAN || "(none)"}',
    d9d1c8e: 'TEST_PLAN: ${TEST_PLAN ? JSON.stringify(TEST_PLAN) : "(none)"}',
  },
  {
    file: 'agents/test.md',
    shipped: 'TP lines from /plan, /implement, /resolve or /devflow:dynamic-plan (if any)',
    d9d1c8e: 'TP lines from /plan, /implement or /resolve, or a scenario list from /devflow:dynamic-plan (if any)',
  },
]

describe('AC-2: no JSON test-plan shape in dynamic-plan, dynamic-build or the Test agent', () => {
  it('the corpus is the three real consumers', () => {
    expect(PLAN_BUILT).toContain('phase("plan-challenge"')
    expect(BUILD_BUILT).toContain('const TEST_PLAN = args.testPlan')
    expect(TEST_AGENT).toContain('- **TEST_PLAN**:')
    for (const f of CONSUMERS) expect(f.content.length, f.name).toBeGreaterThan(3000)
  })

  it('none of them carries a legacy token', () => {
    expect(collectLegacyTestPlanShapes(CONSUMERS)).toEqual([])
  })

  for (const site of D9D1C8E_LEGACY_SITES) {
    it(`known-bad probe: the d9d1c8e ${site.file} site is reported`, () => {
      const seeded = CONSUMERS.map(f => (f.name === site.file ? { ...f, content: seedOnce(f.content, site.shipped, site.d9d1c8e) } : f))
      const hits = collectLegacyTestPlanShapes(seeded)
      expect(hits.length, hits.join('\n')).toBeGreaterThan(0)
      expect(hits.every(h => h.startsWith(`${site.file}: `))).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// AC-2 — the plan-challenge step writes TP lines
// ---------------------------------------------------------------------------

/** The built dynamic-plan workflow fence. */
function planScript(built: string): string | null {
  const hits = parseFences(built).filter(f => f.includes('name: "devflow-dynamic-plan"'))
  return hits.length === 1 ? hits[0] : null
}

const CHALLENGE_OPEN = 'const challenged = await phase("plan-challenge"'
const CRITIC_OPEN = 'const crossCritic = await phase("cross-plan-critic"'
const WRITE_OPEN = 'return phase("write-artifacts"'

/** What the challenger must be told and asked for — one row per guarded site. */
const CHALLENGER_SITES: ReadonlyArray<{ readonly site: string; readonly needle: string }> = [
  { site: 'contract', needle: '${TP_CONTRACT}' },
  { site: 'numbering', needle: 'as TP lines, numbered from TP-1, at least one per criterion' },
  { site: 'ac mapping', needle: 'the number of the criterion it covers is its (AC-m)' },
  { site: 'method mapping', needle: 'a test committed to the suite is ci; a command run and read (a load test, a script) is local; a step performed and observed is manual' },
  { site: 'files mapping', needle: 'the paths it exercises, from the plan\'s affected files, are its files: globs' },
  { site: 'scenario text', needle: 'is the line\'s scenario text — never a path, a reference, a mention or markup' },
  { site: 'setup apart', needle: 'Setup and expected outcome never go in a line: give them per TP in testScenarios' },
  { site: 'return', needle: 'testPlan (array of TP-line strings, TP-1 first), testScenarios (array of {tp, setup, outcome})' },
]

/**
 * Named collector: the challenger sites missing from the plan-challenge statement,
 * plus the contract's injection point — declared before the statement reads it.
 */
export function collectChallengerDefects(built: string): string[] {
  const script = planScript(built)
  if (script === null) return ['script: the dynamic-plan workflow fence was not found']
  const statement = between(script, CHALLENGE_OPEN, CRITIC_OPEN)
  if (statement === null) return ['statement: phase("plan-challenge") was not found']
  const out = CHALLENGER_SITES.filter(s => !statement.includes(s.needle)).map(s => `${s.site}: missing`)
  const declared = script.indexOf('const TP_CONTRACT = args.tpContract')
  if (declared === -1 || declared > script.indexOf(CHALLENGE_OPEN)) out.push('injection: TP_CONTRACT is not declared before Phase 3')
  return out
}

describe('AC-2: the plan-challenge step writes TP lines under the injected contract', () => {
  it('every challenger site is present', () => {
    expect(between(planScript(PLAN_BUILT) ?? '', CHALLENGE_OPEN, CRITIC_OPEN)?.length ?? 0, 'the statement is found').toBeGreaterThan(1000)
    expect(collectChallengerDefects(PLAN_BUILT)).toEqual([])
  })

  for (const s of CHALLENGER_SITES) {
    it(`known-bad probe: dropping the ${s.site} site is reported, exactly once`, () => {
      expect(collectChallengerDefects(seedOnce(PLAN_BUILT, s.needle, ''))).toEqual([`${s.site}: missing`])
    })
  }

  it('known-bad probe: an undeclared contract is reported', () => {
    const seeded = PLAN_BUILT.replace('const TP_CONTRACT = args.tpContract', 'const TP_CONTRACT_X = args.tpContract')
    expect(collectChallengerDefects(seeded)).toEqual(['injection: TP_CONTRACT is not declared before Phase 3'])
  })

  it('the injected text is the contract the command carries: its define names the paragraph to paste', () => {
    const script = planScript(PLAN_BUILT) ?? ''
    const decl = script.split('\n').find(l => l.startsWith('const TP_CONTRACT = ')) ?? ''
    expect(decl).toContain('"Test-plan line (TP)"')
    expect(PLAN_BUILT).toContain('**Test-plan line (TP).**')
  })
})

/** Named collector: what Phase 6 fails to write, in order, about the two test-plan sections. */
export function collectArtifactDefects(built: string): string[] {
  const script = planScript(built)
  const at = script === null ? -1 : script.indexOf(WRITE_OPEN)
  if (at === -1) return ['statement: phase("write-artifacts") was not found']
  const lines = script!.slice(at).split('\n')
  const out: string[] = []
  const plan = lines.findIndex(l => l.startsWith('- ## Test Plan'))
  const scenarios = lines.findIndex(l => l.startsWith('- ## Test Scenarios'))
  const auto = lines.findIndex(l => l.startsWith('- ## Auto-Resolved Decisions'))
  if (plan === -1) return ['test plan: no `## Test Plan` bullet']
  if (!lines[plan].includes('testPlan lines, verbatim, one per line, and nothing else')) out.push('test plan: not the lines verbatim and nothing else')
  if (scenarios === -1) return [...out, 'test scenarios: no `## Test Scenarios` bullet']
  if (!lines[scenarios].includes('TP-n:') || !lines[scenarios].includes('from testScenarios')) out.push('test scenarios: not one TP-n: entry per TP from testScenarios')
  if (!(plan < scenarios && scenarios < auto)) out.push('order: Test Plan, then Test Scenarios, then Auto-Resolved Decisions')
  return out
}

describe('AC-2: Phase 6 writes `## Test Plan` (TP lines only) and then `## Test Scenarios`', () => {
  it('both bullets are present, worded and in order', () => {
    expect(collectArtifactDefects(PLAN_BUILT)).toEqual([])
  })

  it('known-bad probe: the d9d1c8e Phase 6 (per-criterion scenarios, no Test Scenarios) is reported', () => {
    const script = planScript(PLAN_BUILT)!
    const at = script.indexOf(WRITE_OPEN)
    const lines = script.slice(at).split('\n')
    const planLine = lines.find(l => l.startsWith('- ## Test Plan'))!
    const scenariosLine = lines.find(l => l.startsWith('- ## Test Scenarios'))!
    const seeded = seedOnce(seedOnce(PLAN_BUILT, `${scenariosLine}\n`, ''), planLine, '- ## Test Plan (per-criterion scenarios)')
    expect(collectArtifactDefects(seeded)).toEqual([
      'test plan: not the lines verbatim and nothing else',
      'test scenarios: no `## Test Scenarios` bullet',
    ])
  })

  it('known-bad probe: Test Scenarios written before Test Plan is reported', () => {
    const script = planScript(PLAN_BUILT)!
    const lines = script.slice(script.indexOf(WRITE_OPEN)).split('\n')
    const planLine = lines.find(l => l.startsWith('- ## Test Plan'))!
    const scenariosLine = lines.find(l => l.startsWith('- ## Test Scenarios'))!
    const swapped = seedOnce(PLAN_BUILT, `${planLine}\n${scenariosLine}`, `${scenariosLine}\n${planLine}`)
    expect(collectArtifactDefects(swapped)).toEqual(['order: Test Plan, then Test Scenarios, then Auto-Resolved Decisions'])
  })
})

// ---------------------------------------------------------------------------
// AC-2 — the post-workflow check, and why it reads the section
// ---------------------------------------------------------------------------

const PLAN_CHECK_OPEN = '**Check each plan\'s test plan.**'

/** The post-workflow check step: from its bold lead-in to the next numbered item. */
function planCheckStep(built: string): string | null {
  const at = offsetsOf(built, PLAN_CHECK_OPEN)
  if (at.length !== 1) return null
  const next = built.indexOf('\n2. ', at[0])
  return next === -1 ? null : built.slice(at[0], next)
}

/** Named collector: what the post-workflow check step fails to state. */
export function collectPlanCheckDefects(built: string): string[] {
  const step = planCheckStep(built)
  if (step === null) return ['step: no single post-workflow check step']
  const out: string[] = []
  const need = (label: string, ok: boolean): void => { if (!ok) out.push(label) }
  need('every plan: for every path in planPaths', step.includes('For every path in `planPaths`'))
  need('the section: its `## Test Plan` section is copied, never the whole file', step.includes('copy that plan\'s `## Test Plan` section') && step.includes('never the whole plan file'))
  need('the copy: byte for byte into a fresh mktemp file with the Write tool', step.includes('byte for byte into a fresh `mktemp` file with the Write tool, never through an interpolated shell string'))
  need('the check: the script\'s check tp', step.split('\n').includes(CHECK_TP))
  need('the gate: only exit=0 passes', step.includes('`exit=0` passes'))
  need('the report: test plan malformed (<code>)', step.includes('`test plan malformed (<code>)`'))
  need('no repair', step.includes('Nothing is repaired'))
  const order = built.indexOf('After the workflow completes:')
  need('placement: after the workflow completes', order !== -1 && order < built.indexOf(PLAN_CHECK_OPEN))
  return out
}

describe('AC-2: after the workflow, each plan\'s `## Test Plan` section is checked, never repaired', () => {
  it('the step is present and states every rule', () => {
    expect(planCheckStep(PLAN_BUILT)?.length ?? 0, 'the step is found').toBeGreaterThan(300)
    expect(collectPlanCheckDefects(PLAN_BUILT)).toEqual([])
  })

  it('known-bad probes: a whole-file check, an unguarded exit and a repair are each reported', () => {
    const wholeFile = seedOnce(PLAN_BUILT, 'copy that plan\'s `## Test Plan` section', 'copy that plan file')
    expect(collectPlanCheckDefects(wholeFile)).toEqual(['the section: its `## Test Plan` section is copied, never the whole file'])
    const noCheck = seedOnce(PLAN_BUILT, `${CHECK_TP}\n`, 'cat <that file>\n')
    expect(collectPlanCheckDefects(noCheck)).toEqual(['the check: the script\'s check tp'])
    const repaired = seedOnce(PLAN_BUILT, 'Nothing is repaired', 'Correct the lines and check again')
    expect(collectPlanCheckDefects(repaired)).toEqual(['no repair'])
    expect(collectPlanCheckDefects(PLAN_BUILT.replace(PLAN_CHECK_OPEN, '**Step one.**'))).toEqual(['step: no single post-workflow check step'])
  })

  it('the :243 summary paragraph runs the check before reading DECISIONS-NEEDED.md', () => {
    const para = PLAN_BUILT.split('\n').find(l => l.startsWith('After the workflow returns:')) ?? ''
    expect(para).toContain('check each plan\'s test plan')
    expect(para.indexOf('check each plan\'s test plan')).toBeLessThan(para.indexOf('`DECISIONS-NEEDED.md`'))
  })
})

describe('AC-2: why the check reads the section — the real script over a Phase 6 plan file', () => {
  interface Outcome { readonly code: number; readonly stdout: string }
  const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as {
    main(argv: readonly string[], deps?: { cwd?: string; stderr?: (t: string) => void }): Outcome
  }
  const TP = [
    '- [ ] TP-1 (AC-1) the endpoint rejects an expired token — method:ci [files: src/auth/**]',
    '- [ ] TP-2 (AC-2) a load of one hundred requests stays under the latency bound — method:local',
  ]
  const PLAN_FILE = [
    '## Implementation Plan', 'Build it.', '',
    '## Acceptance Criteria', '1. MUST reject an expired token.', '2. MUST NOT exceed 200 ms at p99.', '',
    '## Test Plan', ...TP, '',
    '## Test Scenarios', 'TP-1: a token past its expiry; the call returns 401.', 'TP-2: one hundred parallel calls; p99 under 200 ms.', '',
  ].join('\n')

  function check(text: string): number {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-tp-lines-'))
    try {
      const file = path.join(dir, 'in.md')
      fs.writeFileSync(file, text)
      return VE.main(['node', 'verify-evidence.cjs', 'check', 'tp', file], { cwd: dir, stderr: () => {} }).code
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  it('the copied `## Test Plan` section exits 0', () => {
    expect(check(['## Test Plan', ...TP].join('\n') + '\n')).toBe(0)
  })

  it('the whole plan file exits 5: its other headings make the script parse the whole document as the plan', () => {
    expect(check(PLAN_FILE)).toBe(5)
  })

  it('an absent section copies as an empty file, which is refused (exit 5), never admitted', () => {
    expect(check('')).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// AC-3 — /dynamic-build passes only checked TP lines
// ---------------------------------------------------------------------------

/** Pre-authoring step 4 of the built dynamic-build.md. */
function buildStep4(built: string): string | null {
  return between(built, '**4. Resolve plan and acceptance criteria**', '**5. Resolve tracking-issue number')
}

/** Named collector: what /dynamic-build's step 4 fails to state about the test plan it passes. */
export function collectBuildPassDefects(built: string): string[] {
  const step = buildStep4(built)
  if (step === null) return ['step: Pre-authoring step 4 was not found']
  const out: string[] = []
  const need = (label: string, ok: boolean): void => { if (!ok) out.push(label) }
  need('the copy: the plan\'s `## Test Plan` section into a fresh mktemp file with the Write tool', step.includes('Copy the plan\'s `## Test Plan` section byte for byte into a fresh `mktemp` file with the Write tool, never through an interpolated shell string'))
  need('the check: the script\'s check tp', step.split('\n').includes(CHECK_TP))
  need('the gate: only exit=0 passes testPlan, as one string', step.includes('Only `exit=0` passes it: pass the section\'s TP lines, as one string, as `testPlan`'))
  need('the note: Test plan: missing or malformed', step.includes('note `Test plan: missing or malformed` in the run summary'))
  need('no other shape', step.includes('a test plan in any other shape — an older JSON one included — is never passed'))
  const script = parseFences(built).find(f => f.includes('name: "devflow-dynamic-build"')) ?? ''
  need('the spawn: TEST_PLAN carries the string as it is', script.includes('TEST_PLAN: ${TEST_PLAN || "(none)"}'))
  return out
}

describe('AC-3: /dynamic-build passes `testPlan` only after `check tp` exits 0, as a string', () => {
  it('step 4 and the Test spawn state every rule', () => {
    expect(buildStep4(BUILD_BUILT)?.length ?? 0, 'step 4 is found').toBeGreaterThan(500)
    expect(collectBuildPassDefects(BUILD_BUILT)).toEqual([])
  })

  it('known-bad probe: the d9d1c8e step 4 (pass criteria and testPlan as found) is reported', () => {
    const step = buildStep4(BUILD_BUILT)!
    const d9d1c8e = '**4. Resolve plan and acceptance criteria**\n\n- Acceptance criteria and test plan (for Gate 2) — pass them as `criteria` and `testPlan` when invoking the workflow; a test plan alone still runs the Test agent\n\n'
    const seeded = seedOnce(BUILD_BUILT, step, d9d1c8e)
    expect(collectBuildPassDefects(seeded)).toEqual([
      'the copy: the plan\'s `## Test Plan` section into a fresh mktemp file with the Write tool',
      'the check: the script\'s check tp',
      'the gate: only exit=0 passes testPlan, as one string',
      'the note: Test plan: missing or malformed',
      'no other shape',
    ])
  })

  it('known-bad probe: the d9d1c8e JSON spawn key is reported', () => {
    const seeded = seedOnce(BUILD_BUILT, 'TEST_PLAN: ${TEST_PLAN || "(none)"}', 'TEST_PLAN: ${TEST_PLAN ? JSON.stringify(TEST_PLAN) : "(none)"}')
    expect(collectBuildPassDefects(seeded)).toEqual(['the spawn: TEST_PLAN carries the string as it is'])
  })
})

// ---------------------------------------------------------------------------
// AC-2 — the contract: the test plan IS TP lines
// ---------------------------------------------------------------------------

/** The acceptance_criteria_contract define body, source form. */
function contractDefine(source: string): string {
  const lines = source.split('\n')
  const start = lines.indexOf('@define acceptance_criteria_contract():')
  const end = lines.indexOf('@end', start + 1)
  return start === -1 || end === -1 ? '' : lines.slice(start + 1, end).join('\n')
}

/** Named collector: what the contract fails to say about the test plan's form. */
export function collectContractDefects(define: string): string[] {
  const out: string[] = []
  const need = (label: string, ok: boolean): void => { if (!ok) out.push(label) }
  need('the test plan IS TP lines', define.includes('The test plan IS TP lines'))
  need('setup and outcome go under ## Test Scenarios', define.includes('They go under a `## Test Scenarios` section after `## Test Plan`'))
  need('## Test Plan holds TP lines only', define.includes('`## Test Plan` holds TP lines only'))
  need('the Test agent receives the TP lines', define.includes('The Test agent receives: the test plan\'s TP lines'))
  need('no per-criterion structured list', !define.includes('Verification method:') && !define.includes('Expected outcome:'))
  return out
}

describe('AC-2: the shared contract says the test plan is TP lines, with setup and outcome apart', () => {
  it('the define is found and says so', () => {
    expect(contractDefine(CONTRACT_SOURCE).length).toBeGreaterThan(800)
    expect(collectContractDefects(contractDefine(CONTRACT_SOURCE))).toEqual([])
  })

  it('known-bad probe: the d9d1c8e structured list is reported', () => {
    const d9d1c8e = [
      '**Test plan (structured, for the Test agent)**', '',
      'For each acceptance criterion:',
      '- Test scenario: a concrete, runnable scenario description',
      '- Setup: preconditions and test data needed',
      '- Expected outcome: the specific observable result that confirms the criterion',
      '- Verification method: unit test / integration test / manual step / load test',
      '',
      'The Test agent receives: the test plan (all scenarios and expected outcomes).',
    ].join('\n')
    expect(collectContractDefects(d9d1c8e)).toEqual([
      'the test plan IS TP lines',
      'setup and outcome go under ## Test Scenarios',
      '## Test Plan holds TP lines only',
      'the Test agent receives the TP lines',
      'no per-criterion structured list',
    ])
  })
})
