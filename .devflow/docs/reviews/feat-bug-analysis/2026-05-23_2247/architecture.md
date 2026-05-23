# Architecture Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-23

## Issues in Your Changes (BLOCKING)

### HIGH

**BugAnalyzer agent has incomplete skill declarations vs actual usage** - `shared/agents/bug-analyzer.md:1-11`, `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:25-29`
**Confidence**: 85%
- Problem: The BugAnalyzer agent frontmatter declares skills `devflow:security`, `devflow:reliability`, `devflow:worktree-support`, `devflow:apply-decisions`, `devflow:apply-feature-knowledge`. However, the agent body references four distinct focus areas (security, functional, integration, usability) with detailed detection patterns for each. Only `devflow:security` and `devflow:reliability` are declared as pattern skills, meaning the functional, integration, and usability focus areas operate purely on inline instructions without loaded skill expertise. In contrast, the Reviewer agent loads the specific pattern skill for its focus area (e.g., `devflow:architecture`, `devflow:performance`). Additionally, the plugin.json `skills` array only lists `agent-teams`, `worktree-support`, `apply-feature-knowledge` — missing `apply-decisions` and `security` which the agent declares in frontmatter.
- Impact: The BugAnalyzer agents for functional, integration, and usability focuses run without the benefit of specialized pattern skills that exist in the system (e.g., `devflow:regression` for functional logic errors, `devflow:consistency` for integration contract checks, `devflow:accessibility` for usability). The plugin.json mismatch means the plugin manifest understates its actual skill dependencies, though this is non-blocking at runtime since skills install universally.
- Fix: Either create dedicated pattern skills for the bug-analysis focuses (functional, integration, usability) or map existing skills to the focuses. For the plugin.json, add `apply-decisions` and `security` (and `reliability`) to the skills array to accurately reflect agent dependencies:
```json
"skills": [
  "agent-teams",
  "worktree-support",
  "apply-feature-knowledge",
  "apply-decisions",
  "security",
  "reliability"
]
```

**No ambient/router integration for BUG_ANALYSIS intent** - `plugins/devflow-bug-analysis/commands/bug-analysis.md`
**Confidence**: 82%
- Problem: The bug-analysis plugin introduces a new `/bug-analysis` command but does not define a corresponding triage or orchestration skill for ambient mode integration. Every other major command (`/implement`, `/plan`, `/code-review`, `/resolve`, `/debug`, `/explore`, `/research`, `/release`) has a corresponding triage skill (e.g., `implement:triage`) and/or orch skill (e.g., `implement:orch`) registered in the ambient router, plus guided variants. The bug-analysis command is exclusively slash-command invoked with no ambient pathway.
- Impact: Users in ambient mode who express intent like "find bugs in my code" or "analyze this branch for bugs" will not be routed to the bug-analysis workflow. This breaks the architectural pattern where all major workflows are accessible through both explicit commands and ambient intent classification. The router's classification rules have no BUG_ANALYSIS intent mapping.
- Fix: Create at minimum a `bug-analysis:orch` skill (for ambient routing) and optionally a triage skill. Register the intent in the router's classification rules. This can be deferred to a follow-up PR if the intent is to ship the slash command first and add ambient integration later, but should be tracked.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Resolve fallback creates implicit coupling between two independent plugins** - `plugins/devflow-resolve/commands/resolve.md:71-81`, `shared/skills/resolve:orch/SKILL.md:33-39`
**Confidence**: 85%
- Problem: The resolve command and resolve:orch skill now contain hardcoded knowledge of the bug-analysis directory structure (`bug-analysis/{branch-slug}/`, focus file names `security.md`, `functional.md`, `integration.md`, `usability.md`). This creates tight coupling between `devflow-resolve` and `devflow-bug-analysis` — the resolve plugin must know the internal file layout of the bug-analysis plugin. If bug-analysis changes its output format or adds new focus areas, resolve must be updated in lockstep.
- Impact: Violates the Open-Closed Principle — adding a new bug-analysis focus requires modifying the resolve command. The hardcoded focus file names (`security.md`, `functional.md`, `integration.md`, `usability.md`) are duplicated across three locations: the bug-analysis command, the resolve command, and the resolve:orch skill.
- Fix: Instead of hardcoding focus file names, use a glob pattern or convention-based detection (any `.md` file in the directory that isn't a summary/meta file). The resolve command already does this for review reports ("Read all `{focus}.md` files") — apply the same pattern to bug-analysis fallback:
```
Contains at least one *.md file (excluding bug-analysis-summary.md, static-findings.md, resolution-summary.md)
```

**Synthesizer bug-analysis mode duplicates cross-tracking logic that could be a shared concern** - `shared/agents/synthesizer.md:137-204`
**Confidence**: 80%
- Problem: The Synthesizer agent now handles six modes (exploration, planning, review, bug-analysis, design, research). The bug-analysis mode introduces cross-tracking logic (confidence boosting for static-confirmed findings, deduplication across analyzers, severity sorting) that partially duplicates the review mode's confidence-aware aggregation logic (confidence boosting for multi-reviewer findings, deduplication, severity sorting). Both modes boost confidence by +10% per additional source and cap at 100%.
- Impact: The Synthesizer agent continues to grow as a multi-modal monolith. Adding a seventh mode would further bloat this single agent. The shared confidence-boosting pattern (+10% per corroborating source) is now duplicated in two modes without being explicitly recognized as a shared concern.
- Fix: This is acceptable for now given the agent is ~400 lines, which is within bounds for a Synthesizer. Consider extracting the shared confidence aggregation algorithm into a referenced section or a shared skill if a seventh mode is added.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Synthesizer agent accumulates responsibilities across 6 modes — approaching SRP boundary** - `shared/agents/synthesizer.md`
**Confidence**: 82%
- Problem: The Synthesizer agent now serves 6 distinct modes (exploration, planning, review, bug-analysis, design, research), each with its own process/output contract. While the modes share the "synthesis" abstraction, each mode has unique logic (trust-aware merging for research, convergence detection for review, cross-tracking for bug-analysis, execution strategy for planning). This is a pre-existing architectural pattern that the bug-analysis addition follows but does not worsen significantly.
- Impact: The agent has 6 reasons to change — one per mode. Any change to review synthesis could inadvertently affect bug-analysis synthesis if the agent implementation conflates the modes. However, since agents are markdown-driven and modes are cleanly sectioned, the practical risk is low.

## Suggestions (Lower Confidence)

- **Bug-analysis command lacks multi-worktree support** - `plugins/devflow-bug-analysis/commands/bug-analysis.md` (Confidence: 72%) — Unlike `/code-review` and `/resolve` which auto-discover and process all worktrees, `/bug-analysis` operates only on the current branch. This is architecturally inconsistent but may be intentional for a first release.

- **Static analysis phase runs in the orchestrator, not in an agent** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:87-124` (Confidence: 65%) — Phase 2 (static analysis) executes semgrep/snyk/codeql directly in the command orchestrator rather than delegating to a dedicated agent. The project convention is "commands are orchestration-only — spawn agents, never do agent work in main session." Running tool invocations and SARIF parsing in the orchestrator blurs this boundary. However, the static analysis phase is arguably infrastructure setup (producing input for agents) rather than analysis work.

- **No `apply-decisions` skill listed in plugin.json skills array** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:25-29` (Confidence: 70%) — The BugAnalyzer agent declares `devflow:apply-decisions` in its frontmatter but the plugin.json does not list it in skills. This works due to universal skill installation but understates plugin dependencies.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new plugin follows the established Devflow architecture well — proper plugin structure, agent delegation, phase-based orchestration, incremental analysis pattern, and consistent output format for `/resolve` compatibility. The main architectural concerns are: (1) incomplete skill coverage for the BugAnalyzer's non-security focuses compared to how the Reviewer agent leverages specialized pattern skills, and (2) missing ambient mode integration which breaks the pattern where all major workflows are accessible through intent classification. The resolve fallback coupling and Synthesizer mode growth are lower-priority structural concerns that are acceptable for a first release.
