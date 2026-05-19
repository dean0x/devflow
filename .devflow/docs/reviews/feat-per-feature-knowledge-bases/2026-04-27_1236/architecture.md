# Architecture Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27
**Diff range**: 998f2b2...HEAD (5 commits)

## Issues in Your Changes (BLOCKING)

### HIGH

**Sidecar path interpolated into Node.js string literal -- shell injection vector** - `scripts/hooks/background-kb-refresh:163-168`
**Confidence**: 85%
- Problem: The `$SIDECAR` variable is interpolated directly into a Node.js string literal passed via `node -e`. If a malicious or malformed `.features/$SLUG/` path contained a single quote, it would break out of the JS string and execute arbitrary code. While the slug is validated upstream (`validateSlug` rejects path traversal), the `$CWD` prefix is user-controlled (passed from the hook chain) and could in theory contain adversarial characters.
- Impact: Potential code injection in the background process running with `--dangerously-skip-permissions`.
- Fix: Use the `feature-kb.cjs` CLI to read the sidecar instead of inline `node -e`, or pass the path via an environment variable and read it with `process.env` inside the JS snippet:
  ```bash
  REF_FILES=$(SIDECAR_PATH="$SIDECAR" node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(process.env.SIDECAR_PATH,'utf8'));
      console.log(JSON.stringify(d.referencedFiles || []));
    } catch { console.log('[]'); }
  " 2>/dev/null || echo "[]")
  ```

**Unsafe type assertion to access `referencedFiles` on untyped entry** - `src/cli/commands/kb.ts:539`
**Confidence**: 82%
- Problem: `(kbEntry as Record<string, unknown>)?.referencedFiles as string[]` casts through `Record<string, unknown>` then `as string[]`. The `FeatureKbModule.listKBs` return type does not include `referencedFiles` in its declared interface (line 22), so the code reaches around TypeScript's type system. If `referencedFiles` is undefined or not an array, the fallback chain still works (falls through to `[]`), but the double cast masks a type system gap.
- Impact: Violates DIP -- depending on an undeclared implementation detail rather than the interface contract. If `listKBs` return shape changes, this silently breaks without compile-time detection.
- Fix: Either expand the `FeatureKbModule.listKBs` return type to include `referencedFiles: string[]`, or perform a separate `checkStaleness` or `loadIndex` call to get referenced files through a typed path:
  ```typescript
  interface FeatureKbModule {
    listKBs: (worktreePath: string) => Array<{
      slug: string; name: string; category: string;
      directories: string[]; referencedFiles: string[];
      lastUpdated: string;
    }>;
    // ...
  }
  ```

### MEDIUM

**Sidecar pattern duplicated across three call sites without shared abstraction** - `src/cli/commands/kb.ts:381-434`, `src/cli/commands/kb.ts:497-544`, `scripts/hooks/background-kb-refresh:108-178`
**Confidence**: 85%
- Problem: The sidecar file pattern (clear old sidecar, spawn agent, read sidecar JSON, call updateIndex, clean up sidecar) is repeated three times: `create`, `refresh` (CLI), and `background-kb-refresh` (shell hook). Each has slightly different fields (`create` reads `category` + `description` + `referencedFiles`; `refresh` reads only `referencedFiles`; background reads `referencedFiles`), but the core lifecycle is identical. This is an OCP concern -- adding a new sidecar field means updating three locations.
- Impact: Maintenance burden increases with each new sidecar field. Divergence risk if one site is updated and another is missed (the create path already reads `category` and `description` that the refresh paths do not).
- Fix: Extract a shared `readAndApplySidecar(sidecarPath, defaults)` helper in `feature-kb.cjs` that handles the read-parse-fallback lifecycle. The CLI and shell hook can both call it. This also eliminates the inline `node -e` in `background-kb-refresh` entirely.

**`set -e` removal from background hooks is correct but inconsistent with `session-end-kb-refresh`** - `scripts/hooks/background-kb-refresh:1-10`, `scripts/hooks/session-end-kb-refresh:11`
**Confidence**: 80%
- Problem: `set -e` was removed from `background-kb-refresh`, `background-learning`, and `background-memory-update` (good -- background scripts should not abort on transient failures), but `session-end-kb-refresh` still has `set -e` on line 11. The session-end hook uses early `exit 0` for guard clauses, which is fine, but if the `node ... stale-slugs` call on line 41 exits non-zero for a transient reason (e.g., node module not found), `set -e` aborts the entire hook silently. The other session-end hooks (`session-end-learning`) follow the same pattern, so this is a pre-existing consistency question, but since this file was modified in this PR, it should be addressed.
- Impact: Transient failures in `stale-slugs` computation silently prevent all future KB refresh attempts until the next session.
- Fix: Either remove `set -e` and add explicit error checks where needed, or ensure the `node` call has a `|| true` fallback like `STALE_SLUGS=$(node ... 2>/dev/null || true)` (which it partially does via `2>/dev/null` but not for non-zero exit codes under `set -e`).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`FeatureKbModule` interface incomplete -- missing `referencedFiles` on `listKBs` return** - `src/cli/commands/kb.ts:22`
**Confidence**: 88%
- Problem: The `listKBs` return type omits `referencedFiles` from its declared shape, yet the refresh command (line 539) accesses it via unsafe cast. The actual `listKBs` implementation in `feature-kb.cjs` (line 374) does a spread (`{ slug, ...entry }`), which includes `referencedFiles` from the index entry. The TypeScript interface should reflect the actual shape.
- Impact: Type safety gap that forces unsafe casts elsewhere in the file.
- Fix: Add `referencedFiles: string[]` to the `listKBs` return type array element.

## Pre-existing Issues (Not Blocking)

(none found at CRITICAL severity)

## Suggestions (Lower Confidence)

- **Stale slug passing via positional shell arg may break on slugs with spaces** - `scripts/hooks/session-end-kb-refresh:54` (Confidence: 65%) -- `$STALE_SLUGS` is passed as a single `$3` positional arg containing newline-separated slugs, then iterated via `for SLUG in $STALE_SLUGS` (unquoted word splitting). This works because slugs are validated to be `[a-z0-9-]`, but the coupling between validation in `feature-kb.cjs` and consumption in the shell script is implicit.

- **Background hook sidecar files not in `.gitignore`** - `.features/$SLUG/.refresh-result.json`, `.features/$SLUG/.create-result.json` (Confidence: 70%) -- These transient sidecar files are written during agent operations and cleaned up, but a crash or timeout could leave them on disk. If `.features/` is committed (per CLAUDE.md: "committed to git"), stale sidecar files could be accidentally committed.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar pattern is a sound architectural improvement over the previous approach (which had the LLM agent call `node feature-kb.cjs update-index` via Bash -- a fragile coupling). Moving index updates to the caller (CLI or shell hook) and using a declarative JSON sidecar is cleaner separation of concerns. The main concerns are: (1) the inline `node -e` in the shell hook interpolates a file path unsafely, (2) the TypeScript interface does not reflect the actual data shape forcing unsafe casts, and (3) the sidecar lifecycle is duplicated three times without a shared abstraction.
