---
name: resolve:orch
description: Agent orchestration for RESOLVE intent in ambient mode — issue resolution from review reports
user-invocable: false
---

# Resolve Orchestration

Agent pipeline for RESOLVE intent in ambient mode. Parses review reports, validates issues, batches resolutions, and runs Simplifier cleanup.

This is a lightweight variant of `/resolve` for ambient mode. Excluded: pitfall recording, tech debt management, Agent Teams debate, multi-worktree flow, CLI flags.

## Iron Law

> **VALIDATE FIRST, FIX EVERYTHING POSSIBLE**
>
> Every issue must be validated in current file context before any fix.
> Read first, decide second, fix third. Never apply a suggested fix blindly.
> Tech debt deferral is the LAST RESORT — only for complete architectural overhauls.

---

## Phase 1: Target Review Directory

**Produces:** REVIEW_DIR, BRANCH_SLUG

Find the latest timestamped directory under `.docs/reviews/` that:
1. Contains a `review-summary.md` (has been reviewed)
2. Does NOT contain a `resolution-summary.md` (hasn't been resolved yet)

If no unresolved review found: halt with "No unresolved review found. Run a review first."

Extract branch slug from the directory path.

<!-- Phase 1.5 rather than Step 0d: ambient mode has no Phase 0 (no worktree
     discovery, no pre-flight git check, no TARGET_DIR selection — those are
     handled by Phase 1 here). Same content as resolve.md Step 0d. -->
## Phase 1.5: Load Project Knowledge

**Produces:** KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE
**Requires:** REVIEW_DIR

Run `node scripts/hooks/lib/knowledge-context.cjs index "{worktree}"` to produce a compact index of active ADR/PF entries from `decisions.md` and `pitfalls.md`, with Deprecated/Superseded entries already stripped. Falls back to `(none)` when both files are absent or all entries are filtered. Pass `KNOWLEDGE_CONTEXT` to every Resolver agent in Phase 4. Resolver agents use `devflow:apply-knowledge` to Read full entry bodies on demand — no fan-out of the full corpus.

Also load feature knowledge:
1. Read `.features/index.json` if it exists
2. Based on file paths from review report issue entries, identify relevant KBs
3. Read matching `.features/{slug}/KNOWLEDGE.md` files, check staleness via `node scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug}`
4. Concatenate as `FEATURE_KNOWLEDGE` (or `(none)`)

## Phase 2: Parse Issues

**Produces:** ISSUES
**Requires:** REVIEW_DIR

Read all `{focus}.md` files in the timestamped directory (exclude `review-summary.md` and `resolution-summary.md`).

Extract **ALL** issues from all categories and severities, including Suggestions.

For each issue, extract: id (generated), file, line, severity, category (blocking/should-fix/pre-existing), type (from focus), description, suggested_fix.

If no actionable issues found: "Review is clean — no issues to resolve." → stop.

## Phase 3: Analyze & Batch

**Produces:** BATCHES
**Requires:** ISSUES

Group issues by file/function for efficient resolution:
- Issues in the same file → same batch
- Issues with cross-file dependencies → same batch
- Max 5 issues per batch

Determine execution: batches with no shared files can run in parallel.

## Phase 4: Resolve (Parallel)

**Produces:** RESOLUTION_RESULTS
**Requires:** BATCHES, KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE, BRANCH_SLUG

Spawn `Agent(subagent_type="Resolver")` agents — one per batch, parallel where possible.

Each receives:
- **ISSUES**: Array of issues in the batch
- **BRANCH**: Branch slug
- **BATCH_ID**: Identifier for this batch
- **KNOWLEDGE_CONTEXT**: Knowledge index from Phase 1.5 (or `(none)`). Resolvers follow `devflow:apply-knowledge` to Read full ADR/PF bodies on demand.
- **FEATURE_KNOWLEDGE**: Feature area context from Phase 1.5 (or `(none)`). Follow `devflow:apply-feature-kb` for consumption algorithm.

Resolvers follow a 3-tier risk approach:
- **Standard fixes**: Applied directly
- **Careful fixes** (public API, shared state, >3 files): Systematic refactoring — understand context, plan, test, implement, verify
- **Architectural overhaul**: Defer to tech debt (LAST RESORT — avoided at almost all costs, only when complete system redesign required)

## Phase 5: Collect & Simplify

**Produces:** SIMPLIFICATION_RESULTS
**Requires:** RESOLUTION_RESULTS

Aggregate results from all Resolver agents:
- Count: fixed, false positives, deferred

Spawn `Agent(subagent_type="Simplifier")` on all files modified by Resolvers.

## Phase 6: Report

**Requires:** RESOLUTION_RESULTS, SIMPLIFICATION_RESULTS, REVIEW_DIR

Write `resolution-summary.md` to the same timestamped review directory.

The report includes a `## Knowledge Citations` section at the top (before Statistics) listing all unique `applies ADR-NNN` and `avoids PF-NNN` references extracted from Resolver Reasoning columns. Omit the section entirely if no citations were made.

Report to user:
- Issues resolved vs deferred vs false positives
- Files modified
- Commits created
- Remaining issues (if any deferred)
- Knowledge citations applied (if any)

## Error Handling

- **No review directory**: Halt, suggest running review first
- **All issues false positive**: Report findings, write resolution-summary noting no changes needed
- **Resolver BLOCKED**: Report which batch blocked, continue with remaining
- **Simplifier fails**: Resolution still valid — report that simplification was skipped

## Phase Completion Checklist

Before reporting results, verify every phase was announced:

- [ ] Phase 1: Target Review Directory → REVIEW_DIR captured
- [ ] Phase 1.5: Load Project Knowledge → KNOWLEDGE_CONTEXT captured, FEATURE_KNOWLEDGE loaded (or skipped if `.features/` absent)
- [ ] Phase 2: Parse Issues → ISSUES captured (or stopped: no actionable issues)
- [ ] Phase 3: Analyze & Batch → BATCHES captured
- [ ] Phase 4: Resolve → RESOLUTION_RESULTS captured per batch
- [ ] Phase 5: Collect & Simplify → SIMPLIFICATION_RESULTS captured
- [ ] Phase 6: Report → resolution-summary.md written

If any phase is unchecked, execute it before proceeding.
