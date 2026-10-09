/**
 * Report-cap guard (D-REPORT-CAP).
 *
 * An agent's final message is read by the orchestrator that spawned it, and every
 * token of it stays in that orchestrator's context for the rest of the run. Each
 * roster agent's Output section therefore ends with a `Report cap:` line: the final
 * message is at most about 1,500 tokens, longer material goes to a file whose path
 * the message gives, and the line names the agent's EXEMPT fields.
 *
 * An exempt field is one a command or test parses, or an orchestrator passes to
 * another agent. Moving it to a file would break its reader, so it stays inline in
 * full and is never truncated. The exempt sets were taken from the commands that
 * spawn each agent, not from the agent's own template; the table in this file is
 * the record of what each line must name.
 *
 * The roster is DERIVED from DEVFLOW_PLUGINS, never listed here, so a new agent
 * without a cap line fails the guard instead of slipping past a stale list.
 * Three agents are excluded, each by name and for a stated reason:
 *
 *   - `learning` and `tracker` are spawned by the session-start hook and are never
 *     roster members of a command or workflow;
 *   - `git` is deferred: its source has no `## Output` heading (its output is per
 *     operation), it sits 98 characters under its byte-equality baseline, and its
 *     fixture is frozen for every ticket except the Git agent split. That ticket
 *     removes this exclusion.
 *
 * Sections are read fence-aware: the Design, Review and Diagnose templates carry
 * `## ` lines inside fenced blocks, and those are template payload, not section
 * boundaries. A section ends at the next UNFENCED `## ` heading.
 *
 * Every arm runs through a named collector, and the known-bad probes feed the same
 * collectors synthetic agents, so a collector that stopped seeing defects fails its
 * own probe instead of passing the guard vacuously.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, collectUnfencedH2, resolveAgentSource } from '../helpers.js'
import { DEVFLOW_PLUGINS } from '../../src/core/plugins.js'

/** Agents outside the roster, with the reason each is out. */
const EXCLUDED: Readonly<Record<string, string>> = {
  learning: 'hook-spawned by the session-start learning directive, never a roster member',
  tracker: 'hook-spawned by the session-start tracker-setup directive, never a roster member',
  git: 'deferred to the Git agent split: no `## Output` heading, 98 characters under its byte-equality baseline, frozen fixture',
}

/** The Output heading each agent uses when it is not `## Output`. */
const OUTPUT_HEADING: Readonly<Record<string, string>> = { research: '## Output Format' }

/**
 * What each agent's cap line must name. Substrings of the line, taken from the
 * fields the spawning commands parse or hand on (see the header).
 */
const EXEMPT_MARKERS: Readonly<Record<string, readonly string[]>> = {
  code: ['`## Verification` block', '`commitShas`', '`unresolved`'],
  validate: ['`HEAD:` line', '| Command | Status | Exit | Duration |', '30 lines per failing command'],
  test: ['### Test Plan Evidence', '| ID | TP | Type |', '### Evidence Log'],
  scrutinize: ['`### Status` line', '`status` return field'],
  simplify: ['completion status', 'commits'],
  evaluate: ['`### Status` line', '`### Misalignments Found`'],
  design: ['`## Findings` list'],
  skim: ['`### Relevant Files for Task`'],
  knowledge: ['`KB_*` status block'],
  review: ['report path', '`filesExamined`', '`findings`'],
  diagnose: ['Exempt: none'],
  research: ['Exempt: none'],
  triage: ['whole ledger'],
  synthesize: ['exploration, planning and design'],
}

/** What every cap line states, whatever the agent. */
const COMMON_CLAUSES: readonly string[] = [
  'about 1,500 tokens',
  '`mktemp`',
  'gives its path',
  'Exempt',
]

/** The roster: every plugin-declared agent that is not excluded, each once. */
function rosterOf(plugins: ReadonlyArray<{ agents: readonly string[] }>): string[] {
  const names = new Set<string>()
  for (const plugin of plugins) for (const agent of plugin.agents) names.add(agent)
  return [...names].filter(name => !(name in EXCLUDED))
}

/**
 * An agent's output section: from its heading to the next UNFENCED `## ` heading
 * (or the end), or null when the heading is absent.
 */
function outputSection(content: string, heading: string): string | null {
  const headings = collectUnfencedH2(content)
  const at = headings.findIndex(h => h.text === heading)
  if (at === -1) return null
  const end = at + 1 < headings.length ? headings[at + 1].index : content.length
  return content.slice(headings[at].index, end)
}

/** Named collector: how an agent's output section fails to end in a conforming cap line. */
function collectCapDefects(name: string, content: string): string[] {
  const heading = OUTPUT_HEADING[name] ?? '## Output'
  const section = outputSection(content, heading)
  if (section === null) return [`${name}: no "${heading}" section`]
  const lines = section.split('\n').filter(l => l.trim() !== '')
  const last = lines[lines.length - 1] ?? ''
  if (!last.startsWith('Report cap:')) return [`${name}: the "${heading}" section does not end with a "Report cap:" line`]
  const defects: string[] = []
  for (const clause of COMMON_CLAUSES) {
    if (!last.includes(clause)) defects.push(`${name}: the cap line lacks "${clause}"`)
  }
  for (const marker of EXEMPT_MARKERS[name] ?? []) {
    if (!last.includes(marker)) defects.push(`${name}: the cap line does not name its exempt field "${marker}"`)
  }
  return defects
}

const roster = rosterOf(DEVFLOW_PLUGINS)

describe('D-REPORT-CAP: the report cap on the roster', () => {
  it('derives a roster of at least 14 agents from DEVFLOW_PLUGINS', () => {
    expect(roster.length).toBeGreaterThanOrEqual(14)
    expect(Object.keys(EXEMPT_MARKERS).sort(), 'every roster agent has an exempt-field record').toEqual([...roster].sort())
  })

  it('excludes learning, tracker and git by name, each with a reason', () => {
    expect(Object.keys(EXCLUDED).sort()).toEqual(['git', 'learning', 'tracker'])
    for (const [name, reason] of Object.entries(EXCLUDED)) {
      expect(reason.length, `${name} needs a stated reason`).toBeGreaterThan(20)
      expect(roster, `${name} is out of the roster`).not.toContain(name)
    }
  })

  it('every roster agent\'s output section ends with a conforming Report cap line', () => {
    for (const name of roster) expect(collectCapDefects(name, resolveAgentSource(name).content)).toEqual([])
  })

  it('synthesize.md has an Output heading before Principles, and its per-mode templates stay where they are', () => {
    const headings = collectUnfencedH2(resolveAgentSource('synthesize').content).map(h => h.text)
    expect(headings.indexOf('## Output')).toBeGreaterThan(-1)
    expect(headings.indexOf('## Output')).toBe(headings.indexOf('## Principles') - 1)
    expect(headings.indexOf('## Mode: Exploration')).toBeLessThan(headings.indexOf('## Output'))
  })

  it('the Output template in agent-design.md carries the same line', () => {
    const doc = readFileSync(path.join(ROOT, 'docs', 'reference', 'agent-design.md'), 'utf-8')
    const template = doc.slice(doc.indexOf('## Output\n[Simple structured report format]'))
    expect(template.split('\n')[2], 'the line follows the output placeholder').toMatch(/^Report cap: /)
  })

  it('known-bad probe: an agent without the line is reported', () => {
    const real = resolveAgentSource('validate').content
    const capLine = real.split('\n').find(l => l.startsWith('Report cap:'))
    expect(capLine, 'the seed must land').toBeDefined()
    const without = real.replace(`${capLine}\n`, '')
    expect(collectCapDefects('validate', without)).toEqual([
      'validate: the "## Output" section does not end with a "Report cap:" line',
    ])
  })

  it('known-bad probe: a cap line that drops its exempt fields or its path clause is reported', () => {
    const real = resolveAgentSource('test').content
    const dropped = real.replace('`### Test Plan Evidence`', '`### Plan`')
    expect(dropped, 'the seed must land').not.toBe(real)
    expect(collectCapDefects('test', dropped)).toContain(
      'test: the cap line does not name its exempt field "### Test Plan Evidence"',
    )
    const pathless = real.replace('gives its path', 'says nothing')
    expect(collectCapDefects('test', pathless)).toContain('test: the cap line lacks "gives its path"')
  })

  it('known-bad probe: a ## line inside a fenced template is not a section boundary', () => {
    const cap = 'Report cap: about 1,500 tokens; `mktemp`; the message gives its path. Exempt: none.'
    const fenced = `## Output\n\n\`\`\`markdown\n## Findings\n\`\`\`\n\n${cap}\n\n## Principles\n`
    expect(collectCapDefects('diagnose', fenced)).toEqual([])
    const naive = `## Output\n\n\`\`\`markdown\n## Findings\n${cap}\n\`\`\`\n\n## Principles\n`
    expect(collectCapDefects('diagnose', naive), 'a cap line inside the fence is not the last line').toEqual([
      'diagnose: the "## Output" section does not end with a "Report cap:" line',
    ])
  })

  it('known-bad probe: a roster that gains an agent without a record is caught by the derivation', () => {
    const grown = rosterOf([...DEVFLOW_PLUGINS, { agents: ['newcomer'] }])
    expect(grown).toContain('newcomer')
    expect(Object.keys(EXEMPT_MARKERS)).not.toContain('newcomer')
  })
})
