# Code Review Summary

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25
**Cycle**: 1 / 10

## Merge Recommendation: CHANGES_REQUESTED

The PR is a well-executed architectural simplification applying ADR-001 (clean break philosophy), replacing a complex 4-layer ambient classification pipeline (~1200 lines, 17 skill directories) with a focused 2-component system: plan-detection bash hook + commands awareness rule. This is a significant improvement in simplicity, performance, and maintainability.

**However, 4 blocking issues must be fixed before merge:**

1. **[CRITICAL] Missing LEGACY_SKILL_NAMES for deleted `devflow:`-prefixed skills** — 15 skill directories will be orphaned on existing machines
2. **[HIGH] Dual-source rule content** — `COMMANDS_RULE_CONTENT` and `shared/rules/commands.md` create maintenance risk
3. **[HIGH] Filesystem I/O as hidden side-effect** — `addAmbientHook` mixes JSON transformation with file writes
4. **[HIGH] `removeAmbientHook` silently drops stale hook cleanup** — classification hook removal is discarded when UserPromptSubmit is absent

Additionally, **6 should-fix issues** should be addressed to prevent regressions and improve test coverage. **2 pre-existing documentation issues** that drifted from the architecture changes.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| **Blocking** | 0 | 4 | 4 | 0 |
| **Should Fix** | 0 | 0 | 6 | 0 |
| **Pre-existing** | 0 | 0 | 3 | 0 |
| **Total** | 0 | 4 | 13 | 0 |

---

## Blocking Issues (Must Fix Before Merge)

### HIGH: Missing LEGACY_SKILL_NAMES Entries

**Files**: `src/cli/plugins.ts:LEGACY_SKILL_NAMES`  
**Confidence**: 95%  
**Impact**: Existing users will have 15 orphaned skill directories after upgrade

17 skill directories were deleted (router + 7 triage + 7 guided skills). The bare names already exist in `LEGACY_SKILL_NAMES`, but the `devflow:`-prefixed versions (e.g., `devflow:router`, `devflow:implement:triage`) are missing. When users run `devflow init` after upgrading, these stale directories at `~/.claude/skills/devflow:router/`, etc., will persist and may appear in Claude Code's skill catalog.

**Fix**: Add these 15 entries to `LEGACY_SKILL_NAMES`:
```typescript
// v2.x ambient simplification: deleted router, triage, and guided skills
'devflow:router',
'devflow:implement:triage',
'devflow:implement:guided',
'devflow:debug:triage',
'devflow:debug:guided',
'devflow:explore:triage',
'devflow:explore:guided',
'devflow:plan:triage',
'devflow:plan:guided',
'devflow:review:triage',
'devflow:review:guided',
'devflow:research:triage',
'devflow:research:guided',
'devflow:release:triage',
'devflow:release:guided',
```

---

### HIGH: Dual-Source Rule Content

**Files**: 
- `src/cli/commands/ambient.ts:26-52` (TypeScript constant)
- `shared/rules/commands.md` (canonical source file)

**Confidence**: 90% (flagged by architecture, complexity, consistency, regression reviewers)

The commands rule content exists in two locations with identical text. `ambient.ts` writes the TypeScript string literal to disk, while `shared/rules/commands.md` sits in the rules directory but is not declared in `plugin.json` (so the build system never distributes it). This creates two independent write channels:

1. `ambient.ts` writes via `COMMANDS_RULE_CONTENT` constant → `~/.claude/rules/devflow/commands.md`
2. Rules installer (if someone declares it) writes via `shared/rules/commands.md` → `~/.claude/rules/devflow/commands.md`

**Why this is blocking**: The CLAUDE.md explicitly says the rule is "managed by ambient.ts directly, not by the rules plugin system," but the physical file exists in `shared/rules/` (the canonical source directory). Any future maintainer editing `shared/rules/commands.md` will break the embedded constant silently. There is no mechanism to detect drift.

**Fix (choose one)**:
- **Option A (cleaner)**: Delete `shared/rules/commands.md`. The embedded constant in `ambient.ts` is the source of truth. The CLAUDE.md count changes from "13 rules" (4 core + 8 language/UI + 1 ambient-managed) to "12 rules" and the rule becomes ambient-exclusive.
- **Option B**: Remove `COMMANDS_RULE_CONTENT` from `ambient.ts` and read from `shared/rules/commands.md` at build time, letting the normal rules pipeline manage it. Add `'commands'` to `devflow-ambient` `plugin.json` `rules` array.

Recommendation: **Option A is cleaner** given the stated design of ambient managing the rule directly.

---

### HIGH: Side-Effect Hidden in JSON Transformation

**Files**: `src/cli/commands/ambient.ts:95-131` (function) and `src/cli/commands/ambient.ts:232-240` (caller)

**Confidence**: 85% (flagged by reliability, architecture reviewers)

`addAmbientHook` was previously a pure synchronous function that transformed settings JSON. It is now async and performs filesystem I/O (mkdir + writeFile for the commands rule) as a side effect. The function then returns early (line 129) if the hook already exists, creating a confusing contract:

- When the hook is already present → returns unchanged JSON (signals "no change") BUT writes the rule file to disk
- When the hook is absent → returns changed JSON (signals "change") AND writes the rule file to disk

The caller at `ambient.ts:233-240` prints "already enabled" when `updated === settingsContent` and returns early, skipping the settings.json write. The rule file was still written silently as a side-effect — which is correct and idempotent, but the contract is unclear.

**Why this is blocking**: If the rule file write fails (e.g., permission denied), the exception bubbles to a caller expecting a JSON transformation, not a file I/O operation. Additionally, the early return creates asymmetry: the function signals "no change" while it did work (file write).

**Fix**: Separate concerns. Extract rule file writing into a dedicated function:

```typescript
// Keep pure
export function addAmbientHook(settingsJson: string, devflowDir: string): string {
  // ... JSON transformation only ...
  return unchanged ? settingsJson : JSON.stringify(...);
}

// New explicit function for file I/O
export async function installCommandsRule(): Promise<void> {
  await fs.mkdir(path.dirname(COMMANDS_RULE_PATH), { recursive: true });
  await fs.writeFile(COMMANDS_RULE_PATH, COMMANDS_RULE_CONTENT, 'utf-8');
}

// Caller in ambientCommand:
const updated = addAmbientHook(settingsContent, devflowDir); // pure
if (updated !== settingsContent) {
  await writeFileSync(settingsPath, updated);
}
await installCommandsRule(); // explicit side-effect
```

---

### HIGH: `removeAmbientHook` Discards Stale Hook Cleanup

**Files**: `src/cli/commands/ambient.ts:141-155`

**Confidence**: 92% (flagged by TypeScript, consistency, regression reviewers)

The function calls `filterHookEntries(settings, 'SessionStart', isClassification)` to remove stale classification hooks from previous installs but discards the return value:

```typescript
filterHookEntries(settings, 'SessionStart', isClassification); // ← no assignment
// ...
if (!removedPrompt) return settingsJson; // ← only checks UserPromptSubmit
```

If a user has **only** a stale classification hook (no UserPromptSubmit hooks at all), the function:
1. Mutates `settings` object in memory (classification hook removed)
2. Returns the original `settingsJson` string unchanged (because `removedPrompt` is false)
3. The in-memory mutation is lost

**Why this is blocking**: Upgrading users who had ambient enabled but disabled it will keep a stale hook that is no longer used. This violates the contract stated in the JSDoc: "Also removes stale SessionStart classification hook from previous installs."

**Fix**: Capture both removal results:

```typescript
export async function removeAmbientHook(settingsJson: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  try {
    await fs.unlink(COMMANDS_RULE_PATH);
  } catch {
    // File may not exist
  }

  if (!removedPrompt && !removedClassification) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}
```

---

### HIGH (MEDIUM in some reviews): `hasAmbientHook` Only Checks UserPromptSubmit

**Files**: `src/cli/commands/ambient.ts:161-168`

**Confidence**: 82% (flagged by architecture, consistency reviewers)

The detection function only checks for the preamble hook in UserPromptSubmit. It does not verify that the commands rule file exists at `COMMANDS_RULE_PATH`. A user with a partially-failed install or who manually deleted the rule file will see ambient as "enabled" but be missing command awareness.

**Why this is less urgent than the above**: The hook is the canonical signal for "ambient enabled" and the rule file is secondary. However, the system is marketed as "two-component" (hook + rule), so the status check should reflect both.

**Fix**: Either (a) make `hasAmbientHook` async and check file existence, or (b) document that the hook is the canonical signal and the rule is optional. If (a), update the `--status` command to be async. **Low-priority fix**.

---

## Should-Fix Issues (Secondary Priority)

### MEDIUM: Filesystem I/O Happens on Idempotent Calls

**Files**: `src/cli/commands/ambient.ts:126-127`

**Confidence**: 70% (flagged by performance reviewer)

The rule file is always written even when `addAmbientHook` detects the hook already exists. The `mkdir` + `writeFile` happen before the early return that signals "no change." This means every idempotent call performs two unnecessary filesystem syscalls. Impact is minimal (only runs during init or enable, not on hot path) but violates the "idempotent" contract in the JSDoc comment.

**Fix**: Move the rule file write outside the "hook already exists" path, or make it conditional:
```typescript
if (!changed) {
  // Rule still needs writing even if hook exists
  await fs.mkdir(path.dirname(COMMANDS_RULE_PATH), { recursive: true });
  await fs.writeFile(COMMANDS_RULE_PATH, COMMANDS_RULE_CONTENT, 'utf-8');
  return settingsJson; // unchanged
}
```

Or better: split into separate functions (see blocking fix #2 above).

---

### MEDIUM: Unit Tests Execute Real Filesystem I/O

**Files**: `tests/ambient.test.ts:17-140`

**Confidence**: 90% (flagged by testing reviewer)

The unit tests for `addAmbientHook`/`removeAmbientHook` call functions that now execute `fs.mkdir`, `fs.writeFile`, and `fs.unlink` on the real home directory (`~/.claude/rules/devflow/commands.md`). Unit tests must not have real filesystem side-effects — this breaks isolation and can cause flaky failures in CI or parallel test runs.

**Fix**: Mock the fs operations:
```typescript
vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
vi.spyOn(fs, 'writeFile').mockResolvedValue();
vi.spyOn(fs, 'unlink').mockResolvedValue();
```

---

### MEDIUM: `removeAmbientHook` Swallows All `fs.unlink` Errors

**Files**: `src/cli/commands/ambient.ts:148-152`

**Confidence**: 82% (flagged by reliability reviewer)

The catch block swallows all errors from `fs.unlink`, not just `ENOENT` (file not found). Permission errors, filesystem errors, etc., are silently eaten. If the rule file exists but cannot be deleted (e.g., read-only directory), the user sees "disabled" but the stale rule file remains, silently injecting commands into every session.

**Fix**: Only swallow `ENOENT`:
```typescript
try {
  await fs.unlink(COMMANDS_RULE_PATH);
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw err;
  }
}
```

---

### MEDIUM: Preamble Hook Has No Upper-Bound Guard

**Files**: `scripts/hooks/preamble:25`

**Confidence**: 80% (flagged by reliability reviewer)

The preamble hook performs substring matching on the entire prompt with no size guard. While bash glob matching is efficient, extremely large prompts could theoretically cause slowdown. The 5-second hook timeout provides an implicit bound, but there's no explicit safeguard. Low practical risk but a defense-in-depth improvement.

**Fix**: Add a size guard:
```bash
if [ "${#PROMPT}" -gt 65536 ]; then exit 0; fi
```

---

### MEDIUM: Missing Test Coverage for Stale Hook Cleanup Edge Case

**Files**: `tests/ambient.test.ts:152-171`

**Confidence**: 82% (flagged by testing reviewer)

The test suite covers removing a stale classification hook from SessionStart but doesn't test the edge case where **only** a classification hook exists (no UserPromptSubmit hooks). This edge case triggers the bug in `removeAmbientHook` described in blocking issue #4 above.

**Fix**: Add a test case documenting the edge case:
```typescript
it('removes stale classification hook from SessionStart when no UserPromptSubmit exists', async () => {
  const input = JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: '/path/to/session-start-classification' }] },
      ],
    },
  });
  const result = await removeAmbientHook(input);
  const parsed = JSON.parse(result);
  expect(parsed.hooks.SessionStart).toBeUndefined(); // Hook should be cleaned
});
```

---

### MEDIUM: Integration Test Bypasses Actual Preamble Hook

**Files**: `tests/integration/ambient-activation.test.ts:38-43`

**Confidence**: 80% (flagged by testing reviewer)

The "plan handoff" test manually injects `systemPrompt: 'EXECUTION_PLAN detected...'` rather than verifying the actual bash preamble hook fires. The test validates that Claude responds to the directive but not that the hook detects markers and outputs it. The critical path of the new architecture (bash pattern matching) has no direct integration test.

**Fix**: Either verify the actual hook fires (if possible in `claude -p` mode) or add a shell-level unit test:
```bash
echo 'some prompt ## Goal Add X ## Steps 1. Do Y ## Files z.ts' | \
  DEVFLOW_USER_PROMPT='...' \
  bash scripts/hooks/preamble | \
  grep -q 'EXECUTION_PLAN'
```

---

## Pre-existing Issues (Informational)

### HIGH: "First Message" Claim Contradicts Hook Behavior

**Files**: 
- `shared/rules/commands.md:24`
- `plugins/devflow-ambient/README.md:15`

**Confidence**: 92%

Both files claim plan detection fires only on "the first message in a session." However, the preamble hook checks every prompt with no first-message guard. The CLAUDE.md description is accurate ("when a prompt contains"), making the rule and README misleading.

**Fix**: Remove "first message" qualifier:
- In `shared/rules/commands.md:24`: "When the first message in a session is a structured implementation plan" → "When a prompt is a structured implementation plan"
- In `plugins/devflow-ambient/README.md:15`: "When the first message contains" → "When a prompt contains"

---

### HIGH: README Rule Count Not Updated

**Files**: `README.md:56`

**Confidence**: 88%

The README says "12 ultra-condensed engineering principles" but this PR adds the commands rule (13 total). The CLAUDE.md was correctly updated but the README was not.

**Fix**: Update to "13" and clarify the breakdown.

---

### MEDIUM: README Skills Section Overstates Ambient Scope

**Files**: `plugins/devflow-ambient/README.md:39-47`

**Confidence**: 82%

The Skills section lists 9 orch skills as if ambient mode triggers all of them. In reality, only `implement:orch` is triggered by plan detection. The other 8 are available as slash commands but not routed by ambient.

**Fix**: Clarify or restrict to just `implement:orch`.

---

## Convergence Status

**Cycle 1 of 10** — No prior resolutions to compare against.

All 10 reviewers independently identified the same core issues:
- **Dual-source rule content** — flagged by all 4 reviewers who examine system coupling (architecture, complexity, consistency, regression)
- **`addAmbientHook` filesystem side-effect** — flagged by 4 reviewers (architecture, reliability, consistency, regression)
- **`removeAmbientHook` stale hook cleanup bug** — flagged by 4 reviewers (typescript, consistency, regression, reliability)
- **Missing `devflow:` skill prefixes in LEGACY_SKILL_NAMES** — flagged uniquely by regression reviewer (highest confidence: 95%)

This convergence indicates these are real, high-confidence issues that must be addressed.

---

## Recommendations for Resolution

**Priority 1 (Before Merge)**:
1. Add 15 `devflow:` skill names to LEGACY_SKILL_NAMES
2. Remove dual-source rule content (delete `shared/rules/commands.md`, keep TypeScript constant)
3. Separate rule file writing from `addAmbientHook`
4. Fix `removeAmbientHook` to track classification cleanup

**Priority 2 (Merge-blocking if found during follow-up review)**:
1. Mock filesystem operations in unit tests
2. Narrow `removeAmbientHook` error handling to ENOENT only
3. Fix documentation claims about "first message"
4. Update README rule and skills counts

**Priority 3 (Polish)**:
1. Add size guard to preamble hook
2. Add test for stale hook cleanup edge case
3. Clarify README scope of ambient skills

---

## Architecture Assessment

Despite the blocking issues, the underlying architectural simplification is **sound and beneficial**:

- **Performance gain**: Eliminated per-prompt classification overhead (old: inject instructions on every UserPromptSubmit; new: bash pattern match on plan markers only)
- **Complexity reduction**: -1200 lines, -17 skill directories, -4 pipeline stages (session-start hook, router, triage skills, guided skills)
- **Maintenance improvement**: Simpler architecture = fewer moving parts = easier to debug and extend
- **Applies ADR-001**: Clean break philosophy — old classification system entirely removed, not carried forward with toggles

The blocking issues are **implementation defects** (dual source of truth, hidden side-effects, incomplete cleanup logic), not architectural flaws. All are fixable with localized changes.
