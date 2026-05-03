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
}

/**
 * Available Devflow plugins
 */
export const DEVFLOW_PLUGINS: PluginDefinition[] = [
  {
    name: 'devflow-core-skills',
    description: 'Auto-activating quality enforcement skills - foundation layer for all Devflow plugins',
    commands: [],
    agents: [],
    skills: ['apply-decisions', 'apply-feature-kb', 'software-design', 'docs-framework', 'git', 'boundary-validation', 'research', 'test-driven-development', 'testing'],
  },
  {
    name: 'devflow-plan',
    description: 'Unified design planning with gap analysis and design review',
    commands: ['/plan'],
    agents: ['git', 'skimmer', 'synthesizer', 'designer', 'knowledge'],
    skills: ['agent-teams', 'gap-analysis', 'design-review', 'patterns', 'worktree-support', 'feature-kb', 'apply-feature-kb'],
  },
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow - accepts plan documents, issues, or task descriptions',
    commands: ['/implement'],
    agents: ['git', 'coder', 'simplifier', 'scrutinizer', 'evaluator', 'tester', 'validator'],
    skills: ['agent-teams', 'patterns', 'qa', 'quality-gates', 'worktree-support', 'apply-feature-kb'],
  },
  {
    name: 'devflow-code-review',
    description: 'Comprehensive code review with parallel specialized agents',
    commands: ['/code-review'],
    agents: ['git', 'reviewer', 'synthesizer'],
    skills: ['agent-teams', 'architecture', 'complexity', 'consistency', 'database', 'dependencies', 'documentation', 'performance', 'regression', 'review-methodology', 'security', 'testing', 'worktree-support', 'apply-feature-kb'],
  },
  {
    name: 'devflow-resolve',
    description: 'Process and fix code review issues with risk assessment',
    commands: ['/resolve'],
    agents: ['git', 'resolver', 'simplifier'],
    skills: ['agent-teams', 'patterns', 'security', 'worktree-support', 'apply-feature-kb'],
  },
  {
    name: 'devflow-debug',
    description: 'Debugging workflows with competing hypothesis investigation using agent teams',
    commands: ['/debug'],
    agents: ['git', 'synthesizer'],
    skills: ['agent-teams', 'git', 'worktree-support', 'apply-feature-kb'],
  },
  {
    name: 'devflow-explore',
    description: 'Codebase exploration with structured analysis and optional KB creation',
    commands: ['/explore'],
    agents: ['skimmer', 'synthesizer', 'knowledge'],
    skills: ['agent-teams', 'worktree-support', 'apply-feature-kb', 'feature-kb'],
  },
  {
    name: 'devflow-self-review',
    description: 'Self-review workflow: Simplifier + Scrutinizer for code quality',
    commands: ['/self-review'],
    agents: ['simplifier', 'scrutinizer', 'validator'],
    skills: ['quality-gates', 'software-design', 'worktree-support', 'apply-feature-kb'],
  },
  {
    name: 'devflow-ambient',
    description: 'Ambient mode — intent classification with proportional agent orchestration',
    commands: ['/ambient'],
    agents: ['coder', 'validator', 'simplifier', 'scrutinizer', 'evaluator', 'tester', 'skimmer', 'reviewer', 'git', 'synthesizer', 'resolver', 'designer', 'knowledge'],
    skills: [
      'router',
      'implement:orch',
      'debug:orch',
      'explore:orch',
      'plan:orch',
      'review:orch',
      'resolve:orch',
      'pipeline:orch',
      'review-methodology',
      'security',
      'architecture',
      'performance',
      'complexity',
      'consistency',
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
      'feature-kb',
      'apply-feature-kb',
    ],
  },
  {
    name: 'devflow-audit-claude',
    description: 'Audit CLAUDE.md files against Anthropic best practices',
    commands: ['/audit-claude'],
    agents: ['claude-md-auditor'],
    skills: [],
    optional: true,
  },
  {
    name: 'devflow-typescript',
    description: 'TypeScript language patterns - type safety, generics, utility types, type guards',
    commands: [],
    agents: [],
    skills: ['typescript'],
    optional: true,
  },
  {
    name: 'devflow-react',
    description: 'React framework patterns - hooks, state management, composition, performance',
    commands: [],
    agents: [],
    skills: ['react'],
    optional: true,
  },
  {
    name: 'devflow-accessibility',
    description: 'Web accessibility patterns - WCAG compliance, ARIA roles, keyboard navigation, focus management',
    commands: [],
    agents: [],
    skills: ['accessibility'],
    optional: true,
  },
  {
    name: 'devflow-ui-design',
    description: 'UI design patterns - typography, color systems, spacing, motion, responsive design',
    commands: [],
    agents: [],
    skills: ['ui-design'],
    optional: true,
  },
  {
    name: 'devflow-go',
    description: 'Go language patterns - error handling, interfaces, concurrency, package design',
    commands: [],
    agents: [],
    skills: ['go'],
    optional: true,
  },
  {
    name: 'devflow-java',
    description: 'Java language patterns - records, sealed classes, composition, modern Java features',
    commands: [],
    agents: [],
    skills: ['java'],
    optional: true,
  },
  {
    name: 'devflow-python',
    description: 'Python language patterns - type hints, protocols, dataclasses, async programming',
    commands: [],
    agents: [],
    skills: ['python'],
    optional: true,
  },
  {
    name: 'devflow-rust',
    description: 'Rust language patterns - ownership, borrowing, error handling, type-driven design',
    commands: [],
    agents: [],
    skills: ['rust'],
    optional: true,
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
 */
export const LEGACY_SKILL_NAMES: string[] = [
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
  // v2.x plan plugin: new skills bare names for pre-namespace installs
  'gap-analysis',
  'design-review',
  // v2.x knowledge index pattern: new shared skill bare name for pre-namespace installs
  'apply-knowledge',
  // v2.x feature knowledge bases: new skills bare names for pre-namespace installs
  'feature-kb',
  'apply-feature-kb',
  // v2.x knowledge→decisions rename: old namespaced skill names for cleanup
  'devflow:apply-knowledge',
  'devflow:knowledge-persistence',
  // v2.x knowledge→decisions rename: current bare name for pre-namespace installs
  'apply-decisions',
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
  ['ambient-router', 'router'],
  ['implementation-orchestration', 'implement:orch'],
  ['debug-orchestration', 'debug:orch'],
  ['plan-orchestration', 'plan:orch'],
  ['review-orchestration', 'review:orch'],
  ['resolve-orchestration', 'resolve:orch'],
  ['pipeline-orchestration', 'pipeline:orch'],
  ['implement', 'implement:orch'],
  ['debug', 'debug:orch'],
  ['explore', 'explore:orch'],
  ['plan', 'plan:orch'],
  ['review', 'review:orch'],
  ['resolve', 'resolve:orch'],
  ['pipeline', 'pipeline:orch'],
  ['self-review', 'quality-gates'],
  ['implementation-patterns', 'patterns'],
  ['search-first', 'research'],
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
 * Skills are tiny markdown files — always install all of them so orchestration
 * skills (review, resolve) can spawn agents that
 * depend on skills from other plugins.
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
