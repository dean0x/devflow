/**
 * Generator guard: `scripts/update-golden.ts implement-prompt`.
 *
 * The target copies the four compiled /implement prompts into four golden files. Two rules
 * hold it together and nothing else pins them:
 *   - each compiled source lands under its own golden name (the both-off tree
 *     `dist/curation-compliance-off/` lands as `implement-curation-compliance-off.md`);
 *   - all four sources are read before any file is written, so one absent source leaves no
 *     partial set of goldens behind.
 *
 * Every run here passes `--out-dir`. A run without it rewrites the committed goldens in
 * tests/fixtures/golden/, and a golden a test regenerates asserts nothing.
 *
 * The script finds `dist/` from its own location, so an absent source can only be staged by
 * running a copy of the script inside a stand-in root. The stand-in holds real copies of the
 * script and of the test helpers it imports (the variant resolver in tests/helpers.ts takes
 * its root from its own location), plus links to `src/` and `node_modules/`. The real `dist/`
 * is never touched.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync, type SpawnSyncReturns } from 'child_process'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const GOLDENS_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden')

/** The repo's own tsx, never `npx tsx`: no registry round-trip inside the subprocess timeout. */
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')

/** The script under test. The stand-in root gets a copy of this file. */
const GENERATOR_SOURCE = path.join(ROOT, 'scripts', 'update-golden.ts')

/** One tsx start under full-suite load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000

/** The four compiled prompts, each with the golden the target must write for it. */
const OUTPUTS = [
  { source: 'dist/commands/implement.md', golden: 'implement.md' },
  { source: 'dist/curation-off/commands/implement.md', golden: 'implement-curation-off.md' },
  { source: 'dist/compliance-off/commands/implement.md', golden: 'implement-compliance-off.md' },
  { source: 'dist/curation-compliance-off/commands/implement.md', golden: 'implement-curation-compliance-off.md' },
] as const

/** Files the stand-in root holds as real copies, so that each takes its root from the stand-in. */
const STAND_IN_COPIES = [
  'tests/helpers.ts',
  'tests/install-snapshot-helpers.ts',
  'tests/setup/home-isolation.ts',
] as const

/** Trees the stand-in root links to the real ones; the script only reads them. */
const STAND_IN_LINKS = ['src', 'node_modules'] as const

function copyInto(from: string, root: string, rel: string): void {
  const to = path.join(root, rel)
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(from, to)
}

/** Runs `fn` with a fresh scratch directory and removes it afterward, whatever the outcome. */
function withScratchDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'devflow-update-golden-out-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Runs `fn` with a stand-in repo root that holds every compiled prompt except `omitted`
 * (null omits none), and removes it afterward, whatever the outcome.
 */
function withStandInRoot<T>(omitted: string | null, fn: (root: string, outDir: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'devflow-update-golden-root-'))
  try {
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n', 'utf-8')
    copyInto(GENERATOR_SOURCE, root, 'scripts/update-golden.ts')
    for (const rel of STAND_IN_COPIES) copyInto(path.join(ROOT, rel), root, rel)
    for (const { source } of OUTPUTS) {
      if (source !== omitted) copyInto(path.join(ROOT, source), root, source)
    }
    for (const name of STAND_IN_LINKS) symlinkSync(path.join(ROOT, name), path.join(root, name))
    return fn(root, path.join(root, 'scratch-out'))
  } finally {
    // An unlink on each link drops the link and never reaches the tree it points to.
    // unlinkSync, not rmSync: rmSync on node 24.8 refuses a link to a directory.
    for (const name of STAND_IN_LINKS) {
      const link = path.join(root, name)
      if (lstatSync(link, { throwIfNoEntry: false })) unlinkSync(link)
    }
    rmSync(root, { recursive: true, force: true })
  }
}

/** Runs the target from the script that sits in `root`. `outDir` is required: no run may default to the committed goldens. */
function runImplementPrompt(root: string, outDir: string): SpawnSyncReturns<string> {
  const result = spawnSync(
    TSX_BIN,
    [path.join(root, 'scripts', 'update-golden.ts'), 'implement-prompt', '--out-dir', outDir],
    { cwd: root, encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS, env: { ...process.env } },
  )
  if (result.error) throw result.error
  return result
}

const describeRun = (result: SpawnSyncReturns<string>): string =>
  `exit ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`

/** `outDir` holds exactly the four golden names, each byte-equal to its compiled source under `root`. */
function expectFullGoldenSet(outDir: string, root: string): void {
  expect(readdirSync(outDir).sort(), 'the target must write the four golden names and nothing else').toEqual(
    OUTPUTS.map(({ golden }) => golden).sort(),
  )
  for (const { source, golden } of OUTPUTS) {
    const compiled = readFileSync(path.join(root, source))
    expect(compiled.length, `${source} is empty, so a byte comparison against it proves nothing`).toBeGreaterThan(0)
    expect(
      readFileSync(path.join(outDir, golden)).equals(compiled),
      `${golden} must be byte-equal to ${source}`,
    ).toBe(true)
  }
}

/** Every committed golden with its bytes and its mtime, so a rewrite with the same bytes still shows. */
function snapshotCommittedGoldens(): [string, string, number][] {
  return readdirSync(GOLDENS_DIR)
    .sort()
    .map(name => {
      const file = path.join(GOLDENS_DIR, name)
      return [name, readFileSync(file, 'utf-8'), statSync(file).mtimeMs]
    })
}

describe('update-golden implement-prompt target', () => {
  it('writes each compiled prompt under its own golden name, byte for byte', () => {
    const sources = OUTPUTS.map(({ source }) => readFileSync(path.join(ROOT, source), 'utf-8'))
    expect(new Set(sources).size, 'the four compiled prompts must differ, or a swapped name would pass').toBe(
      OUTPUTS.length,
    )

    withScratchDir(outDir => {
      const result = runImplementPrompt(ROOT, outDir)
      expect(result.status, describeRun(result)).toBe(0)
      expectFullGoldenSet(outDir, ROOT)
    })
  }, SUBPROCESS_TIMEOUT_MS)

  it('leaves the committed goldens untouched when --out-dir is given', () => {
    const before = snapshotCommittedGoldens()
    expect(before.length, 'no committed golden was found, so an unchanged snapshot proves nothing').toBeGreaterThan(0)

    withScratchDir(outDir => {
      const result = runImplementPrompt(ROOT, outDir)
      expect(result.status, describeRun(result)).toBe(0)
    })

    expect(snapshotCommittedGoldens(), 'the target rewrote a file in tests/fixtures/golden/').toEqual(before)
  }, SUBPROCESS_TIMEOUT_MS)

  it('control: a stand-in root that holds all four prompts writes the full set', () => {
    withStandInRoot(null, (root, outDir) => {
      const result = runImplementPrompt(root, outDir)
      expect(result.status, describeRun(result)).toBe(0)
      expectFullGoldenSet(outDir, root)
    })
  }, SUBPROCESS_TIMEOUT_MS)

  it.each(OUTPUTS)(
    'with $source absent, exits 1, names the source and writes no file',
    ({ source }) => {
      withStandInRoot(source, (root, outDir) => {
        const result = runImplementPrompt(root, outDir)
        expect(result.status, describeRun(result)).toBe(1)
        expect(result.stderr, describeRun(result)).toContain(`${source} is absent`)
        expect(
          existsSync(outDir) ? readdirSync(outDir) : [],
          'all four sources are read before any write, so one absent source leaves no golden behind',
        ).toEqual([])
      })
    },
    SUBPROCESS_TIMEOUT_MS,
  )
})
