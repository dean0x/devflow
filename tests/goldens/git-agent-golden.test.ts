/**
 * Golden fixture guard: the resolved Git agent (AC-0.2, P0-S23; AC-1.1, P1).
 *
 * The Git agent is resolved dist-preferred, so this guard covers the compiled
 * `dist/agents/git.md` — the artifact that ships and installs. Byte-equality
 * with the fixture is what proves the MDS conversion changed nothing: the
 * generator host escapes braces in prose, and the compiler unescapes them, so
 * a single missed or doubled escape moves bytes and this assertion fails.
 *
 * A golden mismatch means the source is wrong, never the fixture (H2).
 * The fixture is immutable through Phase 3. Never call test:golden:update in CI.
 *
 * Update ritual: npm run test:golden:update -- git-agent
 *   (writes the named fixture; github-status-lines.txt is refused through Phase 3)
 */

import { describe, it, expect } from 'vitest'
import { loadGolden, resolveAgentSource } from '../helpers.js'

/**
 * Exact byte size of the golden fixture. An EQUALITY baseline, not a floor —
 * the same treatment GIT_MD_LINES / GIT_MD_CHARS get in
 * tests/goldens/github-status-lines.test.ts, and deliberately NOT registered in
 * tests/fixtures/numeric-floors.json (a floor would let the artifact grow).
 *
 * Derived once, from `stat -f %z tests/fixtures/golden/git-agent.md` → 66180,
 * and re-derived from that same fixture below rather than measured a second
 * way (parallel re-derivation is how derived constants rot — PF-057).
 * It moves only in the same commit as the fixture itself.
 */
const GIT_AGENT_BYTES = 66_180

describe('golden: git agent source equality', () => {
  it('the resolved git agent is byte-equal to the golden fixture (AC-0.2)', () => {
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

  it('the golden fixture is exactly GIT_AGENT_BYTES bytes (AC-1.1 equality baseline)', () => {
    const golden = loadGolden('git-agent.md')
    expect(
      Buffer.byteLength(golden, 'utf-8'),
      `git-agent.md fixture size changed. This is an equality baseline, not a floor: ` +
      `move GIT_AGENT_BYTES in the SAME commit as the fixture, or the tree is red at that boundary.`,
    ).toBe(GIT_AGENT_BYTES)
  })

  it('the git agent resolves from dist/agents (AC-1.6 — the dist-preferred path is live)', () => {
    // Before Phase 1 nothing exercised resolveAgentSource's dist branch: dist/agents/
    // did not exist, so every agent came from src and the branch was dead code.
    // Asserting the origin is what proves the byte-equality above is measuring the
    // COMPILED artifact and not a leftover hand-authored source.
    expect(
      resolveAgentSource('git').origin,
      'git must resolve from dist/agents/ — run `npm run build:mds` if this reports src',
    ).toBe('dist')
  })
})
