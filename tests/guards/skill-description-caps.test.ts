/**
 * D-SKILL-DESCRIPTION-CAP — a skill's description is catalog text, so it is capped by who reads it.
 *
 * Every installed skill's description rides in the model-visible skill catalog of every session,
 * whether or not the skill is ever loaded. The text is billed on each session's first turn, so a
 * description says when to use the skill and no more. Two audiences set two caps:
 *
 *   - the 26 AGENT-INTERNAL skills are loaded by name — through an agent's frontmatter preload, a
 *     focus table or a command step — so their description only has to name the role: 90 characters;
 *   - the 15 USER-TRIGGER skills are matched against what a person asks for, so they keep the
 *     "This skill should be used when…" form and three or four of their strongest trigger phrases:
 *     200 characters.
 *
 * Lengths are measured on the parsed value. The repo has no YAML dependency, so the reader handles
 * the scalar forms the skills use: a plain single-line scalar, a plain scalar wrapped onto indented
 * lines (it folds with single spaces), a quoted scalar and a `>` / `>-` folded block. Both sets are
 * named exactly, and a new skill directory that is in neither fails the guard until it is classified.
 *
 * `disable-model-invocation` is absent from every skill: it breaks frontmatter preloading.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills')

export const AGENT_INTERNAL_CAP = 90
export const USER_TRIGGER_CAP = 200

/** Skills loaded by name, never matched against a user's request. */
export const AGENT_INTERNAL: readonly string[] = [
  'apply-decisions', 'apply-feature-knowledge', 'architecture', 'complexity', 'compliance',
  'consistency', 'database', 'dependencies', 'design-review', 'docs-framework', 'documentation',
  'feature-knowledge', 'gap-analysis', 'performance', 'qa', 'quality-gates', 'regression',
  'reliability', 'research-codebase', 'research-competitor', 'research-external', 'research-market',
  'research-technology', 'review-methodology', 'security', 'worktree-support',
]

/** Skills a person's request can trigger. */
export const USER_TRIGGER: readonly string[] = [
  'accessibility', 'boundary-validation', 'dependency-research', 'git', 'go', 'java', 'patterns',
  'python', 'react', 'rust', 'software-design', 'test-driven-development', 'testing', 'typescript',
  'ui-design',
]

/**
 * The parsed `description` of a SKILL.md, or null when the frontmatter has none. Handles a plain or
 * quoted scalar (with any indented continuation lines, which fold with single spaces) and a `>` or
 * `>-` folded block.
 */
export function parseDescription(skill: string): string | null {
  const block = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1]
  if (block === undefined) return null
  const lines = block.split('\n')
  const at = lines.findIndex(l => l.startsWith('description:'))
  if (at === -1) return null
  const first = lines[at].slice('description:'.length).trim()
  const continuation: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (!/^[ \t]/.test(line)) break
    continuation.push(line.trim())
  }
  const folded = first === '>' || first === '>-'
  const parts = (folded ? continuation : [first, ...continuation]).filter(p => p !== '')
  let value = parts.join(' ')
  if (!folded && /^(["']).*\1$/.test(value)) value = value.slice(1, -1)
  return value
}

/** Named collector: each skill directory whose description is missing, unclassified or over its cap. */
export function collectDescriptionDefects(skills: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = []
  for (const [name, text] of skills) {
    const internal = AGENT_INTERNAL.includes(name)
    if (!internal && !USER_TRIGGER.includes(name)) {
      out.push(`${name}: in neither the agent-internal nor the user-trigger set — classify it`)
      continue
    }
    const description = parseDescription(text)
    if (description === null || description === '') {
      out.push(`${name}: no description`)
      continue
    }
    const cap = internal ? AGENT_INTERNAL_CAP : USER_TRIGGER_CAP
    if (description.length > cap) out.push(`${name}: ${description.length} characters, cap ${cap}`)
  }
  return out
}

const liveSkills = (): Array<readonly [string, string]> =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => [entry.name, readFileSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf-8')] as const)

const skillWith = (descriptionLines: string): string => `---\nname: x\n${descriptionLines}\nuser-invocable: false\n---\n# X\n`

describe('skill descriptions stay within their audience cap (D-SKILL-DESCRIPTION-CAP)', () => {
  it('names 26 agent-internal and 15 user-trigger skills, with no skill in both', () => {
    expect(AGENT_INTERNAL).toHaveLength(26)
    expect(USER_TRIGGER).toHaveLength(15)
    expect(AGENT_INTERNAL.filter(n => USER_TRIGGER.includes(n))).toEqual([])
  })

  it('every skill directory is classified, and the two sets name no skill that is gone', () => {
    const live = liveSkills().map(([name]) => name).sort()
    expect(live).toEqual([...AGENT_INTERNAL, ...USER_TRIGGER].sort())
  })

  it('every description is within 90 characters (agent-internal) or 200 (user-trigger)', () => {
    expect(collectDescriptionDefects(liveSkills())).toEqual([])
  })

  it('no SKILL.md carries disable-model-invocation, which would break frontmatter preloading', () => {
    const carrying = liveSkills().filter(([, text]) => text.includes('disable-model-invocation')).map(([name]) => name)
    expect(carrying).toEqual([])
  })

  it('the reader parses every scalar form the skills use', () => {
    expect(parseDescription(skillWith('description: A plain value'))).toBe('A plain value')
    expect(parseDescription(skillWith('description: "A quoted value"'))).toBe('A quoted value')
    expect(parseDescription(skillWith('description: A wrapped\n  plain value\n  of three lines'))).toBe('A wrapped plain value of three lines')
    expect(parseDescription(skillWith('description: >-\n  A folded\n  block'))).toBe('A folded block')
    expect(parseDescription(skillWith('name2: y'))).toBeNull()
  })

  it('known-bad probe: a 91-character agent-internal value, a 201-character user-trigger value and an over-cap folded or wrapped value are each reported', () => {
    const internal = AGENT_INTERNAL[0]
    const trigger = USER_TRIGGER[0]
    expect(collectDescriptionDefects([[internal, skillWith(`description: ${'a'.repeat(91)}`)]])).toEqual([`${internal}: 91 characters, cap 90`])
    expect(collectDescriptionDefects([[internal, skillWith(`description: ${'a'.repeat(90)}`)]])).toEqual([])
    expect(collectDescriptionDefects([[trigger, skillWith(`description: ${'a'.repeat(201)}`)]])).toEqual([`${trigger}: 201 characters, cap 200`])
    expect(collectDescriptionDefects([[trigger, skillWith(`description: ${'a'.repeat(200)}`)]])).toEqual([])
    const folded = `description: >-\n  ${'b'.repeat(60)}\n  ${'c'.repeat(60)}`
    expect(collectDescriptionDefects([[internal, skillWith(folded)]])).toEqual([`${internal}: 121 characters, cap 90`])
    const wrapped = `description: ${'d'.repeat(60)}\n  ${'e'.repeat(60)}`
    expect(collectDescriptionDefects([[internal, skillWith(wrapped)]])).toEqual([`${internal}: 121 characters, cap 90`])
  })

  it('known-bad probe: an unclassified skill and a description-less skill are reported', () => {
    expect(collectDescriptionDefects([['brand-new-skill', skillWith('description: fine')]])).toEqual([
      'brand-new-skill: in neither the agent-internal nor the user-trigger set — classify it',
    ])
    expect(collectDescriptionDefects([[AGENT_INTERNAL[0], skillWith('')]])).toEqual([`${AGENT_INTERNAL[0]}: no description`])
  })
})
