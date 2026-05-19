# Security Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30_1831

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Example secrets in skill reference files could trigger secret scanners** - `shared/skills/security/references/violations.md:132` (Confidence: 65%) -- The string `sk-abc123xyz789` is used as an illustrative example of a hardcoded secret. While clearly a teaching example (commented as `// VULNERABLE`), some automated secret scanners (e.g., GitHub secret scanning, git-secrets) may flag this pattern. Consider using an obviously fake format like `sk-EXAMPLE-DO-NOT-USE` or wrapping in a comment that suppresses scanner alerts. This is pre-existing content migrated from the old `security-patterns` skill, not newly introduced.

- **`migrateShadowOverrides` accepts an arbitrary directory path without validation** - `src/cli/commands/init.ts:61` (Confidence: 60%) -- The function receives `devflowDir` and constructs paths using `path.join(devflowDir, 'skills')` then does `fs.rename` operations. Since `SHADOW_RENAMES` is a hardcoded constant (not user input) and the only caller passes the controlled `devflowDir` path from the init flow, exploitation is not realistic. However, for defense-in-depth, the function could validate that resolved paths stay within the expected `devflowDir` subtree before performing rename operations. Low practical risk since both path components (directory and name) are compile-time constants.

- **`fs.rename` is not atomic across filesystems** - `src/cli/commands/init.ts:78` (Confidence: 62%) -- `fs.rename(oldShadow, newShadow)` will fail if the source and destination are on different mount points (unlikely in practice since both are under `~/.devflow/skills/`). Not a security issue per se, but a robustness concern for the migration path that could leave shadows in an inconsistent state. The existing error handling via try/catch would surface this as an unhandled rejection since the outer catch is for `fs.access` on the old path, not for the rename itself.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

This PR is a large-scale skill renaming and content enrichment effort. The security-relevant changes fall into the following categories:

### 1. Skill renaming (bulk of the diff)
The majority of changes rename skills from verbose names to shorter names:
- `security-patterns` -> `security`
- `architecture-patterns` -> `architecture`
- `performance-patterns` -> `performance`
- `core-patterns` -> `software-design`
- `test-patterns` -> `testing`
- `input-validation` -> `boundary-validation`
- `frontend-design` -> `ui-design`

These renames are propagated consistently across plugin manifests (`plugin.json`), agent frontmatter, command files, README files, shell scripts, and tests. No security impact from the renames themselves.

### 2. New `migrateShadowOverrides` function (`src/cli/commands/init.ts:61-87`)
This is the only new executable logic with security relevance. It migrates user shadow skill overrides from old directory names to new names. Analysis:
- **Path construction**: Uses `path.join` with hardcoded `SHADOW_RENAMES` constants -- no user-controlled path components
- **Race conditions**: No TOCTOU risk because `fs.access` + `fs.rename` operate on local filesystem directories owned by the user
- **Data preservation**: When both old and new shadows exist, it warns but does not overwrite (safe default)
- **Error handling**: Missing paths are caught gracefully via try/catch
- **Test coverage**: 5 test cases covering the core scenarios (rename, conflict, no-op, multi-rename, missing directory)

### 3. Skill content enrichment
Skills now include source citations (bibliography numbers like `[1][6]`) and references to `sources.md` files. The security skill (`shared/skills/security/SKILL.md`) is well-structured with OWASP Top 10 mapping, severity guidelines, and references to authoritative sources (OWASP, NIST, MITRE CWE, IETF RFCs). No executable code in these files.

### 4. Shell script changes (`scripts/hooks/ambient-prompt`)
Only skill name references were updated in the ambient prompt preamble. No changes to shell logic, no new command execution, no new environment variable handling.

### 5. Pitfalls check
Reviewed `.memory/knowledge/pitfalls.md`. PF-002 (init.ts monolith) is relevant -- the new `migrateShadowOverrides` function was correctly extracted as a pure function rather than inlined into the init handler, which is the right direction. No known pitfall patterns are being reintroduced.
