# Architecture Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### HIGH

**Worktree Support section duplicated verbatim across 8 agents** (8 occurrences) -- Confidence: 90%
- `shared/agents/coder.md:25-31`, `shared/agents/git.md:20-24`, `shared/agents/resolver.md:19-25`, `shared/agents/reviewer.md:22-28`, `shared/agents/scrutinizer.md:18-23`, `shared/agents/shepherd.md:20-25`, `shared/agents/simplifier.md:18-23`, `shared/agents/synthesizer.md:19-25`, `shared/agents/validator.md:18-25`
- Problem: The identical "Worktree Support (Optional)" block (prefix git commands with `-C`, resolve `.docs/` paths, resolve source files, default to cwd) is copy-pasted across 8 agent files. This is a DRY violation. When the worktree path resolution logic changes (e.g., adding env var support, handling symlinks, or adding validation), every agent file must be updated in lockstep. This mirrors the existing PF-005 pattern (HookEntry/HookMatcher/Settings duplicated 4x) but at a larger scale.
- Fix: Extract worktree support into a shared reference document (e.g., `shared/skills/worktree-support/SKILL.md` or a `references/worktree-support.md`) and reference it from each agent with a single line: "See `references/worktree-support.md` for WORKTREE_PATH handling." Alternatively, since these are markdown prompt files (not executable code), a lighter approach: add a single "Worktree Support" section to a shared conventions doc and reference it by name in each agent's skills frontmatter. This keeps agent files lean and the worktree contract in one place.

**Worktree discovery logic duplicated across 4 command files** (4 occurrences) -- Confidence: 88%
- `plugins/devflow-code-review/commands/code-review.md` (Step 0a), `plugins/devflow-code-review/commands/code-review-teams.md` (Step 0a), `plugins/devflow-resolve/commands/resolve.md` (Step 0a), `plugins/devflow-resolve/commands/resolve-teams.md` (Step 0a)
- Problem: The 7-step worktree discovery algorithm (run `git worktree list --porcelain`, filter by named branch, exclude protected branches, check for mid-rebase/mid-merge, handle `--path` flag, deduplicate by branch) is duplicated verbatim in all 4 command files. The protected branch list (`main, master, develop, release/*, staging, production`) and filtering heuristics are embedded inline in each copy. Any change to the discovery algorithm (e.g., adding a new protected branch pattern, changing the dedup strategy) requires coordinated edits to 4 files.
- Fix: Extract worktree discovery into a shared skill (e.g., `shared/skills/worktree-discovery/SKILL.md`) that defines the discovery algorithm, filtering rules, and protected branch list in one place. Each command would reference it: "Follow worktree-discovery skill for Step 0a." This follows the existing pattern where commands reference skills for domain logic rather than inlining it.

**Incremental detection logic duplicated across code-review and code-review-teams** (2 occurrences) -- Confidence: 85%
- `plugins/devflow-code-review/commands/code-review.md` (Step 0c), `plugins/devflow-code-review/commands/code-review-teams.md` (Step 0c)
- Problem: The incremental detection algorithm (check `.last-review-head`, verify SHA reachability via `git cat-file -t`, compare to HEAD, set `DIFF_RANGE`) is duplicated in both the base and teams variants. The timestamp collision handling (`YYYY-MM-DD_HHMM` with seconds fallback) is also duplicated. These two files are the base/teams variants of the same command.
- Fix: Since base/teams command variants are an established pattern in this codebase (per CLAUDE.md), some duplication between them is expected. However, the incremental detection logic is complex enough (5+ steps with branching) that it should be extracted to either: (a) a shared section in the skill catalog, or (b) a "Incremental Review Protocol" reference document that both variants reference. This keeps the variants focused on their structural differences (parallel subagents vs. Agent Teams).

### MEDIUM

**Edge case table duplicated across base and teams command variants** (4 files) -- Confidence: 82%
- `plugins/devflow-code-review/commands/code-review.md` (Edge Cases section), `plugins/devflow-code-review/commands/code-review-teams.md` (Edge Cases section), `plugins/devflow-resolve/commands/resolve.md` (Edge Cases section), `plugins/devflow-resolve/commands/resolve-teams.md` (Edge Cases section)
- Problem: The edge case handling tables (11 rows for code-review, 5+ new rows for resolve) are duplicated between base and teams variants. These tables define behavioral contracts. When a new edge case is discovered, it must be added to both variants.
- Fix: Consider a shared reference document for edge case handling that both variants include. Alternatively, accept this as a cost of the base/teams variant pattern and document a convention that edge case tables must stay in sync.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--review` flag interaction with multi-worktree not fully specified** -- `plugins/devflow-resolve/commands/resolve.md:110` and `plugins/devflow-resolve/commands/resolve-teams.md:110`
**Confidence**: 82%
- Problem: The resolve commands state `--review {timestamp}` is "not supported in multi-worktree mode" and recommend using `--path` + `--review`. However, the error behavior is unspecified: should the command silently ignore `--review` in multi-worktree mode, emit a warning, or fail hard? Ambiguous error contracts violate the Dependency Inversion principle -- callers (users, ambient mode) cannot predict behavior.
- Fix: Add explicit behavior to the edge case table: "`--review` in multi-worktree mode: emit error message and abort. Suggest `--path {worktree} --review {timestamp}` in the error."

**Ambient preamble MULTI_WORKTREE routing lacks disambiguation** -- `scripts/hooks/ambient-prompt:40`
**Confidence**: 80%
- Problem: The new ambient preamble line says `MULTI_WORKTREE: all worktrees/branches, each worktree, review everything, resolve all -> ORCHESTRATED`. However, phrases like "review everything" could also match a general REVIEW intent (e.g., "review everything in this file"). The intent classification in ambient-router SKILL.md has more nuanced signal keywords, but the preamble is the actual injected prompt text. The preamble's keyword overlap between MULTI_WORKTREE and REVIEW could cause false escalation to ORCHESTRATED when the user means single-worktree review.
- Fix: Tighten the preamble signals to be more specific. Replace "review everything" with "review all worktrees" in the preamble. The ambient-router SKILL.md already has the detailed table; the preamble should use unambiguous triggers only.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Base/teams command variant duplication is growing** -- `plugins/devflow-code-review/commands/`, `plugins/devflow-resolve/commands/`
**Confidence**: 80%
- Problem: The code-review command went from ~160 lines to ~357 lines (+123%), and the teams variant grew proportionally. Both variants now carry substantial duplicated logic (worktree discovery, incremental detection, edge cases, backwards compatibility). The base/teams pattern was designed for structural differences (parallel subagents vs. Agent Teams), but shared behavioral logic has grown to dominate both files. This is a pre-existing architectural debt that this PR amplifies but did not create.
- Fix: In a future PR, consider extracting shared behavioral logic into a skill or reference document, leaving only the structural orchestration pattern (parallel vs. teams) in each variant.

## Suggestions (Lower Confidence)

- **Protected branch list should be centralized** - `plugins/devflow-code-review/commands/code-review.md` (Confidence: 72%) -- The list `main, master, develop, release/*, staging, production` appears in 4 command files. If the project adds a new protected branch pattern, all 4 files need updating. Could be extracted to a shared constant or reference.

- **Worktree pass-through in skills may be unnecessary** - `shared/skills/debug-orchestration/SKILL.md`, `shared/skills/implementation-orchestration/SKILL.md`, `shared/skills/plan-orchestration/SKILL.md` (Confidence: 65%) -- Three orchestration skills received one-line "pass WORKTREE_PATH through" additions. These skills are loaded by ambient mode which does not currently invoke multi-worktree workflows (MULTI_WORKTREE always routes to command flow). The pass-through may be forward-looking, but could also be dead code that adds noise.

- **No explicit cleanup of `.last-review-head` on branch delete** - `plugins/devflow-code-review/commands/code-review.md` (Confidence: 62%) -- When a branch is merged and deleted, the `.docs/reviews/{branch-slug}/.last-review-head` file persists. Over time, this accumulates stale marker files. Not harmful but could be confusing.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The feature design is sound -- incremental reviews, timestamped directories, and worktree auto-discovery are well-conceived. The edge case handling is thorough and the backwards compatibility story is clean. However, the implementation introduces significant DRY violations: the worktree support block is copied 8 times across agents, the discovery algorithm is copied 4 times across commands, and the incremental detection logic is copied twice across command variants. These are the kind of duplications that compound maintenance cost over time. The most impactful fix would be extracting worktree discovery and incremental detection into shared reference documents, which aligns with the existing skill-based architecture pattern already used throughout DevFlow.
