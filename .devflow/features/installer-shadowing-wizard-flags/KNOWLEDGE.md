---
feature: installer-shadowing-wizard-flags
name: Wizard Steps, Flags CLI/TUI & Managed-shape Oracle
description: "Use when changing prompt-io, the compliance or attribution wizard step, the devflow flags CLI/TUI, convergeFlagsIntoSettings or the managed-shape oracle (settingHoldsManagedShape). Keywords: wizard, flags, TUI."
category: component-patterns
directories: [src/cli/commands/prompt-io.ts, src/cli/commands/compliance-prompts.ts, src/cli/commands/attribution-prompts.ts, src/cli/commands/flags.ts, src/cli/flags-view, src/cli/tui, src/core/flags.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Wizard Steps, Flags CLI/TUI & Managed-shape Oracle

## Rules

- **KB-AP-1** Never re-derive the display vocabulary at a render site: route through `effectiveDisplay` / `formatFlagValue` (`D-EFFDV`). Literal `unset` appears only where the user typed it (`--set flag=unset`).
- **KB-AP-2** Do not "restore symmetry" between the attribution and compliance gates: `shouldRunAttributionStep` is Advanced-only with no `modePromptShown` and no CLI override, by design.
- **KB-AP-3** The compliance gate keys on `modePromptShown`, never on the mode name, or `--recommended` and the non-TTY fallback lose their promptless contract.
- **KB-AP-4** Never add `attribution` to `templates/settings.json` or `mergeDevflowSettingsTemplate`: the flags pipeline is its only writer, and a second one races it.
- **KB-AP-5** Never hand-roll the managed-shape comparison (`isDeepStrictEqual` against the guard) at a call site: delegate to `settingValueHoldsManagedShape` / `settingHoldsManagedShape`.
- **KB-AP-6** Never define `PromptOutcome` or `WizardPromptIO` locally in a wizard module: import them from `prompt-io.ts`.
- **KB-AP-7** `convergeFlagsIntoSettings` never skips its post-strip key-order restore (`D-KEY-ORDER`): without it a second init moves flag keys behind a key merged after them and re-init stops being a no-op.
- **KB-AP-8** The adoption folds run on PRE-strip content: after `stripFlags` they are vacuous and an externally set `/focus` or a template-written attribution block is lost.
- **KB-AP-9** Never narrow `BooleanFlagDef` with a `target.type` check: `onPayload` stays a union. Use the exported `isEnvBooleanFlag(f)` where the string type matters.
- **KB-AP-10** Wizard step orchestrators never `throw` or `process.exit()`: they return `{kind:'resolved'...}` or `{kind:'cancelled'}` and callers own the cancel idiom.
- **KB-AP-11** `persistFlagConfig` never reports success with an absent manifest, and success is tracked in locals, never read back off the process-wide `process.exitCode`.
- **KB-AP-12** `--enable` / `--disable` are boolean-only: non-boolean flags use `--set`.
- **KB-AP-13** Do not expect `ENTER_ALT` sequences from the flags TUI: it runs inline (`screen: 'inline'`); only agents-view uses the default alt screen.
- **KB-INV-1** `settingDeleteGuard` protects deletion, not writes: `suppress-attribution` enabled always writes `{"commit":"","pr":""}`, overwriting a custom attribution; disabled deletes the key only when the value deep-equals the managed shape. Test-pinned.
- **KB-INV-2** `settingValueHoldsManagedShape` is the single equality oracle for managed-shape comparisons; `canDeleteSettingKey`, `resolveExistingAttributionSuppression` and the adoption fold all delegate to it.
- **KB-INV-3** The `attribution` settings key is owned exclusively by the flags pipeline (`applyFlags` / `stripFlags` via `convergeFlagsIntoSettings`); a registry-driven test asserts no setting-target key appears in the template.
- **KB-INV-4** `suppress-attribution` (like view-mode) is encoded into `FlagsRecord` BEFORE `convergeFlagsIntoSettings` runs (fold-before-strip).
- **KB-INV-5** Every wizard gate predicate is pure, fully wired, seeded and tested for both init paths.
- **KB-INV-6** `persistFlagConfig` evaluates the settings write and the manifest write independently; neither is skipped by the other's outcome.
- **KB-INV-7** `buildPayload` returns `structuredClone` for object payloads (`D-PAYLOAD-CLONE`): a `FLAG_REGISTRY` entry is never aliased into the caller's settings tree.
- **KB-INV-8** Flag `blurb` and `hint` length caps are enforced by registry-walk tests in `tests/flags.test.ts`, not by TypeScript types.

## Overview

Three CLI-layer concerns share this KB because they converge on the flags record: the wizard step modules (`compliance-prompts.ts`, `attribution-prompts.ts` over the shared `prompt-io.ts` seam), the `devflow flags` command and its inline TUI, and the pure registry pipeline in `src/core/flags.ts` that writes the record into `settings.json`. Core stays UI-agnostic: all I/O-free flag logic lives in `src/core/flags.ts`; the CLI modules own prompts, Commander wiring, settings I/O and manifest persistence, and the init-specific prompt modules (and `init-seed.ts`) live in `src/cli/commands/` rather than `src/core/` for that reason. The tracker wizard step has its own gate and prompt shape and is in the tracker-wiring KB; init-seed (the KB of that name) covers how the seed is computed.

## Shared Wizard Prompt-IO Seam (`prompt-io.ts`)

A one-definition seam owning the shared DI types and the real clack adapters:
- `PromptOutcome<T>` — `{ kind: 'value'; value: T } | { kind: 'cancel' }`.
- `WizardPromptIO` — the base injectable interface: `note(message, title): void` + `select(opts): Promise<PromptOutcome<boolean>>`.
- `clackNote` / `clackSelect<T>` — the real adapters; `clackSelect` narrows away the cancel branch with `p.isCancel` as a type guard, no `as T` cast.
- `AttributionPromptIO` is a type alias of `WizardPromptIO` (a named export kept for tests and callers importing it by name); `CompliancePromptIO` and `TrackerPromptIO` extend it with their own prompt.

A new wizard step builds on this module rather than redefining those types.

## Compliance Wizard Step (`compliance-prompts.ts`)

CLI-layer module owning all compliance wizard UI:
- `frameworkChoices()` (clack multiselect options from `COMPLIANCE_FRAMEWORKS`), `FRAMEWORK_SELECT_MESSAGE`, `formatFrameworkCatalogue()` (padded catalogue for the `p.note` body), `formatComplianceSummary(enabled, frameworks)` (pure; the canonical home for the compliance state label, re-exported by `init.ts` for backward-compatible test imports).
- `CompliancePromptIO` — `WizardPromptIO` plus `multiselect`; `buildClackCompliancePrompts()` builds the real adapter, translating the cancel symbol into the `PromptOutcome` union.
- `runComplianceStep(opts)` — pure orchestrator, all I/O through `opts.prompts`. Flow: note header → labeled enable select → framework multiselect (`required:false`). Disabling preserves frameworks (defensive copy; returned arrays never alias the seed). Returns `{kind:'resolved', state, messages}` or `{kind:'cancelled'}`.
- `shouldRunComplianceStep({mode, modePromptShown, isTTY, hasCliOverride})` — pure gate: `hasCliOverride` (`--compliance` / `--no-compliance`) → no; non-TTY → no; Advanced → yes; Recommended → only when `modePromptShown`, which is `true` only when the Setup-mode `p.select` actually ran (the `--recommended` flag and the non-TTY fallback never set it). BOTH wizard paths call it. Recommended threads the result via `applyCliToggles(…, { compliance: cliComplianceOverride ?? wizardCompliance })`.

## Attribution Wizard Step (`attribution-prompts.ts`, D27)

Parallel structure to the compliance module with a deliberately different gate:
- `shouldRunAttributionStep({mode, isTTY})` → `isTTY && mode === 'advanced'`. Safe without `modePromptShown` because the Advanced branch itself exits non-zero on non-TTY, so `mode === 'advanced'` only occurs interactively. There is no CLI override: post-install toggling is `devflow flags --enable/--disable suppress-attribution`. The question never runs on Recommended, which carries the seeded value unchanged.
- `buildClackAttributionPrompts()` delegates to the shared `clackNote` / `clackSelect`.
- `attributionSeedFrom(flags: FlagsRecord): boolean` → `true` only for `suppress-attribution === true` (not `as boolean`; undefined, null and false map to false), so `init.ts` passes a real boolean to `p.select`.
- `applyAttributionAnswer(flags, outcome): FlagsRecord` — immutable merge (a new record, never a mutation) and the single merge site; `init.ts` must not duplicate the spread.
- `runAttributionStep({seed, prompts})` — pure orchestrator. Its note names the destructive enable branch ("Yes REPLACES any existing `attribution` value in settings.json, including a custom one") and carries an org AI-disclosure-policy clause.
- **Call site in `init.ts`:** `mode: useRecommended ? 'recommended' : 'advanced'` (never a string literal); one call, in the Advanced path only, via `shouldRunAttributionStep`; `attributionSeedFrom(enabledFlags)` derives the seed and `applyAttributionAnswer(enabledFlags, outcome)` updates `enabledFlags`.

## Flags Pipeline and the Managed-shape Oracle (`src/core/flags.ts`)

- **Registry types:** `FLAG_REGISTRY` (a `ClaudeCodeFlag` per flag; `auto-compact-window` is an opt-in number flag, unset by default); `FlagDefCommon` carries `blurb` (short trailing-column phrase) and `hint`. `BooleanFlagDef = EnvBooleanFlagDef | SettingBooleanFlagDef` is a discriminated union that provides declaration-site guarantees only: `EnvBooleanFlagDef` compile-constrains `onPayload: string` and `settingDeleteGuard?: never`; `SettingBooleanFlagDef` allows an object `onPayload` and an optional `settingDeleteGuard: Record<string, unknown>`. A nested `target.type` check does NOT narrow `onPayload` for consumers, so `isEnvBooleanFlag(f): f is EnvBooleanFlagDef` (exported) is the narrowing predicate. `suppress-attribution` is a `SettingBooleanFlagDef` (target key `attribution`, `onPayload` and `settingDeleteGuard` both `{commit:'',pr:''}`).
- **Single equality oracle:** `settingValueHoldsManagedShape(flag, value)` is true iff the flag has a `settingDeleteGuard` and the value deep-equals it (`node:util.isDeepStrictEqual`); `settingHoldsManagedShape(settingsJson, flagId)` reads `settings.json` and delegates. `canDeleteSettingKey` (module-private, `D-ATTR-GUARD`) is shared by `applyFlags`' neutral branch and `stripFlags` and delegates to the oracle. `resolveExistingAttributionSuppression` (init-seed KB) and the Step 2b adoption fold delegate too.
- **`convergeFlagsIntoSettings(settingsJson, record, {viewModeExplicit, ownedRecord?})`** is the fold-before-strip pipeline; both `init.ts` and `persistFlagConfig` MUST call it instead of `stripFlags` + `applyFlags` directly, so the invariant lives in the pipeline. Steps: (1) fold view-mode via `resolveFinalViewMode`, so an externally set `/focus` survives unless `viewModeExplicit`; (2) fold existing settings values into the record for unclaimed valued (enum/number/string) flags — "claimed" is decided by `ownedRecord` (omitted → the record itself, the `persistFlagConfig` path; `null` → nothing owned, fresh install; the pre-seed manifest flags on the init path), and boolean flags are never folded at this step; (2b, `D-ATTR-ADOPT`) adopt guarded boolean settings whose pre-strip on-disk value matches the managed shape, only when the record does not already claim the flag (a claimed `false` or `null` still deletes the block), so a template-written attribution block is not stripped unconditionally on first init; (3) `stripFlags` then `applyFlags` over the folded record; (4) `orderKeysLike` restores the pre-strip key order, top-level and inside `env` (`D-KEY-ORDER`: strip-then-apply re-adds every managed key at the end, and the security deny list merged AFTER the flags appends `permissions`, so without the restore the second init reorders and re-init is no longer byte-for-byte stable). Uninstall calls `stripFlags` directly with no record, preserving its full-sweep semantics.
- **Registry adoption of an on-disk key:** the day a settings key that already ships on disk becomes registry-managed, it must be adopted before the strip pass; the presence of `settingDeleteGuard` is the signal and Step 2b the mechanism.
- **Ownership contract:** the guarded deletion is the prove-you-wrote-it contract (only remove a key whose value is the devflow-managed shape). Its corollary — a guard protects deletion, not overwrite — is why enable overwrites a custom attribution while disable preserves one.

## Flags CLI (`src/cli/commands/flags.ts`)

- **`createFlagsCommand()`** is the root Commander for `devflow flags` (a fresh instance per call; `flagsCommand` is the singleton `src/cli.ts` imports). Options: `--list`, `--status`, `--enable <ids>`, `--disable <ids>`, `--set <assignment>` (repeatable), `--unset <ids>`; bare invocation on a TTY launches the TUI, on non-TTY it prints the status table and exits 1. Flags resolve through `findFlag(id)` from core (unknown IDs error).
- **`readSettingsSafe`** returns `{ok, content}` / `{ok:false, reason}` and never silently falls back to `{}` on malformed JSON (that would clobber the user's settings); a root that is not a JSON object is rejected. ENOENT yields `{}`. `loadFlagContext` is the one shared load path for the mutating branches.
- **`persistFlagConfig(claudeDir, devflowDir, settingsContent, newRecord, manifest, {viewModeExplicit})`** runs `convergeFlagsIntoSettings`, writes `settings.json` (atomically) and `manifest.json` (`features.flags` = the FOLDED record, so adopted values persist and the two stay in sync) independently, and returns a discriminated `PersistResult`: `{ok:true}`, `{ok:false, failed:['settings'|'manifest'...]}`, or `{ok:false, reason:'no-manifest'}` — an absent manifest is a failure, not a no-op, because "Flags saved." with an unrecorded selection is reverted by the next init. Callers print success only on `ok === true`. `applyTuiResult(result, freshSettingsContent, manifest, claudeDir, devflowDir)` (exported) derives `viewModeExplicit` from whether the view-mode row changed and returns `'saved' | 'unchanged' | PersistResult failure`.
- **Display vocabulary (`D-EFFDV`, one definition, every surface via `effectiveDisplay`):** `--enable` / `--disable` confirmations call `formatFlagValue` (`true` → `on`, `false` → `off`); `--set` confirmations route active values through `formatFlagValue` and echo literal `unset` for a `null` input at the call site (the user typed that word); `formatStatusRows` (the non-TTY status table, sanitised with `sanitizeCell`) renders not-adopted rows as `not adopted — default: <effective text> applies on next devflow init` using `effectiveDisplay(flag, neutralValueOf(flag)).text`; `--list` prints `upstream default: N` for number flags with `upstreamDefault`, else the `defaultValue` string or `none` (never `unset`).

## Flags TUI (`src/cli/flags-view/`, `src/cli/tui/`)

An interactive editor launched exclusively by `devflow flags` bare on a TTY (D40: init applies flags non-interactively in every path). It runs in **inline mode**, rendering in place in the scroll buffer.
- **`flags-view/state.ts`** — the pure state machine. Exported: `buildFlagRows(record)` (rows from the live `FlagsRecord`; each `FlagRow` holds `id`, the `tui` value, `hint`, and `blurb` sourced from `flag.blurb` at build time, so there is no registry reach-back at render time), `collectFlagRecord(rows)` (the inverse, via `tuiToRecord` per row), `reduce(state, key) → {state, done, saved}`, `resizeViewport`, `BUFFER_MAX_LEN`. Private helpers: `buildStops`, `cycleForward` / `cycleBackward`, `enterEdit` / `commitEdit` / `insertChar` / `reduceEditMode` (inline text edit for enum and string flags), `adjustViewport`. `recordToTui` / `tuiToRecord` live in `core/flags.ts`: the TUI uses `null` as the "devflow default" stop and `tuiToRecord` maps it back to `neutralValueOf`.
- **`flags-view/render.ts`** — frame renderer. Column layout at the 80-col reference: PREFIX 2 (cursor mark), LABEL 27, DIRTY 2 (`● `), VALUE 16, BLURB 30 (dim trailing column, header `HINT`, omitted when `blurbW === 0`); VALUE + BLURB preserve the prior single-VALUE-column total, and all widths scale with terminal width (`Math.min(1, cols/80)`). `formatValue` delegates to `effectiveDisplay` for null/neutral values (`dim(...text)`, with ` (default)` appended for number flags); `true` → green `on`, `false` → yellow `off`; a non-boolean active value is `bold` when it deviates from the devflow default, else plain (`D-BLURB`).
- **`tui/cells.ts`** — shared ANSI-aware cell helpers: `sanitizeCell` (strips control characters; prevents terminal injection), `padToVisible`, `truncateVisible`.
- **`flags-view/terminal.ts`** — `runFlagsTui` passes `screen: 'inline'` to `runTui` (`D-INLINE`); the intent type is closed so a new `FlagsIntent` member is a compile error.
- **`tui/terminal.ts`** — the generic `runTui<S,A,C>` driver. `RunTuiSpec.screen?: 'alt' | 'inline'` defaults to `'alt'` (agents-view); inline mechanics: the first frame writes lines directly, later frames use `cursorUp(prevLineCount - 1) + \r`, rewrite and `ERASE_BELOW`; on exit it cursor-ups to the frame top and uses `ERASE_BELOW` + `SHOW_CURSOR`, erasing the widget so the caller's clack flow continues uninterrupted. `INLINE_MARGIN = 2` lines stay free below the widget so the shell prompt is never clobbered (height clamped to `stdout.rows - INLINE_MARGIN`). `cursorUp(n)` returns `ESC[nA` for `n > 0` and an empty string otherwise, so callers need no guard.

## Anti-Patterns

- **KB-AP-1** Four render sites (TUI `formatValue`, the `--enable` / `--disable` confirmation, the `--status` not-adopted message, `--list`'s `defaultLabel`) all route through `effectiveDisplay`; a fifth that hand-codes on/off or shows `unset` creates vocabulary drift.
- **KB-AP-2** The compliance gate runs on interactive Recommended (`modePromptShown: true`); the attribution gate never does. The divergence is design intent, documented in `attribution-prompts.ts`.
- **KB-AP-4** The template merge runs BEFORE the flags pipeline, so a template-written value would be immediately overwritten, or on the off path leave a stale block. Single ownership is enforced by omission from the template and the merge function and by a registry-driven test in `tests/post-install-merge.test.ts`.
- **KB-AP-5** `resolveExistingAttributionSuppression` and the Step 2b fold both use the oracle; a hand-rolled copy drifts.
- **KB-AP-7** Skipping the restore reintroduces the re-init non-idempotency (#388 AC-3).

## Gotchas

- **KB-INV-1** `settingDeleteGuard` is test-pinned asymmetric: with a custom attribution block (for example an org name) a flag-disable preserves it and a flag-enable overwrites it. The wizard note says so.
- **KB-AP-9** After `if (f.target.type === 'env')`, `f` is still `BooleanFlagDef` and `f.onPayload` remains `string | boolean | Record<string, unknown>`.
- **`--set flag=unset`** is parsed to `null` by `parseFlagValueInput`; the `handleSet` confirmation special-cases `null → 'unset'` so the user sees their own word. It is the only place `unset` still reaches user-facing output.
- **KB-AP-13** A flags TUI test expecting `ENTER_ALT` fails for `runFlagsTui` but passes for agents-view tests; use `screen: 'alt'` explicitly when testing alt-screen behaviour.
- **Selective uninstall never strips flags** (`runCleanupPhase` only), so flag state persists when individual plugins are removed (uninstall KB).
- **KB-INV-4 fold timing:** a record that already has `suppress-attribution: false` or `null` still deletes the block; the fold only claims unclaimed flags.
- **Test fixtures must match runtime shapes:** `tests/init-e2e-flags.test.ts` drives subprocess e2e tests over the real init settings pass.

## Key Files

- `src/core/flags.ts` — `FLAG_REGISTRY`, `FlagDefCommon` (`blurb`, `hint`), `BooleanFlagDef` / `EnvBooleanFlagDef` / `SettingBooleanFlagDef`, `isEnvBooleanFlag`, `settingValueHoldsManagedShape`, `settingHoldsManagedShape`, `canDeleteSettingKey` (private), `buildPayload` (`structuredClone`), `convergeFlagsIntoSettings` + `orderKeysLike`, `applyFlags`, `stripFlags`, `FlagsRecord` / `FlagsRecordValue`, `effectiveDisplay`, `formatFlagValue`, `getDefaultFlagsRecord`, `sanitizeFlagsRecord`, `migrateLegacyFlagsToRecord`, `coerceFlagValue`, `parseFlagValueInput`, `neutralValueOf`, `isNeutral`, `countActiveFlags`, `findFlag`, `recordToTui` / `tuiToRecord`, `readViewMode`, `resolveExistingViewMode`, `resolveFinalViewMode`
- `src/cli/commands/flags.ts` — `createFlagsCommand`, `flagsCommand`, `applyTuiResult`, `PersistResult`; private `readSettingsSafe`, `loadFlagContext`, `persistFlagConfig`, `formatStatusRows`, `handleList` / `handleStatus` / `handleSetBooleans` / `handleSet` / `handleUnset` / `handleBare`
- `src/cli/commands/prompt-io.ts` — `PromptOutcome`, `WizardPromptIO`, `clackNote`, `clackSelect`
- `src/cli/commands/compliance-prompts.ts` — `shouldRunComplianceStep`, `runComplianceStep`, `CompliancePromptIO`, `buildClackCompliancePrompts`, `formatComplianceSummary`, `frameworkChoices`, `FRAMEWORK_SELECT_MESSAGE`, `formatFrameworkCatalogue`
- `src/cli/commands/attribution-prompts.ts` — `shouldRunAttributionStep`, `AttributionPromptIO`, `buildClackAttributionPrompts`, `attributionSeedFrom`, `applyAttributionAnswer`, `runAttributionStep`
- `src/cli/flags-view/{state,render,terminal,index}.ts` (`FlagsViewState`, `FlagRow`, `FlagsIntent`, `FlagsTuiResult`, `runFlagsTui`) and `src/cli/tui/{terminal,cells}.ts` (`runTui`, `RunTuiSpec`, `INLINE_MARGIN`, `cursorUp`, `sanitizeCell`, `padToVisible`, `truncateVisible`) — the TUI as above
- `tests/flags.test.ts` (blurb ≤ 30 and hint ≤ 76 registry walks), `tests/post-install-merge.test.ts` (single ownership), `tests/init-e2e-flags.test.ts` (subprocess init settings pass), `tests/flags-view-render.test.ts` (render)

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub
- `.devflow/features/installer-shadowing-init-seed/KNOWLEDGE.md` — seeding that encodes view-mode and suppress-attribution into the record and calls these gates
- `.devflow/features/installer-shadowing-tracker-wiring/KNOWLEDGE.md` — the third wizard gate, copying the compliance table
- `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md` — `stripFlags` with shape-guarded deletion on full uninstall
- `.devflow/features/compliance-feature/KNOWLEDGE.md` — what the compliance step selects and installs
- `.devflow/features/external-model-routing/KNOWLEDGE.md` — agents-view TUI (alt screen) and proxy
