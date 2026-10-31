/**
 * Size ceilings of the Review group (#720): the Review agent body in both curation builds,
 * the `review-methodology` skill that it preloads, and the ten focus skills, one of which
 * each Review spawn loads. A spawn reads these bytes again in every turn, so each ceiling
 * holds the size that the lean cut reached. Each row is registered in
 * `tests/fixtures/numeric-floors.json`; lowered, never raised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, resolveAgentSource, resolveCurationOffSource } from '../helpers.js'

/** The Review agent body of the curation-on build, dist/agents/review.md, in bytes. */
const REVIEW_BODY_MAX_BYTES = 10_899
/** The Review agent body of the curation-off build, dist/curation-off/agents/review.md, in bytes. */
const REVIEW_BODY_CURATION_OFF_MAX_BYTES = 10_303

/** [skill, ceiling of its SKILL.md in bytes]. Each row's text is the pattern its numeric-floors.json entry pins. */
const SKILL_MAX_BYTES: ReadonlyArray<readonly [string, number]> = [
  ['review-methodology', 3_195],
  ['architecture', 3_403],
  ['complexity', 2_465],
  ['consistency', 2_136],
  ['database', 3_028],
  ['dependencies', 2_051],
  ['documentation', 2_808],
  ['performance', 3_080],
  ['regression', 3_118],
  ['reliability', 2_524],
  ['security', 4_063],
]

/** Named collector: the file is over its ceiling. */
function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

function reviewBuilds(): ReadonlyArray<readonly [string, string, number]> {
  const off = resolveCurationOffSource('agents', 'review')
  if (off === null) throw new Error('dist/curation-off/agents/review.md is absent: run `npm run build:mds`')
  return [
    ['review.md (curation on)', resolveAgentSource('review').content, REVIEW_BODY_MAX_BYTES],
    ['review.md (curation off)', off, REVIEW_BODY_CURATION_OFF_MAX_BYTES],
  ]
}

const skillText = (name: string): string => readFileSync(path.join(ROOT, 'src', 'assets', 'skills', name, 'SKILL.md'), 'utf-8')

describe('the Review group sits under its ceilings (#720)', () => {
  it.each(reviewBuilds())('%s fits its ceiling', (label, text, ceiling) => {
    expect(Buffer.byteLength(text), 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(5_000)
    expect(collectSizeDefects(label, text, ceiling)).toEqual([])
  })

  it.each(SKILL_MAX_BYTES)('%s SKILL.md fits its ceiling', (name, ceiling) => {
    const text = skillText(name)
    expect(Buffer.byteLength(text), 'the skill is read: the guard would pass vacuously on an empty one').toBeGreaterThan(1_000)
    expect(collectSizeDefects(`${name} SKILL.md`, text, ceiling)).toEqual([])
  })

  it('probes: one byte over a ceiling is reported, and the ceiling itself passes', () => {
    const [label, text, ceiling] = reviewBuilds()[0]
    const over = `${text}${'x'.repeat(ceiling - Buffer.byteLength(text) + 1)}`
    expect(Buffer.byteLength(over)).toBe(ceiling + 1)
    expect(collectSizeDefects(label, over, ceiling)).toEqual([`${label} is ${ceiling + 1} bytes, ceiling ${ceiling}`])
    expect(collectSizeDefects(label, over.slice(0, -1), ceiling)).toEqual([])
  })
})
