# Consistency Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23

## Issues in Your Changes (BLOCKING)

### HIGH

**FEATURE_KNOWLEDGE missing from SEQUENTIAL_CODERS and PARALLEL_CODERS Coder templates** - `plugins/devflow-implement/commands/implement.md:117-169`, `plugins/devflow-implement/commands/implement-teams.md:110-162`
**Confidence**: 92%
- Problem: The SINGLE_CODER template includes `FEATURE_KNOWLEDGE: {feature_knowledge}` (line 106 in implement.md), but the SEQUENTIAL_CODERS Phase 1 Coder, Phase 2+ Coders, and PARALLEL_CODERS templates do not. This means 20% of implement invocations (sequential + parallel strategies) will silently drop feature knowledge context that was loaded in Phase 1. The Coder agent documents `FEATURE_KNOWLEDGE` as an input variable and its orient step references it, so omitting it from the prompt template means it will never reach those Coders.
- Fix: Add `FEATURE_KNOWLEDGE: {feature_knowledge}` to all four Coder spawn templates (Sequential Phase 1, Sequential Phase 2+, Parallel Coder 1, Parallel Coder 2) in both `implement.md` and `implement-teams.md`.

**Architecture diagrams in plan.md and plan-teams.md omit Phase 14.5** - `plugins/devflow-plan/commands/plan.md:428-486`, `plugins/devflow-plan/commands/plan-teams.md:480-528`
**Confidence**: 95%
- Problem: Both plan commands add a new `#### Phase 14.5: Feature KB Generation (Conditional)` section in the Phases documentation, but neither command's Architecture ASCII diagram at the end includes Phase 14.5. The architecture diagram is the quick-reference for the orchestration agent to understand the full pipeline. A missing phase causes the orchestrator to skip it.
- Fix: Add Phase 14.5 to the Architecture diagram in both files, under Block 6: Output, after the Phase 14 entry. For example:
  ```
  └─ Block 6: Output
     ├─ Phase 14: Output
     │  ├─ Store design artifact (.docs/design/)
     │  ├─ Create GitHub issue (optional)
     │  └─ Report summary + next step
     └─ Phase 14.5: Feature KB Generation (conditional, non-blocking)
        └─ KB Builder agent (if new feature area explored)
  ```

### MEDIUM

**Frontmatter inconsistency: apply-feature-kb has `trigger: agent-loaded` but apply-knowledge does not** - `shared/skills/apply-feature-kb/SKILL.md:4`, `shared/skills/apply-knowledge/SKILL.md` (no trigger field)
**Confidence**: 82%
- Problem: `apply-knowledge` and `apply-feature-kb` are companion consumption skills for parallel knowledge systems (KNOWLEDGE_CONTEXT and FEATURE_KNOWLEDGE respectively). They follow the same activation pattern — preloaded in agent frontmatter, invoked by agents as needed. However, `apply-feature-kb` adds `trigger: agent-loaded` while `apply-knowledge` has no `trigger` field at all. This creates an inconsistency in skill frontmatter conventions for functionally identical activation patterns.
- Fix: Either add `trigger: agent-loaded` to `apply-knowledge/SKILL.md` for consistency, or remove it from `apply-feature-kb/SKILL.md`. The `trigger` field does not appear to have runtime significance for skills loaded via agent frontmatter.

**allowed-tools format inconsistency: apply-knowledge uses inline format, apply-feature-kb uses array format** - `shared/skills/apply-knowledge/SKILL.md:4`, `shared/skills/apply-feature-kb/SKILL.md:5-8`
**Confidence**: 80%
- Problem: `apply-knowledge` uses `allowed-tools: Read` (single-line), while `apply-feature-kb` uses a YAML array format across 4 lines. Additionally, `apply-feature-kb` includes `Grep` and `Glob` in its allowed tools while `apply-knowledge` only allows `Read`. The feature-kb consumption skill is a read-only consumer like apply-knowledge — it reads pre-computed KB content from FEATURE_KNOWLEDGE, which is already loaded by the orchestrator. The extra tools (Grep, Glob) are unnecessary for the consumption algorithm described in the skill (3 steps: read KB, apply to task, supplement as needed). The feature-kb creation skill correctly needs these tools, but the apply/consumption skill should match apply-knowledge's minimal read-only surface.
- Fix: Change `apply-feature-kb` allowed-tools to `allowed-tools: Read` to match `apply-knowledge`. The consumption algorithm does not require Grep or Glob.

**Inconsistent `FEATURE_KNOWLEDGE` loading instructions across commands** - Multiple files
**Confidence**: 84%
- Problem: The "Load Feature Knowledge" block is copy-pasted across 10+ command and orch files with minor variations in wording and step numbering. Most use "Read `.features/index.json` if it exists" but some say "Check if `.features/index.json` exists (Read tool)". Some use "Concatenate as" while others use "Set". The debug commands use "locally only" phrasing while others use "Pass to agents". This is not a bug per se, but the inconsistent phrasing across otherwise-identical loading blocks makes maintenance harder and risks divergence over time.
- Fix: Consider extracting the loading algorithm into the `apply-feature-kb` or `feature-kb` skill as a "Loading Algorithm" section (similar to how `apply-knowledge` defines the consumption algorithm), then referencing it from commands instead of duplicating the steps. This matches the project's pattern of skills as single source of truth.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**plan:orch Phase 0.5 renumber creates confusing double-0.5** - `shared/skills/plan:orch/SKILL.md:71-94`
**Confidence**: 85%
- Problem: The original plan:orch had Phase 0.5 as Requirements Discovery. The PR renamed it to Phase 0.6 and added a new Phase 0.5 (Load Feature Knowledge). This creates a confusing ordering: Phase 0 (Knowledge Index) -> Phase 0.5 (Feature Knowledge) -> Phase 0.6 (Requirements Discovery) -> Phase 1 (Orient). The `.5` and `.6` suffixes are unconventional and harder to reference in checklists. The Phase Completion Checklist at the bottom correctly lists both, but the naming is awkward.
- Fix: This is a naming choice that works mechanically but is worth noting for future refactoring. Consider using Phase 0a/0b/0c instead of 0/0.5/0.6 for sub-phases of pre-flight, matching the Step 0a/0b/0c pattern used by code-review and resolve commands.

**CLAUDE.md project structure does not document `.features/.kb.lock` gitignore** - `CLAUDE.md`
**Confidence**: 80%
- Problem: The `.features/` directory is added to the project structure diagram, and `post-install.ts` adds `.features/.kb.lock` to `.gitignore` entries for local-scope installs. However, the CLAUDE.md documentation for `.features/` does not mention that `.kb.lock` is gitignored while the rest of `.features/` is committed. For other directories like `.memory/`, the documentation clearly states the commit vs gitignore policy.
- Fix: Add a note in the Feature Knowledge Bases paragraph or the project structure section: "`.features/.kb.lock` is gitignored (concurrent write guard); all other `.features/` content is committed."

## Pre-existing Issues (Not Blocking)

No pre-existing issues identified.

## Suggestions (Lower Confidence)

- **`markStale` function name vs behavior mismatch** - `scripts/hooks/lib/feature-kb.cjs:263` (Confidence: 65%) — `markStale()` does not actually mark anything as stale (it does not mutate the index). It returns slugs that overlap with changed files, acting as a query rather than a mutation. The function name suggests a write operation but it is read-only. Consider renaming to `findOverlapping()` or `detectStale()` for clarity.

- **kb-builder.md duplicated across plugins without build distribution** - `plugins/devflow-ambient/agents/kb-builder.md`, `plugins/devflow-plan/agents/kb-builder.md`, `shared/agents/kb-builder.md` (Confidence: 70%) — Per CLAUDE.md, shared agents should live in `shared/agents/` and be copied to plugins at build time. The diff shows `kb-builder.md` added to both `plugins/devflow-ambient/agents/` and `plugins/devflow-plan/agents/` as new files with identical content. These should be gitignored copies produced by `npm run build:plugins`, not committed. If they are committed, this violates the single-source-of-truth convention for shared agents.

- **`devflow kb create` uses `--dangerously-skip-permissions`** - `src/cli/commands/kb.ts:207` (Confidence: 72%) — The `claude -p` invocation uses `--dangerously-skip-permissions`, which bypasses the Claude Code permission model. While this matches patterns in other background hooks (background-learning, background-memory-update), those are background processes. `devflow kb create` is a user-initiated foreground command where the user could be prompted for permissions. Consider whether the standard permission model would be more appropriate here.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The feature knowledge base system introduces a new cross-cutting concern (`FEATURE_KNOWLEDGE`) that must be woven consistently through 10+ command files, 7 orchestration skills, 6 agents, 2 new skills, and a new CLI module. The wiring is generally thorough and follows the established `KNOWLEDGE_CONTEXT` pattern well. The two HIGH-severity issues (missing `FEATURE_KNOWLEDGE` in sequential/parallel Coder templates and missing Phase 14.5 in architecture diagrams) are genuine omissions that will cause silent behavior differences. The MEDIUM-severity frontmatter inconsistencies between the companion `apply-knowledge` and `apply-feature-kb` skills should be harmonized to maintain the convention that parallel systems follow parallel patterns.
