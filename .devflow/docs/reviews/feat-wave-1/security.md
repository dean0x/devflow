# Security Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13
**Commits reviewed**: 5 (cd315f5, 9e316a7, 47c4a67, 7879fc6, 53380dc)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Insufficient validation on `readManifest` parsed data (A08 — Data Integrity)** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:27-30`
**Confidence**: 82%
- Problem: `readManifest` uses `JSON.parse(content) as ManifestData` with a type assertion, then validates only three top-level fields (`version`, `plugins` array, `scope`). The remaining fields (`features`, `installedAt`, `updatedAt`) are trusted without validation. A malformed or tampered `manifest.json` could inject unexpected types into `features.teams`, `features.ambient`, or `features.memory` (e.g., strings instead of booleans), which would then propagate into `list.ts:29-31` where they are used in truthiness checks and into display output. While this is a local CLI tool and the manifest is written by the tool itself, the file is user-editable on disk.
- Fix: Validate the full shape of the manifest, or use a schema library (Zod is already a project convention per CLAUDE.md). At minimum, add guards for the `features` object:
```typescript
if (
  !data.version ||
  !Array.isArray(data.plugins) ||
  !data.scope ||
  typeof data.features?.teams !== 'boolean' ||
  typeof data.features?.ambient !== 'boolean' ||
  typeof data.features?.memory !== 'boolean' ||
  typeof data.installedAt !== 'string' ||
  typeof data.updatedAt !== 'string'
) {
  return null;
}
```

---

**No file permission restriction on `writeManifest` output (A05 — Security Misconfiguration)** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:43`
**Confidence**: 80%
- Problem: `writeManifest` creates `manifest.json` with default file permissions (typically `0o644` on Unix), meaning any local user can read it. The manifest contains installation metadata (version, installed plugins, feature flags, timestamps). While none of this is secret, it reveals the exact tool configuration which could help an attacker understand the development environment in a shared-machine scenario. This is a minor hardening opportunity, not an exploitable vulnerability.
- Fix: Write with restricted permissions if desired:
```typescript
await fs.writeFile(manifestPath, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
```

## Issues in Code You Touched (Should Fix)

_No issues found in this category._

## Pre-existing Issues (Not Blocking)

_No pre-existing CRITICAL issues detected in reviewed files._

## Suggestions (Lower Confidence)

- **Prototype pollution via JSON.parse** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:27` (Confidence: 65%) -- `JSON.parse` on a user-editable file could theoretically contain `__proto__` keys. In practice, the parsed object is only accessed via known property names and TypeScript types, and modern V8 engines do not propagate `__proto__` from `JSON.parse` to the global prototype chain. Risk is negligible but worth noting for defense-in-depth in security-critical contexts.

- **Symlink following in manifest path** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:24,42` (Confidence: 62%) -- Both `readManifest` and `writeManifest` accept a `devflowDir` parameter and use `path.join` to construct the manifest path. If `devflowDir` or the manifest file itself were replaced with a symlink, the tool would follow it. Given that `devflowDir` comes from `getDevFlowDirectory()` (which validates absolute paths and warns about out-of-home directories), exploitation requires the attacker already has write access to `~/.devflow/`, making this low-impact.

- **Unvalidated `version` string in semver comparison** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:66` (Confidence: 60%) -- The `compareSemver` regex `^v?(\d+)\.(\d+)\.(\d+)` captures digits without length bounds. Extremely long version strings could cause minor regex performance overhead, but `Number()` conversion prevents integer overflow exploits. Not exploitable in practice.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions
1. The manifest validation gap (MEDIUM) should be addressed before merge or in a fast-follow. The type assertion `as ManifestData` bypasses TypeScript's guarantees at runtime, and this is the only place in the PR where external data enters the system without full validation. Adding explicit type guards for all fields (or a Zod schema, per project conventions) would close this gap.
2. The file permission issue is a minor hardening suggestion and does not block merge.

### Overall Assessment
This PR introduces a well-structured manifest system for upgrade tracking, a new search-first skill, reviewer confidence thresholds, and related documentation updates. The security surface is small -- the only new code that processes external input is `readManifest`, and it already has partial validation. No injection vectors, no hardcoded secrets, no command execution, no network calls, and no authentication-relevant code was introduced. The changes to agent/skill markdown files are configuration-only and pose no security risk. The TypeScript CLI changes follow existing patterns (dependency injection via path utilities, no global state, proper error handling with try/catch).
