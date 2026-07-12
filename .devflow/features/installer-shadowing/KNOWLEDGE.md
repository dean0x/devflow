---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when modifying the install pipeline (installViaFileCopy, InstallReport), adding or changing skill/rule shadow override logic, touching uninstall scope or leftover-warning behavior, or extending the CLI skills/rules management commands. Keywords: installViaFileCopy, InstallReport, shadow, unshadow, validateSkillShadow, validateRuleShadow, prefixSkillName, unprefixSkillName, devflow:, skills, rules, uninstall, EISDIR."
category: architecture
directories: [src/cli/utils/installer.ts, src/cli/commands/init.ts, src/cli/commands/uninstall.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/cli/plugins.ts]
created: 2026-07-13
updated: 2026-07-13
---

# Installer & Skill/Rule Shadowing

## Overview

Devflow installs its assets (skills, rules, agents, commands, scripts) via a single path: `installViaFileCopy` in `src/cli/utils/installer.ts`. The native `claude plugin install` path was removed; file copy is the only install mechanism. `installViaFileCopy` returns an `InstallReport` that `init.ts` uses to surface shadow and skip events in the post-install summary.

The shadow override system lets users place personal versions of skills or rules at well-known paths under `~/.devflow/`. On every `devflow init` or `devflow rules --enable`, Devflow detects a valid shadow and installs the user's copy instead of the Devflow source — without failing init. This knowledge covers the entire install-to-uninstall lifecycle and the CLI surface for managing overrides.

## System Context

The installer is called from two entry points:
- **`devflow init`** — calls `installViaFileCopy` as part of the full install flow; consumes `InstallReport` for the post-install summary.
- **`devflow rules --enable`** — calls `installRuleFile` per rule; mirrors the init rules block without re-running skill install.

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

`init.ts` iterates `skippedShadows` and emits a warning per entry but never exits non-zero. Invalid shadows are transparent to the user until `devflow init` runs.

### Skill namespace (`prefixSkillName` / `unprefixSkillName`)

Skills install under `~/.claude/skills/devflow:{name}` (prefixed). The `devflow:` prefix is applied at install time; source directories in `shared/skills/` stay unprefixed. Shadow dirs also stay unprefixed at `~/.devflow/skills/{name}/`.

```typescript
// plugins.ts — applied in installer.ts at copy time
export const SKILL_NAMESPACE = 'devflow:';
export function prefixSkillName(name: string): string { ... }
export function unprefixSkillName(name: string): string { ... }
```

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

`installRuleFile` uses this result: `'valid'` → copy shadow; `'empty-shadow-file'` or `'not-a-file'` → install source and mark as `'source-invalid-shadow'`; outcome feeds `InstallReport` via a second `validateRuleShadow` call to capture the specific reason.

### Uninstall scope

`uninstall.ts` removes `~/.devflow/scripts/` (not the whole `~/.devflow/` tree — user shadows and config live there). This is computed as:

```typescript
devflowScriptsDir = path.join(paths.devflowDir, 'scripts');
// removeAllDevFlow receives devflowScriptsDir, NOT paths.devflowDir
```

The whole-tree removal of `~/.devflow/` (user shadows/config) was a pre-existing bug fixed on this branch; the `devflowDataDir` prompt applies only to the project's `.devflow/` directory (cwd-relative), not `~/.devflow/`.

Shadow leftover warnings are computed **before** removal:

```typescript
const shadowedSkillsBefore = !isSelectiveUninstall ? await listShadowed() : [];
const shadowedRulesBefore = !isSelectiveUninstall ? await listShadowedRules() : [];
// ... removal happens ...
// Warnings reference the before-lists so they remain accurate regardless of removal order
```

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
- `list` — shows all known skills with shadow state via `validateSkillShadow`.

Exports: `hasShadow(skillName, devflowDir?)`, `listShadowed(devflowDir?)` — used by uninstall.

### `devflow rules` CLI

Positional actions dispatch **before** flags. When `action` is present, flag options (`--enable`, `--disable`, `--status`, `--list`) are never evaluated. Unknown positional action exits 1.

- `shadow <name>` — seeds from the installed rule at `~/.claude/rules/devflow/{name}.md`; falls back to the built plugin source at `dist/../plugins/{ownerPlugin}/rules/{name}.md` (requires a built CLI — `pluginsDir` resolves relative to `dist/`). If neither exists, emits a warning and instructs the user to create the file manually.
- `unshadow <name>` — removes `~/.devflow/rules/{name}.md`.
- `list` — same as `--list`: shows all known rules with install and shadow state.

Exports: `hasRuleShadow(ruleName, devflowDir?)`, `listShadowedRules(devflowDir?)` — used by uninstall.

## Anti-Patterns

- **Installing all of `~/.devflow/` on uninstall** — only `~/.devflow/scripts/` is Devflow-owned; `~/.devflow/skills/`, `~/.devflow/rules/`, and config files are user-owned and must survive uninstall.
- **Staging shadow state after removal** — `listShadowed()` / `listShadowedRules()` must be called before the removal block; the files may be gone by the time warnings are emitted.
- **Running `devflow rules shadow` without a built CLI** — `pluginsDir` is `path.resolve(__dirname, '../..')}/plugins`, which resolves correctly only from `dist/`. Running from source without `npm run build` fails silently to seed the shadow from plugin source.
- **Skipping `prefixSkillName` at install time** — the install target must always be the prefixed path `devflow:{name}`; shadow dirs stay unprefixed. Mixing these causes duplicate installs or missed cleanup.

## Gotchas

- **`validateRuleShadow`'s `isFile()` guard is load-bearing.** Without the `stat.isFile()` check, a directory at `~/.devflow/rules/{name}.md` would pass the `size > 0` guard (directories report non-zero `st_size` on some FSes) and trigger `copyFile(shadowDir, targetFile)`, which throws `EISDIR` inside the `Promise.all` in `installViaFileCopy` — no per-call catch, so it aborts rule installation entirely and init fails. `fs.stat` follows symlinks: a symlink pointing to a regular file is a valid shadow; a symlink pointing to a directory returns `'not-a-file'`.

- **Rules use `Promise.all` without per-call error isolation.** The rule block in `installViaFileCopy` resolves all entries in parallel with no individual try/catch around each `installRuleFile` call. A throw inside any single call fails the whole batch. The EISDIR gotcha above is the primary trigger; add individual catches when adding new failure modes.

- **Skills are cleaned before install on every run.** `installViaFileCopy` removes both the legacy unprefixed and current prefixed skill directories for all known skills before reinstalling. This ensures no stale duplicate `{name}` directory coexists with `devflow:{name}`. Partial installs (via `--plugin`) still clean all skills universally.

- **Shadow seed from plugin source requires built dist.** `rules shadow` falls back to `dist/../plugins/...` when the installed rule is absent (e.g. rules are disabled). This path only works from a `dist/` build; running via `ts-node` from `src/` will miss the fallback.

- **`hasRuleShadow` uses `fs.access` (not `validateRuleShadow`).** The `hasRuleShadow` export in `rules.ts` just checks existence — it doesn't validate file content. The status display calls `validateRuleShadow` directly for the full state. Don't conflate the two.

## Key Files

- `src/cli/utils/installer.ts` — `installViaFileCopy`, `installRuleFile`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport`, `ShadowSkip`, `copyDirectory`, `chmodRecursive`
- `src/cli/commands/init.ts` — consumes `InstallReport`; calls `installViaFileCopy` with `skillsMap`, `agentsMap`, `rulesMap`
- `src/cli/commands/uninstall.ts` — `removeAllDevFlow` (scoped to scripts dir), shadow leftover warnings, `computeAssetsToRemove`
- `src/cli/commands/rules.ts` — `rulesCommand` positional dispatch, `hasRuleShadow`, `listShadowedRules`
- `src/cli/commands/skills.ts` — `skillsCommand` positional dispatch, `hasShadow`, `listShadowed`
- `src/cli/plugins.ts` — `prefixSkillName`, `unprefixSkillName`, `SKILL_NAMESPACE`, `DEVFLOW_PLUGINS`, `buildFullSkillsMap`, `buildRulesMap`, `LEGACY_SKILL_NAMES`, `LEGACY_AGENT_NAMES`

## Related

- ADR-003: Leave the end-state, not the transition — governs how removals and legacy cleanup are done here (no tombstone comments, no `*_old` names; `LEGACY_SKILL_NAMES` tracks accumulated deprecated names as a prunable list)
- Feature knowledge: `feature-knowledge-system` — the Knowledge agent writes to `.devflow/features/` which is tracked in git; related to the `.gitignore` carve-out maintained by the installer (`ensureDevflowGitignore` in `post-install.ts`)
