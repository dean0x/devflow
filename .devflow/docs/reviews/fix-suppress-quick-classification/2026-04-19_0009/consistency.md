# Consistency Review Report

**Branch**: fix-suppress-quick-classification -> main
**Date**: 2026-04-19

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Missing `hasClassification` assertion in slash-command preamble filter test** - `tests/integration/ambient-activation.test.ts:57-62`
**Confidence**: 90%
- Problem: Three of the four QUICK-tier tests received the new `expect(hasClassification(result)).toBe(false)` assertion (lines 38, 45, 53), but the fourth test ("preamble filter -- slash command prefix skipped before classification") at line 57-62 did not. All four tests share the same semantic contract: classification output should not appear. The slash-command test's comment even says "no classification or skill loading", reinforcing that the assertion belongs there.
- Fix: Add the `hasClassification` assertion to the slash-command preamble filter test:
```typescript
it('preamble filter — slash command prefix skipped before classification', async () => {
    // Preamble filters prompts starting with "/" — no classification or skill loading
    const result = await runClaudeStreaming('/help with something', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    expect(hasClassification(result)).toBe(false);
    console.log(`preamble filter (slash command): no skills (${result.durationMs}ms)`);
  });
```

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No issues found.

## Suggestions (Lower Confidence)

No suggestions.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

### Notes

**PF-001 check**: The diff modifies `tests/integration/helpers.ts` (PF-001 area), but only changes a file path string and preamble text -- no Promise callback parameters are touched. The `resolve` import from `path` is used consistently as `resolve(...)` throughout the file. PF-001 resolution is preserved.

**What this PR does well**:
- Path references to `classification-rules.md` are updated consistently across all 5 files (preamble hook, session-start hook, ambient test, skill-references test, integration helpers).
- The session-start hook adds a proper legacy fallback (`CLASSIFICATION_RULES_LEGACY`) for users who haven't reinstalled yet, maintaining backward compatibility.
- The old `awk`-based SKILL.md fallback (which parsed frontmatter to extract rules) is replaced with a cleaner `cat` of the legacy path -- a simpler fallback that better matches the primary path's behavior.
- The preamble wording change ("then load devflow:router" -> "If GUIDED or ORCHESTRATED, load devflow:router") aligns with `classification-rules.md` line 30-31 and CLAUDE.md's updated "conditional router loading" description.
- The `hasClassification` helper is pre-existing and well-documented (with its `@see` alias `hasDevFlowBranding`), so the new test assertions reuse existing infrastructure.
