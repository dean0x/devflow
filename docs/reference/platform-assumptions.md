# Platform Assumptions

Assumptions about Claude Code behaviour that devflow agents and tests rely on but cannot assert through code alone.
Grounding: empirical observation or upstream documentation, with a date stamp and a drift symptom so a future maintainer
can detect silently broken assumptions before they cause hard-to-diagnose failures.

| Assumption | Date verified | Observable symptom if it drifts |
|---|---|---|
| Subagents cannot call `AskUserQuestion` | 2026-09-05 | A subagent that contains an `AskUserQuestion` call exits immediately with a tool-not-available error; the calling orchestrator treats it as a failed spawn rather than a user interaction. |
| Omitting `tools:` in frontmatter inherits **all** tools, including connected MCP servers | 2026-09-05 | A subagent with no `tools:` frontmatter can reach MCP-provided tools; restricting to a subset requires an explicit allowlist. If this drifts, MCP-heavy agents (e.g. git.md) silently lose tool access without error. |
| Preloaded `skills:` inject full SKILL.md content **per spawn** | 2026-09-05 | Every subagent spawn that lists a skill in its `skills:` frontmatter receives the full content of that skill's SKILL.md as part of its context. If this drifts, skills degrade to no-ops and guard strings like `devflow:X already running` may trigger spuriously (PF-002). |
| `allowed-tools` is a **pre-approval** gate, not a restriction | 2026-09-05 | Tools listed in `allowed-tools` are approved without prompting; tools omitted still appear in the agent's tool set and prompt for permission. If this drifts (becomes a restriction), agents with narrow allowlists lose access to unlisted tools entirely rather than just gaining silent approval for listed ones. |
| Claude Code Bash-tool result truncation limit | `# UNMEASURED` | When a Bash command produces more output than the truncation limit, the result is silently clipped. Phase-3 `--emit` mode relies on this threshold for its byte-budget check (`DR-06`); measure and fill before Phase 3 ships. |
