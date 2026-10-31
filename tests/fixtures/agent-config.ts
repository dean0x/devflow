/**
 * The shipped agent-configuration table — the single place a test reads "what
 * does devflow ship for this agent?" from.
 *
 * Every file that needs a shipped value imports it from here:
 *
 *   - tests/guards/agent-config.test.ts  pins every row against the agent's
 *     frontmatter, and holds the denylist, the preload sets and the tool/body
 *     arm to it;
 *   - tests/curate-agent.test.ts       pins the Curate row;
 *   - tests/decisions/config.test.ts     pins the tuning module's default model
 *     to the Curate row.
 *
 * One table instead of one copy per file is what lets a shipped tier change be
 * an edit to a row, with the frontmatter line it describes, and nothing else.
 *
 * D-OMIT-CLAUDEMD-SET: twelve agents ship `omitClaudeMd: true`: Validate, Git, Triage,
 * Evaluate, Test, Research, Knowledge, Tracker, Curate, Skim, Synthesize and Explore.
 * Code, Harden and Polish keep CLAUDE.md, because they write or rewrite code to the
 * project's conventions; Review, Design and Debug are not in the set. A live probe (Claude Code 2.1.296) found that the flag drops BOTH the CLAUDE.md files and
 * `~/.claude/rules/**`, where devflow installs its rules (`~/.claude/rules/devflow/*.md`):
 * an agent without the flag carries an `instructions` attachment of CLAUDE.md plus the rule
 * files, an agent with it carries none. That attachment is about 7K tokens per spawn in this
 * repository, billed again on every turn of every spawn. The flag therefore costs those
 * agents the rules, and the in-body CORE_RULES_DIGEST replaces them: each omitting agent
 * body carries exactly the digest lines its row declares, and
 * tests/guards/core-rules-digest.test.ts holds the bodies to the rows. An agent whose body
 * needs more of CLAUDE.md than the digest states reads it itself (Curate does).
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

/** The id of one line of the core-rules digest. */
export type DigestKey = 'context-economy' | 'untrusted-input' | 'no-secrets' | 'escape-output' | 'bounded-loops';

/** One digest line and the rule-file phrases it restates. */
export interface DigestEntry {
  /** The exact line an agent body carries, as a bullet under its `## Core rules` heading. */
  readonly line: string;
  /**
   * Distinctive phrases of the line, each of which has to appear verbatim in the line and in
   * a file under src/assets/rules/. A digest line whose phrase leaves the rules is a rule
   * devflow no longer states, and the guard reports it.
   */
  readonly phrases: readonly string[];
}

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
  /**
   * The CORE_RULES_DIGEST lines the agent's body carries, in body order. Empty exactly when
   * the agent keeps CLAUDE.md and the rules (`omitClaudeMd` false): an agent that omits them
   * declares at least the line it relies on most.
   */
  readonly digest: readonly DigestKey[];
}

/**
 * D-SHARED-DENYLIST: the orchestration and host-UI tools that no worker agent
 * needs. One list, spelled exactly, with no wildcard: a wildcard in
 * `disallowedTools` removes MCP names, and the denylist agents that keep their
 * user-environment MCP and web access (Code and Research) must not lose
 * them, so every name is written out. A denied name the runtime does not expose
 * is assumed to be a no-op. Git and Tracker are not denylist agents: they hold an
 * allowlist and reach their tracker servers through whole-server entries the installer
 * stamps (D-GIT-ROW, D-TRACKER-ROW).
 *
 * Code and Research deny exactly this list. Harden and Polish deny it plus
 * `Skill`, and `mcp__*` as their own `extra` (D-SCAN-IN-CODE): the only wildcards
 * a denylist may hold, which MCP_DENY_AGENTS names. `Artifact`, `ListAgents` and
 * `ReportFindings` appear on the registry observed while the table was drafted
 * but not on the approved list, so they are not here.
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

/**
 * D-SCAN-IN-CODE: the code-scanning tool runs in the Code agent, once per changed file
 * before its final commit, so the two agents that review Code's work deny every MCP tool
 * instead of loading a scanner's tool set into each of their spawns. `mcp__*` is the one
 * wildcard a denylist may hold, and only these two agents may hold it.
 */
export const MCP_DENY_AGENTS: readonly string[] = ['harden', 'polish'];

/**
 * D-CORE-RULES-DIGEST: the core rules an agent that omits the rules keeps in its own body.
 * `omitClaudeMd` drops `~/.claude/rules/devflow/*.md` with CLAUDE.md (D-OMIT-CLAUDEMD-SET),
 * so a rule an agent still works by is restated in that agent's body. This map is the single
 * source: a body carries exactly the lines its row declares, byte for byte, as bullets under
 * one `## Core rules` heading, and every line restates text that is still in a rule file,
 * so a digest cannot keep a rule devflow dropped or invent one it never had.
 *
 * Only core rules (`security`, `context-economy`, `reliability`) have a line. The language
 * rules (`typescript`, `python`, ...) stay with the agents that write code in them, and the
 * quiet-form guidance Validate follows is its own Validation Order table.
 */
export const CORE_RULES_DIGEST: Readonly<Record<DigestKey, DigestEntry>> = {
  'context-economy': {
    line: 'Never print a large file whole; page it with offset and limit, and cap any output you print. Before printing search matches, list or count them.',
    phrases: [
      'Never print a large file whole; page it with offset and limit, and cap any output you print',
      'Before printing search matches, list or count them',
    ],
  },
  'untrusted-input': {
    line: 'Assume all input is malicious. Validate and sanitize at every trust boundary.',
    phrases: ['Assume all input is malicious', 'Validate and sanitize at every trust boundary'],
  },
  'no-secrets': {
    line: 'No hardcoded secrets, tokens, or credentials — use environment variables.',
    phrases: ['No hardcoded secrets, tokens, or credentials — use environment variables'],
  },
  'escape-output': {
    line: 'Escape output for its context (HTML, URL, SQL, shell).',
    phrases: ['Escape output for its context (HTML, URL, SQL, shell)'],
  },
  'bounded-loops': {
    line: 'All loops and retries must have a fixed upper bound — no unbounded while(true) or infinite pagination.',
    phrases: ['All loops and retries must have a fixed upper bound — no unbounded while(true) or infinite pagination'],
  },
};

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
 * preload of every registered agent. Each agent's frontmatter is the
 * sole authority for these values at runtime; this table is the pin that holds the
 * frontmatter to the decision. `_roster.mds` carries no effort column, and its
 * model tiers are held to the same frontmatter by the roster guard in
 * tests/agent-name-guards.test.ts.
 *
 * Departures from the plan's tool table, each decided:
 *  - Design gains `Skill`: the /plan compliance-focus spawn tells the agent to
 *    load the compliance skill before analysing (D-COMPLIANCE-INJECT), and that
 *    load needs the tool.
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
 * the five pattern skills from Debug (now loaded on demand, see
 * DEBUG_FOCUS_SKILLS) and `apply-decisions` from Curate.
 */
export const AGENT_CONFIG: Readonly<Record<string, AgentConfigRow>> = {
  code: {
    model: 'sonnet',
    effort: 'high',
    policy: { kind: 'deny', extra: [] },
    omitClaudeMd: false,
    skills: null,
    digest: [],
  },
  /**
   * D-VARIANT-SLUGS: Fix and Refactor are their own `devflow agents` slugs, shipped with
   * Code's model, effort and tool policy. A user override of `code` does not reach them, because the
   * installed frontmatter of each variant is the authority for its own tier. Their preloads are held
   * by tests/guards/code-preload.test.ts, which is why `skills` is not pinned here.
   */
  fix: {
    model: 'sonnet',
    effort: 'high',
    policy: { kind: 'deny', extra: [] },
    omitClaudeMd: false,
    skills: null,
    digest: [],
  },
  refactor: {
    model: 'sonnet',
    effort: 'high',
    policy: { kind: 'deny', extra: [] },
    omitClaudeMd: false,
    skills: null,
    digest: [],
  },
  harden: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'deny', extra: ['Skill', 'mcp__*'] },
    omitClaudeMd: false,
    skills: ['quality-gates', 'software-design', 'worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
    digest: [],
  },
  polish: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'deny', extra: ['Skill', 'mcp__*'] },
    omitClaudeMd: false,
    skills: ['software-design', 'worktree-support'],
    digest: [],
  },
  research: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'deny', extra: [] },
    omitClaudeMd: true,
    skills: ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
    digest: ['context-economy', 'untrusted-input'],
  },
  /**
   * D-REVIEW-SHIPPED-ROW: Review ships opus at high effort. An A/B run of the
   * /code-review focus agents over two seeded PRs found every seeded bug at high
   * that it found at xhigh, for a little over half the cost, so xhigh buys nothing
   * here. The row and the `effort:` line of review.md move together.
   */
  review: {
    model: 'opus',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'Skill', 'StructuredOutput'] },
    omitClaudeMd: false,
    skills: ['review-methodology', 'worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
    digest: [],
  },
  triage: {
    model: 'opus',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
    omitClaudeMd: true,
    skills: ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
    digest: ['context-economy', 'untrusted-input'],
  },
  /**
   * D-EVALUATE-SHIPPED-ROW: Evaluate ships sonnet at medium effort. Its Opus tier
   * had no recorded rationale. The subagent baseline measured 44 Evaluate spawns,
   * every one on Opus, and 3.1% of all subagent cache-equivalent tokens (report
   * .devflow/docs/research/token-diet-subagents/report.2026-10-10_0256.md). The
   * check compares a diff against a plan and a request, which fits the Sonnet tier
   * Code and Test already ship. The row, the `model:` line of evaluate.md and the
   * dynamic roster table move together.
   */
  evaluate: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'] },
    omitClaudeMd: true,
    skills: ['worktree-support', 'apply-feature-knowledge'],
    digest: ['context-economy', 'untrusted-input'],
  },
  design: {
    model: 'opus',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'Skill', 'StructuredOutput'] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-decisions', 'gap-analysis', 'apply-feature-knowledge'],
    digest: [],
  },
  /**
   * D-DESIGN-VARIANTS: Architect is the plan-writing and anti-pattern-review variant of Design.
   * It preloads only the design-review mode skill, and Design only gap-analysis, so no spawn
   * loads a mode skill it does not run.
   */
  architect: {
    model: 'opus',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write'] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-decisions', 'design-review', 'apply-feature-knowledge'],
    digest: [],
  },
  debug: {
    model: 'opus',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Skill'] },
    omitClaudeMd: false,
    skills: ['worktree-support', 'apply-decisions', 'apply-feature-knowledge'],
    digest: [],
  },
  test: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'allow', tools: TEST_TOOLS },
    omitClaudeMd: true,
    skills: ['qa', 'worktree-support'],
    digest: ['context-economy', 'untrusted-input', 'no-secrets', 'escape-output'],
  },
  knowledge: {
    model: 'sonnet',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'] },
    omitClaudeMd: true,
    skills: ['feature-knowledge', 'apply-decisions', 'worktree-support'],
    digest: ['context-economy', 'untrusted-input', 'no-secrets'],
  },
  /**
   * D-LEARNING-SHIPPED-ROW: Curate keeps the model and the absent effort that main ships,
   * and omits CLAUDE.md and the rules. An A/B run over frozen batches decided the tier: the
   * cheaper candidate (sonnet at high effort) fell clearly short of the capture bar, and the
   * opus-at-medium fallback came in just under it. Series 2's other changes stay: no preload
   * and the same Read/Bash/Glob/Grep tools.
   *
   * The same A/B showed that without the injected CLAUDE.md context Curate stops retiring
   * entries as Encoded, because its Encoded check compares a lesson against the rule that
   * already states it. The explicit Read replaces that context: Curate reads the root
   * CLAUDE.md and the installed rule files itself, once per run, before its first
   * already-encoded comparison (the Inputs section of curate.md; tests/curate-agent.test.ts
   * holds the step and its position). A change of tier is an edit to this row and to the
   * `model:` and `effort:` lines of curate.md, and the default model in
   * src/core/curate-tuning-config.ts, which tests/decisions/config.test.ts holds equal to
   * this row.
   */
  curate: {
    model: 'opus',
    effort: null,
    policy: { kind: 'allow', tools: ['Read', 'Bash', 'Glob', 'Grep'] },
    omitClaudeMd: true,
    skills: [],
    digest: ['context-economy', 'untrusted-input'],
  },
  validate: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Bash', 'Read', 'Grep', 'Glob'] },
    omitClaudeMd: true,
    skills: ['worktree-support'],
    digest: ['context-economy', 'untrusted-input'],
  },
  synthesize: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'StructuredOutput'] },
    omitClaudeMd: true,
    skills: ['worktree-support'],
    digest: ['context-economy', 'untrusted-input', 'no-secrets'],
  },
  skim: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Bash', 'Read'] },
    omitClaudeMd: true,
    skills: ['worktree-support'],
    digest: ['context-economy'],
  },
  /**
   * D-EXPLORE-ROW: Explore is devflow's override of the Explore agent built into
   * Claude Code (D-EXPLORE-OVERRIDE in src/targets/claude-code/agent-type-owner.ts
   * holds the precedence rule, the version it was read from, and why the install
   * never beside-installs over a user's own Explore). The built-in inherits the
   * session model: the baseline measured 81 Explore spawns, 98% of them on Opus at a
   * median 11.9K tokens of starting context. The override runs them on Sonnet at
   * high effort, read-only (Read and Bash: the other search tools are withheld from
   * an agent that holds Bash), and omits CLAUDE.md and the rules, as the built-in
   * does. The override applies to every session on the machine, plan mode included,
   * and uninstalling devflow restores the built-in. The row, the frontmatter of
   * explore.md and the parity checklist in tests/explore-agent.test.ts move together.
   */
  explore: {
    model: 'sonnet',
    effort: 'high',
    policy: { kind: 'allow', tools: ['Read', 'Bash'] },
    omitClaudeMd: true,
    skills: [],
    digest: ['context-economy'],
  },
  /**
   * D-GIT-ROW: Git keeps haiku at medium effort (the Git agent split's frontmatter change,
   * #425) and holds an ALLOWLIST: the built-in tools its operation bodies and the references
   * they load direct. Bash runs `git`, `gh` and the helper scripts; Read opens the
   * conventions, summary and mechanics files; Write composes a body to a temp file; ToolSearch
   * loads a tracker server's deferred tool schemas. No body edits a file in place, so Edit is
   * not granted. Grep and Glob are withheld because Claude Code does not offer them to an
   * agent that holds Bash, so the Git bodies search with Bash commands. The earlier row was a
   * denylist, kept so the user's tracker tool servers stayed callable; the allowlist replaces
   * it and those servers come back through the install-time stamp (D-TRACKER-SERVER-ALLOWLIST,
   * src/targets/claude-code/tracker-servers.ts). The shipped list therefore names no server:
   * this row pins that vendor-neutral half, and tests/tracker-servers.test.ts pins the
   * stamped half. tests/guards/provider-scope.test.ts holds the list to the bodies. Model and
   * effort stay overridable through `devflow agents`.
   */
  git: {
    model: 'haiku',
    effort: 'medium',
    policy: { kind: 'allow', tools: ['Bash', 'Read', 'Write', 'ToolSearch'] },
    omitClaudeMd: true,
    skills: ['git', 'worktree-support'],
    digest: ['context-economy', 'untrusted-input', 'no-secrets'],
  },
  /**
   * D-TRACKER-ROW: Tracker is a deliberate constant: its model is pinned equal to the
   * session-start hook that spawns it (`TRACKER_MODEL`; tests/guards/agent-config.test.ts holds
   * this row equal to both the hook literal and `loadShippedAgentDefaults()['tracker'].model`),
   * and it ships no effort line. It holds an allowlist of the built-in tools its body directs:
   * Bash for the claim, the history sampling and the one scrub-gated write chain, Read for the
   * file it opens, ToolSearch to load a tracker server's tool schemas. It has no Write: its one
   * file is written by that Bash chain, and a Write tool would be a second way to write outside
   * it. Its tracker servers are stamped at install like Git's (D-TRACKER-SERVER-ALLOWLIST), and a
   * name no connected server answers to surfaces as `TRACEABILITY: DEGRADED (no tracker tool for
   * {capability})`. It works with the issue tracker's text, which it treats as untrusted, writes
   * one scrubbed file and runs a bounded scan: the digest says so.
   */
  tracker: {
    model: 'sonnet',
    effort: null,
    policy: { kind: 'allow', tools: ['Bash', 'Read', 'ToolSearch'] },
    omitClaudeMd: true,
    skills: ['git'],
    digest: ['context-economy', 'untrusted-input', 'no-secrets', 'bounded-loops'],
  },
};

/**
 * The agents that ship `omitClaudeMd: true`, each with the digest lines its body carries.
 * Derived from the table rows that omit CLAUDE.md, never listed, so a new omitting row is
 * covered without an edit here.
 */
export function deriveOmitDigests(
  table: Readonly<Record<string, AgentConfigRow>>,
): ReadonlyMap<string, readonly DigestKey[]> {
  const out = new Map<string, readonly DigestKey[]>();
  for (const [name, row] of Object.entries(table)) {
    if (row.omitClaudeMd) out.set(name, row.digest);
  }
  return out;
}

/** The live omitting set: AGENT_CONFIG through deriveOmitDigests. */
export const OMIT_CLAUDE_MD_DIGESTS: ReadonlyMap<string, readonly DigestKey[]> = deriveOmitDigests(AGENT_CONFIG);

/**
 * D-DIAGNOSE-FOCUS-SKILLS: the pattern skills the Debug agent loads on demand
 * for each focus, now that none is preloaded. The mapping is the agent's Focus
 * Areas table, held literally. `complexity` is mapped to `functional` because
 * it would otherwise load under no focus.
 */
export const DEBUG_FOCUS_SKILLS: Readonly<Record<string, readonly string[]>> = {
  security: ['security'],
  functional: ['regression', 'reliability', 'complexity'],
  integration: ['regression', 'consistency'],
  usability: ['consistency', 'reliability'],
};
