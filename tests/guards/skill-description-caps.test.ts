/**
 * D-SKILL-DESCRIPTION-CAP — a skill's description is catalog text, so it is capped by who reads it.
 *
 * Every installed skill's description rides in the model-visible skill catalog of every session,
 * whether or not the skill is ever loaded. The text is billed on each session's first turn, so a
 * description says when to use the skill and no more. Two audiences set two caps:
 *
 *   - the 27 AGENT-INTERNAL skills are loaded by name — through an agent's frontmatter preload, a
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
 * `disable-model-invocation` is absent from every skill but one: it breaks frontmatter preloading, so only
 * a skill nothing preloads may carry it. D-AGENT-REFS names that skill, `agent-references`, which holds the
 * text an agent mode reads by explicit path; a second guard below holds that no agent `skills:` list and no
 * plugin `requires:` entry names it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import * as path from 'path'
import { parseFrontmatterSkills, resolveAgentSource, resolveCurationOffSource } from '../helpers.js'
import { DEVFLOW_PLUGINS, getAllAgentNames, type PluginDefinition } from '../../src/core/plugins.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills')

export const AGENT_INTERNAL_CAP = 90
export const USER_TRIGGER_CAP = 200

/** Skills loaded by name, never matched against a user's request. */
export const AGENT_INTERNAL: readonly string[] = [
  'agent-references', 'apply-decisions', 'apply-feature-knowledge', 'architecture', 'complexity', 'compliance',
  'consistency', 'database', 'dependencies', 'design-review', 'docs-framework', 'documentation',
  'feature-knowledge', 'gap-analysis', 'performance', 'qa', 'quality-gates', 'regression',
  'reliability', 'research-codebase', 'research-competitor', 'research-external', 'research-market',
  'research-technology', 'review-methodology', 'security', 'worktree-support',
]

/**
 * D-AGENT-REFS: the one skill that may carry `disable-model-invocation: true`. It is reference-only, so no
 * agent preloads it and no plugin requires it; the model never needs to invoke it either, because an agent
 * names the path of the file it wants. The exception names this skill and no other.
 */
export const REFERENCE_ONLY: readonly string[] = ['agent-references']

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

/** The frontmatter block of a SKILL.md, or '' when it has none. */
const frontmatterOf = (skill: string): string => /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? ''

/**
 * Named collector: each skill that carries `disable-model-invocation` without being reference-only, and each
 * reference-only skill that lacks either flag. A non-exempt skill is held to the whole text, so a mention in
 * its body is reported too; an exempt skill is held to its frontmatter, where the flags take effect.
 */
export function collectInvocationFlagDefects(skills: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = []
  for (const [name, text] of skills) {
    if (!REFERENCE_ONLY.includes(name)) {
      if (text.includes('disable-model-invocation')) out.push(`${name}: carries disable-model-invocation, which would break frontmatter preloading`)
      continue
    }
    const block = frontmatterOf(text)
    if (!/^disable-model-invocation: true$/m.test(block)) out.push(`${name}: reference-only, so its frontmatter needs disable-model-invocation: true`)
    if (!/^user-invocable: false$/m.test(block)) out.push(`${name}: reference-only, so its frontmatter needs user-invocable: false`)
  }
  return out
}

/**
 * Named collector: where a reference-only skill is preloaded or installed as a dependency. An agent's
 * `skills:` list preloads; a plugin's `requires:` list installs a skill for the plugin's corpus, and the
 * skill is owned by `devflow-core-skills` alone, which is always installed.
 */
export function collectPreloadDefects(
  agents: ReadonlyArray<readonly [string, string]>,
  plugins: readonly Pick<PluginDefinition, 'name' | 'skills' | 'requires'>[],
): string[] {
  const out: string[] = []
  for (const skill of REFERENCE_ONLY) {
    for (const [agent, text] of agents) {
      if (parseFrontmatterSkills(text).includes(skill)) out.push(`${agent}: preloads ${skill}`)
    }
    for (const plugin of plugins) {
      if (plugin.requires.includes(skill)) out.push(`${plugin.name}: requires ${skill}`)
      if (plugin.name !== 'devflow-core-skills' && plugin.skills.includes(skill)) out.push(`${plugin.name}: owns ${skill}, which devflow-core-skills owns`)
    }
    if (!plugins.some(plugin => plugin.name === 'devflow-core-skills' && plugin.skills.includes(skill))) {
      out.push(`devflow-core-skills: does not own ${skill}, so it would not install`)
    }
  }
  return out
}

/** Every agent the registry declares, as installed: the compiled or source body, and each curation-off variant. */
const liveAgents = (): Array<readonly [string, string]> =>
  getAllAgentNames().flatMap(name => {
    const off = resolveCurationOffSource('agents', name)
    const rows: Array<readonly [string, string]> = [[name, resolveAgentSource(name).content]]
    if (off !== null) rows.push([`${name} (learning off)`, off])
    return rows
  })

const liveSkills = (): Array<readonly [string, string]> =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => [entry.name, readFileSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf-8')] as const)

const skillWith = (descriptionLines: string): string => `---\nname: x\n${descriptionLines}\nuser-invocable: false\n---\n# X\n`

describe('skill descriptions stay within their audience cap (D-SKILL-DESCRIPTION-CAP)', () => {
  it('names 27 agent-internal and 15 user-trigger skills, with no skill in both', () => {
    expect(AGENT_INTERNAL).toHaveLength(27)
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

  it('only the reference-only skill carries disable-model-invocation, and it carries both flags (AC-404)', () => {
    expect(REFERENCE_ONLY, 'the exception names exactly one skill').toEqual(['agent-references'])
    expect(AGENT_INTERNAL, 'the exempt skill is classified').toContain('agent-references')
    expect(collectInvocationFlagDefects(liveSkills())).toEqual([])
    const carrying = liveSkills().filter(([, text]) => text.includes('disable-model-invocation')).map(([name]) => name)
    expect(carrying, 'the flag is carried, so the guard is not reading an empty set').toEqual(['agent-references'])
  })

  it('known-bad probe: a second skill with the flag, and a reference-only skill missing a flag, are each reported', () => {
    const flagged = (name: string, flags: string): [string, string] => [name, `---\nname: ${name}\ndescription: d\n${flags}\n---\n# X\n`]
    expect(collectInvocationFlagDefects([flagged('agent-references', 'user-invocable: false\ndisable-model-invocation: true')])).toEqual([])
    expect(collectInvocationFlagDefects([flagged('security', 'user-invocable: false\ndisable-model-invocation: true')])).toEqual([
      'security: carries disable-model-invocation, which would break frontmatter preloading',
    ])
    expect(collectInvocationFlagDefects([flagged('agent-references', 'user-invocable: false')])).toEqual([
      'agent-references: reference-only, so its frontmatter needs disable-model-invocation: true',
    ])
    expect(collectInvocationFlagDefects([flagged('agent-references', 'disable-model-invocation: true')])).toEqual([
      'agent-references: reference-only, so its frontmatter needs user-invocable: false',
    ])
  })

  it('no agent preloads the reference-only skill and no plugin requires it; devflow-core-skills alone owns it (AC-404)', () => {
    const agents = liveAgents()
    expect(agents.length, 'every declared agent is read').toBeGreaterThanOrEqual(getAllAgentNames().length)
    expect(agents.some(([, text]) => parseFrontmatterSkills(text).length > 0), 'the preload reader sees a real list').toBe(true)
    expect(DEVFLOW_PLUGINS.some(plugin => plugin.requires.length > 0), 'the requires reader sees a real list').toBe(true)
    expect(collectPreloadDefects(agents, DEVFLOW_PLUGINS)).toEqual([])
  })

  it('known-bad probe: a preloading agent, a requiring plugin, a second owner and a missing owner are each reported', () => {
    const agentWith = (skills: string): [string, string] => ['synthetic', `---\nname: Synthetic\nskills:\n${skills}\n---\n# Body\n`]
    const core = { name: 'devflow-core-skills', skills: ['agent-references'], requires: [] as string[] }
    expect(collectPreloadDefects([agentWith('  - devflow:testing')], [core])).toEqual([])
    expect(collectPreloadDefects([agentWith('  - devflow:testing\n  - devflow:agent-references')], [core])).toEqual(['synthetic: preloads agent-references'])
    expect(collectPreloadDefects([], [core, { name: 'devflow-plan', skills: [], requires: ['agent-references'] }])).toEqual(['devflow-plan: requires agent-references'])
    expect(collectPreloadDefects([], [core, { name: 'devflow-plan', skills: ['agent-references'], requires: [] }])).toEqual([
      'devflow-plan: owns agent-references, which devflow-core-skills owns',
    ])
    expect(collectPreloadDefects([], [{ ...core, skills: [] }])).toEqual(['devflow-core-skills: does not own agent-references, so it would not install'])
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
