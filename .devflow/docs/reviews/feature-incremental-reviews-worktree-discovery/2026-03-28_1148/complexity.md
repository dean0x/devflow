# Complexity Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### HIGH

**Worktree discovery logic duplicated verbatim across 4 command files (Step 0a)** -- Confidence: 90%
- `plugins/devflow-code-review/commands/code-review.md:22-33`, `plugins/devflow-code-review/commands/code-review-teams.md:22-33`, `plugins/devflow-resolve/commands/resolve.md:22-33`, `plugins/devflow-resolve/commands/resolve-teams.md:22-33`
- Problem: The worktree discovery algorithm (Step 0a: Discover Worktrees) is copied near-identically across all 4 command files. Each copy contains 7 steps of filtering logic (named branch check, protected branch exclusion, rebase/merge detection, `--path` override, single-vs-multi flow, deduplication by branch). The only variation is "reviewable" vs "resolvable" and an additional filter for resolve commands (unresolved reviews check). This creates a 4-way synchronization burden -- any future change to discovery logic (e.g., adding a new protected branch pattern, changing filter criteria) must be replicated across all 4 files.
- Impact: The project's CLAUDE.md already documents PF-003 (pluginHints duplication) and PF-005 (HookEntry interface duplication 4x) as known DRY pitfalls. This PR introduces the same pattern at the command orchestration layer. With 4 copies, discovery logic drift is likely as the codebase evolves.
- Fix: Extract the shared worktree discovery algorithm into a shared reference document (e.g., `shared/skills/worktree-discovery/SKILL.md` or a reference file under docs-framework) and have each command file reference it with only the command-specific filter delta (reviewable vs resolvable criteria). This follows the existing pattern where skills are the single source of truth and commands reference them.

### MEDIUM

**Worktree Support boilerplate duplicated across 9 agent files** -- Confidence: 85%
- `shared/agents/coder.md:25-31`, `shared/agents/git.md:18-24`, `shared/agents/resolver.md:19-25`, `shared/agents/reviewer.md:20-26`, `shared/agents/scrutinizer.md:18-23`, `shared/agents/shepherd.md:20-25`, `shared/agents/simplifier.md:18-23`, `shared/agents/synthesizer.md:19-25`, `shared/agents/validator.md:18-24`
- Problem: The "Worktree Support (Optional)" section is added to 9 agent files with near-identical content. All share the same structure: "If `WORKTREE_PATH` is provided: prefix git commands, resolve paths, if omitted use cwd." The only variation is whether `.docs/` path resolution is included (5 of 9 agents include it) and whether `cd {WORKTREE_PATH} && ...` is mentioned (validator only). This introduces a 9-way duplication.
- Impact: Adding a new path resolution rule (e.g., for `.memory/` paths) or changing the `WORKTREE_PATH` convention requires updating all 9 files. Given that agents are described as 50-150 line targets, adding 6-8 lines of boilerplate to each is proportionally significant.
- Fix: Since agents cannot reference skills at runtime (they load skills listed in frontmatter), the most practical approach is to keep the boilerplate but consolidate the two variants (with `.docs/` / without `.docs/`) into a standardized template in `docs/reference/agent-design.md` so future agents copy from a single canonical source. Alternatively, add a shared snippet mechanism if the build system supports it.

**Phase 0 sub-step complexity in code-review-teams.md** -- `plugins/devflow-code-review/commands/code-review-teams.md:20-66` -- Confidence: 82%
- Problem: Phase 0 has grown from a single "Pre-Flight" section (~10 lines) to a 3-sub-step discovery/pre-flight/incremental-detection section spanning 47 lines with deeply nested conditional logic (if `--path` provided, if `--full` not set, if SHA reachable, if SHA == HEAD). The teams variant is now 361 lines total. While this is documentation (markdown), it serves as executable instructions for LLM agents -- complexity in the prompt directly impacts agent execution reliability.
- Impact: LLM agents interpreting this prompt must track 3 sub-steps, 2 mode branches (single/multi), 3 flag interactions (`--full`, `--path`, `#PR`), incremental detection with 4 conditional paths, and timestamp collision handling. This is within but approaching the "5-minute understanding" threshold from the Iron Law.
- Fix: The Phase 0 structure is well-organized with clear sub-headings (0a, 0b, 0c), which mitigates the raw line count. No immediate refactor needed, but consider extracting the incremental detection logic (Step 0c) into a standalone reference if more features are added to this phase.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**code-review-teams.md total file length approaching warning threshold** -- `plugins/devflow-code-review/commands/code-review-teams.md` (361 lines) -- Confidence: 80%
- Problem: At 361 lines, this is the longest command file in the project. The parallel (non-teams) variant is 236 lines. The teams variant includes 4 fully spelled-out reviewer prompt blocks (~15 lines each, totaling ~60 lines) plus all the new worktree/incremental infrastructure. The complexity metrics reference warns at 300 lines for files; this exceeds that threshold.
- Impact: LLM agents consuming this entire command as a prompt may lose focus on later phases (Phase 5-7) due to attention dilution from the lengthy Phase 2 reviewer prompts. The 4 reviewer prompt blocks share 90% identical structure (only focus area and skill path differ).
- Fix: The reviewer prompt blocks already contain a `[Add conditional perspectives based on Phase 1 -- follow same pattern]` shorthand for conditional reviewers. Apply the same templating approach to the core 4 reviewers: show one fully expanded example, then list the remaining 3 as variations (name, skill path, focus description). This could save ~45 lines.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**resolve-teams.md resolver batch prompts are verbose templates** -- `plugins/devflow-resolve/commands/resolve-teams.md:119-167` -- Confidence: 82%
- Problem: Two resolver batch prompt blocks (batch-1 and batch-2) are nearly identical (~15 lines each, differing only in batch number and issue assignment). This pattern predates this PR but the PR adds `WORKTREE_PATH` to both, extending the duplicated block.
- Impact: Any change to the resolver prompt template requires updating both blocks identically.

## Suggestions (Lower Confidence)

- **Edge case table growth** -- `plugins/devflow-code-review/commands/code-review-teams.md:330-344` (Confidence: 65%) -- The edge case table has grown to 11 rows across the command files. Consider grouping related cases (worktree filtering cases, incremental review cases, multi-worktree behavioral cases) with sub-headings for scannability.

- **Ambient prompt single-line density** -- `scripts/hooks/ambient-prompt:40` (Confidence: 62%) -- The new `MULTI_WORKTREE:` line is appended to an already dense single-line preamble. The preamble is intentionally compressed for token efficiency, but adding another intent category increases the cognitive load for the ambient router. The line is functional but terse.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR introduces two well-designed features (incremental reviews and worktree auto-discovery) with thorough edge case handling and backwards compatibility. The primary complexity concern is the 4-way duplication of worktree discovery logic across command files, which mirrors existing known pitfalls (PF-003, PF-005) in the codebase. The boilerplate across 9 agent files is a lesser concern given the architectural constraint that agents cannot share runtime definitions.

**Conditions:**
1. Address the HIGH finding: extract shared worktree discovery logic to avoid 4-way synchronization burden, or document the duplication as a known pitfall (PF-007) with a planned consolidation path.
2. The MEDIUM findings are acceptable for merge but should be tracked for follow-up.
