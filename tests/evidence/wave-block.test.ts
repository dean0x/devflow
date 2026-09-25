/**
 * tests/evidence/wave-block.test.ts
 *
 * SDLC-evidence PR6 (#365), phase P1 — the wave block and `verify-evidence.cjs
 * check wave`. The wave block is the wave PR body's `## Related Issues` section
 * plus a closed-vocabulary evidence table:
 *
 *   ## Related Issues
 *   Closes #12
 *   Refs #13
 *
 *   ## Wave Evidence
 *   | T | Ticket | Verdict | Evaluate | Test | Surviving | Coverage |
 *   |---|---|---|---|---|---|---|
 *   | T1 | #12 | PASS | PASS | PASS | 0 | complete |
 *   | T2 | #13 | QUARANTINED | FAIL-FIXED | SKIPPED | 2 | incomplete |
 *
 * Its text reaches a GitHub-visible PR body and every ticket ref, verdict and cell
 * in it is hostile, so the grammar is closed and the cross rules make a wrong
 * closing line unrepresentable.
 *
 *   AC-1   `check wave` enforces every rule — structure, related lines, rows, the
 *          cross rules — so a `Closes` on an unmerged row is refused. Stdout stays
 *          empty, and the exits are 0 admit · 1 usage · 2 file unusable · 5 refused.
 *   AC-16  (in miniature) the documented example exits 0, and 5 once one closing
 *          line moves onto the QUARANTINED row.
 *
 * The parity arms pin the exports to the shipped text that governs them: every
 * line code.md's R7 paste gate admits (each ticket's captured ISSUE_PR_LINK) is a
 * related line, and so is its Closes→Refs swap, and nothing else; the heading is
 * the PR body section code.md emits; the merged verdicts are exactly what the
 * built wave skeleton's merge condition merges; every Gate 2 value the built
 * SINGLE skeleton produces is a table value.
 *
 * NOT covered here (P3 of #365 adds it with the wave-PR step): the table header
 * and the verdict vocabulary against the built dynamic-build.md that renders the
 * block — no shipped text renders it before P3.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe run through the same collector (PF-064).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { parseFences, requireDistFile, resolveAgentSource } from '../helpers.js'
import { scopedEnv } from '../evidence-policy/scripted-shim.js'
import { PR_EVIDENCE_SCRIPT, VERIFY_EVIDENCE_SCRIPT } from './seam.js'

// ---------------------------------------------------------------------------
// The .cjs seams — transcribed from the modules' JSDoc; open those before changing
// ---------------------------------------------------------------------------

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; line: number } }

interface WaveRelated { readonly keyword: 'Closes' | 'Refs'; readonly ref: string; readonly line: number }
interface WaveRow {
  readonly k: number
  readonly ticket: string | null
  readonly verdict: string
  readonly evaluate: string
  readonly test: string
  readonly surviving: number | null
  readonly coverage: string
  readonly line: number
}
interface WaveBlock { readonly related: readonly WaveRelated[]; readonly rows: readonly WaveRow[] }

interface WaveExports {
  readonly LIMITS: Readonly<Record<string, number>>
  readonly WAVE_HEADINGS: readonly string[]
  readonly WAVE_TABLE_HEADER: string
  readonly WAVE_VERDICTS: readonly string[]
  readonly WAVE_MERGED_VERDICTS: readonly string[]
  readonly WAVE_GATE_VALUES: readonly string[]
  readonly RELATED_LINE_RE: RegExp
  readonly WAVE_TICKET_RE: RegExp
  parseWaveBlock(text: unknown): Result<WaveBlock>
}

interface Outcome { readonly code: number; readonly stdout: string }
interface VerifyEvidence {
  main(argv: readonly string[], deps?: { cwd?: string; stderr?: (t: string) => void; exec?: () => never }): Outcome
}

const req = createRequire(import.meta.url)
const PE = req(PR_EVIDENCE_SCRIPT) as WaveExports
const VE = req(VERIFY_EVIDENCE_SCRIPT) as VerifyEvidence

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EM = '—'
const HEADER = '| T | Ticket | Verdict | Evaluate | Test | Surviving | Coverage |'
const SEPARATOR = '|---|---|---|---|---|---|---|'

interface RowSpec {
  readonly ticket: string
  readonly verdict: string
  readonly evaluate?: string
  readonly test?: string
  readonly surviving?: string
  readonly coverage?: string
}

/** One table row, T<k> first; a BLOCKED row defaults to `—` in its last four cells. */
function row(k: number | string, r: RowSpec): string {
  const blocked = r.verdict === 'BLOCKED'
  const cells = [
    typeof k === 'number' ? `T${k}` : k,
    r.ticket,
    r.verdict,
    r.evaluate ?? (blocked ? EM : 'PASS'),
    r.test ?? (blocked ? EM : 'PASS'),
    r.surviving ?? (blocked ? EM : '0'),
    r.coverage ?? (blocked ? EM : 'complete'),
  ]
  return `| ${cells.join(' | ')} |`
}

/** A whole block: heading, related lines, one blank line, heading, header, separator, rows. */
function waveBlock(related: readonly string[], rows: readonly string[], eol = '\n', trailing = eol): string {
  return [
    '## Related Issues',
    ...related,
    '',
    '## Wave Evidence',
    HEADER,
    SEPARATOR,
    ...rows,
  ].join(eol) + trailing
}

/** The §3.1 example, verbatim. */
const EXAMPLE_RELATED = ['Closes #12', 'Closes #14', 'Refs #13'] as const
const EXAMPLE_ROWS = [
  '| T1 | #12 | PASS | PASS | PASS | 0 | complete |',
  '| T2 | #14 | UNVERIFIED | PASS | FAIL-FIXED | 0 | complete |',
  '| T3 | #13 | QUARANTINED | FAIL-FIXED | SKIPPED | 2 | incomplete |',
  `| T4 | #15 | BLOCKED | ${EM} | ${EM} | ${EM} | ${EM} |`,
] as const
const EXAMPLE = waveBlock(EXAMPLE_RELATED, EXAMPLE_ROWS)

/** Line numbers inside EXAMPLE (1-based). */
const L = { related1: 2, related3: 4, blank: 5, heading: 6, header: 7, separator: 8, row1: 9, row3: 11, row4: 12 } as const

/** `n` merged rows T1…Tn, each with its own `Closes #k` line. */
function mergedWave(n: number): string {
  const related = Array.from({ length: n }, (_, i) => `Closes #${i + 1}`)
  const rows = Array.from({ length: n }, (_, i) => row(i + 1, { ticket: `#${i + 1}`, verdict: 'PASS' }))
  return waveBlock(related, rows)
}

function unwrap<T>(r: Result<T>, label = 'result'): T {
  if (!r.ok) throw new Error(`${label}: expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-wave-block-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function writeScratch(name: string, text: string): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'case-'))
  const p = path.join(dir, name)
  fs.writeFileSync(p, text)
  return p
}

/** Run main() in-process; stderr is captured, never printed. */
function runMain(args: readonly string[]): Outcome & { stderr: string } {
  let stderr = ''
  const out = VE.main(['node', 'verify-evidence.cjs', ...args], {
    cwd: tmp,
    stderr: (t: string) => { stderr += t },
    exec: () => { throw new Error('check wave must make no subprocess call') },
  })
  return { ...out, stderr }
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('the wave exports', () => {
  it('carry the closed vocabularies the design names, each frozen', () => {
    expect(PE.WAVE_HEADINGS).toEqual(['## Related Issues', '## Wave Evidence'])
    expect(PE.WAVE_TABLE_HEADER).toBe(HEADER)
    expect(PE.WAVE_VERDICTS).toEqual(['PASS', 'UNVERIFIED', 'QUARANTINED', 'BLOCKED'])
    expect(PE.WAVE_MERGED_VERDICTS).toEqual(['PASS', 'UNVERIFIED'])
    expect(PE.WAVE_GATE_VALUES).toEqual(['PASS', 'FAIL', 'FAIL-FIXED', 'SKIPPED', EM])
    for (const v of [PE.WAVE_HEADINGS, PE.WAVE_VERDICTS, PE.WAVE_MERGED_VERDICTS, PE.WAVE_GATE_VALUES]) {
      expect(Object.isFrozen(v)).toBe(true)
    }
  })

  it('the merged verdicts are wave verdicts, and QUARANTINED and BLOCKED are not among them', () => {
    for (const v of PE.WAVE_MERGED_VERDICTS) expect(PE.WAVE_VERDICTS).toContain(v)
    expect(PE.WAVE_MERGED_VERDICTS).not.toContain('QUARANTINED')
    expect(PE.WAVE_MERGED_VERDICTS).not.toContain('BLOCKED')
  })

  it('pins the two bounds: 16,000 characters and 100 rows', () => {
    expect(PE.LIMITS.WAVE_BLOCK_CHARS).toBe(16000)
    expect(PE.LIMITS.WAVE_ROWS).toBe(100)
  })

  it('both RegExps are frozen and non-global (no shared lastIndex state)', () => {
    for (const re of [PE.RELATED_LINE_RE, PE.WAVE_TICKET_RE]) {
      expect(Object.isFrozen(re), re.source).toBe(true)
      expect(re.global || re.sticky, re.source).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// RELATED_LINE_RE and WAVE_TICKET_RE
// ---------------------------------------------------------------------------

describe('RELATED_LINE_RE — `Closes` only for #N, `Refs` for #N or a keyed ref', () => {
  const ACCEPT = [
    'Closes #1', 'Closes #999999999', 'Refs #13', 'Refs A-1', 'Refs ABC-123', 'Refs A_B-1', 'Refs A1-1',
    'Refs ABCDEFGHIJ-999999999',
  ]
  const REJECT = [
    'Closes ABC-1',            // a closing keyed ref: Jira and Linear render Refs
    'Closes A-1',
    'Closes #0', 'Closes #01', 'Closes #1234567890', 'Refs #0', 'Refs A-0', 'Refs A-01', 'Refs A-1234567890',
    'closes #1', 'CLOSES #1', 'Fixes #1', 'Resolves #1', 'Closed #1', 'Ref #1', 'Refs: #1',
    'Closes  #1', 'Closes #1 ', ' Closes #1', 'Closes #1\r', 'Closes\t#1',
    'Refs abc-1', 'Refs _A-1', 'Refs 1A-1', 'Refs ABCDEFGHIJK-1', 'Refs A--1', 'Refs A',
    'Refs #1, #2', 'Closes #1 #2', 'Refs o/r#1', 'Refs https://github.com/o/r/issues/1', 'Closes GH-1',
    'Refs A-1<!-- x -->', 'Refs `A-1`', 'Refs $(id)-1', 'Closes #1@user', '',
  ]

  it('accepts every documented shape', () => {
    for (const line of ACCEPT) expect(PE.RELATED_LINE_RE.test(line), line).toBe(true)
  })

  it('refuses every near-miss, keyword and hostile variant', () => {
    for (const line of REJECT) expect(PE.RELATED_LINE_RE.test(line), JSON.stringify(line)).toBe(false)
  })
})

describe('WAVE_TICKET_RE — a ref of the related-line shapes, or `(none)`', () => {
  it('accepts the ref shapes and (none)', () => {
    for (const t of ['#1', '#999999999', 'A-1', 'ABC-12', 'A_B-1', 'ABCDEFGHIJ-999999999', '(none)']) {
      expect(PE.WAVE_TICKET_RE.test(t), t).toBe(true)
    }
  })

  it('refuses everything else', () => {
    for (const t of ['#0', '#01', '12', 'abc-1', 'ABCDEFGHIJK-1', '(None)', 'none', '', '—', '#1 ', 'o/r#1', '@user', '<b>', '`#1`']) {
      expect(PE.WAVE_TICKET_RE.test(t), JSON.stringify(t)).toBe(false)
    }
  })

  it('a ticket is exactly the ref of a related line: the two grammars share their ref shapes', () => {
    const refs = ['#1', '#42', 'A-1', 'ABC-12', 'A_B-7', 'ABCDEFGHIJ-999999999', '#0', 'abc-1', 'ABCDEFGHIJK-1']
    for (const ref of refs) {
      expect(PE.WAVE_TICKET_RE.test(ref), ref).toBe(PE.RELATED_LINE_RE.test(`Refs ${ref}`))
    }
  })
})

// ---------------------------------------------------------------------------
// parseWaveBlock — every §3.1 rule
// ---------------------------------------------------------------------------

interface RuleCase {
  readonly label: string
  readonly text: string
  /** null ⇒ admitted. */
  readonly code: string | null
  readonly line?: number
}

const tooLong = (): string => {
  // Valid in every way but size: pad the related section is impossible (no free
  // text), so pad with trailing blank lines past the character bound.
  const base = EXAMPLE
  return base + '\n'.repeat(16001 - base.length)
}

const RULES: readonly RuleCase[] = [
  // --- admitted --------------------------------------------------------------
  { label: 'the documented example', text: EXAMPLE, code: null },
  { label: 'the documented example with CRLF line endings', text: waveBlock(EXAMPLE_RELATED, EXAMPLE_ROWS, '\r\n'), code: null },
  { label: 'trailing blank lines', text: `${EXAMPLE}\n\n\n`, code: null },
  { label: 'no trailing newline', text: waveBlock(EXAMPLE_RELATED, EXAMPLE_ROWS, '\n', ''), code: null },
  { label: 'no related lines (every row blocked)', text: waveBlock([], [row(1, { ticket: '#1', verdict: 'BLOCKED' })]), code: null },
  { label: 'a merged row with no ticket needs no line', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'PASS' })]), code: null },
  { label: 'a merged Jira/Linear row carries its Refs line', text: waveBlock(['Refs ABC-7'], [row(1, { ticket: 'ABC-7', verdict: 'UNVERIFIED', test: 'FAIL-FIXED' })]), code: null },
  { label: 'a merged GitHub row may carry Refs instead of Closes', text: waveBlock(['Refs #7'], [row(1, { ticket: '#7', verdict: 'PASS' })]), code: null },
  { label: 'a quarantined row with no line', text: waveBlock(['Closes #1'], [row(1, { ticket: '#1', verdict: 'PASS' }), row(2, { ticket: '#2', verdict: 'QUARANTINED' })]), code: null },
  { label: 'a blocked row with a Refs line', text: waveBlock(['Refs #2'], [row(1, { ticket: '#2', verdict: 'BLOCKED' })]), code: null },
  { label: 'related lines in any order', text: waveBlock(['Refs #13', 'Closes #14', 'Closes #12'], EXAMPLE_ROWS), code: null },
  { label: 'a quarantined row with every cell dashed (stopped before implementing)', text: waveBlock([], [row(1, { ticket: 'ABC-1', verdict: 'QUARANTINED', evaluate: EM, test: EM, surviving: EM, coverage: EM })]), code: null },
  { label: 'two (none) tickets', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'PASS' }), row(2, { ticket: '(none)', verdict: 'QUARANTINED' })]), code: null },
  { label: '100 rows and 100 related lines', text: mergedWave(100), code: null },
  { label: 'surviving at its three-digit bound', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', surviving: '999' })]), code: null },

  // --- the cross rules: a wrong closing line is unrepresentable ---------------
  { label: 'Closes on a QUARANTINED row', text: waveBlock(['Closes #12', 'Closes #14', 'Closes #13'], EXAMPLE_ROWS), code: 'unmerged', line: L.related3 },
  { label: 'Closes on a BLOCKED row', text: waveBlock([...EXAMPLE_RELATED, 'Closes #15'], EXAMPLE_ROWS), code: 'unmerged', line: 5 },
  { label: 'a merged row with no related line', text: waveBlock(['Closes #14', 'Refs #13'], EXAMPLE_ROWS), code: 'unlinked', line: 8 },
  { label: 'an UNVERIFIED row with no related line', text: waveBlock(['Closes #12', 'Refs #13'], EXAMPLE_ROWS), code: 'unlinked', line: 9 },
  { label: 'a related ref naming no row', text: waveBlock([...EXAMPLE_RELATED, 'Refs #99'], EXAMPLE_ROWS), code: 'orphan', line: 5 },
  { label: 'a related ref naming a (none) row', text: waveBlock(['Refs #1'], [row(1, { ticket: '(none)', verdict: 'QUARANTINED' })]), code: 'orphan', line: 2 },
  { label: 'a repeated related ref', text: waveBlock(['Closes #12', 'Closes #12', 'Closes #14', 'Refs #13'], EXAMPLE_ROWS), code: 'duplicate', line: 3 },
  { label: 'the same ref under both keywords', text: waveBlock(['Refs #12', ...EXAMPLE_RELATED], EXAMPLE_ROWS), code: 'duplicate', line: 3 },
  { label: 'a ticket in two rows', text: waveBlock(['Closes #1'], [row(1, { ticket: '#1', verdict: 'PASS' }), row(2, { ticket: '#1', verdict: 'QUARANTINED' })]), code: 'duplicate', line: 8 },

  // --- related lines ------------------------------------------------------------
  { label: 'a closing keyed ref', text: waveBlock(['Closes ABC-1'], [row(1, { ticket: 'ABC-1', verdict: 'PASS' })]), code: 'malformed', line: 2 },
  { label: 'a Fixes keyword', text: waveBlock(['Fixes #1'], [row(1, { ticket: '#1', verdict: 'PASS' })]), code: 'malformed', line: 2 },
  { label: 'free text among the related lines', text: waveBlock(['Closes #12', 'please merge', 'Closes #14', 'Refs #13'], EXAMPLE_ROWS), code: 'malformed', line: 3 },
  { label: 'an HTML comment among the related lines', text: waveBlock(['<!-- wave -->', ...EXAMPLE_RELATED], EXAMPLE_ROWS), code: 'malformed', line: 2 },
  { label: '101 related lines', text: waveBlock(Array.from({ length: 101 }, (_, i) => `Refs #${i + 1}`), [row(1, { ticket: '#1', verdict: 'QUARANTINED' })]), code: 'oversize', line: 102 },

  // --- structure ----------------------------------------------------------------
  { label: 'a wrong first heading', text: EXAMPLE.replace('## Related Issues', '## Related issues'), code: 'malformed', line: 1 },
  { label: 'a leading blank line', text: `\n${EXAMPLE}`, code: 'malformed', line: 1 },
  { label: 'text before the first heading', text: `Wave PR\n${EXAMPLE}`, code: 'malformed', line: 1 },
  { label: 'no blank line between the sections', text: EXAMPLE.replace('Refs #13\n\n', 'Refs #13\n'), code: 'malformed', line: 5 },
  { label: 'two blank lines between the sections', text: EXAMPLE.replace('Refs #13\n\n', 'Refs #13\n\n\n'), code: 'malformed', line: 6 },
  { label: 'a wrong second heading', text: EXAMPLE.replace('## Wave Evidence', '## Evidence'), code: 'malformed', line: L.heading },
  { label: 'a blank line under the second heading', text: EXAMPLE.replace('## Wave Evidence\n', '## Wave Evidence\n\n'), code: 'malformed', line: L.header },
  { label: 'a header with a column renamed', text: EXAMPLE.replace(HEADER, HEADER.replace('Surviving', 'Findings')), code: 'malformed', line: L.header },
  { label: 'a header with a trailing space', text: EXAMPLE.replace(HEADER, `${HEADER} `), code: 'malformed', line: L.header },
  { label: 'an aligned separator', text: EXAMPLE.replace(SEPARATOR, '|:--|---|---|---|---|---|---|'), code: 'malformed', line: L.separator },
  { label: 'no separator', text: EXAMPLE.replace(`${SEPARATOR}\n`, ''), code: 'malformed', line: L.separator },
  { label: 'a third heading', text: `${EXAMPLE}## Notes\n`, code: 'malformed', line: 13 },
  { label: 'text after the table', text: `${EXAMPLE}Thanks!\n`, code: 'malformed', line: 13 },
  { label: 'a blank line inside the table', text: EXAMPLE.replace(`${EXAMPLE_ROWS[1]}\n`, `${EXAMPLE_ROWS[1]}\n\n`), code: 'malformed', line: 11 },
  { label: 'a lone CR inside a line', text: EXAMPLE.replace('| T1 | #12 |', '| T1 |\r #12 |'), code: 'malformed', line: L.row1 },
  { label: 'no evidence section at all', text: '## Related Issues\nCloses #1\n', code: 'malformed', line: 4 },
  { label: 'no rows', text: waveBlock([], []), code: 'empty' },
  { label: 'the empty string', text: '', code: 'malformed', line: 1 },

  // --- rows -----------------------------------------------------------------------
  { label: 'an unknown verdict', text: waveBlock(['Closes #1'], [row(1, { ticket: '#1', verdict: 'MERGED' })]), code: 'malformed', line: 7 },
  { label: 'a lowercase verdict', text: waveBlock(['Closes #1'], [row(1, { ticket: '#1', verdict: 'pass' })]), code: 'malformed', line: 7 },
  { label: 'an unknown gate value', text: waveBlock(['Closes #1'], [row(1, { ticket: '#1', verdict: 'PASS', test: 'RETRIED' })]), code: 'malformed', line: 7 },
  { label: 'an unknown coverage value', text: waveBlock(['Closes #1'], [row(1, { ticket: '#1', verdict: 'PASS', coverage: 'partial' })]), code: 'malformed', line: 7 },
  { label: 'a four-digit surviving count', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', surviving: '1000' })]), code: 'malformed', line: 6 },
  { label: 'a negative surviving count', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', surviving: '-1' })]), code: 'malformed', line: 6 },
  { label: 'a BLOCKED row with a gate value', text: waveBlock([], [row(1, { ticket: '#1', verdict: 'BLOCKED', evaluate: 'PASS' })]), code: 'malformed', line: 6 },
  { label: 'a BLOCKED row with a surviving count', text: waveBlock([], [row(1, { ticket: '#1', verdict: 'BLOCKED', surviving: '0' })]), code: 'malformed', line: 6 },
  { label: 'a BLOCKED row with coverage', text: waveBlock([], [row(1, { ticket: '#1', verdict: 'BLOCKED', coverage: 'complete' })]), code: 'malformed', line: 6 },
  { label: 'a row that starts at T2', text: waveBlock([], [row(2, { ticket: '(none)', verdict: 'BLOCKED' })]), code: 'order', line: 6 },
  { label: 'a skipped row number', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'BLOCKED' }), row(3, { ticket: '(none)', verdict: 'BLOCKED' })]), code: 'order', line: 7 },
  { label: 'a repeated row number', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'BLOCKED' }), row(1, { ticket: '(none)', verdict: 'BLOCKED' })]), code: 'order', line: 7 },
  { label: 'a row numbered T0', text: waveBlock([], [row('T0', { ticket: '(none)', verdict: 'BLOCKED' })]), code: 'malformed', line: 6 },
  { label: 'a row numbered T01', text: waveBlock([], [row('T01', { ticket: '(none)', verdict: 'BLOCKED' })]), code: 'malformed', line: 6 },
  { label: 'an unknown ticket shape', text: waveBlock([], [row(1, { ticket: 'issue-1', verdict: 'QUARANTINED' })]), code: 'malformed', line: 6 },
  { label: 'a row with an extra column', text: waveBlock([], [`${row(1, { ticket: '(none)', verdict: 'BLOCKED' })} x |`]), code: 'malformed', line: 6 },
  { label: 'a row with a missing column', text: waveBlock([], [`| T1 | (none) | BLOCKED | ${EM} | ${EM} | ${EM} |`]), code: 'malformed', line: 6 },
  { label: 'a row without its outer pipes', text: waveBlock([], [`T1 | (none) | BLOCKED | ${EM} | ${EM} | ${EM} | ${EM}`]), code: 'malformed', line: 6 },
  { label: 'a row with double spaces', text: waveBlock([], [`|  T1 | (none) | BLOCKED | ${EM} | ${EM} | ${EM} | ${EM} |`]), code: 'malformed', line: 6 },
  { label: '101 rows', text: waveBlock([], Array.from({ length: 101 }, (_, i) => row(i + 1, { ticket: '(none)', verdict: 'BLOCKED' }))), code: 'oversize', line: 106 },
  { label: 'over 16,000 characters', text: tooLong(), code: 'oversize' },

  // --- hostile cells ------------------------------------------------------------
  { label: 'a backtick in a ticket cell', text: waveBlock([], [row(1, { ticket: '`#1`', verdict: 'QUARANTINED' })]), code: 'malformed', line: 6 },
  { label: 'a command substitution in a cell', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', coverage: '$(id)' })]), code: 'malformed', line: 6 },
  { label: 'an HTML comment in a cell', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', evaluate: '<!-- x -->' })]), code: 'malformed', line: 6 },
  { label: 'a mention in a cell', text: waveBlock([], [row(1, { ticket: '@octocat', verdict: 'QUARANTINED' })]), code: 'malformed', line: 6 },
  { label: 'a closing keyword smuggled into a cell', text: waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', test: 'Closes #9' })]), code: 'malformed', line: 6 },
  { label: 'an escaped pipe forging a cell', text: waveBlock([], [row(1, { ticket: '#1 \\| x', verdict: 'QUARANTINED' })]), code: 'malformed', line: 6 },
  { label: 'a bidi override in a cell', text: waveBlock([], [row(1, { ticket: '(none)\u202e', verdict: 'QUARANTINED' })]), code: 'malformed', line: 6 },
]

/** Named collector: the rule rows parseWaveBlock decides differently from the table. */
function collectRuleViolations(parse: (text: unknown) => Result<WaveBlock>, rules: readonly RuleCase[]): string[] {
  return rules.flatMap(c => {
    const r = parse(c.text)
    if (c.code === null) return r.ok ? [] : [`${c.label}: expected admit, got ${r.error.code} at line ${r.error.line}`]
    if (r.ok) return [`${c.label}: expected ${c.code}, got admitted`]
    const want = `${c.code}${c.line === undefined ? '' : ` at line ${c.line}`}`
    const got = `${r.error.code}${c.line === undefined ? '' : ` at line ${r.error.line}`}`
    return want === got ? [] : [`${c.label}: expected ${want}, got ${got}`]
  })
}

describe('parseWaveBlock — every rule of the wave grammar', () => {
  it('the table exercises every admit and refusal code', () => {
    expect(RULES.filter(c => c.code === null).length, 'too few admitted rows').toBeGreaterThanOrEqual(12)
    expect(new Set(RULES.map(c => c.code))).toEqual(new Set([
      null, 'unmerged', 'unlinked', 'orphan', 'duplicate', 'malformed', 'oversize', 'order', 'empty',
    ]))
  })

  it('decides every row of the table', () => {
    expect(collectRuleViolations(PE.parseWaveBlock, RULES)).toEqual([])
  })

  it('known-bad probe: a grammar that admits everything is reported on every refusal row', () => {
    const lenient = (): Result<WaveBlock> => ({ ok: true, value: { related: [], rows: [] } })
    const refusals = RULES.filter(c => c.code !== null)
    expect(collectRuleViolations(lenient, RULES)).toHaveLength(refusals.length)
  })

  it('a non-string input is invalid, never admitted', () => {
    for (const v of [undefined, null, 42, ['## Related Issues'], { text: EXAMPLE }]) {
      const r = PE.parseWaveBlock(v)
      expect(r.ok ? 'ok' : r.error.code).toBe('invalid')
    }
  })

  it('parses the example into its related lines and rows, frozen', () => {
    const block = unwrap(PE.parseWaveBlock(EXAMPLE))
    expect(Object.isFrozen(block)).toBe(true)
    expect(block.related.map(r => `${r.keyword} ${r.ref} @${r.line}`)).toEqual(['Closes #12 @2', 'Closes #14 @3', 'Refs #13 @4'])
    expect(block.rows.map(r => [r.k, r.ticket, r.verdict, r.evaluate, r.test, r.surviving, r.coverage, r.line])).toEqual([
      [1, '#12', 'PASS', 'PASS', 'PASS', 0, 'complete', L.row1],
      [2, '#14', 'UNVERIFIED', 'PASS', 'FAIL-FIXED', 0, 'complete', 10],
      [3, '#13', 'QUARANTINED', 'FAIL-FIXED', 'SKIPPED', 2, 'incomplete', L.row3],
      [4, '#15', 'BLOCKED', EM, EM, null, EM, L.row4],
    ])
    for (const r of [...block.related, ...block.rows]) expect(Object.isFrozen(r)).toBe(true)
  })

  it('a (none) ticket parses to null', () => {
    const block = unwrap(PE.parseWaveBlock(waveBlock([], [row(1, { ticket: '(none)', verdict: 'PASS' })])))
    expect(block.rows[0].ticket).toBeNull()
  })

  it('every value of each closed vocabulary is admitted in its column, and nothing outside it', () => {
    for (const verdict of PE.WAVE_VERDICTS) {
      const r = row(1, { ticket: '(none)', verdict })
      expect(PE.parseWaveBlock(waveBlock([], [r])).ok, verdict).toBe(true)
    }
    for (const g of PE.WAVE_GATE_VALUES) {
      const r = row(1, { ticket: '(none)', verdict: 'QUARANTINED', evaluate: g, test: g })
      expect(PE.parseWaveBlock(waveBlock([], [r])).ok, g).toBe(true)
    }
    for (const outside of ['PASSED', 'ESCALATED', 'PARTIAL', 'FAIL ', '-', '']) {
      expect(PE.parseWaveBlock(waveBlock([], [row(1, { ticket: '(none)', verdict: outside })])).ok, outside).toBe(false)
      expect(PE.parseWaveBlock(waveBlock([], [row(1, { ticket: '(none)', verdict: 'QUARANTINED', test: outside })])).ok, outside).toBe(false)
    }
  })

  it('a refusal carries a code and a line number, never a byte of the input', () => {
    const sentinel = 'SENTINEL-WAVE-CELL'
    const r = PE.parseWaveBlock(waveBlock([], [row(1, { ticket: '(none)', verdict: sentinel })]))
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(sentinel)
  })
})

// ---------------------------------------------------------------------------
// AC-16 in miniature — the documented example, and one Closes moved
// ---------------------------------------------------------------------------

describe('AC-16: a closing line on an unmerged row cannot pass', () => {
  it('the documented example is admitted; the same block with `Refs #13` → `Closes #13` is refused `unmerged`', () => {
    expect(PE.parseWaveBlock(EXAMPLE).ok).toBe(true)
    const moved = EXAMPLE.replace('Refs #13', 'Closes #13')
    expect(moved, 'the seed must land').not.toBe(EXAMPLE)
    const r = PE.parseWaveBlock(moved)
    expect(r.ok ? 'ok' : `${r.error.code}@${r.error.line}`).toBe(`unmerged@${L.related3}`)
  })

  it('every unmerged row refuses a Closes line, whatever its cells say', () => {
    for (const verdict of PE.WAVE_VERDICTS.filter(v => !PE.WAVE_MERGED_VERDICTS.includes(v))) {
      for (const cells of [{}, { evaluate: 'PASS', test: 'PASS', surviving: '0', coverage: 'complete' }]) {
        if (verdict === 'BLOCKED' && Object.keys(cells).length > 0) continue
        const text = waveBlock(['Closes #7'], [row(1, { ticket: '#7', verdict, ...cells })])
        const r = PE.parseWaveBlock(text)
        expect(r.ok ? 'ok' : r.error.code, `${verdict} ${JSON.stringify(cells)}`).toBe('unmerged')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// check wave <file> — the CLI
// ---------------------------------------------------------------------------

describe('check wave <file> — stdout empty, exits 0 · 1 · 2 · 5', () => {
  it('admits the documented example: exit 0, nothing on stdout or stderr', () => {
    const r = runMain(['check', 'wave', writeScratch('wave.md', EXAMPLE)])
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  it('reads the whole file: a wave block is not an evidence-file section', () => {
    // check tp would fall back to the whole text on an unknown heading; check wave
    // never looks for sections at all, so an evidence file is simply malformed.
    const evidence = '## Test Plan\n- [ ] TP-1 (AC-1) x — method:ci\n\n## Claims\n'
    expect(runMain(['check', 'wave', writeScratch('evidence.md', evidence)]).code).toBe(5)
  })

  for (const c of RULES.filter(x => x.code !== null)) {
    it(`refuses ${c.label}: exit 5, stdout empty, a closed diagnostic`, () => {
      const r = runMain(['check', 'wave', writeScratch('wave.md', c.text)])
      expect(r.code).toBe(5)
      expect(r.stdout).toBe('')
      const at = c.line === undefined ? '' : ` at line ${c.line}`
      expect(r.stderr).toBe(`verify-evidence: check wave: ${c.code}${at}\n`)
    })
  }

  it('the diagnostic never echoes a byte of the input', () => {
    const sentinel = 'SENTINEL-WAVE-TEXT'
    const r = runMain(['check', 'wave', writeScratch('wave.md', EXAMPLE.replace('Refs #13', `Refs #13 ${sentinel}`))])
    expect(r.code).toBe(5)
    expect(r.stderr).not.toContain(sentinel)
  })

  it('an unreadable file is input-unusable (exit 2), never "valid"', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'missing-'))
    for (const target of [path.join(dir, 'absent.md'), dir]) {
      const r = runMain(['check', 'wave', target])
      expect(r.code).toBe(2)
      expect(r.stdout).toBe('')
    }
  })

  it('a file that is not UTF-8 is input-unusable (exit 2)', () => {
    const file = writeScratch('latin1.md', '')
    fs.writeFileSync(file, Buffer.from([0x23, 0x23, 0x20, 0xff, 0xfe, 0x0a]))
    expect(runMain(['check', 'wave', file]).code).toBe(2)
  })

  for (const [label, args] of [
    ['no file', ['check', 'wave']],
    ['two files', ['check', 'wave', 'a', 'b']],
    ['a flag for a file', ['check', 'wave', '--x']],
    ['an empty file argument', ['check', 'wave', '']],
  ] as const) {
    it(`usage: ${label} → exit 1, stdout empty, the usage names check wave`, () => {
      const r = runMain(args)
      expect(r.code).toBe(1)
      expect(r.stdout).toBe('')
      expect(r.stderr).toMatch(/check tp\|block\|exceptions\|wave <file>/)
    })
  }
})

describe('check wave through the real process (applies PF-060: tmp HOME, non-repo cwd)', { timeout: 30_000 }, () => {
  function runReal(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
    const home = fs.mkdtempSync(path.join(tmp, 'home-'))
    const r = spawnSync(process.execPath, [VERIFY_EVIDENCE_SCRIPT, ...args], {
      cwd: home,
      env: scopedEnv(home),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    })
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  it('exit 0, 5, 2 and 1 — each with not one byte on stdout', () => {
    const good = writeScratch('wave.md', EXAMPLE)
    const moved = writeScratch('wave.md', EXAMPLE.replace('Refs #13', 'Closes #13'))
    const cases: ReadonlyArray<readonly [readonly string[], number]> = [
      [['check', 'wave', good], 0],
      [['check', 'wave', moved], 5],
      [['check', 'wave', path.join(tmp, 'no-such-file.md')], 2],
      [['check', 'wave'], 1],
    ]
    for (const [args, status] of cases) {
      const r = runReal(args)
      expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(status)
      expect(r.stdout, args.join(' ')).toBe('')
    }
    expect(runReal(['check', 'wave', moved]).stderr).toBe(`verify-evidence: check wave: unmerged at line ${L.related3}\n`)
  })
})

// ---------------------------------------------------------------------------
// Parity — the exports against the shipped text that governs them
// ---------------------------------------------------------------------------

/** code.md's R7 paste gate: provider → the whole-line pattern `ISSUE_PR_LINK` must match. */
function collectR7Grammars(code: string): Map<string, RegExp> {
  const out = new Map<string, RegExp>()
  const at = code.indexOf('**Pasting the handoff values.**')
  if (at === -1) return out
  const end = code.indexOf('**Pasting `PR_EXCEPTIONS`.**', at)
  for (const line of code.slice(at, end === -1 ? undefined : end).split('\n')) {
    const m = /^\s*\| `([a-z]+)` \| `(\^[^`]+\$)` \|$/.exec(line)
    if (m !== null) out.set(m[1], new RegExp(m[2]))
  }
  return out
}

/** A corpus of related-line candidates: every keyword over every ref shape and near-miss. */
function relatedCorpus(): string[] {
  const numbers = ['1', '9', '42', '999999999', '0', '01', '1234567890']
  const keys = ['A', 'AB', 'A_B', 'A1', 'AB_', 'ABCDEFGHIJ', 'ABCDEFGHIJK', 'a', '_A', '1A', 'A-B']
  const refs = [...numbers.map(n => `#${n}`), ...keys.flatMap(k => numbers.map(n => `${k}-${n}`))]
  const lines = ['Closes', 'Refs', 'Fixes', 'closes'].flatMap(kw => refs.map(r => `${kw} ${r}`))
  return [...lines, 'Closes  #1', 'Refs #1 ', 'Refs', '']
}

/**
 * Named collector: the corpus lines on which a related-line grammar disagrees with
 * code.md's R7 gate. A line must be admitted exactly when R7 admits it (a merged
 * ticket's captured ISSUE_PR_LINK) or when R7 admits its Refs→Closes swap (an
 * unmerged GitHub ticket's line with `Closes ` replaced by `Refs `).
 */
function collectRelatedLineDisagreements(candidate: RegExp, gates: ReadonlyMap<string, RegExp>, corpus: readonly string[]): string[] {
  const admittedByR7 = (l: string): boolean => [...gates.values()].some(re => re.test(l))
  return corpus.flatMap(line => {
    const want = admittedByR7(line) || (line.startsWith('Refs ') && admittedByR7(`Closes ${line.slice('Refs '.length)}`))
    return candidate.test(line) === want ? [] : [`${JSON.stringify(line)}: grammar ${want ? 'refuses' : 'admits'} it`]
  })
}

describe('parity: RELATED_LINE_RE admits exactly code.md\'s R7 lines and their Closes→Refs swap', () => {
  const code = resolveAgentSource('code').content
  const gates = collectR7Grammars(code)

  it('R7\'s three tracker grammars are found', () => {
    expect([...gates.keys()].sort()).toEqual(['github', 'jira', 'linear'])
  })

  it('the corpus is non-trivial on both sides', () => {
    const corpus = relatedCorpus()
    const admitted = corpus.filter(l => PE.RELATED_LINE_RE.test(l))
    expect(admitted.length, 'too few admitted lines').toBeGreaterThanOrEqual(30)
    expect(corpus.length - admitted.length, 'too few refused lines').toBeGreaterThanOrEqual(100)
  })

  it('no line of the corpus is decided differently', () => {
    expect(collectRelatedLineDisagreements(PE.RELATED_LINE_RE, gates, relatedCorpus())).toEqual([])
  })

  it('known-bad probe: a grammar that lets Closes take a keyed ref is reported', () => {
    const widened = /^(?:Closes (?:#[1-9][0-9]{0,8}|[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,8})|Refs (?:#[1-9][0-9]{0,8}|[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,8}))$/
    const d = collectRelatedLineDisagreements(widened, gates, relatedCorpus())
    expect(d.length).toBeGreaterThan(0)
    expect(d.every(x => x.startsWith('"Closes ') && x.endsWith('grammar admits it'))).toBe(true)
  })

  it('known-bad probe: a grammar without the GitHub swap (no `Refs #N`) is reported', () => {
    const noSwap = /^(?:Closes #[1-9][0-9]{0,8}|Refs [A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,8})$/
    const d = collectRelatedLineDisagreements(noSwap, gates, relatedCorpus())
    expect(d).toContain('"Refs #42": grammar refuses it')
  })

  it('known-bad probe: R7 losing its Linear row is reported (the collector reads the gate, not a copy)', () => {
    const narrowed = new Map([...gates].filter(([k]) => k !== 'linear'))
    expect(collectRelatedLineDisagreements(PE.RELATED_LINE_RE, narrowed, relatedCorpus())).toContain('"Refs A-1": grammar admits it')
  })

  it('the first heading is the PR body section R7 fills', () => {
    expect(code).toContain(`include a \`${PE.WAVE_HEADINGS[0]}\` section in the PR body`)
  })
})

// --- the built dynamic-build.md ------------------------------------------------

const BUILT = requireDistFile('dynamic-build.md')
const WAVE_ENGINE_CALL = 'const engineResult = await runSingleTicketEngine('

/**
 * Every engine verdict the wave can see: the SINGLE skeleton's overallVerdict
 * values and the engine schema's. (P3 of #365 declares the union in the schema.)
 */
const ENGINE_VERDICTS = ['PASS', 'UNVERIFIED', 'PARTIAL', 'FAIL', 'ESCALATED'] as const

/** The built wave skeleton's merge condition — the first `if (…) {` after the engine call — or null. */
function waveMergeCondition(built: string): string | null {
  const fences = parseFences(built).filter(f => f.includes(WAVE_ENGINE_CALL))
  if (fences.length !== 1) return null
  const lines = fences[0].split('\n')
  const at = lines.findIndex(l => l.includes(WAVE_ENGINE_CALL))
  const test = lines.slice(at + 1).find(l => /^\s*if \(/.test(l))
  return test?.match(/^\s*if \((.*)\) \{\s*$/)?.[1] ?? null
}

/** Named collector: where the verdicts a merge condition merges differ from WAVE_MERGED_VERDICTS. */
function collectMergedVerdictDrift(condition: string | null): string[] {
  if (condition === null) return ['the wave merge condition was not found']
  const decide = new Function('engineResult', `return (${condition});`) as (engineResult: unknown) => unknown
  return ENGINE_VERDICTS.flatMap(v => {
    const merges = Boolean(decide({ verdict: v }))
    const want = PE.WAVE_MERGED_VERDICTS.includes(v)
    return merges === want ? [] : [`${v}: the built condition ${merges ? 'merges' : 'quarantines'} it, WAVE_MERGED_VERDICTS ${want ? 'lists' : 'omits'} it`]
  })
}

describe('parity: WAVE_MERGED_VERDICTS are exactly what the built wave skeleton merges', () => {
  it('the merge condition is found and merges exactly the merged verdicts', () => {
    const condition = waveMergeCondition(BUILT)
    expect(condition, 'exactly one wave skeleton with a merge condition').not.toBeNull()
    expect(collectMergedVerdictDrift(condition)).toEqual([])
  })

  it('known-bad probe: a PASS-only condition drifts on UNVERIFIED alone', () => {
    expect(collectMergedVerdictDrift('(engineResult.verdict || engineResult.overallVerdict) === "PASS"')).toEqual([
      'UNVERIFIED: the built condition quarantines it, WAVE_MERGED_VERDICTS lists it',
    ])
  })

  it('known-bad probe: an unreadable skeleton is reported, not passed', () => {
    expect(collectMergedVerdictDrift(waveMergeCondition('no fences here'))).toHaveLength(1)
  })
})

const GATE2_OPEN = 'const gate2 = await phase("gate2", async () => {'
const REVIEW_OPEN = 'const reviewResult = await phase("review"'

/** The built SINGLE skeleton's `phase("gate2")` statement, or null unless both anchors are unique. */
function gate2Statement(built: string): string | null {
  const script = parseFences(built).filter(f => f.includes('name: "devflow-dynamic-build"'))
  if (script.length !== 1) return null
  const open = script[0].split(GATE2_OPEN)
  const close = script[0].split(REVIEW_OPEN)
  if (open.length !== 2 || close.length !== 2) return null
  const start = script[0].indexOf(GATE2_OPEN)
  const end = script[0].indexOf(REVIEW_OPEN)
  return end > start ? script[0].slice(start, end) : null
}

type AsyncFn = (...args: unknown[]) => Promise<unknown>
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...params: string[]) => AsyncFn

/**
 * Every (evaluateVerdict, testVerdict) value the statement can produce: run it with
 * stub agents over every input presence and every agent outcome.
 */
async function gate2Values(statement: string): Promise<Set<string>> {
  const values = new Set<string>()
  const inputs = [
    { plan: 'the plan', criteria: '1. works', testPlan: '- [ ] TP-1 (AC-1) works — method:ci' },
    { plan: null, criteria: null, testPlan: '- [ ] TP-1 (AC-1) works — method:ci' },
    { plan: null, criteria: null, testPlan: null },
  ]
  for (const input of inputs) {
    for (const evalOutcome of ['PASS', 'FAIL']) {
      for (const testOutcome of ['PASS', 'FAIL']) {
        const agent = async (_prompt: string, opts: { agentType: string }): Promise<object> => {
          if (opts.agentType === 'Evaluate') return { verdict: evalOutcome, rationale: 'r' }
          if (opts.agentType === 'Test') return { verdict: testOutcome, failures: 'TP-1 failed' }
          return { verdict: 'PASS' }
        }
        const phase = async (_n: string, fn: () => Promise<unknown>): Promise<unknown> => fn()
        const parallel = async (ts: Array<() => Promise<unknown>>): Promise<unknown[]> => Promise.all(ts.map(t => t()))
        const run = new AsyncFunction(
          'phase', 'agent', 'parallel', 'BRANCH', 'PLAN', 'CRITERIA', 'TEST_PLAN', 'ISSUE_NUMBER', 'ISSUE_PR_LINK',
          `${statement}\nreturn gate2;`,
        )
        const g = (await run(phase, agent, parallel, 'ticket/x', input.plan, input.criteria, input.testPlan, '(none)', '(none)')) as Record<string, unknown>
        values.add(String(g.evaluateVerdict))
        values.add(String(g.testVerdict))
      }
    }
  }
  return values
}

/** Named collector: the Gate 2 values a wave row could not carry. */
function collectUnrepresentableGateValues(values: ReadonlySet<string>): string[] {
  return [...values].filter(v => !PE.WAVE_GATE_VALUES.includes(v)).map(v => `${v}: not in WAVE_GATE_VALUES`)
}

describe('parity: every Gate 2 value the built SINGLE skeleton produces is a wave-table value', () => {
  it('the produced set is found and non-vacuous', async () => {
    const statement = gate2Statement(BUILT)
    expect(statement, 'the phase("gate2") statement must be extractable').not.toBeNull()
    const values = await gate2Values(statement!)
    for (const v of ['PASS', 'FAIL-FIXED', 'SKIPPED']) expect(values, v).toContain(v)
    expect(collectUnrepresentableGateValues(values)).toEqual([])
  })

  it('known-bad probe: a statement that records a new Gate 2 value is reported', async () => {
    const statement = gate2Statement(BUILT)!
    const seeded = statement.replace('testVerdict = "FAIL-FIXED";', 'testVerdict = "RETRIED";')
    expect(seeded, 'the seed must land').not.toBe(statement)
    expect(collectUnrepresentableGateValues(await gate2Values(seeded))).toEqual(['RETRIED: not in WAVE_GATE_VALUES'])
  })
})
