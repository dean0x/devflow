---
feature: cli-rules
name: Rules System CLI
description: "Use when adding new rules, modifying the rules install flow, implementing rule shadowing, or wiring rules into init/uninstall. Keywords: rules, shared/rules, rulesMap, buildRulesMap, isValidRuleName, LEGACY_RULE_NAMES, rulesEnabled, devflow rules, ~/.claude/rules/devflow, installRuleFile."
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
  - shared/rules/reliability.md
created: 2026-05-10
updated: 2026-05-17
---

# Rules System CLI

## Overview

Rules are ultra-condensed, always-on engineering principle files (~10 lines each) installed as flat `.md` files to `~/.claude/rules/devflow/`. Claude Code loads them automatically on every prompt, filling the guidance gap for quick edits that don't trigger a full skill pipeline. The system mirrors the skill build pipeline exactly: rules live in `shared/rules/`, are declared in `plugin.json` manifests and `DEVFLOW_PLUGINS`, distributed to plugins at build time, and installed (or shadowed) at runtime.

Unlike skills, which install universally from all plugins, rules are **plugin-scoped**: only rules belonging to the currently installed plugins are installed. This keeps core rules (security, engineering, quality, reliability) always present and optional-plugin rules (typescript, react, go, etc.) only present when the user has that plugin installed.

## System Context

Rules flow through four distinct stages that parallel the skill pipeline:

1. **Authoring** — flat `.md` files with YAML frontmatter in `shared/rules/`
2. **Build-time distribution** — `scripts/build-plugins.ts` copies each rule from `shared/rules/{name}.md` into `plugins/{plugin}/rules/{name}.md` based on the plugin's `plugin.json` `rules` array
3. **Install-time placement** — `installRuleFile` in `src/cli/utils/installer.ts` copies rules from the built plugin directory to `~/.claude/rules/devflow/{name}.md`, respecting shadow overrides
4. **Runtime activation** — Claude Code reads rules from `~/.claude/rules/devflow/` on every prompt automatically (no hooks required, unlike skills)

## Component Architecture

### Rule Anatomy

Rules use a two-part structure, but the `paths` frontmatter differs by rule type:

**Core rules** (security, engineering, quality) — apply to every file Claude touches:
```markdown
---
paths: []
---
# Engineering Principles

**Never throw in business logic.**

- Bullet enforcement principles (5-7 lines)
```

**Language/ecosystem rules** (typescript, react, go, etc.) — activate only when editing files matching their pattern:
```markdown
---
paths: ["**/*.ts", "**/*.tsx"]
---
# TypeScript

**Type safety is non-negotiable — `unknown` over `any`, always.**

- Bullet enforcement principles (4-5 lines)
```

This two-tier design is what makes language rules low-cost: a Go rule never loads during TypeScript edits. The init Advanced-mode note shown to users describes this: *"They only load when you edit or generate code in a matching language — e.g., TypeScript rules activate for .ts files, Go rules for .go files. Not loaded all at once; minimal token cost."*

Rules must be ultra-concise — ~10-15 lines total. Longer explanations belong in a skill, not a rule.

### Plugin Declaration

Rules are added to `PluginDefinition` in `src/cli/plugins.ts` via the required `rules` field (`string[]`). Core rules belong on `devflow-core-skills`; language-specific rules belong on their respective optional plugin. All 8 optional language/ecosystem plugins carry rules — typescript, react, accessibility, ui-design, go, java, python, rust:

```typescript
// In DEVFLOW_PLUGINS:
{
  name: 'devflow-core-skills',
  rules: ['security', 'engineering', 'quality', 'reliability'],  // always installed
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

Plugins that have no rules must still include `rules: []` — the field is required on `PluginDefinition` (not optional).

Four helper functions in `plugins.ts` serve distinct scopes:
- `getAllRuleNames()` — unique names across ALL plugins, sorted (used by `devflow rules --list`)
- `buildRulesMap(plugins)` — name → ownerPlugin map for a GIVEN plugin subset; throws on invalid names (used during install and by `devflow rules --enable` and `--status`/`--list`)
- `isValidRuleName(name)` — validates rule names match `/^[a-z0-9-]+$/`; called by `buildRulesMap` at map-build time as a path-traversal defense
- `LEGACY_RULE_NAMES` — currently empty; add entries here when renaming or removing a rule

### Build Pipeline

`scripts/build-plugins.ts` extends the skill/agent build to handle rules. The key difference from skills: rules are **flat files** (not directories), so no recursive copy is needed. The build script reads `plugin.json`'s `rules` array, clears and recreates the plugin's `rules/` directory, then copies each `shared/rules/{name}.md` into `plugins/{plugin}/rules/{name}.md`. The build fails with exit 1 if a declared rule is missing from `shared/rules/`.

The `shared/rules/` directory is optional — the build script warns but does not fail if it doesn't exist (rules are new; older devflow installs may lack it).

### Install Flow

Rule installation is handled by `installRuleFile`, an exported function in `src/cli/utils/installer.ts`. It is called from both `installViaFileCopy` (during init) and the `devflow rules --enable` command. Shadow resolution is centralized here:

```typescript
// installRuleFile: shadow-respecting copy for a single rule.
// Called via Promise.all in both init and devflow rules --enable.
export async function installRuleFile(
  ruleName: string,
  ownerPlugin: string,
  pluginsDir: string,
  devflowDir: string,
  rulesTarget: string,
): Promise<void> {
  const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
  const targetFile = path.join(rulesTarget, `${ruleName}.md`);

  try {
    await fs.access(shadowFile);
    await fs.copyFile(shadowFile, targetFile);  // shadow wins
    return;
  } catch { /* no shadow — fall through to plugin source */ }

  const ruleSource = path.join(pluginsDir, ownerPlugin, 'rules', `${ruleName}.md`);
  try {
    await fs.access(ruleSource);
    await fs.copyFile(ruleSource, targetFile);
  } catch { /* source missing — skip silently */ }
}
```

`installViaFileCopy` calls this via `Promise.all([...rulesMap.entries()].map(...))` after creating the target directory. Shadow check: `~/.devflow/rules/{name}.md` overrides the built plugin source.

Key install properties:
- Target: `~/.claude/rules/devflow/{name}.md` (flat, no subdirectory nesting)
- Shadow: `~/.devflow/rules/{name}.md` overrides the Devflow source — same pattern as skills but for a flat file
- Disabled: if `rulesEnabled` is false, no rules directory is created; post-install step in init removes it if it already exists

### Manifest Tracking

`ManifestData.features.rules: boolean` tracks whether rules are enabled. The manifest reader in `src/cli/utils/manifest.ts` self-heals — when reading a manifest that lacks the `rules` key, it defaults to `true` (rules-on is the safe default for upgrades from pre-rules installs).

The full `ManifestData.features` object (as of v2.x) tracks: `teams`, `ambient`, `memory`, `learn`, `hud`, `knowledge`, `decisions`, `rules`, `flags: string[]`, and `viewMode?: ViewMode`. When adding new toggleable features, extend this interface and add the corresponding self-heal default in `readManifest`.

### `devflow rules` Command

The `rules` command in `src/cli/commands/rules.ts` has four subcommands:

| Subcommand | Behavior |
|---|---|
| `--enable` | Wipes `~/.claude/rules/devflow/` first (stale cleanup), reads manifest plugins, copies rules from built plugin dirs (respecting shadows), updates `manifest.features.rules = true` |
| `--disable` | Removes `~/.claude/rules/devflow/` entirely, updates `manifest.features.rules = false` |
| `--status` | Lists installed rules with owner plugin (shortened) and `[shadowed]` tag |
| `--list` | Lists ALL available rules from all plugins with install indicator (✓/✗) |

The `--enable` path resolves the source directory relative to the compiled CLI's location (`path.resolve(__dirname, '../..'), 'plugins'`), not the source tree — this is the built `dist/plugins/` path. It also wipes the rules directory before reinstalling, mirroring the full-install init flow so that rules from previously uninstalled plugins are cleaned up.

Two private helpers are top-level named functions in `rules.ts` (not inline):
- `isShadowed(devflowDir, ruleName)` — `fs.access` on `~/.devflow/rules/{name}.md`; returns `Promise<boolean>`
- `formatRuleRow(name, devflowDir, ownerMap, suffix)` — builds a colorized display row; takes the `ownerMap` (a `Map<string, string>` from `buildRulesMap`) as an explicit parameter. Both `--status` and `--list` build their own `buildRulesMap(DEVFLOW_PLUGINS)` call locally and pass it in — there is no module-level constant.

## Component Interactions

**init → rules**: During `devflow init`, `rulesEnabled` defaults to `true`. In **Recommended mode** (`--recommended`, non-TTY, or user chooses Recommended at the setup-mode prompt), the value is applied silently — rules status appears only in the printed summary note, no prompt is shown. In **Advanced mode**, an explicit `p.note()` explains the per-language token model, followed by `p.confirm()`. CLI flags (`--rules`/`--no-rules`) override the default in both modes. Once decided, `buildRulesMap(pluginsToInstall)` builds the name→plugin map passed to `installViaFileCopy` (when enabled), or an empty Map is used (when disabled). Rules are **overwritten per-file** by `installViaFileCopy` — the rules directory itself is not wiped on init. Stale renamed or removed rules are cleaned up via the `LEGACY_RULE_NAMES` loop (analogous to `LEGACY_SKILL_NAMES` for skills). If disabled, a post-install step removes the entire `~/.claude/rules/devflow/` directory.

**uninstall → rules**: Full uninstall (`removeAllDevFlow`) includes `~/.claude/rules/devflow/` in its target directory list. Selective plugin uninstall (`computeAssetsToRemove`) computes which rules to remove using the same "retained by remaining plugins" logic as skills and agents — `removeSelectedPlugins` removes per-rule files from `~/.claude/rules/devflow/`.

**list → rules**: `devflow list` shows `rules` in the Features line of the installation summary when `manifest.features.rules` is true.

**build → install**: Rules are not installed from `shared/rules/` directly at runtime — the installer reads from `plugins/{plugin}/rules/`, which is the build output. Always run `npm run build` after modifying `shared/rules/` before testing install.

## Constraints

- Rules have no namespace prefix (unlike skills which install as `devflow:{name}/`). The directory `~/.claude/rules/devflow/` itself provides the namespace.
- Rules are plugin-scoped by design — no `buildFullRulesMap()` equivalent exists. If you need a rule in all installs, put it in `devflow-core-skills`.
- `LEGACY_RULE_NAMES` in `plugins.ts` is currently empty — the first rules are new. Add entries here when renaming or removing a rule.
- The `paths` frontmatter key must always be present — Claude Code uses it to determine loading scope. Core rules use `paths: []` (global); language rules use a glob array (file-type-scoped). Omitting the key entirely may break rule loading.
- `buildRulesMap` throws if any rule name fails the `isValidRuleName` check — misconfigured `plugin.json` entries are caught at map-build time, not at path-construction time.

## Anti-Patterns

- **Adding a language rule to `devflow-core-skills`**: Core rules install for every user. Language-specific rules (TypeScript, React, Go) belong in their optional plugin so users who don't use that language don't pay the token cost.
- **Using `paths: []` on a language-specific rule**: Language rules must scope to their file types (e.g. `paths: ["**/*.ts", "**/*.tsx"]`). Using `paths: []` makes them load on every prompt for every user, eliminating the per-language token savings.
- **Using a file-type path on a core rule**: Core rules (security, engineering, quality) must use `paths: []` — they apply cross-language. A path filter would silently skip them for non-matching files.
- **Installing rules from `shared/rules/` directly at runtime**: The installer reads from `plugins/{plugin}/rules/` (build output), not `shared/rules/`. Skipping `npm run build` after editing a rule will silently install the old version.
- **Using a skill for ultra-concise guidance**: If content fits in ~15 lines and applies universally, prefer a rule. Rules load on every prompt with zero user action; skills require the router or explicit invocation.
- **Long rule files**: Rules should be ~10-15 lines. If a rule grows beyond ~20 lines, extract the detail into a skill's `references/` directory and keep only the iron law in the rule.
- **Omitting `rules: []` on a plugin**: The `rules` field is required on `PluginDefinition`. Omitting it causes TypeScript errors at build time.

## Gotchas

- **Rules are not cleaned between partial installs via init**: On `devflow init --plugin=typescript` (partial install), the existing `~/.claude/rules/devflow/` directory is NOT wiped first (only commands and agents directories are wiped on full install). Use `devflow rules --enable` to get a clean reinstall of the current plugin set — it always wipes first.
- **`devflow rules --enable` resolves plugin dirs from dist/**: The command computes the plugins directory as `path.resolve(__dirname, '../..', 'plugins')` relative to the compiled CLI file. In development, this means running the command against `dist/plugins/`, so you must build before running.
- **Shadow files are flat, not directories**: Skills shadow at `~/.devflow/skills/{name}/` (a directory). Rules shadow at `~/.devflow/rules/{name}.md` (a flat file). The `isShadowed` check uses `fs.access()` on the flat path, not `fs.stat()` for a directory.
- **Manifest defaults `rules: true` on read**: Old manifests without the `rules` field are read as `rules: true`. This means upgrading users get rules enabled automatically, which is the desired behavior but worth knowing when reading the manifest.
- **`buildRulesMap` throws on invalid names**: If a `plugin.json` declares a rule name with uppercase letters, dots, or slashes, `buildRulesMap` throws immediately. This is intentional — catch misconfiguration early rather than silently writing a path-traversal-susceptible file.
- **Rules have no runtime sentinel**: Unlike knowledge (`.features/.disabled`), decisions (`.memory/decisions/.disabled`), memory (`.memory/.working-memory-disabled`), and learn (`.memory/.learning-disabled`), rules have no `.disabled` file sentinel. Both `manageSentinel` and `updateSidecarFeature` calls in `init.ts` conspicuously omit rules — this is intentional. The sidecar system (which writes `sidecar/config.json` entries for memory, learning, decisions, and knowledge to coordinate background agents) has no entry for rules because rules have no background agent: they are static files loaded by Claude Code directly. Disabling rules is a destructive operation: `devflow rules --disable` removes `~/.claude/rules/devflow/` entirely, and `devflow init --no-rules` does the same. There is no way to temporarily suppress rules without removing the files themselves.
- **Core vs language rules have different token behavior**: Core rules (security, engineering, quality, reliability) load on every prompt regardless of file type. Language rules only activate when Claude is working with a matching file. A user without the TypeScript plugin pays zero cost for TypeScript rules — but a user with it only pays the cost when editing `.ts`/`.tsx` files.
- **manifest.ts contains a `kb → knowledge` migration self-heal**: `readManifest` detects `features.kb` and migrates it to `features.knowledge` in-place (ADR-001 clean-break applies to install-time assets like rules, skills, commands — not to disk data that users cannot easily migrate themselves). This is the only backward-compat code in `manifest.ts`; do not add more. For rules, `LEGACY_RULE_NAMES` in `plugins.ts` is the correct pattern when renaming rule files — no manifest migration needed.

## Key Files

- `shared/rules/` — source of truth for all rule content; flat `.md` files
- `src/cli/plugins.ts` — `DEVFLOW_PLUGINS` `rules` field, `buildRulesMap()`, `getAllRuleNames()`, `isValidRuleName()`, `LEGACY_RULE_NAMES`
- `src/cli/commands/rules.ts` — `devflow rules` command (enable/disable/status/list)
- `src/cli/utils/installer.ts` — `installRuleFile` (exported); `installViaFileCopy` rules section
- `src/cli/commands/init.ts` — `rulesEnabled` flag (default `true`); Recommended-mode silent apply vs Advanced-mode note+confirm; `buildRulesMap(pluginsToInstall)`; `LEGACY_RULE_NAMES` stale-file cleanup loop; post-install removal of rules dir when disabled
- `src/cli/commands/uninstall.ts` — `computeAssetsToRemove` includes rules; `removeAllDevFlow` removes rules dir; `removeSelectedPlugins` removes per-rule files
- `src/cli/utils/manifest.ts` — `ManifestData.features.rules` with `true` self-heal default
- `scripts/build-plugins.ts` — build-time distribution from `shared/rules/` → `plugins/*/rules/`

## Related

- ADR-001: No migration code for devflow refactors — clean break philosophy (applies: `LEGACY_RULE_NAMES` starts empty; when rules are renamed, add legacy names there without migration logic)
- Skills system (parallel architecture): `src/cli/utils/installer.ts` `installViaFileCopy` skills section is the model rules followed
- Feature flags: `src/cli/utils/flags.ts` — another toggleable feature using the same manifest.features pattern
