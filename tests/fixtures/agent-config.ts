/**
 * The shipped agent-configuration table — the single place a test reads "what
 * does devflow ship for this agent?" from.
 *
 * Every file that needs a shipped value imports it from here:
 *
 *   - tests/guards/agent-config.test.ts  pins every row against the agent's
 *     frontmatter, and holds the denylist, the preload sets and the tool/body
 *     arm to it;
 *   - tests/learning-agent.test.ts       pins the Learning row;
 *   - tests/decisions/config.test.ts     pins the tuning module's default model
 *     to the Learning row.
 *
 * One table instead of one copy per file is what lets a shipped tier change be
 * an edit to a row, with the frontmatter line it describes, and nothing else.
 */

import type { EffortLevel } from '../../src/core/agent-models.js';

/**
 * A tool policy. D-SHARED-DENYLIST: an agent either holds an allowlist (`tools:`)
 * or denies a list (`disallowedTools:`), never both. A denylist agent denies the
 * shared list plus its own `extra` names.
 */
export type ToolPolicy =
  | { readonly kind: 'allow'; readonly tools: readonly string[] }
  | { readonly kind: 'deny'; readonly extra: readonly string[] };

/** What one agent's shipped frontmatter must carry. */
export interface AgentConfigRow {
  /** The `model:` tier. */
  readonly model: string;
  /** The `effort:` level, or null when the frontmatter ships no `effort:` line. */
  readonly effort: EffortLevel | null;
  /** The tool policy. */
  readonly policy: ToolPolicy;
  /** True when the frontmatter carries `omitClaudeMd: true`; false when the key is absent. */
  readonly omitClaudeMd: boolean;
  /**
   * The preloaded skills, unprefixed. An empty list means the frontmatter has no
   * `skills:` key at all. null means the preload is not pinned here: Code's is
   * pinned by its own guard.
   */
  readonly skills: readonly string[] | null;
}

/**
 * D-SHARED-DENYLIST: the orchestration and host-UI tools that no worker agent
 * needs. One list, spelled exactly, with no wildcard: the research behind this
 * table says a wildcard in `disallowedTools` removes MCP names, and the agents
 * that use it (Code, Research, Scrutinize, Simplify) keep their user-environment
 * MCP and web access, so every name is written out. A denied name the runtime
 * does not expose is assumed to be a no-op.
 *
 * Code and Research deny exactly this list. Scrutinize and Simplify deny it plus
 * `Skill`. `Artifact`, `ListAgents` and `ReportFindings` appear on the registry
 * observed while the table was drafted but not on the approved list, so they are
 * not here.
 */
export const SHARED_DENYLIST: readonly string[] = [
  'Agent',
  'SendMessage',
  'NotebookEdit',
  'EnterWorktree',
  'ExitWorktree',
  'ArtifactComments',
  'ArtifactData',
  'TodoWrite',
  'AskUserQuestion',
  'TaskOutput',
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'CronList',
  'RemoteTrigger',
  'PushNotification',
  'DesignSync',
];

/** The tools Test keeps: its browser tools are part of its allowlist, unchanged. */
const TEST_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'mcp__claude-in-chrome__tabs_context_mcp',
  'mcp__claude-in-chrome__tabs_create_mcp',
  'mcp__claude-in-chrome__navigate',
  'mcp__claude-in-chrome__get_page_text',
  'mcp__claude-in-chrome__read_page',
  'mcp__claude-in-chrome__find',
  'mcp__claude-in-chrome__form_input',
  'mcp__claude-in-chrome__javascript_tool',
  'mcp__claude-in-chrome__read_console_messages',
];

/**
 * D-AGENT-CONFIG-TABLE: the shipped model, effort, tool policy, omitClaudeMd and
 * preload of the fifteen agents this table covers. Each agent's frontmatter is the
 * sole authority for these values at runtime; this table is the pin that holds the
 * frontmatter to the decision. `_roster.mds` carries no effort column, and its
 * model tiers are held to the same frontmatter by the roster guard in
 * tests/agent-name-guards.test.ts.
 *
 * Departures from the plan's tool table, each decided:
 *  - Design gains `Skill`: the gap-analysis skill tells the compliance focus to
 *    load the compliance skill before analysing, and that load needs the tool.
 *  - Design, Review and Synthesize gain `StructuredOutput`
 *    (D-STRUCTURED-RETURN-TOOL).
 *  - Evaluate gains `Write`: its report cap sends longer material to a temp file
 *    written with Write, because its Bash is git-read-only.
 *  - Validate and Test gain no `Monitor`, `ToolSearch` or `TaskStop`: no body
 *    directs any of the three, and both bodies forbid polling.
 *  - Validate and Skim keep no `Write`: their report-cap writes go to a temp
 *    file through Bash.
 *
 * D-PRELOAD-TRIM: the preloads that left, because the agent's body never reads
 * the skill: `testing` from Validate and Test, `software-design` from Evaluate,
 * the five pattern skills from Diagnose (now loaded on demand, see
 * DIAGNOSE_FOCUS_SKILLS) and `apply-decisions` from Learning.
 */
export const AGENT_CONFIG: Readonly<Record<string, AgentConfigRow>> = {
  code: {
    model: 'sonnet',
    effort: 'high',
    policy: { kind: 'deny', extra: [] },
    omitClaudeMd: false,
    skills: null,
  },
  scrutinize: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'deny', extra: ['Skill'] },
    omitClaudeMd: false,
    skills: ['quality-gates', 'software-design', 'worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
  },
  simplify: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'deny', extra: ['Skill'] },
    omitClaudeMd: false,
    skills: ['software-design', 'worktree-support'],
  },
  research: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'deny', extra: [] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
  },
  /**
   * The Review tier is gated on an A/B run of the /code-review focus agents (a
   * lower effort against the current tier). Until the verdict lands, the row keeps
   * the model and the absent effort that main ships, and takes the tool allowlist;
   * the verdict is an edit to this row and the `effort:` line of review.md.
   */
  review: {
    model: 'opus',
    effort: null,
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'Skill', 'StructuredOutput'] },
    omitClaudeMd: false,
    skills: ['review-methodology', 'worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
  },
  triage: {
    model: 'opus',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
    omitClaudeMd: false,
    skills: ['security', 'worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
  },
  evaluate: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-feature-knowledge'],
  },
  design: {
    model: 'opus',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'Skill', 'StructuredOutput'] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-decisions', 'gap-analysis', 'design-review', 'apply-feature-knowledge'],
  },
  diagnose: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Skill'] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
  },
  test: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'allow', tools: TEST_TOOLS },
    omitClaudeMd: false,
    skills: ['qa', 'worktree-support'],
  },
  knowledge: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'] },
    omitClaudeMd: false,
    skills: ['feature-knowledge', 'apply-feature-knowledge', 'apply-decisions', 'worktree-support'],
  },
  /**
   * D-LEARNING-SHIPPED-ROW: the Learning tier is gated on an A/B run of the
   * candidate (a cheaper model at a higher effort) against the current tier, over
   * frozen batches. Until the verdict lands, the row keeps the model and the
   * absent effort that main ships, together with every change the A/B does not
   * decide: no preload, `omitClaudeMd`, and the same Read/Bash/Glob/Grep tools.
   *
   * The verdict is an edit to this row, the `model:` and `effort:` lines of
   * learning.md and the default model in src/core/learning-tuning-config.ts, which
   * tests/decisions/config.test.ts holds equal to this row.
   */
  learning: {
    model: 'opus',
    effort: null,
    policy: { kind: 'allow', tools: ['Read', 'Bash', 'Glob', 'Grep'] },
    omitClaudeMd: true,
    skills: [],
  },
  validate: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Bash', 'Read', 'Grep', 'Glob'] },
    omitClaudeMd: false,
    skills: ['worktree-support'],
  },
  synthesize: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'StructuredOutput'] },
    omitClaudeMd: true,
    skills: ['review-methodology', 'docs-framework', 'worktree-support'],
  },
  skim: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Bash', 'Read'] },
    omitClaudeMd: true,
    skills: ['worktree-support'],
  },
};

/**
 * The registered agents this table does not cover, each with the reason. An agent
 * is in AGENT_CONFIG or here, never neither: a new agent has to be placed on
 * purpose.
 */
export const EXEMPT_AGENTS: Readonly<Record<string, string>> = {
  git: 'Its row waits for the Git agent split, which pays for the change from the git.md byte cut.',
  tracker: 'A deliberate constant: it declares no tool list, and its model is pinned equal to the hook that spawns it.',
};

/**
 * D-DIAGNOSE-FOCUS-SKILLS: the pattern skills the Diagnose agent loads on demand
 * for each focus, now that none is preloaded. The mapping is the agent's Focus
 * Areas table, held literally. `complexity` is mapped to `functional` because
 * it would otherwise load under no focus.
 */
export const DIAGNOSE_FOCUS_SKILLS: Readonly<Record<string, readonly string[]>> = {
  security: ['security'],
  functional: ['regression', 'reliability', 'complexity'],
  integration: ['regression', 'consistency'],
  usability: ['consistency', 'reliability'],
};
