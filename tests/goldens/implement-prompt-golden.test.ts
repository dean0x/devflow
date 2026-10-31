/**
 * Golden fixture guard: the compiled /implement prompt, one golden per variant key.
 *
 * The prompt compiles to four files: curation on or off, compliance on or off. Each compiled
 * file is held byte for byte, so every change to the compiled wording shows in the diff of
 * its golden. A wording-only pin that a cut breaks moves into this golden.
 *
 * A golden mismatch means the source changed without the fixture, never the reverse.
 * The fixture is regenerated only by a change that moves the compiled prompt's bytes,
 * and it moves in the same commit as the prompt change that causes it, so that commit's
 * diff shows the source change and its compiled effect together, reviewed as a text diff.
 * Never call test:golden:update in CI: a golden CI regenerates asserts nothing.
 *
 * Update ritual: npm run test:golden:update -- implement-prompt
 *   (writes all four files from the built dist/; run `npm run build:mds` first)
 */

import { describe, it, expect } from 'vitest'
import { loadGolden, requireDistFile, resolveVariantOffSource } from '../helpers.js'

const UPDATE_COMMAND = 'npm run test:golden:update -- implement-prompt'

/** The variant keys, each with its golden file and the compiled prompt it holds. */
const VARIANTS: readonly { readonly key: string; readonly golden: string; readonly compiled: () => string }[] = [
  { key: 'on', golden: 'implement.md', compiled: () => requireDistFile('implement.md') },
  { key: 'curation-off', golden: 'implement-curation-off.md', compiled: () => offPrompt('curation-off') },
  { key: 'compliance-off', golden: 'implement-compliance-off.md', compiled: () => offPrompt('compliance-off') },
  {
    key: 'both-off',
    golden: 'implement-curation-compliance-off.md',
    compiled: () => offPrompt('both-off'),
  },
]

function offPrompt(key: 'curation-off' | 'compliance-off' | 'both-off'): string {
  const text = resolveVariantOffSource(key, 'commands', 'implement')
  if (text === null) throw new Error(`the ${key} implement prompt is absent: run \`npm run build:mds\``)
  return text
}

describe('golden: compiled implement prompt', () => {
  for (const { key, golden, compiled } of VARIANTS) {
    it(`the ${key} implement prompt is byte-equal to ${golden}`, () => {
      expect(
        compiled(),
        `The ${key} implement prompt does not match ${golden}. A mismatch means the source changed ` +
        `without the fixture. If the change is intentional: ${UPDATE_COMMAND}`,
      ).toBe(loadGolden(golden))
    })

    it(`${golden} is non-empty (sanity check: loadGolden never self-heals)`, () => {
      expect(loadGolden(golden).length, `${golden} golden fixture is empty`).toBeGreaterThan(0)
    })
  }

  it('the four goldens are four different files, so none pins another', () => {
    const texts = VARIANTS.map(({ golden }) => loadGolden(golden))
    expect(new Set(texts).size).toBe(VARIANTS.length)
  })
})
