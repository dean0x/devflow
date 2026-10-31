/**
 * Size ceilings of the Plan path group (#714): the Design agent body in both curation builds,
 * the two mode skills that it preloads, and the Explore agent body. A spawn reads these bytes
 * again in every turn, so each ceiling holds the size that the lean cut reached. The /plan
 * command builds keep their ceilings in command-size.test.ts. Each row is registered in
 * `tests/fixtures/numeric-floors.json`; lowered, never raised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, resolveAgentSource, resolveCurationOffSource } from '../helpers.js'

/** The Design agent body of the curation-on build, dist/agents/design.md, in bytes. */
const DESIGN_BODY_MAX_BYTES = 4_090
/** The Design agent body of the curation-off build, dist/curation-off/agents/design.md, in bytes. */
const DESIGN_BODY_CURATION_OFF_MAX_BYTES = 3_524
/** The Explore agent body, src/assets/agents/explore.md (hand-authored, one build), in bytes. */
const EXPLORE_BODY_MAX_BYTES = 3_355

/** [skill, ceiling of its SKILL.md in bytes]. Each row's text is the pattern its numeric-floors.json entry pins. */
const SKILL_MAX_BYTES: ReadonlyArray<readonly [string, number]> = [
  ['gap-analysis', 5_575],
  ['design-review', 4_415],
]

/** Named collector: the file is over its ceiling. */
function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

function agentBuilds(): ReadonlyArray<readonly [string, string, number]> {
  const off = resolveCurationOffSource('agents', 'design')
  if (off === null) throw new Error('dist/curation-off/agents/design.md is absent: run `npm run build:mds`')
  return [
    ['design.md (curation on)', resolveAgentSource('design').content, DESIGN_BODY_MAX_BYTES],
    ['design.md (curation off)', off, DESIGN_BODY_CURATION_OFF_MAX_BYTES],
    ['explore.md', resolveAgentSource('explore').content, EXPLORE_BODY_MAX_BYTES],
  ]
}

const skillText = (name: string): string => readFileSync(path.join(ROOT, 'src', 'assets', 'skills', name, 'SKILL.md'), 'utf-8')

describe('the Plan path group sits under its ceilings (#714)', () => {
  it.each(agentBuilds())('%s fits its ceiling', (label, text, ceiling) => {
    expect(Buffer.byteLength(text), 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(2_000)
    expect(collectSizeDefects(label, text, ceiling)).toEqual([])
  })

  it.each(SKILL_MAX_BYTES)('%s SKILL.md fits its ceiling', (name, ceiling) => {
    const text = skillText(name)
    expect(Buffer.byteLength(text), 'the skill is read: the guard would pass vacuously on an empty one').toBeGreaterThan(1_000)
    expect(collectSizeDefects(`${name} SKILL.md`, text, ceiling)).toEqual([])
  })

  it('probes: one byte over a ceiling is reported, and the ceiling itself passes', () => {
    const [label, text, ceiling] = agentBuilds()[0]
    const over = `${text}${'x'.repeat(ceiling - Buffer.byteLength(text) + 1)}`
    expect(Buffer.byteLength(over)).toBe(ceiling + 1)
    expect(collectSizeDefects(label, over, ceiling)).toEqual([`${label} is ${ceiling + 1} bytes, ceiling ${ceiling}`])
    expect(collectSizeDefects(label, over.slice(0, -1), ceiling)).toEqual([])
  })
})
