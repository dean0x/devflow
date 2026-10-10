---
feature: tracker-feature-providers
name: "Tracker Feature: providers (registering a provider, the Jira and Linear mechanics)"
description: "Use when editing src/assets/mds/tracker/_jira.mds or _linear.mds, adding a fourth tracker provider, or touching dedup markers or ref grammars. Keywords: dedup ladder, rank 4, RATELIMITED, VARIANT_MODULES."
category: architecture
directories: [src/assets/mds/tracker/_jira.mds, src/assets/mds/tracker/_linear.mds, src/assets/mds/tracker/_common.mds, src/core/mds-variants.ts, src/targets/claude-code/installer.ts, src/assets/agents/code.mds, tests/tracker/jira-module.test.ts, tests/tracker/linear-module.test.ts, tests/tracker/hostile-values.test.ts, tests/provider-literals.test.ts, tests/installer/reference-overlay.test.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Tracker Feature: providers

## Rules

- **KB-AP-1** Never give a tool-call provider's comment a visible `*Posted by [devflow](…)*` footer: the footer is confined to `post-review-summary` and `post-resolution-summary`, and the marker line carries the discrimination.
- **KB-AP-2** Never place a dedup marker anywhere but the first line of a comment, or match it by substring: a later line is quoted prose and does not suppress, and a substring search lets a quoter silence a release note.
- **KB-AP-3** Never use one global marker for all comment kinds: markers are namespaced per kind (`devflow:shipped`, `devflow:wave`, `devflow:traceability`) with exactly one owning operation, or the kinds mutually suppress.
- **KB-AP-4** Never fall back to a GitHub issue when the tracker is absent or denied: a different tracker is not a degraded version of this one; the branch is still cut and the PR still opened with `Tracked (pending)` and the reason.
- **KB-AP-5** Never add a fact a provider does not have: no `X-RateLimit-Remaining` or pre-emptive rung on Jira or Linear, no GitHub comment cap, no `Retry-After` on Linear. Absence is asserted, and an omitted rung reads as an oversight the next author "fixes".
- **KB-AP-6** Never fetch issues one at a time in `fetch-issues-batch`, nor name a per-item tool verb or the single-key capability in that file; the batch is ONE query.
- **KB-AP-7** Never write a ref grammar as one alternation (`^A|B$`): it anchors the left branch at the start only and the right at the end only; use two anchored forms.
- **KB-AP-8** Never soften Linear's bottom-rung prose because some deployment has a non-stock server, and never suppress a post on missing evidence (the single exception is `post-wave-report`'s FULL scan, where a truncated scan is the condition).
- **KB-AP-9** Never move `## Known Unknowns` below the first section marker of `_linear.mds`: a column-zero `## ` heading in a generated reference ends its operation section for every guard.
- **KB-AP-10** Never allowlist provider literals per token: scope is per (path, token) in `PROVIDER_OWNED_PATHS`, and a further exceptional region is a row in `ALLOWLISTED_PROVIDER_REGIONS`, never a second condition.
- **KB-AP-11** Never let caller-supplied prose into a query except as a quoted string literal in value position; escape then DROP what still carries a quote, backslash, newline or backtick (repair is forbidden).
- **KB-AP-12** Never restate the tool-call contract inside a posting operation: name `references/tracker/_mcp.md` and list the steps; `MCP_SHARED_LITERAL_REGISTRY` holds the normative sentences.
- **KB-AP-13** Never register the installer test's fixture provider (`probe-provider`) in the real manifest: its stale-prune and isolation arms would silently invert.
- **KB-INV-1** File-set parity across providers is structural: every provider row reads `TRACKER_OPS`, and define-set parity is asserted both directions over every ordered provider pair.
- **KB-INV-2** Registering a provider module whose `subdir` is in `MCP_BACKED_PROVIDER_SUBDIRS` is the only edit that opens the `_mcp.md` generation gate.
- **KB-INV-3** Linear dedup lands on the bottom rung (post with `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)`) because every higher rung is unreachable on a stock server; the rank is a property of the SERVER.
- **KB-INV-4** Every posting operation carries a `### Posting gate` (compose into a fresh `mktemp`, `--emit`, require `D11-OK`, verify `<bytes>`, echo `SCRUB:`, `SECRET-EXPOSED` when N > 0, post `{SCRUBBED_BODY}`); no `curl`, `wget`, `Authorization:`, environment credential or command-line client appears anywhere in the tree.
- **KB-INV-5** Reference grammars are anchored at both ends and the entry gate defers to the resolved provider's grammar; Linear normalises ASCII-upper first.
- **KB-INV-6** Rate-limit handling is the provider's own signal: Jira `Retry-After` on a 429 (reactive only, reported never slept on), Linear HTTP `400` carrying `RATELIMITED` as error text; both STOP the fan-out.
- **KB-INV-7** The marker-call budget (items times pages equals the product) is pinned as three literals with asserted arithmetic in the jira and linear module tests, and exceeding it reports `TRUNCATED ({n} not processed)`.
- **KB-INV-8** Each provider is priced on its own loaded-set row (`D-LOADED-SET-PER-PROVIDER`, see `tracker-feature-reader`).
- **KB-INV-9** The installer overlay classifies by SHAPE, not file identity: `tracker/{provider}` exactly is an atomically swapped provider unit; everything else is a flat set carrying its directory.

## Overview

The mechanics a Git spawn executes for a non-GitHub tracker live in two MDS modules, `_jira.mds` and `_linear.mds`, each compiled to `dist/skills/git/references/tracker/{provider}/{op}.md`, one file per tracker operation, registered in `VARIANT_MODULES` with `kind: 'fanout'` and `ops: TRACKER_OPS`. This facet is the checklist a FOURTH provider reads (written as the end state three providers reached) and the provider-specific facts each module must state and must keep absent. The contract those modules rely on is `tracker-feature-reader`; selection is the hub.

## Integration patterns: what registering a provider drags with it

Registering a provider module whose `subdir` is one of `MCP_BACKED_PROVIDER_SUBDIRS` is what OPENS the `_mcp.md` generation gate, and it is the only edit that does. No flag, no frontmatter change. Every row below is what one registration drags with it:

1. **The `.mds` roster.** `MDS_REFERENCE_MODULES` in `tests/fixtures/mds-manifest.ts` holds all reference modules; `deferredReferenceModuleSources()` in `src/core/mds-variants.ts` is the build's own deferral predicate, exported so the build and the two count guards read ONE owner. A probe over the registry must range over EVERY gated sub-directory, not name one member (a probe naming only `tracker/jira` stops discriminating when a second tool-call provider registers).
2. **Floors and ceilings move together.** `generated-reference-manifest-size` / `packed-reference-manifest-size` pin one manifest at its two sinks; `capability-hoist-block-floor` and `installed-reference-count-{github,provider}` move on the same rhythm. A provider (or a provider-independent module like `pr/`) adds its whole roster at once, never a file at a time; the two installed-count floors pin ONE shared constant, `INSTALLED_REFS`.
3. **`tests/guards/mcp-sink-bypass.test.ts` runs LIVE** over the real generated corpus and must REACH every member of `MCP_BACKED_PROVIDER_SUBDIRS` by name (a bare non-emptiness check is satisfied by one provider while a second's tree is missing). `POSTING_VERBS` admits a space separator because the contract mandates selection by capability DESCRIPTION rather than tool name.
4. **`tests/guards/provider-scope.test.ts`'s AC-2.7 describe is OPEN for the shipped registry and SHUT for an injected registry with no tool-call provider**, so the claim that no GitHub mechanics file names `_mcp.md` stays behind an assertion, not an inspection.
5. **Provider literals are allowlisted per (path, token), never per token.** `PROVIDER_OWNED_PATHS` carries two entries per provider (the module and its generated directory), each admitting exactly ONE token; a module naming a sibling provider is still a violation in either direction. `_mcp.mds` needs no entry because it names no provider. The discipline throughout: classify each guard literal individually and widen only where a literal provably moved (it is also why the `_mcp.md` shared-literal registry stays a SEPARATE registry rather than a relaxed arm on its sibling).
6. **The loaded set is priced per provider** (and per provider-independent module, like the PR host): see the byte budget in `tracker-feature-reader`.
7. **`tests/tracker/hostile-values.test.ts`** ships an anchored ref-grammar row for EVERY provider and models the escape-then-drop rule scoped to the four characters that can END a quoted literal: a query sink is not a shell, so dropping `$(id)` costs search results while protecting nothing; containment by POSITION is the rule's other half.
8. **The installer overlay classifies by SHAPE** (`D-OVERLAY-PROVIDER-SHAPE`): `isProviderSubdir`; `tracker/{provider}` exactly is a provider unit with an atomic per-directory swap; everything else (the references root, the `tracker/` contract files, `pr/`) is a FLAT SET carrying the directory it lands in, with one staging name per directory and a `pr-host` unit kind for `pr/`. `tests/installer/reference-overlay.test.ts`'s fixture provider `probe-provider` must stay absent from the real manifest.
9. **The tool-call contract owns a shared-literal registry** (`MCP_SHARED_LITERAL_REGISTRY` in `tests/tracker/single-authority.test.ts`): the normative sentences `tracker/_mcp.md` OWNS, asserted present in the contract, absent from the cross-cutting documents, and restated in no provider `{op}.md`. `MARKER_REFS` in `tests/skill-references.test.ts` is keyed on the marker NAMESPACE rather than HTML-comment syntax, since Jira's markers are visible first lines.

**The end state on GitHub-specific literals.** `git.mds`'s `## Operations` table and op descriptions are provider-neutral ("tracker issue(s)", not "GitHub issue") except `create-release` and `fetch-review-threads`, which correctly name GitHub because PR and release hosting stay there under every provider. `backlink-shipped-issues`' step 0 requires every `SHIPPED_ISSUES` entry to satisfy the resolved provider's anchored reference grammar, which that provider's mechanics state and enforce (GitHub's is `^#?[1-9][0-9]{0,8}$` with one leading `#` stripped before use, because a `#` at word start opens a shell comment that would truncate the command). Its D4 line states the rate-limit rung provider-neutrally, except `resolve-review-threads`, a non-tracker op whose D4 line defers to `references/github-api.md` for GitHub's literal thresholds. `tests/provider-literals.test.ts` asserts that split per file. `src/assets/skills/git/SKILL.md`'s `X-RateLimit-Remaining` threshold is KEPT deliberately: GitHub doctrine in a GitHub-preloaded file.

**Not taken, recorded so the absence reads as a decision:** the optional per-run capability attestation line (see Linear's Known Unknowns): no named consumer and no budget headroom; if a later phase wants it, it belongs in a per-operation Output block, never the contract.

## Provider: Jira

Guarded by `tests/tracker/jira-module.test.ts` (registration and the gate it opens, define-set parity, the Jira literals, the batch and call-budget rules, the never-GitHub-fallback rule, the no-HTTP rule).

**Parity is structural, not asserted.** `TRACKER_OPS` is the roster and every provider row reads it, so a provider cannot gain or lose an operation without every provider moving. `TRACKER_GITHUB_OPS` remains as a named alias of the same list for guards that mean *the GitHub path's ops* rather than *the roster*; the two are asserted identical by `toBe` at the registration sites. **Define-set parity is asserted over every ordered PROVIDER pair** (derived from the registry, so a fourth joins by construction), since a `@define` name is visible to no type: the define roster equals the op roster with hyphens as underscores, every define body clears a character floor, and every cell of the capability matrix is filled (each define states what the operation does on that provider or names why it cannot). The known-undefined cells (`closing_refs_for_commit` on Linear and on Jira) are asserted POSITIVELY so "no blanks" cannot be met by a module quietly claiming support it lacks.

**Provider facts, and the ones that must be ABSENT**

| Fact | Value | Why the absence matters as much as the presence |
|---|---|---|
| comment-body cap | `32767`, stated once as the `comment_cap()` define; `provider-literals.test.ts` pins the rendered value at every emitted site | The truncation floor derives from it and from the Bash-result limit in `platform-assumptions.md`; it is a provider fact, not a shared rule, because another provider's cap is a different number |
| rate-limit signal | `Retry-After` on a 429: **reported, never slept on** (the value can outlast the spawn, and an agent asleep in one is killed before it reports); STOP the fan-out | **Reactive only.** `X-RateLimit-Remaining` is **absent**: Jira publishes no remaining-request count, so a pre-emptive rung keyed on one would never engage and would read as coverage while providing none |
| GitHub's cap | `60000` **absent** | One number per provider, never a parameterised one |

**The dedup ladder and the marker.** Rungs in order, each named by **capability description, never by tool name**: *entity property read/write*, *edit comment in place*, *list comments with authors* filtered on the hoisted `accountId` from *identify current user*, then **post-with-warning** (`TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)` and post anyway). Jira lands on `authored-marker` by default and drops to `post-with-warning` when identify-current-user is absent or denied. **The marker is the comment's FIRST LINE and nothing else**: Jira's comment format has no HTML-comment node, so the marker is visible prose on line 1, matched for equality. Markers are namespaced per comment kind, each with exactly one owning operation:

| Namespace | Owner | Line-1 form |
|---|---|---|
| `devflow:shipped` | `backlink-shipped-issues` | `devflow:shipped v{BARE_VERSION}` |
| `devflow:wave` | `post-wave-report` | `devflow:wave {WAVE_ID}` |
| `devflow:traceability` | `ensure-traceable-issue` | `devflow:traceability {ISSUE_REF}` |

A single global marker would make the three kinds **mutually suppress**, one kind's comment satisfying another's dedup predicate. A guard asserts the namespace appears in its owner and **in no other op file**. The comment format also has no collapsed-block analogue, so the plan artifact degrades to a PLAIN comment carrying the plan body behind the `devflow:traceability` marker (over the comment cap it posts none of the plan and reports `plan artifact exceeds comment cap`, because a truncated plan is worse than a pointer).

**The call budget is a product, pinned as three literals.** `backlink-shipped-issues`: `≤50` items times `≤2` pages gives `≤100` marker calls; exceeding it reports `TRUNCATED ({n} not processed)`. Under GitHub each item's marker check is one call; under Jira rung 3 is the *default* landing rung and each check is a paged comment listing filtered client-side, so the op-level cost is a product no per-call bound expresses. A test asserts the arithmetic (a page bound raised to `≤4` with the product left at `≤100` is the drift it catches). The module also states the **structural** preference: hoist one bounded *list by filter* read over the `≤50` keys and match markers in memory, one read instead of a hundred.

**`fetch-issues-batch` is ONE query:** `key in (KEY-1, KEY-2, …)` with an explicit `maxResults`, bounded `≤50` with `TRUNCATED ({n} not processed)`, **never a per-item loop**. The guard forbids two classes of per-item shape in that file: tool-name verbs and the single-key **capability** name (`fetch by key`); a guard covering only the first would be inert against the module the capability-first doctrine steers an author towards writing. Both classes are driven by seeded fixtures, and `fetch-issue` is in the table too, so the batch reference names the sibling op by description rather than by name.

**JQL and filter safety is stated once**, in `ensure-traceable-issue`'s `### Query safety`: it is the only op where caller-supplied prose reaches a query (`manage-debt`'s search uses a structured filter and the batch filter carries only pre-flight-anchored keys). Prefer a structured filter argument; a value may appear **only as a quoted string literal** in value position, never as a field, operator or ordering clause; escape `\` first and then `"`; after escaping **drop** anything still carrying `"`, `\`, a newline or a backtick; every query carries the `≤50` bound plus `TRUNCATED`.

**The ref grammar** is `^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$`, **anchored at both ends**. The pre-flight drops what fails with `issue reference "{ref}" does not match jira reference grammar` per entry and emits `no parseable refs for provider {p}` when everything is dropped. Because the always-loaded entry gate defers to this grammar, `SHIPPED_ISSUES="PROJ-1 PROJ-2"` is admitted. `backlink-shipped-issues` states **never report the status as `COMPLETE`** (when every entry is dropped, or any went unprocessed); `gather-release-evidence` states it for a different reason: `closing_refs_for_commit` is `DEGRADED (unsupported by jira)`, so its enrichment is incomplete by construction and the report is `PARTIAL ({n} DEGRADED)` or `TRUNCATED ({n} not processed)`, never `COMPLETE`.

**Every op carries a named DEGRADED.** Jira absent or denied yields `no tracker tool for {capability}` at each tracker op, naming the capability, while the branch is still cut and the PR still opened. **Never a GitHub issue as a fallback.** `setup-task` additionally owns `unusable site` (the site shape gate on the settings `SITE`, else `## Project`), `tracker not configured` (no site or key), `ambiguous issue reference` (a bare number) and `unsupported transition` (a state `## Transitions` names that this run did not enumerate).

**Posting: the contract is NAMED, never restated.** Four ops post (`manage-debt`, `backlink-shipped-issues`, `ensure-traceable-issue`, `post-wave-report`). Each `### Posting gate` names `references/tracker/_mcp.md` and lists its steps without restating its rules. The Jira loaded-set row is priced on its own (`BUDGET_LOADED_SET_JIRA`), since `bytes(tracker/_mcp.md)` is 0 on the GitHub row by construction; re-run `tests/tracker/byte-budget.test.ts` for the per-term figures.

## Provider: Linear

Guarded by `tests/tracker/linear-module.test.ts` (rank 4 and why higher rungs are unreachable, the marker predicate's two halves, the `400` signal in all three forms, the ref-grammar payload table, `## Known Unknowns` placement, the batch and call-budget rules, the no-HTTP rule) plus the cross-provider files.

**Rank 4 is a property of the SERVER, and every mechanic is written for it.** Three of the four dedup rungs are unreachable on a stock official Linear server, and the module says so rung by rung rather than presenting rank 4 as a choice:

| Rung | Reachable? | Why |
|---|---|---|
| 1. entity property | No | no capability records an invisible property on an issue |
| 2. edit comment in place | No | not exposed on a stock server |
| 3. first-line marker + author filter | No | **no viewer/"me" tool**, so the current-user identity an author filter compares against cannot be resolved. A URL-form remote link would otherwise give idempotency, but the attachment create takes a **binary payload**, not a URL |
| **4. post with a warning** | **Yes, this is the rung** | `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)` on every run, whether the scan suppressed or posted |

Ranks 1 and 3 need a non-stock server; a deployment that has one is **not** a reason to soften rung 4's prose: `## Dedup Strategy` is a **hint that only narrows the probe order** and the live probe is the sole authority. **Suppress only on positive evidence, never on missing evidence:** the absent identity capability is never a reason to suppress, because a silently skipped release back-link is worse than a second one the reader is told about. The one place the fail-closed direction wins is `post-wave-report`'s FULL scan: a truncated scan says the evidence exists and was not read, a different condition from an absent capability, and a duplicate wave report is worse than a missing one because the next run cannot tell which is authoritative. **Both rules ship, and the module states the distinction where they meet.**

**The marker, and the second discriminator rank 4 makes load-bearing.** Line 1 is exactly `devflow:shipped v{BARE_VERSION} · https://github.com/dean0x/devflow` (and the `devflow:wave` / `devflow:traceability` equivalents), matched for equality. The **first-line binding** defeats a quoter, who prefixes line 1 with `> ` and breaks the exact match. The **URL** defeats a coincidence: with no author column to compare against, the marker is the only evidence a comment is devflow's, and `devflow:shipped v1.2.3` is a first line somebody discussing a release might plausibly type; a full project URL on the same line is not. **The URL is part of the MARKER, not a visible footer** (`KB-AP-1`): a guard asserts every namespace appears on a line that also carries the URL, in all three kinds, because a kind that dropped it would dedup on the marker alone and inherit the false positive rank 4 cannot otherwise rule out. The spellings are `devflow:wave` for Linear and Jira, deliberately against GitHub's frozen `devflow:wave-report`; a negative arm asserts GitHub's spelling never leaks in. No reader crosses providers, so they cannot collide.

**Provider facts, and the ones that must be ABSENT**

| Fact | Value | Note |
|---|---|---|
| comment-body cap | `32767` | **BORROWED, not measured** (see Known Unknowns) |
| rate-limit signal | HTTP **`400`** carrying `RATELIMITED` | **not a 429**, and it arrives as error TEXT rather than a status line; the named 4xx signal in the tool-call contract's `### Rate-limit signals` governs: STOP the fan-out and report the remainder |
| `Retry-After` | **absent** | Jira's signal; honouring a header this provider never sends |
| `X-RateLimit-Remaining` | **absent** | a pre-emptive count this provider does not publish |
| `60000` | **absent** | GitHub's cap |

**Why the `400` must be named explicitly:** the degradation rule is status-shaped (a generic 4xx means "degrade this item and continue"), so an unnamed `400` is answered by continuing to fan out **into** the window the rung exists to stop, the one way this provider's backpressure is missed entirely. The module names the code, the token, the error-text form and `STOP`, and states there is **no pre-emptive rung**.

**The ref grammar is two anchored forms, never one alternation:** the team-key form `^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$` **or** the internal-id form `^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$`, each anchored at both ends, after **ASCII-upper normalisation** (a reference copied out of a branch name or a URL arrives lowercased). An alternation inside one anchor pair anchors one branch at the start only and the other at the end only, and `hostile-values.test.ts` drives that exact shape as a probe to show it admits a payload every shipped form rejects. The batch filter is `issues(filter: …)` with an explicit page bound (`first:`), bounded `≤50`. The call budget (`≤50` items times `≤2` pages gives `≤100`, with the hoisted single pass stated beside it) differs from Jira's in status rather than numbers: rung 4 is this provider's **only** rung, so the paged comment listing is what every run does. The Linear loaded-set row (`BUDGET_LOADED_SET_LINEAR`) is the largest tracker row because this provider's `setup-task` and `ensure-traceable-issue` mechanics are each the longest of the three.

**`## Known Unknowns` is module-level prose.** The section lives **above the first section marker** in `_linear.mds`, which the build emits **nowhere**: a column-0 `## ` inside a generated reference terminates its operation section for every guard reading it through `extractOpSectionFromCorpus`, so everything below would go silently invisible while the bytes stay on disk. A guard asserts the heading is above the first marker AND absent from every generated Linear file. The user-facing twin is `docs/cli-reference.md`'s `### Known Unknowns — Linear`; the two carry a twin comment and must move together. They name two inherited rather than measured facts: the borrowed comment cap and the possible duplicate back-link. **The optional per-op capability-attestation line is DEFERRED, not shipped**: it would make the author-filter and no-HTTP-fallback controls auditable in the artifact, but it has no reachable consumer and no budget headroom (always-loaded text, every loaded-set gate runs thin); owner dean0x, to be revisited with the prompt-diet pass (#342), where always-loaded bytes get freed rather than borrowed. Measuring the borrowed cap is issue #343; `tests/provider-literals.test.ts` is the other place the borrowed value is pinned.

## Anti-Patterns

- **KB-AP-1.** `git.md`'s attribution rule gives the `*Posted by [devflow](…)*` footer only to the two summary operations; `post-wave-report`, `backlink-shipped-issues` and `ensure-traceable-issue` "use the marker only". Linear needed a second discriminator and the answer was to put the project URL **inside the marker line**; a footer would contradict an always-loaded rule to solve a problem the marker solves itself.
- **KB-AP-5.** An omitted rung reads as an oversight and the next author adds GitHub's; the module names what it deliberately lacks.
- **KB-AP-6.** The `fetch-issues-batch` guard seeds fixtures for both classes of per-item shape, so neither a tool-name verb nor the single-key capability name can reappear.
- **KB-AP-13.** The overlay fixture provider exists to exercise the classifier; registering it for real flips "the orphan is removed" into "the real provider survives".

## Gotchas

- **The Code agent (`code.mds`) is a THIRD authority for each provider's reference grammar, a recorded tension, not an oversight.** It re-checks a pasted `ISSUE_PR_LINK` (the rendered `Refs {KEY}-{n}` line) against the resolved provider's grammar in a table, so the jira, linear and github grammars are stated there as well as in each provider's mechanics module. It is accepted because the Code agent is outside the Git spawn surface and loads no mechanics file it could defer to, and because the alternative leaves the PR sink ungated for two of three providers. If a future phase gives the Code agent a loadable reference, these arms move into it. The jira and linear arms OVERLAP (a plain uppercase key satisfies both; they part only on jira's `_` and linear's single-character keys), so the RESOLVED provider picks the arm. `ALLOWLISTED_PROVIDER_REGIONS` in `provider-scope.test.ts` is the registry that admits the second region, with a justification floor and a per-region "still needed" arm.
- **Content added to whichever op sits inside a worst spawn's load moves a ceiling; the same content elsewhere moves nothing.** Check the printed byte-budget table before choosing where a cross-cutting paragraph goes.
- **A provider module's `@define` names are visible to no type**, so a define dropped from one provider is caught only by the pairwise define-set parity test.

## Key Files

- `src/assets/mds/tracker/_jira.mds`: the Jira mechanics: defines named identically to `_github.mds`'s, the dedup ladder and first-line namespaced markers, `comment_cap()`, `Retry-After`, the single-query batch, the call budget, `### Query safety`, and a `### Posting gate` in each of the four posting ops
- `src/assets/mds/tracker/_linear.mds`: the Linear mechanics: the rung-by-rung ladder ending at rank 4, the URL-bearing first-line marker, `400 RATELIMITED`, the two anchored ref forms after ASCII-upper, `issues(filter: …)` with `first:`, and the module-level `## Known Unknowns` naming #343
- `src/assets/mds/tracker/_common.mds`: the shared defines (kept small because compile cost is exponential in define count)
- `src/core/mds-variants.ts`: `TRACKER_OPS`, `TRACKER_GITHUB_OPS`, `PR_HOST_OPS` (the PR/review roster), `PR_HOST_DESTINATION_ROOT` (`'pr'`, installed under every provider), the provider rows of `VARIANT_MODULES`, `MCP_BACKED_PROVIDER_SUBDIRS`, `deferredReferenceModuleSources`
- `src/targets/claude-code/installer.ts`: `D-OVERLAY-PROVIDER-SHAPE`: `isProviderSubdir`, the `pr-host` unit kind for `pr/`, the flat arm's `dir`, one staging name per unit kind and directory
- `src/assets/agents/code.mds`: the Code agent's `ISSUE_PR_LINK` shape re-check before a PR paste; it states all three reference grammars because it is outside the Git spawn surface
- `tests/tracker/jira-module.test.ts`, `tests/tracker/linear-module.test.ts`: registration, cross-provider define-set parity, provider literals, the batch and call-budget rules, no-HTTP, Known Unknowns placement
- `tests/tracker/hostile-values.test.ts`: the field-by-payload matrix, the per-provider ref-grammar table and the escape-then-drop model
- `tests/provider-literals.test.ts`: the provider-literal matrix over sources AND generated trees, the cross-provider batch negative, the tool-call-scoped bound arm, the borrowed cap pin
- `tests/guards/provider-scope.test.ts`: `PROVIDER_OWNED_PATHS`, `ALLOWLISTED_PROVIDER_REGIONS`, the five forbidden scopes with a seeded probe each, the AC-2.7 gate in both directions
- `tests/helpers.ts`: `PER_ITEM_FETCH_SHAPES` / `collectPerItemFetchVerbs`, the one authority for what a per-item fetch looks like
- `tests/installer/reference-overlay.test.ts`: the overlay classifier and the `probe-provider` fixture
- `docs/cli-reference.md` (`### Known Unknowns — Linear`)

## Related

- `.devflow/features/tracker-feature/KNOWLEDGE.md`: the hub (selection and lifecycle)
- `.devflow/features/tracker-feature-reader/KNOWLEDGE.md`: the contract these modules rely on, `--emit`, the DEGRADED registry, the per-provider loaded-set rows
- `.devflow/features/tracker-feature-inference/KNOWLEDGE.md`: the conventions file whose `## Dedup Strategy` and `## Reference Rendering` the mechanics consume
- `.devflow/features/tracker-references/KNOWLEDGE.md`: `VARIANT_MODULES`, `expandVariants`, `splitVariantSections` and the generated GitHub references
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: the installer half of the reference overlay
- `.devflow/features/test-harness/KNOWLEDGE.md`: guard conventions and `numeric-floors.json`
