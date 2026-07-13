---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when modifying the install pipeline (installViaFileCopy, installAllRules, InstallReport), adding or changing skill/rule shadow override logic, touching uninstall scope or leftover-warning behavior, or extending the CLI skills/rules management commands. Keywords: installViaFileCopy, installAllRules, InstallReport, RuleInstallOutcome, SkillShadowState, RuleShadowState, shadow, unshadow, validateSkillShadow, validateRuleShadow, seedRuleShadow, prefixSkillName, unprefixSkillName, devflow:, skills, rules, uninstall, EISDIR, computeShadowLeftoverWarnings, ShadowWarning, marketplace-cleanup."
category: architecture
directories: [src/cli/utils/installer.ts, src/cli/commands/init.ts, src/cli/commands/uninstall.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/cli/plugins.ts, src/cli/utils/marketplace-cleanup.ts]
created: 2026-07-13
updated: 2026-07-13
---

# Installer & Skill/Rule Shadowing

## Overview

Devflow installs its assets (skills, rules, agents, commands, scripts) via a single path: `installViaFileCopy` in `src/cli/utils/installer.ts`. File copy is the sole install mechanism. `installViaFileCopy` returns an `InstallReport` that `init.ts` uses to surface shadow and skip events in the post-install summary.

The shadow override system lets users place personal versions of skills or rules at well-known paths under `~/.devflow/`. On every `devflow init` or `devflow rules --enable`, Devflow detects a valid shadow and installs the user's copy instead of the Devflow source — without failing init. This knowledge covers the entire install-to-uninstall lifecycle and the CLI surface for managing overrides.

## System Context

The installer is called from two entry points:
- **`devflow init`** — calls `installViaFileCopy` as part of the full install flow; consumes `InstallReport` for the post-install summary.
- **`devflow rules --enable`** — calls `installAllRules` directly; mirrors the init rules block without re-running skill install.

Shadow state is also read by `devflow skills list` and `devflow rules list` for the status display, and by `uninstall.ts` to emit leftover warnings.

## Component Architecture

### InstallReport

`installViaFileCopy` returns `InstallReport`:

```typescript
export interface InstallReport {
  shadowedSkills: string[];  // bare skill names that had a valid shadow applied
  shadowedRules: string[];   // bare rule names that had a valid shadow applied
  skippedShadows: ShadowSkip[];  // invalid shadows that were bypassed
}

export interface ShadowSkip {
  kind: 'skill' | 'rule';
  name: string;
  reason: ShadowSkipReason;  // 'missing-skill-md' | 'empty-shadow-file' | 'not-a-file'
}
```

`init.ts` iterates `skippedShadows` and emits a warning per entry via an exhaustive switch on `ShadowSkipReason` (with `never` guard). Invalid shadows never cause init to exit non-zero.

### RuleInstallOutcome

`installRuleFile` returns a discriminated `RuleInstallOutcome` per rule:

```typescript
export type RuleInstallOutcome =
  | 'shadow'                                  // valid shadow applied
  | 'source'                                  // Devflow source installed (no shadow)
  | 'source-invalid-shadow:empty-shadow-file' // source installed; shadow was empty
  | 'source-invalid-shadow:not-a-file'        // source installed; shadow path is a dir
  | 'skipped';                                // source file absent — no-op
```

The compound `source-invalid-shadow:*` variants carry the specific reason directly in the outcome, eliminating any need to re-stat the shadow file in the caller. `installViaFileCopy` decodes these to populate `InstallReport.skippedShadows`.

### SkillShadowState / RuleShadowState

Named exported types for the return values of the two validators:

```typescript
export type SkillShadowState = 'valid' | 'missing-skill-md' | 'none';
export type RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none';
```

Both are exported from `installer.ts` and imported by `skills.ts` and `rules.ts` for use in the exhaustive `buildSkillShadowTag` / `buildRuleShadowTag` display switches.

### installAllRules

The single compute site for rule installation. Both `installViaFileCopy` and `rules --enable` call it:

```typescript
export async function installAllRules(
  rulesMap: Map<string, string>,
  pluginsDir: string,
  devflowDir: string,
  rulesTarget: string,
): Promise<{ ruleName: string; outcome: RuleInstallOutcome }[]>
```

`installViaFileCopy` consumes the outcomes to populate `InstallReport`. `rules --enable` renders per-rule log lines. One place computes; callers present.

### Skill namespace (`prefixSkillName` / `unprefixSkillName`)

Skills install under `~/.claude/skills/devflow:{name}` (prefixed). The `devflow:` prefix is applied at install time; source directories in `shared/skills/` stay unprefixed. Shadow dirs also stay unprefixed at `~/.devflow/skills/{name}/`.

`skills.ts` CLI accepts both prefixed and bare input (`unprefixSkillName` normalizes before lookup).

### Universal skill install

All skills from ALL plugins install regardless of plugin selection. `skillsMap` passed to `installViaFileCopy` is built by `buildFullSkillsMap` which covers every `DEVFLOW_PLUGINS` entry — not just the selected subset. Rules, by contrast, are plugin-scoped (only selected plugins' rules install).

## Component Interactions

### Shadow validation flow (skills)

`validateSkillShadow(shadowDir)` in `installer.ts`:
- Returns `'none'` — shadow dir absent (no override)
- Returns `'valid'` — dir exists with a non-empty `SKILL.md` file
- Returns `'missing-skill-md'` — dir exists but `SKILL.md` absent, empty, or not a file

On `'valid'`: `copyDirectory(shadowDir, skillTarget)` replaces the install with the user's copy.
On `'missing-skill-md'`: adds to `skippedShadows`, installs Devflow source.
On `'none'`: installs Devflow source silently.

### Shadow validation flow (rules)

`validateRuleShadow(shadowFile)` in `installer.ts`:
- Returns `'none'` — file absent
- Returns `'valid'` — file exists, is a regular file, non-empty
- Returns `'empty-shadow-file'` — file is size 0
- Returns `'not-a-file'` — path exists but is not a file (e.g. a directory)

`installRuleFile` uses this result:
- `'valid'` → attempts `copyFile(shadowFile, targetFile)`; if the copy fails (e.g. `EACCES`, `EISDIR` on the target), falls through and installs Devflow source (returns `'source'`).
- `'empty-shadow-file'` or `'not-a-file'` → installs source, returns the matching `source-invalid-shadow:*` variant.
- `'none'` → installs source, returns `'source'`.

Both the shadow copy and the source copy paths are individually wrapped in try/catch inside `installRuleFile`, so `installAllRules`'s outer `Promise.all` cannot abort from a per-rule failure.

### Uninstall scope

`uninstall.ts` removes `~/.devflow/scripts/` (not the whole `~/.devflow/` tree — user shadows and config live there). This is computed as:

```typescript
devflowScriptsDir = path.join(paths.devflowDir, 'scripts');
// removeAllDevFlow receives devflowScriptsDir, NOT paths.devflowDir
```

Uninstall removes only `~/.devflow/scripts/` because the rest of `~/.devflow/` (shadows, config) is user-owned; the `devflowDataDir` prompt applies only to the project's cwd-relative `.devflow/`, never `~/.devflow/`.

### computeShadowLeftoverWarnings

`uninstall.ts` exports a pure seam returning `ShadowWarning[]`:

```typescript
export interface ShadowWarning { level: 'warn' | 'info'; message: string; }

export function computeShadowLeftoverWarnings(opts: {
  shadowedSkills: string[];
  shadowedRules: string[];
  isSelectiveUninstall: boolean;
  devflowDir: string;
}): ShadowWarning[]
```

Returns `[]` for selective uninstalls. For full uninstall, each non-empty shadow list produces a `warn` entry (leftover notice) followed by an `info` entry (cleanup hint). The caller emits these after `removeAllDevFlow` runs, using lists captured before removal.

## Integration Patterns

### Shadow paths (canonical)

| Asset | Shadow path | Install target |
|-------|-------------|----------------|
| Skill | `~/.devflow/skills/{name}/` (unprefixed) | `~/.claude/skills/devflow:{name}/` |
| Rule | `~/.devflow/rules/{name}.md` | `~/.claude/rules/devflow/{name}.md` |

### `devflow skills` CLI

Positional command only (no flags). Unknown action exits 1.

- `shadow <name>` — validates the skill is installed; copies `~/.claude/skills/devflow:{name}/` to `~/.devflow/skills/{name}/` as a starting point; accepts both bare and prefixed input.
- `unshadow <name>` — removes `~/.devflow/skills/{name}/`; restores Devflow source on next `devflow init`.
- `list` — pre-reads `shadowDirSet` from `~/.devflow/skills/`, then uses `shadowDirSet.has(skill)` as a short-circuit before calling `validateSkillShadow` (skips the stat for skills with no shadow directory). All rows are built via `Promise.all`. Shadow state renders via `buildSkillShadowTag` exhaustive switch. Orphan directories (in shadow root but not a known skill) are shown as "unknown skill".

Exports: `hasShadow(skillName, devflowDir?)`, `listShadowed(devflowDir?)` — used by uninstall.

### `devflow rules` CLI

Positional actions dispatch **before** flags. When `action` is present, flag options (`--enable`, `--disable`, `--status`, `--list`) are never evaluated. Unknown positional action exits 1.

- `shadow <name>` — validates the rule name against `allRules`; seeds via `seedRuleShadow` (3-tier); emits a manual-create hint when seeding fails. Implemented in `handleRuleShadow`.
- `unshadow <name>` — validates the rule name against `allRules` (exits 1 on unknown names, mirroring the shadow guard); removes `~/.devflow/rules/{name}.md`. Implemented in `handleRuleUnshadow`.
- `list` — delegates to `printRulesList`; same output as `--list`.

`printRulesList` collects shadow state for all known rules via `Promise.all`, renders a `(N known, M shadowed)` header, shows valid shadow state as a green unbracketed tag, and marks orphan shadows (in `~/.devflow/rules/` but not in `getAllRuleNames()`) as "unknown rule".

`seedRuleShadow` (named export — injected `pluginsDir` makes it testable):
- Tier 1: installed rule at `~/.claude/rules/devflow/{name}.md`
- Tier 2: built plugin source at `pluginsDir/{owner}/rules/{name}.md`
- Tier 3: returns `'none'` — caller emits manual-create instruction

`buildRuleShadowTag` / `buildSkillShadowTag` use exhaustive switches over their respective state types (with `never` guard), so a new state added to either union causes a compile error until display coverage is added.

Exports: `hasRuleShadow(ruleName, devflowDir?)`, `listShadowedRules(devflowDir?)`, `seedRuleShadow(...)` — used by uninstall and tests.

### Marketplace cleanup migration

`marketplace-cleanup.ts` exports `stripDevflowMarketplaceFromJson` (pure string→string) and `stripDevflowMarketplace` (async file I/O wrapper). The global migration `purge-stale-extra-known-marketplaces-v1` calls `stripDevflowMarketplace` to remove the `devflow` key from `extraKnownMarketplaces` in `settings.json`. Per ADR-003, if `extraKnownMarketplaces` becomes empty after removal, the entire key is deleted (clean end-state). Malformed JSON and missing keys are returned unchanged so a corrupt file never causes the migration to record a false success.

## Anti-Patterns

- **Installing all of `~/.devflow/` on uninstall** — only `~/.devflow/scripts/` is Devflow-owned; `~/.devflow/skills/`, `~/.devflow/rules/`, and config files are user-owned and must survive uninstall.
- **Staging shadow state after removal** — `listShadowed()` / `listShadowedRules()` must be called before the removal block; the files may be gone by the time warnings are emitted.
- **Running `devflow rules shadow` without a built CLI** — `seedRuleShadow` tier 2 resolves `pluginsDir` from `dist/`; running from source without `npm run build` silently misses the plugin-source fallback.
- **Skipping `prefixSkillName` at install time** — the install target must always be the prefixed path `devflow:{name}`; shadow dirs stay unprefixed. Mixing these causes duplicate installs or missed cleanup.
- **Adding failure modes to `installRuleFile` without per-path catches** — both the shadow copy and source copy paths must be individually caught. A bare throw inside `installRuleFile` escapes to the `installAllRules` `Promise.all` and aborts rule installation for the whole batch.

## Gotchas

- **`validateRuleShadow`'s `isFile()` guard is load-bearing.** Without the `stat.isFile()` check, a directory at `~/.devflow/rules/{name}.md` would pass the `size > 0` guard (directories report non-zero `st_size` on some FSes) and return `'valid'`, triggering `copyFile(shadowDir, targetFile)`. That `copyFile` throws `EISDIR`. The valid-shadow copy block catches this and falls through to install the Devflow source — so the user's shadow is silently bypassed (degraded path), not an abort. `fs.stat` follows symlinks: a symlink pointing to a regular file is a valid shadow; a symlink pointing to a directory returns `'not-a-file'`.

- **Skills are cleaned before install on every run.** `installViaFileCopy` removes both the legacy unprefixed and current prefixed skill directories for all known skills before reinstalling. This ensures no stale duplicate `{name}` directory coexists with `devflow:{name}`. Partial installs (via `--plugin`) still clean all skills universally.

- **Shadow seed from plugin source requires built dist.** `seedRuleShadow` tier 2 falls back to `dist/../plugins/...` when the installed rule is absent (e.g. rules are disabled). This path only works from a `dist/` build; running via `ts-node` from `src/` will miss the fallback.

- **`hasRuleShadow` uses `fs.access` (not `validateRuleShadow`).** The `hasRuleShadow` export in `rules.ts` just checks existence — it does not validate file content. The status display calls `validateRuleShadow` directly for the full state. Do not conflate the two.

## Key Files

- `src/cli/utils/installer.ts` — `installViaFileCopy`, `installAllRules`, `installRuleFile`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport`, `ShadowSkip`, `RuleInstallOutcome`, `SkillShadowState`, `RuleShadowState`, `copyDirectory`, `chmodRecursive`
- `src/cli/commands/init.ts` — consumes `InstallReport`; calls `installViaFileCopy` with `skillsMap`, `agentsMap`, `rulesMap`; exhaustive `ShadowSkipReason` switch with `never` guard in post-install summary
- `src/cli/commands/uninstall.ts` — `removeAllDevFlow` (scoped to scripts dir), `computeShadowLeftoverWarnings` (pure, returns `ShadowWarning[]`), `computeAssetsToRemove`
- `src/cli/commands/rules.ts` — `rulesCommand` positional dispatch, `seedRuleShadow`, `handleRuleShadow`, `handleRuleUnshadow`, `buildRuleShadowTag`, `printRulesList`, `hasRuleShadow`, `listShadowedRules`
- `src/cli/commands/skills.ts` — `skillsCommand` positional dispatch, `buildSkillShadowTag`, `hasShadow`, `listShadowed`
- `src/cli/plugins.ts` — `prefixSkillName`, `unprefixSkillName`, `SKILL_NAMESPACE`, `DEVFLOW_PLUGINS`, `buildFullSkillsMap`, `buildRulesMap`, `LEGACY_SKILL_NAMES`, `LEGACY_AGENT_NAMES`
- `src/cli/utils/marketplace-cleanup.ts` — `stripDevflowMarketplaceFromJson` (pure), `stripDevflowMarketplace` (async file wrapper); consumed by `purge-stale-extra-known-marketplaces-v1` migration

## Related

- ADR-010: Productionalize skill/rule shadowing — governs the decision to make `installViaFileCopy` the sole install path and to surface invalid shadows as warn-and-install-source (not hard-fail) (applies ADR-010)
- ADR-003: Leave the end-state, not the transition — governs removals and legacy cleanup (no tombstone comments, no `*_old` names; `LEGACY_SKILL_NAMES` tracks accumulated deprecated names; `extraKnownMarketplaces` key removal in `marketplace-cleanup.ts`) (applies ADR-003)
- Feature knowledge: `feature-knowledge-system` — the Knowledge agent writes to `.devflow/features/` which is tracked in git; related to the `.gitignore` carve-out maintained by the installer (`ensureDevflowGitignore` in `post-install.ts`)
