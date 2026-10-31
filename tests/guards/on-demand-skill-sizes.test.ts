/**
 * Size ceilings of the skills that no agent preloads (#718): docs-framework, the
 * language and ecosystem skills, boundary-validation, patterns, dependency-research,
 * compliance, agent-references and the five research skills. A run loads one with the
 * Skill tool when it invokes the skill, and reads it again in every later turn, so each
 * ceiling holds the size that the lean cut reached. agent-references is the exception:
 * no run loads it with the Skill tool, and its ceiling only keeps it from growing back.
 * Each row is registered in `tests/fixtures/numeric-floors.json`; lowered, never raised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT } from '../helpers.js'

/** [skill, ceiling of its SKILL.md in bytes]. Each row's text is the pattern its numeric-floors.json entry pins. */
const SKILL_MAX_BYTES: ReadonlyArray<readonly [string, number]> = [
  ['docs-framework', 10_453],
  ['agent-references', 2_825],
  ['compliance', 3_548],
  ['dependency-research', 3_765],
  ['boundary-validation', 3_081],
  ['patterns', 2_981],
  ['typescript', 2_711],
  ['python', 2_620],
  ['go', 2_405],
  ['java', 2_506],
  ['rust', 2_776],
  ['react', 3_631],
  ['accessibility', 3_455],
  ['ui-design', 4_096],
  ['research-codebase', 2_641],
  ['research-competitor', 3_418],
  ['research-external', 3_456],
  ['research-market', 3_304],
  ['research-technology', 4_258],
]

/** Named collector: the file is over its ceiling. */
function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

const skillText = (name: string): string => readFileSync(path.join(ROOT, 'src', 'assets', 'skills', name, 'SKILL.md'), 'utf-8')

describe('the on-demand skills sit under their ceilings (#718)', () => {
  it.each(SKILL_MAX_BYTES)('%s SKILL.md fits its ceiling', (name, ceiling) => {
    const text = skillText(name)
    expect(Buffer.byteLength(text), 'the skill is read: the guard would pass vacuously on an empty one').toBeGreaterThan(1_000)
    expect(collectSizeDefects(`${name} SKILL.md`, text, ceiling)).toEqual([])
  })

  it('probes: one byte over a ceiling is reported, and the ceiling itself passes', () => {
    const [name, ceiling] = SKILL_MAX_BYTES[0]
    const text = skillText(name)
    const over = `${text}${'x'.repeat(ceiling - Buffer.byteLength(text) + 1)}`
    expect(Buffer.byteLength(over)).toBe(ceiling + 1)
    expect(collectSizeDefects(name, over, ceiling)).toEqual([`${name} is ${ceiling + 1} bytes, ceiling ${ceiling}`])
    expect(collectSizeDefects(name, over.slice(0, -1), ceiling)).toEqual([])
  })
})
