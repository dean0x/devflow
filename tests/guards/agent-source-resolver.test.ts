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
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  resolveAgentSource,
  resolveAllAgents,
  extractOpSectionFromCorpus,
  gitAgentSinkCorpus,
  statusLineRefReader,
  walkFiles,
  STATUS_LINE_REFERENCE_FILES,
  type CorpusEntry,
} from '../helpers.js'
import { getAllAgentNames } from '../../src/core/plugins.js'
import { MAX_REFERENCE_SWEEP_DEPTH } from '../../src/core/reference-sweep.js'

// ---------------------------------------------------------------------------
// Guard: resolveAllAgents ⊇ getAllAgentNames() (17 today)
// ---------------------------------------------------------------------------

describe('resolveAllAgents ⊇ getAllAgentNames() (17 agents, AC-0.7)', () => {
  it('resolveAllAgents() returns at least all plugin-declared agent names', () => {
    const resolved = [...resolveAllAgents().keys()]
    const declared = getAllAgentNames()

    expect(resolved, 'resolveAllAgents must include all names from getAllAgentNames()').toEqual(
      expect.arrayContaining(declared),
    )
  })

  it('resolved agent count is 17 (non-vacuous floor, GAP-07)', () => {
    // If this fails, a new agent was added without updating the expected count.
    // Update the expected value AND ensure the new agent has a source file.
    const resolved = resolveAllAgents()
    expect(
      resolved.size,
      `Expected 17 agents but found ${resolved.size} — update this test if an agent was added or removed`,
    ).toBe(17)
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
      writeFileSync(
        path.join(srcAgentsDir, `${name}.md`),
        resolveAgentSource(name).content,
        'utf8',
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

  it('resolveAllAgents(tmpRoot) covers all 17 registry names', () => {
    const resolved = resolveAllAgents(tmpRoot)
    const declared = getAllAgentNames()
    expect([...resolved.keys()]).toEqual(expect.arrayContaining(declared))
    // Use declared.length (not literal 17) so this site does not duplicate the
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
// Guard: extractOpSectionFromCorpus — the section boundary is fence-aware (PF-063)
// ---------------------------------------------------------------------------
//
// A column-0 `## ` line inside a fenced code block is payload, not structure:
// in the shipped tree it is the body of a GitHub issue composed by a heredoc.
// Reading it as a heading ends the section mid-fence and hands every union-mode
// guard an empty tail while the bytes stay on disk, containment-green.
//
// Four synthetic corpora, one per rule of the fence grammar. The unfenced arm is
// the control: it proves the boundary still fires where it must, so a fence rule
// that swallowed every heading could not pass this block.

describe('extractOpSectionFromCorpus: `## ` boundaries are fence-aware (PF-063)', () => {
  const FILE = '/fake/refs/probe-op.md'

  function section(content: string): string {
    return extractOpSectionFromCorpus([{ path: FILE, content }], 'probe-op', { mode: 'sole' }).content
  }

  it('a `## ` line inside a backtick fence does not terminate the section', () => {
    const content =
      '## Operation: probe-op\n\n' +
      '```bash\n' +
      "printf '%s\\n' \"## Items\"\n" +
      'gh issue close "$old_issue"\n' +
      '```\n\n' +
      'TAIL_MARKER\n'
    const sec = section(content)
    expect(sec, 'the fenced heading must not cut the section').toContain('gh issue close')
    expect(sec, 'content after the closing fence must be returned').toContain('TAIL_MARKER')
  })

  it('a `## ` line outside any fence still terminates the section (control)', () => {
    const content =
      '## Operation: probe-op\n\nBODY_MARKER\n\n## Another Section\n\nAFTER_MARKER\n'
    const sec = section(content)
    expect(sec, 'the section must keep its own body').toContain('BODY_MARKER')
    expect(
      sec,
      'an unfenced `## ` must still end the section — otherwise the boundary rule is gone, not fixed',
    ).not.toContain('AFTER_MARKER')
  })

  it('a `~~~` fence behaves like a backtick fence, and a backtick run cannot close it', () => {
    const content =
      '## Operation: probe-op\n\n' +
      '~~~markdown\n' +
      '## Initial Request\n' +
      '```\n' +                     // a backtick run must not close a tilde fence
      '## Product Requirements\n' +
      '~~~\n\n' +
      'TAIL_MARKER\n'
    const sec = section(content)
    expect(sec, 'the tilde-fenced headings must not cut the section').toContain('## Product Requirements')
    expect(sec, 'content after the tilde fence closes must be returned').toContain('TAIL_MARKER')
  })

  it('an unclosed fence runs to end of text, so nothing below it terminates the section', () => {
    const content =
      '## Operation: probe-op\n\n' +
      '```bash\n' +
      '## Items\n\n' +
      '## Also Not A Heading\n' +
      'TAIL_MARKER\n'
    const sec = section(content)
    expect(sec, 'an unclosed fence must swallow every later `## `').toContain('## Also Not A Heading')
    expect(sec, 'the unclosed fence runs to end of text').toContain('TAIL_MARKER')
  })
})

// ---------------------------------------------------------------------------
// Guard: statusLineRefReader — the closed reference list refuses, both ways
// ---------------------------------------------------------------------------
//
// `STATUS_LINE_REFERENCE_FILES` is a closed list with two enforcement arms: the
// reader refuses a path the list does not declare, and `extractStatusLines`
// refuses to return while a declared path went unread. The second arm fires on
// every `npm test` through the extractor; the first fires NOWHERE in the shipped
// corpus, because every call site inside the extractor passes a declared path.
// Until this block, "the reader refuses an undeclared path" was a claim about
// code nothing executed — the shape PF-018 names.
//
// These probes live here rather than beside the fixture in tests/goldens/
// because that file is the golden ritual's fixture-only lane: it is rewritten
// wholesale when the golden is regenerated, and a behavioural probe parked there
// would be carried along by a commit that is supposed to touch fixtures only.
// The refusal is resolver-adjacent contract, which is what this file holds.

describe('statusLineRefReader: undeclared paths are refused (PF-018)', () => {
  // A REAL generated reference that the list does not declare — so the refusal
  // is proven to be about DECLARATION, not about the file being absent.
  const UNDECLARED = 'tracker/github/fetch-issue.md'

  it('RED: reading a real-but-undeclared reference throws naming the list', () => {
    const reader = statusLineRefReader()
    expect(
      () => reader.read(UNDECLARED),
      'a path outside STATUS_LINE_REFERENCE_FILES must be refused, not read',
    ).toThrow(/STATUS_LINE_REFERENCE_FILES/)
    expect(
      reader.seen.size,
      'a refused read must not be counted as sampled — the completeness arm reads this set',
    ).toBe(0)
  })

  it('GREEN control: a declared reference is read and recorded', () => {
    const declared = STATUS_LINE_REFERENCE_FILES[0]
    const reader = statusLineRefReader()
    const content = reader.read(declared)
    expect(
      content.length,
      `declared reference '${declared}' must return content — a reader that refused everything would pass the RED probe alone`,
    ).toBeGreaterThan(0)
    expect([...reader.seen], 'a completed read must be recorded for the completeness arm').toEqual([declared])
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

// ---------------------------------------------------------------------------
// Guard: walkFiles — ENOENT, the per-call maxDepth scope, and the shared bound
// ---------------------------------------------------------------------------

/**
 * Build `levels` nested directories under a fresh temp root and drop one `.md`
 * file in the deepest one. Returns the root and that deepest directory.
 *
 * Named here rather than inlined in each probe so both the at-bound and
 * past-bound cases walk trees built by the same code — a hand-built chain in one
 * probe and a loop in the other is how two cases come to disagree about what
 * "one level past the bound" means (PF-018).
 */
function makeDepthTree(levels: number): { root: string; deepest: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'devflow-walkfiles-bound-'))
  const deepest = path.join(root, ...Array.from({ length: levels }, (_, i) => `d${i + 1}`))
  mkdirSync(deepest, { recursive: true })
  writeFileSync(path.join(deepest, 'leaf.md'), '# leaf', 'utf8')
  return { root, deepest }
}

describe('walkFiles: ENOENT, maxDepth scope, and the shared depth bound', () => {
  it('returns [] for a non-existent directory', () => {
    const missing = path.join(os.tmpdir(), 'devflow-walkfiles-nonexistent-' + Date.now())
    expect(walkFiles(missing, () => true)).toEqual([])
  })

  it('does not descend into directories nested deeper than maxDepth', () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'devflow-walkfiles-depth-'))
    try {
      // Build a chain: tmpRoot/a/b/c/deep.md — depth 3 from tmpRoot.
      const deepDir = path.join(tmpRoot, 'a', 'b', 'c')
      mkdirSync(deepDir, { recursive: true })
      writeFileSync(path.join(deepDir, 'deep.md'), '# deep', 'utf8')

      // maxDepth=2 stops before entering 'c' (depths 0→a, 1→b, 2 stops before c).
      const files = walkFiles(tmpRoot, f => f.endsWith('.md'), 2)
      expect(files, 'file nested at depth 3 must not be returned when maxDepth=2').toHaveLength(0)

      // maxDepth=3 (default minus some) should reach 'c'.
      const filesDeep = walkFiles(tmpRoot, f => f.endsWith('.md'), 3)
      expect(filesDeep, 'file nested at depth 3 must be returned when maxDepth=3').toHaveLength(1)
      expect(filesDeep[0]).toMatch(/deep\.md$/)
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  // The bound is the shared one (MAX_REFERENCE_SWEEP_DEPTH), not a per-call
  // scope: a walk that stopped there and returned anyway would hand a collector
  // a corpus smaller than the tree it claims to cover, and every guard reading
  // from it would pass over ground it never saw. Both cases derive their depth
  // from the constant — a literal here would keep passing after the bound moves.

  it('RED: descending one level past MAX_REFERENCE_SWEEP_DEPTH throws, naming the directory and the bound', () => {
    const { root, deepest } = makeDepthTree(MAX_REFERENCE_SWEEP_DEPTH + 1)
    try {
      let message = ''
      try {
        walkFiles(root, f => f.endsWith('.md'))
      } catch (e) {
        message = String(e)
      }
      expect(
        message,
        'a breach of the shared bound must throw — a silent stop reports a corpus smaller than the tree',
      ).toContain('exceeds the bound')
      expect(message, 'the throw must name the directory the walk refused to enter').toContain(deepest)
      expect(message, 'the throw must name the bound it enforced').toContain(String(MAX_REFERENCE_SWEEP_DEPTH))
    } finally {
      rmSync(root, { recursive: true })
    }
  })

  it('GREEN control: a tree at exactly MAX_REFERENCE_SWEEP_DEPTH walks through', () => {
    const { root } = makeDepthTree(MAX_REFERENCE_SWEEP_DEPTH)
    try {
      const files = walkFiles(root, f => f.endsWith('.md'))
      expect(
        files,
        'the deepest permitted directory must still be walked — otherwise the bound is off by one, not enforced',
      ).toHaveLength(1)
      expect(files[0]).toMatch(/leaf\.md$/)
    } finally {
      rmSync(root, { recursive: true })
    }
  })
})
