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
 *   #679   The Test agent reports `BLOCKED` when a BLOCKING scenario's command gave no result (a TP
 *          outcome stays PASS, FAIL or SKIP). #680 /implement Phases 6, 7 and 8 each stop on a BLOCKED
 *          report with the cause and log path, spawn no Fix agent and never read it as PASS.
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
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

import {
  CODE_AGENT_TYPES,
  collectOrderViolations,
  countOf,
  DEFAULT_BRANCH_FILL,
  ensurePrReadyReference,
  GH_FAILED_RULE,
  isAgentBlock,
  JUDGE_BY_READING,
  MAIN_PROBE,
  MASTER_FALLBACK,
  NAME_FILE_TRAP,
  NO_PR_CLAUSE,
  ORIGIN_HEAD_READ,
  OTHER_GH_FAILURE_CLAUSE,
  parseFences,
  PRODUCER_NAME_TAIL,
  PRODUCER_STATUS_CAPTURE,
  readAgentReference,
  requireDistFile,
  resolveAgentSource,
  resolveCurationOffSource,
  resolveVariantOffSource,
  ROOT,
  SHELL_WRITE_PROBES,
  WRITE_FAILURE,
  walkFiles,
  countShellWritesIntoF,
  type OrderRule,
} from '../helpers.js'
import { PROJECT_CONFIG_LIB, SETTINGS_SCRIPT, scopedEnv } from '../evidence-policy/scripted-shim.js'
import { seedOnce } from '../guards/level-guard-helpers.js'
import { PR_EVIDENCE_SCRIPT, RESOLVE_BASE_SCRIPT, VERIFY_EVIDENCE_SCRIPT } from './seam.js'

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

/** Transcribed from resolve-base.cjs's header: the one base-name class the prompts copy. */
interface ResolveBaseApi {
  readonly STRICT_NAME_RE: RegExp
}
const RB = createRequire(import.meta.url)(RESOLVE_BASE_SCRIPT) as ResolveBaseApi

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
  if (!section.some(l => l.includes('`method:local` row carries its Exit, or — when its command gave no result'))) out.push('a local TP row does not carry its exit, or — when its command gave no result')
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

const TEST_STATUS_LINE = '### Status: PASS | PASS ({n} BLOCKING scenario(s) skipped: {reasons}) | FAIL | BLOCKED'
const BLOCKED_REPORT_HEADING = '**Report as BLOCKED:**'
const BLOCKERS_HEADING = '### Blockers (if BLOCKED)'

/**
 * Named collector (#679): what test.md lacks to report a run whose command gave no result as BLOCKED. The
 * TP outcome set stays PASS, FAIL and SKIP (`collectTestReportDefects` holds it), so a blocked TP reads SKIP
 * with its reason under Blockers.
 */
function collectTestBlockedStatusDefects(test: string): string[] {
  const out: string[] = []
  const output = outputSection(test, '## Principles')
  if (output === null) return ['no ## Output section']
  const lines = output.split('\n')
  const statusLines = lines.filter(l => l.startsWith('### Status:'))
  if (statusLines.length !== 1 || statusLines[0] !== TEST_STATUS_LINE) out.push(`the Status line is not exactly "${TEST_STATUS_LINE}"`)
  if (!lines.includes('- Blocked: {count}')) out.push('the Summary lacks a Blocked count')
  if (!lines.some(l => l.startsWith('| S1 |') && l.includes('| PASS/FAIL/SKIPPED/BLOCKED |'))) out.push('the Scenario Results Status cell lacks BLOCKED')
  if (!test.includes('5. Record PASS or FAIL with evidence, or BLOCKED when its command gave no result')) out.push('the Execution step does not record BLOCKED for a command with no result')
  const rule = lines.find(l => l.startsWith('One row per TP line')) ?? ''
  for (const part of ['in every report, a BLOCKED one included', 'PASS only when at least one scenario covers it and every one passed', 'FAIL when any failed']) {
    if (!rule.includes(part)) out.push(`the TP row rule lacks "${part}"`)
  }
  const blockers = lines.indexOf(BLOCKERS_HEADING)
  if (blockers === -1) {
    out.push(`no "${BLOCKERS_HEADING}" section`)
  } else {
    const template = lines[blockers + 1] ?? ''
    for (const part of ['`command could not start`', '`no EXIT= line read`', '{duration, or —}', 'log {its `LOG=` path, or —}']) {
      if (!template.includes(part)) out.push(`the Blockers line lacks ${part}`)
    }
  }
  const boundaries = test.indexOf('\n## Boundaries\n')
  const at = test.indexOf(`\n${BLOCKED_REPORT_HEADING}\n`)
  if (boundaries === -1 || at < boundaries) {
    out.push(`no "${BLOCKED_REPORT_HEADING}" block in Boundaries`)
  } else {
    const block = test.slice(at).split('\n\n')[0]
    if (!block.includes('No BLOCKING scenario failed')) out.push('the BLOCKED block does not require that no BLOCKING scenario failed')
    if (!block.includes('skipped for its environment') || !block.includes('never makes the run BLOCKED')) out.push('the BLOCKED block does not exclude a scenario skipped for its environment')
  }
  return out
}

describe('#679: the Test agent reports BLOCKED for a run whose command gave no result', () => {
  it('test.md names the BLOCKED status, its Blockers section and its Boundaries block', () => {
    expect(collectTestBlockedStatusDefects(resolveAgentSource('test').content)).toEqual([])
  })

  it('known-bad probes: each lost statement is reported by name, and a BLOCKED TP outcome stays outside the claim grammar', () => {
    const test = resolveAgentSource('test').content
    const block = `${BLOCKED_REPORT_HEADING}\n- No BLOCKING scenario failed, and a BLOCKING scenario's command gave no result\n- A scenario skipped for its environment (no browser tools, no local database) never makes the run BLOCKED\n`
    expect(collectTestBlockedStatusDefects(seedOnce(test, TEST_STATUS_LINE, '### Status: PASS | FAIL'))).toEqual([`the Status line is not exactly "${TEST_STATUS_LINE}"`])
    expect(collectTestBlockedStatusDefects(seedOnce(test, '- Blocked: {count}\n', ''))).toEqual(['the Summary lacks a Blocked count'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, 'PASS/FAIL/SKIPPED/BLOCKED', 'PASS/FAIL/SKIPPED'))).toEqual(['the Scenario Results Status cell lacks BLOCKED'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, ', or BLOCKED when its command gave no result', ''))).toEqual(['the Execution step does not record BLOCKED for a command with no result'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, 'PASS only when at least one scenario covers it and every one passed', 'PASS only when every scenario covering the TP passed'))).toEqual([
      'the TP row rule lacks "PASS only when at least one scenario covers it and every one passed"',
    ])
    expect(collectTestBlockedStatusDefects(seedOnce(test, 'in every report, a BLOCKED one included', 'in a PASS or FAIL report'))).toEqual(['the TP row rule lacks "in every report, a BLOCKED one included"'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, '; {duration, or —}', ''))).toEqual(['the Blockers line lacks {duration, or —}'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, '; log {its `LOG=` path, or —}', ''))).toEqual(['the Blockers line lacks log {its `LOG=` path, or —}'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, '`no EXIT= line read`', '`no EXIT line read`'))).toEqual(['the Blockers line lacks `no EXIT= line read`'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, `${BLOCKERS_HEADING}\n`, ''))).toEqual([`no "${BLOCKERS_HEADING}" section`])
    expect(collectTestBlockedStatusDefects(seedOnce(test, `\n${block}`, ''))).toEqual([`no "${BLOCKED_REPORT_HEADING}" block in Boundaries`])
    expect(collectTestBlockedStatusDefects(seedOnce(test, 'No BLOCKING scenario failed, and a', 'A'))).toEqual(['the BLOCKED block does not require that no BLOCKING scenario failed'])
    expect(collectTestBlockedStatusDefects(seedOnce(test, 'never makes the run BLOCKED', 'makes the run BLOCKED'))).toEqual(['the BLOCKED block does not exclude a scenario skipped for its environment'])
    expect(collectTestReportDefects(seedOnce(test, 'PASS/FAIL/SKIP | S1, S3', 'PASS/FAIL/SKIP/BLOCKED | S1, S3'))).toEqual([
      'Outcome [PASS, FAIL, SKIP, BLOCKED] is not the claim grammar\'s [PASS, FAIL, SKIP]',
    ])
  })
})

const REPORT_AS_PASS_HEADING = '**Report as PASS:**'
const PASS_SKIP_EXAMPLE = '`### Status: PASS (1 BLOCKING scenario skipped: no browser tools)`'
const PASS_ALL_SKIPPED_EXAMPLE = '`### Status: PASS (0 of 3 BLOCKING scenarios ran: all skipped, no browser tools)`'

/**
 * Named collector (T3): what test.md lacks to report a run whose BLOCKING scenario was skipped for its environment as
 * PASS with the skips named. The word PASS stays first on the Status line; the skip never makes the run BLOCKED
 * (`collectTestBlockedStatusDefects` holds that). The rule covers a run in which every BLOCKING scenario that ran passed,
 * the run in which none ran included, and that run says so on the Status line. The Status template offers the
 * `PASS ({n} BLOCKING scenario(s) skipped: {reasons})` form.
 */
function collectSkipNoteDefects(test: string): string[] {
  const boundaries = test.indexOf('\n## Boundaries\n')
  const at = test.indexOf(`\n${REPORT_AS_PASS_HEADING}\n`)
  if (boundaries === -1 || at < boundaries) return [`no "${REPORT_AS_PASS_HEADING}" block in Boundaries`]
  const block = test.slice(at + 1).split('\n\n')[0]
  const out: string[] = []
  const parts = ['skipped for its environment', 'every BLOCKING scenario that ran passed', 'names every such skip', 'with PASS first', PASS_SKIP_EXAMPLE, 'If none ran', PASS_ALL_SKIPPED_EXAMPLE]
  for (const part of parts) {
    if (!block.includes(part)) out.push(`the PASS block lacks "${part}"`)
  }
  if (!test.includes(`\n${TEST_STATUS_LINE}\n`)) out.push('the Status template does not offer the PASS form that names skips')
  return out
}

const PHASE_7_PASS_ARM = '**If PASS** (first word of the Status): Continue to Phase 8'

/**
 * Named collector (T3): the /implement Phase 7 PASS arm reads the Test Status by its first word, so `PASS (…)` is PASS and
 * never falls to the arm for any other Status. It is the one PASS arm of Phase 7.
 */
function collectPassFirstWordDefects(md: string): string[] {
  const section = phaseSection(md, H.p7)
  if (section === null) return [`${H.p7}: the section is absent`]
  const arms = section.split('\n\n').map(p => p.trim()).filter(p => p.startsWith('**If PASS'))
  return arms.length === 1 && arms[0] === PHASE_7_PASS_ARM ? [] : [`Phase 7 does not hold exactly one PASS arm \`${PHASE_7_PASS_ARM}\``]
}

describe('T3: a run with a BLOCKING scenario skipped for its environment reports PASS with the skips named', () => {
  it('test.md states the rule and offers the Status form, and Phase 7 reads the Status by its first word (both curation builds)', () => {
    expect(collectSkipNoteDefects(resolveAgentSource('test').content)).toEqual([])
    expect(collectPassFirstWordDefects(implementMd()), 'curation on').toEqual([])
    expect(collectPassFirstWordDefects(implementMdOff()), 'curation off').toEqual([])
  })

  it('known-bad probes: each lost statement of the Test rule is reported by name', () => {
    const test = resolveAgentSource('test').content
    const bullet = test.split('\n').find(l => l.startsWith('- A BLOCKING scenario skipped for its environment, and every')) ?? ''
    expect(bullet, 'the PASS bullet must be found').not.toBe('')
    expect(collectSkipNoteDefects(seedOnce(test, `${bullet}\n`, ''))).toEqual([
      'the PASS block lacks "skipped for its environment"',
      'the PASS block lacks "every BLOCKING scenario that ran passed"',
      'the PASS block lacks "names every such skip"',
      'the PASS block lacks "with PASS first"',
      `the PASS block lacks "${PASS_SKIP_EXAMPLE}"`,
      'the PASS block lacks "If none ran"',
      `the PASS block lacks "${PASS_ALL_SKIPPED_EXAMPLE}"`,
    ])
    expect(collectSkipNoteDefects(seedOnce(test, 'with PASS first', 'with the skips first'))).toEqual(['the PASS block lacks "with PASS first"'])
    expect(collectSkipNoteDefects(seedOnce(test, 'every BLOCKING scenario that ran passed', 'whatever else ran'))).toEqual(['the PASS block lacks "every BLOCKING scenario that ran passed"'])
    expect(collectSkipNoteDefects(seedOnce(test, `. If none ran, it says so: ${PASS_ALL_SKIPPED_EXAMPLE}`, ''))).toEqual([
      'the PASS block lacks "If none ran"',
      `the PASS block lacks "${PASS_ALL_SKIPPED_EXAMPLE}"`,
    ])
    expect(collectSkipNoteDefects(seedOnce(test, PASS_ALL_SKIPPED_EXAMPLE, '`### Status: BLOCKED (all skipped)`'))).toEqual([`the PASS block lacks "${PASS_ALL_SKIPPED_EXAMPLE}"`])
    expect(collectSkipNoteDefects(seedOnce(test, TEST_STATUS_LINE, '### Status: PASS | FAIL | BLOCKED'))).toEqual(['the Status template does not offer the PASS form that names skips'])
    expect(collectSkipNoteDefects(seedOnce(test, `\n${REPORT_AS_PASS_HEADING}\n`, '\n**Report as OK:**\n'))).toEqual([`no "${REPORT_AS_PASS_HEADING}" block in Boundaries`])
    // The skip still never makes the run BLOCKED: the other collector reports a rule that says it does.
    expect(collectTestBlockedStatusDefects(seedOnce(test, 'never makes the run BLOCKED', 'makes the run BLOCKED'))).toEqual(['the BLOCKED block does not exclude a scenario skipped for its environment'])
  })

  it('known-bad probes: a Phase 7 PASS arm that does not read the first word, a doubled arm and a lost phase are reported', () => {
    const md = implementMd()
    const fault = `Phase 7 does not hold exactly one PASS arm \`${PHASE_7_PASS_ARM}\``
    expect(collectPassFirstWordDefects(seedOnce(md, PHASE_7_PASS_ARM, '**If PASS:** Continue to Phase 8'))).toEqual([fault])
    expect(collectPassFirstWordDefects(seedOnce(md, PHASE_7_PASS_ARM, `${PHASE_7_PASS_ARM}\n\n${PHASE_7_PASS_ARM}`))).toEqual([fault])
    expect(collectPassFirstWordDefects(seedOnce(md, PHASE_7_PASS_ARM, ''))).toEqual([fault])
    expect(collectPassFirstWordDefects(seedOnce(md, H.p7, '### Phase 7 gone'))).toEqual([`${H.p7}: the section is absent`])
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

/** Named collector: the first principle says that the main session never tests, builds or fixes, and that "Spawn X" means the Agent tool. */
function collectOrchestrationPrincipleDefects(md: string): string[] {
  const line = md.split('\n').find(l => l.startsWith('1. **Orchestration only**'))
  if (line === undefined) return ['the first principle is not the Orchestration-only principle']
  const out: string[] = []
  if (!line.includes('never does work itself (no tests, builds or fixes)')) out.push('the first principle does not say that the main session never runs tests, builds or fixes')
  if (!line.includes('"Spawn X" means call the Agent tool')) out.push('the first principle does not say that "Spawn X" means call the Agent tool')
  return out
}

describe('#561: the first principle of /implement keeps the main session to plumbing', () => {
  it('says that the main session never tests, builds or fixes, and that spawn means the Agent tool', () => {
    expect(collectOrchestrationPrincipleDefects(implementMd())).toEqual([])
  })

  it('known-bad probes: a lost clause and a principle that is not first are each reported', () => {
    const md = implementMd()
    const noWork = md.replace('never does work itself (no tests, builds or fixes)', 'does its own work')
    expect(noWork, 'the seed must land').not.toBe(md)
    expect(collectOrchestrationPrincipleDefects(noWork)).toEqual(['the first principle does not say that the main session never runs tests, builds or fixes'])
    const noAgent = md.replace('"Spawn X" means call the Agent tool', '"Spawn X" means ask')
    expect(noAgent, 'the seed must land').not.toBe(md)
    expect(collectOrchestrationPrincipleDefects(noAgent)).toEqual(['the first principle does not say that "Spawn X" means call the Agent tool'])
    const second = md.replace('1. **Orchestration only**', '2. **Orchestration only**')
    expect(second, 'the seed must land').not.toBe(md)
    expect(collectOrchestrationPrincipleDefects(second)).toEqual(['the first principle is not the Orchestration-only principle'])
  })
})

// ---------------------------------------------------------------------------
// /implement Phase 1 — the test-plan step and its ask (AC-9)
// ---------------------------------------------------------------------------

const CODE_SPAWN = 'Agent(subagent_type="Code")'
/** Every spawn of the Code family (D-CODE-VARIANTS): Code, Fix and Refactor. */
const CODE_FAMILY_SPAWNS = CODE_AGENT_TYPES.map(type => `Agent(subagent_type="${type}")`)
const TICKET_ASK = '**Ticket link, only when `ISSUE_REQUIRED` is `true`:**'
const RECORD = '**Record the exception at once**'
const TEST_PLAN_STEP = '**Test plan.** Before any Code spawn'
const MISSING_ASK = '**Missing test plan, only when `EVIDENCE_POLICY` is `required`:**'
const OUTPUTS = '**Test-plan outputs**'
const STANDARD_LINE = 'When `EVIDENCE_POLICY` is `standard`, a missing test plan is never asked about'
const CAPTURE = '**Capture from Git agent output**'
/** The one inline resolver call; its script name is unique in the built file. */
const RESOLVER = 'resolve-base.cjs'

function implementMd(): string {
  return requireDistFile('implement.md')
}

/** The curation-off build of /implement: it states the same fresh-base text as the curation-on build. */
function implementMdOff(): string {
  const off = resolveCurationOffSource('commands', 'implement')
  if (off === null) throw new Error('dist/curation-off/commands/implement.md is absent: run `npm run build:mds`')
  return off
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
  { label: 'the base name is captured before the base resolves', before: CAPTURE, after: RESOLVER },
  { label: 'the base resolves before Phase 2', before: RESOLVER, after: '### Phase 2: Implement' },
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
    expect(collectCodeSpawnsBefore(md, RESOLVER)).toEqual([])
  })

  it('known-bad probes: a test-plan step moved above the record and a Code spawn seeded above the outputs are reported', () => {
    const md = implementMd()
    const hoisted = md.replace(TEST_PLAN_STEP, 'Test plan later.').replace(RECORD, `${TEST_PLAN_STEP}\n\n${RECORD}`)
    expect(collectOrderViolations('implement.md', hoisted, PHASE1_ORDER).some(v => v.includes('the ticket exception is recorded before'))).toBe(true)
    const seeded = md.replace(MISSING_ASK, `${CODE_SPAWN}:\n\n${MISSING_ASK}`)
    expect(collectCodeSpawnsBefore(seeded, OUTPUTS)).toHaveLength(1)
  })

  it('known-bad probes: a base resolved after Phase 2 or before the capture, and a Code spawn above the resolver, are reported', () => {
    const md = implementMd()
    const late = md.replace(RESOLVER, 'x.cjs').replace('### Phase 2: Implement', `### Phase 2: Implement\n\n${RESOLVER}`)
    expect(late, 'the seed must land').not.toBe(md)
    expect(collectOrderViolations('implement.md', late, PHASE1_ORDER).some(v => v.includes('the base resolves before Phase 2'))).toBe(true)
    const early = md.replace(RESOLVER, 'x.cjs').replace(CAPTURE, `${RESOLVER}\n\n${CAPTURE}`)
    expect(early, 'the seed must land').not.toBe(md)
    expect(collectOrderViolations('implement.md', early, PHASE1_ORDER).some(v => v.includes('the base name is captured before the base resolves'))).toBe(true)
    const spawned = md.replace('**Fresh base.**', `${CODE_SPAWN}:\n\n**Fresh base.**`)
    expect(spawned, 'the seed must land').not.toBe(md)
    expect(collectCodeSpawnsBefore(spawned, RESOLVER)).toHaveLength(1)
  })

  it('the check and the render run the installed script over the evidence file', () => {
    const lines = implementMd().split('\n')
    const script = 'node "$HOME/.devflow/scripts/verify-evidence.cjs"'
    expect(lines).toContain(`${script} check tp "{worktree}/.devflow/docs/evidence-{branch_slug}.md"; echo "exit=$?"`)
    expect(lines).toContain(`${script} render --plan "{worktree}/.devflow/docs/evidence-{branch_slug}.md"; echo "exit=$?"`)
  })
})

/**
 * The compliance-on outputs hold one step that copies `PR_EXCEPTIONS` into the evidence file. It
 * must sit after the missing-plan ask: the ask can add a `test-plan` exception to `PR_EXCEPTIONS`
 * without writing the evidence file, and the `Test plan.` paragraph writes that file before the ask.
 */
const EVIDENCE_COPY = 'its `## Evidence Exceptions` section now a byte copy of `PR_EXCEPTIONS`'
const EVIDENCE_COPY_ORDER: readonly OrderRule[] = [
  { label: 'a step after the missing-plan ask copies PR_EXCEPTIONS into the evidence file', before: MISSING_ASK, after: EVIDENCE_COPY },
  { label: 'that copy is set before Phase 2', before: EVIDENCE_COPY, after: '### Phase 2: Implement' },
]

describe('AC-9: the exception the missing-plan ask records reaches the evidence file (compliance-on builds)', () => {
  it('a step after the missing-plan ask copies PR_EXCEPTIONS into EVIDENCE_FILE, with curation on and off', () => {
    for (const [label, md] of [['curation on', implementMd()], ['curation off', implementMdOff()]] as const) {
      expect(collectOrderViolations(`implement.md (${label})`, md, EVIDENCE_COPY_ORDER), label).toEqual([])
    }
  })

  it('known-bad probes: a lost copy step and a copy moved above the ask are reported', () => {
    const md = implementMd()
    const bullet = md.split('\n').find(l => l.includes(EVIDENCE_COPY))
    expect(bullet, 'the copy step is read').toBeDefined()
    const lost = md.replace(`${bullet}\n`, '')
    expect(lost, 'the seed must land').not.toBe(md)
    expect(collectOrderViolations('implement.md', lost, EVIDENCE_COPY_ORDER).some(v => v.includes('anchor absent'))).toBe(true)
    const hoisted = lost.replace(MISSING_ASK, `${bullet}\n\n${MISSING_ASK}`)
    expect(hoisted, 'the seed must land').not.toBe(lost)
    expect(collectOrderViolations('implement.md', hoisted, EVIDENCE_COPY_ORDER).some(v => v.includes('does not precede'))).toBe(true)
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
    expect(md.split('{ref_dir}/implement-evidence-asks.md').length - 1, 'one explicit read path').toBe(1)
    expect(md.split('`{ref_dir}` is `<that directory>/skills/devflow:agent-references/references/commands`').length - 1, 'the path root is bound once').toBe(1)
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
    expect(lines.filter(l => l.startsWith('After every Test agent run — whatever its Status, first run or retry — append its TP claims'))).toHaveLength(1)
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
// /implement — the HEAD rule of the claim shapes (AC-11), in every build
// ---------------------------------------------------------------------------
//
// The Test agent writes `HEAD: {before} → {after}` when HEAD moves during its run. That value is not a single
// SHA, so no claim may be appended from the report. A reader who sees only the condition may take the `after`
// SHA and append `sha:<after>`, a claim for a HEAD the tests did not all run at: a false pass. So the rule
// states both the condition and the moved-HEAD example, in all four builds.

type ImplementKey = 'on' | 'curation-off' | 'compliance-off' | 'both-off'

const IMPLEMENT_KEYS: readonly ImplementKey[] = ['on', 'curation-off', 'compliance-off', 'both-off']

function implementMdOfKey(key: ImplementKey): string {
  if (key === 'on') return implementMd()
  const text = resolveVariantOffSource(key, 'commands', 'implement')
  if (text === null) throw new Error(`the ${key} build of /implement is absent: run \`npm run build:mds\``)
  return text
}

const HEAD_RULE_LEAD = '- Append nothing from a report whose `HEAD:`'
const HEAD_RULE_CONDITION = 'is not a single 40-hex SHA'
const HEAD_RULE_EXAMPLE = 'a reported before/after change included'

/** Named collector: what the HEAD rule bullet of the Evidence claims lacks, one defect per missing clause. */
function collectHeadRuleDefects(file: string, text: string): string[] {
  const rules = text.split('\n').filter(line => line.startsWith(HEAD_RULE_LEAD))
  if (rules.length !== 1) return [`${file}: ${rules.length} HEAD rule bullets, expected 1`]
  const out: string[] = []
  if (!rules[0].includes(HEAD_RULE_CONDITION)) out.push(`${file}: the HEAD rule does not state the condition "${HEAD_RULE_CONDITION}"`)
  if (!rules[0].includes(HEAD_RULE_EXAMPLE)) out.push(`${file}: the HEAD rule does not state the moved-HEAD example "${HEAD_RULE_EXAMPLE}"`)
  return out
}

describe('AC-11: the HEAD rule of the claim shapes states the condition and the moved-HEAD example in every build', () => {
  for (const key of IMPLEMENT_KEYS) {
    const file = `${key} build of implement.md`

    it(`${key}: the rule states "${HEAD_RULE_CONDITION}" and the before/after example`, () => {
      expect(collectHeadRuleDefects(file, implementMdOfKey(key))).toEqual([])
    })

    it(`${key}: known-bad probe: a lost condition is reported as the condition, and no other clause`, () => {
      const text = implementMdOfKey(key)
      const broken = text.replace(HEAD_RULE_CONDITION, 'is not a SHA')
      expect(broken, 'the condition seed must land').not.toBe(text)
      expect(collectHeadRuleDefects(file, broken)).toEqual([`${file}: the HEAD rule does not state the condition "${HEAD_RULE_CONDITION}"`])
    })

    it(`${key}: known-bad probe: a lost example is reported as the example, and no other clause`, () => {
      const text = implementMdOfKey(key)
      const broken = text.replace(` — ${HEAD_RULE_EXAMPLE} —`, '')
      expect(broken, 'the example seed must land').not.toBe(text)
      expect(collectHeadRuleDefects(file, broken)).toEqual([`${file}: the HEAD rule does not state the moved-HEAD example "${HEAD_RULE_EXAMPLE}"`])
    })

    it(`${key}: known-bad probe: a missing or doubled rule bullet is reported by count`, () => {
      const text = implementMdOfKey(key)
      const lost = text.replace(HEAD_RULE_LEAD, '- Skip')
      expect(lost, 'the loss seed must land').not.toBe(text)
      expect(collectHeadRuleDefects(file, lost)).toEqual([`${file}: 0 HEAD rule bullets, expected 1`])
      const rule = text.split('\n').find(line => line.startsWith(HEAD_RULE_LEAD))
      expect(rule, 'the rule bullet must exist to double').toBeDefined()
      expect(collectHeadRuleDefects(file, `${text}\n${rule}`)).toEqual([`${file}: 2 HEAD rule bullets, expected 1`])
    })
  }
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
    expect(md).toContain('or the fresh base step, Phase 10\'s push, Phase 11\'s push or Phase 11\'s script output carried one, surface them verbatim')
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
    expect(revalidateReference().split('\n').find(l => l.startsWith('6. **Proceed to Phase 9**'))).toContain('**Phase 11** (Evidence)')
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
    expect(collectEvidenceRunDefects(md.replace('cd "{worktree}" && node "$HOME/.devflow/scripts/verify-evidence.cjs" publish', 'node "$HOME/.devflow/scripts/verify-evidence.cjs" publish'))).toEqual(['the call does not run from the worktree'])
    const back = md.replace('### Phase 12: Report', '```\nAgent(subagent_type="Git"):\n"OPERATION: update-pr-evidence\nPR_NUMBER: {PR_NUMBER}"\n```\n\n### Phase 12: Report')
    expect(collectEvidenceRunDefects(back)).toEqual(['a Git agent is still spawned for update-pr-evidence (1)'])
    expect(collectEvidenceRunDefects(md.replace('Use the Bash tool with `timeout: 180000`', 'Use the Bash tool'))).toEqual([
      'the call carries no Bash timeout above the script\'s two deadlines',
    ])
    const early = md.replace('### Phase 10: CI Status Gate', '### Phase 10 later').replace('### Phase 12: Report', '### Phase 10: CI Status Gate\n\n### Phase 12: Report')
    expect(collectOrderViolations('implement.md', early, PHASE11_ORDER).some(v => v.includes('Phase 11 follows the CI gate'))).toBe(true)
    expect(collectPublicationImporters([
      { name: 'implement', content: `@import { publication_resolve } from "${PUBLICATION_IMPORT}"` },
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
//                   cover (Code, Polish, Harden, the alignment fixes): the order
//                   is Code, Polish, Harden, Evaluate, Validate (full), Test, the
//                   conditional changed-only Validate, push, CI gate. An alignment-fix
//                   commit gets no self-review: Phase 6 Validate and `/code-review`
//                   check it. A qa-fix is the only commit after the full run, so only
//                   it earns Phase 8. No loop spawns a Validate of its own and nothing
//                   re-validates on a Harden FIXED status.
// D-CI-WAIT-INLINE  Phase 10 pushes first, with its own command outside the gate block,
//                   then waits through ci-wait.cjs. A failed push records
//                   `TRACEABILITY: DEGRADED (ci push failed)` and waits for nothing.
//
// Every guard has a named collector, a non-empty-corpus assertion and a known-bad
// probe run through the same collector. The absence guards (no Validate in a loop, no
// re-validate on FIXED, no old pointer) pass vacuously when the text they read is
// missing, so each has a probe that seeds the defect and a corpus assertion.

/** The `### Phase N:` section: from its heading to the next phase heading or the Principles section. */
function phaseSection(md: string, heading: string): string | null {
  const at = md.indexOf(heading)
  if (at === -1) return null
  const rest = md.slice(at + heading.length)
  const next = rest.search(/\n### Phase |\n## Principles/)
  return next === -1 ? md.slice(at) : md.slice(at, at + heading.length + next)
}

/** The sentence that stops a Validate report with any Status but PASS or FAIL: its own paragraph, right after the `**If PASS:**` paragraph. */
const OTHER_STATUS_HALT = 'Any other or missing Status: report and halt; never PASS.'

/** True when `text` holds the halt sentence exactly once, as the paragraph that follows the `**If PASS:**` paragraph. */
function haltFollowsPass(text: string): boolean {
  const paragraphs = text.split('\n\n').map(p => p.trim())
  const pass = paragraphs.findIndex(p => p.startsWith('**If PASS:**'))
  return text.split(OTHER_STATUS_HALT).length - 1 === 1 && pass !== -1 && paragraphs[pass + 1] === OTHER_STATUS_HALT
}

const H = {
  p1: '### Phase 1: Setup',
  p2: '### Phase 2: Implement',
  p3: '### Phase 3: Polish',
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
  { label: 'Polish follows implementation', before: H.p2, after: SPAWN('Polish') },
  { label: 'Harden follows Polish', before: SPAWN('Polish'), after: SPAWN('Harden') },
  { label: 'Evaluate follows Harden', before: SPAWN('Harden'), after: SPAWN('Evaluate') },
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

describe('#421 AC-1: the gates run Code, Polish, Harden, Evaluate, Validate, Test, the conditional Validate, push, CI', () => {
  it('every post-code step follows the one before it, and the phase headings hold their order', () => {
    const md = implementMd()
    expect(collectOrderViolations('implement.md', md, GATE_ORDER)).toEqual([])
    expect(collectPhaseHeadingDefects(md)).toEqual([])
  })

  it('known-bad probe: a Validate before Polish (the order before #421) is reported', () => {
    const md = implementMd()
    const early = md.replace('VALIDATION_SCOPE: full', 'VALIDATION_SCOPE: other').replace(SPAWN('Polish'), `VALIDATION_SCOPE: full\n${SPAWN('Polish')}`)
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
  if (!haltFollowsPass(six)) out.push('Phase 6 does not halt on any other or missing Status, once, after its PASS line')
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

  it('known-bad probe: a Phase 6 that lost its halt on any other or missing Status is reported', () => {
    const md = implementMd()
    const lost = md.replace(OTHER_STATUS_HALT, 'Carry on.')
    expect(lost, 'the seed must land').not.toBe(md)
    expect(collectValidateOnceDefects(lost)).toEqual(['Phase 6 does not halt on any other or missing Status, once, after its PASS line'])
  })
})

/** Phases whose loops and steps must never spawn a Validate of their own. */
const VALIDATE_FREE_PHASES = [H.p3, H.p4, H.p5, H.p7] as const

/**
 * Named collector: Validate spawns inside the Polish, Harden, alignment and QA
 * phases, and any sentence that re-validates because Harden reported FIXED. The
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

describe('#421 AC-3: no Validate inside the alignment loop, the QA loop or on a Harden FIXED status', () => {
  it('the Polish, Harden, alignment and QA phases spawn no Validate', () => {
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
    const refire = md
      .replace('**If PASS or FIXED:** continue to Phase 5.', `If Harden agent made changes (status: FIXED), spawn Validate agent:\n${validate}\n**If PASS or FIXED:** continue to Phase 5.`)
    expect(refire, 'the seed must land').not.toBe(md)
    expect(collectLoopValidateDefects(refire).some(d => d.includes('Validate spawn(s) inside the phase'))).toBe(true)
  })
})

/** The Phase 4 line that names what Harden never reviews (#571), and the opening that finds it. */
const HARDEN_SCOPE_OPENING = 'Harden never reviews a deleted file'
const HARDEN_SCOPE_LINE = 'Harden never reviews a deleted file or the old path of a rename; an empty list is no review, and Harden reports `no files reviewed`.'
/** The Phase 6 line that says an alignment-fix commit gets no self-review (#572), and the opening that finds it. */
const ALIGNMENT_NO_REVIEW_OPENING = 'Alignment-fix commits get no self-review'
const ALIGNMENT_NO_REVIEW_LINE = 'Alignment-fix commits get no self-review: Phase 6 Validate and `/code-review` check them.'
/**
 * The Harden agent line for an empty `FILES_CHANGED` (#571), and the opening that finds it. The exit applies to a prompt
 * that has the line and lists no file. A prompt with no such line, as `/dynamic-build` sends, gets a review of the branch.
 */
const HARDEN_EMPTY_OPENING = '**Empty FILES_CHANGED**:'
const HARDEN_EMPTY_LINE = '**Empty FILES_CHANGED**: If the prompt has a `FILES_CHANGED` line that lists no file, report `### Status: PASS` with the line `no files reviewed`, and review nothing; with no `FILES_CHANGED` line, find the branch changes and review them.'
/** The Harden agent input bullet for `FILES_CHANGED`: optional, and the branch diff list that `/implement` sends. */
const HARDEN_INPUT_LINE = "- **FILES_CHANGED** (optional): The branch diff's file list, with no deleted file or old rename path"

/** What a one-sentence line must be: it starts its own line, and no second sentence follows on it. */
function collectOwnLineDefects(tag: string, text: string, opening: string, mustSay: readonly string[]): string[] {
  const found = text.split(opening).length - 1
  if (found !== 1) return [`${tag}: expected one line, found ${found}`]
  const line = text.split('\n').find(l => l.includes(opening)) ?? ''
  if (!line.startsWith(opening)) return [`${tag}: does not start its own line`]
  if (/\.\s/.test(line)) return [`${tag}: shares its line with another sentence`]
  return mustSay.filter(piece => !line.includes(piece)).map(piece => `${tag}: does not say ${piece}`)
}

/**
 * Named collector (#571, #572): what /implement and the Harden agent lack of the self-review scope.
 * Phase 4 says Harden never reviews a deleted file or the old path of a rename and that an empty
 * list is no review; the Harden agent reports `no files reviewed` for a `FILES_CHANGED` line with no file,
 * reviews the branch when the prompt has no such line, and takes the branch diff list as its optional input;
 * Phase 6 says an alignment-fix commit gets no self-review and names who checks it. Each line
 * stands alone, because the Phase 4 status line is read line by line: the FIXED check in
 * `collectLoopValidateDefects` would fire on a status word, a spawn or a Validate word added to it.
 */
function collectSelfReviewScopeDefects(md: string, harden: string): string[] {
  const out: string[] = []
  const four = phaseSection(md, H.p4)
  const six = phaseSection(md, H.p6)
  if (four === null) out.push(`${H.p4}: the section is absent`)
  else {
    out.push(...collectOwnLineDefects('the #571 line', four, HARDEN_SCOPE_OPENING, ['the old path of a rename', 'an empty list is no review', '`no files reviewed`']))
    if (four.split('\n').filter(l => l.startsWith('Harden agent reports')).length !== 1) out.push('Phase 4 does not hold one status line that starts `Harden agent reports`')
    const hardenFences = parseFences(four).filter(f => isAgentBlock(f, 'Harden')).length
    if (hardenFences !== 1) out.push(`Phase 4 holds ${hardenFences} Harden fences, expected 1`)
    if (four.split('\n').some(l => (l.startsWith(HARDEN_SCOPE_OPENING) || l.includes('`no files reviewed`')) && /skip/i.test(l))) out.push('the #571 line holds the word skip')
  }
  if (six === null) out.push(`${H.p6}: the section is absent`)
  else out.push(...collectOwnLineDefects('the #572 line', six, ALIGNMENT_NO_REVIEW_OPENING, ['Phase 6 Validate', '`/code-review`']))
  out.push(...collectOwnLineDefects('the Harden empty-list line', harden, HARDEN_EMPTY_OPENING, [
    'a `FILES_CHANGED` line that lists no file', '`### Status: PASS`', '`no files reviewed`', 'review nothing',
    'with no `FILES_CHANGED` line', 'find the branch changes and review them',
  ]))
  if (!harden.split('\n').includes(HARDEN_INPUT_LINE)) out.push('the Harden input bullet for `FILES_CHANGED` is not the pinned line')
  return out
}

/** The two builds of /implement, each with the Harden agent built beside it. */
function selfReviewBuilds(): ReadonlyArray<{ readonly label: string; readonly md: string; readonly harden: string }> {
  const hardenOff = resolveCurationOffSource('agents', 'harden')
  if (hardenOff === null) throw new Error('dist/curation-off/agents/harden.md is absent: run `npm run build:mds`')
  return [
    { label: 'curation on', md: implementMd(), harden: resolveAgentSource('harden').content },
    { label: 'curation off', md: implementMdOff(), harden: hardenOff },
  ]
}

/** The line that opens the Phase 6 Validate spawn: ALIGNED, a single-pass Fix that reports COMPLETE, or a user who continues after a Phase 5 report for decision. */
const PHASE_6_LEAD = 'After ALIGNED, a single-pass Fix that reports COMPLETE, or a user who continues after a Phase 5 report, spawn Validate agent:'

describe('#571, #572: /implement and Harden state the self-review scope, in both builds', () => {
  it.each(['curation on', 'curation off'])('%s: the three lines stand alone and the Phase 4 status line is unchanged', label => {
    const build = selfReviewBuilds().find(b => b.label === label)
    if (build === undefined) throw new Error(`no build named ${label}`)
    expect(phaseSection(build.md, H.p4) ?? '', 'no Phase 4 read').toContain('Harden agent reports')
    expect(phaseSection(build.md, H.p6) ?? '', 'no Phase 6 read').toContain('spawn Validate agent:')
    expect(build.harden, 'no Harden agent read').toContain('# Harden Agent')
    expect(collectSelfReviewScopeDefects(build.md, build.harden)).toEqual([])
    const lines = build.md.split('\n')
    expect(lines.filter(l => l === HARDEN_SCOPE_LINE), 'the #571 text, whole').toHaveLength(1)
    expect(lines.filter(l => l === ALIGNMENT_NO_REVIEW_LINE), 'the #572 text, whole').toHaveLength(1)
    expect(build.harden.split('\n').filter(l => l === HARDEN_EMPTY_LINE), 'the Harden text, whole').toHaveLength(1)
    expect(build.harden.split('\n').filter(l => l === HARDEN_INPUT_LINE), 'the Harden input bullet, whole').toHaveLength(1)
    expect(lines.filter(l => l === PHASE_6_LEAD), 'the Phase 6 spawn lead, whole').toHaveLength(1)
  })

  it('known-bad probes: each line removed, each line moved onto a neighbour, a skip rewording and a lost name are reported', () => {
    for (const { label, md, harden } of selfReviewBuilds()) {
      const seed = (text: string, from: string, to: string): string => {
        expect(text.includes(from), `${label}: the seed must land (${from.slice(0, 40)})`).toBe(true)
        return text.replace(from, to)
      }
      const statusLine = (text: string): string => text.split('\n').find(l => l.startsWith('Harden agent reports')) ?? ''
      expect(statusLine(md), `${label}: no Phase 4 status line read`).not.toBe('')
      // Removed.
      expect(collectSelfReviewScopeDefects(seed(md, `${HARDEN_SCOPE_LINE}\n\n`, ''), harden), label).toEqual(['the #571 line: expected one line, found 0'])
      expect(collectSelfReviewScopeDefects(seed(md, `${ALIGNMENT_NO_REVIEW_LINE}\n\n`, ''), harden), label).toEqual(['the #572 line: expected one line, found 0'])
      expect(collectSelfReviewScopeDefects(md, seed(harden, `${HARDEN_EMPTY_LINE}\n\n`, '')), label).toEqual(['the Harden empty-list line: expected one line, found 0'])
      // Appended to the status line, or joined to the next sentence.
      expect(collectSelfReviewScopeDefects(seed(md, `\n\n${HARDEN_SCOPE_LINE}`, ` ${HARDEN_SCOPE_LINE}`), harden), label).toEqual(['the #571 line: does not start its own line'])
      expect(collectSelfReviewScopeDefects(seed(md, `${ALIGNMENT_NO_REVIEW_LINE}\n\n`, `${ALIGNMENT_NO_REVIEW_LINE} `), harden), label).toEqual(['the #572 line: shares its line with another sentence'])
      const moved = seed(seed(md, `${ALIGNMENT_NO_REVIEW_LINE}\n\n`, ''), statusLine(md), `${statusLine(md)} ${ALIGNMENT_NO_REVIEW_LINE}`)
      expect(collectSelfReviewScopeDefects(moved, harden), label).toEqual(['the #572 line: expected one line, found 0'])
      // A skip rewording, with the opening kept and with it lost.
      expect(collectSelfReviewScopeDefects(seed(md, 'is no review, and', 'is no review, it skips the rest, and'), harden), label).toEqual(['the #571 line holds the word skip'])
      expect(collectSelfReviewScopeDefects(seed(md, HARDEN_SCOPE_OPENING, 'Harden skips a deleted file'), harden), label).toEqual([
        'the #571 line: expected one line, found 0',
        'the #571 line holds the word skip',
      ])
      // A lost name.
      expect(collectSelfReviewScopeDefects(seed(md, 'Phase 6 Validate and `/code-review`', 'a later run and `/code-review`'), harden), label).toEqual(['the #572 line: does not say Phase 6 Validate'])
      expect(collectSelfReviewScopeDefects(seed(md, 'Phase 6 Validate and `/code-review`', 'Phase 6 Validate and a later check'), harden), label).toEqual(['the #572 line: does not say `/code-review`'])
      // The `no files reviewed` text, lost at either site.
      expect(collectSelfReviewScopeDefects(seed(md, 'Harden reports `no files reviewed`', 'Harden reports nothing'), harden), label).toEqual(['the #571 line: does not say `no files reviewed`'])
      expect(collectSelfReviewScopeDefects(md, seed(harden, 'with the line `no files reviewed`', 'with no line')), label).toEqual(['the Harden empty-list line: does not say `no files reviewed`'])
      // The absent-line case dropped or turned into an early exit, the exit left unscoped, and the input bullet back to the Code list.
      const absentCase = '; with no `FILES_CHANGED` line, find the branch changes and review them'
      expect(collectSelfReviewScopeDefects(md, seed(harden, absentCase, '')), label).toEqual([
        'the Harden empty-list line: does not say with no `FILES_CHANGED` line',
        'the Harden empty-list line: does not say find the branch changes and review them',
      ])
      expect(collectSelfReviewScopeDefects(md, seed(harden, absentCase, '; with no `FILES_CHANGED` line, review nothing')), label)
        .toEqual(['the Harden empty-list line: does not say find the branch changes and review them'])
      expect(collectSelfReviewScopeDefects(md, seed(harden, 'If the prompt has a `FILES_CHANGED` line that lists no file', 'If `FILES_CHANGED` is empty')), label)
        .toEqual(['the Harden empty-list line: does not say a `FILES_CHANGED` line that lists no file'])
      expect(collectSelfReviewScopeDefects(md, seed(harden, HARDEN_INPUT_LINE, '- **FILES_CHANGED**: List of modified files from Code agent output')), label)
        .toEqual(['the Harden input bullet for `FILES_CHANGED` is not the pinned line'])
      // A second Harden fence in Phase 4, and a status line that lost its opening.
      expect(collectSelfReviewScopeDefects(seed(md, '**If PASS or FIXED:** continue to Phase 5.', '```\nAgent(subagent_type="Harden"):\n"again"\n```\n\n**If PASS or FIXED:** continue to Phase 5.'), harden), label).toEqual(['Phase 4 holds 2 Harden fences, expected 1'])
      expect(collectSelfReviewScopeDefects(seed(md, statusLine(md), statusLine(md).replace('Harden agent reports', 'The Harden agent reports')), harden), label).toEqual(['Phase 4 does not hold one status line that starts `Harden agent reports`'])
    }
  })
})

/** Named collector: what Phase 8 fails to state in its own text. */
function collectPhase8Defects(md: string): string[] {
  const text = phaseSection(md, H.p8)
  if (text === null) return ['no Phase 8 section']
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('the condition (only if a qa-fix committed)', text.includes('only if a qa-fix committed (`git rev-parse HEAD` differs from `VALIDATED_HEAD`)'))
  need('the scope (changed files since VALIDATED_HEAD)', text.includes('`git diff --name-only --diff-filter=d VALIDATED_HEAD..HEAD`') && text.includes('VALIDATION_SCOPE: changed-only'))
  need('the FAIL arm (report and halt)', /\*\*If FAIL:\*\* Report the failures to user and halt\./.test(text))
  need('the PASS arm appends the second claim', text.includes('**If PASS:** append a `gate:validate` claim'))
  need('any other or missing Status halts, once, after the PASS arm', haltFollowsPass(text))
  return out
}

describe('#421 AC-4: Phase 8 states its condition, its scope and its FAIL arm in its own text', () => {
  it('all three are stated', () => {
    expect(collectPhase8Defects(implementMd())).toEqual([])
  })

  it('known-bad probes: each lost statement is reported by name', () => {
    const md = implementMd()
    expect(collectPhase8Defects(md.replace('only if a qa-fix committed (`git rev-parse HEAD` differs from `VALIDATED_HEAD`)', 'always'))).toEqual(['the condition (only if a qa-fix committed)'])
    expect(collectPhase8Defects(md.replace('`git diff --name-only --diff-filter=d VALIDATED_HEAD..HEAD`', 'the Code agent\'s list'))).toEqual(['the scope (changed files since VALIDATED_HEAD)'])
    expect(collectPhase8Defects(md.replace('**If FAIL:** Report the failures to user and halt.', '**If FAIL:** carry on.'))).toEqual(['the FAIL arm (report and halt)'])
    expect(collectPhase8Defects(md.replace(H.p8, '### Phase 8 gone'))).toEqual(['no Phase 8 section'])
    const at = md.lastIndexOf(OTHER_STATUS_HALT)
    expect(at, 'the Phase 8 sentence must be found').toBeGreaterThan(md.indexOf(H.p8))
    const lost = md.slice(0, at) + 'Carry on.' + md.slice(at + OTHER_STATUS_HALT.length)
    expect(collectPhase8Defects(lost)).toEqual(['any other or missing Status halts, once, after the PASS arm'])
  })
})

const BLOCKED_ARM = '**If BLOCKED:**'
const PHASE_8_BLOCKED_ARM = '**If BLOCKED:** as in Phase 6.'
const PHASE_7_BLOCKED_OPENING = '**If BLOCKED, or any other or missing Status:**'
const PHASE_7_STEP_3 = '3. If `qa_retry_count > 2`:'
const PHASE_7_STOP = 'Phases 8 to 11 do not run'
const TEST_STATUS_SENTENCE = 'Report your Status with evidence.'

/**
 * Named collector (#679, #680): the BLOCKED arm of the Validate gates (Phases 6 and 8) and of the Test gate
 * (Phase 7). A Phase 6 or 8 arm is one paragraph before `**If PASS:**`, so the halt sentence that
 * `haltFollowsPass` pins stays the paragraph right after PASS. The Phase 7 arm follows the renumbered escalation
 * step, spawns no Fix agent and stops the run; the Test spawn asks for the agent's Status, not PASS or FAIL.
 */
function collectBlockedArmDefects(md: string): string[] {
  const out: string[] = []
  const paragraphsOf = (heading: string): string[] | null => {
    const section = phaseSection(md, heading)
    if (section === null) {
      out.push(`${heading}: the section is absent`)
      return null
    }
    return section.split('\n\n').map(p => p.trim())
  }
  const gateArm = (heading: string, label: string, holds: (arm: string) => boolean, wording: string): void => {
    const paragraphs = paragraphsOf(heading)
    if (paragraphs === null) return
    const arms = paragraphs.flatMap((p, i) => (p.startsWith(BLOCKED_ARM) ? [i] : []))
    if (arms.length !== 1) {
      out.push(`${label} holds ${arms.length} \`${BLOCKED_ARM}\` paragraphs, expected 1`)
      return
    }
    const pass = paragraphs.findIndex(p => p.startsWith('**If PASS:**'))
    if (pass === -1 || arms[0] > pass) out.push(`${label}: the BLOCKED arm does not come before \`**If PASS:**\``)
    if (!holds(paragraphs[arms[0]])) out.push(`${label}: the BLOCKED arm ${wording}`)
  }
  gateArm(H.p6, 'Phase 6', arm => arm.includes('cause and log path') && arm.includes('halt'), 'does not report its cause and log path, then halt')
  gateArm(H.p8, 'Phase 8', arm => arm === PHASE_8_BLOCKED_ARM, `is not \`${PHASE_8_BLOCKED_ARM}\``)

  const paragraphs = paragraphsOf(H.p7)
  if (paragraphs === null) return out
  const arms = paragraphs.flatMap((p, i) => (p.startsWith(PHASE_7_BLOCKED_OPENING) ? [i] : []))
  if (arms.length !== 1) {
    out.push(`Phase 7 holds ${arms.length} \`${PHASE_7_BLOCKED_OPENING}\` paragraphs, expected 1`)
  } else {
    for (const phrase of ['cause and log path', 'no Fix agent', 'stop as in step 3']) {
      if (!paragraphs[arms[0]].includes(phrase)) out.push(`Phase 7: the BLOCKED arm lacks "${phrase}"`)
    }
    const step3 = (paragraphs[arms[0] - 1] ?? '').split('\n').at(-1) ?? ''
    if (!step3.startsWith(PHASE_7_STEP_3) || !step3.includes(PHASE_7_STOP)) {
      out.push(`Phase 7: the BLOCKED arm does not follow \`${PHASE_7_STEP_3}\` that stops the run ("${PHASE_7_STOP}")`)
    }
  }
  const spawns = parseFences(phaseSection(md, H.p7) ?? '').filter(f => isAgentBlock(f, 'Test'))
  if (spawns.length !== 1) {
    out.push(`Phase 7 holds ${spawns.length} Test spawns, expected 1`)
  } else {
    if (!spawns[0].includes(TEST_STATUS_SENTENCE)) out.push(`the Test spawn lacks "${TEST_STATUS_SENTENCE}"`)
    if (spawns[0].includes('Report PASS or FAIL')) out.push('the Test spawn still says "Report PASS or FAIL"')
  }
  return out
}

describe('#679, #680: the Validate and Test gates each state a BLOCKED arm that halts and spawns no Fix agent', () => {
  const builds = (): ReadonlyArray<readonly [string, string]> => [['curation on', implementMd()], ['curation off', implementMdOff()]]

  it('Phases 6, 7 and 8 hold their BLOCKED arm, in both curation builds', () => {
    for (const [label, md] of builds()) {
      expect(phaseSection(md, H.p7), `${label}: no Phase 7 read`).not.toBeNull()
      expect(collectBlockedArmDefects(md), label).toEqual([])
    }
  })

  it('known-bad probes: a dropped arm, a duplicated arm, a reverted Test fence and a renumbered step are each reported', () => {
    const md = implementMd()
    const p6 = `${BLOCKED_ARM} report its cause and log path, then halt.`
    const p7 = `${PHASE_7_BLOCKED_OPENING} report its cause and log path, and stop as in step 3; no Fix agent.`
    expect(collectBlockedArmDefects(seedOnce(md, `${p6}\n\n`, ''))).toEqual(['Phase 6 holds 0 `**If BLOCKED:**` paragraphs, expected 1'])
    expect(collectBlockedArmDefects(seedOnce(md, `${PHASE_8_BLOCKED_ARM}\n\n`, ''))).toEqual(['Phase 8 holds 0 `**If BLOCKED:**` paragraphs, expected 1'])
    expect(collectBlockedArmDefects(seedOnce(md, `\n\n${p7}`, ''))).toEqual([`Phase 7 holds 0 \`${PHASE_7_BLOCKED_OPENING}\` paragraphs, expected 1`])
    expect(collectBlockedArmDefects(seedOnce(md, p6, `${p6}\n\n${p6}`))).toEqual(['Phase 6 holds 2 `**If BLOCKED:**` paragraphs, expected 1'])
    expect(collectBlockedArmDefects(seedOnce(md, p6, `${BLOCKED_ARM} carry on.`))).toEqual(['Phase 6: the BLOCKED arm does not report its cause and log path, then halt'])
    expect(collectBlockedArmDefects(seedOnce(md, PHASE_8_BLOCKED_ARM, `${BLOCKED_ARM} carry on.`))).toEqual([`Phase 8: the BLOCKED arm is not \`${PHASE_8_BLOCKED_ARM}\``])
    expect(collectBlockedArmDefects(seedOnce(md, 'no Fix agent.', 'then a Fix agent.'))).toEqual(['Phase 7: the BLOCKED arm lacks "no Fix agent"'])
    expect(collectBlockedArmDefects(seedOnce(md, 'stop as in step 3', 'carry on'))).toEqual(['Phase 7: the BLOCKED arm lacks "stop as in step 3"'])
    expect(collectBlockedArmDefects(seedOnce(md, TEST_STATUS_SENTENCE, 'Report PASS or FAIL with evidence.'))).toEqual([
      `the Test spawn lacks "${TEST_STATUS_SENTENCE}"`,
      'the Test spawn still says "Report PASS or FAIL"',
    ])
    expect(collectBlockedArmDefects(seedOnce(md, PHASE_7_STEP_3, '4. If `qa_retry_count > 2`:'))).toEqual([
      `Phase 7: the BLOCKED arm does not follow \`${PHASE_7_STEP_3}\` that stops the run ("${PHASE_7_STOP}")`,
    ])
    expect(collectBlockedArmDefects(seedOnce(md, H.p8, '### Phase 8 gone'))).toEqual([`${H.p8}: the section is absent`])
  })

  it('known-bad probes: a Phase 6 arm placed between the PASS paragraph and the halt sentence is reported by both collectors', () => {
    const md = implementMd()
    const p6 = `${BLOCKED_ARM} report its cause and log path, then halt.`
    const afterPass = `then continue to Phase 7.\n\n${OTHER_STATUS_HALT}`
    const moved = seedOnce(seedOnce(md, `${p6}\n\n`, ''), afterPass, `then continue to Phase 7.\n\n${p6}\n\n${OTHER_STATUS_HALT}`)
    expect(collectBlockedArmDefects(moved)).toEqual(['Phase 6: the BLOCKED arm does not come before `**If PASS:**`'])
    expect(collectValidateOnceDefects(moved)).toEqual(['Phase 6 does not halt on any other or missing Status, once, after its PASS line'])
  })
})

/** Phase 9 stops the run at the report when the Git agent opens no PR: its sentence says that Phases 10 and 11 do not run. */
const PHASE_9_STOP = 'Phases 10 and 11 do not run'
/** The Phase 11 skip rule, as the command words it. */
const PHASE_11_SKIP_RULE = 'Skip it only when the run stopped before Phase 10 started.'
/** The Phase 11 lead: it runs after Phase 10, or after Phase 9 on the re-validation path, which has no Phase 10. */
const PHASE_11_RUN_LEAD = "Run once, after Phase 10 or the re-validation path's Phase 9, under every strategy."
/** The rule as it read before the fix: "an earlier phase" also reaches a stop in Phase 10, so a PR that Phase 9 opened got no evidence. */
const PHASE_11_SKIP_RULE_EARLIER = 'Skip it only when an earlier phase stopped the run.'
/** The Phase 10 lead sentence for a passing gate, which hands the run to Phase 11. */
const PHASE_10_PASSING_ARM = '2. **If PASSING** → proceed to Phase 11.'

/**
 * Named collector (#675): the Phase 11 skip rule skips Phase 11 for every stop before Phase 10 and for no stop in Phase 10.
 * Phase 7 (step 3) and Phase 9 each stop the run at the report and say that Phase 11 does not run, so the rule must cover
 * both: it says "before Phase 10", or it names each of those phases. A Phase 10 stop leaves the PR that Phase 9 opened, and
 * Phase 11 must still run for it, so a rule that says "earlier" or names Phase 10 or a later phase reaches that stop and is
 * reported, and so is a Phase 10 that says Phase 11 does not run. A rule that names only Phase 9 leaves the Phase 7 stop with
 * no skip rule. The stops are read from the phases, so a stop sentence that goes missing fails here and does not pass for
 * lack of a subject.
 */
function collectPhase11SkipDefects(md: string): string[] {
  const eleven = phaseSection(md, H.p11)
  if (eleven === null) return [`${H.p11}: the section is absent`]
  const rules = eleven.match(/Skip it only when [^.]*\./g) ?? []
  if (rules.length !== 1) return [`Phase 11 holds ${rules.length} skip rules, expected 1`]
  const rule = rules[0]
  const bounded = /before Phase 10\b/.test(rule)
  const unbounded = /\bearlier\b/.test(rule)
  const out: string[] = []
  if (!eleven.includes(PHASE_11_RUN_LEAD)) out.push(`the Phase 11 lead does not say: ${PHASE_11_RUN_LEAD}`)
  if (unbounded || /Phase 1[0-2]/.test(rule.replace(/before Phase 10\b/, ''))) out.push('the Phase 11 skip rule reaches a Phase 10 stop, so the PR that Phase 9 opened gets no evidence')
  for (const [phase, heading, stop] of [['Phase 7', H.p7, PHASE_7_STOP], ['Phase 9', H.p9, PHASE_9_STOP]] as const) {
    if (!(phaseSection(md, heading) ?? '').includes(stop)) out.push(`${phase}: the stop sentence "${stop}" is absent, so the skip rule has no stop to cover`)
    else if (!bounded && !unbounded && !rule.includes(phase)) out.push(`the Phase 11 skip rule does not cover the ${phase} stop`)
  }
  const ten = phaseSection(md, H.p10)
  if (ten === null) out.push(`${H.p10}: the section is absent`)
  else if (/\b11 do(es)? not run/.test(ten)) out.push('Phase 10 says that Phase 11 does not run, so the PR that it leaves gets no evidence')
  return out
}

describe('#675: the Phase 11 skip rule skips Phase 11 for every stop before Phase 10 and for no stop in Phase 10, in all four builds', () => {
  it.each(IMPLEMENT_KEYS)('%s: the rule covers the Phase 7 stop and the Phase 9 stop and leaves the Phase 10 stop to Phase 11', key => {
    const md = implementMdOfKey(key)
    expect(phaseSection(md, H.p7), `${key}: Phase 7 says that Phase 11 does not run`).toContain(PHASE_7_STOP)
    expect(phaseSection(md, H.p9), `${key}: Phase 9 says that Phase 11 does not run`).toContain(PHASE_9_STOP)
    expect(phaseSection(md, H.p10), `${key}: Phase 10 hands the run to Phase 11`).toContain(PHASE_10_PASSING_ARM)
    expect(collectPhase11SkipDefects(md), key).toEqual([])
    expect(phaseSection(md, H.p11), `${key}: the skip rule, whole`).toContain(` ${PHASE_11_SKIP_RULE} `)
    expect(phaseSection(md, H.p11), `${key}: the lead, whole`).toContain(PHASE_11_RUN_LEAD)
  })

  it.each(IMPLEMENT_KEYS)("%s: known-bad probes: a lead that lost the re-validation path's Phase 9, or the whole lead, is reported", key => {
    const md = implementMdOfKey(key)
    const lead = `the Phase 11 lead does not say: ${PHASE_11_RUN_LEAD}`
    expect(collectPhase11SkipDefects(seedOnce(md, " or the re-validation path's Phase 9", '')), 'the re-validation path dropped').toEqual([lead])
    expect(collectPhase11SkipDefects(seedOnce(md, PHASE_11_RUN_LEAD, 'Run once, after Phase 10, under every strategy.')), 'the lead as it was').toEqual([lead])
    expect(collectPhase11SkipDefects(seedOnce(md, `${PHASE_11_RUN_LEAD} `, '')), 'the lead deleted').toEqual([lead])
  })

  it.each(IMPLEMENT_KEYS)('%s: known-bad probes: the earlier-phase rule, a rule that names only Phase 9, only Phase 7 or Phase 10, a missing rule, a lost stop sentence and a Phase 10 stop sentence are each reported', key => {
    const md = implementMdOfKey(key)
    const reachesTen = 'the Phase 11 skip rule reaches a Phase 10 stop, so the PR that Phase 9 opened gets no evidence'
    expect(collectPhase11SkipDefects(seedOnce(md, PHASE_11_SKIP_RULE, PHASE_11_SKIP_RULE_EARLIER)), 'the rule that skipped Phase 11 after a Phase 10 stop').toEqual([reachesTen])
    const onlyNine = seedOnce(md, PHASE_11_SKIP_RULE, 'Skip it only when Phase 9 stopped the run.')
    expect(collectPhase11SkipDefects(onlyNine), 'the rule before the earlier-phase rule: it leaves the Phase 7 stop with no skip rule').toEqual(['the Phase 11 skip rule does not cover the Phase 7 stop'])
    const onlySeven = seedOnce(md, PHASE_11_SKIP_RULE, 'Skip it only when Phase 7 stopped the run.')
    expect(collectPhase11SkipDefects(onlySeven)).toEqual(['the Phase 11 skip rule does not cover the Phase 9 stop'])
    const bothNamed = seedOnce(md, PHASE_11_SKIP_RULE, 'Skip it only when Phase 7 step 3 or Phase 9 stopped the run.')
    expect(collectPhase11SkipDefects(bothNamed), 'a rule that names both stops covers both and leaves Phase 10 to Phase 11').toEqual([])
    expect(collectPhase11SkipDefects(seedOnce(md, PHASE_11_SKIP_RULE, 'Skip it only when Phase 7 step 3, Phase 9 or Phase 10 stopped the run.'))).toEqual([reachesTen])
    expect(collectPhase11SkipDefects(seedOnce(md, ` ${PHASE_11_SKIP_RULE}`, ''))).toEqual(['Phase 11 holds 0 skip rules, expected 1'])
    expect(collectPhase11SkipDefects(seedOnce(md, PHASE_11_SKIP_RULE, `${PHASE_11_SKIP_RULE} ${PHASE_11_SKIP_RULE}`))).toEqual(['Phase 11 holds 2 skip rules, expected 1'])
    expect(collectPhase11SkipDefects(seedOnce(onlyNine, PHASE_7_STOP, 'Phase 11 runs.'))).toEqual([
      `Phase 7: the stop sentence "${PHASE_7_STOP}" is absent, so the skip rule has no stop to cover`,
    ])
    expect(collectPhase11SkipDefects(seedOnce(md, PHASE_10_PASSING_ARM, '2. **If PASSING** → stop at the report; Phase 11 does not run.'))).toEqual(['Phase 10 says that Phase 11 does not run, so the PR that it leaves gets no evidence'])
    expect(collectPhase11SkipDefects(seedOnce(md, H.p10, '### Phase 10 gone'))).toEqual([`${H.p10}: the section is absent`])
    expect(collectPhase11SkipDefects(seedOnce(md, H.p11, '### Phase 11 gone'))).toEqual([`${H.p11}: the section is absent`])
  })
})

/**
 * Named collector (#675): the Phase 6 lead-in names the three paths into Phase 6 and the status that gates the second one.
 * A single-pass Fix that reports FAILED or BLOCKED reports the misalignments to the user and starts no Phase 6, so a
 * lead-in that says only that the Fix "completes" reads as "returns" and lets a reader start Phase 6 after a stop.
 * The third path is the user's go after a Phase 5 report for decision: the lead-in must name it, or Phase 6 has no
 * stated way in from that report.
 * The lead-in must say ALIGNED as a whole word (MISALIGNED is the opposite status), must say that the Fix reports COMPLETE,
 * and must say that a user who continues after a Phase 5 report starts Phase 6.
 */
function collectPhase6LeadDefects(md: string): string[] {
  const six = phaseSection(md, H.p6)
  if (six === null) return [`${H.p6}: the section is absent`]
  const leads = six.split('\n').filter(l => l.endsWith('spawn Validate agent:'))
  if (leads.length !== 1) return [`Phase 6 holds ${leads.length} Validate spawn leads, expected 1`]
  const out: string[] = []
  if (!/\bALIGNED\b/.test(leads[0])) out.push('the Phase 6 lead-in does not name ALIGNED')
  if (!leads[0].includes('a single-pass Fix that reports COMPLETE')) out.push('the Phase 6 lead-in does not name the COMPLETE status of the single-pass Fix')
  if (!leads[0].includes('a user who continues after a Phase 5 report')) out.push('the Phase 6 lead-in does not name the user who continues after a Phase 5 report')
  return out
}

describe('#675: the Phase 6 lead-in names ALIGNED, the COMPLETE status of the single-pass Fix and the user who continues, in all four builds', () => {
  it.each(IMPLEMENT_KEYS)('%s: the lead-in names ALIGNED, the COMPLETE status and the continuing user', key => {
    const md = implementMdOfKey(key)
    expect(md.split('\n').filter(l => l === PHASE_6_LEAD), `${key}: the lead-in, whole`).toHaveLength(1)
    expect(collectPhase6LeadDefects(md), key).toEqual([])
  })

  it.each(IMPLEMENT_KEYS)('%s: known-bad probes: the word completes, a lost status, a lost ALIGNED, MISALIGNED in its place, a lost continue path, no lead-in, two leads and no section are each reported', key => {
    const md = implementMdOfKey(key)
    const noStatus = 'the Phase 6 lead-in does not name the COMPLETE status of the single-pass Fix'
    const noContinue = 'the Phase 6 lead-in does not name the user who continues after a Phase 5 report'
    const CONTINUE_PATH = 'or a user who continues after a Phase 5 report'
    expect(collectPhase6LeadDefects(seedOnce(md, PHASE_6_LEAD, `After ALIGNED, a single-pass fix completes, ${CONTINUE_PATH}, spawn Validate agent:`)), 'the lead-in before the fix').toEqual([noStatus])
    expect(collectPhase6LeadDefects(seedOnce(md, PHASE_6_LEAD, `After ALIGNED, a single-pass Fix that returns, ${CONTINUE_PATH}, spawn Validate agent:`))).toEqual([noStatus])
    expect(collectPhase6LeadDefects(seedOnce(md, PHASE_6_LEAD, `After a single-pass Fix that reports COMPLETE, ${CONTINUE_PATH}, spawn Validate agent:`))).toEqual(['the Phase 6 lead-in does not name ALIGNED'])
    expect(collectPhase6LeadDefects(seedOnce(md, PHASE_6_LEAD, 'After the gates, spawn Validate agent:'))).toEqual(['the Phase 6 lead-in does not name ALIGNED', noStatus, noContinue])
    expect(collectPhase6LeadDefects(seedOnce(md, PHASE_6_LEAD, `After MISALIGNED, a single-pass Fix that reports COMPLETE, ${CONTINUE_PATH}, spawn Validate agent:`)), 'MISALIGNED holds the letters of ALIGNED but is not the status').toEqual(['the Phase 6 lead-in does not name ALIGNED'])
    expect(collectPhase6LeadDefects(seedOnce(md, ', or a user who continues after a Phase 5 report', '')), 'the continue path dropped').toEqual([noContinue])
    expect(collectPhase6LeadDefects(seedOnce(md, 'who continues after a Phase 5 report', 'who continues')), 'the Phase 5 report dropped from the continue path').toEqual([noContinue])
    expect(collectPhase6LeadDefects(seedOnce(md, 'a user who continues', 'a reader who continues')), 'the user replaced').toEqual([noContinue])
    expect(collectPhase6LeadDefects(seedOnce(md, `${PHASE_6_LEAD}\n`, ''))).toEqual(['Phase 6 holds 0 Validate spawn leads, expected 1'])
    expect(collectPhase6LeadDefects(seedOnce(md, PHASE_6_LEAD, `${PHASE_6_LEAD}\n${PHASE_6_LEAD}`))).toEqual(['Phase 6 holds 2 Validate spawn leads, expected 1'])
    expect(collectPhase6LeadDefects(seedOnce(md, H.p6, '### Phase 6 gone'))).toEqual([`${H.p6}: the section is absent`])
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

/** What every spawn after Phase 2 names as FILES_CHANGED; Phase 3 defines `{branch_diff}` once. */
const BRANCH_DIFF = 'FILES_CHANGED: {branch_diff}'
/** `--diff-filter=d` drops deleted paths: Harden and Evaluate read every path the list names. The range starts at the resolved fork point, `BASE_REF`. */
const BRANCH_DIFF_COMMAND = '`{branch_diff}` is the output of `git diff --name-only --diff-filter=d {BASE_REF}...HEAD`, run again at each spawn'
/** A failed diff must never read as an empty list. */
const BRANCH_DIFF_EXIT = '; a non-zero exit stops, and an empty list counts only on exit 0.'
const CODE_AGENT_LIST = '{list of files from Code agent output}'

/** The spawns that take the branch diff: [phase heading, label, agent type, a line only that spawn carries]. */
const BRANCH_DIFF_SPAWNS: ReadonlyArray<readonly [string, string, string, string]> = [
  [H.p3, 'Phase 3 Polish', 'Polish', 'FILES_CHANGED:'],
  [H.p4, 'Phase 4 Harden', 'Harden', 'FILES_CHANGED:'],
  [H.p5, 'Phase 5 Evaluate', 'Evaluate', 'FILES_CHANGED:'],
  [H.p6, 'Phase 6 Validate', 'Validate', 'VALIDATION_SCOPE: full'],
  [H.p7, 'Phase 7 Test', 'Test', 'FILES_CHANGED:'],
]

/** Named collector: the spawns whose file list is not the branch diff, because the Code agent's own list names only the last phase of a sequential run. */
function collectFilesChangedDefects(md: string): string[] {
  const out = BRANCH_DIFF_SPAWNS.flatMap(([heading, label, type, marker]) => {
    const section = phaseSection(md, heading)
    if (section === null) return [`no ${label} section`]
    const spawn = parseFences(section).find(f => isAgentBlock(f, type) && f.includes(marker))
    if (spawn === undefined) return [`${label} has no spawn`]
    const requires = section.split('\n').find(l => l.startsWith('**Requires:**')) ?? ''
    const declared = !/\bBASE_REF\b/.test(requires)
      ? [`${label} Requires does not name BASE_REF`]
      : /\bFILES_CHANGED\b/.test(requires) ? [`${label} Requires still names the Code agent's FILES_CHANGED`] : []
    return [...(spawn.includes(BRANCH_DIFF) ? [] : [`the ${label} spawn takes the Code agent's file list, not the branch diff`]), ...declared]
  })
  const listed = BRANCH_DIFF_SPAWNS.map(([heading]) => heading)
  for (const [, heading, phase] of md.matchAll(/^(### (Phase \d+):[^\n]*)$/gm)) {
    if (listed.includes(heading)) continue
    const section = phaseSection(md, heading) ?? ''
    const requires = section.split('\n').find(l => l.startsWith('**Requires:**')) ?? ''
    if (section.includes('{branch_diff}') && !/\bBASE_REF\b/.test(requires)) out.push(`${phase} names {branch_diff} but its Requires does not name BASE_REF`)
  }
  const defined = md.indexOf(BRANCH_DIFF_COMMAND)
  if (defined === -1) out.push('the branch diff is not defined with git diff --name-only --diff-filter=d {BASE_REF}...HEAD')
  else if (!md.includes(BRANCH_DIFF_COMMAND + BRANCH_DIFF_EXIT)) out.push('the branch diff does not say that a non-zero exit stops and an empty list counts only on exit 0')
  else if (md.indexOf(BRANCH_DIFF) !== -1 && md.indexOf(BRANCH_DIFF) < defined) out.push('the branch diff is used before it is defined')
  const unfiltered = (md.match(/git diff --name-only (?!--diff-filter=d )/g) ?? []).length
  if (unfiltered > 0) out.push(`${unfiltered} git diff --name-only site(s) list deleted paths: no --diff-filter=d`)
  return md.includes(CODE_AGENT_LIST) ? [...out, 'a spawn still takes the Code agent\'s file list'] : out
}

describe('#421, #452: every spawn after Phase 2 gets the branch diff, not the Code agent\'s list', () => {
  it('FILES_CHANGED is the one `git diff --name-only --diff-filter=d {BASE_REF}...HEAD` at Polish, Harden, Evaluate, Validate and Test', () => {
    expect(BRANCH_DIFF_SPAWNS.length, 'the site table is empty, so this guard proves nothing').toBe(5)
    expect(collectFilesChangedDefects(implementMd())).toEqual([])
  })

  it('known-bad probe: the Code agent\'s list is reported at Validate', () => {
    const md = implementMd()
    const old = md.replace(`${BRANCH_DIFF}\nVALIDATION_SCOPE: full`, `FILES_CHANGED: ${CODE_AGENT_LIST}\nVALIDATION_SCOPE: full`)
    expect(old, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(old)).toEqual(["the Phase 6 Validate spawn takes the Code agent's file list, not the branch diff", "a spawn still takes the Code agent's file list"])
  })

  it.each(BRANCH_DIFF_SPAWNS.filter(([, , type]) => type !== 'Validate').map(([heading, label]) => [label, heading] as const))('known-bad probe: the Code agent\'s list is reported at %s', (label, heading) => {
    const md = implementMd()
    const section = phaseSection(md, heading)!
    const old = md.replace(section, section.replace(BRANCH_DIFF, `FILES_CHANGED: ${CODE_AGENT_LIST}`))
    expect(old, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(old)).toEqual([`the ${label} spawn takes the Code agent's file list, not the branch diff`, "a spawn still takes the Code agent's file list"])
  })

  it('known-bad probe: a phase outside the five that names the branch diff without requiring BASE_REF is reported', () => {
    const md = implementMd()
    const seeded = md.replace(H.p12, `${H.p12}\n\nFILES_CHANGED: {branch_diff}`)
    expect(seeded, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(seeded)).toEqual(['Phase 12 names {branch_diff} but its Requires does not name BASE_REF'])
  })

  it('known-bad probe: a lost site is reported', () => {
    const md = implementMd()
    const section = phaseSection(md, H.p3)!
    expect(collectFilesChangedDefects(md.replace(section, section.replace(/```[\s\S]*```/, '')))).toEqual(['Phase 3 Polish has no spawn'])
  })

  it.each(BRANCH_DIFF_SPAWNS.map(([heading, label]) => [label, heading] as const))('known-bad probe: a Requires line that names the Code agent\'s FILES_CHANGED, not BASE_REF, is reported at %s', (label, heading) => {
    const md = implementMd()
    const section = phaseSection(md, heading)!
    const requires = section.split('\n').find(l => l.startsWith('**Requires:**'))!
    const old = md.replace(section, section.replace(requires, requires.replace(/\bBASE_REF\b/, 'FILES_CHANGED')))
    expect(old, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(old)).toEqual([`${label} Requires does not name BASE_REF`])
  })

  it.each(BRANCH_DIFF_SPAWNS.map(([heading, label]) => [label, heading] as const))('known-bad probe: a Requires line that names both BASE_REF and the Code agent\'s FILES_CHANGED is reported at %s', (label, heading) => {
    const md = implementMd()
    const section = phaseSection(md, heading)!
    const requires = section.split('\n').find(l => l.startsWith('**Requires:**'))!
    const old = md.replace(section, () => section.replace(requires, () => `${requires}, FILES_CHANGED`))
    expect(old, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(old)).toEqual([`${label} Requires still names the Code agent's FILES_CHANGED`])
  })

  it('known-bad probes: a branch diff defined late, one that lists deleted paths and one lost are each reported', () => {
    const md = implementMd()
    expect(collectFilesChangedDefects(md.replace(BRANCH_DIFF_COMMAND, 'x') + `\n${BRANCH_DIFF_COMMAND}${BRANCH_DIFF_EXIT}\n`)).toEqual(['the branch diff is used before it is defined'])
    const unfiltered = md.replace('--diff-filter=d VALIDATED_HEAD..HEAD', 'VALIDATED_HEAD..HEAD')
    expect(unfiltered, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(unfiltered)).toEqual(['1 git diff --name-only site(s) list deleted paths: no --diff-filter=d'])
    expect(collectFilesChangedDefects(md.replace(BRANCH_DIFF_COMMAND, '`{branch_diff}` is the output of `git diff --name-only {BASE_REF}...HEAD`, run again at each spawn'))).toEqual([
      'the branch diff is not defined with git diff --name-only --diff-filter=d {BASE_REF}...HEAD',
      '1 git diff --name-only site(s) list deleted paths: no --diff-filter=d',
    ])
  })

  it('known-bad probes: a branch diff that names the base branch, and one with no exit rule, are each reported', () => {
    const md = implementMd()
    const named = md.replace(BRANCH_DIFF_COMMAND, BRANCH_DIFF_COMMAND.replace('{BASE_REF}', '{BASE_BRANCH}'))
    expect(named, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(named)).toEqual(['the branch diff is not defined with git diff --name-only --diff-filter=d {BASE_REF}...HEAD'])
    const silent = md.replace(BRANCH_DIFF_EXIT, '.')
    expect(silent, 'the seed must land').not.toBe(md)
    expect(collectFilesChangedDefects(silent)).toEqual(['the branch diff does not say that a non-zero exit stops and an empty list counts only on exit 0'])
  })
})

/** The one class a base name must match before it reaches a shell line: the resolver's exported STRICT_NAME_RE, which each prompt copies. */
const BASE_BRANCH_PATTERN = RB.STRICT_NAME_RE.source
/** The allowed set the stop line names: the characters and length, then the shapes the class refuses. */
const ALLOWED_SET = 'ASCII letters, digits and `._/+@,#-`, at most 200; no leading `-` or `#`, no `origin/` prefix, no `..`, not `@` or a HEAD name'
/** A branch name that `git check-ref-format --branch` accepts and a shell would run. */
const HOSTILE_BASE = 'a$(touch$IFS/tmp/x)|sh;b'
/** How the re-validation step hands the guarded value on: Phases 3-7 run this from `BASE_REF`, the fork point. */
const REVALIDATE_BRANCH_DIFF = 'Phases 3-7 run `{branch_diff}`'
const REVALIDATE_FORK_POINT = 'from `BASE_REF`, the fork point'
/** The fix a consumer names when the resolver gives no usable line. */
const RESOLVER_FIX = 're-run; if it repeats, run devflow init'
/** The captured `BASE_BRANCH` is checked again by reference, not by a second copy of the class. */
const CAPTURED_CHECK = 'stop unless it passes the setup check'

/** Named collector: where the base ref reaches a shell line with no check, in Setup, after the capture and in the re-validation path that can skip Setup. */
function collectBaseBranchGuardDefects(md: string, revalidate: string = revalidateReference()): string[] {
  const out: string[] = []
  const guarded = (line: string | undefined): boolean => line !== undefined && line.includes(`\`${BASE_BRANCH_PATTERN}\``) && /stop the run/i.test(line)
  const record = md.split('\n').find(l => l.startsWith('Record the current branch name as `BASE_BRANCH`'))
  if (!guarded(record)) out.push(`Phase 1 records BASE_BRANCH without stopping the run unless it matches \`${BASE_BRANCH_PATTERN}\``)
  else if (md.indexOf(record!) > md.indexOf('OPERATION: setup-task')) out.push('the BASE_BRANCH guard comes after the setup-task spawn')
  else if (!record!.includes(`\`${BASE_BRANCH_PATTERN}\` (${JUDGE_BY_READING})`)) out.push('Phase 1 does not say that the match is judged by reading, never by passing the value to a command')
  const captured = md.split('\n').find(l => l.startsWith('- `BASE_BRANCH`: Branch this feature was created from'))
  if (captured === undefined || !captured.includes(CAPTURED_CHECK)) out.push('the captured BASE_BRANCH is not checked again by the setup check before the base resolves')
  const rerecord = revalidate.split('\n').find(l => l.startsWith('3. **Record BASE_BRANCH**'))
  if (!guarded(rerecord)) out.push(`the re-validation path records BASE_BRANCH without stopping the run unless it matches \`${BASE_BRANCH_PATTERN}\``)
  else if (!rerecord!.includes(REVALIDATE_BRANCH_DIFF)) out.push('the re-validation path does not say that Phases 3-7 run {branch_diff}')
  else if (!rerecord!.includes(REVALIDATE_FORK_POINT)) out.push('the re-validation path does not say that the branch diff starts at BASE_REF, the fork point')
  else if (rerecord!.indexOf(BASE_BRANCH_PATTERN) > rerecord!.indexOf(REVALIDATE_BRANCH_DIFF)) out.push('the re-validation guard comes after the branch diff')
  else if (!rerecord!.includes('baseRefName')) out.push('the re-validation path does not say where BASE_BRANCH comes from when Phase 1 is skipped')
  else if (!rerecord!.includes('never the name')) out.push('the re-validation stop line does not say that it never writes the name')
  else if (!rerecord!.includes(`\`${BASE_BRANCH_PATTERN}\` (${JUDGE_BY_READING})`)) out.push('the re-validation path does not say that the match is judged by reading, never by passing the value to a command')
  const call = revalidate.split('\n').find(l => l.includes(RESOLVER))
  const spans = (call ?? '').match(/`[^`]*resolve-base\.cjs[^`]*`/g) ?? []
  const prSpan = spans.find(s => s.includes(' pr '))
  const localSpan = spans.find(s => s.includes(' local '))
  if (call === undefined || prSpan === undefined || !/ pr --name-stdin --cross "\$\{X\}" < "\$F"; echo "exit=\$\?"/.test(prSpan) || !call.includes('isCrossRepository')) {
    out.push('the re-validation path does not run the pr-mode resolver over the name file on stdin with the cross flag from isCrossRepository')
  } else if (localSpan === undefined || !/ local --name-stdin < "\$F"; echo "exit=\$\?"/.test(localSpan)) {
    out.push('the re-validation path does not run the local-mode resolver over the name file on stdin when gh returned no PR')
  } else if (![prSpan, localSpan].every(span => span.startsWith(`\`${NAME_FILE_TRAP} `))) {
    out.push('a re-validation resolver call does not bind the name file and arm the trap that removes it with a flagless rm')
  } else if (rerecord !== undefined && revalidate.indexOf(call) < revalidate.indexOf(rerecord)) {
    out.push('the re-validation path resolves the base before it checks the name')
  }
  if (call !== undefined && !(call.includes('`REASON=resolver-unavailable`') && call.includes(`\`${RESOLVER_FIX}\``))) {
    out.push('the re-validation path does not read other resolver output as resolver-unavailable with the re-run, then devflow init fix')
  }
  return out
}

describe('#452: BASE_BRANCH is checked before it reaches a shell line', () => {
  it('Setup, the capture and the re-validation path stop the run on a base ref outside the pattern', () => {
    expect(collectBaseBranchGuardDefects(implementMd())).toEqual([])
  })

  it('the pattern admits git-valid ASCII branch names up to 200 characters and refuses the rest, a name git accepts and a shell would run included', () => {
    const gitAccepts = (name: string): void => {
      expect(() => execFileSync('git', ['check-ref-format', '--branch', name], { cwd: SCRATCH, env: scopedEnv(SCRATCH), stdio: 'pipe' }), `git no longer accepts ${name}, so it proves nothing`).not.toThrow()
    }
    const re = new RegExp(BASE_BRANCH_PATTERN)
    const admitted = ['main', 'feat/452-token-diet-wave-c2', 'release/1.2.3', 'feat+x', 'user@feat', 'fix/#12', 'a,b']
    for (const ok of admitted) { gitAccepts(ok); expect(re.test(ok), ok).toBe(true) }
    expect(re.test('x'.repeat(200)), 'the 200-character bound is inclusive').toBe(true)
    // Git accepts these too; the pattern is narrower than git on purpose, and the stop line says so.
    for (const refused of [HOSTILE_BASE, 'café']) { gitAccepts(refused); expect(re.test(refused), refused).toBe(false) }
    for (const bad of ['a;b', 'a b', 'a`id`', '$(id)', 'a|b', '', 'x'.repeat(201)]) expect(re.test(bad), bad).toBe(false)
    // The shapes the stop line names: a leading `-` or `#`, an `origin/` prefix, `..` and the revision names.
    for (const bad of ['-x', '#12', 'origin/main', 'a..b', '@', 'HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD']) expect(re.test(bad), bad).toBe(false)
    for (const ok of ['origin', 'originx/y', 'HEAD-2', 'feat/HEAD', 'a.b', '@x', 'x@']) expect(re.test(ok), ok).toBe(true)
  })

  it('both stop lines tell the user which names are allowed', () => {
    const record = implementMd().split('\n').find(l => l.startsWith('Record the current branch name as `BASE_BRANCH`'))!
    const rerecord = revalidateReference().split('\n').find(l => l.startsWith('3. **Record BASE_BRANCH**'))!
    for (const [where, line] of [['Phase 1', record], ['the re-validation path', rerecord]] as const) {
      expect(line, `${where} gives the stop no reason`).toContain(ALLOWED_SET)
    }
  })

  it('known-bad probes: a lost guard, a widened pattern, a late guard, an unchecked capture and an unguarded re-validation are each reported', () => {
    const md = implementMd()
    const record = md.split('\n').find(l => l.startsWith('Record the current branch name as `BASE_BRANCH`'))!
    const unguarded = md.replace(record, 'Record the current branch name as `BASE_BRANCH`.')
    expect(unguarded, 'the seed must land').not.toBe(md)
    const lost = `Phase 1 records BASE_BRANCH without stopping the run unless it matches \`${BASE_BRANCH_PATTERN}\``
    expect(collectBaseBranchGuardDefects(unguarded)).toEqual([lost])
    const widened = md.replace(record, () => record.replace('{1,200}', '+'))
    expect(widened, 'the seed must land').not.toBe(md)
    expect(collectBaseBranchGuardDefects(widened)).toEqual([lost])
    const stale = md.replace(record, () => record.replace('(?!.*\\.\\.)', ''))
    expect(stale, 'the seed must land').not.toBe(md)
    expect(collectBaseBranchGuardDefects(stale)).toEqual([lost])
    expect(collectBaseBranchGuardDefects(md.replace(record, '').replace('OPERATION: setup-task', () => `OPERATION: setup-task\n${record}`))).toEqual(['the BASE_BRANCH guard comes after the setup-task spawn'])
    const unchecked = md.replace(`; ${CAPTURED_CHECK}`, '')
    expect(unchecked, 'the seed must land').not.toBe(md)
    expect(collectBaseBranchGuardDefects(unchecked)).toEqual(['the captured BASE_BRANCH is not checked again by the setup check before the base resolves'])
    const unread = md.replace(record, () => record.replace(` (${JUDGE_BY_READING})`, ''))
    expect(unread, 'the seed must land').not.toBe(md)
    expect(collectBaseBranchGuardDefects(unread)).toEqual(['Phase 1 does not say that the match is judged by reading, never by passing the value to a command'])

    const reval = revalidateReference()
    const rerecord = reval.split('\n').find(l => l.startsWith('3. **Record BASE_BRANCH**'))!
    const lostReval = `the re-validation path records BASE_BRANCH without stopping the run unless it matches \`${BASE_BRANCH_PATTERN}\``
    const lateGuard = rerecord.replace(BASE_BRANCH_PATTERN, 'x').replace(` Phases 3-7 run \`{branch_diff}\` ${REVALIDATE_FORK_POINT}.`, () => ` Phases 3-7 run \`{branch_diff}\` ${REVALIDATE_FORK_POINT} unless it fails the pattern \`${BASE_BRANCH_PATTERN}\`; stop the run.`)
    expect(lateGuard, 'the seed must land').not.toBe(rerecord)
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => rerecord.replace(BASE_BRANCH_PATTERN, 'x')))).toEqual([lostReval])
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => lateGuard))).toEqual(['the re-validation guard comes after the branch diff'])
    const unsaid = rerecord.replace(REVALIDATE_BRANCH_DIFF, 'Phases 3-7 run it')
    expect(unsaid, 'the seed must land').not.toBe(rerecord)
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => unsaid))).toEqual(['the re-validation path does not say that Phases 3-7 run {branch_diff}'])
    const fromName = rerecord.replace(REVALIDATE_FORK_POINT, 'from it')
    expect(fromName, 'the seed must land').not.toBe(rerecord)
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => fromName))).toEqual(['the re-validation path does not say that the branch diff starts at BASE_REF, the fork point'])
    const sourceless = rerecord.replaceAll('baseRefName', 'x')
    expect(sourceless, 'the seed must land').not.toBe(rerecord)
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => sourceless))).toEqual(['the re-validation path does not say where BASE_BRANCH comes from when Phase 1 is skipped'])
    const namesIt = rerecord.replace('never the name', 'the name')
    expect(namesIt, 'the seed must land').not.toBe(rerecord)
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => namesIt))).toEqual(['the re-validation stop line does not say that it never writes the name'])
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, ''))).toEqual([lostReval])
    const unreadReval = rerecord.replace(` (${JUDGE_BY_READING})`, '')
    expect(unreadReval, 'the seed must land').not.toBe(rerecord)
    expect(collectBaseBranchGuardDefects(md, reval.replace(rerecord, () => unreadReval))).toEqual(['the re-validation path does not say that the match is judged by reading, never by passing the value to a command'])

    const call = reval.split('\n').find(l => l.includes(RESOLVER))!
    const lostCall = 'the re-validation path does not run the pr-mode resolver over the name file on stdin with the cross flag from isCrossRepository'
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, ''))).toEqual([lostCall])
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => call.replace(' pr --name-stdin', ' local --name-stdin')))).toEqual([lostCall])
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => call.replaceAll('isCrossRepository', 'x')))).toEqual([lostCall])
    const argvName = call.replace(' pr --name-stdin --cross "${X}" < "$F"', ' pr "${B}" --cross "${X}"')
    expect(argvName, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => argvName))).toEqual([lostCall])
    const prNoStdin = call.replace(' pr --name-stdin --cross "${X}" < "$F"', ' pr --name-stdin --cross "${X}"')
    expect(prNoStdin, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => prNoStdin))).toEqual([lostCall])
    const lostLocal = 'the re-validation path does not run the local-mode resolver over the name file on stdin when gh returned no PR'
    const noLocal = call.replace(' local --name-stdin', ' pr --name-stdin')
    expect(noLocal, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => noLocal))).toEqual([lostLocal])
    const localNoStdin = call.replace(' local --name-stdin < "$F"', ' local --name-stdin')
    expect(localNoStdin, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => localNoStdin))).toEqual([lostLocal])
    const localArgv = call.replace(' local --name-stdin < "$F"', ' local "${B}"')
    expect(localArgv, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => localArgv))).toEqual([lostLocal])
    const lostTrap = 'a re-validation resolver call does not bind the name file and arm the trap that removes it with a flagless rm'
    const noTrap = call.replace(`${NAME_FILE_TRAP} `, '')
    expect(noTrap, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => noTrap))).toEqual([lostTrap])
    const flaggedTrap = call.replace(`trap 'rm -- "$F"' EXIT`, `trap 'rm -f "$F"' EXIT`)
    expect(flaggedTrap, 'the seed must land').not.toBe(call)
    expect(collectBaseBranchGuardDefects(md, reval.replace(call, () => flaggedTrap))).toEqual([lostTrap])
    expect(collectBaseBranchGuardDefects(md, reval.replace(`${rerecord}\n${call}`, () => `${call}\n${rerecord}`))).toEqual(['the re-validation path resolves the base before it checks the name'])
    const lostUnavailable = 'the re-validation path does not read other resolver output as resolver-unavailable with the re-run, then devflow init fix'
    expect(collectBaseBranchGuardDefects(md, reval.replace('`REASON=resolver-unavailable`', 'a stop'))).toEqual([lostUnavailable])
    expect(collectBaseBranchGuardDefects(md, reval.replace(`\`${RESOLVER_FIX}\``, '`run devflow init`'))).toEqual([lostUnavailable])
  })
})

/** The one Bash call that starts the re-validation base step: the fork flag to stdout, the PR base name to a fresh temp file, the gh status echoed. */
const REVALIDATE_PRODUCER = `cd "{worktree}" && F="$(mktemp)" && echo "F=$F" && gh pr view --json isCrossRepository --jq .isCrossRepository; ${PRODUCER_STATUS_CAPTURE} ${PRODUCER_NAME_TAIL}`
/** The no-PR default branch, in the order the step takes it: the origin read, then main, then master, each checked by the same rev-parse. */
const REVALIDATE_NO_PR_CHAIN = [NO_PR_CLAUSE, ORIGIN_HEAD_READ, MAIN_PROBE, MASTER_FALLBACK] as const
const REVALIDATE_STOP_ON_GH = `Stop the run, after \`rm -- "{name file}"\`, if ${OTHER_GH_FAILURE_CLAUSE}, or the file is empty after every fallback.`
const REVALIDATE_STOP_ON_CLASS = 'Stop the run, after `rm -- "{name file}"`, unless the name matches'

/** Named collector: how the re-validation base step gets the name into a file, takes the no-PR default branch and removes the file on its stops. */
function collectRevalidateNameFileDefects(revalidate: string): string[] {
  const step = revalidate.split('\n').find(l => l.startsWith('3. **Record BASE_BRANCH**'))
  if (step === undefined) return ['no re-validation base step']
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  const chainAt = REVALIDATE_NO_PR_CHAIN.map(part => step.indexOf(part))
  need('the fork flag and the PR base name are read in one Bash call, the name going to a fresh temp file', step.includes(`\`${REVALIDATE_PRODUCER}\``) && step.includes('`{name file}` is the printed `F=` path'))
  need('a gh failure that shows no PR takes the default branch by for-each-ref, then main, then master, before any stop line', chainAt.every((at, n) => at >= 0 && (n === 0 || at > chainAt[n - 1])) && chainAt[chainAt.length - 1] < step.indexOf('Stop the run'))
  need('the default branch is read with for-each-ref, never by symbolic-ref, abbrev-ref or a pipe', !/symbolic-ref|abbrev-ref|\| *sed/.test(step))
  need('a gh failure is read from either printed status', step.includes(GH_FAILED_RULE))
  need('the default branch is filled by the origin read, main, master and the Write tool, an empty line counts as empty, and a failed Write is a missing value', step.includes(DEFAULT_BRANCH_FILL))
  need('only the two reads redirect into the name file', countShellWritesIntoF(step) === 2)
  need('the name file is read with the Read tool', step.includes('Read `{name file}` with the Read tool: its one line is the name.'))
  need('a gh failure that shows no missing PR, or an empty file, stops the run after removing the name file', step.includes(REVALIDATE_STOP_ON_GH))
  need('a name outside the class stops the run after removing the name file', step.includes(REVALIDATE_STOP_ON_CLASS))
  const call = revalidate.split('\n').find(l => l.includes(RESOLVER)) ?? ''
  need('one pr-mode call runs when gh returned a PR, else one local-mode call, each reading the name file', (call.match(/resolve-base\.cjs/g) ?? []).length === 2 && / pr --name-stdin [^`]*` when gh returned a PR, else `[^`]* local --name-stdin /.test(call))
  return out
}

describe('#561: the re-validation base step passes the name through a file', () => {
  const seeded = (from: string, to: string): string => {
    const real = revalidateReference()
    const wounded = real.replace(from, () => to)
    expect(wounded, 'the seed must land').not.toBe(real)
    return wounded
  }

  it('reads the name into a fresh file, takes the no-PR default branch by for-each-ref, main, master, and removes the file on each stop', () => {
    expect(collectRevalidateNameFileDefects(revalidateReference())).toEqual([])
  })

  it('known-bad probes: each lost part is reported by name', () => {
    expect(collectRevalidateNameFileDefects(seeded(REVALIDATE_PRODUCER, 'gh pr view --json baseRefName,isCrossRepository'))).toContain('the fork flag and the PR base name are read in one Bash call, the name going to a fresh temp file')
    const noProbe = 'a gh failure that shows no PR takes the default branch by for-each-ref, then main, then master, before any stop line'
    expect(collectRevalidateNameFileDefects(seeded('shows that no PR applies', 'shows a PR'))).toContain(noProbe)
    const filled = 'the default branch is filled by the origin read, main, master and the Write tool, an empty line counts as empty, and a failed Write is a missing value'
    expect(collectRevalidateNameFileDefects(seeded('rev-parse --verify --quiet main', 'rev-parse --verify --quiet trunk'))).toEqual([noProbe, filled])
    expect(collectRevalidateNameFileDefects(seeded(MASTER_FALLBACK, 'otherwise `master`'))).toEqual([noProbe, filled])
    expect(collectRevalidateNameFileDefects(seeded("for-each-ref --format='%(symref:lstrip=3)' refs/remotes/origin/HEAD", 'symbolic-ref --quiet --short refs/remotes/origin/HEAD'))).toEqual([noProbe, 'the default branch is read with for-each-ref, never by symbolic-ref, abbrev-ref or a pipe', filled])
    expect(collectRevalidateNameFileDefects(seeded(WRITE_FAILURE, ''))).toEqual([filled])
    expect(collectRevalidateNameFileDefects(seeded('write a literal name with the Write tool, after a Read of the file', 'write a literal name with a shell command'))).toEqual([filled])
    expect(collectRevalidateNameFileDefects(seeded(' (a file whose only content is an empty line is empty)', ''))).toEqual([filled])
    expect(collectRevalidateNameFileDefects(seeded(GH_FAILED_RULE, '`gh` failed when its first status is not 0'))).toEqual(['a gh failure is read from either printed status'])
    expect(collectRevalidateNameFileDefects(seeded('Read `{name file}` with the Read tool: its one line is the name.', ''))).toEqual(['the name file is read with the Read tool'])
    expect(collectRevalidateNameFileDefects(seeded(REVALIDATE_STOP_ON_GH, 'Stop the run if gh failed.'))).toEqual(['a gh failure that shows no missing PR, or an empty file, stops the run after removing the name file'])
    expect(collectRevalidateNameFileDefects(seeded(REVALIDATE_STOP_ON_CLASS, 'Stop the run unless the name matches'))).toEqual(['a name outside the class stops the run after removing the name file'])
    expect(collectRevalidateNameFileDefects(seeded(' Read `{name file}` with the Read tool', ' printf "%s" "{BASE_BRANCH}" > "$F"; Read `{name file}` with the Read tool'))).toEqual(['only the two reads redirect into the name file'])
    for (const [spelling, shellWrite] of SHELL_WRITE_PROBES) {
      expect(collectRevalidateNameFileDefects(seeded(' Read `{name file}` with the Read tool', ` ${shellWrite}; Read \`{name file}\` with the Read tool`)), spelling).toEqual(['only the two reads redirect into the name file'])
    }
    expect(collectRevalidateNameFileDefects(seeded(' when gh returned a PR, else ', ' always, then '))).toEqual(['one pr-mode call runs when gh returned a PR, else one local-mode call, each reading the name file'])
    expect(collectRevalidateNameFileDefects(revalidateReference().replace('3. **Record BASE_BRANCH**', '3. **Base**'))).toEqual(['no re-validation base step'])
  })
})

/** The checkout-root command Phase 1's docs root runs; the re-validation path runs the same one when Phase 1 does not. */
const REVALIDATE_ROOT_COMMAND = 'git -C "{start}" rev-parse --show-toplevel'

/** Named collector: whether the re-validation path resolves `{worktree}` before its first use, as Phase 1 does, when Phase 1 does not run. */
function collectRevalidateRootDefects(revalidate: string): string[] {
  const out: string[] = []
  const root = revalidate.indexOf(REVALIDATE_ROOT_COMMAND)
  const firstUse = revalidate.indexOf('"{worktree}"')
  if (firstUse === -1) return ['the re-validation path no longer uses {worktree}, so this guard proves nothing']
  if (root === -1) out.push('the re-validation path uses {worktree} without resolving it by the checkout-root command')
  else if (root > firstUse) out.push('the re-validation path resolves {worktree} after its first use')
  else if (!/else the start directory/.test(revalidate.slice(root, firstUse))) out.push('the re-validation path does not fall back to the start directory outside a git repository')
  return out
}

describe('#495: the re-validation path resolves {worktree} when Phase 1 does not run', () => {
  it('resolves it by the checkout-root rule of Phase 1 before the first use', () => {
    expect(collectRevalidateRootDefects(revalidateReference())).toEqual([])
  })

  it('known-bad probes: a lost resolution, a late one and a lost fallback are each reported', () => {
    const reval = revalidateReference()
    const lost = reval.replace(REVALIDATE_ROOT_COMMAND, () => 'git rev-parse --show-toplevel')
    expect(lost, 'the seed must land').not.toBe(reval)
    expect(collectRevalidateRootDefects(lost)).toEqual(['the re-validation path uses {worktree} without resolving it by the checkout-root command'])
    const late = `${reval.replace(REVALIDATE_ROOT_COMMAND, () => 'x')}\n${REVALIDATE_ROOT_COMMAND}`
    expect(collectRevalidateRootDefects(late)).toEqual(['the re-validation path resolves {worktree} after its first use'])
    const noFallback = reval.replace('else the start directory', () => 'else stop')
    expect(noFallback, 'the seed must land').not.toBe(reval)
    expect(collectRevalidateRootDefects(noFallback)).toEqual(['the re-validation path does not fall back to the start directory outside a git repository'])
  })
})

/** The pointers the renumbering retires, and the ones that replace them. */
const RETIRED_POINTERS = ['Harden agent (Phase 5)', 'Phase 3 or Phase 6 PASS', 'Phase 3\'s **Evidence claims**', 'after every Phase 8 run'] as const

/** Named collector: the Orchestration-only principle names the resolver calls that the fresh base step runs inline. */
function collectInlineResolverDefects(md: string): string[] {
  return /\*\*Orchestration only\*\*[^\n]*the fresh base step's resolver calls \(Phase 1, re-validation\)/.test(md)
    ? []
    : ['the Orchestration-only principle does not name the resolver calls of the fresh base step']
}

/** Named collector: cross-references that still use the numbers before #421, and the new ones that are absent. */
function collectPointerDefects(md: string, revalidate: string = revalidateReference()): string[] {
  const out = RETIRED_POINTERS.filter(p => md.includes(p)).map(p => `a retired pointer remains: "${p}"`)
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  need('Phase 1 does not point Harden at Phase 4', md.includes('Harden agent (Phase 4)'))
  need('the Evidence-claims definition does not name Phase 6 and Phase 8', md.includes('`gate:validate` — after a Phase 6 or Phase 8 PASS.'))
  need('the TP claims are not tied to Phase 7', md.includes('`TP-<n>` — after every Phase 7 run'))
  need('the Test spawn does not point at Phase 6\'s claims', md.includes('append its TP claims (Phase 6\'s **Evidence claims**)'))
  need('the continuation path names no order', revalidate.includes('**Run Phases 3-8** — Polish (at `full`), Self-Review, Alignment, the one full Validate, QA Testing and the conditional Re-Validate'))
  need('the Orchestration-only principle does not name the Phase 10 push and the ci-wait call', /\*\*Orchestration only\*\*[^\n]*Phase 10[^\n]*push[^\n]*ci-wait call/.test(md))
  out.push(...collectInlineResolverDefects(md))
  need('the Loop-limits principle does not carry the CI gate budget', /\*\*Loop limits\*\*[^\n]*at most 3 waits and 2 fixes/.test(md))
  return out
}

describe('#421 AC-26: the cross-references match the new phase numbers', () => {
  it('no retired pointer remains and each new one is present', () => {
    expect(collectPointerDefects(implementMd())).toEqual([])
  })

  it('known-bad probes: the old pointers and a lost principle clause are each reported', () => {
    const md = implementMd()
    const old = md.replace('Harden agent (Phase 4)', 'Harden agent (Phase 5)').replace('after a Phase 6 or Phase 8 PASS', 'after a Phase 3 or Phase 6 PASS')
    expect(collectPointerDefects(old)).toEqual(expect.arrayContaining([
      'a retired pointer remains: "Harden agent (Phase 5)"',
      'a retired pointer remains: "Phase 3 or Phase 6 PASS"',
      'Phase 1 does not point Harden at Phase 4',
    ]))
    expect(collectPointerDefects(md.replace('the CI gate allows at most 3 waits and 2 fixes', 'the CI gate polls ten times'))).toEqual(['the Loop-limits principle does not carry the CI gate budget'])
    const unnamed = md.replace("the fresh base step's resolver calls (Phase 1, re-validation), ", '')
    expect(unnamed, 'the seed must land').not.toBe(md)
    expect(collectPointerDefects(unnamed)).toEqual(['the Orchestration-only principle does not name the resolver calls of the fresh base step'])
  })
})

// ---------------------------------------------------------------------------
// #495 — Phase 1 resolves a fresh base once and every later diff starts at it
// ---------------------------------------------------------------------------

/** The call: the local rule over the name file read on stdin, in the worktree, with the file removed on every exit and the exit status echoed. */
const FRESH_BASE_CALL = `${NAME_FILE_TRAP} cd "{worktree}" && node "$HOME/.devflow/scripts/resolve-base.cjs" local --name-stdin < "$F"; echo "exit=$?"`

/** What the fresh-base step states: [what it must say, the text that says it]. */
const FRESH_BASE_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['the name written with the Write tool to a fresh temp file, after one Read of it', 'write `BASE_BRANCH` with the Write tool to the file that `F="$(mktemp)" && echo "F=$F"` prints, after one Read of it'],
  ['a failed Write counts as a missing value and is never done by a shell command', WRITE_FAILURE],
  ['the local-rule call over the name file on stdin, in the worktree, with the trap and the exit status echoed', `run \`${FRESH_BASE_CALL}\``],
  ['the accepted-line test (40 or 64 hex, or none) with exit=0', 'Output other than one `BASE_REF=` line (40 or 64 hex, or `none`) with `exit=0`'],
  ['unusable output reads as resolver-unavailable', '`REASON=resolver-unavailable`'],
  ['BASE_REF is recorded', 'Record `BASE_REF`.'],
  ['info prints one plain line', '`info` prints one plain line'],
  ['degraded records the base DEGRADED line with its fix', '`degraded` records `TRACEABILITY: DEGRADED (base {REASON}; fix: {fix})`'],
  ['a stop, with BASE_REF none, names its cause and fix', '`stop` (`BASE_REF=none`) stops the run, naming REASON and its fix'],
  ['no-merge-base names the unshallow fix', 'no-merge-base `git fetch --unshallow`'],
  ['no-ref and timeout name the fetch fix', 'no-ref or timeout `git fetch origin <base>`'],
  ['resolver-unavailable names the re-run, then the install fix', 'resolver-unavailable `re-run; if it repeats, run devflow init`'],
  ['invalid-name states the allowed set, never the name', 'invalid-name the allowed set, never the name'],
]

/** Named collector: what the fresh-base step, its channel, its sink and its Validate hand-off fail to state. */
function collectImplementFreshBaseDefects(md: string): string[] {
  const out: string[] = []
  const start = md.indexOf('**Fresh base.**')
  const end = start === -1 ? -1 : md.indexOf('\n\n', start)
  if (start === -1 || end === -1) return ['no fresh-base step']
  const step = md.slice(start, end)
  for (const [what, text] of FRESH_BASE_PARTS) if (!step.includes(text)) out.push(`the fresh-base step lacks: ${what}`)
  const traceability = md.split('\n').find(l => l.includes('under a `### Traceability` subsection')) ?? ''
  if (!traceability.includes('the fresh base step')) out.push('the Traceability section does not name the fresh base step')
  const phase1 = phaseSection(md, H.p1) ?? ''
  const produces = phase1.split('\n').filter(l => l.startsWith('**Produces:**'))
  if (produces.length === 0 || produces.some(l => !/\bBASE_REF\b/.test(l))) out.push('Phase 1 does not produce BASE_REF')
  const validate = phaseSection(md, H.p6) ?? ''
  if (!validate.includes('\nBASE_SHA: {BASE_REF}\n')) out.push('the Phase 6 Validate spawn does not take BASE_SHA from BASE_REF')
  if (md.includes('git merge-base')) out.push('a git merge-base over the base name remains')
  const openPr = phaseSection(md, H.p9) ?? ''
  if (!openPr.includes('\nBASE_BRANCH: {base branch}\n')) out.push('the Phase 9 PR target is not the bare base branch name')
  if (!openPr.includes('\nBASE_REF: {BASE_REF}\n')) out.push('the Phase 9 spawn does not pass BASE_REF to ensure-pr-ready')
  if (!/^\*\*Requires:\*\*[^\n]*\bBASE_REF\b/m.test(openPr)) out.push('Phase 9 does not require BASE_REF')
  return out
}

describe('#495: /implement resolves a fresh base once, before Phase 2, and every diff starts at it', () => {
  it('the step, its channel, its sink and the Validate hand-off state every part', () => {
    expect(FRESH_BASE_PARTS.length, 'the table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(10)
    expect(collectImplementFreshBaseDefects(implementMd())).toEqual([])
  })

  it.each(FRESH_BASE_PARTS)('known-bad probe: dropping "%s" is reported', (what, text) => {
    const md = implementMd()
    const seeded = md.replace(text, '')
    expect(seeded, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(seeded)).toContain(`the fresh-base step lacks: ${what}`)
  })

  it('known-bad probes: a name word, a call that reads no file and a flagged rm in the trap are each reported', () => {
    const md = implementMd()
    const callPart = 'the fresh-base step lacks: the local-rule call over the name file on stdin, in the worktree, with the trap and the exit status echoed'
    for (const wounded of [
      FRESH_BASE_CALL.replace(' --name-stdin < "$F"', ' "${B}"'),
      FRESH_BASE_CALL.replace(' < "$F"', ''),
      FRESH_BASE_CALL.replace('trap \'rm -- "$F"\'', 'trap \'rm -f "$F"\''),
      FRESH_BASE_CALL.replace('trap \'rm -- "$F"\' EXIT; ', ''),
    ]) {
      expect(wounded, 'the seed must land').not.toBe(FRESH_BASE_CALL)
      const seeded = md.replace(FRESH_BASE_CALL, () => wounded)
      expect(seeded, 'the seed must land').not.toBe(md)
      expect(collectImplementFreshBaseDefects(seeded)).toEqual([callPart])
    }
  })

  it('known-bad probes: a lost step, a lost channel, a lost product, a bare-name Validate base and a hex PR target are each reported', () => {
    const md = implementMd()
    expect(collectImplementFreshBaseDefects(md.replace('**Fresh base.**', '**Base.**'))).toEqual(['no fresh-base step'])
    const noChannel = md.replace('the fresh base step, ', '')
    expect(noChannel, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(noChannel)).toEqual(['the Traceability section does not name the fresh base step'])
    const noProduct = md.replace('**Produces:** TASK_ID, BASE_BRANCH, BASE_REF,', '**Produces:** TASK_ID, BASE_BRANCH,')
    expect(noProduct, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(noProduct)).toEqual(['Phase 1 does not produce BASE_REF'])
    const bareValidate = md.replace('\nBASE_SHA: {BASE_REF}\n', '\nBASE_SHA: {output of `git merge-base {BASE_BRANCH} HEAD`}\n')
    expect(bareValidate, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(bareValidate)).toEqual(['the Phase 6 Validate spawn does not take BASE_SHA from BASE_REF', 'a git merge-base over the base name remains'])
    const hexTarget = md.replace(/(### Phase 9: Open PR[\s\S]*?)BASE_BRANCH: \{base branch\}/, '$1BASE_BRANCH: {BASE_REF}')
    expect(hexTarget, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(hexTarget)).toEqual(['the Phase 9 PR target is not the bare base branch name'])
    const noPass = md.replace('BASE_BRANCH: {base branch}\nBASE_REF: {BASE_REF}\n', 'BASE_BRANCH: {base branch}\n')
    expect(noPass, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(noPass)).toEqual(['the Phase 9 spawn does not pass BASE_REF to ensure-pr-ready'])
    const noRequire = md.replace(/(### Phase 9: Open PR[\s\S]*?\*\*Requires:\*\* BASE_BRANCH), BASE_REF,/, '$1,')
    expect(noRequire, 'the seed must land').not.toBe(md)
    expect(collectImplementFreshBaseDefects(noRequire)).toEqual(['Phase 9 does not require BASE_REF'])
  })
})

describe('#495: the curation-off build of /implement states the same fresh-base text', () => {
  it('the order, the step, the branch diff, the base check and the principle hold in both builds', () => {
    const off = implementMdOff()
    expect(off, 'the curation-off build is the curation-on build, so this proves nothing').not.toBe(implementMd())
    expect(collectOrderViolations('implement.md', off, PHASE1_ORDER)).toEqual([])
    expect(collectImplementFreshBaseDefects(off)).toEqual([])
    expect(collectFilesChangedDefects(off)).toEqual([])
    expect(collectBaseBranchGuardDefects(off)).toEqual([])
    expect(collectInlineResolverDefects(off)).toEqual([])
    expect(collectOrchestrationPrincipleDefects(off)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// #544 — the re-validation path follows the review-publication setting, and "Phase 1 ran" means all of Phase 1
// ---------------------------------------------------------------------------
//
// The path skips Phase 1 on a work branch, so the value Phase 11 passes to the evidence script must come from a
// Phase 1 step that the path runs again. Step 4 of the reference points at the three Phase 1 rules in order: the
// evidence policy, the publication value of the worktree, and the stub rule. Step 1 says that "Phase 1 ran" means
// all of Phase 1, so a later "unless Phase 1 ran" never leaves the lens, the level or the base unset.

const EVIDENCE_POLICY_STEP = '**Resolve the evidence policy once per run**'
const PUBLICATION_STEP = '**Resolve `REVIEW_PUBLICATION` per worktree:**'
const STUB_RULE = '**Evidence stub:**'
const PHASE11_PUBLICATION_ARG = '{REVIEW_PUBLICATION resolved in Phase 1, or auto}'

/** The three Phase 1 steps that the settings step points at for the publication value, in the order it points at them. */
const PUBLICATION_POINTERS = [EVIDENCE_POLICY_STEP, PUBLICATION_STEP, STUB_RULE] as const

/** The line of the reference that opens with `lead`. A missing step fails with a report, so a probe never meets a TypeError. */
const referenceStep = (reference: string, lead: string): string => {
  const step = reference.split('\n').find(l => l.startsWith(lead))
  expect(step, `the re-validation reference has no step that opens with ${lead}`).toBeDefined()
  return step!
}

/** The words of the settings step that take the publication value, each exact: [what it must say, the text that says it]. */
const REVALIDATE_PUBLICATION_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['the publication value comes from that same settings line', 'take `REVIEW_PUBLICATION` from that same line'],
  ['the evidence policy is resolved by the Phase 1 step', EVIDENCE_POLICY_STEP],
  ['the publication value follows the Phase 1 per-worktree rule', PUBLICATION_STEP],
  ['the Phase 1 stub rule applies', STUB_RULE],
  ['Phase 11 passes the value resolved in Phase 1', 'Phase 11 passes `REVIEW_PUBLICATION` as the value resolved in Phase 1'],
]

/** The settings step as the reference worded it before it took the publication value: a known-bad text for the collector. */
const PRE_FIX_SETTINGS_STEP =
  '4. **Take GATE_LEVEL**: unless Phase 1 ran, run the **Resolve the settings line** step of Phase 1 once for this worktree, and take `GATE_LEVEL` from the line it accepts, or from its fail-closed line when it accepts none. Phase 6 passes it to Validate.'

/**
 * Named collector: how the re-validation path falls short of the review-publication setting. The settings step holds
 * the three Phase 1 pointers in order, and the reference has no `auto` fallback of its own. Each build of /implement
 * holds each of the three Phase 1 labels the step points at exactly once, and Phase 11 passes the value that Phase 1
 * resolved.
 */
function collectRevalidatePublicationDefects(md: string, revalidate: string = revalidateReference()): string[] {
  const out: string[] = []
  const step = revalidate.split('\n').find(l => l.startsWith('4. **Take GATE_LEVEL**'))
  if (step === undefined) return ['no re-validation settings step']
  for (const [what, text] of REVALIDATE_PUBLICATION_PARTS) {
    if (!step.includes(text)) out.push(`the settings step does not say: ${what}`)
  }
  const positions = PUBLICATION_POINTERS.map(label => step.indexOf(label))
  const allFound = positions.every(at => at >= 0)
  const inOrder = positions.every((at, i) => i === 0 || positions[i - 1] < at)
  if (allFound && !inOrder) {
    out.push('the settings step does not point at the evidence policy, the publication value and the stub rule in that order')
  }
  if (/\bor auto\b/.test(revalidate)) out.push('the re-validation reference falls back to auto')
  const phase1 = phaseSection(md, H.p1) ?? ''
  for (const label of PUBLICATION_POINTERS) {
    if (countOf(phase1, label) !== 1) out.push(`Phase 1 does not hold ${label} exactly once`)
  }
  if (!(phaseSection(md, H.p11) ?? '').includes(PHASE11_PUBLICATION_ARG)) out.push(`Phase 11 does not pass ${PHASE11_PUBLICATION_ARG}`)
  return out
}

describe('#544: the re-validation path takes the review-publication value from the same settings line as a full run', () => {
  it('step 4 points at the evidence policy, the publication value and the stub rule, and both builds hold the Phase 1 source and the Phase 11 pass', () => {
    expect(REVALIDATE_PUBLICATION_PARTS.length, 'the part table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(5)
    for (const [label, md] of [['curation on', implementMd()], ['curation off', implementMdOff()]] as const) {
      expect(phaseSection(md, H.p1)?.length ?? 0, `${label}: Phase 1 is empty, so this guard proves nothing`).toBeGreaterThan(5_000)
      expect(collectRevalidatePublicationDefects(md, revalidateReference()), label).toEqual([])
    }
  })

  it('known-bad probes: the step as it was, each lost pointer, a swapped order and an auto fallback are each reported', () => {
    const md = implementMd()
    const reval = revalidateReference()
    const step = referenceStep(reval, '4. **Take GATE_LEVEL**')
    const said = (what: string): string => `the settings step does not say: ${what}`
    expect(collectRevalidatePublicationDefects(md, seedOnce(reval, step, PRE_FIX_SETTINGS_STEP)), 'the step as it was')
      .toEqual(REVALIDATE_PUBLICATION_PARTS.map(([what]) => said(what)))
    for (const [what, text] of REVALIDATE_PUBLICATION_PARTS) {
      expect(collectRevalidatePublicationDefects(md, seedOnce(reval, text, '')), `dropping "${what}"`).toEqual([said(what)])
    }
    const swapped = seedOnce(seedOnce(seedOnce(reval, EVIDENCE_POLICY_STEP, '@@'), STUB_RULE, EVIDENCE_POLICY_STEP), '@@', STUB_RULE)
    expect(collectRevalidatePublicationDefects(md, swapped), 'the stub rule before the evidence policy')
      .toEqual(['the settings step does not point at the evidence policy, the publication value and the stub rule in that order'])
    expect(collectRevalidatePublicationDefects(md, seedOnce(reval, step, `${step} Pass the value, or auto.`)), 'an auto fallback in the settings step')
      .toEqual(['the re-validation reference falls back to auto'])
    const proceed = referenceStep(reval, '6. **Proceed to Phase 9**')
    expect(collectRevalidatePublicationDefects(md, seedOnce(reval, proceed, `${proceed} Pass the value, or auto.`)), 'an auto fallback outside the settings step')
      .toEqual(['the re-validation reference falls back to auto'])
    expect(collectRevalidatePublicationDefects(md, seedOnce(reval, step, `${step} Run it for automatic checks, or automatically.`)), 'prose that only starts with "auto"')
      .toEqual([])
    expect(collectRevalidatePublicationDefects(md, seedOnce(reval, '4. **Take GATE_LEVEL**', '4. **Take the level**'))).toEqual(['no re-validation settings step'])
  })

  it('known-bad probes: a Phase 1 label renamed or doubled, or the Phase 11 pass lost, in either build, is reported', () => {
    const reval = revalidateReference()
    for (const [label, md] of [['curation on', implementMd()], ['curation off', implementMdOff()]] as const) {
      for (const text of PUBLICATION_POINTERS) {
        expect(collectRevalidatePublicationDefects(seedOnce(md, text, '**Renamed rule**'), reval), `${label}: ${text} renamed`).toEqual([`Phase 1 does not hold ${text} exactly once`])
        expect(collectRevalidatePublicationDefects(seedOnce(md, text, `${text} ${text}`), reval), `${label}: ${text} twice`).toEqual([`Phase 1 does not hold ${text} exactly once`])
      }
      expect(collectRevalidatePublicationDefects(seedOnce(md, PHASE11_PUBLICATION_ARG, '{REVIEW_PUBLICATION}'), reval), `${label}: the Phase 11 pass`)
        .toEqual([`Phase 11 does not pass ${PHASE11_PUBLICATION_ARG}`])
    }
  })
})

/** Step 1 of the reference as it was before it said what "Phase 1 ran" means: a known-bad text for the collector. */
const PRE_FIX_BRANCH_STEP =
  '1. **Branch safety check**: If on a protected branch (main, master, develop, etc.), run Phase 1 to create/switch to a work branch. If already on a work branch, skip Phase 1 and resolve `{worktree}` as its docs root does: `git -C "{start}" rev-parse --show-toplevel`, else the start directory.'

/** What step 1 states: [what it must say, the text that says it]. */
const REVALIDATE_PHASE1_RUN_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['a protected branch runs all of Phase 1, through its Fresh base step', 'run all of Phase 1, through its **Fresh base.** step,'],
  ['"Phase 1 ran" means all of Phase 1 ran', '"Phase 1 ran" below means all of it ran'],
]

/** The conditions that read "Phase 1 ran", each at its own anchor: [what it is, the anchor]. */
const REVALIDATE_PHASE1_CONDITIONS: ReadonlyArray<readonly [string, string]> = [
  ['the BASE_BRANCH record', '**Record BASE_BRANCH**: unless Phase 1 ran,'],
  ['the base resolution', 'Unless Phase 1 ran (its `BASE_REF` stands)'],
  ['the GATE_LEVEL step', 'GATE_LEVEL**: unless Phase 1 ran,'],
]

/**
 * Named collector: how the re-validation reference leaves "Phase 1 ran" open to the reading "only the branch part ran".
 * Step 1 runs all of Phase 1 on a protected branch and says what "Phase 1 ran" means. The three conditions that read it
 * stay, each at its own anchor, so the lens, the level and the base are set whenever Phase 1 did not run. Each bold
 * label that step 1 names is held, byte for byte, by Phase 1 of the build of /implement it is checked against.
 */
function collectRevalidatePhase1RunDefects(md: string, revalidate: string = revalidateReference()): string[] {
  const step = revalidate.split('\n').find(l => /^1\. \*\*Branch safety check\*\*/.test(l))
  if (step === undefined) return ['no re-validation branch step']
  const out: string[] = []
  for (const [what, text] of REVALIDATE_PHASE1_RUN_PARTS) {
    if (!step.includes(text)) out.push(`step 1 does not say: ${what}`)
  }
  const phase1 = phaseSection(md, H.p1) ?? ''
  for (const [label] of step.replace(/^1\. \*\*Branch safety check\*\*/, '').matchAll(/\*\*[^*]+\*\*/g)) {
    if (!phase1.includes(label)) out.push(`Phase 1 does not hold ${label}, which step 1 names`)
  }
  for (const [what, anchor] of REVALIDATE_PHASE1_CONDITIONS) {
    if (!revalidate.includes(anchor)) out.push(`${what} no longer waits for "Phase 1 ran"`)
  }
  return out
}

describe('#544: "Phase 1 ran" on the re-validation path means all of Phase 1', () => {
  it('step 1 runs all of Phase 1 on a protected branch, the label it names is in Phase 1 of both builds, and the three conditions that read it stay at their anchors', () => {
    expect(REVALIDATE_PHASE1_CONDITIONS.length, 'the condition table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(3)
    for (const [label, md] of [['curation on', implementMd()], ['curation off', implementMdOff()]] as const) {
      expect(phaseSection(md, H.p1)?.length ?? 0, `${label}: Phase 1 is empty, so this guard proves nothing`).toBeGreaterThan(5_000)
      expect(collectRevalidatePhase1RunDefects(md, revalidateReference()), label).toEqual([])
    }
  })

  it('known-bad probes: step 1 as it was, a lost pointer, a lost condition and a renamed step are each reported', () => {
    const md = implementMd()
    const reval = revalidateReference()
    const step = referenceStep(reval, '1. **Branch safety check**')
    const said = (what: string): string => `step 1 does not say: ${what}`
    expect(collectRevalidatePhase1RunDefects(md, seedOnce(reval, step, PRE_FIX_BRANCH_STEP)), 'step 1 as it was')
      .toEqual(REVALIDATE_PHASE1_RUN_PARTS.map(([what]) => said(what)))
    expect(collectRevalidatePhase1RunDefects(md, seedOnce(reval, 'run all of Phase 1, through its **Fresh base.** step,', 'run Phase 1')), 'the old wording of the run')
      .toEqual([said(REVALIDATE_PHASE1_RUN_PARTS[0][0])])
    expect(collectRevalidatePhase1RunDefects(md, seedOnce(reval, ' "Phase 1 ran" below means all of it ran.', '')), 'the meaning of "Phase 1 ran"')
      .toEqual([said(REVALIDATE_PHASE1_RUN_PARTS[1][0])])
    for (const [what, anchor] of REVALIDATE_PHASE1_CONDITIONS) {
      expect(collectRevalidatePhase1RunDefects(md, seedOnce(reval, anchor, anchor.replace(/[Uu]nless Phase 1 ran/, 'Always')))).toEqual([`${what} no longer waits for "Phase 1 ran"`])
    }
    expect(collectRevalidatePhase1RunDefects(md, seedOnce(reval, '**Branch safety check**', '**Branch check**'))).toEqual(['no re-validation branch step'])
  })

  it('known-bad probes: a label that step 1 names but Phase 1 does not hold is reported, in either build', () => {
    const reval = revalidateReference()
    const unpunctuated = seedOnce(reval, '**Fresh base.**', '**Fresh base**')
    expect(collectRevalidatePhase1RunDefects(implementMd(), unpunctuated), 'the label without its period')
      .toEqual([`step 1 does not say: ${REVALIDATE_PHASE1_RUN_PARTS[0][0]}`, 'Phase 1 does not hold **Fresh base**, which step 1 names'])
    for (const [label, md] of [['curation on', implementMd()], ['curation off', implementMdOff()]] as const) {
      expect(collectRevalidatePhase1RunDefects(seedOnce(md, '**Fresh base.**', '**Base.**'), reval), `${label}: the Phase 1 label renamed`)
        .toEqual(['Phase 1 does not hold **Fresh base.**, which step 1 names'])
    }
  })
})

/** The Phase 1 steps that step 4 of the reference points at, each by its bold label. */
const REVALIDATE_TARGET_LABELS = ['**Resolve the settings line**', '**Set the compliance directive**', EVIDENCE_POLICY_STEP, PUBLICATION_STEP, STUB_RULE] as const

/**
 * Named collector: how step 4 of the reference names its Phase 1 targets in more than one form. Every target is
 * written "the Phase 1 <label> step", so no pronoun stands for Phase 1 and a reader finds each target by one pattern.
 */
function collectRevalidateTargetFormDefects(revalidate: string): string[] {
  const step = revalidate.split('\n').find(l => l.startsWith('4. **Take GATE_LEVEL**'))
  if (step === undefined) return ['no re-validation settings step']
  return REVALIDATE_TARGET_LABELS.filter(label => !step.includes(`the Phase 1 ${label} step`)).map(label => `the settings step does not name ${label} as "the Phase 1 <label> step"`)
}

describe('#544: step 4 of the re-validation reference names every Phase 1 target in one form', () => {
  it('each of the five Phase 1 targets reads "the Phase 1 <label> step"', () => {
    expect(REVALIDATE_TARGET_LABELS.length, 'the label table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(5)
    expect(collectRevalidateTargetFormDefects(revalidateReference())).toEqual([])
  })

  it('known-bad probes: the step as it was, a target in the "of Phase 1" form and a target behind "its" are each reported', () => {
    const reval = revalidateReference()
    const step = referenceStep(reval, '4. **Take GATE_LEVEL**')
    const defect =(label: string): string => `the settings step does not name ${label} as "the Phase 1 <label> step"`
    expect(collectRevalidateTargetFormDefects(seedOnce(reval, step, PRE_FIX_SETTINGS_STEP)), 'the step as it was')
      .toEqual(REVALIDATE_TARGET_LABELS.map(defect))
    expect(collectRevalidateTargetFormDefects(seedOnce(reval, 'the Phase 1 **Resolve the settings line** step', 'the **Resolve the settings line** step of Phase 1')), 'the "of Phase 1" form')
      .toEqual([defect('**Resolve the settings line**')])
    expect(collectRevalidateTargetFormDefects(seedOnce(reval, `by the Phase 1 ${PUBLICATION_STEP} step`, `by its ${PUBLICATION_STEP} rule`)), 'the "its" form')
      .toEqual([defect(PUBLICATION_STEP)])
    expect(collectRevalidateTargetFormDefects(seedOnce(reval, '4. **Take GATE_LEVEL**', '4. **Take the level**'))).toEqual(['no re-validation settings step'])
  })
})

// ---------------------------------------------------------------------------
// #648 phase B — the compliance-off builds of /implement (AC-13, AC-18, AC-19, AC-26)
// ---------------------------------------------------------------------------
//
// A machine with compliance off installs no step that posts to GitHub or a tracker. /implement keeps its
// local evidence flow instead:
//   AC-18  Under `required`, Phase 1 records the one fixed local DEGRADED line for the Phase 12 report.
//   AC-19  Phase 11 runs `verify-evidence.cjs verify` against the local evidence file and writes the local
//          result file. It passes no publication value, makes no publish call and spawns no Git agent.
//   AC-26  The ticket-link ask and the missing-test-plan ask stay, inline (the off build reads no
//          `implement-evidence-asks` reference). An exception reaches only the local evidence file,
//          through `EVIDENCE_EXCEPTIONS`; the PR body inputs PR_EXCEPTIONS and PR_TEST_PLAN_BLOCK are gone.
//   #669   The re-validation reference points at three Phase 1 steps (the evidence policy, the publication
//          value per worktree, the stub rule). The off build keeps each of the three exactly once.
//
// Both off builds are read: compliance off with curation on, and both off. Every guard has a named
// collector, a non-empty-corpus assertion and a known-bad probe run through the same collector.

type ComplianceOffImplementKey = 'compliance-off' | 'both-off'

/** The compliance-off builds of /implement, by label. */
const COMPLIANCE_OFF_IMPLEMENT_BUILDS: ReadonlyArray<readonly [string, ComplianceOffImplementKey]> = [
  ['compliance off', 'compliance-off'],
  ['curation and compliance off', 'both-off'],
]

function implementMdComplianceOff(key: ComplianceOffImplementKey): string {
  const off = resolveVariantOffSource(key, 'commands', 'implement')
  if (off === null) throw new Error(`the ${key} build of /implement is absent: run \`npm run build:mds\``)
  return off
}

/** The one fixed line a compliance-off build records under `required` (AC-18). */
const OFF_POLICY_LINE = 'TRACEABILITY: DEGRADED (compliance off on this machine; the repository requires evidence)'
/** The off Phase 11 call: the local verify, not the publish. */
const OFF_EVIDENCE_RUN = 'verify-evidence.cjs" verify --pr {PR_NUMBER}'

/** Phase 11's order in an off build: the evidence anchor is the local verify. */
const PHASE11_ORDER_OFF: readonly OrderRule[] = PHASE11_ORDER.map(rule => ({
  ...rule,
  before: rule.before === EVIDENCE_RUN ? OFF_EVIDENCE_RUN : rule.before,
  after: rule.after === EVIDENCE_RUN ? OFF_EVIDENCE_RUN : rule.after,
}))

/**
 * What an off build of /implement names nowhere: the PR-body inputs, the reference reads, the publish call and the publication pass.
 * Each text is one the on build holds, so the absence guard is not vacuous. The Git agent's publication gate document is named by
 * no /implement build, on or off (`collectGateDocumentDefects`), so it has no row here.
 */
const OFF_ABSENT: ReadonlyArray<readonly [string, string]> = [
  ['the PR exceptions input', 'PR_EXCEPTIONS'],
  ['the PR test-plan block input', 'PR_TEST_PLAN_BLOCK'],
  ['the evidence-asks reference', 'implement-evidence-asks'],
  ['the plan artifact input', 'PLAN_ARTIFACT_PATH'],
  ['the publication flag', '--publication'],
  ['the publish call', 'verify-evidence.cjs" publish'],
  ['the update-pr-evidence operation', 'update-pr-evidence'],
  ['the publish timeout', 'timeout: 180000'],
]

/** Named collector: what an off build of /implement still names that a non-posting machine must not. */
function collectOffAbsenceDefects(content: string): string[] {
  return OFF_ABSENT.filter(([, text]) => content.includes(text)).map(([what, text]) => `the off build names ${what}: ${text}`)
}

/** The document of the Git agent's publication gate. Compliance off does not install it, and /implement hands the resolved value to the evidence script in every build. */
const GATE_DOCUMENT = 'publication-gate'

/** Named collector: a /implement build that names the Git agent's publication gate document. */
function collectGateDocumentDefects(content: string): string[] {
  return content.includes(GATE_DOCUMENT) ? [`the build names the Git agent's publication gate document: ${GATE_DOCUMENT}`] : []
}

/**
 * Named collector: what Phase 11 of an off build lacks. One inline `verify` call from the worktree reads the
 * local evidence file and writes the local result file; it passes no publication value, spawns no Git agent
 * and never blocks.
 */
function collectOffEvidenceRunDefects(content: string): string[] {
  const phase = phaseSection(content, PHASE11)
  if (phase === null) return ['no Phase 11 section']
  const runs = parseFences(phase).filter(f => f.includes(OFF_EVIDENCE_RUN))
  if (runs.length !== 1) return [`expected one local verify call in Phase 11, found ${runs.length}`]
  const out: string[] = []
  if (!runs[0].startsWith('```bash\n')) out.push('the call is not a bash fence')
  if (!runs[0].includes('cd "{worktree}" && node "$HOME/.devflow/scripts/verify-evidence.cjs" verify')) out.push('the call does not run from the worktree')
  if (!runs[0].includes('--evidence ".devflow/docs/evidence-{branch_slug}.md"')) out.push('--evidence is not the evidence file')
  if (!runs[0].includes('--comment-out ".devflow/docs/evidence-result-{branch_slug}.md"')) out.push('--comment-out is not the local result file')
  if (/--publication|\bpublish\b/.test(phase)) out.push('Phase 11 names a publication value or a publish call')
  if (parseFences(content).some(f => isAgentBlock(f, 'Git') && f.includes(EVIDENCE_SPAWN))) out.push('a Git agent is spawned for update-pr-evidence')
  if (!phase.includes('under every strategy')) out.push('Phase 11 does not run under every strategy')
  if (!phase.includes('It never blocks')) out.push('Phase 11 may block')
  if (!phase.includes('path does not match `^[A-Za-z0-9._/-]{1,255}$`')) out.push('the evidence path reaches the shell ungated')
  if (!phase.includes('`TRACEABILITY: DEGRADED (evidence unavailable)`')) out.push('a failed run names no DEGRADED reason')
  if (!phase.includes('`EVIDENCE_RESULT`')) out.push('the result is not captured as EVIDENCE_RESULT')
  return out
}

/**
 * Named collector: how an off build of /implement keeps the two asks and the one home of an exception. Both asks
 * stay inline with exactly their two options, the exception grammar is stated once in the build, the record step
 * sets `EVIDENCE_EXCEPTIONS`, and no line that names an exception section names the handoff file or a PR input.
 */
function collectOffAskDefects(content: string): string[] {
  const out: string[] = []
  const need = (what: string, ok: boolean): void => { if (!ok) out.push(what) }
  const ticket = content.slice(content.indexOf(TICKET_ASK), content.indexOf(RECORD))
  need('the ticket-link ask is absent or after the record step', ticket.length > 0 && content.indexOf(TICKET_ASK) !== -1)
  need('the ticket ask is not an AskUserQuestion before any Code spawn', ticket.includes('ask with AskUserQuestion before any Code spawn'))
  need('the ticket ask does not offer the two options', ticket.includes('- **Record an exception** —') && ticket.includes('- **Stop** — report `BLOCKED (no ticket link)`'))
  need('the ticket ask names no project-file remedy', ticket.includes('`.devflow/project.json`'))
  need('the exception grammar is not stated once', countOf(content, '**Exception grammar.**') === 1)
  need('the grammar does not render the section the evidence file holds', content.includes('## Evidence Exceptions\n- `<kind>` self-attested by @<login> at <utc>: <reason>'))
  need('the record step does not set EVIDENCE_EXCEPTIONS', content.includes('**Record the exception at once**, before any Code spawn: set `EVIDENCE_EXCEPTIONS` to the rendered section.'))
  need('EVIDENCE_EXCEPTIONS has no default', content.includes('`EVIDENCE_EXCEPTIONS` is `(none)` until an exception is recorded.'))
  const missing = missingAskBlock(content)
  need('the missing-test-plan ask is absent', missing !== null)
  if (missing !== null) {
    need('the missing ask is not keyed on the required policy', missing.startsWith(MISSING_ASK))
    need('the missing ask does not offer exactly the two options', /- \*\*Record an exception\*\* —[\s\S]*- \*\*Stop\*\* — report `BLOCKED \(no test plan\)`/.test(missing))
    need('the missing ask records kind test-plan', missing.includes('as kind `test-plan`'))
    need('the missing ask writes the evidence file, not the handoff file', missing.includes('`## Evidence Exceptions` section of `EVIDENCE_FILE`') && !missing.includes('handoff-'))
    need('the missing ask does not set EVIDENCE_EXCEPTIONS', missing.includes('set `EVIDENCE_EXCEPTIONS` to that section'))
    need('the missing ask names no project-file remedy', missing.includes('`.devflow/project.json`'))
  }
  // The Handoff Protocol line only forbids a Code agent from rewriting the section the handoff file may hold.
  for (const line of content.split('\n').filter(l => l.includes('Evidence Exceptions') && !l.startsWith('**Handoff Protocol**'))) {
    if (/handoff-|PR_EXCEPTIONS/.test(line)) out.push(`an exception section line names the handoff file or a PR input: ${line.slice(0, 80)}`)
  }
  return out
}

/** Named collector: how the AC-18 line is recorded — once, only under `required`, after the policy resolves and before Phase 2. */
function collectOffPolicyLineDefects(content: string): string[] {
  const out: string[] = []
  if (countOf(content, OFF_POLICY_LINE) !== 1) out.push(`the build holds the fixed line ${countOf(content, OFF_POLICY_LINE)} times, expected 1`)
  if (!content.includes(`When \`EVIDENCE_POLICY\` is \`required\`, record \`${OFF_POLICY_LINE}\``)) {
    out.push('the line is not recorded only under `required`')
  }
  out.push(...collectOrderViolations('implement.md', content, [
    { label: 'the policy resolves before the line is recorded', before: 'resolve-evidence-policy.cjs', after: OFF_POLICY_LINE },
    { label: 'the line is recorded before Phase 2', before: OFF_POLICY_LINE, after: H.p2 },
    { label: 'the report names the line', before: H.p12, after: 'or the compliance-off line of Phase 1' },
  ]))
  return out
}

describe('#648 AC-19: Phase 11 of the compliance-off builds runs the local verify and posts nothing', () => {
  it('both off builds hold the local verify call in order, the Phase 11 push, and none of the posting text', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      const md = implementMdComplianceOff(key)
      expect(md, `${label}: the off build is the on build, so this proves nothing`).not.toBe(implementMd())
      expect(phaseSection(md, PHASE11)?.length ?? 0, `${label}: Phase 11 is empty, so this guard proves nothing`).toBeGreaterThan(1_000)
      expect(collectOrderViolations('implement.md', md, PHASE11_ORDER_OFF), label).toEqual([])
      expect(collectOffEvidenceRunDefects(md), label).toEqual([])
      expect(collectEvidencePushDefects(md), label).toEqual([])
      expect(collectOffAbsenceDefects(md), label).toEqual([])
    }
  })

  it('the on build keeps the publish call, the publication pass and the timeout, so the absence guard is not vacuous', () => {
    const on = implementMd()
    expect(OFF_ABSENT.length, 'the absence table is empty, so this guard proves nothing').toBeGreaterThanOrEqual(8)
    expect(collectOffAbsenceDefects(on)).toEqual(OFF_ABSENT.map(([what, text]) => `the off build names ${what}: ${text}`))
    expect(collectOffEvidenceRunDefects(on)).toEqual(['expected one local verify call in Phase 11, found 0'])
  })

  it('the off Phase 11 names the local result file in the report and says nothing was posted', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      const md = implementMdComplianceOff(key)
      expect(md, label).toContain('Evidence result: .devflow/docs/evidence-result-{branch_slug}.md (local; not posted)')
      expect(phaseSection(md, PHASE11), label).toContain('It writes nothing to GitHub')
    }
  })

  it('known-bad probes: a publication value, a publish call, a Git spawn, a lost flag and a lost run are each reported', () => {
    const md = implementMdComplianceOff('compliance-off')
    expect(collectOffEvidenceRunDefects(seedOnce(md, 'verify --pr {PR_NUMBER} --evidence', 'verify --pr {PR_NUMBER} --publication auto --evidence'))).toEqual(['Phase 11 names a publication value or a publish call'])
    expect(collectOffEvidenceRunDefects(seedOnce(md, 'verify-evidence.cjs" verify --pr {PR_NUMBER}', 'verify-evidence.cjs" publish --pr {PR_NUMBER}'))).toEqual([
      'expected one local verify call in Phase 11, found 0',
    ])
    const back = seedOnce(md, '### Phase 12: Report', '```\nAgent(subagent_type="Git"):\n"OPERATION: update-pr-evidence\nPR_NUMBER: {PR_NUMBER}"\n```\n\n### Phase 12: Report')
    expect(collectOffEvidenceRunDefects(back)).toEqual(['a Git agent is spawned for update-pr-evidence'])
    expect(collectOffAbsenceDefects(back)).toEqual(['the off build names the update-pr-evidence operation: update-pr-evidence'])
    expect(collectOffEvidenceRunDefects(seedOnce(md, ' --comment-out ".devflow/docs/evidence-result-{branch_slug}.md"', ''))).toEqual(['--comment-out is not the local result file'])
    expect(collectOffEvidenceRunDefects(seedOnce(md, 'cd "{worktree}" && node "$HOME/.devflow/scripts/verify-evidence.cjs" verify', 'node "$HOME/.devflow/scripts/verify-evidence.cjs" verify'))).toEqual(['the call does not run from the worktree'])
    expect(collectOffAbsenceDefects(`${md}\nPR_TEST_PLAN_BLOCK: x`)).toEqual(['the off build names the PR test-plan block input: PR_TEST_PLAN_BLOCK'])
    expect(collectOffAbsenceDefects(`${md}\nthrough the Bash tool with \`timeout: 180000\``)).toEqual(['the off build names the publish timeout: timeout: 180000'])
    expect(collectOrderViolations('implement.md', seedOnce(md, '### Phase 12: Report', '### Phase 12 later').replace('### Phase 11: Evidence', '### Phase 12: Report\n\n### Phase 11: Evidence'), PHASE11_ORDER_OFF).length).toBeGreaterThan(0)
  })
})

describe('X1: no /implement build names the Git agent publication gate, because the evidence script decides what each value means', () => {
  it.each(IMPLEMENT_KEYS)('%s: the build names no publication gate document, and a seeded note that names it is reported', key => {
    const md = implementMdOfKey(key)
    expect(collectGateDocumentDefects(md), key).toEqual([])
    expect(md.length, `${key}: nothing read`).toBeGreaterThan(5_000)
    const seeded = `${md}\nthe Git agent's publication gate (\`references/publication-gate.md\` step 2)`
    expect(collectGateDocumentDefects(seeded)).toEqual([`the build names the Git agent's publication gate document: ${GATE_DOCUMENT}`])
  })
})

describe('#648 AC-26: the compliance-off builds keep both asks and record an exception only in the evidence file', () => {
  it('both off builds hold the Phase 1 order, the two inline asks and no PR input', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      const md = implementMdComplianceOff(key)
      expect(md.split(CODE_SPAWN).length - 1, `${label}: no Code spawn read`).toBeGreaterThanOrEqual(5)
      expect(collectOrderViolations('implement.md', md, PHASE1_ORDER), label).toEqual([])
      expect(collectOrderViolations('implement.md', md, GATE_ORDER), label).toEqual([])
      expect(collectCodeSpawnsBefore(md, OUTPUTS), label).toEqual([])
      expect(collectCodeSpawnsBefore(md, RESOLVER), label).toEqual([])
      expect(collectOffAskDefects(md), label).toEqual([])
      expect(md, label).toContain(STANDARD_LINE)
    }
  })

  it('the Test plan step writes EVIDENCE_EXCEPTIONS into the evidence file and the outputs name the evidence file as its one home', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      const md = implementMdComplianceOff(key)
      expect(md, label).toContain('`## Evidence Exceptions`, a byte copy of `EVIDENCE_EXCEPTIONS` present only while that is not `(none)`')
      expect(md, label).toContain('its `## Evidence Exceptions` section now a byte copy of `EVIDENCE_EXCEPTIONS` (absent when that is `(none)`)')
      expect(md, label).not.toContain('handoff-{branch_slug}.md` exception')
    }
  })

  it('the on build keeps the asks in the reference, so the inline arm differs from it', () => {
    const on = implementMd()
    expect(collectOffAskDefects(on).length, 'the on build is read by the off ask collector, which reports its reference reads').toBeGreaterThan(0)
    expect(on).toContain('implement-evidence-asks')
  })

  it('known-bad probes: a dropped option, a handoff home, a lost record step and a PR input are each reported', () => {
    const md = implementMdComplianceOff('compliance-off')
    expect(collectOffAskDefects(md)).toEqual([])
    expect(collectOffAskDefects(seedOnce(md, '- **Stop** — report `BLOCKED (no ticket link)`', '- **Skip** — report `BLOCKED (no ticket link)`'))).toEqual(['the ticket ask does not offer the two options'])
    expect(collectOffAskDefects(seedOnce(md, 'set `EVIDENCE_EXCEPTIONS` to the rendered section.', 'set `PR_EXCEPTIONS` to the rendered section.'))).toEqual(['the record step does not set EVIDENCE_EXCEPTIONS'])
    expect(collectOffAskDefects(seedOnce(md, '`## Evidence Exceptions` section of `EVIDENCE_FILE`', '`## Evidence Exceptions` section of `{worktree}/.devflow/docs/handoff-{branch_slug}.md`')).length).toBeGreaterThan(0)
    expect(collectOffAskDefects(seedOnce(md, '**Missing test plan, only when', '**Missing plan, only when')).length).toBeGreaterThan(0)
    expect(collectOffAskDefects(seedOnce(md, 'ask with AskUserQuestion before any Code spawn — "No tracker issue', 'ask before any Code spawn — "No tracker issue'))).toEqual(['the ticket ask is not an AskUserQuestion before any Code spawn'])
  })
})

describe('#648 AC-18: the compliance-off builds record the fixed local line once, under `required`', () => {
  it('both off builds hold it once, after the policy and before Phase 2, and the report names it', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      expect(collectOffPolicyLineDefects(implementMdComplianceOff(key)), label).toEqual([])
    }
  })

  it('no compliance-on build of /implement holds the line', () => {
    expect(implementMd()).not.toContain(OFF_POLICY_LINE)
    expect(implementMdOff()).not.toContain(OFF_POLICY_LINE)
  })

  it('known-bad probes: a missing line, a doubled line, an unconditional line and a late line are each reported', () => {
    const md = implementMdComplianceOff('compliance-off')
    expect(collectOffPolicyLineDefects(seedOnce(md, `${OFF_POLICY_LINE}\` once`, 'x once'))[0]).toContain('0 times')
    expect(collectOffPolicyLineDefects(`${md}\n${OFF_POLICY_LINE}`)[0]).toContain('2 times')
    expect(collectOffPolicyLineDefects(seedOnce(md, 'When `EVIDENCE_POLICY` is `required`, record `TRACEABILITY: DEGRADED (compliance off', 'Record `TRACEABILITY: DEGRADED (compliance off')).some(d => d.includes('only under `required`'))).toBe(true)
  })
})

describe('#669 and #648: the re-validation pointers stay valid in the compliance-off builds', () => {
  it('each off build holds the three Phase 1 pointer targets once and the re-validation reference points at them', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      const md = implementMdComplianceOff(key)
      expect(phaseSection(md, H.p1)?.length ?? 0, `${label}: Phase 1 is empty, so this guard proves nothing`).toBeGreaterThan(5_000)
      for (const target of PUBLICATION_POINTERS) expect(countOf(phaseSection(md, H.p1) ?? '', target), `${label}: ${target}`).toBe(1)
      expect(collectRevalidatePhase1RunDefects(md, revalidateReference()), label).toEqual([])
      expect(collectRevalidateTargetFormDefects(revalidateReference()), label).toEqual([])
      expect(collectFilesChangedDefects(md), label).toEqual([])
      expect(collectBaseBranchGuardDefects(md), label).toEqual([])
      expect(collectInlineResolverDefects(md), label).toEqual([])
      expect(collectImplementFreshBaseDefects(md), label).toEqual([])
      expect(collectOrchestrationPrincipleDefects(md), label).toEqual([])
    }
  })

  it('the off Phase 1 says Phase 11 passes no publication value, and the on Phase 11 still passes it', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      expect(implementMdComplianceOff(key), label).toContain('Phase 11 passes no publication value: the local verify posts nothing.')
      expect(phaseSection(implementMdComplianceOff(key), H.p11) ?? '', label).not.toContain(PHASE11_PUBLICATION_ARG)
    }
    expect(phaseSection(implementMd(), H.p11)).toContain(PHASE11_PUBLICATION_ARG)
    expect(implementMd()).not.toContain('Phase 11 passes no publication value')
  })

  it('known-bad probes: a renamed or doubled Phase 1 target in an off build is reported', () => {
    for (const [label, key] of COMPLIANCE_OFF_IMPLEMENT_BUILDS) {
      const md = implementMdComplianceOff(key)
      for (const text of PUBLICATION_POINTERS) {
        expect(countOf(phaseSection(seedOnce(md, text, '**Renamed rule**'), H.p1) ?? '', text), `${label}: ${text} renamed`).toBe(0)
        expect(countOf(phaseSection(seedOnce(md, text, `${text} ${text}`), H.p1) ?? '', text), `${label}: ${text} twice`).toBe(2)
      }
    }
  })
})

describe('the compliance-on Phase 1 names the evidence script as the owner of the publication value', () => {
  const OWNER_SENTENCE =
    'Phase 11 passes the resolved value to the evidence script (`publish`), which decides what each value means for the evidence comment.'
  const COMPLIANCE_ON_BUILDS = [['curation on', implementMd], ['curation off', implementMdOff]] as const

  /** Named collector: the owner sentence sits in Phase 1 exactly once, whole, and has no copy in another phase. */
  function collectOwnerSentenceDefects(md: string): string[] {
    const one = phaseSection(md, H.p1)
    if (one === null) return [`${H.p1}: the section is absent`]
    const out: string[] = []
    const inOne = countOf(one, OWNER_SENTENCE)
    if (inOne !== 1) out.push(`Phase 1 holds the owner sentence ${inOne} times, expected 1`)
    const elsewhere = countOf(md, OWNER_SENTENCE) - inOne
    if (elsewhere !== 0) out.push(`the build holds the owner sentence ${elsewhere} times outside Phase 1, expected 0`)
    return out
  }

  it('both compliance-on builds say that the evidence script, not the publication gate, decides what each value means', () => {
    for (const [label, build] of COMPLIANCE_ON_BUILDS) {
      expect(collectOwnerSentenceDefects(build()), label).toEqual([])
    }
  })

  it('known-bad probes: a lost clause, a removed sentence, a doubled sentence, a moved sentence and a copy in another phase are each reported', () => {
    const shortened = OWNER_SENTENCE.replace(', which decides what each value means for the evidence comment', '')
    expect(shortened).not.toBe(OWNER_SENTENCE)
    for (const [label, build] of COMPLIANCE_ON_BUILDS) {
      const md = build()
      expect(collectOwnerSentenceDefects(seedOnce(md, OWNER_SENTENCE, shortened)), `${label}: the clause is lost`).toEqual(['Phase 1 holds the owner sentence 0 times, expected 1'])
      expect(collectOwnerSentenceDefects(seedOnce(md, `${OWNER_SENTENCE} `, '')), `${label}: the sentence is removed`).toEqual(['Phase 1 holds the owner sentence 0 times, expected 1'])
      expect(collectOwnerSentenceDefects(seedOnce(md, OWNER_SENTENCE, `${OWNER_SENTENCE} ${OWNER_SENTENCE}`)), `${label}: the sentence is doubled`).toEqual(['Phase 1 holds the owner sentence 2 times, expected 1'])
      expect(collectOwnerSentenceDefects(`${seedOnce(md, `${OWNER_SENTENCE} `, '')}\n${OWNER_SENTENCE}\n`), `${label}: the sentence is moved out of Phase 1`).toEqual([
        'Phase 1 holds the owner sentence 0 times, expected 1',
        'the build holds the owner sentence 1 times outside Phase 1, expected 0',
      ])
      expect(collectOwnerSentenceDefects(`${md}\n${OWNER_SENTENCE}\n`), `${label}: a copy sits in another phase`).toEqual(['the build holds the owner sentence 1 times outside Phase 1, expected 0'])
      expect(collectOwnerSentenceDefects(seedOnce(md, H.p1, '### Phase 1 gone')), `${label}: no Phase 1 section`).toEqual([`${H.p1}: the section is absent`])
    }
  })
})
