/**
 * tests/evidence/implement-flow.test.ts
 *
 * SDLC-evidence PR4 (#363), phase P4: how the test plan travels from /implement to
 * the PR.
 *
 *   AC-10  code.md pastes `PR_TEST_PLAN_BLOCK` only after
 *          `verify-evidence.cjs check block` admits it. The paragraph sits inside
 *          Responsibility 7 after the PR_EXCEPTIONS gate and before the D11 scrub,
 *          leaves the frozen fixture's three code.md anchors unique, and states the
 *          gate, the refusal and the absent case. The gate it names is EXECUTED here
 *          (in-process, `main()` — `check` makes no subprocess call): it admits what
 *          `render --plan` prints and refuses every hostile block in the table.
 *   AC-11  The Test agent reports, per TP, an outcome, the command and its exit,
 *          and the HEAD it ran at (read before and after); the Validate agent
 *          reports each command's exit and its HEAD. The Test outcome vocabulary is
 *          the claim grammar's (CLAIM_LINE_RE), so every row maps onto a claim.
 *   AC-9   /implement writes and checks the evidence file's `## Test Plan` in
 *          Phase 1 — after the ticket ask and the exception record, before any
 *          Code spawn — and, only under a `required` policy, asks about a missing
 *          one: record a `test-plan` exception, or stop with BLOCKED (no test plan)
 *          and the policy-file remedy. `standard` never asks.
 *   AC-10  Every Code spawn that can create the PR forwards PR_TEST_PLAN_BLOCK.
 *   AC-11  The Phase 8 Test spawn passes TEST_PLAN. Phase 3/6 PASSes and every
 *          Phase 8 run append claims whose shapes CLAIM_LINE_RE admits, and Phase
 *          10b — after Phase 10, one spawn for all three strategies — runs
 *          update-pr-evidence with the REVIEW_PUBLICATION Phase 1 resolved through
 *          the publication partial (its third importer, after the policy resolves).
 *   AC-9   /plan's artifact carries a `## Test Plan` section (required section
 *          13): Gate 2 shows the TP lines in the imported TP-line contract, and
 *          Phase 14 runs `check tp` over them before the artifact's one write —
 *          so the contract text, whose "Write every" would read as a second write
 *          instruction, stays out of Phase 14 (g5-issue-flow's single-write rule).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064).
 *
 * The block table carries D-TP-SCENARIO's rows: a scenario holding a closing
 * keyword, an issue URL, a mention or a code span fails `check block`, so it never
 * reaches the PR body (the TP grammar excludes `#`, `@`, `/`, `<`, `>` and backtick).
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import {
  collectOrderViolations,
  isAgentBlock,
  parseFences,
  requireDistFile,
  resolveAgentSource,
  ROOT,
  walkFiles,
  type OrderRule,
} from '../helpers.js'
import { RESOLVER_SCRIPT } from '../evidence-policy/scripted-shim.js'
import { PR_EVIDENCE_SCRIPT, VERIFY_EVIDENCE_SCRIPT } from './seam.js'

/** Transcribed from the script's JSDoc — only what this suite calls. */
interface VerifyEvidenceApi {
  main(argv: readonly string[], deps?: { stderr?: (text: string) => void }): { code: number; stdout: string }
}
const VE = createRequire(import.meta.url)(VERIFY_EVIDENCE_SCRIPT) as VerifyEvidenceApi

/** Transcribed from pr-evidence.cjs's JSDoc — only the claim grammar. */
interface ClaimGrammar {
  readonly CLAIM_LINE_RE: RegExp
}
const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as ClaimGrammar

/** Transcribed from the resolver's JSDoc: the policy-file parser and serializer. */
interface PolicyFileApi {
  parsePolicyBytes(buf: Uint8Array): { kind: string; policy?: string }
  serializePolicy(policy: unknown): string | null
}
const RESOLVER = createRequire(import.meta.url)(RESOLVER_SCRIPT) as PolicyFileApi

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'devflow-implement-flow-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** Run one verify-evidence subcommand in-process over a text written to a scratch file. */
function runOnText(sub: readonly string[], text: string, name: string): { code: number; stdout: string } {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, text)
  return VE.main(['node', 'verify-evidence.cjs', ...sub, file], { stderr: () => {} })
}

function codeMd(): string {
  return resolveAgentSource('code').content
}

// ---------------------------------------------------------------------------
// code.md — the PR_TEST_PLAN_BLOCK paste gate (AC-10)
// ---------------------------------------------------------------------------

const TEST_PLAN_PASTE = '**Pasting `PR_TEST_PLAN_BLOCK`.**'
const EXCEPTIONS_PASTE = '**Pasting `PR_EXCEPTIONS`.**'

/**
 * The three code.md lines the frozen github-status-lines fixture samples by first
 * match. The new paragraph must not repeat them, or a sampler could pick it up.
 */
const FROZEN_CODE_ANCHORS = [
  '| Related Issues (ISSUE_NUMBER provided) |',
  'When `ISSUE_NUMBER` is provided, always include',
  '**D11 scrub (PR body is a GitHub-visible sink):**',
] as const

const CODE_ORDER: readonly OrderRule[] = [
  { label: 'the test-plan gate follows the exception gate', before: EXCEPTIONS_PASTE, after: TEST_PLAN_PASTE },
  { label: 'the test-plan gate precedes the D11 scrub', before: TEST_PLAN_PASTE, after: FROZEN_CODE_ANCHORS[2] },
]

/** The paragraph: from its label to the next Responsibility-7 paragraph. */
function testPlanParagraph(code: string): string | null {
  const at = code.indexOf(TEST_PLAN_PASTE)
  if (at === -1) return null
  const end = code.indexOf('\n\n', at)
  return code.slice(at, end === -1 ? code.length : end)
}

/** Named collector: what code.md's PR_TEST_PLAN_BLOCK paragraph fails to state. */
function collectTestPlanPasteDefects(code: string): string[] {
  const para = testPlanParagraph(code)
  if (para === null) return ['no PR_TEST_PLAN_BLOCK paste paragraph']
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('the value is saved with the Write tool, not a shell string', para.includes('with the Write tool') && para.includes('never through an interpolated shell string'))
  need('the gate is `verify-evidence.cjs check block`', /verify-evidence\.cjs" check block <that file>; echo "exit=\$\?"/.test(para))
  need('only `exit=0` admits the value', para.includes('only `exit=0` admits the value'))
  need('it is pasted before any exceptions section', para.includes('before any `## Evidence Exceptions` section'))
  need('it is scrubbed with the body', para.includes('scrubbed with the body'))
  need('a mismatch is omitted, never repaired or partly pasted', para.includes('never repair or partly paste it'))
  need('the DEGRADED reason', para.includes('`TRACEABILITY: DEGRADED (test-plan block does not match its grammar)`'))
  need('`(none)` is the documented absent case', /`\(none\)`, or absent, is \*\*not a mismatch\*\*/.test(para))
  need('the scrubber-failure body never carries it', para.includes('minimal body below never carries the block'))
  return out
}

describe('AC-10: code.md pastes PR_TEST_PLAN_BLOCK only through `check block`', () => {
  it('the paragraph sits after the exception gate and before the D11 scrub; the frozen anchors stay unique', () => {
    const code = codeMd()
    expect(collectOrderViolations('code.md', code, CODE_ORDER)).toEqual([])
    for (const anchor of FROZEN_CODE_ANCHORS) expect(code.split(anchor).length - 1, anchor).toBe(1)
    expect(testPlanParagraph(code) ?? '', 'the paragraph must not spell a frozen anchor').not.toMatch(/ISSUE_NUMBER|D11 scrub \(/)
  })

  it('the paragraph states the gate, the placement, the refusal and the absent case', () => {
    expect(collectTestPlanPasteDefects(codeMd())).toEqual([])
  })

  it('known-bad probes: a repairing paragraph, a lost gate and a missing paragraph are reported', () => {
    const code = codeMd()
    const repairs = code.replace('never repair or partly paste it', 'repair it and paste it')
    expect(repairs, 'the seed must land').not.toBe(code)
    expect(collectTestPlanPasteDefects(repairs)).toEqual(['a mismatch is omitted, never repaired or partly pasted'])
    const ungated = code.replace(' check block <that file>', ' render --plan <that file>')
    expect(ungated, 'the seed must land').not.toBe(code)
    expect(collectTestPlanPasteDefects(ungated)).toEqual(['the gate is `verify-evidence.cjs check block`'])
    expect(collectTestPlanPasteDefects(code.replace(TEST_PLAN_PASTE, '**Pasting the block.**'))).toEqual(['no PR_TEST_PLAN_BLOCK paste paragraph'])
  })

  it('code.md declares the input, and pr-create takes it and names its gate', () => {
    const code = codeMd()
    const inputs = code.slice(code.indexOf('## Input Context'), code.indexOf('## Responsibilities'))
    expect(inputs).toContain('- **PR_TEST_PLAN_BLOCK** (optional):')
    const mode = code.slice(code.indexOf('## Mode: pr-create'))
    const lines = mode.split('\n')
    expect(lines.find(l => l.startsWith('**Inputs:**'))).toContain('`PR_TEST_PLAN_BLOCK`')
    expect(lines.find(l => l.startsWith('2. Run Responsibility 7 only'))).toContain('`PR_TEST_PLAN_BLOCK` paste gates')
  })
})

// ---------------------------------------------------------------------------
// The gate code.md names — executed
// ---------------------------------------------------------------------------

const EM = '—'
const PLAN = [
  '## Test Plan',
  `- [ ] TP-1 (AC-1) login succeeds with valid credentials ${EM} method:ci [files: src/auth/**]`,
  `- [ ] TP-2 (AC-2) a bad password is refused ${EM} method:local`,
  '',
].join('\n')

/** The creation block exactly as /implement renders it for a Code spawn. */
function renderedBlock(): string {
  const r = runOnText(['render', '--plan'], PLAN, 'plan.md')
  if (r.code !== 0) throw new Error(`render --plan exited ${r.code}`)
  return r.stdout
}

/** Admitted blocks (the rendered block and its EOL variants) and hostile near-misses. */
function blockTable(): ReadonlyArray<{ readonly label: string; readonly text: string; readonly admit: boolean }> {
  const block = renderedBlock()
  const lines = block.split('\n')
  return [
    { label: 'the rendered block', text: block, admit: true },
    { label: 'no trailing newline', text: block.replace(/\n$/, ''), admit: true },
    { label: 'CRLF line ends', text: block.replace(/\n/g, '\r\n'), admit: true },
    { label: 'a ticked TP', text: block.replace('- [ ] TP-1', '- [x] TP-1'), admit: false },
    { label: 'a free line inside', text: block.replace('## Test Plan\n', '## Test Plan\nCloses #1\n'), admit: false },
    { label: 'a blank line inside', text: block.replace('## Test Plan\n', '## Test Plan\n\n'), admit: false },
    { label: 'text after the end marker', text: `${block}Closes #1\n`, admit: false },
    { label: 'text before the start marker', text: `Closes #1\n${block}`, admit: false },
    { label: 'no end marker', text: lines.filter(l => !l.startsWith('<!-- /')).join('\n'), admit: false },
    { label: 'an HTML comment inside', text: block.replace('## Test Plan\n', `## Test Plan\n<!-- note -->\n`), admit: false },
    { label: 'no TP line', text: lines.filter(l => !l.startsWith('- [')).join('\n'), admit: false },
    { label: 'the (none) placeholder', text: '(none)\n', admit: false },
    { label: 'an empty value', text: '', admit: false },
    { label: 'a TP line with markup', text: block.replace('login succeeds', '<img src=x> login succeeds'), admit: false },
    { label: 'a scenario closing an issue', text: block.replace('login succeeds', 'Closes #12 login succeeds'), admit: false },
    { label: 'a scenario with an issue URL', text: block.replace('login succeeds', 'fixes https://github.com/o/r/issues/1 login succeeds'), admit: false },
    { label: 'a scenario mentioning a user', text: block.replace('login succeeds', '@user login succeeds'), admit: false },
    { label: 'a scenario with a code span', text: block.replace('login succeeds', '`login` succeeds'), admit: false },
  ]
}

/** Named collector: table rows a checker decides differently from the table. */
function collectGateMisses(check: (text: string, name: string) => number): string[] {
  return blockTable()
    .map((row, i) => ({ row, code: check(row.text, `block-${i}.md`) }))
    .filter(({ row, code }) => (code === 0) !== row.admit)
    .map(({ row, code }) => `${row.label}: exit ${code} (${row.admit ? 'should admit' : 'should refuse'})`)
}

describe('AC-10: the `check block` gate admits the rendered block and refuses the hostile ones', () => {
  const checkBlock = (text: string, name: string): number => runOnText(['check', 'block'], text, name).code

  it('decides every table row as the table says', () => {
    const table = blockTable()
    expect(table.filter(r => r.admit).length, 'too few admitted rows').toBeGreaterThanOrEqual(3)
    expect(table.filter(r => !r.admit).length, 'too few hostile rows').toBeGreaterThanOrEqual(10)
    expect(collectGateMisses(checkBlock)).toEqual([])
  })

  it('a refusal is exit 5 with empty stdout — never a repaired block', () => {
    const r = runOnText(['check', 'block'], renderedBlock().replace('- [ ] TP-2', '- [x] TP-2'), 'ticked.md')
    expect(r).toEqual({ code: 5, stdout: '' })
  })

  it('known-bad probe: a checker that admits everything is reported on every hostile row', () => {
    const permissive = collectGateMisses(() => 0)
    expect(permissive.length).toBe(blockTable().filter(r => !r.admit).length)
  })
})

// ---------------------------------------------------------------------------
// test.md and validate.md — the report fields /implement turns into claims (AC-11)
// ---------------------------------------------------------------------------

/** An agent's `## Output` section, up to the section that follows it. */
function outputSection(content: string, next: string): string | null {
  const start = content.indexOf('\n## Output\n')
  const end = content.indexOf(`\n${next}\n`, start + 1)
  return start === -1 || end === -1 ? null : content.slice(start, end)
}

/** The outcome alternation CLAIM_LINE_RE admits, read out of its own source. */
function claimOutcomes(): string[] {
  const m = /\(\?<outcome>([A-Z|]+)\)/.exec(PE.CLAIM_LINE_RE.source)
  if (m === null) throw new Error('CLAIM_LINE_RE has no (?<outcome>…) group')
  return m[1].split('|')
}

const TP_EVIDENCE_HEADING = '### Test Plan Evidence'
const TP_EVIDENCE_HEADER = '| TP | Outcome | Scenarios | Command | Exit |'
const VALIDATE_HEADER = '| Command | Status | Exit | Duration |'

/** Named collector: what test.md's input declaration and Output template lack. */
function collectTestReportDefects(test: string): string[] {
  const out: string[] = []
  const input = test.split('\n').find(l => l.startsWith('- **TEST_PLAN**:')) ?? ''
  if (!input.includes('never run TP text verbatim')) out.push('TEST_PLAN: TP text may be run verbatim')
  if (!input.includes('`<untrusted-test-plan>`')) out.push('TEST_PLAN: third-party lines are not marked')
  const output = outputSection(test, '## Principles')
  if (output === null) return [...out, 'no ## Output section']
  const lines = output.split('\n')
  if (!lines.some(l => l.startsWith('| ID | TP | Type |'))) out.push('Scenario Results: no TP column after ID')
  const at = lines.findIndex(l => l.startsWith(TP_EVIDENCE_HEADING))
  if (at === -1) return [...out, `no ${TP_EVIDENCE_HEADING} section`]
  const section = lines.slice(at, lines.findIndex((l, i) => i > at && l.startsWith('### ')))
  const head = section.find(l => l.startsWith('HEAD: {'))
  if (head === undefined || !head.includes('read before the first scenario and again after the last') || !head.includes('report the change')) {
    out.push('HEAD: not read before and after')
  }
  const header = section.findIndex(l => l === TP_EVIDENCE_HEADER)
  if (header === -1) return [...out, `no "${TP_EVIDENCE_HEADER}" table`]
  const row = section[header + 2]?.split('|').map(c => c.trim()) ?? []
  const outcomes = (row[2] ?? '').split('/')
  if (outcomes.join('|') !== claimOutcomes().join('|')) out.push(`Outcome [${outcomes.join(', ')}] is not the claim grammar's [${claimOutcomes().join(', ')}]`)
  if (!section.some(l => l.includes('`method:local` row always carries its Exit'))) out.push('a local TP may omit its exit')
  return out
}

/** Named collector: what validate.md's Output template lacks. */
function collectValidateReportDefects(validate: string): string[] {
  const output = outputSection(validate, '## Boundaries')
  if (output === null) return ['no ## Output section']
  const lines = output.split('\n')
  const out: string[] = []
  if (!lines.some(l => l.startsWith('HEAD: {') && l.includes('git rev-parse HEAD'))) out.push('no HEAD line')
  if (!lines.includes(VALIDATE_HEADER)) out.push(`no "${VALIDATE_HEADER}" table`)
  return out
}

describe('AC-11: the Test and Validate agents report what a claim needs', () => {
  it('test.md reports HEAD, and per TP an outcome in the claim vocabulary, a command and an exit', () => {
    expect(claimOutcomes()).toEqual(['PASS', 'FAIL', 'SKIP'])
    expect(collectTestReportDefects(resolveAgentSource('test').content)).toEqual([])
  })

  it('validate.md reports HEAD and every command\'s exit code', () => {
    expect(collectValidateReportDefects(resolveAgentSource('validate').content)).toEqual([])
  })

  it('known-bad probes: a lost Exit column, a single HEAD read, a narrowed outcome set and a verbatim run are reported', () => {
    const test = resolveAgentSource('test').content
    expect(collectTestReportDefects(test.replace('PASS/FAIL/SKIP | S1, S3', 'PASS/FAIL | S1, S3'))).toEqual([
      'Outcome [PASS, FAIL] is not the claim grammar\'s [PASS, FAIL, SKIP]',
    ])
    expect(collectTestReportDefects(test.replace('read before the first scenario and again after the last', 'read once'))).toEqual([
      'HEAD: not read before and after',
    ])
    expect(collectTestReportDefects(test.replace('never run TP text verbatim', 'run each TP'))).toEqual([
      'TEST_PLAN: TP text may be run verbatim',
    ])
    const validate = resolveAgentSource('validate').content
    expect(collectValidateReportDefects(validate.replace(VALIDATE_HEADER, '| Command | Status | Duration |'))).toEqual([
      `no "${VALIDATE_HEADER}" table`,
    ])
  })
})

// ---------------------------------------------------------------------------
// /plan — the artifact's `## Test Plan` section (AC-9)
// ---------------------------------------------------------------------------

const CONTRACT_HEAD = '**Test-plan line (TP).**'
const PLAN_CHECK = '**Check the test plan before the artifact exists:**'
const PLAN_WRITE = '**Write the artifact now**'

const PLAN_ORDER: readonly OrderRule[] = [
  { label: 'Gate 2 shows the TP lines in the contract\'s shape', before: '#### Phase 13: Gate 2', after: CONTRACT_HEAD },
  { label: 'the contract stays out of Phase 14', before: CONTRACT_HEAD, after: '#### Phase 14: Output' },
  { label: 'section 13 is listed in Phase 14', before: '#### Phase 14: Output', after: '13. **Test Plan** — ' },
  { label: 'the plan is checked before the artifact is written', before: PLAN_CHECK, after: PLAN_WRITE },
]

/** Named collector: what /plan's built text lacks for the `## Test Plan` section. */
function collectPlanTestPlanDefects(plan: string): string[] {
  const out = collectOrderViolations('plan.md', plan, PLAN_ORDER)
  const lines = plan.split('\n')
  if (lines.filter(l => l === '### 12. PR Description Guidance').length !== 1) out.push('`### 12.` lost its number')
  if (!lines.some(l => l.startsWith('   - Test strategy — the test plan as TP lines'))) out.push('Gate 2 does not list the TP lines')
  const check = lines.find(l => l.startsWith('node ') && l.includes('verify-evidence.cjs" check tp <that file>; echo "exit=$?"'))
  if (check === undefined) out.push('Phase 14 runs no `check tp`')
  return out
}

describe('AC-9: /plan keeps a checked `## Test Plan` section', () => {
  it('Gate 2 shows the contract, section 13 is listed and the check precedes the one write', () => {
    const plan = requireDistFile('plan.md')
    expect(plan.split(CONTRACT_HEAD).length - 1, 'the contract expands exactly once').toBe(1)
    expect(collectPlanTestPlanDefects(plan)).toEqual([])
  })

  it('known-bad probes: a lost section 13 and a check moved after the write are reported', () => {
    const plan = requireDistFile('plan.md')
    const noSection = plan.replace('13. **Test Plan** — ', '13. Test plan — ')
    expect(noSection, 'the seed must land').not.toBe(plan)
    expect(collectPlanTestPlanDefects(noSection)).toEqual([
      'plan.md: [section 13 is listed in Phase 14] after anchor absent: "13. **Test Plan** — "',
    ])
    const late = plan.replace(PLAN_CHECK, 'Check later:').replace(PLAN_WRITE, `${PLAN_WRITE}\n\n${PLAN_CHECK}`)
    expect(collectPlanTestPlanDefects(late)).toEqual([
      `plan.md: [the plan is checked before the artifact is written] "${PLAN_CHECK}" does not precede "${PLAN_WRITE}"`,
    ])
  })
})

// ---------------------------------------------------------------------------
// /implement Phase 1 — the test-plan step and its ask (AC-9)
// ---------------------------------------------------------------------------

const CODE_SPAWN = 'Agent(subagent_type="Code")'
const TICKET_ASK = '**Ticket link, only when `ISSUE_REQUIRED` is `true`:**'
const RECORD = '**Record the exception at once**'
const TEST_PLAN_STEP = '**Test plan.** Before any Code spawn'
const MISSING_ASK = '**Missing test plan, only when `EVIDENCE_POLICY` is `required`:**'
const OUTPUTS = '**Test-plan outputs**'
const STANDARD_LINE = 'When `EVIDENCE_POLICY` is `standard`, a missing test plan is never asked about'

function implementMd(): string {
  return requireDistFile('implement.md')
}

/** The order Phase 1 keeps, invocation to first Code spawn. Every anchor is unique in the built file. */
const PHASE1_ORDER: readonly OrderRule[] = [
  { label: 'the policy resolves before setup-task', before: 'resolve-evidence-policy.cjs', after: 'OPERATION: setup-task' },
  { label: 'setup-task runs before the ticket ask', before: 'OPERATION: setup-task', after: TICKET_ASK },
  { label: 'the ticket exception is recorded before the test-plan step', before: RECORD, after: TEST_PLAN_STEP },
  { label: 'the test plan is checked before it can be missing', before: 'check tp .devflow/docs/evidence-{branch_slug}.md', after: MISSING_ASK },
  { label: 'the missing-plan ask precedes the outputs', before: MISSING_ASK, after: OUTPUTS },
  { label: 'the outputs are set before Phase 2', before: OUTPUTS, after: '### Phase 2: Implement' },
]

/** Named collector: Code spawns that open before `anchor` — every one must follow it, not just the first. */
function collectCodeSpawnsBefore(content: string, anchor: string): string[] {
  const at = content.indexOf(anchor)
  if (at === -1) return [`the anchor is absent: "${anchor}"`]
  const out: string[] = []
  for (let i = content.indexOf(CODE_SPAWN); i !== -1; i = content.indexOf(CODE_SPAWN, i + CODE_SPAWN.length)) {
    if (i < at) out.push(`a Code spawn at offset ${i} opens before "${anchor}" (offset ${at})`)
  }
  return out
}

describe('AC-9: /implement writes and checks the test plan before any Code spawn', () => {
  it('invocation → setup-task → ticket ask → record → test-plan step → missing-plan ask → outputs → Phase 2', () => {
    const md = implementMd()
    expect(md.split(CODE_SPAWN).length - 1, 'no Code spawn read').toBeGreaterThanOrEqual(5)
    expect(collectOrderViolations('implement.md', md, PHASE1_ORDER)).toEqual([])
    expect(collectCodeSpawnsBefore(md, OUTPUTS)).toEqual([])
  })

  it('known-bad probes: a test-plan step moved above the record and a Code spawn seeded above the outputs are reported', () => {
    const md = implementMd()
    const hoisted = md.replace(TEST_PLAN_STEP, 'Test plan later.').replace(RECORD, `${TEST_PLAN_STEP}\n\n${RECORD}`)
    expect(collectOrderViolations('implement.md', hoisted, PHASE1_ORDER).some(v => v.includes('the ticket exception is recorded before'))).toBe(true)
    const seeded = md.replace(MISSING_ASK, `${CODE_SPAWN}:\n\n${MISSING_ASK}`)
    expect(collectCodeSpawnsBefore(seeded, OUTPUTS)).toHaveLength(1)
  })

  it('the check and the render run the installed script over the evidence file', () => {
    const lines = implementMd().split('\n')
    const script = 'node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/verify-evidence.cjs"'
    expect(lines).toContain(`${script} check tp .devflow/docs/evidence-{branch_slug}.md; echo "exit=$?"`)
    expect(lines).toContain(`${script} render --plan .devflow/docs/evidence-{branch_slug}.md; echo "exit=$?"`)
  })
})

/** The missing-plan ask: from its gate to the blank line after its last option. */
function missingAskBlock(content: string): string | null {
  const start = content.indexOf(MISSING_ASK)
  if (start === -1) return null
  const end = content.indexOf('\n\n', start)
  return content.slice(start, end === -1 ? content.length : end)
}

/**
 * Named collector: what the missing-plan ask fails to state. Scoped to its own
 * block, so ticket-gate's options collector (which reads the ticket ask through
 * the record paragraph) never sees these options.
 */
function collectMissingAskDefects(block: string | null): string[] {
  if (block === null) return ['no missing-plan ask block']
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('keys on the policy (`required`), no mechanism key', block.startsWith(MISSING_ASK))
  need('asks with AskUserQuestion before any Code spawn', block.includes('AskUserQuestion before any Code spawn'))
  const options = block.split('\n').filter(l => /^- \*\*[^*]+\*\* — /.test(l)).map(l => l.slice(4, l.indexOf('** ')))
  need(`exactly the two options (found: ${options.join(', ')})`, options.join('|') === 'Record an exception|Stop')
  need('renders the exception as kind `test-plan`', block.includes('as kind `test-plan`'))
  need('a bounded re-ask for an empty reason', /ask for it once more, and stop/.test(block))
  need('the same Evidence Exceptions section of the handoff file', block.includes('`## Evidence Exceptions` section of `.devflow/docs/handoff-{branch_slug}.md`'))
  need('the BLOCKED report', block.includes('`BLOCKED (no test plan)`'))
  need('the branch and BASE_BRANCH', block.includes('`TASK_ID`') && block.includes('`BASE_BRANCH`'))
  need('the policy-file remedy', block.includes('`.devflow/policy.json`'))
  return out
}

describe('AC-9: a missing test plan asks only under `required`, and a stop names its remedy', () => {
  it('the ask states every part of the contract', () => {
    expect(collectMissingAskDefects(missingAskBlock(implementMd()))).toEqual([])
  })

  it('the remedy quotes the canonical standard policy file, and it parses', () => {
    const block = missingAskBlock(implementMd())!
    const literal = /`(\{"version":1,[^`]*\})`/.exec(block)?.[1]
    expect(literal, 'the remedy must quote the policy file').toBeDefined()
    expect(`${literal}\n`).toBe(RESOLVER.serializePolicy('standard'))
    expect(RESOLVER.parsePolicyBytes(new TextEncoder().encode(literal!))).toEqual({ kind: 'valid', policy: 'standard' })
  })

  it('under `standard` the missing plan is reported and never asked about', () => {
    const lines = implementMd().split('\n').filter(l => l.startsWith(STANDARD_LINE))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Phase 11 report')
    expect(lines[0]).not.toContain('AskUserQuestion')
  })

  it('known-bad probes: a third option, a lost BLOCKED report and a missing block are reported', () => {
    const block = missingAskBlock(implementMd())!
    const third = block.replace('- **Stop** — ', '- **Skip the plan** — carry on.\n- **Stop** — ')
    expect(collectMissingAskDefects(third).some(d => d.startsWith('exactly the two options'))).toBe(true)
    expect(collectMissingAskDefects(block.replace('`BLOCKED (no test plan)`', 'an error'))).toEqual(['the BLOCKED report'])
    expect(collectMissingAskDefects(null)).toEqual(['no missing-plan ask block'])
  })
})

// ---------------------------------------------------------------------------
// /implement spawns — PR_TEST_PLAN_BLOCK (AC-10) and TEST_PLAN (AC-11)
// ---------------------------------------------------------------------------

const FORWARD_LINE = 'PR_TEST_PLAN_BLOCK: {PR_TEST_PLAN_BLOCK from Phase 1 verbatim, or (none)}'

/**
 * Named collector: Code spawns that can create the PR (`CREATE_PR: true`, or the
 * sequential `CREATE_PR: {true if last …}`) and do not forward the block. Returns
 * the violations and how many PR-creating spawns were read.
 */
function collectUnforwardedTestPlan(content: string): { creating: number; violations: string[] } {
  let creating = 0
  const violations: string[] = []
  parseFences(content).forEach((fence, i) => {
    if (!isAgentBlock(fence, 'Code')) return
    if (!/^\s*"?CREATE_PR: (?:true\b|\{true if last)/m.test(fence)) return
    creating++
    const lines = fence.split('\n').map(l => l.replace(/"$/, ''))
    if (!lines.includes(FORWARD_LINE)) violations.push(`fence ${i + 1}: a PR-creating Code spawn without "${FORWARD_LINE}"`)
  })
  return { creating, violations }
}

describe('AC-10/AC-11: the spawns carry the test plan', () => {
  it('SINGLE, SEQUENTIAL Phase 2+ and PARALLEL pr-create forward PR_TEST_PLAN_BLOCK', () => {
    const { creating, violations } = collectUnforwardedTestPlan(implementMd())
    expect(creating, 'fewer PR-creating Code spawns than SINGLE + SEQUENTIAL + pr-create').toBeGreaterThanOrEqual(3)
    expect(violations).toEqual([])
  })

  it('known-bad probe: a spawn that lost the key is reported', () => {
    const md = implementMd()
    const seeded = md.replace(`\n${FORWARD_LINE}`, '')
    expect(seeded, 'the seed must land').not.toBe(md)
    expect(collectUnforwardedTestPlan(seeded).violations).toHaveLength(1)
  })

  it('the Phase 8 Test spawn passes TEST_PLAN from the evidence file', () => {
    const tests = parseFences(implementMd()).filter(f => isAgentBlock(f, 'Test'))
    expect(tests, 'the Phase 8 Test spawn').toHaveLength(1)
    expect(tests[0]).toContain("TEST_PLAN: {the TP lines of the evidence file's ## Test Plan section, or (none)}")
  })
})

// ---------------------------------------------------------------------------
// /implement — claims (AC-11)
// ---------------------------------------------------------------------------

/** The claim shapes the Evidence claims paragraph states: the lines of the fence under it. */
function claimTemplates(content: string): string[] {
  const at = content.indexOf('**Evidence claims** are lines appended')
  if (at === -1) return []
  const fence = /```\n([\s\S]*?)```/.exec(content.slice(at))
  return fence === null ? [] : fence[1].split('\n').filter(l => l !== '')
}

/**
 * Named collector: every concrete claim a template can produce that CLAIM_LINE_RE
 * refuses, plus template placeholders it cannot fill. `<a|b>` alternations are
 * expanded; `exit:<0-255>` is filled at both bounds and also dropped (the line may
 * end at `by:test`).
 */
function collectInadmissibleClaims(templates: readonly string[]): string[] {
  const head = 'a'.repeat(40)
  const out: string[] = []
  for (const template of templates) {
    const alternation = /<([A-Z]+(?:\|[A-Z]+)+)>/.exec(template)
    const outcomes = alternation === null ? [''] : alternation[1].split('|')
    for (const outcome of outcomes) {
      for (const exit of ['0', '255', null]) {
        let line = template.replace('<head>', head).replace('<n>', '7')
        if (alternation !== null) line = line.replace(alternation[0], outcome)
        line = exit === null ? line.replace(/ exit:<0-255>$/, '') : line.replace('<0-255>', exit)
        if (/<[^>]*>/.test(line)) out.push(`unfilled placeholder: ${template}`)
        else if (!PE.CLAIM_LINE_RE.test(line)) out.push(`refused: ${line}`)
      }
    }
  }
  return [...new Set(out)]
}

describe('AC-11: /implement appends claims the evidence script can read', () => {
  it('the gate and TP claim shapes fill to lines CLAIM_LINE_RE admits, with the claim outcome vocabulary', () => {
    const templates = claimTemplates(implementMd())
    expect(templates).toHaveLength(2)
    expect(templates[1]).toContain(`<${claimOutcomes().join('|')}>`)
    expect(collectInadmissibleClaims(templates)).toEqual([])
  })

  it('Phase 3 and Phase 6 PASS append the gate claim, and every Phase 8 run its TP claims', () => {
    const lines = implementMd().split('\n')
    expect(lines.filter(l => l.startsWith('**If PASS:** append a `gate:validate` claim'))).toHaveLength(2)
    expect(lines.filter(l => l.startsWith('After every Test agent run — PASS or FAIL, first run or retry — append its TP claims'))).toHaveLength(1)
  })

  it('known-bad probes: an outcome outside the grammar, an unfilled placeholder and a short SHA are refused', () => {
    expect(collectInadmissibleClaims(['- TP-<n> <PASS|PASSED> sha:<head> by:test exit:<0-255>'])).toContain(
      `refused: - TP-7 PASSED sha:${'a'.repeat(40)} by:test exit:0`,
    )
    expect(collectInadmissibleClaims(['- TP-<n> <outcome> sha:<head> by:test'])).toEqual([
      'unfilled placeholder: - TP-<n> <outcome> sha:<head> by:test',
    ])
    expect(collectInadmissibleClaims(['- gate:validate PASS sha:abc123 by:validate'])).toEqual([
      'refused: - gate:validate PASS sha:abc123 by:validate',
    ])
  })
})

// ---------------------------------------------------------------------------
// /implement — REVIEW_PUBLICATION and Phase 10b (AC-11)
// ---------------------------------------------------------------------------

const PUBLICATION_IMPORT = './_partials/_publication.mds'

/** Named collector: which src .mds hosts import the publication partial, in any import form. */
function collectPublicationImporters(sources: ReadonlyArray<{ name: string; content: string }>): string[] {
  const importLine = new RegExp(`^@import\\b.*"${PUBLICATION_IMPORT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`, 'm')
  return sources.filter(s => importLine.test(s.content)).map(s => s.name).sort()
}

const PHASE10B = '### Phase 10b: Evidence'
const EVIDENCE_SPAWN = '"OPERATION: update-pr-evidence'

/** The one push /implement runs itself: claims keyed to a local HEAD must be in the PR before 10b reads them. */
const EVIDENCE_PUSH = 'git push origin HEAD; echo "exit=$?"'

const PHASE10B_ORDER: readonly OrderRule[] = [
  { label: 'the policy resolves before the publication partial reads it', before: 'resolve-evidence-policy.cjs', after: '**Evidence stub:**' },
  { label: 'REVIEW_PUBLICATION resolves in Phase 1', before: '**Evidence stub:**', after: '### Phase 2: Implement' },
  { label: 'Phase 10b follows Phase 10', before: '### Phase 10: Create PR', after: PHASE10B },
  { label: 'the push sits in Phase 10b', before: PHASE10B, after: EVIDENCE_PUSH },
  { label: 'the push precedes the evidence spawn', before: EVIDENCE_PUSH, after: EVIDENCE_SPAWN },
  { label: 'the evidence spawn sits in Phase 10b', before: PHASE10B, after: EVIDENCE_SPAWN },
  { label: 'Phase 11 follows the evidence spawn', before: EVIDENCE_SPAWN, after: '### Phase 11: Report' },
]

/** Named collector: what the Phase 10b spawn lacks — exactly one, carrying the op's Input keys. */
function collectEvidenceSpawnDefects(content: string): string[] {
  const spawns = parseFences(content).filter(f => isAgentBlock(f, 'Git') && f.includes(EVIDENCE_SPAWN))
  if (spawns.length !== 1) return [`expected one update-pr-evidence spawn, found ${spawns.length}`]
  const keys = spawns[0].split('\n').map(l => /^\s*"?([A-Z_]+): /.exec(l)?.[1]).filter((k): k is string => k !== undefined)
  const out: string[] = []
  for (const key of ['OPERATION', 'PR_NUMBER', 'EVIDENCE_FILE', 'REVIEW_PUBLICATION']) {
    if (!keys.includes(key)) out.push(`the spawn does not pass ${key}`)
  }
  if (!spawns[0].includes('EVIDENCE_FILE: .devflow/docs/evidence-{branch_slug}.md')) out.push('EVIDENCE_FILE is not the evidence file')
  const phase = content.slice(content.indexOf(PHASE10B), content.indexOf('### Phase 11: Report'))
  if (!phase.includes('under every strategy')) out.push('Phase 10b does not run under every strategy')
  if (!phase.includes('It never blocks')) out.push('Phase 10b may block')
  return out
}

/**
 * Named collector: what Phase 10b's push lacks. It is the command's only push: one
 * bash fence, never forced, never retried, and a failure is a DEGRADED line rather
 * than a stop — the evidence spawn still runs, and an unpushed claim reads
 * UNVERIFIED rather than blocking the PR.
 */
function collectEvidencePushDefects(content: string): string[] {
  const at = content.indexOf(PHASE10B)
  const end = content.indexOf('### Phase 11: Report')
  if (at === -1 || end === -1) return ['no Phase 10b section']
  const phase = content.slice(at, end)
  const out: string[] = []
  const pushes = parseFences(phase).filter(f => /\bgit\b[^\n]*\bpush\b/.test(f))
  if (pushes.length !== 1) out.push(`expected one push fence in Phase 10b, found ${pushes.length}`)
  if (pushes.some(f => !f.includes(EVIDENCE_PUSH))) out.push('the push is not the stated command')
  if (pushes.some(f => /(^|\s)(--force(-with-lease)?\b|-f\b|\+\S)/.test(f))) out.push('the push may force')
  if (!phase.includes('never force, and no retry')) out.push('the push does not say never force, no retry')
  if (!phase.includes('`TRACEABILITY: DEGRADED (evidence push failed)`')) out.push('a failed push names no DEGRADED reason')
  if (!phase.includes('does not block') || !phase.includes('spawn anyway')) out.push('a failed push may block the evidence spawn')
  return out
}

describe('0b: Phase 10b pushes the branch before the evidence spawn', () => {
  it('one unforced push precedes the spawn, and its failure is DEGRADED, never a stop', () => {
    const md = implementMd()
    expect(md.split(EVIDENCE_PUSH).length - 1, 'the push command is the corpus').toBe(1)
    expect(collectEvidencePushDefects(md)).toEqual([])
    expect(collectOrderViolations('implement.md', md, PHASE10B_ORDER)).toEqual([])
  })

  it('the Report surfaces the push\'s DEGRADED line and the diagram shows the push', () => {
    const md = implementMd()
    expect(md).toContain('or Phase 10b\'s push recorded one, surface them verbatim')
    expect(md).toContain('Push the branch (never force; a failure is DEGRADED, not a stop)')
  })

  it('known-bad probes: a push after the spawn, a forced push, a lost push and a blocking failure are reported', () => {
    const md = implementMd()
    const phase = md.slice(md.indexOf(PHASE10B), md.indexOf('### Phase 11: Report'))
    const pushFence = '```bash\n' + EVIDENCE_PUSH + '\n```\n\n'
    expect(phase.includes(pushFence), 'the push fence moved').toBe(true)
    const late = md.replace(pushFence, '').replace('### Phase 11: Report', pushFence + '### Phase 11: Report')
    expect(collectOrderViolations('implement.md', late, PHASE10B_ORDER).some(v => v.includes('the push precedes the evidence spawn'))).toBe(true)
    expect(collectEvidencePushDefects(md.replace(EVIDENCE_PUSH, 'git push --force origin HEAD; echo "exit=$?"'))).toEqual([
      'the push is not the stated command',
      'the push may force',
    ])
    expect(collectEvidencePushDefects(md.replace(EVIDENCE_PUSH, 'git push origin +HEAD; echo "exit=$?"'))).toContain('the push may force')
    expect(collectEvidencePushDefects(md.replace(pushFence, ''))).toEqual(['expected one push fence in Phase 10b, found 0'])
    expect(collectEvidencePushDefects(md.replace('spawn anyway', 'stop'))).toEqual(['a failed push may block the evidence spawn'])
  })
})

describe('AC-11: Phase 10b runs update-pr-evidence once, after Phase 10, for every strategy', () => {
  it('the publication partial has four importers, /implement among them', () => {
    const sources = walkFiles(path.join(ROOT, 'src'), f => f.endsWith('.mds')).map(f => ({
      name: path.basename(f, '.mds'),
      content: readFileSync(f, 'utf-8'),
    }))
    expect(sources.length, 'the src/ .mds walk found nothing').toBeGreaterThanOrEqual(20)
    // dynamic-build joined in #376 (W1): the wave PR's evidence refresh resolves the same value.
    expect(collectPublicationImporters(sources)).toEqual(['code-review', 'dynamic-build', 'implement', 'resolve'])
  })

  it('the order holds and the spawn carries the op\'s Input keys', () => {
    const md = implementMd()
    expect(collectOrderViolations('implement.md', md, PHASE10B_ORDER)).toEqual([])
    expect(collectEvidenceSpawnDefects(md)).toEqual([])
  })

  it('the re-validation path, the Report and Principle 12 name the evidence step', () => {
    const lines = implementMd().split('\n')
    expect(lines.find(l => l.startsWith('5. **Proceed to Phase 10**'))).toContain('**Phase 10b** (Evidence)')
    expect(lines.find(l => l.startsWith('Show the test plan\'s evidence from Phase 10b'))).toContain('never inferred')
    expect(lines.find(l => l.startsWith('12. **CI awareness**'))).toContain('test-plan evidence (Phase 10b) is recorded under every strategy')
  })

  it('known-bad probes: a lost spawn, a dropped key, a spawn before Phase 10 and a stray importer are reported', () => {
    const md = implementMd()
    expect(collectEvidenceSpawnDefects(md.replace(EVIDENCE_SPAWN, '"OPERATION: check-ci-status'))).toEqual([
      'expected one update-pr-evidence spawn, found 0',
    ])
    expect(collectEvidenceSpawnDefects(md.replace('\nREVIEW_PUBLICATION: {REVIEW_PUBLICATION resolved in Phase 1, or auto}', ''))).toEqual([
      'the spawn does not pass REVIEW_PUBLICATION',
    ])
    const early = md.replace('### Phase 10: Create PR', '### Phase 10 later').replace('### Phase 11: Report', '### Phase 10: Create PR\n\n### Phase 11: Report')
    expect(collectOrderViolations('implement.md', early, PHASE10B_ORDER).some(v => v.includes('Phase 10b follows Phase 10'))).toBe(true)
    expect(collectPublicationImporters([
      { name: 'implement', content: `@import { publication_gate } from "${PUBLICATION_IMPORT}"` },
      { name: 'stray', content: `@import "${PUBLICATION_IMPORT}" as pub` },
      { name: 'other', content: '@import { x } from "./_partials/_plan_contract.mds"' },
    ])).toEqual(['implement', 'stray'])
  })
})
