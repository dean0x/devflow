# Security & Architecture Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05
**Focus**: Security and Architecture (combined review)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-002: Init command action handler monolith** - `src/cli/commands/init.ts:118-890`
**Confidence**: 95%
- Problem: Already documented in pitfalls.md (PF-002). The init handler is ~877 lines. This branch adds 12 more lines of SHADOW_RENAMES and LEGACY_SKILL_NAMES entries, further growing the monolith. Not introduced by this branch, but each rename wave compounds the maintenance burden.
- Fix: Pre-existing; tracked in pitfalls.md. Extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()` in a separate PR.

## Suggestions (Lower Confidence)

- **Colon in directory names on Windows** - `src/cli/plugins.ts:101-107` (Confidence: 65%) -- Directories like `devflow:implement:orch` use `:` which is an illegal character on Windows (NTFS). The project already had single-colon directories (`devflow:router`), and `installer.ts:261` has an explicit `process.platform !== 'win32'` guard for chmod, suggesting Windows is not a supported platform. However, the double-colon pattern doubles down on this limitation. If Windows support is ever considered, all colon-containing paths would need encoding or an alternate separator.

- **SHADOW_RENAMES growing linearly with each rename wave** - `src/cli/plugins.ts:392-426` (Confidence: 70%) -- SHADOW_RENAMES now has 26 entries including many-to-one mappings. Each rename wave adds entries for both the old->new AND the intermediate->new transitions (e.g., `implementation-orchestration -> implement:orch` AND `implement -> implement:orch`). The `migrateShadowOverrides()` function handles this correctly with grouped serialization, but the list will continue to grow with each rename. Consider a version-based migration system that applies renames sequentially rather than maintaining a flat list.

- **LEGACY_SKILL_NAMES growing without bounds** - `src/cli/plugins.ts:227-384` (Confidence: 70%) -- LEGACY_SKILL_NAMES now has 158 entries across 5 migration waves. Every rename adds entries for bare, `devflow-` prefixed, and `devflow:` prefixed variants. The cleanup logic in `init.ts:863-871` iterates all 158 entries with `fs.rm()` on every install. Performance impact is negligible (async I/O, most entries don't exist), but the list is a maintenance burden. Consider pruning entries older than N major versions.

## Detailed Analysis

### 1. Colon in Directory Names — prefixSkillName / unprefixSkillName

**Verified safe.** The `prefixSkillName` function (`src/cli/plugins.ts:16-18`) uses `startsWith('devflow:')` to check for existing prefix. When called with `implement:orch`:
- `'implement:orch'.startsWith('devflow:')` is `false`, so it prepends `devflow:` -> `devflow:implement:orch`
- When called with `devflow:implement:orch`, it's already prefixed, returns unchanged.

`unprefixSkillName` (`src/cli/plugins.ts:24-26`) strips exactly `SKILL_NAMESPACE.length` (8 chars = `devflow:`) from the start:
- `'devflow:implement:orch'.slice(8)` -> `implement:orch` (correct)

There is no logic anywhere that splits on `:` to separate namespace from skill name. The prefix/unprefix functions use `startsWith` and `slice`, not `split`. **No bug here.**

### 2. Shadow Migration Safety

**Verified safe.** `migrateShadowOverrides()` in `src/cli/commands/init.ts:71-116` uses `path.join(shadowsRoot, newName)` where `newName` is e.g. `implement:orch`. On macOS/Linux, `:` is a valid filename character. The function correctly:
- Groups entries by target name for serialized execution (avoids TOCTOU races)
- Checks for existing target before rename (warns instead of overwriting)
- Uses `fs.rename()` which handles colon characters correctly on Unix filesystems

New SHADOW_RENAMES entries cover all three migration paths:
1. `implementation-orchestration -> implement:orch` (from pre-v2.0.0)
2. `implement -> implement:orch` (from previous rename wave)
3. `self-review -> quality-gates` (name change)

**No bug here.**

### 3. Uninstall Safety

**Verified safe.** The uninstall code in `src/cli/commands/uninstall.ts:537-552` iterates `allSkillNames` (which includes `implement:orch` etc.) and calls:
- `prefixSkillName(skillName)` -> `devflow:implement:orch` -> `path.join(skillsDir, 'devflow:implement:orch')` -- correctly targets the installed directory
- `path.join(skillsDir, skillName)` -> `path.join(skillsDir, 'implement:orch')` -- correctly targets bare variant

The `removeSelectedPlugins` function (`uninstall.ts:604-619`) also handles the triple variant cleanup (`prefixed`, `bare`, `devflow-` prefixed). **No bug here.**

### 4. Build System

**Verified safe.** `scripts/build-plugins.ts:52-62` reads `shared/skills/` directory entries via `readdirSync`. The `getAvailableSkills()` function returns a `Set<string>` of directory names (e.g., `implement:orch`). The build then does `path.join(SHARED_SKILLS, skill)` which correctly resolves to `shared/skills/implement:orch`. Verified by running `npm run build:plugins` -- all 39 skills, 71 skill copies, zero errors. The `plugin.json` manifests list skills as `implement:orch` which matches the directory names. **No bug here.**

### 5. LEGACY_SKILL_NAMES Completeness

**Verified complete.** Programmatically tested: every entry from `getAllSkillNames()` appears in `LEGACY_SKILL_NAMES`. The new entries added in this branch cover:
- `devflow:implement`, `devflow:debug`, `devflow:explore`, `devflow:plan`, `devflow:review`, `devflow:resolve`, `devflow:pipeline` (prefixed short names from previous wave)
- `devflow:self-review` (prefixed old name)
- `implement:orch`, `debug:orch`, `explore:orch`, `plan:orch`, `review:orch`, `resolve:orch`, `pipeline:orch` (bare `:orch` names for pre-namespace installs)
- `quality-gates` (bare name for pre-namespace installs)

All 26 test assertions in `tests/plugins.test.ts` pass, including SHADOW_RENAMES consistency checks. All 29 assertions in `tests/skill-references.test.ts` pass. **No missing entries.**

### 6. Path Traversal / Protocol Scheme Injection

**No risk.** The `implement:orch` pattern cannot be interpreted as a protocol scheme because:
- Node.js `path.join()` treats `:` as a literal character on Unix. It would only be a drive letter prefix on Windows (e.g., `C:\`) and only at the start of a path.
- `fs.mkdir`, `fs.rm`, `fs.rename` all use the joined path as a literal filesystem path.
- There is no `new URL()` or `fetch()` call using these skill names as URLs.
- The installer never passes skill names to shell commands (no command injection vector).
- The shadow directory check (`installer.ts:234`) uses `path.join(devflowDir, 'skills', skillName)` which resolves to `~/.devflow/skills/implement:orch/` -- no traversal possible since `implement:orch` contains no `/` or `..` segments.

**No security risk.**

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Security Score**: 9/10
**Architecture Score**: 8/10
**Recommendation**: APPROVED

## Rationale

This branch executes a well-structured rename from short orchestration skill names (`implement`, `debug`, etc.) to `:orch`-suffixed names (`implement:orch`, `debug:orch`, etc.) plus a `self-review` -> `quality-gates` rename. The implementation is thorough:

1. **All code paths handle double-colon correctly** -- prefix/unprefix use `startsWith`/`slice`, not `split(':')`
2. **Migration chains are complete** -- SHADOW_RENAMES covers both `implementation-orchestration -> implement:orch` AND `implement -> implement:orch`, ensuring users on any prior version get migrated
3. **LEGACY_SKILL_NAMES covers all variants** -- bare, `devflow-` prefixed, and `devflow:` prefixed forms for cleanup
4. **Build system works** -- 39 skills, 71 copies, zero errors
5. **Full test suite green** -- 590 tests pass across 23 files, including comprehensive skill reference integrity tests
6. **No security concerns** -- colon in filenames is safe on macOS/Linux, no injection vectors

The only concern is the growing size of migration lists (LEGACY_SKILL_NAMES at 158 entries, SHADOW_RENAMES at 26 entries), which is a pre-existing architectural pattern that works correctly but scales linearly with rename waves. This is noted as a suggestion, not a blocking issue.
