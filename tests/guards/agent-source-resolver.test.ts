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
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  ROOT,
  resolveAgentSource,
  resolveAllAgents,
  extractOpSectionFromCorpus,
  gitAgentSinkCorpus,
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

  it('resolved agents report origin=src when no dist/agents/ file is present (Phase 1 safe)', () => {
    // Conditional: when dist/agents/<name>.md does not exist, origin must be 'src'.
    // When it does exist (Phase 1+), origin will be 'dist' — also correct.
    const resolved = resolveAllAgents()
    for (const [name, source] of resolved) {
      if (!existsSync(path.join(ROOT, 'dist', 'agents', `${name}.md`))) {
        expect(
          source.origin,
          `Agent '${name}' must resolve from src when dist/agents/${name}.md is absent`,
        ).toBe('src')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Guard: dist-preferred resolver behaviour (hermetic temp root)
// ---------------------------------------------------------------------------

describe('resolveAgentSource: dist-preferred, src-fallback', () => {
  // Hermetic: writes only into a mkdtempSync root — never into the real dist/.
  // PF-043: copies the real agent files rather than hand-authoring fixture content.
  const SENTINEL = '# DIST SENTINEL\n'
  let tmpRoot: string

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'devflow-resolver-'))

    // Populate src/assets/agents/ with copies of all real agent files (PF-043).
    const srcAgentsDir = path.join(tmpRoot, 'src', 'assets', 'agents')
    mkdirSync(srcAgentsDir, { recursive: true })
    for (const name of getAllAgentNames()) {
      copyFileSync(
        path.join(ROOT, 'src', 'assets', 'agents', `${name}.md`),
        path.join(srcAgentsDir, `${name}.md`),
      )
    }

    // Populate dist/agents/ with only a git.md sentinel — exercises dist-preferred path.
    // 'code' deliberately has no dist copy so the src-fallback path is exercised too.
    const distAgentsDir = path.join(tmpRoot, 'dist', 'agents')
    mkdirSync(distAgentsDir, { recursive: true })
    writeFileSync(path.join(distAgentsDir, 'git.md'), SENTINEL, 'utf8')
  })

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('dist is preferred over src when dist/agents/<name>.md exists', () => {
    const source = resolveAgentSource('git', tmpRoot)
    expect(source.origin, 'git agent must resolve from dist when dist/agents/git.md is present').toBe('dist')
    expect(source.content, 'dist agent content must match the sentinel').toContain('DIST SENTINEL')
  })

  it('src-fallback is used when the agent has no dist/agents/ file', () => {
    // 'code' has no sentinel in dist — resolves from src while git resolves from dist.
    const source = resolveAgentSource('code', tmpRoot)
    expect(source.origin, 'code agent (no dist sentinel) must resolve from src').toBe('src')
    expect(source.content.length).toBeGreaterThan(0)
  })

  it('throws with a build hint when neither dist nor src resolves the agent', () => {
    // Non-vacuous: prove the throw path with a name that cannot exist.
    expect(
      () => resolveAgentSource('_nonexistent_agent_for_test_', tmpRoot),
      'resolver must throw with a build hint for an unresolvable agent name',
    ).toThrow(/Run `npm run build`/)
  })

  it('resolveAllAgents(tmpRoot) covers all 16 registry names', () => {
    const resolved = resolveAllAgents(tmpRoot)
    const declared = getAllAgentNames()
    expect([...resolved.keys()]).toEqual(expect.arrayContaining(declared))
    // Use declared.length (not literal 16) so this site does not duplicate the
    // numeric-floor-manifest pin in the real-tree suite (DR-27a, occurrences: 1).
    expect(resolved.size, 'resolveAllAgents(tmpRoot) must resolve all registry agents').toBe(declared.length)
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

// ---------------------------------------------------------------------------
// Guard: gitAgentSinkCorpus — walks references/ recursively (Phase 2 prep)
// ---------------------------------------------------------------------------
//
// Phase 2 nests compiled reference files at references/tracker/github/{op}.md.
// The corpus must include that depth — a flat readdirSync would miss it.

describe('gitAgentSinkCorpus: references/ is walked recursively (Phase 2 prep)', () => {
  let tmpRoot: string

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'devflow-corpus-recursive-'))

    // Copy the real git.md (PF-043: real shape, not hand-authored).
    // Use resolveAgentSource().path — no literal src/assets/agents/ path
    // (the literal-agent-paths guard scans this file's parent directory).
    const srcAgentsDir = path.join(tmpRoot, 'src', 'assets', 'agents')
    mkdirSync(srcAgentsDir, { recursive: true })
    copyFileSync(resolveAgentSource('git').path, path.join(srcAgentsDir, 'git.md'))

    // Build probe-op section from the first real operation section in git.md (PF-043):
    // slice the section and rename the heading to probe-op.
    const realGitContent = resolveAgentSource('git').content
    const firstOpStart = realGitContent.indexOf('\n## Operation:')
    const nextOpStart = realGitContent.indexOf('\n## Operation:', firstOpStart + 1)
    const realSection = realGitContent.slice(firstOpStart + 1, nextOpStart === -1 ? undefined : nextOpStart)
    const probeSection = realSection.replace(/^## Operation: \S+/m, '## Operation: probe-op')

    // Flat reference file (currently served by Phase 0 flat readdirSync)
    const flatRefsDir = path.join(tmpRoot, 'dist', 'skills', 'git', 'references')
    mkdirSync(flatRefsDir, { recursive: true })
    writeFileSync(path.join(flatRefsDir, 'flat.md'), probeSection, 'utf8')

    // Nested reference file (Phase 2 depth: references/tracker/github/{op}.md)
    const nestedRefsDir = path.join(flatRefsDir, 'tracker', 'github')
    mkdirSync(nestedRefsDir, { recursive: true })
    writeFileSync(path.join(nestedRefsDir, 'fetch-issue.md'), probeSection, 'utf8')
  })

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('corpus includes both the flat reference and the nested tracker/github reference', () => {
    const corpus = gitAgentSinkCorpus(tmpRoot)
    const paths = corpus.map(e => e.path)
    const nestedPath = path.join(
      tmpRoot, 'dist', 'skills', 'git', 'references', 'tracker', 'github', 'fetch-issue.md',
    )
    expect(paths, 'corpus must include the nested tracker/github/fetch-issue.md path').toContain(nestedPath)

    // mode: 'union' — both flat.md and tracker/github/fetch-issue.md contribute one
    // probe-op section each; matchCount must be 2 (a flat readdirSync returns 1)
    const result = extractOpSectionFromCorpus(corpus, 'probe-op', { mode: 'union' })
    expect(
      result.matchCount,
      "'union' matchCount must be 2 (flat.md + tracker/github/fetch-issue.md)",
    ).toBe(2)
  })

  it('corpus has exactly one entry (git.md) when dist/skills/ is absent', () => {
    const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'devflow-corpus-noskills-'))
    try {
      // Only src/assets/agents/git.md — no dist/skills/ at all
      const srcDir = path.join(emptyRoot, 'src', 'assets', 'agents')
      mkdirSync(srcDir, { recursive: true })
      copyFileSync(resolveAgentSource('git').path, path.join(srcDir, 'git.md'))

      const corpus = gitAgentSinkCorpus(emptyRoot)
      expect(corpus, 'corpus must have exactly one entry when dist/skills/ is absent').toHaveLength(1)
      expect(corpus[0].path, 'sole entry must end with git.md').toMatch(/git\.md$/)
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})
