## Mode: Bug Analysis

Synthesize outputs from multiple Diagnose agents into a single actionable bug report.

**Input:**
- **ANALYSIS_BASE_DIR**: Timestamped directory containing `{focus}.md` files and `static-findings.md`
- **BRANCH**: Branch name and base branch
- **TIMESTAMP**: ISO timestamp for the report

**Process:**
1. Read all `{focus}.md` files from `${ANALYSIS_BASE_DIR}` — exclude `bug-analysis-summary.md` and `static-findings.md`
2. Also read `${ANALYSIS_BASE_DIR}/static-findings.md` if it exists (contains raw tool output)
3. Extract all bugs with their confidence percentages and static tool source (if noted)
4. Cross-track confidence: findings that appear in both `static-findings.md` and a focus report get +10% confidence boost (static-confirmed)
5. Deduplicate: same file:line from multiple analyzers → keep highest confidence, boost +10% per additional agent (cap 100%)
6. Merge acceptance criteria coverage tables from the functional analyzer (if present)
7. Sort bugs by severity (CRITICAL → HIGH → MEDIUM → LOW), then by confidence descending within each severity
8. Determine overall risk assessment: highest severity of any CRITICAL/HIGH bug found

**Output:**
**CRITICAL**: Write the summary to disk using the Write tool:
1. Create directory: `mkdir -p ${ANALYSIS_BASE_DIR}`
2. Write to `${ANALYSIS_BASE_DIR}/bug-analysis-summary.md` using Write tool
3. Confirm file written in final message

Report format:

```markdown
# Bug Analysis Summary

**Branch**: {branch} -> {base}
**Date**: {timestamp}

## Risk Assessment: {CRITICAL | HIGH | MEDIUM | LOW | CLEAN}

{Brief reasoning — what drives the risk level, or "No bugs found above confidence threshold."}

## Bug Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Security | {n} | {n} | {n} | {n} | {n} |
| Functional | {n} | {n} | {n} | {n} | {n} |
| Integration | {n} | {n} | {n} | {n} | {n} |
| Usability | {n} | {n} | {n} | {n} | {n} |

## Critical & High Bugs

{For each CRITICAL and HIGH bug (sorted by severity then confidence):}
**{Title}** — `file:line` ({n}% confidence, {Category})
- Problem: {description}
- Fix: {suggestion}

## Acceptance Criteria Status

(Omit section if no functional analyzer produced acceptance criteria coverage)

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| {id} | {criterion} | PASS / FAIL / NOT_TESTED | {file:line or note} |

## Suggestions (Lower Confidence)

{Max 5 items across all analyzers with 60-79% confidence. Brief description only.}

- **{Issue}** — `file.ts:456` ({n}%, {Category}) — {brief description}

## Action Plan
1. {Highest-priority fix — CRITICAL or first HIGH}
2. {Next priority fix}
3. {Additional fixes in priority order}
```
