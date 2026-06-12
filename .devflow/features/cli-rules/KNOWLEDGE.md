---
feature: cli-rules
name: Rules System CLI
description: "Use when adding new rules, modifying the rules install flow, implementing rule shadowing, or wiring rules into init/uninstall. Keywords: rules, shared/rules, rulesMap, buildRulesMap, isValidRuleName, LEGACY_RULE_NAMES, rulesEnabled, devflow rules, ~/.claude/rules/devflow, installRuleFile, removeLegacyCommandsRule, ambient.ts, partitionSelectablePlugins, WORKFLOW_ORDER, combineSelection, shouldRetry, autoCommit, DreamConfig, decisions-ledger-unify-v1, sync-devflow-gitignore-v3, devflow-dynamic, build-recipes, shared/recipes."
category: architecture
directories: [src/cli/commands/, src/cli/utils/, shared/rules/, scripts/]
referencedFiles:
  - src/cli/commands/rules.ts
  - src/cli/commands/init.ts
  - src/cli/commands/uninstall.ts
  - src/cli/commands/ambient.ts
  - src/cli/plugins.ts
  - src/cli/utils/installer.ts
  - src/cli/utils/manifest.ts
  - src/cli/utils/flags.ts
  - src/cli/utils/teammate-mode-cleanup.ts
  - src/cli/utils/dream-config.ts
  - src/cli/utils/migrations.ts
  - scripts/build-plugins.ts
  - scripts/build-recipes.ts
  - shared/rules/security.md
  - shared/rules/engineering.md
  - shared/rules/quality.md
  - shared/rules/reliability.md
created: 2026-05-10
updated: 2026-06-12
---

# Rules System CLI

## Overview

Rules are ultra-condensed, always-on engineering principle files (~10 lines each) installed as flat `.md` files to `~/.claude/rules/devflow/`. Claude Code loads them automatically on every prompt, filling the guidance gap for quick edits that don't trigger a full skill pipeline. The system mirrors the skill build pipeline exactly: rules live in `shared/rules/`, are declared in `plugin.json` manifests and `DEVFLOW_PLUGINS`, distributed to plugins at build time, and installed (or shadowed) at runtime.

Unlike skills, which install universally from all plugins, rules are **plugin-scoped**: only rules belonging to the currently installed plugins are installed. This keeps core rules (security, engineering, quality, reliability) always present and optional-plugin rules (typescript, react, accessibility, ui-design, go, java, python, rust) only present when the user has that plugin installed. There are currently 12 rules total: 4 core + 8 language/ecosystem.

## System Context

Rules flow through four distinct stages that parallel the skill pipeline:

1. **Authoring** — flat `.md` files with YAML frontmatter in `shared/rules/`
2. **Build-time distribution** — `scripts/build-plugins.ts` copies each rule from `shared/rules/{name}.md` into `plugins/{plugin}/rules/{name}.md` based on the plugin's `plugin.json` `rules` array
3. **Install-time placement** — `installRuleFile` in `src/cli/utils/installer.ts` copies rules from the built plugin directory to `~/.claude/rules/devflow/{name}.md`, respecting shadow overrides
4. **Runtime activation** — Claude Code reads rules from `~/.claude/rules/devflow/` on every prompt automatically (no hooks required, unlike skills)

## Component Architecture

### Rule Anatomy

Rules use a two-part structure, but the `paths` frontmatter differs by rule type:

**Core rules** (security, engineering, quality, reliability) — apply to every file Claude touches:
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

This two-tier design is what makes language rules low-cost: a Go rule never loads during TypeScript edits. Rules must be ultra-concise — ~10-15 lines total. Longer explanations belong in a skill, not a rule.

### Plugin Declaration

Rules are added to `PluginDefinition` in `src/cli/plugins.ts` via the required `rules` field (`string[]`). Core rules belong on `devflow-core-skills`; language-specific rules belong on their respective optional plugin. All 8 optional language/ecosystem plugins carry rules — typescript, react, accessibility, ui-design, go, java, python, rust. Non-language optional plugins (devflow-audit-claude, **devflow-dynamic**) and all non-language workflow plugins have `rules: []`. Only `devflow-core-skills` and the 8 language/UI plugins carry rules through the plugin system:

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

Plugins that have no rules must still include `rules: []` — the field is required on `PluginDefinition` (not optional). `devflow-ambient` has `rules: []` — its legacy `commands` rule was removed; any stale `~/.claude/rules/devflow/commands.md` file is purged automatically on every `devflow ambient --enable/--disable` or `devflow init`.

Four helper functions in `plugins.ts` serve distinct scopes:
- `getAllRuleNames()` — unique names across ALL plugins, sorted (used by `devflow rules --list`)
- `buildRulesMap(plugins)` — name → ownerPlugin map for a GIVEN plugin subset; throws on invalid names (used during install and by `devflow rules --enable` and `--status`/`--list`)
- `isValidRuleName(name)` — validates rule names match `/^[a-z0-9-]+$/`; called by `buildRulesMap` at map-build time as a path-traversal defense
- `LEGACY_RULE_NAMES` — currently empty; add entries here when renaming or removing a rule

The `devflow-core-skills` plugin's `skills` array in `plugins.ts` registers the three active per-task Dream skills (`dream-decisions`, `dream-knowledge`, `dream-curation`). `dream-memory` was removed from the active skills list in PR #239 — memory is now handled entirely by the `background-memory-update` detached worker, not a Dream subagent. Both `dream-memory` (bare) and `devflow:dream-memory` (namespaced) are in `LEGACY_SKILLS_V2X` so older installs that had them are swept during `devflow init`. The learning pipeline skills (`eval-learning`, `eval-reinforce`, and the `devflow learn` CLI) were removed in PR #238.

**PR #241 (decisions ledger + deterministic render)**: Added `decisions-ledger-unify-v1` (per-project migration) and `sync-devflow-gitignore-v3` (per-project) migrations in `src/cli/utils/migrations.ts`. The `DreamConfig` interface in `src/cli/utils/dream-config.ts` now has a fourth field: `autoCommit: boolean` (default `true`). When `autoCommit` is true (the default), the Dream agent's `dream-commit` helper automatically creates `chore(dream):` commits after each Dream maintenance write. `devflow decisions --status` now outputs an `Auto-commit: ON/OFF` line. `coerceConfig` in `dream-config.ts` silently drops the legacy `learning` key AND reads `autoCommit` — the interface is `{memory, decisions, knowledge, autoCommit}`. Do NOT reference `features.teams` (removed PR #240) or `features.learn` (removed PR #238) as fields of `DreamConfig`.

**Agent Teams removal (PR #240)**: The bespoke Agent Teams machinery was removed. The eight `*-teams.md` command variants, the `agent-teams` skill, all `teamsEnabled`/`applyTeamsConfig`/`stripTeamsConfig` touch-points, and the `--teams`/`--no-teams` init flags were deleted. Agent Teams is re-exposed as a single optional flag `agent-teams` in `FLAG_REGISTRY` (defaultEnabled: false), toggled via `devflow flags --enable agent-teams`. Key cleanup mechanics:
- `devflow:agent-teams` (namespaced) is in `LEGACY_SKILLS_V2X` for install cleanup
- `init.ts` sweeps orphaned `*-teams.md` files from the commands directory unconditionally on every install type (full install clears the dir; partial install runs the explicit blanket sweep)
- Two migrations clean stale `teammateMode: "auto"` written by prior Devflow installs: `purge-devflow-teammate-mode-global-v1` (global, `~/.claude/settings.json`) and `purge-devflow-teammate-mode-v1` (per-project, `<projectRoot>/.claude/settings.json`)
- `stripDevflowTeammateModeFromJson` in `src/cli/utils/teammate-mode-cleanup.ts` is the pure function that handles the cleanup; called by both migrations and by `uninstall.ts`

**Dual-role bare entries in `LEGACY_SKILLS_V2X`**: the bare entries `dream-decisions`, `dream-knowledge`, and `dream-curation` are still-active skills installed at `devflow:<bare-name>`. These bare entries in `LEGACY_SKILLS_V2X` exist only to clean up pre-namespace V2.x install directories (e.g., `~/.claude/skills/dream-decisions`). On current installs, the `fs.rm` targeting the bare path is a harmless no-op because active skills always install under the `devflow:` prefix. A block comment in `plugins.ts` documents this explicitly — do NOT remove these entries or V2.x upgraders will be left with stale bare-name dirs.

### Build Pipeline

`scripts/build-plugins.ts` extends the skill/agent build to handle rules. The key difference from skills: rules are **flat files** (not directories), so no recursive copy is needed. The build script reads `plugin.json`'s `rules` array, clears and recreates the plugin's `rules/` directory, then copies each `shared/rules/{name}.md` into `plugins/{plugin}/rules/{name}.md`. The build fails with exit 1 if a declared rule is missing from `shared/rules/`.

**Recipe compilation** (`build:recipes`): `scripts/build-recipes.ts` compiles `.mds` recipe files from `shared/recipes/` into Markdown command files in `plugins/devflow-dynamic/commands/`. Partials (files whose basename starts with `_`) are skipped. The build hard-fails on any compile error, ensuring a broken or stale command never ships. Recipe commands cannot be installed from `shared/recipes/` directly — always run `npm run build:recipes` (or `npm run build`) before testing the dynamic plugin commands. The full build order is: `build:cli && build:plugins && build:recipes && build:hud`.

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

Key install properties:
- Target: `~/.claude/rules/devflow/{name}.md` (flat, no subdirectory nesting)
- Shadow: `~/.devflow/rules/{name}.md` overrides the Devflow source — same pattern as skills but for a flat file
- Disabled: if `rulesEnabled` is false, no rules directory is created; post-install step in init removes it if it already exists

### Manifest Tracking

`ManifestData.features.rules: boolean` tracks whether rules are enabled. The manifest reader in `src/cli/utils/manifest.ts` self-heals — when reading a manifest that lacks the `rules` field, it defaults to `true` (rules-on is the safe default for upgrades from pre-rules installs). The `features.learn` field was removed from `ManifestData` in PR #238 (learning pipeline removal); `DreamConfig` (in `src/cli/utils/dream-config.ts`) now tracks only `{memory, decisions, knowledge, autoCommit}`. The `--learn`/`--no-learn` CLI option and `learnEnabled` variable in `init.ts` no longer exist. The `features.teams`/`teamsEnabled` manifest field was removed in PR #240 (agent-teams removal) — `manifest.features` no longer tracks agent-teams state at all; it is handled entirely by `features.flags: string[]`.

### `devflow rules` Command

The `rules` command in `src/cli/commands/rules.ts` has four subcommands:

| Subcommand | Behavior |
|---|---|
| `--enable` | Wipes `~/.claude/rules/devflow/` first (stale cleanup), reads manifest plugins, copies rules from built plugin dirs (respecting shadows), updates `manifest.features.rules = true` |
| `--disable` | Removes `~/.claude/rules/devflow/` entirely, updates `manifest.features.rules = false` |
| `--status` | Lists installed rules with owner plugin (shortened) and `[shadowed]` tag |
| `--list` | Lists ALL available rules from all plugins with install indicator (✓/✗) |

Two private helpers are top-level named functions in `rules.ts` (not inline):
- `isShadowed(devflowDir, ruleName)` — `fs.access` on `~/.devflow/rules/{name}.md`; returns `Promise<boolean>`
- `formatRuleRow(name, devflowDir, ownerMap, suffix)` — builds a colorized display row; both `--status` and `--list` build their own `buildRulesMap(DEVFLOW_PLUGINS)` call locally and pass it in — there is no module-level constant.

## Init Flow Integration (Updated: Two-Step Plugin Selection)

**Scope**: The interactive scope prompt was removed in feat(init). User scope is now the default for all TTY interactive runs. Only `--scope` flag or non-TTY path can set `local` scope. Non-TTY detects and logs "Non-interactive mode detected, using scope: user".

**Two-step plugin selection**: `devflow init` (TTY, no `--plugin`) now presents two sequential `p.multiselect` prompts instead of one:
- **Step 1 — Workflow plugins**: All command-bearing plugins (excluding `devflow-core-skills`, `devflow-ambient`, `devflow-audit-claude`). Pre-selected: non-optional workflow plugins. **Includes `devflow-dynamic`** (optional, command-bearing).
- **Step 2 — Language plugins**: All command-less selectable plugins (language/ecosystem). Nothing pre-selected.

The split is computed by `partitionSelectablePlugins(DEVFLOW_PLUGINS)` in `plugins.ts`, which returns `{ workflow, language }` buckets. This is a pure function — no I/O, no mutation of the input array, deterministic, no side effects.

**`devflow-dynamic` in workflow bucket**: `partitionSelectablePlugins` places `devflow-dynamic` in the **workflow** bucket because `commands.length > 0`. It carries `optional: true` so it is not pre-selected at init. The test in `tests/plugins.test.ts` allowlists `devflow-dynamic` in the `allowedOptional` set alongside `devflow-audit-claude` and the 8 language plugins.

**Bounded retry loop**: A `while (attempts < MAX_ATTEMPTS)` loop (MAX_ATTEMPTS = 3) guards both steps:
```typescript
const { plugins: combined, accepted } = combineSelection(workflowSelected, languageSelected);
if (accepted) { selectedPlugins = combined; break; }
if (!shouldRetry(attempts, MAX_ATTEMPTS, accepted)) {
  p.cancel('Installation cancelled — no plugins selected.');
  process.exit(0);
}
p.log.warn('Select at least one plugin.');
```

Two exported pure functions power the loop:
- `combineSelection(workflowSelected, languageSelected)` → `{ plugins: string[], accepted: boolean }` — merges the two arrays; `accepted` is true iff the union is non-empty.
- `shouldRetry(attempt, maxAttempts, accepted)` → `boolean` — returns true iff the selection was empty AND the attempt ceiling has not been reached; returns false when accepted or exhausted (caller exits on false + !accepted).

Both functions are exported from `init.ts` for unit testing (same pattern as `parsePluginSelection`). Tests in `tests/init.test.ts` cover: accept-on-non-empty, empty-both-buckets, retry-exhaustion, and mid-loop iteration.

**WORKFLOW_ORDER is now exported from `plugins.ts`**:
```typescript
export const WORKFLOW_ORDER: string[] = [
  '/research', '/explore', '/plan', '/implement',
  '/code-review', '/resolve', '/self-review', '/bug-analysis',
  '/debug', '/release', '/audit-claude',
  '/dynamic-tickets', '/dynamic-plan', '/dynamic-build', '/dynamic-wave', '/dynamic-profile',
];
```
`init.ts` imports it from `plugins.ts` rather than keeping a local duplicate. A regression guard test in `tests/plugins.test.ts` verifies every entry has a real backing command in `DEVFLOW_PLUGINS` (bidirectional: WORKFLOW_ORDER ⊆ commands AND commands ⊆ WORKFLOW_ORDER for the non-excluded set). The 5 dynamic commands were added to WORKFLOW_ORDER in the same commit that landed the dynamic plugin — the regression guard catches future omissions.

**Agent Teams init flags removed (PR #240)**: The `--teams`/`--no-teams` init flags and `teamsEnabled` variable no longer exist. Users who want Agent Teams mode use `devflow flags --enable agent-teams` instead.

**Learning pipeline removed (PR #238)**: The `--learn`/`--no-learn` init flags, `learnEnabled` variable, and `features.learn` manifest field no longer exist. The self-learning step in the Advanced mode prompt was removed. Legacy hook scripts `eval-learning` and `eval-reinforce` are now in the init's legacy hook cleanup list alongside their removal from `dream-evaluate` sourcing.

**Excluded from plugin selection buckets**: `devflow-core-skills` (always installed), `devflow-ambient` (always installed), `devflow-audit-claude` (installable via `--plugin` only).

**Rules in init**: `rulesEnabled` defaults to `true`. In Recommended mode, applied silently (no prompt). In Advanced mode, an explicit `p.note()` explains the per-language token model, followed by `p.confirm()`. CLI flag `--rules`/`--no-rules` overrides in both modes. `buildRulesMap(pluginsToInstall)` is called with the user's selected plugins — rules from non-selected optional plugins are excluded. Rules directory is NOT wiped on init (only on `devflow rules --enable`); stale rules are cleaned up via `LEGACY_RULE_NAMES` loop.

## Component Interactions

**init → rules**: `rulesEnabled` flows through to `buildRulesMap(pluginsToInstall)` → `installViaFileCopy`. When disabled, post-install removes `~/.claude/rules/devflow/` entirely.

**uninstall → rules**: Full uninstall (`removeAllDevFlow`) includes `~/.claude/rules/devflow/` in its target list. Selective plugin uninstall (`computeAssetsToRemove`) computes which rules to remove using the same "retained by remaining plugins" logic as skills. `uninstall.ts` also calls `stripDevflowTeammateModeFromJson` to clean `teammateMode: "auto"` written by prior Devflow installs.

**list → rules**: `devflow list` shows `rules` in the Features line when `manifest.features.rules` is true.

**build → install**: Rules are not installed from `shared/rules/` directly at runtime — the installer reads from `plugins/{plugin}/rules/`, which is the build output. Always run `npm run build` after modifying `shared/rules/` before testing install. Similarly, dynamic recipe commands are not installable from `shared/recipes/` — always run `npm run build:recipes` (or `npm run build`) first; the installer reads from `plugins/devflow-dynamic/commands/`.

**plugins.ts → init.ts**: `partitionSelectablePlugins`, `WORKFLOW_ORDER`, `combineSelection`, `shouldRetry` are all exported from their respective modules and imported by `init.ts`. `combineSelection` and `shouldRetry` are in `init.ts` (not `plugins.ts`).

## Constraints

- Rules have no namespace prefix (unlike skills which install as `devflow:{name}/`). The directory `~/.claude/rules/devflow/` itself provides the namespace.
- Rules are plugin-scoped by design — no `buildFullRulesMap()` equivalent exists.
- `LEGACY_RULE_NAMES` in `plugins.ts` is currently empty. Add entries here when renaming or removing a rule.
- The `paths` frontmatter key must always be present. Core rules use `paths: []` (global); language rules use a glob array (file-type-scoped). Omitting the key may break rule loading.
- `buildRulesMap` throws if any rule name fails `isValidRuleName` — misconfigured `plugin.json` entries are caught at map-build time, not at path-construction time.
- `partitionSelectablePlugins` uses the presence of `commands.length > 0` as the sole criterion for the workflow bucket — command-less selectable plugins always land in the language bucket. `devflow-dynamic` has 5 commands and lands in the workflow bucket.

## Anti-Patterns

- **Adding a language rule to `devflow-core-skills`**: Core rules install for every user. Language-specific rules belong in their optional plugin.
- **Using `paths: []` on a language-specific rule**: Language rules must scope to their file types. Using `paths: []` makes them load on every prompt, eliminating per-language token savings.
- **Using a file-type path on a core rule**: Core rules (security, engineering, quality, reliability) must use `paths: []` — they apply cross-language.
- **Installing rules from `shared/rules/` directly at runtime**: The installer reads from `plugins/{plugin}/rules/` (build output). Skipping `npm run build` silently installs the old version.
- **Installing dynamic recipe commands from `shared/recipes/`**: Recipe `.mds` files are source-only; compiled `.md` command files live in `plugins/devflow-dynamic/commands/`. Always build before testing.
- **Unbounded plugin selection loop**: The bounded `while (attempts < MAX_ATTEMPTS)` + `shouldRetry` guard is the pattern — never replace with `while (true)`.
- **Long rule files**: Rules should be ~10-15 lines. If a rule grows beyond ~20 lines, extract the detail into a skill's `references/` directory.
- **Omitting `rules: []` on a plugin**: The `rules` field is required on `PluginDefinition`. Omitting it causes TypeScript errors at build time.
- **Adding a bespoke feature toggle to `manifest.features`**: Agent Teams was removed partly because it was a bespoke `teamsEnabled` field on the manifest. New optional toggleable Claude Code behaviours belong in `FLAG_REGISTRY` with `defaultEnabled: false`, not as custom manifest fields.

## Gotchas

- **Rules ARE wiped on full install but not on partial**: `installViaFileCopy` wipes `~/.claude/rules/devflow/` at the start of a full install. On a partial install (`devflow init --plugin=typescript`), the rules directory is NOT wiped. Use `devflow rules --enable` to get a clean reinstall — it always wipes first.
- **`devflow rules --enable` resolves plugin dirs from dist/`**: Computes the plugins directory relative to the compiled CLI file. Must build before running.
- **Shadow files are flat, not directories**: Skills shadow at `~/.devflow/skills/{name}/` (a directory). Rules shadow at `~/.devflow/rules/{name}.md` (a flat file).
- **Manifest defaults `rules: true` on read**: Old manifests without the `rules` field are read as `rules: true`. Upgrading users get rules enabled automatically.
- **`buildRulesMap` throws on invalid names**: Uppercase letters, dots, or slashes in a `plugin.json` rules entry cause an immediate throw — intentional early-catch.
- **`commands.md` has been removed**: The ambient-managed commands rule no longer exists. Any stale `~/.claude/rules/devflow/commands.md` from prior installs is purged automatically by `removeLegacyCommandsRule()` which runs unconditionally in both `addAmbientHook` and `removeAmbientHook`. `devflow rules --enable/--disable` never touched it and still does not.
- **Scope prompt removed**: Interactive TTY runs no longer ask for scope — user scope is the automatic default. The `--scope` flag still works (for `local` installs or scripted `user` overrides), and non-TTY still logs and defaults to `user`.
- **Two-step selection requires `partitionSelectablePlugins` for bucket assignment**: Do NOT sort or filter `DEVFLOW_PLUGINS` manually in init code. Always delegate to `partitionSelectablePlugins`. The workflow-bucket predicate is `commands.length > 0` — `devflow-dynamic` is in the workflow bucket. The language-bucket is every command-less selectable plugin.
- **`WORKFLOW_ORDER` regression guard is bidirectional**: `tests/plugins.test.ts` verifies WORKFLOW_ORDER entries correspond to real commands AND that commands not in the excluded set are covered. Adding a new workflow command requires updating WORKFLOW_ORDER or the test will fail. The 5 dynamic commands are already registered.
- **Rules have no runtime sentinel**: Unlike knowledge (`.devflow/features/.disabled`), decisions, and memory, rules have no `.disabled` file. Disabling rules is destructive: `devflow rules --disable` removes the directory entirely. There is no temporary suppression path.
- **`background-memory-update` is NOT in `LEGACY_HOOK_FILES`**: The worker is an active installed script — it must NOT be listed in the `LEGACY_HOOK_FILES` cleanup array in `init.ts`. It was accidentally listed there (fixed in `8c157db`), which caused `installViaFileCopy` to install it and the cleanup loop to immediately delete it, making memory refresh dead-on-arrival for installed users. If a future hook rename is needed, use `LEGACY_HOOK_FILES` only for truly retired scripts, never for scripts that are still installed and active.
- **Core vs language rules have different token behavior**: Core rules load on every prompt. Language rules only activate when Claude is working with a matching file type.
- **manifest.ts contains a `kb → knowledge` migration self-heal**: `readManifest` detects `features.kb` and migrates it to `features.knowledge` in-place. This is the only backward-compat code in `manifest.ts`; do not add more. For rules, `LEGACY_RULE_NAMES` is the correct pattern when renaming rule files.
- **`features.learn` no longer exists in ManifestData**: The learning pipeline was removed in PR #238. `manifest.features.learn`, `--learn`/`--no-learn` init flags, and `learnEnabled` in `init.ts` are all gone. Two migrations (`purge-learning-pipeline-v1` per-project, `purge-learning-global-v1` global) in `src/cli/utils/migrations.ts` sweep legacy learning artifacts on `devflow init`. `eval-learning` and `eval-reinforce` hook scripts are removed and in the legacy hook cleanup list.
- **`features.teams` no longer exists in ManifestData**: The agent-teams bespoke manifest field was removed in PR #240. Agent Teams is now a standard flag entry in `FLAG_REGISTRY` (`id: 'agent-teams'`, `defaultEnabled: false`). The env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is applied/stripped by the normal `applyFlags`/`stripFlags` machinery. Migration `purge-devflow-teammate-mode-global-v1` (global) and `purge-devflow-teammate-mode-v1` (per-project) clean up stale `teammateMode: "auto"` written by prior installs.
- **`*-teams.md` command files are orphaned, not re-installed**: The blanket sweep in `init.ts` (`f.endsWith('-teams.md')`) runs on every install type including partial installs. This is safe because no `*-teams.md` command file is ever installed by current Devflow. Old installs that had these files will have them cleaned up on the next `devflow init`.
- **`dream-memory` skill is no longer active**: `dream-memory` was removed from `devflow-core-skills` skills array in PR #239 (the `dream-memory` SKILL.md file was removed in PR #238; the skills array entry was removed in PR #239). Memory refresh is handled by `background-memory-update` (detached worker), not a Dream subagent. Both `dream-memory` and `devflow:dream-memory` are in `LEGACY_SKILLS_V2X` and are swept by `devflow init`. Migration `purge-stale-memory-markers-v1` (added in PR #239) sweeps `dream/memory.*` marker files from old installations.
- **`DreamConfig` tracks 4 features**: `{memory, decisions, knowledge, autoCommit}` — the `learning` key was removed in PR #238; `autoCommit` was added in PR #241 (default `true`; governs whether Dream tasks auto-commit maintenance writes). Do not add `learning` back or reference `features.learn`.
- **New migration `sync-devflow-gitignore-v2`**: Per-project migration added in PR #238 to re-sync `.devflow/.gitignore` to the ignore-by-default allowlist policy. Overwrites existing `.gitignore` if content differs from canonical template. ENOENT-safe (no-op if `.devflow/` does not exist).
- **New migration `sync-devflow-gitignore-v3`**: Per-project migration added in PR #241 to push the gitignore update that explicitly allows `decisions-ledger.jsonl` (the committed ledger). Without this, projects that had `.gitignore` from `sync-devflow-gitignore-v2` would not track the ledger file.
- **New migration `decisions-ledger-unify-v1`**: Per-project migration added in PR #241. Backfills `decisions-ledger.jsonl` from the existing `decisions.md`/`pitfalls.md` and `decisions-log.jsonl`. Preserves every existing body verbatim via `raw_body`, synthesizes rows whose source obs is missing, marks hand-deleted anchors `Retired` (numbers reserved). Idempotent + crash-safe (always reconciles `.md` from ledger after write). Located in `src/cli/utils/decisions-ledger-migration.ts`.
- **`devflow-dynamic` plugin is optional**: It installs only when the user selects it at `devflow init` (Step 1 — Workflow plugins) or passes `--plugin=dynamic`. It is not pre-selected. Its 5 recipe commands (`/dynamic-tickets`, `/dynamic-plan`, `/dynamic-build`, `/dynamic-wave`, `/dynamic-profile`) are compiled from `shared/recipes/*.mds` — not hand-authored `.md` files.
- **`COMMAND_REFS` in `tests/skill-references.test.ts` includes dynamic commands**: The test allowlist `COMMAND_REFS` contains `dynamic-tickets`, `dynamic-plan`, `dynamic-build`, `dynamic-profile`, `dynamic-wave`. When adding new recipe commands, add them to this set or the skill-references test will fail.

## Key Files

- `shared/rules/` — source of truth for all rule content; flat `.md` files (12 total)
- `shared/recipes/` — source of truth for dynamic plugin recipe commands; `.mds` files compiled at build time; partials prefixed with `_` are not compiled to commands
- `scripts/build-recipes.ts` — compiles `shared/recipes/*.mds` → `plugins/devflow-dynamic/commands/*.md`; hard-fails on any compile error; skips partials
- `src/cli/plugins.ts` — `DEVFLOW_PLUGINS` `rules` field, `buildRulesMap()`, `getAllRuleNames()`, `isValidRuleName()`, `LEGACY_RULE_NAMES`, `WORKFLOW_ORDER` (now includes 5 dynamic commands), `partitionSelectablePlugins()`; active Dream skills: `dream-decisions`, `dream-knowledge`, `dream-curation` (NOT `dream-memory`); `LEGACY_SKILLS_V2X` includes `dream-memory`, `devflow:dream-memory`, and `devflow:agent-teams` for cleanup; `devflow-dynamic` is optional, command-bearing, workflow bucket
- `src/cli/commands/init.ts` — `rulesEnabled` flag; two-step plugin selection with `partitionSelectablePlugins`; `combineSelection`, `shouldRetry` pure helpers (exported for tests); `WORKFLOW_ORDER` import; Recommended-mode silent apply vs Advanced-mode note+confirm; `buildRulesMap(pluginsToInstall)`; `LEGACY_RULE_NAMES` stale-file cleanup loop; blanket `*-teams.md` command sweep; no `--learn`/`--no-learn` or `learnEnabled` (removed PR #238); no `--teams`/`--no-teams` or `teamsEnabled` (removed PR #240)
- `src/cli/commands/rules.ts` — `devflow rules` command (enable/disable/status/list)
- `src/cli/commands/ambient.ts` — purges legacy `commands.md` via `COMMANDS_RULE_PATH` / `removeLegacyCommandsRule()`; called unconditionally from `addAmbientHook` and `removeAmbientHook` so stale files are cleaned up on every enable/disable/init
- `src/cli/utils/installer.ts` — `installRuleFile` (exported); `installViaFileCopy` rules section
- `src/cli/commands/uninstall.ts` — `computeAssetsToRemove` includes rules; `removeAllDevFlow` removes rules dir; `removeSelectedPlugins` removes per-rule files; calls `stripDevflowTeammateModeFromJson` to clean `teammateMode`
- `src/cli/utils/manifest.ts` — `ManifestData.features.rules` with `true` self-heal default; `features.learn` removed in PR #238; no `features.teams` (removed PR #240)
- `src/cli/utils/flags.ts` — `FLAG_REGISTRY` with 18 entries including `agent-teams` (defaultEnabled: false); `applyFlags`/`stripFlags`/`getDefaultFlags`; `applyViewMode`/`stripViewMode`
- `src/cli/utils/teammate-mode-cleanup.ts` — `stripDevflowTeammateModeFromJson` (pure, tolerant) and `stripDevflowTeammateMode` (file I/O wrapper); used by both migrations and uninstall
- `src/cli/utils/migrations.ts` — `purge-learning-pipeline-v1` (per-project) + `purge-learning-global-v1` (global) sweep legacy learning artifacts; `sync-devflow-gitignore-v2` re-syncs `.devflow/.gitignore` (PR #238); `sync-devflow-gitignore-v3` pushes gitignore change for decisions-ledger allowlist (PR #241); `purge-stale-memory-markers-v1` removes stale `dream/memory.*` markers; `purge-devflow-teammate-mode-global-v1` (global) + `purge-devflow-teammate-mode-v1` (per-project) remove `teammateMode: "auto"` from settings.json files; `decisions-ledger-unify-v1` (per-project) backfills `decisions-ledger.jsonl` from existing `.md` + log, preserving every body verbatim (`raw_body`), marking hand-deleted anchors `Retired`; applies ADR-002
- `scripts/build-plugins.ts` — build-time distribution from `shared/rules/` → `plugins/*/rules/`
- `tests/plugins.test.ts` — `partitionSelectablePlugins` (8 cases) + `WORKFLOW_ORDER` regression guard (4 cases, bidirectional) + `LEGACY_SKILL_NAMES consistency` guard; `allowedOptional` set includes `devflow-dynamic`
- `tests/init.test.ts` — `combineSelection` and `shouldRetry` unit tests
- `tests/skill-references.test.ts` — `COMMAND_REFS` set includes dynamic commands (`dynamic-tickets`, `dynamic-plan`, `dynamic-build`, `dynamic-profile`, `dynamic-wave`)
- `tests/teammate-mode-cleanup.test.ts` — `stripDevflowTeammateModeFromJson` and `stripDevflowTeammateMode` tests

## Related

- ADR-002: Migrations leave a clean house — learning-pipeline purge migrations and agent-teams cleanup migrations follow this pattern
- ADR-012: `.devflow` knowledge committed to git — governs feature knowledge storage; rules themselves install outside the repo to `~/.claude/rules/devflow/`
- Skills system (parallel architecture): `src/cli/utils/installer.ts` `installViaFileCopy` skills section is the model rules followed
- Feature flags: `src/cli/utils/flags.ts` — another toggleable feature using the same manifest.features pattern; now the home for `agent-teams` after bespoke pipeline removal
- Ambient simplification (c51114d): introduced `commands.md` rule + ambient-managed separation
- Init flow simplification (5143d73–154899b): two-step selection, `partitionSelectablePlugins`, `WORKFLOW_ORDER` export, `combineSelection`/`shouldRetry`
- PR #238 (learning removal): removed `dream-memory` SKILL.md file, removed `features.learn`, removed `--learn`/`--no-learn`, added `purge-learning-pipeline-v1` + `sync-devflow-gitignore-v2` migrations; note — `dream-memory` was removed from the `devflow-core-skills` skills ARRAY in PR #239 (not #238)
- PR #239 (eager memory refresh): removed `dream-memory` from `devflow-core-skills` skills array, added `background-memory-update` worker, added `purge-stale-memory-markers-v1` migration; `background-memory-update` is NOT in `LEGACY_HOOK_FILES` (fixed in `8c157db`)
- PR #240 (agent-teams removal): removed bespoke Agent Teams machinery; re-exposed as `agent-teams` flag in `FLAG_REGISTRY`; added `purge-devflow-teammate-mode-global-v1` + `purge-devflow-teammate-mode-v1` migrations; blanket `*-teams.md` sweep in `init.ts`; `devflow:agent-teams` skill in `LEGACY_SKILLS_V2X`
- PR #241 (decisions ledger + deterministic render): added `decisions-ledger.jsonl` as committed render source of truth; new `assign-anchor`/`retire-anchor`/`rotate-observations` ops in `json-helper.cjs`; `dream-commit` shell helper for attributable maintenance commits; `autoCommit: boolean` added to `DreamConfig`; `devflow decisions --status` now surfaces auto-commit state; `decisions-ledger-unify-v1` + `sync-devflow-gitignore-v3` per-project migrations added
- PR #242 (devflow-dynamic plugin): added `devflow-dynamic` optional plugin with 5 recipe commands compiled from `shared/recipes/*.mds` via `scripts/build-recipes.ts`; `WORKFLOW_ORDER` extended with 5 dynamic commands; `devflow-dynamic` added to `allowedOptional` in `tests/plugins.test.ts`; `COMMAND_REFS` in `tests/skill-references.test.ts` updated with dynamic command names
