---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when modifying the install pipeline (installViaFileCopy, installAllRules, composeScripts, InstallReport), adding or changing skill/rule shadow override logic, touching uninstall scope or leftover-warning behavior, extending the CLI skills/rules management commands, or working with asset directory accessors (rulesDir, skillsDir, commandsDir) and package-root resolution. Keywords: installViaFileCopy, installAllRules, composeScripts, InstallReport, RuleInstallOutcome, SkillShadowState, RuleShadowState, shadow, unshadow, validateSkillShadow, validateRuleShadow, seedRuleShadow, prefixSkillName, unprefixSkillName, devflow:, skills, rules, uninstall, EISDIR, computeShadowLeftoverWarnings, ShadowWarning, getPackageRoot, rulesDir, skillsDir, agentsDir, commandsDir, scriptsDir, LEGACY_SKILL_NAMES, LEGACY_AGENT_NAMES."
category: architecture
directories: [src/targets/claude-code/installer.ts, src/targets/claude-code/legacy.ts, src/cli/commands/init.ts, src/cli/commands/uninstall.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/core/plugins.ts, src/core/assets.ts, src/core/paths.ts]
created: 2026-07-13
updated: 2026-07-19
---

# Installer & Skill/Rule Shadowing

## Overview

Devflow installs its assets (skills, rules, agents, commands, scripts) via a single path: `installViaFileCopy` in `src/targets/claude-code/installer.ts`. File copy is the sole install mechanism. All asset source paths are resolved via named accessors in `src/core/assets.ts`, which are backed by `getPackageRoot()` in `src/core/paths.ts`. `installViaFileCopy` returns an `InstallReport` that `init.ts` uses to surface shadow and skip events in the post-install summary.

The shadow override system lets users place personal versions of skills or rules at well-known paths under `~/.devflow/`. On every `devflow init` or `devflow rules --enable`, Devflow detects a valid shadow and installs the user's copy instead of the Devflow source — without failing init. This knowledge covers the entire install-to-uninstall lifecycle and the CLI surface for managing overrides.

## System Context

The installer is called from two entry points:
- **`devflow init`** — calls `installViaFileCopy` as part of the full install flow; consumes `InstallReport` for the post-install summary.
- **`devflow rules --enable`** — calls `installAllRules` directly; mirrors the init rules block without re-running skill install.

Shadow state is also read by `devflow skills list` and `devflow rules list` for the status display, and by `uninstall.ts` to emit leftover warnings.

## Component Architecture

### Asset Directory Accessors (`src/core/assets.ts`)

Every path to a source asset is obtained through a named accessor — no scattered `path.resolve(__dirname, '../..')` lookups anywhere in the installer:

| Accessor | Resolves to |
|----------|-------------|
| `skillsDir()` | `{root}/src/assets/skills/` — flat; one subdir per skill |
| `agentsDir()` | `{root}/src/assets/agents/` — flat; one `.md` per agent |
| `rulesDir()` | `{root}/src/assets/rules/` — flat; one `.md` per rule |
| `scriptsDir()` | `{root}/src/assets/scripts/` — hooks/ and hud.sh |
| `commandsDir()` | `{root}/dist/commands/` — compiled MDS + verbatim .md files |

All five call `getPackageRoot()` internally.

### Package Root Resolution (`src/core/paths.ts`)

`getPackageRoot()` resolves the package root from `import.meta.url` depth — 2 levels up from compiled `dist/core/paths.js`. It **throws loudly** if `package.json` is absent at the resolved root. Depth-mismatch bugs surface immediately at install time rather than silently producing wrong paths.

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

`init.ts` iterates `skippedShadows` and emits a warning per entry via an exhaustive switch on `ShadowSkipReason` (with `never` guard). Invalid shadows never cause init to exit non-zero. (applies ADR-010)

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

```typescript
export type SkillShadowState = 'valid' | 'missing-skill-md' | 'none';
export type RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none';
```

Both are exported from `installer.ts` and imported by `skills.ts` and `rules.ts` for use in the exhaustive `buildSkillShadowTag` / `buildRuleShadowTag` display switches.

### installAllRules

The single compute site for rule installation. Both `installViaFileCopy` and `rules --enable` call it. There is **no `pluginsDir` or `ownerPlugin` parameter** — rule source is resolved internally by `installRuleFile` via `rulesDir()`:

```typescript
export async function installAllRules(
  rulesMap: Map<string, string>,
  devflowDir: string,
  rulesTarget: string,
): Promise<{ ruleName: string; outcome: RuleInstallOutcome }[]>
```

One place computes; callers present the outcomes.

### composeScripts

`composeScripts(scriptsTarget)` assembles `~/.devflow/scripts/` from three sources in order:

**(a) `src/assets/scripts/` verbatim** — hooks/ subdirectory and `hud.sh` entry script copied via `copyDirectory`, with executable bits applied via `chmodRecursive` (non-Windows only).

**(b) Transitive `dist/hud/` import graph** — starting from `dist/hud/index.js`, walks all relative JS import/export specifiers (matched by `IMPORT_RE`), copies each reachable module to `scriptsTarget` preserving its `dist/`-relative path. Files that cannot be accessed are skipped silently.

**(c) `package.json` with `{"type":"module"}`** — written with `flag: 'wx'` (exclusive create); an existing file is left as-is.

Frozen externally-referenced paths that must not move:
- `~/.devflow/scripts/hooks/run-hook` — hook bootstrap entry point
- `~/.devflow/scripts/hud.sh` — HUD entry script

### Command Install (registry-driven)

Commands are installed from `dist/commands/{name}.md` (compiled MDS output). A declared command whose source file is absent from `dist/commands/` is a **hard throw** — init exits non-zero with a clear error. This is intentional: a missing compiled command is a build failure, not a skip. Contrast with agents (missing source is a silent skip) and skills (missing source dir skipped silently).

### Skill Namespace (`prefixSkillName` / `unprefixSkillName`)

Skills install under `~/.claude/skills/devflow:{name}` (prefixed). The `devflow:` prefix is applied at install time; source directories in `src/assets/skills/` stay unprefixed. Shadow dirs also stay unprefixed at `~/.devflow/skills/{name}/`.

`skills.ts` CLI accepts both prefixed and bare input (`unprefixSkillName` normalizes before lookup).

### Universal Skill Install

All skills from ALL plugins install regardless of plugin selection. `skillsMap` passed to `installViaFileCopy` is built by `buildFullSkillsMap` which covers every `DEVFLOW_PLUGINS` entry — not just the selected subset. Rules, by contrast, are plugin-scoped (only selected plugins' rules install).

### LEGACY_* Symbol Split

Legacy cleanup lists are split across two files:

| Symbol | File |
|--------|------|
| `LEGACY_AGENT_NAMES`, `LEGACY_SKILL_NAMES` (+ `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`) | `src/targets/claude-code/legacy.ts` |
| `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES` | `src/core/plugins.ts` |

The split keeps target-specific delete lists separate from the plugin registry consumed by cross-cutting CLI commands. (avoids PF-012)

## Component Interactions

### Shadow Validation Flow (skills)

`validateSkillShadow(shadowDir)` in `installer.ts`:
- Returns `'none'` — shadow dir absent
- Returns `'valid'` — dir exists with a non-empty `SKILL.md` file
- Returns `'missing-skill-md'` — dir exists but `SKILL.md` absent, empty, or not a file

On `'valid'`: `copyDirectory(shadowDir, skillTarget)` replaces the install with the user's copy.
On `'missing-skill-md'`: adds to `skippedShadows`, installs Devflow source.
On `'none'`: installs Devflow source silently.

### Shadow Validation Flow (rules)

`validateRuleShadow(shadowFile)` in `installer.ts`:
- Returns `'none'` — file absent
- Returns `'valid'` — file exists, is a regular file, non-empty
- Returns `'empty-shadow-file'` — file exists and is a file but has size 0
- Returns `'not-a-file'` — path exists but is not a file (e.g. a directory)

`installRuleFile(ruleName, devflowDir, rulesTarget)` uses this result. Rule source is always resolved internally: `path.join(rulesDir(), `${ruleName}.md`)`.
- `'valid'` → attempts `copyFile(shadowFile, targetFile)`; if the copy fails, falls through and installs Devflow source.
- `'empty-shadow-file'` or `'not-a-file'` → installs source, returns the matching `source-invalid-shadow:*` variant.
- `'none'` → installs source, returns `'source'`.

Both the shadow copy and the source copy paths are individually wrapped in try/catch inside `installRuleFile`, so `installAllRules`'s outer `Promise.all` cannot abort from a per-rule failure. (avoids PF-009)

### Uninstall Scope

`removeAllDevFlow(claudeDir, devflowScriptsDir, verbose)` removes four directory paths:
- `~/.claude/commands/devflow/`
- `~/.claude/agents/devflow/`
- `~/.claude/rules/devflow/`
- `devflowScriptsDir` (computed by caller as `path.join(paths.devflowDir, 'scripts')`)

Skills are removed separately by iterating `getAllSkillNames() + LEGACY_SKILL_NAMES`, removing both prefixed (`devflow:{name}`) and bare variants. The rest of `~/.devflow/` (shadows, config) is user-owned and survives uninstall. The project `.devflow/` directory (docs, memory, learning) is prompted separately with `--keep-docs` as a bypass.

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

Returns `[]` for selective uninstalls. For full uninstall, each non-empty shadow list produces a `warn` entry followed by an `info` cleanup hint. Shadow lists are captured before `removeAllDevFlow` runs.

## Integration Patterns

### Shadow Paths (canonical)

| Asset | Shadow path | Install target |
|-------|-------------|----------------|
| Skill | `~/.devflow/skills/{name}/` (unprefixed) | `~/.claude/skills/devflow:{name}/` |
| Rule | `~/.devflow/rules/{name}.md` | `~/.claude/rules/devflow/{name}.md` |

### `devflow skills` CLI

Positional command only (no flags). Unknown action exits 1.

- `shadow <name>` — validates the skill is installed; copies `~/.claude/skills/devflow:{name}/` to `~/.devflow/skills/{name}/` as a starting point; accepts both bare and prefixed input.
- `unshadow <name>` — removes `~/.devflow/skills/{name}/`; restores Devflow source on next `devflow init`.
- `list` — pre-reads `shadowDirSet` from `~/.devflow/skills/`, uses `shadowDirSet.has(skill)` as a short-circuit before calling `validateSkillShadow`. Shadow state renders via `buildSkillShadowTag` exhaustive switch. Orphan directories are shown as "unknown skill".

Exports: `hasShadow(skillName, devflowDir?)`, `listShadowed(devflowDir?)` — used by uninstall.

### `devflow rules` CLI

Positional actions dispatch before flags. Unknown positional action exits 1.

- `shadow <name>` — validates against `allRules`; seeds via `seedRuleShadow`; emits a manual-create hint when seeding fails.
- `unshadow <name>` — validates against `allRules` (exits 1 on unknown names); removes `~/.devflow/rules/{name}.md`.
- `list` — delegates to `printRulesList`; same output as `--list`.

`seedRuleShadow(name, shadowFile, rulesTarget, devflowDir)` — 3-tier, **no `pluginsDir` param**:
- Tier 1: installed rule at `rulesTarget/{name}.md` (fastest path when rules are enabled)
- Tier 2: flat source at `rulesDir()/{name}.md` → `src/assets/rules/{name}.md` (fallback when rules are disabled)
- Tier 3: returns `'none'` — caller emits manual-create instruction

`buildRuleShadowTag` / `buildSkillShadowTag` use exhaustive switches with `never` guards, so adding a new state variant causes a compile error until display coverage is added.

Exports: `hasRuleShadow(ruleName, devflowDir?)`, `listShadowedRules(devflowDir?)`, `seedRuleShadow(...)` — used by uninstall and tests.

## Anti-Patterns

- **Installing all of `~/.devflow/` on uninstall** — only `~/.devflow/scripts/` is Devflow-owned; `~/.devflow/skills/`, `~/.devflow/rules/`, and config files are user-owned and must survive uninstall.
- **Staging shadow state after removal** — `listShadowed()` / `listShadowedRules()` must be called before the removal block; the files may be gone by the time warnings are emitted.
- **Installing without `npm run build`** — commands fail hard with a loud throw when `dist/commands/{name}.md` is missing; rules and skills skip silently when `src/assets/` content is absent. Run `npm run build` (or `build:mds` for commands alone) before any install.
- **Skipping `prefixSkillName` at install time** — the install target must always be the prefixed path `devflow:{name}`; shadow dirs stay unprefixed. Mixing these causes duplicate installs or missed cleanup.
- **Adding a failure path to `installRuleFile` without per-path try/catch** — both the shadow copy and source copy paths must be individually caught. A bare throw inside `installRuleFile` escapes to the `installAllRules` `Promise.all` and aborts rule installation for the whole batch.
- **Restoring `pluginsDir` to `installAllRules` or `installRuleFile`** — rule source is exclusively `rulesDir()` (flat `src/assets/rules/`); there is no per-plugin subdirectory path to provide.

## Gotchas

- **`validateRuleShadow`'s `isFile()` guard is load-bearing.** Without `stat.isFile()`, a directory at `~/.devflow/rules/{name}.md` passes the `size > 0` check on some FSes and returns `'valid'`, causing `copyFile(shadowDir, targetFile)` to throw `EISDIR`. The valid-shadow block catches this and falls through to install the Devflow source (degraded path, not an abort). `fs.stat` follows symlinks: symlink → regular file = valid; symlink → directory = `'not-a-file'`.

- **Skills are cleaned before install on every run.** `installViaFileCopy` removes both the legacy unprefixed and current prefixed skill directories for all known skills before reinstalling. Partial installs (via `--plugin`) still clean all skills universally.

- **`seedRuleShadow` tier 2 requires a built package root.** `rulesDir()` calls `getPackageRoot()`, which resolves from `dist/core/paths.js` depth and throws loudly if `package.json` is absent at the resolved root. Running `devflow rules shadow` without a built `dist/` causes a loud throw on tier-2 fallback (e.g. when rules are disabled and the installed file is absent).

- **`composeScripts` writes `package.json` with `wx` (exclusive create) flag.** A pre-existing `~/.devflow/scripts/package.json` is silently left as-is. If it is corrupt from a failed prior install, the next `devflow init` will not repair it — manual delete is needed.

- **`hasRuleShadow` uses `fs.access`, not `validateRuleShadow`.** It only checks existence. The status display calls `validateRuleShadow` for the full state. Do not conflate the two.

- **Command install hard-throws on a missing `dist/commands/` entry.** A declared command with no compiled source file aborts init — it is not a skip. This distinguishes commands (build output, must exist) from agents and skills (source files, may be absent, silent skip).

## Key Files

- `src/targets/claude-code/installer.ts` — `installViaFileCopy`, `installAllRules`, `installRuleFile`, `composeScripts`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport`, `ShadowSkip`, `RuleInstallOutcome`, `SkillShadowState`, `RuleShadowState`, `copyDirectory`, `chmodRecursive`
- `src/core/assets.ts` — `skillsDir`, `agentsDir`, `rulesDir`, `scriptsDir`, `commandsDir` accessors; single source of truth for all asset source paths
- `src/core/paths.ts` — `getPackageRoot()` with hard `package.json` assertion; 2-level-up resolution from `dist/core/paths.js`
- `src/targets/claude-code/legacy.ts` — `LEGACY_AGENT_NAMES`, `LEGACY_SKILL_NAMES` (composed from `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`); target-specific delete lists for upgrade cleanup
- `src/cli/commands/init.ts` — consumes `InstallReport`; calls `installViaFileCopy`; exhaustive `ShadowSkipReason` switch with `never` guard; imports `LEGACY_SKILL_NAMES` from `legacy.ts`
- `src/cli/commands/uninstall.ts` — `removeAllDevFlow` (removes commands/agents/rules dirs + `devflowScriptsDir` + all skill variants), `computeShadowLeftoverWarnings` (pure), `computeAssetsToRemove`; imports `LEGACY_SKILL_NAMES` from `legacy.ts`
- `src/cli/commands/rules.ts` — `rulesCommand` positional dispatch, `seedRuleShadow` (3-tier, uses `rulesDir()` flat source), `handleRuleShadow`, `handleRuleUnshadow`, `buildRuleShadowTag`, `printRulesList`, `hasRuleShadow`, `listShadowedRules`
- `src/cli/commands/skills.ts` — `skillsCommand` positional dispatch, `buildSkillShadowTag`, `hasShadow`, `listShadowed`
- `src/core/plugins.ts` — `prefixSkillName`, `unprefixSkillName`, `SKILL_NAMESPACE`, `DEVFLOW_PLUGINS`, `buildFullSkillsMap`, `buildRulesMap`, `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES` (note: `LEGACY_SKILL_NAMES` and `LEGACY_AGENT_NAMES` moved to `legacy.ts`)

## Related

- ADR-010: Productionalize skill/rule shadowing — governs `installViaFileCopy` as sole install path and warn-and-install-source (not hard-fail) for invalid shadows (applies ADR-010)
- ADR-003: Leave the end-state, not the transition — governs removals and legacy cleanup; `LEGACY_SKILL_NAMES` accumulates deprecated names, never deletes them (applies ADR-003)
- PF-009: Per-item failure isolation in rule/skill fan-out — per-rule try/catch inside `installRuleFile` ensures one failing rule does not abort the `Promise.all` (avoids PF-009)
- PF-012: LEGACY_* lists deletion-risk — lists now split between `src/targets/claude-code/legacy.ts` (skill/agent) and `src/core/plugins.ts` (plugin/command/rule); both must be retained across upgrades (avoids PF-012)
- Feature knowledge: `feature-knowledge-system` — the Knowledge agent writes to `.devflow/features/` which is tracked in git; related to the `.gitignore` carve-out maintained by the installer (`ensureDevflowGitignore` in `post-install.ts`)
