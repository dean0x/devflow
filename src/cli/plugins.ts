/**
 * Shared plugin registry — single source of truth for all CLI commands.
 */

/**
 * Namespace prefix for Devflow skills installed to ~/.claude/skills/.
 * Skills are installed as `devflow:{skill-name}` to avoid collisions with
 * other plugin ecosystems. Source dirs in shared/skills/ stay unprefixed.
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
  agents: string[];
  skills: string[];
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
    // The Dream agent lives here (always-installed foundation plugin) because the
    // session-start-context hook spawns Agent(subagent_type="Dream") unconditionally
    // for the decisions/knowledge/curation subsystems — independent of whether
    // the ambient plugin is installed. Declaring it only in devflow-ambient would break
    // the dream subsystem under `devflow init --no-ambient` (agents install per selected
    // plugin, unlike skills which install universally). Predecessor was the universally
    // installed `devflow:sidecar` skill; core-skills preserves that guarantee.
    agents: ['dream'],
    skills: ['apply-decisions', 'apply-feature-knowledge', 'software-design', 'docs-framework', 'git', 'boundary-validation', 'test-driven-development', 'testing', 'dependency-research', 'dream-decisions', 'dream-knowledge', 'dream-curation'],
    rules: ['security', 'engineering', 'quality', 'reliability'],
  },
  {
    name: 'devflow-plan',
    description: 'Unified design planning with gap analysis and design review',
    commands: ['/plan'],
    agents: ['git', 'skimmer', 'synthesizer', 'designer', 'knowledge'],
    skills: ['agent-teams', 'gap-analysis', 'design-review', 'patterns', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow - accepts plan documents, issues, or task descriptions',
    commands: ['/implement'],
    agents: ['git', 'coder', 'simplifier', 'scrutinizer', 'evaluator', 'tester', 'validator'],
    skills: ['agent-teams', 'patterns', 'qa', 'quality-gates', 'worktree-support', 'apply-feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-code-review',
    description: 'Comprehensive code review with parallel specialized agents',
    commands: ['/code-review'],
    agents: ['git', 'reviewer', 'synthesizer'],
    skills: ['agent-teams', 'architecture', 'complexity', 'consistency', 'database', 'dependencies', 'documentation', 'performance', 'regression', 'reliability', 'review-methodology', 'security', 'testing', 'worktree-support', 'apply-feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-resolve',
    description: 'Process and fix code review issues with risk assessment',
    commands: ['/resolve'],
    agents: ['git', 'resolver', 'simplifier'],
    skills: ['agent-teams', 'patterns', 'security', 'worktree-support', 'apply-feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-debug',
    description: 'Debugging workflows with competing hypothesis investigation using agent teams',
    commands: ['/debug'],
    agents: ['git', 'synthesizer'],
    skills: ['agent-teams', 'git', 'worktree-support', 'apply-feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-explore',
    description: 'Codebase exploration with structured analysis and optional knowledge base creation',
    commands: ['/explore'],
    agents: ['skimmer', 'synthesizer', 'knowledge'],
    skills: ['agent-teams', 'worktree-support', 'apply-feature-knowledge', 'feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-research',
    description: 'Multi-type research with parallel researchers and trust-aware synthesis',
    commands: ['/research'],
    agents: ['researcher', 'skimmer', 'synthesizer', 'knowledge'],
    skills: ['agent-teams', 'worktree-support', 'apply-feature-knowledge', 'feature-knowledge', 'research-codebase', 'research-external', 'research-market', 'research-competitor', 'research-technology'],
    rules: [],
  },
  {
    name: 'devflow-release',
    description: 'Adaptive project release with learned configuration',
    commands: ['/release'],
    agents: ['git', 'synthesizer', 'validator'],
    skills: ['agent-teams', 'git', 'worktree-support'],
    rules: [],
  },
  {
    name: 'devflow-self-review',
    description: 'Self-review workflow: Simplifier + Scrutinizer for code quality',
    commands: ['/self-review'],
    agents: ['simplifier', 'scrutinizer', 'validator'],
    skills: ['quality-gates', 'software-design', 'worktree-support', 'apply-feature-knowledge'],
    rules: [],
  },
  {
    name: 'devflow-bug-analysis',
    description: 'Proactive bug finding with static and semantic analysis',
    commands: ['/bug-analysis'],
    agents: ['git', 'bug-analyzer', 'synthesizer'],
    skills: [
      'agent-teams',
      'apply-decisions',
      'apply-feature-knowledge',
      'complexity',
      'consistency',
      'regression',
      'reliability',
      'security',
      'worktree-support',
    ],
    rules: [],
  },
  {
    name: 'devflow-ambient',
    description: 'Keyword + plan auto-detection',
    commands: ['/ambient'],
    agents: ['coder', 'validator', 'simplifier', 'scrutinizer', 'evaluator', 'tester', 'skimmer', 'reviewer', 'git', 'synthesizer', 'resolver', 'designer', 'knowledge', 'researcher', 'dream'],
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
    rules: [],
  },
  {
    name: 'devflow-audit-claude',
    description: 'Audit CLAUDE.md files against Anthropic best practices',
    commands: ['/audit-claude'],
    agents: ['claude-md-auditor'],
    skills: [],
    optional: true,
    rules: [],
  },
  {
    name: 'devflow-typescript',
    description: 'TypeScript language patterns - type safety, generics, utility types, type guards',
    commands: [],
    agents: [],
    skills: ['typescript'],
    optional: true,
    rules: ['typescript'],
  },
  {
    name: 'devflow-react',
    description: 'React framework patterns - hooks, state management, composition, performance',
    commands: [],
    agents: [],
    skills: ['react'],
    optional: true,
    rules: ['react'],
  },
  {
    name: 'devflow-accessibility',
    description: 'Web accessibility patterns - WCAG compliance, ARIA roles, keyboard navigation, focus management',
    commands: [],
    agents: [],
    skills: ['accessibility'],
    optional: true,
    rules: ['accessibility'],
  },
  {
    name: 'devflow-ui-design',
    description: 'UI design patterns - typography, color systems, spacing, motion, responsive design',
    commands: [],
    agents: [],
    skills: ['ui-design'],
    optional: true,
    rules: ['ui-design'],
  },
  {
    name: 'devflow-go',
    description: 'Go language patterns - error handling, interfaces, concurrency, package design',
    commands: [],
    agents: [],
    skills: ['go'],
    optional: true,
    rules: ['go'],
  },
  {
    name: 'devflow-java',
    description: 'Java language patterns - records, sealed classes, composition, modern Java features',
    commands: [],
    agents: [],
    skills: ['java'],
    optional: true,
    rules: ['java'],
  },
  {
    name: 'devflow-python',
    description: 'Python language patterns - type hints, protocols, dataclasses, async programming',
    commands: [],
    agents: [],
    skills: ['python'],
    optional: true,
    rules: ['python'],
  },
  {
    name: 'devflow-rust',
    description: 'Rust language patterns - ownership, borrowing, error handling, type-driven design',
    commands: [],
    agents: [],
    skills: ['rust'],
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
 * Deprecated command names from old installations.
 * Used during init to clean up stale command files on upgrade.
 */
export const LEGACY_COMMAND_NAMES: string[] = [
  'review',
  'specify',
  'specify-teams',
];

/**
 * Deprecated agent names from old installations.
 * Used during init to clean up stale agent files on upgrade.
 */
export const LEGACY_AGENT_NAMES: string[] = [
  'shepherd',
];

/**
 * Deprecated skill names from old installations (prefixed with devflow-).
 * Used during uninstall to clean up legacy installs.
 *
 * Pruning: entries can be removed after 2 major versions.
 * Users who skip major versions should run uninstall + reinstall.
 *
 * Organized by era to make scanning for duplicates tractable.
 */

/** Pre-v1.0.0: devflow- prefixed skill names from the original install scheme. */
const LEGACY_SKILLS_PRE_V1: string[] = [
  'devflow-core-patterns',
  'devflow-review-methodology',
  'devflow-docs-framework',
  'devflow-git-safety',
  'devflow-git-workflow',
  'devflow-github-patterns',
  'devflow-implementation-patterns',
  'devflow-codebase-navigation',
  'devflow-test-design',
  'devflow-code-smell',
  'devflow-commit',
  'devflow-pull-request',
  'devflow-input-validation',
  'devflow-self-review',
  'devflow-typescript',
  'devflow-react',
  'devflow-architecture-patterns',
  'devflow-complexity-patterns',
  'devflow-consistency-patterns',
  'devflow-database-patterns',
  'devflow-dependencies-patterns',
  'devflow-documentation-patterns',
  'devflow-performance-patterns',
  'devflow-regression-patterns',
  'devflow-security-patterns',
  'devflow-tests-patterns',
  'devflow-pattern-check',
  'devflow-error-handling',
  'devflow-debug',
  'devflow-accessibility',
  'devflow-frontend-design',
  'devflow-agent-teams',
  // v1.0.0 consolidation: old unprefixed names from pre-v1.0.0 installs
  'codebase-navigation',
  'test-design',
  'code-smell',
  'commit',
  'pull-request',
  'tests-patterns',
];

/** v2.0.0: bare names and prefixed old names from the namespace migration. */
const LEGACY_SKILLS_V2: string[] = [
  // v2.0.0 namespace migration: bare names from pre-namespace installs
  'core-patterns',
  'docs-framework',
  'git-safety',
  'git-workflow',
  'github-patterns',
  'input-validation',
  'search-first',
  'test-driven-development',
  'test-patterns',
  'agent-teams',
  'implementation-patterns',
  'knowledge-persistence',
  'self-review',
  'worktree-support',
  'architecture-patterns',
  'complexity-patterns',
  'consistency-patterns',
  'database-patterns',
  'dependencies-patterns',
  'documentation-patterns',
  'performance-patterns',
  'regression-patterns',
  'review-methodology',
  'security-patterns',
  'ambient-router',
  'implementation-orchestration',
  'debug-orchestration',
  'plan-orchestration',
  'review-orchestration',
  'resolve-orchestration',
  'pipeline-orchestration',
  'typescript',
  'react',
  'accessibility',
  'frontend-design',
  'go',
  'java',
  'python',
  'rust',
  // v2.0.0 skill renames: prefixed old names for cleanup
  'devflow:security-patterns',
  'devflow:test-patterns',
  'devflow:performance-patterns',
  'devflow:core-patterns',
  'devflow:input-validation',
  'devflow:architecture-patterns',
  'devflow:frontend-design',
  // v2.0.0 skill renames: new bare names (for pre-namespace installs that had old-name → new-name)
  'git',
  'software-design',
  'boundary-validation',
  'testing',
  'architecture',
  'performance',
  'security',
  'ui-design',
  'complexity',
  'consistency',
  'regression',
  'database',
  'dependencies',
  'documentation',
  // v2.0.0 new skills: bare names for pre-namespace installs
  'qa',
  // v2.0.0 git consolidation: prefixed old names for cleanup
  'devflow:git-safety',
  'devflow:git-workflow',
  'devflow:github-patterns',
  // v2.0.0 skill renames: prefixed old names for the 6 remaining -patterns suffix removals
  'devflow:complexity-patterns',
  'devflow:consistency-patterns',
  'devflow:regression-patterns',
  'devflow:database-patterns',
  'devflow:dependencies-patterns',
  'devflow:documentation-patterns',
  // v2.0.0 ambient refinements: old names → short names
  'devflow:ambient-router',
  'devflow:implementation-orchestration',
  'devflow:debug-orchestration',
  'devflow:plan-orchestration',
  'devflow:review-orchestration',
  'devflow:resolve-orchestration',
  'devflow:pipeline-orchestration',
  'devflow:implementation-patterns',
  'devflow:search-first',
  // v2.0.0 ambient refinements: new bare names for pre-namespace installs
  'explore',
  'router',
  'implement',
  'debug',
  'plan',
  'review',
  'resolve',
  'pipeline',
  'patterns',
  'research',
  'devflow:research',
  // v2.0.0 orch rename: prefixed short names for cleanup
  'devflow:implement',
  'devflow:debug',
  'devflow:explore',
  'devflow:plan',
  'devflow:review',
  'devflow:resolve',
  'devflow:pipeline',
  // v2.0.0 self-review → quality-gates rename
  'devflow:self-review',
  // v2.0.0 orch rename: bare :orch names for pre-namespace installs
  'implement:orch',
  'debug:orch',
  'explore:orch',
  'plan:orch',
  'review:orch',
  'resolve:orch',
  'pipeline:orch',
  // v2.0.0 quality-gates: bare name for pre-namespace installs
  'quality-gates',
];

/** v2.x: incremental additions across the v2 minor series. */
const LEGACY_SKILLS_V2X: string[] = [
  // v2.x plan plugin: new skills bare names for pre-namespace installs
  'gap-analysis',
  'design-review',
  // v2.x knowledge index pattern: new shared skill bare name for pre-namespace installs
  'apply-knowledge',
  // v2.x feature knowledge bases: bare names for pre-namespace installs (current names)
  'feature-knowledge',
  'apply-feature-knowledge',
  // v2.x kb→knowledge rename: old namespaced skill names for cleanup
  'devflow:feature-kb',
  'devflow:apply-feature-kb',
  // v2.x kb→knowledge rename: old bare names for pre-namespace installs
  'feature-kb',
  'apply-feature-kb',
  // v2.x knowledge→decisions rename: old namespaced skill names for cleanup
  'devflow:apply-knowledge',
  'devflow:knowledge-persistence',
  // v2.x knowledge→decisions rename: current bare names for pre-namespace installs
  'apply-decisions',
  'decisions-format',
  // v2.x research + release: new bare names for pre-namespace installs
  'research-codebase',
  'research-external',
  'research-market',
  'research-competitor',
  'research-technology',
  'research:orch',
  'release:orch',
  // v2.x research → dependency-research rename: bare name for pre-namespace installs
  'dependency-research',
  // v2.x guided skill split: bare names for pre-namespace installs
  'implement:guided',
  'debug:guided',
  'explore:guided',
  'plan:guided',
  'review:guided',
  'research:guided',
  'release:guided',
  // v2.x reliability: bare name for pre-namespace installs
  'reliability',
  // v2.x triage skills: bare names for pre-namespace installs
  'implement:triage',
  'debug:triage',
  'explore:triage',
  'plan:triage',
  'review:triage',
  'research:triage',
  'release:triage',
  // v2.x sidecar system: bare name for pre-namespace installs
  'sidecar',
  // v3.x dream rename: namespaced sidecar skill name for cleanup on upgrade
  'devflow:sidecar',
  // v2.x ambient simplification: devflow:-prefixed orch names for cleanup
  'devflow:implement:orch',
  'devflow:debug:orch',
  'devflow:explore:orch',
  'devflow:plan:orch',
  'devflow:review:orch',
  'devflow:resolve:orch',
  'devflow:pipeline:orch',
  'devflow:research:orch',
  'devflow:release:orch',
  // v3.x dream per-task skills: bare names for pre-namespace installs
  'dream-memory',
  'dream-decisions',
  'dream-knowledge',
  'dream-curation',
  // v3.x dream-memory removal: namespaced name for cleanup of installed devflow:dream-memory skill
  'devflow:dream-memory',
  // v2.x ambient refinements: devflow:-prefixed triage/guided/router names for cleanup
  'devflow:router',
  'devflow:implement:triage',
  'devflow:implement:guided',
  'devflow:debug:triage',
  'devflow:debug:guided',
  'devflow:explore:triage',
  'devflow:explore:guided',
  'devflow:plan:triage',
  'devflow:plan:guided',
  'devflow:review:triage',
  'devflow:review:guided',
  'devflow:research:triage',
  'devflow:research:guided',
  'devflow:release:triage',
  'devflow:release:guided',
];

export const LEGACY_SKILL_NAMES: string[] = [
  ...LEGACY_SKILLS_PRE_V1,
  ...LEGACY_SKILLS_V2,
  ...LEGACY_SKILLS_V2X,
];

/**
 * Shadow directory renames for V2 skill overhaul.
 * When users had `devflow skills shadow core-patterns`, the override lives at
 * `~/.devflow/skills/core-patterns/`. After V2, init looks for the new name.
 * This map drives migration of old shadow dirs to new names.
 */
export const SHADOW_RENAMES: [string, string][] = [
  ['git-safety', 'git'],
  ['git-workflow', 'git'],
  ['github-patterns', 'git'],
  ['core-patterns', 'software-design'],
  ['test-patterns', 'testing'],
  ['security-patterns', 'security'],
  ['architecture-patterns', 'architecture'],
  ['performance-patterns', 'performance'],
  ['input-validation', 'boundary-validation'],
  ['frontend-design', 'ui-design'],
  ['complexity-patterns', 'complexity'],
  ['consistency-patterns', 'consistency'],
  ['regression-patterns', 'regression'],
  ['database-patterns', 'database'],
  ['dependencies-patterns', 'dependencies'],
  ['documentation-patterns', 'documentation'],
  ['self-review', 'quality-gates'],
  ['implementation-patterns', 'patterns'],
  ['search-first', 'dependency-research'],
  ['research', 'dependency-research'],
];

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
 * Build a skills map from ALL plugins (regardless of selection).
 * Skills are tiny markdown files — always install all of them so commands
 * (review, resolve) can spawn agents that depend on skills from other plugins.
 */
export function buildFullSkillsMap(): Map<string, string> {
  const skillsMap = new Map<string, string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const skill of plugin.skills) {
      if (!skillsMap.has(skill)) {
        skillsMap.set(skill, plugin.name);
      }
    }
  }
  return skillsMap;
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
 * misconfigured plugin.json entries at map-build time rather than at
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
export const LEGACY_RULE_NAMES: string[] = [];

/**
 * Canonical display order for workflow commands shown at end of init.
 * Mirrors the user-facing pipeline: research → explore → plan → implement →
 * code-review → resolve → self-review → bug-analysis → debug → release → audit-claude.
 * Export so init.ts can import it rather than keeping a local copy.
 */
export const WORKFLOW_ORDER: string[] = [
  '/research', '/explore', '/plan', '/implement',
  '/code-review', '/resolve', '/self-review', '/bug-analysis',
  '/debug', '/release', '/audit-claude',
];

/**
 * Partition the selectable plugins into workflow (command-bearing) and language
 * (command-less, optional language/ecosystem) buckets for the two-step init UI.
 *
 * Excluded from both buckets (not selectable at init):
 *   - devflow-core-skills  (always installed)
 *   - devflow-ambient      (always installed)
 *   - devflow-audit-claude (installable via --plugin only)
 *
 * Pure function — does not mutate the input array; preserves DEVFLOW_PLUGINS
 * ordering within each bucket; deterministic; no I/O.
 */
export function partitionSelectablePlugins(plugins: PluginDefinition[]): {
  workflow: PluginDefinition[];
  language: PluginDefinition[];
} {
  const EXCLUDED = new Set(['devflow-core-skills', 'devflow-ambient', 'devflow-audit-claude']);
  const workflow: PluginDefinition[] = [];
  const language: PluginDefinition[] = [];

  for (const plugin of plugins) {
    if (EXCLUDED.has(plugin.name)) continue;
    if (plugin.commands.length > 0) {
      workflow.push(plugin);
    } else {
      // "language" bucket: today every command-less selectable plugin is a
      // language/ecosystem plugin. If a non-language command-less plugin is
      // added in the future, it will land here — update the bucket name or
      // add an explicit category field at that point.
      language.push(plugin);
    }
  }

  return { workflow, language };
}
