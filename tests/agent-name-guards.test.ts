/**
 * Agent name guard suite — Phase 1 of the agent-action-verbs refactor.
 *
 * WHY THESE GUARDS EXIST: a devflow agent has THREE independent identity strings
 * that nothing in src/ links together:
 *   Form A — slug: filename, registry entry, agent-models.json key
 *   Form B — spawn key: frontmatter `name:` on line 2 (what Claude Code resolves)
 *   Form C — prose: charter, roster, docs
 *
 * A rename that updates the file, registry, and every subagent_type literal but
 * misses the frontmatter `name:` leaves every structural guard green while every
 * spawn fails at runtime. These guards close that gap.
 *
 * All five guards are GREEN on current names (phase 1). Populated/updated in
 * subsequent phases as agents are renamed.
 *
 * GAP-1  Form A ↔ Form B — slug (filename) vs frontmatter name:
 * GAP-2  agentType: coverage — dynamic commands use only declared roster agents
 * GAP-3  Orchestrator charter — byte-size cap + no retired agent names
 * GAP-4  Model tiers (dist-gated) — roster model tiers match agent frontmatter
 * GAP-5  Retired-name sweep (dist-gated) — no retired names in any shipped artifact
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import * as path from 'path'
import { getAllAgentNames } from '../src/core/plugins.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const AGENTS_DIR = path.join(ROOT, 'src', 'assets', 'agents')
const ASSETS_DIR = path.join(ROOT, 'src', 'assets')
const DIST_COMMANDS_DIR = path.join(ROOT, 'dist', 'commands')
const CHARTER_PATH = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md')
const ROSTER_SRC = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_roster.mds')

// ---------------------------------------------------------------------------
// GAP-1 exception map — slug → expected form B name
// ---------------------------------------------------------------------------

/**
 * Maps agent slug (form A, from filename) to its non-default frontmatter name: (form B).
 *
 * Default transform: slug → capitalizeFirst(slug) → e.g. coder → Coder.
 * This default does NOT strip hyphens: capitalize('bug-analyzer') = 'Bug-analyzer'.
 * Entries here are cases where form B does NOT match that default.
 *
 * D-RI-1: The map MUST shrink to empty by phase 4 (the wave's acceptance criterion).
 * Today it has exactly ONE entry: bug-analyzer.md declares name: BugAnalyzer (hyphens
 * collapsed, PascalCase) instead of the default Bug-analyzer.
 *
 * SAFETY: Object.create(null) — no prototype keys can accidentally match a slug.
 * All lookups use Object.hasOwn().
 */
const SLUG_TO_NAME_EXCEPTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    'bug-analyzer': 'BugAnalyzer',
  }),
)

// ---------------------------------------------------------------------------
// GAP-5 — retired form B names
// ---------------------------------------------------------------------------

/**
 * Form B names (frontmatter name:) that once existed but have been renamed.
 * Ships EMPTY — populated in phase 4 when agents are renamed.
 *
 * Derive form B by READING each agent's frontmatter name:, never by Capitalize(slug).
 * (Capitalize('bug-analyzer') = 'Bug-analyzer', not 'BugAnalyzer'.)
 *
 * Each name is searched with MAXIMAL RECALL: case-insensitive, NO trailing boundary.
 * This catches Coders, Coder's, coderPath, and ANSI-embedded 31mcoder.
 * Over-match + allowlist is safe; under-match is not.
 *
 * When populated in phase 4, extend RETIRED_ALLOWLIST below if needed.
 */
const RETIRED_AGENT_FORM_B: readonly string[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize an agent name for cross-form comparison: strip hyphens, lowercase. */
const normalize = (name: string) => name.replace(/-/g, '').toLowerCase()

/** Capitalize only the first character; leave the rest unchanged. */
const capitalizeFirst = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)

/** Parse the frontmatter name: value from an agent .md file. */
function readFrontmatterName(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8')
  // name: must be the second line in the frontmatter block
  const m = content.match(/^---\n(?:.*\n)*?name:\s*(\S+)/)
  if (!m) throw new Error(`No name: field in frontmatter of ${filePath}`)
  return m[1]
}

/** Parse model: value from agent frontmatter. */
function readFrontmatterModel(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8')
  const m = content.match(/^---\n(?:.*\n)*?model:\s*(\S+)/)
  if (!m) throw new Error(`No model: field in frontmatter of ${filePath}`)
  return m[1]
}

/**
 * Ensure dist/commands/ exists and return its .md files.
 * Throws — does NOT return — when absent. A guard that silently skips
 * on a missing build artifact is not a guard.
 */
function requireDistFiles(): string[] {
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
function requireDistFile(name: string): string {
  const filePath = path.join(DIST_COMMANDS_DIR, name)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    throw new Error(
      `dist/commands/${name} is absent — run \`npm run build\` first`,
    )
  }
}

/**
 * Recursively collect files with given extensions from a directory.
 * Returns [] when the directory does not exist (non-fatal absence).
 */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = []
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts))
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(full)
    }
  }
  return results
}

/**
 * Extract agentType: values from compiled content.
 * Pattern is case-insensitive and tolerates no-space form (agentType:"X").
 */
function extractAgentTypes(content: string): Set<string> {
  const result = new Set<string>()
  const re = /agentType[=:]\s*"([^"]+)"/gi
  for (const m of content.matchAll(re)) result.add(m[1])
  return result
}

/**
 * Parse the "| AgentName | tier | … |" roster table from _roster.mds source.
 * Returns name → model tier.
 */
function parseRosterFromSource(): Map<string, string> {
  const content = readFileSync(ROSTER_SRC, 'utf-8')
  const roster = new Map<string, string>()
  for (const line of content.split('\n')) {
    const m = line.match(/^\|\s*(\w+)\s*\|\s*(haiku|sonnet|opus)\s*\|/)
    if (m) roster.set(m[1], m[2])
  }
  return roster
}

/**
 * Parse the roster table from compiled dist/commands/dynamic-build.md.
 * Throws (does NOT return) when dist is absent — FAIL-LOUD requirement.
 */
function parseRosterFromDist(): Map<string, string> {
  const content = requireDistFile('dynamic-build.md')
  const roster = new Map<string, string>()
  for (const line of content.split('\n')) {
    const m = line.match(/^\|\s*(\w+)\s*\|\s*(haiku|sonnet|opus)\s*\|/)
    if (m) roster.set(m[1], m[2])
  }
  return roster
}

// ---------------------------------------------------------------------------
// GAP-1: Form A ↔ Form B
// ---------------------------------------------------------------------------

describe('GAP-1: slug (form A) ↔ frontmatter name: (form B)', () => {
  /**
   * For agents NOT in SLUG_TO_NAME_EXCEPTIONS, the default expected name is
   * capitalizeFirst(slug) — coder → Coder, designer → Designer.
   *
   * The exception map handles the one case where form B diverges from the
   * default: bug-analyzer → BugAnalyzer (hyphens removed, PascalCase).
   * That entry exits when the agent is renamed in phase 4.
   */
  it('every agent frontmatter name: matches its slug or the exception map', () => {
    const agentFiles = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'))
    expect(agentFiles.length, 'No agent files found in src/assets/agents/').toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of agentFiles) {
      const slug = path.basename(file, '.md')
      const frontmatterName = readFrontmatterName(path.join(AGENTS_DIR, file))
      const expected = Object.hasOwn(SLUG_TO_NAME_EXCEPTIONS, slug)
        ? SLUG_TO_NAME_EXCEPTIONS[slug]
        : capitalizeFirst(slug)
      if (frontmatterName !== expected) {
        violations.push(
          `  ${file}: name: '${frontmatterName}' ≠ expected '${expected}'` +
          (slug.includes('-')
            ? ` (add to SLUG_TO_NAME_EXCEPTIONS if PascalCase was intended)`
            : ' (fix frontmatter name: or add to SLUG_TO_NAME_EXCEPTIONS)'),
        )
      }
    }
    expect(violations, `Form A↔B mismatches:\n${violations.join('\n')}`).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GAP-2: agentType: coverage
// ---------------------------------------------------------------------------

describe('GAP-2: agentType: values in dist ↔ declared roster', () => {
  /**
   * subagent_type="Explore" is a Claude Code built-in — not a devflow agent,
   * not in the roster, must not be flagged, and must never be renamed.
   */
  const BUILTINS_NORMALIZED = new Set(['explore'])

  it('agentType values in dist match the _roster.mds roster exactly (fail-loud when dist absent)', () => {
    // FAIL-LOUD: requireDistFiles() throws when dist is absent — not a skip.
    const distFiles = requireDistFiles()

    // Collect all agentType values from all compiled command files.
    // Two patterns cover the full surface:
    //   agentType: "X"   — standard JS object form
    //   agentType:"X"    — no-space form (present in _engine.mds compiled output)
    const agentTypesInDist = new Set<string>()
    for (const file of distFiles) {
      const content = readFileSync(path.join(DIST_COMMANDS_DIR, file), 'utf-8')
      for (const name of extractAgentTypes(content)) {
        if (!BUILTINS_NORMALIZED.has(normalize(name))) {
          agentTypesInDist.add(name)
        }
      }
    }

    // Parse the declared roster (form B names + model tier) from source.
    const sourceRoster = parseRosterFromSource()
    expect(sourceRoster.size, '_roster.mds table is empty — parse failure?').toBeGreaterThan(0)

    const registryNormalized = new Set(getAllAgentNames().map(normalize))

    // Check 1: roster ⊆ registry (every roster entry is a real registered agent).
    const rosterNotInRegistry: string[] = []
    for (const [name] of sourceRoster) {
      if (!registryNormalized.has(normalize(name))) {
        rosterNotInRegistry.push(name)
      }
    }
    expect(
      rosterNotInRegistry,
      `_roster.mds declares agents not in the registry (DEVFLOW_PLUGINS):\n  ${rosterNotInRegistry.join('\n  ')}\n` +
      'Either add them to src/core/plugins.ts or remove from the roster.',
    ).toHaveLength(0)

    // Check 2: set-equality between declared roster and agentType values in dist.
    const rosterNames = new Set(sourceRoster.keys())

    const inRosterNotInDist = [...rosterNames].filter(
      n => !agentTypesInDist.has(n),
    )
    expect(
      inRosterNotInDist,
      `Roster agents never used as agentType in dist/commands/ — roster or dist out of sync:\n  ${inRosterNotInDist.join('\n  ')}`,
    ).toHaveLength(0)

    const inDistNotInRoster = [...agentTypesInDist].filter(
      n => !rosterNames.has(n),
    )
    expect(
      inDistNotInRoster,
      `agentType values in dist/commands/ not in _roster.mds — update the roster or fix the command:\n  ${inDistNotInRoster.join('\n  ')}`,
    ).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GAP-3: Orchestrator charter
// ---------------------------------------------------------------------------

describe('GAP-3: orchestrator charter integrity', () => {
  /**
   * The charter cap is 4,096 characters (shell ${#CHARTER}).
   * session-start-orchestrator fails OPEN AND SILENT past that cap —
   * the charter is simply not injected, with no error (hook line ~49).
   * We require at least 25% headroom: ≤ 3,072 characters.
   */
  const CHARTER_CAP = 4096
  const HEADROOM_FRACTION = 0.25
  const MAX_CHARTER_CHARS = Math.floor(CHARTER_CAP * (1 - HEADROOM_FRACTION)) // 3072

  it('charter byte size stays below 75% of the 4096-character injection cap', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    // Use Buffer.byteLength for bytes; for this ASCII file chars == bytes.
    // Shell ${#CHARTER} counts characters; for pure ASCII they match.
    const charCount = charter.length
    expect(
      charCount,
      `Orchestrator charter is ${charCount} chars — exceeds 75% of the ${CHARTER_CAP}-char cap (max: ${MAX_CHARTER_CHARS}).\n` +
      `The hook at src/assets/scripts/hooks/session-start-orchestrator (~line 49) fails OPEN past the cap.`,
    ).toBeLessThanOrEqual(MAX_CHARTER_CHARS)
  })

  it('charter contains no retired agent names (vacuous when RETIRED_AGENT_FORM_B is empty)', () => {
    if (RETIRED_AGENT_FORM_B.length === 0) return // vacuously green in phase 1

    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    const violations: string[] = []

    for (const retiredName of RETIRED_AGENT_FORM_B) {
      // MAXIMAL RECALL: case-insensitive, no trailing boundary
      const re = new RegExp(retiredName, 'i')
      if (re.test(charter)) {
        violations.push(
          `  Charter still references retired name '${retiredName}' — update orchestrator-charter.md`,
        )
      }
    }
    expect(violations, violations.join('\n')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GAP-4: Model tiers (dist-gated)
// ---------------------------------------------------------------------------

describe('GAP-4: roster model tiers match agent frontmatter (fail-loud when dist absent)', () => {
  it('every roster entry model tier matches that agent\'s frontmatter model: field', () => {
    // FAIL-LOUD: parseRosterFromDist() throws when dist is absent — not a skip.
    const rosterFromDist = parseRosterFromDist()
    expect(rosterFromDist.size, 'dist roster table is empty — parse failure or dist is stale?').toBeGreaterThan(0)

    const violations: string[] = []
    for (const [agentName, rosterTier] of rosterFromDist) {
      // Map from form B name to agent file: normalize for lookup
      const agentSlug = getAllAgentNames().find(
        slug => normalize(slug) === normalize(agentName),
      )
      if (!agentSlug) {
        violations.push(`  Roster entry '${agentName}' has no matching agent file in src/assets/agents/`)
        continue
      }
      const agentFile = path.join(AGENTS_DIR, `${agentSlug}.md`)
      const frontmatterModel = readFrontmatterModel(agentFile)
      if (frontmatterModel !== rosterTier) {
        violations.push(
          `  ${agentSlug}.md: frontmatter model: '${frontmatterModel}' ≠ roster tier '${rosterTier}'\n` +
          `  Update either the agent frontmatter or the _roster.mds table — they must agree.`,
        )
      }
    }
    expect(violations, `Model tier mismatches:\n${violations.join('\n')}`).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GAP-5: Retired-name sweep (dist-gated)
// ---------------------------------------------------------------------------

describe('GAP-5: no retired agent names in any shipped artifact (fail-loud when dist absent)', () => {
  /**
   * Corpus: src/assets/**\/*.{md,mds} + dist/commands/**\/*.md
   * src/assets = the canonical shipping tree (skills, agents, commands, hooks, rules)
   * dist/commands = compiled command files actually deployed to users
   *
   * If dist/ is absent: requireDistFiles() throws — FAIL LOUD, not skip.
   * That's intentional: if this guard passes with an empty dist it is not a guard.
   *
   * filesScanned >= 220 ensures the corpus is not accidentally empty or
   * mis-globbed — a vacuously passing sweep on an empty corpus has burned
   * this repo before (registry-integrity Guard 5 and skill-references.test.ts:865
   * both had this failure mode; the two existing sites are fixed in this commit).
   */

  it('corpus size is at least 220 files (guards against mis-glob / empty dist)', () => {
    // Fail-loud: requireDistFiles() throws if dist is absent
    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])

    const filesScanned = assetsFiles.length + distFiles.length
    expect(
      filesScanned,
      `Corpus is only ${filesScanned} files (expected >= 220). ` +
      `Check glob patterns — an empty corpus is a silent false-pass.\n` +
      `  src/assets files: ${assetsFiles.length}  dist/commands files: ${distFiles.length}`,
    ).toBeGreaterThanOrEqual(220)
  })

  it('no retired form B names appear in any shipped artifact (vacuous when list is empty)', () => {
    if (RETIRED_AGENT_FORM_B.length === 0) return // vacuously green in phase 1

    // Fail-loud: requireDistFiles() throws if dist is absent
    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])

    const violations: string[] = []

    const scan = (files: string[], baseDir: string, prefix: string) => {
      for (const filePath of files) {
        let content: string
        try {
          content = readFileSync(filePath, 'utf-8')
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw err
        }
        for (const retiredName of RETIRED_AGENT_FORM_B) {
          // MAXIMAL RECALL: case-insensitive, NO trailing boundary.
          // Catches Coders, Coder's, coderPath, ANSI-embedded 31mcoder.
          const re = new RegExp(retiredName, 'i')
          if (re.test(content)) {
            violations.push(
              `  ${prefix}${path.relative(baseDir, filePath)}: references retired name '${retiredName}'`,
            )
          }
        }
      }
    }

    scan(assetsFiles, ASSETS_DIR, 'src/assets/')
    scan(
      distFiles.map(f => path.join(DIST_COMMANDS_DIR, f)),
      DIST_COMMANDS_DIR,
      'dist/commands/',
    )

    expect(violations, `Retired agent names found in shipped artifacts:\n${violations.join('\n')}`).toHaveLength(0)
  })
})
