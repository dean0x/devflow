/**
 * D-KNOWLEDGE-PRELOAD-ONCE — a command never tells the Knowledge agent to load
 * the skill it already has.
 *
 * The Knowledge agent lists `devflow:feature-knowledge` in its `skills:`
 * frontmatter, so the full skill body is injected into every spawn, and it has no
 * Skill tool to load anything with. A spawn prompt that says "load the
 * feature-knowledge skill" therefore asks for a second copy it cannot fetch and
 * does not need; at best it is a dead instruction, at worst the agent reads the
 * skill body from disk and carries it twice.
 *
 * Two halves of one fact, each by a named collector with a known-bad probe over
 * the wording it replaced: the agent really does preload the skill and hold no
 * Skill tool (so the instruction is redundant), and no compiled command still
 * gives it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { requireDistFile, requireDistFiles } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const KNOWLEDGE_AGENT = path.join(ROOT, 'src', 'assets', 'agents', 'knowledge.md')

/** The load instructions a spawn prompt must not give, as they were worded. */
const REDUNDANT_LOADS: ReadonlyArray<readonly [string, string]> = [
  ['the write-back partial', 'Load the devflow:feature-knowledge skill'],
  ['the research spawn', 'instructing it to load `devflow:feature-knowledge`'],
]

/** Named collector: the frontmatter lines (`skills:` and `tools:` list items) of an agent source. */
function frontmatterList(agentText: string, key: 'skills' | 'tools'): string[] {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(agentText)?.[1] ?? ''
  const items: string[] = []
  let inList = false
  for (const line of frontmatter.split('\n')) {
    if (line === `${key}:`) { inList = true; continue }
    if (inList && line.startsWith('  - ')) { items.push(line.slice(4).trim()); continue }
    inList = false
  }
  return items
}

/** Named collector: every redundant load instruction a command body still gives. */
export function collectRedundantKnowledgeLoads(commandText: string): string[] {
  return REDUNDANT_LOADS.filter(([, wording]) => commandText.includes(wording)).map(([where]) => where)
}

describe('the Knowledge agent preloads feature-knowledge (D-KNOWLEDGE-PRELOAD-ONCE)', () => {
  it('the agent lists the skill in its frontmatter and holds no Skill tool', () => {
    const agent = readFileSync(KNOWLEDGE_AGENT, 'utf-8')
    expect(frontmatterList(agent, 'skills'), 'the skill must be preloaded for the load instruction to be redundant')
      .toContain('devflow:feature-knowledge')
    const tools = frontmatterList(agent, 'tools')
    expect(tools.length, 'the tools list was not read — the next assertion would pass vacuously').toBeGreaterThan(0)
    expect(tools, 'with a Skill tool the agent could load it; without one the instruction is dead').not.toContain('Skill')
  })

  it('no compiled command tells the Knowledge agent to load the skill', () => {
    const files = requireDistFiles()
    expect(files.length, 'no compiled command was read').toBeGreaterThan(0)
    const violations = files.flatMap(file =>
      collectRedundantKnowledgeLoads(requireDistFile(file)).map(where => `${file}: ${where}`))
    expect(violations, `Redundant feature-knowledge loads:\n  ${violations.join('\n  ')}`).toEqual([])
  })

  it('known-bad probe: each redundant wording is reported by the same collector', () => {
    for (const [where, wording] of REDUNDANT_LOADS) {
      expect(collectRedundantKnowledgeLoads(`before\n${wording} and follow its authoring process.\nafter`)).toEqual([where])
    }
    expect(collectRedundantKnowledgeLoads('Follow devflow:apply-feature-knowledge for FEATURE_KNOWLEDGE.')).toEqual([])
  })
})
