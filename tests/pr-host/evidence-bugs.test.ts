/**
 * SDLC-evidence PR2 (#360), phase P1 — the PR-host evidence defects, executed
 * and structurally pinned.
 *
 * Every guard in this file has the three parts PF-064 asks of an absence-based
 * check: a NAMED collector, an assertion that the corpus it read is non-empty
 * (or exactly the size the property ranges over), and a known-bad probe that
 * drives the SAME collector over a seeded or historical text and must go red.
 * The historical texts are the `d09da34` spellings each fix replaces, quoted
 * verbatim, so the probes prove the teeth on real history rather than on seeds
 * alone.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'

import { compiledSkillRefsDir } from '../../src/core/assets.js'
import {
  collectOrderViolations,
  extractOpSectionFromCorpus,
  gitAgentSinkCorpus,
  isPrHostEntryPath,
  prHostRel,
  requireDistFile,
  resolveAgentSource,
  type CorpusEntry,
  type OrderRule,
} from '../helpers.js'

// ---------------------------------------------------------------------------
// Shared readers — every guard below reads BUILT artifacts
// ---------------------------------------------------------------------------

const GIT_AGENT = resolveAgentSource('git')

/** A generated `devflow:git` reference, by its references-root-relative path. */
function requireRef(rel: string): string {
  const file = path.join(compiledSkillRefsDir(), ...rel.split('/'))
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    throw new Error(`${rel} is absent — run \`npm run build\` first (this guard reads built artifacts)`)
  }
}

/**
 * `git.md` plus the PR-host references and nothing else — the two halves of every
 * PR-host operation (its contract in the agent, its mechanics under `pr/`).
 * Asserted to hold both halves, so a guard over it cannot pass over one alone.
 */
function prHostCorpus(): CorpusEntry[] {
  const corpus = gitAgentSinkCorpus().filter(
    entry => entry.path === GIT_AGENT.path || isPrHostEntryPath(entry.path),
  )
  if (!corpus.some(e => e.path === GIT_AGENT.path) || !corpus.some(e => isPrHostEntryPath(e.path))) {
    throw new Error('prHostCorpus: git.md or the pr/ references are missing — run `npm run build`')
  }
  return corpus
}

/** The corpus with one PR-host file's content replaced — the probes' seeding. */
function seedPrHost(corpus: CorpusEntry[], op: string, transform: (content: string) => string): CorpusEntry[] {
  let seeded = 0
  const out = corpus.map(entry => {
    if (!isPrHostEntryPath(entry.path, op)) return entry
    const content = transform(entry.content)
    if (content !== entry.content) seeded++
    return { path: entry.path, content }
  })
  if (seeded !== 1) throw new Error(`seedPrHost: the transform changed ${seeded} ${op} files, expected 1 — the probe is inert`)
  return out
}

/** Replace the single line matching `match` with `replacement`; throws when none or several match. */
function replaceLine(content: string, match: RegExp, replacement: string): string {
  const lines = content.split('\n')
  const hits = lines.flatMap((line, i) => (match.test(line) ? [i] : []))
  if (hits.length !== 1) throw new Error(`replaceLine: ${hits.length} lines match ${match}, expected 1`)
  lines[hits[0]] = replacement
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 0. The shared order collector (tests/helpers.ts)
// ---------------------------------------------------------------------------

describe('collectOrderViolations — the shared order collector', () => {
  const RULE: OrderRule = { label: 'a before b', before: 'ALPHA', after: 'BRAVO' }

  it('reports nothing for a text in which each anchor occurs once and in order', () => {
    expect(collectOrderViolations('clean.md', 'x\nALPHA\ny\nBRAVO\n', [RULE])).toEqual([])
  })

  it('known-bad probe: a swapped pair yields exactly one violation', () => {
    const found = collectOrderViolations('swapped.md', 'BRAVO\nALPHA\n', [RULE])
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('swapped.md')
    expect(found[0]).toContain(RULE.label)
  })

  it('known-bad probe: a missing anchor yields exactly one violation, not a pass', () => {
    const found = collectOrderViolations('missing.md', 'ALPHA only\n', [RULE])
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('BRAVO')
  })

  it('known-bad probe: a duplicated anchor is ambiguity, reported as exactly one violation', () => {
    // A first-match reading would pass this text — the first ALPHA precedes BRAVO —
    // while the second ALPHA, after it, is the one a reader may follow.
    const found = collectOrderViolations('duplicated.md', 'ALPHA\nBRAVO\nALPHA\n', [RULE])
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('ALPHA')
  })

  it('refuses an empty anchor rather than matching it everywhere', () => {
    const found = collectOrderViolations('empty.md', 'ALPHA\n', [{ label: 'empty', before: '', after: 'ALPHA' }])
    expect(found, found.join('\n')).toHaveLength(1)
  })

  it('checks every rule, each on its own', () => {
    const rules: OrderRule[] = [RULE, { label: 'c before d', before: 'CHARLIE', after: 'DELTA' }]
    const found = collectOrderViolations('two.md', 'ALPHA\nBRAVO\nDELTA\nCHARLIE\n', rules)
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toContain('c before d')
  })
})

// ---------------------------------------------------------------------------
// 1. Resolution dedupe keyed on the run (§3.1; applies D8, avoids PF-033)
// ---------------------------------------------------------------------------
//
// `post-resolution-summary` skipped whenever ANY viewer comment held the bare
// prefix `<!-- devflow:resolution-summary ts:`, and the ts was minted at post
// time — so the first /resolve on a PR satisfied the guard for every later cycle,
// and cycles 2+ reported "already posted" while posting nothing. A dedup key must
// carry the discriminator of the unit of work it protects (PF-033 instance 2):
// here the per-run RESOLUTION_TS /resolve mints once and passes in.

/** Each summary op's step-1 search literal must carry this run key. */
const DEDUP_RUN_KEYS: ReadonlyArray<{ readonly op: string; readonly key: string }> = [
  { op: 'post-review-summary', key: 'cycle:{CYCLE_NUMBER} ts:{REVIEW_TIMESTAMP}' },
  { op: 'post-resolution-summary', key: 'ts:{RESOLUTION_TS} -->' },
]

/** Named collector: the backticked marker literal(s) each step-1 `- Search` line looks for. */
export function collectDedupSearchLiterals(section: string): string[] {
  return section
    .split('\n')
    .filter(line => /^\s*- Search\b/.test(line))
    .flatMap(line => [...line.matchAll(/`([^`]*<!-- devflow:[^`]*)`/g)].map(m => m[1]))
}

/**
 * Named collector: summary ops whose dedup search is not keyed on the run.
 * Exactly ONE search literal per op is required — none is a vacuous pass, two is
 * a second, unkeyed search a reader may follow instead.
 */
export function collectUnkeyedDedupSearches(corpus: CorpusEntry[]): string[] {
  const out: string[] = []
  for (const { op, key } of DEDUP_RUN_KEYS) {
    const section = extractOpSectionFromCorpus(corpus, op, { mode: 'union' }).content
    const literals = collectDedupSearchLiterals(section)
    if (literals.length !== 1) out.push(`${op}: ${literals.length} step-1 marker searches, expected exactly 1`)
    for (const literal of literals) {
      if (!literal.includes(key)) out.push(`${op}: search literal "${literal}" does not carry its run key "${key}"`)
    }
  }
  return out
}

/** The `d09da34` step-1 search line — the bare prefix that matched every prior run. */
const D09DA34_RESOLUTION_SEARCH =
  '   - Search for `<!-- devflow:resolution-summary ts:` in the viewer-authored comment bodies only'

/** The `d09da34` step-5 binding — the marker's ts minted at post time. */
const D09DA34_RESOLUTION_TS_BINDING = '5. Compose body (where `{TS}` = current UTC timestamp, ISO 8601):'

/** The resolution op's placeholder binding, read out of step 5: `{TS}` = `<INPUT>`. */
function collectTsBinding(content: string): string | null {
  return content.match(/where `\{TS\}` = `([A-Z_]+)`/)?.[1] ?? null
}

/** The template marker lines of the compose step (indented, inside the FULL/STUB fences). */
function collectTemplateMarkers(content: string): string[] {
  return content.split('\n').filter(line => /^ {5}<!-- devflow:resolution-summary /.test(line))
}

/**
 * The dedup decision, executed from the built reference: does a run keyed `runTs`
 * skip, given the comment bodies already on the PR? `literal` is step 1's search,
 * `{RESOLUTION_TS}` bound to the run; a bare prefix binds nothing and matches all.
 */
function skips(literal: string, runTs: string, bodies: readonly string[]): boolean {
  const key = literal.split('{RESOLUTION_TS}').join(runTs)
  return bodies.some(body => body.includes(key))
}

/** A posted comment for run `ts`, rendered from the op's own FULL template marker. */
function postedBody(templateMarker: string, ts: string): string {
  return `${templateMarker.trim().split('{TS}').join(ts)}\n# Resolution Summary\n`
}

const RUN_A = '2026-09-24T08:00:00Z'
const RUN_B = '2026-09-25T09:30:00Z'

describe('resolution dedupe is keyed on the per-run RESOLUTION_TS (§3.1, AC-2)', () => {
  it('both summary ops search for exactly one marker literal carrying their run key', () => {
    const corpus = prHostCorpus()
    expect(collectUnkeyedDedupSearches(corpus)).toEqual([])
  })

  it('known-bad probe: the d09da34 bare-prefix search is reported for that op only', () => {
    const seeded = seedPrHost(prHostCorpus(), 'post-resolution-summary', c =>
      replaceLine(c, /^\s*- Search\b/, D09DA34_RESOLUTION_SEARCH))
    const found = collectUnkeyedDedupSearches(seeded)
    expect(found, found.join('\n')).toHaveLength(1)
    expect(found[0]).toMatch(/^post-resolution-summary: /)
  })

  it('the compose step binds the marker ts to RESOLUTION_TS, and both template markers are unchanged', () => {
    const ref = requireRef(prHostRel('post-resolution-summary'))
    expect(collectTsBinding(ref), 'step 5 must bind {TS} to the RESOLUTION_TS input').toBe('RESOLUTION_TS')
    expect(
      ref,
      'the op mints no timestamp of its own — the caller passes the run key (ADR-028: no fallback mint)',
    ).not.toMatch(/current UTC timestamp|date -u/)
    expect(collectTemplateMarkers(ref)).toEqual([
      '     <!-- devflow:resolution-summary ts:{TS} -->',
      '     <!-- devflow:resolution-summary ts:{TS} -->',
    ])
    expect(
      collectTsBinding(D09DA34_RESOLUTION_TS_BINDING),
      'probe: the d09da34 post-time binding names no input, so no caller key can reach the marker',
    ).toBeNull()
  })

  describe('the cycle-2 table, executed from the built reference', () => {
    const ref = requireRef(prHostRel('post-resolution-summary'))
    const [literal] = collectDedupSearchLiterals(ref)
    const [marker] = collectTemplateMarkers(ref)
    const priorCycle = [postedBody(marker, RUN_A)]

    it('reads a search literal and a template marker out of the shipped file', () => {
      expect(literal, 'no step-1 search literal in pr/post-resolution-summary.md').toBeDefined()
      expect(marker, 'no template marker in pr/post-resolution-summary.md').toBeDefined()
    })

    it.each([
      { name: 'first run on the PR posts', run: RUN_A, bodies: [], skip: false },
      { name: 'cycle 2 (a new run) posts', run: RUN_B, bodies: priorCycle, skip: false },
      { name: 'a retry of the same run dedupes', run: RUN_A, bodies: priorCycle, skip: true },
      { name: 'cycle 2 posts beside unrelated comments', run: RUN_B, bodies: [...priorCycle, 'LGTM'], skip: false },
    ])('$name', ({ run, bodies, skip }) => {
      expect(skips(literal, run, bodies)).toBe(skip)
    })

    it('known-bad probe: the d09da34 bare prefix SKIPS cycle 2', () => {
      const [historical] = collectDedupSearchLiterals(D09DA34_RESOLUTION_SEARCH)
      expect(historical).toBe('<!-- devflow:resolution-summary ts:')
      expect(skips(historical, RUN_B, priorCycle), 'the defect: a new run matches the prior run').toBe(true)
    })
  })

  it('/resolve mints RESOLUTION_TS once per run, before any phase, and writes it as the summary date', () => {
    const resolve = requireDistFile('resolve.md')
    const mints = resolve.split('\n').filter(line => line.includes('`date -u +%Y-%m-%dT%H:%M:%SZ`'))
    expect(mints, 'exactly one mint of the run key').toHaveLength(1)
    expect(mints[0]).toContain('RESOLUTION_TS')
    expect(
      collectOrderViolations('resolve.md', resolve, [
        { label: 'minted before Phase 1', before: mints[0], after: '### Phase 1: Parse Issues' },
      ]),
    ).toEqual([])
    expect(resolve, 'the local file and the posted marker must agree').toContain('**Date**: {RESOLUTION_TS}')
  })
})
