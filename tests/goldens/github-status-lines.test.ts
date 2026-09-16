/**
 * Golden fixture guard: tests/fixtures/golden/github-status-lines.txt (AC-0.2, AC-0.9).
 *
 * Measurements pinned to the current git-agent.md golden:
 *
 *   tests/fixtures/golden/git-agent.md          55,664 ch / 913 L   (== dist/agents/git.md)
 *   src/assets/skills/git/SKILL.md               6,581 ch / 213 L
 *   src/assets/skills/worktree-support/SKILL.md  2,942 ch / 92 L
 *   Total (all three)                           65,187 ch / 1,218 L
 *
 * The post-Phase-0 figures the budget is derived FROM — git.md 65,677 ch / 992 L,
 * SKILL.md 9,205 ch / 283 L, total 77,824 ch / 1,367 L — are the pre-split
 * preloaded set. They live on as BUDGET_LOADED_SET in tests/tracker/byte-budget.test.ts,
 * which is a target the artifact must reach and therefore never follows it down.
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
 * github-status-lines.txt is frozen from this commit, and the --unfreeze refusal
 * guard below protects that fixture only. Overriding the freeze takes an explicit,
 * dated user authorisation naming the exact bytes it permits, and each such
 * authorisation is spent by the single commit that uses it. The most recent one
 * (2026-09-15) permitted one re-capture whose only change was the two
 * `**Mechanics:**` pointer lines the resolve wave rewrote, at fixture lines 134
 * and 161. Any further change to this fixture — in Phase 3 or after — requires a
 * new explicit authorisation; none is outstanding.
 * git-agent.md carries no such freeze: any change that moves the compiled agent's
 * bytes regenerates it in its own fixture-only commit via
 * `npm run test:golden:update -- git-agent`, which re-sets GIT_MD_CHARS and
 * GIT_MD_LINES in the same commit.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync, type SpawnSyncReturns } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { loadGolden, extractStatusLines } from '../helpers.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const GOLDEN_PATH = path.join(ROOT, 'tests', 'fixtures', 'golden', 'github-status-lines.txt')
const SKILL_GIT_PATH = path.join(ROOT, 'src', 'assets', 'skills', 'git', 'SKILL.md')
const SKILL_WORKTREE_PATH = path.join(ROOT, 'src', 'assets', 'skills', 'worktree-support', 'SKILL.md')

/**
 * The repo's own tsx, never `npx tsx`.
 *
 * `npx` re-resolves the binary on every spawn and, on a cold cache, fetches it
 * from the registry — a network round-trip inside a 10-30s subprocess timeout.
 * That makes reachability of the npm registry an unstated precondition of four
 * guards whose subject is a local script. Same spelling as tests/helpers.ts and
 * tests/build-mds.test.ts.
 */
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')

/** Newline count — the unit every `*_LINES` / `*_NEWLINES` baseline here is measured in. */
const newlineCount = (source: string): number => (source.match(/\n/g) ?? []).length

/**
 * Runs `update-golden.ts github-status-lines --unfreeze` against a scratch
 * `--out-dir`, hands the directory and the subprocess result to `fn`, and
 * removes the directory afterward regardless of outcome.
 *
 * Shared by both --out-dir tests below so the mkdtemp/spawn/cleanup shape is
 * defined once — a scratch dir the harness creates is a scratch dir the
 * harness also always removes.
 */
function runUnfreezeToScratchDir<T>(
  fn: (tmpDir: string, result: SpawnSyncReturns<string>) => T,
): T {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'devflow-golden-'))
  try {
    const result = spawnSync(
      TSX_BIN,
      ['scripts/update-golden.ts', 'github-status-lines', '--unfreeze', '--out-dir', tmpDir],
      { cwd: ROOT, encoding: 'utf-8', timeout: 30_000, env: { ...process.env } },
    )
    if (result.error) throw result.error
    return fn(tmpDir, result)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// Pre-Phase-0 baseline at main@e726874 — informational, measured units.
export const PRE_PHASE0_GIT_MD_BYTES = 59_376  // wc -c bytes
export const PRE_PHASE0_GIT_MD_CHARS = 58_903  // JS .length (UTF-16 code units)
export const PRE_PHASE0_GIT_MD_LINES = 938

// Phase-0 char baselines (JS `.length`, not bytes) — named constants so Phase-2's
// byte-budget.test.ts can import them without re-deriving (C6). These are equality
// baselines: they move only in the same commit as the golden fixture.
export const GIT_MD_CHARS = 58_776
export const GIT_MD_LINES = 918
// SKILL_GIT_CHARS/SKILL_GIT_LINES pin src/assets/skills/git/SKILL.md, the
// preloaded skill file the git-agent golden above cross-references. Like
// GIT_MD_CHARS/GIT_MD_LINES, this is an equality baseline: it moves only in
// the same commit that edits SKILL.md's bytes — never afterwards, and never
// to make a red test green on its own.
export const SKILL_GIT_CHARS = 6_581
export const SKILL_GIT_LINES = 213
export const SKILL_WORKTREE_CHARS = 2_942
export const SKILL_WORKTREE_LINES = 92
/**
 * The preloaded set's total size across the three files above — pinned literals,
 * not a sum of the constants.
 *
 * `TOTAL_CHARS = GIT_MD_CHARS + …` asserted against `GIT_MD_CHARS + …` restates
 * its own definition: it holds for every state of the tree, including one where
 * all three parts drifted, so it pinned nothing (PF-018). The guard below MEASURES
 * the three files and compares the measurement to these literals, which makes them
 * equality baselines like every other constant in this file — re-set in the same
 * golden-regeneration commit that moves the parts, never on their own to clear a
 * red assertion.
 */
export const TOTAL_CHARS = 68_299
export const TOTAL_LINES = 1_223

// Fixture invariants — these ARE bytes (Buffer.byteLength), not JS .length
export const FIXTURE_BYTES = 17_527
export const FIXTURE_NEWLINES = 249

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
    expect(
      newlineCount(golden),
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
      newlineCount(golden),
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

  it(`the three preloaded files measure ${TOTAL_CHARS} chars / ${TOTAL_LINES} lines`, () => {
    const gitMd = loadGolden('git-agent.md')
    const skillGit = readFileSync(SKILL_GIT_PATH, 'utf-8')
    const skillWorktree = readFileSync(SKILL_WORKTREE_PATH, 'utf-8')

    expect(
      gitMd.length + skillGit.length + skillWorktree.length,
      `Preloaded-set char total changed — re-measure the three files and move TOTAL_CHARS ` +
      `in the same commit as the change that moved them.`,
    ).toBe(TOTAL_CHARS)

    expect(
      newlineCount(gitMd) + newlineCount(skillGit) + newlineCount(skillWorktree),
      `Preloaded-set line total changed — re-measure the three files and move TOTAL_LINES ` +
      `in the same commit as the change that moved them.`,
    ).toBe(TOTAL_LINES)
  })
})

describe('skill live-file baselines (Phase-0)', () => {
  it(`skills/git/SKILL.md has ${SKILL_GIT_LINES} lines`, () => {
    const content = readFileSync(SKILL_GIT_PATH, 'utf-8')
    expect(
      newlineCount(content),
      `skills/git/SKILL.md line count changed from baseline (${SKILL_GIT_LINES}) — update SKILL_GIT_LINES`,
    ).toBe(SKILL_GIT_LINES)
  })

  it(`skills/git/SKILL.md has ${SKILL_GIT_CHARS} chars`, () => {
    const content = readFileSync(SKILL_GIT_PATH, 'utf-8')
    expect(
      content.length,
      `skills/git/SKILL.md char count changed from baseline (${SKILL_GIT_CHARS}) — update SKILL_GIT_CHARS`,
    ).toBe(SKILL_GIT_CHARS)
  })

  it(`skills/worktree-support/SKILL.md has ${SKILL_WORKTREE_LINES} lines`, () => {
    const content = readFileSync(SKILL_WORKTREE_PATH, 'utf-8')
    expect(
      newlineCount(content),
      `skills/worktree-support/SKILL.md line count changed from baseline (${SKILL_WORKTREE_LINES}) — update SKILL_WORKTREE_LINES`,
    ).toBe(SKILL_WORKTREE_LINES)
  })

  it(`skills/worktree-support/SKILL.md has ${SKILL_WORKTREE_CHARS} chars`, () => {
    const content = readFileSync(SKILL_WORKTREE_PATH, 'utf-8')
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
      TSX_BIN,
      ['scripts/update-golden.ts', 'github-status-lines'],
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
    runUnfreezeToScratchDir((tmpDir, result) => {
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
    })
  })

  it('leaves the live fixture untouched when --out-dir is given (no self-regeneration)', () => {
    const before = loadGolden('github-status-lines.txt')
    const beforeMtime = statSync(GOLDEN_PATH).mtimeMs

    runUnfreezeToScratchDir((_tmpDir, result) => {
      expect(result.status).toBe(0)
    })

    expect(loadGolden('github-status-lines.txt'), 'frozen fixture content changed').toBe(before)
    expect(
      statSync(GOLDEN_PATH).mtimeMs,
      'frozen fixture was rewritten — the update script must not touch tests/fixtures/golden/ ' +
      'when --out-dir redirects the write',
    ).toBe(beforeMtime)
  })

  it('exits non-zero with usage when no target is given (subprocess guard)', () => {
    const result = spawnSync(
      TSX_BIN,
      ['scripts/update-golden.ts'],
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
