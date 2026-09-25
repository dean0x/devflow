/**
 * tests/evidence/update-pr-evidence.test.ts
 *
 * SDLC-evidence PR4 (#363), phase P3 — the `update-pr-evidence` PR-host operation.
 *
 *   AC-5  the op's contract lives in git.md (Input, D4, Output) and its mechanics
 *         in `references/pr/update-pr-evidence.md`; it loads no publication gate
 *         and runs no visibility probe.
 *   AC-6  the mechanics DRIVE the evidence scripts rather than restating them: the
 *         body edit is one `&&` chain behind the block scrub and the script's
 *         compare-and-swap splice, the comment is one `&&` chain behind the
 *         Comment-sink scrub (D11), and the op reads the PR only through the script.
 *         The `EVIDENCE` template the mechanics parse accepts and rejects exactly
 *         what `EVIDENCE_LINE_RE` does, over a differential table.
 *
 * Every guard has a named collector, a non-empty-corpus assertion and a known-bad
 * probe through the same collector (PF-064). Every reader reads BUILT artifacts.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import { extractOpSectionFromCorpus, prHostRel, resolveAgentSource } from '../helpers.js'
import { PR_EVIDENCE_SCRIPT } from './seam.js'

interface EvidenceFields {
  pr: number
  head: string
  total: number
  counts: Record<string, number>
  stale: readonly number[]
  exceptions: readonly string[]
  approval: string
  key: string
  posted: string
  body: string
}

/** Only what this suite reads from the script. */
interface EvidenceExports {
  readonly EVIDENCE_LINE_RE: RegExp
  readonly STATES: readonly string[]
  readonly MARKERS: Readonly<Record<string, unknown>>
  formatEvidenceLine(fields: EvidenceFields): { ok: true; value: string } | { ok: false }
}

const PE = createRequire(import.meta.url)(PR_EVIDENCE_SCRIPT) as EvidenceExports

const OP = 'update-pr-evidence'

function requirePrBody(): string {
  const file = path.join(compiledSkillRefsDir(), ...prHostRel(OP).split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${prHostRel(OP)} is absent — run \`npm run build\` first (this suite reads the built reference)`)
  }
}

/** The op's own section of the compiled agent — 'sole': git.md is the one contract authority [DR-18]. */
function contractSection(): string {
  const git = resolveAgentSource('git')
  return extractOpSectionFromCorpus([{ path: git.path, content: git.content }], OP, { mode: 'sole' }).content
}

// ---------------------------------------------------------------------------
// 1. The EVIDENCE template ↔ EVIDENCE_LINE_RE
// ---------------------------------------------------------------------------

/** Placeholder words whose meaning is the script's: compiled from the regex's own group. */
const OPEN_PLACEHOLDERS: ReadonlySet<string> = new Set(['n', 'sha', 'ids', 'kinds', 'hex'])

/** Escape a literal for a RegExp source. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** The named capture groups of a RegExp source, in source order. */
function namedGroups(source: string): string[] {
  return [...source.matchAll(/\(\?<([A-Za-z][A-Za-z0-9]*)>/g)].map(m => m[1])
}

/** The source of one named group, without the group itself. Bounded by the source length. */
function namedGroupSource(source: string, group: string): string {
  const open = `(?<${group}>`
  const start = source.indexOf(open)
  if (start === -1) throw new Error(`no (?<${group}>…) group`)
  let depth = 1
  let inClass = false
  for (let i = start + open.length; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') { i++; continue }
    if (inClass) { if (ch === ']') inClass = false; continue }
    if (ch === '[') { inClass = true; continue }
    if (ch === '(') depth++
    if (ch === ')') {
      depth--
      if (depth === 0) return source.slice(start + open.length, i)
    }
  }
  throw new Error(`(?<${group}>…) is unbalanced`)
}

/** Named collector: the one `EVIDENCE …` code span the mechanics parse, or null when not exactly one. */
export function collectEvidenceTemplate(prBody: string): string | null {
  const spans = [...prBody.matchAll(/`(EVIDENCE [^`]+)`/g)].map(m => m[1])
  return spans.length === 1 ? spans[0] : null
}

/**
 * Compile the template to a RegExp. The i-th `<…>` placeholder is the regex's i-th
 * named group — order, not a hand-kept name map, so a reordered or dropped field
 * disagrees. A placeholder naming an open word (`<n>`, `<sha>`, `<ids|none>` …) takes
 * that group's own source; a closed one (`<yes|no|unchecked>`) compiles to its
 * listed values, so a value the template drops or invents disagrees.
 */
export function compileEvidenceTemplate(template: string, re: RegExp): RegExp {
  const groups = namedGroups(re.source)
  let out = ''
  let slot = 0
  for (let i = 0; i < template.length;) {
    if (template[i] === '<') {
      const close = template.indexOf('>', i)
      if (close === -1) throw new Error('template: unclosed <')
      const body = template.slice(i + 1, close)
      const group = groups[slot]
      if (group === undefined) throw new Error(`template: placeholder ${slot + 1} has no group in the regex`)
      out += body.split('|').some(word => OPEN_PLACEHOLDERS.has(word))
        ? `(?:${namedGroupSource(re.source, group)})`
        : `(?:${body.split('|').map(escapeRe).join('|')})`
      slot++
      i = close + 1
      continue
    }
    out += escapeRe(template[i])
    i++
  }
  if (slot !== groups.length) throw new Error(`template: ${slot} placeholders for ${groups.length} groups`)
  return new RegExp(`^${out}$`)
}

const HEAD = '0123456789abcdef0123456789abcdef01234567'

function line(over: Partial<EvidenceFields> = {}): string {
  const fields: EvidenceFields = {
    pr: 7,
    head: HEAD,
    total: 3,
    counts: { 'VERIFIED-CI': 1, 'ATTESTED-LOCAL': 1, UNVERIFIED: 0, STALE: 1, FAILED: 0, INDETERMINATE: 0 },
    stale: [2],
    exceptions: [],
    approval: 'unchecked',
    key: '0123456789ab',
    posted: 'no',
    body: 'changed',
    ...over,
  }
  const r = PE.formatEvidenceLine(fields)
  if (!r.ok) throw new Error(`formatEvidenceLine refused ${JSON.stringify(fields)}`)
  return r.value
}

/** The differential table: lines the script prints, and hostile near-misses. */
function differentialTable(): string[] {
  const zero = { 'VERIFIED-CI': 0, 'ATTESTED-LOCAL': 0, UNVERIFIED: 0, STALE: 0, FAILED: 0, INDETERMINATE: 0 }
  const rows: string[] = [
    line({ total: 0, counts: zero, stale: [] }),
    line({ pr: 1_234_567_890 }),
    line({ total: 200, counts: { ...zero, STALE: 200 }, stale: Array.from({ length: 200 }, (_, i) => i + 1) }),
    line({ total: 100, counts: { ...zero, 'VERIFIED-CI': 99, FAILED: 1 }, stale: [] }),
  ]
  for (const approval of ['yes', 'no', 'unchecked']) {
    for (const posted of ['yes', 'no', 'n/a']) {
      for (const body of ['same', 'changed']) {
        for (const exceptions of [[], ['ticket-link'], ['test-plan'], ['ticket-link', 'test-plan']]) {
          rows.push(line({ approval, posted, body, exceptions }))
        }
      }
    }
  }
  const ok = line()
  rows.push(
    ok.replace('approval:unchecked', 'approval:maybe'),
    ok.replace('posted:no', 'posted:na'),
    ok.replace('body:changed', 'body:SAME'),
    ok.replace('exceptions:none', 'exceptions:test-plan,ticket-link'),
    ok.replace('exceptions:none', 'exceptions:ticket-links'),
    ok.replace(`head:${HEAD}`, `head:${HEAD.slice(1)}`),
    ok.replace(`head:${HEAD}`, `head:${HEAD.toUpperCase()}`),
    ok.replace('key:0123456789ab', 'key:0123456789a'),
    ok.replace('pr:7', 'pr:0'),
    ok.replace('pr:7', 'pr:07'),
    ok.replace('total:3', 'total:201'),
    ok.replace('stale:TP-2', 'stale:TP-0'),
    ok.replace('stale:TP-2', 'stale:TP-2,'),
    ok.replace('stale:TP-2', 'stale:2'),
    ok.replace(' FAILED:0 ', ' '),
    ok.replace('STALE:1 FAILED:0', 'FAILED:0 STALE:1'),
    ok.replace('EVIDENCE ', 'EVIDENCE  '),
    ok.replace('EVIDENCE', 'evidence'),
    ` ${ok}`,
    `${ok} `,
    `${ok}\tx`,
    ok.replace(' body:changed', ''),
    '',
  )
  return rows
}

/** Named collector: the table rows on which the compiled template and the script's regex disagree. */
export function collectTemplateDisagreements(candidate: RegExp, rows: readonly string[]): string[] {
  return rows
    .filter(row => candidate.test(row) !== PE.EVIDENCE_LINE_RE.test(row))
    .map(row => `${JSON.stringify(row.slice(0, 120))}: template ${candidate.test(row) ? 'accepts' : 'rejects'}, EVIDENCE_LINE_RE ${PE.EVIDENCE_LINE_RE.test(row) ? 'accepts' : 'rejects'}`)
}

describe('AC-6: the EVIDENCE template accepts and rejects exactly what EVIDENCE_LINE_RE does', () => {
  const prBody = requirePrBody()

  it('the mechanics carry exactly one EVIDENCE template, and the table is two-sided', () => {
    expect(collectEvidenceTemplate(prBody), 'exactly one `EVIDENCE …` span').not.toBeNull()
    const rows = differentialTable()
    const accepted = rows.filter(r => PE.EVIDENCE_LINE_RE.test(r))
    expect(accepted.length, 'too few accepted rows').toBeGreaterThanOrEqual(70)
    expect(rows.length - accepted.length, 'too few hostile rows').toBeGreaterThanOrEqual(20)
  })

  it('over the differential table', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    expect(collectTemplateDisagreements(compileEvidenceTemplate(template, PE.EVIDENCE_LINE_RE), differentialTable())).toEqual([])
  })

  it('known-bad probe: a template that drops `unchecked` disagrees', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    const seeded = template.replace('<yes|no|unchecked>', '<yes|no>')
    expect(seeded, 'the seed must land').not.toBe(template)
    expect(collectTemplateDisagreements(compileEvidenceTemplate(seeded, PE.EVIDENCE_LINE_RE), differentialTable()).length).toBeGreaterThan(0)
  })

  it('known-bad probe: a template with two fields swapped disagrees', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    const seeded = template.replace('STALE:<n> FAILED:<n>', 'FAILED:<n> STALE:<n>')
    expect(seeded, 'the seed must land').not.toBe(template)
    expect(collectTemplateDisagreements(compileEvidenceTemplate(seeded, PE.EVIDENCE_LINE_RE), differentialTable()).length).toBeGreaterThan(0)
  })

  it('known-bad probe: a template that drops a field cannot even be compiled against the regex', () => {
    const template = collectEvidenceTemplate(prBody) ?? ''
    expect(() => compileEvidenceTemplate(template.replace(' body:<same|changed>', ''), PE.EVIDENCE_LINE_RE)).toThrow(/placeholders for/)
  })
})

// ---------------------------------------------------------------------------
// 2. The mechanics drive the scripts, and never restate them
// ---------------------------------------------------------------------------

/**
 * Every backticked span that INVOKES `cmd` — with an argument after it. A bare
 * mention (the residual-race sentence names `gh pr edit`) is prose, not a sink.
 */
function spansInvoking(text: string, cmd: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(span => span.includes(`${cmd} `))
}

/** A chain's commands, in order, when it is `&&`-joined only (no `;`, `|` or `||`). Null otherwise. */
function andChain(span: string): string[] | null {
  if (/;|\|/.test(span)) return null
  return span.split(' && ').map(part => part.trim())
}

interface ChainRule {
  readonly label: string
  /** The sink the chain ends in. */
  readonly sink: string
  /** Each command in the chain, in order, as the substring it must contain. */
  readonly steps: readonly string[]
}

/** The two sinks this op writes, and the gates each must sit behind. */
const CHAIN_RULES: readonly ChainRule[] = [
  {
    label: 'body edit',
    sink: 'gh pr edit',
    steps: [
      'redact-secrets.cjs" "$DEVFLOW_NOTES_RAW" "$DEVFLOW_NOTES"',
      'verify-evidence.cjs" splice --pr {PR_NUMBER} --state "$S" --block "$DEVFLOW_NOTES" --out "$DEVFLOW_BODY"',
      'gh pr edit {PR_NUMBER} --body-file "$DEVFLOW_BODY"',
    ],
  },
  {
    label: 'evidence comment',
    sink: 'gh pr comment',
    steps: [
      'redact-secrets.cjs" "$DEVFLOW_BODY_RAW" "$DEVFLOW_BODY"',
      'gh pr comment {PR_NUMBER} --body-file "$DEVFLOW_BODY"',
    ],
  },
]

/** Text the script owns, which the mechanics must never spell (a second grammar authority). */
function restatedGrammar(): string[] {
  const markers = Object.values(PE.MARKERS).filter((v): v is string => typeof v === 'string')
  return ['<!-- devflow:', '<!-- /devflow:', ...markers, ' — method:', ' out:', 'status:self-attested']
}

/** Named collector: every way the mechanics stop driving the scripts or bypass a gate. */
export function collectMechanicsDefects(prBody: string): string[] {
  const out: string[] = []
  for (const rule of CHAIN_RULES) {
    const spans = spansInvoking(prBody, rule.sink)
    if (spans.length !== 1) {
      out.push(`${rule.label}: ${spans.length} spans invoke ${rule.sink}, expected 1`)
      continue
    }
    const chain = andChain(spans[0])
    if (chain === null || chain.length !== rule.steps.length || !rule.steps.every((step, i) => chain[i].includes(step))) {
      out.push(`${rule.label}: not one \`&&\` chain of ${rule.steps.length} gated steps ending in ${rule.sink}`)
    }
  }
  for (const sub of ['verify --pr {PR_NUMBER}', 'readback --pr {PR_NUMBER} --expect "$DEVFLOW_BODY"']) {
    if (!prBody.includes(`verify-evidence.cjs" ${sub}`)) out.push(`does not run \`verify-evidence.cjs ${sub}\``)
  }
  if (!prBody.includes('apply the Comment-sink scrub (D11)')) out.push('does not name the Comment-sink scrub (D11)')
  if (/gh pr view [^`]/.test(prBody)) out.push('reads the PR itself with `gh pr view` — only the script may')
  for (const text of restatedGrammar()) {
    if (prBody.includes(text)) out.push(`restates script-owned text ${JSON.stringify(text)}`)
  }
  for (const text of ['publication-gate.md', 'gh repo view', '`full` → ']) {
    if (prBody.includes(text)) out.push(`decides publication itself (${text}) — the script decides the comment's form`)
  }
  for (const [label, text] of [
    ['one invocation', 'Run steps 1–4 as ONE Bash invocation'],
    ['CAS conflict', '`SPLICE conflict`'],
    ['read-back gate', 'anything but `READBACK ok`'],
    ['append-only', 'Never edit or delete an evidence comment'],
    ['residual race', 'GitHub has no conditional body edit'],
    ['state cleanup', 'rmdir -- "$S"'],
    ['empty-state guard', '[ -n "$S" ] && { rm -- "$S/base" "$S/base.sha256"; rmdir -- "$S"; }'],
    ['evidence-file path gate', 'only a value matching `^[A-Za-z0-9._/-]{1,255}$` reaches the shell'],
  ] as const) {
    if (!prBody.includes(text)) out.push(`does not state the ${label} rule`)
  }
  return out
}

describe('AC-6: the mechanics drive the evidence scripts', () => {
  const prBody = requirePrBody()

  it('the reference is the built one, opening with its own anchor', () => {
    expect(prBody.startsWith(`## Operation: ${OP}\n`)).toBe(true)
    expect(spansInvoking(prBody, 'verify-evidence.cjs"').length, 'verify, splice and readback').toBeGreaterThanOrEqual(3)
  })

  it('every sink sits behind its gates, and nothing the script owns is restated', () => {
    expect(collectMechanicsDefects(prBody)).toEqual([])
  })

  it('known-bad probe: a body edit that runs after a failed splice is reported', () => {
    const seeded = prBody.replace('--out "$DEVFLOW_BODY" && gh pr edit', '--out "$DEVFLOW_BODY"; gh pr edit')
    expect(seeded, 'the seed must land').not.toBe(prBody)
    expect(collectMechanicsDefects(seeded)).toEqual([
      'body edit: not one `&&` chain of 3 gated steps ending in gh pr edit',
    ])
  })

  it('known-bad probe: a comment posted from the unscrubbed file is reported', () => {
    const seeded = prBody.replace('gh pr comment {PR_NUMBER} --body-file "$DEVFLOW_BODY"', 'gh pr comment {PR_NUMBER} --body-file "$DEVFLOW_BODY_RAW"')
    expect(seeded, 'the seed must land').not.toBe(prBody)
    expect(collectMechanicsDefects(seeded)).toEqual([
      'evidence comment: not one `&&` chain of 2 gated steps ending in gh pr comment',
    ])
  })

  it('known-bad probe: a cleanup that runs on an empty $S, and an ungated evidence path, are reported', () => {
    const unguarded = prBody.replace('[ -n "$S" ] && { rm -- "$S/base" "$S/base.sha256"; rmdir -- "$S"; }', 'rm -- "$S/base" "$S/base.sha256"; rmdir -- "$S"')
    expect(unguarded, 'the seed must land').not.toBe(prBody)
    expect(collectMechanicsDefects(unguarded)).toEqual(['does not state the empty-state guard rule'])
    const ungated = prBody.replace(' — only a value matching `^[A-Za-z0-9._/-]{1,255}$` reaches the shell', '')
    expect(ungated, 'the seed must land').not.toBe(prBody)
    expect(collectMechanicsDefects(ungated)).toEqual(['does not state the evidence-file path gate rule'])
  })

  it('known-bad probe: a marker literal, an own PR read and a visibility probe are each reported', () => {
    const block = String(PE.MARKERS.BLOCK_START)
    const seeded = `${prBody}\nFind ${block} in \`gh pr view {PR_NUMBER} --json body\`, then \`gh repo view --json visibility\`.\n`
    expect(collectMechanicsDefects(seeded)).toEqual([
      'reads the PR itself with `gh pr view` — only the script may',
      'restates script-owned text "<!-- devflow:"',
      `restates script-owned text ${JSON.stringify(block)}`,
      'decides publication itself (gh repo view) — the script decides the comment\'s form',
    ])
  })
})

// ---------------------------------------------------------------------------
// 3. The contract in git.md, and its statuses ↔ the mechanics
// ---------------------------------------------------------------------------

const INPUT_LINE =
  '**Input:** `PR_NUMBER`, `REVIEW_PUBLICATION`, `EVIDENCE_FILE` (optional), `WORKTREE_PATH` (optional)'
const POINTER_LINE = `**PR mechanics:** load \`references/${prHostRel(OP)}\`.`

/** The status tokens an Output line enumerates after `**<label>**:`, DEGRADED excluded. */
function outputStatuses(section: string, label: string): string[] {
  const m = new RegExp(`\\*\\*${label}\\*\\*: ([^·\\n]+)`).exec(section)
  if (m === null) return []
  return m[1].split('|').map(s => s.trim()).filter(s => s !== '' && !s.startsWith('DEGRADED'))
}

/** Named collector: contract lines missing from git.md, and Output statuses the mechanics never report (or vice versa). */
export function collectContractDefects(section: string, prBody: string): string[] {
  const out: string[] = []
  const inputs = section.split('\n').filter(l => l.startsWith('**Input:**'))
  if (inputs.length !== 1 || inputs[0] !== INPUT_LINE) out.push(`Input line is not ${JSON.stringify(INPUT_LINE)}`)
  if (!section.includes('**Degradation (D4):**')) out.push('no **Degradation (D4):** clause in the agent section')
  if (!section.includes(POINTER_LINE)) out.push(`no pointer ${JSON.stringify(POINTER_LINE)}`)
  if (!section.includes('{the script\'s EVIDENCE line}')) out.push('Output does not return the script\'s EVIDENCE line')
  const reported = new Set([...prBody.matchAll(/→ `([A-Z]+)`|\(else `([A-Z]+)`\)|else `([A-Z]+)`/g)].map(m => m[1] ?? m[2] ?? m[3]))
  for (const label of ['Body', 'Comment']) {
    const statuses = outputStatuses(section, label)
    if (statuses.length === 0) out.push(`Output has no **${label}** statuses`)
    for (const status of statuses) {
      if (!reported.has(status) && !prBody.includes(`\`${status}\``)) out.push(`**${label}**: ${status} is never reported by the mechanics`)
    }
  }
  return out
}

describe('AC-5: the contract is the agent\'s, and its statuses are the mechanics\'', () => {
  const section = contractSection()
  const prBody = requirePrBody()

  it('the section is the op\'s own, and names neither the publication gate nor a visibility probe', () => {
    expect(section.startsWith(`## Operation: ${OP}\n`)).toBe(true)
    expect(section).not.toContain('publication-gate.md')
    expect(section).not.toContain('gh repo view')
    expect(section, 'PR_EXCEPTIONS reaches the op through the evidence file, never as an input').not.toContain('PR_EXCEPTIONS')
  })

  it('carries its contract lines, and every Output status is one the mechanics report', () => {
    expect(collectContractDefects(section, prBody)).toEqual([])
  })

  it('known-bad probe: an Input the design keeps out, and a status nothing reports, are reported', () => {
    const seeded = section
      .replace(INPUT_LINE, `${INPUT_LINE}, \`PR_EXCEPTIONS\``)
      .replace('POSTED | SKIPPED | OFF', 'POSTED | SKIPPED | OFF | QUEUED')
    expect(collectContractDefects(seeded, prBody)).toEqual([
      `Input line is not ${JSON.stringify(INPUT_LINE)}`,
      '**Comment**: QUEUED is never reported by the mechanics',
    ])
  })
})
