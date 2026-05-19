# Regression Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13_0010
**PR**: #181
**DIFF_COMMAND**: `git diff main...HEAD`
**Scope**: 58 files changed (+7578 / -369 lines)

## Issues in Your Changes (BLOCKING)

### CRITICAL

**Install ordering regression: shadow-override migration now runs AFTER install, leaving V1→V2 upgraders with stock skills on first init** — `src/cli/commands/init.ts:762-789` (install) vs `:888-912` (migration)
**Confidence**: 92%
- **Problem**: In main, `migrateShadowOverrides(devflowDir)` ran at `init.ts:822` **BEFORE** `installViaFileCopy` (line ~830), specifically so the installer's shadow check at `installer.ts:232-245` could find user overrides at the V2 names. The new code inverts this order:
  1. Line 772: `installViaFileCopy` runs — looks for shadow at `~/.devflow/skills/software-design/` → not found (user still has V1 shadow at `~/.devflow/skills/core-patterns/`) → installs stock skill to `~/.claude/skills/devflow:software-design/`
  2. Line 893: `runMigrations` runs — renames `~/.devflow/skills/core-patterns/` → `~/.devflow/skills/software-design/` and writes `shadow-overrides-v2-names` to `migrations.json`
  3. Migration is now marked applied; shadow is at correct path; but stock content is already in `~/.claude/skills/` and the migration will not re-run on next init
- **Impact**: V1→V2 upgraders who customized any of the 25+ shadow-renamed skills (`core-patterns`, `security-patterns`, `test-patterns`, etc.) will silently lose their customizations on first V2 install. The user is not warned. Subsequent init re-reads the shadow at the correct name, so running `devflow init` a second time **would** fix it — but the user has no signal to do so.
- **Fix**: Either (a) move the `runMigrations` call back before `installViaFileCopy` at line 762, restoring the original ordering; or (b) teach `runMigrations` to detect whether the global shadow-overrides migration was newly-applied in this run and trigger a re-install of affected skills; or (c) run only the `shadow-overrides-v2-names` migration pre-install and everything else post-install. Option (a) is simplest:
  ```typescript
  // Move migration block above installViaFileCopy
  {
    const { runMigrations } = await import('../utils/migrations.js');
    const userDevflowDir = path.join(os.homedir(), '.devflow');
    const projectsForMigration =
      discoveredProjects.length > 0 ? discoveredProjects : (gitRoot ? [gitRoot] : []);
    const migrationResult = await runMigrations(
      { devflowDir: userDevflowDir, claudeDir },
      projectsForMigration,
    );
    // ... warnings/logging
  }

  // THEN install
  await installViaFileCopy({ ... });
  ```
  Note: per-project migrations depend on `discoveredProjects` which is computed earlier, so no wiring changes are required.

**Teams-variant commands still invoke `knowledge-persistence` SKILL for writing, but SKILL is now a read-only format spec** — 4 files
**Confidence**: 95%
- `plugins/devflow-resolve/commands/resolve-teams.md:184-190` (Phase 6: Record Pitfalls)
- `plugins/devflow-code-review/commands/code-review-teams.md:262-268` (Phase 6: Record Pitfalls)
- `plugins/devflow-debug/commands/debug-teams.md:197-200` (Record Pitfalls inline)
- `plugins/devflow-implement/commands/implement-teams.md:364-370` (Phase 10: Record Decisions)
- **Problem**: The D8 refactor removed "Record Pitfalls"/"Record Decisions" phases from the 4 non-teams command variants (`code-review.md`, `debug.md`, `implement.md`, `resolve.md`) and added explanatory JSDoc comments. The matching `-teams.md` variants were **not updated** — only 4 files changed per `git diff main...HEAD --stat -- plugins/*/commands/`. The teams commands still say:
  > "Read `~/.claude/skills/devflow:knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls to `.memory/knowledge/pitfalls.md`"
  But the skill itself (shared/skills/knowledge-persistence/SKILL.md) was rewritten in this PR:
  - Description changed to "Format specification for on-disk knowledge files ... Writing is performed exclusively by the background extractor"
  - `allowed-tools` changed from `Read, Write, Bash` → `Read, Grep, Glob` (removed Write!)
  - Iron Law changed from "SINGLE SOURCE OF TRUTH" (extraction procedure) → "SINGLE SOURCE OF FORMAT TRUTH" (format spec only)
  - The skill explicitly states "This skill is a format spec. Rendering is performed by the background extractor ... Commands do not invoke this skill to write."
- **Impact**: Users who installed with `--teams` (Agent Teams variant) will see agents loading a skill that contradicts the command instructions. The skill has no Write capability, so the agent cannot actually record pitfalls/decisions even if it tries. Teams users lose knowledge capture entirely — a silent behavior regression versus main.
- **Fix**: Apply the same D8 refactor to the 4 teams-variant files. Remove the "Record Pitfalls"/"Record Decisions" phases, renumber subsequent phases, add the D8 explanatory JSDoc block at the top. The mechanical diff is already visible in the non-teams variants — apply the same pattern.

### HIGH

**Stale "Phase 9" reference in resolve.md after phase renumbering** — `plugins/devflow-resolve/commands/resolve.md:259`
**Confidence**: 98%
- Problem: After removing Phase 6 (Record Pitfalls) and renumbering, the final phase is now Phase 8. But the "Output Artifact" section at line 259 still reads: `Written by orchestrator in Phase 9 to {TARGET_DIR}/resolution-summary.md:`. The phase numbers in the file go from Phase 0 through Phase 8 (line 164: `### Phase 8: Report`). Phase 9 no longer exists.
- Impact: Orchestrator (Claude) reading this command will be confused about which phase writes the resolution summary. In practice the artifact still gets written because Phase 8 is labeled "Report" and contains the Write tool invocation. This is documentation drift but has low runtime impact — the actual work is done in Phase 8.
- Fix:
  ```markdown
  Written by orchestrator in Phase 8 to `{TARGET_DIR}/resolution-summary.md`:
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Plugin.json dependency inconsistency: `knowledge-persistence` removed from 3 of 6 plugins that reference it** — `src/cli/plugins.ts:63-74`
**Confidence**: 82%
- Problem: The PR removes `knowledge-persistence` from:
  - `devflow-implement.skills` (line 63-64)
  - `devflow-code-review.skills` (line 68-71)
  - `devflow-resolve.skills` (line 73-76)
  But it keeps it in:
  - `devflow-plan.skills` — because `/plan` doesn't explicitly load it but the shared skimmer agent does
  - `devflow-debug.skills` — because `/debug` Phase 1 reads knowledge for context
  - `devflow-ambient.skills` — because ambient router may load it
  The built output directories (`plugins/devflow-code-review/skills/`, etc.) correctly reflect the manifest and no longer contain `knowledge-persistence/`. However, since `buildFullSkillsMap()` at `plugins.ts:496` aggregates skills across **all** plugins, the skill still gets installed universally to `~/.claude/skills/devflow:knowledge-persistence/` — so teams commands and other consumers that reference the skill path still work. This isn't a functional regression but creates a subtle inconsistency: removing `knowledge-persistence` from a plugin that actually depends on it (even transitively, via skimmer agent references) breaks the "manifest as dependency declaration" invariant.
- Impact: Future maintenance risk. If someone later uses plugin.json as the source of truth for plugin dependencies (e.g., to generate docs or enforce isolation), the implement/code-review/resolve plugins will appear not to depend on `knowledge-persistence` when in fact they do (their teams variants invoke it, their agents read it).
- Fix: Either leave `knowledge-persistence` in all 6 plugin.json files (since all 6 still reference the skill via agent frontmatter or command instructions), or update the teams-variants and skimmer agent to drop all knowledge-persistence references first, then remove from manifests consistently.

## Pre-existing Issues (Not Blocking)

None identified within the regression focus area.

## Suggestions (Lower Confidence)

- **Migration registry does not re-run for projects discovered AFTER first init** — `src/cli/utils/migrations.ts:186-221` (Confidence: 70%) — D37 documents this as known edge case. The recovery path (`rm ~/.devflow/migrations.json`) is documented only in CLAUDE.md line 51, not in any `devflow init` help text or `devflow learn --status` output. Users hitting this won't discover the recovery path without reading contributor docs.

- **`notifications` field is optional in GatherContext but always passed** — `src/cli/hud/index.ts:104` + `src/cli/hud/types.ts:139` (Confidence: 65%) — `GatherContext.notifications` is typed as `notifications?: NotificationData | null` (optional), but index.ts always sets it. Either make it required for consistency with `learningCounts: LearningCountsData | null` (non-optional in types.ts:138), or drop the emptyassignment. Test at `tests/hud-render.test.ts:41` relies on the optional typing (doesn't set the field) — that's the only consumer that needs the `?` marker.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 2 | 1 | - | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | - | - |

**Regression Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

**Rationale**: Two CRITICAL regressions are blocking:
1. **Install ordering** silently breaks V1→V2 shadow-override upgraders on first init — this is the exact population the migration was built for. The migration registry pattern is sound; the call site just needs to move back above `installViaFileCopy`.
2. **Teams-variant commands** remain uncoupled from the D8 refactor — users on `--teams` installations lose knowledge capture entirely while non-teams users get the intended v2 behavior. This is a clear feature-parity regression.

Both are mechanically simple to fix (one call-site move + propagating a 6-line JSDoc + removing 2 phase blocks across 4 files). Neither requires architectural rework. The remaining findings (Phase 9 doc drift, plugin.json inconsistency, D37 UX) can be handled in follow-up PRs.

**Areas verified clean**:
- `--purge-legacy-knowledge` flag removal is complete — no stale references in CLAUDE.md, README.md, docs/, shared/, scripts/, plugins/, or .github/workflows. Only internal JSDoc/test refs remain (expected).
- `migrateShadowOverrides` extraction preserves test compat via `export { migrateShadowOverridesRegistry as migrateShadowOverrides }` at `init.ts:42`. Tests at `tests/init-logic.test.ts:637` continue to import under the old name.
- HUD module layout: `hud/learning-counts.ts` + `hud/notifications.ts` (data gatherers) and `hud/components/learning-counts.ts` + `hud/components/notifications.ts` (renderers) are two distinct file pairs, not a rename. All imports wire correctly: `index.ts:10-11` loads gatherers, `render.ts:23-24` loads renderers. No stale imports.
- `migrations.json` contract is well-scoped: `{ applied: string[] }`, atomic write via tmp+rename, graceful fallback on malformed/missing file. No breaking-change risk for future migrations as long as new fields are added with `?` defaults.
- `json-helper.cjs` preserved all pre-existing CLI subcommands (`get-field`, `validate`, `construct`, `update-field`, etc.) while adding new ones. No removed command dispatch.
- CI (`ci.yml`) and release workflows unchanged.
- Build output (`plugins/*/skills/`) matches manifest declarations.
