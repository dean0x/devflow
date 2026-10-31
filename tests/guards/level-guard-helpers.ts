/**
 * What the three guards of the /implement and /resolve level references share: `implement-resolve-levels.test.ts`,
 * `implement-resolve-level-docs.test.ts` and `implement-resolve-level-keepers.test.ts`. A guard imports a helper from
 * here and never copies it. This file holds no test. Each read of a reference throws when the file is absent, so a
 * guard that imports this file never skips.
 */

import { expect } from 'vitest'

import { countOf, escapeRe, readAgentReference, sectionBetween } from '../helpers.js'

/** The one `countOf` lives in `../helpers.js`; the guards that import it from here keep working. */
export { countOf }

// ---------------------------------------------------------------------------
// The decided text, written by hand from the issue and the gate decisions
// ---------------------------------------------------------------------------

export const OPEN = '**Gate level.**'
export const TABLE_SEPARATOR = '|-------|----------|------|'
export const RULES_INTRO = 'An `apply:` cell names one bullet of this section. At least one row names each bullet.'

/** The commands that have a level reference, in the order that the guards list them. */
export type LevelCmd = 'implement' | 'resolve'
export const LEVEL_CMDS: readonly LevelCmd[] = ['implement', 'resolve']

/** The rows that the reference of each command holds, as the lines of the file. A row joins the list in the change that decides it. */
export const DECIDED_ROWS: Readonly<Record<LevelCmd, readonly string[]>> = {
  implement: ['| 4 Self-Review | - | apply: harden-scope |'],
  resolve: ['| 2 Global Triage | pass level | pass level |', '| 6 Polish | skip | skip |'],
}

/** How a command writes a Polish spawn: the `subagent_type` argument of a prose or block call, or the `agentType` option of a dynamic-build call. */
export const POLISH_MARKERS = ['subagent_type="Polish"', 'agentType: "Polish"'] as const
export const POLISH_SPAWN = `Agent(${POLISH_MARKERS[0]}`

// ---------------------------------------------------------------------------
// Corpus and readers
// ---------------------------------------------------------------------------

export const REFS: Readonly<Record<string, string>> = {
  implement: readAgentReference('commands/implement-levels.md'),
  resolve: readAgentReference('commands/resolve-levels.md'),
}

/**
 * The section that the line opening with `opening` starts: that line and the lines after it, up to the next line that
 * starts with `next`, or to the end of the text when no such line follows. Null when no line opens with `opening`. The one
 * heading-section slicer of the level guards, built on `sectionBetween`: the section starts at the heading itself.
 */
export function headingSection(text: string, opening: string, next: string): string | null {
  const at = text.indexOf(`\n${opening}`)
  if (at === -1) return null
  const rest = text.slice(at + 1)
  return sectionBetween(rest, opening, `\n${next}`) ?? rest
}

export interface RefSection { readonly heading: string; readonly lines: readonly string[] }
export interface ParsedRef { readonly title: string; readonly preamble: readonly string[]; readonly sections: readonly RefSection[] }

/** A reference as its title line, the text before its first heading and its `## ` sections, blank lines dropped. */
export function parseRef(ref: string): ParsedRef {
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

export const sectionOf = (parsed: ParsedRef, heading: string): RefSection | undefined => parsed.sections.find(s => s.heading === heading)

/** The table lines of the `## Phases` section: the header, the separator, then the rows. */
export const tableLines = (parsed: ParsedRef): string[] => (sectionOf(parsed, '## Phases')?.lines ?? []).filter(line => line.startsWith('|'))

/** The row lines of the table, header and separator dropped. */
export const tableRowLines = (parsed: ParsedRef): string[] => tableLines(parsed).slice(2)

/**
 * The trimmed cells of one table line, or null when the line is not pipe-bounded. The one cell parser of the level guards.
 * For a row of a level reference the cells are the phase, the standard cell and the lean cell, in that order.
 */
export function rowCells(line: string): string[] | null {
  return line.startsWith('|') && line.endsWith('|') ? line.split('|').slice(1, -1).map(cell => cell.trim()) : null
}

/** The rows of a reference, header and separator dropped. */
export function referenceRows(ref: string): string[] {
  return tableRowLines(parseRef(ref))
}

/** The level columns of a row, as the cell index that each one reads: a row is its phase cell, then the standard cell, then the lean cell. The one statement of the column layout. */
export const LEVEL_CELL_INDEX = { standard: 1, lean: 2 } as const
export type LevelColumn = keyof typeof LEVEL_CELL_INDEX
/** The level columns, in cell order. */
export const LEVELS = Object.keys(LEVEL_CELL_INDEX) as readonly LevelColumn[]

// ---------------------------------------------------------------------------
// The /implement Phase 5 re-check loop at `full`
// ---------------------------------------------------------------------------

/**
 * The lines of the `full` Phase 5 re-check loop of /implement, each trimmed and each held once by the Phase 5 section. The
 * full-fences guard pins them in the compiled command, and the levels guard ties the step numbers of the one-pass
 * paragraph of Phase 5 to the two numbered steps here: the test of the attempt cap (index 1) and the report to the user (index 3).
 */
export const FULL_LOOP_LINES: readonly string[] = [
  '2. Increment `alignment_fix_count`',
  '3. If `alignment_fix_count <= 2`:',
  '- Loop back to Phase 5 (re-check alignment). The fix is not validated here: the Phase 6 run covers it.',
  '4. If `alignment_fix_count > 2`: Report misalignments to user for decision',
]

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** Replace `from` with `to` in `body`, failing the test when the seed did not land. */
export function seed(body: string, from: string | RegExp, to: string): string {
  const next = typeof from === 'string' ? body.replace(from, () => to) : body.replace(from, to)
  expect(next, `the seed ${String(from).slice(0, 60)} must change the text`).not.toBe(body)
  return next
}

/** `seed`, once the text holds exactly one `from`: `seed` changes the first copy only, so a probe on a repeated text may change another place than the one it means to. A probe on a shipped reference uses this one. */
export function seedOnce(body: string, from: string, to: string): string {
  expect(countOf(body, from), `"${from.slice(0, 60)}" must occur once`).toBe(1)
  return seed(body, from, to)
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
export function withRows(ref: string, rows: readonly string[], bullets: readonly string[] = []): string {
  expect(ref, 'the reference holds the table separator').toContain(TABLE_SEPARATOR)
  expect(ref, 'the reference holds the Rules intro').toContain(RULES_INTRO)
  return ref
    .replace(TABLE_ROWS, () => `${TABLE_SEPARATOR}\n${rows.map(row => `${row}\n`).join('')}`)
    .replace(RULES_BULLETS, () => (bullets.length === 0 ? RULES_INTRO : `${RULES_INTRO}\n\n${bullets.join('\n')}`))
}
