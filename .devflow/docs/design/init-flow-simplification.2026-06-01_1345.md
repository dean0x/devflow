---
type: design-artifact
version: 1
status: APPROVED
issue: null
title: "Init flow simplification: user-scope-only, bug-analysis listing, two-step plugin selection"
slug: init-flow-simplification
created: 2026-06-01T13:45:00Z
execution-strategy: SINGLE_CODER
context-risk: LOW
---

# Init Flow Simplification

## 1. Problem Statement

Three rough edges in `devflow init` (`src/cli/commands/init.ts`):

1. **Scope prompt is unwanted.** Init interactively asks whether to install on user
   scope (`~/.claude/`) or local/project scope (`./.claude/`). Going forward, interactive
   init should always install on user scope — no project-scope prompt.
2. **`/bug-analysis` is missing from the end-of-init command list.** When the
   bug-analysis feature shipped, its command was never added to the `WORKFLOW_ORDER`
   list printed at the end of init, so users never see it advertised.
3. **Plugin selection mixes two kinds of plugins in one list.** The single plugin
   multiselect mixes workflow/command plugins (`plan`, `implement`, `code-review`, …)
   with language/ecosystem plugins (`typescript`, `react`, `go`, …). Splitting this into
   two sequential steps is clearer.

**Target users:** Anyone running `devflow init` interactively (first-time install and re-init).

## 2. Acceptance Criteria

- AC1: Interactive `devflow init` no longer shows the "Installation scope" prompt and
  always installs on user scope.
- AC2: The `--scope` CLI flag and non-TTY auto-detection (both already → `user` by
  default) continue to work unchanged; `--scope local` still functions for scripted use.
- AC3: The end-of-init "Available commands" note includes `/bug-analysis` (when the
  bug-analysis plugin is installed).
- AC4: A regression test fails if any selectable command-bearing plugin's command is
  absent from `WORKFLOW_ORDER`.
- AC5: Interactive plugin selection is presented as two sequential multiselects:
  Step 1 = workflow/command plugins, Step 2 = language/ecosystem plugins.
- AC6: Both steps are optional individually, but the combined selection must be non-empty;
  if empty, the user is re-prompted (bounded) rather than silently installing nothing.
  This permits a language-only interactive install (zero workflow plugins).
- AC7: The `--plugin=<list>` non-interactive path is unchanged (single combined parse).
- AC8: `partitionSelectablePlugins` correctly buckets plugins and applies the existing
  exclusions (`devflow-core-skills`, `devflow-ambient`, `devflow-audit-claude`).
- AC9: `npm run build` and `npm test` pass.

## 3. Scope

**v1 (included):**
- Remove interactive scope prompt; hardcode interactive scope to `user`.
- Add `/bug-analysis` to `WORKFLOW_ORDER`; extract `WORKFLOW_ORDER` to `plugins.ts`.
- Split plugin multiselect into two steps with combined non-empty validation.
- Pure helper `partitionSelectablePlugins`; short hints for `explore`/`research`/`release`/`bug-analysis`.
- Two new unit tests (partition + WORKFLOW_ORDER coverage).

**Deferred (explicitly later):**
- Deeper scope removal — stripping the `local` branch from `uninstall.ts` and `paths.ts`,
  removing the `--scope` flag entirely. (User: "later, we will go into a deeper removal.")

**Excluded:**
- Custom 2-column grid multiselect rendering (rejected — `@clack` multiselect is
  single-column and shows the description only for the focused row; a grid would require
  a custom prompt component, not worth it).
- Any change to universal skill installation (skills remain installed from all plugins).

## 4. Gap Analysis Results

- **Language-only interactive install (resolved):** Requiring ≥1 workflow plugin would
  block installing only language plugins. Resolution (AC6): both steps optional + combined
  non-empty validation with a bounded re-prompt. Skills install universally regardless, and
  language plugins still contribute plugin-scoped rules, so a language-only install is meaningful.
- **`WORKFLOW_ORDER` was local to the init function (root cause of the `/bug-analysis`
  omission):** No test could see it. Resolution: extract to an exported const + coverage test (AC4).
- **`required: true` cancel semantics:** The removed scope `p.select` had `isCancel`
  handling; each new multiselect must keep its own `isCancel` handling.
- **Reliability:** The re-prompt loop must have a fixed upper bound (project reliability
  rule — no unbounded loops). Bound = 3 attempts, then graceful cancel.

## 5. Execution Strategy

**SINGLE_CODER.** One file is the primary surface (`init.ts`); `plugins.ts` gains two
small pure exports; `tests/plugins.test.ts` gains two tests. Changes are interdependent
and small — no benefit to parallel or sequential coders.

## 6. Implementation Plan

### Step 1 — `plugins.ts`: extract `WORKFLOW_ORDER` + add `partitionSelectablePlugins`
- Export `WORKFLOW_ORDER` (the ordered command list) from `plugins.ts`, inserting
  `'/bug-analysis'` after `'/self-review'`:
  `['/research','/explore','/plan','/implement','/code-review','/resolve','/self-review','/bug-analysis','/debug','/release','/audit-claude']`
- Add pure helper:
  ```ts
  export function partitionSelectablePlugins(plugins: PluginDefinition[]): {
    workflow: PluginDefinition[];
    language: PluginDefinition[];
  }
  ```
  - Exclude `devflow-core-skills`, `devflow-ambient`, `devflow-audit-claude` (current init exclusions).
  - `workflow` = remaining with `commands.length > 0`; `language` = remaining with `commands.length === 0`.

### Step 2 — `init.ts`: remove the interactive scope prompt
- File: `src/cli/commands/init.ts` ~200-213.
- Delete the trailing `else { … p.select('Installation scope') … }` block and its
  `isCancel` handling. `scope` stays `'user'` by default (line 184); `options.scope`
  (189-195) and `!process.stdin.isTTY` (196-198) branches are untouched.

### Step 3 — `init.ts`: two-step plugin selection (interactive branch ~296-339)
- Import `partitionSelectablePlugins` from `plugins.ts`.
- Build `{ workflow, language }`. For each, map to `{ value, label: name.replace('devflow-',''), hint }`
  using the existing `pluginHints` map (extended with `explore`, `research`, `release`, `bug-analysis`).
- `preSelected` for Step 1 = non-optional workflow plugins (current logic). Step 2 preselect = none.
- Bounded selection loop (max 3 attempts):
  - `p.multiselect({ message: 'Step 1 — Workflow plugins', options: workflowChoices, initialValues: preSelected, required: false })`
  - `p.multiselect({ message: 'Step 2 — Language plugins', options: languageChoices, required: false })`
  - Handle `isCancel` on each (cancel → exit 0, as today).
  - Merge into `selectedPlugins`. If non-empty → break. If empty → `p.log.warn('Select at least one plugin.')` and retry.
  - After 3 empty attempts → `p.cancel('Installation cancelled — no plugins selected.')`, exit 0.
- `--plugin` path (287-295) unchanged.

### Step 4 — `init.ts`: use exported `WORKFLOW_ORDER`
- Replace the local `WORKFLOW_ORDER` const (~1222) with the import from `plugins.ts`.
  Existing filtering/printing logic (1227-1234) is unchanged.

### Step 5 — Tests (`tests/plugins.test.ts`)
- `partitionSelectablePlugins`: workflow bucket contains command plugins (e.g. `devflow-plan`,
  `devflow-bug-analysis`); language bucket contains `devflow-typescript` etc.; excluded plugins
  appear in neither bucket.
- `WORKFLOW_ORDER` coverage: for every selectable command-bearing plugin (workflow bucket),
  each of its `commands` is present in `WORKFLOW_ORDER`. (This test would have caught the
  original `/bug-analysis` omission.)

## 7. Patterns to Follow

- Pure, exported helpers in `plugins.ts` mirroring `buildAssetMaps` / `buildFullSkillsMap`
  (`src/cli/plugins.ts:604-640`) — keep detection/partition logic pure and unit-tested.
- `@clack/prompts` multiselect usage as in current `init.ts:327` (`message`, `options`,
  `initialValues`, `required`, `isCancel` guard).
- Test style: `tests/plugins.test.ts` `describe`/`it` over `DEVFLOW_PLUGINS` and pure helpers.

## 8. Integration Points

- `src/cli/commands/init.ts` — interactive scope branch (~184-214), interactive plugin
  selection (~296-339), end-of-init command note (~1222-1234).
- `src/cli/plugins.ts` — new `WORKFLOW_ORDER` export + `partitionSelectablePlugins`.
- `tests/plugins.test.ts` — two new tests.
- Unchanged but verified: `--scope` flag (init.ts:145/189), non-TTY branch (196),
  `parsePluginSelection` (`--plugin` path), `manifest.scope` persistence, `uninstall.ts`.

## 9. Design Review Results

- **No over-engineering:** No custom prompt component; reuse stock `@clack` multiselect.
- **No hidden no-op:** Label-padding alignment was rejected because `@clack` shows the
  description only for the focused row — padding would have no visible effect.
- **Bounded loop:** Re-prompt loop has a fixed cap (3) per the reliability rule.
- **Root-cause fix:** `/bug-analysis` omission is fixed *and* guarded by a coverage test,
  not just patched once.

## 10. Risk Assessment

**Context risk: LOW.**
- Interactive-only UI changes; `--plugin` and `--scope` non-interactive paths untouched.
- Behavior change: interactive init can no longer choose local scope (intended). `--scope local` remains.
- Behavior change: plugin selection is two prompts instead of one (intended).
- Unresolved risks: none. Deferred work (deep scope removal) is tracked in Scope §3.

## 11. PR Description Guidance

### Problem Being Solved
Three init-flow rough edges: an unwanted user/local scope prompt, a missing `/bug-analysis`
entry in the post-install command list, and a single plugin list that conflated workflow and
language plugins.

### Key Changes to Highlight
- Interactive init always installs on user scope (scope prompt removed; `--scope` flag kept).
- `/bug-analysis` now appears in the "Available commands" note, guarded by a coverage test.
- Plugin selection split into two steps: workflow plugins, then language plugins.
- New pure helper `partitionSelectablePlugins` + exported `WORKFLOW_ORDER`, both unit-tested.

### Breaking Changes
None for scripted use (`--plugin`, `--scope` unchanged). Interactive scope choice is
removed by design; deep local-scope removal is deferred.

### Reviewer Focus Areas
- The bounded re-prompt loop and combined non-empty validation (language-only path).
- `isCancel` handling on both new multiselects.
- Correct exclusions in `partitionSelectablePlugins`.
