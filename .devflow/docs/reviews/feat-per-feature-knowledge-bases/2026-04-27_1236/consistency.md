# Consistency Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### HIGH

**`listKBs` return type missing `referencedFiles` field in FeatureKbModule interface** - `src/cli/commands/kb.ts:22`
**Confidence**: 90%
- Problem: The `FeatureKbModule.listKBs` interface declares the return type as `Array<{ slug: string; name: string; category: string; directories: string[]; lastUpdated: string }>`, but the actual `listKBs` in `feature-kb.cjs` does `{ slug, ...entry }` which includes `referencedFiles`. The refresh code at line 539 accesses `referencedFiles` through a `Record<string, unknown>` cast: `(kbEntry as Record<string, unknown>)?.referencedFiles as string[]`. This cast bypasses type safety and is inconsistent with the project's strict typing approach (CLAUDE.md: "Type everything -- No any types, explicit returns").
- Impact: If `referencedFiles` is removed or renamed in the underlying CJS module, this code will silently produce `undefined`, which gets cast to `string[]` without error. The `updateIndex` interface already declares `referencedFiles: string[]` as required, so the type system cannot help here.
- Fix: Add `referencedFiles` to the `listKBs` return type:
  ```typescript
  listKBs: (worktreePath: string) => Array<{ slug: string; name: string; category: string; directories: string[]; referencedFiles: string[]; lastUpdated: string }>;
  ```
  Then replace line 539 with:
  ```typescript
  referencedFiles: sidecar.referencedFiles ?? kbEntry?.referencedFiles ?? [],
  ```

### MEDIUM

**Knowledge agent `tools` frontmatter includes Bash but `--allowedTools` excludes it** - `src/cli/commands/kb.ts:37`, `scripts/hooks/background-kb-refresh:141`
**Confidence**: 82%
- Problem: The Knowledge agent definition (`shared/agents/knowledge.md` line 14) lists `Bash` in its `tools` frontmatter. However, the `KB_AGENT_TOOLS` constant was changed from `'Read,Grep,Glob,Write,Bash'` to `'Read,Grep,Glob,Write'`, and the background-kb-refresh hook also uses `'Read,Grep,Glob,Write'`. The agent spec and the `claude -p` invocations are now inconsistent about whether the Knowledge agent can use Bash. The sidecar pattern was introduced specifically to remove the need for Bash (previously the agent ran `node feature-kb.cjs update-index` via Bash), so the removal is intentional in practice, but the agent spec was not updated to match.
- Impact: When the Knowledge agent is spawned via Agent Teams (the formal agent framework), it gets Bash from the frontmatter. When spawned via `claude -p`, it does not. This behavioral inconsistency could cause confusion or bugs if the agent's prompt references Bash-dependent patterns.
- Fix: Either remove `Bash` from `shared/agents/knowledge.md` tools list (if the sidecar pattern fully replaces it) or document why the discrepancy is intentional. Since the sidecar approach was designed to eliminate Bash usage, removing it from the agent spec is the consistent choice.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Sidecar files not covered by `.gitignore`** - `src/cli/commands/kb.ts:381`, `src/cli/commands/kb.ts:497`, `scripts/hooks/background-kb-refresh:108`
**Confidence**: 85%
- Problem: The new sidecar pattern creates `.create-result.json` and `.refresh-result.json` files inside `.features/{slug}/`. These files are cleaned up after use, but `.features/` is a committed directory (not in `.gitignore`). If a crash, timeout, or interruption occurs between the agent writing the sidecar and the cleanup `fs.unlink`, these transient files could be committed to git. The `background-kb-refresh` hook has a 180s watchdog that kills the process, and cleanup happens after `wait`, so a kill during the sidecar-read phase could leave orphan files. Other transient patterns in the project (`.memory/.pending-turns.processing`, `.features/.kb-refresh.lock`, `.features/.kb.lock`) are either in gitignored directories (`.memory/`) or are lock directories that are cleaned by traps.
- Impact: Orphan `.create-result.json` or `.refresh-result.json` files in a committed directory could be accidentally committed, adding noise to the repository.
- Fix: Add a `.features/.gitignore` or entries in the root `.gitignore`:
  ```
  .features/*/.create-result.json
  .features/*/.refresh-result.json
  ```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Sidecar file naming convention not documented** - `src/cli/commands/kb.ts:381,497` (Confidence: 65%) -- The sidecar pattern (`.create-result.json` / `.refresh-result.json`) is a new convention for agent-to-caller communication. It is applied consistently across create, refresh (CLI), and refresh (background), but the pattern itself is not documented in the file-organization reference or CLAUDE.md. Given this is a reusable pattern, a brief note in `docs/reference/file-organization.md` would help future contributors.

- **`set -e` removal inconsistency with session-end hooks** - `scripts/hooks/background-kb-refresh:8`, `scripts/hooks/background-learning:9`, `scripts/hooks/background-memory-update:9` (Confidence: 70%) -- All three `background-*` hooks had `set -e` removed in this PR. The session-end and session-start hooks still use `set -e`. This is likely intentional (background hooks have explicit error handling with `|| true` patterns and should not exit on any failure), but the commit message does not call out this design decision. The asymmetry is defensible but should be documented in a code comment for the pattern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar pattern is applied consistently across all three callsites (create, refresh CLI, background refresh), which is good. The `set -e` removal is consistent across all background hooks. Test refactoring (try/catch to `.toThrow()`, deduplication) follows project conventions. The main consistency gaps are the `listKBs` TypeScript interface not matching runtime shape (forcing an unsafe cast) and the Knowledge agent tools mismatch between frontmatter and `claude -p` invocations. avoids PF-001 -- no Promise resolver renaming issues observed in this diff.
