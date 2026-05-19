# Architecture Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05
**Commits**: 4 (6e83fa4, 76dfaff, e6d8df5, dada0ef)

## Issues in Your Changes (BLOCKING)

### CRITICAL

_None._

### HIGH

_None._

### MEDIUM

**Dual-parse of settings JSON in `addAmbientHook` — redundant deserialization** - `src/cli/commands/ambient.ts:48-51`
**Confidence**: 85%
- Problem: `addAmbientHook` calls `removeLegacyAmbientHook(settingsJson)` which parses and re-serializes the JSON, then immediately parses the result again on line 51. This is two full parse/serialize cycles for every `addAmbientHook` call when the common case (no legacy hook present) returns the original string unchanged.
- Impact: Minor performance cost on every `devflow init` and `devflow ambient --enable`, but more importantly it is a modularity issue -- the function's internal flow couples two independent operations (legacy cleanup + new hook addition) through a serialized intermediate representation rather than operating on a shared parsed object.
- Fix: Accept a parsed Settings object internally, or restructure so `removeLegacyAmbientHook` and `addAmbientHook` share the same parse:
```typescript
export function addAmbientHook(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  // Remove legacy entries in-place
  const hadLegacy = removeLegacyEntries(settings);

  // Check if new hook already exists
  if (settings.hooks?.UserPromptSubmit?.some((m) =>
    m.hooks.some((h) => h.command.includes(PREAMBLE_HOOK_MARKER)),
  )) {
    return hadLegacy ? JSON.stringify(settings, null, 2) + '\n' : settingsJson;
  }
  // ... add new hook to settings ...
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Preamble hook references `devflow:router` skill by convention, not by contract** - `scripts/hooks/preamble:40-44`, `shared/skills/router/SKILL.md:12`
**Confidence**: 82%
- Problem: The preamble hook injects a hardcoded instruction to "Load devflow:router skill FIRST via Skill tool" but there is no runtime validation that this skill is installed. The router SKILL.md notes "This SKILL.md contains the full skill mappings -- load it via Skill tool for complete routing logic." This creates a two-layer architecture (preamble for detection, router for mappings) where failure of the second layer (router skill missing or renamed) silently degrades to classification-only with no skill loading. The preamble contains no fallback instructions.
- Impact: If `devflow:router` is renamed again in a future refactoring pass, the preamble becomes a dead-end -- it tells the LLM to load a skill that does not exist, with no error handling guidance. The previous architecture (ambient-prompt) was self-contained, embedding skill mappings directly in the preamble. The new split is cleaner in principle but introduces an implicit contract between the shell hook and the installed skill.
- Fix: Either (a) make the preamble include a minimal fallback mapping for the most common intents (so classification still produces skill loads even if the router skill fails), or (b) add a SYNC comment in both the preamble and router SKILL.md that explicitly names the coupling:
```bash
# SYNC: Router skill name must match devflow:router (see shared/skills/router/SKILL.md)
# If this name changes, update the PREAMBLE string below AND the DEVFLOW_PREAMBLE in tests/integration/helpers.ts
```

**`LEGACY_SKILL_NAMES` list is growing unbounded without grouping** - `src/cli/plugins.ts:227-364`
**Confidence**: 80%
- Problem: `LEGACY_SKILL_NAMES` has grown to ~100 entries across 6 naming eras (pre-v1.0.0 `devflow-` prefixed, v1.0.0 consolidation bare names, v2.0.0 namespace migration bare names, v2.0.0 prefixed old names, v2.0.0 new bare names, and now v2.0.0 ambient refinements). Each rename cycle adds both the bare name and the `devflow:`-prefixed name. The comments help but the list is a flat array with no structural relationship between old-name and new-name pairs.
- Impact: Risk of missing entries on future renames (must remember to add both bare and prefixed variants). No automated verification that the legacy list covers all historical names. The list will continue to grow with every rename. This is a modularity concern -- the same rename information exists in `SHADOW_RENAMES` (as tuples) and `LEGACY_SKILL_NAMES` (as a flat list), which is a DRY violation.
- Fix: Derive `LEGACY_SKILL_NAMES` from `SHADOW_RENAMES` plus a small set of truly ancient names:
```typescript
// Ancient names that predate SHADOW_RENAMES
const ANCIENT_LEGACY_SKILLS: string[] = [
  'devflow-core-patterns', 'devflow-review-methodology', /* ... */
];

// Derive from SHADOW_RENAMES: each old name generates bare + prefixed entries
export const LEGACY_SKILL_NAMES: string[] = [
  ...ANCIENT_LEGACY_SKILLS,
  ...SHADOW_RENAMES.flatMap(([oldName]) => [oldName, `devflow:${oldName}`]),
  // Also add new bare names (for pre-namespace installs)
  ...SHADOW_RENAMES.map(([, newName]) => newName),
];
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`devflow-ambient` plugin declares all 11 agents -- superset of any single intent path** - `src/cli/plugins.ts:98`
**Confidence**: 85%
- Problem: The `devflow-ambient` plugin's agent list includes every agent in the system (coder, validator, simplifier, scrutinizer, evaluator, tester, skimmer, reviewer, git, synthesizer, resolver). This means installing ambient mode pulls in every agent regardless of which intents the user actually triggers. While agents are just markdown files (low disk cost), the architectural concern is that the plugin manifest does not express which agents belong to which intent path, making it impossible to reason about agent dependencies per-intent from the manifest alone.
- Impact: No runtime cost, but the manifest loses its value as a dependency declaration -- it's effectively "everything." If agent installation ever becomes selective or size-constrained, this all-or-nothing approach would need to be decomposed.

**PF-002 (init handler monolith) continues to grow** - `src/cli/commands/init.ts`
**Confidence**: 90%
- Problem: Known pitfall PF-002 documents that the init handler is a monolith. This PR adds `removeAmbientHook` import and the legacy-cleanup-before-add pattern (line 920), further extending the monolithic action handler. While the change itself is minimal and correct, it reinforces the pattern rather than addressing it.
- Impact: Pre-existing architectural issue, documented in pitfalls. Not introduced by this PR.

## Suggestions (Lower Confidence)

- **Preamble and router skill catalog may drift** - `scripts/hooks/preamble:37-44`, `shared/skills/router/references/skill-catalog.md` (Confidence: 70%) -- The preamble lists intent names (CHAT, EXPLORE, PLAN, IMPLEMENT, REVIEW, RESOLVE, DEBUG, PIPELINE) which must match the router's Step 1 table. Two sources of truth for the intent taxonomy. Consider a generated constant or SYNC marker.

- **Test helper `runClaudeStreaming` uses process spawn without cleanup guarantee** - `tests/integration/helpers.ts` (Confidence: 65%) -- The streaming helper spawns a `claude` process and kills it on detection or timeout. If the test runner itself crashes before the timeout fires, orphaned `claude` processes could persist. Consider adding a `beforeAll`/`afterAll` cleanup hook in the test suite.

- **Explore skill has both GUIDED and ORCHESTRATED paths in a single SKILL.md** - `shared/skills/explore/SKILL.md` (Confidence: 62%) -- Most orchestration skills are ORCHESTRATED-only (implement, debug, pipeline). The explore skill uniquely contains both GUIDED behavior (main session direct) and ORCHESTRATED pipeline. This dual-mode pattern within a single skill could lead to confusion about which path to follow, though the router's depth classification should disambiguate.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Assessment

This is a well-executed architectural refinement. The core changes are:

1. **Skill renames** (9 skills shortened: `ambient-router` -> `router`, `implementation-orchestration` -> `implement`, etc.) -- Clean, consistent naming. Migration path via `LEGACY_SKILL_NAMES` and `SHADOW_RENAMES` is thorough.

2. **Preamble separation of concerns** -- Splitting the monolithic `ambient-prompt` hook (which embedded all skill mappings) into a detection-only `preamble` hook + a `devflow:router` skill is architecturally sound. The preamble is now ~6 lines of classification rules instead of ~15 lines with skill mappings. This follows the information hiding principle: the preamble knows about intent taxonomy, the router knows about skill mappings.

3. **Session-start simplification** -- Removing the ambient skill injection from `session-start-memory` (Section 2) reduces the hook's responsibilities from 2 to 1, aligning with SRP.

4. **New orchestration skills** (`explore`, `implement`, `debug`, `plan`) -- Each follows the established pattern (Iron Law, phase structure, worktree support, error handling). The `explore` skill adds GUIDED behavior alongside ORCHESTRATED, which is novel but well-structured.

5. **Legacy migration** -- The `addAmbientHook` function now performs remove-then-add to upgrade from `ambient-prompt` to `preamble`. Init.ts applies the same pattern. Shadow renames cover all 9 skill name changes.

6. **Test infrastructure overhaul** -- Moving from `execFileSync` + JSON output to `spawn` + `stream-json` is a significant improvement for detecting Skill tool invocations. The `StreamResult` interface replaces `ClaudeResult` with a more appropriate contract for streaming detection.

The conditions for approval are the MEDIUM blocking issue (dual-parse in `addAmbientHook`) which is a minor modularity concern, not a correctness bug. The should-fix items around SYNC markers and legacy list derivation are architectural hygiene improvements that would reduce future maintenance risk.
