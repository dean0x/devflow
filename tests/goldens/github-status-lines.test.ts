/**
 * Golden fixture guard: tests/fixtures/golden/github-status-lines.txt (AC-0.2, AC-0.9).
 *
 * Post-regeneration measurements (commit 7, after conventions-commit and ref-handling fixes):
 *
 *   tests/fixtures/golden/git-agent.md          65,677 ch / 992 L   (== dist/agents/git.md)
 *   src/assets/skills/git/SKILL.md               9,205 ch / 283 L
 *   src/assets/skills/worktree-support/SKILL.md  2,942 ch / 92 L
 *   Total (all three)                           77,824 ch / 1,367 L
 *
 * Pre-Phase-0 baseline at main@e726874:
 *   PRE_PHASE0_GIT_MD_BYTES = 59,376 (wc -c) / PRE_PHASE0_GIT_MD_CHARS = 58,903 (.length) / PRE_PHASE0_GIT_MD_LINES = 938 L
 * constants derive from the verified post-Phase-0 numbers above — drift D19.
 *
 * The GIT_MD_* / SKILL_* / TOTAL_* size constants in this file are EQUALITY
 * baselines pinned to the git-agent.md golden fixture, re-set in each
 * golden-regeneration commit. They are NOT floors and are NOT registered in
 * tests/fixtures/numeric-floors.json.
 *
 * github-status-lines.txt is frozen through Phase 3 and the --unfreeze refusal
 * guard below protects that fixture only. git-agent.md is what gets regenerated
 * (always a fixture-only commit via `npm run test:golden:update -- git-agent`).
 * Phase 2 re-baselines the SKILL_* constants in its T2 task.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { loadGolden, extractStatusLines } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const GOLDEN_PATH = path.join(ROOT, 'tests', 'fixtures', 'golden', 'github-status-lines.txt')

// Pre-Phase-0 baseline at main@e726874 — informational, measured units.
export const PRE_PHASE0_GIT_MD_BYTES = 59_376  // wc -c bytes
export const PRE_PHASE0_GIT_MD_CHARS = 58_903  // JS .length (UTF-16 code units)
export const PRE_PHASE0_GIT_MD_LINES = 938

// Phase-0 char baselines (JS `.length`, not bytes) — named constants so Phase-2's
// byte-budget.test.ts can import them without re-deriving (C6). Updated after
// D4 degradation clauses added to fetch-issue + fetch-issues-batch.
export const GIT_MD_CHARS = 65_677
export const GIT_MD_LINES = 992
// +1 char in Phase 1: the SKILL.md cross-reference to the Git agent moved from
// src/assets/agents/git.md (deleted) to src/assets/agents/git.mds (the generator
// host). An equality baseline moves in the SAME commit as the file it measures.
export const SKILL_GIT_CHARS = 9_205
export const SKILL_GIT_LINES = 283
export const SKILL_WORKTREE_CHARS = 2_942
export const SKILL_WORKTREE_LINES = 92
export const TOTAL_CHARS = GIT_MD_CHARS + SKILL_GIT_CHARS + SKILL_WORKTREE_CHARS
export const TOTAL_LINES = GIT_MD_LINES + SKILL_GIT_LINES + SKILL_WORKTREE_LINES

// Fixture invariants — these ARE bytes (Buffer.byteLength), not JS .length
export const FIXTURE_BYTES = 17_914
export const FIXTURE_NEWLINES = 246

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
// Golden-dimension baselines for git.md (equality, re-set in regeneration commits)
//
// Assert the golden fixture's dimensions match the named constants. A mismatch
// means the golden was regenerated — update the constants to match the new values.
// These are EQUALITY baselines pinned to the golden, not floors.
// ---------------------------------------------------------------------------

describe('git.md golden-dimension baselines', () => {
  it(`git-agent.md golden has ${GIT_MD_LINES} newlines`, () => {
    const golden = loadGolden('git-agent.md')
    expect(
      (golden.match(/\n/g) ?? []).length,
      `git-agent.md newline count changed — update GIT_MD_LINES and regenerate the golden`,
    ).toBe(GIT_MD_LINES)
  })

  it(`git-agent.md golden has ${GIT_MD_CHARS} chars`, () => {
    const golden = loadGolden('git-agent.md')
    expect(
      golden.length,
      `git-agent.md char count changed — update GIT_MD_CHARS and regenerate the golden`,
    ).toBe(GIT_MD_CHARS)
  })

  it('TOTAL_* constants are sums of their parts', () => {
    expect(TOTAL_CHARS, 'TOTAL_CHARS must equal GIT_MD_CHARS + SKILL_GIT_CHARS + SKILL_WORKTREE_CHARS').toBe(GIT_MD_CHARS + SKILL_GIT_CHARS + SKILL_WORKTREE_CHARS)
    expect(TOTAL_LINES, 'TOTAL_LINES must equal GIT_MD_LINES + SKILL_GIT_LINES + SKILL_WORKTREE_LINES').toBe(GIT_MD_LINES + SKILL_GIT_LINES + SKILL_WORKTREE_LINES)
  })
})

describe('skill live-file baselines (Phase-0)', () => {
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
