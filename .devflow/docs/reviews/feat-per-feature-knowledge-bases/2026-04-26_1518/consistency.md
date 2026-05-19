# Consistency Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### HIGH

**`hasKbHook` return type inconsistent with `hasLearningHook` pattern** - `src/cli/commands/kb.ts:132`
**Confidence**: 85%
- Problem: `hasLearningHook` returns `'current' | 'legacy' | false` (a tri-state discriminating between current and legacy hook installations), while `hasKbHook` returns `boolean`. While KB hooks have no legacy variant today, this diverges from the established pattern for hook detection functions. Every other `has*Hook` function in the codebase is designed to support future migration detection.
- Fix: This is acceptable if the KB feature intentionally has no legacy migration path. However, if the intent is to match existing patterns for future-proofing, change the return type:
  ```typescript
  export function hasKbHook(input: string | Settings): 'current' | false {
    // ...
    return hasSessionEnd ? 'current' : false;
  }
  ```
  And update callers to check `hookPresent === 'current'` or `hookPresent !== false`. This is a judgment call given KB hooks are brand new.

### MEDIUM

**`addKbHook` uses simple idempotent check; other `add*Hook` functions use remove-then-add internally** - `src/cli/commands/kb.ts:64-93`
**Confidence**: 82%
- Problem: `addLearningHook` internally calls `removeLearningHook(settingsJson)` before adding (to self-upgrade from legacy). `addKbHook` instead does a simple `if (hasKbHook) return` check. In `init.ts`, the caller wraps `addKbHook` with `removeKbHook` externally (line 956-957), which mirrors what `addLearningHook` does internally. The two approaches work but differ: `addLearningHook` is self-contained, `addKbHook` requires callers to remember the remove-then-add dance.
- Fix: Either make `addKbHook` self-contained like `addLearningHook` (remove-then-add internally), or document the external remove-then-add requirement. The self-contained approach is more defensive:
  ```typescript
  export function addKbHook(settingsJson: string, devflowDir: string): string {
    const cleanedJson = removeKbHook(settingsJson);
    const settings: Settings = JSON.parse(cleanedJson);
    // ... add hook ...
  }
  ```

**plan:orch GUIDED behavior loads Feature KBs but not KNOWLEDGE_CONTEXT** - `shared/skills/plan:orch/SKILL.md:28`
**Confidence**: 83%
- Problem: The ORCHESTRATED path in plan:orch loads both `KNOWLEDGE_CONTEXT` (Phase 1) and `FEATURE_KNOWLEDGE` (Phase 2). The GUIDED behavior (line 28) only loads Feature KBs but not `KNOWLEDGE_CONTEXT`. The explore:orch GUIDED path (line 25) was updated in this PR to load both. This inconsistency means plan:orch GUIDED ignores ADR/PF entries entirely.
- Fix: Add a KNOWLEDGE_CONTEXT loading step to plan:orch GUIDED behavior, mirroring what was done for explore:orch:
  ```markdown
  2. **Load Knowledge** — Run `node scripts/hooks/lib/knowledge-context.cjs index "{worktree}"` 
     for KNOWLEDGE_CONTEXT. Read `.features/index.json` if it exists. Based on the task, identify
     relevant KBs, read them, and use as context for direct planning.
  ```

**Inconsistent knowledge passing: explore:orch keeps both orchestrator-local; plan:orch passes both to sub-agents** - `shared/skills/explore:orch/SKILL.md:44-53` vs `shared/skills/plan:orch/SKILL.md:154`
**Confidence**: 80%
- Problem: The explore:orch skill was updated with an explicit "Do NOT pass KNOWLEDGE_CONTEXT to Explore sub-agents" and "Do NOT pass [FEATURE_KNOWLEDGE] to Explore sub-agents" (orchestrator-local asymmetric pattern). Meanwhile, plan:orch Phase 5 (line 154) explicitly passes *both* `KNOWLEDGE_CONTEXT` and `FEATURE_KNOWLEDGE` to Explore agents with a "VALIDATE, EXTEND, and CORRECT" instruction. These are contradictory design decisions for the same type of agent. If explore:orch's rationale is that investigation workers should examine code without pre-loaded context (per CLAUDE.md: "debug:orch keeps FEATURE_KNOWLEDGE orchestrator-local"), then plan:orch should follow the same principle for its Explore agents. Or vice versa — this needs a clear, documented convention.
- Fix: Align the two skills. If the orchestrator-local pattern is correct (explore:orch and debug:orch), update plan:orch Phase 5 Explore agents accordingly. If plan:orch's pass-through is correct, update explore:orch. Add a brief comment explaining the chosen rationale.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shared agent count in docs/reference/file-organization.md updated to 13 but was already 13 before rename** - `docs/reference/file-organization.md:18`
**Confidence**: 82%
- Problem: The diff changes the comment from "12 shared agents" to "13 shared agents" at line 18, and updates the shared agent list at line 141 to include `knowledge`. However, the previous version already had `kb-builder` as the 13th shared agent. The comment was wrong before (said 12 when there were 13), and this PR fixes the count — which is good. But the pre-existing error in the old code (12 instead of 13) suggests the doc may have been stale already. This is just noting the pre-existing inconsistency was correctly fixed.
- Fix: Already fixed in this PR. No action needed.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**review:orch Phase 5 comment says "from Phase 3 file analysis" but Phase 3 is "Load Knowledge Index"** - `shared/skills/review:orch/SKILL.md:99`
**Confidence**: 85%
- Problem: Line 99 says "Conditional reviewers (from Phase 3 file analysis)" but the Phase numbers were renumbered: Phase 3 is now "Load Knowledge Index" and Phase 4 is "File Analysis". The fix in this PR (changing the comment from Phase 3 to Phase 4) corrects this, so this is already addressed.
- Fix: Already fixed in this PR.

## Suggestions (Lower Confidence)

- **Inconsistent `.disabled` sentinel pattern vs hook-presence-is-state** - `.features/.disabled` (Confidence: 70%) — The learning system uses "hook presence in settings.json IS the enabled state" with no separate sentinel file. The KB system introduces a `.disabled` sentinel file as a secondary gate. This dual-signal approach (hook presence + sentinel) means the system can be in inconsistent states (hook present but sentinel exists, or hook absent but sentinel removed). Consider whether the hook-presence-is-state pattern alone would suffice.

- **Background script `background-kb-refresh` uses `$STALE_SLUGS` in an unquoted for-loop** - `scripts/hooks/background-kb-refresh:97` (Confidence: 65%) — The `for SLUG in $STALE_SLUGS` pattern word-splits on whitespace. KB slugs are validated as kebab-case (no spaces), so this is safe in practice, but quoting or using `mapfile` would be more defensive.

- **`checkEntryFiles` extracted as shared helper but not exported** - `scripts/hooks/lib/feature-kb.cjs` (Confidence: 62%) — The new `checkEntryFiles` function is extracted for DRY reuse between `checkStaleness` and `checkAllStaleness`, which is good. It is not exported, which is appropriate for internal use. No action needed.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 1 | - |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The rename from `kb-builder` to `knowledge` is thoroughly applied across all 33 changed files — agent definitions, plugin manifests, command files, orchestration skills, tests, and documentation. This is a well-executed codebase-wide rename with no missed references. The `KNOWLEDGE_CONTEXT` threading to implement/coder/scrutinizer/evaluator is consistent within those flows.

The primary consistency concerns are: (1) the `hasKbHook` return type diverging from the established tri-state pattern, (2) the `addKbHook` function not being self-contained like its sibling, and (3) the contradictory knowledge-passing strategy between explore:orch (orchestrator-local) and plan:orch (pass to sub-agents). The `.disabled` sentinel introduces a dual-signal toggle pattern that differs from the hook-presence-is-state convention used by the learning system, though this may be intentional given KB generation can be triggered by plan:orch Phase 12 independently of the hook.
