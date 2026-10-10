---
feature: dynamic-workflow-engine-contracts
name: Dynamic Workflow Engine Shared Contracts
description: "Use when changing the settings block, decisions step, learning arms, _tracker.mds, COMMAND_INPUT or ISSUE_REF vocabulary in dynamic-* hosts. Keywords: declared receivers, authoring_decisions."
category: architecture
directories:
  - src/assets/commands/dynamic-build.mds
  - src/assets/commands/dynamic-plan.mds
  - src/assets/commands/dynamic-tickets.mds
  - src/assets/commands/dynamic-profile.mds
  - src/assets/commands/_partials/_preamble.mds
  - src/assets/commands/_partials/_decisions.mds
  - src/assets/commands/_partials/_settings.mds
  - src/assets/commands/_partials/_tracker.mds
  - src/assets/commands/_partials/_ticket_template.mds
  - dist/commands
  - dist/learning-off/commands
  - tests/decisions
  - tests/learning
  - tests/dynamic
  - tests/seams
created: 2026-10-10
updated: 2026-10-10
---

# Dynamic Workflow Engine Shared Contracts

## Rules

- **KB-INV-1** Each dynamic host expands `settings.settings_resolve()` exactly once, under `### Settings line`, between `authoring_preamble()` and `authoring_decisions()`; no partial imports `_settings.mds`, partials say "the settings line resolved above".
- **KB-INV-2** The decisions step is its own define (`authoring_decisions()`), wholly a learning-on arm; its gate sentence (`LEARNING=off` means `DECISIONS_CONTEXT` is `(none)`, no ledger located, no index read) precedes the ledger-locate call and the index read.
- **KB-INV-3** The decisions index goes only to agent types whose contract declares `DECISIONS_CONTEXT` among the valid `agentType`s: Code, Design, Knowledge, Review, Scrutinize. Evaluate, Synthesize, Validate, Simplify, Test and Git get none.
- **KB-INV-4** Every Code spawn in a dynamic host passes `DECISIONS_CONTEXT` in the learning-on build (fix modes, the conflict resolver and the engine pseudo-line included), since Code has no fallback that reads the index. The one keyless Code spawn in the command layer is `/implement`'s `OPERATION: pr-create` (`KEYLESS_OPERATION`).
- **KB-INV-5** Decisions text lives only inside `<!-- learning:on -->` arms; the learning-off build holds none. Arms are whole-line marker triples, cannot nest, and an arm owns the blank line after its content.
- **KB-INV-6** Bind the command input once: one `$ARGUMENTS` per host, alone on its line between `<command-input>` lines; every later step and partial says `COMMAND_INPUT` (`arguments-once-max` only lowers).
- **KB-INV-7** `_tracker.mds` declares exactly two defines, `issue_ref_grammar` and `issue_capture_contract`, both exported; the adopters are the named set `TRACKER_PARTIAL_ADOPTERS`, and `dynamic-tickets` is not one.
- **KB-INV-8** The command layer forwards issue tokens to the Git agent verbatim as `ISSUE_REFS`: it never renders, normalises, pads, strips, coerces or rules out a token. Whether a bare digit run is a reference is the Git agent's provider adjudication.
- **KB-INV-9** Capture Git-output values exactly as written (`ISSUE_REF`, `ISSUE_ID`, `ISSUE_CONTENT`, `ACCEPTANCE_CRITERIA`, `ISSUE_PR_LINK`, `ISSUE_BRANCH_TOKEN`); the Handoff Values trio comes only from `setup-task` and `fetch-issue`, `(none)` on the batch path.
- **KB-INV-10** `{ISSUE_REF}` is the rendered reference (displayed or compared), `{ISSUE_ID}` the filesystem-safe id for artifact names, `{ISSUE_PR_LINK}` a sibling of `ISSUE_NUMBER` forwarded to Code and never re-derived from it.
- **KB-INV-11** Every Code spawn fence that carries `ISSUE_NUMBER` also carries `ISSUE_PR_LINK` (`MIN_FORWARDING_SITES`, registered as floor `issue-pr-link-forwarding-sites`).
- **KB-INV-12** One DEGRADED spelling per condition: a foreign-shaped PR-link line is `issue reference "{ref}" does not match any tracker reference grammar` (Code's paste gate); an unparseable `Depends on:` entry is `foreign issue reference {ref}` and not a blocker.
- **KB-INV-13** Dynamic hosts load no feature knowledge: no `knowledge_load()` or `knowledge_writeback()`, no `FEATURE_KNOWLEDGE` or `FEATURE_KNOWLEDGE_RULES` on any spawn.
- **KB-INV-14** Every dynamic command that reads or files issues carries the provider-neutral `**Tracker paths:**` preflight item and checks no tracker CLI (`gh` included) at the command layer.
- **KB-AP-1** Never give the decisions index to an undeclared receiver, nor write a pass sentence that names no receiver ("to all subsequent agents"): the seam guard fails both.
- **KB-AP-2** Never leave a `DECISIONS_CONTEXT` line, a recorded-decisions sentence or an `apply-decisions` mention outside a learning arm: it survives into the learning-off build.
- **KB-AP-3** Never restate the command input (a second `$ARGUMENTS`, or the bound text pasted into a later step): each copy re-enters the main-thread context.
- **KB-AP-4** Never re-derive `ISSUE_ID`, `ISSUE_PR_LINK` or `ISSUE_BRANCH_TOKEN` from another value or a batch heading; a batch flow needing them re-fetches with `fetch-issue`.
- **KB-AP-5** Never add a producer-side grammar check, or coerce or silently drop a foreign-shaped token, at the grammar site; no operation emits DEGRADED for it there.
- **KB-AP-6** Never pin only one side of `**Depends on:**`: a writer-only guard stays green when the wave reader stops parsing the field, and the wave then schedules everything at once.
- **KB-AP-7** Never add a settings-line consumer to dynamic-plan, dynamic-tickets or dynamic-profile without moving its block out of the learning arm and adding the host to `SETTINGS_BLOCK_HOSTS_LEARNING_OFF`.
- **KB-AP-8** Never add a feature-knowledge load or variable to a dynamic host or spawn: `/dynamic-build` gets none by decision.
- **KB-AP-9** Never name a capability in the round-refresh doctrine that is not a live Git-agent roster operation: a noun in the text proves no agent can act on it.
- **KB-AP-10** Never pin a `_tracker.mds` define by presence alone: a placeholder body compiles cleanly, so each define needs a required phrase plus a byte floor.

## Overview

The dynamic hosts (`dynamic-build`, `dynamic-plan`, `dynamic-tickets`, `dynamic-profile`) share contracts that wire a run to the repository's settings, the decisions ledger, the issue tracker's vocabulary and the bound command input. Each lives in a shared MDS partial (`_settings`, `_decisions`, `_preamble`, `_tracker`, `_ticket_template`) that hosts expand at compile time, and the test suite pins the compiled text. Every dynamic prompt compiles twice, so decisions text sits in learning arms and a learning-off variant lands at `dist/learning-off/commands/{name}.md`.

This KB owns where those contracts sit in the dynamic sources and what each variant of a dynamic command must say. Engine doctrine (gates, review pass) is in `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md`, WAVE mode in `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md`, and compiled-output counts, doctrine-literal pins and MDS authoring gotchas in `.devflow/features/dynamic-workflow-engine-pins/KNOWLEDGE.md`. The splitter (`src/core/learning-variants.ts`) and the `dist/learning-off/` build belong to the MDS build pipeline (`feature-knowledge-system`); installing or converging a variant belongs to `installer-shadowing`.

## Settings line, decisions step and learning arms

**One settings block per host.** Each of the four hosts imports `_settings.mds` as an alias (`@import "./_partials/_settings.mds" as settings`) and expands `{{settings.settings_resolve()}}` once. dynamic-build already resolved the line for its compliance lens and publication gate. dynamic-plan, dynamic-tickets and dynamic-profile carry the block so the decisions gate that follows reads a resolved line. `_decisions`, `_compliance`, `_publication` and `_knowledge` keep each gate's own condition inside its own step. `SETTINGS_BLOCK_HOSTS` names every command host with a block; `SETTINGS_BLOCK_HOSTS_LEARNING_OFF` names those that keep it with learning off. The latter is smaller because in dynamic-plan, dynamic-tickets and dynamic-profile the decisions gate is the block's only consumer, so their block sits in a learning-on arm; dynamic-build's does not (KB-AP-7). The two variants come from one `npm run build:mds`, which writes `dist/commands/` and `dist/learning-off/commands/` together; `npm run build:cli` produces neither.

**The decisions step is its own define.** `authoring_decisions()` is separate from `authoring_preamble()`, which carries no decisions text, and all four hosts expand it right after their settings block (dynamic-profile included, though its single Knowledge spawn passes no decisions context). The step is a leading `decisions_gate()` sentence (an unresolvable line keeps `LEARNING=on`, as the fail-closed line does), then `decisions_locate()` (one git call finds the main worktree's ledger `{ledger}`), then the read of `{ledger}/.devflow/learning/index.md`. `_decisions.mds` imports nothing from `_settings.mds`; the dynamic hosts reach it only through `_preamble.mds` (alias import). The gate-before-locate order is held by `tests/decisions/decisions-seam.test.ts`; `tests/commands/partials-root.test.ts` runs the locate command from a subdirectory and a linked worktree. The main model reads the index before authoring the script, because the script body has no filesystem access, and injects it with the `devflow:apply-decisions` algorithm.

**Declared receivers only.** The index is the largest single input a command can give an agent, so the step names as receivers only Code, Design, Knowledge, Review and Scrutinize (KB-INV-3). Consequences in the sources:
- dynamic-plan's Evaluate (plan-challenge) and Synthesize (preference-resolve, write-artifacts) prompts carry no index, leaving its two Design spawns (plan-parallel, cross-plan-critic) as its only decisions lines; Pre-authoring step 1 injects into Design prompts only. The plan-parallel prompt tells Design to state every decision in words, never by ID, because a plan file can be posted to the tracker.
- dynamic-tickets' step 1 names Design only, and the index reaches only the Design draft spawns (stated in words, never by ID, since the ticket is filed to the tracker); no review lens, critic or amend spawn carries it.
- dynamic-build's step 1 names Code only.

`decisions-seam.test.ts` computes the declared set from the agent sources and holds three rules over the compiled commands: every Code spawn passes the key (bar the `pr-create` exemption); a site that passes the key names a declared type; every prose sentence that gives the key away names its receiver and every receiver it names is declared. A literal classification table allows release's own declared-only sentence and the debug and explore prohibitions on passing the key to Explore agents (KB-AP-1).

**Code spawns carry the key.** The Code agent has no fallback that reads the decisions index (and `apply-decisions`' Skip Guard has no clause letting an instruction tell an agent to read it), so a Code spawn without `DECISIONS_CONTEXT` leaves Code with no decisions context. In dynamic-build every Code template spawn carries it beside `COMPLIANCE_FRAMEWORKS`: the implement prompt and the five fix modes (validation-fix after Gate 1 #1, alignment-fix, qa-fix, the review-batch issue-fix, the final validation-fix after Gate 1 #2). The merge-conflict resolver sentence in `_wave.mds` and the `implement_bundle` pseudo-line in `_engine.mds` name both keys too. `collectCodeSpawnSites(file, text, agentType = 'Code')` in `tests/helpers.ts` is the one collector the decisions-seam, OPERATION (`tests/guards/code-operation.test.ts`) and compliance-lens guards share, so they count the same sites, each guard holding its own floor (`CODE_SITE_FLOOR` in the seam test). The `pr-create` spawn is exempt only because it loads no mode skill and merely opens the PR; the seam test pins the exemption in both directions (exactly one such site, in implement, keyless).

**Learning arms in the dynamic sources.** An arm is a whole-line marker triple: `<!-- learning:on -->`, optional `<!-- learning:off -->` (that arm's else), `<!-- learning:end -->`. They are interim devflow-side build markers (MDS has no fence- or indent-aware `@if` yet); they pass through the MDS compile and the splitter cuts the compiled body into the two variants. Where the dynamic sources put them:
- `authoring_decisions()` is one arm over its whole body; `decisions_gate()` and `decisions_locate()` are leaves with no arm of their own, since an arm cannot nest.
- In the hosts: Pre-authoring step "Apply decisions context" (dynamic-build, -plan, -tickets), the `const DECISIONS_CONTEXT = args.decisionsContext` script line, every `DECISIONS_CONTEXT` prompt line, and in dynamic-plan the ADR-naming wording of its write prompt (an on/off pair). The wave's `runSingleTicketEngine({...})` call is an on/off pair whose off form drops `decisionsContext`. A vanished step leaves a numbering gap; later steps keep their numbers.
- In `_engine.mds`: the `implement_bundle` pseudo-line and the "Every Code agent prompt opens with `OPERATION: <mode>`" paragraph are on/off pairs; the off form drops `DECISIONS_CONTEXT` and keeps `COMPLIANCE_FRAMEWORKS`.
- In `_wave.mds`: the resolver sentence is an on/off pair (off drops `DECISIONS_CONTEXT`); the "relevant ADRs" bullet and the "new decisions surfaced during resolution" write-back note are on-only.

`tests/learning/learning-variants-arms.test.ts` holds: the hosts that carry an arm equal the hosts that have a learning-off file, both directions; each variant is checked against an independent resolution of the compiled host; every on arm holds learning text (or is a renumbering pair) and no off arm does; the settings blocks per variant equal the two `SETTINGS_BLOCK_HOSTS*` rosters; the learning-off dynamic-build keeps exactly one learning token, the settings grammar line naming `LEARNING=<on|off>` (the guards exempt that line by its `TRACKER=<github|jira|linear>` template), and the other three learning-off dynamic commands hold none. The doctrine literals pinned in the sibling KB are read from the learning-on build.

## `_tracker.mds`: issue-reference grammar and Git-output capture contract

`_tracker.mds` declares two zero-arg defines, exports both (one `@export` line each), and uses the "Note:" paragraph device `_publication.mds` also uses to pre-empt a one-armed misreading of each rule.

- **`issue_ref_grammar()`**: a two-armed GitHub foreign-shape rule. Scanning `COMMAND_INPUT`, a `#`-prefixed token and a bare digit run are both candidates, collected in source order as `ISSUE_REFS` and forwarded verbatim. Whether a bare digit run counts is a provider adjudication (`github`: yes, via `^#?[1-9][0-9]{0,8}$`) that belongs to the Git agent alone; the command layer holds no provider knowledge. A foreign-shaped token is neither coerced nor dropped silently, no producer-side grammar check rejects it before the fetch, and no operation emits DEGRADED for it at this site. Adjudication belongs to whichever operation runs, answered in its own Output block: `fetch-issue` strips a leading `#` and takes the text branch, so a non-numeric token is a search term returning the first open match or nothing; `fetch-issues-batch` resolves each token, drops what it cannot resolve and names the drops in `NOT_FOUND ({refs})` beside the issues it fetched. The DEGRADED spelling for a foreign-shaped reference lives one layer up, in Code's `ISSUE_PR_LINK` re-check. The define states what the operations actually do; a wrong "Git agent emits DEGRADED here" claim was rewritten rather than left in place with a caveat.
- **`issue_capture_contract()`**: what to capture from the Git agent's Output block, as written. Never infer any value from a `TRACEABILITY: DEGRADED` line (a status, not issue content). Scoped to real producers: `ISSUE_CONTENT` and `ACCEPTANCE_CRITERIA` come from every issue-bearing operation; `ISSUE_REF` from the two fetching operations (`fetch-issue`, `fetch-issues-batch`); the `### Handoff Values` block (`ISSUE_ID`, `ISSUE_PR_LINK`, `ISSUE_BRANCH_TOKEN`) only from the single-issue operations `setup-task` and `fetch-issue`. On the batch path all three are `(none)`: a batch answers for many issues, and its `### Issue #{number}:` heading is an `ISSUE_REF`, not an `ISSUE_ID`. This define IS an exhaustive spawn-field contract, unlike the `Produces:` / `Requires:` phase annotations in `_engine.mds` and `_wave.mds`, which name orchestrator state only.

Adopters are `TRACKER_PARTIAL_ADOPTERS` in `tests/fixtures/mds-manifest.ts` (`debug`, `dynamic-build`, `dynamic-plan`, `implement`, `plan`). `dynamic-tickets` writes the `Depends on:` field through `_ticket_template.mds` but never scans a command input for an issue reference or reads a Git-agent Output block, so it has no call site for either define. The partial replaced five divergent inline issue-parse rules that had drifted across those hosts.

Guarded by `tests/build-mds.test.ts` section 22: every adopting host's compiled output carries both expanded bodies (the scanned-host count is asserted non-vacuous); the partial declares exactly these two defines and exports both, with a seeded-third-define probe proving the collector would see an unmodelled define; each body clears a minimum byte floor and states its required phrase (`issue_ref_grammar`: `no producer-side grammar check`; `issue_capture_contract`: `- **PR link line**:`) and its `\nNote:` paragraph, because the command-to-agent-operation boundary is untyped and a hollowed-out define compiles cleanly (KB-AP-10). The placeholder-body probe reads its expected phrase off the `TRACKER_DEFINES` table rather than restating it, so a phrase change moves the probe with it.

## Command input binding: `COMMAND_INPUT`

Claude Code replaces `$ARGUMENTS` with the full argument string at every occurrence in a command file, so a pasted plan or stack trace is copied into the main-thread context once per occurrence; a command with no placeholder gets its input appended once as a final `ARGUMENTS:` line. A host that reads its input binds the placeholder exactly once, in its input section, on its own line inside a `<command-input>` block (never an inline code span, which a multi-line or backtick-bearing argument breaks). `dynamic-build.mds` binds it in Pre-authoring step 3 (mode detection) and reads it again by name in step 5 (tracking-issue resolution); `dynamic-plan.mds` binds it in step 3 (ticket input). `dynamic-tickets` and `dynamic-profile` carry no placeholder. `issue_ref_grammar()` scans `COMMAND_INPUT`, so the partial adds no occurrence of its own.

Held by `tests/guards/arguments-once.test.ts` over the compiled commands (at most one placeholder per command, none positional, exactly one in each `TRACKER_PARTIAL_ADOPTERS` host, each between `<command-input>` lines) and, on the installed copy, by `tests/install-bound-input.test.ts`. A plan handoff that invokes `devflow:implement` passes no arguments, so `COMMAND_INPUT` is empty there (see `ambient-orchestrator`).

## Vocabulary: `{ISSUE_REF}`, `{ISSUE_ID}`, `{ISSUE_PR_LINK}`

A provider-neutral vocabulary replaced the old GitHub-bound `#issue-number` placeholder across the command layer:

- **`{ISSUE_REF}`**: the provider-canonical rendered reference (under `github`, `#{n}`). Used wherever a reference is displayed or compared to what the tracker shows: `_ticket_template.mds`'s `**Depends on:** {ISSUE_REF}, {ISSUE_REF} (or "none")` field (zero or more, comma-separated, or the literal `none`); `_wave.mds`'s reader side (a foreign, unparseable entry is named `foreign issue reference {ref}` and treated as not a blocker, stated before the cascade-quarantine rules that would otherwise use it); and the `#N`-literal sites in `plan.mds` and `resolve.mds` (`Tracked = #{n}`, `Closes #{n}`).
- **`{ISSUE_ID}`**: the filesystem-safe identifier for artifact naming, never the rendered reference. `plan.mds` writes `{ISSUE_ID}-{topic-slug}`; `docs-framework`'s SKILL.md records the same convention with the same worked example (`42-jwt-auth.2026-04-07_1430.md`).
- **`{ISSUE_PR_LINK}`**: captured from `### Handoff Values` (single-issue ops only) and forwarded as a sibling of `ISSUE_NUMBER`. In `dynamic-build.mds` it is captured pre-authoring, defaults to `"(none)"` when no Handoff Values block supplied one (Code then composes `## Related Issues` from `ISSUE_NUMBER`), and each ticket's engine binds it from that ticket's own setup-task Output as `ISSUE_PR_LINK`, never from the token passed in. `implement.mds` forwards it at every Code spawn that carries `ISSUE_NUMBER` (the parallel-strategy `pr-create` spawn included), as does `dynamic-build.mds`; `tests/seams/pr-link-handoff.test.ts` proves it with a seeded-removal probe that leaves exactly one unforwarded site. Before pasting, Code re-checks the shape against the tracker reference grammars (`^Closes #[1-9][0-9]{0,8}$` for `github`, with a `jira` and a `linear` row beside it) in the paste-gate table of `code.mds` Responsibility 7. That is the only gate on the value, since no operation checks the rendered line's shape. A mismatch emits `TRACEABILITY: DEGRADED (issue reference "{ref}" does not match any tracker reference grammar)`; the guard bans provider-named spellings (KB-INV-12).

**The `Depends on:` guard.** `tests/dynamic/depends-on-grammar.test.ts` is modelled on `tests/resolve/duplicate-verdict.test.ts`'s writer-reader shape: two two-sided pairs (`_ticket_template.mds` writer and `_wave.mds` reader for the `Depends on:` grammar and cardinality; `plan.mds` writer and `docs-framework` reader for `{ISSUE_ID}` artifact naming), plus a battery pinning the four github-path renderings (`Tracked = #{n}` in resolve.md, `Depends on: #{n}, #{n}` in dynamic-tickets.md, the `42-jwt-auth.{ts}.md` example in docs-framework and plan.md, `issue: 42` in plan.md) by occurrence-count equality (`== 1`, not `toContain`) against the deployed dist files, so a rendering that moved, was duplicated or was removed fails differently. Named collectors (`collectTokenSites`, `collectSourcesMissing/Carrying`, `collectOffCountSites`) back every assertion, each proven live by a known-bad seeded-probe arm (KB-AP-6).

**The round-refresh operation-naming guard.** The same file pins that the wave's per-round refresh (`_wave.mds` Step 3) names a real Git-agent roster operation. A capability noun absent from the Git agent's `## Operations` table reads clean to a human reading the diff, because presence of the noun proves only that the noun was written (one such noun was retracted). The guard reads the roster live off `resolveAgentSource('git')` at test time via `collectRosterOperations`, extracts the paragraph via `roundRefreshParagraph`, and asserts `collectRosterOpsNamedIn` returns a non-empty match (currently `fetch-issues-batch`); a probe substitutes a non-roster placeholder into a copy of the real paragraph and asserts the collector comes back empty (KB-AP-9).

## Tracker paths preflight

`dynamic-build`, `dynamic-plan` and `dynamic-tickets` state the same provider-neutral preflight item, `**Tracker paths:**`: the issue reference or URL (for dynamic-tickets, the filing step) routes through the Git agent, which resolves the configured tracker and its access and reports `TRACEABILITY: DEGRADED ({reason})` when it cannot read or file one. No tracker CLI is checked at the command layer. `dynamic-profile.mds` has no such item, since it never reads or files an issue. `tests/guards/provider-scope.test.ts`'s `collectHostIssueLiterals` scans the source and compiled artifacts of `plan` and the three issue-touching dynamic commands, and fails on any of four host literals (`GitHub issue`, `GitHub paths`, `GitHub-dependent`, `` `gh` CLI ``) outside `plan.mds`'s usage-synopsis allowlist (the one place a literal `#42` example is legitimate). It also asserts every dynamic command's preflight literally contains `**Tracker paths:**` and a `TRACEABILITY: DEGRADED (` phrase.

## Decisions loading and the no-knowledge decision

The step is `authoring_decisions()`, expanded by all four hosts after their settings block and behind the `LEARNING=off` gate sentence; it is absent from the learning-off build. The returned index is injected using `devflow:apply-decisions`, and only into the declared receivers.

The four hosts expand neither `knowledge_load()` nor `knowledge_writeback()` and pass no `FEATURE_KNOWLEDGE` or `FEATURE_KNOWLEDGE_RULES` to any spawn; the compiled commands contain no feature-knowledge text. For dynamic-build this is a decision, not a gap: when feature-knowledge delivery was reshaped into Rules plus a heading index, the open question of whether `/dynamic-build` should get a load was answered no, so its Code, Scrutinize and Evaluate spawns take no knowledge variable (unlike `/implement`). Revisit that decision before adding one.

## Anti-Patterns

**KB-AP-1.** The index is the biggest input a command hands over. A pass sentence that names no receiver fails the seam guard just as a named undeclared one does, so every giving-away sentence names its receiver.

**KB-AP-2.** The arms guard fails an off arm that still holds a learning token, so a stray decisions line outside an arm is caught only by the learning-off check, not by the learning-on pins.

**KB-AP-3.** The bind-once rule exists because the substitution is per occurrence; the bound text is referred to as `COMMAND_INPUT` everywhere, partials included.

**KB-AP-6.** When touching `_ticket_template.mds`'s field or `_wave.mds`'s parse of it, update and re-check both sides together; a stalled reader looks like a clean run, not a failure.

**KB-AP-7.** A new consumer of the settings line in dynamic-plan, dynamic-tickets or dynamic-profile (a compliance lens, a publication gate, a knowledge write-back) would otherwise refer to a block the learning-off command no longer carries.

## Key Files

- `src/assets/commands/_partials/_settings.mds`: `settings_resolve()`, the one settings-line block each host expands once.
- `src/assets/commands/_partials/_decisions.mds`: `decisions_gate()`, `decisions_locate()`, `decisions_load()`; the `LEARNING=off` gate and the main-worktree ledger rule shared with the knowledge-workflow commands and `release`.
- `src/assets/commands/_partials/_preamble.mds`: `authoring_decisions()`, the declared-receivers step (the rest of the file is engine-side, in the hub KB).
- `src/assets/commands/_partials/_tracker.mds`: `issue_ref_grammar()` and `issue_capture_contract()`; owned in detail by `tracker-references`, adopted here by dynamic-build and dynamic-plan.
- `src/assets/commands/_partials/_ticket_template.mds`: canonical ticket body, the `Depends on: {ISSUE_REF}` writer.
- `tests/decisions/decisions-seam.test.ts`: declared-receivers seam over the compiled commands, gate-before-locate order, the `pr-create` exemption.
- `tests/learning/learning-variants-arms.test.ts`: arm roster, variants against independent resolution, on arms hold learning text and off arms none, settings blocks per variant.
- `tests/dynamic/depends-on-grammar.test.ts`: the `{ISSUE_REF}` / `{ISSUE_ID}` writer-reader pairs, the rendering battery and the round-refresh operation-naming guard.
- `tests/seams/pr-link-handoff.test.ts`: `ISSUE_PR_LINK` forwarding floor across Code spawn sites carrying `ISSUE_NUMBER`.
- `tests/guards/arguments-once.test.ts` and `tests/install-bound-input.test.ts`: the bind-once input, compiled and installed.
- `tests/guards/provider-scope.test.ts`: `collectHostIssueLiterals` and the wider provider-neutrality guards.
- `tests/helpers.ts`: `collectCodeSpawnSites`, the shared Code-spawn collector.
- `tests/fixtures/mds-manifest.ts`: `TRACKER_PARTIAL_ADOPTERS`, `SETTINGS_BLOCK_HOSTS`, `SETTINGS_BLOCK_HOSTS_LEARNING_OFF`, `LEARNING_VARIANT_HOSTS`.

## Related

- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md`: engine doctrine and the partial hierarchy these contracts plug into.
- `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md`: the wave reader that parses `Depends on:` and the wave block that consumes `issuePrLink`.
- `.devflow/features/dynamic-workflow-engine-pins/KNOWLEDGE.md`: host and partial counts, doctrine-literal pins and MDS authoring gotchas.
- `.devflow/features/tracker-references/KNOWLEDGE.md`: the tracker and git reference-module split, `_tracker.mds`'s relationship to the Git agent's provider-resolution preamble, and the byte-budget and containment guards under `tests/tracker/`.
- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: the decisions ledger and the rendered `.devflow/learning/index.md` that `authoring_decisions()` reads.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: installing the learning-on or learning-off variant for the machine's learning switch and converging it when the switch toggles.
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the MDS build pipeline, the splitter and the knowledge host commands.
- `.devflow/features/resolve-pipeline/KNOWLEDGE.md`: `/resolve` also spawns Code in fix modes and carries the decisions key on its validation-fix and ci-fix spawns, under the same every-Code-spawn rule.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: a plan handoff invokes `devflow:implement` with no arguments, so `COMMAND_INPUT` is empty there.
- `.devflow/features/test-harness/KNOWLEDGE.md`: the named-collector, seeded-probe and ratchet-manifest guard shape these guards follow.
