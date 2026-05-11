---
feature: cli-rules
name: Rules System CLI
description: "Use when adding new rules, modifying the rules install flow, implementing rule shadowing, or wiring rules into init/uninstall. Keywords: rules, shared/rules, rulesMap, buildRulesMap, LEGACY_RULE_NAMES, rulesEnabled, devflow rules, ~/.claude/rules/devflow."
category: architecture
directories: [src/cli/commands/, src/cli/utils/, shared/rules/, scripts/]
referencedFiles:
  - src/cli/commands/rules.ts
  - src/cli/commands/init.ts
  - src/cli/commands/uninstall.ts
  - src/cli/plugins.ts
  - src/cli/utils/installer.ts
  - src/cli/utils/manifest.ts
  - scripts/build-plugins.ts
  - shared/rules/security.md
  - shared/rules/engineering.md
  - shared/rules/quality.md
created: 2026-05-10
updated: 2026-05-11
---

# Rules System CLI

## Overview

Rules are ultra-condensed, always-on engineering principle files (~10 lines each) installed as flat `.md` files to `~/.claude/rules/devflow/`. Claude Code loads them automatically on every prompt, filling the guidance gap for quick edits that don't trigger a full skill pipeline. The system mirrors the skill build pipeline exactly: rules live in `shared/rules/`, are declared in `plugin.json` manifests and `DEVFLOW_PLUGINS`, distributed to plugins at build time, and installed (or shadowed) at runtime.

Unlike skills, which install universally from all plugins, rules are **plugin-scoped**: only rules belonging to the currently installed plugins are installed. This keeps core rules (security, engineering, quality) always present and optional-plugin rules (typescript, react, go, etc.) only present when the user has that plugin installed.

## System Context

Rules flow through four distinct stages that parallel the skill pipeline:

1. **Authoring** — flat `.md` files with YAML frontmatter in `shared/rules/`
2. **Build-time distribution** — `scripts/build-plugins.ts` copies each rule from `shared/rules/{name}.md` into `plugins/{plugin}/rules/{name}.md` based on the plugin's `plugin.json` `rules` array
3. **Install-time placement** — `installViaFileCopy` in `src/cli/utils/installer.ts` copies rules from the built plugin directory to `~/.claude/rules/devflow/{name}.md`, respecting shadow overrides
4. **Runtime activation** — Claude Code reads rules from `~/.claude/rules/devflow/` on every prompt automatically (no hooks required, unlike skills)

## Component Architecture

### Rule Anatomy

Every rule file uses a two-part structure:

```markdown
---
paths: []
---
# Rule Title

**Iron law sentence.**

- Bullet enforcement principles (5-7 lines)
```

The `paths: []` frontmatter tells Claude Code to apply this rule to all files (no path filter). Rules must be ultra-concise — the entire file should be ~10-15 lines. Longer explanations belong in a skill, not a rule.

### Plugin Declaration

Rules are added to `PluginDefinition` in `src/cli/plugins.ts` via the optional `rules` field. Core rules belong on `devflow-core-skills`; language-specific rules belong on their respective optional plugin. All 8 optional language/ecosystem plugins carry rules — typescript, react, accessibility, ui-design, go, java, python, rust:

```typescript
// In DEVFLOW_PLUGINS:
{
  name: 'devflow-core-skills',
  rules: ['security', 'engineering', 'quality'],  // always installed
},
{
  name: 'devflow-typescript',
  optional: true,
  rules: ['typescript'],  // only installed when plugin is selected
},
// devflow-react, devflow-accessibility, devflow-ui-design,
// devflow-go, devflow-java, devflow-python, devflow-rust
// all follow the same pattern — one rule per plugin, same name as plugin suffix
```

Plugins that have no rules simply omit the `rules` field from their `PluginDefinition` — do not set `rules: []`.

Three helper functions in `plugins.ts` serve distinct scopes:
- `getAllRuleNames()` — unique names across ALL plugins (used by `devflow rules --list`)
- `buildRulesMap(plugins)` — name → ownerPlugin map for a GIVEN plugin subset (used during install and by `devflow rules --enable`)
- `buildRulesMap(DEVFLOW_PLUGINS)` — called once at module load in `rules.ts` to create a module-level `allRulesMap` constant for owner lookups in `formatRuleRow`; avoids rebuilding on every `--status` or `--list` invocation

### Build Pipeline

`scripts/build-plugins.ts` extends the skill/agent build to handle rules. The key difference from skills: rules are **flat files** (not directories), so no recursive copy is needed. The build script reads `plugin.json`'s `rules` array, clears and recreates the plugin's `rules/` directory, then copies each `shared/rules/{name}.md` into `plugins/{plugin}/rules/{name}.md`. The build fails with exit 1 if a declared rule is missing from `shared/rules/`.

The `shared/rules/` directory is optional — the build script warns but does not fail if it doesn't exist (rules are new; older devflow installs may lack it).

### Install Flow

In `src/cli/utils/installer.ts`, rules install happens after skills, guarded by `rulesMap.size > 0`:

```typescript
// Rules path: no prefix, no directory nesting (unlike skills which nest under devflow:name/)
const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
if (rulesMap.size > 0) {
  await fs.mkdir(rulesTarget, { recursive: true });
  for (const [ruleName, ownerPlugin] of rulesMap) {
    const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
    // Shadow check: ~/.devflow/rules/{name}.md overrides source
    const isShadowed = ...
    const ruleSource = path.join(pluginsDir, ownerPlugin, 'rules', `${ruleName}.md`);
    await fs.copyFile(isShadowed ? shadowFile : ruleSource, targetFile);
  }
}
```

Key install properties:
- Target: `~/.claude/rules/devflow/{name}.md` (flat, no subdirectory nesting)
- Shadow: `~/.devflow/rules/{name}.md` overrides the Devflow source — same pattern as skills but for a flat file
- Disabled: if `rulesEnabled` is false, the entire `~/.claude/rules/devflow/` directory is removed

### Manifest Tracking

`ManifestData.features.rules: boolean` tracks whether rules are enabled. The manifest reader in `src/cli/utils/manifest.ts` self-heals — when reading a manifest that lacks the `rules` key, it defaults to `true` (rules-on is the safe default for upgrades from pre-rules installs).

### `devflow rules` Command

The `rules` command in `src/cli/commands/rules.ts` has four subcommands:

| Subcommand | Behavior |
|---|---|
| `--enable` | Reads manifest, filters to installed plugins, copies rules from built plugin dirs (respecting shadows), updates `manifest.features.rules = true` |
| `--disable` | Removes `~/.claude/rules/devflow/` entirely, updates `manifest.features.rules = false` |
| `--status` | Lists installed rules with owner plugin (shortened) and `[shadowed]` tag |
| `--list` | Lists ALL available rules from all plugins with install indicator (✓/✗) |

The `--enable` path resolves the source directory relative to the compiled CLI's location (`path.resolve(__dirname, '../..'), 'plugins'`), not the source tree — this is the built `dist/plugins/` path.

Two private helpers are extracted as top-level named functions in `rules.ts` (not inline):
- `isShadowed(devflowDir, ruleName)` — `fs.access` on `~/.devflow/rules/{name}.md`; returns `Promise<boolean>`
- `formatRuleRow(name, devflowDir, suffix)` — builds a colorized display row using `allRulesMap` for owner attribution; `suffix` is either the install indicator (✓/✗) for `--list` or empty string for `--status`

## Component Interactions

**init → rules**: During `devflow init`, `rulesEnabled` is computed from CLI flags or prompts. If true, `buildRulesMap(pluginsToInstall)` builds the map that gets passed to `installViaFileCopy`. If false, the map is empty, and a post-install step removes the rules directory.

**uninstall → rules**: Full uninstall (`removeAllDevFlow`) includes `~/.claude/rules/devflow/` in its target directory list. Selective plugin uninstall (`computeAssetsToRemove`) computes which rules to remove using the same "retained by remaining plugins" logic as skills and agents.

**list → rules**: `devflow list` shows `rules` in the Features line of the installation summary when `manifest.features.rules` is true.

**build → install**: Rules are not installed from `shared/rules/` directly at runtime — the installer reads from `plugins/{plugin}/rules/`, which is the build output. Always run `npm run build` after modifying `shared/rules/` before testing install.

## Constraints

- Rules have no namespace prefix (unlike skills which install as `devflow:{name}/`). The directory `~/.claude/rules/devflow/` itself provides the namespace.
- Rules are plugin-scoped by design — no `buildFullRulesMap()` equivalent exists. If you need a rule in all installs, put it in `devflow-core-skills`.
- `LEGACY_RULE_NAMES` in `plugins.ts` is currently empty — the first rules are new. Add entries here when renaming or removing a rule.
- The `paths: []` YAML frontmatter must remain — it signals to Claude Code that the rule applies globally. Omitting it may break rule loading.

## Anti-Patterns

- **Adding a language rule to `devflow-core-skills`**: Core rules install for every user. Language-specific rules (TypeScript, React, Go) belong in their optional plugin so users who don't use that language don't pay the token cost.
- **Installing rules from `shared/rules/` directly at runtime**: The installer reads from `plugins/{plugin}/rules/` (build output), not `shared/rules/`. Skipping `npm run build` after editing a rule will silently install the old version.
- **Using a skill for ultra-concise guidance**: If content fits in ~15 lines and applies universally, prefer a rule. Rules load on every prompt with zero user action; skills require the router or explicit invocation.
- **Long rule files**: Rules should be ~10-15 lines. If a rule grows beyond ~20 lines, extract the detail into a skill's `references/` directory and keep only the iron law in the rule.

## Gotchas

- **Rules are not cleaned between partial installs**: On `devflow init --plugin=typescript` (partial install), the existing `~/.claude/rules/devflow/` directory is NOT wiped first (only commands and agents directories are wiped on full install). Rules from previously installed plugins persist unless they're explicitly removed via selective uninstall.
- **`devflow rules --enable` resolves plugin dirs from dist/**: The command computes the plugins directory as `path.resolve(__dirname, '../..', 'plugins')` relative to the compiled CLI file. In development, this means running the command against `dist/plugins/`, so you must build before running.
- **Shadow files are flat, not directories**: Skills shadow at `~/.devflow/skills/{name}/` (a directory). Rules shadow at `~/.devflow/rules/{name}.md` (a flat file). The `isShadowed` check uses `fs.access()` on the flat path, not `fs.stat()` for a directory.
- **Manifest defaults `rules: true` on read**: Old manifests without the `rules` field are read as `rules: true`. This means upgrading users get rules enabled automatically, which is the desired behavior but worth knowing when reading the manifest.

## Key Files

- `shared/rules/` — source of truth for all rule content; flat `.md` files
- `src/cli/plugins.ts` — `DEVFLOW_PLUGINS` `rules` field, `buildRulesMap()`, `getAllRuleNames()`, `LEGACY_RULE_NAMES`
- `src/cli/commands/rules.ts` — `devflow rules` command (enable/disable/status/list)
- `src/cli/utils/installer.ts` — `installViaFileCopy` rules section; shadow resolution
- `src/cli/commands/init.ts` — `rulesEnabled` flag, `buildRulesMap(pluginsToInstall)`, post-install cleanup of rules directory
- `src/cli/commands/uninstall.ts` — `computeAssetsToRemove` includes rules; `removeAllDevFlow` removes rules dir; `removeSelectedPlugins` removes per-rule files
- `src/cli/utils/manifest.ts` — `ManifestData.features.rules` with `true` self-heal default
- `scripts/build-plugins.ts` — build-time distribution from `shared/rules/` → `plugins/*/rules/`

## Related

- ADR-001: No migration code for devflow refactors — clean break philosophy (applies: `LEGACY_RULE_NAMES` starts empty; when rules are renamed, add legacy names there without migration logic)
- Skills system (parallel architecture): `src/cli/utils/installer.ts` `installViaFileCopy` skills section is the model rules followed
- Feature flags: `src/cli/utils/flags.ts` — another toggleable feature using the same manifest.features pattern
