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
import { existsSync, readFileSync, readdirSync, type Dirent } from 'fs'
import * as path from 'path'
import { getAllAgentNames } from '../src/core/plugins.js'
import { LEGACY_AGENT_KEYS, canonicaliseAgentKeys } from '../src/core/agent-models.js'
import { BUILT_IN_SPAWN_TYPES, collectValidAgentTypes, requireDistFiles, requireDistFile, resolveAgentSource, resolveAllAgents } from './helpers.js'
import {
  HANDOFF_PREFIX,
  REPORT_CAP,
  collectCharterContentViolations,
  collectCharterKnowledgeDefects,
  collectCharterRoutingViolations,
} from './helpers/charter-guards.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const ASSETS_DIR = path.join(ROOT, 'src', 'assets')
const DIST_COMMANDS_DIR = path.join(ROOT, 'dist', 'commands')
const DOCS_DIR = path.join(ROOT, 'docs')
// Root-level doc files included in GAP-5 corpus.
// CHANGELOG.md is intentionally excluded: it documents history and may legitimately
// reference retired names as examples of what was renamed.
const ROOT_DOC_FILES = ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md'].map(f => path.join(ROOT, f))
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
 * One retired spelling of an agent name.
 *
 * `patterns` carry no `g` flag, so `test()` holds no state between files. A file hits the form
 * when any one pattern matches. `bad` holds synthetic text per spelling; the known-bad probe feeds
 * it to the same collector the sweep calls, so a matcher that goes blind fails there.
 */
interface RetiredForm {
  /** Label in violation messages and the key an allowlist entry names. */
  name: string
  patterns: readonly RegExp[]
  bad: readonly string[]
}

/** True when `text` holds any spelling of the retired form. */
const hasRetiredHit = (form: RetiredForm, text: string): boolean =>
  form.patterns.some(re => re.test(text))

/**
 * A name no prose uses (a role noun like Coder, or a hyphenated one like Code-fix):
 * MAXIMAL RECALL, any case, no boundary. This catches Coders, Coder's, coderPath and
 * ANSI-embedded 31mcoder. Over-match plus an allowlist is safe; under-match is not.
 */
const looseForm = (name: string): RetiredForm => ({
  name,
  patterns: [new RegExp(name, 'i')],
  bad: [`Agent(subagent_type="${name}")`],
})

/**
 * An agent whose retired name is an ordinary English word (Simplify, Diagnose, Scrutinize).
 * The unbounded any-case sweep above would flag every use of the verb, so this matches only
 * the shapes that name the agent:
 *   - the capitalised word on its own, case-SENSITIVE (a spawn key, a roster row, "the Simplify agent");
 *   - the agent file (`simplify.md`, `simplify.mds`) and its path (`agents/simplify`);
 *   - the slug quoted as a code span or a map key (`simplify`, "simplify").
 * The lowercase verb passes. A capitalised verb that opens a sentence is waived by the allowlist.
 */
const verbForm = (name: string): RetiredForm => {
  const slug = name.toLowerCase()
  return {
    name,
    patterns: [
      new RegExp(`\\b${name}\\b`),
      new RegExp(`(?<![\\w-])${slug}\\.mds?\\b`),
      new RegExp(`agents/${slug}(?![\\w-])`),
      new RegExp('(["\'`])' + slug + '\\1'),
    ],
    bad: [
      `Agent(subagent_type="${name}")`,
      `the ${name} agent runs after Code`,
      `src/assets/agents/${slug}.mds`,
      `the file lives in agents/${slug}`,
      `agents: \`${slug}\`, \`test\``,
    ],
  }
}

/**
 * Form B names (frontmatter name:) that once existed but have been renamed.
 *
 * Derived from the actual frontmatter name: values that agents carried before
 * the rename (reading them directly, not inferring from Capitalize(slug)).
 *
 * Legitimate collateral hits are covered by RETIRED_ALLOWLIST below.
 */
const RETIRED_AGENT_FORM_B: readonly RetiredForm[] = [
  // 13 agents renamed noun→action-verb (phase 4 of agent-action-verbs wave)
  looseForm('Coder'),        // → Code
  looseForm('Designer'),     // → Design
  looseForm('Evaluator'),    // → Evaluate
  looseForm('Researcher'),   // → Research
  looseForm('Reviewer'),     // → Review
  looseForm('Scrutinizer'),  // → Harden
  looseForm('Simplifier'),   // → Polish
  looseForm('Skimmer'),      // → Skim
  looseForm('Synthesizer'),  // → Synthesize
  looseForm('Tester'),       // → Test
  looseForm('Triager'),      // → Triage
  looseForm('Validator'),    // → Validate
  looseForm('BugAnalyzer'),  // → Debug
  // six agents renamed to state their job (#466). Scrutinize, Simplify and Diagnose are also
  // ordinary verbs, so only the shapes that name the agent are retired.
  looseForm('Code-fix'),     // → Fix
  looseForm('Code-edit'),    // → Refactor
  verbForm('Scrutinize'),    // → Harden
  verbForm('Simplify'),      // → Polish
  verbForm('Diagnose'),      // → Debug
  // Learning is also the pre-rename name of the curation feature (old KB titles, the mirror
  // switch key, "Learning-aware"), so only the agent-specific spellings are retired.
  {
    name: 'Learning agent',                // → Curate agent
    patterns: [/\bLearning agents?\b/],
    bad: ['the Learning agent drains the queue'],
  },
  {
    name: 'name: Learning',                // → name: Curate
    patterns: [/^name:[ \t]*Learning[ \t]*$/m],
    bad: ['---\nname: Learning\nmodel: opus\n---'],
  },
  {
    name: 'subagent_type="Learning"',      // → subagent_type="Curate"
    patterns: [/(?:subagent_type|agentType)\s*[=:]\s*["']learning["']/i],
    bad: ['Agent(subagent_type="Learning")', 'agentType: "Learning"'],
  },
  {
    name: 'agents/learning',               // → agents/curate
    patterns: [/agents\/learning(?![\w-])/i],
    bad: ['src/assets/agents/learning'],
  },
  {
    name: 'references/learning',           // → references/curate
    patterns: [/references\/learning\//i],
    bad: ['agent-references/references/learning/maintain.md'],
  },
  {
    name: 'learning.md',                   // → curate.md
    patterns: [/(?<![\w.-])learning\.md\b/i],
    bad: ['read learning.md first'],
  },
  {
    name: 'agents.learning',               // → agents.curate (the legacy-key fallback is allowlisted)
    patterns: [/\bagents\.learning(?![\w-])/],
    bad: ['agents.learning.model'],
  },
  {
    name: 'AGENT_CONFIG.learning',         // → AGENT_CONFIG.curate
    patterns: [/\bAGENT_CONFIG\.learning\b/],
    bad: ['AGENT_CONFIG.learning.model'],
  },
]

/**
 * Named collector for GAP-5 and the charter check: every retired spelling `content` still holds.
 *
 * A hit is waived only by an allowlist entry for this path and name. The entry's contexts are
 * stripped and the text re-tested, so a stray reference beside a waived one still fails. The sweep
 * and the known-bad probes both call this, so the guard and its probe cannot drift apart.
 */
function collectRetiredNameViolations(
  displayPath: string,
  content: string,
  forms: readonly RetiredForm[] = RETIRED_AGENT_FORM_B,
  allowlist: ReadonlyArray<AllowlistEntry> = RETIRED_ALLOWLIST,
): string[] {
  const out: string[] = []
  for (const form of forms) {
    if (!hasRetiredHit(form, content)) continue
    const entry = allowlist.find(e => e.path === displayPath && e.name === form.name)
    if (!entry) {
      out.push(`  ${displayPath}: references retired name '${form.name}'`)
      continue
    }
    let residual = content
    for (const ctx of entry.contexts) residual = residual.split(ctx).join('')
    if (hasRetiredHit(form, residual)) {
      out.push(`  ${displayPath}: references retired name '${form.name}' outside its allowlisted contexts`)
    }
  }
  return out
}

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
  {
    path: 'src/assets/scripts/lib/project-config.cjs',
    name: 'Coder',
    reason:
      'THIRD_PARTY: "TextDecoder" — the WHATWG Encoding API the shared config parser ' +
      'decodes policy, project and manifest bytes with (fatal on malformed UTF-8); no agent spawn reference',
    contexts: ['TextDecoder'],
  },

  // -----------------------------------------------------------------------
  // Evaluator — CONCEPT (MDS function name)
  // The actual Evaluate agent is spawned via agentType: "Evaluate".
  // evaluator_panel() is an MDS function (the single Gate 2 Evaluate spawn's
  // doctrine); the merged spawn's prompt carries no role label of its own.
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/commands/dynamic-build.mds',
    name: 'Evaluator',
    reason:
      'CONCEPT: evaluator_panel MDS function import/call — not a Form-B spawn key; ' +
      'actual spawn uses agentType: "Evaluate"',
    contexts: ['evaluator_panel'],
  },
  {
    path: 'src/assets/commands/_partials/_engine.mds',
    name: 'Evaluator',
    reason:
      'CONCEPT: @define evaluator_panel() MDS function definition and export — not a Form-B spawn key',
    contexts: ['evaluator_panel'],
  },
  {
    path: 'dist/commands/dynamic-build.md',
    name: 'Evaluator',
    reason:
      'CONCEPT: compiled output of dynamic-build.mds; the evaluator_panel function name ' +
      '— not a Form-B spawn key',
    contexts: ['evaluator_panel'],
  },

  // -----------------------------------------------------------------------
  // Reviewer — DATA_FIELD, CONTRACT, CONCEPT, THIRD_PARTY (generic term)
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/agents/triage.mds',
    name: 'Reviewer',
    reason:
      'DATA_FIELD: reviewer_confidence — issue contract field carrying a confidence ' +
      'percentage; not an agent spawn',
    contexts: ['reviewer_confidence'],
  },
  {
    path: 'src/assets/mds/git/_ops_steps.mds',
    name: 'Reviewer',
    reason:
      'CONTRACT: "Reviewer Focus Areas" — protected PR description contract heading ' +
      '(plan.mds emits; ensure-pr-ready step 4a maps the PR table to it); 5 sites, 3 files',
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
    path: 'src/assets/skills/compliance/frameworks/sox/reference.md',
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
  {
    path: 'src/assets/agents/test.md',
    name: 'Tester',
    reason:
      'CONCEPT: "devflow-tester-" — the scenario write path in the Bash Execution Constraints ' +
      '(mktemp in /tmp/devflow-tester-*), moved from references/browser-testing.md by #711; not an agent spawn',
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

  // -----------------------------------------------------------------------
  // Simplify — CONCEPT (a capitalised verb opening a sentence, not the agent renamed to Polish;
  // the lowercase verb needs no row)
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/skills/test-driven-development/references/rationalization-prevention.md',
    name: 'Simplify',
    reason:
      'CONCEPT: the verb opening a rationalization-table row; no agent reference',
    contexts: ['Simplify the interface first'],
  },

  // -----------------------------------------------------------------------
  // agents.learning — CONTRACT (the documented read of the key the Curate agent carried
  // before the rename; a new reference elsewhere stays a violation)
  // -----------------------------------------------------------------------
  {
    path: 'src/assets/scripts/hooks/session-start-context',
    name: 'agents.learning',
    reason:
      'CONTRACT: the model-resolution fallback reads agents.curate.model, then the pre-rename ' +
      'agents.learning.model; not an agent spawn reference',
    contexts: ['agents.learning.model'],
  },
  {
    path: 'docs/reference/hooks.md',
    name: 'agents.learning',
    reason:
      'CONTRACT: documents the same fallback to the pre-rename agents.learning.model entry',
    contexts: ['agents.learning.model'],
  },
  {
    path: '.devflow/features/curation-capture-system-agent/KNOWLEDGE.md',
    name: 'agents.learning',
    reason:
      'CONTRACT: documents the same fallback to the pre-rename agents.learning.model entry',
    contexts: ['agents.learning.model'],
  },

  // -----------------------------------------------------------------------
  // Scrutinize — DATA_FIELD (field data recorded under the name the agent carried before the
  // rename; a new reference elsewhere stays a violation)
  // -----------------------------------------------------------------------
  {
    path: 'docs/reference/platform-assumptions.md',
    name: 'Scrutinize',
    reason:
      'DATA_FIELD: the stall investigation counts agent types from transcripts dated 2026-10-01 to ' +
      '2026-10-07, which logged Harden as Scrutinize; not an agent spawn reference',
    contexts: ['(logged as Scrutinize)'],
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
 * Recursively collect files with given extensions from a directory.
 * Returns [] when the directory does not exist (non-fatal absence).
 */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = []
  let entries: Dirent[]
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
  let entries: Dirent[]
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
 * Named collector: how a compiled dynamic host's "Valid `agentType` values" sentence (the preamble's
 * closed list) differs from the types the host spawns and from the roster. A type the host spawns but the
 * sentence omits tells the main model that its own script is invalid, so the three disagree; a listed
 * type the roster lacks (or the reverse) is a name no spawn or no registry entry stands behind.
 */
function collectValidListDefects(host: string, text: string, roster: ReadonlySet<string>): string[] {
  const listed = collectValidAgentTypes(text)
  if (listed === null) return [`${host}: no "Valid \`agentType\` values" sentence`]
  const listedSet = new Set(listed)
  const out: string[] = []
  for (const type of extractAgentTypes(text)) {
    if (!listedSet.has(type)) out.push(`${host}: spawns "${type}", which the valid-agentType sentence does not list`)
  }
  for (const type of listed) {
    if (!roster.has(type)) out.push(`${host}: lists "${type}", which the roster does not`)
  }
  for (const type of roster) {
    if (!listedSet.has(type)) out.push(`${host}: omits "${type}", which the roster lists`)
  }
  return out
}

/**
 * A `subagent_type` literal: `subagent_type="X"`, `subagent_type: "X"` and the shell-escaped
 * `subagent_type=\"X\"` form used inside hook heredoc strings.
 */
const SPAWN_LITERAL_RE = /subagent_type[=:]\s*\\?"([^"\\]+)\\?"/g

/**
 * Named collector: the `subagent_type` literals in `content` that name no spawnable type. A literal
 * passes when it byte-equals a live form-B name, or an entry of BUILT_IN_SPAWN_TYPES. `Plan` is a Claude
 * Code built-in that devflow ships no agent file for, so no form-B name stands behind it. The compare is
 * exact: `plan`, `PLAN` and `general-purpose` are reported.
 */
export function collectSpawnLiteralDefects(displayPath: string, content: string, formBNames: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const m of content.matchAll(SPAWN_LITERAL_RE)) {
    const name = m[1]
    if (formBNames.has(name) || BUILT_IN_SPAWN_TYPES.includes(name)) continue
    out.push(`  ${displayPath}: subagent_type "${name}" does not byte-equal any agent frontmatter name:`)
  }
  return out
}

/**
 * Parse the "| AgentName | tier | … |" roster table from _roster.mds source.
 * Returns name → model tier.
 */
function parseRosterFromSource(): Map<string, string> {
  const content = readFileSync(ROSTER_SRC, 'utf-8')
  const roster = new Map<string, string>()
  for (const line of content.split('\n')) {
    const m = line.match(/^\|\s*([\w-]+)\s*\|\s*(haiku|sonnet|opus)\s*\|/)
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
    const m = line.match(/^\|\s*([\w-]+)\s*\|\s*(haiku|sonnet|opus)\s*\|/)
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
   * The exception map holds the cases where form B diverges from the default.
   * It is empty: every agent's name: is capitalizeFirst(slug).
   */
  it('every agent frontmatter name: matches its slug or the exception map', () => {
    const agents = resolveAllAgents()
    expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))

    const violations: string[] = []
    for (const [slug, source] of agents) {
      const frontmatterName = readFrontmatterName(source.path)
      const expected = Object.hasOwn(SLUG_TO_NAME_EXCEPTIONS, slug)
        ? SLUG_TO_NAME_EXCEPTIONS[slug]
        : capitalizeFirst(slug)
      if (frontmatterName !== expected) {
        violations.push(
          `  ${path.relative(ROOT, source.path)}: name: '${frontmatterName}' ≠ expected '${expected}'` +
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
   * Explore is a devflow agent that overrides the Claude Code built-in of the same
   * name (D-EXPLORE-OVERRIDE). The prose commands spawn it by type name and it is
   * not a member of the dynamic roster, so a workflow `agentType` of Explore would
   * be held against the roster like any other type: none is expected.
   */
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
        agentTypesInDist.add(name)
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

  /** The four dynamic hosts (build, plan, profile, tickets): each carries the preamble's valid-agentType sentence. */
  const DYNAMIC_HOST_COUNT = 4

  it("each dynamic host's valid-agentType sentence lists the roster and every type the host spawns", () => {
    const hosts = requireDistFiles().filter(f => f.startsWith('dynamic-'))
    expect(hosts, 'dynamic hosts in dist/commands').toHaveLength(DYNAMIC_HOST_COUNT)
    const roster = new Set(parseRosterFromSource().keys())
    expect(roster.size, '_roster.mds table is empty — parse failure?').toBeGreaterThan(0)

    // Non-vacuity: every host yields a list, and the hosts together spawn at least one type to hold it to.
    const texts = hosts.map(h => [h, requireDistFile(h)] as const)
    for (const [host, text] of texts) {
      expect(collectValidAgentTypes(text)?.length ?? 0, `${host}: types in the valid-agentType sentence`).toBeGreaterThan(0)
    }
    const spawned = new Set(texts.flatMap(([, text]) => [...extractAgentTypes(text)]))
    expect(spawned.size, 'agentType values the dynamic hosts spawn').toBeGreaterThan(0)

    expect(texts.flatMap(([host, text]) => collectValidListDefects(host, text, roster))).toEqual([])
  })

  it('known-bad probes: a dropped spawned type, an invented type and a missing sentence are each reported', () => {
    const host = 'dynamic-build.md'
    const text = requireDistFile(host)
    const roster = new Set(parseRosterFromSource().keys())
    const line = text.split('\n').find(l => l.startsWith('Valid `agentType` values: ')) ?? ''
    expect(line, 'the valid-agentType sentence').not.toBe('')
    const listed = collectValidAgentTypes(text) ?? []
    const withList = (types: readonly string[]): string => text.replace(line, `Valid \`agentType\` values: ${types.join(', ')}.`)

    // Control: the real host passes, so the probes below are not red for an unrelated reason.
    expect(collectValidListDefects(host, text, roster)).toEqual([])

    expect(collectValidListDefects(host, withList(listed.filter(t => t !== 'Fix')), roster)).toEqual([
      `${host}: spawns "Fix", which the valid-agentType sentence does not list`,
      `${host}: omits "Fix", which the roster lists`,
    ])
    expect(collectValidListDefects(host, withList([...listed, 'Fixer']), roster)).toEqual([
      `${host}: lists "Fixer", which the roster does not`,
    ])
    expect(collectValidListDefects(host, text.replace(line, ''), roster)).toEqual([
      `${host}: no "Valid \`agentType\` values" sentence`,
    ])
  })

  it('subagent_type literals in dist and hook scripts exactly match a live form-B name (case-sensitive)', () => {
    /**
     * Guard 5 (registry-integrity) compares subagent_type values to registry
     * slugs case-INSENSITIVELY, and GAP-1 ties slugs to form B — but nothing
     * enforced exact case on the literal itself. subagent_type="CODE" would
     * pass both while failing at spawn time. This closes that hole: every
     * literal must byte-equal an actual frontmatter name: value. Explore is
     * one: devflow's explore.md ships `name: Explore`, so the built-in's name
     * needs no exemption. Plan is the other built-in, and devflow ships no
     * agent file for it, so the closed set BUILT_IN_SPAWN_TYPES admits it by
     * its exact name.
     */
    // Truth set: the real frontmatter name: values via the resolver, not a derived transform.
    const agents = resolveAllAgents()
    expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))
    const formBNames = new Set(
      [...agents.values()].map(source => readFrontmatterName(source.path)),
    )

    let matchCount = 0
    const violations: string[] = []
    const scanContent = (displayPath: string, content: string) => {
      matchCount += [...content.matchAll(SPAWN_LITERAL_RE)].length
      violations.push(...collectSpawnLiteralDefects(displayPath, content, formBNames))
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

    // Non-vacuity: dist currently carries ~66 spawn sites + the Curate hook
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

  it('known-bad probes: the built-in Plan type passes by exact name; general-purpose, plan and PLAN are reported', () => {
    // Plan is a Claude Code built-in with no agent file, so it is in no form-B set. BUILT_IN_SPAWN_TYPES is
    // closed: a new entry needs a recorded decision.
    expect(BUILT_IN_SPAWN_TYPES).toEqual(['Plan'])

    const formBNames = new Set(['Explore', 'Synthesize', 'Design'])
    const defectsOf = (content: string): string[] => collectSpawnLiteralDefects('probe.md', content, formBNames)
    const defect = (name: string): string => `  probe.md: subagent_type "${name}" does not byte-equal any agent frontmatter name:`

    // Controls: a form-B name is clean, and so is the built-in in each spelling the corpus uses.
    expect(defectsOf('Agent(subagent_type="Explore"):')).toEqual([])
    expect(defectsOf('Agent(subagent_type="Plan"):')).toEqual([])
    expect(defectsOf('Spawn 3 `Agent(subagent_type="Plan")` agents')).toEqual([])
    expect(defectsOf('subagent_type: "Plan"')).toEqual([])
    expect(defectsOf('subagent_type=\\"Plan\\"')).toEqual([])

    // Probes: the allow set is the exact name Plan and nothing nearby.
    expect(defectsOf('Agent(subagent_type="general-purpose"):')).toEqual([defect('general-purpose')])
    expect(defectsOf('Agent(subagent_type="plan"):')).toEqual([defect('plan')])
    expect(defectsOf('Agent(subagent_type="PLAN"):')).toEqual([defect('PLAN')])
    expect(defectsOf('Agent(subagent_type="Plan "):')).toEqual([defect('Plan ')])
    expect(defectsOf('Agent(subagent_type="Plan"): then Agent(subagent_type="plan"):')).toEqual([defect('plan')])
  })
})

// ---------------------------------------------------------------------------
// GAP-3: Orchestrator charter
// ---------------------------------------------------------------------------

describe('GAP-3: orchestrator charter integrity', () => {
  /**
   * The hook cap is 4,096 characters (shell ${#CHARTER}).
   * session-start-orchestrator fails OPEN AND SILENT past that cap —
   * the charter is simply not injected, with no error (hook line ~49).
   * The ceiling is the byte size of the full-install source charter: 3,376 bytes, which is
   * 82.4% of the cap. A rendered charter is never larger than the source. The founder
   * authorised a ceiling of 3,384 on 2026-10-23, up from 3,072: the routing now names every
   * roster agent and the installed workflows. #733 lowered it to 3,376 when the routing named
   * Architect. The ceiling row in tests/fixtures/numeric-floors.json
   * pins the literal below.
   */
  const CHARTER_CAP = 4096
  const MAX_CHARTER_BYTES = 3321

  it('charter byte size stays within its ceiling, below the 4096-character injection cap', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    // The hook measures characters (shell ${#CHARTER}), the file is measured in bytes. They agree
    // only for pure ASCII, so the byte ceiling holds the character cap only while both are equal.
    const byteCount = Buffer.byteLength(charter)
    expect(
      byteCount,
      `Orchestrator charter is ${byteCount} bytes but ${charter.length} chars — it must be pure ASCII so the hook's character count equals its byte size.`,
    ).toBe(charter.length)
    expect(
      byteCount,
      `Orchestrator charter is ${byteCount} bytes — exceeds its ceiling of ${MAX_CHARTER_BYTES} bytes (hook cap: ${CHARTER_CAP}).\n` +
      `The hook at src/assets/scripts/hooks/session-start-orchestrator (~line 49) fails OPEN past the cap.`,
    ).toBeLessThanOrEqual(MAX_CHARTER_BYTES)
  })

  // The bounded-inline exception, the report cap, the Code routing line and the handoff line are
  // held by collectCharterContentViolations (tests/helpers/charter-guards.ts), which any rendering
  // of the charter can run too.

  it('charter carries the bounded-inline exception, a token-figure report cap, the no-argument handoff and a Code routing line that names OPERATION', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    const violations = collectCharterContentViolations(charter)
    expect(violations, `Orchestrator charter content violations:\n  ${violations.join('\n  ')}`).toEqual([])
  })

  it('routing ends with a roster-only fallback that names no model', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    expect(collectCharterRoutingViolations(charter)).toEqual([])
  })

  it('known-bad probe: a missing routing list, a different last routing line and a named model are each reported', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    expect(collectCharterRoutingViolations(charter)).toEqual([])

    const noRouting = charter.replace('Routing (Agent tool)', 'Dispatch')
    expect(noRouting, 'the seed must land').not.toBe(charter)
    expect(collectCharterRoutingViolations(noRouting)).toEqual(['no "Routing (Agent tool)" line'])

    const openEnded = charter.replace('the closest roster agent, never general-purpose.', 'any agent you like.')
    expect(openEnded, 'the seed must land').not.toBe(charter)
    expect(collectCharterRoutingViolations(openEnded)).toHaveLength(1)

    const namesModel = charter.replace('- Search and listing: Explore.', '- Search and listing: Explore (haiku).')
    expect(namesModel, 'the seed must land').not.toBe(charter)
    expect(collectCharterRoutingViolations(namesModel)).toEqual(['the routing lines name a model'])
  })

  it('known-bad probe: a charter without the bounds, without a report figure, without OPERATION on the Code line, or with "full plan" is reported', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    // Non-vacuity: the real charter is clean, so each seed below fails for its own reason.
    expect(collectCharterContentViolations(charter)).toEqual([])

    const unbounded = charter.replace('40 lines', 'any length')
    expect(unbounded, 'the seed must land').not.toBe(charter)
    expect(collectCharterContentViolations(unbounded).some(v => v.startsWith('no single sentence holds all of'))).toBe(true)

    const uncapped = charter.replace(REPORT_CAP, 'a short report')
    expect(uncapped, 'the seed must land').not.toBe(charter)
    expect(collectCharterContentViolations(uncapped)).toContain(
      'no delegation report cap carries a token figure ("at most about N tokens")',
    )

    const noOperation = charter.replace('`OPERATION: <mode>`', 'a mode')
    expect(noOperation, 'the seed must land').not.toBe(charter)
    expect(collectCharterContentViolations(noOperation)).toContain(
      'the Code routing line does not tell a direct Code delegation to open with OPERATION: <mode>',
    )

    // D-CODE-VARIANTS: the edit route must name the Refactor variant, and Code must not keep it.
    const noEditVariant = charter.replace('Refactor (', 'Code (')
    expect(noEditVariant, 'the seed must land').not.toBe(charter)
    expect(collectCharterContentViolations(noEditVariant)).toContain(
      'the Code routing line does not route `OPERATION: edit` to Refactor',
    )
    const editOnCode = charter.replace(': `issue-fix` for', ': `edit` for mechanical changes, `issue-fix` for')
    expect(editOnCode, 'the seed must land').not.toBe(charter)
    expect(collectCharterContentViolations(editOnCode)).toContain('the Code routing line still routes edit to Code')

    const fullPlan = charter.replace(HANDOFF_PREFIX, `${HANDOFF_PREFIX} pass the full plan as skill input,`)
    expect(fullPlan, 'the seed must land').not.toBe(charter)
    expect(collectCharterContentViolations(fullPlan)).toContain(
      'the handoff line tells the orchestrator to pass the full plan as skill input',
    )
  })

  it('known-bad probe: bound words scattered over several sentences do not count as one bounded sentence', () => {
    const scattered = [
      'The main thread may run a single command.',
      'It is git or gh only, and its output stays under about 40 lines.',
      'Never a diff, a log or a test run.',
      `If the first message begins with ${HANDOFF_PREFIX} invoke devflow:implement.`,
      'Ask for a report of at most about 1,500 tokens.',
    ].join('\n')
    const violations = collectCharterContentViolations(scattered)
    expect(violations.some(v => v.startsWith('no single sentence holds all of'))).toBe(true)
  })

  it('charter contains no retired agent names', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    // The charter has no allowlist: any retired spelling in it is a defect.
    const violations = collectRetiredNameViolations('orchestrator-charter.md', charter, RETIRED_AGENT_FORM_B, [])
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
      // Use resolveAgentSource (dist-preferred, src-fallback) so the lookup survives
      // future agent renames without updating a hardcoded directory constant (AC-0.7).
      const agentFile = resolveAgentSource(agentSlug).path
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
   * filesScanned >= 265 ensures the corpus is not accidentally empty or
   * mis-globbed — a vacuously passing sweep on an empty corpus has burned
   * this repo before (registry-integrity Guard 5 and skill-references.test.ts:865
   * both had this failure mode; the two existing sites are fixed in this commit).
   */

  it('corpus size is at least 265 files (guards against mis-glob / empty dist)', () => {
    // Fail-loud: requireDistFiles() throws if dist is absent
    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])
    const docsFiles = collectFiles(DOCS_DIR, ['.md'])
    const rootDocFiles = ROOT_DOC_FILES.filter(f => existsSync(f))
    const featureFiles = collectFiles(FEATURES_DIR, ['.md'])
    const scriptFiles = collectScriptFiles(SCRIPTS_DIR)

    // Segment floors: collectFiles returns [] for a missing directory, which
    // would silently drop a corpus segment while the 265 total still passes.
    expect(docsFiles.length, 'docs/ corpus segment is empty — check DOCS_DIR').toBeGreaterThanOrEqual(5)
    expect(rootDocFiles.length, 'root doc files (README/CLAUDE/CONTRIBUTING) not found').toBeGreaterThanOrEqual(3)
    expect(featureFiles.length, '.devflow/features corpus segment is empty — check FEATURES_DIR').toBeGreaterThanOrEqual(3)
    expect(scriptFiles.length, 'src/assets/scripts corpus segment is empty — check SCRIPTS_DIR').toBeGreaterThanOrEqual(20)

    const filesScanned = assetsFiles.length + distFiles.length + docsFiles.length + rootDocFiles.length + featureFiles.length + scriptFiles.length
    expect(
      filesScanned,
      `Corpus is only ${filesScanned} files (expected >= 265). ` +
      `Check glob patterns — an empty corpus is a silent false-pass.\n` +
      `  src/assets files: ${assetsFiles.length}  dist/commands files: ${distFiles.length}  ` +
      `docs/ files: ${docsFiles.length}  root docs: ${rootDocFiles.length}  ` +
      `.devflow/features files: ${featureFiles.length}  src/assets/scripts files: ${scriptFiles.length}`,
    ).toBeGreaterThanOrEqual(265)
  })

  it('no retired form B names appear in any shipped artifact (vacuous when list is empty)', () => {
    // Fail-loud: requireDistFiles() throws if dist is absent
    const distFiles = requireDistFiles()
    const assetsFiles = collectFiles(ASSETS_DIR, ['.md', '.mds'])

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
        violations.push(...collectRetiredNameViolations(displayPath, content))
      }
    }

    scan(assetsFiles, ASSETS_DIR, 'src/assets/')
    scan(
      distFiles.map(f => path.join(DIST_COMMANDS_DIR, f)),
      DIST_COMMANDS_DIR,
      'dist/commands/',
    )
    scan(collectFiles(DOCS_DIR, ['.md']), DOCS_DIR, 'docs/')
    scan(ROOT_DOC_FILES.filter(f => existsSync(f)), ROOT, '')
    scan(collectFiles(FEATURES_DIR, ['.md']), FEATURES_DIR, '.devflow/features/')
    scan(collectScriptFiles(SCRIPTS_DIR), SCRIPTS_DIR, 'src/assets/scripts/')

    expect(violations, `Retired agent names found in shipped artifacts:\n${violations.join('\n')}`).toHaveLength(0)
  })

  it('every retired form has samples, and each of its patterns is exercised by one', () => {
    // A pattern no sample reaches could break unnoticed: the probe below would never feed it.
    expect(RETIRED_AGENT_FORM_B.length, 'no retired forms').toBeGreaterThan(0)
    const unexercised: string[] = []
    for (const form of RETIRED_AGENT_FORM_B) {
      for (const re of form.patterns) {
        if (!form.bad.some(sample => re.test(sample))) unexercised.push(`${form.name}: ${re}`)
      }
    }
    expect(unexercised, `Patterns with no known-bad sample:\n${unexercised.join('\n')}`).toEqual([])
  })

  it('known-bad probe: the collector flags every spelling of every retired agent name', () => {
    // Loops the whole set (not one member) and calls the collector the sweep calls, with no allowlist.
    const missed: string[] = []
    for (const form of RETIRED_AGENT_FORM_B) {
      for (const sample of form.bad) {
        const found = collectRetiredNameViolations('probe.md', sample, RETIRED_AGENT_FORM_B, [])
        if (!found.some(v => v.includes(`retired name '${form.name}'`))) missed.push(`${form.name}: ${JSON.stringify(sample)}`)
      }
    }
    expect(missed, `Retired spellings the collector did not flag:\n${missed.join('\n')}`).toEqual([])
  })

  it('known-bad probe: ordinary words and the pre-rename feature name are not retired agent names', () => {
    const benign = [
      '---\nfeature: curation-capture-system\nname: Curation capture system\n---',
      '---\nname: Learning store, ops and rendering\n---',
      '---\nname: Learning-aware Install & Language-focus Stamp\n---',
      '# Learning-aware Install & Language-focus Stamp',
      'Learning is on when `features.learning` is not false.',
      'The learning agent tuning config lives in learning.json.',
      'A message that does not help diagnose the problem; tests misdiagnosed as defects.',
      'Failures that are hard-to-diagnose, so scrutinize the diff.',
      'Run it to simplify and improve code. Rename, simplify, apply DRY. Fix, simplify first.',
    ]
    const wrongly = benign.filter(text => collectRetiredNameViolations('probe.md', text, RETIRED_AGENT_FORM_B, []).length > 0)
    expect(wrongly, `Plain English or feature prose flagged as a retired agent name:\n${wrongly.join('\n---\n')}`).toEqual([])
  })

  it('known-bad probe: an allowlist entry waives only its own contexts', () => {
    const entry: AllowlistEntry = {
      path: 'probe.md',
      name: 'Simplify',
      reason: 'probe',
      contexts: ['Simplify the interface first'],
    }
    const covered = collectRetiredNameViolations('probe.md', 'Simplify the interface first.', RETIRED_AGENT_FORM_B, [entry])
    expect(covered).toEqual([])
    const stray = collectRetiredNameViolations(
      'probe.md', 'Simplify the interface first. Then spawn the Simplify agent.', RETIRED_AGENT_FORM_B, [entry],
    )
    expect(stray).toEqual(["  probe.md: references retired name 'Simplify' outside its allowlisted contexts"])
    const otherFile = collectRetiredNameViolations('other.md', 'Simplify the interface first.', RETIRED_AGENT_FORM_B, [entry])
    expect(otherFile).toEqual(["  other.md: references retired name 'Simplify'"])
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
    for (const filePath of collectFiles(DOCS_DIR, ['.md'])) {
      try {
        corpus.push({
          displayPath: `docs/${path.relative(DOCS_DIR, filePath)}`,
          content: readFileSync(filePath, 'utf-8'),
        })
      } catch { /* skip */ }
    }
    for (const filePath of ROOT_DOC_FILES.filter(f => existsSync(f))) {
      try {
        corpus.push({
          displayPath: path.relative(ROOT, filePath),
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
      const form = RETIRED_AGENT_FORM_B.find(f => f.name === entry.name)
      const file = corpus.find(({ displayPath }) => displayPath === entry.path)
      if (!form || !file || !hasRetiredHit(form, file.content)) {
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
 * The rename map exactly as it must ship: the 2.0.0 action-verb rename, the 1.x names
 * retargeted to their final slug, and the rename of six agents (code-fix, code-edit, scrutinize,
 * simplify, diagnose, learning).
 *
 * WHY THIS IS PINNED HERE AND NOT IN agent-models.test.ts: the
 * `canonicaliseAgentKeys` suite in that file deletes every key from the
 * exported LEGACY_AGENT_KEYS in beforeEach and injects synthetic entries
 * ('old-coder' → 'coder'). Every assertion there runs against a map the test
 * emptied first, so that suite is structurally incapable of noticing that the
 * SHIPPED map went empty — which is exactly how a stale dist/ exporting zero
 * entries stayed green during this wave (a green test proves nothing unless
 * it exercised a non-empty target).
 *
 * These guards read the map as shipped and never mutate it.
 */
const EXPECTED_LEGACY_AGENT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // 1.x names, single hop to the final slug
  'scrutinizer': 'harden',
  'simplifier': 'polish',
  'bug-analyzer': 'debug',
  // 2.0.0 action-verb rename
  'coder': 'code',
  'designer': 'design',
  'evaluator': 'evaluate',
  'researcher': 'research',
  'reviewer': 'review',
  'skimmer': 'skim',
  'synthesizer': 'synthesize',
  'tester': 'test',
  'triager': 'triage',
  'validator': 'validate',
  // rename of six agents
  'code-fix': 'fix',
  'code-edit': 'refactor',
  'scrutinize': 'harden',
  'simplify': 'polish',
  'diagnose': 'debug',
  'learning': 'curate',
})

describe('GAP-6: shipped LEGACY_AGENT_KEYS integrity', () => {
  it('is non-empty — the map actually shipped', () => {
    // Non-vacuity gate. If this fails, every other assertion in this describe
    // is meaningless and the migration silently does nothing for every user.
    expect(Object.keys(LEGACY_AGENT_KEYS).length).toBeGreaterThan(0)
  })

  it('pins the exact 19 old→new pairs', () => {
    // Sorted plain-object comparison: catches additions, removals, and retargets.
    const actual = Object.fromEntries(
      Object.keys(LEGACY_AGENT_KEYS).sort().map(k => [k, LEGACY_AGENT_KEYS[k]]),
    )
    const expected = Object.fromEntries(
      Object.keys(EXPECTED_LEGACY_AGENT_KEYS).sort().map(k => [k, EXPECTED_LEGACY_AGENT_KEYS[k]]),
    )
    expect(actual).toEqual(expected)
    expect(Object.keys(LEGACY_AGENT_KEYS)).toHaveLength(19)
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
    // genuine 19 mappings rather than an injected 'old-coder' → 'coder' stub.
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
    // 19 old keys land on 16 slugs: scrutinizer/scrutinize, simplifier/simplify and
    // bug-analyzer/diagnose each meet at one.
    expect(Object.keys(agents)).toHaveLength(16)
  })
})

// ---------------------------------------------------------------------------
// D-KB-DELIVERY-TIERS (#427): the charter's Feature knowledge bullet
// ---------------------------------------------------------------------------

describe('charter Feature knowledge bullet (D-KB-DELIVERY-TIERS)', () => {
  it('passes Rules bullets with IDs, the path and the heading index, and keeps its three limits', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    expect(charter.length, 'nothing read').toBeGreaterThan(1000)
    expect(collectCharterKnowledgeDefects(charter)).toEqual([])
  })

  it('known-bad probe: the whole-file wording, a lost limit and a lost element are each reported', () => {
    const charter = readFileSync(CHARTER_PATH, 'utf-8')
    expect(collectCharterKnowledgeDefects(charter)).toEqual([])
    const whole = charter.replace(/pass each matching KB's one to three.*?as FEATURE_KNOWLEDGE/, 'pass matching KNOWLEDGE.md content as FEATURE_KNOWLEDGE')
    expect(whole, 'the seed must land').not.toBe(charter)
    const defects = collectCharterKnowledgeDefects(whole)
    expect(defects).toContain('the bullet still passes whole KNOWLEDGE.md content')
    expect(defects).toContain('the bullet does not state: the one to three Rules bullets')
    const noLimit = charter.replace('direct delegations only', 'every delegation')
    expect(collectCharterKnowledgeDefects(noLimit)).toEqual(['the bullet does not state: direct delegations only'])
    const noKnowledge = charter.replace('spawn Knowledge to refresh that KB', 'do nothing')
    expect(collectCharterKnowledgeDefects(noKnowledge)).toEqual(['the bullet does not state: a covered change spawns Knowledge afterwards'])
    expect(collectCharterKnowledgeDefects('no bullet')).toEqual(['no "- Feature knowledge" bullet'])
  })
})
