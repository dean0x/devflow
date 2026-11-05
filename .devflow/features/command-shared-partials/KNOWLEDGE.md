---
feature: command-shared-partials
name: Command Shared Partials
description: "Use when changing the settings block, decisions step, curation arms, _tracker.mds, COMMAND_INPUT or the ISSUE_REF vocabulary that the command hosts share. Keywords: declared receivers, decisions_load, issue_capture_note."
category: architecture
directories:
  - src/assets/commands/_partials/_decisions.mds
  - src/assets/commands/_partials/_settings.mds
  - src/assets/commands/_partials/_tracker.mds
  - dist/commands
  - dist/curation-off/commands
  - tests/decisions
  - tests/curation
  - tests/seams
created: 2026-10-10
updated: 2026-11-05
---

# Command Shared Partials

## Rules

- **KB-INV-1** Each command host that consumes the settings line expands `settings.settings_resolve()` exactly once, through an alias import, immediately before its earliest consumer; no partial imports `_settings.mds`, partials say "the settings line resolved above".
- **KB-INV-2** The decisions step is its own define (`decisions_load()`), wholly a curation-on arm; its gate sentence (`CURATION=off` means `DECISIONS_CONTEXT` is `(none)`, no index read) precedes the ledger-locate call and the index read, and `decisions_slice()` follows the read.
- **KB-INV-3** The decisions index goes only to agent types whose contract declares `DECISIONS_CONTEXT`; the seam guard computes that set from the agent sources.
- **KB-INV-4** Every Code-family spawn (Code, Fix, Refactor) passes `DECISIONS_CONTEXT` in the curation-on build, since no Code variant has a fallback that reads the index. No operation is exempt: no Code variant opens a PR, so no Code spawn is keyless.
- **KB-INV-5** Decisions text lives only inside `<!-- curation:on -->` arms; the curation-off build holds none. Arms are whole-line marker triples, cannot nest inside an arm of their own axis, and an arm owns the blank line after its content.
- **KB-INV-6** Bind the command input once: one `$ARGUMENTS` per host, alone on its line between `<command-input>` lines; every later step and partial says `COMMAND_INPUT` (`arguments-once-max` only lowers).
- **KB-INV-7** `_tracker.mds` declares exactly three defines, `issue_ref_grammar`, `issue_capture_contract` and `issue_capture_note`, all exported; the adopters are the named set `TRACKER_PARTIAL_ADOPTERS`.
- **KB-INV-8** The command layer forwards issue tokens to the Git agent verbatim as `ISSUE_REFS`: it never renders, normalises, pads, strips, coerces or rules out a token. Whether a bare digit run is a reference is the Git agent's provider adjudication.
- **KB-INV-9** Capture Git-output values exactly as written (`ISSUE_REF`, `ISSUE_ID`, `ISSUE_CONTENT`, `ACCEPTANCE_CRITERIA`, `ISSUE_PR_LINK`, `ISSUE_BRANCH_TOKEN`); the Handoff Values trio comes only from `setup-task` and `fetch-issue`, `(none)` on the batch path.
- **KB-INV-10** `{ISSUE_REF}` is the rendered reference (displayed or compared), `{ISSUE_ID}` the filesystem-safe id for artifact names, `{ISSUE_PR_LINK}` a sibling of `ISSUE_NUMBER` forwarded only to the PR-opening Git spawn and never re-derived from it.
- **KB-INV-11** No Code-family spawn carries `ISSUE_NUMBER`, `ISSUE_PR_LINK` or `PR_EXCEPTIONS` (an exact-zero guard); a command that captures the link forwards it into its `ensure-pr-ready` Git spawn (`ISSUE_PR_LINK:` in `/implement`), with `MIN_PR_OPEN_SITES` registered as floor `issue-pr-link-pr-open-sites`.
- **KB-INV-12** One DEGRADED spelling per condition: a foreign-shaped PR-link line is `issue reference "{ref}" does not match any tracker reference grammar` (the Git agent's paste gate in `ensure-pr-ready`).
- **KB-AP-1** Never give the decisions index to an undeclared receiver, nor write a pass sentence that names no receiver ("to all subsequent agents"): the seam guard fails both.
- **KB-AP-2** Never leave a `DECISIONS_CONTEXT` line, a recorded-decisions sentence or an `apply-decisions` mention outside a curation arm: it survives into the curation-off build.
- **KB-AP-3** Never restate the command input (a second `$ARGUMENTS`, or the bound text pasted into a later step): each copy re-enters the main-thread context.
- **KB-AP-4** Never re-derive `ISSUE_ID`, `ISSUE_PR_LINK` or `ISSUE_BRANCH_TOKEN` from another value or a batch heading; a flow needing them re-fetches with `fetch-issue`.
- **KB-AP-5** Never add a producer-side grammar check, or coerce or silently drop a foreign-shaped token, at the grammar site; no operation emits DEGRADED for it there.
- **KB-AP-7** Never add a settings-line consumer to `bug-analysis`, `release` or `research` without moving its block out of the curation arm and adding the host to `SETTINGS_BLOCK_HOSTS_CURATION_OFF`.
- **KB-AP-10** Never pin a `_tracker.mds` define by presence alone: a placeholder body compiles cleanly, so each define needs a required phrase plus a byte floor.

## Overview

The command hosts share contracts that wire a run to the repository's settings, the decisions ledger, the issue tracker's vocabulary and the bound command input. Each lives in a shared MDS partial (`_settings`, `_decisions`, `_tracker`) that hosts expand at compile time, and the test suite pins the compiled text. Every command compiles twice, so decisions text sits in curation arms and a curation-off variant lands at `dist/curation-off/commands/{name}.md`.

This KB owns where those contracts sit in the command sources and what each variant of a command must say. The splitter (`src/core/curation-variants.ts`) and the `dist/curation-off/` build belong to the MDS build pipeline (`feature-knowledge-system`); installing or converging a variant belongs to `installer-shadowing`; the slice rule itself and `DECISIONS_PASS_RULE` belong to `curation-capture-system-delivery`; host and partial counts and the marker-ownership guard belong to `test-harness-goldens-budgets`.

## Settings line, decisions step and curation arms

**One settings block per host.** Each command host with a consumer imports `_settings.mds` as an alias (`@import "./_partials/_settings.mds" as settings`) and expands `{{settings.settings_resolve()}}` once. `_decisions`, `_compliance`, `_publication` and `_knowledge` keep each gate's own condition inside its own step. `SETTINGS_BLOCK_HOSTS` names every command host with a block; `SETTINGS_BLOCK_HOSTS_CURATION_OFF` names those that keep it with curation off (code-review, debug, explore, implement, plan, resolve, self-review). The other three (bug-analysis, release, research) read the line only for the decisions gate or a Skim spawn, so their block sits inside the curation-on arm (KB-AP-7). The two variants come from one `npm run build:mds`, which writes `dist/commands/` and `dist/curation-off/commands/` together; `npm run build:cli` produces neither.

**The decisions step is its own define.** `decisions_load()` is a leading `decisions_gate()` sentence (an unresolvable line reads `CURATION=off`, as the fail-closed line does, and so does the line of a project where git tracks the curation data folders or does not answer for them), then `decisions_locate()` (the shared `root_paths()` step of `_docs_root.mds`: one `resolve-root.cjs` call names the ledger, the main worktree's copy when the checkout is a linked worktree), then the read of `{ledger}/.devflow/curation/index.md`, then `decisions_slice()` (the main model cuts one slice over the run, and siblings over one diff share it). `_decisions.mds` imports only `root_paths` and nothing from `_settings.mds`. The gate-before-locate order is held by `tests/decisions/decisions-seam.test.ts`; `tests/commands/partials-root.test.ts` runs the locate command from a subdirectory and a linked worktree. The agents that receive the slice follow `devflow:apply-decisions` and read the full index at the path the slice's marker names only when their work leaves it.

**Declared receivers only.** The index is the largest single input a command can give an agent, so the step hands it only to declared receivers, and as a slice rather than whole (KB-INV-3). `decisions-seam.test.ts` computes the declared set from the agent sources and holds three rules over the compiled commands: every Code-family spawn passes the key, with no exemption by operation; a site that passes the key names a declared type; every prose sentence that gives the key away names its receiver and every receiver it names is declared. A literal classification table allows release's own declared-only sentence and the debug and explore prohibitions on passing the key to Explore agents (KB-AP-1). `tests/decisions/decisions-slice.test.ts` holds that every curation-on host states the slice rule, none of a curation-off host does, and every `decisions_slice()` expansion sits inside an on arm.

**Code spawns carry the key.** No Code variant has a fallback that reads the decisions index, and `apply-decisions`' Skip Guard has no clause letting an instruction tell an agent to read it, so a Code-family spawn without `DECISIONS_CONTEXT` leaves the agent with no decisions context. `collectCodeSpawnSites(file, text, agentType?)` in `tests/helpers.ts` is the one collector the decisions-seam, OPERATION (`tests/guards/code-operation.test.ts`) and compliance-lens guards share; with no type it reads the whole Code family (`CODE_AGENT_TYPES`), so they count the same sites, each guard holding its own floor (`CODE_SITE_FLOOR` in the seam test). A known-bad probe seeds a keyless Code spawn to prove the collector would report it.

**Curation arms.** An arm is a whole-line marker triple: `<!-- curation:on -->`, optional `<!-- curation:off -->` (that arm's else), `<!-- curation:end -->`. The old spelling `<!-- learning:... -->` is refused by the splitter (the `legacy-marker` error), never read as an arm. They are interim devflow-side build markers (MDS has no fence- or indent-aware `@if` yet); they pass through the MDS compile and the splitter cuts the compiled body into the two variants. `decisions_load()` is one arm over its whole body; `decisions_gate()`, `decisions_locate()` and `decisions_slice()` are leaves with no arm of their own, since an arm cannot nest. A vanished step leaves a numbering gap; later steps keep their numbers.

`tests/curation/curation-variants-arms.test.ts` holds: the hosts that carry an arm equal the hosts that have a curation-off file, both directions; each variant is checked against an independent resolution of the compiled host; every on arm holds curation text (or is a renumbering pair) and no off arm does; the settings blocks per variant equal the two `SETTINGS_BLOCK_HOSTS*` rosters.

## `_tracker.mds`: issue-reference grammar and Git-output capture contract

`_tracker.mds` declares three zero-arg defines, exports each (one `@export` line each), and uses the "Note:" paragraph device `_publication.mds` also uses to pre-empt a one-armed misreading of each rule.

- **`issue_ref_grammar()`**: a two-armed GitHub foreign-shape rule. Scanning `COMMAND_INPUT`, a `#`-prefixed token and a bare digit run are both candidates, collected in source order as `ISSUE_REFS` and forwarded verbatim. Whether a bare digit run counts is a provider adjudication (`github`: yes, via `^#?[1-9][0-9]{0,8}$`) that belongs to the Git agent alone; the command layer holds no provider knowledge. A foreign-shaped token is neither coerced nor dropped silently, no producer-side grammar check rejects it before the fetch, and no operation emits DEGRADED for it at this site. Adjudication belongs to whichever operation runs, answered in its own Output block: `fetch-issue` strips a leading `#` and takes the text branch, so a non-numeric token is a search term returning the first open match or nothing; `fetch-issues-batch` resolves each token, drops what it cannot resolve and names the drops in `NOT_FOUND ({refs})` beside the issues it fetched. The DEGRADED spelling for a foreign-shaped reference lives at the PR-opening paste, in the Git agent's `ISSUE_PR_LINK` re-check in `ensure-pr-ready`.
- **`issue_capture_contract()`**: what to capture from the Git agent's Output block, as written. Never infer any value from a `TRACEABILITY: DEGRADED` line (a status, not issue content). Scoped to real producers: `ISSUE_CONTENT` and `ACCEPTANCE_CRITERIA` come from every issue-bearing operation; `ISSUE_REF` from the two fetching operations (`fetch-issue`, `fetch-issues-batch`); the `### Handoff Values` block (`ISSUE_ID`, `ISSUE_PR_LINK`, `ISSUE_BRANCH_TOKEN`) only from the single-issue operations `setup-task` and `fetch-issue`. On the batch path all three are `(none)`: a batch answers for many issues, and its `### Issue {ISSUE_REF}:` heading is an `ISSUE_REF`, not an `ISSUE_ID`.
- **`issue_capture_note()`**: the containment half of the capture contract. `ISSUE_CONTENT` stays inside its `<untrusted-issue-body>` markers wherever it is quoted onward, and `ISSUE_PR_LINK` / `ISSUE_BRANCH_TOKEN` are shape-checked again by whoever pastes them. The contract calls it, and a host that lists its own capture values calls it directly.

Adopters are `TRACKER_PARTIAL_ADOPTERS` in `tests/fixtures/mds-manifest.ts` (`debug`, `implement`, `plan`). `implement` lists its own capture values and carries the note alone: it takes one input (a plan path, one issue token or a task description, never a batch) and spawns only `setup-task`, which emits the whole Handoff Values block, so the emit-source table and the batch rule govern no case it reaches. The partial replaced divergent inline issue-parse rules.

Guarded by `tests/build-mds.test.ts` section 22: every adopting host's compiled output carries the bodies it adopts (the scanned-host count is asserted non-vacuous); the partial declares exactly these three defines and exports all three, with a seeded-extra-define probe proving the collector would see an unmodelled define; each body clears a minimum byte floor and states its required phrase (`issue_ref_grammar`: `no producer-side grammar check`; `issue_capture_contract`: `- **PR link line**:`; `issue_capture_note`: `shape-checked again by whoever pastes them`) and its note, because the command-to-agent-operation boundary is untyped and a hollowed-out define compiles cleanly (KB-AP-10). The placeholder-body probe reads its expected phrase off the `TRACKER_DEFINES` table rather than restating it, so a phrase change moves the probe with it.

## Command input binding: `COMMAND_INPUT`

Claude Code replaces `$ARGUMENTS` with the full argument string at every occurrence in a command file, so a pasted plan or stack trace is copied into the main-thread context once per occurrence; a command with no placeholder gets its input appended once as a final `ARGUMENTS:` line. A host that reads its input binds the placeholder exactly once, in its input section, on its own line inside a `<command-input>` block (never an inline code span, which a multi-line or backtick-bearing argument breaks). `issue_ref_grammar()` scans `COMMAND_INPUT`, so the partial adds no occurrence of its own.

Held by `tests/guards/arguments-once.test.ts` over the compiled commands (at most one placeholder per command, none positional, exactly one in each `TRACKER_PARTIAL_ADOPTERS` host, each between `<command-input>` lines) and, on the installed copy, by `tests/install-bound-input.test.ts`. A plan handoff that invokes `devflow:implement` passes no arguments, so `COMMAND_INPUT` is empty there (see `ambient-orchestrator`).

## Vocabulary: `{ISSUE_REF}`, `{ISSUE_ID}`, `{ISSUE_PR_LINK}`

A provider-neutral vocabulary replaced the old GitHub-bound `#issue-number` placeholder across the command layer:

- **`{ISSUE_REF}`**: the provider-canonical rendered reference (under `github`, `#{n}`). Used wherever a reference is displayed or compared to what the tracker shows, such as `Tracked = {ISSUE_REF}` in `resolve.mds`.
- **`{ISSUE_ID}`**: the filesystem-safe identifier for artifact naming, never the rendered reference. `plan.mds` writes `{ISSUE_ID}-{topic-slug}`; `docs-framework`'s SKILL.md records the same convention with the same worked example (`42-jwt-auth.2026-04-07_1430.md`).
- **`{ISSUE_PR_LINK}`**: captured from `### Handoff Values` (single-issue ops only) and carried as a sibling of `ISSUE_NUMBER`. No Code spawn receives it. `implement.mds` passes it as `ISSUE_PR_LINK:` in its Phase 9 `ensure-pr-ready` Git spawn, the one place the Git agent pastes it into `## Related Issues`. `tests/seams/pr-link-handoff.test.ts` proves the relation with seeded-removal probes on the forwarder (the key dropped, an unnamed capturer, a forwarder that stopped capturing) and holds the exact-zero rule for Code spawns. Before pasting, the Git agent re-checks the shape against the tracker reference grammars (`^Closes #[1-9][0-9]{0,8}$` for `github`, with a `jira` and a `linear` row beside it) in the paste-gate table of the `ensure-pr-ready` reference. That is the only gate on the value, since no operation checks the rendered line's shape; a given `(none)` is not a mismatch and leaves the heading with no reference. A mismatch emits `TRACEABILITY: DEGRADED (issue reference "{ref}" does not match any tracker reference grammar)`; the guard bans provider-named spellings (KB-INV-12).

## Anti-Patterns

**KB-AP-1.** The index is the biggest input a command hands over. A pass sentence that names no receiver fails the seam guard just as a named undeclared one does, so every giving-away sentence names its receiver.

**KB-AP-2.** The arms guard fails an off arm that still holds a curation token, so a stray decisions line outside an arm is caught only by the curation-off check, not by the curation-on pins.

**KB-AP-3.** The bind-once rule exists because the substitution is per occurrence; the bound text is referred to as `COMMAND_INPUT` everywhere, partials included.

**KB-AP-7.** A new consumer of the settings line in `bug-analysis`, `release` or `research` (a compliance lens, a publication gate, a knowledge write-back) would otherwise refer to a block the curation-off command no longer carries.

## Key Files

- `src/assets/commands/_partials/_settings.mds`: `settings_resolve()`, the one settings-line block each host expands once.
- `src/assets/commands/_partials/_decisions.mds`: `decisions_gate()`, `decisions_locate()`, `decisions_slice()`, `decisions_load()`; the `CURATION=off` gate, the main-worktree ledger rule and the slice rule shared by every command host.
- `src/assets/commands/_partials/_tracker.mds`: `issue_ref_grammar()`, `issue_capture_contract()` and `issue_capture_note()`; owned in detail by `tracker-references`, adopted here by debug, implement and plan.
- `tests/decisions/decisions-seam.test.ts`: declared-receivers seam over the compiled commands, gate-before-locate order, the no-exemption rule for Code spawns.
- `tests/decisions/decisions-slice.test.ts`: the slice rule and marker in every curation-on host, none in a curation-off one, and the leaf expanded only inside on arms.
- `tests/curation/curation-variants-arms.test.ts`: arm roster, variants against independent resolution, on arms hold curation text and off arms none, settings blocks per variant.
- `tests/seams/pr-link-handoff.test.ts`: the link reaches each capturing command's PR-opening Git spawn (floor `issue-pr-link-pr-open-sites`), and no Code spawn carries a PR input.
- `tests/guards/arguments-once.test.ts` and `tests/install-bound-input.test.ts`: the bind-once input, compiled and installed.
- `tests/guards/provider-scope.test.ts`: `collectHostIssueLiterals` and the wider provider-neutrality guards.
- `tests/helpers.ts`: `collectCodeSpawnSites` and `CODE_OPERATIONS`, the shared Code-family spawn collector and the mode-to-variant map.
- `tests/fixtures/mds-manifest.ts`: `TRACKER_PARTIAL_ADOPTERS`, `SETTINGS_BLOCK_HOSTS`, `SETTINGS_BLOCK_HOSTS_CURATION_OFF`, `CURATION_VARIANT_HOSTS`.

## Related

- `.devflow/features/test-harness-goldens-budgets/KNOWLEDGE.md`: host and partial counts, marker ownership, the gh-issue scope guard and MDS authoring gotchas.
- `.devflow/features/tracker-references/KNOWLEDGE.md`: the tracker and git reference-module split, `_tracker.mds`'s relationship to the Git agent's provider-resolution preamble, and the byte-budget and containment guards under `tests/tracker/`.
- `.devflow/features/curation-capture-system/KNOWLEDGE.md`: the decisions ledger and the rendered `.devflow/curation/index.md` that `decisions_load()` reads.
- `.devflow/features/curation-capture-system-delivery/KNOWLEDGE.md`: the slice rule itself, `DECISIONS_PASS_RULE` and the other hosts that expand it.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: installing the curation-on or curation-off variant for the machine's curation switch and converging it when the switch toggles.
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the MDS build pipeline, the splitter and the knowledge host commands.
- `.devflow/features/resolve-pipeline/KNOWLEDGE.md`: `/resolve` also spawns the Code family (Fix for gate failures) and carries the decisions key on its validation-fix and ci-fix spawns, under the same every-Code-spawn rule.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: a plan handoff invokes `devflow:implement` with no arguments, so `COMMAND_INPUT` is empty there.
- `.devflow/features/test-harness/KNOWLEDGE.md`: the named-collector, seeded-probe and ratchet-manifest guard shape these guards follow.
