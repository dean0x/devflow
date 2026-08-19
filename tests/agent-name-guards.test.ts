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
 * GAP-2  agentType: coverage — dynamic commands use only declared roster agents,
 *        plus exact-case subagent_type closure over dist and hook scripts
 * GAP-3  Orchestrator charter — byte-size cap + no retired agent names
 * GAP-4  Model tiers (dist-gated) — roster model tiers match agent frontmatter
 * GAP-5  Retired-name sweep (dist-gated) — no retired names in any shipped
 *        artifact, with context-scoped allowlisting
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import * as path from 'path'
import { getAllAgentNames } from '../src/core/plugins.js'
import { LEGACY_AGENT_KEYS, canonicaliseAgentKeys } from '../src/core/agent-models.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const AGENTS_DIR = path.join(ROOT, 'src', 'assets', 'agents')
const ASSETS_DIR = path.join(ROOT, 'src', 'assets')
const DIST_COMMANDS_DIR = path.join(ROOT, 'dist', 'commands')
const DOCS_REFERENCE_DIR = path.join(ROOT, 'docs', 'reference')
const FEATURES_DIR = path.join(ROOT, '.devflow', 'features')
const SCRIPTS_DIR = path.join(ASSETS_DIR, 'scripts')
const CHARTER_PATH = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md')
const ROSTER_SRC = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_roster.mds')

// ---------------------------------------------------------------------------
// GAP-1 exception map — slug → expected form B name
// ---------------------------------------------------------------------------

/**
 * Maps agent slug (form A, from filename) to its non-default frontmatter name: (form B).
 *
 * Default transform: slug → capitalizeFirst(slug) → e.g. code → Code.
 * Entries here are cases where form B does NOT match that default.
 *
 * D-RI-1: The map MUST be empty by phase 4 (the wave's acceptance criterion).
 * Phase 2 emptied this map: all 13 renamed agents use capitalizeFirst(slug) as name:.
 *
 * SAFETY: Object.create(null) — no prototype keys can accidentally match a slug.
 * All lookups use Object.hasOwn().
 */
const SLUG_TO_NAME_EXCEPTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {}),
)

// ---------------------------------------------------------------------------
// GAP-5 — retired form B names
// ---------------------------------------------------------------------------

/**
 * Form B names (frontmatter name:) that once existed but have been renamed.
 * Populated in phase 4 of the agent-action-verbs rename wave.
 *
 * Derived from the actual frontmatter name: values that agents carried before
 * the rename (reading them directly, not inferring from Capitalize(slug)).
 *
 * Each name is searched with MAXIMAL RECALL: case-insensitive, NO trailing boundary.
 * This catches Coders, Coder's, coderPath, and ANSI-embedded 31mcoder.
 * Over-match + allowlist is safe; under-match is not.
 *
 * Legitimate collateral hits are covered by RETIRED_ALLOWLIST below.
 */
const RETIRED_AGENT_FORM_B: readonly string[] = [
  // 13 agents renamed noun→action-verb (phase 4 of agent-action-verbs wave)
  'Coder',        // → Code
  'Designer',     // → Design
  'Evaluator',    // → Evaluate
  'Researcher',   // → Research
  'Reviewer',     // → Review
  'Scrutinizer',  // → Scrutinize
  'Simplifier',   // → Simplify
  'Skimmer',      // → Skim
  'Synthesizer',  // → Synthesize
  'Tester',       // → Test
  'Triager',      // → Triage
  'Validator',    // → Validate
  'BugAnalyzer',  // → Diagnose
]

// ---------------------------------------------------------------------------
// GAP-5 — allowlist for legitimate collateral hits
// ---------------------------------------------------------------------------

/**
 * Entries that cover expected GAP-5 false positives.
 *
 * Every entry is CONTEXT-SCOPED: it suppresses entry.name only inside the
 * exact substrings listed in entry.contexts. The sweep strips every context
 * occurrence from the file and re-tests — a residual match is a violation,
 * so a future stray agent reference in an allowlisted file still fails.
 *
 * An entry MUST satisfy both directions:
 *   (a) Forward  — after stripping entry.contexts, no hit for entry.name remains.
 *   (b) Backward — every entry has a live name hit AND every context string
 *                  occurs verbatim in the file (stale contexts must be removed).
 *
 * Entry.path is the full display path as it appears in violation messages:
 *   "src/assets/<rel>" for assets corpus
 *   "dist/commands/<rel>" for compiled dist corpus
 *   "docs/reference/<rel>" for contributor reference docs
 *   ".devflow/features/<rel>" for git-tracked feature knowledge bases
 *   "src/assets/scripts/<rel>" for extensionless hook scripts
 *
 * Allowed categories (in priority order):
 *   URL_LINK     — entry.name appears only as a URL or link text
 *   DATA_FIELD   — entry.name appears as a data-model field name
 *   CONTRACT     — entry.name is part of a protected cross-file protocol heading
 *   CONCEPT      — entry.name describes a pattern concept, not an agent type
 *   THIRD_PARTY  — entry.name is a third-party library or tool name
 *   EXAMPLE_CODE — entry.name appears only in code-example/violation samples
 */
interface AllowlistEntry {
  path: string
  name: string
  reason: string
  /** Exact substrings that legitimately contain the retired name in this file. */
  contexts: readonly string[]
}

const RETIRED_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [
  // -----------------------------------------------------------------------
  // Coder — URL_LINK
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/skills/go/references/sources.md',
    name: 'Coder',
    reason:
      'URL_LINK: "CodeReviewComments" — link text for the Go wiki page; ' +
      'no agent spawn reference',
    contexts: ['CodeReviewComments'],
  },

  // -----------------------------------------------------------------------
  // Evaluator — CONCEPT (MDS function name + inline prompt role descriptors)
  // The actual Evaluate agent is spawned via agentType: "Evaluate".
  // evaluator_panel() is an MDS function; "Acceptance-criteria evaluator:"
  // is an inline agent-prompt label, not a Form-B spawn key.
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/commands/dynamic-build.mds',
    name: 'Evaluator',
    reason:
      'CONCEPT: evaluator_panel MDS function import/call; inline prompt role labels ' +
      '("Acceptance-criteria evaluator:", etc.) — not Form-B spawn keys; ' +
      'actual spawn uses agentType: "Evaluate"',
    contexts: ['evaluator_panel', 'Acceptance-criteria evaluator', 'Scope/intent-drift evaluator'],
  },
  {
    path: 'src/assets/commands/_partials/_engine.mds',
    name: 'Evaluator',
    reason:
      'CONCEPT: @define evaluator_panel() MDS function body; inline prompt descriptors ' +
      '— not Form-B spawn keys',
    contexts: ['evaluator_panel', 'Acceptance-criteria evaluator', 'Scope / intent-drift evaluator', 'Cross-ticket-consistency evaluator'],
  },
  {
    path: 'dist/commands/dynamic-build.md',
    name: 'Evaluator',
    reason:
      'CONCEPT: compiled output of dynamic-build.mds; evaluator_panel function + prompt labels ' +
      '— not Form-B spawn keys',
    contexts: ['evaluator_panel', 'Acceptance-criteria evaluator', 'Scope/intent-drift evaluator', 'Scope / intent-drift evaluator', 'Cross-ticket-consistency evaluator'],
  },

  // -----------------------------------------------------------------------
  // Reviewer — DATA_FIELD, CONTRACT, CONCEPT, THIRD_PARTY (generic term)
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/agents/triage.md',
    name: 'Reviewer',
    reason:
      'DATA_FIELD: reviewer_confidence — issue contract field carrying a confidence ' +
      'percentage; not an agent spawn',
    contexts: ['reviewer_confidence'],
  },
  {
    path: 'src/assets/agents/code.md',
    name: 'Reviewer',
    reason:
      'CONTRACT: "Reviewer Focus Areas" — protected PR description contract heading ' +
      '(plan.mds emits; code.md maps the PR table to it); 5 sites, 3 files',
    contexts: ['Reviewer Focus Areas'],
  },
  {
    path: 'src/assets/commands/plan.mds',
    name: 'Reviewer',
    reason:
      'CONTRACT: "Reviewer Focus Areas" heading emitted in PR Description Guidance output ' +
      '— protected cross-file contract; not an agent spawn',
    contexts: ['Reviewer Focus Areas'],
  },
  {
    path: 'src/assets/commands/resolve.mds',
    name: 'Reviewer',
    reason:
      'DATA_FIELD: reviewer_confidence — issue input data field; not an agent spawn',
    contexts: ['reviewer_confidence'],
  },
  {
    path: 'src/assets/commands/dynamic-build.mds',
    name: 'Reviewer',
    reason:
      'CONCEPT: "dead-reviewer detection" — detection concept in comment; not an agent spawn',
    contexts: ['dead-reviewer'],
  },
  {
    path: 'src/assets/commands/_partials/_engine.mds',
    name: 'Reviewer',
    reason:
      'CONCEPT: "clean reviewer" — generic prose in Review agent result contract description; ' +
      'not an agent spawn',
    contexts: ['clean reviewer'],
  },
  {
    path: 'src/assets/skills/quality-gates/SKILL.md',
    name: 'Reviewer',
    reason:
      'URL_LINK: "reviewer/" — URL path segment in Google Engineering Practices link; ' +
      'not an agent spawn',
    contexts: ['review/reviewer/'],
  },
  {
    path: 'src/assets/skills/compliance/references/sox.md',
    name: 'Reviewer',
    reason:
      '"reviewer" — generic human code-review role in SOX control description; ' +
      'not an agent spawn',
    contexts: ['lacks a PR and reviewer'],
  },
  {
    path: 'src/assets/skills/git/references/violations.md',
    name: 'Reviewer',
    reason:
      '"Reviewers" — plural generic human code-review participants in violation example; ' +
      'not an agent spawn',
    contexts: ['Reviewers can'],
  },
  {
    path: 'src/assets/skills/git/references/patterns.md',
    name: 'Reviewer',
    reason:
      'CONTRACT: "## Reviewer Focus Areas" section heading — protected PR description ' +
      'contract site in git skill reference patterns',
    contexts: ['Reviewer Focus Areas'],
  },
  {
    path: 'dist/commands/resolve.md',
    name: 'Reviewer',
    reason:
      'DATA_FIELD: compiled resolve.mds; reviewer_confidence field — not an agent spawn',
    contexts: ['reviewer_confidence'],
  },
  {
    path: 'dist/commands/dynamic-build.md',
    name: 'Reviewer',
    reason:
      'CONCEPT: compiled dynamic-build.mds; "dead-reviewer" concept + "clean reviewer" prose ' +
      '— not agent spawns',
    contexts: ['dead-reviewer', 'clean reviewer'],
  },
  {
    path: 'dist/commands/plan.md',
    name: 'Reviewer',
    reason:
      'CONTRACT: compiled plan.mds; "Reviewer Focus Areas" protected contract heading',
    contexts: ['Reviewer Focus Areas'],
  },

  // -----------------------------------------------------------------------
  // Tester — CONCEPT (temp file path pattern)
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/skills/qa/references/browser-testing.md',
    name: 'Tester',
    reason:
      'CONCEPT: "devflow-tester-" — temp file path pattern in browser test scaffolding ' +
      '(mktemp /tmp/devflow-tester-XXXXXX.log); not an agent spawn',
    contexts: ['devflow-tester-'],
  },

  // -----------------------------------------------------------------------
  // Validator — THIRD_PARTY + EXAMPLE_CODE
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/skills/boundary-validation/SKILL.md',
    name: 'Validator',
    reason:
      'THIRD_PARTY: go-playground/validator, serde+validator — third-party library names ' +
      'in skills table; not agent spawns',
    contexts: ['go-playground/validator', 'serde + validator'],
  },
  {
    path: 'src/assets/skills/boundary-validation/references/sources.md',
    name: 'Validator',
    reason:
      'THIRD_PARTY: go-playground/validator, validator Rust crate — source bibliography ' +
      'entries; not agent spawns',
    contexts: ['go-playground/validator', 'custom validators', 'validator (Rust crate)', 'docs.rs/validator'],
  },
  {
    path: 'src/assets/skills/python/references/sources.md',
    name: 'Validator',
    reason:
      'THIRD_PARTY: "field validators" — Pydantic validation terminology in source entry; ' +
      'not an agent spawn',
    contexts: ['field validators'],
  },
  {
    path: 'src/assets/skills/complexity/references/violations.md',
    name: 'Validator',
    reason:
      'EXAMPLE_CODE: UserValidator — code identifier in violation sample; not an agent spawn',
    contexts: ['UserValidator'],
  },
  {
    path: 'src/assets/skills/testing/references/violations.md',
    name: 'Validator',
    reason:
      'EXAMPLE_CODE: mockValidator — test variable in violation sample; not an agent spawn',
    contexts: ['mockValidator', 'RealValidator'],
  },
  {
    path: 'src/assets/skills/architecture/SKILL.md',
    name: 'Validator',
    reason:
      'EXAMPLE_CODE: UserValidator — class name in dependency-injection example; not an agent spawn',
    contexts: ['UserValidator'],
  },
  {
    path: 'src/assets/skills/architecture/references/patterns.md',
    name: 'Validator',
    reason:
      'EXAMPLE_CODE: UserValidator — class in DI pattern example code; not an agent spawn',
    contexts: ['UserValidator', 'private validator', 'this.validator'],
  },

  // -----------------------------------------------------------------------
  // Reviewer — DATA_FIELD (.devflow/features corpus)
  // -----------------------------------------------------------------------
  {
    path: '.devflow/features/resolve-pipeline/KNOWLEDGE.md',
    name: 'Reviewer',
    reason:
      'DATA_FIELD: reviewer_confidence — live field name in the /resolve issue ' +
      'contract (resolve.mds); not a Form-B spawn key',
    contexts: ['reviewer_confidence'],
  },

  // -----------------------------------------------------------------------
  // Evaluator — CONCEPT (.devflow/features corpus)
  // -----------------------------------------------------------------------
  {
    path: '.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md',
    name: 'Evaluator',
    reason:
      'CONCEPT: evaluator_panel — live MDS function name defined in _engine.mds; ' +
      'not a Form-B spawn key',
    contexts: ['evaluator_panel'],
  },
]

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
 * Recursively collect the extensionless shell/CJS hook scripts under
 * src/assets/scripts. Excludes .md/.mds files — those are already covered by
 * the assets corpus scan (e.g. hooks/assets/orchestrator-charter.md).
 * Returns [] when the directory does not exist.
 */
function collectScriptFiles(dir: string): string[] {
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
      results.push(...collectScriptFiles(full))
    } else if (!entry.name.endsWith('.md') && !entry.name.endsWith('.mds')) {
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
   * default: diagnose → Diagnose (capitalizeFirst, no hyphens in slug).
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

  it('SLUG_TO_NAME_EXCEPTIONS is empty — phase 4 wave acceptance criterion (D-RI-1)', () => {
    /**
     * D-RI-1: by phase 4, every renamed agent MUST use capitalizeFirst(slug)
     * as its frontmatter name:, so no slug→name exceptions are needed.
     * Phase 2 emptied this map. This assertion proves it stayed empty.
     */
    expect(
      Object.keys(SLUG_TO_NAME_EXCEPTIONS),
      'SLUG_TO_NAME_EXCEPTIONS must be empty (D-RI-1). Found:\n' +
        Object.entries(SLUG_TO_NAME_EXCEPTIONS)
          .map(([k, v]) => `  ${k} → ${v}`)
          .join('\n'),
    ).toHaveLength(0)
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

  it('subagent_type literals in dist and hook scripts exactly match a live form-B name (case-sensitive)', () => {
    /**
     * Guard 5 (registry-integrity) compares subagent_type values to registry
     * slugs case-INSENSITIVELY, and GAP-1 ties slugs to form B — but nothing
     * enforced exact case on the literal itself. subagent_type="CODE" would
     * pass both while failing at spawn time. This closes that hole: every
     * literal must byte-equal an actual frontmatter name: value (or a
     * Claude Code built-in).
     */
    const BUILTINS_EXACT = new Set(['Explore'])

    // Truth set: the real frontmatter name: values, not a derived transform.
    const formBNames = new Set(
      readdirSync(AGENTS_DIR)
        .filter(f => f.endsWith('.md'))
        .map(f => readFrontmatterName(path.join(AGENTS_DIR, f))),
    )
    expect(formBNames.size, 'No agent frontmatter names parsed').toBeGreaterThan(0)

    // Matches subagent_type="X", subagent_type: "X", and the shell-escaped
    // subagent_type=\"X\" form used inside hook heredoc strings.
    const re = /subagent_type[=:]\s*\\?"([^"\\]+)\\?"/g

    let matchCount = 0
    const violations: string[] = []
    const scanContent = (displayPath: string, content: string) => {
      for (const m of content.matchAll(re)) {
        matchCount++
        const name = m[1]
        if (BUILTINS_EXACT.has(name) || formBNames.has(name)) continue
        violations.push(
          `  ${displayPath}: subagent_type "${name}" does not byte-equal any agent frontmatter name:`,
        )
      }
    }

    for (const f of requireDistFiles()) {
      scanContent(`dist/commands/${f}`, readFileSync(path.join(DIST_COMMANDS_DIR, f), 'utf-8'))
    }
    for (const filePath of collectScriptFiles(SCRIPTS_DIR)) {
      scanContent(
        `src/assets/scripts/${path.relative(SCRIPTS_DIR, filePath)}`,
        readFileSync(filePath, 'utf-8'),
      )
    }

    // Non-vacuity: dist currently carries ~66 spawn sites + the Learning hook
    // directive. Far fewer scanned means the regex or the corpus broke.
    expect(
      matchCount,
      `Only ${matchCount} subagent_type literals scanned (expected >= 50) — regex or corpus is broken`,
    ).toBeGreaterThanOrEqual(50)

    expect(
      violations,
      `Case-exact subagent_type mismatches (spawn resolution is exact; Guard 5 normalizes):\n${violations.join('\n')}`,
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
    const sourceRosterSize = parseRosterFromSource().size
    expect(rosterFromDist.size, 'dist roster table is empty — parse failure or dist is stale?').toBeGreaterThan(0)
    expect(
      rosterFromDist.size,
      `dist roster has ${rosterFromDist.size} entries but source _roster.mds has ${sourceRosterSize} — dist is stale, run npm run build:mds`,
    ).toBe(sourceRosterSize)

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
   *         + docs/reference/**\/*.md + .devflow/features/**\/*.md
   *         + src/assets/scripts/** (extensionless hook scripts)
   * src/assets = the canonical shipping tree (skills, agents, commands, hooks, rules)
   * dist/commands = compiled command files actually deployed to users
   * docs/reference = contributor docs that teach agent names and registry shapes
   * .devflow/features = git-tracked knowledge bases injected as FEATURE_KNOWLEDGE
   * src/assets/scripts = shell/CJS hooks (spawn directives and injected prose live here)
   *
   * If dist/ is absent: requireDistFiles() throws — FAIL LOUD, not skip.
   * That's intentional: if this guard passes with an empty dist it is not a guard.
   *
   * filesScanned >= 220 ensures the corpus is not accidentally empty or
   * mis-globbed — a vacuously passing sweep on an empty corpus has burned
   * this repo before (registry-integrity Guard 5 and skill-references.test.ts:865
   * both had this failure mode; the two existing sites are fixed in this commit).
   */

  it('corpus size is at least 260 files (guards against mis-glob / empty dist)', () => {
    // Fail-loud: requireDistFiles() throws if dist is absent
    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])
    const docsFiles = collectFiles(DOCS_REFERENCE_DIR, ['.md'])
    const featureFiles = collectFiles(FEATURES_DIR, ['.md'])
    const scriptFiles = collectScriptFiles(SCRIPTS_DIR)

    // Segment floors: collectFiles returns [] for a missing directory, which
    // would silently drop a corpus segment while the 260 total still passes.
    expect(docsFiles.length, 'docs/reference corpus segment is empty — check DOCS_REFERENCE_DIR').toBeGreaterThanOrEqual(5)
    expect(featureFiles.length, '.devflow/features corpus segment is empty — check FEATURES_DIR').toBeGreaterThanOrEqual(3)
    expect(scriptFiles.length, 'src/assets/scripts corpus segment is empty — check SCRIPTS_DIR').toBeGreaterThanOrEqual(20)

    const filesScanned = assetsFiles.length + distFiles.length + docsFiles.length + featureFiles.length + scriptFiles.length
    expect(
      filesScanned,
      `Corpus is only ${filesScanned} files (expected >= 260). ` +
      `Check glob patterns — an empty corpus is a silent false-pass.\n` +
      `  src/assets files: ${assetsFiles.length}  dist/commands files: ${distFiles.length}  ` +
      `docs/reference files: ${docsFiles.length}  .devflow/features files: ${featureFiles.length}  ` +
      `src/assets/scripts files: ${scriptFiles.length}`,
    ).toBeGreaterThanOrEqual(260)
  })

  it('no retired form B names appear in any shipped artifact (vacuous when list is empty)', () => {
    if (RETIRED_AGENT_FORM_B.length === 0) return // vacuously green in phase 1

    // Fail-loud: requireDistFiles() throws if dist is absent
    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])

    // O(1) lookup from the allowlist: "displayPath\0name" → entry (context-scoped)
    const allowlistByHit = new Map(RETIRED_ALLOWLIST.map(e => [`${e.path}\0${e.name}`, e]))

    const violations: string[] = []

    const scan = (files: string[], baseDir: string, prefix: string) => {
      for (const filePath of files) {
        const displayPath = `${prefix}${path.relative(baseDir, filePath)}`
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
            const entry = allowlistByHit.get(`${displayPath}\0${retiredName}`)
            if (entry) {
              // Context-scoped: strip every allowlisted context, then re-test.
              // A residual hit is a NEW reference the entry does not cover.
              let residual = content
              for (const ctx of entry.contexts) residual = residual.split(ctx).join('')
              if (!re.test(residual)) continue
              violations.push(
                `  ${displayPath}: references retired name '${retiredName}' outside its allowlisted contexts`,
              )
              continue
            }
            violations.push(
              `  ${displayPath}: references retired name '${retiredName}'`,
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
    scan(collectFiles(DOCS_REFERENCE_DIR, ['.md']), DOCS_REFERENCE_DIR, 'docs/reference/')
    scan(collectFiles(FEATURES_DIR, ['.md']), FEATURES_DIR, '.devflow/features/')
    scan(collectScriptFiles(SCRIPTS_DIR), SCRIPTS_DIR, 'src/assets/scripts/')

    expect(violations, `Retired agent names found in shipped artifacts:\n${violations.join('\n')}`).toHaveLength(0)
  })

  it('RETIRED_ALLOWLIST is bidirectional — every entry matches at least one live corpus hit', () => {
    /**
     * Bidirectional invariant:
     *   (a) Every live hit is covered by an allowlist entry (forward — checked above).
     *   (b) Every allowlist entry covers at least one live hit (backward — this test).
     *
     * A stale allowlist entry (no hit in corpus) must be removed. Stale entries mask
     * future genuine regressions — they falsely suppress violations that no longer exist.
     */
    if (RETIRED_AGENT_FORM_B.length === 0 || RETIRED_ALLOWLIST.length === 0) return

    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])

    // Build corpus with display paths matching what the scan uses.
    const corpus: Array<{ displayPath: string; content: string }> = []
    for (const filePath of assetsFiles) {
      try {
        corpus.push({
          displayPath: `src/assets/${path.relative(ASSETS_DIR, filePath)}`,
          content: readFileSync(filePath, 'utf-8'),
        })
      } catch { /* skip unreadable files — scan handles them the same way */ }
    }
    for (const f of distFiles) {
      try {
        corpus.push({
          displayPath: `dist/commands/${f}`,
          content: readFileSync(path.join(DIST_COMMANDS_DIR, f), 'utf-8'),
        })
      } catch { /* skip */ }
    }
    for (const filePath of collectFiles(DOCS_REFERENCE_DIR, ['.md'])) {
      try {
        corpus.push({
          displayPath: `docs/reference/${path.relative(DOCS_REFERENCE_DIR, filePath)}`,
          content: readFileSync(filePath, 'utf-8'),
        })
      } catch { /* skip */ }
    }
    for (const filePath of collectFiles(FEATURES_DIR, ['.md'])) {
      try {
        corpus.push({
          displayPath: `.devflow/features/${path.relative(FEATURES_DIR, filePath)}`,
          content: readFileSync(filePath, 'utf-8'),
        })
      } catch { /* skip */ }
    }
    for (const filePath of collectScriptFiles(SCRIPTS_DIR)) {
      try {
        corpus.push({
          displayPath: `src/assets/scripts/${path.relative(SCRIPTS_DIR, filePath)}`,
          content: readFileSync(filePath, 'utf-8'),
        })
      } catch { /* skip */ }
    }

    const staleEntries: string[] = []
    for (const entry of RETIRED_ALLOWLIST) {
      const re = new RegExp(entry.name, 'i')
      const file = corpus.find(({ displayPath }) => displayPath === entry.path)
      if (!file || !re.test(file.content)) {
        staleEntries.push(
          `  { path: '${entry.path}', name: '${entry.name}' } — no hit in corpus; stale entry must be removed`,
        )
        continue
      }
      // Context staleness: every context must occur verbatim, or it suppresses nothing.
      for (const ctx of entry.contexts) {
        if (!file.content.includes(ctx)) {
          staleEntries.push(
            `  { path: '${entry.path}', name: '${entry.name}' } context '${ctx}' not found in file — stale context must be removed`,
          )
        }
      }
    }
    expect(
      staleEntries,
      `Stale RETIRED_ALLOWLIST entries (no corpus hit found):\n${staleEntries.join('\n')}`,
    ).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GAP-6: Shipped LEGACY_AGENT_KEYS integrity
// ---------------------------------------------------------------------------

/**
 * The action-verb rename map exactly as it must ship.
 *
 * WHY THIS IS PINNED HERE AND NOT IN agent-models.test.ts: the
 * `canonicaliseAgentKeys` suite in that file deletes every key from the
 * exported LEGACY_AGENT_KEYS in beforeEach and injects synthetic entries
 * ('old-coder' → 'coder'). Every assertion there runs against a map the test
 * emptied first, so that suite is structurally incapable of noticing that the
 * SHIPPED map went empty — which is exactly how a stale dist/ exporting zero
 * entries stayed green during this wave (avoids PF-018: a green test proves
 * nothing unless it exercised a non-empty target).
 *
 * These guards read the map as shipped and never mutate it.
 */
const EXPECTED_LEGACY_AGENT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'coder': 'code',
  'designer': 'design',
  'evaluator': 'evaluate',
  'researcher': 'research',
  'reviewer': 'review',
  'scrutinizer': 'scrutinize',
  'simplifier': 'simplify',
  'skimmer': 'skim',
  'synthesizer': 'synthesize',
  'tester': 'test',
  'triager': 'triage',
  'validator': 'validate',
  'bug-analyzer': 'diagnose',
})

describe('GAP-6: shipped LEGACY_AGENT_KEYS integrity', () => {
  it('is non-empty — the map actually shipped', () => {
    // Non-vacuity gate. If this fails, every other assertion in this describe
    // is meaningless and the migration silently does nothing for every user.
    expect(Object.keys(LEGACY_AGENT_KEYS).length).toBeGreaterThan(0)
  })

  it('pins the exact 13 old→new pairs', () => {
    // Sorted plain-object comparison: catches additions, removals, and retargets.
    const actual = Object.fromEntries(
      Object.keys(LEGACY_AGENT_KEYS).sort().map(k => [k, LEGACY_AGENT_KEYS[k]]),
    )
    const expected = Object.fromEntries(
      Object.keys(EXPECTED_LEGACY_AGENT_KEYS).sort().map(k => [k, EXPECTED_LEGACY_AGENT_KEYS[k]]),
    )
    expect(actual).toEqual(expected)
    expect(Object.keys(LEGACY_AGENT_KEYS)).toHaveLength(13)
  })

  it('no legacy key collides with a live registry agent', () => {
    // A key that is ALSO a live agent would migrate a valid current override away.
    const live = new Set(getAllAgentNames())
    const collisions = Object.keys(LEGACY_AGENT_KEYS).filter(k => live.has(k))
    expect(
      collisions,
      `Legacy keys that are also live agents (migration would destroy valid overrides): ${collisions.join(', ')}`,
    ).toEqual([])
  })

  it('every legacy value is a live registry agent', () => {
    // A value that is not a live agent would migrate an override onto a dead key,
    // silently dropping the user's setting.
    const live = new Set(getAllAgentNames())
    const dangling = Object.entries(LEGACY_AGENT_KEYS)
      .filter(([, v]) => !live.has(v))
      .map(([k, v]) => `${k} → ${v}`)
    expect(
      dangling,
      `Legacy values with no live agent (override would land on a dead key): ${dangling.join(', ')}`,
    ).toEqual([])
  })

  it('is single-hop — no value is itself a key', () => {
    // canonicaliseAgentKeys applies exactly one pass. A chain (a→b, b→c) would
    // resolve to b or c depending on iteration order — order-dependent corruption.
    const keys = new Set(Object.keys(LEGACY_AGENT_KEYS))
    const chained = Object.entries(LEGACY_AGENT_KEYS)
      .filter(([, v]) => keys.has(v))
      .map(([k, v]) => `${k} → ${v} (and '${v}' is itself a key)`)
    expect(
      chained,
      `Multi-hop chains in LEGACY_AGENT_KEYS (single-pass migration is order-dependent):\n${chained.join('\n')}`,
    ).toEqual([])
  })

  it('applies the real shipped map end-to-end (non-synthetic)', () => {
    // The only test in the suite that runs canonicaliseAgentKeys against the
    // genuine 13 mappings rather than an injected 'old-coder' → 'coder' stub.
    const input = Object.fromEntries(
      Object.keys(EXPECTED_LEGACY_AGENT_KEYS).map(k => [k, { model: 'opus' }]),
    )
    const { agents, didMutate } = canonicaliseAgentKeys(input)
    expect(didMutate).toBe(true)
    for (const [oldKey, newKey] of Object.entries(EXPECTED_LEGACY_AGENT_KEYS)) {
      expect(Object.hasOwn(agents, oldKey), `'${oldKey}' should have been renamed away`).toBe(false)
      expect(Object.hasOwn(agents, newKey), `'${newKey}' should exist after migration`).toBe(true)
      expect(agents[newKey]).toEqual({ model: 'opus' })
    }
    expect(Object.keys(agents)).toHaveLength(13)
  })
})
