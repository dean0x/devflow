/**
 * Shared plugin registry — single source of truth for all CLI commands.
 */

/**
 * Namespace prefix for Devflow skills installed to ~/.claude/skills/.
 * Skills are installed as `devflow:{skill-name}` to avoid collisions with
 * other plugin ecosystems. Source dirs in src/assets/skills/ stay unprefixed.
 */
export const SKILL_NAMESPACE = 'devflow:';

/**
 * Add the `devflow:` namespace prefix to a bare skill name.
 * No-op if already prefixed.
 */
export function prefixSkillName(name: string): string {
  return name.startsWith(SKILL_NAMESPACE) ? name : `${SKILL_NAMESPACE}${name}`;
}

/**
 * Strip the `devflow:` namespace prefix from a skill name.
 * No-op if not prefixed.
 */
export function unprefixSkillName(name: string): string {
  return name.startsWith(SKILL_NAMESPACE) ? name.slice(SKILL_NAMESPACE.length) : name;
}

/**
 * Plugin definition with metadata
 */
export interface PluginDefinition {
  name: string;
  description: string;
  commands: string[];
  /**
   * Agents spawned by this plugin's commands. Must exactly match the set of
   * subagent_type values used in the compiled dist/commands/{name}.md output.
   * Guarded by registry-integrity.test.ts Guard 5 (bidirectional spawn check).
   */
  agents: string[];
  /**
   * Skills OWNED by this plugin — the declaration that makes the skill exist in
   * the registry at all, and the source of its install when any selection pulls
   * it in. Guard 1/2 in registry-integrity.test.ts enforce set-completeness
   * (no orphans on disk, no declarations without a directory).
   *
   * Ownership is not usage. What this plugin installs is `skills ∪ requires`.
   */
  skills: string[];
  /**
   * Skills this plugin USES but does not own — the rest of its install closure.
   *
   * D-SCOPED-SKILLS: skills became plugin-scoped (rules already were, agents and
   * commands always have been), so a selection now has to name everything it
   * needs. This field is HAND-DECLARED rather than derived: the corpus contains
   * one reference that no mechanical scan can resolve (`devflow:{focus}`, see
   * {@link TEMPLATE_SKILL_REFS}), so a generated closure would be incomplete by
   * construction, and splitting the prohibition from its exemption across two
   * mechanisms is the shape PF-067 exists to keep out.
   *
   * The table is EVIDENCE-DERIVED and bidirectionally guarded
   * (tests/guards/requires-closure.test.ts) over the corpus a selection actually
   * installs: `dist/commands/*.md` ∪ agent sources ∪ `SKILL.md` + `references/**`
   * of every skill already in the closure, iterated to a fixed point. Both
   * directions matter — a missing entry is a prompt pointing at an absent skill,
   * an unreferenced entry is a skill the user installs for no reason.
   *
   * Never contains a {@link FEATURE_OWNED_SKILLS} entry (the feature installs
   * those) nor a {@link PRESENCE_GATED_SKILLS} entry (those are probed for).
   */
  requires: readonly string[];
  /** Optional plugins are not installed by default — require explicit --plugin flag */
  optional?: boolean;
  /** Rules installed from this plugin (flat .md files in ~/.claude/rules/devflow/) */
  rules: string[];
}

/**
 * Available Devflow plugins
 */
export const DEVFLOW_PLUGINS: PluginDefinition[] = [
  {
    name: 'devflow-core-skills',
    description: 'Auto-activating quality enforcement skills - foundation layer for all Devflow plugins',
    commands: [],
    /**
     * Hook-spawned agents live here, and `commands: []` above is why that works.
     *
     * Guard 5 reverse (registry-integrity.test.ts, "declared agents are spawned")
     * skips a plugin whose commands spawn nothing — `if (spawned.size === 0)
     * continue` — and this plugin ships no commands at all. So `learning` and
     * `tracker`, which are spawned by a SessionStart directive rather than by any
     * command, satisfy the reverse check STRUCTURALLY.
     *
     * Recorded because the alternative looks equivalent and is not: adding either
     * name to an exemption list would make the guard pass by being told to ignore
     * them, which is the vacuous-guard trap this repo polices everywhere else. If
     * this plugin ever gains a command, the right fix is a new commands-less
     * plugin for the hook-spawned agents — never an exemption.
     *
     * Neither agent may gain a `_roster.mds` row: that file is asserted
     * set-equal, both directions, against the `agentType` values present in
     * dist/commands/, and a hook-spawned agent appears in none of them.
     */
    agents: ['learning', 'tracker'],
    skills: ['apply-decisions', 'apply-feature-knowledge', 'software-design', 'docs-framework', 'git', 'boundary-validation', 'test-driven-development', 'testing', 'dependency-research'],
    requires: [
      'architecture',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'documentation',
      'performance',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'worktree-support',
    ],
    rules: ['security', 'engineering', 'quality', 'reliability'],
  },
  {
    name: 'devflow-plan',
    description: 'Unified design planning with gap analysis and design review',
    commands: ['/plan'],
    agents: ['git', 'skim', 'synthesize', 'design'],
    skills: ['gap-analysis', 'design-review', 'patterns', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge'],
    requires: [
      'apply-decisions',
      'architecture',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'docs-framework',
      'documentation',
      'git',
      'performance',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'software-design',
      'test-driven-development',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow - accepts plan documents, issues, or task descriptions',
    commands: ['/implement'],
    agents: ['git', 'code', 'simplify', 'scrutinize', 'evaluate', 'test', 'validate', 'knowledge'],
    skills: ['patterns', 'qa', 'quality-gates', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge'],
    requires: [
      'apply-decisions',
      'architecture',
      'boundary-validation',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'dependency-research',
      'documentation',
      'git',
      'performance',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'software-design',
      'test-driven-development',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-code-review',
    description: 'Comprehensive code review with parallel specialized agents',
    commands: ['/code-review'],
    agents: ['git', 'review', 'synthesize'],
    skills: ['architecture', 'complexity', 'consistency', 'database', 'dependencies', 'documentation', 'performance', 'regression', 'reliability', 'review-methodology', 'security', 'testing', 'worktree-support', 'apply-feature-knowledge'],
    requires: ['apply-decisions', 'docs-framework', 'git', 'quality-gates', 'software-design'],
    rules: [],
  },
  {
    name: 'devflow-resolve',
    description: 'Process and fix code review issues with blast-radius triage, Code agent fixes, and Validate agent verification',
    commands: ['/resolve'],
    agents: ['git', 'triage', 'code', 'simplify', 'validate', 'test', 'knowledge'],
    skills: ['patterns', 'security', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge', 'apply-decisions'],
    requires: [
      'architecture',
      'boundary-validation',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'dependency-research',
      'documentation',
      'git',
      'performance',
      'qa',
      'regression',
      'reliability',
      'review-methodology',
      'software-design',
      'test-driven-development',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-debug',
    description: 'Debugging workflows with competing hypothesis investigation via parallel subagents',
    commands: ['/debug'],
    agents: ['git', 'synthesize', 'simplify', 'knowledge'],
    skills: ['git', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge'],
    requires: [
      'apply-decisions',
      'architecture',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'docs-framework',
      'documentation',
      'patterns',
      'performance',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'software-design',
      'test-driven-development',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-explore',
    description: 'Codebase exploration with structured analysis and optional knowledge base creation',
    commands: ['/explore'],
    agents: ['skim', 'synthesize', 'knowledge'],
    skills: ['worktree-support', 'apply-feature-knowledge', 'feature-knowledge'],
    requires: [
      'apply-decisions',
      'architecture',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'docs-framework',
      'documentation',
      'performance',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-research',
    description: 'Multi-type research with parallel Research agents and trust-aware synthesis',
    commands: ['/research'],
    agents: ['research', 'skim', 'synthesize', 'knowledge'],
    skills: ['worktree-support', 'apply-feature-knowledge', 'feature-knowledge', 'research-codebase', 'research-external', 'research-market', 'research-competitor', 'research-technology'],
    requires: [
      'apply-decisions',
      'architecture',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'docs-framework',
      'documentation',
      'performance',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-release',
    description: 'Adaptive project release with learned configuration',
    commands: ['/release'],
    agents: ['git', 'validate'],
    skills: ['git', 'worktree-support'],
    requires: ['testing'],
    rules: [],
  },
  {
    name: 'devflow-self-review',
    description: 'Self-review workflow: Simplify agent + Scrutinize agent for code quality',
    commands: ['/self-review'],
    agents: ['simplify', 'scrutinize', 'validate', 'knowledge'],
    skills: ['quality-gates', 'software-design', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge'],
    requires: ['apply-decisions', 'testing'],
    rules: [],
  },
  {
    name: 'devflow-bug-analysis',
    description: 'Proactive bug finding with static and semantic analysis',
    commands: ['/bug-analysis'],
    agents: ['git', 'diagnose', 'synthesize'],
    skills: [
      'apply-decisions',
      'apply-feature-knowledge',
      'complexity',
      'consistency',
      'regression',
      'reliability',
      'security',
      'worktree-support',
    ],
    requires: [
      'architecture',
      'database',
      'dependencies',
      'docs-framework',
      'documentation',
      'git',
      'performance',
      'review-methodology',
      'testing',
    ],
    rules: [],
  },
  {
    name: 'devflow-ambient',
    description: 'Orchestrator ambient mode — session charter, per-prompt reminder, plan handoff',
    commands: [],
    agents: ['code', 'validate', 'simplify', 'scrutinize', 'evaluate', 'test', 'skim', 'review', 'git', 'synthesize', 'triage', 'design', 'knowledge', 'research', 'learning'],
    skills: [
      'review-methodology',
      'security',
      'architecture',
      'performance',
      'complexity',
      'consistency',
      'reliability',
      'regression',
      'testing',
      'database',
      'dependencies',
      'documentation',
      'patterns',
      'qa',
      'worktree-support',
      'gap-analysis',
      'design-review',
      'feature-knowledge',
      'apply-feature-knowledge',
    ],
    requires: [
      'apply-decisions',
      'boundary-validation',
      'dependency-research',
      'docs-framework',
      'git',
      'quality-gates',
      'research-codebase',
      'research-competitor',
      'research-external',
      'research-market',
      'research-technology',
      'software-design',
      'test-driven-development',
    ],
    rules: [],
  },
  {
    name: 'devflow-dynamic',
    description: 'Dynamic workflow recipes - dependency-aware tickets→plan→build delivery pipeline',
    // Commands compiled from commands/*.mds at build time (build:mds).
    commands: ['/dynamic-tickets', '/dynamic-plan', '/dynamic-build', '/dynamic-profile'],
    agents: ['code', 'validate', 'simplify', 'scrutinize', 'evaluate', 'test', 'review', 'git', 'synthesize', 'knowledge', 'design'],
    skills: ['apply-decisions', 'apply-feature-knowledge', 'worktree-support', 'docs-framework'],
    requires: [
      'architecture',
      'boundary-validation',
      'complexity',
      'consistency',
      'database',
      'dependencies',
      'dependency-research',
      'design-review',
      'documentation',
      'feature-knowledge',
      'gap-analysis',
      'git',
      'patterns',
      'performance',
      'qa',
      'quality-gates',
      'regression',
      'reliability',
      'review-methodology',
      'security',
      'software-design',
      'test-driven-development',
      'testing',
    ],
    optional: true,
    rules: [],
  },
  {
    name: 'devflow-typescript',
    description: 'TypeScript language patterns - type safety, generics, utility types, type guards',
    commands: [],
    agents: [],
    skills: ['typescript'],
    requires: [],
    optional: true,
    rules: ['typescript'],
  },
  {
    name: 'devflow-react',
    description: 'React framework patterns - hooks, state management, composition, performance',
    commands: [],
    agents: [],
    skills: ['react'],
    requires: [],
    optional: true,
    rules: ['react'],
  },
  {
    name: 'devflow-accessibility',
    description: 'Web accessibility patterns - WCAG compliance, ARIA roles, keyboard navigation, focus management',
    commands: [],
    agents: [],
    skills: ['accessibility'],
    requires: [],
    optional: true,
    rules: ['accessibility'],
  },
  {
    name: 'devflow-ui-design',
    description: 'UI design patterns - typography, color systems, spacing, motion, responsive design',
    commands: [],
    agents: [],
    skills: ['ui-design'],
    requires: [],
    optional: true,
    rules: ['ui-design'],
  },
  {
    name: 'devflow-go',
    description: 'Go language patterns - error handling, interfaces, concurrency, package design',
    commands: [],
    agents: [],
    skills: ['go'],
    requires: [],
    optional: true,
    rules: ['go'],
  },
  {
    name: 'devflow-java',
    description: 'Java language patterns - records, sealed classes, composition, modern Java features',
    commands: [],
    agents: [],
    skills: ['java'],
    requires: [],
    optional: true,
    rules: ['java'],
  },
  {
    name: 'devflow-python',
    description: 'Python language patterns - type hints, protocols, dataclasses, async programming',
    commands: [],
    agents: [],
    skills: ['python'],
    requires: [],
    optional: true,
    rules: ['python'],
  },
  {
    name: 'devflow-rust',
    description: 'Rust language patterns - ownership, borrowing, error handling, type-driven design',
    commands: [],
    agents: [],
    skills: ['rust'],
    requires: [],
    optional: true,
    rules: ['rust'],
  },
];

/**
 * Deprecated plugin names from old installations.
 * Maps old name → new name for migration during init.
 */
export const LEGACY_PLUGIN_NAMES: Record<string, string> = {
  'devflow-frontend-design': 'devflow-ui-design',
  'devflow-specify': 'devflow-plan',
};

/**
 * Plugin names that have been deleted from the registry.
 * Used during init to prune stale entries from users' manifests on partial
 * reinstalls — the full-reinstall path writes installedPluginNames directly
 * and cannot carry a deleted name. Entries can be removed after 2 major versions.
 */
export const DELETED_PLUGIN_NAMES: readonly string[] = [
  'devflow-audit-claude',
  'devflow-compliance', // D-B2: converted to built-in feature (devflow compliance); skill/rule assets stay in src/assets/ under feature system management
];

/**
 * Skills owned by the feature system — not any plugin in DEVFLOW_PLUGINS.
 * These assets live in src/assets/skills/ and are managed by convergeComplianceArtifacts
 * (compliance-install.ts) rather than the plugin registry or installViaFileCopy loop.
 *
 * Used by:
 *   - uninstall.ts: union into prefixedSkillNames for full-uninstall and enumerateDryRunExtras
 *   - uninstall.ts sweepDevflowNamespaces: union into knownNames to spare devflow:compliance
 *     from the post-selective-uninstall sweep (nothing converges after selective uninstall)
 *   - skills.ts: union into allSkills for shadow/unshadow/list
 *   - tests: independent literal ['compliance'] (avoids EXCLUDED-as-oracle trap, PF-018)
 *
 * D-FO-1: FEATURE_OWNED_SKILLS must be disjoint from getAllSkillNames()
 * (guarded by plugins.test.ts FEATURE_OWNED constants describe block).
 */
export const FEATURE_OWNED_SKILLS = ['compliance'] as const satisfies readonly string[];

/**
 * Rules owned by the feature system — not any plugin in DEVFLOW_PLUGINS.
 * The compliance rule (src/assets/rules/compliance.md) is stamped and installed
 * by convergeComplianceArtifacts, not by the plugin installer.
 *
 * Used by:
 *   - rules.ts: union into allRules for shadow/unshadow/list
 *   - tests: independent literal ['compliance'] (avoids EXCLUDED-as-oracle trap, PF-018)
 *
 * D-FO-2: FEATURE_OWNED_RULES must be disjoint from getAllRuleNames()
 * (guarded by plugins.test.ts FEATURE_OWNED constants describe block).
 */
export const FEATURE_OWNED_RULES = ['compliance'] as const satisfies readonly string[];

// ── Skill-closure boundaries ──────────────────────────────────────────────────

/**
 * Skills that are REFERENCED but never REQUIRED — the presence-gated set.
 *
 * D-PRESENCE-GATED: every language/ecosystem skill ships with an optional,
 * command-less plugin, so a reference to one is a reference to something the
 * user may deliberately not have. The referencing prompts are written to probe
 * first and proceed without it — `/code-review` checks
 * `~/.claude/skills/devflow:{focus}/SKILL.md` before spawning that focus, the
 * Review and Code agents continue when the Skill invocation fails. Putting them
 * in a `requires` would reinstate the universal install for exactly the eight
 * skills the selection prompt exists to let a user decline (AC-25).
 *
 * DERIVED from the registry rather than hand-listed: a ninth language plugin is
 * presence-gated by being declared, with no second roster to remember. Guarded
 * against its own definition in tests/guards/requires-closure.test.ts.
 */
export const PRESENCE_GATED_SKILLS: readonly string[] = [
  ...new Set(
    DEVFLOW_PLUGINS
      .filter(plugin => plugin.optional === true && plugin.commands.length === 0)
      .flatMap(plugin => plugin.skills),
  ),
];

/** A skill reference written as a template, with the reason it cannot be resolved. */
export interface TemplateSkillRef {
  /** The reference exactly as it is written in the prompt. */
  readonly literal: string;
  /** Where it is written. */
  readonly site: string;
  /** Why no `requires` entry can satisfy it. */
  readonly why: string;
}

/**
 * The classified exception to the closure guard — declared HERE, at the
 * declaration site of the field it exempts, and imported by the guard.
 *
 * D-TEMPLATE-EXCEPTION (applies PF-067: one authority for a prohibition and its
 * exemptions). Every other templated reference in the corpus carries a literal
 * prefix and resolves through it — `devflow:research-{RESEARCH_TYPE}` resolves
 * because five in-scope skills start with `research-`. The Review focus skill is
 * the one reference with NO literal prefix: the whole skill name is substituted
 * at spawn time, and the substitution set spans the presence-gated language
 * skills, so there is nothing a scan or a `requires` entry could resolve it to.
 *
 * Two spellings, one exception: the command writes the placeholder it passes and
 * the agent writes the placeholder it receives.
 *
 * An entry here is NOT permission to stop thinking about the reference — the
 * guard asserts each literal still occurs in the corpus, so an exemption that
 * outlives its site fails rather than rotting.
 */
export const TEMPLATE_SKILL_REFS: readonly TemplateSkillRef[] = [
  {
    literal: 'devflow:{focus}',
    site: 'dist/commands/code-review.md (Review agent spawn prompt)',
    why: 'the whole skill name is substituted per focus; the substitution set includes presence-gated language skills',
  },
  {
    literal: 'devflow:{FOCUS}',
    site: 'src/assets/agents/review.md (the Review agent loading its own focus skill)',
    why: 'receiving half of the same substitution — the agent is told which focus it is, not which skill exists',
  },
];

// ── Feature redirect ──────────────────────────────────────────────────────────

/**
 * Plugin names (and aliases) that have been converted to built-in features.
 * These names are no longer valid plugin selections; the corresponding feature
 * is now managed via `devflow compliance` (or similar) instead.
 */
const FEATURE_REDIRECTED_NAMES: ReadonlySet<string> = new Set([
  'devflow-compliance', // B2: converted to built-in feature; manage via `devflow compliance`
  'compliance',         // shorthand alias users may type
]);

/**
 * Resolve feature redirects from a requested plugin list.
 *
 * Identifies retired plugin names (converted to built-in features), strips them
 * from the list, and returns the remaining plugins along with a notice when any
 * were found. Callers should:
 *   1. Print `notice` when present.
 *   2. Continue with `remaining` (pass to parsePluginSelection).
 *   3. Exit only when `remaining` is empty (nothing else to install/uninstall).
 *
 * This prevents a mixed --plugin list like `devflow-implement,devflow-compliance`
 * from silently no-oping: the compliance redirect fires, the notice is emitted,
 * and devflow-implement is still installed/uninstalled correctly.
 */
export function resolveFeatureRedirect(
  requested: string[],
): { redirected: string[]; remaining: string[]; notice?: string } {
  const redirected: string[] = [];
  const remaining: string[] = [];
  for (const name of requested) {
    if (FEATURE_REDIRECTED_NAMES.has(name)) {
      redirected.push(name);
    } else {
      remaining.push(name);
    }
  }
  const notice = redirected.length > 0
    ? 'compliance is now a built-in feature — manage it with `devflow compliance`'
    : undefined;
  return { redirected, remaining, notice };
}

/**
 * Parse a comma-separated plugin selection string into normalized plugin names.
 * Validates against known plugins; returns invalid names as errors.
 *
 * D-MOVE: moved from src/cli/commands/init.ts so uninstall can share it
 * without creating a command→command import cycle.
 */
export function parsePluginSelection(
  input: string,
  validPlugins: PluginDefinition[],
): { selected: string[]; invalid: string[] } {
  const selected = input.split(',').map(raw => {
    const trimmed = raw.trim();
    const normalized = trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
    return LEGACY_PLUGIN_NAMES[normalized] ?? normalized;
  });

  const validNames = validPlugins.map(pl => pl.name);
  const invalid = selected.filter(name => !validNames.includes(name));
  return { selected, invalid };
}

/**
 * Deprecated command names from old installations.
 * Used during init to clean up stale command files on upgrade.
 */
export const LEGACY_COMMAND_NAMES: readonly string[] = [
  'review',
  'specify',
  'specify-teams',
];

/**
 * Derive unique command names (without leading /) from all plugins.
 * Returns one entry per distinct command, preserving DEVFLOW_PLUGINS declaration order.
 */
export function getAllCommandNames(): string[] {
  const commands = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const cmd of plugin.commands) {
      commands.add(cmd.startsWith('/') ? cmd.slice(1) : cmd);
    }
  }
  return [...commands];
}

/**
 * Derive unique skill names from all plugins.
 */
export function getAllSkillNames(): string[] {
  const skills = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const skill of plugin.skills) {
      skills.add(skill);
    }
  }
  return [...skills];
}

/**
 * Derive unique agent names from all plugins.
 */
export function getAllAgentNames(): string[] {
  const agents = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const agent of plugin.agents) {
      agents.add(agent);
    }
  }
  return [...agents];
}

/**
 * Build maps of unique assets to their source plugin (first plugin that declares them).
 * This ensures each skill/agent is copied only once during installation.
 */
export function buildAssetMaps(plugins: PluginDefinition[]): {
  skillsMap: Map<string, string>;
  agentsMap: Map<string, string>;
} {
  const skillsMap = new Map<string, string>();
  const agentsMap = new Map<string, string>();
  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      if (!skillsMap.has(skill)) {
        skillsMap.set(skill, plugin.name);
      }
    }
    for (const agent of plugin.agents) {
      if (!agentsMap.has(agent)) {
        agentsMap.set(agent, plugin.name);
      }
    }
  }
  return { skillsMap, agentsMap };
}

/**
 * The install closure of a plugin selection: everything those plugins own plus
 * everything they use.
 *
 * ONE spelling of `skills ∪ requires`, because every consumer that spells it
 * inline is a place the two halves can be forgotten apart: the installer's
 * install set, its removal set, the skills-list scope and the closure guard all
 * read this. Pure, order-independent, no I/O.
 */
export function skillsOf(plugins: readonly PluginDefinition[]): Set<string> {
  const skills = new Set<string>();
  for (const plugin of plugins) {
    for (const skill of plugin.skills) skills.add(skill);
    for (const skill of plugin.requires) skills.add(skill);
  }
  return skills;
}

/**
 * Every plugin that OWNS a skill, in registry order.
 *
 * D-ALL-OWNERS: returns all declarers, not the first — `devflow skills list`'s
 * owner column becomes a lie the moment install is scoped, because the answer a
 * user needs from it is "which plugin do I select to keep this?", and a
 * first-wins answer names one plugin out of several that would each do. Empty
 * for a skill no plugin owns, which for a registry-valid name cannot happen:
 * a `requires` entry is guarded to be a known skill, and a known skill is one
 * some plugin declares.
 */
export function skillOwners(name: string): string[] {
  return DEVFLOW_PLUGINS.filter(plugin => plugin.skills.includes(name)).map(plugin => plugin.name);
}

/**
 * Build the skill → source-plugin map for a SELECTION.
 *
 * The key set is the selection's closure ({@link skillsOf}); the value is the
 * plugin the skill is copied on behalf of. A skill the selection only REQUIRES
 * has no owner among the selected plugins, so its owner is resolved from the
 * full registry ({@link skillOwners}) — the map's value is a provenance label,
 * and labelling a required skill with the plugin that happens to need it would
 * misattribute ownership.
 */
export function buildScopedSkillsMap(plugins: readonly PluginDefinition[]): Map<string, string> {
  const skillsMap = new Map<string, string>();
  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      if (!skillsMap.has(skill)) skillsMap.set(skill, plugin.name);
    }
  }
  for (const skill of skillsOf(plugins)) {
    if (skillsMap.has(skill)) continue;
    const owner = skillOwners(skill)[0];
    if (owner !== undefined) skillsMap.set(skill, owner);
  }
  return skillsMap;
}

/**
 * Build a skills map over the WHOLE registry.
 *
 * The scoped map applied to every plugin: `skills ∪ requires` across the full
 * registry is `skills` across the full registry, since a `requires` entry is
 * always some plugin's owned skill. Retained for the consumers that legitimately
 * want every skill regardless of selection — uninstall's removal manifest and
 * `devflow skills list`'s catalogue.
 */
export function buildFullSkillsMap(): Map<string, string> {
  return buildScopedSkillsMap(DEVFLOW_PLUGINS);
}

/** What a selection installs, what it removes, and which shadows it leaves inert. */
export interface SkillInstallPlan {
  /** Skills to install — the selection's closure. */
  readonly install: ReadonlySet<string>;
  /** Skills to remove because no selected plugin owns or requires them. */
  readonly remove: ReadonlySet<string>;
  /** Shadowed skills outside the install set: kept on disk, applied to nothing. */
  readonly dormantShadows: readonly string[];
}

/**
 * Decide the skill install/remove/dormant sets for one run — pure, no fs.
 *
 * H4: extracted so the decision is unit-testable without a temp tree, and so
 * `installViaFileCopy` consumes a decision rather than growing a fourth set of
 * inline set-arithmetic.
 *
 * The removal set is GATED on a full install. A `--plugin=X` run is a request to
 * add X, not a statement that X is the whole selection, so it may never remove
 * what another plugin contributed (AC-22). {@link FEATURE_OWNED_SKILLS} is
 * subtracted unconditionally: those install and uninstall with their feature,
 * and sweeping them here would delete an artifact this code does not own
 * (applies ADR-024).
 *
 * A shadow is NEVER removed, whatever the selection — `~/.devflow/skills/` is
 * user content. One that falls outside the install set simply applies to
 * nothing, and is reported so the user can tell "inert" from "ignored".
 */
export function resolveSkillInstallPlan(input: {
  readonly effectivePlugins: readonly PluginDefinition[];
  readonly isPartialInstall: boolean;
  /** Bare skill names with a shadow directory under `~/.devflow/skills/`. */
  readonly shadowedSkills: readonly string[];
}): SkillInstallPlan {
  const install = skillsOf(input.effectivePlugins);

  const remove = new Set<string>();
  if (!input.isPartialInstall) {
    for (const skill of skillsOf(DEVFLOW_PLUGINS)) {
      if (install.has(skill)) continue;
      if ((FEATURE_OWNED_SKILLS as readonly string[]).includes(skill)) continue;
      remove.add(skill);
    }
  }

  const dormantShadows = [...new Set(input.shadowedSkills)]
    .filter(skill => !install.has(skill))
    .sort();

  return { install, remove, dormantShadows };
}

/**
 * Derive unique rule names from all plugins.
 */
export function getAllRuleNames(): string[] {
  const rules = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const rule of plugin.rules) {
      rules.add(rule);
    }
  }
  return [...rules].sort();
}

/**
 * Rule names must be lowercase letters, digits, and hyphens only.
 * Defense-in-depth: prevents path traversal if names ever come from
 * non-static sources (e.g., manifest reads or user overrides).
 */
export function isValidRuleName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name);
}

/**
 * Build a map of rule name → owner plugin for SELECTED plugins only.
 * Rules are plugin-scoped (unlike skills which install from all plugins).
 * First plugin to declare a rule wins.
 * Throws if any rule name fails the isValidRuleName check — catches
 * misconfigured `DEVFLOW_PLUGINS` rules entries at map-build time rather than at
 * path-construction time.
 */
export function buildRulesMap(plugins: PluginDefinition[]): Map<string, string> {
  const rulesMap = new Map<string, string>();
  for (const plugin of plugins) {
    for (const rule of plugin.rules) {
      if (!isValidRuleName(rule)) {
        throw new Error(`Invalid rule name "${rule}" in plugin "${plugin.name}": must match /^[a-z0-9-]+$/`);
      }
      if (!rulesMap.has(rule)) {
        rulesMap.set(rule, plugin.name);
      }
    }
  }
  return rulesMap;
}

/**
 * Deprecated rule names from old installations.
 * Used during init to clean up stale rule files on upgrade.
 *
 * Pruning: entries can be removed after 2 major versions.
 */
export const LEGACY_RULE_NAMES: readonly string[] = [];

/**
 * Canonical display order for workflow commands shown at end of init.
 * Mirrors the user-facing pipeline: research → explore → plan → implement →
 * code-review → resolve → self-review → bug-analysis → debug → release →
 * dynamic pipeline (dynamic-tickets → dynamic-plan → dynamic-build → dynamic-profile).
 * Export so init.ts can import it rather than keeping a local copy.
 */
export const WORKFLOW_ORDER: readonly string[] = [
  '/research', '/explore', '/plan', '/implement',
  '/code-review', '/resolve', '/self-review', '/bug-analysis',
  '/debug', '/release',
  '/dynamic-tickets', '/dynamic-plan', '/dynamic-build', '/dynamic-profile',
];

/**
 * Plugin names excluded from the init multiselect buckets.
 * These are always installed regardless of user selection:
 *   - devflow-core-skills  (always installed, non-optional)
 *   - devflow-ambient      (always installed, non-optional)
 *
 * Invariant: EXCLUDED ∩ optional === ∅ — no optional plugin may be excluded from
 * the init UI without a re-init carry mechanism to preserve it across full reinstalls.
 * Guarded by the structural invariant test in tests/plugins.test.ts.
 */
export const EXCLUDED: ReadonlySet<string> = new Set(['devflow-core-skills', 'devflow-ambient']);

/**
 * Partition the selectable plugins into workflow (command-bearing) and language
 * (command-less, optional language/ecosystem) buckets for the two-step init UI.
 *
 * Excluded from both buckets (not selectable at init):
 *   - devflow-core-skills  (always installed)
 *   - devflow-ambient      (always installed)
 *
 * Pure function — does not mutate the input array; preserves DEVFLOW_PLUGINS
 * ordering within each bucket; deterministic; no I/O.
 */
export function partitionSelectablePlugins(plugins: PluginDefinition[]): {
  workflow: PluginDefinition[];
  language: PluginDefinition[];
} {
  const workflow: PluginDefinition[] = [];
  const language: PluginDefinition[] = [];

  for (const plugin of plugins) {
    if (EXCLUDED.has(plugin.name)) continue;
    if (plugin.commands.length > 0) {
      workflow.push(plugin);
    } else {
      // "language" bucket: command-less selectable plugins — language/ecosystem
      // plugins (typescript, go, etc.).
      // If a command-less plugin needs a distinct install group, add a category field.
      language.push(plugin);
    }
  }

  return { workflow, language };
}
