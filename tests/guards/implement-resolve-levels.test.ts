/**
 * /implement and /resolve phases per gate level (#480, part of epic #468).
 *
 * `GATE_LEVEL` comes from the accepted settings line. At `standard` and `lean`, each command reads its own level
 * reference once per run and applies the rows of that reference to the phases the rows name. At `full` it reads
 * nothing. Both references ship with the fixed row grammar and no rows: later issues add the rows, so this file
 * holds what a row may say, where the command reads it and what no row may touch.
 *   - `/implement`: one Gate level block at the start of Phase 3. The normal path and the re-validation path
 *     (Phases 3-8) both reach it. A failed read applies no row and keeps `GATE_LEVEL`, so at `lean` Phase 6 still
 *     passes the level to Validate and the lint pack still runs.
 *   - `/resolve`: one Gate level block in Step 0d. Each worktree keeps its own level. A failed read applies no row
 *     in any worktree.
 *   - No level changes the security floor that each block names.
 *
 * What this file holds, each arm through a named collector and a known-bad probe over the same collector:
 *   a. The Gate level block of each command, closed to the read paragraph and the three bullets, in its place,
 *      outside every learning arm of the source.
 *   b. The data flow: `GATE_LEVEL` in the Produces and Requires lines that carry it.
 *   c. The fail-closed bullet: no row applied, the level kept, and the Phase 6 Validate prompt still carries it.
 *   d. The reference grammar: title, headings, header, closed phase set, cell grammar (a never-skip phase takes no
 *      `skip`, `pass level` needs a spawn) and Rules bullets.
 *   e. Row safety, a tripwire: protected phases, never-skip phases, floor controls, dispositions and actions no row
 *      may carry.
 *   f. `full` reads nothing: the reference path appears only inside the block, and no Validate fence of
 *      `/resolve` names the level.
 *   g. The report lines that name the level.
 *   h. The two `/resolve` routes that skip phases, and the numbered principles.
 * The spawn fences of both commands are pinned in `implement-resolve-full-fences.test.ts`.
 *
 * The reference arms (d, e) read the two references. The command arms (a, b, c, f, g, h) read the compiled commands.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { ROOT, SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION_PRINT, isAgentBlock, parseFences, readAgentReference, requireDistFile, resolveLearningOffSource, sectionBetween } from '../helpers.js'

// ---------------------------------------------------------------------------
// The decided text, written by hand from the issue and the gate decisions
// ---------------------------------------------------------------------------

const LEVEL_DIR = 'skills/devflow:agent-references/references/commands'
const OPEN = '**Gate level.**'
const TABLE_HEADER = '| Phase | standard | lean |'
const TABLE_SEPARATOR = '|-------|----------|------|'
const RULES_INTRO = 'An `apply:` cell names one bullet of this section. Each bullet is named by at least one row.'

const GRAMMAR_CELL = "- **Cell:** `-` runs the phase as written; `skip`, alone, skips it; `apply: <name>` applies the `## Rules` bullet `<name>`; `pass level` adds the line `GATE_LEVEL: {GATE_LEVEL}` to every spawn prompt of the phase, and a phase with no spawn never takes `pass level`. Join `apply:` and `pass level` with `; `. Each `apply:` names exactly one bullet. Any other cell is malformed."
const GRAMMAR_RULES_BULLET = '- **Rules bullet:** a Rules bullet opens `- **<name>:**`.'
const GRAMMAR_SKIPPED = '- **Skipped:** a skipped phase counts as passed, so the next phase starts as written. Each name on its `**Produces:**` line reads `skipped`, and a report shows `skipped`, never a pass.'
const FLOOR_FIRST = 'No row or rule overrides the next two lines.'
const FAIL_CLOSED_HEAD = 'If the Read fails, or the file has no `## Phases` heading with the `| Phase | standard | lean |` header, or a row breaks its grammar, '
const UNREADABLE = 'say `level reference unreadable: no level rows applied`.'

/** What one command's block, reference and neighbours must be. */
interface LevelSpec {
  readonly cmd: 'implement' | 'resolve'
  /** The reference file name and the title it opens with. */
  readonly refFile: string
  readonly title: string
  /** The closed phase set, as [number, name] in the order the reference names them. */
  readonly closed: ReadonlyArray<readonly [string, string]>
  /** The compiled `### Phase N:` numbers outside the closed set, in heading order. */
  readonly protectedPhases: readonly string[]
  /** The pinned `## Phases` intro and the pinned `## Grammar` lines. */
  readonly intro: string
  readonly grammar: readonly string[]
  /** The block: the read paragraph, the three bullets, the condition inside the read and the fail-closed needles. */
  readonly readParagraph: string
  readonly items: readonly string[]
  readonly levelCondition: string
  readonly failClosed: readonly string[]
  /** Where the block sits: the region it must lie in, the paragraph before it, the paragraph after it. */
  readonly regionFrom: string
  readonly regionTo: string
  readonly outsideMessage: string
  readonly prevHas: string
  readonly nextParagraph: string
  /** The source line that ends the block in the `.mds` source, and a heading to move the block in front of in a probe. */
  readonly sourceEnd: string
  readonly moveBefore: string
  /** A phase cell that is in the closed set and carries no floor word, for probe rows. */
  readonly sampleRow: string
  /** The closed-set phases that never take `skip`: a skip there drops a security fix, a ticket or a gate that follows. */
  readonly neverSkip: readonly string[]
  /** Each Produces or Requires line that must list `GATE_LEVEL`. */
  readonly dataFlow: ReadonlyArray<{ readonly site: string; readonly kind: 'Produces' | 'Requires'; readonly start: string; readonly end: string | null }>
}

const IMPLEMENT: LevelSpec = {
  cmd: 'implement',
  refFile: 'implement-levels.md',
  title: '# Implement: phases by gate level',
  closed: [['3', 'Polish'], ['4', 'Self-Review'], ['5', 'Alignment Check']],
  protectedPhases: ['1', '2', '6', '7', '8', '9', '10', '11', '12'],
  intro: 'At `standard` and `lean`, a row sets its phase at that level. A phase with no row runs as written, and a table with no rows is well-formed.',
  grammar: [
    "- **Phase:** `3 Polish`, `4 Self-Review` or `5 Alignment Check`: the number and the text after `### Phase N: ` in the command, without a trailing parenthetical. Any other phase, or a name that is not its number's heading, is malformed.",
    GRAMMAR_CELL,
    GRAMMAR_RULES_BULLET,
    GRAMMAR_SKIPPED,
    '- **Gate level block:** the command reads this file at the start of Phase 3, before the Polish spawn. A `3 Polish` row with `skip` skips the Polish spawn, never that block.',
    "- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, and keeps Validate, the CI gate, the evidence claims and the compliance directive. One exception: a `4 Self-Review` row may skip Harden, and an enabled compliance lens keeps Harden.",
    '- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row.',
  ],
  readParagraph: `${OPEN} At \`standard\` or \`lean\`, once per run, run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash and Read \`<that directory>/${LEVEL_DIR}/implement-levels.md\` with the Read tool, and apply each row to the phase it names.`,
  items: [
    FLOOR_FIRST,
    `${FAIL_CLOSED_HEAD}apply no row, keep \`GATE_LEVEL\` and ${UNREADABLE}`,
    'Validate, the CI gate, the evidence claims and the compliance directive run at every level. An enabled compliance lens keeps Harden.',
  ],
  levelCondition: 'At `standard` or `lean`, once per run',
  failClosed: [
    'has no `## Phases` heading with the `| Phase | standard | lean |` header',
    'a row breaks its grammar',
    'apply no row, keep `GATE_LEVEL` and',
    '`level reference unreadable: no level rows applied`',
  ],
  regionFrom: '### Phase 3: Polish',
  regionTo: '### Phase 4:',
  outsideMessage: 'the block is outside Phase 3: the re-validation path skips Phase 1',
  prevHas: '**Requires:**',
  nextParagraph: 'After the Code agent completes',
  sourceEnd: 'After the Code agent completes',
  moveBefore: '### Phase 2: Implement',
  sampleRow: '3 Polish',
  neverSkip: [],
  dataFlow: [
    { site: 'Phase 3', kind: 'Requires', start: '### Phase 3: Polish', end: '### Phase 4:' },
    { site: 'Phase 12', kind: 'Requires', start: '### Phase 12: Report', end: null },
  ],
}

const RESOLVE: LevelSpec = {
  cmd: 'resolve',
  refFile: 'resolve-levels.md',
  title: '# Resolve: phases by gate level',
  closed: [['2', 'Global Triage'], ['3', 'Batch FIX_NOW Issues'], ['4', 'Fix'], ['6', 'Polish'], ['9', 'Manage Debt']],
  protectedPhases: ['0', '1', '1b', '5', '7', '8', '9b', '9c', '10'],
  intro: 'At `standard` and `lean`, a row sets its phase at that level. Each worktree reads the column of its own level, except in a global phase. A phase with no row runs as written, and a table with no rows is well-formed.',
  grammar: [
    "- **Phase:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix`, `6 Polish` or `9 Manage Debt`: the number and the text after `### Phase N: ` in the command, without a trailing parenthetical. Phase `9` never covers `9b` or `9c`. Any other phase, or a name that is not its number's heading, is malformed.",
    GRAMMAR_CELL,
    GRAMMAR_RULES_BULLET,
    GRAMMAR_SKIPPED,
    '- **Never skip:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix` and `9 Manage Debt` never take `skip`. Triage routes each security finding as it does at `full`. No row leaves a FIX_NOW security finding unfixed, leaves a FIX_SEPARATE item without a ticket, or drops the CI gate.',
    "- **Global phase:** a phase that one spawn serves for all worktrees, as `2 Global Triage` does, uses the strictest level in the run, in the order `full`, `standard`, `lean`: it takes that level's cell, and `pass level` passes that level. At `full` it runs as written.",
    "- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, changes neither the Triage security gate nor the ESCALATED route, and keeps the Verification Gate, the CI gate and the compliance directive.",
    '- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row in any worktree.',
  ],
  readParagraph: `${OPEN} Each worktree keeps its own \`GATE_LEVEL\`. When any is \`standard\` or \`lean\`, once per run, run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash and Read \`<that directory>/${LEVEL_DIR}/resolve-levels.md\` with the Read tool, and apply each row to the phase it names, in each worktree at its own level.`,
  items: [
    FLOOR_FIRST,
    `${FAIL_CLOSED_HEAD}apply no row in any worktree, keep every \`GATE_LEVEL\` and ${UNREADABLE}`,
    'No level changes the Triage security gate or the ESCALATED route. The Verification Gate, the CI gate and the compliance directive run at every level.',
  ],
  levelCondition: 'When any is `standard` or `lean`, once per run',
  failClosed: [
    'has no `## Phases` heading with the `| Phase | standard | lean |` header',
    'a row breaks its grammar',
    'apply no row in any worktree, keep every `GATE_LEVEL` and',
    '`level reference unreadable: no level rows applied`',
  ],
  regionFrom: '#### Step 0d:',
  regionTo: '### Phase 1: Parse Issues',
  outsideMessage: 'the block is outside Step 0d',
  prevHas: "Set it per worktree, from that worktree's lens",
  nextParagraph: '**Mint `RESOLUTION_TS` once per run:**',
  sourceEnd: '**Mint `RESOLUTION_TS`',
  moveBefore: '### Phase 1: Parse Issues',
  sampleRow: '6 Polish',
  neverSkip: ['2', '3', '4', '9'],
  dataFlow: [
    { site: 'Step 0d', kind: 'Produces', start: '#### Step 0d:', end: '### Phase 1: Parse Issues' },
    { site: 'Phase 5', kind: 'Requires', start: '### Phase 5:', end: '### Phase 6:' },
    { site: 'Phase 10', kind: 'Requires', start: '### Phase 10:', end: null },
  ],
}

const SPECS: readonly LevelSpec[] = [IMPLEMENT, RESOLVE]

/** The pinned report lines (arm g) and cut routes (arm h). */
const IMPLEMENT_REPORT = "Display completion summary with phase status, `Gate level: {GATE_LEVEL}` with any level note, Validate's `Lint pack:` line if any, PR info, and next steps."
const RESOLVE_DISPLAY = '**Total Issues**: {n}\n**Gate level**: {GATE_LEVEL, with any level note}\n\n### Results'
const RESOLVE_HEADER = '**Command**: /resolve\n**Gate level**: {GATE_LEVEL}\n\n'
const ROUTE_EMPTY = 'If FIX_NOW list is empty: skip to Phase 5, then run Phases 9, 9b, 9c and 10.'
const ROUTE_PUSH = '**Route after push:** VERIFICATION_STATUS = PASS → continue to Phase 8 (CI gate). FAILED or SKIPPED → skip Phase 8 and continue with Phase 9 and the later phases in order.'
const ROUTE_EMPTY_PHASES = ['10', '5', '9', '9b', '9c']

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

const countOf = (text: string, needle: string): number => text.split(needle).length - 1

/** The names on a section's `**Produces:**` or `**Requires:**` line, parentheticals dropped. */
function dataFlowNames(section: string | null, kind: 'Produces' | 'Requires'): string[] {
  const line = new RegExp(`^\\*\\*${kind}:\\*\\* (.+)$`, 'm').exec(section ?? '')?.[1] ?? ''
  return line.replace(/\([^)]*\)/g, '').split(',').map(n => n.trim()).filter(n => n !== '')
}

/** The `### Phase N:` headings of a compiled command, as number to name with the parenthetical dropped. */
function phaseHeadings(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of body.matchAll(/^### Phase (\d+[a-z]?): (.+)$/gm)) {
    if (!map.has(m[1])) map.set(m[1], m[2].replace(/ \([^)]*\)$/, ''))
  }
  return map
}

/** The phase numbers of the compiled headings that are outside the closed set: a new phase is protected by default. */
function protectedOf(spec: LevelSpec, body: string): string[] {
  return [...body.matchAll(/^### Phase (\d+[a-z]?): /gm)].map(m => m[1]).filter(n => !spec.closed.some(([c]) => c === n))
}

/** The compiled `### Phase N:` section, up to the next phase heading: where a row's spawns sit. Empty when the phase is absent. */
function phaseSection(body: string, num: string): string {
  const from = body.indexOf(`\n### Phase ${num}: `)
  if (from === -1) return ''
  const next = body.indexOf('\n### Phase ', from + 1)
  return next === -1 ? body.slice(from) : body.slice(from, next)
}

/** The block as the command carries it: the read paragraph, a blank line, then the three bullets. */
const blockText = (spec: LevelSpec): string => `${spec.readParagraph}\n\n${spec.items.map(i => `- ${i}`).join('\n')}`

// ---------------------------------------------------------------------------
// a. The Gate level block of the command
// ---------------------------------------------------------------------------

/** The defect for a read paragraph that is not the pinned one. */
const notPinned = (paragraph: string): string => `the read paragraph is not the pinned sentence: ${paragraph.slice(0, 200)}`

/**
 * AC-3, AC-6: the block that applies the level reference, in one compiled build. The block is a closed set: the read
 * paragraph, equal to one pinned string, then one paragraph of exactly three bullets, word for word. It sits inside
 * its region, after the paragraph it follows and before the paragraph it precedes.
 */
export function collectLevelBlockDefects(body: string, spec: LevelSpec): string[] {
  const out: string[] = []
  const start = body.indexOf(OPEN)
  if (start === -1) return [`no "${OPEN}" block`]
  if (body.indexOf(OPEN, start + OPEN.length) !== -1) out.push(`the command holds more than one "${OPEN}" block`)
  const [read = '', bullets = '', next = ''] = body.slice(start).split('\n\n')
  if (read !== spec.readParagraph) out.push(notPinned(read))
  const wantBullets = spec.items.map(i => `- ${i}`).join('\n')
  if (bullets !== wantBullets) out.push(`the block lines are not the three pinned lines: ${bullets.split('\n').join(' | ').slice(0, 200)}`)
  for (const item of spec.items) {
    if (!`${read}\n\n${bullets}`.includes(item)) out.push(`the block lacks: ${item.slice(0, 60)}`)
  }
  if (!next.startsWith(spec.nextParagraph)) out.push(`the block is not followed by "${spec.nextParagraph}"`)
  const previous = body.slice(0, start).trimEnd().split('\n\n').pop() ?? ''
  if (!previous.includes(spec.prevHas)) out.push(`the block does not follow "${spec.prevHas}"`)
  const from = body.indexOf(spec.regionFrom)
  const to = from === -1 ? -1 : body.indexOf(spec.regionTo, from + 1)
  if (from === -1 || to === -1 || start < from || start > to) out.push(spec.outsideMessage)
  return out
}

/** AC-3: in the source, the block sits outside every learning arm, so both builds carry it. */
export function collectBlockArmDefects(source: string, spec: LevelSpec): string[] {
  let arm: string | null = null
  let inBlock = false
  let seen = false
  const out: string[] = []
  for (const line of source.split('\n')) {
    const open = /^<!-- learning:(on|off) -->$/.exec(line)
    if (open !== null) { arm = open[1]; continue }
    if (line === '<!-- learning:end -->') { arm = null; continue }
    if (line.startsWith(OPEN)) { inBlock = true; seen = true }
    else if (line.startsWith(spec.sourceEnd)) inBlock = false
    if (inBlock && arm !== null) { out.push(`the gate-level block sits inside a learning:${arm} arm`); break }
  }
  if (!seen) out.push('the source has no gate-level block')
  return out
}

// ---------------------------------------------------------------------------
// b. Data flow
// ---------------------------------------------------------------------------

/** AC-3: every Produces or Requires line that carries `GATE_LEVEL` lists it. */
export function collectDataFlowDefects(body: string, spec: LevelSpec): string[] {
  const out: string[] = []
  for (const { site, kind, start, end } of spec.dataFlow) {
    const section = sectionBetween(body, start, end)
    if (section === null) { out.push(`no ${site} section from "${start}"`); continue }
    if (!dataFlowNames(section, kind).includes('GATE_LEVEL')) out.push(`${site} ${kind} does not list GATE_LEVEL`)
  }
  return out
}

// ---------------------------------------------------------------------------
// c. Fail-closed and AC-9
// ---------------------------------------------------------------------------

/**
 * AC-3, AC-9: a failed read applies no row and keeps the level. The bullet holds the malformed definition, the
 * route and the message, and none of the retired wording that set the level to `full`. For `/implement`, the Phase 6
 * Validate prompt still opens with the level line and Validate still runs the lint pack only on a first `lean` line.
 */
export function collectFailClosedDefects(body: string, spec: LevelSpec, validate: string): string[] {
  const out: string[] = []
  const start = body.indexOf(OPEN)
  const lines = start === -1 ? [] : (body.slice(start).split('\n\n')[1] ?? '').split('\n')
  const bullet = lines.find(line => line.startsWith('- If the Read fails'))
  if (bullet === undefined) out.push('the block has no fail-closed bullet ("If the Read fails")')
  else {
    for (const needle of spec.failClosed) if (!bullet.includes(needle)) out.push(`the fail-closed bullet lacks: ${needle}`)
    if (bullet.includes('full applied')) out.push('the fail-closed bullet holds "full applied"')
    if (/\bset `?GATE_LEVEL/i.test(bullet)) out.push('the fail-closed bullet sets GATE_LEVEL')
  }
  if (spec.cmd === 'implement') {
    const fences = parseFences(sectionBetween(body, '### Phase 6: Validate', '### Phase 7:') ?? '').filter(f => isAgentBlock(f, 'Validate'))
    if (fences.length !== 1) out.push(`Phase 6 holds ${fences.length} Validate fences, expected 1`)
    else if (!/^```[^\n]*\nAgent\(subagent_type="Validate"\):\n"GATE_LEVEL: \{GATE_LEVEL\}\n/.test(fences[0])) out.push('the Phase 6 Validate prompt does not open with GATE_LEVEL: {GATE_LEVEL}')
    if (!validate.includes('Only if the first `GATE_LEVEL:` line is exactly `lean`')) out.push('validate.md lacks "Only if the first `GATE_LEVEL:` line is exactly `lean`"')
  }
  return out
}

// ---------------------------------------------------------------------------
// d. The reference grammar
// ---------------------------------------------------------------------------

interface RefSection { readonly heading: string; readonly lines: readonly string[] }
interface ParsedRef { readonly title: string; readonly preamble: readonly string[]; readonly sections: readonly RefSection[] }

/** A reference as its title line, the text before its first heading and its `## ` sections, blank lines dropped. */
function parseRef(ref: string): ParsedRef {
  const lines = ref.split('\n')
  const sections: Array<{ heading: string; lines: string[] }> = []
  const preamble: string[] = []
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) { sections.push({ heading: line, lines: [] }); continue }
    if (line.trim() === '') continue
    const current = sections[sections.length - 1]
    if (current === undefined) preamble.push(line)
    else current.lines.push(line)
  }
  return { title: lines[0] ?? '', preamble, sections }
}

const sectionOf = (parsed: ParsedRef, heading: string): RefSection | undefined => parsed.sections.find(s => s.heading === heading)

/** The table lines of the `## Phases` section: the header, the separator, then the rows. */
const tableLines = (parsed: ParsedRef): string[] => (sectionOf(parsed, '## Phases')?.lines ?? []).filter(line => line.startsWith('|'))

/** The rows of a reference, header and separator dropped. */
export function referenceRows(ref: string): string[] {
  return tableLines(parseRef(ref)).slice(2)
}

/** The cells of a table row, or null when the line is not bounded by pipes. */
function splitRow(line: string): string[] | null {
  if (!line.startsWith('|') || !line.endsWith('|')) return null
  return line.split('|').slice(1, -1).map(cell => cell.trim())
}

const RULE_BULLET = /^- \*\*([A-Za-z0-9][A-Za-z0-9 _-]*):\*\* \S/

/** What a phase lets a cell do: `skip` is barred on a never-skip phase, and `pass level` needs a spawn prompt to carry the line. */
interface PhaseTraits { readonly num: string; readonly neverSkips: boolean; readonly hasSpawn: boolean }

/** The traits of a closed-set phase, read from the spec and the compiled section. A phase outside the closed set is reported by its own row defect, so it gets neutral traits. */
function phaseTraits(spec: LevelSpec, body: string, num: string): PhaseTraits {
  if (!spec.closed.some(([n]) => n === num)) return { num, neverSkips: false, hasSpawn: true }
  return { num, neverSkips: spec.neverSkip.includes(num), hasSpawn: /\bAgent\(/.test(phaseSection(body, num)) }
}

/** The tail of the defect for a `skip` cell on a never-skip phase, shared by the grammar and the row-safety check. */
const takesSkip = (num: string): string => `takes skip, which phase ${num} never takes`

/** What is wrong with one level cell, or null. `names` are the Rules bullets that exist. */
function cellDefect(cell: string, names: readonly string[], phase: PhaseTraits): string | null {
  if (cell === 'skip') return phase.neverSkips ? `the cell ${takesSkip(phase.num)}` : null
  if (cell === '-') return null
  const seen = new Set<string>()
  for (const part of cell.split('; ')) {
    if (seen.has(part)) return `the cell repeats "${part}"`
    seen.add(part)
    if (part === 'pass level') {
      if (!phase.hasSpawn) return `the cell takes pass level, but phase ${phase.num} has no spawn to carry it`
      continue
    }
    const applied = /^apply: ([A-Za-z0-9][A-Za-z0-9 _-]*)$/.exec(part)
    if (applied === null) return `the cell holds "${part}", which is not skip, -, apply: <name> or pass level`
    if (!names.includes(applied[1])) return `the cell applies "${applied[1]}", which no Rules bullet names`
  }
  return null
}

/** AC-5: the closed phase set, by number and name, against the compiled headings of one build. */
export function collectClosedSetDefects(spec: LevelSpec, body: string): string[] {
  const out: string[] = []
  const headings = phaseHeadings(body)
  for (const [num, name] of spec.closed) {
    const got = headings.get(num)
    if (got !== name) out.push(`the closed set names "${num} ${name}", but the compiled "### Phase ${num}:" heading is "${got ?? 'absent'}"`)
    const times = countOf(body, `\n### Phase ${num}: `)
    if (times !== 1) out.push(`the compiled command holds ${times} "### Phase ${num}:" headings, expected 1`)
  }
  const protectedNow = protectedOf(spec, body)
  if (protectedNow.join(', ') !== spec.protectedPhases.join(', ')) out.push(`the protected phases are ${protectedNow.join(', ')}, expected ${spec.protectedPhases.join(', ')}`)
  return out
}

/**
 * AC-5: the shape of one reference. The title, the three headings in order, the exact header and separator, rows whose
 * phase is in the closed set under the compiled heading name, cells in the cell grammar, `apply:` naming one Rules
 * bullet that exists, Rules bullets that open `- **<name>:**`, and no spawn block, `subagent_type` or learning
 * marker. A table with no rows has no defect.
 */
export function collectLevelReferenceDefects(ref: string, spec: LevelSpec, body: string): string[] {
  const out: string[] = []
  const parsed = parseRef(ref)
  if (parsed.title !== spec.title) out.push(`the reference does not open with "${spec.title}"`)
  const headings = parsed.sections.map(s => s.heading)
  for (const want of ['## Phases', '## Grammar', '## Rules']) if (!headings.includes(want)) out.push(`no "${want}" heading`)
  if (headings.includes('## Phases') && headings.includes('## Grammar') && headings.includes('## Rules') && headings.join(', ') !== '## Phases, ## Grammar, ## Rules') {
    out.push(`the headings are "${headings.join(', ')}", expected "## Phases, ## Grammar, ## Rules"`)
  }

  const names: string[] = []
  for (const line of sectionOf(parsed, '## Rules')?.lines ?? []) {
    if (!line.startsWith('- ')) continue
    const m = RULE_BULLET.exec(line)
    if (m === null) { out.push(`a Rules bullet does not open "- **<name>:**": ${line.slice(0, 60)}`); continue }
    if (names.includes(m[1])) out.push(`the Rules bullet "${m[1]}" is repeated`)
    names.push(m[1])
  }

  if (sectionOf(parsed, '## Phases') !== undefined) {
    const table = tableLines(parsed)
    if (table[0] !== TABLE_HEADER) out.push(`the table header is "${table[0] ?? 'absent'}", expected "${TABLE_HEADER}"`)
    if (table[1] !== TABLE_SEPARATOR) out.push(`the table separator is "${table[1] ?? 'absent'}", expected "${TABLE_SEPARATOR}"`)
  }
  const compiled = phaseHeadings(body)
  for (const line of referenceRows(ref)) {
    const cells = splitRow(line)
    if (cells === null || cells.length !== 3) { out.push(`a row does not have three cells: ${line.slice(0, 60)}`); continue }
    const [phase, ...levels] = cells
    const m = /^(\d+[a-z]?) (\S.*)$/.exec(phase)
    if (m === null) { out.push(`a row phase is not "<number> <name>": ${phase}`); continue }
    const [, num, name] = m
    const closed = spec.closed.find(([n]) => n === num)
    if (closed === undefined) out.push(`a row for phase ${num}, which is outside the closed set ${spec.closed.map(([n]) => n).join(', ')}`)
    else {
      if (name !== closed[1]) out.push(`phase ${num} is named "${name}", expected "${closed[1]}"`)
      if (compiled.get(num) !== name) out.push(`phase ${num} "${name}" is not the compiled "### Phase ${num}:" heading ("${compiled.get(num) ?? 'absent'}")`)
    }
    levels.forEach((cell, i) => {
      const defect = cellDefect(cell, names, phaseTraits(spec, body, num))
      if (defect !== null) out.push(`row ${num} ${i === 0 ? 'standard' : 'lean'}: ${defect}`)
    })
  }

  if (ref.includes('Agent(')) out.push('the reference carries a spawn block')
  if (ref.includes('subagent_type')) out.push('the reference carries a subagent_type field')
  if (/<!-- learning:/.test(ref)) out.push('the reference carries a learning marker')
  return out
}

// ---------------------------------------------------------------------------
// e. Row safety, a tripwire
// ---------------------------------------------------------------------------

/** Stems of removal verbs; a stem matches every word that begins with it ("remov" matches remove, removed, removal). */
const REMOVAL_STEMS = ['skip', 'drop', 'remov', 'omit', 'disabl', 'bypass', 'ignor', 'defer', 'stop'] as const
/** Whole words and phrases of removal and negation; "does not run" and "do not spawn" are read through "not". */
const REMOVAL_WORDS = ['without', 'no', 'not', 'never', "don't", "doesn't", 'cut', 'leave out', 'turn off', 'turns off', 'turned off', 'turning off'] as const
/** Names of the controls that no level may remove, with and without "the": the Triage, security, ESCALATED, Harden, Validate, CI, Verification, evidence and compliance controls. */
const FLOOR_NAMES = ['security', 'ESCALATED', 'compliance', 'Triage', 'Harden', 'Validate', 'validation', 'CI', 'verification', 'evidence'] as const
/** The dispositions that Triage gives a finding; a security or ESCALATED finding may go to none of them. */
const DISPOSITIONS = ['TECH_DEBT', 'FALSE_POSITIVE', 'BY_DESIGN', 'FIX_SEPARATE', 'DUPLICATE'] as const
/** Whole words for a shell, write, push, commit, post or GitHub action, which no row may add. */
const ACTION_WORDS = ['git', 'gh', 'push', 'pushes', 'pushed', 'pushing', 'commit', 'commits', 'committed', 'committing', 'write', 'writes', 'wrote', 'written', 'writing', 'post', 'posts', 'posted', 'posting', 'PR', 'Bash', 'GitHub'] as const

/** The array as regex source: each entry escaped, and a space in a phrase read as any run of spaces. */
const anyOf = (words: readonly string[]): string => words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')
const wholeWords = (words: readonly string[]): RegExp => new RegExp(`\\b(?:${anyOf(words)})\\b`, 'i')
const REMOVAL = `\\b(?:${anyOf(REMOVAL_STEMS)})\\w*|\\b(?:${anyOf(REMOVAL_WORDS)})\\b`
/** At most this many words may stand between a removal word and the control it removes, in one sentence. Farther apart, they are two clauses: "Pass no extra files to Validate". */
const NEAR_WORDS = 2
const NEAR = `(?:[^\\w.;:!?\\n]+\\w+){0,${NEAR_WORDS}}[^\\w.;:!?\\n]+`

const SECURITY = /\bsecurity\b/i
const ESCALATED = /\bESCALATED\b/i
const DISPOSITION = wholeWords(DISPOSITIONS)
const ACTION = new RegExp(`\`\`\`|${wholeWords(ACTION_WORDS).source}`, 'i')

/** A removal word within NEAR_WORDS of a floor name or of a protected phase named by its number ("Phase 7"), in either order. */
function removalPattern(floorPhases: readonly string[]): RegExp {
  const names = `\\b(?:${anyOf(FLOOR_NAMES)})\\b`
  const floor = floorPhases.length === 0 ? names : `${names}|\\bPhases?\\s+(?:${anyOf(floorPhases)})\\b`
  return new RegExp(`(?:${REMOVAL})${NEAR}(?:${floor})|(?:${floor})${NEAR}(?:${REMOVAL})`, 'i')
}

/** Why one cell or one Rules bullet is unsafe, as phrases. The match is case-insensitive and on word boundaries. `floorPhases` are the phase numbers that no row may skip. */
function unsafeReasons(text: string, floorPhases: readonly string[]): string[] {
  const out: string[] = []
  if (removalPattern(floorPhases).test(text)) out.push('removes or defers a floor control')
  if (SECURITY.test(text) && DISPOSITION.test(text)) out.push('routes a security finding to a disposition')
  if (ESCALATED.test(text) && DISPOSITION.test(text)) out.push('routes an ESCALATED finding to a disposition')
  if (ACTION.test(text)) out.push('adds a shell, write, push or GitHub action')
  return out
}

/**
 * AC-6: a tripwire, not a guarantee. It catches the known unsafe words, not every unsafe meaning. The `## Phases` intro,
 * the `## Grammar` text and the `## Rules` intro are pinned; a row for a protected phase (every compiled phase outside
 * the closed set) is rejected; every cell and every Rules bullet is checked; a Rules bullet that no row names is rejected.
 */
export function collectRowSafetyDefects(ref: string, spec: LevelSpec, body: string): string[] {
  const out: string[] = []
  const parsed = parseRef(ref)
  if (parsed.preamble.length > 0) out.push('the reference holds text between its title and "## Phases"')
  const prose = (sectionOf(parsed, '## Phases')?.lines ?? []).filter(line => !line.startsWith('|'))
  if (prose.join('\n') !== spec.intro) out.push('the "## Phases" intro is not the pinned paragraph')
  if ((sectionOf(parsed, '## Grammar')?.lines ?? []).join('\n') !== spec.grammar.join('\n')) out.push('the "## Grammar" text is not the pinned text')
  const rules = sectionOf(parsed, '## Rules')?.lines ?? []
  if (rules.filter(line => !line.startsWith('- ')).join('\n') !== RULES_INTRO) out.push('the "## Rules" section holds text other than the pinned intro and its bullets')

  const guarded = protectedOf(spec, body)
  const floorPhases = [...guarded, ...spec.neverSkip]
  const applied = new Set<string>()
  for (const line of referenceRows(ref)) {
    const cells = splitRow(line)
    if (cells === null || cells.length !== 3) continue
    const [phase, ...levels] = cells
    const num = /^(\d+[a-z]?)(?: |$)/.exec(phase)?.[1]
    if (num === undefined) { out.push(`a row phase "${phase}" does not open with a phase number`); continue }
    if (guarded.includes(num)) out.push(`a row for protected phase ${num}`)
    else if (!spec.closed.some(([n]) => n === num)) out.push(`a row for phase ${num}, which is outside the closed set`)
    levels.forEach((cell, i) => {
      const column = i === 0 ? 'standard' : 'lean'
      for (const reason of unsafeReasons(cell, floorPhases)) out.push(`row ${num} ${column} cell "${cell}" ${reason}`)
      for (const m of cell.matchAll(/apply: ([^;]+)/g)) applied.add(m[1].trim())
      if (spec.neverSkip.includes(num) && cell === 'skip') out.push(`row ${num} ${column} cell ${takesSkip(num)}`)
    })
  }
  for (const line of rules.filter(l => l.startsWith('- '))) {
    const name = /^- \*\*([^*:]+):\*\*/.exec(line)?.[1] ?? line.slice(0, 40)
    for (const reason of unsafeReasons(line, floorPhases)) out.push(`Rules bullet "${name}" ${reason}`)
    if (!applied.has(name)) out.push(`Rules bullet "${name}" is named by no row`)
  }
  return out
}

// ---------------------------------------------------------------------------
// f. Full reads nothing
// ---------------------------------------------------------------------------

/**
 * AC-2: the level reference is named once, inside the block, and the read is conditioned on the level. The
 * `/resolve` Phase 7 Validate fence holds no `GATE_LEVEL`: the Verification Gate does not run the lint pack.
 */
export function collectFullPathDefects(body: string, spec: LevelSpec): string[] {
  const out: string[] = []
  const start = body.indexOf(OPEN)
  const read = start === -1 ? '' : body.slice(start).split('\n\n')[0]
  const mentions = countOf(body, spec.refFile)
  if (mentions !== 1) out.push(`${spec.refFile} is named ${mentions} times, expected once, inside the Gate level block`)
  else if (!read.includes(spec.refFile)) out.push(`the one mention of ${spec.refFile} is outside the Gate level block`)
  if (!read.includes(spec.levelCondition)) out.push(`the read is not conditioned on "${spec.levelCondition}"`)
  if (spec.cmd === 'resolve') {
    const fences = parseFences(sectionBetween(body, '### Phase 7: Verification Gate', '### Phase 8:') ?? '').filter(f => isAgentBlock(f, 'Validate'))
    if (fences.length !== 1) out.push(`Phase 7 holds ${fences.length} Validate fences, expected 1`)
    else if (fences[0].includes('GATE_LEVEL')) out.push('the Phase 7 Validate fence names GATE_LEVEL')
  }
  return out
}

// ---------------------------------------------------------------------------
// g. Report lines
// ---------------------------------------------------------------------------

/** AC-4: the `/implement` report, the `/resolve` display and the `resolution-summary.md` header name the level. */
export function collectReportDefects(body: string, spec: LevelSpec): string[] {
  const out: string[] = []
  if (spec.cmd === 'implement') {
    const phase12 = sectionBetween(body, '### Phase 12: Report', null)
    if (phase12 === null) return ['no Phase 12']
    if (countOf(phase12, IMPLEMENT_REPORT) !== 1) out.push(`the Phase 12 report line is not the pinned sentence: ${IMPLEMENT_REPORT}`)
    return out
  }
  if (countOf(body, RESOLVE_DISPLAY) !== 1) out.push('the display lacks the Gate level line between **Total Issues** and ### Results')
  const at = body.indexOf(RESOLVE_HEADER)
  if (at === -1 || countOf(body, RESOLVE_HEADER) !== 1) out.push('the summary template lacks the Gate level line right after **Command**: /resolve')
  else if (!/^## (?:Decisions Citations|Statistics)\n/.test(body.slice(at + RESOLVE_HEADER.length))) out.push('the Gate level header line is not followed by the learning arm or ## Statistics')
  return out
}

// ---------------------------------------------------------------------------
// h. Cut routes
// ---------------------------------------------------------------------------

/** A1: the empty-FIX_NOW route and the route after push pass no phase that pushes, the principles are numbered 1 to 3. */
export function collectCutRouteDefects(body: string): string[] {
  const out: string[] = []
  const lines = body.split('\n')
  const empty = lines.filter(line => line.startsWith('If FIX_NOW list is empty:'))
  if (empty.length !== 1) out.push(`the empty FIX_NOW route appears ${empty.length} times, expected once`)
  else {
    if (empty[0] !== ROUTE_EMPTY) out.push(`the empty FIX_NOW route is not the pinned sentence: ${empty[0].slice(0, 200)}`)
    const named = [...new Set(empty[0].match(/\b\d+[bc]?\b/g) ?? [])]
    for (const n of named.filter(p => ['6', '7', '8'].includes(p))) out.push(`the empty FIX_NOW route names Phase ${n}`)
    const namedSorted = [...named].sort().join(', ')
    const expectedSorted = [...ROUTE_EMPTY_PHASES].sort().join(', ')
    if (namedSorted !== expectedSorted) out.push(`the empty FIX_NOW route names phases ${namedSorted}, expected ${expectedSorted}`)
  }
  const push = lines.filter(line => line.startsWith('**Route after push:**'))
  if (push.length !== 1) out.push(`the route after push appears ${push.length} times, expected once`)
  else {
    if (push[0] !== ROUTE_PUSH) out.push(`the route after push is not the pinned sentence: ${push[0].slice(0, 200)}`)
    if (!push[0].endsWith('and the later phases in order.')) out.push('the route after push does not end "and the later phases in order."')
  }
  const principles = sectionBetween(body, '## Principles', '## Output Artifact')
  if (principles === null) out.push('no "## Principles" section')
  else {
    const numbers = [...principles.matchAll(/^(\d+)\. /gm)].map(m => m[1])
    if (numbers.join(', ') !== '1, 2, 3') out.push(`the principles are numbered ${numbers.join(', ')}, expected 1, 2, 3`)
    if (!principles.includes('1. **Orchestration only**')) out.push('Principle 1 (**Orchestration only**) is missing')
  }
  return out
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

interface Build { readonly label: string; readonly spec: LevelSpec; readonly body: string }

const BUILDS: readonly Build[] = SPECS.flatMap(spec => {
  const off = resolveLearningOffSource('commands', spec.cmd)
  if (off === null) throw new Error(`dist/learning-off/commands/${spec.cmd}.md is absent: run \`npm run build:mds\``)
  return [
    { label: `${spec.cmd}, learning on`, spec, body: requireDistFile(`${spec.cmd}.md`) },
    { label: `${spec.cmd}, learning off`, spec, body: off },
  ]
})
const bodyOf = (spec: LevelSpec): string => BUILDS.find(b => b.spec === spec)?.body ?? ''
const REFS: Readonly<Record<string, string>> = {
  implement: readAgentReference('commands/implement-levels.md'),
  resolve: readAgentReference('commands/resolve-levels.md'),
}
const SOURCES: Readonly<Record<string, string>> = {
  implement: readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'implement.mds'), 'utf-8'),
  resolve: readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8'),
}
const VALIDATE = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'validate.md'), 'utf-8')

/** Replace `from` with `to` in `body`, failing the test when the seed did not land. */
function seed(body: string, from: string | RegExp, to: string): string {
  const next = typeof from === 'string' ? body.replace(from, () => to) : body.replace(from, to)
  expect(next, `the seed ${String(from).slice(0, 60)} must change the text`).not.toBe(body)
  return next
}

/** Replace `from` with `to` inside the section between two anchors only, and splice the section back. */
function seedIn(body: string, start: string, end: string | null, from: string | RegExp, to: string): string {
  const section = sectionBetween(body, start, end)
  expect(section, `no section from "${start}"`).not.toBeNull()
  const text = section as string
  const at = body.indexOf(text)
  return body.slice(0, at) + seed(text, from, to) + body.slice(at + text.length)
}

/** The reference with rows after its separator and bullets after its Rules intro. */
function withRows(ref: string, rows: readonly string[], bullets: readonly string[] = []): string {
  let next = ref
  if (rows.length > 0) next = seed(next, `${TABLE_SEPARATOR}\n`, `${TABLE_SEPARATOR}\n${rows.join('\n')}\n`)
  if (bullets.length > 0) next = seed(next, RULES_INTRO, `${RULES_INTRO}\n\n${bullets.join('\n')}`)
  return next
}

/** A probe seeds text inside the block, so it first checks that the compiled command carries the pinned read paragraph: without it the probe fails for that reason. */
function needsBlock(body: string, spec: LevelSpec): void {
  expect(body.includes(spec.readParagraph), `the compiled ${spec.cmd} lacks the pinned Gate level read paragraph`).toBe(true)
}

/** The block taken out of its place and put in front of `spec.moveBefore`. */
function movedBlock(body: string, spec: LevelSpec): string {
  const block = blockText(spec)
  return seed(seed(body, `${block}\n\n`, ''), spec.moveBefore, `${block}\n\n${spec.moveBefore}`)
}

/** One word taken out of `text`: its second word. */
const dropWord = (text: string): string => text.replace(/ \S+/, '')

describe('the corpus is real', () => {
  it('reads both builds of both commands, both sources, both references and the Validate agent', () => {
    expect(BUILDS).toHaveLength(4)
    for (const { label, body } of BUILDS) expect(body.length, `${label}: nothing read`).toBeGreaterThan(5000)
    for (const spec of SPECS) {
      expect(REFS[spec.cmd].length, `${spec.cmd}: the level reference is empty`).toBeGreaterThan(400)
      expect(SOURCES[spec.cmd].length, `${spec.cmd}: the command source is empty`).toBeGreaterThan(5000)
    }
    expect(VALIDATE.length, 'the Validate agent is empty').toBeGreaterThan(1000)
  })
})

// ---------------------------------------------------------------------------
// d. The reference grammar
// ---------------------------------------------------------------------------

describe('the level references hold the fixed grammar and no rows (AC-5)', () => {
  it.each(BUILDS)('$label: the reference is well formed against the compiled command, and the closed set matches its headings', ({ spec, body }) => {
    expect(collectLevelReferenceDefects(REFS[spec.cmd], spec, body)).toEqual([])
    expect(collectClosedSetDefects(spec, body)).toEqual([])
  })

  it.each(SPECS)('$cmd: the table has no rows, and the Rules section has no bullets', spec => {
    expect(referenceRows(REFS[spec.cmd])).toEqual([])
    expect((sectionOf(parseRef(REFS[spec.cmd]), '## Rules')?.lines ?? []).filter(line => line.startsWith('- '))).toEqual([])
  })

  it.each(SPECS)('$cmd: the reference holds no spawn block, no subagent_type and no learning marker, and a seeded one is reported', spec => {
    const ref = REFS[spec.cmd]
    expect(ref).not.toContain('Agent(')
    expect(ref).not.toContain('subagent_type')
    expect(ref).not.toMatch(/<!-- learning:/)
    const defects = (text: string): string[] => collectLevelReferenceDefects(text, spec, bodyOf(spec))
    expect(defects(`${ref}\nAgent(subagent_type="Design"):\n`)).toEqual(expect.arrayContaining(['the reference carries a spawn block', 'the reference carries a subagent_type field']))
    expect(defects(`${ref}\n<!-- learning:on -->\n`)).toContain('the reference carries a learning marker')
  })

  it.each(SPECS)('$cmd: known-bad probes: a missing heading, a changed title or header, a bad phase, a bad cell and an unknown bullet are each reported', spec => {
    const ref = REFS[spec.cmd]
    const body = bodyOf(spec)
    const defects = (text: string): string[] => collectLevelReferenceDefects(text, spec, body)
    const sample = spec.sampleRow
    const num = sample.split(' ')[0]
    expect(defects(seed(ref, '## Phases\n', ''))).toContain('no "## Phases" heading')
    expect(defects(seed(ref, '## Grammar\n', ''))).toContain('no "## Grammar" heading')
    expect(defects(seed(ref, '## Rules\n', ''))).toContain('no "## Rules" heading')
    expect(defects(seed(ref, spec.title, '# Levels'))).toContain(`the reference does not open with "${spec.title}"`)
    expect(defects(seed(ref, TABLE_HEADER, '| Phase | standard, lean |'))).toContain(`the table header is "| Phase | standard, lean |", expected "${TABLE_HEADER}"`)
    expect(defects(seed(ref, TABLE_HEADER, '| Phase | full | standard | lean |'))).toContain(`the table header is "| Phase | full | standard | lean |", expected "${TABLE_HEADER}"`)
    expect(defects(seed(ref, TABLE_SEPARATOR, '|---|---|---|'))).toContain(`the table separator is "|---|---|---|", expected "${TABLE_SEPARATOR}"`)
    expect(defects(withRows(ref, [`| ${num} | skip | skip |`]))).toContain(`a row phase is not "<number> <name>": ${num}`)
    expect(defects(withRows(ref, [`| ${sample} | skip |`]))).toContain(`a row does not have three cells: | ${sample} | skip |`)
    expect(defects(withRows(ref, [`| ${sample} | drop: x | - |`]))).toContain(`row ${num} standard: the cell holds "drop: x", which is not skip, -, apply: <name> or pass level`)
    expect(defects(withRows(ref, [`| ${sample} | - | apply: nosuch |`]))).toContain(`row ${num} lean: the cell applies "nosuch", which no Rules bullet names`)
    expect(defects(withRows(ref, [`| ${sample} | skip; pass level | - |`]))).toContain(`row ${num} standard: the cell holds "skip", which is not skip, -, apply: <name> or pass level`)
    expect(defects(withRows(ref, [`| ${sample} | pass level; pass level | - |`]))).toContain(`row ${num} standard: the cell repeats "pass level"`)
    expect(defects(withRows(ref, [`| ${sample} | apply: a, b | - |`], ['- **a:** Polish the diff.']))).toContain(`row ${num} standard: the cell holds "apply: a, b", which is not skip, -, apply: <name> or pass level`)
    expect(defects(withRows(ref, [], ['- Polish the diff.']))).toContain('a Rules bullet does not open "- **<name>:**": - Polish the diff.')
    expect(defects(withRows(ref, [], ['- **a:** Polish the diff.', '- **a:** Polish it again.']))).toContain('the Rules bullet "a" is repeated')
  })

  it('known-bad probes: the phase set is closed and keyed by the compiled heading name', () => {
    const impl = (rows: string[]): string[] => collectLevelReferenceDefects(withRows(REFS.implement, rows), IMPLEMENT, bodyOf(IMPLEMENT))
    expect(impl(['| 4 Polish | - | skip |'])).toEqual(expect.arrayContaining(['phase 4 is named "Polish", expected "Self-Review"', 'phase 4 "Polish" is not the compiled "### Phase 4:" heading ("Self-Review")']))
    expect(impl(['| 6 Validate | skip | skip |'])).toContain('a row for phase 6, which is outside the closed set 3, 4, 5')
    expect(impl(['| 12 Report | skip | skip |'])).toContain('a row for phase 12, which is outside the closed set 3, 4, 5')
    const res = (rows: string[]): string[] => collectLevelReferenceDefects(withRows(REFS.resolve, rows), RESOLVE, bodyOf(RESOLVE))
    expect(res(['| 9 Thread Resolution | skip | skip |'])).toContain('phase 9 is named "Thread Resolution", expected "Manage Debt"')
    expect(res(['| 9b Thread Resolution + Resolution Comment | skip | skip |'])).toContain('a row for phase 9b, which is outside the closed set 2, 3, 4, 6, 9')
    expect(res(['| 9c Merge Readiness | skip | skip |'])).toContain('a row for phase 9c, which is outside the closed set 2, 3, 4, 6, 9')
    expect(res(['| 9 Manage Debt | skip | skip |'])).toEqual(['row 9 standard: the cell takes skip, which phase 9 never takes', 'row 9 lean: the cell takes skip, which phase 9 never takes'])
    const renamed = bodyOf(IMPLEMENT).replace('\n### Phase 3: Polish\n', '\n### Phase 3: Tidy\n')
    expect(renamed, 'the heading seed landed').not.toBe(bodyOf(IMPLEMENT))
    expect(collectClosedSetDefects(IMPLEMENT, renamed)).toContain('the closed set names "3 Polish", but the compiled "### Phase 3:" heading is "Tidy"')
    expect(collectLevelReferenceDefects(withRows(REFS.implement, ['| 3 Polish | skip | skip |']), IMPLEMENT, renamed)).toContain('phase 3 "Polish" is not the compiled "### Phase 3:" heading ("Tidy")')
    const grown = `${bodyOf(RESOLVE)}\n### Phase 11: Extra\n`
    expect(collectClosedSetDefects(RESOLVE, grown)).toContain('the protected phases are 0, 1, 1b, 5, 7, 8, 9b, 9c, 10, 11, expected 0, 1, 1b, 5, 7, 8, 9b, 9c, 10')
  })

  it('known-bad probes (/resolve): a skip on a never-skip phase is reported, and Polish alone may skip', () => {
    const res = (rows: string[]): string[] => collectLevelReferenceDefects(withRows(REFS.resolve, rows), RESOLVE, bodyOf(RESOLVE))
    const never = RESOLVE.closed.filter(([n]) => RESOLVE.neverSkip.includes(n))
    expect(never.map(([n]) => n), 'the never-skip phases').toEqual(['2', '3', '4', '9'])
    for (const [num, name] of never) {
      expect(res([`| ${num} ${name} | skip | - |`]), `${num} standard`).toEqual([`row ${num} standard: the cell takes skip, which phase ${num} never takes`])
      expect(res([`| ${num} ${name} | - | skip |`]), `${num} lean`).toEqual([`row ${num} lean: the cell takes skip, which phase ${num} never takes`])
    }
    expect(res(['| 3 Batch FIX_NOW Issues | - | skip |'])).toEqual(['row 3 lean: the cell takes skip, which phase 3 never takes'])
    expect(res(['| 4 Fix | skip | - |'])).toEqual(['row 4 standard: the cell takes skip, which phase 4 never takes'])
    expect(res(['| 6 Polish | skip | skip |']), 'Polish may skip').toEqual([])
  })

  it('known-bad probes: pass level needs a spawn prompt to carry the line', () => {
    const res = (rows: string[]): string[] => collectLevelReferenceDefects(withRows(REFS.resolve, rows), RESOLVE, bodyOf(RESOLVE))
    expect(phaseSection(bodyOf(RESOLVE), '3'), 'Phase 3 of /resolve spawns no agent').not.toMatch(/\bAgent\(/)
    expect(res(['| 3 Batch FIX_NOW Issues | pass level | - |'])).toEqual(['row 3 standard: the cell takes pass level, but phase 3 has no spawn to carry it'])
    expect(res(['| 3 Batch FIX_NOW Issues | - | pass level |'])).toEqual(['row 3 lean: the cell takes pass level, but phase 3 has no spawn to carry it'])
    const bare = seedIn(bodyOf(IMPLEMENT), '### Phase 3: Polish', '### Phase 4:', 'Agent(subagent_type="Polish"):', 'Run the Polish step:')
    expect(collectLevelReferenceDefects(withRows(REFS.implement, ['| 3 Polish | pass level | - |']), IMPLEMENT, bare)).toEqual(['row 3 standard: the cell takes pass level, but phase 3 has no spawn to carry it'])
    expect(collectLevelReferenceDefects(withRows(REFS.implement, ['| 3 Polish | pass level | - |']), IMPLEMENT, bodyOf(IMPLEMENT)), 'the unmodified Phase 3 spawns Polish').toEqual([])
  })

  it.each(SPECS)('$cmd: well-formed rows and bullets pass the grammar and the row-safety check', spec => {
    const body = bodyOf(spec)
    const rows = spec.cmd === 'implement'
      ? ['| 3 Polish | apply: tidy; pass level | skip |', '| 4 Self-Review | - | pass level |', '| 5 Alignment Check | pass level | apply: tidy |']
      : ['| 2 Global Triage | pass level | pass level |', '| 3 Batch FIX_NOW Issues | apply: tidy | - |', '| 4 Fix | - | pass level |', '| 6 Polish | apply: tidy | skip |', '| 9 Manage Debt | pass level | - |']
    const ref = withRows(REFS[spec.cmd], rows, ['- **tidy:** Polish only the files named in the diff.'])
    expect(collectLevelReferenceDefects(ref, spec, body)).toEqual([])
    expect(collectRowSafetyDefects(ref, spec, body)).toEqual([])
    expect(referenceRows(ref)).toEqual(rows)
  })
})

// ---------------------------------------------------------------------------
// e. Row safety
// ---------------------------------------------------------------------------

describe('row safety is a tripwire over the references (AC-6)', () => {
  it.each(BUILDS)('$label: the empty tables and empty Rules sections pass, and the pinned text is the file', ({ spec, body }) => {
    expect(collectRowSafetyDefects(REFS[spec.cmd], spec, body)).toEqual([])
  })

  it('the pinned text is the reference, and the protected phases are the complement of the closed set', () => {
    for (const spec of SPECS) {
      const parsed = parseRef(REFS[spec.cmd])
      expect(sectionOf(parsed, '## Phases')?.lines.filter(line => !line.startsWith('|')), `${spec.cmd}: the intro`).toEqual([spec.intro])
      expect(sectionOf(parsed, '## Grammar')?.lines, `${spec.cmd}: the grammar`).toEqual(spec.grammar)
      expect(sectionOf(parsed, '## Rules')?.lines, `${spec.cmd}: the Rules section`).toEqual([RULES_INTRO])
      expect(protectedOf(spec, bodyOf(spec)), `${spec.cmd}: the protected phases`).toEqual(spec.protectedPhases)
      const neverLine = spec.grammar.find(line => line.startsWith('- **Never skip:**')) ?? ''
      for (const [num, name] of spec.closed) {
        expect(neverLine.includes(`\`${num} ${name}\``), `${spec.cmd}: the Never skip bullet names phase ${num} exactly when the spec lists it`).toBe(spec.neverSkip.includes(num))
      }
    }
  })

  it('known-bad probes (/implement): a row for a protected phase is reported', () => {
    const defects = (rows: string[]): string[] => collectRowSafetyDefects(withRows(REFS.implement, rows), IMPLEMENT, bodyOf(IMPLEMENT))
    expect(defects(['| 6 Validate | skip | skip |'])).toContain('a row for protected phase 6')
    for (const phase of ['1 Setup', '2 Implement', '7 QA Testing', '8 Re-Validate', '9 Open PR', '10 CI Status Gate', '11 Evidence', '12 Report']) {
      expect(defects([`| ${phase} | skip | - |`]), phase).toContain(`a row for protected phase ${phase.split(' ')[0]}`)
    }
  })

  it('known-bad probes (/resolve): a row for a protected phase or a skipped never-skip phase is reported', () => {
    const defects = (rows: string[]): string[] => collectRowSafetyDefects(withRows(REFS.resolve, rows), RESOLVE, bodyOf(RESOLVE))
    expect(defects(['| 7 Verification Gate | skip | skip |'])).toContain('a row for protected phase 7')
    expect(defects(['| 8 CI Status Gate | skip | skip |'])).toContain('a row for protected phase 8')
    expect(defects(['| 5 Write resolution-summary.md | skip | - |'])).toContain('a row for protected phase 5')
    expect(defects(['| 9b Thread Resolution + Resolution Comment | skip | skip |'])).toContain('a row for protected phase 9b')
    expect(defects(['| 9c Merge Readiness | skip | skip |'])).toContain('a row for protected phase 9c')
    expect(defects(['| 0 Worktree Discovery & Pre-Flight | skip | skip |'])).toContain('a row for protected phase 0')
    expect(defects(['| 10 Report | - | skip |'])).toContain('a row for protected phase 10')
    for (const [num, name] of RESOLVE.closed.filter(([n]) => RESOLVE.neverSkip.includes(n))) {
      expect(defects([`| ${num} ${name} | skip | - |`]), `${num} standard`).toContain(`row ${num} standard cell takes skip, which phase ${num} never takes`)
      expect(defects([`| ${num} ${name} | - | skip |`]), `${num} lean`).toContain(`row ${num} lean cell takes skip, which phase ${num} never takes`)
    }
    expect(defects(['| 2 Global Triage | pass level | - |'])).toEqual([])
    expect(defects(['| 6 Polish | skip | skip |']), 'Polish may skip').toEqual([])
  })

  it('known-bad probes (/resolve): the global phase takes the strictest level in the run, and the premise, the order and the exception are pinned', () => {
    const ref = REFS.resolve
    const defects = (text: string): string[] => collectRowSafetyDefects(text, RESOLVE, bodyOf(RESOLVE))
    const pinned = ['the "## Grammar" text is not the pinned text']
    expect(phaseSection(bodyOf(RESOLVE), '2'), 'one Triage spawn serves all worktrees').toContain('Spawn a single global Triage agent for ALL issues')
    expect(RESOLVE.readParagraph, 'the block applies a row in each worktree at its own level').toContain('in each worktree at its own level')
    expect(defects(ref), 'the unmodified reference').toEqual([])
    expect(defects(seed(ref, 'in the order `full`, `standard`, `lean`', 'in the order `lean`, `standard`, `full`')), 'the order reversed').toEqual(pinned)
    expect(defects(seed(ref, 'uses the strictest level in the run', 'uses its own level')), 'a phase on its own level').toEqual(pinned)
    expect(defects(seed(ref, ', except in a global phase', '')), 'the intro without the exception').toEqual(['the "## Phases" intro is not the pinned paragraph'])
  })

  it('known-bad probes (/implement): Harden is a floor word, and a 4 Self-Review skip cell is the one permitted removal', () => {
    const defects = (rows: string[], bullets: string[] = []): string[] => collectRowSafetyDefects(withRows(REFS.implement, rows, bullets), IMPLEMENT, bodyOf(IMPLEMENT))
    expect(phaseSection(bodyOf(IMPLEMENT), '4').match(/Agent\(subagent_type="\w+"/g), 'Harden is the only spawn of Phase 4').toEqual(['Agent(subagent_type="Harden"'])
    // The Scope line lets a 4 Self-Review row skip Harden, and an enabled compliance lens keeps Harden at run time, which a static check cannot see.
    expect(defects(['| 4 Self-Review | - | skip |'])).toEqual([])
    expect(defects(['| 4 Self-Review | skip | skip |'])).toEqual([])
    // Any other way to drop Harden, in a cell name or a Rules bullet, removes a floor control.
    expect(defects(['| 4 Self-Review | apply: skip-harden | - |'], ['- **skip-harden:** Run the spawn.'])).toContain('row 4 standard cell "apply: skip-harden" removes or defers a floor control')
    expect(defects(['| 3 Polish | apply: tidy | - |'], ['- **tidy:** Skip Harden after Polish.'])).toContain('Rules bullet "tidy" removes or defers a floor control')
    expect(defects(['| 3 Polish | apply: tidy | - |'], ['- **tidy:** Polish only the files named in the diff.'])).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: a Rules bullet that removes a floor control, routes security, adds an action or is named by no row is reported', spec => {
    const body = bodyOf(spec)
    const row = spec.sampleRow
    const defects = (bullet: string): string[] => collectRowSafetyDefects(withRows(REFS[spec.cmd], [`| ${row} | apply: probe | - |`], [`- **probe:** ${bullet}`]), spec, body)
    const floor = 'Rules bullet "probe" removes or defers a floor control'
    const routesSecurity = 'Rules bullet "probe" routes a security finding to a disposition'
    const routesEscalated = 'Rules bullet "probe" routes an ESCALATED finding to a disposition'
    // A removal verb that precedes the floor name.
    const verbs = ['Drop the security check.', 'Turn off ESCALATED routing.', 'Bypass the compliance directive.', 'Skip Validate.', 'Skip Harden.', 'Omit the CI gate.', 'Ignore the Verification Gate.', 'Defer the evidence claims.', 'Run without security review.', 'Disable compliance.', 'Remove ESCALATED.', 'No security check.', 'BYPASS THE COMPLIANCE DIRECTIVE.']
    // A negation, stop, leave out or cut, on either side of the floor name.
    const negations = ['Validate does not run.', 'Never run Validate.', 'Do not spawn Validate.', "Don't run Validate.", 'Stop Validate.', 'Leave out Validate.', 'Cut the CI gate.']
    // A floor name without "the", and the names Triage, validation, verification, evidence and CI alone.
    const bareNames = ['Skip Verification Gate.', 'Skip CI.', 'Omit CI gate.', 'Defer evidence claims.', 'Skip validation.', 'Skip Triage.', 'Skip the Triage agent and treat every finding as FIX_NOW.']
    // A protected phase named by its number: the Verification Gate and the CI gate are Phases 7 and 8 of /resolve.
    const phases = ['Skip Phase 7 and Phase 8.', 'Do not run Phase 7.']
    for (const bullet of [...verbs, ...negations, ...bareNames, ...phases]) expect(defects(bullet), bullet).toContain(floor)
    expect(defects('Route security findings to TECH_DEBT.')).toContain(routesSecurity)
    expect(defects('Mark every security finding FALSE_POSITIVE.')).toContain(routesSecurity)
    expect(defects('Send a security finding to BY_DESIGN.')).toContain(routesSecurity)
    expect(defects('Send a security finding to FIX_SEPARATE.')).toContain(routesSecurity)
    expect(defects('Mark security findings DUPLICATE.')).toContain(routesSecurity)
    expect(defects('Route ESCALATED findings to TECH_DEBT.')).toContain(routesEscalated)
    expect(defects('Treat ESCALATED as DUPLICATE.')).toContain(routesEscalated)
    const action = 'Rules bullet "probe" adds a shell, write, push or GitHub action'
    for (const bullet of ['Run git push after the spawn.', 'Call gh pr comment.', 'Use the Write tool on the summary.', 'Run Bash to count lines.', 'Post to GitHub.', 'Commit the result.', 'Write the summary to disk.', 'Post a PR comment.']) expect(defects(bullet), bullet).toContain(action)
    expect(defects('Run `x` in a fence: ```sh\nls\n```')).toContain(action)
    expect(defects('Polish only the files named in the diff.'), 'a safe bullet').toEqual([])
    // "no" and "not" here do not apply to Validate: the removal word and the floor name are too far apart to read as one clause.
    expect(defects('Pass no extra files to Validate.'), 'a safe bullet with no and Validate').toEqual([])
    expect(defects('Run Validate on files that are not generated.'), 'a safe bullet with not and Validate').toEqual([])
    const unnamed = collectRowSafetyDefects(withRows(REFS[spec.cmd], [], ['- **tidy:** Polish only the files named in the diff.']), spec, body)
    expect(unnamed).toEqual(['Rules bullet "tidy" is named by no row'])
  })

  it('known-bad probes (/resolve): a never-skip phase is named by its number, and Polish alone may be skipped by number', () => {
    const defects = (bullet: string): string[] => collectRowSafetyDefects(withRows(REFS.resolve, ['| 6 Polish | apply: probe | - |'], [`- **probe:** ${bullet}`]), RESOLVE, bodyOf(RESOLVE))
    const floor = 'Rules bullet "probe" removes or defers a floor control'
    for (const num of RESOLVE.neverSkip) expect(defects(`Skip Phase ${num}.`), `Phase ${num}`).toContain(floor)
    expect(defects('Skip Phase 6.'), 'Polish may skip').toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: a cell that removes a floor control, a changed Grammar word and a changed Phases intro are reported', spec => {
    const ref = REFS[spec.cmd]
    const body = bodyOf(spec)
    const row = spec.sampleRow
    const num = row.split(' ')[0]
    expect(collectRowSafetyDefects(withRows(ref, [`| ${row} | apply: bypass-security | - |`], ['- **bypass-security:** Polish the diff.']), spec, body))
      .toContain(`row ${num} standard cell "apply: bypass-security" removes or defers a floor control`)
    expect(collectRowSafetyDefects(seed(ref, 'without a trailing parenthetical', 'without its parenthetical'), spec, body)).toEqual(['the "## Grammar" text is not the pinned text'])
    expect(collectRowSafetyDefects(seed(ref, 'a table with no rows is well-formed', 'a table with no rows is well formed'), spec, body)).toEqual(['the "## Phases" intro is not the pinned paragraph'])
    expect(collectRowSafetyDefects(seed(ref, 'reads `skipped`', 'reads `PASS`'), spec, body), 'the Skipped bullet').toEqual(['the "## Grammar" text is not the pinned text'])
    expect(collectRowSafetyDefects(seed(ref, 'to every spawn prompt of the phase, and a phase with no spawn never takes `pass level`', "to the phase's spawn prompt"), spec, body), 'the pass level target').toEqual(['the "## Grammar" text is not the pinned text'])
    expect(collectRowSafetyDefects(seed(ref, RULES_INTRO, `${RULES_INTRO} Extra.`), spec, body)).toEqual(['the "## Rules" section holds text other than the pinned intro and its bullets'])
    expect(collectRowSafetyDefects(withRows(ref, [], ['- **tidy:** Polish the diff.\ncontinued here']), spec, body)).toContain('the "## Rules" section holds text other than the pinned intro and its bullets')
    expect(collectRowSafetyDefects(seed(ref, '## Phases\n', 'Stray text.\n\n## Phases\n'), spec, body)).toContain('the reference holds text between its title and "## Phases"')
  })

  it('known-bad probes: a phase added to the command is protected by default, and a phase renamed in the closed set is reported', () => {
    const grown = `${bodyOf(IMPLEMENT)}\n### Phase 13: Extra\n`
    expect(collectRowSafetyDefects(withRows(REFS.implement, ['| 13 Extra | skip | skip |']), IMPLEMENT, grown)).toContain('a row for protected phase 13')
    expect(collectRowSafetyDefects(withRows(REFS.implement, ['| 13 Extra | skip | skip |']), IMPLEMENT, bodyOf(IMPLEMENT))).toContain('a row for phase 13, which is outside the closed set')
  })
})

// ---------------------------------------------------------------------------
// a. The block
// ---------------------------------------------------------------------------

describe('the command carries one Gate level block, closed and in its place (AC-3, AC-6)', () => {
  it.each(BUILDS)('$label: the read paragraph, the three bullets, the place and the neighbours', ({ spec, body }) => {
    expect(collectLevelBlockDefects(body, spec)).toEqual([])
  })

  it.each(SPECS)('$cmd: the source holds the block outside every learning arm', spec => {
    expect(collectBlockArmDefects(SOURCES[spec.cmd], spec)).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: each floor line with a word dropped, and each read phrase removed, is reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const defects = (text: string): string[] => collectLevelBlockDefects(text, spec)
    expect(spec.items[0], 'the first floor line is the override line').toBe(FLOOR_FIRST)
    for (const item of spec.items) {
      expect(defects(seed(body, `- ${item}`, `- ${dropWord(item)}`)), `dropping a word of "${item.slice(0, 40)}"`).toContain(`the block lacks: ${item.slice(0, 60)}`)
    }
    for (const phrase of [spec.levelCondition.split(',')[0], SANCTIONED_RESOLUTION, 'with the Read tool', 'once per run', 'apply each row to the phase it names']) {
      const edited = spec.readParagraph.replace(phrase, 'removed')
      expect(edited, `"${phrase.slice(0, 40)}" is in the read paragraph`).not.toBe(spec.readParagraph)
      expect(defects(seed(body, spec.readParagraph, edited)), `removing "${phrase.slice(0, 40)}"`).toEqual([notPinned(edited)])
    }
    expect(defects(seed(body, spec.readParagraph, spec.readParagraph.replace(`<that directory>/${LEVEL_DIR}`, '$HOME/.claude/skills')))).toEqual([notPinned(spec.readParagraph.replace(`<that directory>/${LEVEL_DIR}`, '$HOME/.claude/skills'))])
    expect(defects(seed(body, spec.readParagraph, spec.readParagraph.replace(SANCTIONED_RESOLUTION, 'd="$HOME/.claude";')))).toEqual([notPinned(spec.readParagraph.replace(SANCTIONED_RESOLUTION, 'd="$HOME/.claude";'))])
    expect(defects(seed(body, OPEN, '**Level.**'))).toEqual(['no "**Gate level.**" block'])
  })

  it.each(SPECS)('$cmd: known-bad probes: an added bullet, a reordered bullet, a continuation line, an added paragraph and a second block are reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const defects = (text: string): string[] => collectLevelBlockDefects(text, spec)
    const notLines = (found: string[]): boolean => found.some(d => d.startsWith('the block lines are not the three pinned lines'))
    const last = spec.items[2]
    expect(notLines(defects(seed(body, `- ${last}`, `- ${last}\n- At \`lean\`, skip Validate.`))), 'an added bullet').toBe(true)
    expect(notLines(defects(seed(body, `- ${spec.items[1]}\n- ${last}`, `- ${last}\n- ${spec.items[1]}`))), 'two bullets in the other order').toBe(true)
    expect(notLines(defects(seed(body, `- ${last}`, `- ${last}\nAt \`lean\`, Validate does not run.`))), 'a continuation line under the bullets').toBe(true)
    expect(notLines(defects(seed(body, `- ${last}`, `- ${last} Validate does not run at lean.`))), 'a sentence added to a bullet').toBe(true)
    expect(defects(seed(body, `- ${last}\n\n`, `- ${last}\n\nAt \`lean\`, Validate does not run.\n\n`)), 'an added paragraph').toContain(`the block is not followed by "${spec.nextParagraph}"`)
    expect(defects(`${body}\n${OPEN} again.\n`), 'a second block').toContain(`the command holds more than one "${OPEN}" block`)
  })

  it.each(SPECS)('$cmd: known-bad probes: a block moved out of its place is reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const moved = collectLevelBlockDefects(movedBlock(body, spec), spec)
    if (spec.cmd === 'implement') expect(moved).toContain(spec.outsideMessage)
    else expect(moved).toEqual(expect.arrayContaining([`the block is not followed by "${spec.nextParagraph}"`, `the block does not follow "${spec.prevHas}"`]))
  })

  it.each(SPECS)('$cmd: known-bad probes: a block inside a learning arm of the source is reported', spec => {
    const source = SOURCES[spec.cmd]
    expect(source.includes(OPEN), `the ${spec.cmd} source lacks the Gate level block`).toBe(true)
    for (const arm of ['on', 'off']) {
      const wrapped = seed(seed(source, OPEN, `<!-- learning:${arm} -->\n${OPEN}`), spec.sourceEnd, `<!-- learning:end -->\n${spec.sourceEnd}`)
      expect(collectBlockArmDefects(wrapped, spec)).toEqual([`the gate-level block sits inside a learning:${arm} arm`])
    }
    expect(collectBlockArmDefects(seed(source, OPEN, '**Level.**'), spec)).toEqual(['the source has no gate-level block'])
  })
})

// ---------------------------------------------------------------------------
// b. Data flow
// ---------------------------------------------------------------------------

describe('the data flow lists GATE_LEVEL where the block and the reports use it (AC-3, AC-4)', () => {
  it.each(BUILDS)('$label: every Produces and Requires line that carries the level lists it', ({ spec, body }) => {
    expect(collectDataFlowDefects(body, spec)).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: each site without GATE_LEVEL is reported', spec => {
    const body = bodyOf(spec)
    expect(collectDataFlowDefects(body, spec), 'the unmodified data flow has no defect').toEqual([])
    for (const { site, kind, start, end } of spec.dataFlow) {
      const without = seedIn(body, start, end, new RegExp(`^(\\*\\*${kind}:\\*\\* .*?), GATE_LEVEL`, 'm'), '$1')
      expect(collectDataFlowDefects(without, spec), site).toEqual([`${site} ${kind} does not list GATE_LEVEL`])
    }
    expect(collectDataFlowDefects(seed(body, spec.dataFlow[0].start, '### Phase 99:'), spec)).toContain(`no ${spec.dataFlow[0].site} section from "${spec.dataFlow[0].start}"`)
  })
})

// ---------------------------------------------------------------------------
// c. Fail-closed and AC-9
// ---------------------------------------------------------------------------

describe('a failed read applies no row and keeps the level (AC-3, AC-9)', () => {
  it.each(BUILDS)('$label: the fail-closed bullet and, for /implement, the Phase 6 Validate prompt', ({ spec, body }) => {
    expect(collectFailClosedDefects(body, spec, VALIDATE)).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: the retired wording and a bullet without the header clause are reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const defects = (text: string): string[] => collectFailClosedDefects(text, spec, VALIDATE)
    const bullet = `- ${spec.items[1]}`
    const retired = '- If the Read fails, or a row is missing or malformed, set `GATE_LEVEL` to `full` and say `level reference unreadable: full applied`.'
    expect(defects(seed(body, bullet, retired))).toEqual(expect.arrayContaining(['the fail-closed bullet holds "full applied"', 'the fail-closed bullet sets GATE_LEVEL']))
    const clause = 'or the file has no `## Phases` heading with the `| Phase | standard | lean |` header, '
    expect(defects(seed(body, clause, ''))).toContain('the fail-closed bullet lacks: has no `## Phases` heading with the `| Phase | standard | lean |` header')
    expect(defects(seed(body, 'or a row breaks its grammar, ', ''))).toContain('the fail-closed bullet lacks: a row breaks its grammar')
    expect(defects(seed(body, spec.failClosed[2], 'apply nothing and'))).toContain(`the fail-closed bullet lacks: ${spec.failClosed[2]}`)
    expect(defects(seed(body, 'say `level reference unreadable: no level rows applied`', 'say nothing'))).toContain('the fail-closed bullet lacks: `level reference unreadable: no level rows applied`')
    expect(defects(seed(body, bullet, '- Something else.'))).toContain('the block has no fail-closed bullet ("If the Read fails")')
  })

  it('known-bad probes (/implement): a Phase 6 prompt without its level line and a Validate agent without its lean rule are reported', () => {
    const body = bodyOf(IMPLEMENT)
    const defects = (text: string, validate: string = VALIDATE): string[] => collectFailClosedDefects(text, IMPLEMENT, validate)
    expect(defects(seedIn(body, '### Phase 6: Validate', '### Phase 7:', '"GATE_LEVEL: {GATE_LEVEL}\n', '"'))).toContain('the Phase 6 Validate prompt does not open with GATE_LEVEL: {GATE_LEVEL}')
    expect(defects(seedIn(body, '### Phase 6: Validate', '### Phase 7:', 'Agent(subagent_type="Validate"):', 'Agent(subagent_type="Test"):'))).toContain('Phase 6 holds 0 Validate fences, expected 1')
    expect(defects(body, VALIDATE.replace('Only if the first `GATE_LEVEL:` line is exactly `lean`', 'Always'))).toContain('validate.md lacks "Only if the first `GATE_LEVEL:` line is exactly `lean`"')
    expect(VALIDATE, 'validate.md carries the rule').toContain('Only if the first `GATE_LEVEL:` line is exactly `lean`')
  })
})

// ---------------------------------------------------------------------------
// f. Full reads nothing
// ---------------------------------------------------------------------------

describe('full reads no level reference (AC-2)', () => {
  it.each(BUILDS)('$label: the reference path appears once, inside the block, under the level condition', ({ spec, body }) => {
    expect(collectFullPathDefects(body, spec)).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: a second mention and a removed level condition are reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const defects = (text: string): string[] => collectFullPathDefects(text, spec)
    expect(defects(`${body}\nRead ${spec.refFile} again.\n`)).toContain(`${spec.refFile} is named 2 times, expected once, inside the Gate level block`)
    expect(defects(seed(body, spec.levelCondition, 'Once per run'))).toContain(`the read is not conditioned on "${spec.levelCondition}"`)
  })

  it('known-bad probes (/resolve): a level line in the Phase 7 Validate fence is reported', () => {
    const body = bodyOf(RESOLVE)
    const defects = (text: string): string[] => collectFullPathDefects(text, RESOLVE)
    const withLevel = seedIn(body, '### Phase 7: Verification Gate', '### Phase 8:', 'Agent(subagent_type="Validate"):\n"', 'Agent(subagent_type="Validate"):\n"GATE_LEVEL: {GATE_LEVEL}\n')
    expect(defects(withLevel)).toContain('the Phase 7 Validate fence names GATE_LEVEL')
    expect(defects(seedIn(body, '### Phase 7: Verification Gate', '### Phase 8:', 'Agent(subagent_type="Validate"):', 'Agent(subagent_type="Test"):'))).toContain('Phase 7 holds 0 Validate fences, expected 1')
  })
})

// ---------------------------------------------------------------------------
// g. Report lines
// ---------------------------------------------------------------------------

describe('the report names the level (AC-4)', () => {
  it.each(BUILDS)('$label: the Phase 12 line, or the display and the summary header', ({ spec, body }) => {
    expect(collectReportDefects(body, spec)).toEqual([])
  })

  it('known-bad probes (/implement): the Phase 12 line without the level note is reported', () => {
    const body = bodyOf(IMPLEMENT)
    expect(collectReportDefects(body, IMPLEMENT), 'the unmodified Phase 12 line has no defect').toEqual([])
    expect(collectReportDefects(seed(body, '`Gate level: {GATE_LEVEL}` with any level note, ', ''), IMPLEMENT)).toEqual([`the Phase 12 report line is not the pinned sentence: ${IMPLEMENT_REPORT}`])
    expect(collectReportDefects(seed(body, 'with any level note, ', ''), IMPLEMENT)).toHaveLength(1)
  })

  it('known-bad probes (/resolve): the display line and the summary header line are each required', () => {
    const body = bodyOf(RESOLVE)
    expect(collectReportDefects(body, RESOLVE), 'the unmodified display and summary header have no defect').toEqual([])
    expect(collectReportDefects(seed(body, '**Gate level**: {GATE_LEVEL, with any level note}\n', ''), RESOLVE)).toEqual(['the display lacks the Gate level line between **Total Issues** and ### Results'])
    expect(collectReportDefects(seed(body, RESOLVE_HEADER, '**Command**: /resolve\n\n'), RESOLVE)).toEqual(['the summary template lacks the Gate level line right after **Command**: /resolve'])
    expect(collectReportDefects(seed(body, '**Gate level**: {GATE_LEVEL}\n\n', '**Gate level**: {GATE_LEVEL}\n\n## Extra\n\n'), RESOLVE)).toEqual(['the Gate level header line is not followed by the learning arm or ## Statistics'])
  })
})

// ---------------------------------------------------------------------------
// h. Cut routes
// ---------------------------------------------------------------------------

describe('the /resolve routes that skip phases pass no pushing phase (A1)', () => {
  it.each(BUILDS.filter(b => b.spec === RESOLVE))('$label: the empty FIX_NOW route, the route after push and the numbered principles', ({ body }) => {
    expect(collectCutRouteDefects(body)).toEqual([])
  })

  it('known-bad probes: a pushing phase in the route, the retired wording and a shortened route are each reported', () => {
    const body = bodyOf(RESOLVE)
    expect(collectCutRouteDefects(body), 'the unmodified routes have no defect').toEqual([])
    expect(collectCutRouteDefects(seed(body, 'Phases 9, 9b', 'Phases 7, 9, 9b'))).toEqual(expect.arrayContaining(['the empty FIX_NOW route names Phase 7']))
    expect(collectCutRouteDefects(seed(body, 'skip to Phase 5, then', 'skip to Phase 5, then run Phase 6, then'))).toContain('the empty FIX_NOW route names Phase 6')
    expect(collectCutRouteDefects(seed(body, ROUTE_EMPTY, 'If FIX_NOW list is empty: skip to Phase 5 and run the later phases in order.')))
      .toContain('the empty FIX_NOW route is not the pinned sentence: If FIX_NOW list is empty: skip to Phase 5 and run the later phases in order.')
    expect(collectCutRouteDefects(seed(body, ' and the later phases in order.', '.'))).toEqual(expect.arrayContaining(['the route after push does not end "and the later phases in order."']))
    expect(collectCutRouteDefects(seed(body, '1. **Orchestration only**', '1. **Only**'))).toContain('Principle 1 (**Orchestration only**) is missing')
    expect(collectCutRouteDefects(seedIn(body, '## Principles', '## Output Artifact', /^3\. \*\*/m, '4. **'))).toContain('the principles are numbered 1, 2, 4, expected 1, 2, 3')
  })
})
