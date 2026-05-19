# Security Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Path traversal via rule names in shadow file resolution** - `src/cli/utils/installer.ts:265-277`, `src/cli/commands/rules.ts:73-86`
**Confidence**: 80%
- Problem: Rule names from the `rulesMap` (originating from `DEVFLOW_PLUGINS` in `plugins.ts`) are interpolated directly into file paths via `path.join(devflowDir, 'rules', \`${ruleName}.md\`)` and `path.join(rulesTarget, \`${ruleName}.md\`)`. While the current rule names are hardcoded string literals in the source code (e.g., `'security'`, `'engineering'`), no validation exists at the path-construction sites. If a future contributor adds a rule name containing path separators or `..` sequences (e.g., via a plugin.json contribution), `path.join` would resolve them, potentially reading from or writing to arbitrary locations. The skill shadow resolution has the same pattern (`isShadowed` at `rules.ts:25`).
- Impact: In the current codebase, this is not exploitable because rule names are hardcoded constants. However, this is a defense-in-depth gap -- the code trusts that all rule names are safe path components without enforcement. If the system ever accepts rule names from external sources (e.g., third-party plugin manifests), this becomes a file write vulnerability.
- Fix: Add a rule name validation guard at `buildRulesMap` or at the path construction sites. A simple check rejects names containing path separators or `..`:
  ```typescript
  function isValidRuleName(name: string): boolean {
    return /^[a-z0-9-]+$/.test(name);
  }
  ```
  Apply this in `buildRulesMap` or as a guard before `path.join` calls. This matches the existing skill naming convention (lowercase-dashes only) and provides defense-in-depth (applies ADR-001 -- clean break, no migration baggage, just enforce from the start).

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Shadow file symlink following** - `src/cli/utils/installer.ts:266-275` (Confidence: 65%) -- The shadow file check uses `fs.access()` then `fs.copyFile()`. If a malicious symlink is placed at `~/.devflow/rules/{name}.md`, `copyFile` would follow it and copy arbitrary file content into the Claude rules directory. Low risk since `~/.devflow/` is user-owned and requires local access to exploit.

- **Recursive directory removal scope** - `src/cli/commands/rules.ts:94` (Confidence: 60%) -- `fs.rm(rulesTarget, { recursive: true, force: true })` removes the entire `~/.claude/rules/devflow/` directory. If `rulesTarget` were miscalculated (e.g., missing the `devflow` segment), it could remove the parent `rules/` directory. The path is computed from `getClaudeDirectory()` which is well-tested, so risk is low.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The rules system introduces a clean, well-scoped feature with minimal attack surface. Rule names are currently hardcoded constants in the source code, and the system does not accept external/user-supplied rule names at any trust boundary. The single MEDIUM finding is a defense-in-depth recommendation to add rule name validation, which would protect against future changes that might introduce untrusted rule names. No secrets, credentials, authentication bypasses, injection vectors, or dangerous execution patterns (eval, exec, spawn) are present in the new code. The shadow override mechanism follows the same pattern already established for skills. Applies ADR-001 (clean break -- LEGACY_RULE_NAMES starts empty with no migration code). Avoids PF-001 (no backward-compatibility shims or migration scaffolding added for a new feature).
