/**
 * Shared plugin registry — single source of truth for all CLI commands.
 */

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
 * Available DevFlow plugins
 */
export const DEVFLOW_PLUGINS: PluginDefinition[] = [
  {
    name: 'devflow-core-skills',
    description: 'Auto-activating quality enforcement (foundation layer)',
    commands: [],
    agents: [],
    skills: ['accessibility', 'core-patterns', 'docs-framework', 'frontend-design', 'git-safety', 'git-workflow', 'github-patterns', 'input-validation', 'react', 'test-patterns', 'typescript'],
  },
  {
    name: 'devflow-specify',
    description: 'Interactive feature specification',
    commands: ['/specify'],
    agents: ['skimmer', 'synthesizer'],
    skills: ['agent-teams'],
  },
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow',
    commands: ['/implement'],
    agents: ['git', 'skimmer', 'synthesizer', 'coder', 'simplifier', 'scrutinizer', 'shepherd', 'validator'],
    skills: ['accessibility', 'agent-teams', 'frontend-design', 'implementation-patterns', 'self-review'],
  },
  {
    name: 'devflow-code-review',
    description: 'Comprehensive code review',
    commands: ['/code-review'],
    agents: ['git', 'reviewer', 'synthesizer'],
    skills: ['accessibility', 'agent-teams', 'architecture-patterns', 'complexity-patterns', 'consistency-patterns', 'database-patterns', 'dependencies-patterns', 'documentation-patterns', 'frontend-design', 'performance-patterns', 'react', 'regression-patterns', 'review-methodology', 'security-patterns', 'test-patterns'],
  },
  {
    name: 'devflow-resolve',
    description: 'Process and fix review issues',
    commands: ['/resolve'],
    agents: ['git', 'resolver', 'simplifier'],
    skills: ['agent-teams', 'implementation-patterns', 'security-patterns'],
  },
  {
    name: 'devflow-debug',
    description: 'Debugging with competing hypotheses',
    commands: ['/debug'],
    agents: ['git'],
    skills: ['agent-teams', 'git-safety'],
  },
  {
    name: 'devflow-self-review',
    description: 'Self-review workflow (Simplifier + Scrutinizer)',
    commands: ['/self-review'],
    agents: ['simplifier', 'scrutinizer', 'validator'],
    skills: ['self-review', 'core-patterns'],
  },
  {
    name: 'devflow-audit-claude',
    description: 'Audit CLAUDE.md files against Anthropic best practices',
    commands: ['/audit-claude'],
    agents: ['claude-md-auditor'],
    skills: [],
    optional: true,
  },
];

/**
 * Deprecated command names from old installations.
 * Used during init to clean up stale command files on upgrade.
 */
export const LEGACY_COMMAND_NAMES: string[] = [
  'review',
];

/**
 * Deprecated skill names from old installations (prefixed with devflow-).
 * Used during uninstall to clean up legacy installs.
 */
export const LEGACY_SKILL_NAMES: string[] = [
  'devflow-core-patterns',
  'devflow-review-methodology',
  'devflow-docs-framework',
  'devflow-git-safety',
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
