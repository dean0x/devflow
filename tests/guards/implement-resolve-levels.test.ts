/**
 * /implement and /resolve phases per gate level (#480 and #481, part of epic #468). A bare `AC-n` is an acceptance
 * criterion of #480. A criterion of #481 names its issue, as in `#481 AC-3`.
 *
 * `GATE_LEVEL` comes from the accepted settings line. At `standard` and `lean`, each command reads its own level
 * reference once per run and applies the rows of that reference to the phases the rows name. At `full` it reads
 * nothing. Both references ship with the fixed row grammar. The rows they hold are the decided ones (`expectedRows`),
 * so this file holds what a row may say, where the command reads it, what no row may touch and where the docs state
 * what a row does.
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
 *      `skip`, and a phase with no spawn takes only `-`) and Rules bullets, and the decided rows and bullets. The doc
 *      sites (the `devflow gates` text, the init hints, README.md, docs/cli-reference.md and docs/commands.md) state
 *      the effect of each shipped row, and none keeps a retired "no rows" claim. The check proves each site carries
 *      the effect phrase once. It does not prove which command the phrase names: a site that covers both commands
 *      and names one satisfies the check for both.
 *   e. Row safety, a tripwire: protected phases, never-skip phases, floor controls, dispositions and actions no row
 *      may carry.
 *   f. `full` reads nothing: the reference path appears only inside the block, and no Validate fence of
 *      `/resolve` names the level.
 *   g. The report lines that name the level.
 *   h. The two `/resolve` routes that skip phases, the numbered principles and the edge row that reports an empty parse.
 *   i. What a skipped Polish phase leaves alone: the branch diff definition and the readers of the Polish output in
 *      both builds of both commands, and the three commands that keep Polish and read no level.
 * The spawn fences of both commands are pinned in `implement-resolve-full-fences.test.ts`.
 *
 * The reference arms (d, e) read the two references, and the doc-site check of arm d reads the docs. The command arms
 * (a, b, c, f, g, h, i) read the compiled commands.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { GATE_LEVEL_HINTS } from '../../src/cli/commands/gate-level-prompts.js'
import { GATE_LEVEL_EFFECT } from '../../src/cli/commands/gates.js'
import { ROOT, SANCTIONED_RESOLUTION, SANCTIONED_RESOLUTION_PRINT, escapeRe, isAgentBlock, parseFences, readAgentReference, requireDistFile, resolveAgentSource, resolveLearningOffSource, sectionBetween, tableRows } from '../helpers.js'

// ---------------------------------------------------------------------------
// The decided text, written by hand from the issue and the gate decisions
// ---------------------------------------------------------------------------

const LEVEL_DIR = 'skills/devflow:agent-references/references/commands'
const OPEN = '**Gate level.**'
const TABLE_HEADER = '| Phase | standard | lean |'
const TABLE_SEPARATOR = '|-------|----------|------|'
const RULES_INTRO = 'An `apply:` cell names one bullet of this section. At least one row names each bullet.'

const GRAMMAR_CELL = "- **Cell:** `-` runs the phase as written; `skip`, alone, skips it; `apply: <name>` applies the `## Rules` bullet `<name>`; `pass level` adds the line `GATE_LEVEL: {GATE_LEVEL}` to every spawn prompt of the phase. A phase with no spawn takes only `-`. Join `apply:` and `pass level` with `; `. Each `apply:` names exactly one bullet. Any other cell is malformed."
const GRAMMAR_RULES_BULLET = '- **Rules bullet:** a Rules bullet opens `- **<name>:**`.'
const GRAMMAR_SKIPPED = '- **Skipped:** a skipped phase does not stop the run, and the next phase starts as written. Each name on its `**Produces:**` line reads `SKIPPED`, and a report shows `SKIPPED`.'
const FLOOR_FIRST = 'No row or rule overrides the next two lines.'
/** The fail-closed wording, in the pieces that the bullet, its needles and the probes share. */
const NO_HEADING = 'has no `## Phases` heading with the `| Phase | standard | lean |` header'
const BAD_ROW = 'a row breaks its grammar'
const UNREADABLE_LINE = '`level reference unreadable: no level rows applied`'
const FAIL_CLOSED_HEAD = `If the Read fails, or the file ${NO_HEADING}, or ${BAD_ROW}, `
const UNREADABLE = `say ${UNREADABLE_LINE}.`
/** The condition that opens the read, in the read paragraph and in `levelCondition`. */
const IMPLEMENT_CONDITION = 'At `standard` or `lean`, once per run'
const RESOLVE_CONDITION = 'When any is `standard` or `lean`, once per run'

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
  /** Parts of `items[1]`, in its order. The exact pin of the block already implies them: they name the part that is missing. */
  readonly failClosed: readonly string[]
  /** Where the block sits: the region it must lie in, the paragraph before it, the paragraph after it. In the `.mds` source, the line that opens with the next paragraph also ends the block. */
  readonly regionFrom: string
  readonly regionTo: string
  readonly outsideMessage: string
  readonly prevHas: string
  readonly nextParagraph: string
  /** A heading to move the block in front of in a probe. Absent: the end of the region, so the block stays in it and the neighbour checks report it. */
  readonly moveBefore?: string
  /** A phase cell that is in the closed set and carries no floor word, for probe rows. */
  readonly sampleRow: string
  /** The closed-set phases that never take `skip`: a skip there drops a security fix, a ticket or a gate that follows. */
  readonly neverSkip: readonly string[]
  /** The closed-set phases that run the Triage agent: a Rules bullet that a row of one of them applies may name no disposition. */
  readonly triage: readonly string[]
  /** Each Produces or Requires line that must list `GATE_LEVEL`. */
  readonly dataFlow: ReadonlyArray<{ readonly site: string; readonly kind: 'Produces' | 'Requires'; readonly start: string; readonly end: string | null }>
  /** The rows and the Rules bullets that the reference holds, as the lines of the file. A row or bullet joins the list in the change that decides it. */
  readonly expectedRows: readonly string[]
  readonly expectedBullets: readonly string[]
}

const IMPLEMENT: LevelSpec = {
  cmd: 'implement',
  refFile: 'implement-levels.md',
  title: '# Implement: phases by gate level',
  closed: [['3', 'Polish'], ['4', 'Self-Review'], ['5', 'Alignment Check']],
  protectedPhases: ['1', '2', '6', '7', '8', '9', '10', '11', '12'],
  intro: 'At `standard` and `lean`, a row sets its phase at that level. A phase with no row runs as written, and a table with no rows is well-formed.',
  grammar: [
    "- **Phase:** `3 Polish`, `4 Self-Review` or `5 Alignment Check`: the number and the text after `### Phase N: ` in the command, without a trailing parenthetical. Any other phase, or a name that does not match its number's heading by this rule, is malformed.",
    GRAMMAR_CELL,
    GRAMMAR_RULES_BULLET,
    GRAMMAR_SKIPPED,
    '- **Gate level block:** the command reads this file at the start of Phase 3, before the Polish spawn. A `3 Polish` row with `skip` skips the Polish spawn, never that block or the `{branch_diff}` definition.',
    "- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, except that a `4 Self-Review` row may skip Harden. It keeps Validate, the CI gate, the evidence claims and the compliance directive. An enabled compliance lens keeps Harden.",
    '- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row.',
  ],
  readParagraph: `${OPEN} ${IMPLEMENT_CONDITION}, run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash and Read \`<that directory>/${LEVEL_DIR}/implement-levels.md\` with the Read tool, and apply each row to the phase it names.`,
  items: [
    FLOOR_FIRST,
    `${FAIL_CLOSED_HEAD}apply no row, keep \`GATE_LEVEL\` and ${UNREADABLE}`,
    'Validate, the CI gate, the evidence claims and the compliance directive run at every level. An enabled compliance lens keeps Harden.',
  ],
  levelCondition: IMPLEMENT_CONDITION,
  failClosed: [NO_HEADING, BAD_ROW, 'apply no row, keep `GATE_LEVEL` and', UNREADABLE_LINE],
  regionFrom: '### Phase 3: Polish',
  regionTo: '### Phase 4:',
  outsideMessage: 'the block is outside Phase 3: the re-validation path skips Phase 1',
  prevHas: '**Requires:**',
  nextParagraph: 'After the Code agent completes',
  moveBefore: '### Phase 2: Implement',
  sampleRow: '3 Polish',
  neverSkip: [],
  triage: [],
  dataFlow: [
    { site: 'Phase 3', kind: 'Requires', start: '### Phase 3: Polish', end: '### Phase 4:' },
    { site: 'Phase 12', kind: 'Requires', start: '### Phase 12: Report', end: null },
  ],
  expectedRows: ['| 3 Polish | skip | skip |'],
  expectedBullets: [],
}

const RESOLVE: LevelSpec = {
  cmd: 'resolve',
  refFile: 'resolve-levels.md',
  title: '# Resolve: phases by gate level',
  closed: [['2', 'Global Triage'], ['3', 'Batch FIX_NOW Issues'], ['4', 'Fix'], ['6', 'Polish'], ['9', 'Manage Debt']],
  protectedPhases: ['0', '1', '1b', '5', '7', '8', '9b', '9c', '10'],
  intro: 'At `standard` and `lean`, a row sets its phase at that level. Each worktree reads the column of its own level, except in a global phase. A phase with no row runs as written, and a table with no rows is well-formed.',
  grammar: [
    "- **Phase:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix`, `6 Polish` or `9 Manage Debt`: the number and the text after `### Phase N: ` in the command, without a trailing parenthetical. Phase `9` never covers `9b` or `9c`. Any other phase, or a name that does not match its number's heading by this rule, is malformed.",
    GRAMMAR_CELL,
    GRAMMAR_RULES_BULLET,
    GRAMMAR_SKIPPED,
    '- **Never skip:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix` and `9 Manage Debt` never take `skip`. Triage routes each security finding as it does at `full`. No row leaves a FIX_NOW security finding unfixed, leaves a FIX_SEPARATE item without a ticket, or drops the CI gate. A row or Rules bullet that breaks this rule is malformed, so the command applies no row in any worktree.',
    "- **Global phase:** one spawn serves all worktrees in a global phase, as in `2 Global Triage`. A global phase uses the strictest level in the run. `full` is the strictest and `lean` the least strict. The phase takes that level's cell, and `pass level` sends that level. At `full` the phase runs as written.",
    "- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, changes neither the Triage security gate nor the ESCALATED route, and keeps the Verification Gate, the CI gate and the compliance directive.",
    '- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row in any worktree.',
  ],
  readParagraph: `${OPEN} Each worktree keeps its own \`GATE_LEVEL\`. ${RESOLVE_CONDITION}, run \`${SANCTIONED_RESOLUTION_PRINT}\` in Bash and Read \`<that directory>/${LEVEL_DIR}/resolve-levels.md\` with the Read tool, and apply each row to the phase it names, as the reference says.`,
  items: [
    FLOOR_FIRST,
    `${FAIL_CLOSED_HEAD}apply no row in any worktree, keep every \`GATE_LEVEL\` and ${UNREADABLE}`,
    'No level changes the Triage security gate or the ESCALATED route. The Verification Gate, the CI gate and the compliance directive run at every level.',
  ],
  levelCondition: RESOLVE_CONDITION,
  failClosed: [NO_HEADING, BAD_ROW, 'apply no row in any worktree, keep every `GATE_LEVEL` and', UNREADABLE_LINE],
  regionFrom: '#### Step 0d:',
  regionTo: '### Phase 1: Parse Issues',
  outsideMessage: 'the block is outside Step 0d',
  prevHas: "Set it per worktree, from that worktree's lens",
  nextParagraph: '**Mint `RESOLUTION_TS` once per run:**',
  sampleRow: '6 Polish',
  neverSkip: ['2', '3', '4', '9'],
  triage: ['2'],
  dataFlow: [
    { site: 'Step 0d', kind: 'Produces', start: '#### Step 0d:', end: '### Phase 1: Parse Issues' },
    { site: 'Phase 5', kind: 'Requires', start: '### Phase 5:', end: '### Phase 6:' },
    { site: 'Phase 6', kind: 'Requires', start: '### Phase 6: Polish', end: '### Phase 7:' },
    { site: 'Phase 10', kind: 'Requires', start: '### Phase 10:', end: null },
  ],
  expectedRows: ['| 6 Polish | skip | skip |'],
  expectedBullets: [],
}

const SPECS: readonly LevelSpec[] = [IMPLEMENT, RESOLVE]

/** The pinned report lines (arm g) and cut routes (arm h). */
const IMPLEMENT_REPORT = "Display completion summary with phase status, `Gate level: {GATE_LEVEL}` with any level note, Validate's `Lint pack:` line if any, PR info, and next steps."
const RESOLVE_DISPLAY = '**Total Issues**: {n}\n**Gate level**: {GATE_LEVEL, with any level note}\n\n### Results'
const RESOLVE_HEADER = '**Command**: /resolve\n**Gate level**: {GATE_LEVEL}\n\n'
const ROUTE_EMPTY = 'If FIX_NOW list is empty: skip to Phase 5, then run Phases 9, 9b, 9c and 10.'
const ROUTE_PUSH = '**Route after push:** VERIFICATION_STATUS = PASS → continue to Phase 8 (CI gate). FAILED or SKIPPED → skip Phase 8 and continue with Phase 9 and the later phases in order.'
/** The phases that the empty route names, in the order it names them. The comparison sorts both sides. */
const ROUTE_EMPTY_PHASES = ['5', '9', '9b', '9c', '10']
const EDGE_EMPTY_PARSE_CASE = 'No issues parsed'
const EDGE_EMPTY_PARSE_HANDLING = 'Report "No issues to resolve"'

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

const countOf = (text: string, needle: string): number => text.split(needle).length - 1

/** The names on a section's `**Produces:**` or `**Requires:**` line, parentheticals dropped. */
function dataFlowNames(section: string | null, kind: 'Produces' | 'Requires'): string[] {
  const line = new RegExp(`^\\*\\*${kind}:\\*\\* (.+)$`, 'm').exec(section ?? '')?.[1] ?? ''
  return line.replace(/\([^)]*\)/g, '').split(',').map(n => n.trim()).filter(n => n !== '')
}

/** The `### Phase N:` numbers of a compiled command, in heading order. */
const phaseNumbers = (body: string): string[] => [...body.matchAll(/^### Phase (\d+[a-z]?): /gm)].map(m => m[1])

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
  return phaseNumbers(body).filter(n => !spec.closed.some(([c]) => c === n))
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
  // The exact pin above implies this check. It stays to name the line that changed, which the 200-character pin message may cut off.
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
    else if (line.startsWith(spec.nextParagraph)) inBlock = false
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
 * The fail-closed bullet of the block: its parts, and none of the wording that sets the level to `full`.
 * The exact pin of the bullet in the block collector implies each check here. They stay to name the part that changed.
 */
export function collectFailClosedBulletDefects(body: string, spec: LevelSpec): string[] {
  const out: string[] = []
  const start = body.indexOf(OPEN)
  const lines = start === -1 ? [] : (body.slice(start).split('\n\n')[1] ?? '').split('\n')
  const bullet = lines.find(line => line.startsWith('- If the Read fails'))
  if (bullet === undefined) return ['the block has no fail-closed bullet ("If the Read fails")']
  for (const needle of spec.failClosed) if (!bullet.includes(needle)) out.push(`the fail-closed bullet lacks: ${needle}`)
  if (bullet.includes('full applied')) out.push('the fail-closed bullet holds "full applied"')
  if (/\bset `?GATE_LEVEL/i.test(bullet)) out.push('the fail-closed bullet sets GATE_LEVEL')
  return out
}

/** `/implement` only: the Phase 6 Validate prompt opens with the level line, and Validate runs the lint pack only on a first `lean` line. */
export function collectImplementValidateDefects(body: string, validate: string): string[] {
  const out: string[] = []
  const fences = parseFences(sectionBetween(body, '### Phase 6: Validate', '### Phase 7:') ?? '').filter(f => isAgentBlock(f, 'Validate'))
  if (fences.length !== 1) out.push(`Phase 6 holds ${fences.length} Validate fences, expected 1`)
  else if (!/^```[^\n]*\nAgent\(subagent_type="Validate"\):\n"GATE_LEVEL: \{GATE_LEVEL\}\n/.test(fences[0])) out.push('the Phase 6 Validate prompt does not open with GATE_LEVEL: {GATE_LEVEL}')
  if (!validate.includes('Only if the first `GATE_LEVEL:` line is exactly `lean`')) out.push('validate.md lacks "Only if the first `GATE_LEVEL:` line is exactly `lean`"')
  return out
}

/**
 * AC-3, AC-9: a failed read applies no row and keeps the level. Both commands carry the bullet. Only `/implement`
 * passes the level to a Validate prompt that a row does not remove.
 */
export function collectFailClosedDefects(body: string, spec: LevelSpec, validate: string): string[] {
  const bullet = collectFailClosedBulletDefects(body, spec)
  switch (spec.cmd) {
    case 'implement': return [...bullet, ...collectImplementValidateDefects(body, validate)]
    case 'resolve': return bullet
  }
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

/** The row lines of the table, header and separator dropped. */
const tableRowLines = (parsed: ParsedRef): string[] => tableLines(parsed).slice(2)

/** The rows of a reference, header and separator dropped. */
export function referenceRows(ref: string): string[] {
  return tableRowLines(parseRef(ref))
}

/** One row of the table, parsed once for the grammar check and the row-safety check. */
interface ParsedRow {
  readonly line: string
  /** The phase, standard and lean cells; null when the line is not three pipe-bounded cells. */
  readonly cells: readonly [phase: string, standard: string, lean: string] | null
  /** The phase number that the phase cell opens with, when it opens with one. */
  readonly num: string | undefined
  /** The name after the number: set only when the phase cell is `<number> <name>`. */
  readonly name: string | undefined
}

/** The level columns of a row, after its phase cell. */
const LEVEL_COLUMNS = ['standard', 'lean'] as const

function parseRow(line: string): ParsedRow {
  const cells = line.startsWith('|') && line.endsWith('|') ? line.split('|').slice(1, -1).map(cell => cell.trim()) : null
  if (cells === null || cells.length !== 3) return { line, cells: null, num: undefined, name: undefined }
  const [phase, standard, lean] = cells
  return { line, cells: [phase, standard, lean], num: /^(\d+[a-z]?)(?: |$)/.exec(phase)?.[1], name: /^\d+[a-z]? (\S.*)$/.exec(phase)?.[1] }
}

/** The rows of the `## Phases` table. The one parser of a row, for every collector. */
const parseRows = (parsed: ParsedRef): ParsedRow[] => tableRowLines(parsed).map(parseRow)

const RULE_BULLET = /^- \*\*([A-Za-z0-9][A-Za-z0-9 _-]*):\*\* \S/

/** The name that a Rules bullet opens with, `- **<name>:** <text>`; null when the line does not open so. The one parser of a bullet name, for every collector. */
const ruleBulletName = (line: string): string | null => RULE_BULLET.exec(line)?.[1] ?? null

/** The bullet lines of the `## Rules` section. */
const ruleBullets = (parsed: ParsedRef): string[] => (sectionOf(parsed, '## Rules')?.lines ?? []).filter(line => line.startsWith('- '))

/** The Rules bullet names that exist: the names that a cell may apply. */
const ruleNames = (parsed: ParsedRef): string[] => ruleBullets(parsed).flatMap(line => ruleBulletName(line) ?? [])

/** What a phase lets a cell do: `skip` is barred on a never-skip phase, and a phase with no spawn takes only `-`, because `skip`, `apply:` and `pass level` all act on a spawn. */
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
  if (cell === 'skip') {
    if (phase.neverSkips) return `the cell ${takesSkip(phase.num)}`
    return phase.hasSpawn ? null : `the cell takes skip, but phase ${phase.num} has no spawn to skip`
  }
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
    if (!phase.hasSpawn) return `the cell applies "${applied[1]}", but phase ${phase.num} has no spawn to change`
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

const REF_HEADINGS = ['## Phases', '## Grammar', '## Rules'] as const

/** AC-5: the reference opens with its title and holds the three headings, in order. */
export function collectRefShapeDefects(parsed: ParsedRef, spec: LevelSpec): string[] {
  const out: string[] = []
  if (parsed.title !== spec.title) out.push(`the reference does not open with "${spec.title}"`)
  const headings = parsed.sections.map(s => s.heading)
  const missing = REF_HEADINGS.filter(want => !headings.includes(want))
  for (const want of missing) out.push(`no "${want}" heading`)
  if (missing.length === 0 && headings.join(', ') !== REF_HEADINGS.join(', ')) out.push(`the headings are "${headings.join(', ')}", expected "${REF_HEADINGS.join(', ')}"`)
  return out
}

/** AC-5: every Rules bullet opens `- **<name>:**`, and no name repeats. */
export function collectRuleNameDefects(parsed: ParsedRef): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of ruleBullets(parsed)) {
    const name = ruleBulletName(line)
    if (name === null) { out.push(`a Rules bullet does not open "- **<name>:**": ${line.slice(0, 60)}`); continue }
    if (seen.has(name)) out.push(`the Rules bullet "${name}" is repeated`)
    seen.add(name)
  }
  return out
}

/** AC-5: the exact header and separator of the table. A reference with no `## Phases` section has none to check: the shape collector reports the heading. */
export function collectTableHeaderDefects(parsed: ParsedRef): string[] {
  if (sectionOf(parsed, '## Phases') === undefined) return []
  const out: string[] = []
  const table = tableLines(parsed)
  if (table[0] !== TABLE_HEADER) out.push(`the table header is "${table[0] ?? 'absent'}", expected "${TABLE_HEADER}"`)
  if (table[1] !== TABLE_SEPARATOR) out.push(`the table separator is "${table[1] ?? 'absent'}", expected "${TABLE_SEPARATOR}"`)
  return out
}

/** The defects of one row: its phase against the closed set and the compiled heading, then each level cell. */
function rowGrammarDefects(row: ParsedRow, spec: LevelSpec, body: string, compiled: ReadonlyMap<string, string>, names: readonly string[]): string[] {
  if (row.cells === null) return [`a row does not have three cells: ${row.line.slice(0, 60)}`]
  const [phase, ...levels] = row.cells
  const { num, name } = row
  if (num === undefined || name === undefined) return [`a row phase is not "<number> <name>": ${phase}`]
  const out: string[] = []
  const closed = spec.closed.find(([n]) => n === num)
  if (closed === undefined) out.push(`a row for phase ${num}, which is outside the closed set ${spec.closed.map(([n]) => n).join(', ')}`)
  else {
    if (name !== closed[1]) out.push(`phase ${num} is named "${name}", expected "${closed[1]}"`)
    if (compiled.get(num) !== name) out.push(`phase ${num} "${name}" is not the compiled "### Phase ${num}:" heading ("${compiled.get(num) ?? 'absent'}")`)
  }
  const traits = phaseTraits(spec, body, num)
  levels.forEach((cell, i) => {
    const defect = cellDefect(cell, names, traits)
    if (defect !== null) out.push(`row ${num} ${LEVEL_COLUMNS[i]}: ${defect}`)
  })
  return out
}

/** AC-5: every row has three cells and a phase in the closed set under its compiled heading name, and its cells are in the cell grammar. */
export function collectRowGrammarDefects(parsed: ParsedRef, spec: LevelSpec, body: string): string[] {
  const names = ruleNames(parsed)
  const compiled = phaseHeadings(body)
  return parseRows(parsed).flatMap(row => rowGrammarDefects(row, spec, body, compiled, names))
}

/** AC-5: a reference is read, never run, so it holds no spawn block, `subagent_type` field or learning marker. */
export function collectRefMarkerDefects(ref: string): string[] {
  const out: string[] = []
  if (ref.includes('Agent(')) out.push('the reference carries a spawn block')
  if (ref.includes('subagent_type')) out.push('the reference carries a subagent_type field')
  if (/<!-- learning:/.test(ref)) out.push('the reference carries a learning marker')
  return out
}

/**
 * AC-5: the shape of one reference, from five collectors: the title and the three headings in order, Rules bullets
 * that open `- **<name>:**`, the exact header and separator, rows whose phase is in the closed set under the compiled
 * heading name with cells in the cell grammar (`apply:` naming one Rules bullet that exists), and no spawn block,
 * `subagent_type` or learning marker. A table with no rows has no defect.
 */
export function collectLevelReferenceDefects(ref: string, spec: LevelSpec, body: string): string[] {
  const parsed = parseRef(ref)
  return [
    ...collectRefShapeDefects(parsed, spec),
    ...collectRuleNameDefects(parsed),
    ...collectTableHeaderDefects(parsed),
    ...collectRowGrammarDefects(parsed, spec, body),
    ...collectRefMarkerDefects(ref),
  ]
}

/** The entries of `have` that `want` does not hold, one per copy: a second copy of a row is a surplus. */
function surplus(have: readonly string[], want: readonly string[]): string[] {
  const left = [...want]
  return have.filter(item => {
    const at = left.indexOf(item)
    if (at === -1) return true
    left.splice(at, 1)
    return false
  })
}

/**
 * AC-5, #481 AC-1: the table holds exactly the decided rows and the Rules section exactly the decided bullets, as the lines of
 * the file. A decided row or bullet that is missing and an undecided one that is present are each reported. A change to
 * one cell of a decided row reports both.
 */
export function collectDecidedRowDefects(ref: string, spec: LevelSpec): string[] {
  const parsed = parseRef(ref)
  const rows = referenceRows(ref)
  const bullets = ruleBullets(parsed)
  return [
    ...surplus(spec.expectedRows, rows).map(row => `the ${spec.cmd} table lacks the decided row ${row}`),
    ...surplus(rows, spec.expectedRows).map(row => `the ${spec.cmd} table holds the undecided row ${row}`),
    ...surplus(spec.expectedBullets, bullets).map(bullet => `the ${spec.cmd} Rules section lacks the decided bullet ${bullet}`),
    ...surplus(bullets, spec.expectedBullets).map(bullet => `the ${spec.cmd} Rules section holds the undecided bullet ${bullet}`),
  ]
}

/** The clauses that say the references hold no rows. No doc site keeps one once any table has a row. */
const RETIRED_CLAIMS = ['no phase rules yet', 'no rows yet'] as const

/** What a doc site says when it states that Polish is skipped: "skip Polish", "skips Polish" or "no Polish". */
const POLISH_SKIP = /\b(?:skips?|no) Polish\b/

/**
 * What a doc site must say for each shipped row, keyed by `${cmd}:` plus the full row line. A change to one cell is a new
 * key, so it sends someone back to the docs. A row with no entry here is reported.
 */
const ROW_EFFECTS: ReadonlyMap<string, RegExp> = new Map([
  ['implement:| 3 Polish | skip | skip |', POLISH_SKIP],
  ['resolve:| 6 Polish | skip | skip |', POLISH_SKIP],
])

/** One text that states what the levels do, named as a defect names it, with the commands whose rows it covers. */
interface DocSite { readonly label: string; readonly text: string; readonly cmds: ReadonlyArray<LevelSpec['cmd']> }

/** The rows that the reference of one command holds, as the table lists them. */
interface ShippedRows { readonly cmd: LevelSpec['cmd']; readonly rows: readonly string[] }

/** How many times `re` matches `text`. The count rebuilds `re` as global, so it does not depend on the flags of `re`. */
const matchCount = (text: string, re: RegExp): number => [...text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))].length

/** Check 1 of the doc sites: a shipped row with no entry in `effects`. */
function collectUnregisteredRowDefects(shipped: readonly ShippedRows[], effects: ReadonlyMap<string, RegExp>): string[] {
  return shipped.flatMap(({ cmd, rows }) => rows.filter(row => !effects.has(`${cmd}:${row}`)).map(row => `the ${cmd} row ${row} has no ROW_EFFECTS entry`))
}

/** Check 2 of the doc sites: a retired claim at `site`, reported once any table has a row. `withRow` names the commands whose table has one. */
function collectRetiredClaimDefects(site: DocSite, withRow: readonly string[]): string[] {
  if (withRow.length === 0) return []
  return RETIRED_CLAIMS.filter(claim => site.text.includes(claim)).map(claim => `a table has a row (${withRow.join(', ')}), but ${site.label} still says "${claim}"`)
}

/** Check 3 of the doc sites: `site` states the effect of each shipped row of its own commands exactly once. A row with no entry is check 1's to report. */
function collectEffectCountDefects(site: DocSite, shipped: readonly ShippedRows[], effects: ReadonlyMap<string, RegExp>): string[] {
  return shipped.filter(({ cmd }) => site.cmds.includes(cmd)).flatMap(({ cmd, rows }) => rows.flatMap(row => {
    const effect = effects.get(`${cmd}:${row}`)
    if (effect === undefined) return []
    const times = matchCount(site.text, effect)
    if (times === 0) return [`${site.label} does not state the effect of the ${cmd} row ${row}: it must match ${effect}`]
    return times > 1 ? [`${site.label} states the effect of the ${cmd} row ${row} ${times} times, expected once`] : []
  }))
}

/**
 * #481 AC-6: every shipped row has an entry in `effects`, and each site that covers the command of a shipped row states the
 * effect of that row exactly once. Once any table has a row, no site keeps a retired claim. While no table has a row, no
 * site owes an effect and none is barred a retired claim. The match is on a phrase: it does not tell which command the
 * phrase names, so a site that covers both commands and names one satisfies the check for both.
 * The defects come in this order: the unregistered rows, then for each site its retired claims and its effect counts.
 */
export function collectDocSiteDefects(sites: readonly DocSite[], refs: Readonly<Record<string, string>>, effects: ReadonlyMap<string, RegExp> = ROW_EFFECTS): string[] {
  const shipped = SPECS.map(spec => ({ cmd: spec.cmd, rows: referenceRows(refs[spec.cmd]) }))
  const withRow = shipped.filter(({ rows }) => rows.length > 0).map(({ cmd }) => cmd)
  return [
    ...collectUnregisteredRowDefects(shipped, effects),
    ...sites.flatMap(site => [...collectRetiredClaimDefects(site, withRow), ...collectEffectCountDefects(site, shipped, effects)]),
  ]
}

// ---------------------------------------------------------------------------
// e. Row safety, a tripwire
// ---------------------------------------------------------------------------

/** Stems of removal verbs; a stem matches every word that begins with it ("remov" matches remove, removed, removal; "leav" matches leave, leaves, leaving). A verb counts when a floor name stands anywhere in the same cell or bullet. */
const REMOVAL_STEMS = ['skip', 'drop', 'remov', 'omit', 'disabl', 'bypass', 'ignor', 'defer', 'stop', 'leav'] as const
/** Whole-word removal verbs that are no stem. They count the same way as a stem. */
const REMOVAL_PHRASES = ['cut', 'turn off', 'turns off', 'turned off', 'turning off'] as const
/** Bare negations; "does not run" and "do not spawn" are read through "does not" and "do not". "no" and "not" are ordinary prose ("Pass no extra files to Validate"), so one counts only within NEAR_WORDS of a floor name. */
const REMOVAL_WORDS = ['without', 'no', 'not', 'never', "don't", "doesn't", 'do not', 'does not'] as const
/** Names of the controls that no level may remove, with and without "the": the Triage, security, ESCALATED, Harden, Validate, CI, Verification, evidence and compliance controls, and the fix path (FIX_NOW and FIX_SEPARATE items, the issues, the fixes, the edits and commits of a fix, the tickets). */
const FLOOR_NAMES = ['security', 'ESCALATED', 'compliance', 'Triage', 'Harden', 'Validate', 'validation', 'CI', 'verification', 'evidence', 'FIX_NOW', 'FIX_SEPARATE', 'ticket', 'tickets', 'fix', 'fixes', 'edit', 'edits', 'commit', 'commits', 'issue', 'issues'] as const
/** The words that follow a floor name as a part of what it names ("the CI Status Gate", "the Validate agent"). The window of a negation opens after them. */
const FLOOR_TAIL_WORDS = ['gate', 'status', 'agent', 'run', 'check', 'checks'] as const
/** The dispositions that Triage gives a finding to take it off the fix path; a security or ESCALATED finding may go to none of them. */
const DISPOSITIONS = ['TECH_DEBT', 'FALSE_POSITIVE', 'BY_DESIGN', 'FIX_SEPARATE', 'DUPLICATE'] as const
/** Every outcome that Triage gives a finding. A Rules bullet that a Triage row applies may name none of them: the Triage body routes. */
const TRIAGE_OUTCOMES = [...DISPOSITIONS, 'ESCALATED', 'FIX_NOW'] as const
/** Whole words for a shell, write, push, commit, post or GitHub action, which no row may add. */
const ACTION_WORDS = ['git', 'gh', 'push', 'pushes', 'pushed', 'pushing', 'commit', 'commits', 'committed', 'committing', 'write', 'writes', 'wrote', 'written', 'writing', 'post', 'posts', 'posted', 'posting', 'Bash', 'GitHub'] as const

/** The array as regex source: each entry escaped, a space in a phrase read as any run of spaces, and an apostrophe read as a straight or a typographic one. */
const anyOf = (words: readonly string[]): string => words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+').replace(/'/g, '[\'\u2019]')).join('|')
const wholeWords = (words: readonly string[]): RegExp => new RegExp(`\\b(?:${anyOf(words)})\\b`, 'i')
const VERB = `\\b(?:${anyOf(REMOVAL_STEMS)})\\w*|\\b(?:${anyOf(REMOVAL_PHRASES)})\\b`
const NEGATION = `\\b(?:${anyOf(REMOVAL_WORDS)})\\b`
const FLOOR_TAIL = `(?:\\s+(?:${anyOf(FLOOR_TAIL_WORDS)})\\b)*`
/** At most this many words may stand between a negation and the control it removes, in one sentence. Farther apart, they are two clauses: "Pass no extra files to Validate". A sentence stop (`.;!?`) also ends the clause. */
const NEAR_WORDS = 2
const NEAR = `(?:[^\\w.;!?]+\\w+){0,${NEAR_WORDS}}[^\\w.;!?]+`
/** The numbers that may stand before a protected phase number in a plural list ("Phases 6, 7 and 8"), each with its separator: a comma with an optional "and" or "or" (the Oxford comma), or "and" or "or" alone. */
const PHASE_LIST_PREFIX = '(?:\\d+[a-z]?(?:\\s*,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+))*'

const SECURITY = /\bsecurity\b/i
const ESCALATED = /\bESCALATED\b/i
const DISPOSITION = wholeWords(DISPOSITIONS)
const TRIAGE_OUTCOME = wholeWords(TRIAGE_OUTCOMES)
const ACTION = new RegExp(`\`\`\`|${wholeWords(ACTION_WORDS).source}`, 'i')

/**
 * Whether a cell or a Rules bullet removes or defers a floor control, in three ways. A floor control is a floor name, or
 * a protected phase named by its number ("Phase 7"), with the tail words that belong to the name. A plural list of
 * numbers joined by a comma, "and" or "or" ("Phases 6, 7 and 8") names the protected number wherever it stands in the list.
 *   - A removal verb (skip, drop, turn off ...) and a floor control anywhere in the same text. A list, another clause or
 *     another sentence does not hide the control.
 *   - A negation (no, not, never, do not ...) within NEAR_WORDS words before a floor control, in one sentence.
 *   - A negation within NEAR_WORDS words after a floor control and its tail words, in one sentence.
 * The text is the whole bullet, name included: `- **validate:** skipped at lean.` names the control in the bullet name.
 */
function removesFloorControl(text: string, floorPhases: readonly string[]): boolean {
  const names = `\\b(?:${anyOf(FLOOR_NAMES)})\\b`
  const floor = `(?:${floorPhases.length === 0 ? names : `${names}|\\bPhases?\\s+${PHASE_LIST_PREFIX}(?:${anyOf(floorPhases)})\\b`})${FLOOR_TAIL}`
  const verbAndFloor = new RegExp(`(?:${VERB})`, 'i').test(text) && new RegExp(floor, 'i').test(text)
  return verbAndFloor || new RegExp(`(?:${NEGATION})${NEAR}(?:${floor})|(?:${floor})${NEAR}(?:${NEGATION})`, 'i').test(text)
}

/** Why one cell or one Rules bullet is unsafe, as phrases. The match is case-insensitive and on word boundaries. `floorPhases` are the phase numbers that no row may skip. `triage` is true for a bullet that a row of a Triage phase applies. */
function unsafeReasons(text: string, floorPhases: readonly string[], triage = false): string[] {
  const out: string[] = []
  if (removesFloorControl(text, floorPhases)) out.push('removes or defers a floor control')
  if (SECURITY.test(text) && DISPOSITION.test(text)) out.push('routes a security finding to a disposition')
  if (ESCALATED.test(text) && DISPOSITION.test(text)) out.push('routes an ESCALATED finding to a disposition')
  if (triage && TRIAGE_OUTCOME.test(text)) out.push('is applied by a Triage row and names a disposition')
  if (ACTION.test(text)) out.push('adds a shell, write, push or GitHub action')
  return out
}

/**
 * AC-6: a tripwire, not a guarantee. It catches the known unsafe words, not every unsafe meaning. The `## Phases` intro,
 * the `## Grammar` text and the `## Rules` intro are pinned; a row for a protected phase (every compiled phase outside
 * the closed set) is rejected; every cell and every Rules bullet is checked, a bullet with its name; a bullet that a row of
 * a Triage phase applies names no disposition; a Rules bullet that no row names is rejected.
 *
 * It reads rows and bullet names through the parsers of the grammar check and relies on `collectLevelReferenceDefects`
 * to report a malformed one. It skips a row that has not three cells, and it labels a bullet that does not open
 * `- **<name>:**` by its first 40 characters. It still checks the text of that bullet.
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
  const appliedBy = new Map<string, Set<string>>()
  for (const row of parseRows(parsed)) {
    if (row.cells === null) continue
    const [phase, ...levels] = row.cells
    const { num } = row
    if (num === undefined) { out.push(`a row phase "${phase}" does not open with a phase number`); continue }
    if (guarded.includes(num)) out.push(`a row for protected phase ${num}`)
    else if (!spec.closed.some(([n]) => n === num)) out.push(`a row for phase ${num}, which is outside the closed set`)
    levels.forEach((cell, i) => {
      const column = LEVEL_COLUMNS[i]
      for (const reason of unsafeReasons(cell, floorPhases)) out.push(`row ${num} ${column} cell "${cell}" ${reason}`)
      for (const m of cell.matchAll(/apply: ([^;]+)/g)) {
        const phases = appliedBy.get(m[1].trim()) ?? new Set<string>()
        appliedBy.set(m[1].trim(), phases.add(num))
      }
      if (spec.neverSkip.includes(num) && cell === 'skip') out.push(`row ${num} ${column} cell ${takesSkip(num)}`)
    })
  }
  for (const line of ruleBullets(parsed)) {
    const name = ruleBulletName(line) ?? line.slice(0, 40)
    const phases = appliedBy.get(name)
    const inTriage = [...(phases ?? [])].some(n => spec.triage.includes(n))
    for (const reason of unsafeReasons(line, floorPhases, inTriage)) out.push(`Rules bullet "${name}" ${reason}`)
    if (phases === undefined) out.push(`Rules bullet "${name}" is named by no row`)
  }
  return out
}

// ---------------------------------------------------------------------------
// f. Full reads nothing
// ---------------------------------------------------------------------------

/**
 * AC-2: the level reference is named once, inside the block, and the read is conditioned on the level. The exact pin
 * of the read paragraph implies the condition check. It stays to name the missing condition.
 */
export function collectReferenceReadDefects(body: string, spec: LevelSpec): string[] {
  const out: string[] = []
  const start = body.indexOf(OPEN)
  const read = start === -1 ? '' : body.slice(start).split('\n\n')[0]
  const mentions = countOf(body, spec.refFile)
  if (mentions !== 1) out.push(`${spec.refFile} is named ${mentions} times, expected once, inside the Gate level block`)
  else if (!read.includes(spec.refFile)) out.push(`the one mention of ${spec.refFile} is outside the Gate level block`)
  if (!read.includes(spec.levelCondition)) out.push(`the read is not conditioned on "${spec.levelCondition}"`)
  return out
}

/** `/resolve` only: the Phase 7 Validate fence holds no `GATE_LEVEL`, because the Verification Gate does not run the lint pack. */
export function collectResolvePhase7Defects(body: string): string[] {
  const out: string[] = []
  const fences = parseFences(sectionBetween(body, '### Phase 7: Verification Gate', '### Phase 8:') ?? '').filter(f => isAgentBlock(f, 'Validate'))
  if (fences.length !== 1) out.push(`Phase 7 holds ${fences.length} Validate fences, expected 1`)
  else if (fences[0].includes('GATE_LEVEL')) out.push('the Phase 7 Validate fence names GATE_LEVEL')
  return out
}

/** AC-2: `full` reads nothing. The reference is read only inside the block, and `/resolve` passes no level to its Verification Gate. */
export function collectFullPathDefects(body: string, spec: LevelSpec): string[] {
  const read = collectReferenceReadDefects(body, spec)
  switch (spec.cmd) {
    case 'implement': return read
    case 'resolve': return [...read, ...collectResolvePhase7Defects(body)]
  }
}

// ---------------------------------------------------------------------------
// g. Report lines
// ---------------------------------------------------------------------------

/** AC-4, `/implement` only: the Phase 12 report line names the level. */
export function collectImplementReportDefects(body: string): string[] {
  const phase12 = sectionBetween(body, '### Phase 12: Report', null)
  if (phase12 === null) return ['no Phase 12']
  return countOf(phase12, IMPLEMENT_REPORT) === 1 ? [] : [`the Phase 12 report line is not the pinned sentence: ${IMPLEMENT_REPORT}`]
}

/** AC-4, `/resolve` only: the display and the `resolution-summary.md` header name the level. */
export function collectResolveReportDefects(body: string): string[] {
  const out: string[] = []
  if (countOf(body, RESOLVE_DISPLAY) !== 1) out.push('the display lacks the Gate level line between **Total Issues** and ### Results')
  const at = body.indexOf(RESOLVE_HEADER)
  if (at === -1 || countOf(body, RESOLVE_HEADER) !== 1) out.push('the summary template lacks the Gate level line right after **Command**: /resolve')
  else if (!/^## (?:Decisions Citations|Statistics)\n/.test(body.slice(at + RESOLVE_HEADER.length))) out.push('the Gate level header line is not followed by the learning arm or ## Statistics')
  return out
}

/** AC-4: the report of the command names the level. */
export function collectReportDefects(body: string, spec: LevelSpec): string[] {
  switch (spec.cmd) {
    case 'implement': return collectImplementReportDefects(body)
    case 'resolve': return collectResolveReportDefects(body)
  }
}

// ---------------------------------------------------------------------------
// h. Cut routes
// ---------------------------------------------------------------------------

/**
 * A1: the empty-FIX_NOW route and the route after push pass no phase that pushes, the principles are numbered 1 to 3.
 * An all-false-positive run takes the empty-FIX_NOW route, which writes the Phase 5 summary. So the one edge row that
 * reports "No issues to resolve" names the parse-time case only, and no edge row names an "actionable" case that such a
 * run could match.
 */
export function collectCutRouteDefects(body: string): string[] {
  const out: string[] = []
  const lines = body.split('\n')
  const empty = lines.filter(line => line.startsWith('If FIX_NOW list is empty:'))
  if (empty.length !== 1) out.push(`the empty FIX_NOW route appears ${empty.length} times, expected once`)
  else {
    if (empty[0] !== ROUTE_EMPTY) out.push(`the empty FIX_NOW route is not the pinned sentence: ${empty[0].slice(0, 200)}`)
    // The exact pin above implies the next two checks. They stay to name the phase or the set that changed.
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
    // The exact pin above implies this check. It stays to name the clause that a shortened route loses.
    if (!push[0].endsWith('and the later phases in order.')) out.push('the route after push does not end "and the later phases in order."')
  }
  const principles = sectionBetween(body, '## Principles', '## Output Artifact')
  if (principles === null) out.push('no "## Principles" section')
  else {
    const numbers = [...principles.matchAll(/^(\d+)\. /gm)].map(m => m[1])
    if (numbers.join(', ') !== '1, 2, 3') out.push(`the principles are numbered ${numbers.join(', ')}, expected 1, 2, 3`)
    if (!principles.includes('1. **Orchestration only**')) out.push('Principle 1 (**Orchestration only**) is missing')
  }
  const edge = sectionBetween(body, '## Edge Cases', '## Principles')
  if (edge === null) out.push('no "## Edge Cases" section')
  else {
    const rows = tableRows(edge)
    const reports = rows.filter(cells => cells[1] === EDGE_EMPTY_PARSE_HANDLING)
    if (reports.length !== 1) out.push(`the edge case that reports "No issues to resolve" appears in ${reports.length} rows, expected once`)
    else if (reports[0][0] !== EDGE_EMPTY_PARSE_CASE) out.push(`the edge row that reports "No issues to resolve" reads "${reports[0][0]}", expected "${EDGE_EMPTY_PARSE_CASE}"`)
    for (const cells of rows.filter(c => /actionable/i.test(c[0]))) out.push(`the edge case "${cells[0]}" could catch an all-false-positive run, which takes the empty FIX_NOW route`)
  }
  return out
}

// ---------------------------------------------------------------------------
// i. What a skipped Polish phase leaves alone
// ---------------------------------------------------------------------------

/** The sentence that defines `{branch_diff}`. It opens so, whatever base name the rest of the sentence uses. */
const BRANCH_DIFF_DEFINITION = '`{branch_diff}` is the output of'
/** How a command writes a Polish spawn: the `subagent_type` argument of a prose or block call, or the `agentType` option of a dynamic-build call. */
const POLISH_MARKERS = ['subagent_type="Polish"', 'agentType: "Polish"'] as const
const POLISH_SPAWN = `Agent(${POLISH_MARKERS[0]}`
/** The Polish output that the skipped phase sets to `SKIPPED`, per command. */
const POLISH_OUTPUT_NAMES: Readonly<Record<LevelSpec['cmd'], { readonly name: string; readonly from: string }>> = {
  implement: { name: 'POLISH_OUTPUT', from: '4' },
  resolve: { name: 'POLISH_RESULT', from: '7' },
}

/** The text without its code fences. */
const outsideFences = (text: string): string => text.replace(/```[^\n]*\n[\s\S]*?```/g, '')

/**
 * The phases from `from` on whose Requires line names `name`, or null when the command has no `from` heading. A skipped
 * Polish phase sets its output to `SKIPPED`, so no later phase may read it.
 */
function readersFrom(body: string, from: string, name: string): string[] | null {
  const numbers = phaseNumbers(body)
  const at = numbers.indexOf(from)
  if (at === -1) return null
  return numbers.slice(at).filter(num => dataFlowNames(phaseSection(body, num), 'Requires').includes(name))
}

/** #481 AC-3, `/implement`: the branch diff is defined once, in Phase 3 prose before the Polish fence, and Harden takes it. */
export function collectImplementPolishInputDefects(body: string): string[] {
  const out: string[] = []
  const defined = countOf(body, BRANCH_DIFF_DEFINITION)
  if (defined !== 1) out.push(`the branch diff definition appears ${defined} times, expected once`)
  else {
    const phase3 = phaseSection(body, '3')
    const at = phase3.indexOf(BRANCH_DIFF_DEFINITION)
    if (at === -1) out.push('the branch diff definition is not in Phase 3')
    else if (!outsideFences(phase3).includes(BRANCH_DIFF_DEFINITION)) out.push('the branch diff definition is inside a fence of Phase 3: a skipped Polish phase drops it')
    else if (phase3.indexOf(POLISH_SPAWN) === -1) out.push('Phase 3 has no Polish spawn')
    else if (at > phase3.indexOf(POLISH_SPAWN)) out.push('the branch diff definition is after the Polish fence')
  }
  const harden = parseFences(phaseSection(body, '4')).filter(f => isAgentBlock(f, 'Harden'))
  if (harden.length !== 1) out.push(`Phase 4 holds ${harden.length} Harden fences, expected 1`)
  else if (!harden[0].includes('\nFILES_CHANGED: {branch_diff}\n')) out.push('the Phase 4 Harden prompt does not take FILES_CHANGED: {branch_diff}')
  return out
}

/** #481 AC-3: no Requires line after the Polish phase names its output, because a skipped phase gives it no value. */
export function collectPolishOutputReaderDefects(body: string, spec: LevelSpec): string[] {
  const { name, from } = POLISH_OUTPUT_NAMES[spec.cmd]
  const readers = readersFrom(body, from, name)
  if (readers === null) return [`no "### Phase ${from}:" heading`]
  return readers.map(num => `Phase ${num} Requires names ${name}, which a skipped Polish phase sets to SKIPPED`)
}

/** #481 AC-3: the inputs and outputs of the Polish phase that a skip must leave whole, in one compiled build. */
export function collectPolishSkipDefects(body: string, spec: LevelSpec): string[] {
  switch (spec.cmd) {
    case 'implement': return [...collectImplementPolishInputDefects(body), ...collectPolishOutputReaderDefects(body, spec)]
    case 'resolve': return collectPolishOutputReaderDefects(body, spec)
  }
}

/** A command that keeps Polish at every level and reads no level: how many times it spawns Polish. */
interface KeeperSpec { readonly cmd: string; readonly spawns: number }
const KEEPERS: readonly KeeperSpec[] = [
  { cmd: 'self-review', spawns: 1 },
  { cmd: 'debug', spawns: 1 },
  { cmd: 'dynamic-build', spawns: 2 },
]
const POLISH_MARKER = new RegExp(POLISH_MARKERS.map(escapeRe).join('|'))
const polishSpawnCount = (body: string): number => POLISH_MARKERS.reduce((total, marker) => total + countOf(body, marker), 0)
const AGENT_CALL = /\bagent\(/i
/**
 * How many lines above its marker line a spawn call may open. A dynamic-build call opens on its marker line, but a probe
 * that puts a `GATE_LEVEL:` line inside the prompt moves `agent(` two lines up, and that is the longest shape here. The
 * bound is larger, so a prompt of several more lines still starts at its call.
 */
const SPAWN_CALL_LOOKBACK = 12

/** The line where the spawn call of the marker line `at` opens: the nearest `agent(` within the look-back, else `at`. */
function spawnCallStart(lines: readonly string[], at: number): number {
  for (let from = at; from >= Math.max(0, at - SPAWN_CALL_LOOKBACK); from--) if (AGENT_CALL.test(lines[from])) return from
  return at
}

/**
 * The text of each Polish spawn: the line that holds the spawn marker. A call that opens on an earlier line (see
 * `SPAWN_CALL_LOOKBACK`) starts there, and a block spawn (a marker line that ends `):`) runs to the next blank line or fence.
 */
function polishSpawnTexts(body: string): string[] {
  const lines = body.split('\n')
  const out: string[] = []
  lines.forEach((line, i) => {
    if (!POLISH_MARKER.test(line)) return
    const from = spawnCallStart(lines, i)
    let to = i
    if (line.trimEnd().endsWith('):')) while (to + 1 < lines.length && lines[to + 1].trim() !== '' && !lines[to + 1].startsWith('```')) to++
    out.push(lines.slice(from, to + 1).join('\n'))
  })
  return out
}

/** #481 AC-5: the command spawns Polish as often as it does today, names no level reference and puts no `GATE_LEVEL:` line in a Polish spawn. */
export function collectPolishKeeperDefects(body: string, keeper: KeeperSpec): string[] {
  const out: string[] = []
  const spawns = polishSpawnCount(body)
  if (spawns !== keeper.spawns) out.push(`${keeper.cmd} spawns Polish ${spawns} times, expected ${keeper.spawns}`)
  if (body.includes('-levels.md')) out.push(`${keeper.cmd} names a level reference`)
  polishSpawnTexts(body).forEach((spawn, i) => {
    if (/\bGATE_LEVEL\s*:/.test(spawn)) out.push(`${keeper.cmd}: Polish spawn ${i + 1} carries a GATE_LEVEL: line`)
  })
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
const VALIDATE = resolveAgentSource('validate').content

interface KeeperBuild { readonly label: string; readonly keeper: KeeperSpec; readonly body: string }
const KEEPER_BUILDS: readonly KeeperBuild[] = KEEPERS.flatMap(keeper => {
  const off = resolveLearningOffSource('commands', keeper.cmd)
  if (off === null) throw new Error(`dist/learning-off/commands/${keeper.cmd}.md is absent: run \`npm run build:mds\``)
  return [
    { label: `${keeper.cmd}, learning on`, keeper, body: requireDistFile(`${keeper.cmd}.md`) },
    { label: `${keeper.cmd}, learning off`, keeper, body: off },
  ]
})

/** The one paragraph of a doc that opens with `opener`. A missing or repeated paragraph throws at import, so the guard never skips. */
function paragraphOf(file: string, text: string, opener: string): string {
  const found = text.split('\n\n').filter(paragraph => paragraph.startsWith(opener))
  if (found.length !== 1) throw new Error(`${file} holds ${found.length} paragraphs that open "${opener}", expected 1`)
  return found[0]
}

/** The `## ` section of a doc, from its heading to the next `## ` heading. A missing section throws at import, so the guard never skips. */
function sectionOfDoc(file: string, text: string, heading: string): string {
  const from = text.indexOf(`\n${heading}\n`)
  if (from === -1) throw new Error(`${file} has no "${heading}" section`)
  const next = text.indexOf('\n## ', from + heading.length + 2)
  return text.slice(from + 1, next === -1 ? undefined : next)
}

/** A doc site as the product carries it, with the length below which the read has surely failed. */
interface ReadSite extends DocSite { readonly min: number }
const README_TEXT = readFileSync(path.join(ROOT, 'README.md'), 'utf-8')
const CLI_REFERENCE_TEXT = readFileSync(path.join(ROOT, 'docs', 'cli-reference.md'), 'utf-8')
const COMMANDS_DOC_TEXT = readFileSync(path.join(ROOT, 'docs', 'commands.md'), 'utf-8')
const BOTH_COMMANDS: DocSite['cmds'] = ['implement', 'resolve']
/** The texts that say what a level does to /implement and /resolve. Only the README, cli-reference and commands doc paragraphs and sections that name the level are read, so a "no Polish" elsewhere in a file cannot satisfy the check. */
const DOC_SITES: readonly ReadSite[] = [
  { label: 'the devflow gates text', text: GATE_LEVEL_EFFECT, cmds: BOTH_COMMANDS, min: 150 },
  { label: 'the standard init hint', text: GATE_LEVEL_HINTS.standard, cmds: BOTH_COMMANDS, min: 40 },
  { label: 'the lean init hint', text: GATE_LEVEL_HINTS.lean, cmds: BOTH_COMMANDS, min: 40 },
  { label: 'the README.md Gate level paragraph', text: paragraphOf('README.md', README_TEXT, OPEN), cmds: BOTH_COMMANDS, min: 500 },
  { label: 'the docs/cli-reference.md What reads it paragraph', text: paragraphOf('docs/cli-reference.md', CLI_REFERENCE_TEXT, '**What reads it.**'), cmds: BOTH_COMMANDS, min: 500 },
  { label: 'the docs/commands.md /implement section', text: sectionOfDoc('docs/commands.md', COMMANDS_DOC_TEXT, '## /implement'), cmds: ['implement'], min: 500 },
  { label: 'the docs/commands.md /resolve section', text: sectionOfDoc('docs/commands.md', COMMANDS_DOC_TEXT, '## /resolve'), cmds: ['resolve'], min: 500 },
]

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

/** The table rows after the separator, and the Rules bullets after the Rules intro: what `withRows` replaces. */
const TABLE_ROWS = new RegExp(`^${escapeRe(TABLE_SEPARATOR)}\\n(?:\\|.*\\n)*`, 'm')
const RULES_BULLETS = new RegExp(`${escapeRe(RULES_INTRO)}(?:\\n+- .*)*`)

/**
 * The reference with exactly these table rows and exactly these Rules bullets: it replaces the rows and bullets it holds,
 * so each probe states the whole table it checks. A probe that needs the shipped rows plus one more writes
 * `withRows(ref, [...spec.expectedRows, extra])`. It does not use `seed`, which fails when nothing changes, because a
 * probe may state the rows that the reference already holds. The existence checks keep it from going vacuous. The
 * replacers are functions, so a `$` in a probe stays literal.
 */
function withRows(ref: string, rows: readonly string[], bullets: readonly string[] = []): string {
  expect(ref, 'the reference holds the table separator').toContain(TABLE_SEPARATOR)
  expect(ref, 'the reference holds the Rules intro').toContain(RULES_INTRO)
  return ref
    .replace(TABLE_ROWS, () => `${TABLE_SEPARATOR}\n${rows.map(row => `${row}\n`).join('')}`)
    .replace(RULES_BULLETS, () => (bullets.length === 0 ? RULES_INTRO : `${RULES_INTRO}\n\n${bullets.join('\n')}`))
}

/** The row-safety defects of a reference whose one row applies the Rules bullet `line`. A line that does not open `- **<name>:**` gets no row. `phase` is the row's phase cell. */
function bulletDefects(spec: LevelSpec, line: string, phase: string = spec.sampleRow): string[] {
  const name = ruleBulletName(line)
  const rows = name === null ? [] : [`| ${phase} | apply: ${name} | - |`]
  return collectRowSafetyDefects(withRows(REFS[spec.cmd], rows, [line]), spec, bodyOf(spec))
}

/** The reference with two of its `## ` sections in each other's place. */
function swapSections(ref: string, first: string, second: string): string {
  const parts = ref.split(/^(?=## )/m)
  const indexOf = (heading: string): number => parts.findIndex(part => part.startsWith(`${heading}\n`))
  const [i, j] = [indexOf(first), indexOf(second)]
  expect(Math.min(i, j), `the reference holds "${first}" and "${second}"`).toBeGreaterThan(-1)
  return parts.map((part, k) => (k === i ? parts[j] : k === j ? parts[i] : part)).join('')
}

/** A probe seeds text inside the block, so it first checks that the compiled command carries the pinned read paragraph: without it the probe fails for that reason. */
function needsBlock(body: string, spec: LevelSpec): void {
  expect(body.includes(spec.readParagraph), `the compiled ${spec.cmd} lacks the pinned Gate level read paragraph`).toBe(true)
}

/** The block taken out of its place and put in front of `spec.moveBefore`, or of the end of its region. */
function movedBlock(body: string, spec: LevelSpec): string {
  const block = blockText(spec)
  const before = spec.moveBefore ?? spec.regionTo
  return seed(seed(body, `${block}\n\n`, ''), before, `${block}\n\n${before}`)
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
    for (const { label, text, min } of DOC_SITES) expect(text.length, `${label}: nothing read`).toBeGreaterThan(min)
    for (const { label, body } of KEEPER_BUILDS) expect(body.length, `${label}: nothing read`).toBeGreaterThan(5000)
  })
})

// ---------------------------------------------------------------------------
// d. The reference grammar
// ---------------------------------------------------------------------------

describe('the level references hold the fixed grammar and the decided rows (AC-5)', () => {
  it.each(BUILDS)('$label: the reference is well formed against the compiled command, and the closed set matches its headings', ({ spec, body }) => {
    expect(collectLevelReferenceDefects(REFS[spec.cmd], spec, body)).toEqual([])
    expect(collectClosedSetDefects(spec, body)).toEqual([])
  })

  it.each(SPECS)('$cmd: the table holds exactly the decided rows and the Rules section the decided bullets', spec => {
    expect(collectDecidedRowDefects(REFS[spec.cmd], spec)).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: a missing decided row or bullet and an undecided row or bullet are each reported', spec => {
    const ref = REFS[spec.cmd]
    const decided = collectDecidedRowDefects
    // A row and a bullet that no change decides, so the probes hold whatever rows the reference ships.
    const row = '| 99 Synthetic | skip | skip |'
    const bullet = '- **synthetic:** Polish the diff.'
    expect(decided(withRows(ref, spec.expectedRows, spec.expectedBullets), spec), 'the decided rows and bullets alone').toEqual([])
    expect(decided(ref, { ...spec, expectedRows: [...spec.expectedRows, row] }), 'a decided row the table lacks').toEqual([`the ${spec.cmd} table lacks the decided row ${row}`])
    expect(decided(withRows(ref, [...spec.expectedRows, row], spec.expectedBullets), spec), 'an undecided row').toEqual([`the ${spec.cmd} table holds the undecided row ${row}`])
    expect(decided(ref, { ...spec, expectedBullets: [...spec.expectedBullets, bullet] }), 'a decided bullet the Rules section lacks').toEqual([`the ${spec.cmd} Rules section lacks the decided bullet ${bullet}`])
    expect(decided(withRows(ref, spec.expectedRows, [...spec.expectedBullets, bullet]), spec), 'an undecided bullet').toEqual([`the ${spec.cmd} Rules section holds the undecided bullet ${bullet}`])
    // A second copy of a decided row is a surplus, and one changed cell is a missing row and an undecided row.
    expect(decided(withRows(ref, [row, row]), { ...spec, expectedRows: [row] }), 'a decided row twice').toEqual([`the ${spec.cmd} table holds the undecided row ${row}`])
    const changed = '| 99 Synthetic | skip | - |'
    expect(decided(withRows(ref, [changed]), { ...spec, expectedRows: [row] }), 'a decided row with one cell changed').toEqual([`the ${spec.cmd} table lacks the decided row ${row}`, `the ${spec.cmd} table holds the undecided row ${changed}`])
  })

  it.each(SPECS)('$cmd: known-bad probes: withRows replaces the rows and bullets it finds, keeps a $ literal and fails on a reference without its anchors', spec => {
    const ref = REFS[spec.cmd]
    const held = withRows(ref, ['| 3 Held | skip | skip |'], ['- **held:** one.'])
    expect(referenceRows(held), 'the first call put its row in').toEqual(['| 3 Held | skip | skip |'])
    expect(ruleBullets(parseRef(held)), 'the first call put its bullet in').toEqual(['- **held:** one.'])
    // The second call states `$&` in a row and in a bullet. A string replacer would put the matched text there.
    const next = withRows(held, ['| 4 Cost$& | - | - |'], ['- **next:** $& two.'])
    expect(referenceRows(next), 'the second call replaced the row, not appended').toEqual(['| 4 Cost$& | - | - |'])
    expect(ruleBullets(parseRef(next)), 'the second call replaced the bullet, not appended').toEqual(['- **next:** $& two.'])
    expect(withRows(next, [], []), 'the empty call leaves the bare reference').toBe(withRows(ref, [], []))
    expect(() => withRows(seed(ref, TABLE_SEPARATOR, ''), [], []), 'a reference without the table separator').toThrow('the reference holds the table separator')
    expect(() => withRows(seed(ref, RULES_INTRO, ''), [], []), 'a reference without the Rules intro').toThrow('the reference holds the Rules intro')
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

  it.each(SPECS)('$cmd: known-bad probes: a missing or swapped heading, a changed title or header, a bad phase, a bad cell and an unknown bullet are each reported', spec => {
    const ref = REFS[spec.cmd]
    const body = bodyOf(spec)
    const defects = (text: string): string[] => collectLevelReferenceDefects(text, spec, body)
    const sample = spec.sampleRow
    const num = sample.split(' ')[0]
    expect(defects(seed(ref, '## Phases\n', ''))).toContain('no "## Phases" heading')
    expect(defects(seed(ref, '## Grammar\n', ''))).toContain('no "## Grammar" heading')
    expect(defects(seed(ref, '## Rules\n', ''))).toContain('no "## Rules" heading')
    expect(defects(swapSections(ref, '## Grammar', '## Rules'))).toContain('the headings are "## Phases, ## Rules, ## Grammar", expected "## Phases, ## Grammar, ## Rules"')
    expect(defects(seed(ref, spec.title, '# Levels'))).toContain(`the reference does not open with "${spec.title}"`)
    expect(defects(seed(ref, TABLE_HEADER, '| Phase | standard, lean |'))).toContain(`the table header is "| Phase | standard, lean |", expected "${TABLE_HEADER}"`)
    expect(defects(seed(ref, TABLE_HEADER, '| Phase | full | standard | lean |'))).toContain(`the table header is "| Phase | full | standard | lean |", expected "${TABLE_HEADER}"`)
    expect(defects(seed(ref, TABLE_SEPARATOR, '|---|---|---|'))).toContain(`the table separator is "|---|---|---|", expected "${TABLE_SEPARATOR}"`)
    expect(defects(withRows(ref, [`| ${num} | skip | skip |`]))).toContain(`a row phase is not "<number> <name>": ${num}`)
    expect(defects(withRows(ref, ['| Phase 6 | skip | - |']))).toContain('a row phase is not "<number> <name>": Phase 6')
    expect(defects(withRows(ref, [`| ${sample} | skip |`]))).toContain(`a row does not have three cells: | ${sample} | skip |`)
    expect(defects(withRows(ref, [`| ${sample} | drop: x | - |`]))).toContain(`row ${num} standard: the cell holds "drop: x", which is not skip, -, apply: <name> or pass level`)
    expect(defects(withRows(ref, [`| ${sample} | - | apply: nosuch |`]))).toContain(`row ${num} lean: the cell applies "nosuch", which no Rules bullet names`)
    expect(defects(withRows(ref, [`| ${sample} | skip; pass level | - |`]))).toContain(`row ${num} standard: the cell holds "skip", which is not skip, -, apply: <name> or pass level`)
    expect(defects(withRows(ref, [`| ${sample} | pass level; pass level | - |`]))).toContain(`row ${num} standard: the cell repeats "pass level"`)
    expect(defects(withRows(ref, [`| ${sample} | apply: a, b | - |`], ['- **a:** Polish the diff.']))).toContain(`row ${num} standard: the cell holds "apply: a, b", which is not skip, -, apply: <name> or pass level`)
    expect(defects(withRows(ref, [], ['- Polish the diff.']))).toContain('a Rules bullet does not open "- **<name>:**": - Polish the diff.')
    expect(defects(withRows(ref, [], ['- **a:** Polish the diff.', '- **a:** Polish it again.']))).toContain('the Rules bullet "a" is repeated')
  })

  it('known-bad probes: the phase set is closed and keyed by the compiled heading name, and a repeated phase heading is reported', () => {
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
    for (const spec of SPECS) {
      const [num, name] = spec.closed[0]
      expect(collectClosedSetDefects(spec, `${bodyOf(spec)}\n### Phase ${num}: ${name}\n`), `a second "### Phase ${num}:" heading of ${spec.cmd}`).toContain(`the compiled command holds 2 "### Phase ${num}:" headings, expected 1`)
    }
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

  it('known-bad probes: a phase with no spawn takes only -', () => {
    const tidy = ['- **tidy:** Polish only the files named in the diff.']
    const res = (rows: string[], body: string = bodyOf(RESOLVE)): string[] => collectLevelReferenceDefects(withRows(REFS.resolve, rows, tidy), RESOLVE, body)
    expect(phaseSection(bodyOf(RESOLVE), '3'), 'Phase 3 of /resolve spawns no agent').not.toMatch(/\bAgent\(/)
    expect(res(['| 3 Batch FIX_NOW Issues | apply: tidy | - |'])).toEqual(['row 3 standard: the cell applies "tidy", but phase 3 has no spawn to change'])
    expect(res(['| 3 Batch FIX_NOW Issues | - | apply: tidy; pass level |'])).toEqual(['row 3 lean: the cell applies "tidy", but phase 3 has no spawn to change'])
    expect(res(['| 3 Batch FIX_NOW Issues | - | - |']), 'a - cell is the one cell a no-spawn phase takes').toEqual([])
    const bare = seedIn(bodyOf(RESOLVE), '### Phase 6: Polish', '### Phase 7:', 'Agent(subagent_type="Polish", run_in_background=false):', 'Run the Polish step:')
    expect(phaseSection(bare, '6'), 'the seeded Phase 6 spawns no agent').not.toMatch(/\bAgent\(/)
    expect(res(['| 6 Polish | skip | - |'], bare)).toEqual(['row 6 standard: the cell takes skip, but phase 6 has no spawn to skip'])
    expect(res(['| 6 Polish | - | apply: tidy |'], bare)).toEqual(['row 6 lean: the cell applies "tidy", but phase 6 has no spawn to change'])
    expect(res(['| 6 Polish | - | - |'], bare)).toEqual([])
    expect(res(['| 6 Polish | skip | apply: tidy |']), 'the unmodified Phase 6 spawns Polish').toEqual([])
  })

  it.each(SPECS)('$cmd: well-formed rows and bullets pass the grammar and the row-safety check', spec => {
    const body = bodyOf(spec)
    const rows = spec.cmd === 'implement'
      ? ['| 3 Polish | apply: tidy; pass level | skip |', '| 4 Self-Review | - | pass level |', '| 5 Alignment Check | pass level | apply: tidy |']
      : ['| 2 Global Triage | pass level | pass level |', '| 3 Batch FIX_NOW Issues | - | - |', '| 4 Fix | - | pass level |', '| 6 Polish | apply: tidy | skip |', '| 9 Manage Debt | pass level | - |']
    const ref = withRows(REFS[spec.cmd], rows, ['- **tidy:** Polish only the files named in the diff.'])
    expect(collectLevelReferenceDefects(ref, spec, body)).toEqual([])
    expect(collectRowSafetyDefects(ref, spec, body)).toEqual([])
    expect(referenceRows(ref)).toEqual(rows)
  })
})

describe('the doc sites state the effect of each shipped row and keep no retired claim (#481 AC-6)', () => {
  /** Test-only sites: the probes do not depend on what the real docs say, so they hold before and after the rows ship. */
  const effect = 'At standard and lean they skip Polish, and full keeps it.'
  const site = (text: string, cmds: DocSite['cmds'] = BOTH_COMMANDS): DocSite => ({ label: 'the probe site', text, cmds })
  const none = { implement: withRows(REFS.implement, []), resolve: withRows(REFS.resolve, []) }
  const both = { implement: withRows(REFS.implement, ['| 3 Polish | skip | skip |']), resolve: withRows(REFS.resolve, ['| 6 Polish | skip | skip |']) }
  const onlyResolve = { implement: none.implement, resolve: both.resolve }

  it('the sites are the registered ones, each read from the product, and the shipped tables leave no defect', () => {
    expect(DOC_SITES.map(s => s.label)).toEqual([
      'the devflow gates text',
      'the standard init hint',
      'the lean init hint',
      'the README.md Gate level paragraph',
      'the docs/cli-reference.md What reads it paragraph',
      'the docs/commands.md /implement section',
      'the docs/commands.md /resolve section',
    ])
    expect(collectDocSiteDefects(DOC_SITES, REFS)).toEqual([])
  })

  it('every ROW_EFFECTS key is a command and a row line, and POLISH_SKIP reads the three wordings of a skip', () => {
    for (const key of ROW_EFFECTS.keys()) expect(key, key).toMatch(/^(?:implement|resolve):\| \d+[a-z]? \S.* \| \S.* \| \S.* \|$/)
    for (const text of ['they skip Polish', 'it skips Polish', 'and no Polish (the default)']) expect(POLISH_SKIP.test(text), text).toBe(true)
    for (const text of ['Polish is skipped', 'keeps Polish', 'the full plan shape and Polish', 'noPolish']) expect(POLISH_SKIP.test(text), text).toBe(false)
  })

  it('known-bad probes (test-only sites): while no table has a row, no effect is owed and a retired claim is allowed', () => {
    expect(collectDocSiteDefects([site('Nothing about the levels.')], none)).toEqual([])
    expect(collectDocSiteDefects([site(RETIRED_CLAIMS.join(' and '))], none)).toEqual([])
    expect(collectDocSiteDefects([site(effect)], none), 'an effect with no row to state').toEqual([])
  })

  it('known-bad probes (test-only sites): a site that states the effect once is clean, and a site without it, or with it twice, is reported', () => {
    expect(collectDocSiteDefects([site(effect)], both)).toEqual([])
    expect(collectDocSiteDefects([site('Nothing about Polish here.')], both)).toEqual([
      `the probe site does not state the effect of the implement row | 3 Polish | skip | skip |: it must match ${POLISH_SKIP}`,
      `the probe site does not state the effect of the resolve row | 6 Polish | skip | skip |: it must match ${POLISH_SKIP}`,
    ])
    expect(collectDocSiteDefects([site(`${effect} ${effect}`)], both)).toEqual([
      'the probe site states the effect of the implement row | 3 Polish | skip | skip | 2 times, expected once',
      'the probe site states the effect of the resolve row | 6 Polish | skip | skip | 2 times, expected once',
    ])
  })

  it('known-bad probes (test-only sites): a site owes the effect of the rows of its own commands only', () => {
    expect(collectDocSiteDefects([site('No effect here.', ['implement'])], onlyResolve), 'an /implement site while only /resolve has a row').toEqual([])
    expect(collectDocSiteDefects([site('No effect here.', ['resolve'])], onlyResolve)).toEqual([
      `the probe site does not state the effect of the resolve row | 6 Polish | skip | skip |: it must match ${POLISH_SKIP}`,
    ])
    expect(collectDocSiteDefects([site(effect, ['resolve'])], onlyResolve)).toEqual([])
  })

  it('known-bad probes (test-only sites): once any table has a row, each retired claim at a site is reported', () => {
    for (const claim of RETIRED_CLAIMS) {
      expect(collectDocSiteDefects([site(`${effect} The references hold ${claim}.`)], both), claim).toEqual([`a table has a row (implement, resolve), but the probe site still says "${claim}"`])
      expect(collectDocSiteDefects([site(`${effect} ${claim}`, ['implement'])], onlyResolve), `${claim}, a site of the command with no row`).toEqual([`a table has a row (resolve), but the probe site still says "${claim}"`])
    }
  })

  it('known-bad probes (test-only sites): a shipped row with no ROW_EFFECTS entry is reported, and one changed cell is a new row', () => {
    const unregistered = withRows(REFS.implement, ['| 3 Polish | skip | skip |', '| 4 Self-Review | pass level | - |'])
    expect(collectDocSiteDefects([site(effect)], { ...both, implement: unregistered })).toEqual(['the implement row | 4 Self-Review | pass level | - | has no ROW_EFFECTS entry'])
    const changed = withRows(REFS.implement, ['| 3 Polish | skip | - |'])
    expect(collectDocSiteDefects([site(effect)], { ...both, implement: changed })).toEqual(['the implement row | 3 Polish | skip | - | has no ROW_EFFECTS entry'])
    const other = new Map([['implement:| 3 Polish | skip | skip |', /\bleaves out Polish\b/]])
    expect(collectDocSiteDefects([site(effect, ['implement'])], both, other), 'a registered effect that the site lacks').toEqual([
      'the resolve row | 6 Polish | skip | skip | has no ROW_EFFECTS entry',
      'the probe site does not state the effect of the implement row | 3 Polish | skip | skip |: it must match /\\bleaves out Polish\\b/',
    ])
  })

  // The probes over the real sites need the rows to ship, so they ride with them. The pin test below fixes `shippedRows`,
  // so an empty `expectedRows` fails there instead of passing on an empty loop.
  const shippedRows = SPECS.flatMap(spec => spec.expectedRows.map(row => ({ cmd: spec.cmd, row })))
  const withRowCmds = SPECS.filter(spec => spec.expectedRows.length > 0).map(spec => spec.cmd)

  it('known-bad probes (real sites): the decided rows are the ones the probes loop over', () => {
    expect(shippedRows.map(({ cmd, row }) => `${cmd}:${row}`)).toEqual(['implement:| 3 Polish | skip | skip |', 'resolve:| 6 Polish | skip | skip |'])
    expect(withRowCmds).toEqual(['implement', 'resolve'])
  })

  it('known-bad probes (real sites): a real site with its effect phrase taken out is reported for every shipped row it covers', () => {
    const covered = new Set<string>()
    for (const real of DOC_SITES) {
      const owed = shippedRows.filter(({ cmd }) => real.cmds.includes(cmd))
      expect(owed.length, `${real.label}: no shipped row to state`).toBeGreaterThan(0)
      const without: DocSite = { ...real, text: seed(real.text, POLISH_SKIP, 'runs Polish') }
      expect(collectDocSiteDefects([without], REFS), real.label).toEqual(
        owed.map(({ cmd, row }) => `${real.label} does not state the effect of the ${cmd} row ${row}: it must match ${POLISH_SKIP}`),
      )
      for (const { cmd, row } of owed) covered.add(`${cmd}:${row}`)
    }
    expect(covered.size, 'every shipped row was probed at a real site').toBe(shippedRows.length)
  })

  it('known-bad probes (real sites): a retired claim put back at any real site is reported', () => {
    for (const real of DOC_SITES) {
      for (const claim of RETIRED_CLAIMS) {
        const putBack: DocSite = { ...real, text: `${real.text} The references hold ${claim}.` }
        expect(collectDocSiteDefects([putBack], REFS), `${real.label}: ${claim}`).toEqual([`a table has a row (${withRowCmds.join(', ')}), but ${real.label} still says "${claim}"`])
      }
    }
  })

  it('known-bad probes (real sites): an unregistered row or one changed cell in a shipped table is reported against the real sites', () => {
    const extra: Readonly<Record<string, string>> = { implement: '| 4 Self-Review | pass level | - |', resolve: '| 2 Global Triage | pass level | - |' }
    for (const { cmd, row } of shippedRows) {
      const rows = SPECS.find(spec => spec.cmd === cmd)?.expectedRows ?? []
      const added = withRows(REFS[cmd], [...rows, extra[cmd]])
      expect(collectDocSiteDefects(DOC_SITES, { ...REFS, [cmd]: added }), `${cmd}: an unregistered row`).toEqual([`the ${cmd} row ${extra[cmd]} has no ROW_EFFECTS entry`])
      const changed = row.replace(/ skip \|$/, ' - |')
      expect(changed, `${cmd}: the cell change landed`).not.toBe(row)
      const edited = withRows(REFS[cmd], rows.map(each => (each === row ? changed : each)))
      expect(collectDocSiteDefects(DOC_SITES, { ...REFS, [cmd]: edited }), `${cmd}: one changed cell`).toEqual([`the ${cmd} row ${changed} has no ROW_EFFECTS entry`])
    }
  })
})

// ---------------------------------------------------------------------------
// e. Row safety
// ---------------------------------------------------------------------------

describe('row safety is a tripwire over the references (AC-6)', () => {
  it.each(BUILDS)('$label: the shipped rows and Rules sections pass, and the pinned text is the file', ({ spec, body }) => {
    expect(collectRowSafetyDefects(REFS[spec.cmd], spec, body)).toEqual([])
  })

  it('the pinned text is the reference, and the protected phases are the complement of the closed set', () => {
    for (const spec of SPECS) {
      const parsed = parseRef(REFS[spec.cmd])
      expect(sectionOf(parsed, '## Phases')?.lines.filter(line => !line.startsWith('|')), `${spec.cmd}: the intro`).toEqual([spec.intro])
      expect(sectionOf(parsed, '## Grammar')?.lines, `${spec.cmd}: the grammar`).toEqual(spec.grammar)
      expect(sectionOf(parsed, '## Rules')?.lines, `${spec.cmd}: the Rules section`).toEqual([RULES_INTRO, ...spec.expectedBullets])
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
    expect(RESOLVE.readParagraph, 'the block leaves the level of a phase to the reference').toContain('apply each row to the phase it names, as the reference says.')
    expect(RESOLVE.readParagraph, 'the block puts no phase on its own worktree level').not.toContain('at its own level')
    expect(defects(ref), 'the unmodified reference').toEqual([])
    expect(defects(seed(ref, '`full` is the strictest and `lean` the least strict', '`lean` is the strictest and `full` the least strict')), 'the order reversed').toEqual(pinned)
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
    // A removal verb that precedes the floor name; "turn off" in each of its four forms.
    const verbs = ['Drop the security check.', 'Turn off ESCALATED routing.', 'Turn off Validate.', 'Turns off Validate.', 'Validate is turned off.', 'Turning off Validate.', 'Bypass the compliance directive.', 'Skip Validate.', 'Skip Harden.', 'Omit the CI gate.', 'Ignore the Verification Gate.', 'Defer the evidence claims.', 'Run without security review.', 'Disable compliance.', 'Remove ESCALATED.', 'No security check.', 'BYPASS THE COMPLIANCE DIRECTIVE.']
    // A negation, stop, leave out or cut, on either side of the floor name; "does not" and the contractions in both apostrophes.
    const negations = ['Validate does not run.', 'Never run Validate.', 'Do not spawn Validate.', "Don't run Validate.", "Validate doesn't run.", 'Don\u2019t run Validate.', 'Validate doesn\u2019t run.', 'Stop Validate.', 'Leave out Validate.', 'Cut the CI gate.']
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
    const actions = [
      'Run git status.', 'Call gh pr comment.', 'Use GitHub.', 'Run Bash to count lines.', 'Use the Write tool on the summary.',
      'Push the branch.', 'Pushes the branch.', 'Pushed the branch.', 'Pushing the branch.',
      'Commit the result.', 'Commits the result.', 'Committed the result.', 'Committing the result.',
      'Write the summary to disk.', 'Writes the summary.', 'Wrote the summary.', 'The summary is written.', 'Writing the summary.',
      'Post to GitHub.', 'Post a PR comment.', 'Posts a comment.', 'Posted a comment.', 'Posting a comment.', 'Run git push after the spawn.',
    ]
    for (const bullet of actions) expect(defects(bullet), bullet).toContain(action)
    expect(defects('Run `x` in a fence: ```sh\nls\n```')).toContain(action)
    expect(defects('Polish only the files named in the diff.'), 'a safe bullet').toEqual([])
    expect(defects('Polish only the files the PR changed.'), 'a PR alone is no GitHub action').toEqual([])
    // "no" and "not" here do not apply to Validate: the removal word and the floor name are too far apart to read as one clause.
    expect(defects('Pass no extra files to Validate.'), 'a safe bullet with no and Validate').toEqual([])
    expect(defects('Run Validate on files that are not generated.'), 'a safe bullet with not and Validate').toEqual([])
    const unnamed = collectRowSafetyDefects(withRows(REFS[spec.cmd], [], ['- **tidy:** Polish only the files named in the diff.']), spec, body)
    expect(unnamed).toEqual(['Rules bullet "tidy" is named by no row'])
  })

  it.each(SPECS)('$cmd: known-bad probes: a removal verb counts anywhere in the bullet, and a bullet named for a floor control is read with its name', spec => {
    const defects = (text: string): string[] => bulletDefects(spec, `- **probe:** ${text}`)
    const floor = 'Rules bullet "probe" removes or defers a floor control'
    // The floor name stands in a list, behind other words, behind a colon or in another sentence than the verb.
    const lists = [
      'Skip Polish and the CI gate.', 'Skip Polish and the Verification Gate.', 'Skip the Polish spawn and the CI gate.', 'Skip Polish, Alignment Check and Validate.',
      'Skip Phase 6 and Phase 7.', 'Skip the slow final Validate run.', 'Skip all the security checks.', 'Remove the second, third and fourth security passes.',
      'Defer the whole of the compliance directive to a later run.', 'Validate: skip.', 'Validate: skip it', 'Validate runs last. Skip it at lean.',
    ]
    for (const text of lists) expect(defects(text), text).toContain(floor)
    // The bullet name is part of the bullet: a name that is a floor control is read with the text that follows it.
    expect(bulletDefects(spec, '- **validate:** skipped at lean.'), 'a verb behind the bullet name').toContain('Rules bullet "validate" removes or defers a floor control')
    expect(bulletDefects(spec, '- **validate:** not run at lean.'), 'a negation behind the bullet name').toContain('Rules bullet "validate" removes or defers a floor control')
    // A bullet that does not open "- **<name>:**" is reported by the grammar check, and row safety still reads its text.
    expect(bulletDefects(spec, '- Skip Validate.'), 'a malformed bullet').toContain('Rules bullet "- Skip Validate." removes or defers a floor control')
  })

  it.each(SPECS)('$cmd: known-bad probes: a negation counts within two words of a floor name and its tail words, and not across a sentence stop', spec => {
    const defects = (text: string): string[] => bulletDefects(spec, `- **probe:** ${text}`)
    const floor = 'Rules bullet "probe" removes or defers a floor control'
    // The floor name takes its tail words (gate, status, agent, run, check, checks) before the count starts. The first two read several tail words. Each of the rest has two words after its one tail word, so it fails without that tail word.
    const tails = [
      'The CI Status Gate does not run.', 'The Verification Gate agent does not run.',
      'The CI gate in lean does not run.', 'The CI status in lean does not run.', 'The Validate agent in lean does not run.',
      'The Validate run on lean does not happen.', 'The security check on lean does not happen.', 'The security checks on lean do not happen.',
    ]
    // Exactly two words between the negation and the floor name, in each order: a window of one word misses these.
    const twoWords = ['Do not run the Validate agent.', 'Validate on lean never runs.', 'Validate on lean does not run.', 'Validate and Polish do not run at lean.']
    for (const text of [...tails, ...twoWords]) expect(defects(text), text).toContain(floor)
    // Three words or more apart, the negation and the floor name are two clauses.
    const apart = ['Pass no extra files to Validate.', 'Run Validate on files that are not generated.', 'Validate each generated file, not the rest.']
    // A sentence stop ends the clause, in each order.
    const stops = ['.', ';', '!', '?'].flatMap(stop => [`Add no extras${stop} Validate runs.`, `Run Validate first${stop} No extra files.`])
    // A floor name alone, with its tail words, is no removal.
    const bare = ['Run the Validate agent on the files named in the diff.', 'Run Harden on the files named in the diff.', 'Fix only the listed issues.', 'Polish only the files named in the diff.']
    for (const text of [...apart, ...stops, ...bare]) expect(defects(text), text).toEqual([])
  })

  it.each(SPECS)('$cmd: known-bad probes: a plural Phases list counts when any number in it is a floor phase, and a list of skippable phases stays safe', spec => {
    const defects = (text: string): string[] => bulletDefects(spec, `- **probe:** ${text}`)
    const floor = 'Rules bullet "probe" removes or defers a floor control'
    const skippable = spec.closed.map(([n]) => n).filter(n => !spec.neverSkip.includes(n))
    const first = skippable[0]
    // Phase 7 is a floor phase in both specs. Each list opens with a skippable number and reaches Phase 7 later, behind "and", "or", a comma or an Oxford comma, so a match on the first number alone misses it.
    const lists = ['Skip Phases 6 and 7.', 'Skip Phases 6, 7 and 8.', `Skip Phases ${first} and 7.`, `Skip Phases ${first}, 7 and 8.`, `Skip Phases ${first} or 7.`, `Skip Phases ${first}, 7, and 8.`, `Skip Phases ${first} and 7 at lean.`]
    // A negation reads the list the same way, before it and after it.
    const negations = [`Do not run Phases ${first} and 7.`, `Phases ${first} and 7 do not run.`]
    for (const text of [...lists, ...negations]) expect(defects(text), text).toContain(floor)
    // A plural list of skippable phases alone is no removal. /resolve skips Phase 6 alone, so it holds no such list and no safe probe.
    if (skippable.length >= 2) expect(defects(`Skip Phases ${skippable.slice(0, -1).join(', ')} and ${skippable[skippable.length - 1]}.`), 'skippable phases only').toEqual([])
    else expect(skippable, `${spec.cmd} has one skippable phase, so it has no plural list of them`).toHaveLength(1)
  })

  it.each(SPECS)('$cmd: known-bad probes: a Rules bullet that drops a fix, an issue, an edit, a commit or a ticket of the fix path is reported', spec => {
    const defects = (text: string): string[] => bulletDefects(spec, `- **probe:** ${text}`)
    const floor = 'Rules bullet "probe" removes or defers a floor control'
    // One removal verb and one fix-path name: FIX_NOW, FIX_SEPARATE, ticket(s), fix(es), edit(s), commit(s) and issue(s).
    const names = ['Skip FIX_NOW.', 'Skip FIX_SEPARATE.', 'Skip the ticket.', 'Skip tickets.', 'Skip the fix.', 'Skip the fixes.', 'Skip the edit.', 'Skip edits.', 'Skip the commit.', 'Skip commits.', 'Skip the issue.', 'Skip issues.']
    // The shapes that leave a security fix or a ticket undone without a removal verb for the control.
    const shapes = ['Batch only CRITICAL and HIGH issues; leave the rest.', 'Batch only CRITICAL and HIGH issues; leave the rest for a later run.', 'Report the fixes and make no edits.', 'Record FIX_SEPARATE items with no ticket.']
    for (const text of [...names, ...shapes]) expect(defects(text), text).toContain(floor)
  })

  it('known-bad probes (/resolve): a Rules bullet that a Triage row applies names no disposition', () => {
    const triage = (text: string): string[] => bulletDefects(RESOLVE, `- **probe:** ${text}`, '2 Global Triage')
    const named = 'Rules bullet "probe" is applied by a Triage row and names a disposition'
    expect(IMPLEMENT.triage, '/implement runs no Triage phase').toEqual([])
    expect(RESOLVE.closed.filter(([, name]) => /Triage/.test(name)).map(([n]) => n), 'the Triage phases of the spec are the closed-set phases named Triage').toEqual(RESOLVE.triage)
    for (const text of ['Route each LOW finding to TECH_DEBT.', 'Mark each LOW finding FALSE_POSITIVE.', 'Send each LOW finding to BY_DESIGN.', 'Send each LOW finding to FIX_SEPARATE.', 'Treat each LOW finding as DUPLICATE.', 'Treat each LOW finding as ESCALATED.', 'Treat each LOW finding as FIX_NOW.']) {
      expect(triage(text), text).toContain(named)
    }
    expect(triage('Polish only the files named in the diff.'), 'a Triage bullet that names no disposition').toEqual([])
    expect(bulletDefects(RESOLVE, '- **probe:** Route each LOW finding to TECH_DEBT.', '6 Polish'), 'the same bullet on a phase that runs no Triage').toEqual([])
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
    expect(collectRowSafetyDefects(seed(ref, 'reads `SKIPPED`', 'reads `skipped`'), spec, body), 'the Skipped bullet').toEqual(['the "## Grammar" text is not the pinned text'])
    expect(collectRowSafetyDefects(seed(ref, 'to every spawn prompt of the phase. A phase with no spawn takes only `-`', "to the phase's spawn prompt"), spec, body), 'the pass level target').toEqual(['the "## Grammar" text is not the pinned text'])
    expect(collectRowSafetyDefects(seed(ref, RULES_INTRO, `${RULES_INTRO} Extra.`), spec, body)).toEqual(['the "## Rules" section holds text other than the pinned intro and its bullets'])
    expect(collectRowSafetyDefects(withRows(ref, [], ['- **tidy:** Polish the diff.\ncontinued here']), spec, body)).toContain('the "## Rules" section holds text other than the pinned intro and its bullets')
    expect(collectRowSafetyDefects(seed(ref, '## Phases\n', 'Stray text.\n\n## Phases\n'), spec, body)).toContain('the reference holds text between its title and "## Phases"')
  })

  it('known-bad probe (/implement): a Gate level block bullet that stops keeping the branch diff definition on a Polish skip is reported (#481 AC-3)', () => {
    const cut = seed(REFS.implement, ' or the `{branch_diff}` definition', '')
    expect(collectRowSafetyDefects(cut, IMPLEMENT, bodyOf(IMPLEMENT))).toEqual(['the "## Grammar" text is not the pinned text'])
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
    expect(collectLevelBlockDefects(movedBlock(body, { ...spec, moveBefore: spec.regionFrom }), spec), 'the block in front of its region').toContain(spec.outsideMessage)
    const block = blockText(spec)
    expect(collectLevelBlockDefects(`${seed(body, `${block}\n\n`, '')}\n${block}\n\n`, spec), 'the block after its region').toContain(spec.outsideMessage)
  })

  it.each(SPECS)('$cmd: known-bad probes: a block inside a learning arm of the source is reported', spec => {
    const source = SOURCES[spec.cmd]
    expect(source.includes(OPEN), `the ${spec.cmd} source lacks the Gate level block`).toBe(true)
    for (const arm of ['on', 'off']) {
      const wrapped = seed(seed(source, OPEN, `<!-- learning:${arm} -->\n${OPEN}`), spec.nextParagraph, `<!-- learning:end -->\n${spec.nextParagraph}`)
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

  it.each(SPECS)('$cmd: known-bad probes: wording that sets the level to full and a bullet without the header clause are reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const defects = (text: string): string[] => collectFailClosedDefects(text, spec, VALIDATE)
    const bullet = `- ${spec.items[1]}`
    const setsFull = '- If the Read fails, or a row is missing or malformed, set `GATE_LEVEL` to `full` and say `level reference unreadable: full applied`.'
    expect(defects(seed(body, bullet, setsFull))).toEqual(expect.arrayContaining(['the fail-closed bullet holds "full applied"', 'the fail-closed bullet sets GATE_LEVEL']))
    expect(defects(seed(body, `or the file ${NO_HEADING}, `, ''))).toContain(`the fail-closed bullet lacks: ${NO_HEADING}`)
    expect(defects(seed(body, `or ${BAD_ROW}, `, ''))).toContain(`the fail-closed bullet lacks: ${BAD_ROW}`)
    expect(defects(seed(body, spec.failClosed[2], 'apply nothing and'))).toContain(`the fail-closed bullet lacks: ${spec.failClosed[2]}`)
    expect(defects(seed(body, `say ${UNREADABLE_LINE}`, 'say nothing'))).toContain(`the fail-closed bullet lacks: ${UNREADABLE_LINE}`)
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

  it.each(SPECS)('$cmd: known-bad probes: a second mention, a mention outside the read paragraph and a removed level condition are reported', spec => {
    const body = bodyOf(spec)
    needsBlock(body, spec)
    const defects = (text: string): string[] => collectFullPathDefects(text, spec)
    expect(defects(`${body}\nRead ${spec.refFile} again.\n`)).toContain(`${spec.refFile} is named 2 times, expected once, inside the Gate level block`)
    const elsewhere = `${seed(body, spec.readParagraph, spec.readParagraph.replace(spec.refFile, 'levels.md'))}\nRead ${spec.refFile}.\n`
    expect(defects(elsewhere)).toEqual([`the one mention of ${spec.refFile} is outside the Gate level block`])
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
  it.each(BUILDS.filter(b => b.spec === RESOLVE))('$label: the empty FIX_NOW route, the route after push, the numbered principles and the edge row', ({ body }) => {
    expect(collectCutRouteDefects(body)).toEqual([])
  })

  it('known-bad probes: a pushing phase in the route, a reworded empty route and a shortened route after push are each reported', () => {
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

  it('known-bad probes: an edge row that an all-false-positive run could match is reported', () => {
    const body = bodyOf(RESOLVE)
    const parsedRow = `| ${EDGE_EMPTY_PARSE_CASE} | ${EDGE_EMPTY_PARSE_HANDLING} |`
    expect(body, 'the edge row names the parse-time case').toContain(parsedRow)
    expect(collectCutRouteDefects(seed(body, parsedRow, `| No actionable issues | ${EDGE_EMPTY_PARSE_HANDLING} |`)))
      .toEqual(expect.arrayContaining([
        `the edge row that reports "No issues to resolve" reads "No actionable issues", expected "${EDGE_EMPTY_PARSE_CASE}"`,
        'the edge case "No actionable issues" could catch an all-false-positive run, which takes the empty FIX_NOW route',
      ]))
    expect(collectCutRouteDefects(seed(body, '| Fix attempt fails |', '| No actionable issues | Normal completion |\n| Fix attempt fails |')))
      .toContain('the edge case "No actionable issues" could catch an all-false-positive run, which takes the empty FIX_NOW route')
    expect(collectCutRouteDefects(seed(body, parsedRow, '| No issues found | Normal completion |')))
      .toContain('the edge case that reports "No issues to resolve" appears in 0 rows, expected once')
    expect(collectCutRouteDefects(seed(body, '## Edge Cases', '## Edge Notes'))).toContain('no "## Edge Cases" section')
  })
})

// ---------------------------------------------------------------------------
// i. What a skipped Polish phase leaves alone
// ---------------------------------------------------------------------------

describe('a skipped Polish phase leaves the branch diff and the readers of its output alone (#481 AC-3)', () => {
  it.each(BUILDS)('$label: the branch diff is defined once before the Polish fence, Harden takes it, and no later phase reads the Polish output', ({ spec, body }) => {
    expect(collectPolishSkipDefects(body, spec)).toEqual([])
  })

  /** The heading that follows Phase `num`, so a probe seeds inside that phase only. */
  const nextPhaseHeading = (body: string, num: string): string | null => {
    const numbers = phaseNumbers(body)
    const next = numbers[numbers.indexOf(num) + 1]
    return next === undefined ? null : `### Phase ${next}:`
  }
  /** The Requires line of Phase `num` with `name` added. */
  const withReader = (body: string, num: string, name: string): string => seedIn(body, `### Phase ${num}:`, nextPhaseHeading(body, num), /^\*\*Requires:\*\* .+$/m, `$&, ${name}`)

  it.each(BUILDS.filter(b => b.spec === IMPLEMENT))('$label: known-bad probes (/implement): a branch diff definition that is gone, moved or repeated, and a Harden prompt without the diff, are each reported', ({ spec, body }) => {
    const defects = (text: string): string[] => collectPolishSkipDefects(text, spec)
    expect(countOf(body, BRANCH_DIFF_DEFINITION), 'the definition appears once in the unmodified command').toBe(1)
    const gone = seed(body, BRANCH_DIFF_DEFINITION, 'The branch diff is the output of')
    expect(defects(gone), 'the definition removed').toEqual(['the branch diff definition appears 0 times, expected once'])
    const inFence = seedIn(gone, '### Phase 3: Polish', '### Phase 4:', 'FILES_CHANGED: {branch_diff}\n', `FILES_CHANGED: {branch_diff}\n${BRANCH_DIFF_DEFINITION} the changed files.\n`)
    expect(defects(inFence), 'the definition moved into the Polish fence').toEqual(['the branch diff definition is inside a fence of Phase 3: a skipped Polish phase drops it'])
    const afterFence = seed(gone, '\n### Phase 4: ', `\n${BRANCH_DIFF_DEFINITION} the changed files.\n\n### Phase 4: `)
    expect(defects(afterFence), 'the definition after the Polish fence').toEqual(['the branch diff definition is after the Polish fence'])
    const inPhase4 = seedIn(gone, '### Phase 4:', '### Phase 5:', 'After Phase 3, spawn Harden agent', `${BRANCH_DIFF_DEFINITION} the changed files. After Phase 3, spawn Harden agent`)
    expect(defects(inPhase4), 'the definition moved to Phase 4').toEqual(['the branch diff definition is not in Phase 3'])
    const twice = seed(body, '\n### Phase 4: ', `\n${BRANCH_DIFF_DEFINITION} the changed files.\n\n### Phase 4: `)
    expect(defects(twice), 'the definition twice').toEqual(['the branch diff definition appears 2 times, expected once'])
    const noSpawn = seedIn(body, '### Phase 3: Polish', '### Phase 4:', POLISH_SPAWN, 'Agent(subagent_type="Harden"')
    expect(defects(noSpawn), 'Phase 3 without a Polish spawn').toEqual(['Phase 3 has no Polish spawn'])
    const codeFiles = seedIn(body, '### Phase 4:', '### Phase 5:', 'FILES_CHANGED: {branch_diff}', 'FILES_CHANGED: {code_agent_files}')
    expect(defects(codeFiles), 'a Harden prompt that takes the Code agent file list').toEqual(['the Phase 4 Harden prompt does not take FILES_CHANGED: {branch_diff}'])
    const noHarden = seedIn(body, '### Phase 4:', '### Phase 5:', 'Agent(subagent_type="Harden"', 'Agent(subagent_type="Evaluate"')
    expect(defects(noHarden), 'Phase 4 without a Harden fence').toEqual(['Phase 4 holds 0 Harden fences, expected 1'])
  })

  it.each(BUILDS.filter(b => b.spec === IMPLEMENT))('$label: known-bad probes (/implement): POLISH_OUTPUT on the Requires line of any phase from Phase 4 on is reported', ({ spec, body }) => {
    // Phase 4 is the first reader, Phase 6 is the Validate phase, and Phase 12 is the last phase of the command.
    for (const num of ['4', '6', '12']) {
      expect(collectPolishSkipDefects(withReader(body, num, 'POLISH_OUTPUT'), spec), `Phase ${num}`).toEqual([`Phase ${num} Requires names POLISH_OUTPUT, which a skipped Polish phase sets to SKIPPED`])
    }
    expect(dataFlowNames(phaseSection(body, '3'), 'Produces'), 'Phase 3 produces the output that no later phase reads').toEqual(['POLISH_OUTPUT'])
  })

  it.each(BUILDS.filter(b => b.spec === RESOLVE))('$label: known-bad probes (/resolve): POLISH_RESULT on the Requires line of any phase from Phase 7 on is reported', ({ spec, body }) => {
    for (const num of ['7', '9b', '10']) {
      expect(collectPolishSkipDefects(withReader(body, num, 'POLISH_RESULT'), spec), `Phase ${num}`).toEqual([`Phase ${num} Requires names POLISH_RESULT, which a skipped Polish phase sets to SKIPPED`])
    }
    expect(dataFlowNames(phaseSection(body, '6'), 'Produces'), 'Phase 6 produces the output that no later phase reads').toEqual(['POLISH_RESULT'])
    expect(collectPolishSkipDefects(seed(body, '\n### Phase 7: ', '\n### Step 7: '), spec), 'a command without the Phase 7 heading').toEqual(['no "### Phase 7:" heading'])
  })
})

describe('/self-review, /debug and /dynamic-build keep Polish and read no level (#481 AC-5)', () => {
  it('the commands that keep Polish spawn it 1, 1 and 2 times', () => {
    expect(KEEPERS.map(k => `${k.cmd}: ${k.spawns}`)).toEqual(['self-review: 1', 'debug: 1', 'dynamic-build: 2'])
  })

  it.each(KEEPER_BUILDS)('$label: Polish is spawned as often as today, no level reference is named and no Polish spawn carries a GATE_LEVEL: line', ({ keeper, body }) => {
    expect(collectPolishKeeperDefects(body, keeper)).toEqual([])
  })

  /** A level line put into each Polish spawn of the command: into the prompt of a block, onto the line of a prose spawn, or onto its own line inside a call. */
  const LEVEL_LINE_SEEDS: Readonly<Record<string, { readonly from: string; readonly to: string }>> = {
    'self-review': { from: 'Polish and refine the code for clarity and consistency while preserving functionality.', to: 'GATE_LEVEL: {GATE_LEVEL}\nPolish and refine the code for clarity and consistency while preserving functionality.' },
    'debug': { from: 'Agent(subagent_type="Polish")', to: 'Agent(subagent_type="Polish") with GATE_LEVEL: {GATE_LEVEL}' },
    'dynamic-build': { from: 'Polish and reduce complexity of recent changes on branch ${BRANCH}. Commit any improvements.`', to: 'Polish and reduce complexity of recent changes on branch ${BRANCH}.\nGATE_LEVEL: ${GATE_LEVEL}\nCommit any improvements.`' },
  }

  it.each(KEEPER_BUILDS)('$label: known-bad probes: Polish removed, a spare Polish spawn, a level line in a spawn and a level reference are each reported', ({ keeper, body }) => {
    const defects = (text: string): string[] => collectPolishKeeperDefects(text, keeper)
    const removed = POLISH_MARKERS.reduce((text, marker) => text.split(marker).join(marker.replace('Polish', 'Harden')), body)
    expect(removed, 'the removal landed').not.toBe(body)
    expect(defects(removed), 'Polish removed').toEqual([`${keeper.cmd} spawns Polish 0 times, expected ${keeper.spawns}`])
    expect(defects(`${body}\n${POLISH_SPAWN})\n`), 'a spare Polish spawn').toEqual([`${keeper.cmd} spawns Polish ${keeper.spawns + 1} times, expected ${keeper.spawns}`])
    const { from, to } = LEVEL_LINE_SEEDS[keeper.cmd]
    expect(countOf(body, from), `the level line seed lands in each Polish spawn of ${keeper.cmd}`).toBe(keeper.spawns)
    const leveled = body.split(from).join(to)
    expect(defects(leveled), 'a GATE_LEVEL: line in each Polish spawn').toEqual(Array.from({ length: keeper.spawns }, (_, i) => `${keeper.cmd}: Polish spawn ${i + 1} carries a GATE_LEVEL: line`))
    expect(defects(`${body}\n\nGATE_LEVEL: {GATE_LEVEL}\n`), 'a level line outside every Polish spawn').toEqual([])
    for (const file of ['implement-levels.md', 'resolve-levels.md', 'plan-levels.md', 'code-review-levels.md']) {
      expect(defects(`${body}\nRead the ${file} reference.\n`), file).toEqual([`${keeper.cmd} names a level reference`])
    }
  })
})
