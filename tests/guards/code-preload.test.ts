/**
 * D-MODE-SKILLS-ON-DEMAND and D-CODE-PRELOAD-CAP — Code preloads six skills and loads four on demand.
 *
 * Every Code spawn pays for its frontmatter `skills:` list: the SKILL.md of each one enters the
 * first turn and is re-read on every turn after it. Code alone is about half of all spend, so the
 * list is the cheapest place to save. Ten skills were preloaded (53,450 bytes). Four of them are
 * needed by some operating modes and not others: `software-design`, `patterns`,
 * `boundary-validation` and `dependency-research`. They leave the preload and load on demand from
 * the "Step 0: Mode Skills" table in `code.md`, by a hard condition per mode
 * (D-MODE-SKILLS-ON-DEMAND). That ticket does not edit the plugin `requires:` lists: the Step 0
 * table keeps naming the four skills, so `tests/guards/requires-closure.test.ts` still holds them
 * installed.
 *
 * What stays is what every mode uses (`git`, `testing`, `test-driven-development`,
 * `worktree-support`) and the two consumer skills (`apply-decisions`, `apply-feature-knowledge`).
 * The six SKILL.md files total at most CODE_PRELOAD_MAX_BYTES, the ceiling the numeric-floor
 * manifest registers (`code-preload-max-bytes`), and three of them carry their own cap
 * (D-CODE-PRELOAD-CAP). A ceiling is lowered by a pass that cut the artifact and never raised to
 * fit one that grew; `git`, `testing` and `test-driven-development` are fixed terms here, so a
 * later change that grows any of the six pays for itself inside the six.
 *
 * `tests/guards/agent-config.test.ts` does not pin Code's `skills:` key: this file is the single
 * authority for it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { CODE_OPERATIONS, parseFrontmatterSkills, resolveAgentSource, resolveLearningOffSource } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills')

/** The skills Code preloads, in the order its frontmatter lists them. */
export const CODE_PRELOAD: readonly string[] = [
  'git', 'testing', 'test-driven-development', 'worktree-support', 'apply-feature-knowledge', 'apply-decisions',
]

/** The skills Code loads from Step 0 instead. */
export const MODE_SKILLS: readonly string[] = ['software-design', 'patterns', 'boundary-validation', 'dependency-research']

/** The six SKILL.md files together, in bytes. Registered as `code-preload-max-bytes` in tests/fixtures/numeric-floors.json; lowered, never raised. */
const CODE_PRELOAD_MAX_BYTES = 25_646;

/**
 * Per-file caps for the three skills this ticket reshaped. `apply-decisions` stays under the
 * 3,072-byte threshold at which conditional preload stripping would apply.
 */
const FILE_CAPS: Readonly<Record<string, number>> = {
  'worktree-support': 1_900,
  'apply-feature-knowledge': 2_200,
  'apply-decisions': 3_071,
}

const skillBytes = (name: string): number => Buffer.byteLength(readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8'))

/** Named collector: how a preload list differs from the six. */
export function collectPreloadSetDefects(skills: readonly string[]): string[] {
  const out: string[] = []
  for (const name of CODE_PRELOAD) if (!skills.includes(name)) out.push(`missing ${name}`)
  for (const name of skills) {
    if (!CODE_PRELOAD.includes(name)) out.push(MODE_SKILLS.includes(name) ? `mode skill ${name} is preloaded` : `unexpected ${name}`)
  }
  if (new Set(skills).size !== skills.length) out.push('a skill is listed twice')
  return out
}

/** Named collector: the byte totals that are over a cap. */
export function collectPreloadSizeDefects(bytes: Readonly<Record<string, number>>, totalCap: number): string[] {
  const out: string[] = []
  for (const [name, cap] of Object.entries(FILE_CAPS)) {
    if ((bytes[name] ?? Infinity) > cap) out.push(`${name} is ${bytes[name]} bytes, cap ${cap}`)
  }
  const total = CODE_PRELOAD.reduce((sum, name) => sum + (bytes[name] ?? 0), 0)
  if (total > totalCap) out.push(`the preload is ${total} bytes, ceiling ${totalCap}`)
  return out
}

/**
 * Named collector: how code.md's "Step 0: Mode Skills" section falls short. It sits before
 * "## Responsibilities", its header names the four mode skills in order, and it holds exactly one
 * row for each of the eight modes with a condition (or `never`) for every skill in that same row.
 * The rows that load nothing (`validation-fix`, `pr-create`, `edit`) read `never` throughout, and
 * `ci-fix` may load only `dependency-research`.
 */
export function collectStepZeroDefects(codeText: string): string[] {
  const out: string[] = []
  const start = codeText.indexOf('## Step 0: Mode Skills')
  const responsibilities = codeText.indexOf('## Responsibilities')
  if (start === -1) return ['no "## Step 0: Mode Skills" section']
  if (responsibilities === -1 || start > responsibilities) out.push('Step 0 does not sit before "## Responsibilities"')
  const next = codeText.indexOf('\n## ', start + 1)
  const section = codeText.slice(start, next === -1 ? undefined : next)
  const rows = section.split('\n').filter(line => line.startsWith('|')).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
  const header = rows[0] ?? []
  const expectedHeader = ['Mode', ...MODE_SKILLS.map(name => `devflow:${name}`)]
  if (header.join('|') !== expectedHeader.join('|')) out.push(`the header reads "${header.join(' | ')}", expected "${expectedHeader.join(' | ')}"`)
  const body = rows.slice(2)
  for (const mode of CODE_OPERATIONS) {
    const matching = body.filter(cells => cells[0] === `\`${mode}\``)
    if (matching.length !== 1) { out.push(`${mode}: ${matching.length} rows, expected one`); continue }
    const cells = matching[0].slice(1)
    if (cells.length !== MODE_SKILLS.length || cells.some(cell => cell === '')) { out.push(`${mode}: needs a condition or "never" for each of the ${MODE_SKILLS.length} skills`); continue }
    const nevers = cells.map(cell => cell === 'never')
    if (['validation-fix', 'pr-create', 'edit'].includes(mode) && !nevers.every(Boolean)) out.push(`${mode}: loads no mode skill, so every cell reads "never"`)
    if (mode === 'ci-fix' && !(nevers[0] && nevers[1] && nevers[2] && !nevers[3] && /dependency/.test(cells[3]))) out.push('ci-fix: only dependency-research may load, and only for a dependency')
    if (['implement', 'issue-fix', 'alignment-fix', 'qa-fix'].includes(mode) && nevers.some(Boolean)) out.push(`${mode}: every cell carries a condition`)
  }
  return out
}

const code = (): string => resolveAgentSource('code').content
const bodyOf = (text: string): string => text.slice(text.indexOf('\n---\n', 4) + 5)

describe('Code preloads six skills and loads four on demand (D-MODE-SKILLS-ON-DEMAND)', () => {
  it('the frontmatter skills: list is exactly the six', () => {
    const skills = parseFrontmatterSkills(code())
    expect(skills.length, 'the skills block was not read').toBeGreaterThan(0)
    expect(collectPreloadSetDefects(skills)).toEqual([])
  })

  it('none of the four mode skills appears in the frontmatter', () => {
    const frontmatter = code().slice(0, code().indexOf('\n---\n', 4))
    for (const name of MODE_SKILLS) expect(frontmatter, name).not.toContain(`devflow:${name}`)
  })

  it('the body names each mode skill, so the plugin closure still holds them installed', () => {
    const body = bodyOf(code())
    for (const name of MODE_SKILLS) expect(body, name).toContain(`devflow:${name}`)
    expect(body).toContain('Skill(skill="devflow:<name>")')
  })

  it('the body calls Skill(...) for none of the six preloaded names', () => {
    const calls = [...bodyOf(code()).matchAll(/Skill\(skill="devflow:([\w-]+)"\)/g)].map(m => m[1])
    expect(calls.filter(name => CODE_PRELOAD.includes(name))).toEqual([])
  })

  it('known-bad probe: a seventh skill, a preloaded mode skill and a missing skill are each reported', () => {
    expect(collectPreloadSetDefects([...CODE_PRELOAD, 'security'])).toEqual(['unexpected security'])
    expect(collectPreloadSetDefects([...CODE_PRELOAD, 'patterns'])).toEqual(['mode skill patterns is preloaded'])
    expect(collectPreloadSetDefects(CODE_PRELOAD.filter(n => n !== 'git'))).toEqual(['missing git'])
    expect(collectPreloadSetDefects([...CODE_PRELOAD, 'git'])).toEqual(['a skill is listed twice'])
  })
})

describe('code.md Step 0 gives each mode a hard condition per mode skill (D-MODE-SKILLS-ON-DEMAND)', () => {
  it('Step 0 sits before Responsibilities with one complete row for each of the eight modes', () => {
    expect(collectStepZeroDefects(code())).toEqual([])
  })

  it('known-bad probe: a lost row, a short row, a loaded no-op mode and a misplaced section are each reported', () => {
    const real = code()
    expect(collectStepZeroDefects(real), 'the real section is clean, so each seed fails for its own reason').toEqual([])
    const lostRow = real.replace(/^\| `qa-fix` \|.*\n/m, '')
    expect(lostRow, 'the seed must land').not.toBe(real)
    expect(collectStepZeroDefects(lostRow)).toEqual(['qa-fix: 0 rows, expected one'])
    const shortRow = real.replace(/^(\| `issue-fix` \|.*)\| the fix adds a \*\*helper\*\* \|$/m, '$1|')
    expect(shortRow, 'the seed must land').not.toBe(real)
    expect(collectStepZeroDefects(shortRow)).toEqual(['issue-fix: needs a condition or "never" for each of the 4 skills'])
    const loaded = real.replace(/^\| `edit` \| never \|/m, '| `edit` | the edit adds **error** |')
    expect(loaded, 'the seed must land').not.toBe(real)
    expect(collectStepZeroDefects(loaded)).toEqual(['edit: loads no mode skill, so every cell reads "never"'])
    const moved = real.replace('## Step 0: Mode Skills', '## Step 9: Mode Skills')
    expect(collectStepZeroDefects(moved)).toEqual(['no "## Step 0: Mode Skills" section'])
    const stepZero = real.slice(real.indexOf('## Step 0: Mode Skills'), real.indexOf('## Responsibilities'))
    const after = real.replace(stepZero, '').replace('## Output', `${stepZero}## Output`)
    expect(collectStepZeroDefects(after)).toEqual(['Step 0 does not sit before "## Responsibilities"'])
  })
})

describe('the six preloaded SKILL.md files stay within their caps (D-CODE-PRELOAD-CAP)', () => {
  const measured = (): Record<string, number> => Object.fromEntries(CODE_PRELOAD.map(name => [name, skillBytes(name)]))

  it('the total is at most CODE_PRELOAD_MAX_BYTES and each reshaped skill is within its own cap', () => {
    expect(collectPreloadSizeDefects(measured(), CODE_PRELOAD_MAX_BYTES)).toEqual([])
  })

  it('apply-decisions is under the 3,072-byte threshold that gates conditional preload stripping', () => {
    expect(skillBytes('apply-decisions')).toBeLessThan(3_072)
  })

  it('known-bad probe: an oversize file and an oversize total are each reported', () => {
    const real = measured()
    expect(collectPreloadSizeDefects(real, CODE_PRELOAD_MAX_BYTES), 'the real sizes are clean, so each seed fails for its own reason').toEqual([])
    const bloated = { ...real, 'worktree-support': 1_901 }
    expect(collectPreloadSizeDefects(bloated, Infinity)).toEqual(['worktree-support is 1901 bytes, cap 1900'])
    const total = CODE_PRELOAD.reduce((sum, name) => sum + real[name], 0)
    expect(collectPreloadSizeDefects(real, total - 1)).toEqual([`the preload is ${total} bytes, ceiling ${total - 1}`])
  })
})

// ── The learning-off Code (D-LEARNING-VARIANTS, AC-150) ─────────────────────────────────────────────
//
// A machine with learning off installs dist/learning-off/agents/code.md, which loses the
// `devflow:apply-decisions` preload line with the rest of the decisions text. The learning-on file above
// stays the file the six-skill total is measured against (25,646 bytes); the learning-off Code preloads the
// same list minus that skill, so its total is the on total less the skill's bytes.

/** The skills the learning-off Code preloads: the six minus `apply-decisions`. */
const OFF_PRELOAD: readonly string[] = CODE_PRELOAD.filter(name => name !== 'apply-decisions')

/** Named collector: how a learning-off preload list differs from the five. */
export function collectOffPreloadDefects(skills: readonly string[]): string[] {
  const out: string[] = []
  if (skills.includes('apply-decisions')) out.push('apply-decisions is preloaded under learning off')
  for (const name of OFF_PRELOAD) if (!skills.includes(name)) out.push(`missing ${name}`)
  for (const name of skills) if (name !== 'apply-decisions' && !OFF_PRELOAD.includes(name)) out.push(`unexpected ${name}`)
  return out
}

const codeOff = (): string => resolveLearningOffSource('agents', 'code') as string

describe('the learning-off Code preloads the six minus apply-decisions (AC-150)', () => {
  it('the learning-off file exists, and its skills: list is the five', () => {
    expect(codeOff(), 'dist/learning-off/agents/code.md is built').not.toBeNull()
    const skills = parseFrontmatterSkills(codeOff())
    expect(skills.length, 'the skills block was not read').toBeGreaterThan(0)
    expect(collectOffPreloadDefects(skills)).toEqual([])
  })

  it('the off total is the on total minus apply-decisions, and the on total stays within the ceiling', () => {
    const total = (skills: readonly string[]): number => skills.reduce((sum, name) => sum + skillBytes(name), 0)
    const on = total(parseFrontmatterSkills(code()))
    const off = total(parseFrontmatterSkills(codeOff()))
    expect(on, 'the learning-on six-file total').toBeLessThanOrEqual(CODE_PRELOAD_MAX_BYTES)
    expect(off).toBe(on - skillBytes('apply-decisions'))
    expect(off).toBeLessThan(on)
  })

  it('the learning-off body keeps Step 0 and the mode-skill names, and drops every decisions instruction', () => {
    expect(collectStepZeroDefects(codeOff())).toEqual([])
    for (const name of MODE_SKILLS) expect(bodyOf(codeOff()), name).toContain(`devflow:${name}`)
    expect(codeOff()).not.toContain('DECISIONS_CONTEXT')
    expect(codeOff()).not.toContain('apply-decisions')
  })

  it('known-bad probe: a kept preload, a missing skill and an extra skill are each reported', () => {
    expect(collectOffPreloadDefects(OFF_PRELOAD)).toEqual([])
    expect(collectOffPreloadDefects([...OFF_PRELOAD, 'apply-decisions'])).toEqual(['apply-decisions is preloaded under learning off'])
    expect(collectOffPreloadDefects(OFF_PRELOAD.filter(n => n !== 'git'))).toEqual(['missing git'])
    expect(collectOffPreloadDefects([...OFF_PRELOAD, 'security'])).toEqual(['unexpected security'])
  })
})
