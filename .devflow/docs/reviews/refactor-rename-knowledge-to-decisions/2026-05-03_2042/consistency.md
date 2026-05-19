# Consistency Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03
**Commits**: 2 (5cdd786 refactor: rename decisions system from "knowledge" to "decisions" (#199), 3297089 feat: add feature knowledge bases index and knowledge agent)

## Issues in Your Changes (BLOCKING)

### HIGH

**Notification key `knowledge-capacity-*` not renamed to `decisions-capacity-*` (3 occurrences)** -- Confidence: 82%
- `scripts/hooks/json-helper.cjs:1290`, `scripts/hooks/json-helper.cjs:1782`, `src/cli/commands/learn.ts:1184-1185`
- Problem: The notification keys `knowledge-capacity-decisions` and `knowledge-capacity-pitfalls` are used as storage keys in `.notifications.json` and as identifiers across `json-helper.cjs`, `learn.ts`, and `notifications.ts`. These keys were not renamed to `decisions-capacity-*`, leaving "knowledge" embedded in a data contract created by this branch's own code. The `notifications.ts` parser at line 58 (`worst.key.replace('knowledge-capacity-', '')`) also encodes the old prefix. While internally consistent (writers and readers agree), this contradicts the stated goal of renaming "knowledge" to "decisions". No migration was added to rename existing notification keys in `.notifications.json`.
- Fix: Either (a) rename the keys to `decisions-capacity-decisions` / `decisions-capacity-pitfalls` and add a migration for existing `.notifications.json` files, or (b) add a comment documenting why the key was intentionally kept as a stable storage identifier.

### MEDIUM

**Comment says "log/knowledge" in learn.ts:936 -- missed in rename sweep** -- Confidence: 85%
- `src/cli/commands/learn.ts:936`
- Problem: The comment `// partial progress (and log/knowledge stay consistent).` uses the old "knowledge" naming. This line is in the same function where many other "knowledge" references were renamed to "decisions" (e.g., `updateDecisionsStatus`, `softCapExceeded` comment at line 454). While the surrounding lines were not modified in the diff, this comment sits in code that was actively edited nearby and was clearly in scope for the rename.
- Fix: Change to `// partial progress (and log/decisions stay consistent).`

**Exported function/type names in `legacy-knowledge-purge.ts` retain "knowledge" inconsistently** -- Confidence: 80%
- `src/cli/utils/legacy-knowledge-purge.ts:37,43,111,181,249`
- Problem: The file's internal variable names were renamed (`knowledgeDir` -> `decisionsDir`, `knowledgeLockDir` -> `decisionsLockDir`) but the exported API surface kept old names: `PurgeLegacyKnowledgeResult`, `KnowledgeFilePair`, `withKnowledgeFiles`, `purgeLegacyKnowledgeEntries`, `purgeAllPreV2KnowledgeEntries`. The callers in `migrations.ts` also import and use these old names. This creates a split personality: internal code says "decisions", external API says "knowledge". One could argue these functions describe legacy purge operations on "knowledge" entries, but the same argument does not hold for `KnowledgeFilePair` and `withKnowledgeFiles` which are generic helpers not specific to legacy content.
- Fix: Rename to `DecisionsFilePair`, `withDecisionsFiles`, `PurgeLegacyDecisionsResult`. Keep `purgeLegacyKnowledgeEntries` / `purgeAllPreV2KnowledgeEntries` if desired (since they describe purging legacy "knowledge"-era entries), but update the generic types and internal helper.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`## Knowledge Citations` section name retained across resolve commands and CLAUDE.md** -- Confidence: 65%
- `plugins/devflow-resolve/commands/resolve.md:182,325`, `plugins/devflow-resolve/commands/resolve-teams.md:231,378`, `shared/skills/resolve:orch/SKILL.md:111`, `CLAUDE.md:152`
- This is listed as a Suggestion below (see Suggestions section) due to confidence being under 80%. The section heading is a user-facing output artifact name that may be intentionally stable.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues found._

## Suggestions (Lower Confidence)

- **`## Knowledge Citations` output section heading** - `plugins/devflow-resolve/commands/resolve.md:325` (Confidence: 65%) -- This output section name was consistently retained everywhere (resolve commands, resolve:orch skill, CLAUDE.md), suggesting a deliberate choice to keep it as a stable output artifact name. However, it uses "Knowledge" where the system now calls them "Decisions". Consider renaming to `## Decisions Citations` for full consistency, or add a comment explaining the stable artifact name.

- **File not renamed: `legacy-knowledge-purge.ts`** - `src/cli/utils/legacy-knowledge-purge.ts` (Confidence: 60%) -- The filename itself was not renamed. Given that the internal variables were updated and the file now operates on `.memory/decisions/`, the filename is slightly misleading. However, since imports reference this file by name (`./legacy-knowledge-purge.js`), renaming would require updating all importers.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The rename from "knowledge" to "decisions" is thorough across the vast majority of the 84 changed files. The core system works correctly: all file paths, variable names, skill names, agent references, CLI commands, and hook scripts are updated consistently. The migration for renaming `.memory/knowledge/` to `.memory/decisions/` is well-structured with proper handling of manifest paths, learning log paths, and lock files.

The main consistency gap is the `knowledge-capacity-*` notification key that lives in a data contract (`.notifications.json`) and spans 3 files -- this should either be renamed with a migration or explicitly documented as a stable key. The other issues are minor comment/naming oversights that don't affect functionality.

The second commit (3297089) adding the feature knowledge bases index and explore-plugin knowledge agent is clean and correctly uses the new `DECISIONS_CONTEXT` naming throughout.
