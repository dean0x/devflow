/** Target-specific cleanup lists for legacy ~/.claude artifacts. */

/**
 * Deprecated agent names from old installations.
 * Used during init to clean up stale agent files on upgrade.
 */
export const LEGACY_AGENT_NAMES: string[] = [
  'shepherd',
  'resolver', // retired in favour of Triager + Coder-as-fixer split
  'dream',    // renamed to 'learning' in commit 8 of rename-dream-to-learning
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
export const LEGACY_SKILLS_V2: string[] = [
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
];

/**
 * v2.x: incremental additions across the v2 minor series.
 * Bare entries (no devflow: prefix) = skills that shipped pre-namespace only
 * (dcecda3, 2026-03-30). Skills born after namespacing must not appear bare here.
 */
export const LEGACY_SKILLS_V2X: string[] = [
  // v2.x knowledge index pattern: old bare name for cleanup
  'apply-knowledge',
  // v2.x kb→knowledge rename: old namespaced skill names for cleanup
  'devflow:feature-kb',
  'devflow:apply-feature-kb',
  // v2.x kb→knowledge rename: old bare names for pre-namespace installs
  'feature-kb',
  'apply-feature-kb',
  // v2.x knowledge→decisions rename: old namespaced skill names for cleanup
  'devflow:apply-knowledge',
  'devflow:knowledge-persistence',
  // v2.x knowledge→decisions rename: old bare name for cleanup
  'decisions-format',
  // v2.x research + release: old orch names for cleanup
  'research:orch',
  'release:orch',
  // v2.x guided skill split: bare names for pre-namespace installs
  'implement:guided',
  'debug:guided',
  'explore:guided',
  'plan:guided',
  'review:guided',
  'research:guided',
  'release:guided',
  // v2.x triage skills: old bare names for cleanup
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
  // v3.x dream per-task skills: bare and namespaced names for cleanup
  'dream-memory',
  'dream-knowledge',
  'dream-decisions',
  'dream-curation',
  'devflow:dream-memory',
  'devflow:dream-knowledge',
  'devflow:dream-decisions',
  'devflow:dream-curation',
  // v3.x agent-teams removal: namespaced name for cleanup of installed devflow:agent-teams skill
  'devflow:agent-teams',
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
