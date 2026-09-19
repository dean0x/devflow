---
feature: feature-knowledge-system
name: Feature Knowledge Base System
description: "Use when adding a new knowledge base entry, modifying how knowledge is loaded into agents, changing the write-through save model, extending the CLI knowledge commands, or working on the MDS build pipeline and its three host kinds (build-mds.ts, mds-variants.ts, git.mds) including the reference-module generation gate. Keywords: feature knowledge, KNOWLEDGE.md, write-through, knowledge_load, knowledge_writeback, build-mds, _knowledge.mds, index.md, apply-feature-knowledge, generator host, reference module, skill-refs, output-dir, dist/agents, mds-variants, validateOutputName, validateContractOutputName, resolveOutputDir, expandVariants, resolveVariantModules, splitVariantSections, VARIANT_MODULES, VariantModuleKind, TRACKER_OPS, TRACKER_GITHUB_OPS, GIT_CROSS_CUTTING_DOCS, MIN_VARIANT_PAIRS, MCP_CONTRACT_MODULE, MCP_BACKED_PROVIDER_SUBDIRS, mcpContractIsGenerated, deferredReferenceModuleSources, GATED_REFERENCE_MODULE_SOURCES, LEGALISED_IN_PHASE2, compiledSkillRefsDir, pruneOrphanReferences, stripGeneratorFrontmatter, mds-manifest, HostPlan, planHost, planSingleFile, planReferenceModule, destsOf, VariantSection, OperationNamed, generatedReferenceManifest, SKILL_REFS_SKILL_NAME, reference-sweep, reference-structure, MAX_REFERENCE_SWEEP_DEPTH."
category: architecture
directories:
  - src/cli/commands/knowledge
  - src/assets/skills/feature-knowledge
  - src/assets/skills/apply-feature-knowledge
  - src/assets/agents/knowledge.md
  - src/assets/commands/_partials
  - scripts/build-mds.ts
  - src/core/mds-variants.ts
  - src/assets/agents/git.mds
  - src/assets/mds/tracker
  - src/assets/mds/git/_references.mds
  - tests/fixtures/mds-manifest.ts
  - tests/build-mds-generator-hosts.test.ts
  - tests/guards/dist-agents.test.ts
created: 2026-06-21
updated: 2026-09-17
---

# Feature Knowledge Base System

## Overview

The Feature Knowledge Base System uses a **write-through** model. Knowledge is authored
in-command (at workflow end) by a simplified Knowledge agent that writes directly to
`.devflow/features/{slug}/KNOWLEDGE.md` and updates the `index.md` cache line. There is
no background refresh pipeline, no SessionEnd hook, no Learning task, and no deterministic
CJS engine.

**Source of truth = `KNOWLEDGE.md` frontmatter.** The `index.md` is a regenerable cache:
if it is absent or incomplete, `knowledge_load` falls back to globbing frontmatter across
all `features/*/KNOWLEDGE.md` files. A clobbered `index.md` is non-fatal.

`.devflow/` is local by default, but feature knowledge is the ONE exception (amends ADR-021):
the root `.gitignore` carve-out (`.devflow/*` + level-by-level `!` re-includes) tracks
`.devflow/features/index.md` + every `{slug}/KNOWLEDGE.md`, and the Knowledge agent commits
those paths to the current branch itself (scoped pathspec, no push, no force, no script). A
team opts back out by re-adding `.devflow/features/` to their own `.gitignore`.

This knowledge base also covers the **MDS build pipeline** (`scripts/build-mds.ts` +
`src/core/mds-variants.ts`) that compiles `.mds` sources into three output kinds:
`dist/commands/` (13 command hosts), `dist/agents/` (1 generator host, the Git agent), and
`dist/skills/git/references/` (five **reference-module sources** that fan out into 34 files
today: `_github.mds`, `_jira.mds`, and `_linear.mds` — three provider modules that each read
the SAME shared `TRACKER_OPS` roster, 10 ops apiece — plus `_references.mds` (3 named
cross-cutting documents) and `_mcp.mds`, a provider-independent tool-call **contract module**
whose generation is gated on at least one tool-call-backed provider being registered
(`mcpContractIsGenerated`) — the gate is open on this tree, so all five sources compile and
nothing is deferred). `build-mds.ts` is the single compiler for all three host kinds, so
several KBs legitimately cover it from different sides: **this KB owns the pipeline itself**
— discovery (including the deferred/gated census bucket), destination validation, the
frontmatter strips, variant expansion/section-splitting, and the prune step, for all three
variants. The sibling `tracker-references` KB owns what the GitHub reference files
**contain** (the tracker operation mechanics, the byte-budget formula, and the installer's
overlay of the compiled tree into the shipped `devflow:git` skill); `tracker-feature` owns
the **provider dimension** — how a provider is selected, what opens the `_mcp.mds` gate, and
what the contract document itself says — read that KB for the gate's *meaning*, this one for
the compiler *mechanism* that implements it. The `dynamic-workflow-engine` KB owns the
command-host side (what the compiled commands must say). The knowledge partials
(`_knowledge.mds`) are themselves MDS sources, which is why the mechanism is documented here
rather than only where its outputs are asserted.

## System Context

**Purpose**: Give agents pre-computed codebase context for their specific task area without
requiring them to explore from scratch each session.

**Role in larger system**: One of two persistence layers under `.devflow/` (alongside the
Decisions pipeline). Knowledge is NOT a Learning task — it is written in-command. Working
memory is handled by the background-memory-update worker.

**External dependencies**: MDS compiler (`@mdscript/mds`) at build time to compile the
knowledge partials, the Git agent generator host, AND the reference modules; `claude` agent
at runtime (the Knowledge agent, model=sonnet) to write KNOWLEDGE.md.

**Toggle**: `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`.
Feature state lives in `.devflow/config.json` (field `knowledge`, default `true`; see `src/core/feature-config.ts`).
Gates write-back ONLY — load is ungated (harmless). No sentinel file.

## Component Architecture

| Component | Path | Role |
|-----------|------|------|
| MDS partial module | `src/assets/commands/_partials/_knowledge.mds` | Defines + exports `knowledge_load` and `knowledge_writeback` |
| Host command sources (9) | `src/assets/commands/{name}.mds` | Command bodies that `@import "_partials/_knowledge.mds"` and call the partials |
| Host command sources (4 dynamic) | `src/assets/commands/dynamic-*.mds` | Dynamic workflow commands — `@import` various `_partials/*.mds`; not knowledge-specific |
| Build script | `scripts/build-mds.ts` | Frontmatter-driven: walks the whole repo (minus `IGNORE_DIRS`, to a bounded depth) for `.mds` files declaring a non-empty `output-dir:`, buckets each into host / partial / **deferred** (a reference module the registry knows about but whose generation gate is shut), validates the destination + emitted filename(s) via `src/core/mds-variants.ts`, and compiles each host to `{output-dir}/{name}.md` (command/agent hosts) or to `{output-dir}/{subdir}/{op}.md` per operation (reference modules); refuses two hosts claiming one destination (via `planHost`'s `HostPlan` union and the uniform `destsOf()` view over it); prunes unclaimed `.md` files from `dist/agents/` and, recursively, from `dist/skills/git/references/`, after a clean build; hard-fails on any error |
| Output validation + variant module | `src/core/mds-variants.ts` | Pure, zero-I/O core module. Answers five questions for an MDS host: is the emitted filename safe (`validateOutputName` / `validateContractOutputName`); is the declared directory writable, and which `HostVariant` does it select (`resolveOutputDir`, 3-entry allowlist); which files does a reference module fan out into (`expandVariants` over the *resolved* `VARIANT_MODULES` registry, `resolveVariantModules()`); which slice of the compiled body belongs to each (`splitVariantSections<T extends OperationNamed>`, returning `Result<readonly VariantSection<T>[], SectionSplitError>` keyed to the caller's own records — no lookup, no non-null assertion); which files does the shipped registry produce, flattened into the installer's converge manifest (`generatedReferenceManifest`). Also exports `SKILL_REFS_SKILL_NAME` (`'git'`, the one fact `SKILL_REFS_OUTPUT_DIR` is composed from) and the generation-gate predicates (`mcpContractIsGenerated`, `deferredReferenceModuleSources`, `GATED_REFERENCE_MODULE_SOURCES`, `MCP_BACKED_PROVIDER_SUBDIRS`). Returns `Result`, never throws or exits — the shell (`build-mds.ts`) owns every `process.exit` (avoids PF-014, applies ADR-013) |
| Generator host | `src/assets/agents/git.mds` | The Git agent's `.mds` source; declares `output-dir: dist/agents` in a first frontmatter block, carries the agent's real frontmatter (name/description/model/skills) in a second block; compiles to `dist/agents/git.md` |
| Reference modules (5 sources) | `src/assets/mds/tracker/_github.mds`, `_jira.mds`, `_linear.mds`, `_mcp.mds`; `src/assets/mds/git/_references.mds` | ONE leading steering block (`output-dir: dist/skills/git/references`) each; the stripped body is a concatenation of per-operation sections, each introduced by a `<!-- op: NAME -->` marker, compiled to one file per op under `{output-dir}/{subdir}/{op}.md`. `_github.mds` / `_jira.mds` / `_linear.mds` are `kind: 'fanout'` (10 ops each, the shared `TRACKER_OPS` roster); `_references.mds` is `kind: 'named'` (3 fixed cross-cutting docs at the references root); `_mcp.mds` is `kind: 'contract'` (1 doc, `tracker/_mcp.md`, generation-gated). Content ownership belongs to `tracker-references` (GitHub mechanics, byte budget, installer overlay) and `tracker-feature` (the provider dimension, the gate, the contract text) — see those KBs for what each op's mechanics say |
| Reference-module registry | `VARIANT_MODULES` in `src/core/mds-variants.ts` | `{ source, subdir, kind: 'fanout' \| 'named' \| 'contract', ops }[]` — 4 entries registered unconditionally (three provider `'fanout'` rows plus the `'named'` cross-cutting row); `resolveVariantModules()` conditionally appends a 5th, `MCP_CONTRACT_MODULE`, only while `mcpContractIsGenerated()` is true — a `skill-refs` host whose source path is absent from the *resolved* registry is refused rather than guessed at |
| Reference-module generation gate | `mcpContractIsGenerated`, `deferredReferenceModuleSources`, `GATED_REFERENCE_MODULE_SOURCES`, `MCP_BACKED_PROVIDER_SUBDIRS` (`src/core/mds-variants.ts`) | Answers "does anything load `tracker/_mcp.md`?" as a predicate DERIVED from the registry's own shape, never a stored flag or a phase marker: `MCP_BACKED_PROVIDER_SUBDIRS` names the two provider subdirs (`tracker/jira`, `tracker/linear`) whose mechanics reach the tracker through a tool call rather than a CLI, and registering such a provider module is the same edit as opening the gate. The build's `discoverHosts()` reads `deferredReferenceModuleSources()` once per build and buckets any matching `.mds` path into a third census bucket (`deferred`) before it can become a `HostEntry` or a counted partial |
| Prune/sweep depth bound | `src/core/reference-sweep.ts` | Exports `MAX_REFERENCE_SWEEP_DEPTH` (8), the descent bound shared by the build's own `pruneOrphans` (throws on breach — `dist/` is the build's own tree to fail) and the installer's `sweepOrphanedReferences` (reports the unswept subtree into `failed` on breach, avoids PF-009); one bound, two deliberately different failure postures for the same breach |
| MDS name manifest | `tests/fixtures/mds-manifest.ts` | `MDS_COMMAND_HOSTS` (13), `MDS_PARTIALS` (12), `MDS_GENERATOR_HOSTS` (`['git']`), `MDS_REFERENCE_MODULES` (5 source paths, including the gated `_mcp.mds`), `ALL_MDS_HOSTS` (14 — filenames only, excludes reference modules by construction), `ALL_DISCOVERED_HOSTS` (19 = 13 command + 1 generator + 5 reference-module sources — everything `output-dir:` finds, gated or not), `DIST_COMMAND_FILES` (14, incl. hand-authored `release.md`) — the single named-set source every count-literal test compares against, in both directions |
| Author agent | `src/assets/agents/knowledge.md` | Writes KNOWLEDGE.md + updates index.md line directly; model=sonnet |
| Author skill | `src/assets/skills/feature-knowledge/SKILL.md` | 4-phase authoring + KNOWLEDGE.md template + index.md registration |
| Consumption skill | `src/assets/skills/apply-feature-knowledge/SKILL.md` | 3-step algorithm for agents loading FEATURE_KNOWLEDGE |
| CLI list | `src/cli/commands/knowledge/list.ts` | Reads index.md / falls back to frontmatter glob; no external scripts |
| CLI toggle | `src/cli/commands/knowledge/toggle.ts` | Flips `knowledge` key in `.devflow/config.json` via `feature-config.ts`; no sentinel creation |

## Component Interactions

### Flow 1: Loading (consumption)

Invoked at the start of applicable workflows via `knowledge_load()` MDS call site.

1. **Read cache** — read `.devflow/features/index.md` if present
2. **Fallback** — if absent or thin, glob `features/*/KNOWLEDGE.md` frontmatter
3. **Select** — pick relevant KBs by comparing task area against each entry's `description` + `directories`
4. **Read bodies** — Read each selected `KNOWLEDGE.md`, verify-against-code on mismatch
5. **Set FEATURE_KNOWLEDGE** — concatenate under `--- Feature knowledge: {slug} ---` headers; `(none)` if no KBs found

**Zero subprocess calls** — load is pure file I/O; no git calls, no node scripts.

**Asymmetry** (hard requirement):
- `knowledge_load` used by: implement, plan, resolve, code-review, self-review, research, bug-analysis
- `knowledge_writeback` only (no load) used by: explore, debug (investigators read code fresh — no confirmation bias)

### Flow 2: Saving (write-through)

Invoked at the end of applicable workflows via `knowledge_writeback()` MDS call site.

1. **Gate** — if `.devflow/config.json` `knowledge` is `false`, skip entirely
2. **Check scope** — if this workflow changed a documented area OR found durable cross-cutting knowledge, proceed
3. **Spawn Knowledge agent** — `Agent(subagent_type="Knowledge")` with WORKTREE_PATH, FEATURE_SLUG, FEATURE_NAME, DIRECTORIES, FILES_CHANGED, DECISIONS_CONTEXT, EXISTING_KB, EXPLORATION_OUTPUTS
4. **Agent writes KNOWLEDGE.md** — directly to `.devflow/features/{slug}/KNOWLEDGE.md`
5. **Agent updates index.md** — read-modify-write `index.md`; replace existing slug line or append; create file if absent
   - Line format: `- **{slug}** — {areas} — {Use-when description}`
6. **No result file** — no `.create-result.json`, no handoff artifact

### Flow 3: MDS build-time compilation

`npm run build:mds` (part of `npm run build` = `build:cli` + `build:mds`; `build:mds` alone never wipes `dist/`, so it can be run standalone against a working tree):

1. Walks the repo from root, skipping `IGNORE_DIRS`: `node_modules`, `dist`, `.git`, `.devflow`, `.claude`, `.release`, `tmp`, `tests`, `coverage` (`tests` and `coverage` are skipped so a `.mds` committed under either — a fixture or a coverage artifact, never a shipped host — can never be compiled into the real `dist/` tree; the skip is by directory **name**, so it holds under `DEVFLOW_MDS_ROOT` as well, and a fixture host planted at `<tmpRoot>/tests/` is likewise invisible. A `DEVFLOW_MDS_ROOT` env var lets negative-path tests redirect the whole walk to a throwaway temp root instead of the real repo). The recursion is bounded by `MAX_WALK_DEPTH` (12, counting the root as depth 0; the deepest `.mds` in the shipped tree sits at depth 4 and the deepest directory under `src/assets/` at depth 6). The bound **throws**, it does not truncate: a host skipped for being too deep would compile nothing while the build still printed its counts and exited 0, and no test could distinguish "not there" from "never looked" (PF-018). `readdirSync` tolerates `ENOENT`/`ENOTDIR` (an entry can vanish between the parent's readdir and the descent) and rethrows everything else
2. Before any frontmatter is read, each walked path is checked against `deferredReferenceModuleSources()` (computed once, from the one owner in `mds-variants.ts`): a path the registry knows about but whose generation gate is shut this build is bucketed straight into `deferred` and skipped — it never becomes a `HostEntry` and is never counted as a partial. For every other file: reads the FIRST `---…---` frontmatter block with a scalar regex (`readFrontmatterKey`, not a YAML parse — the build must not gain a YAML dependency); if it declares a non-empty `output-dir:` key, treats it as a host, else a partial (skipped). `BUILD_KEYS` (`output-dir`, `output-name`) is the one list of keys the build consumes; it drives both the read here and the strip in step 5 (for command hosts), so a key the build reads can never leak into a shipped artifact. A build key that is present but **valueless** is a malformed host and hard-fails during discovery with an explicit message (`output-dir: is empty …`, `output-name: is empty …`) — `readFrontmatterKey` returns `''` (not null) for a bare key, so `?? basename` would not fire and a silent basename fallback would hide the authoring mistake. Discovery precedes every plan and every write, so this exit leaves `dist/` wholly untouched
3. Validates the declared `output-dir` via `resolveOutputDir(root, declared)` from `src/core/mds-variants.ts`: containment (`isContainedIn`) → backslash rejection (declarations are POSIX-spelled by contract; `path.posix.normalize` leaves `\` untouched, so `dist\commands` would pass the canonical check on win32) → canonical-spelling check (POSIX-normalized, no trailing slash — `dist/commands/`, `./dist/agents`, `dist/skills/../commands` all refused) → allowlist match. On success it returns `{ variant, abs }` — the resolved absolute directory plus the `HostVariant` (`'commands' | 'agents' | 'skill-refs'`) the matching allowlist entry declares, which is what selects the strip strategy in step 5. All four error kinds (`escapes-root`, `backslash-separator`, `non-canonical`, `not-allowlisted`) are rendered by an exhaustive `switch` with a `never` default in `build-mds.ts` and **thrown**, so `main()`'s aggregation reports every refusal and exits 1 once after the loop — no mid-loop `process.exit` leaving `dist/` half-updated
4. **Plans the destination(s) before writing anything** (`planHost`, in `scripts/build-mds.ts`). `planHost` dispatches on the `HostVariant` returned in step 3 through an exhaustive `switch` (`never` default) to one of two strategies, each returning the same `HostPlan` type — a discriminated union on `variant`: the one-file arm (`commands`/`agents`) carries a single `dest`; the fan-out arm (`skill-refs`) carries `outputs: readonly PlannedReference[]`, each entry pairing its `dest` with the `(module, op)` pair that fills it, so there is no parallel-array correspondence to maintain and no arm can read a field the other arm owns. `destsOf(plan)` gives every caller that needs the uniform 'every file this host claims' view — the plan pass's claims loop, the contested-destination filter, the prune's claimed set — one function regardless of which arm it is. `planSingleFile` (commands/agents): the emitted filename (source basename, or the optional `output-name:` key's value) is validated via `validateOutputName` — charset `^[a-z0-9][a-z0-9._-]{0,63}$`, refuses `..`/`.` segments and path separators. `planReferenceModule` (skill-refs): `output-name:` is **refused outright** (there is nothing for it to name — see Gotchas), the module's source path is looked up via `referenceModuleFor`, which resolves against `resolveVariantModules()` — the GATED registry, never the raw `VARIANT_MODULES` constant, so a gated-but-open module is found the same way an unconditional one is — and `expandVariants([mod])` turns its `ops` list into the flat `(module, op)` pair list this host will emit, each path re-validated segment-by-segment (`validateContractOutputName` in place of `validateOutputName` for a `'contract'`-kind module, since its op name carries a mandatory leading underscore). Every host's destination(s) — read through `destsOf()` — are recorded in a `Map<destAbs, HostEntry[]>` across the WHOLE plan pass — a destination claimed by two or more hosts disqualifies **every** claimant (letting the first win would pick arbitrarily between two equally-declared intents), and the build errors naming all claimants while unrelated healthy hosts still compile
5. Compiles each host via `@mdscript/mds` `compileFile()`, THEN strips frontmatter — dispatched by an exhaustive `switch` over the `HostVariant` returned in step 3 (`never` default), never by comparing the resolved path against a re-derived destination constant. `commands` → `stripBuildKeys` removes every `BUILD_KEYS` line from the single real frontmatter block (every other key survives byte-untouched — no YAML round-trip); `agents` → `stripGeneratorFrontmatter` removes the ENTIRE first frontmatter block, promoting the second block (the artifact's real frontmatter) into place — verified on both ends (PRE: a leading block must exist; POST: a second block must be what the slice exposes — a single-block host, the shape every hand-authored agent has, would otherwise ship headerless with the build reporting success, PF-061); `skill-refs` → `stripReferenceFrontmatter` also removes the one leading block but verifies the OPPOSITE postcondition — a second block must NOT follow it, because a skill reference ships as plain markdown with no frontmatter at all (an author copying the generator-host habit of two blocks would otherwise leak `output-dir:` into every emitted file as content). All three strips run AFTER `compileFile` — the compiler emits a byte-0 frontmatter block verbatim, so block 1 survives compilation unchanged and is safe to slice off afterward
6. For `skill-refs`, `materializeOutputs` then hands the stripped body to `splitVariantSections<T extends OperationNamed>(body, entries)` (the same pure module) — `entries` is each planned output's own `{dest, op}` record (from the plan's `outputs`), so the function returns exactly one `VariantSection<T>` per entry passed in, each carrying a `content` field alongside the caller's original fields; there is no separate lookup structure and no non-null assertion, because the destination travels WITH its content rather than beside it in a map. The splitter walks the body line by line for `<!-- op: NAME -->` markers, drops any module-level preamble before the first marker (it belongs to no operation, so shipping it would duplicate it into every file — `_linear.mds`'s `## Known Unknowns` section, which documents two inherited-not-measured facts for a human reading the source, is exactly this: it sits above the first marker and is emitted nowhere), and returns `Result<readonly VariantSection<T>[], SectionSplitError>`. Bidirectional and load-bearing both ways: `unknown-section` (a marker names an op the registry doesn't) and `missing-section` (the registry names an op the body never marks) both refuse the build; `empty-section` is a third, independent refusal (GAP-44) for a marker whose body is blank — the other two checks cannot see it, because a marker with an empty body compiles cleanly and would otherwise ship a zero-byte reference with no build signal at all
7. Writes each output — `{basename}.md`, `{output-name}.md`, or `{subdir}/{op}.md` per pair — to the declared `output-dir` via a temp file (`{dest}.{pid}.tmp` — scoped to the writing process so two concurrent builds never share one staging path) + `renameSync` (per-file atomic; the `.tmp` is cleaned up on rename failure; concurrent readers, e.g. parallel vitest workers, never see a partial write — avoids PF-011, whose ENOENT-window shape is exactly what the temp-then-rename sequence closes)
8. Hard-fails on any compile error — no stale command ever ships. Prints `N partial(s) skipped (no output-dir:)`, `N reference module(s) deferred (generation gated)` — naming each held-back source (`deferred: {source} (no registered provider needs it yet)`) — and `N host(s) to compile:`; all three lines are parsed by `tests/build-mds-generator-hosts.test.ts` §6 (AC-1.8) and the PF-064 non-vacuity arm in `tests/packaging.test.ts`; do not reword them. The deferred count is subtracted from the partial-count arithmetic EXPLICITLY (`totalCount - hosts.length - deferred.length`) rather than left to fall out of it, so a gated module can never silently move the partial count for a reason that is not a roster change. There is **no separate "references emitted" line**: a reference module's fan-out is folded into the same `compiled: {source} → {dest}` line every host prints, rendered as `{outDir}/ (N file(s))` when a host emits more than one file, rather than as a distinct census line
9. **Prunes** (`main()`, only after step 8 finds zero errors): `pruneOrphanAgents` deletes every `.md` under `dist/agents/` that no host in this build emitted, one `pruned: {path} (no generator host)` line each; `pruneOrphanReferences` runs the SAME sweep (shared `pruneOrphans` helper, bounded by the shared `MAX_REFERENCE_SWEEP_DEPTH` constant — 8, owned by and imported from `src/core/reference-sweep.ts` rather than redeclared) recursively over `dist/skills/git/references/`, one `pruned: {path} (no reference module)` line each — recursion is not optional there, since the tree is nested `tracker/{provider}/{op}.md` (plus the flat `tracker/_mcp.md`) and a flat sweep would leave every orphan exactly where it lives. A breach (`depth > MAX_REFERENCE_SWEEP_DEPTH`, the walked root counted as depth 0) is answered differently by the build's own `pruneOrphans`, which **throws** (a generated tree that deep is a build bug, and `dist/` is the build's own tree to fail), than by the installer's `sweepOrphanedReferences` in the same module, which instead **reports** the unswept subtree into its `failed` array (avoids PF-009 — one bad subtree does not abort the whole install); one constant, two call sites, two deliberately different failure postures for the same breach. Both directories are gitignored and outrank their `src/` counterparts in every consumer that resolves from them, so a file left behind installs in preference to the audited source on every `devflow init`. Scope is deliberate: **`dist/commands/` is never pruned** (it also receives `release.md`, copied verbatim from a hand-authored source that is not a host); non-`.md` entries are left alone in every pruned directory (a concurrent build's `{dest}.{pid}.tmp` staging file lives there); and a refused build prunes nothing. `AGENTS_OUTPUT_DIR` and `SKILL_REFS_OUTPUT_DIR` (both the allowlist table's own spellings) name the prune targets even when zero hosts of that kind are planned — the case where every file in the directory is an orphan, so the target cannot be derived from the plan

**What is and isn't test-verified today**: `pruneOrphanAgents` has a dedicated describe block ("orphans in dist/agents/ are pruned") in `tests/build-mds-generator-hosts.test.ts` covering delete-and-report, claimed-survives, refused-build-prunes-nothing, non-`.md`-survives, and `dist/commands/`-untouched. `pruneOrphanReferences` shares the same `pruneOrphans` implementation. The dedicated describe `dist/skills/git/references orphan prune` in `tests/build-mds-generator-hosts.test.ts` covers the following cases: unclaimed files are pruned and reported; nested directories are pruned; claimed outputs survive; non-`.md` staging files survive; root-level planted files are pruned because the build prune sweeps the entire generated tree root-included (unlike the installer's prune, which narrows to `references/tracker/**` because the installed skill dir mixes generated and hand-authored sources); refused builds perform no prune operation; depth-8 descent succeeds; depth-9+ descent fails without pruning.

The 13/14/14 count rule is owned by the `dynamic-workflow-engine` KB — see there for which number counts what and why the two 14s are different sets. The discovery census (step 8 above) reports **12 partials / 19 hosts / 0 deferred** today (`MDS_PARTIALS.length` / `ALL_DISCOVERED_HOSTS.length` / `deferredReferenceModuleSources().length`), where 19 = 13 command hosts + 1 generator host + 5 reference-module sources. The deferred count is a live measurement rather than a constant: it reads 0 while a tool-call-backed provider (`jira`, `linear`) is registered — as this tree has — and reads 1, naming `src/assets/mds/tracker/_mcp.mds`, for a registry with every `MCP_BACKED_PROVIDER_SUBDIRS` entry removed. Both readings are asserted directly, not assumed, by the PF-064 non-vacuity arms described in Gotchas. `DIST_COMMAND_FILES` (14 files in `dist/commands/`) is unaffected — reference modules write nowhere near that directory.

What this KB owns is the split those numbers count: the build has three host kinds. 13 MDS-compiled **command** hosts (`MDS_COMMAND_HOSTS`) — 9 knowledge hosts + 4 dynamic hosts — plus one **generator host** (`src/assets/agents/git.mds` → `dist/agents/git.md`) plus five **reference-module sources** (`MDS_REFERENCE_MODULES`) — four registered unconditionally and one (`_mcp.mds`) generation-gated — all fanning out to `dist/skills/git/references/` when compiled, 34 files today (10 GitHub-op files + 10 Jira-op files + 10 Linear-op files from the shared `TRACKER_OPS` roster + 3 named cross-cutting documents + the 1 gated contract document). `MDS_PARTIALS` (12, `src/assets/commands/_partials/`) have no `output-dir:` and are skipped automatically; the `_` prefix convention is also enforced structurally — `validateOutputName` would refuse a filename starting with `_` if a partial were ever mistakenly treated as a one-file host, while a `'contract'`-kind reference module's op name REQUIRES the same leading underscore under a second, dedicated rule (`validateContractOutputName`) — the two rules point opposite directions on purpose (see Gotchas).

## Integration Patterns

**index.md as regenerable cache**: If `index.md` is absent, `knowledge_load` globs
frontmatter and continues normally. Write-through recreates it on the next writeback.
There is no consistency risk from a missing index.

**knowledge_writeback conditionality**: The writeback call site is always present in the
compiled command, but the gate (`knowledge: false`) and the condition (documented area
changed / cross-cutting knowledge found) mean the Knowledge agent spawns only when useful.
If neither condition is met, write-back is a no-op.

**DECISIONS_CONTEXT injection**: `knowledge_writeback` passes `DECISIONS_CONTEXT` to the
Knowledge agent so it can cross-reference ADR/PF entries when authoring the KB.

**research.md bespoke knowledge**: `/research` Phase 7 (user-gated) has its own bespoke
knowledge creation block instead of using `knowledge_writeback()`, because the plan's
writeback list omits research. This is intentional — the bespoke block is the equivalent
of `knowledge_writeback` for the research workflow.

**dist/ as a shipping artifact area with three destinations**: Compiling the Git agent and
the reference modules makes `dist/agents/` and `dist/skills/git/references/` shipping
output directories alongside `dist/commands/`. `dist/agents/` carries the same three
properties `tests/guards/dist-agents.test.ts` enforces: (a) source↔output parity in both
directions, fail-loud (never a silent `catch { return }` skip on a missing build — PF-018),
(b) no leaked `\{`/`\}` escape sequences in compiled output (PF-024), (c) no agent with both
a hand-authored `.md` and a generator `.mds` source (the resolver would silently pick a
winner). The dist-first precedence has exactly one owner: `agentSourceDirs()` in
`src/core/assets.ts`, a non-empty tuple spelled MOST-PREFERRED FIRST
(`[compiledAgentsDir(), agentsDir()]`). Order is invisible to the type system — a list
spelled the other way round still typechecks and silently inverts the answer — so every
consumer takes that list as-is and never re-spells it. Consumers: the installer's
agent-source loop (first hit wins; a hit on no directory throws, naming every candidate
path plus an `npm run build:mds` hint); `loadShippedDefaults(dirs = agentSourceDirs(),
opts)` (walks the list first-wins over a per-directory `readDirDefaults(dir)`, tolerating
a missing directory symmetrically on EVERY entry). The test resolver `resolveAgentSource` in
`tests/helpers.ts` reads the same order from `agentSourceDirs()` but is a different resolver
with a stricter contract: only its dist side is ENOENT-tolerant, and a missing src file
throws with a build hint. `dist/skills/git/references/` has an analogous accessor,
`compiledSkillRefsDir()` in `src/core/assets.ts`, which reads `SKILL_REFS_OUTPUT_DIR` off
the allowlist table rather than re-spelling the path — the installer's reference overlay
(owned by the `tracker-references` and `installer-shadowing` KBs) is that directory's
consumer, the way `agentSourceDirs()`'s installer loop consumes `dist/agents/`. Since
`_mcp.mds` lands as a flat file (`tracker/_mcp.md`) beside the provider directories
(`tracker/github/`, `tracker/jira/`, `tracker/linear/`), the overlay's own unit-shape rule
(`D-OVERLAY-PROVIDER-SHAPE`, owned by `installer-shadowing`) is what tells that bare file
apart from a provider subdirectory during install — this KB's registry only decides the
generated SHAPE (via `subdir`), never the overlay's grouping of it. `npm run
build:cli` alone produces no installable agents or references — `npm run build:mds`
(or the combined `npm run build`) is required.

## Constraints

- **500-line cap**: KNOWLEDGE.md exceeding 500 lines must be split into focused sub-knowledge bases.
- **index.md line format**: `- **{slug}** — {areas} — {Use-when description}` — frontmatter is authoritative if the line format changes.
- **No sentinel gating**: The old `.devflow/features/.disabled` sentinel is gone (clean break). Config-only gate per ADR-001 — the `knowledge` key in `.devflow/config.json` is the sole toggle.
- **No concurrent lock**: `index.md` write-through may clobber concurrent writes, but the frontmatter fallback self-heals. `index.md` is git-tracked (shared), so it can also merge-conflict when two branches add different slugs — resolve by keeping both lines.
- **Output-dir allowlist is closed, three entries**: `ALLOWED_OUTPUT_DIRS` in `mds-variants.ts` holds `{ dir: 'dist/commands', variant: 'commands' }`, `{ dir: 'dist/agents', variant: 'agents' }`, and `{ dir: 'dist/skills/git/references', variant: 'skill-refs' }` (D-SKILLREFS-ALLOWLIST — the third entry is deliberate: the alternative was letting the build write reference files through a path composed outside `resolveOutputDir`, which would have made the allowlist a partial gate, true for two destinations and bypassed for the third). The generation gate on `_mcp.mds` does NOT add a fourth destination — a gated module still resolves to the same `skill-refs` variant and the same `SKILL_REFS_OUTPUT_DIR` allowlist entry as every other reference module; only its `subdir` (`tracker`, not `tracker/{provider}`) and its op-name rule differ. Adding a fourth *directory* means adding it to the allowlist table — `satisfies` forces the new entry to declare a `HostVariant`, and `_EveryVariantHasADirectory` is the reverse compile-time proof (a `HostVariant` member with no table entry is unreachable and fails to typecheck). Introducing a new variant widens the union and breaks every exhaustive dispatch over it until the new case is handled (that is the intended friction, not an obstacle to route around).
- **Phase-2 scope fence (AC-1.2, narrowed from Phase 1)**: `tests/guards/dist-agents.test.ts` still forbids `@if` conditionals, a `variants:` YAML key, the `tracker-<provider>.md` filename token, the `{provider}.md` templated output name, and `@import`/`@define` inside a compiled AGENT host — none of these exist on this tree either; the generated tree is `tracker/{provider}/{op}.md`, driven by the typed `VARIANT_MODULES` registry, not by a template or a conditional. Two constructs were deliberately **legalised** and are named in `LEGALISED_IN_PHASE2` rather than silently dropped from the forbidden list (ADR-003 — narrowing must be visible, not silent): the literal strings `expandVariants(` and `(module, op)`, both of which now live in `src/core/mds-variants.ts` and `scripts/build-mds.ts` — the guard's own corpus. A later legalisation must update `LEGALISED_IN_PHASE2` (and the guard has its own test proving the fence still forbids ≥6 constructs after the narrowing).

## Anti-Patterns

**Calling feature-knowledge.cjs**: This file no longer exists. All knowledge I/O is direct
file reads in `knowledge_load` (the MDS partial) and direct writes by the Knowledge agent.

**Writing to .create-result.json**: The handoff result file pattern is abolished. The
Knowledge agent writes KNOWLEDGE.md and index.md directly; no intermediate files.

**Passing FEATURE_KNOWLEDGE to /explore or /debug investigation workers**: These workflows
call `knowledge_writeback` only (no load). Investigators read code fresh to avoid
confirmation bias.

**Using index.json**: The old `index.json` (object keyed by slug) is deprecated. The new
`index.md` uses one line per KB in `- **{slug}** — {areas} — {Use-when}` format. If you
see `index.json`, it is a deprecated artifact — run `devflow init` to rename it.

**Depending on referencedFiles in frontmatter**: The `referencedFiles` field is no longer
used by the system (staleness detection is removed). Existing KBs may still have it in
their frontmatter — it is silently ignored. New KBs should omit it.

**De-indenting an MDS fence to "simplify" it**: Column-0 ` ``` ` fences are the only raw
(non-interpolated) text in an `.mds` source. Indenting a fence — or de-indenting one that
was deliberately indented — flips its interpolation treatment and is NOT byte-preserving.
This rule is load-bearing across `git.mds` and every reference module under
`src/assets/mds/tracker/` and `src/assets/mds/git/`, which carry the same MDS grammar and
the same escaping discipline for any prose moved between them.

**Adding a new build destination without editing `mds-variants.ts`**: `resolveOutputDir`'s
allowlist is the single gate on where the build may write. A host declaring an
unlisted `output-dir:` (even a real, sensible-looking path) is refused with the `typo?`
message — this is by design, not a bug to route around by hardcoding a path elsewhere.

## Gotchas

**`knowledge_writeback()` is conditional, not unconditional**: The partial always checks
the config gate AND the area-change condition before spawning the Knowledge agent. A
workflow that changes no documented area and finds no cross-cutting knowledge skips the
agent spawn entirely. This is by design (P2: no unconditional spawns).

**index.md is the cache, not the source of truth**: `knowledge_load` uses it as a fast
path. If it is stale or absent, frontmatter glob is the authoritative fallback. Never
treat a missing `index.md` as a problem — write-through creates it lazily.

**The knowledge config key is the sole gate**: ADR-001 requires config-only gates. The
`knowledge` key in `.devflow/config.json` gates write-back. The old sentinel
(`.devflow/features/.disabled`) is gone via the clean break — no migration removes it
because it was never deployed on this branch.

**MDS brace-escaping**: In the `.mds` host files, every literal `{…}` in prose (including
inline code and prose inside indented fences) must be escaped as `\{…\}`; only column-0
` ``` ` fences are raw. `~~~` fences, inline code, and prose are all interpolated —
`\{x\}` compiles to the literal `{x}`, an unescaped `{x}` is treated as a param
reference, and 2+ blank lines collapse to 1 (even inside fences). `stripGeneratorFrontmatter`,
`stripBuildKeys`, and `stripReferenceFrontmatter` all run on the compiler's OUTPUT, after
this interpolation has already happened — they never see or touch escape sequences.

**A verbatim move between `.mds` files is not free of grammar hazards (PF-063)**: prose
(including headings) relocated out of `git.mds` and its skill body into a reference module
carries the SOURCE file's grammar assumptions into a DESTINATION parsed by a different one
— a generated reference is sliced by heading level and by the `<!-- op: -->` marker regex,
not by the source file's conventions, so text that was an ordinary section heading in one
file can become a section TERMINATOR in another. A byte-identical move is not automatically
a semantics-preserving one; check moved text against the destination's grammar, not the
source's. Full incident detail (the SKILL.md → `ensure-traceable-issue.md` case) lives in
PF-063 and in the `tracker-references` KB. The structural half of the remedy — forbidding
the reserved token at the destination rather than only avoiding it by convention — is
asserted by `tests/tracker/reference-structure.test.ts`: every generated reference under
`dist/skills/git/references/` must start with its own `## Operation: {op}` (or
cross-cutting) anchor and carry no further UNFENCED column-0 `## ` line after it (a
FENCED `## ` — inside a heredoc or a template fence a provider module ships on purpose,
e.g. `manage-debt.md`'s `## Items` or `ensure-traceable-issue.md`'s D3 template — is
exempt, via the fence-aware `collectUnfencedH2` helper in `tests/helpers.ts`, because
demoting THOSE headings would change what the tracker renders). Every emitted file also
clears a content floor (`MIN_REFERENCE_CHARS = 80`, asserted in `tests/tracker/
containment.test.ts` / `linear-module.test.ts` — a thinness guard owned by the
`tracker-references`/`tracker-feature` test suite, not by the build itself; the build's own
emptiness check, `empty-section`, only refuses a fully blank section, not a merely thin one).

**Converting a hand-authored agent to a generator host is not a re-emit**: The conversion
method that produced `git.mds` was `git mv` + a scripted fence-state-machine transform +
`cmp` against the golden fixture, never a fresh re-write of the body — regenerating the
body from scratch risks losing exact byte parity with `tests/fixtures/golden/git-agent.md`
(66,180 bytes, `GIT_AGENT_BYTES` derived once via `stat`, never hand-typed — PF-057: goldens
are compared, never regenerated by hand).

**output-dir: is kept as the last frontmatter key in host .mds files (test convention, not a strip requirement)**:
A `build-mds.test.ts` case asserts `output-dir:` is the last key in every command host's frontmatter, so keep it
last to satisfy the test. This is a style convention only — `stripBuildKeys`'s block-scoped regex removes
each build-owned key line regardless of its position, so key ordering does not affect byte-identity of the
compiled output. Generator hosts and reference modules are exempt: their entire first block is a dedicated
steering block, not a shared block with other real keys.

**A generator or reference-module's first block may not smuggle extra keys through to the artifact**:
Whatever the first frontmatter block of a generator host or reference module carries (`output-dir:`) is
stripped WHOLE. There is no key-level filtering for these two variants the way `stripBuildKeys` does for
command hosts — adding an unrelated key to that first block is harmless (it never reaches the compiled
artifact) but also pointless.

**`output-name:` names one file; a reference module has no basename to name**: `output-name:`
decouples an emitted filename from a `commands`/`agents` host's source basename. On a
`skill-refs` host it is **refused outright** — not silently ignored — because the emitted
filenames come from the module's `ops` roster in `VARIANT_MODULES` (any `kind`), and there is
no basename fallback to override; a key that is read on two variants and silently dropped on
the third is exactly the authoring trap the refusal exists to avoid. There is still no
templating key: variant expansion is registry-driven (edit `VARIANT_MODULES`), not
frontmatter-templated — `name-template:` remains unclaimed.

**A `'contract'` module's op name carries a MANDATORY leading underscore — the opposite of
every other variant**: `validateOutputName` REFUSES a name starting with `_` (that is the
partial-file convention); `validateContractOutputName` REQUIRES one. `expandVariants`
dispatches between the two rules by `mod.kind` rather than relaxing the shared one, because
relaxing `OUTPUT_NAME_RE` itself would have admitted `_anything.md` as a legal command or
agent basename too — a widening across ALL THREE build destinations to buy a property only
the reference-module tree needs (ADR-025: classify the case, never blanket-widen). The
underscore is what tells a reader of the `tracker/` directory apart which entries are
providers (`tracker/github/`, `tracker/jira/`, `tracker/linear/`) and which one is the
single cross-cutting contract beside them (`tracker/_mcp.md`) — `tracker/mcp.md` would read
as a fourth provider.

**The generation gate is a derived predicate, not a phase marker or a flag to remember**:
`mcpContractIsGenerated` / `deferredReferenceModuleSources` decide whether `_mcp.mds`
compiles, and the answer is computed from the registry's own shape rather than stored
anywhere: a provider module is registered with the `subdir` its files land in (`tracker/
jira`, `tracker/linear`), and `MCP_BACKED_PROVIDER_SUBDIRS` names exactly those two subdirs
as the gate's subject — registering a tool-call-backed provider and opening the gate are the
SAME edit, with no second flag to flip. `resolveVariantModules()` is the idempotent function
that actually applies the gate: it appends `MCP_CONTRACT_MODULE` to `VARIANT_MODULES` only
while the gate is open, and resolving an already-resolved list a second time is a no-op
rather than a `duplicate-output` refusal. `expandVariants()`'s default parameter and
`generatedReferenceManifest()` both call `resolveVariantModules()` internally — reading the
raw `VARIANT_MODULES` constant instead would silently omit the contract module. `tracker/
github` is deliberately ABSENT from `MCP_BACKED_PROVIDER_SUBDIRS`: GitHub's mechanics are
`gh` CLI calls rather than tool calls, and a gate keyed on "any tracker module is registered"
would already be open on a GitHub-only tree, generating a contract nothing loads (GAP-02 —
the byte-budget formula prices those wasted bytes at zero on that path for the same reason).

**A predicate that reads "nothing is gated" on the shipped tree needs a presence arm proving
it still discriminates (PF-064)**: with both `jira` and `linear` registered,
`deferredReferenceModuleSources()` returns `[]` on this tree, and a loop over an empty set
asserts nothing about the predicate itself. `tests/build-mds-generator-hosts.test.ts` proves
the same question against a PROBE registry — `VARIANT_MODULES` filtered to drop every
`MCP_BACKED_PROVIDER_SUBDIRS` entry, read from the gate's own subject rather than naming one
provider by hand (dropping only the first of two registered tool-call providers would leave
the second holding the gate open, which is the probe going stale rather than the predicate
breaking) — and asserts the contract module IS deferred there. `tests/packaging.test.ts` runs
the companion arm directly on the roster: `expect(GATED_REFERENCE_MODULE_SOURCES.length).
toBeGreaterThan(0)`, because a loop asserting every gated source still ships inside the
tarball proves nothing if that roster is empty.

**`MIN_VARIANT_PAIRS = 8` is not a tuning knob**: `expandVariants` refuses any `kind:
'fanout'` module whose `ops` list is shorter than 8 entries. Below that floor, "every op
has a file and every file has an op" parity assertions stop discriminating, because a list
short enough to enumerate by hand is satisfied by any implementation that returns something
(GAP-42). It applies per module and only to `'fanout'` modules — `_references.mds` (`kind:
'named'`, 3 fixed cross-cutting documents) and `_mcp.mds` (`kind: 'contract'`, 1
provider-independent document) are both exempt by design, not by oversight; see
`VariantModuleKind`'s doc comment for why a count proves nothing about a named or a
singleton document set. `kind` is itself a required field on `VariantModule` — `as const
satisfies readonly VariantModule[]` forces the registry to declare it at each entry site
rather than defaulting an omission, so a module lands in its bucket because it says so; all
four unconditionally-registered entries plus the one gated entry declare it today.

**No test writes the real `dist/`**: every build spawned by
`tests/build-mds-generator-hosts.test.ts` or `tests/build-mds.test.ts` is scoped to a temp
`DEVFLOW_MDS_ROOT`, and each file's closing self-scan (`collectSpawnScoping` from
`tests/helpers.ts`, with a known-bad probe and a non-vacuity floor) is the mechanical proof —
a spawn added without `DEVFLOW_MDS_ROOT` fails the file. Assertions that need the WHOLE
committed corpus (AC-1.8's printed host/partial/deferred census, the dist/-is-in-sync check,
and every compiled-command content guard in `build-mds.test.ts`) get it from
`buildCommittedTree()`: `src/assets/{commands,agents}` are `fs.cp`-copied into a temp root
and built there, memoised per test file so all callers share ONE spawn. Earlier these ran
against the real repo root; PID-scoping the staging file (`<dest>.<pid>.tmp`) closed the
writer/writer clash, but the writer/reader clash outlived it — a real-root build silently
REPAIRS a stale `dist/` while parallel workers read it, so the staleness surfaces as a flake
in whichever reader lost the race rather than as itself (PF-055). `cwd:` is not a scope: the
root falls back to the script's own location, so `cwd: <tmp>` without the env var walks and
rewrites the real repo while the test asserts about a tree the build never opened.

**What the dist/-staleness check does and does not prove**: `dist/` is gitignored
(`git ls-files dist` → 0), so the check compares a fresh build of the committed `src/`
against whatever `dist/` the working tree holds — not against reviewed bytes frozen in git.
It catches "src/ changed and nobody rebuilt", a hand-edited `dist/`, and stale orphans; it
cannot catch a `src/` change that was rebuilt before review. AC-1.5's pre-S1 SHA-256 list
was verified by hand and lives only in the PR #334 body, so the check carries that claim
forward exactly as long as `dist/` carries the reviewed bytes (PF-019: the PR-body list is
a claim, not re-runnable evidence). The byte-idempotence test it replaced proved a property
of the build agreeing with itself, not a property of the artifacts (PF-057). This same
byte-compare recurses into `dist/skills/` too (`hashDistSubtree` bounded to depth 6), so it
covers all three output kinds with the same one property.

## Key Files

- `src/assets/commands/_partials/_knowledge.mds` — defines and exports `knowledge_load` and `knowledge_writeback` partials; the single authoritative source for both algorithms
- `src/assets/commands/{name}.mds` (9 files) — knowledge host command sources that `@import "_partials/_knowledge.mds"` and call the partials; compiled to `dist/commands/` at build time
- `scripts/build-mds.ts` — unified frontmatter-driven build script; discovers hosts by `output-dir:` key across the whole-repo walk from the repo root (`DEVFLOW_MDS_ROOT` overrides the root for isolated tests), bucketing each walked reference-module path into `deferred` via `deferredReferenceModuleSources()` before it can become a host; dispatches all three host variants through one exhaustive switch at both the strip step (`stripFrontmatterFor`) and the plan step (`planHost`, dispatching to `planSingleFile`/`planReferenceModule` and returning a `HostPlan` discriminated union on `variant` — the fan-out arm's `outputs: readonly PlannedReference[]` pairs each `dest` with its `(module, op)` pair; `destsOf(plan)` is the one function every uniform-view caller goes through instead of branching on the arm); `referenceModuleFor` resolves a host's registry entry through `resolveVariantModules()`, never the raw `VARIANT_MODULES` constant, so a gated-but-open module is found the same way an unconditional one is; owns the single `process.exit`, reached only from `main()` after the loop; prunes unclaimed `.md` files from `dist/agents/` and `dist/skills/git/references/` (`pruneOrphanAgents` / `pruneOrphanReferences`, sharing the `pruneOrphans` helper, bounded by the shared `MAX_REFERENCE_SWEEP_DEPTH` imported from `src/core/reference-sweep.ts`) once that exit is passed; renders errors from `mds-variants.ts` Result values through per-kind exhaustive switches and throws them for aggregation
- `src/core/mds-variants.ts` — pure, zero-I/O core module: `validateOutputName` / `validateContractOutputName` (the leading-underscore-mandatory sibling for `'contract'`-kind op names), `resolveOutputDir` (3-entry allowlist, returns `{ variant, abs }` with `HostVariant = 'commands' | 'agents' | 'skill-refs'`), `expandVariants` (registry → flat `(module, op)` pair list, `MIN_VARIANT_PAIRS = 8` floor on fan-out modules — a `too-few-pairs` refusal carries the offending `module`), `splitVariantSections<T extends OperationNamed>` (compiled body + caller's own `{op}`-bearing records → `Result<readonly VariantSection<T>[], SectionSplitError>`, bidirectional parity + empty-section check, no lookup, no non-null assertion), `generatedReferenceManifest()` (every file the shipped, *resolved* registry emits, for the installer's converge manifest — asserts rather than returning a `Result`, since a registry refusal here is a programming error no caller could sensibly continue past). `VARIANT_MODULES` (4 unconditional entries, each `kind: 'fanout' | 'named'` required, not defaulted), `TRACKER_OPS` (the shared 10-op roster all three providers read), `TRACKER_GITHUB_OPS` (an alias of `TRACKER_OPS` for GitHub-scoped call sites — same list, two readings), `GIT_CROSS_CUTTING_DOCS`, `MCP_CONTRACT_MODULE` (`kind: 'contract'`, the 5th, gated entry), `MCP_BACKED_PROVIDER_SUBDIRS`, `mcpContractIsGenerated`, `resolveVariantModules`, `deferredReferenceModuleSources`, `GATED_REFERENCE_MODULE_SOURCES`. Exports `AGENTS_OUTPUT_DIR`, `SKILL_REFS_OUTPUT_DIR`, `SKILL_REFS_SKILL_NAME` (`'git'`). Returns `Result<T, E>`, never throws for expected refusals and never calls `process.exit`
- `src/core/reference-sweep.ts` — exports `MAX_REFERENCE_SWEEP_DEPTH` (8), the descent bound shared by the build's own `pruneOrphans` (throws on breach — `dist/` is the build's tree to fail) and the installer's `sweepOrphanedReferences` (reports the unswept subtree into `failed` on breach, avoids PF-009); one bound, two deliberately different failure postures for the same breach
- `src/assets/agents/git.mds` — the Git agent's generator-host source; compiles to `dist/agents/git.md`; carries the `## Tracker provider resolution` preamble (content/budget ownership: `tracker-references`/`tracker-feature`)
- `src/assets/mds/tracker/_github.mds`, `_jira.mds`, `_linear.mds`, `_mcp.mds`, `src/assets/mds/git/_references.mds` — the five reference-module sources; registered (four unconditionally, one gated) in `VARIANT_MODULES`/`MCP_CONTRACT_MODULE`; content ownership and byte-budget detail live in the `tracker-references` and `tracker-feature` KBs, not here
- `tests/fixtures/mds-manifest.ts` — named-set manifest (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `MDS_GENERATOR_HOSTS`, `MDS_REFERENCE_MODULES` (5), `ALL_MDS_HOSTS`, `ALL_DISCOVERED_HOSTS` (19), `DIST_COMMAND_FILES`) that every count-literal assertion across `build-mds.test.ts`, `build-mds-generator-hosts.test.ts`, `packaging.test.ts`, and `mds-variants.test.ts` compares against in both directions; floors only ever rise; imports `TRACKER_OPS`/`GIT_CROSS_CUTTING_DOCS` from production rather than retyping them
- `tests/build-mds-generator-hosts.test.ts` — generator-host and reference-module build tests: whole-block strip, byte-unchanged command outputs, dest-allowlist negatives (message text sourced from `ALLOWED_OUTPUT_DIR_NAMES`, not retyped), filename-validation negatives, `IGNORE_DIRS` coverage, the `MAX_WALK_DEPTH` bound, printed host/partial/deferred counts vs. the manifest and the gate predicate (AC-1.8, driven by `ALL_DISCOVERED_HOSTS` and `deferredReferenceModuleSources()`), the PF-064 non-vacuity arm (a probe registry with every `MCP_BACKED_PROVIDER_SUBDIRS` entry dropped must still defer the contract module), and the `dist/agents/` orphan prune. The whole-tree byte-compare (`hashDistTree`/`hashDistSubtree`) recurses into `dist/skills/` to cover the fanned-out reference files; `pruneOrphanReferences` is pinned by the dedicated describe `dist/skills/git/references orphan prune`
- `tests/mds-variants.test.ts` — unit coverage of the pure core module: `validateOutputName` / `validateContractOutputName`, `resolveOutputDir` (including the `skill-refs` allowlist entry and per-directory variant tagging), `expandVariants` (shipped-registry expansion, `MIN_VARIANT_PAIRS` floor, one-element-list refusal, traversal/duplicate-output refusals, purity), `splitVariantSections` (op/section bidirectional parity, empty-section refusal, marker-format edge cases), `resolveVariantModules`/`mcpContractIsGenerated`/`deferredReferenceModuleSources` (idempotence, gate-open and gate-closed probes), and `VARIANT_MODULES` shape assertions over the current three-provider registry
- `tests/tracker/reference-structure.test.ts` — the structural half of PF-063: asserts every generated reference starts with its own `## Operation:` anchor and carries no further unfenced column-0 `## ` line, via the fence-aware `collectUnfencedH2` helper; content/ownership sits with `tracker-references`, listed here because it polices this KB's build output shape
- `tests/guards/dist-agents.test.ts` — `dist/agents/` shipping-artifact guards: source↔output parity (fail-loud both directions), no leaked `\{`/`\}` escapes, no `.md`/`.mds` shadowing, resolver-origin assertions, and the AC-1.2 scope fence (`@if`/`variants:`/provider templating remain forbidden; `expandVariants(` and `(module, op)` are named in `LEGALISED_IN_PHASE2` as the deliberate narrowing)
- `src/assets/agents/knowledge.md` — Knowledge agent contract: dual-write (KNOWLEDGE.md + index.md line), no result file, model=sonnet
- `src/assets/skills/feature-knowledge/SKILL.md` — Iron Law, 4-phase authoring, KNOWLEDGE.md template, index.md registration instructions
- `src/assets/skills/apply-feature-knowledge/SKILL.md` — 3-step consumption algorithm, skip guard, verify-against-code freshness
- `src/cli/commands/knowledge/list.ts` — reads index.md directly or falls back to frontmatter glob; no external scripts
- `src/cli/commands/knowledge/toggle.ts` — flips `knowledge` in `.devflow/config.json` (`feature-config.ts`); no sentinel creation/deletion

## Related

- Working Memory (`.devflow/memory/WORKING-MEMORY.md`, `background-memory-update` worker) — sibling persistence layer; independent toggle.
- Decisions pipeline (`.devflow/learning/`, `decisions-ledger.jsonl`) — sibling persistence layer; independent toggle.
- ADR-021 (`.devflow/` local by default) — amended for `features/`: feature knowledge bases are git-tracked and committed by the Knowledge agent. See the carve-out in `src/assets/scripts/hooks/ensure-root-gitignore` + `ensureDevflowGitignore`.
- ADR-003 (end-state prose, clause iii — no artifact without a reachable consumer) — applies to the AC-1.2 scope fence (`LEGALISED_IN_PHASE2` names what was deliberately narrowed rather than silently dropping it) and to the reference-module registry (`VARIANT_MODULES` names every source it expects on disk).
- ADR-013 (pure core modules, I/O at edges) — `src/core/mds-variants.ts` is zero-I/O; `scripts/build-mds.ts` is the shell that owns every filesystem call and `process.exit`.
- ADR-024 (named collectors + known-bad probes) — `tests/build-mds-generator-hosts.test.ts`, `tests/mds-variants.test.ts`, and `tests/guards/dist-agents.test.ts` all follow this pattern (e.g. `collectAgentParity`, `collectEscapedBraceLeaks`, `collectForbiddenConstructs`, each with a paired known-bad probe).
- ADR-025 (classify the case, never blanket-widen) — cited directly in `validateContractOutputName`'s own JSDoc as the reason a SECOND name rule was added for `'contract'`-kind ops rather than relaxing `OUTPUT_NAME_RE` for every host variant.
- PF-011 (delete-then-write ENOENT window) — avoided by the temp-file + `renameSync` write pattern used for every output of all three host variants.
- PF-014 (no `process.exit` in core) — `mds-variants.ts` returns `Result`; only `build-mds.ts` exits.
- PF-018 (non-vacuous guards) — `dist-agents.test.ts` deliberately avoids Guard 4's `catch { return }` skip-on-missing-build shape; the `MAX_WALK_DEPTH` bound throws rather than silently truncating for the same reason. `ALLOWED_OUTPUT_DIR_NAMES`'s doc comment in `mds-variants.ts` cites this pitfall for the same reason — a guard's refusal-message expectation must come from the table under test, not a retyped copy of it.
- PF-024 (escaped-brace leakage into dist) — guarded by `collectEscapedBraceLeaks` in `dist-agents.test.ts`.
- PF-035 (skim hook — use Read) — applies to this session's tool hygiene when reading `.mds`/`.ts` sources for verification.
- PF-055 (real-root build repairs stale dist/ under parallel readers) — every build in the MDS test suite is scoped to `DEVFLOW_MDS_ROOT`, verified by `collectSpawnScoping`.
- PF-057 (goldens compared, never regenerated) — `tests/fixtures/golden/git-agent.md` (`GIT_AGENT_BYTES`, derived once via `stat`) is the oracle for the generator-host conversion.
- PF-061 (verify both ends of a block-delete transform) — `stripGeneratorFrontmatter` and `stripReferenceFrontmatter` both check PRE (a leading block exists) and POST (a second block does/does not follow, opposite expectations for the two variants).
- PF-063 (a verbatim move is not grammar-safe) — applies to any relocation of prose between `.mds` sources; see the Gotchas entry above, `tests/tracker/reference-structure.test.ts` for the structural remedy, and the `tracker-references` KB for the incident this pitfall generalises from.
- PF-064 (an absence-based guard needs a presence arm to prove it still discriminates) — applies to `deferredReferenceModuleSources()`'s empty-set reading on this tree; the non-vacuity arms in `tests/build-mds-generator-hosts.test.ts` and `tests/packaging.test.ts` are the presence proof.
- `dynamic-workflow-engine` KB — covers `DIST_COMMAND_FILES` / `COMMAND_HOSTS` split and the SG-13 `release.md` hand-authored divergence in more depth.
- `tracker-references` KB — owns what the generated GitHub reference files CONTAIN (tracker operation mechanics, byte-budget formula, the installer's overlay of the compiled tree into `devflow:git`); read it for content, this KB for the compiler.
- `tracker-feature` KB — owns the provider dimension: how a provider is selected, what opens the `_mcp.mds` generation gate, and what the tool-call contract document says; read it for the gate's meaning, this KB for the mechanism (`mcpContractIsGenerated`, `resolveVariantModules`) that implements it.
- `test-harness` KB — covers `resolveAgentSource`, `requireDistFile(s)`, and the guard/goldens test-directory conventions these tests build on.
