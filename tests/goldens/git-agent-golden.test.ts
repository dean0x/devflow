/**
 * Golden fixture guard: src/assets/agents/git.md (AC-0.2, P0-S23).
 *
 * In Phase 0: asserts byte-equality with the post-A1 snapshot.
 * In Phase 1: the same assertion covers the compiled dist/agents/git.md
 *   (the resolver is dist-preferred — zero test edits needed for the rename).
 *
 * A golden mismatch means the source is wrong, never the fixture (H2).
 * The fixture is immutable through Phase 3. Never call test:golden:update in CI.
 *
 * Update ritual: npm run test:golden:update -- git-agent
 *   (writes the named fixture; github-status-lines.txt is refused through Phase 3)
 */

import { describe, it, expect } from 'vitest'
import { loadGolden, resolveAgentSource } from '../helpers.js'

describe('golden: git agent source equality', () => {
  it('src/assets/agents/git.md is byte-equal to the golden fixture (AC-0.2)', () => {
    const agent = resolveAgentSource('git')
    const golden = loadGolden('git-agent.md')
    const actual = agent.content

    if (actual !== golden) {
      // Show a diff hint using <<<... >>> boundary markers (mds-proto/drive.mjs:23-26 style)
      const actualLines = actual.split('\n')
      const goldenLines = golden.split('\n')
      const firstDiff = actualLines.findIndex((line, i) => line !== goldenLines[i])
      const hint =
        firstDiff === -1
          ? `(byte difference beyond last line; actual ${actual.length} bytes, golden ${golden.length} bytes)`
          : [
              `First mismatch at line ${firstDiff + 1}:`,
              `<<<`,
              `actual:  ${JSON.stringify(actualLines[firstDiff] ?? '')}`,
              `golden:  ${JSON.stringify(goldenLines[firstDiff] ?? '')}`,
              `>>>`,
              `To update: npm run test:golden:update -- git-agent`,
            ].join('\n')

      expect.fail(
        `git-agent.md does not match the golden fixture.\n${hint}\n\n` +
        `A mismatch means the source file changed without updating the fixture.\n` +
        `If the change is intentional: npm run test:golden:update -- git-agent`,
      )
    }

    expect(actual).toBe(golden)
  })

  it('golden fixture is non-empty (sanity check — loadGolden never self-heals)', () => {
    const golden = loadGolden('git-agent.md')
    expect(golden.length, 'git-agent.md golden fixture is empty').toBeGreaterThan(0)
  })
})
