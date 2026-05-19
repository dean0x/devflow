# DevFlow Consistency Audit Report

**Branch**: feat/project-knowledge-99
**Date**: 2026-03-14

---

## 1. Commands Audit

### 1.1 Frontmatter Consistency

| Command | File | `description` | `name` | `user-invocable` | `allowed-tools` |
|---------|------|:---:|:---:|:---:|:---:|
| `/audit-claude` | `plugins/devflow-audit-claude/commands/audit-claude.md` | MISSING | MISSING | MISSING | MISSING |
| `/ambient` | `plugins/devflow-ambient/commands/ambient.md` | YES | MISSING | MISSING | MISSING |
| `/self-review` | `plugins/devflow-self-review/commands/self-review.md` | YES | MISSING | MISSING | MISSING |
| `/code-review` | `plugins/devflow-code-review/commands/code-review.md` | YES | MISSING | MISSING | MISSING |
| `/code-review` (teams) | `plugins/devflow-code-review/commands/code-review-teams.md` | YES | MISSING | MISSING | MISSING |
| `/debug` | `plugins/devflow-debug/commands/debug.md` | YES | MISSING | MISSING | MISSING |
| `/debug` (teams) | `plugins/devflow-debug/commands/debug-teams.md` | YES | MISSING | MISSING | MISSING |
| `/implement` | `plugins/devflow-implement/commands/implement.md` | YES | MISSING | MISSING | MISSING |
| `/implement` (teams) | `plugins/devflow-implement/commands/implement-teams.md` | YES | MISSING | MISSING | MISSING |
| `/resolve` | `plugins/devflow-resolve/commands/resolve.md` | YES | MISSING | MISSING | MISSING |
| `/resolve` (teams) | `plugins/devflow-resolve/commands/resolve-teams.md` | YES | MISSING | MISSING | MISSING |
| `/specify` | `plugins/devflow-specify/commands/specify.md` | YES | MISSING | MISSING | MISSING |
| `/specify` (teams) | `plugins/devflow-specify/commands/specify-teams.md` | YES | MISSING | MISSING | MISSING |

**Findings:**

- **[MEDIUM] F-CMD-01: No command has `name` in frontmatter.** 12 of 13 commands have `description` in YAML frontmatter, but none have `name`. This is a minor gap since Claude derives the command name from the file name, but adding `name` would be more explicit.

- **[HIGH] F-CMD-02: `/audit-claude` is the only command without YAML frontmatter.** It has no `---` delimited frontmatter block at all. All other commands use YAML frontmatter with at least `description`. This is an inconsistency.

- **[LOW] F-CMD-03: No commands declare `user-invocable` or `allowed-tools` in frontmatter.** The conventions doc mentions these as expected fields, but Claude Code commands do not actually support `user-invocable` and `allowed-tools` in command frontmatter (those are agent frontmatter fields). This is a documentation mismatch -- the "expected frontmatter" in the task description does not match the Claude plugins format, which only supports `description` for commands. This is NOT a bug in the commands; the audit criteria were overly broad.

---

### 1.2 Teams Variants -- Orphan Check

| Base Command | Base `.md` exists | Teams `-teams.md` exists | Status |
|-------------|:-:|:-:|--------|
| `code-review` | YES | YES | OK |
| `debug` | YES | YES | OK |
| `implement` | YES | YES | OK |
| `resolve` | YES | YES | OK |
| `specify` | YES | YES | OK |
| `audit-claude` | YES | NO | OK (no teams variant by design) |
| `ambient` | YES | NO | OK (no teams variant by design) |
| `self-review` | YES | NO | OK (no teams variant by design) |

**Finding: No orphaned teams variants detected.** Every `-teams.md` file has a matching base `.md` file. This aligns with the CLAUDE.md rule: "Every `-teams.md` command variant **must** have a matching base `.md` file."

---

### 1.3 Orchestration-Only Pattern

All commands should spawn agents via the Task tool, never do agent work themselves.

| Command | Spawns Agents | Does Work Itself | Verdict |
|---------|:---:|:---:|---------|
| `/audit-claude` | YES (claude-md-auditor) | Partial (Phase 1 discovery bash script) | MINOR ISSUE |
| `/ambient` | NO (by design) | YES (main session, no agents) | OK (documented exception) |
| `/self-review` | YES (Simplifier, Scrutinizer, Validator) | NO | OK |
| `/code-review` | YES (Git, Reviewer, Synthesizer) | Partial (Phase 1 file analysis) | MINOR ISSUE |
| `/code-review` (teams) | YES (Git, team members) | Partial (Phase 1 file analysis) | MINOR ISSUE |
| `/debug` | YES (Git, Explore, Synthesizer) | Partial (Phase 1 hypothesis generation) | OK (orchestrator planning) |
| `/debug` (teams) | YES (Git, team members) | Partial (Phase 1 hypothesis generation) | OK (orchestrator planning) |
| `/implement` | YES (Git, Skimmer, Explore, Synthesizer, Plan, Coder, etc.) | NO | OK |
| `/implement` (teams) | YES (Git, Skimmer, teams, Coder, etc.) | NO | OK |
| `/resolve` | YES (Git, Resolver, Simplifier, Git) | Partial (Phase 1-3 parsing and planning) | MINOR ISSUE |
| `/resolve` (teams) | YES (Git, team, Simplifier, Git) | Partial (Phase 1-3 parsing and planning) | MINOR ISSUE |
| `/specify` | YES (Skimmer, Explore, Synthesizer, Plan) | Partial (Phase 3 knowledge loading, Phase 10 gh issue) | ACCEPTABLE |
| `/specify` (teams) | YES (Skimmer, teams, Synthesizer) | Partial (Phase 3 knowledge loading, Phase 10 gh issue) | ACCEPTABLE |

**Findings:**

- **[LOW] F-CMD-04: Several commands perform lightweight analysis in the orchestrator.** `/code-review` (Phase 1 file type detection), `/resolve` (Phases 1-3 issue parsing/dependency analysis), and `/audit-claude` (Phase 1 file discovery) do work in the main session rather than delegating to agents. However, these are lightweight analysis/planning tasks that would add unnecessary overhead if delegated to agents. This is an acceptable pragmatic compromise.

- **[OK] `/ambient` is explicitly documented as a main-session-only command** that never spawns agents. This is by design and consistent with its documented principles.

---

### 1.4 Skill Loading Consistency

Commands should reference skills via "Read the skill at `~/.claude/skills/<name>/SKILL.md`" patterns.

| Command | Loads Skills Directly | Delegates Skill Loading to Agents | Verdict |
|---------|:---:|:---:|---------|
| `/audit-claude` | NO | NO (agent has its own rubric) | OK |
| `/ambient` | YES (`~/.claude/skills/ambient-router/SKILL.md`) | N/A | OK |
| `/self-review` | NO | YES (via agent frontmatter skills) | OK |
| `/code-review` | NO | YES (Reviewer loads skills per focus) | OK |
| `/code-review` (teams) | NO | YES (teammates read skills in prompt) | OK |
| `/debug` | NO | NO (Explore agents are generic) | OK |
| `/debug` (teams) | NO | NO (teammates are generic) | OK |
| `/implement` | NO | YES (Coder loads domain skills) | OK |
| `/implement` (teams) | NO | YES (teammates read skills in prompt, Coder loads domain skills) | OK |
| `/resolve` | NO | YES (Resolver has skills in frontmatter) | OK |
| `/resolve` (teams) | NO | YES (teammates read skills in prompt) | OK |
| `/specify` | NO | YES (via Skimmer, Explore, Synthesizer) | OK |
| `/specify` (teams) | NO | YES (teammates do not read skills) | ISSUE |

**Findings:**

- **[MEDIUM] F-CMD-05: `/specify-teams.md` exploration teammates do not read any skills.** The base `/specify` command delegates skill loading to agents via frontmatter. But in the teams variant, the exploration teammates (`user-perspective-explorer`, `similar-features-explorer`, `constraints-explorer`, `failure-mode-explorer`) have no skill reading instructions in their prompts. Compare with `/implement-teams.md` where exploration teammates explicitly read `~/.claude/skills/implementation-patterns/SKILL.md`. The planning teammates also lack skill references. The `/code-review-teams.md` correctly instructs all teammates to read their relevant skill files.

---

### 1.5 Agent Spawning Consistency

Commands should use `Task(subagent_type="AgentName")` patterns. Check that `subagent_type` values match the shared agent roster.

**Shared agent roster** (10): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, shepherd, scrutinizer, validator

| Command | Agent Types Used | Matching Roster | Issues |
|---------|-----------------|:---:|--------|
| `/audit-claude` | claude-md-auditor | YES (plugin-specific) | OK |
| `/ambient` | None | N/A | OK |
| `/self-review` | Simplifier, Scrutinizer, Validator | YES | OK |
| `/code-review` | Git, Reviewer, Synthesizer | YES | OK |
| `/debug` | Git, Explore (x3-5) | ISSUE | See below |
| `/debug` (teams) | Git (Task), teammates | PARTIAL | See below |
| `/implement` | Git, Skimmer, Explore (x4), Synthesizer, Plan (x3), Coder, Validator, Simplifier, Scrutinizer, Shepherd | ISSUE | See below |
| `/implement` (teams) | Git, Skimmer, Synthesizer, Coder, Validator, Simplifier, Scrutinizer, teammates | ISSUE | See below |
| `/resolve` | Git, Resolver, Simplifier | YES | OK |
| `/specify` | Skimmer, Explore (x4), Synthesizer, Plan (x3) | ISSUE | See below |
| `/specify` (teams) | Skimmer, Synthesizer, teammates | PARTIAL | OK (teams handle Explore/Plan) |

**Findings:**

- **[MEDIUM] F-CMD-06: "Explore" and "Plan" are not shared agents but are spawned via `Task(subagent_type="Explore")` and `Task(subagent_type="Plan")`.** There is no `shared/agents/explore.md` or `shared/agents/plan.md`. These appear to be "general purpose" subagent invocations that rely on Claude Code's ability to spawn unnamed agents. This is **not necessarily a bug** -- Claude Code can spawn agents with `subagent_type` pointing to a non-existent agent file, which results in a general-purpose agent with the given prompt. However, this is an inconsistency with the convention that commands should reference agents from the shared roster. This pattern is used in:
  - `/debug` (base): `Task(subagent_type="Explore", name="investigator-a")`
  - `/implement` (base): `Task(subagent_type="Explore")` (x4), `Task(subagent_type="Plan")` (x3)
  - `/specify` (base): `Task(subagent_type="Explore")` (x4), `Task(subagent_type="Plan")` (x3)

- **[MEDIUM] F-CMD-07: `/debug` (base) Phase 3 uses `Task(subagent_type="general-purpose", name="synthesizer")` instead of `Task(subagent_type="Synthesizer")`.** This spawns a generic agent rather than the dedicated Synthesizer agent. The Synthesizer agent has specific modes (exploration, planning, review) and structured output formats. Using `general-purpose` loses these capabilities. The debug-teams variant avoids this by having the lead synthesize directly.

---

## 2. Shared Agents Audit

### 2.1 Frontmatter Consistency

| Agent | `name` | `description` | `model` | `skills` | `allowed-tools` |
|-------|:---:|:---:|:---:|:---:|:---:|
| git.md | YES | YES | `haiku` | YES (3) | MISSING |
| synthesizer.md | YES | YES | `haiku` | YES (2) | MISSING |
| skimmer.md | YES | YES | `inherit` | MISSING | MISSING |
| simplifier.md | YES | YES | `inherit` | MISSING | MISSING |
| coder.md | YES | YES | `inherit` | YES (6) | MISSING |
| reviewer.md | YES | YES | `inherit` | YES (1) | MISSING |
| resolver.md | YES | YES | `inherit` | YES (4) | MISSING |
| shepherd.md | YES | YES | `inherit` | YES (1) | MISSING |
| scrutinizer.md | YES | YES | `inherit` | YES (2) | MISSING |
| validator.md | YES | YES | `haiku` | YES (1) | MISSING |

**Plugin-specific agent:**

| Agent | `name` | `description` | `model` | `skills` | `allowed-tools` |
|-------|:---:|:---:|:---:|:---:|:---:|
| claude-md-auditor.md | YES | YES | `sonnet` | MISSING | YES (`Read, Grep, Glob`) |

**Findings:**

- **[MEDIUM] F-AGT-01: Skimmer and Simplifier agents have no `skills` in frontmatter.** All other agents either declare `skills` or have a specific reason not to. Skimmer could reference `search-first` since it emphasizes pattern discovery. Simplifier could reference `core-patterns` since it applies project coding standards.

- **[LOW] F-AGT-02: No agents declare `allowed-tools` except claude-md-auditor.** This is not necessarily a violation -- agents get broad tool access by default. The claude-md-auditor explicitly restricts to `Read, Grep, Glob` because it is read-only by design. Other agents that should be read-only (like Shepherd, which "never modifies code") could benefit from similar restrictions.

- **[OK] All agents have `name`, `description`, and `model` in frontmatter.** This is consistent.

---

### 2.2 Line Count Compliance

| Agent | Lines | Target Range | Status |
|-------|------:|-------------|--------|
| simplifier.md | 61 | 50-80 (Utility) | OK |
| scrutinizer.md | 80 | 50-80 (Utility) | OK (at boundary) |
| validator.md | 86 | 50-80 (Utility) | SLIGHTLY OVER |
| skimmer.md | 92 | 50-80 (Utility) | OVER |
| shepherd.md | 94 | 80-120 (Worker) | OK |
| resolver.md | 131 | 80-120 (Worker) | SLIGHTLY OVER |
| coder.md | 135 | 80-120 (Worker) | SLIGHTLY OVER |
| reviewer.md | 165 | 80-120 (Worker) | OVER |
| synthesizer.md | 211 | 80-120 (Worker) | SIGNIFICANTLY OVER |
| git.md | 277 | 80-120 (Worker) | SIGNIFICANTLY OVER |
| claude-md-auditor.md | 134 | Plugin-specific | OK |

**Findings:**

- **[HIGH] F-AGT-03: Git agent at 277 lines significantly exceeds the 120-line Worker target.** The agent handles 7 distinct operations (ensure-pr-ready, validate-branch, setup-task, fetch-issue, comment-pr, manage-debt, create-release). Each operation has its own process and output format. Consider splitting into separate agents or extracting operation templates into a skill.

- **[HIGH] F-AGT-04: Synthesizer agent at 211 lines significantly exceeds the 120-line Worker target.** It documents 3 modes (exploration, planning, review) with detailed output templates. Consider extracting output templates to a `references/` directory or splitting by mode.

- **[MEDIUM] F-AGT-05: Reviewer agent at 165 lines exceeds the 120-line Worker target.** The confidence scale, consolidation rules, and conditional activation table add bulk. Some could be extracted to the review-methodology skill's references.

- **[LOW] F-AGT-06: Skimmer (92 lines) slightly exceeds Utility target (50-80).** The skim modes table and output template add necessary detail. Borderline -- could be trimmed slightly.

- **[LOW] F-AGT-07: Resolver (131 lines) and Coder (135 lines) slightly exceed Worker target (80-120).** Both contain essential decision logic. The risk assessment tree in Resolver and the sequential execution context in Coder justify the extra lines.

---

### 2.3 Skill References in Frontmatter

| Agent | Skills in Frontmatter | Skills Referenced in Body | Duplication? |
|-------|----------------------|--------------------------|:---:|
| git.md | github-patterns, git-safety, git-workflow | None | NO |
| synthesizer.md | review-methodology, docs-framework | None | NO |
| skimmer.md | (none) | None | N/A |
| simplifier.md | (none) | None | N/A |
| coder.md | core-patterns, git-safety, implementation-patterns, git-workflow, test-patterns, input-validation | domain skills loaded dynamically | NO |
| reviewer.md | review-methodology | Focus skill loaded dynamically | NO |
| resolver.md | core-patterns, git-safety, implementation-patterns, git-workflow | None | NO |
| shepherd.md | core-patterns | None | NO |
| scrutinizer.md | self-review, core-patterns | None | NO |
| validator.md | test-patterns | None | NO |

**Finding: No skill content duplication detected.** Agents reference skills via frontmatter and do not re-document skill content in the body. This is consistent with the anti-pattern guidelines.

---

### 2.4 Input/Output Contract Clarity

| Agent | Input Contract | Output Format | Boundaries Section |
|-------|:---:|:---:|:---:|
| git.md | YES (per operation) | YES (per operation) | YES |
| synthesizer.md | YES (mode + outputs) | YES (per mode) | YES |
| skimmer.md | YES (TASK_DESCRIPTION) | YES (structured markdown) | YES |
| simplifier.md | YES (TASK_DESCRIPTION, FILES_CHANGED) | MISSING | MISSING |
| coder.md | YES (detailed params) | YES (structured markdown) | YES |
| reviewer.md | YES (focus, branch, output path) | YES (structured markdown) | MISSING |
| resolver.md | YES (ISSUES, BRANCH, BATCH_ID) | YES (structured markdown) | YES |
| shepherd.md | YES (4 params) | YES (structured markdown) | YES (as report constraints) |
| scrutinizer.md | YES (TASK_DESCRIPTION, FILES_CHANGED) | YES (structured markdown) | YES |
| validator.md | YES (FILES_CHANGED, VALIDATION_SCOPE) | YES (structured markdown) | YES |

**Findings:**

- **[MEDIUM] F-AGT-08: Simplifier agent has no Output section and no Boundaries section.** It describes what it does but not what it produces. Other agents all have structured output templates. The Simplifier simply commits changes, but a structured report (files modified, changes made count) would help the orchestrator know what happened.

- **[LOW] F-AGT-09: Reviewer agent has no explicit Boundaries section.** It has a "Conditional Activation" table and "Principles" section but no formal "Handle autonomously / Escalate to orchestrator" boundaries like other agents.

---

### 2.5 Model Assignments

| Agent | Model | Appropriate? |
|-------|-------|:---:|
| git.md | `haiku` | YES (lightweight API calls) |
| synthesizer.md | `haiku` | POSSIBLE CONCERN |
| skimmer.md | `inherit` | YES |
| simplifier.md | `inherit` | YES (needs to modify code) |
| coder.md | `inherit` | YES (needs full capability) |
| reviewer.md | `inherit` | YES (complex analysis) |
| resolver.md | `inherit` | YES (code modification) |
| shepherd.md | `inherit` | YES (alignment analysis) |
| scrutinizer.md | `inherit` | YES (code review + fixes) |
| validator.md | `haiku` | YES (simple command execution) |
| claude-md-auditor.md | `sonnet` | YES (analysis without modification) |

**Finding:**

- **[LOW] F-AGT-10: Synthesizer uses `haiku` model.** The Synthesizer performs complex aggregation across multiple agent outputs, including confidence-aware merging, conflict resolution, and execution strategy decisions. The review mode involves reading multiple review reports and applying merge rules. While haiku may be adequate for simple synthesis, complex review synthesis with confidence calculations could benefit from a more capable model. This is a borderline case.

---

## 3. Cross-Cutting Issues

### 3.1 Plugin.json Agent and Skill Declaration Gaps

| Plugin | Agents Used by Commands | Agents in plugin.json | Missing |
|--------|------------------------|----------------------|---------|
| devflow-debug | git, Explore* | git | Explore is generic (see F-CMD-06) |
| devflow-implement | git, skimmer, synthesizer, coder, simplifier, scrutinizer, shepherd, validator, Explore*, Plan* | git, skimmer, synthesizer, coder, simplifier, scrutinizer, shepherd, validator | Explore/Plan are generic (see F-CMD-06) |
| devflow-specify | skimmer, synthesizer, Explore*, Plan* | skimmer, synthesizer | Explore/Plan are generic (see F-CMD-06) |
| devflow-code-review | git, reviewer, synthesizer | git, reviewer, synthesizer | OK |
| devflow-resolve | git, resolver, simplifier | git, resolver, simplifier | OK |
| devflow-self-review | simplifier, scrutinizer, validator | simplifier, scrutinizer, validator | OK |
| devflow-audit-claude | claude-md-auditor | (none in agents array) | OK (plugin-specific, committed directly) |
| devflow-ambient | (none) | (none) | OK |

**Finding: All formally declared agents match. "Explore" and "Plan" are not declared anywhere because they are generic Task invocations, not dedicated agent files.**

### 3.2 Knowledge Loading Consistency

Commands that load project knowledge (`.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`):

| Command | Loads Knowledge | How | Consistent |
|---------|:---:|-----|:---:|
| `/self-review` | YES | Phase 0 - reads and passes as KNOWLEDGE_CONTEXT | YES |
| `/code-review` | NO | Reviewer agent checks pitfalls independently (step 2) | DIFFERENT |
| `/code-review` (teams) | NO | Teammates instructed to read pitfalls.md | DIFFERENT |
| `/implement` | NO | Coder agent loads knowledge in step 1 (orient on branch) | DIFFERENT |
| `/implement` (teams) | NO | Exploration teammates read decisions.md + pitfalls.md | DIFFERENT |
| `/debug` | NO | No knowledge loading | ISSUE |
| `/debug` (teams) | NO | No knowledge loading | ISSUE |
| `/resolve` | NO | No knowledge loading | OK (fixes existing issues) |
| `/specify` | YES | Phase 3 - reads and passes to Explore agents | YES |
| `/specify` (teams) | YES | Phase 3 - reads and passes to teammates | YES |

**Findings:**

- **[LOW] F-CROSS-01: Knowledge loading patterns vary across commands.** Some commands load knowledge in the orchestrator and pass it (self-review, specify). Others delegate knowledge loading to agents (code-review, implement). This inconsistency is acceptable since agents have different needs, but it makes the system harder to reason about.

- **[MEDIUM] F-CROSS-02: `/debug` and `/debug-teams` do not load or check project knowledge at all.** Known pitfalls could directly relate to bugs being investigated. Investigators could benefit from seeing prior pitfall patterns. The Phase 1 context gathering step should include pitfalls.md loading.

### 3.3 Knowledge Persistence Consistency

Commands that record decisions/pitfalls via `knowledge-persistence` skill:

| Command | Records Knowledge | What | When |
|---------|:---:|------|------|
| `/code-review` | YES | Pitfalls | If blocking issues found |
| `/code-review` (teams) | YES | Pitfalls | If blocking issues found |
| `/debug` | YES | Pitfalls | If root cause found |
| `/debug` (teams) | YES | Pitfalls | If root cause found |
| `/implement` | YES | Decisions | If architectural decisions made |
| `/implement` (teams) | YES | Decisions | If architectural decisions made |
| `/resolve` | YES | Pitfalls | If issues deferred to tech debt |
| `/resolve` (teams) | YES | Pitfalls | If issues deferred to tech debt |
| `/self-review` | NO | - | - |
| `/specify` | NO | - | - |
| `/ambient` | NO | - | - |
| `/audit-claude` | NO | - | - |

**Finding: Knowledge persistence is consistently applied where it makes sense.** Self-review is a lightweight workflow focused on fixing, not recording. Specify focuses on requirements, not implementation decisions. No issues found.

---

## 4. Summary

### Commands

| ID | Severity | Description | Location |
|----|----------|-------------|----------|
| F-CMD-02 | HIGH | `/audit-claude` has no YAML frontmatter | `plugins/devflow-audit-claude/commands/audit-claude.md` |
| F-CMD-05 | MEDIUM | `/specify-teams` teammates lack skill reading instructions | `plugins/devflow-specify/commands/specify-teams.md` |
| F-CMD-06 | MEDIUM | "Explore" and "Plan" subagent types have no shared agent files | Multiple commands |
| F-CMD-07 | MEDIUM | `/debug` uses `general-purpose` instead of `Synthesizer` agent | `plugins/devflow-debug/commands/debug.md` |
| F-CMD-01 | MEDIUM | No command has `name` in frontmatter | All commands |
| F-CMD-04 | LOW | Some commands do lightweight work in orchestrator | Multiple |
| F-CMD-03 | LOW | `user-invocable`/`allowed-tools` not in command frontmatter (not supported) | N/A |

### Agents

| ID | Severity | Description | Location |
|----|----------|-------------|----------|
| F-AGT-03 | HIGH | Git agent at 277 lines, significantly over 120 limit | `shared/agents/git.md` |
| F-AGT-04 | HIGH | Synthesizer at 211 lines, significantly over 120 limit | `shared/agents/synthesizer.md` |
| F-AGT-01 | MEDIUM | Skimmer and Simplifier lack `skills` in frontmatter | `shared/agents/skimmer.md`, `shared/agents/simplifier.md` |
| F-AGT-05 | MEDIUM | Reviewer at 165 lines, over 120 limit | `shared/agents/reviewer.md` |
| F-AGT-08 | MEDIUM | Simplifier has no Output or Boundaries section | `shared/agents/simplifier.md` |
| F-CROSS-02 | MEDIUM | Debug commands do not load project knowledge | `plugins/devflow-debug/commands/debug.md`, `debug-teams.md` |
| F-AGT-02 | LOW | No agents declare `allowed-tools` (except auditor) | All shared agents |
| F-AGT-06 | LOW | Skimmer slightly over Utility line target | `shared/agents/skimmer.md` |
| F-AGT-07 | LOW | Resolver and Coder slightly over Worker line target | `shared/agents/resolver.md`, `shared/agents/coder.md` |
| F-AGT-09 | LOW | Reviewer lacks formal Boundaries section | `shared/agents/reviewer.md` |
| F-AGT-10 | LOW | Synthesizer may need stronger model for review synthesis | `shared/agents/synthesizer.md` |

### Cross-Cutting

| ID | Severity | Description |
|----|----------|-------------|
| F-CROSS-02 | MEDIUM | Debug commands should load pitfalls.md for investigators |
| F-CROSS-01 | LOW | Knowledge loading patterns inconsistent across commands |

### Totals

| Severity | Count |
|----------|------:|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 8 |
| LOW | 8 |
| **Total** | **20** |

### No Orphaned Teams Variants

All 5 `-teams.md` files have matching base `.md` files. No orphans detected.

---

## 5. Recommended Fixes (Priority Order)

### HIGH Priority

1. **F-CMD-02**: Add YAML frontmatter to `/audit-claude`:
   ```yaml
   ---
   description: Audit CLAUDE.md files against Anthropic best practices
   ---
   ```

2. **F-AGT-03**: Reduce Git agent (277 lines). Options:
   - Extract operation-specific output templates to `references/`
   - Create a `git-operations` skill with the operation details
   - Split less-common operations (create-release) into a separate agent

3. **F-AGT-04**: Reduce Synthesizer agent (211 lines). Options:
   - Extract output templates per mode to `references/`
   - Move execution strategy tables to `implementation-patterns` skill
   - Move merge rules to `review-methodology` skill

4. **F-CMD-07**: In `/debug` base command, change `Task(subagent_type="general-purpose", name="synthesizer")` to `Task(subagent_type="Synthesizer")` to use the dedicated agent.

### MEDIUM Priority

5. **F-CMD-05**: Add skill reading instructions to `/specify-teams` teammates. Each exploration teammate should read `~/.claude/skills/implementation-patterns/SKILL.md` (matching the `/implement-teams` pattern).

6. **F-AGT-01**: Add `skills` to Skimmer (`search-first`) and Simplifier (`core-patterns`) frontmatter.

7. **F-AGT-05**: Trim Reviewer agent. Move confidence scale and consolidation rules to `review-methodology` skill's `references/`.

8. **F-AGT-08**: Add Output and Boundaries sections to Simplifier agent.

9. **F-CROSS-02**: Add pitfalls.md loading to `/debug` Phase 1 and `/debug-teams` Phase 1.
