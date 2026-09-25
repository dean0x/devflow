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

import { collectOrderViolations, resolveAgentSource, type OrderRule } from '../helpers.js'
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
