---
feature: tracker-references-build-install
name: "Tracker References: MDS Build Registry, Compiler Cliff and Installer Overlay"
description: "Use when editing mds-variants.ts, the _common/_steps/_mcp partials, hitting the MDS compile cliff, or changing the installer's reference overlay or converged subtrees. Keywords: VARIANT_MODULES, CONVERGED_SUBTREES."
category: architecture
directories: [src/core/mds-variants.ts, src/core/reference-sweep.ts, src/core/assets.ts, src/targets/claude-code/installer.ts, src/targets/claude-code/tracker-install.ts, src/cli/commands/install-report.ts, src/assets/mds/tracker, src/assets/mds/git, tests/installer, tests/build-mds-compile-time.test.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Tracker References: Build Registry, Compiler Cliff and Installer Overlay

## Rules

- **KB-INV-1** `src/core/mds-variants.ts` is the closed registry of reference modules (`VARIANT_MODULES`). `expandVariants` is pure and total (a `Result`, never a throw); `splitVariantSections` splits a module's output on `<!-- op: NAME -->` markers bidirectionally and rejects an empty section (GAP-44).
- **KB-INV-2** `VariantModuleKind` has three members. Only `fanout` is held to `MIN_VARIANT_PAIRS`; `named` and `contract` are exempt, and a `contract` module's emitted basename must start with an underscore.
- **KB-INV-3** `tracker/_mcp.md` is generated only while a registered module lands in `tracker/jira` or `tracker/linear`; `tracker/_contract.md` is ungated because every install carries every provider.
- **KB-INV-4** Generated references land only under `dist/` through `compiledSkillRefsDir()`; nothing generated lives in `src/`.
- **KB-INV-5** Anything that enumerates MDS partials uses `ALL_MDS_PARTIALS` (`MDS_PARTIALS` plus `MDS_REFERENCE_PARTIALS`).
- **KB-INV-6** The prune converges exactly `CONVERGED_SUBTREES`: a directory converges when every file in it is generated. The references root holds hand-authored documents and is overlaid, never pruned.
- **KB-INV-7** Every overlay write and removal goes through a real-directory converged root; a symlinked or otherwise non-directory root is refused and reported, never repaired.
- **KB-INV-8** A directory unit swaps atomically behind a `.old` backup (displace, rename the new tree in, drop the backup); the flat cross-cutting set builds a staging tree first and promotes one rename per document.
- **KB-AP-1** Adding defines to `_mcp.mds` (it sits at the compiler cliff) or step text to `_common.mds`: the resolver's cost is exponential in a module's own define count and a build that does not finish is not a comment. New defines go to `_steps.mds` or a partial of their own.
- **KB-AP-2** Importing a reference partial selectively (`@import { a, b } from …`): the resolver deep-copies the captured scope per `@define` of the importer. Alias-import (`as steps`, `as mcp`) instead.
- **KB-AP-3** `rm(target)` then `rename(tmp, target)` for a swap: a failed rename leaves nothing. Displace to `.old` first.
- **KB-AP-4** Reusing a fixed staging directory name across runs: staging paths stay process-unique (pid plus timestamp).
- **KB-AP-5** Deriving the prune scope from "every top-level directory the manifest names": a subtree the manifest stops naming entirely would keep its whole installed tree. The list is explicit.
- **KB-AP-6** Bucketing a manifest entry by "any non-empty directory part is a provider": `tracker/_contract.md` would make `tracker/` itself a provider unit. A provider unit is exactly `tracker/{provider}` (`isProviderSubdir`).
- **KB-AP-7** Adding a third partial enumerator beside `ALL_MDS_PARTIALS`: `tests/packaging.test.ts` and `tests/build-mds-generator-hosts.test.ts` were both re-pointed for exactly that.
- **KB-AP-8** A one- or two-element fanout roster: a list short enough to hand-enumerate is satisfied by any implementation that returns something (GAP-42), so `MIN_VARIANT_PAIRS` refuses a shrink below the floor and does not cap growth.

## Overview

The tracker reference tree is produced by the MDS build and installed by a converge-not-merge overlay. This KB owns the registry that decides which files the build emits, the partials those files are compiled from and the compile-time discipline they impose, and the overlay that gets the generated tree into `~/.claude/skills/devflow:git/references/`. What the files say and how a spawn loads them is `.devflow/features/tracker-references/KNOWLEDGE.md`; what the byte budget gates is `.devflow/features/tracker-references-byte-budget/KNOWLEDGE.md`; the guards over all of it are `.devflow/features/tracker-references-guards/KNOWLEDGE.md`. The overlay is owned in full detail by `.devflow/features/installer-shadowing-reference-overlay/KNOWLEDGE.md`, and the general MDS pipeline (generator hosts, `output-dir:`, the `skill-refs` variant) by `.devflow/features/feature-knowledge-system-mds-build/KNOWLEDGE.md`; this KB states the tracker-specific parts.

## The build registry — `src/core/mds-variants.ts`

`VariantModule { source, subdir, kind, ops }`, with a closed `VARIANT_MODULES` array of six entries:
- `_github.mds` (`subdir: 'tracker/github'`, `kind: 'fanout'`, `ops: TRACKER_OPS`) — one file per tracker op;
- `_jira.mds` (`tracker/jira`) and `_linear.mds` (`tracker/linear`) — the two MCP-backed providers, reading the SAME shared roster rather than a provider-specific list;
- `_pr.mds` (`subdir: PR_HOST_DESTINATION_ROOT = 'pr'`, `kind: 'fanout'`, `ops: PR_HOST_OPS`) — the provider-independent PR/review split, source `src/assets/mds/git/_pr.mds`;
- `_references.mds` (`subdir: ''`, `kind: 'named'`, `ops: GIT_CROSS_CUTTING_DOCS`) — the fixed, individually-named cross-cutting documents: `decision-markers`, `learn-conventions`, `publication-gate`, `trust-rule` (the last is the one statement of the PR-review trust rule);
- `_contract.mds` (`subdir: 'tracker'`, `kind: 'contract'`, `ops: ['_contract']`) — the tracker contract, the registry's last entry and its first UNGATED `contract` module (`D-TRACKER-CONTRACT-ON-DEMAND`).

`kind` is `'fanout' | 'named' | 'contract'`. `'fanout'` (default) is checked against `MIN_VARIANT_PAIRS` — a roster short enough to hand-enumerate makes every parity assertion over it vacuous (GAP-42), so the floor refuses a shrink and does not cap growth. `'named'` is exempt from the count floor. `'contract'` — a single cross-cutting CONTRACT document whose emitted basename carries a mandatory leading underscore (`validateContractOutputName`), distinguishing `tracker/_mcp.md` and `tracker/_contract.md` from the provider directories beside them — is exempt for the same reason nothing ranges over it, but is its own kind rather than a flag on `'named'` because the NAME RULE differs.

`MCP_CONTRACT_MODULE` (`_mcp.mds` → `tracker/_mcp.md`) sits outside `VARIANT_MODULES` behind a generation gate (`GATED_REFERENCE_MODULES`, `resolveVariantModules()`, keyed off `MCP_BACKED_PROVIDER_SUBDIRS`): registering a module whose `subdir` is one of those is the whole edit that opens the gate. `_contract.mds` has no gate: no registered provider is the condition it depends on, and a gate keyed on a tool-call provider would be open whenever it mattered.

`compiledSkillRefsDir()` (`src/core/assets.ts`) is the one owner of where generated references land in `dist/`; `dist/skills/git/references` is `ALLOWED_OUTPUT_DIRS`' `skill-refs` entry (`D-SKILLREFS-ALLOWLIST`).

Build order: `scripts/build-mds.ts` reads `VARIANT_MODULES`, calls `expandVariants()`, compiles each module host once and calls `splitVariantSections()` to emit one file per pair under `compiledSkillRefsDir()`. `git.mds` compiles separately to `dist/agents/git.md`, carrying only the contract text plus the pointers and the loading section's single tracker naming line. `_contract.mds` compiles with the other reference modules into `tracker/_contract.md`; `_steps.mds` reaches the artifact only by expanding into the three provider modules. A tarball must carry every file the overlay converges to (`tests/packaging.test.ts`, floor `packed-reference-manifest-size`).

## The partials and the compiler cliff

Three partials live under `src/assets/mds/tracker/` with no `output-dir:`, so the build skips them and they reach artifacts only by expanding into importers. All three are `MDS_REFERENCE_PARTIALS`; each is alias-imported (`as steps`, `as mcp`) in the provider modules.

- **`_common.mds`** holds the lines every provider writes identically: `state_batch_line`, `bare_number_rule`, the four `ref_preflight_*` heads (single, list, entry, branch — four because `@if` is block-structured and every call site is a fragment in the middle of a list item), `traceable_issue_rules`, `wave_report_inputs`, `conventions_step`, `branch_detection_step`, `closing_keyword_rule`, `handoff_values`, `last_release_tag_step` and `trace_map_step`. Each define states its own audience, since not all are provider-neutral. It is treated as full. The marker-neutralisation bullet is deliberately not hoisted: it is byte-identical in content but indented differently in the three modules, and indentation is list grammar.
- **`_steps.mds`** holds provider-neutral STEP TEXT (`D-NEUTRAL-STEP-MOVE`, content in the hub KB). It is its own partial because the same defines in `_common.mds` took it from about 20 ms to about 4,900 ms and every importing provider module to about 9,500 ms against the 1,500 ms guard in `tests/build-mds-compile-time.test.ts`. As a separate partial its three providers are its only importers and its defines capture only one another; measured when it landed: `_common` ~16 ms, `_steps` ~0 ms, `_github` ~46 ms, `_jira` ~86 ms, `_linear` ~84 ms and `_contract` ~0 ms. A define that wants hoisting goes here or to a new partial.
- **`_mcp.mds`** is the provider-independent tool-call contract plus authoring-only defines (the D11 posting-gate head and similar rules whose text `tests/guards/mcp-sink-bypass.test.ts` requires every posting mechanic to spell for itself). It is the one at the cliff.

**The cliff, as recorded in `_mcp.mds`.** Compiling a provider module against `_mcp.mds` costs, measured with control defines whose whole body is one character (so it is the define COUNT against that module's size, not the content): 3.3 s at nine defines (as shipped), 4.9 s at ten, 8.3 s at eleven, and it did not finish in 12 s at twelve. `_jira.mds` and `_linear.mds` both pay it, so twelve defines would make `npm run build:mds` not terminate in any practical time; the same five defines in `_common.mds` cost 1.2 s in total. Anything further that wants hoisting goes to `_steps.mds` or a partial of its own, never `_mcp.mds`, or `_mcp.mds` shrinks first. `_pr.mds` is an import-free fanout module with one `@define` per op and no `@import`, so it never compiles against `_mcp.mds` and its defines capture only one another; `_contract.mds` has no define and no import and is plain text under its one marker.

## Installer overlay

The overlay (`overlayGeneratedReferences` in `src/targets/claude-code/installer.ts`, one call site inside the skill-install loop) converges the generated `references/` tree of the `git` skill after the skill is copied. It is converge-not-merge for the generated subtrees: a file the manifest no longer names leaves on the next install. `installedReferenceManifest()` equals the full generated manifest under every provider (`D-INSTALL-ALL-PROVIDERS`), so the prune compares against one manifest on every machine.

- **Unit kinds** (`planOverlayUnits`, `OverlayUnit` with `kind: 'provider' | 'pr-host' | 'cross-cutting'`). `tracker/{provider}` — exactly two segments, `tracker` first (`isProviderSubdir`, `D-OVERLAY-PROVIDER-SHAPE`) — is a provider unit; `pr/` (`PR_HOST_DESTINATION_ROOT`) is the PR-host unit. Both are directories the unit owns outright and are swapped whole behind a `.old` backup. Every other directory — the references root, and `tracker/` itself, which holds `_contract.md` and `_mcp.md` beside the provider directories — is a flat cross-cutting set, promoted one rename per document (`D-OVERLAY-FLAT-UNIT`). A new directory the registry emits takes the flat arm until it is classified. The PR-host unit's staging tree and backup sit under `tracker/` (`tracker/.pr-host.pr.{token}.tmp`, `tracker/.pr-host.pr.old`), so a crash that strands either is removed by the next run's prune.
- **The flat set** builds every document under a staging tree first and aborts the whole unit on any per-file failure; its promotion loop is the one place a mid-flight I/O error leaves the set partly refreshed, which `OverlayFailureState`'s `partially-refreshed` arm reports by name (the other arms are `installed-unchanged`, `not-installed` and `restore-failed`, one rendered sentence each in `describeOverlayFailureState`).
- **`CONVERGED_SUBTREES = [TRACKER_DESTINATION_ROOT, PR_HOST_DESTINATION_ROOT]`** (`D-CONVERGED-SUBTREES`) is the whole rule for what the prune converges. The same list gates the full-install pre-clean: `overlayOwnedSkillPaths` keeps a nested directory whole only when its top segment is listed, so a directory missing from the list fails safe — kept file by file — rather than keeping stale files forever. A listed root that is a symlink or otherwise not a real directory is refused and reported (`D-CONVERGED-ROOT-REAL`, `convergedRootFault`): no unit stages, promotes or backs up through it and its prune is skipped; every unit stages under `tracker/`, so a faulted `tracker/` refuses them all. The installer does not delete a link it did not create.
- **The prune.** `pruneConvergedSubtrees` merges the per-subtree sweeps (`prunePreservingRecoveryCopies`, parameterised over `(referencesTarget, subtree, manifest, overlayFailures)`, built on `sweepOrphanedReferences` and bounded by `MAX_REFERENCE_SWEEP_DEPTH`) into one `SweepResult`. Every removed or failed name is prefixed with its subtree (`pr/stale.md` vs `tracker/probe-provider`), so two identically-named orphans never collapse into one report line. A stranded recovery copy (`restore-failed`) skips the prune only for the subtree it sits under.
- **Modes.** `chmodRecursive` normalises the WHOLE references directory to `0644` (`D-OVERLAY-MODE-SCOPE`), reaching hand-authored references the overlay does not own: the ownership guard protects deletion, not overwrite, so the boundary is "never replace or delete".
- **Reporting.** `src/cli/commands/install-report.ts` holds `formatOverlaySummary`, `describeOverlayFailureState`, `formatTrackerAssetSummary` and `formatSkillScopeSummary`. `convergeTrackerArtifacts` (`src/targets/claude-code/tracker-install.ts`) installs the Tracker agent file on every machine; the reference tree converges through the installer's one overlay, never there.

## Anti-Patterns

- **KB-AP-1** The eight `_steps.mds` defines were first written in `_common.mds`: at 22 defines it compiled in about 4.9 s on its own, every provider module importing it took about 9.5 s, and `npm run build:mds` took about 35 s. The failure is invisible locally and fatal in CI, where a vitest run spawns dozens of full builds and a single build on a 2-core runner can exceed the 60 s `spawnSync` timeout, surfacing as unrelated-looking ETIMEDOUTs.
- **KB-AP-2** A selective import copies the imported graph once per define: two modules that selectively imported eight names from `_mcp.mds` and seven from `_common.mds` went from tens of milliseconds to about 4.6 s each. The alias form's captures are shallow and change lookup, not expansion, so emitted bytes are unchanged. `tests/build-mds-compile-time.test.ts` makes the cause the thing that goes red: it measures in-process (`compileFile`, the seeded probe written to a temp directory, never touching `src/` or `dist/`) rather than grepping, so a future import form with the same cliff or a resolver regression in a dependency bump is caught.
- **KB-AP-3, KB-AP-4** The swap displaces first so a failed rename can restore the previous tree, and a staging path that repeats across runs would let a crashed run's tree be mistaken for this one's.
- **KB-AP-5** With an explicit list a retired subtree converges to empty; with a derived one it would be forgotten.
- **KB-AP-6** The earlier rule renamed `tracker/` ITSELF over every provider's mechanics the first time the manifest carried a file directly under `tracker/`; its staging sibling also sat outside the subtree the prune converges.

## Gotchas

- **KB-INV-3** A provider's `_mcp.md` dependency is a registration side effect: there is no second edit and no flag. A fourth provider changes no gate for `_contract.md`.
- **KB-INV-5, KB-AP-7** `tests/packaging.test.ts` and `tests/build-mds-generator-hosts.test.ts` both had to be re-pointed at `ALL_MDS_PARTIALS` once reference partials existed outside `src/assets/commands/_partials/`; `tests/fixtures/mds-manifest.ts` discovers partials by a repo-wide walk that classifies by the build's own rule (no `output-dir:` key), so a partial parked elsewhere is named rather than merely counted.
- **Cliff measurements disagree with today's alias-import timing.** `_mcp.mds`' header records the multi-second cliff figures above, while `tests/build-mds-compile-time.test.ts` records each reference module compiling in tens of milliseconds under alias imports, with its 1,500 ms budget about three times below the ~4,600 ms selective-import cliff. Treat the define caps as the standing rule and re-measure before relaxing one. The partial headers disagree on where overflow goes: `_mcp.mds` still points it at `_common.mds`, while `_steps.mds` sends a define that would be `_common.mds`' eighteenth to `_steps.mds` or a new partial. The rule here is the conservative one (new defines go to `_steps.mds` or a partial of their own) until a measurement says otherwise.
- **KB-INV-6** `sweepOrphanedReferences` (`src/core/reference-sweep.ts`) is scoped strictly to the converged subtrees; its descent is bounded and a breach is reported in `failed` under its own relative path.

## Key Files

- `src/core/mds-variants.ts` — `VARIANT_MODULES`, `MCP_CONTRACT_MODULE`, `GATED_REFERENCE_MODULES`, `MCP_BACKED_PROVIDER_SUBDIRS`, `TRACKER_OPS`, `TRACKER_GITHUB_OPS`, `PR_HOST_OPS`, `PR_HOST_DESTINATION_ROOT`, `TRACKER_DESTINATION_ROOT`, `GIT_CROSS_CUTTING_DOCS`, `VariantModuleKind`, `MIN_VARIANT_PAIRS`, `expandVariants`, `resolveVariantModules`, `VARIANT_SECTION_MARKER_RE`, `splitVariantSections`, `installedReferenceManifest`, `generatedReferenceManifest`, `SKILL_REFS_SKILL_NAME`, `SKILL_REFS_OUTPUT_DIR`
- `src/core/reference-sweep.ts` — `sweepOrphanedReferences`, `MAX_REFERENCE_SWEEP_DEPTH`, `directoryPrefixes`
- `src/core/assets.ts` — `compiledSkillRefsDir`
- `src/targets/claude-code/installer.ts` — `CONVERGED_SUBTREES`, `isProviderSubdir`, `planOverlayUnits`, `OverlayUnit`/`OverlayUnitRef`, `convergedRootFault`, `overlayOwnedSkillPaths`, `OverlayFailure`/`OverlayFailureState`, `buildUnitStagingTree`, `restoreDisplacedUnit`, `promoteUnitStagingTree`, `requireGeneratedTree`, `prunePreservingRecoveryCopies`, `pruneConvergedSubtrees`, `overlayGeneratedReferences`
- `src/cli/commands/install-report.ts`, `src/targets/claude-code/tracker-install.ts` — overlay rendering and Tracker-agent install
- `src/assets/mds/tracker/_common.mds`, `_steps.mds`, `_mcp.mds` — the three partials; their headers record the audience, the omissions and the measured cliff
- `tests/build-mds-compile-time.test.ts` — the per-module compile budget (alias vs selective import)
- `tests/installer/reference-overlay.test.ts` — whole-directory swap for both `tracker/{provider}` and the `pr/` unit, refusal of a symlinked converged root, the pre-clean's keep-whole rule, shadow-independence, prune across `CONVERGED_SUBTREES`, symlink-skip, `0644` normalisation and the `formatOverlaySummary` render-site tests
- `tests/packaging.test.ts`, `tests/build-mds-generator-hosts.test.ts`, `tests/fixtures/mds-manifest.ts` — tarball carries the full manifest; partial enumerators

## Related

- `.devflow/features/tracker-references/KNOWLEDGE.md` — the hub: the contract/mechanics split these files implement
- `.devflow/features/tracker-references-byte-budget/KNOWLEDGE.md`, `.devflow/features/tracker-references-guards/KNOWLEDGE.md` — sibling facets
- `.devflow/features/installer-shadowing-reference-overlay/KNOWLEDGE.md` — the overlay in full detail
- `.devflow/features/feature-knowledge-system-mds-build/KNOWLEDGE.md` — the general MDS build pipeline this registry extends
- `.devflow/features/tracker-feature/KNOWLEDGE.md` — provider selection and the generation gate on `_mcp.md`
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — the install pipeline the overlay runs inside
- Selection-scoped install — its skill half (skills as the closure of `skills ∪ requires` over the selected plugins) stands; its tracker-bundle half (`{github} ∪ {selected provider}`) is superseded because every provider's references, `_mcp.md` and the Tracker agent install on every machine
- `src/core/` vs `src/targets/claude-code/` split — `mds-variants.ts` and `reference-sweep.ts` are target-agnostic core; the overlay lives in the Claude Code target
- Per-item failure isolation and staged-build-then-swap via a `.tmp` sibling — the atomic per-unit overlay swap and the sweep's per-file try/catch apply them over two converged subtrees
- Prove-you-wrote-it ownership of shared config — the settings.json ownership guard protects deletion, not overwrite; cited narrowly for the overlay's mode-normalisation step
