/**
 * tests/evidence/implement-flow.test.ts
 *
 * SDLC-evidence PR4 (#363), phase P4: how the test plan travels from /implement to
 * the PR.
 *
 *   AC-10  ensure-pr-ready pastes `PR_TEST_PLAN_BLOCK` only after
 *          `verify-evidence.cjs check block` admits it. The caller-blocks bullet sits in
 *          step 4a before the PR_EXCEPTIONS gate and the D11 scrub,
 *          leaves the frozen fixture's three ensure-pr-ready anchors unique, and states the
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
 *          and the project-file remedy. `standard` never asks.
 *   AC-10  The Phase 9 Git spawn that opens the PR forwards PR_TEST_PLAN_BLOCK; no Code spawn takes it.
 *   AC-11  The Phase 7 Test spawn passes TEST_PLAN. Phase 6/8 PASSes and every
 *          Phase 7 run append claims whose shapes CLAIM_LINE_RE admits, and Phase
 *          11 — after Phase 10, one call for all three strategies — runs
 *          `verify-evidence.cjs publish` (the whole update-pr-evidence operation, #455:
 *          inline, no Git spawn) with the REVIEW_PUBLICATION Phase 1 resolved through
 *          the publication partial (its third importer, after the policy resolves).
 *   AC-9   /plan's artifact carries a `## Test Plan` section (required section
 *          13): Gate 2 shows the TP lines in the imported TP-line contract, and
 *          Phase 14 runs `check tp` over them before the artifact's one write —
 *          so the contract text, whose "Write every" would read as a second write
 *          instruction, stays out of Phase 14 (g5-issue-flow's single-write rule).
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector.
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
  CODE_AGENT_TYPES,
  collectOrderViolations,
  ensurePrReadyReference,
  isAgentBlock,
  parseFences,
  readAgentReference,
  requireDistFile,
  resolveAgentSource,
  ROOT,
  walkFiles,
  type OrderRule,
} from '../helpers.js'
import { PROJECT_CONFIG_LIB, SETTINGS_SCRIPT } from '../evidence-policy/scripted-shim.js'
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

/** Transcribed from the settings resolver's JSDoc: the project.json serializer the CLI prints from. */
interface ProjectSuggestionApi {
  serializeProjectSuggestion(input: unknown): string | null
}
const SETTINGS = createRequire(import.meta.url)(SETTINGS_SCRIPT) as ProjectSuggestionApi

/** Transcribed from lib/project-config.cjs's JSDoc: the one project.json parser. */
interface ProjectConfigApi {
  parseProjectBytes(buf: Uint8Array): { kind: string; evidence?: { kind: string; value?: unknown } }
}
const LIB = createRequire(import.meta.url)(PROJECT_CONFIG_LIB) as ProjectConfigApi

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'devflow-implement-flow-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** Run one verify-evidence subcommand in-process over a text written to a scratch file. */
function runOnText(sub: readonly string[], text: string, name: string): { code: number; stdout: string } {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, text)
  return VE.main(['node', 'verify-evidence.cjs', ...sub, file], { stderr: () => {} })
}

// ---------------------------------------------------------------------------
// ensure-pr-ready — the PR_TEST_PLAN_BLOCK paste gate (AC-10)
// ---------------------------------------------------------------------------
//
// The paste gate lives in ensure-pr-ready step 4a, beside the PR it opens (D-PR-BY-GIT). One
// `check block` serves the test-plan block and the wave block, so the rule is one bullet, "Caller
// blocks", read here beside the exception gate and the scrub.

const CALLER_BLOCKS = '   - **Caller blocks**'
const EXCEPTIONS_PASTE = '**Pasting `PR_EXCEPTIONS`.**'

/**
 * The three ensure-pr-ready lines the frozen github-status-lines fixture samples by first
 * match. The caller-blocks bullet must not repeat them, or a sampler could pick it up.
 */
const FROZEN_ANCHORS = [
  '| Related Issues (ISSUE_NUMBER provided) |',
  'When `ISSUE_NUMBER` is provided, always include',
  '**D11 scrub (PR body is a GitHub-visible sink):**',
] as const

const PASTE_ORDER: readonly OrderRule[] = [
  { label: 'the caller blocks precede the exception gate', before: CALLER_BLOCKS, after: EXCEPTIONS_PASTE },
  { label: 'the caller blocks precede the D11 scrub', before: CALLER_BLOCKS, after: FROZEN_ANCHORS[2] },
]

/** The caller-blocks bullet — one line — or null. */
function callerBlocksParagraph(ref: string): string | null {
  const hits = ref.split('\n').filter(l => l.startsWith(CALLER_BLOCKS))
  return hits.length === 1 ? hits[0] : null
}

/** Named collector: what ensure-pr-ready's PR_TEST_PLAN_BLOCK rule fails to state. */
function collectTestPlanPasteDefects(ref: string): string[] {
  const para = callerBlocksParagraph(ref)
  if (para === null) return ['no single caller-blocks paste paragraph']
  const step4a = ref.split('\n').find(l => l.startsWith('4a. Check if PR exists')) ?? ''
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('the value is saved with the Write tool, not a shell string', para.includes('with the Write tool') && para.includes('never via a shell string'))
  need('the gate is `verify-evidence.cjs check block`', para.includes('`PR_TEST_PLAN_BLOCK` (`check block`)') && /verify-evidence\.cjs" check <wave\|block> <file>; echo "exit=\$\?"/.test(para))
  need('only `exit=0` admits the value', para.includes('Only `exit=0` admits it, verbatim'))
  need('it is scrubbed with the body', step4a.includes('then append the caller blocks. Apply the Comment-sink scrub (D11)'))
  need('a mismatch is omitted, never repaired or partly pasted', para.includes('never repaired or partly pasted'))
  need('the DEGRADED reason', para.includes('`TRACEABILITY: DEGRADED (test-plan block does not match its grammar)`'))
  need('`(none)` is the documented absent case', para.includes('each when given and not `(none)`'))
  need('the scrubber-failure body never carries it', step4a.includes('a failed one posts neither block'))
  need('there is exactly one test-plan check', ref.split('check block').length - 1 === 1)
  return out
}

describe('AC-10: ensure-pr-ready pastes PR_TEST_PLAN_BLOCK only through `check block`', () => {
  it('the bullet sits before the exception gate and the D11 scrub; the frozen anchors stay unique', () => {
    const ref = ensurePrReadyReference()
    expect(collectOrderViolations('ensure-pr-ready.md', ref, PASTE_ORDER)).toEqual([])
    for (const anchor of FROZEN_ANCHORS) expect(ref.split(anchor).length - 1, anchor).toBe(1)
    expect(callerBlocksParagraph(ref) ?? '', 'the bullet must not spell a frozen anchor').not.toMatch(/ISSUE_NUMBER|D11 scrub \(/)
  })

  it('the bullet states the gate, the placement, the refusal and the absent case', () => {
    expect(collectTestPlanPasteDefects(ensurePrReadyReference())).toEqual([])
  })

  it('known-bad probes: a repairing bullet, a lost gate, a second check and a missing bullet are reported', () => {
    const ref = ensurePrReadyReference()
    const repairs = ref.replace('never repaired or partly pasted', 'repaired, then pasted')
    expect(repairs, 'the seed must land').not.toBe(ref)
    expect(collectTestPlanPasteDefects(repairs)).toEqual(['a mismatch is omitted, never repaired or partly pasted'])
    const ungated = ref.replace(' check <wave|block> <file>', ' render --plan <file>')
    expect(ungated, 'the seed must land').not.toBe(ref)
    expect(collectTestPlanPasteDefects(ungated)).toEqual(['the gate is `verify-evidence.cjs check block`'])
    expect(collectTestPlanPasteDefects(`${ref}\nthen run check block again`)).toEqual(['there is exactly one test-plan check'])
    expect(collectTestPlanPasteDefects(ref.replace(CALLER_BLOCKS, '   - **Blocks**'))).toEqual(['no single caller-blocks paste paragraph'])
  })

  it('ensure-pr-ready declares PR_TEST_PLAN_BLOCK as an optional input, and the Code agent declares none of the PR inputs', () => {
    const input = ensurePrReadyReference().split('\n').find(l => l.startsWith('**Input:**')) ?? ''
    expect(input).toContain('`PR_TEST_PLAN_BLOCK` (optional)')
    const code = resolveAgentSource('code').content
    expect(code).not.toContain('PR_TEST_PLAN_BLOCK')
    expect(code).not.toContain('pr-create')
  })
})

// ---------------------------------------------------------------------------
// The gate ensure-pr-ready names — executed
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
/** Every spawn of the Code family (D-CODE-VARIANTS): Code, Code-fix and Code-edit. */
const CODE_FAMILY_SPAWNS = CODE_AGENT_TYPES.map(type => `Agent(subagent_type="${type}")`)
const TICKET_ASK = '**Ticket link, only when `ISSUE_REQUIRED` is `true`:**'
const RECORD = '**Record the exception at once**'
const TEST_PLAN_STEP = '**Test plan.** Before any Code spawn'
const MISSING_ASK = '**Missing test plan, only when `EVIDENCE_POLICY` is `required`:**'
const OUTPUTS = '**Test-plan outputs**'
const STANDARD_LINE = 'When `EVIDENCE_POLICY` is `standard`, a missing test plan is never asked about'

function implementMd(): string {
  return requireDistFile('implement.md')
}

/** D-CMD-REF-HAND: the ticket-link and missing-test-plan steps /implement reads on demand. */
function evidenceAsksReference(): string {
  return readAgentReference('commands/implement-evidence-asks.md')
}

/** D-CMD-REF-HAND: the re-validation continuation path /implement reads on demand. */
function revalidateReference(): string {
  return readAgentReference('commands/implement-revalidate.md')
}

/** The order Phase 1 keeps, invocation to first Code spawn. Every anchor is unique in the built file. */
const PHASE1_ORDER: readonly OrderRule[] = [
  { label: 'the policy resolves before setup-task', before: 'resolve-evidence-policy.cjs', after: 'OPERATION: setup-task' },
  { label: 'setup-task runs before the ticket ask', before: 'OPERATION: setup-task', after: TICKET_ASK },
  { label: 'the ticket exception is recorded before the test-plan step', before: RECORD, after: TEST_PLAN_STEP },
  { label: 'the test plan is checked before it can be missing', before: 'check tp "{worktree}/.devflow/docs/evidence-{branch_slug}.md"', after: MISSING_ASK },
  { label: 'the missing-plan ask precedes the outputs', before: MISSING_ASK, after: OUTPUTS },
  { label: 'the outputs are set before Phase 2', before: OUTPUTS, after: '### Phase 2: Implement' },
]

/** Named collector: Code spawns that open before `anchor` — every one must follow it, not just the first. */
function collectCodeSpawnsBefore(content: string, anchor: string): string[] {
  const at = content.indexOf(anchor)
  if (at === -1) return [`the anchor is absent: "${anchor}"`]
  const out: string[] = []
  for (const spawn of CODE_FAMILY_SPAWNS) {
    for (let i = content.indexOf(spawn); i !== -1; i = content.indexOf(spawn, i + spawn.length)) {
      if (i < at) out.push(`a Code spawn at offset ${i} opens before "${anchor}" (offset ${at})`)
    }
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
    const script = 'node "$HOME/.devflow/scripts/verify-evidence.cjs"'
    expect(lines).toContain(`${script} check tp "{worktree}/.devflow/docs/evidence-{branch_slug}.md"; echo "exit=$?"`)
    expect(lines).toContain(`${script} render --plan "{worktree}/.devflow/docs/evidence-{branch_slug}.md"; echo "exit=$?"`)
  })
})

/** The missing-plan ask: from its gate to the blank line after its last option. Read from the evidence-asks reference. */
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
  need('the same Evidence Exceptions section of the handoff file', block.includes('`## Evidence Exceptions` section of `{worktree}/.devflow/docs/handoff-{branch_slug}.md`'))
  need('the BLOCKED report', block.includes('`BLOCKED (no test plan)`'))
  need('the branch and BASE_BRANCH', block.includes('`TASK_ID`') && block.includes('`BASE_BRANCH`'))
  need('the project-file remedy', block.includes('`.devflow/project.json`'))
  return out
}

describe('AC-9: a missing test plan asks only under `required`, and a stop names its remedy', () => {
  it('the ask states every part of the contract', () => {
    expect(collectMissingAskDefects(missingAskBlock(evidenceAsksReference()))).toEqual([])
  })

  it('the command keeps the ask\'s gate and sends the run to the reference, once, by explicit path', () => {
    const md = implementMd()
    const gates = md.split('\n').filter(l => l.startsWith(MISSING_ASK))
    expect(gates, 'exactly one gate line in the command').toHaveLength(1)
    expect(gates[0]).toContain('evidence-asks reference')
    expect(gates[0]).toContain('before any Code spawn')
    expect(gates[0], 'the ask itself lives in the reference').not.toContain('AskUserQuestion')
    expect(md.split('skills/devflow:agent-references/references/commands/implement-evidence-asks.md').length - 1, 'one explicit read path').toBe(1)
  })

  it('the remedy quotes the canonical standard project file, and it parses', () => {
    const block = missingAskBlock(evidenceAsksReference())!
    const literal = /`(\{"version":1,[^`]*\})`/.exec(block)?.[1]
    expect(literal, 'the remedy must quote the project file').toBeDefined()
    expect(`${literal}\n`).toBe(SETTINGS.serializeProjectSuggestion({ evidence: 'standard' }))
    expect(LIB.parseProjectBytes(new TextEncoder().encode(literal!)).evidence).toEqual({ kind: 'valid', value: 'standard' })
  })

  it('under `standard` the missing plan is reported and never asked about', () => {
    const lines = implementMd().split('\n').filter(l => l.startsWith(STANDARD_LINE))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Phase 12 report')
    expect(lines[0]).not.toContain('AskUserQuestion')
  })

  it('known-bad probes: a third option, a lost BLOCKED report and a missing block are reported', () => {
    const block = missingAskBlock(evidenceAsksReference())!
    const third = block.replace('- **Stop** — ', '- **Skip the plan** — carry on.\n- **Stop** — ')
    expect(collectMissingAskDefects(third).some(d => d.startsWith('exactly the two options'))).toBe(true)
    expect(collectMissingAskDefects(block.replace('`BLOCKED (no test plan)`', 'an error'))).toEqual(['the BLOCKED report'])
    expect(collectMissingAskDefects(null)).toEqual(['no missing-plan ask block'])
  })
})

// ---------------------------------------------------------------------------
// /implement spawns — PR_TEST_PLAN_BLOCK (AC-10) and TEST_PLAN (AC-11)
// ---------------------------------------------------------------------------

const FORWARD_LINE = 'PR_TEST_PLAN_BLOCK: {PR_TEST_PLAN_BLOCK verbatim, or (none)}'

/**
 * Named collector: ensure-pr-ready spawns that do not forward the block, and Code spawns that do
 * (the Code agent opens no PR, so a block in its prompt is dead weight). Returns the violations and
 * how many PR-opening spawns were read.
 */
function collectTestPlanForwarding(content: string): { opening: number; violations: string[] } {
  let opening = 0
  const violations: string[] = []
  parseFences(content).forEach((fence, i) => {
    const lines = fence.split('\n').map(l => l.replace(/"$/, ''))
    if (CODE_AGENT_TYPES.some(type => isAgentBlock(fence, type)) && lines.some(l => l.startsWith('PR_TEST_PLAN_BLOCK:'))) {
      violations.push(`fence ${i + 1}: a Code spawn carries PR_TEST_PLAN_BLOCK`)
    }
    if (!isAgentBlock(fence, 'Git') || !fence.includes('OPERATION: ensure-pr-ready')) return
    opening++
    if (!lines.includes(FORWARD_LINE)) violations.push(`fence ${i + 1}: the PR-opening Git spawn without "${FORWARD_LINE}"`)
  })
  return { opening, violations }
}

describe('AC-10/AC-11: the spawns carry the test plan', () => {
  it('the one PR-opening Git spawn forwards PR_TEST_PLAN_BLOCK, and no Code spawn does', () => {
    const { opening, violations } = collectTestPlanForwarding(implementMd())
    expect(opening, 'exactly one PR-opening Git spawn: Phase 9, under every strategy').toBe(1)
    expect(violations).toEqual([])
  })

  it('known-bad probes: a spawn that lost the key and a Code spawn that gained it are reported', () => {
    const md = implementMd()
    const dropped = md.replace(`\n${FORWARD_LINE}`, '')
    expect(dropped, 'the drop seed must land').not.toBe(md)
    expect(collectTestPlanForwarding(dropped).violations).toHaveLength(1)
    const gained = md.replace('"OPERATION: alignment-fix\n', '"OPERATION: alignment-fix\nPR_TEST_PLAN_BLOCK: x\n')
    expect(gained, 'the gain seed must land').not.toBe(md)
    expect(collectTestPlanForwarding(gained).violations).toEqual([expect.stringContaining('a Code spawn carries PR_TEST_PLAN_BLOCK')])
  })

  it('the Phase 7 Test spawn passes TEST_PLAN from the evidence file', () => {
    const tests = parseFences(implementMd()).filter(f => isAgentBlock(f, 'Test'))
    expect(tests, 'the Phase 7 Test spawn').toHaveLength(1)
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

  it('Phase 6 and Phase 8 PASS append the gate claim, and every Phase 7 run its TP claims', () => {
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
// /implement — REVIEW_PUBLICATION and Phase 11 (AC-11)
// ---------------------------------------------------------------------------

const PUBLICATION_IMPORT = './_partials/_publication.mds'

/** Named collector: which src .mds hosts import the publication partial, in any import form. */
function collectPublicationImporters(sources: ReadonlyArray<{ name: string; content: string }>): string[] {
  const importLine = new RegExp(`^@import\\b.*"${PUBLICATION_IMPORT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`, 'm')
  return sources.filter(s => importLine.test(s.content)).map(s => s.name).sort()
}

const PHASE11 = '### Phase 11: Evidence'
/** The Phase 11 call (#455): the script runs inline; no Git agent is spawned for it. */
const EVIDENCE_RUN = 'verify-evidence.cjs" publish --pr {PR_NUMBER}'
const EVIDENCE_SPAWN = '"OPERATION: update-pr-evidence'

/** The push before the evidence call: claims keyed to a local HEAD must be in the PR before Phase 11 reads them. */
const EVIDENCE_PUSH = 'git push origin HEAD; echo "exit=$?"'

/** The Phase 11 push, made unique: Phase 10's preamble spells the same command, followed by "the gate". */
const EVIDENCE_PUSH_ANCHOR = `${EVIDENCE_PUSH}\n\`\`\`\n\n\`exit=0\` continues to the script`

const PHASE11_ORDER: readonly OrderRule[] = [
  { label: 'the policy resolves before the publication partial reads it', before: 'resolve-evidence-policy.cjs', after: '**Evidence stub:**' },
  { label: 'REVIEW_PUBLICATION resolves in Phase 1', before: '**Evidence stub:**', after: '### Phase 2: Implement' },
  { label: 'Phase 11 follows the CI gate', before: '### Phase 10: CI Status Gate', after: PHASE11 },
  { label: 'the push sits in Phase 11', before: PHASE11, after: EVIDENCE_PUSH_ANCHOR },
  { label: 'the push precedes the evidence call', before: EVIDENCE_PUSH_ANCHOR, after: EVIDENCE_RUN },
  { label: 'the evidence call sits in Phase 11', before: PHASE11, after: EVIDENCE_RUN },
  { label: 'the report follows the evidence call', before: EVIDENCE_RUN, after: '### Phase 12: Report' },
]

/**
 * Named collector: what Phase 11's evidence call lacks — exactly one inline script call
 * from the worktree carrying the op's Input as flags, and no Git spawn for the op.
 */
function collectEvidenceRunDefects(content: string): string[] {
  const at = content.indexOf(PHASE11)
  const end = content.indexOf('### Phase 12: Report')
  if (at === -1 || end === -1) return ['no Phase 11 section']
  const phase = content.slice(at, end)
  const out: string[] = []
  const runs = parseFences(phase).filter(f => f.includes(EVIDENCE_RUN))
  if (runs.length !== 1) return [`expected one evidence script call in Phase 11, found ${runs.length}`]
  if (!runs[0].startsWith('```bash\n')) out.push('the call is not a bash fence')
  if (!runs[0].includes('cd "{worktree}" && node "$HOME/.devflow/scripts/verify-evidence.cjs" publish')) out.push('the call does not run from the worktree')
  // Repo-relative by the op's shape gate (no space admitted); it resolves under the cd the same line makes (D-DOCS-ROOT).
  if (!runs[0].includes('--evidence ".devflow/docs/evidence-{branch_slug}.md"')) out.push('--evidence is not the evidence file')
  if (!runs[0].includes('--publication {REVIEW_PUBLICATION resolved in Phase 1, or auto}')) out.push('the call does not pass REVIEW_PUBLICATION')
  const spawns = parseFences(content).filter(f => isAgentBlock(f, 'Git') && f.includes(EVIDENCE_SPAWN))
  if (spawns.length !== 0) out.push(`a Git agent is still spawned for update-pr-evidence (${spawns.length})`)
  if (!phase.includes('under every strategy')) out.push('Phase 11 does not run under every strategy')
  if (!phase.includes('It never blocks')) out.push('Phase 11 may block')
  if (!phase.includes('Use the Bash tool with `timeout: 180000`')) out.push('the call carries no Bash timeout above the script\'s two deadlines')
  if (!phase.includes('path does not match `^[A-Za-z0-9._/-]{1,255}$`')) out.push('the evidence path reaches the shell ungated')
  if (!phase.includes('`TRACEABILITY: DEGRADED (evidence unavailable)`')) out.push('a failed run names no DEGRADED reason')
  return out
}

/**
 * Named collector: what Phase 11's push lacks. It is the command's only push: one
 * bash fence, never forced, never retried, and a failure is a DEGRADED line rather
 * than a stop — the evidence call still runs, and an unpushed claim reads
 * UNVERIFIED rather than blocking the PR.
 */
function collectEvidencePushDefects(content: string): string[] {
  const at = content.indexOf(PHASE11)
  const end = content.indexOf('### Phase 12: Report')
  if (at === -1 || end === -1) return ['no Phase 11 section']
  const phase = content.slice(at, end)
  const out: string[] = []
  const pushes = parseFences(phase).filter(f => /\bgit\b[^\n]*\bpush\b/.test(f))
  if (pushes.length !== 1) out.push(`expected one push fence in Phase 11, found ${pushes.length}`)
  if (pushes.some(f => !f.includes(EVIDENCE_PUSH))) out.push('the push is not the stated command')
  if (pushes.some(f => /(^|\s)(--force(-with-lease)?\b|-f\b|\+\S)/.test(f))) out.push('the push may force')
  if (!phase.includes('never force, and no retry')) out.push('the push does not say never force, no retry')
  if (!phase.includes('`TRACEABILITY: DEGRADED (evidence push failed)`')) out.push('a failed push names no DEGRADED reason')
  if (!phase.includes('does not block') || !phase.includes('run the script anyway')) out.push('a failed push may block the evidence call')
  return out
}

describe('0b: Phase 11 pushes the branch before the evidence call', () => {
  it('one unforced push precedes the call, and its failure is DEGRADED, never a stop', () => {
    const md = implementMd()
    // Per phase: the Phase 10 preamble pushes once for the CI gate, Phase 11 once for the evidence call.
    const phase11 = md.slice(md.indexOf(PHASE11), md.indexOf('### Phase 12: Report'))
    expect(phase11.split(EVIDENCE_PUSH).length - 1, 'the Phase 11 push is the corpus').toBe(1)
    expect(md.split(EVIDENCE_PUSH).length - 1, 'the push command appears in Phase 10 and Phase 11 only').toBe(2)
    expect(collectEvidencePushDefects(md)).toEqual([])
    expect(collectOrderViolations('implement.md', md, PHASE11_ORDER)).toEqual([])
  })

  it('the Report surfaces the push\'s DEGRADED line and Phase 11 says the push never forces and never stops the run', () => {
    const md = implementMd()
    expect(md).toContain('or Phase 10\'s push, Phase 11\'s push or Phase 11\'s script output carried one, surface them verbatim')
    // The diagram's sub-bullet restated this paragraph and was cut; the Phase 11 body is the one statement.
    const phase = md.slice(md.indexOf(PHASE11), md.indexOf('### Phase 12: Report'))
    expect(phase).toContain('push the branch once before the script — never force, and no retry')
    expect(phase).toContain('does not block: record `TRACEABILITY: DEGRADED (evidence push failed)`')
  })

  it('known-bad probes: a push after the spawn, a forced push, a lost push and a blocking failure are reported', () => {
    const md = implementMd()
    const phase = md.slice(md.indexOf(PHASE11), md.indexOf('### Phase 12: Report'))
    const pushFence = '```bash\n' + EVIDENCE_PUSH + '\n```\n\n'
    expect(phase.includes(pushFence), 'the push fence moved').toBe(true)
    const lastFence = md.lastIndexOf(pushFence)
    expect(lastFence, 'the Phase 11 push fence is the last one').toBeGreaterThan(md.indexOf(PHASE11))
    const late = (md.slice(0, lastFence) + md.slice(lastFence + pushFence.length)).replace('### Phase 12: Report', pushFence + '### Phase 12: Report')
    expect(collectOrderViolations('implement.md', late, PHASE11_ORDER).some(v => v.includes('the push precedes the evidence call'))).toBe(true)
    const reseed = (to: string): string => md.slice(0, md.indexOf(PHASE11)) + md.slice(md.indexOf(PHASE11)).replace(EVIDENCE_PUSH, to)
    expect(collectEvidencePushDefects(reseed('git push --force origin HEAD; echo "exit=$?"'))).toEqual([
      'the push is not the stated command',
      'the push may force',
    ])
    expect(collectEvidencePushDefects(reseed('git push origin +HEAD; echo "exit=$?"'))).toContain('the push may force')
    expect(collectEvidencePushDefects(md.slice(0, lastFence) + md.slice(lastFence + pushFence.length))).toEqual(['expected one push fence in Phase 11, found 0'])
    expect(collectEvidencePushDefects(md.replace('run the script anyway', 'stop'))).toEqual(['a failed push may block the evidence call'])
  })
})

describe('AC-11: Phase 11 runs the evidence script once, after Phase 10, for every strategy', () => {
  it('the publication partial has four importers, /implement among them', () => {
    const sources = walkFiles(path.join(ROOT, 'src'), f => f.endsWith('.mds')).map(f => ({
      name: path.basename(f, '.mds'),
      content: readFileSync(f, 'utf-8'),
    }))
    expect(sources.length, 'the src/ .mds walk found nothing').toBeGreaterThanOrEqual(20)
    // dynamic-build joined in #376 (W1): the wave PR's evidence refresh resolves the same value.
    expect(collectPublicationImporters(sources)).toEqual(['code-review', 'dynamic-build', 'implement', 'resolve'])
  })

  it('the order holds and the call carries the op\'s Input as flags', () => {
    const md = implementMd()
    expect(collectOrderViolations('implement.md', md, PHASE11_ORDER)).toEqual([])
    expect(collectEvidenceRunDefects(md)).toEqual([])
  })

  it('the re-validation path, the Report and the CI-awareness principle name the evidence step', () => {
    const lines = implementMd().split('\n')
    expect(revalidateReference().split('\n').find(l => l.startsWith('5. **Proceed to Phase 9**'))).toContain('**Phase 11** (Evidence)')
    expect(lines.find(l => l.startsWith('Show the test plan\'s evidence from Phase 11'))).toContain('never inferred')
    expect(lines.find(l => /^\d+\. \*\*CI awareness\*\*/.test(l))).toContain('test-plan evidence (Phase 11) is recorded under every strategy')
  })

  it('known-bad probes: a lost call, a dropped flag, a Git spawn put back, a call before the CI gate and a stray importer are reported', () => {
    const md = implementMd()
    expect(collectEvidenceRunDefects(md.replace(EVIDENCE_RUN, 'verify-evidence.cjs" check tp'))).toEqual([
      'expected one evidence script call in Phase 11, found 0',
    ])
    expect(collectEvidenceRunDefects(md.replace(' --publication {REVIEW_PUBLICATION resolved in Phase 1, or auto}', ''))).toEqual([
      'the call does not pass REVIEW_PUBLICATION',
    ])
    expect(collectEvidenceRunDefects(md.replace('cd "{worktree}" && ', ''))).toEqual(['the call does not run from the worktree'])
    const back = md.replace('### Phase 12: Report', '```\nAgent(subagent_type="Git"):\n"OPERATION: update-pr-evidence\nPR_NUMBER: {PR_NUMBER}"\n```\n\n### Phase 12: Report')
    expect(collectEvidenceRunDefects(back)).toEqual(['a Git agent is still spawned for update-pr-evidence (1)'])
    expect(collectEvidenceRunDefects(md.replace('Use the Bash tool with `timeout: 180000`', 'Use the Bash tool'))).toEqual([
      'the call carries no Bash timeout above the script\'s two deadlines',
    ])
    const early = md.replace('### Phase 10: CI Status Gate', '### Phase 10 later').replace('### Phase 12: Report', '### Phase 10: CI Status Gate\n\n### Phase 12: Report')
    expect(collectOrderViolations('implement.md', early, PHASE11_ORDER).some(v => v.includes('Phase 11 follows the CI gate'))).toBe(true)
    expect(collectPublicationImporters([
      { name: 'implement', content: `@import { publication_gate } from "${PUBLICATION_IMPORT}"` },
      { name: 'stray', content: `@import "${PUBLICATION_IMPORT}" as pub` },
      { name: 'other', content: '@import { x } from "./_partials/_plan_contract.mds"' },
    ])).toEqual(['implement', 'stray'])
  })
})

// ---------------------------------------------------------------------------
// #421 (t04): the gate order, the one full Validate, and the push before CI
// ---------------------------------------------------------------------------
//
// D-VALIDATE-ONCE   Validate takes the one full-suite slot, after every commit it must
//                   cover (Code, Simplify, Scrutinize, the alignment fixes): the order
//                   is Code, Simplify, Scrutinize, Evaluate, Validate (full), Test, the
//                   conditional changed-only Validate, push, CI gate. A qa-fix is the
//                   only commit after the full run, so only it earns Phase 8. No loop
//                   spawns a Validate of its own and nothing re-validates on a
//                   Scrutinize FIXED status.
// D-CI-WAIT-INLINE  Phase 10 pushes first, with its own command outside the gate block,
//                   then waits through ci-wait.cjs. A failed push records
//                   `TRACEABILITY: DEGRADED (ci push failed)` and waits for nothing.
//
// Every guard has a named collector, a non-empty-corpus assertion and a known-bad
// probe run through the same collector. The absence guards (no Validate in a loop, no
// re-validate on FIXED, no old pointer) pass vacuously when the text they read is
// missing, so each has a probe that seeds the defect and a corpus assertion.

/** The `### Phase N:` section: from its heading to the next phase heading or the Architecture section. */
function phaseSection(md: string, heading: string): string | null {
  const at = md.indexOf(heading)
  if (at === -1) return null
  const rest = md.slice(at + heading.length)
  const next = rest.search(/\n### Phase |\n## Architecture/)
  return next === -1 ? md.slice(at) : md.slice(at, at + heading.length + next)
}

const H = {
  p1: '### Phase 1: Setup',
  p2: '### Phase 2: Implement',
  p3: '### Phase 3: Simplify',
  p4: '### Phase 4: Self-Review',
  p5: '### Phase 5: Alignment Check',
  p6: '### Phase 6: Validate',
  p7: '### Phase 7: QA Testing',
  p8: '### Phase 8: Re-Validate (only if a qa-fix committed)',
  p9: '### Phase 9: Open PR',
  p10: '### Phase 10: CI Status Gate',
  p11: '### Phase 11: Evidence',
  p12: '### Phase 12: Report',
} as const

const SPAWN = (type: string): string => `Agent(subagent_type="${type}")`
const CI_WAIT_CALL = 'node "$HOME/.devflow/scripts/ci-wait.cjs" --pr {PR_NUMBER} --head "$HEAD_SHA"'

/** The post-code order D-VALIDATE-ONCE fixes, one anchor per step; each is unique in the built file. */
const GATE_ORDER: readonly OrderRule[] = [
  { label: 'Simplify follows implementation', before: H.p2, after: SPAWN('Simplify') },
  { label: 'Scrutinize follows Simplify', before: SPAWN('Simplify'), after: SPAWN('Scrutinize') },
  { label: 'Evaluate follows Scrutinize', before: SPAWN('Scrutinize'), after: SPAWN('Evaluate') },
  { label: 'the full Validate follows Evaluate', before: SPAWN('Evaluate'), after: 'VALIDATION_SCOPE: full' },
  { label: 'Test follows the full Validate', before: 'VALIDATION_SCOPE: full', after: SPAWN('Test') },
  { label: 'the changed-only Validate follows Test', before: SPAWN('Test'), after: 'VALIDATION_SCOPE: changed-only' },
  { label: 'the PR opens after the changed-only Validate', before: 'VALIDATION_SCOPE: changed-only', after: H.p9 },
  { label: 'the CI gate follows the PR opening', before: H.p9, after: H.p10 },
  { label: 'the CI wait follows the CI gate heading', before: H.p10, after: CI_WAIT_CALL },
  { label: 'the evidence step follows the CI wait', before: CI_WAIT_CALL, after: H.p11 },
]

/** Named collector: the phase headings, in order, with the names the tests pin. */
function collectPhaseHeadingDefects(md: string): string[] {
  const out = collectOrderViolations('implement.md', md, Object.values(H).slice(0, -1).map((h, i, all) => ({
    label: `${h.slice(4)} precedes the next phase`,
    before: h,
    after: Object.values(H)[i + 1],
  })).filter((_, i) => i < Object.values(H).length - 1))
  return out
}

describe('#421 AC-1: the gates run Code, Simplify, Scrutinize, Evaluate, Validate, Test, the conditional Validate, push, CI', () => {
  it('every post-code step follows the one before it, and the phase headings hold their order', () => {
    const md = implementMd()
    expect(collectOrderViolations('implement.md', md, GATE_ORDER)).toEqual([])
    expect(collectPhaseHeadingDefects(md)).toEqual([])
  })

  it('known-bad probe: a Validate before Simplify (the order before #421) is reported', () => {
    const md = implementMd()
    const early = md.replace('VALIDATION_SCOPE: full', 'VALIDATION_SCOPE: other').replace(SPAWN('Simplify'), `VALIDATION_SCOPE: full\n${SPAWN('Simplify')}`)
    expect(early, 'the seed must land').not.toBe(md)
    const violations = collectOrderViolations('implement.md', early, GATE_ORDER)
    expect(violations.some(v => v.includes('the full Validate follows Evaluate'))).toBe(true)
    expect(violations).toHaveLength(1)
  })

  it('known-bad probe: a lost phase heading is reported', () => {
    const md = implementMd()
    expect(collectPhaseHeadingDefects(md.replace(H.p6, '### Phase 6 gone')).length).toBeGreaterThan(0)
  })
})

/** Named collector: what the one full-suite slot and its two claim sites lack. */
function collectValidateOnceDefects(md: string): string[] {
  const out: string[] = []
  const validates = parseFences(md).filter(f => isAgentBlock(f, 'Validate'))
  const full = validates.filter(f => f.includes('VALIDATION_SCOPE: full'))
  if (full.length !== 1) out.push(`expected one full-scope Validate spawn, found ${full.length}`)
  if (validates.length !== 2) out.push(`expected two Validate spawns (Phase 6 and Phase 8), found ${validates.length}`)
  const claimLines = md.split('\n').filter(l => l.startsWith('**If PASS:** append a `gate:validate` claim'))
  if (claimLines.length !== 2) out.push(`expected two gate:validate claim lines, found ${claimLines.length}`)
  const inPhase = (heading: string): number => (phaseSection(md, heading) ?? '').split('\n').filter(l => l.startsWith('**If PASS:** append a `gate:validate` claim')).length
  if (inPhase(H.p6) !== 1) out.push('Phase 6 does not hold exactly one claim line')
  if (inPhase(H.p8) !== 1) out.push('Phase 8 does not hold exactly one claim line')
  const six = phaseSection(md, H.p6) ?? ''
  if (!six.includes('record the result as `VALIDATED_HEAD`')) out.push('Phase 6 does not record VALIDATED_HEAD')
  if (!six.includes('re-validate at the new HEAD, full scope')) out.push('a Phase 6 retry does not re-run at full scope at its new HEAD')
  return out
}

describe('#421 AC-2: one full-scope Validate, and exactly two claim sites', () => {
  it('Phase 6 holds the only full Validate and its claim; Phase 8 holds the second claim', () => {
    const md = implementMd()
    expect(parseFences(md).filter(f => isAgentBlock(f, 'Validate')).length, 'no Validate spawn read').toBeGreaterThanOrEqual(2)
    expect(collectValidateOnceDefects(md)).toEqual([])
  })

  it('known-bad probes: a second full Validate, a third claim line and a lost VALIDATED_HEAD are reported', () => {
    const md = implementMd()
    const second = md.replace('VALIDATION_SCOPE: changed-only', 'VALIDATION_SCOPE: full')
    expect(second, 'the seed must land').not.toBe(md)
    expect(collectValidateOnceDefects(second)).toContain('expected one full-scope Validate spawn, found 2')
    const third = md.replace('### Phase 9: Open PR', '**If PASS:** append a `gate:validate` claim again.\n\n### Phase 9: Open PR')
    expect(collectValidateOnceDefects(third)).toContain('expected two gate:validate claim lines, found 3')
    expect(collectValidateOnceDefects(md.replace('record the result as `VALIDATED_HEAD`', 'remember it'))).toEqual(['Phase 6 does not record VALIDATED_HEAD'])
  })
})

/** Phases whose loops and steps must never spawn a Validate of their own. */
const VALIDATE_FREE_PHASES = [H.p3, H.p4, H.p5, H.p7] as const

/**
 * Named collector: Validate spawns inside the Simplify, Scrutinize, alignment and QA
 * phases, and any sentence that re-validates because Scrutinize reported FIXED. The
 * Phase 6 run covers all of them; the Phase 8 run covers a qa-fix.
 */
function collectLoopValidateDefects(md: string): string[] {
  const out: string[] = []
  for (const heading of VALIDATE_FREE_PHASES) {
    const section = phaseSection(md, heading)
    if (section === null) {
      out.push(`${heading}: the section is absent`)
      continue
    }
    const spawns = parseFences(section).filter(f => isAgentBlock(f, 'Validate'))
    if (spawns.length > 0) out.push(`${heading}: ${spawns.length} Validate spawn(s) inside the phase`)
    if (/(?:status|Status)[^\n]*FIXED[^\n]*\b(?:spawn|re-run|rerun)\b[^\n]*Validate/.test(section)) out.push(`${heading}: a FIXED status triggers a Validate`)
  }
  const four = phaseSection(md, H.p4) ?? ''
  if (!four.includes('starts no Validate of its own')) out.push('Phase 4 does not say a FIXED status starts no Validate')
  return out
}

describe('#421 AC-3: no Validate inside the alignment loop, the QA loop or on a Scrutinize FIXED status', () => {
  it('the Simplify, Scrutinize, alignment and QA phases spawn no Validate', () => {
    const md = implementMd()
    for (const heading of VALIDATE_FREE_PHASES) expect(parseFences(phaseSection(md, heading) ?? '').length, `${heading}: no fence read`).toBeGreaterThan(0)
    expect(collectLoopValidateDefects(md)).toEqual([])
  })

  it('known-bad probes: a Validate re-inserted into each loop and a FIXED-triggered re-validate are each reported', () => {
    const md = implementMd()
    const validate = '```\nAgent(subagent_type="Validate"):\n"FILES_CHANGED: {files}\nVALIDATION_SCOPE: changed-only"\n```\n'
    const align = md.replace('   - Loop back to Phase 5', `   - Spawn Validate agent to verify the fix:\n${validate}   - Loop back to Phase 5`)
    expect(align, 'the seed must land').not.toBe(md)
    expect(collectLoopValidateDefects(align)).toEqual([`${H.p5}: 1 Validate spawn(s) inside the phase`])
    const qa = md.replace('   - Loop back to Phase 7', `   - Spawn Validate agent to verify the fix:\n${validate}   - Loop back to Phase 7`)
    expect(qa, 'the seed must land').not.toBe(md)
    expect(collectLoopValidateDefects(qa)).toEqual([`${H.p7}: 1 Validate spawn(s) inside the phase`])
    const fixed = md.replace('starts no Validate of its own', 'spawns the Validate agent')
    expect(collectLoopValidateDefects(fixed)).toContain('Phase 4 does not say a FIXED status starts no Validate')
    const refire = md.replace('After Simplify agent completes, spawn Scrutinize agent', 'After Simplify agent completes, spawn Scrutinize agent')
      .replace('**If PASS or FIXED:** continue to Phase 5.', `If Scrutinize agent made changes (status: FIXED), spawn Validate agent:\n${validate}\n**If PASS or FIXED:** continue to Phase 5.`)
    expect(refire, 'the seed must land').not.toBe(md)
    expect(collectLoopValidateDefects(refire).some(d => d.includes('Validate spawn(s) inside the phase'))).toBe(true)
  })
})

/** Named collector: what Phase 8 fails to state in its own text. */
function collectPhase8Defects(md: string): string[] {
  const text = phaseSection(md, H.p8)
  if (text === null) return ['no Phase 8 section']
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('the condition (only if a qa-fix committed)', text.includes('only if a qa-fix committed (`git rev-parse HEAD` differs from `VALIDATED_HEAD`)'))
  need('the scope (changed files since VALIDATED_HEAD)', text.includes('`git diff --name-only VALIDATED_HEAD..HEAD`') && text.includes('VALIDATION_SCOPE: changed-only'))
  need('the FAIL arm (report and halt)', /\*\*If FAIL:\*\* Report the failures to user and halt\./.test(text))
  need('the PASS arm appends the second claim', text.includes('**If PASS:** append a `gate:validate` claim'))
  return out
}

describe('#421 AC-4: Phase 8 states its condition, its scope and its FAIL arm in its own text', () => {
  it('all three are stated', () => {
    expect(collectPhase8Defects(implementMd())).toEqual([])
  })

  it('known-bad probes: each lost statement is reported by name', () => {
    const md = implementMd()
    expect(collectPhase8Defects(md.replace('only if a qa-fix committed (`git rev-parse HEAD` differs from `VALIDATED_HEAD`)', 'always'))).toEqual(['the condition (only if a qa-fix committed)'])
    expect(collectPhase8Defects(md.replace('`git diff --name-only VALIDATED_HEAD..HEAD`', 'the Code agent\'s list'))).toEqual(['the scope (changed files since VALIDATED_HEAD)'])
    expect(collectPhase8Defects(md.replace('**If FAIL:** Report the failures to user and halt.', '**If FAIL:** carry on.'))).toEqual(['the FAIL arm (report and halt)'])
    expect(collectPhase8Defects(md.replace(H.p8, '### Phase 8 gone'))).toEqual(['no Phase 8 section'])
  })
})

/** The push, as Phase 10's preamble spells it; the Phase 11 push spells the same command. */
const CI_PUSH = EVIDENCE_PUSH

/** Named collector: what Phase 10's push lacks — placement, no force, an exit check, a DEGRADED arm that waits for nothing. */
function collectCiPushDefects(md: string): string[] {
  const section = phaseSection(md, H.p10)
  if (section === null) return ['no Phase 10 section']
  const out: string[] = []
  const pushAt = section.indexOf(CI_PUSH)
  const waitAt = section.indexOf(CI_WAIT_CALL)
  if (pushAt === -1) out.push('Phase 10 has no push')
  if (waitAt === -1) out.push('Phase 10 has no ci-wait call')
  if (pushAt !== -1 && waitAt !== -1 && pushAt > waitAt) out.push('the push does not precede the first ci-wait call')
  if (section.split(CI_PUSH).length - 1 !== 1) out.push('Phase 10 does not spell its push exactly once')
  const pushes = parseFences(section).filter(f => /\bgit\b[^\n]*\bpush\b/.test(f))
  if (pushes.length !== 1) out.push(`expected one push fence in Phase 10, found ${pushes.length}`)
  if (pushes.some(f => /(^|\s)(--force(-with-lease)?\b|-f\b|\+\S)/.test(f))) out.push('the push may force')
  if (!section.includes('never force, and no retry')) out.push('the push does not say never force, no retry')
  if (!section.includes('`TRACEABILITY: DEGRADED (ci push failed)`')) out.push('a failed push names no DEGRADED reason')
  if (!section.includes('proceeds to Phase 11 without waiting')) out.push('a failed push may still wait')
  return out
}

describe('#421 AC-5: Phase 10 pushes first, unforced and checked, and a failed push waits for nothing', () => {
  it('the push precedes the first ci-wait call and carries its DEGRADED arm', () => {
    expect(collectCiPushDefects(implementMd())).toEqual([])
  })

  it('known-bad probes: a push after the wait, a forced push, a lost push and a waiting failure are reported', () => {
    const md = implementMd()
    const section = phaseSection(md, H.p10)!
    const pushFence = '```bash\n' + CI_PUSH + '\n```\n\n'
    expect(section.includes(pushFence), 'the Phase 10 push fence moved').toBe(true)
    const swapped = md.replace(pushFence, '').replace('<!-- /PATTERN: ci-status-gate -->', `${pushFence}<!-- /PATTERN: ci-status-gate -->`)
    expect(collectCiPushDefects(swapped)).toContain('the push does not precede the first ci-wait call')
    expect(collectCiPushDefects(md.replace(pushFence, '```bash\ngit push --force origin HEAD; echo "exit=$?"\n```\n\n'))).toEqual(['Phase 10 has no push', 'Phase 10 does not spell its push exactly once', 'the push may force'])
    expect(collectCiPushDefects(md.replace(pushFence, ''))).toContain('Phase 10 has no push')
    expect(collectCiPushDefects(md.replace('proceeds to Phase 11 without waiting', 'waits anyway'))).toEqual(['a failed push may still wait'])
  })
})

/** Named collector: what Phase 6's Validate spawn lacks for its file list. */
function collectFilesChangedDefects(md: string): string[] {
  const section = phaseSection(md, H.p6)
  if (section === null) return ['no Phase 6 section']
  const spawn = parseFences(section).find(f => isAgentBlock(f, 'Validate') && f.includes('VALIDATION_SCOPE: full'))
  if (spawn === undefined) return ['Phase 6 has no full Validate spawn']
  return spawn.includes('FILES_CHANGED: {output of `git diff --name-only {base}...HEAD`}') ? [] : ['the Validate spawn takes the Code agent\'s file list, which misses the Simplify, Scrutinize and fix commits']
}

describe('#421: Phase 6 hands Validate the branch diff, not the Code agent\'s list', () => {
  it('FILES_CHANGED is `git diff --name-only {base}...HEAD`', () => {
    expect(collectFilesChangedDefects(implementMd())).toEqual([])
  })

  it('known-bad probe: the Code agent\'s list is reported', () => {
    const md = implementMd()
    const old = md.replace('FILES_CHANGED: {output of `git diff --name-only {base}...HEAD`}\nVALIDATION_SCOPE: full', 'FILES_CHANGED: {list of files from Code agent output}\nVALIDATION_SCOPE: full')
    expect(old, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(old)).toHaveLength(1)
  })
})

/** The pointers the renumbering retires, and the ones that replace them. */
const RETIRED_POINTERS = ['Scrutinize agent (Phase 5)', 'Phase 3 or Phase 6 PASS', 'Phase 3\'s **Evidence claims**', 'after every Phase 8 run'] as const

/** Named collector: cross-references that still use the numbers before #421, and the new ones that are absent. */
function collectPointerDefects(md: string, revalidate: string = revalidateReference()): string[] {
  const out = RETIRED_POINTERS.filter(p => md.includes(p)).map(p => `a retired pointer remains: "${p}"`)
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('Phase 1 does not point Scrutinize at Phase 4', md.includes('Scrutinize agent (Phase 4)'))
  need('the Evidence-claims definition does not name Phase 6 and Phase 8', md.includes('`gate:validate` — after a Phase 6 or Phase 8 PASS.'))
  need('the TP claims are not tied to Phase 7', md.includes('`TP-<n>` — after every Phase 7 run'))
  need('the Test spawn does not point at Phase 6\'s claims', md.includes('append its TP claims (Phase 6\'s **Evidence claims**)'))
  need('the continuation path names no order', revalidate.includes('**Run Phases 3-8** — Simplify, Self-Review, Alignment, the one full Validate, QA Testing and the conditional Re-Validate'))
  need('the diagram lacks the Phase 6 Validate', md.includes('├─ Phase 6: Validate (the one full-suite slot)'))
  need('the diagram lacks the Phase 8 Re-Validate', md.includes('├─ Phase 8: Re-Validate (only if a qa-fix committed)'))
  need('the Orchestration-only principle does not name the Phase 10 push and the ci-wait call', /\*\*Orchestration only\*\*[^\n]*Phase 10[^\n]*push[^\n]*ci-wait call/.test(md))
  need('the Loop-limits principle does not carry the CI gate budget', /\*\*Loop limits\*\*[^\n]*at most 3 waits and 2 fixes/.test(md))
  return out
}

describe('#421 AC-26: the cross-references match the new phase numbers', () => {
  it('no retired pointer remains and each new one is present', () => {
    expect(collectPointerDefects(implementMd())).toEqual([])
  })

  it('known-bad probes: the old pointers and a lost principle clause are each reported', () => {
    const md = implementMd()
    const old = md.replace('Scrutinize agent (Phase 4)', 'Scrutinize agent (Phase 5)').replace('after a Phase 6 or Phase 8 PASS', 'after a Phase 3 or Phase 6 PASS')
    expect(collectPointerDefects(old)).toEqual(expect.arrayContaining([
      'a retired pointer remains: "Scrutinize agent (Phase 5)"',
      'a retired pointer remains: "Phase 3 or Phase 6 PASS"',
      'Phase 1 does not point Scrutinize at Phase 4',
    ]))
    expect(collectPointerDefects(md.replace('the CI gate allows at most 3 waits and 2 fixes', 'the CI gate polls ten times'))).toEqual(['the Loop-limits principle does not carry the CI gate budget'])
  })
})
