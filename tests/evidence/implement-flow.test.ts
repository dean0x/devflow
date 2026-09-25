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
 *   AC-11  The Phase 8 Test spawn passes TEST_PLAN.
 *   AC-9   /plan's artifact carries a `## Test Plan` section (required section
 *          13): Gate 2 shows the TP lines in the imported TP-line contract, and
 *          Phase 14 runs `check tp` over them before the artifact's one write —
 *          so the contract text, whose "Write every" would read as a second write
 *          instruction, stays out of Phase 14 (g5-issue-flow's single-write rule).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064).
 *
 * NOT covered: the TP scenario text class is P1's TP_LINE_RE, and it admits `#`,
 * `@` and `/` — a scenario that carries a `#N` reference, an `@`-mention or a
 * closing keyword passes `check block` and reaches the PR body. The exception
 * grammar removes those characters; the TP grammar does not. Reported to the
 * orchestrator rather than re-decided here, because narrowing TP_LINE_RE changes
 * a shared, parity-pinned contract.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import {
  collectOrderViolations,
  isAgentBlock,
  parseFences,
  requireDistFile,
  resolveAgentSource,
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
