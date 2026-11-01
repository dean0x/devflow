/**
 * Size ceilings of the Plan path group (#714): the Design and Architect agent bodies (#733) in
 * both curation builds, the mode skill that each preloads, and the Explore agent body. A spawn reads these bytes
 * again in every turn, so each ceiling holds the size that the lean cut reached. The /plan
 * command builds keep their ceilings in command-size.test.ts. Each row is registered in
 * `tests/fixtures/numeric-floors.json`; lowered, never raised. The one exception is #752, which restored
 * the Architect plan-writing section and the design-review Suggest lines after wording cuts in the same
 * files; each raise states its bytes in its row.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, resolveAgentSource, resolveCurationOffSource } from '../helpers.js'

/** The Design agent body of the curation-on build, dist/agents/design.md, in bytes. */
const DESIGN_BODY_MAX_BYTES = 3_617
/** The Design agent body of the curation-off build, dist/curation-off/agents/design.md, in bytes. */
const DESIGN_BODY_CURATION_OFF_MAX_BYTES = 3_051
/** The Architect agent body of the curation-on build, dist/agents/architect.md, in bytes. */
const ARCHITECT_BODY_MAX_BYTES = 3_782
/** The Architect agent body of the curation-off build, dist/curation-off/agents/architect.md, in bytes. */
const ARCHITECT_BODY_CURATION_OFF_MAX_BYTES = 3_216
/** The Explore agent body (hand-authored, one build), in bytes. */
const EXPLORE_BODY_MAX_BYTES = 3_276

/** [skill, ceiling of its SKILL.md in bytes]. Each row's text is the pattern its numeric-floors.json entry pins. */
const SKILL_MAX_BYTES: ReadonlyArray<readonly [string, number]> = [
  ['gap-analysis', 5_553],
  ['design-review', 5_217],
]

/** Named collector: the file is over its ceiling. */
function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

function curationOffBody(name: string): string {
  const off = resolveCurationOffSource('agents', name)
  if (off === null) throw new Error(`dist/curation-off/agents/${name}.md is absent: run \`npm run build:mds\``)
  return off
}

function agentBuilds(): ReadonlyArray<readonly [string, string, number]> {
  return [
    ['design.md (curation on)', resolveAgentSource('design').content, DESIGN_BODY_MAX_BYTES],
    ['design.md (curation off)', curationOffBody('design'), DESIGN_BODY_CURATION_OFF_MAX_BYTES],
    ['architect.md (curation on)', resolveAgentSource('architect').content, ARCHITECT_BODY_MAX_BYTES],
    ['architect.md (curation off)', curationOffBody('architect'), ARCHITECT_BODY_CURATION_OFF_MAX_BYTES],
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
