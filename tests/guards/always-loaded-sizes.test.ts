/**
 * Size ceiling of the always-loaded catalog text (#706): the `description` of every skill, command and
 * agent that a default install lists. Claude Code puts these rows in the context of every main turn of
 * every session, so each byte is re-read on every turn. A default install has the core plugins,
 * compliance off and no language plugin. The tool lists of the agent rows are tool policy, not text, so
 * the ceiling counts descriptions only. Registered in `tests/fixtures/numeric-floors.json`; lowered,
 * never raised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, resolveAgentSource, resolveVariantOffSource } from '../helpers.js'
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../../src/core/plugins.js'

/** Sum of the description bytes of the default-install catalog rows. */
const CATALOG_DESCRIPTION_MAX_BYTES = 6_187

/**
 * The single-line `description` value of a frontmatter block, unquoted, or null when it has none. A block
 * scalar (`>` or `|`) or a value wrapped onto the next line is null too, so the guard reports it and no
 * row escapes the count.
 */
function description(text: string): string | null {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
  const match = /^description:[ \t]*(.+)\n?(.*)$/m.exec(frontmatter)
  if (match === null) return null
  const [, value, next] = match
  if (/^[>|]/.test(value) || /^[ \t]/.test(next)) return null
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value) as string
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  return value
}

/** [row label, frontmatter text] for each catalog row of a default install. */
function catalogRows(plugins: readonly PluginDefinition[]): Array<readonly [string, string]> {
  const core = plugins.filter(p => p.optional !== true)
  const skills = new Set(core.flatMap(p => [...p.skills, ...p.requires]))
  const commands = new Set(core.flatMap(p => p.commands.map(c => c.replace(/^\//, ''))))
  const agents = new Set(core.flatMap(p => p.agents))
  const rows: Array<readonly [string, string]> = []
  for (const name of [...skills].sort()) {
    if (name === 'compliance') continue
    const text = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', name, 'SKILL.md'), 'utf-8')
    // A skill that disables model invocation is not listed in the catalog.
    if (/^disable-model-invocation:\s*true\s*$/m.test(text)) continue
    rows.push([`skill ${name}`, text])
  }
  for (const name of [...commands].sort()) {
    const text = resolveVariantOffSource('compliance-off', 'commands', name)
      ?? readFileSync(path.join(ROOT, 'dist', 'commands', `${name}.md`), 'utf-8')
    rows.push([`command ${name}`, text])
  }
  for (const name of [...agents].sort()) {
    const text = resolveVariantOffSource('compliance-off', 'agents', name) ?? resolveAgentSource(name).content
    rows.push([`agent ${name}`, text])
  }
  return rows
}

/** Named collector: the rows with no description, then the total when it is over the ceiling. */
function collectCatalogDefects(rows: ReadonlyArray<readonly [string, string]>, ceiling: number): string[] {
  const defects: string[] = []
  let total = 0
  for (const [label, text] of rows) {
    const value = description(text)
    if (value === null) defects.push(`${label} has no single-line description`)
    else total += Buffer.byteLength(value)
  }
  if (total > ceiling) defects.push(`catalog descriptions are ${total} bytes, ceiling ${ceiling}`)
  return defects
}

describe('the always-loaded catalog text sits under its ceiling (#706)', () => {
  it('the default-install skill, command and agent descriptions fit the ceiling', () => {
    const rows = catalogRows(DEVFLOW_PLUGINS)
    expect(rows.length, 'the rows are read: the guard would pass vacuously on an empty catalog').toBeGreaterThan(50)
    expect(collectCatalogDefects(rows, CATALOG_DESCRIPTION_MAX_BYTES)).toEqual([])
  })

  it('probes: one byte over the ceiling and a row with no description are each reported', () => {
    const rows = catalogRows(DEVFLOW_PLUGINS)
    const total = rows.reduce((sum, [, text]) => sum + Buffer.byteLength(description(text) ?? ''), 0)
    expect(collectCatalogDefects(rows, total)).toEqual([])
    expect(collectCatalogDefects(rows, total - 1)).toEqual([`catalog descriptions are ${total} bytes, ceiling ${total - 1}`])
    const [label] = rows[0]
    const bare: ReadonlyArray<readonly [string, string]> = [[label, '---\nname: x\n---\nbody'], ...rows.slice(1)]
    expect(collectCatalogDefects(bare, Number.MAX_SAFE_INTEGER)).toEqual([`${label} has no single-line description`])
    for (const form of ['description: >-\n  folded\n  text', 'description: |\n  literal', 'description: wrapped\n  onto two lines']) {
      const block: ReadonlyArray<readonly [string, string]> = [[label, `---\nname: x\n${form}\n---\nbody`], ...rows.slice(1)]
      expect(collectCatalogDefects(block, Number.MAX_SAFE_INTEGER), form).toEqual([`${label} has no single-line description`])
    }
  })
})
