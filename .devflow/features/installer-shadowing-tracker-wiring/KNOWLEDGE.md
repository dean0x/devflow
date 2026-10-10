---
feature: installer-shadowing-tracker-wiring
name: Tracker Selection Wiring in Init & CLI
description: "Use when changing the tracker wizard step, devflow tracker (--set/--status), the Tracker agent install, the manifest tracker group or init's tracker convergence. Keywords: tracker, provider, sentinel."
category: component-patterns
directories: [src/core/tracker.ts, src/cli/commands/tracker-prompts.ts, src/cli/commands/tracker.ts, src/targets/claude-code/tracker-install.ts, src/core/feature-config.ts, src/core/manifest.ts, src/cli/commands/init.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Tracker Selection Wiring in Init & CLI

## Rules

- **KB-AP-1** Never add `features.tracker` to `readManifest`'s hard-null validation set: every pre-tracker manifest, i.e. every existing install, would read as "no prior install" and lose the user's other seeded state on the next re-init. It self-heals via `normalizeTrackerFeature`.
- **KB-AP-2** `devflow tracker --set` writes exactly three things in order (manifest, re-armed attempt counters, sentinel) and nothing else: no `devflow:git` probe, no overlay, no agent convergence, no conventions rename (`D-TRACKER-CONVERGE-SET`).
- **KB-AP-3** Never converge tracker artifacts when the manifest write failed: an unpersisted selection converges none of them, so the next `devflow init` retries the whole transition from an unchanged start.
- **KB-AP-4** `--status` is not a pure read: it re-arms every provider's attempt counters (decision D-F) and reports that write as the `Inference:` line, because a capped user reaches for it to learn why nothing is learned.
- **KB-AP-5** The sentinel converges in BOTH directions (`applyTrackerSentinel`): provider name for jira/linear, removed for github, in the same call shape; "enable wrote it, disable forgot it" must not exist.
- **KB-AP-6** Never wire the tracker gate on Recommended only: re-init is Advanced-only by construction, so it would be dead on every re-init. Both paths call `shouldRunTrackerStep` with the same shape.
- **KB-AP-7** The usage note never names a `--no-tracker` that does not exist: github is the default, and `devflow tracker --set github` returns to it.
- **KB-AP-8** `--set` never touches a repository's `.devflow/project.json` selection, which still outranks the machine default in that repository.
- **KB-AP-9** `readTrackerMechanics` never collapses "no files" and "could not look": `MISSING` and `unreadable (<errno>)` have different remedies, and only `ENOENT` on one entry counts as zero.
- **KB-AP-10** The generic agent copy loop skips `TRACKER_AGENT_NAME`; `convergeTrackerArtifacts` alone installs the Tracker agent. It stays declared in `devflow-core-skills.agents` so the registry-keyed agent sweep never treats it as an orphan.
- **KB-AP-11** `TrackerPromptIO` adds a sibling `selectProvider` rather than widening the shared boolean `select`, which would change the seam for every wizard step.
- **KB-AP-12** `src/core/tracker.ts`'s character-class regex stays written with `\x00`-style escapes, never literal control bytes: a raw NUL made repo-wide `grep` guards skip the file as binary while passing green.
- **KB-INV-1** The Tracker agent file installs on EVERY machine whatever its provider (`D-INSTALL-ALL-PROVIDERS`), byte-compared (`installed` vs `unchanged`), self-healing, and `convergeTrackerArtifacts` never throws.
- **KB-INV-2** Init's order: write the manifest, then — only if it landed — converge the agent, then re-arm counters and apply the sentinel in parallel (disjoint files); every step warns rather than aborts.
- **KB-INV-3** The manifest's `tracker` value is always a validated `TrackerProvider`: from `parseTrackerId` at the `--tracker` boundary, the typed wizard select, or the seed.
- **KB-INV-4** Both subcommands re-arm EVERY provider's attempt counters, not only the machine's; a failed re-arm warns and never aborts the report.
- **KB-INV-5** The manifest holds only the MACHINE default; the repository layers (`project.json`, personal override) are folded by `resolve-settings.cjs`, and the agent reads none of the files itself.
- **KB-INV-6** The `--status` `Effective:` line appears ONLY when a repository layer selects the tracker; `Mechanics:` counts what is present against the full installed reference manifest, so it reads the same on every provider.

## Overview

The tracker (a built-in provider selection over `github | jira | linear`, not a plugin) reaches the installer through four seams: the manifest's `features.tracker` group, the wizard step in `tracker-prompts.ts`, the `devflow tracker` command, and the Tracker agent file converged at install. The provider-selection story — which provider applies where, how conventions are inferred, the Tracker agent protocol and the reader-side preamble — is owned by the `tracker-feature` KB; the generated reference tree by the `tracker-references` KB and the overlay KB. This KB owns the mechanics of getting a selection INTO the manifest and config and the agent onto disk. The pure/I-O split follows the core/adapter boundary (`D-TRACKER-PAIR`): domain in `src/core/tracker.ts`, CLI shell in `src/cli/commands/tracker.ts`.

## Manifest Group and Per-repo Override

`ManifestData.features.tracker: TrackerFeatureState` (`{ provider }`, enum `github|jira|linear`) is a manifest-group feature like `ambient` / `hud` / `rules` / `proxy` / `compliance` / `memory` / `learning` / `knowledge`: machine-wide, sourced from `~/.devflow/manifest.json` (the narrow-only repository switches for memory/learning/knowledge are in the init-seed KB). Tracker's distinction is orthogonal to the gate: the manifest holds only the MACHINE default, a repository may select its own tracker in its committed `.devflow/project.json` (`tracker: {provider, site, key}`) and a hand-written personal `tracker` override in `.devflow/config.json` (`TrackerConfigOverride`) can narrow it; `resolve-settings.cjs` folds all three into the settings line the Git agent consumes. Memory/learning/knowledge have no such selection; their old per-repo keys are retired outright (`RETIRED_CONFIG_KEYS`), not merely superseded.

`readManifest` self-heals an absent or malformed tracker value to `{provider:'github'}` via `normalizeTrackerFeature` and deliberately excludes `features.tracker` from its hard-null validation set (KB-AP-1). `TrackerConfigOverride` (`feature-config.ts`) is the three-state per-repo resolution (`absent | valid | invalid`) the Git agent's preamble reads first; `parseTrackerOverride` delegates membership to `parseTrackerId`, the one authority on a provider token, and carries an invalid raw value through for the `unknown tracker provider` DEGRADED reason. `FeatureConfig` keeps the override as `tracker?: unknown`, never written by Devflow (`ManagedConfig = Omit<FeatureConfig, 'tracker'>`).

## Tracker Wizard Step (`tracker-prompts.ts`)

Parallel to the compliance and attribution modules with its own gate and a provider SELECT instead of a boolean:
- `shouldRunTrackerStep({mode, modePromptShown, isTTY, hasCliOverride})` — pure gate in a fixed order: `--tracker` wins on both paths, non-TTY is never asked, Advanced always runs it, Recommended runs it only when the Setup-mode `p.select` actually ran (`modePromptShown`) — the exact table `shouldRunComplianceStep` uses, so `--recommended` and the non-TTY fallback keep their promptless contracts. The full gate-order rationale and test matrix are in the `tracker-feature` KB.
- `TrackerPromptIO` — `WizardPromptIO` plus `selectProvider` (the step is a three-way choice, not an on/off toggle; the inherited boolean `select` is unused but kept so the seam stays substitutable). `buildClackTrackerPrompts()` is the real adapter; `providerChoices()`, `formatProviderCatalogue()`, `TRACKER_SELECT_MESSAGE` feed it.
- `runTrackerStep({seed, prompts})` — pure orchestrator (no `throw` / `process.exit()` / direct I/O) returning `{kind:'resolved', state, messages}` or `{kind:'cancelled'}`. `formatTrackerSummary(provider)` is the pure formatter for the Recommended summary row.
- **Call sites in `init.ts`:** both the Recommended and the Advanced path call `shouldRunTrackerStep` with the same shape compliance uses (`mode`, `modePromptShown`, `isTTY: process.stdin.isTTY`, `hasCliOverride: cliTrackerOverride !== undefined`), so the paths cannot drift onto different gates. Recommended's outcome surfaces only through the `Tracker: {summary}` row — the step emits no per-step messages there, matching compliance. Advanced has no end-of-wizard recap, so its `trackerStep.messages` are the step's only surface and are emitted unconditionally. Precedence at the merge point is `cliTrackerOverride ?? wizardTracker ?? seed.features.tracker`; `applyCliToggles` supplies the seed arm as it does for `compliance`.

## `devflow tracker` CLI (`src/cli/commands/tracker.ts`)

Mirrors `devflow compliance` (`D-TRACKER-PAIR`): the action handles `--status` and `--set <id>` directly (`--status` wins when both are passed); bare invocation with neither flag prints usage and returns 0 (not an error path). `--set`'s input is validated through `parseTrackerId` before any I/O (parse at the boundary); an invalid id logs and `process.exit(1)`s.

**Both subcommands re-arm the inference attempt counters** (decision D-F; every provider's `.tracker.{provider}.attempts`, up to `TRACKER_ATTEMPTS_MAX`) — `--status` after gathering its report, `--set` after the manifest write — because an inspection command is what a capped user reaches for, and if it changed nothing the only escape from the cap would be deleting an undocumented dotfile by hand. Every step warns rather than aborts. The `// ── Set ─` separator comment is a test anchor: `tests/tracker-cli.test.ts` splits the source on it to scope assertions to the `--set` branch. `--status`'s describe drives the CLI as a real subprocess against a seeded temp `HOME` (`requireBuiltCli()` from `tests/helpers.ts`) to prove the counter is actually gone, not just that the pure resolver says so.

**`--set`** is `runTrackerSet({devflowDir, current, requested, io})` over a `TrackerSetIO` seam (`syncManifest`, `rearmInference`, `applySentinel`; `buildTrackerSetIO()` is the real one), returning `TrackerSetOutcome = { exitCode, provider, messages }` — the messages it returns are the ones the command prints (`D-TRACKER-CONVERGE-SET`). The order is the invariant: manifest (the machine default) → re-armed counters → sentinel (the provider's name, or removed for github). Every install already carries every provider's mechanics and the Tracker agent (`D-INSTALL-ALL-PROVIDERS`), and each provider keeps its own conventions file (`D-TRACKER-PER-PROVIDER-CONVENTIONS`), so there is nothing else to converge. The sentinel follows the manifest because it ADVERTISES the value the manifest records.

**`--status`** prints through the pure `formatTrackerStatus`: `Provider:` (the machine default), an `Effective:   {provider} ({source})` line ONLY when a repository layer (project.json or the personal override) selects the tracker — `repoTrackerSelection` over the resolver from the cwd, null for a machine/default decision or a failed resolver — then `Conventions:` and `File:` for the EFFECTIVE provider's `~/.devflow/tracker/{provider}.md` (github prints `none (GitHub needs no learned conventions)`), `Mechanics:` and `Inference:`. It also warns when `personalConfigTrackedWarning` finds a git-tracked personal config. `readTrackerMechanics(claudeDir)` → `TrackerMechanicsState`, rendered by `formatTrackerMechanics`, counts what is PRESENT against the full `installedReferenceManifest()`, so it reads `installed (N file(s))` on every provider, GitHub included. Three outcomes: `installed (N file(s))`, `MISSING — run devflow init`, `unreadable (<errno>)`; `ENOENT` on one entry is a count of zero for that entry and any other errno is a failure to look. `TrackerCliActionMessage.level` is `'info' | 'success' | 'warn' | 'error'`.

## Tracker Agent Install (`tracker-install.ts`)

`convergeTrackerArtifacts({claudeDir, warn, agentSourceDirs?})` owns one artifact: `~/.claude/agents/devflow/tracker.md`, installed on EVERY machine (`D-INSTALL-ALL-PROVIDERS`: a repository's `project.json` can select jira on a github machine, so the agent the session-start directive names must be spawnable everywhere; it is inert until that directive fires, which happens only for a provider with no learned conventions). It copies from the first existing of `agentSourceDirs()` unless the installed file is already byte-identical, returning `{ converged, agent: 'installed' | 'unchanged' }` — `unchanged` keeps a steady-state re-init quiet, and a truncated or hand-edited file differs, so it self-heals. A non-absolute `claudeDir` is refused through the result, not thrown. The reference tree is NOT here: it converges through the installer's one overlay call.

**Declared but skipped:** the Tracker agent stays in `devflow-core-skills.agents` but the generic agent copy loop skips it. `TRACKER_AGENT_NAME` (exported from `tracker-install.ts`, the one authority on the name) is what that loop skips and what the full-install pre-clean keeps around; being declared keeps the registry-keyed agent sweep from treating it as an orphan and keeps the agent-roster floor true without a `FEATURE_OWNED_AGENTS` set.

**Init's counterpart** — `persistManifestThenConvergeTracker({devflowDir, claudeDir, manifestData, io})` (`D-TRACKER-CONVERGE`, over `TrackerLifecycleIO`): write the manifest, then — only if it landed — `convergeArtifacts` (the agent), then `rearmInference` and `applySentinel` in parallel (disjoint files, `D-TRACKER-PARALLEL`); the `ManifestTrackerOutcome` carries `manifestWritten`, `converged`, `agent: TrackerAgentState` and the messages, and the summary line comes from `formatTrackerAssetSummary`. A failed manifest write returns before touching any artifact and warns that the selection was not persisted. `drainDisabledFeatureQueues` runs only after `manifestWritten: true` (init-seed KB). The sentinel's write scope matters: a toggle can converge every artifact it writes and still miss the gate that decides if it writes a narrower scope (one repo's `config.json`) than every reader shares (the manifest) — the same write-scope vs read-scope lesson that fixed the memory/learning/knowledge switches.

## Core Tracker Module (`src/core/tracker.ts`)

The domain leaf module this KB's call sites consume: `TrackerProvider`, `TrackerFeatureState`, `TRACKER_PROVIDERS` / `TRACKER_PROVIDER_IDS` / `DEFAULT_TRACKER_PROVIDER`, `parseTrackerId` (strict boundary parse), `normalizeTrackerFeature` (tolerant manifest self-heal), the artifact basenames uninstall imports (`TRACKER_CONVENTIONS_DIR`, `TRACKER_LEGACY_CONVENTIONS_FILE`, `TRACKER_LEGACY_ATTEMPTS_FILE`, `TRACKER_ATTEMPTS_NAMES`, `TRACKER_ENABLED_FILE`, `TRACKER_CLAIM_FILE`, `TRACKER_STAGED_PREFIX`), the two lifecycle owners `rearmTrackerInference` / `applyTrackerSentinel` that `init.ts` and the CLI each call exactly once, and `migrateLegacyTrackerConventions` (called only by the `tracker-conventions-per-provider-v1` migration; init-seed KB). Deep domain rules (the write-once agent protocol, settings-line resolution, byte budget) live in the `tracker-feature` KB.

## Anti-Patterns

- **KB-AP-1** The hard-null set makes any manifest lacking the field read as "no prior install".
- **KB-AP-2** The "do nothing else" rule is the point: a `--set` that probed `devflow:git`, overlaid references or renamed conventions would duplicate work every install already carries.
- **KB-AP-4** An inspection command that changed nothing would leave the only escape from the attempt cap a hand deletion; a machine-state change the output does not mention cannot be audited, hence the `Inference:` line.
- **KB-AP-6** The tracker gate copies the compliance table exactly (Advanced always, Recommended only when `modePromptShown`), while the attribution gate diverges deliberately (wizard-flags KB).

## Gotchas

- **KB-AP-12** A raw control byte makes the `Binary file matches` skip invisible; `tests/guards/no-control-bytes.test.ts` (scoped to all of `src/**`) is the permanent detector.
- **KB-INV-3** Wizard output, `--tracker <id>` and the seeded value all end as a validated provider before the manifest write.
- **Provider conventions are learned from the first repository that uses them** and kept on uninstall as user content (uninstall KB); their classification is conditional on the Git agent's provider-mismatch guard.
- **Recommended's tracker row** is the step's only Recommended surface; Advanced emits its messages unconditionally.

## Key Files

- `src/core/tracker.ts` — see the section above
- `src/cli/commands/tracker-prompts.ts` — `shouldRunTrackerStep`, `TrackerPromptIO`, `buildClackTrackerPrompts`, `runTrackerStep`, `formatTrackerSummary`, `providerChoices`, `formatProviderCatalogue`, `TRACKER_SELECT_MESSAGE`
- `src/cli/commands/tracker.ts` — `trackerCommand`, `runTrackerSet` + `TrackerSetIO` + `buildTrackerSetIO` + `TrackerSetOutcome`, `formatTrackerStatus`, `readTrackerMechanics` / `formatTrackerMechanics` / `TrackerMechanicsState`, `readTrackerStatusConventions`, `readTrackerProvenance` / `formatTrackerProvenance`, `TrackerCliActionMessage`, the `// ── Set ─` anchor
- `src/targets/claude-code/tracker-install.ts` — `convergeTrackerArtifacts`, `TRACKER_AGENT_NAME`, `TrackerAgentState` (`installed | unchanged`), `ConvergeTrackerArtifactsResult`
- `src/cli/commands/init.ts` — `persistManifestThenConvergeTracker`, `TrackerLifecycleIO`, `ManifestTrackerOutcome`, the `shouldRunTrackerStep` call sites
- `src/core/feature-config.ts` — `TrackerConfigOverride`, `parseTrackerOverride`; `src/core/manifest.ts` — `normalizeTrackerFeature` use in `readManifest`
- `src/targets/claude-code/compliance-install.ts` — `convergeComplianceArtifacts` (owned by the `compliance-feature` KB): the compliance counterpart that also installs on every machine
- `tests/tracker-cli.test.ts`, `tests/tracker-install.test.ts` — the CLI subprocess and agent-install pins

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub
- `.devflow/features/installer-shadowing-reference-overlay/KNOWLEDGE.md` — the generated tree every install carries, which `--set` never touches
- `.devflow/features/installer-shadowing-init-seed/KNOWLEDGE.md` — `resolveSeedFeatures` tracker seeding, the migration that moves legacy conventions, the drain ordering
- `.devflow/features/installer-shadowing-wizard-flags/KNOWLEDGE.md` — the prompt-IO seam and the other two gates
- `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md` — the tracker runtime artifacts and the conventions' user-content classification
- `.devflow/features/tracker-feature/KNOWLEDGE.md` — what a selection means at read time: settings-line resolution, Tracker agent protocol, mismatch guard
- `.devflow/features/tracker-references/KNOWLEDGE.md` — the generated reference tree and its byte budget
- `.devflow/features/compliance-feature/KNOWLEDGE.md` — the same machine-switch-versus-repository pattern for compliance
