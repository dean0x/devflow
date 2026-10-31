/**
 * Size ceilings of the Test group (#711): the Test agent body, the `qa` skill that it
 * preloads, and the browser reference that a run with web-facing changes reads. A spawn
 * reads these bytes again in every later turn, so each ceiling holds the size that the
 * lean cut reached. Each row is registered in `tests/fixtures/numeric-floors.json`;
 * lowered, never raised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { ROOT, resolveAgentSource } from '../helpers.js'

/** The Test agent body (test.md), in bytes. It is hand-authored, so every build key ships it unchanged. */
const TEST_BODY_MAX_BYTES = 11_071
/** src/assets/skills/qa/SKILL.md, in bytes. */
const QA_SKILL_MAX_BYTES = 4_574
/** src/assets/skills/qa/references/browser-testing.md, in bytes. */
const QA_BROWSER_REF_MAX_BYTES = 3_042

/** Named collector: the file is over its ceiling. */
function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

const qaFile = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'qa', ...parts), 'utf-8')

function files(): ReadonlyArray<readonly [string, string, number]> {
  return [
    ['test.md', resolveAgentSource('test').content, TEST_BODY_MAX_BYTES],
    ['qa SKILL.md', qaFile('SKILL.md'), QA_SKILL_MAX_BYTES],
    ['qa references/browser-testing.md', qaFile('references', 'browser-testing.md'), QA_BROWSER_REF_MAX_BYTES],
  ]
}

describe('the Test group sits under its ceilings (#711)', () => {
  it.each(files())('%s fits its ceiling', (label, text, ceiling) => {
    expect(Buffer.byteLength(text), 'the file is read: the guard would pass vacuously on an empty one').toBeGreaterThan(1_000)
    expect(collectSizeDefects(label, text, ceiling)).toEqual([])
  })

  it('probes: one byte over a ceiling is reported, and the ceiling itself passes', () => {
    const [label, text, ceiling] = files()[0]
    const over = `${text}${'x'.repeat(ceiling - Buffer.byteLength(text) + 1)}`
    expect(Buffer.byteLength(over)).toBe(ceiling + 1)
    expect(collectSizeDefects(label, over, ceiling)).toEqual([`${label} is ${ceiling + 1} bytes, ceiling ${ceiling}`])
    expect(collectSizeDefects(label, over.slice(0, -1), ceiling)).toEqual([])
  })
})
