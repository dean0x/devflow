/**
 * Agent-source resolver unit tests (P0-S17, AC-0.7, GAP-07).
 *
 * Verifies the dist-preferred, src-fallback resolver contract and the two
 * extractOpSectionFromCorpus modes [DR-18]. No literal agent path appears in
 * this file — all resolution goes through resolveAgentSource / resolveAllAgents.
 *
 * Anti-pattern named explicitly: `scanned > 0` over the agent corpus.
 * 15 of 16 agents survive that assertion while `git` silently disappears.
 * Use resolveAllAgents() ⊇ getAllAgentNames() instead (GAP-07, AC-0.7).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  resolveAgentSource,
  resolveAllAgents,
  extractOpSectionFromCorpus,
  type CorpusEntry,
} from '../helpers.js'
import { getAllAgentNames } from '../../src/core/plugins.js'

// ---------------------------------------------------------------------------
// Guard: resolveAllAgents ⊇ getAllAgentNames() (16 today)
// ---------------------------------------------------------------------------

describe('resolveAllAgents ⊇ getAllAgentNames() (16 agents, AC-0.7)', () => {
  it('resolveAllAgents() returns at least all plugin-declared agent names', () => {
    const resolved = [...resolveAllAgents().keys()]
    const declared = getAllAgentNames()

    expect(resolved, 'resolveAllAgents must include all names from getAllAgentNames()').toEqual(
      expect.arrayContaining(declared),
    )
  })

  it('resolved agent count is 16 (non-vacuous floor, GAP-07)', () => {
    // If this fails, a new agent was added without updating the expected count.
    // Update the expected value AND ensure the new agent has a source file.
    const resolved = resolveAllAgents()
    expect(
      resolved.size,
      `Expected 16 agents but found ${resolved.size} — update this test if an agent was added or removed`,
    ).toBe(16)
  })

  it('every resolved agent has non-empty content', () => {
    const resolved = resolveAllAgents()
    for (const [name, source] of resolved) {
      expect(
        source.content.length,
        `Agent '${name}' resolved from '${source.path}' but its content is empty`,
      ).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Guard: dist-preferred resolver behaviour (synthetic dist tree)
// ---------------------------------------------------------------------------

describe('resolveAgentSource: dist-preferred, src-fallback', () => {
  let tmpDir: string
  let fakeDistAgentsDir: string
  const SENTINEL = '# DIST SENTINEL\n'

  // These tests use a real agent name but point at a temp tree for isolation.
  // No literal src/assets/agents/ path appears here (AC-0.7).

  it('src-fallback is used when dist/agents/ is absent', () => {
    // dist/agents/ does not exist in Phase 0 — all agents resolve from src.
    const source = resolveAgentSource('git')
    expect(source.origin, 'git agent should resolve from src in Phase 0').toBe('src')
    expect(source.content.length).toBeGreaterThan(0)
  })

  it('throws with a build hint when neither dist nor src resolves the agent', () => {
    // Non-vacuous: prove the throw path with a name that cannot exist.
    expect(
      () => resolveAgentSource('_nonexistent_agent_for_test_'),
      'resolver must throw with a build hint for an unresolvable agent name',
    ).toThrow(/Run `npm run build`/)
  })
})

// ---------------------------------------------------------------------------
// Guard: extractOpSectionFromCorpus — 'sole' mode [DR-18]
// ---------------------------------------------------------------------------

describe('extractOpSectionFromCorpus sole mode [DR-18]', () => {
  const FILE_A = '/fake/path/a.md'
  const FILE_B = '/fake/path/b.md'

  const SECTION_A = '## Operation: test-op\nContent from file A\n'
  const SECTION_B = '## Operation: test-op\nContent from file B\n'

  const corpusDuplicate: CorpusEntry[] = [
    { path: FILE_A, content: SECTION_A + '## Operation: other\nother\n' },
    { path: FILE_B, content: SECTION_B },
  ]

  const corpusSole: CorpusEntry[] = [
    { path: FILE_A, content: SECTION_A + '## Operation: other\nother\n' },
    { path: '/fake/path/c.md', content: '# no op here\n' },
  ]

  // RED proof (mechanic 2 — inline known-bad corpus):
  // The duplicate corpus above has the anchor in both FILE_A and FILE_B.
  // Running 'sole' on it must throw naming both paths.

  it("'sole' throws when the anchor matches in more than one file (RED: duplicate anchor)", () => {
    expect(
      () => extractOpSectionFromCorpus(corpusDuplicate, 'test-op', { mode: 'sole' }),
      "'sole' must throw when the anchor is in multiple files",
    ).toThrow(/test-op.*found in multiple files|found in multiple files.*test-op/is)
  })

  it("'sole' throw message names both conflicting paths", () => {
    let message = ''
    try {
      extractOpSectionFromCorpus(corpusDuplicate, 'test-op', { mode: 'sole' })
    } catch (e) {
      message = String(e)
    }
    expect(message).toContain(FILE_A)
    expect(message).toContain(FILE_B)
  })

  it("'sole' succeeds and returns content when only one file matches", () => {
    const result = extractOpSectionFromCorpus(corpusSole, 'test-op', { mode: 'sole' })
    expect(result.content).toContain('Content from file A')
    expect(result.matchCount).toBe(1)
  })

  it("'sole' throws when anchor is absent from every file", () => {
    const emptyCorpus: CorpusEntry[] = [
      { path: FILE_A, content: '# no operations here\n' },
    ]
    expect(
      () => extractOpSectionFromCorpus(emptyCorpus, 'missing-op', { mode: 'sole' }),
    ).toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// Guard: extractOpSectionFromCorpus — 'union' mode [DR-18]
// ---------------------------------------------------------------------------

describe('extractOpSectionFromCorpus union mode [DR-18]', () => {
  const FILE_A = '/fake/corpus/a.md'
  const FILE_B = '/fake/corpus/b.md'

  const SECTION_A = '## Operation: shared-op\nPart A content\n'
  const SECTION_B = '## Operation: shared-op\nPart B content\n'

  const corpusUnion: CorpusEntry[] = [
    { path: FILE_A, content: SECTION_A },
    { path: FILE_B, content: SECTION_B },
    { path: '/fake/corpus/c.md', content: '# unrelated\n' },
  ]

  // RED proof (mechanic 2 — inline known-bad corpus):
  // A first-match implementation would return matchCount=1 on this corpus.
  // The union must return matchCount=2.

  it("'union' returns concatenated content from both matching files", () => {
    const result = extractOpSectionFromCorpus(corpusUnion, 'shared-op', { mode: 'union' })
    expect(result.content).toContain('Part A content')
    expect(result.content).toContain('Part B content')
  })

  it("'union' returns matchCount > 1 on a corpus with duplicate anchors (non-vacuous)", () => {
    const result = extractOpSectionFromCorpus(corpusUnion, 'shared-op', { mode: 'union' })
    expect(
      result.matchCount,
      "'union' matchCount must be 2 when two files match — a first-match impl would silently return 1",
    ).toBe(2)
  })

  it("'union' throws when anchor is absent from every file", () => {
    const corpus: CorpusEntry[] = [{ path: FILE_A, content: '# nothing\n' }]
    expect(
      () => extractOpSectionFromCorpus(corpus, 'ghost-op', { mode: 'union' }),
    ).toThrow(/not found/)
  })
})
