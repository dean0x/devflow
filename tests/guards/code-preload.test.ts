/**
 * D-CODE-PRELOADS and D-CODE-PRELOAD-CAP — each Code variant preloads only the skills its modes use.
 *
 * Every Code-family spawn pays for its frontmatter `skills:` list: the SKILL.md of each one enters the
 * first turn and is re-read on every turn after it. The Code agent is about half of all spend, so the
 * list is the cheapest place to save. One agent preloaded six skills for all seven modes; three variants
 * (D-CODE-VARIANTS) now preload what their own modes use:
 *
 *   Code      git, testing, test-driven-development, worktree-support, apply-feature-knowledge,
 *             apply-decisions. implement and issue-fix write tests first, and only their spawns pass
 *             `FEATURE_KNOWLEDGE`.
 *   Fix  git, testing, worktree-support, apply-decisions. A gate-failure fix compiles and runs the
 *             named tests; it is not a test-first build, and no fix spawn passes `FEATURE_KNOWLEDGE`.
 *   Refactor git, worktree-support, apply-decisions. A mechanical edit adds no behaviour and no tests.
 *
 * D-NO-RUNTIME-SKILLS: none loads a skill by language or by mode at run time, so the four mode skills the
 * old Step 0 table named and the eight language skills the `DOMAIN` input named are neither preloaded
 * nor named in a variant. The Skill tool stays, so a model can still pick a skill by its description.
 *
 * The SKILL.md files of each variant total at most its ceiling, which the numeric-floor manifest
 * registers (`code-preload-max-bytes`, `fix-preload-max-bytes`, `refactor-preload-max-bytes`), and
 * three of them carry their own cap (D-CODE-PRELOAD-CAP). A ceiling is lowered by a pass that cut the
 * artifact and never raised to fit one that grew; `git`, `testing` and `test-driven-development` are
 * fixed terms here, so a later change that grows any of them pays for itself inside the set.
 *
 * `tests/guards/agent-config.test.ts` does not pin the variants' `skills:` key: this file is the single
 * authority for it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { CODE_AGENT_TYPES, codeSlugOf, parseFrontmatterSkills, resolveAgentSource, resolveCurationOffSource } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills')

/** The skills each variant preloads, in the order its frontmatter lists them (apply-decisions, last, is the curation arm). */
export const CODE_PRELOADS: Readonly<Record<string, readonly string[]>> = {
  'Code': ['git', 'testing', 'test-driven-development', 'worktree-support', 'apply-feature-knowledge', 'apply-decisions'],
  'Fix': ['git', 'testing', 'worktree-support', 'apply-decisions'],
  'Refactor': ['git', 'worktree-support', 'apply-decisions'],
}

/**
 * The skills the pre-split Code loaded at run time: four by mode (the Step 0 table) and eight by language
 * (the `DOMAIN` input). No variant preloads or names any of them (D-NO-RUNTIME-SKILLS).
 */
export const RETIRED_RUNTIME_SKILLS: readonly string[] = [
  'software-design', 'patterns', 'boundary-validation', 'dependency-research',
  'typescript', 'react', 'go', 'java', 'python', 'rust', 'accessibility', 'ui-design',
]

/** The SKILL.md files of Code's preload together, in bytes. Registered as `code-preload-max-bytes` in tests/fixtures/numeric-floors.json; lowered, never raised. */
const CODE_PRELOAD_MAX_BYTES = 20_159

/** The SKILL.md files of Fix's preload together, in bytes. Registered as `fix-preload-max-bytes`; lowered, never raised. */
const FIX_PRELOAD_MAX_BYTES = 13_848

/** The SKILL.md files of Refactor's preload together, in bytes. Registered as `refactor-preload-max-bytes`; lowered, never raised. */
const REFACTOR_PRELOAD_MAX_BYTES = 9_493

const PRELOAD_MAX_BYTES: Readonly<Record<string, number>> = {
  'Code': CODE_PRELOAD_MAX_BYTES,
  'Fix': FIX_PRELOAD_MAX_BYTES,
  'Refactor': REFACTOR_PRELOAD_MAX_BYTES,
}

/**
 * Per-file caps for the three skills a pass reshaped. `apply-decisions` stays under the
 * 3,072-byte threshold at which conditional preload stripping would apply.
 */
const FILE_CAPS: Readonly<Record<string, number>> = {
  'worktree-support': 1_900,
  'apply-feature-knowledge': 2_200,
  'apply-decisions': 3_071,
}

const skillBytes = (name: string): number => Buffer.byteLength(readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8'))
const totalBytes = (skills: readonly string[]): number => skills.reduce((sum, name) => sum + skillBytes(name), 0)

/** Named collector: how a variant's preload list differs from the set it owns. */
export function collectPreloadSetDefects(agentType: string, skills: readonly string[]): string[] {
  const expected = CODE_PRELOADS[agentType]
  const out: string[] = []
  for (const name of expected) if (!skills.includes(name)) out.push(`missing ${name}`)
  for (const name of skills) {
    if (expected.includes(name)) continue
    out.push(RETIRED_RUNTIME_SKILLS.includes(name) ? `runtime skill ${name} is preloaded` : `unexpected ${name}`)
  }
  if (new Set(skills).size !== skills.length) out.push('a skill is listed twice')
  return out
}

/** Named collector: the byte totals that are over a cap. */
export function collectPreloadSizeDefects(agentType: string, bytes: Readonly<Record<string, number>>, totalCap: number): string[] {
  const out: string[] = []
  for (const [name, cap] of Object.entries(FILE_CAPS)) {
    if (name in bytes && bytes[name] > cap) out.push(`${name} is ${bytes[name]} bytes, cap ${cap}`)
  }
  const total = CODE_PRELOADS[agentType].reduce((sum, name) => sum + (bytes[name] ?? 0), 0)
  if (total > totalCap) out.push(`the preload is ${total} bytes, ceiling ${totalCap}`)
  return out
}

/** The skills a variant preloads under curation off: its set minus `apply-decisions`. */
const offPreload = (agentType: string): readonly string[] => CODE_PRELOADS[agentType].filter(name => name !== 'apply-decisions')

/** Named collector: how a curation-off preload list differs from the variant's set minus apply-decisions. */
export function collectOffPreloadDefects(agentType: string, skills: readonly string[]): string[] {
  const expected = offPreload(agentType)
  const out: string[] = []
  if (skills.includes('apply-decisions')) out.push('apply-decisions is preloaded under curation off')
  for (const name of expected) if (!skills.includes(name)) out.push(`missing ${name}`)
  for (const name of skills) if (name !== 'apply-decisions' && !expected.includes(name)) out.push(`unexpected ${name}`)
  return out
}

const on = (agentType: string): string => resolveAgentSource(codeSlugOf(agentType)).content
const off = (agentType: string): string => resolveCurationOffSource('agents', codeSlugOf(agentType)) as string
const frontmatterOf = (text: string): string => text.slice(0, text.indexOf('\n---\n', 4))
const bodyOf = (text: string): string => text.slice(text.indexOf('\n---\n', 4) + 5)

describe('each Code variant preloads only the skills its modes use (D-CODE-PRELOADS)', () => {
  it('the frontmatter skills: list of each variant is exactly its set', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const skills = parseFrontmatterSkills(on(agentType))
      expect(skills.length, `${agentType}: the skills block was not read`).toBeGreaterThan(0)
      expect(collectPreloadSetDefects(agentType, skills), agentType).toEqual([])
    }
  })

  it('every variant preloads apply-decisions, and only Code preloads apply-feature-knowledge and test-driven-development', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const skills = parseFrontmatterSkills(on(agentType))
      expect(skills, `${agentType} preloads apply-decisions`).toContain('apply-decisions')
      expect(skills.includes('apply-feature-knowledge'), `${agentType}: apply-feature-knowledge`).toBe(agentType === 'Code')
      expect(skills.includes('test-driven-development'), `${agentType}: test-driven-development`).toBe(agentType === 'Code')
    }
  })

  it('the variants shrink with their modes: Refactor preloads a subset of Fix, which preloads a subset of Code', () => {
    const set = (agentType: string): string[] => parseFrontmatterSkills(on(agentType))
    for (const name of set('Refactor')) expect(set('Fix'), `Fix lacks ${name}`).toContain(name)
    for (const name of set('Fix')) expect(set('Code'), `Code lacks ${name}`).toContain(name)
  })

  it('no variant preloads or names a skill the old Step 0 table or the DOMAIN input loaded at run time (D-NO-RUNTIME-SKILLS)', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const text = on(agentType)
      for (const name of RETIRED_RUNTIME_SKILLS) {
        expect(frontmatterOf(text), `${agentType} preloads ${name}`).not.toContain(`devflow:${name}`)
        expect(bodyOf(text), `${agentType} names ${name}`).not.toContain(`devflow:${name}`)
      }
    }
  })

  it('no variant calls Skill(...) for one of its own preloaded names', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const calls = [...bodyOf(on(agentType)).matchAll(/Skill\(skill="devflow:([\w-]+)"\)/g)].map(m => m[1])
      expect(calls.filter(name => CODE_PRELOADS[agentType].includes(name)), agentType).toEqual([])
    }
  })

  it('known-bad probe: an extra skill, a preloaded runtime skill, a missing skill and a duplicate are each reported', () => {
    const code = CODE_PRELOADS['Code']
    expect(collectPreloadSetDefects('Code', code)).toEqual([])
    expect(collectPreloadSetDefects('Code', [...code, 'security'])).toEqual(['unexpected security'])
    expect(collectPreloadSetDefects('Code', [...code, 'patterns'])).toEqual(['runtime skill patterns is preloaded'])
    expect(collectPreloadSetDefects('Code', code.filter(n => n !== 'git'))).toEqual(['missing git'])
    expect(collectPreloadSetDefects('Code', [...code, 'git'])).toEqual(['a skill is listed twice'])
    // Fix owns no test-first skill, so handing it Code's set is reported skill by skill.
    expect(collectPreloadSetDefects('Fix', code)).toEqual(['unexpected test-driven-development', 'unexpected apply-feature-knowledge'])
    expect(collectPreloadSetDefects('Refactor', CODE_PRELOADS['Fix'])).toEqual(['unexpected testing'])
  })
})

describe('the preloaded SKILL.md files of each variant stay within their caps (D-CODE-PRELOAD-CAP)', () => {
  const measured = (agentType: string): Record<string, number> => Object.fromEntries(CODE_PRELOADS[agentType].map(name => [name, skillBytes(name)]))

  it('the total of each variant is at most its ceiling and each reshaped skill is within its own cap', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(collectPreloadSizeDefects(agentType, measured(agentType), PRELOAD_MAX_BYTES[agentType]), agentType).toEqual([])
    }
  })

  it('apply-decisions is under the 3,072-byte threshold that gates conditional preload stripping', () => {
    expect(skillBytes('apply-decisions')).toBeLessThan(3_072)
  })

  it('the ceilings are ordered by the sets they hold, and the variants cost less than the one agent they replace', () => {
    expect(PRELOAD_MAX_BYTES['Refactor']).toBeLessThan(PRELOAD_MAX_BYTES['Fix'])
    expect(PRELOAD_MAX_BYTES['Fix']).toBeLessThan(PRELOAD_MAX_BYTES['Code'])
  })

  it('known-bad probe: an oversize file and an oversize total are each reported, for each variant', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const real = measured(agentType)
      expect(collectPreloadSizeDefects(agentType, real, PRELOAD_MAX_BYTES[agentType]), `${agentType}: the real sizes are clean, so each seed fails for its own reason`).toEqual([])
      const total = CODE_PRELOADS[agentType].reduce((sum, name) => sum + real[name], 0)
      expect(collectPreloadSizeDefects(agentType, real, total - 1)).toEqual([`the preload is ${total} bytes, ceiling ${total - 1}`])
    }
    const bloated = { ...measured('Refactor'), 'worktree-support': 1_901 }
    expect(collectPreloadSizeDefects('Refactor', bloated, Infinity)).toEqual(['worktree-support is 1901 bytes, cap 1900'])
  })
})

// ── The curation-off variants (D-LEARNING-VARIANTS, AC-150, AC-307) ──────────────────────────────────────
//
// A machine with curation off installs dist/curation-off/agents/{code,fix,refactor}.md, each of which
// loses the `devflow:apply-decisions` preload line with the rest of its decisions text. The curation-on file
// above stays the file each total is measured against; a curation-off variant preloads the same list minus
// that skill, so its total is the on total less the skill's bytes.

describe('each curation-off Code variant preloads its set minus apply-decisions (AC-150, AC-307)', () => {
  it('each curation-off file exists, and its skills: list is the set without apply-decisions', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(off(agentType), `dist/curation-off/agents/${codeSlugOf(agentType)}.md is built`).not.toBeNull()
      const skills = parseFrontmatterSkills(off(agentType))
      expect(skills.length, `${agentType}: the skills block was not read`).toBeGreaterThan(0)
      expect(collectOffPreloadDefects(agentType, skills), agentType).toEqual([])
    }
  })

  it('the off total is the on total minus apply-decisions, and the on total stays within the ceiling', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const onTotal = totalBytes(parseFrontmatterSkills(on(agentType)))
      const offTotal = totalBytes(parseFrontmatterSkills(off(agentType)))
      expect(onTotal, `${agentType}: the curation-on total`).toBeLessThanOrEqual(PRELOAD_MAX_BYTES[agentType])
      expect(offTotal, agentType).toBe(onTotal - skillBytes('apply-decisions'))
      expect(offTotal, agentType).toBeLessThan(onTotal)
    }
  })

  it('each curation-off body drops every decisions instruction and keeps its commit step and scan', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(off(agentType), agentType).not.toContain('DECISIONS_CONTEXT')
      expect(off(agentType), agentType).not.toContain('apply-decisions')
      expect(off(agentType), agentType).toContain('**Security scan (conditional):**')
      expect(off(agentType).length, `${agentType}: the curation-off body is shorter`).toBeLessThan(on(agentType).length)
    }
  })

  it('known-bad probe: a kept preload, a missing skill and an extra skill are each reported', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      const real = offPreload(agentType)
      expect(collectOffPreloadDefects(agentType, real), agentType).toEqual([])
      expect(collectOffPreloadDefects(agentType, [...real, 'apply-decisions'])).toEqual(['apply-decisions is preloaded under curation off'])
      expect(collectOffPreloadDefects(agentType, real.filter(n => n !== 'git'))).toEqual(['missing git'])
      expect(collectOffPreloadDefects(agentType, [...real, 'security'])).toEqual(['unexpected security'])
    }
  })
})
