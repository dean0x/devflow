/**
 * D-KNOWLEDGE-SINGLE-AUTHORITY — each feature-knowledge rule is written once, where its
 * producer lives, and the consumer skill does not repeat it.
 *
 * `apply-feature-knowledge` rides in the preload of every agent that takes
 * `FEATURE_KNOWLEDGE`, so each sentence it carries is paid on every spawn. Two things it
 * used to restate belong to the commands that build and refresh the knowledge:
 *
 *   - the block format (`--- Feature knowledge: {slug} ---`, the `KB:` path, the `Rules:`
 *     bullets and the `Headings:` index) lives once, in `knowledge_load()`; the skill points at
 *     the header and tells its reader how to apply a block, and never restates the template;
 *   - the write-through rule (a KB is written at the point a documented area changes,
 *     never on a background schedule) lives once, in `knowledge_writeback()`.
 *
 * Both halves are checked: the skill carries neither, and the compiled commands that carry
 * each partial carry its text exactly once. The compiled commands are the text the agents
 * receive, so the count is read from `dist/commands`, not from the partial. The counts
 * are sampled from the commands themselves, and a floor on the number of hosts stops a
 * collector that read nothing from passing. The load floor is a floor, not a count: release
 * loads by the same partial, so it is an eighth host beside the seven that call it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { requireDistFile, requireDistFiles } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SKILL_PATH = path.join(ROOT, 'src', 'assets', 'skills', 'apply-feature-knowledge', 'SKILL.md')

const TEMPLATE_HEADER = '--- Feature knowledge: {slug} ---'
/** The block's own lines: the path, the Rules label and the heading index live in the partial alone. */
const BLOCK_LINES = ['KB: .devflow/features/{slug}/KNOWLEDGE.md', 'Headings: L5 Rules · L40 Overview']
const LOAD_HEADING = '### Load Feature Knowledge'
const WRITEBACK_HEADING = '### Feature Knowledge Write-Back (Conditional)'
const WRITE_THROUGH = 'Knowledge bases are written through at that point, never on a background schedule.'

/** Compiled commands that carry `knowledge_load()` today; a collector that finds fewer read the wrong corpus. */
const LOAD_HOST_FLOOR = 7
/** Compiled commands that carry `knowledge_writeback()` today. */
const WRITEBACK_HOST_FLOOR = 5

const countOf = (text: string, needle: string): number => text.split(needle).length - 1

/** Named collector: how the consumer skill repeats what its producers own. */
export function collectSkillRestatements(skill: string): string[] {
  const out: string[] = []
  if (/^## Concatenation Format/m.test(skill)) out.push('a `## Concatenation Format` section')
  if (skill.includes('[full KNOWLEDGE.md content]')) out.push('the concatenation template body')
  for (const line of BLOCK_LINES) if (skill.includes(line)) out.push(`the block format line "${line.slice(0, 20)}"`)
  if (/write-through/i.test(skill) || /background schedule/i.test(skill)) out.push('the write-through rule')
  return out
}

/** Named collector: compiled commands whose copy of a producer's text is not exactly one. */
export function collectProducerCopyDefects(
  commands: ReadonlyArray<readonly [string, string]>,
  heading: string,
  needle: string,
  floor: number,
): string[] {
  const hosts = commands.filter(([, text]) => text.includes(heading))
  const out = hosts.flatMap(([file, text]) => {
    const n = countOf(text, needle)
    return n === 1 ? [] : [`${file}: ${n} copies of "${needle.slice(0, 48)}"`]
  })
  if (hosts.length < floor) out.push(`only ${hosts.length} command(s) carry "${heading}", floor ${floor}`)
  return out
}

const compiled = (): Array<readonly [string, string]> => requireDistFiles().map(f => [f, requireDistFile(f)] as const)

describe('the consumer skill repeats nothing its producers own (D-KNOWLEDGE-SINGLE-AUTHORITY)', () => {
  it('apply-feature-knowledge carries neither the template nor the write-through rule', () => {
    expect(collectSkillRestatements(readFileSync(SKILL_PATH, 'utf-8'))).toEqual([])
  })

  it('the skill still holds the consumer algorithm, the verify-on-read sentences and the skip guard', () => {
    const skill = readFileSync(SKILL_PATH, 'utf-8')
    expect(skill).toContain('## 3-Step Algorithm')
    expect(skill).toContain('headed `--- Feature knowledge: {slug} ---`')
    expect(skill).toContain('Read the source and trust it')
    expect(skill).toContain('verify-on-read')
    expect(skill).toMatch(/When `FEATURE_KNOWLEDGE` is `\(none\)`, empty, or not provided — skip this skill entirely/)
  })

  it('known-bad probe: a restated template section and a restated write-through rule are each reported', () => {
    const skill = readFileSync(SKILL_PATH, 'utf-8')
    const withTemplate = `${skill}\n## Concatenation Format\n\n${TEMPLATE_HEADER}\n[full KNOWLEDGE.md content]\n`
    expect(collectSkillRestatements(withTemplate)).toEqual(['a `## Concatenation Format` section', 'the concatenation template body'])
    const withRule = `${skill}\n- KBs are written at the point a documented area changes (not on a background schedule)\n`
    expect(collectSkillRestatements(withRule)).toEqual(['the write-through rule'])
    const withBlock = `${skill}\n${TEMPLATE_HEADER}\n${BLOCK_LINES[0]}\nRules:\n${BLOCK_LINES[1]}\n`
    expect(collectSkillRestatements(withBlock)).toEqual([
      `the block format line "${BLOCK_LINES[0].slice(0, 20)}"`,
      `the block format line "${BLOCK_LINES[1].slice(0, 20)}"`,
    ])
  })
})

describe('each producer carries its text once in every compiled command that has it (D-KNOWLEDGE-SINGLE-AUTHORITY)', () => {
  it('the block format appears exactly once in each command that loads feature knowledge', () => {
    expect(collectProducerCopyDefects(compiled(), LOAD_HEADING, TEMPLATE_HEADER, LOAD_HOST_FLOOR)).toEqual([])
    for (const line of BLOCK_LINES) {
      expect(collectProducerCopyDefects(compiled(), LOAD_HEADING, line, LOAD_HOST_FLOOR), line).toEqual([])
    }
  })

  it('the write-through sentence appears exactly once in each command that writes feature knowledge back', () => {
    expect(collectProducerCopyDefects(compiled(), WRITEBACK_HEADING, WRITE_THROUGH, WRITEBACK_HOST_FLOOR)).toEqual([])
  })

  it('known-bad probe: a doubled template, a missing sentence and a short corpus are each reported', () => {
    const loadHost = `${LOAD_HEADING}\n${TEMPLATE_HEADER}\n${TEMPLATE_HEADER}\n`
    expect(collectProducerCopyDefects([['a.md', loadHost]], LOAD_HEADING, TEMPLATE_HEADER, 1)).toEqual([
      `a.md: 2 copies of "${TEMPLATE_HEADER}"`,
    ])
    const writeHost = `${WRITEBACK_HEADING}\nno sentence here\n`
    expect(collectProducerCopyDefects([['b.md', writeHost]], WRITEBACK_HEADING, WRITE_THROUGH, 1)).toEqual([
      `b.md: 0 copies of "${WRITE_THROUGH.slice(0, 48)}"`,
    ])
    expect(collectProducerCopyDefects([], LOAD_HEADING, TEMPLATE_HEADER, 2)).toEqual([
      `only 0 command(s) carry "${LOAD_HEADING}", floor 2`,
    ])
  })
})
