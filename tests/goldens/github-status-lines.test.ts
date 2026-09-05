/**
 * Golden fixture guard: tests/fixtures/golden/github-status-lines.txt (AC-0.2, AC-0.9).
 *
 * Phase-0 byte baselines (named constants, derived from the post-A1 corpus):
 *
 *   git.md              59,376 ch / 938 L   (pre-A1: 57,743 / 911)
 *   skills/git/SKILL.md  9,236 ch / 283 L
 *   skills/worktree-support/SKILL.md  2,950 ch / 92 L
 *   Total (all three)   71,562 ch / 1,313 L
 *
 * (§C.4's 71,090 / 58,904 are wrong by 472 ch; Phase-2 constants derive
 *  from the verified numbers above — drift D19.)
 *
 * The fixture is frozen at Phase 0 and is never regenerated through Phase 3
 * (AC-0.9 / AC-1.11 / AC-2.1 / AC-3.1). A mismatch means the source is
 * wrong, never the fixture (H2). CI must never call test:golden:update.
 *
 * Update ritual (sanctioned once at Phase 2):
 *   npm run test:golden:update -- github-status-lines --unfreeze
 *   (the frozen-target guard below asserts refusal without --unfreeze)
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { loadGolden, extractStatusLines } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

// Phase-0 byte baselines — named constants so Phase-2's byte-budget.test.ts
// can import them without re-deriving (C6).
export const GIT_MD_CHARS = 59_376
export const GIT_MD_LINES = 938
export const SKILL_GIT_CHARS = 9_236
export const SKILL_GIT_LINES = 283
export const SKILL_WORKTREE_CHARS = 2_950
export const SKILL_WORKTREE_LINES = 92
export const TOTAL_CHARS = 71_562
export const TOTAL_LINES = 1_313

// Fixture invariants
export const FIXTURE_BYTES = 16_245
export const FIXTURE_NEWLINES = 215

describe('golden: github-status-lines frozen fixture (AC-0.9)', () => {
  it('extractStatusLines() is byte-equal to the golden fixture', () => {
    const actual = extractStatusLines()
    const golden = loadGolden('github-status-lines.txt')

    if (actual !== golden) {
      const actualLines = actual.split('\n')
      const goldenLines = golden.split('\n')
      const firstDiff = actualLines.findIndex((line, i) => line !== goldenLines[i])
      const hint =
        firstDiff === -1
          ? `(byte difference; actual ${actual.length} bytes, golden ${golden.length} bytes)`
          : [
              `First mismatch at line ${firstDiff + 1}:`,
              `<<<`,
              `actual: ${JSON.stringify(actualLines[firstDiff] ?? '')}`,
              `golden: ${JSON.stringify(goldenLines[firstDiff] ?? '')}`,
              `>>>`,
              `The fixture is frozen — a mismatch means the SOURCE is wrong (H2).`,
              `Do NOT update the fixture; fix the source file.`,
            ].join('\n')

      expect.fail(
        `github-status-lines.txt golden mismatch.\n${hint}\n\n` +
        `This fixture is frozen through Phase 3. If the source change is intentional\n` +
        `AND the phase plan explicitly permits regeneration:\n` +
        `  npm run test:golden:update -- github-status-lines --unfreeze`,
      )
    }

    expect(actual).toBe(golden)
  })

  it(`fixture is ${FIXTURE_BYTES} bytes (byte baseline, C6)`, () => {
    const golden = loadGolden('github-status-lines.txt')
    expect(
      Buffer.byteLength(golden, 'utf-8'),
      `Fixture byte count changed — this fixture is frozen through Phase 3 (AC-0.9)`,
    ).toBe(FIXTURE_BYTES)
  })

  it(`fixture has ${FIXTURE_NEWLINES} newlines (line baseline)`, () => {
    const golden = loadGolden('github-status-lines.txt')
    const count = (golden.match(/\n/g) ?? []).length
    expect(
      count,
      `Fixture newline count changed — the fixture is frozen through Phase 3 (AC-0.9)`,
    ).toBe(FIXTURE_NEWLINES)
  })
})

// ---------------------------------------------------------------------------
// Frozen-target refusal guard [DR-03]
//
// test:golden:update refuses github-status-lines without --unfreeze.
// Mirrors the spawnSync shape from build-mds.test.ts:495-531.
// Non-vacuous: the subprocess is actually invoked and its exit code is observed.
// ---------------------------------------------------------------------------

describe('test:golden:update — frozen-target refusal [DR-03]', () => {
  it('refuses github-status-lines without --unfreeze (subprocess guard)', () => {
    const result = spawnSync(
      'node',
      ['scripts/update-golden.js', 'github-status-lines'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 15_000,
      },
    )

    if (result.error) throw result.error

    expect(
      result.status,
      `Expected non-zero exit for frozen target without --unfreeze, got ${result.status}\n` +
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).not.toBe(0)

    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    // The §0.2 lifecycle rule must be printed verbatim on refusal
    expect(
      combined,
      'Refusal message must mention the frozen phase lifecycle rule',
    ).toMatch(/frozen at Phase 0|never regenerated through Phase 3/i)
  })

  it('accepts github-status-lines with --unfreeze (subprocess guard)', () => {
    // Only verifies exit 0; the written content is tested by the equality guard above.
    const result = spawnSync(
      'node',
      ['scripts/update-golden.js', 'github-status-lines', '--unfreeze'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 30_000,
        env: { ...process.env },
      },
    )

    if (result.error) throw result.error

    expect(
      result.status,
      `Expected exit 0 with --unfreeze but got ${result.status}\n` +
      `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0)
  })

  it('exits non-zero with usage when no target is given (subprocess guard)', () => {
    const result = spawnSync(
      'node',
      ['scripts/update-golden.js'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 10_000,
      },
    )

    if (result.error) throw result.error

    expect(
      result.status,
      `Expected non-zero exit when no target given, got ${result.status}`,
    ).not.toBe(0)

    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    expect(combined).toMatch(/required|Usage/i)
  })
})
