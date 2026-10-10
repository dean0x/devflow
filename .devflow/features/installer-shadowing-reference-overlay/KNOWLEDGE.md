---
feature: installer-shadowing-reference-overlay
name: Generated Reference Overlay & Prune
description: "Use when changing overlayGeneratedReferences, CONVERGED_SUBTREES, overlay units, staged swaps or sweepOrphanedReferences. Keywords: reference overlay, devflow:git, tracker/pr references, prune, staging."
category: architecture
directories: [src/targets/claude-code/installer.ts, src/core/reference-sweep.ts, src/core/mds-variants.ts, src/cli/commands/install-report.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Generated Reference Overlay & Prune

## Rules

- **KB-AP-1** Never gate the overlay call on which skill-install branch ran: it sits downstream of all three (shadow-valid, missing-skill-md, canonical), so a shadowed `devflow:git` still gets the canonical mechanics.
- **KB-AP-2** Never classify an overlay unit by "any non-empty directory part": `tracker/_mcp.md` would become a provider named `tracker` and the swap would rename `tracker/` itself over every provider dir. Classify by shape (`isProviderSubdir`: exactly `tracker/{provider}`).
- **KB-AP-3** Never derive `CONVERGED_SUBTREES` from the manifest: a retired subtree drops out of the derived set and its installed tree is never pruned. The array is explicit and hand-maintained.
- **KB-AP-4** Never prune outside `CONVERGED_SUBTREES`: hand-authored references (`github-api.md`, `violations.md`) share the references root with generated ones.
- **KB-AP-5** Never delete a `restore-failed` unit's surviving `.old` copy in the run that names it as the way back: the prune skips that one subtree for the run, and other subtrees still converge.
- **KB-AP-6** Never `rm(target)` then `rename`: displace to the `.old` backup first so a failed rename can restore it.
- **KB-AP-7** Never reuse `copyDirectory` for the overlay: it follows symlinks and preserves source modes.
- **KB-AP-8** Never share a staging path between units or place one outside the converged subtree; staging names carry the unit kind and a directory slug plus a process-unique token.
- **KB-AP-9** Never treat a manifest size as a byte budget: the loaded set is per SPAWN, not per install.
- **KB-AP-10** Never read prune names as subtree-relative: they are references-root-relative (`tracker/probe-provider`, `pr/stale.md`).
- **KB-INV-1** A unit is one `tracker/{provider}/` dir, the `pr/` dir, or one flat directory set; a failing unit never disturbs another, and every failure is reported as `{ unit, state, error }`, not thrown.
- **KB-INV-2** The only throws are a manifest entry absent from the generated tree and the whole-tree `ENOENT` check (`requireGeneratedTree`); both are packaging failures.
- **KB-INV-3** Converge-not-merge applies to `CONVERGED_SUBTREES` only; the flat references root is overlaid and never pruned.
- **KB-INV-4** The build manifest (`generatedReferenceManifest`) and the install manifest (`installedReferenceManifest`) take no provider argument and carry the same full content on every machine.
- **KB-INV-5** A converged root that is a symlink or not a real directory is refused (`D-CONVERGED-ROOT-REAL`): no unit stages, promotes or backs up through it and the prune never follows it.
- **KB-INV-6** `chmodRecursive` normalises the whole `references/` tree to a read-only-text mode (`D-OVERLAY-MODE-SCOPE`) but never replaces or deletes a file outside the manifest.
- **KB-INV-7** Every walker over this tree shares `MAX_REFERENCE_SWEEP_DEPTH`; the full-install pre-clean keeps what `CONVERGED_SUBTREES` converges, derived from the manifest by `overlayOwnedSkillPaths`.

## Overview

A fourth, converge-not-merge mechanism beside the three registry-diff sweeps: it refreshes generated *content* inside an already-installed skill rather than adding or removing whole assets. The build side (byte budget, containment oracle, contract/mechanics split) belongs to the `tracker-references` KB; this KB covers what an installer maintainer needs: the hook point, the manifests, the isolation units, the staged swap, the prune, and the report/render contract.

"Converge, not merge" is scoped to every entry in `CONVERGED_SUBTREES` — `references/tracker/**` (per-provider tracker mechanics) and `references/pr/**` (the provider-independent PR-host tree). The flat cross-cutting root (hand-authored references beside generated ones) is overlaid but not pruned: no allowlist of hand-authored names exists to prune safely against, an intentional gap rather than an omission.

## Hook Point and Sources

- Runs once per install, for the `git` skill only (`SKILL_REFS_SKILL_NAME`, defined in `src/core/mds-variants.ts` next to the registry it derives from: "which skill owns the generated references" is not Claude-Code-specific, and a second spelling is the drift the `src/core` vs `src/targets` boundary exists to prevent), immediately after that skill's `copyDirectory` call. The ONE call site sits downstream of all three skill-install branches, so a shadowed `devflow:git` receives the canonical generated mechanics exactly as a canonical install does (shadow-independent, a release blocker).
- Source: `compiledSkillRefsDir()` → `dist/skills/git/references/`.
- **Two manifests, one content, two roles.** `generatedReferenceManifest()` is what the BUILD emits and the tarball carries. It is derived from `expandVariants()` itself, never hand-listed: `tracker/{provider}/{op}.md` for github, jira and linear (one shared `TRACKER_OPS` roster); `pr/{op}.md` per `PR_HOST_OPS` (`PR_HOST_DESTINATION_ROOT = 'pr'`: the PR/review host mechanics that stay on GitHub under every tracker provider — branch/commit/push, create, retitle, review-thread, CI-status and PR-evidence ops); the cross-cutting documents (`decision-markers.md`, `learn-conventions.md`, `publication-gate.md`, `trust-rule.md`); and the two tool-call contract documents `tracker/_contract.md` (provider resolution and tracker input contract; an UNGATED `kind: 'contract'` module) and `tracker/_mcp.md`. `ensure-pr-ready` is a member of BOTH the PR-host and tracker rosters by design: the PR skeleton, step 4b's open-PR lookup and body edit included, lives in `pr/ensure-pr-ready.md`, while step 4b's issue-number lookup and link line live in `tracker/{provider}/ensure-pr-ready.md`. It throws if the registry fails to expand, rendering the FULL `VariantExpansionError` payload (not just its `kind`), since the payload names the offending module/op — a compile-time-constant programming error, not an install-time degradation.
- `installedReferenceManifest({modules?})` is what an INSTALL carries, and it is the SAME full manifest whatever the machine's provider (`D-INSTALL-ALL-PROVIDERS`): a repository can select its own tracker in `.devflow/project.json` and a Git spawn must find the mechanics of whichever provider the repository resolves. The trees are inert until a spawn names one of their files, so carrying them all costs disk, never context. It takes no provider argument, throws on registry non-expansion as its sibling does, and has an injectable `modules` seam so the throw is provable without a broken registry. The two stay separate functions because they answer different questions (what the build emits vs what the overlay converges and the pre-clean keeps); the overlay still PRUNES everything under its converged subtrees the manifest does not name. The manifest size is pinned by `tests/mds-variants.test.ts` (`INSTALLED_REFS`) and floored by `tests/packaging.test.ts`. `devflow tracker --set` touches no reference: a provider change has nothing to swap.
- `FileCopyOptions.warn?: (msg) => void` (default no-op) is the non-fatal-notice channel the overlay uses for skipped symlinks, mode-normalisation failures and a `chmodRecursive` depth breach; `devflow init` passes its own logger.

## Isolation Units (`D-OVERLAY-FLAT-UNIT`, `D-OVERLAY-PROVIDER-SHAPE`)

`OverlayUnit = OverlayUnitRef & { files }`, where `OverlayUnitRef` is a discriminated union:
- `{ kind: 'provider'; subdir }` — subdir spelled exactly as the registry declares it, e.g. `tracker/github`;
- `{ kind: 'pr-host'; dir }` — `pr/`;
- `{ kind: 'cross-cutting'; dir }` — `dir` is where the flat set lands: `''` for the references root, `tracker` for the tool-call contract files `_contract.md` and `_mcp.md`. A discriminated union rather than a name string with a sentinel, because a provider directory could in principle hold the same value.

`planOverlayUnits` groups the manifest by directory in deterministic order (sorted by directory part) and classifies each directory by SHAPE through the private `isProviderSubdir(subdir)`: exactly two path segments, `tracker` first and a non-empty second, is a provider unit; `pr/` is the PR-host unit; everything else is a flat/cross-cutting unit, so both the references root and `tracker/` itself (which also holds the flat contract files beside the provider directories) take the flat arm. **This fixed a real defect:** before the shape check, `tracker/_mcp.md`'s directory part (`tracker`) was bucketed as a provider named `tracker`, and that unit's atomic swap renamed `tracker/` itself over every provider directory beside it. The code-site comment states the rule: allowlist-BY-PATH, never "every staging basename begins with a dot".

A unit is one provider directory, the `pr/` directory, OR the whole flat set for one directory — never one unit per flat file, so documents that are always generated and read together report one outcome. `pr/` is classified by name rather than shape: every file in it is generated, so like a provider directory it is owned outright and swapped whole (`isProviderSubdir('pr')` is false, and the flat arm's premise — documents landing beside entries the overlay must never replace — does not hold there).

Before the unit loop, `requireGeneratedTree(sourceRoot, manifest)` stats the compiled references root ONCE and throws, naming `npm run build:mds`, only when that stat fails with `ENOENT` (the whole tree is absent, e.g. only `npm run build:cli` ran). Any other stat failure (`EACCES`, a bad filesystem) falls through to the ordinary per-unit reporting. It is one check rather than per unit because the per-unit build loop has no isolation for a refusal this early: one unbuilt provider would otherwise abort every other unit.

## Staging and Promotion

- Each unit is staged under a `.tmp` sibling at a **process-unique** path (`buildUnitStagingTree`; an orphan tmp from a crashed prior run is pre-cleaned first). The token is `STAGING_TOKEN` = pid plus a base-36 timestamp, fixed for the life of the process. The pid keeps two concurrent `devflow init` runs from deleting each other's half-built tree (staging starts with `rm -rf` on the staging path); the timestamp keeps a REUSED pid from adopting a tree a still-earlier crashed run left behind.
- Names: `tracker/{provider}.<token>.tmp` for a provider; `tracker/.pr-host.pr.<token>.tmp` for the PR-host unit; `tracker/.cross-cutting.{dirSlug}.<token>.tmp` for a flat set, keyed by kind and by a slug of the unit's own directory (`root` for the references root, `tracker` for the contract files). No two units in a run — the references-root set, the `tracker/` contract set and `pr/` — share a staging path or pre-clean each other's half-built tree. All sit under the `tracker/` subtree the prune converges, so a tree stranded by a crash is swept by the NEXT run's prune and needs no recovery path of its own. A staging dir at the references root instead would sit outside every convergence and be mode-normalised forever.
- Promotion (`promoteUnitStagingTree`) dispatches on `unit.kind`. `promoteDirectoryUnit` (provider and PR-host units) displaces the installed directory to a `.old` backup — a provider's beside it, `pr/`'s at `tracker/.pr-host.pr.old`, so a stranded backup is still pruned — **before** the staging tree is renamed in (never `rm(target)` then `rename`). A rename that fails partway calls `restoreDisplacedUnit(backup, target)`, itself a function returning a Result rather than a swallowed `.catch(() => undefined)`, because a failed restore is a materially worse outcome and the report must say which happened. `promoteCrossCuttingUnit` promotes a flat set one `rename` per document into `underRoot(referencesTarget, unit.dir)`: there is no directory to swap, since the documents land beside entries the overlay must never replace or delete, so a mid-flight failure leaves it part new and part old.
- The full-install **pre-clean** (`overlayOwnedSkillPaths(manifest)`) carves its keep-list from the owning step's own manifest, never a hand-typed list. It keeps a nested directory whole only when `CONVERGED_SUBTREES` lists its top segment (any other nested entry is kept file by file, so an unlisted fan-out directory fails safe), and a symlink planted at a kept path is removed, never kept. What the prune converges and what the pre-clean keeps whole therefore agree by construction. It is also what replaces a stale file at the unpruned references root.

## Failure Reporting

A failure, build or promotion, is reported as `{ unit, state, error }` on `overlayFailures`, naming the failing unit and what it was left as. `state: OverlayFailureState` is a closed union naming exactly what is on disk:
- `installed-unchanged` — nothing touched;
- `not-installed` — first install, never had a copy; names the absent files;
- `partially-refreshed` — the flat set stopped mid-rename; names `refreshed` / `stale` file lists;
- `restore-failed` — a directory unit's `.old` backup could not be put back; names the `recoveryPath` and the restore error.

A converged root that is a symlink or otherwise not a real directory refuses every unit that would stage, promote or back up through it (`D-CONVERGED-ROOT-REAL`), reported as `installed-unchanged` or `not-installed` with the refusal as its error. Per-item isolation is proven by a dedicated test: one unreadable file in a second provider's directory leaves that provider byte-unchanged while the other installs normally. Symlink source entries are skipped with a `warn()` call and never followed.

**The ONE throw path inside the per-unit build loop:** a manifest entry absent from the generated tree throws `Generated skill reference not found for declared reference "{relPath}": {absolute}` with an `npm run build:mds` hint. A missing build artifact was never produced, a packaging failure rather than an install-time degradation; every other build or promotion failure is reported through `overlayFailures`, never thrown. `requireGeneratedTree` is the second, coarser throw path.

## Prune (`sweepOrphanedReferences`, `src/core/reference-sweep.ts`)

A SUBTREE-GENERIC sweep: given a root and the manifest paths relative to it, it converges that one root to the manifest, recursively and path-keyed, bounded at `MAX_REFERENCE_SWEEP_DEPTH` (exported from `reference-sweep.ts`; the sweep, the build's own prune and the test harness's `walkFiles` share the one constant and answer a breach differently: this sweep reports it into `failed`, the build throws, `walkFiles` throws). Directory-prefix membership is checked against a `Set` built once per sweep (`directoryPrefixes`) rather than re-scanning the manifest per entry. A shadow-injected stray file (for example `tracker/jira/comment.md`) is removed on the next install; a whole subdirectory with no manifest path descending into it is removed whole, not left empty. A missing or unreadable subtree root is a no-op. It only removes.

**Which roots get swept** is an explicit list, not something the function decides: `CONVERGED_SUBTREES = [TRACKER_DESTINATION_ROOT, PR_HOST_DESTINATION_ROOT] as const` in `installer.ts` (`D-CONVERGED-SUBTREES`) — the directories that are WHOLLY generated, so a name inside them the manifest does not carry is by construction a leftover. It is hand-maintained rather than derived from "every top-level directory the manifest currently names", which would drop a retired subtree out of itself once the manifest stopped naming anything in it, keeping its installed tree forever — exactly the retirement case the prune exists for. One entry per new wholly-generated directory is the intended cost. The references ROOT stays the one exemption.

`prunePreservingRecoveryCopies(referencesTarget, subtree, manifest, overlayFailures)` converges ONE named subtree after an `lstat` of its root: a root that is a symlink or not a real directory is reported in `failed` under the subtree's name and never followed. When a `restore-failed` unit's `recoveryPath` sits under THAT subtree's root (`isContainedIn(subtreeRoot, recoveryPath)`), the prune is skipped for this run, for that subtree only (reported through `pruned.failed`, not silently), rather than deleting the one surviving copy of that unit's mechanics in the run that named it as the way back; a backup stranded under `tracker/` says nothing about whether `pr/` can be converged, so `pr/` still converges in the same call. `pruneConvergedSubtrees(referencesTarget, manifest, overlayFailures)` loops `CONVERGED_SUBTREES`, calls it once per subtree and merges the results into one `SweepResult` (`scanned` summed, `removed` / `failed` concatenated), so `ReferenceOverlayResult.pruned` and `InstallReport.sweptOrphans` see one report. Every name in the merged result is prefixed with its subtree relative to the references ROOT, otherwise same-named orphans under different subtrees (`tracker/stale.md` vs `pr/stale.md`) would reach the report as one indistinguishable `stale.md`. Removals fold into `InstallReport.sweptOrphans` via `recordSweep(report, 'reference', sweep)`.

## Mode Normalisation and Rendering

- `chmodRecursive` normalises the WHOLE `references/` tree to `0644` (`D-OVERLAY-MODE-SCOPE`), not only this run's files: `copyDirectory` preserves source modes, and a reference is read-only instruction text however it got there. Best effort: a filesystem that ignores mode bits must not fail the install. Bounded by `MAX_REFERENCE_SWEEP_DEPTH`; the overlay reports a breach through `warn()` rather than throwing. It is the ONE step reaching a file the overlay does not otherwise own, which is why the module's boundary reads "never REPLACE or DELETE" rather than "never touch": the settings.json ownership contract's corollary (a guard protects deletion, not overwrite) licenses normalising the mode of a hand-authored reference outside the manifest, never replacing or deleting one. The prune's manifest-driven scope is a separate design choice that contract does not govern.
- The overlay's summary renderers live in `src/cli/commands/install-report.ts`, not `init.ts`: `SummaryLine`, `formatOverlaySummary`, `describeOverlayFailureState`, `formatTrackerAssetSummary` (provider, previous provider, installed/removed reference counts, Tracker agent state) and `formatSkillScopeSummary` (the removed-skill line and one dormant-shadow line per shadow). `formatSweepSummary` stays in `init.ts` and imports the type. `overlaidRefs` and `overlayFailures` exist because `formatOverlaySummary` renders them; a report field needs a render site.

## Uninstall

Uninstall needs no reference-cleanup step: generated references live inside `~/.claude/skills/devflow:git/references/`, which `removeAllDevFlow` / `sweepDevflowNamespaces` remove wholesale with the skill directory.

## Anti-Patterns

- **KB-AP-1** The overlay call must stay downstream of all three skill-install branches. A call conditional on the branch lets a shadowed `devflow:git` ship without the canonical mechanics, breaking shadow-independence.
- **KB-AP-2** Reverting to the looser unit classification reintroduces the bug where the atomic swap renamed `tracker/` over every provider directory beside it. One provider unit is `tracker/{provider}` — two segments, non-empty second.
- **KB-AP-3** A set built from "every top-level directory the manifest currently names" is self-maintaining until a subtree is retired: dropping every manifest entry for it removes it from the derived set, and the prune never looks at its installed tree again. The explicit array converges a retired subtree down to empty (`D-CONVERGED-SUBTREES`).
- **KB-AP-4** Pruning outside the converged subtrees would delete hand-authored references (`github-api.md`, `violations.md`) that live in the same `references/` directory.
- **KB-AP-5** The recovery skip is per subtree on purpose: a stranded backup under `tracker/` must not block `pr/`.
- **KB-AP-6, KB-AP-8** Displace-then-rename and process-unique, in-subtree staging are one build-then-swap design: the `.old` backup is what a failed rename restores, and an in-subtree name is what lets the next run's prune clear a crash's leftovers because no later pre-clean will ever look at that name again.
- **KB-AP-7** `copyDirectory` preserves modes and follows symlinks; the overlay does its own copying and skips symlink source entries with a `warn()`.
- **KB-AP-9** The standing trap is confusing a manifest with a byte budget. The installed tree is all providers; the loaded set per Git spawn is only the references that operation names.

## Gotchas

- **KB-AP-10** Since the prune covers two subtrees, `ReferenceOverlayResult.pruned` and `InstallReport.sweptOrphans` names are references-root-relative; a consumer written against bare basenames (`probe-provider`) silently stops matching.
- **Staging names are not dot-prefixed for provider units** (`{provider}.<token>.tmp`), so the prune must reach every staging and backup name by path against the manifest, never by a naming rule.
- **A mid-flight flat-set failure is `partially-refreshed`**: a flat set promotes one rename per document, so it is the only unit that can leave a mix of new and stale files.
- **The prune walkers answer a depth breach differently** (report into `failed`, throw, throw); `composeScripts`' `chmodRecursive` call swallows one silently.
- **Fixtures must match runtime shapes:** `tests/installer/reference-overlay.test.ts` copies its fixtures from the real generated references rather than hand-authored stand-ins, and mkdtemps every root so it never touches the real `~/.claude`.

## Key Files

- `src/targets/claude-code/installer.ts` — `overlayGeneratedReferences`, `OverlayUnit` / `OverlayUnitRef`, `OverlayFailure` / `OverlayFailureState`, `ReferenceOverlayResult`, `planOverlayUnits`, `buildUnitStagingTree`, `promoteUnitStagingTree` (→ `promoteDirectoryUnit` / `promoteCrossCuttingUnit`), `restoreDisplacedUnit`, `requireGeneratedTree`, `CONVERGED_SUBTREES`, `convergedRootFault`, `prunePreservingRecoveryCopies`, `pruneConvergedSubtrees`, `overlayOwnedSkillPaths`, `chmodRecursive`, `FileCopyOptions.warn`; the manifest functions and path constants are imported from `mds-variants.ts`, not defined here
- `src/core/reference-sweep.ts` — `sweepOrphanedReferences(root, knownRelPaths) => Promise<SweepResult>`, `directoryPrefixes`, `MAX_REFERENCE_SWEEP_DEPTH`; path-keyed sibling of `sweepOrphanedAssets`; only removes
- `src/core/mds-variants.ts` — `generatedReferenceManifest()`, `installedReferenceManifest({modules?})`, `TRACKER_DESTINATION_ROOT`, `TRACKER_OPS`, `PR_HOST_OPS`, `PR_HOST_DESTINATION_ROOT`, `SKILL_REFS_SKILL_NAME`, `SKILL_REFS_OUTPUT_DIR`, plus the build registry (`VARIANT_MODULES`, `expandVariants`, `splitVariantSections`); build-side ownership is in the `tracker-references` and `feature-knowledge-system` KBs
- `src/cli/commands/install-report.ts` — the overlay and scope summary renderers
- `tests/installer/reference-overlay.test.ts`, `tests/mds-variants.test.ts`, `tests/packaging.test.ts` — overlay behaviour, manifest size, packaging floor

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub: accessors, sweeps, `InstallReport`, the install conditions this overlay is exempt from
- `.devflow/features/installer-shadowing-tracker-wiring/KNOWLEDGE.md` — the Tracker agent file and `devflow tracker --set`, which converge no reference
- `.devflow/features/tracker-references/KNOWLEDGE.md` — contract/mechanics split, MDS build side, byte budget, containment oracle, provider-resolution preamble
- `.devflow/features/tracker-feature/KNOWLEDGE.md` — what a provider selection means at read time
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — build-side registry ownership
- `.devflow/features/test-harness/KNOWLEDGE.md` — install-snapshot goldens and the shared test helpers
