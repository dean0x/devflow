/**
 * Size ceilings of the agents that #718 (lean other targets) cut and that had no ceiling of
 * their own: each agent body in every curation build. A spawn reads these bytes again in every
 * turn, so each ceiling holds the size that the lean cut reached. Validate and Synthesize keep
 * their ceilings in validate-lint-pack.test.ts and agent-references.test.ts. Each row is
 * registered in `tests/fixtures/numeric-floors.json`; lowered, never raised.
 */

import { describe, it, expect } from 'vitest'
import { resolveAgentSource, resolveCurationOffSource } from '../helpers.js'

type Build = 'on' | 'off'

/**
 * [agent, curation build, ceiling of its compiled body in bytes]. `on` is the default build, which is the source
 * itself for a hand-authored agent. Each row's text is the pattern its numeric-floors.json entry pins.
 */
const AGENT_MAX_BYTES: ReadonlyArray<readonly [string, Build, number]> = [
  ['research', 'on', 5_153],
  ['research', 'off', 4_793],
  ['evaluate', 'on', 4_234],
  ['debug', 'on', 9_411],
  ['debug', 'off', 9_051],
]

/** Named collector: the file is over its ceiling. */
function collectSizeDefects(label: string, text: string, ceiling: number): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > ceiling ? [`${label} is ${bytes} bytes, ceiling ${ceiling}`] : []
}

function bodyOf(agent: string, build: Build): string {
  if (build === 'on') return resolveAgentSource(agent).content
  const off = resolveCurationOffSource('agents', agent)
  if (off === null) throw new Error(`dist/curation-off/agents/${agent}.md is absent: run \`npm run build:mds\``)
  return off
}

describe('the agents cut by #718 sit under their ceilings', () => {
  it.each(AGENT_MAX_BYTES)('%s.md (curation %s) fits its ceiling', (agent, build, ceiling) => {
    const text = bodyOf(agent, build)
    expect(Buffer.byteLength(text), 'the body is read: the guard would pass vacuously on an empty one').toBeGreaterThan(2_000)
    expect(collectSizeDefects(`${agent}.md (curation ${build})`, text, ceiling)).toEqual([])
  })

  it('probes: one byte over a ceiling is reported, and the ceiling itself passes', () => {
    const [agent, build, ceiling] = AGENT_MAX_BYTES[0]
    const label = `${agent}.md (curation ${build})`
    const text = bodyOf(agent, build)
    const over = `${text}${'x'.repeat(ceiling - Buffer.byteLength(text) + 1)}`
    expect(Buffer.byteLength(over)).toBe(ceiling + 1)
    expect(collectSizeDefects(label, over, ceiling)).toEqual([`${label} is ${ceiling + 1} bytes, ceiling ${ceiling}`])
    expect(collectSizeDefects(label, over.slice(0, -1), ceiling)).toEqual([])
  })
})
