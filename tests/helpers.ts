import { readFileSync, readdirSync, existsSync } from 'fs'
import * as path from 'path'
import { type ManifestData } from '../src/core/manifest.js'
import { getAllAgentNames } from '../src/core/plugins.js'

export const ROOT = path.resolve(import.meta.dirname, '..')

const DIST_COMMANDS_DIR = path.join(ROOT, 'dist', 'commands')

/**
 * Ensure dist/commands/ exists and return its .md files.
 * Throws — does NOT return — when absent. A guard that silently skips
 * on a missing build artifact is not a guard.
 */
export function requireDistFiles(): string[] {
  try {
    return readdirSync(DIST_COMMANDS_DIR).filter(f => f.endsWith('.md'))
  } catch {
    throw new Error(
      'dist/commands/ is absent — run `npm run build` first\n' +
      '  (this guard reads compiled command files and cannot be skipped)',
    )
  }
}

/**
 * Read a dist command file. Throws if absent (referencing the build step).
 * A missing dist file is a build error, not a skip condition.
 */
export function requireDistFile(name: string): string {
  const filePath = path.join(DIST_COMMANDS_DIR, name)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    throw new Error(
      `dist/commands/${name} is absent — run \`npm run build\` first`,
    )
  }
}

export function loadFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

// ── Agent-source resolver ────────────────────────────────────────────────────
//
// Dist-preferred, src-fallback. ENOENT-tolerant on the dist side only.
// Throws with a build hint when neither location resolves — matching the
// "throw-with-a-build-hint, never skip" contract of requireDistFile above.
//
// Anti-pattern named explicitly: `scanned > 0` over the agent corpus.
// 15 of 16 agents survive `scanned > 0` while coverage of `git` silently
// disappears (GAP-07). Use resolveAllAgents() ⊇ getAllAgentNames() instead.

export interface AgentSource {
  path: string
  content: string
  origin: 'dist' | 'src'
}

export interface CorpusEntry {
  path: string
  content: string
}

/**
 * Resolve the source for a named agent: dist/agents first, src/assets/agents
 * fallback. Throws with a build hint when neither exists.
 */
export function resolveAgentSource(name: string): AgentSource {
  const distPath = path.join(ROOT, 'dist', 'agents', `${name}.md`)
  if (existsSync(distPath)) {
    return { path: distPath, content: readFileSync(distPath, 'utf-8'), origin: 'dist' }
  }
  const srcPath = path.join(ROOT, 'src', 'assets', 'agents', `${name}.md`)
  try {
    return { path: srcPath, content: readFileSync(srcPath, 'utf-8'), origin: 'src' }
  } catch {
    throw new Error(
      `Agent '${name}' not found at dist/agents/${name}.md or src/assets/agents/${name}.md\n` +
      '  Run `npm run build` first (dist side is ENOENT-tolerant, src side is not)',
    )
  }
}

/**
 * Resolve all agents declared in DEVFLOW_PLUGINS.
 * Returns a Map keyed by agent name. Every consumer must assert:
 *   expect([...resolveAllAgents().keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))
 */
export function resolveAllAgents(): Map<string, AgentSource> {
  const result = new Map<string, AgentSource>()
  for (const name of getAllAgentNames()) {
    result.set(name, resolveAgentSource(name))
  }
  return result
}

// ── Corpus-spanning operation-section extractor ──────────────────────────────
//
// Two modes, explicit — no default. Either choice is silently wrong for one
// caller, so neither is the default [DR-18]:
//
//   'sole'  — the contract authority is a single file; throws when the anchor
//             matches in more than one corpus file, naming both paths. A first-
//             match implementation would accept a key declared only by a non-
//             authoritative provider (makes seam test permissive).
//
//   'union' — concatenates matching sections from all files; returns a match
//             count. A first-match implementation would silently under-count
//             the D11 posting-op floor without touching the literal 8 (the
//             exact evasion R2/H3 exist to prevent).

/**
 * Extract an ## Operation: section from a corpus.
 * Throws when the anchor is absent from every file in the corpus.
 * Throws when mode is 'sole' and the anchor matches in more than one file
 * (naming both paths — that is the intent; the first match is not the authority).
 */
export function extractOpSectionFromCorpus(
  corpus: CorpusEntry[],
  op: string,
  opts: { mode: 'union' | 'sole' },
): { content: string; matchCount: number } {
  const marker = `## Operation: ${op}`
  const matches: Array<{ path: string; section: string }> = []

  for (const entry of corpus) {
    const start = entry.content.indexOf(marker)
    if (start === -1) continue
    const nextSection = entry.content.indexOf('\n## ', start + marker.length)
    const section = nextSection === -1
      ? entry.content.slice(start)
      : entry.content.slice(start, nextSection)
    matches.push({ path: entry.path, section })
  }

  if (matches.length === 0) {
    throw new Error(
      `Anchor "## Operation: ${op}" not found in any of ${corpus.length} corpus file(s)`,
    )
  }

  if (opts.mode === 'sole' && matches.length > 1) {
    throw new Error(
      `'sole' mode: anchor "## Operation: ${op}" found in multiple files:\n` +
      matches.map(m => `  ${m.path}`).join('\n'),
    )
  }

  return {
    content: matches.map(m => m.section).join('\n'),
    matchCount: matches.length,
  }
}

// ── Git agent sink corpus ────────────────────────────────────────────────────
//
// git.md ∪ dist/skills/git/references/*.md (ENOENT-tolerant on the dist side).
// Used by the D11 forward/reverse/bypass guards so the floor stays ≥ 8
// when posting-op mechanics move into compiled reference files (Phase 2+).

/**
 * Build the D11 sink-class corpus: git.md (always) plus compiled skill
 * references (when present). The dist sibling is ENOENT-tolerant so that
 * Phase 0 guards pass before dist/skills/ is built.
 */
export function gitAgentSinkCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = []

  // Primary: git.md (via dist-preferred resolver)
  const git = resolveAgentSource('git')
  corpus.push({ path: git.path, content: git.content })

  // Secondary: compiled skill references (ENOENT-tolerant)
  const refsDir = path.join(ROOT, 'dist', 'skills', 'git', 'references')
  if (existsSync(refsDir)) {
    try {
      const files = readdirSync(refsDir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const filePath = path.join(refsDir, file)
        corpus.push({ path: filePath, content: readFileSync(filePath, 'utf-8') })
      }
    } catch {
      // ENOENT-tolerant: dist references are absent in Phase 0
    }
  }

  return corpus
}

// ── Fence parsing helpers ─────────────────────────────────────────────────────
//
// These mirror registry-integrity.test.ts:449-456 verbatim (the repo's
// canonical fence-parsing precedent).

/**
 * Extract all triple-backtick code fences from content, including their
 * opening and closing fence markers.
 */
export function parseFences(content: string): string[] {
  const fences: string[] = []
  const fencePattern = /```[^\n]*\n([\s\S]*?)```/g
  let match
  while ((match = fencePattern.exec(content)) !== null) {
    fences.push(match[0])
  }
  return fences
}

/**
 * True when a code fence block is a spawn block for the named agent type.
 * Matches both Agent(subagent_type="X") and agentType: "X" forms.
 */
export function isAgentBlock(block: string, type: string): boolean {
  return (
    new RegExp(`Agent\\(subagent_type="${type}"`).test(block) ||
    new RegExp(`agentType:\\s*"${type}"`).test(block)
  )
}

// ── Golden fixture loader ────────────────────────────────────────────────────
//
// Throws with a command hint when the fixture is absent — never self-heals.
// A guard that silently skips on a missing fixture is not a guard (PF-018).
// A golden mismatch means the source is wrong, never the fixture (H2).

const GOLDENS_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden')

/**
 * Load a named golden fixture. Throws with the update-command hint when the
 * file is absent. Never auto-regenerates — CI must never call the update script.
 */
export function loadGolden(name: string): string {
  const fixturePath = path.join(GOLDENS_DIR, name)
  try {
    return readFileSync(fixturePath, 'utf-8')
  } catch {
    // Derive the stem for the command hint: strip extension for the update command
    const stem = name.replace(/\.[^.]+$/, '')
    throw new Error(
      `Golden fixture '${name}' not found at tests/fixtures/golden/${name}\n` +
      `  To regenerate: npm run test:golden:update -- ${stem}`,
    )
  }
}

// ── github-status-lines extractor ────────────────────────────────────────────
//
// Pure function over the source corpus; derives the github-status-lines.txt
// fixture from the exact line ranges documented in P0-S15. Must remain in
// sync with tests/fixtures/golden/github-status-lines.txt (AC-0.9).

/**
 * Extract the status-line corpus that matches tests/fixtures/golden/github-status-lines.txt.
 *
 * Line ranges (1-indexed, inclusive) from P0-S15:
 * - src/assets/agents/git.md cross-cutting: 23-28, 33, 36, 54-57
 * - src/assets/agents/git.md op ranges: 140-149, 174-191, 238-252, 270-283,
 *   302-318, 369-374, 399-408, 429-439, 467-473, 495-506, 570-582, 613-632,
 *   682-692, 742-745, 773-775, 822-830, 865-869, 905-908
 * - src/assets/agents/git.md Guard-5 lines: 354, 730, 909
 * - src/assets/agents/code.md: 93, 95, 99
 * - src/assets/commands/dynamic-build.mds: 522, 524
 * - src/assets/commands/resolve.mds: 244, 352, 499, 508, 539, 619
 */
export function extractStatusLines(): string {
  const git = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'git.md'), 'utf-8')
  const code = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'code.md'), 'utf-8')
  const dynamicBuild = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'dynamic-build.mds'), 'utf-8')
  const resolveMds = readFileSync(path.join(ROOT, 'src', 'assets', 'commands', 'resolve.mds'), 'utf-8')

  function getLines(content: string, from: number, to: number): string {
    return content.split('\n').slice(from - 1, to).join('\n')
  }
  function getLine(content: string, n: number): string {
    return content.split('\n')[n - 1]
  }

  const parts: string[] = [
    // git.md cross-cutting
    getLines(git, 23, 28),
    getLine(git, 33),
    getLine(git, 36),
    getLines(git, 54, 57),
    // git.md op ranges
    getLines(git, 140, 149),
    getLines(git, 174, 191),
    getLines(git, 238, 252),
    getLines(git, 270, 283),
    getLines(git, 302, 318),
    getLines(git, 369, 374),
    getLines(git, 399, 408),
    getLines(git, 429, 439),
    getLines(git, 467, 473),
    getLines(git, 495, 506),
    getLines(git, 570, 582),
    getLines(git, 613, 632),
    getLines(git, 682, 692),
    getLines(git, 742, 745),
    getLines(git, 773, 775),
    getLines(git, 822, 830),
    getLines(git, 865, 869),
    getLines(git, 905, 908),
    // git.md Guard-5 marker lines
    getLine(git, 354),
    getLine(git, 730),
    getLine(git, 909),
    // code.md
    getLine(code, 93),
    getLine(code, 95),
    getLine(code, 99),
    // dynamic-build.mds
    getLine(dynamicBuild, 522),
    getLine(dynamicBuild, 524),
    // resolve.mds
    getLine(resolveMds, 244),
    getLine(resolveMds, 352),
    getLine(resolveMds, 499),
    getLine(resolveMds, 508),
    getLine(resolveMds, 539),
    getLine(resolveMds, 619),
  ]

  return parts.join('\n') + '\n'
}

/**
 * Extract a named section from markdown content.
 * Returns the content from startAnchor to endAnchor (or end of string).
 * Throws loudly if either anchor is absent.
 */
export function extractSection(content: string, startAnchor: string, endAnchor: string | null): string {
  const start = content.indexOf(startAnchor)
  if (start === -1) throw new Error(`Anchor not found: "${startAnchor}"`)
  if (endAnchor === null) return content.slice(start)
  const end = content.indexOf(endAnchor, start + startAnchor.length)
  if (end === -1) throw new Error(`End anchor not found after "${startAnchor}": "${endAnchor}"`)
  return content.slice(start, end)
}

/**
 * Canonical ManifestData factory for tests.
 *
 * Returns a minimal but structurally complete ManifestData with:
 * - flags: FlagsRecord (Phase 2: was string[])
 * - No knownFlags / viewMode fields (deprecated; healed away on readManifest)
 *
 * Use deep-spread to override individual fields:
 *   makeManifest({ features: { ...makeManifest().features, proxy: true } })
 *
 * This factory is the canonical source for ManifestData test fixtures.
 * Tests that write to disk via writeManifest should use this factory so
 * readManifest round-trips produce bit-identical results (no heal cycle).
 */
export function makeManifest(overrides: Partial<ManifestData> = {}): ManifestData {
  return {
    version: '2.0.0',
    plugins: ['devflow-implement', 'devflow-code-review'],
    scope: 'user',
    features: {
      ambient: true,
      memory: true,
      hud: true,
      knowledge: true,
      learning: true,
      rules: true,
      proxy: false,
      compliance: { enabled: false, frameworks: [] },
      flags: { tui: true, lsp: true, 'tool-search': true },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Pure function mirroring the fp_ratio formula documented in command surfaces.
 * Denominator = fp_count + fixed_count + deferred_count.
 * Returns 0 when denominator is 0 or any input is NaN/non-finite (parse failure path).
 */
export function computeFpRatio(fpCount: number, fixedCount: number, deferredCount: number): number {
  if (!Number.isFinite(fpCount) || !Number.isFinite(fixedCount) || !Number.isFinite(deferredCount)) {
    return 0
  }
  const denominator = fpCount + fixedCount + deferredCount
  if (denominator === 0) return 0
  return fpCount / denominator
}
