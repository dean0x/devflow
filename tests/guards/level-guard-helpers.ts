/**
 * What the three guards of the /implement and /resolve level references share: `implement-resolve-levels.test.ts`,
 * `implement-resolve-level-docs.test.ts` and `implement-resolve-level-keepers.test.ts`. A guard imports a helper from
 * here and never copies it. This file holds no test. Each read of a reference throws when the file is absent, so a
 * guard that imports this file never skips.
 */

import { expect } from 'vitest'

import { escapeRe, readAgentReference } from '../helpers.js'

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
  implement: ['| 3 Polish | skip | skip |'],
  resolve: ['| 6 Polish | skip | skip |'],
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

export const countOf = (text: string, needle: string): number => text.split(needle).length - 1

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

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** Replace `from` with `to` in `body`, failing the test when the seed did not land. */
export function seed(body: string, from: string | RegExp, to: string): string {
  const next = typeof from === 'string' ? body.replace(from, () => to) : body.replace(from, to)
  expect(next, `the seed ${String(from).slice(0, 60)} must change the text`).not.toBe(body)
  return next
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
