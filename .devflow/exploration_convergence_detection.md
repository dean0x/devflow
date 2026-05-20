# Convergence Detection Exploration: Similar Features & Scope Patterns

## Executive Summary

Explored the existing Devflow architecture for convergence detection patterns. Found **5 core comparable features** that demonstrate disk-persisted state tracking, cross-phase feedback loops, and confidence-based deduplication mechanisms. These patterns are directly reusable for convergence detection in the review→resolve pipeline.

**Key findings**: Disk-first architecture is canonical; state markers (`.last-review-head`, `resolution-summary.md`) enable phase continuity; synthesizer confidence-boosting algo provides dedup template; false-positive tracking in Resolver validates the approach; decisions/pitfalls citation system proves cross-cycle information persistence.

---

## 1. INCREMENTAL DETECTION PATTERN (Closest Match)

### Location
- **review:orch Phase 2**: `.devflow/docs/reviews/{branch_slug}/.last-review-head`
- **code-review Phase 0c**: Incremental Detection & Timestamp Setup
- **Override mechanism**: `--full` flag forces full review ignoring marker

### Mechanism
```
.last-review-head contains:
  - SHA from last review run
  - On next review: compare HEAD vs stored SHA
  - If equal: "No new commits. Skip review."
  - If different: DIFF_RANGE = {stored_sha}...HEAD (incremental)
  - If missing: DIFF_RANGE = {base_branch}...HEAD (full review)
  - If rebase invalidates SHA: fallback to full (git cat-file -t checks)
```

### Edge Cases Handled
- **Rebase invalidates SHA**: Check `git cat-file -t {sha}` before using it; fallback to full diff if unreachable
- **Same-minute collision**: Retry with seconds appended (`YYYY-MM-DD_HHMMSS`)
- **Legacy flat layout**: Old flat `.md` files coexist with new timestamped subdirectories
- **Multi-worktree support**: Each worktree has independent `.last-review-head` marker

### Relevance to Convergence
- **Reuse pattern**: Store `{branch_slug}/.last-resolution-cycle` with SHA + cycle number
- **Early exit**: "Issues identical to last cycle — reviewer hallucination detected" → skip re-review
- **Override**: `--full-cycle` forces re-run past convergence gate

---

## 2. RESOLUTION-SUMMARY.MD STATE PERSISTENCE

### Location
- **resolve:orch Phase 6**: Immediately write after aggregating results (before Simplifier)
- **resolve.md Phase 5**: Aggregate RESOLUTION_RESULTS, write to disk now
- **Path**: `.devflow/docs/reviews/{branch_slug}/{timestamp}/resolution-summary.md`

### Format
```markdown
# Resolution Summary

**Branch**: {branch} -> {base}
**Date**: {timestamp}
**Review**: {path to review-summary.md}

## Decisions Citations
| ID | Applied | Type |
|----|----|------|
| ADR-NNN | yes | Architectural pattern |
| PF-NNN | avoided | Known pitfall |

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | N |
| Fixed | N |
| False Positive | N |
| Deferred | N |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| {description} | {file}:{line} | {sha} |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| {description} | {file}:{line} | {why invalid} |
```

### Key Pattern: Early Persistence
- **Write immediately** in Phase 6 (before Simplifier runs)
- **Reason**: Context compaction may truncate Phase 7+ work; persist results now
- **Consequence**: Next review can read this summary to detect repeat issues

### Relevance to Convergence
- **Fingerprint storage**: Add `## Previous Cycle Issues` section
- **Dedup source**: Compare new issues against previous resolution-summary
- **False-positive ratio**: Track `(false_positives / total_issues)` per cycle
- **Convergence criterion**: If ratio > threshold AND issues identical → halt

---

## 3. SYNTHESIZER CONFIDENCE-BOOSTING DEDUPLICATION

### Location
- **synthesizer.md Mode: Review** (lines 238-242)
- **Process**: Read all reviewer reports, aggregate by file:line

### Algorithm
```
For each file:line position:
  - If 1 reviewer found it: confidence = base_confidence (from that reviewer)
  - If 2+ reviewers found it: boost confidence by 10% per additional reviewer (cap at 100%)
  
Example:
  security@78%, architecture@82% → both found same issue
  merged_confidence = 82% + 10% = 92% (capped at 100%)
```

### Deduplication Rules
- **Similar issues grouped**: 3+ instances of same pattern → 1 finding listing all locations
- **Stylistic preferences skipped**: Format/naming only — unless violates explicit project conventions
- **Pre-existing code**: Only CRITICAL severity reported (security, data loss)

### Relevance to Convergence
- **Reuse template**: Implement same boosting in resolve→review feedback loop
- **Cycle 2 issues**: Track which issues appeared in both Cycle 1 and Cycle 2
- **Convergence score**: `(repeated_issues / total_issues)` with boosted confidence
- **Mechanism**: If issue appears in both cycles with 100% confidence + "intentional" marker → false positive

---

## 4. FALSE-POSITIVE TRACKING IN RESOLVER

### Location
- **resolver.md Decision Flow** (lines 94-111)
- **resolve:orch Phase 5**: Resolver agents validate each issue

### Validation Logic
```
For each issue:
  1. Read file:line context (30 lines around)
  2. Still present? NO → FALSE_POSITIVE
  3. Reviewer understood correctly? NO → FALSE_POSITIVE
  4. Code is intentional? YES → FALSE_POSITIVE
     (comments suggest deliberate choice, naming indicates purpose, patterns suggest design)
  
  5. If false positive: record reasoning
     - "Issue no longer present"
     - "Reviewer misunderstood context"
     - "Code is intentional — {evidence}"
```

### Output Format
```markdown
## False Positives
| Issue ID | File:Line | Reasoning |
|----------|-----------|-----------|
| {id} | {file}:{line} | {why invalid} |
```

### Relevance to Convergence
- **Existing pattern**: Resolver already distinguishes valid vs invalid issues
- **Cycle 2 enhancement**: Pass Cycle 1 false positives to Cycle 2 reviewers as context
- **Issue fingerprint**: Hash of (file, line, description) to detect repeats across cycles
- **Hallucination marker**: If same false positive appears in 2+ cycles → mark reviewer as hallucinating

---

## 5. DECISIONS/PITFALLS CITATION SYSTEM (Cross-Cycle Information)

### Location
- **apply-decisions.md 5-Step Algorithm**
- **resolver.md**: Cite `applies ADR-NNN` / `avoids PF-NNN` in Reasoning column
- **resolve:orch Phase 6**: Extract all citations, aggregate into `## Decisions Citations` section
- **resolve.md Phase 5**: Collect unique ADR/PF references across all batches

### Mechanism
```
Resolver reasoning column:
  | Issue ID | File:Line | Type | Reasoning |
  | sec-001 | app.ts:42 | missing-validation | applies ADR-015 (input validation pattern) |
  | arch-002 | service.ts:89 | tight-coupling | avoids PF-008 (god object pattern) |

Aggregation (Phase 5):
  Unique ADR/PF IDs: ADR-015, PF-008
  
resolution-summary.md:
  ## Decisions Citations
  | ID | Applied | Type |
  | ADR-015 | yes | Input validation pattern |
  | PF-008 | avoided | God object pattern |
```

### Verbatim-Only Guard
- **Iron Law**: "VERBATIM IDs ONLY — NEVER FABRICATE"
- **Rule**: Cite only IDs appearing in DECISIONS_CONTEXT index
- **Read first**: Must Read full ADR/PF body before citing (step 3 of apply-decisions)
- **No speculation**: If ID not in index, skip citation entirely

### Relevance to Convergence
- **Cycle 2 context**: Pass Cycle 1 decisions citations to Cycle 2 reviewers
- **Pattern persistence**: If Reviewer recommends fix that violates cited ADR → false positive
- **Hallucination detection**: Reviewer cites ADR-XXX, but that decision contradicts fix → likely hallucinating
- **Cross-cycle consistency**: Track which ADRs/PFs appear in both cycles (stable vs drifting)

---

## 6. DISK-FIRST ARCHITECTURE (Foundational Pattern)

### Iron Law
> **EVERY REVIEWER WRITES TO DISK**
>
> A review that exists only in agent output disappears on compaction.
> No disk artifact, no review. The Synthesizer reads from disk, not memory.

### Structure
```
.devflow/docs/reviews/{branch-slug}/
  ├── {timestamp}/
  │   ├── security.md
  │   ├── architecture.md
  │   ├── performance.md
  │   ├── complexity.md
  │   ├── consistency.md
  │   ├── testing.md
  │   ├── regression.md
  │   ├── reliability.md
  │   ├── [conditional].md
  │   ├── review-summary.md          ← Synthesizer writes
  │   └── resolution-summary.md      ← Resolver writes (Phase 6, early persistence)
  ├── {older-timestamp}/
  │   ├── *.md
  │   ├── review-summary.md
  │   └── resolution-summary.md
  └── .last-review-head              ← Incremental marker (updated after Phase 7)
```

### Key Properties
- **Timestamp-based**: YYYY-MM-DD_HHMM naturally sortable
- **No cross-file state**: Each reviewer writes independently; synthesizer aggregates
- **Early persistence**: resolution-summary written before Simplifier (phase 6, not 8/9)
- **Continuation detection**: Phase 2 checks `.last-review-head` before Phase 5 reviews

### Relevance to Convergence
- **Central pattern**: Use same disk-first for convergence markers
- **Multi-cycle tracking**: Store `.devflow/docs/reviews/{branch_slug}/.review-cycles` with:
  ```json
  [
    { "cycle": 1, "timestamp": "2026-05-19_1200", "issues": 15, "false_positives": 2 },
    { "cycle": 2, "timestamp": "2026-05-19_1245", "issues": 14, "false_positives": 3 }
  ]
  ```
- **Convergence marker**: `.devflow/docs/reviews/{branch_slug}/.convergence-detected` written by resolve:orch when gate triggers

---

## 7. PIPELINE:ORCh CHAINING PATTERN

### Location
- **pipeline:orch SKILL.md** (shared/skills/pipeline:orch/)
- **Phases**: Implement → Review → Resolve as unified flow

### Chaining Logic
```
Phase 1: Implement
  ↓ (if BLOCKED, halt)
Phase 2: Status — Review Decision (auto-proceed)
Phase 3: Review
  ↓ (review findings)
Phase 4: Status — Resolve Decision
  ├─ If blocking issues: auto-proceed to Phase 5 (resolve)
  └─ If no blocking: skip to Phase 6 (summary)
Phase 5: Resolve
Phase 6: Summary (end-to-end report)
```

### Key Pattern: Auto-Proceed Between Stages
- No user prompts between phases
- Status gates determine routing (Phase 4)
- Each phase reports status, next auto-starts

### Relevance to Convergence
- **Convergence gate location**: Would fit in Phase 4 (Status — Resolve Decision)
  - Before resolving, check if issues identical to last cycle
  - If converged: report hallucination, suggest manual review, proceed to summary
- **Alternative**: Add Phase 4.5 (Convergence Check) between Resolve Decision and Resolve
- **Reporting**: Include convergence metrics in Phase 6 summary

---

## 8. MULTI-CYCLE RESOLUTION TRACKING (Inferred Pattern)

### How resolve:orch Currently Works
1. **Phase 1**: Target latest review directory (must have `review-summary.md`, no `resolution-summary.md`)
2. **Phase 3**: Parse all issues from `{focus}.md` files
3. **Phase 5**: Validate + fix issues
4. **Phase 6**: Write `resolution-summary.md` with counts (fixed, false positive, deferred)

### What's Missing for Convergence
- No tracking of **previous** resolution summaries
- No detection of **repeated** issues
- No **false-positive ratio** calculation across cycles
- No **cycle counter** or **cycle history**

### Proposed Addition Pattern
```
After Phase 1 (Target Review Directory):

Phase 1.5: Load Previous Resolution Summary
  1. Check if {TARGET_DIR}/../{previous-timestamp}/resolution-summary.md exists
  2. If yes: read previous issue fingerprints, false-positive counts
  3. Calculate: previous_fp_ratio = previous_fp_count / previous_total
  4. Store as PREVIOUS_RESOLUTION for Phase 6 comparison

Phase 6.5: Detect Convergence (NEW)
  1. Current: fp_ratio = current_fp_count / current_total
  2. If current issues ≈ previous issues (by fingerprint hash):
       - Calculate similarity_score
       - If similarity > 80% AND fp_ratio > threshold:
           - Mark CONVERGED
           - Report: "Review-resolve cycle detected halting condition"
           - Write convergence marker to disk
  3. If NOT converged:
       - Update cycle counter
       - Proceed normally

Phase 8: Report (modified)
  - Include convergence status
  - If converged: "Hallucination detected. {N} issues repeated from Cycle {M}."
  - Suggest: "Run /resolve --review {previous-timestamp} --check-intent for manual validation"
```

---

## Edge Cases & Scope

### Case 1: First Review (No Previous Cycle)
- **Handling**: PREVIOUS_RESOLUTION = empty
- **Outcome**: No convergence detection (no prior data to compare)
- **Cycle counter**: Set to 1

### Case 2: Rebase Between Cycles
- **Challenge**: File:line numbers change
- **Handling**: Fingerprint by (file_path, normalized_description) not line number
- **Alternative**: Use `.last-review-head` invalidation to trigger full review

### Case 3: Intentional Code Changes Between Cycles
- **Challenge**: Reviewer might suggest different fixes cycle-to-cycle
- **Handling**: Distinguish "same issue, different fix" from "hallucination"
- **Approach**: Track issue description + suggested fix; hash both for fingerprinting

### Case 4: Reviewer Improvements (Cycle 2 More Specific)
- **Challenge**: Cycle 2 might find sub-issues not flagged in Cycle 1
- **Handling**: Allow issue count increase within threshold (±10% variance)
- **Metric**: Use Jaccard similarity for issue set comparison

### Case 5: False Positive Clearing
- **Challenge**: Cycle 2 resolves a false positive correctly (Cycle 1 mistake)
- **Handling**: Don't count toward hallucination; count toward "convergence improved"
- **Tracking**: Separate "hallucination" from "false positive correction"

---

## Reusable Implementation Patterns

### Pattern A: Disk Persistence for State Markers
```bash
# Store cycle state
CYCLE_STATE=".devflow/docs/reviews/{branch_slug}/.review-cycles"
jq . "$CYCLE_STATE" 2>/dev/null || echo "[]"

# Append new cycle data (as JSON)
jq ". += [{ cycle: 2, timestamp: \"2026-05-19_1245\", issues: 14, false_positives: 3 }]" "$CYCLE_STATE" > /tmp/cycles.json
mv /tmp/cycles.json "$CYCLE_STATE"
```

### Pattern B: Issue Fingerprinting
```bash
# Hash issue for dedup (from Resolver output)
# Use: file_path + severity + description (not line, which changes on rebase)
echo "{file_path}::{severity}::{description}" | md5sum | awk '{print $1}'
```

### Pattern C: Confidence-Based Dedup (Synthesizer Template)
```
For each unique fingerprint:
  - Collect all instances from Cycle 1 and Cycle 2
  - Boost confidence by 10% per cycle × number of cycles (cap 100%)
  - If confidence = 100% AND appeared in both cycles → likely real issue (not hallucination)
  - If confidence < 70% AND appeared in both cycles → likely hallucination (low confidence repeated)
```

### Pattern D: False-Positive Ratio Gate
```
cycle_1_ratio = false_positives_1 / total_issues_1  (e.g., 2 / 15 = 13.3%)
cycle_2_ratio = false_positives_2 / total_issues_2  (e.g., 3 / 14 = 21.4%)

If cycle_2_ratio > 1.5x cycle_1_ratio:
  - Hallucination suspected
  - Report: "False positive rate increased {ratio}x"
  - Suggest: Manual review of Cycle 2 findings

If both ratios > threshold (e.g., 20%):
  - Overall review quality poor
  - Suggest: Adjust reviewer confidence threshold or skip automated resolution
```

### Pattern E: Decisions Citation Cross-Cycle
```
Cycle 1 resolution-summary.md:
  ## Decisions Citations
  ADR-015 (input validation)
  ADR-042 (error handling)

Cycle 2: Pass previous citations to Reviewer as context:
  "Previous cycle applied ADR-015 and ADR-042. 
   If your findings contradict these, confirm via ADR full body before suggesting fix."

Resolver: Cite decisions applied in this cycle
  If same ADR cited → stability signal (pattern applies consistently)
  If different ADR cited → possible hallucination (lost context between cycles)
```

---

## Proposed Convergence Detection Gate (5 Solutions)

### Solution 1: Resolution-Summary Feedback Loop ✓ REUSABLE
- **Pattern**: Already exists in resolve:orch
- **Enhancement**: Read Cycle 1's resolution-summary.md in resolve:orch Phase 1.5
- **Implementation**: Pass to Reviewer as context: "Previous cycle flagged these issues. If you see them again, high confidence."

### Solution 2: False-Positive Ratio Gate ✓ REUSABLE
- **Pattern**: Resolver already classifies false positives
- **Enhancement**: Track ratio trend across cycles
- **Implementation**: Add Phase 6.5 gate: if ratio > threshold, halt resolve

### Solution 3: Re-Resolve Instead of Re-Review ✓ REUSABLE
- **Pattern**: resolve:orch already validates each issue
- **Enhancement**: Skip Phase 3-5 (reviews) if convergence detected; jump to new Resolver batch
- **Implementation**: Add convergence check before Phase 3; if detected, spawn resolver directly on previous issues

### Solution 4: Reviewer Self-Verification ✓ REUSABLE
- **Pattern**: Reviewer already receives DECISIONS_CONTEXT + FEATURE_KNOWLEDGE
- **Enhancement**: Add "are you certain?" prompt if issue also appeared in Cycle 1
- **Implementation**: Pass Cycle 1 issue fingerprints to Reviewer as `PREVIOUS_ISSUES_CONTEXT`

### Solution 5: Issue Fingerprinting/Dedup ✓ REUSABLE
- **Pattern**: Synthesizer already groups similar issues (consolidation rules)
- **Enhancement**: Use fingerprint (file + description, not line) for cross-cycle dedup
- **Implementation**: Store fingerprint in resolution-summary.md; compare Cycle 2 issues against Cycle 1 fingerprints

---

## Summary: Scope & Effort

| Solution | Existing Pattern | Enhancement | Effort | Risk |
|----------|------------------|-------------|--------|------|
| 1. Feedback loop | resolve:orch Phase 1 read | Parse Cycle 1 summary, pass to Reviewer | Low | Low |
| 2. FP ratio gate | Resolver false-positive tracking | Add Phase 6.5 ratio check | Low | Low |
| 3. Re-resolve | resolve:orch full pipeline | Skip reviews if converged; new Resolver batch | Medium | Medium |
| 4. Self-verification | Reviewer receives context | Add context flag + confirmation prompt | Medium | Low |
| 5. Fingerprinting | Synthesizer consolidation | Hash (file, severity, description) not line | Low | Low |

---

## Files to Modify

### Tier 1 (Convergence Detection)
- `shared/skills/resolve:orch/SKILL.md` — Add Phase 1.5 + Phase 6.5
- `plugins/devflow-resolve/commands/resolve.md` — Mirror updates
- `shared/agents/resolver.md` — Add previous-issues context handling
- `shared/agents/reviewer.md` — Add previous-issues context + confidence boost

### Tier 2 (State Persistence)
- Create `.devflow/docs/reviews/{branch_slug}/.review-cycles` JSON format
- Create `.devflow/docs/reviews/{branch_slug}/.convergence-detected` marker
- Modify resolution-summary.md template to include issue fingerprints

### Tier 3 (Documentation)
- `docs/reference/convergence-detection.md` — New comprehensive guide
- `CLAUDE.md` — Update ambient mode section with convergence flow
- `plugins/devflow-resolve/README.md` — Document new flags/behavior

---

## Next Steps (Ordered by Dependency)

1. **Define issue fingerprinting spec** — (file, severity, description) hash
2. **Add fingerprint column to resolution-summary.md** — Include in Phase 6 output
3. **Implement Phase 1.5 + Phase 6.5 in resolve:orch** — Early convergence detection
4. **Add `.review-cycles` JSON format** — Track cycle history
5. **Enhance Reviewer context** — Pass PREVIOUS_ISSUES_CONTEXT
6. **Add convergence reporting** — Phase 6 summary + marker files
7. **Test with real hallucinating scenarios** — Validate gate effectiveness
8. **Document in guide** — Full convergence detection runbook

