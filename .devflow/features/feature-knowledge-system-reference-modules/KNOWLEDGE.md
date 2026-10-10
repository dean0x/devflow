---
feature: feature-knowledge-system-reference-modules
name: MDS Reference-Module Registry
description: "Use when adding or changing a reference module, VARIANT_MODULES, the _mcp.mds generation gate, op rosters or reference manifests. Keywords: reference module, VARIANT_MODULES, expandVariants, gate, manifest."
category: architecture
directories:
  - src/assets/mds
  - src/core/mds-variants.ts
  - tests/mds-variants.test.ts
  - tests/tracker/reference-structure.test.ts
created: 2026-10-10
updated: 2026-10-10
---

# MDS Reference-Module Registry

## Rules

- **KB-INV-1** A reference module is registered in `VARIANT_MODULES` (`source`, `subdir`, `kind`, `ops`) and compiles to one file per op under `dist/skills/git/references/`. Its body is a concatenation of `<!-- op: NAME -->` sections, and the section split is bidirectional: an unknown marker, a registered op with no marker and an empty section each refuse the build.
- **KB-INV-2** `kind` is a required field (`as const satisfies readonly VariantModule[]`), not a default: a module lands in `'fanout'`, `'named'` or `'contract'` because it says so. Only `'fanout'` modules face the `MIN_VARIANT_PAIRS` floor, which is a floor and not a tuning knob.
- **KB-INV-3** A `'contract'` module's op name REQUIRES a leading underscore (`validateContractOutputName`); every other host's name REFUSES one (`validateOutputName`). Classify the case with a second rule; never widen `OUTPUT_NAME_RE`, which would admit `_anything.md` as a command or agent basename across all three destinations.
- **KB-INV-4** The `_mcp.mds` generation gate is a predicate DERIVED from the registry's shape (`mcpContractIsGenerated`, keyed on `MCP_BACKED_PROVIDER_SUBDIRS`), never a stored flag or phase marker. Registering a tool-call-backed provider and opening the gate are the same edit.
- **KB-INV-5** `tracker/github` is deliberately absent from `MCP_BACKED_PROVIDER_SUBDIRS`: GitHub's mechanics are `gh` calls, and a gate keyed on "any tracker module is registered" would generate a contract nothing loads.
- **KB-INV-6** Always expand the RESOLVED registry (`resolveVariantModules()`, which is idempotent), never the raw `VARIANT_MODULES`, which would silently omit the gated contract module. `expandVariants()`'s default and `generatedReferenceManifest()` already do.
- **KB-INV-7** `_contract.mds` is NOT gated: every install carries every provider, GitHub included, so no registered provider is the condition it depends on. `GATED_REFERENCE_MODULES` is the one table the resolver and the gated roster both read.
- **KB-INV-8** The generated manifest and the installed manifest are the same set (install-all): `installedReferenceManifest()` is what one install carries, whatever provider the machine selected, because a repository selects its own tracker. They stay separate functions because they answer different questions, and a footprint claim must name which one it measured.
- **KB-INV-9** Reference-module compile cost is exponential in a module's `@define` count and multiplicative in the capture graph of anything it imports selectively. Provider modules import shared partials by alias; `_pr.mds` imports nothing; `_common.mds` has no room for another define, so new shared step text goes in `_steps.mds`. `tests/build-mds-compile-time.test.ts` (`COMPILE_BUDGET_MS`) holds it.
- **KB-AP-1** A predicate that reads "nothing is gated" on the shipped tree needs a presence arm proving it still discriminates; a loop over an empty set asserts nothing. Probe a registry with every `MCP_BACKED_PROVIDER_SUBDIRS` entry dropped, derived from the gate's own subject, never one provider named by hand.
- **KB-AP-2** A reference file never carries a learning marker, a module-level preamble that must ship, or a further unfenced column-0 `## ` heading after its own anchor.
- **KB-AP-3** Never retype a roster in a test or the installer: `TRACKER_OPS`, `PR_HOST_OPS` and `GIT_CROSS_CUTTING_DOCS` are imported from production, and counts are compared through the named sets in `tests/fixtures/mds-manifest.ts`.

## Overview

The reference-module sources are named by `MDS_REFERENCE_MODULES` and fan out into the installed `devflow:git` skill's `references/` tree:

- **Provider modules** `_github.mds`, `_jira.mds`, `_linear.mds` (`kind: 'fanout'`, `subdir: tracker/{provider}`), all reading the same shared `TRACKER_OPS` roster. `TRACKER_GITHUB_OPS` is an alias of it for GitHub-scoped call sites: same list, two readings.
- **`_pr.mds`** (`kind: 'fanout'`, the shared `PR_HOST_OPS` roster, `subdir: PR_HOST_DESTINATION_ROOT`, i.e. `pr/`). Pull requests, PR reviews and PR checks stay on GitHub whatever the issue tracker is, and every install carries every provider anyway, so it is provider-independent.
- **`_references.mds`** (`kind: 'named'`): the fixed cross-cutting documents `GIT_CROSS_CUTTING_DOCS` at the references root.
- **Two `kind: 'contract'` modules**, one provider-independent document each at the `tracker/` root: `_contract.mds` (`tracker/_contract.md`: provider resolution and the tracker input contract; ungated; no defines, no imports, plain text under `<!-- op: _contract -->`) and `_mcp.mds` (`tracker/_mcp.md`: the tool-call contract, generation-gated).

The three provider modules import the shared partials `_common.mds` and `_steps.mds` by alias, and jira and linear also import `_mcp.mds`. The two partials declare no `output-dir:`, so the build skips them (`MDS_REFERENCE_PARTIALS`). On this tree the gate is open, so every source compiles and nothing is deferred. Content ownership sits elsewhere: `tracker-references` owns what the GitHub mechanics, the byte budget and the installer overlay say, and `tracker-feature` owns the provider dimension and the contract text; this KB owns the registry mechanism. The pipeline that consumes the registry (`planReferenceModule`, `splitVariantSections`, the prune) is in `feature-knowledge-system-mds-build`.

## Registry and Gate

| Piece | Where | Role |
|-------|-------|------|
| `VARIANT_MODULES` | `src/core/mds-variants.ts` | The unconditional entries: the three provider fan-outs, the `_pr.mds` fan-out, the `'named'` cross-cutting row and the ungated `'contract'` row for `_contract.mds` |
| `MCP_CONTRACT_MODULE` | same | The gated `'contract'` entry for `_mcp.mds` |
| `resolveVariantModules()` | same | Appends each gated module whose predicate says yes; asks each predicate about the registry AS PASSED (never the list being built, so one gate cannot be opened by a module another appended); resolving twice is a no-op, not a `duplicate-output` refusal |
| `referenceModuleFor` | `scripts/build-mds.ts` | A skill-refs host whose source is absent from the RESOLVED registry is refused rather than guessed at |
| Gate predicates | `mcpContractIsGenerated`, `deferredReferenceModuleSources`, `GATED_REFERENCE_MODULES`, `GATED_REFERENCE_MODULE_SOURCES`, `MCP_BACKED_PROVIDER_SUBDIRS` | Answer "does anything load `tracker/_mcp.md`?" from the registry's own shape. `MCP_BACKED_PROVIDER_SUBDIRS` names the two provider subdirs whose mechanics reach the tracker through a tool call rather than a CLI. The build's `discoverHosts()` reads `deferredReferenceModuleSources()` once and buckets a matching path into the `deferred` census before it can become a host or a counted partial |
| Manifests | `generatedReferenceManifest()`, `installedReferenceManifest()` | Every file the resolved registry emits, flattened for the installer's converge manifest; both assert (a refusal is a programming error no caller could continue past) rather than returning a `Result` |

The byte-budget model prices the two contracts as a sum: `contractTerm(provider)` in `tests/tracker/budget-model.ts` adds `tracker/_contract.md` for every provider and `tracker/_mcp.md` only for a tool-call-backed one (formula and content owned by `tracker-references`). The overlay's own unit-shape rule (`D-OVERLAY-PROVIDER-SHAPE`, owned by `installer-shadowing`) tells the flat contract files apart from provider subdirectories at install time; this registry only decides the generated SHAPE through `subdir`.

## Gotchas

**KB-INV-3, the underscore runs both ways.** The underscore tells a reader of `tracker/` which entries are providers (`tracker/github/`, `tracker/jira/`, `tracker/linear/`) and which are the cross-cutting contracts beside them (`tracker/_contract.md`, `tracker/_mcp.md`); `tracker/mcp.md` would read as a fourth provider. `expandVariants` dispatches between the two rules by `mod.kind` instead of relaxing the shared one, so the widening is not paid across commands and agents to buy a property only the reference tree needs.

**KB-INV-4, KB-INV-5 and KB-INV-7, the gate.** A provider module is registered with the `subdir` its files land in, so no second flag exists to flip. GitHub is absent from the gate's subjects because a generated-but-unloaded contract would bill every GitHub-only install for bytes nothing reads (GAP-02); the byte-budget formula prices them at zero on that path for the same reason. `GATED_REFERENCE_MODULES` lists only `_mcp.mds`.

**KB-AP-1, the presence arm.** With both tool-call providers registered, `deferredReferenceModuleSources()` returns an empty list on this tree. `tests/build-mds-generator-hosts.test.ts` therefore proves the predicate against a PROBE registry (`VARIANT_MODULES` filtered to drop every `MCP_BACKED_PROVIDER_SUBDIRS` entry) and asserts the contract module IS deferred there. Dropping only the first of two registered providers would leave the second holding the gate open, which is the probe going stale rather than the predicate breaking. `tests/packaging.test.ts` runs the companion arm on the roster, asserting `GATED_REFERENCE_MODULE_SOURCES` is non-empty, because a loop asserting every gated source still ships inside the tarball proves nothing over an empty roster.

**KB-INV-2, the pair floor (GAP-42).** `expandVariants` refuses a `'fanout'` module whose `ops` list is shorter than `MIN_VARIANT_PAIRS`: below it, "every op has a file and every file has an op" stops discriminating, because a list short enough to enumerate by hand is satisfied by any implementation that returns something. It applies per module and only to `'fanout'`: `_references.mds` (`'named'`) and the two contract modules are exempt by design (see `VariantModuleKind`'s doc comment for why a count proves nothing about a named or singleton set). `_pr.mds` sits closest to the floor (see the `PR_HOST_OPS` doc comment), so removing a couple of its ops refuses the build outright, while the provider modules carry headroom it lacks.

**KB-INV-9, `_pr.mds` imports nothing on purpose.** `@mdscript/mds`'s resolver deep-clones the entire definition-site scope into every `@define`, so compile cost is exponential in a module's own define count and multiplicative in the capture graph of anything selectively imported, not linear in body text. `_pr.mds` is a plain fan-out (one `@define` per op, no `@import` of `_tracker.mds` or `_common.mds`) because its ops share nothing with the tracker providers; importing a heavier module the way `_jira.mds` imports `_mcp.mds` and `_common.mds` costs seconds, not milliseconds, and would tax every full build the test suite spawns. Trimming a define body would not help: the cost is the count of cloned `FunctionDef` nodes, not their text.

**KB-INV-9, new shared step text goes in `_steps.mds`.** `_common.mds` went from tens of milliseconds to seconds when it gained defines, and every provider module importing it then compiled in seconds against `COMPILE_BUDGET_MS`. The provider-neutral step text that left the Git agent therefore lives in `_steps.mds` (imported by the three provider modules as the alias `steps`, listed in `MDS_REFERENCE_PARTIALS`), whose defines capture only one another, so it costs almost nothing. A define that would be `_common.mds`'s next one belongs in `_steps.mds` or a new partial.

**KB-INV-8, two manifests (D-INSTALL-ALL-PROVIDERS).** `generatedReferenceManifest()` names every file the resolved registry emits; `installedReferenceManifest()` is what the overlay converges `~/.claude/skills/devflow:git/references/` to, pruning anything under `CONVERGED_SUBTREES` it does not name. Since install-all, the installed manifest equals the generated one, `PR_HOST_DESTINATION_ROOT` unconditionally included, and the installer's prune leaves `pr/` standing across a provider switch. The pluggable tracker's 2026-09-19 status audit caught a footprint claim that did not name which manifest it measured.

**KB-AP-2, reference-file shape.** Every generated reference starts with its own `## Operation: {op}` (or cross-cutting) anchor and carries no further unfenced column-0 `## ` line; `tests/tracker/reference-structure.test.ts` polices this with the fence-aware `collectUnfencedH2` (a fenced `## ` inside a heredoc or template fence is exempt). Content belongs to `tracker-references`, but the test lives here because it polices this build's output shape. The splitter drops any module-level preamble above the first op marker, and a reference module containing a learning marker is refused.

## Key Files

- `src/core/mds-variants.ts` — `VARIANT_MODULES`, `MCP_CONTRACT_MODULE`, `TRACKER_OPS`, `TRACKER_GITHUB_OPS`, `PR_HOST_OPS`, `PR_HOST_DESTINATION_ROOT`, `GIT_CROSS_CUTTING_DOCS`, `TRACKER_DESTINATION_ROOT`, the gate predicates, `expandVariants` (a `too-few-pairs` refusal carries the offending `module`), `generatedReferenceManifest`, `installedReferenceManifest`, `SKILL_REFS_OUTPUT_DIR`
- `src/assets/mds/tracker/_github.mds`, `_jira.mds`, `_linear.mds`, `_mcp.mds`, `_contract.mds`, `src/assets/mds/git/_pr.mds`, `_references.mds` — the reference-module sources
- `src/assets/mds/tracker/_common.mds`, `_steps.mds` — the two reference partials: shared tracker lines, and provider-neutral step text kept apart so `_common.mds` stays at its define ceiling
- `tests/mds-variants.test.ts` — the pure core: name rules, `resolveOutputDir`, `expandVariants` (shipped expansion, the floor, one-element refusal, traversal and duplicate-output refusals, purity), `splitVariantSections` (bidirectional parity, empty-section refusal, marker edge cases), the gate functions (idempotence, gate-open and gate-closed probes) and `VARIANT_MODULES` shape over the current registry
- `tests/tracker/reference-structure.test.ts` — the anchor and unfenced-heading guard
- `tests/build-mds-generator-hosts.test.ts`, `tests/packaging.test.ts` — the presence arms for the gate
- `tests/build-mds-compile-time.test.ts` — the per-module compile budget and the alias-import probe
- `tests/fixtures/mds-manifest.ts` — `MDS_REFERENCE_MODULES` (which includes `_pr.mds`, `_contract.mds` and the gated `_mcp.mds`) and `MDS_REFERENCE_PARTIALS`

## Related

- `.devflow/features/feature-knowledge-system-mds-build/KNOWLEDGE.md` — the pipeline that expands, splits, writes and prunes these modules
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — the hub
- `.devflow/features/tracker-references/KNOWLEDGE.md` — what the generated reference files contain, the `_contract.md` text and moved step text, the byte-budget formula, and the installer's overlay into `devflow:git`
- `.devflow/features/tracker-feature/KNOWLEDGE.md` — how a provider is selected, what opens the `_mcp.mds` gate, and what the tool-call contract says; read it for the gate's meaning, this KB for the mechanism
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — the overlay, `CONVERGED_SUBTREES` and the unit-shape rule
- Principles applied here: classify the case, never blanket-widen (cited in `validateContractOutputName`'s own doc comment); an absence-based guard needs a presence arm; install-all supersedes the selection-scoped bundle, so the installer prune leaves `pr/` standing across a provider switch; compile cost is exponential in define count, so `_pr.mds` is authored import-free
