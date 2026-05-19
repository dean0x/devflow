# Performance Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05_1702

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Double JSON.parse in `addAmbientHook`** - `src/cli/commands/ambient.ts:48-51`
**Confidence**: 85%
- Problem: `addAmbientHook` calls `removeLegacyAmbientHook(settingsJson)` which parses the JSON, potentially serializes it, and returns a string. Then `addAmbientHook` immediately re-parses that string on line 51: `const settings: Settings = JSON.parse(cleaned)`. This is two parse+serialize cycles for settings JSON on every `--enable` call. Additionally, `removeLegacyAmbientHook` itself also re-parses when no legacy hook is found (returns raw `settingsJson`), so the happy path (no legacy hook, preamble hook already present) still incurs one unnecessary parse.
- Fix: Refactor `removeLegacyAmbientHook` to accept and return the parsed `Settings` object instead of re-serializing to string, or extract a shared internal function that operates on the parsed object:

```typescript
function removeLegacyFromSettings(settings: Settings): boolean {
  if (!settings.hooks?.UserPromptSubmit) return false;
  const before = settings.hooks.UserPromptSubmit.length;
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    (matcher) => !matcher.hooks.some((h) => h.command.includes(LEGACY_HOOK_MARKER)),
  );
  if (settings.hooks.UserPromptSubmit.length === before) return false;
  if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return true;
}

export function addAmbientHook(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  removeLegacyFromSettings(settings); // mutate in place, single parse
  // ... rest of logic
}
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`LEGACY_SKILL_NAMES` array grows monotonically with each version** - `src/cli/plugins.ts:227-364`
**Confidence**: 82%
- Problem: The `LEGACY_SKILL_NAMES` array is now 137 entries and grows with every rename cycle. During `init`, a loop at `init.ts:863` iterates all 137 entries and calls `fs.rm()` for each, regardless of whether the directory exists. During `uninstall`, the same array is combined with current skill names into a Set and iterated. This is O(n) filesystem operations where n only ever increases. Currently ~137 entries means ~137 `fs.rm` calls per init (each with a syscall to check+delete). Not blocking today but will compound over future versions.
- Fix: Consider batching: read the `skills/` directory once with `fs.readdir`, build a Set of existing directories, then only delete entries that actually exist. This reduces worst-case from O(legacy_count) syscalls to O(actual_stale_count) + 1:

```typescript
const existingDirs = new Set(await fs.readdir(skillsDir).catch(() => []));
for (const legacy of LEGACY_SKILL_NAMES) {
  if (existingDirs.has(legacy)) {
    await fs.rm(path.join(skillsDir, legacy), { recursive: true });
    staleRemoved++;
  }
}
```

### LOW

**PF-006 (known pitfall) not addressed in this PR** - `scripts/hooks/session-start-memory:131-200`
**Confidence**: 80%
- Problem: Known pitfall PF-006 documents per-line jq spawning latency in session-start hooks (Section 1.75 learned behaviors). While this PR did not modify Section 1.75 directly, it touched the session-start-memory hook (removed Section 2: ambient skill injection). The latency issue in the remaining learned-behaviors section is still present. The removal of Section 2 (ambient skill injection) is itself a net performance improvement -- one fewer `cat` + `grep` + conditional file read per session start.
- Fix: Outside scope of this PR, but the known resolution (replace while-read loops with single-pass `jq -s` operations) remains applicable when this area is next touched.

## Suggestions (Lower Confidence)

- **Preamble hook static string could use a heredoc instead of multi-line variable** - `scripts/hooks/preamble:37-41` (Confidence: 65%) -- The multi-line PREAMBLE string uses bash string concatenation across newlines; a heredoc would avoid potential quoting issues and is marginally more efficient for shell parsing, though the difference is negligible for a 5-line string.

- **`buildFullSkillsMap` iterates all plugins redundantly with `buildAssetMaps`** - `src/cli/plugins.ts:457-467` (Confidence: 70%) -- Both functions iterate `DEVFLOW_PLUGINS` to build skill maps. If called in the same init flow, the iteration is duplicated. Could share the result, but the array is small (17 plugins) so impact is minimal.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a net performance positive: it removes the ambient skill injection from session-start-memory (eliminates file I/O + grep + cat per session start), replaces it with a lightweight detection-only preamble hook, and shortens skill names (minor token savings in context). The one blocking issue (double JSON parse in `addAmbientHook`) is low-impact since it only fires during `devflow ambient --enable`, not on every prompt. The pre-existing `LEGACY_SKILL_NAMES` growth pattern is worth addressing but should not block this PR.
