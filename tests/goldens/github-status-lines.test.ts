/**
 * Golden fixture guard: tests/fixtures/golden/github-status-lines.txt (AC-0.2, AC-0.9).
 *
 * Phase-0 byte baselines (named constants, post-M3 corpus updated after
 * D4 degradation additions to fetch-issue + fetch-issues-batch — MIS-2/MIS-4 fix):
 *
 *   git.md              61,018 ch / 963 L
 *   skills/git/SKILL.md  9,204 ch / 283 L
 *   skills/worktree-support/SKILL.md  2,942 ch / 92 L
 *   Total (all three)   73,164 ch / 1,338 L
 *
 * Pre-Phase-0 baseline at main@e726874 (wc -c / wc -l):
 *   PRE_PHASE0_GIT_MD_CHARS = 59,376 B / PRE_PHASE0_GIT_MD_LINES = 938 L
 * §C.4's plan-time git.md estimate of 58,904 was short by 472
 * (PRE_PHASE0_GIT_MD_CHARS − 58,904 = 59,376 − 58,904 = 472); Phase-2
 * constants derive from the verified post-Phase-0 numbers above — drift D19.
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
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { loadGolden, extractStatusLines, resolveAgentSource } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const GOLDEN_PATH = path.join(ROOT, 'tests', 'fixtures', 'golden', 'github-status-lines.txt')

// Pre-Phase-0 baseline at main@e726874 — informational, wc-c / wc-l units.
// Arithmetic check: PRE_PHASE0_GIT_MD_CHARS − 58_904 (§C.4 estimate) = 472
export const PRE_PHASE0_GIT_MD_CHARS = 59_376
export const PRE_PHASE0_GIT_MD_LINES = 938

// Phase-0 byte baselines — named constants so Phase-2's byte-budget.test.ts
// can import them without re-deriving (C6). Updated after MIS-2/MIS-4 fix
// (D4 degradation clauses added to fetch-issue + fetch-issues-batch).
export const GIT_MD_CHARS = 61_018
export const GIT_MD_LINES = 963
export const SKILL_GIT_CHARS = 9_204
export const SKILL_GIT_LINES = 283
export const SKILL_WORKTREE_CHARS = 2_942
export const SKILL_WORKTREE_LINES = 92
export const TOTAL_CHARS = 73_164
export const TOTAL_LINES = 1_338

// Fixture invariants
export const FIXTURE_BYTES = 17_379
export const FIXTURE_NEWLINES = 233

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
// Live-file baselines for git.md and skills (post-M3, updated after MIS-2/MIS-4 fix)
//
// Assert the source file's dimensions match the named constants. A mismatch
// means a file changed — update the constants and re-capture the golden.
// ---------------------------------------------------------------------------

describe('git.md live-file baselines (post-M3)', () => {
  // Use resolveAgentSource (dist-preferred, src-fallback) — no literal src/assets/agents/ path
  // so Phase 1's git.md → git.mds migration needs zero edits here (AC-0.7/P0-S17).
  const gitAgent = resolveAgentSource('git')

  it(`git.md has ${GIT_MD_LINES} lines`, () => {
    const lines = gitAgent.content.split('\n').length - 1
    expect(
      lines,
      `git.md line count changed from post-M3 baseline (${GIT_MD_LINES}) — update GIT_MD_LINES and re-capture the golden`,
    ).toBe(GIT_MD_LINES)
  })

  it(`git.md has ${GIT_MD_CHARS} chars`, () => {
    expect(
      gitAgent.content.length,
      `git.md char count changed from post-M3 baseline (${GIT_MD_CHARS}) — update GIT_MD_CHARS and re-capture the golden`,
    ).toBe(GIT_MD_CHARS)
  })
})

describe('skill live-file baselines (post-M3)', () => {
  it(`skills/git/SKILL.md has ${SKILL_GIT_LINES} lines`, () => {
    const content = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'git', 'SKILL.md'), 'utf-8')
    const lines = content.split('\n').length - 1
    expect(
      lines,
      `skills/git/SKILL.md line count changed from baseline (${SKILL_GIT_LINES}) — update SKILL_GIT_LINES`,
    ).toBe(SKILL_GIT_LINES)
  })

  it(`skills/git/SKILL.md has ${SKILL_GIT_CHARS} chars`, () => {
    const content = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'git', 'SKILL.md'), 'utf-8')
    expect(
      content.length,
      `skills/git/SKILL.md char count changed from baseline (${SKILL_GIT_CHARS}) — update SKILL_GIT_CHARS`,
    ).toBe(SKILL_GIT_CHARS)
  })

  it(`skills/worktree-support/SKILL.md has ${SKILL_WORKTREE_LINES} lines`, () => {
    const content = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'worktree-support', 'SKILL.md'), 'utf-8')
    const lines = content.split('\n').length - 1
    expect(
      lines,
      `skills/worktree-support/SKILL.md line count changed from baseline (${SKILL_WORKTREE_LINES}) — update SKILL_WORKTREE_LINES`,
    ).toBe(SKILL_WORKTREE_LINES)
  })

  it(`skills/worktree-support/SKILL.md has ${SKILL_WORKTREE_CHARS} chars`, () => {
    const content = readFileSync(path.join(ROOT, 'src', 'assets', 'skills', 'worktree-support', 'SKILL.md'), 'utf-8')
    expect(
      content.length,
      `skills/worktree-support/SKILL.md char count changed from baseline (${SKILL_WORKTREE_CHARS}) — update SKILL_WORKTREE_CHARS`,
    ).toBe(SKILL_WORKTREE_CHARS)
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
      'npx',
      ['tsx', 'scripts/update-golden.ts', 'github-status-lines'],
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

  it('accepts github-status-lines with --unfreeze, writing to --out-dir (never the live fixture)', () => {
    // --out-dir is load-bearing, not convenience. Running this script without it
    // rewrites tests/fixtures/golden/github-status-lines.txt on every `npm test`
    // — including in CI — which silently re-freezes the fixture against whatever
    // the source says today. A drifted source would fail the equality guard once
    // and then pass forever after (§3: "a CI job that regenerates a golden is a
    // golden that asserts nothing"; H2: a mismatch means the SOURCE is wrong).
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'devflow-golden-'))
    try {
      const result = spawnSync(
        'npx',
        ['tsx', 'scripts/update-golden.ts', 'github-status-lines', '--unfreeze', '--out-dir', tmpDir],
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

      const written = readFileSync(path.join(tmpDir, 'github-status-lines.txt'), 'utf-8')

      // …and both still agree with the frozen fixture.
      expect(written, 'regenerated content differs from the frozen fixture').toBe(
        loadGolden('github-status-lines.txt'),
      )
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('leaves the live fixture untouched when --out-dir is given (no self-regeneration)', () => {
    const before = loadGolden('github-status-lines.txt')
    const beforeMtime = statSync(GOLDEN_PATH).mtimeMs

    const tmpDir = mkdtempSync(path.join(tmpdir(), 'devflow-golden-'))
    try {
      const result = spawnSync(
        'npx',
        ['tsx', 'scripts/update-golden.ts', 'github-status-lines', '--unfreeze', '--out-dir', tmpDir],
        { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 },
      )
      if (result.error) throw result.error
      expect(result.status).toBe(0)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }

    expect(loadGolden('github-status-lines.txt'), 'frozen fixture content changed').toBe(before)
    expect(
      statSync(GOLDEN_PATH).mtimeMs,
      'frozen fixture was rewritten — the update script must not touch tests/fixtures/golden/ ' +
      'when --out-dir redirects the write',
    ).toBe(beforeMtime)
  })

  it('exits non-zero with usage when no target is given (subprocess guard)', () => {
    const result = spawnSync(
      'npx',
      ['tsx', 'scripts/update-golden.ts'],
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
