---
feature: tracker-references-byte-budget
name: "Tracker References: Byte Budget, Loaded-Set Model and Body-Hop Closure"
description: "Use when editing git.mds or any tracker/PR-host reference and a ceiling moves, or when touching byte-budget.test.ts, budget-model.ts or numeric-floors ceilings. Keywords: BUDGET_LOADED_SET, closure scan, headroom."
category: architecture
directories: [tests/tracker/byte-budget.test.ts, tests/tracker/budget-model.ts, tests/fixtures/numeric-floors.json, src/assets/agents/git.mds, src/assets/skills/git]
created: 2026-10-10
updated: 2026-10-10
---

# Tracker References: Byte Budget and Loaded-Set Model

## Rules

- **KB-INV-1** Every ceiling is a regression alarm, derived in a comment and registered in `tests/fixtures/numeric-floors.json` `ceilings` (value, `pattern`, `occurrences`). It is lowered, never raised, and lowering re-pins the constant and its entry in the same commit.
- **KB-INV-2** Every ceiling that carries `dist/agents/git.md` (`BUDGET_GIT_MD` and the loaded-set rows) is `min(previous ceiling, measured + the general headroom)`. The headroom is not a reservation: an addition to `git.mds` funds itself with a cut elsewhere.
- **KB-INV-3** `BUDGET_GIT_MD` is the one ceiling on the agent. `git.md` is a term of every loaded-set row, so growth lands in all rows at once and the row with the least headroom binds.
- **KB-INV-4** The gated quantity is per SPAWN: `PRELOADED + contractTerm(provider) + worstCaseProviderLoad(provider)`, where the last maximises `summedForProvider` — an op's own load plus the own load of every op its loaded bodies hop to (`D-BODY-HOP-CLOSURE`).
- **KB-INV-5** `contractTerm(provider)` is a sum of the contract files a spawn reads (`_contract.md`; plus `_mcp.md` under an MCP-backed provider), carried exactly once by `providerLoadedSet`. It is never in `ownLoadForProvider`, the PR-host row or the per-op PR-host cap.
- **KB-INV-6** The PR-host path has its own row (`BUDGET_LOADED_SET_PR_HOST`) and per-op cap (`PR_HOST_MAX_OP_LOAD`), identical on every provider, with no `max_op` term of its own.
- **KB-INV-7** The closure scan is default-deny: every op-name mention in a loaded body is a hop unless it names its own op or an `INFORMATIONAL_OP_MENTIONS` row exempts it by a verbatim single-line anchor.
- **KB-INV-8** A hop is priced in exactly one table: `MODEL_CROSS_CUTTING_REFS` when a `references/…` literal names it, `MODEL_TRANSITIVE_REFS` when only an op-name mention does.
- **KB-INV-9** Always-loaded text (the agent's cross-cutting slice, both preloaded skills, both tracker contract files) is held to "no hop at all".
- **KB-INV-10** `references/github-api.md` is excluded from the PR-host row by `LOADED_SET_WRITTEN_EXCLUSIONS` and pinned by equality (`GITHUB_API_MD_CHARS`), re-pinned in the commit that edits it.
- **KB-AP-1** Raising a ceiling to fit what the artifact grew into: a budget raised to meet the artifact is a description, not a budget.
- **KB-AP-2** A `max_op` "largest file" catch-all term in the formula: it double-counts a file already inside some op's one-spawn load. `largestTrackerReference()` and `largestProviderReference()` stay recorded, never gating.
- **KB-AP-3** Folding the PR-host cost into a per-provider row, or charging `_contract.md` to a PR-host row or the PR-host cap.
- **KB-AP-4** Exempting a sibling-op mention without a verbatim, single-line anchor: a row keyed to a whole file exempts every future mention of that target there, real hops included.
- **KB-AP-5** Writing a closure probe's seeded body into `dist/`: vitest reads those exact paths in parallel workers. Seed through `seededReader` in memory.
- **KB-AP-6** Carrying a measured figure forward by hand: re-derive it from the test's printed output, never from a transcription.

## Overview

`tests/tracker/byte-budget.test.ts` (model in `tests/tracker/budget-model.ts`) makes the payoff of the contract/mechanics split a tested property. It gates three kinds of number: the size of the always-loaded `dist/agents/git.md` and of `skills/git/SKILL.md`, the **per-spawn loaded set** of a tracker spawn under each provider, and the loaded set of a PR-host spawn. The build manifest and install manifest are not what it prices; a spawn is (see `.devflow/features/tracker-references/KNOWLEDGE.md`). No figure is restated here: run `npx vitest run tests/tracker/byte-budget.test.ts` and read the printed shape table, or re-measure the agent with `npm run build && node -e "process.stdout.write(String(require('fs').readFileSync('dist/agents/git.md','utf8').length))"`.

## The ceilings

Constants in the test, each registered under the matching `ceilings` id in `tests/fixtures/numeric-floors.json`:

```
BUDGET_GIT_MD             budget-git-md              the ONE gate on dist/agents/git.md
BUDGET_SKILL_MD           budget-skill-md            skills/git/SKILL.md
BUDGET_LOADED_SET         budget-loaded-set          worst-case one-spawn load, GitHub tracker path (adds tracker/_contract.md)
BUDGET_LOADED_SET_JIRA    budget-loaded-set-jira     … jira path (adds _contract.md and tracker/_mcp.md)
BUDGET_LOADED_SET_LINEAR  budget-loaded-set-linear   … linear path
BUDGET_LOADED_SET_PR_HOST budget-loaded-set-pr-host  … a PR-host spawn (pr/{op}.md), same on every provider, no contract term
PR_HOST_MAX_OP_LOAD       pr-host-max-op-load        per-op PR-host cap, zero headroom (post-review-summary)
PREAMBLE_MAX_LINES        preamble-max-lines         line count of the compiled tracker/_contract.md
```

`mcp-contract-max-chars` (pinned in `tests/tracker/associate-release.test.ts`) caps `tracker/_mcp.md`, which every Jira and Linear spawn loads once, so its growth lands in both tool-call rows; trimming it is the sanctioned first response to either tool-call row going red. `PR_HOST_MAX_OP_LOAD` holds that no single PR-host op loads more than the cap (its `pr/{op}.md` plus every reference its load instructions name, less the written exclusions), so the PR-host row moves by exactly the `git.md` delta instead of spending its headroom twice when one op grows.

**Derivation and headroom.** A ceiling re-derives downward after a pass that genuinely cuts the artifact: the tracker contract and neutral step text leaving the agent lowered `BUDGET_GIT_MD` and every loaded-set row, and the skills diet lowered `BUDGET_SKILL_MD` when it cut the git skill's catalog description (`D-SKILL-DESCRIPTION-CAP`); `BUDGET_SKILL_MD`'s base derivation is the pre-split capture less the D3 template, throttling recipe, PR-comment section, releases recipe and naming-conventions authority block. The SDLC-evidence series had let ceilings sit ahead of the measured artifact through a reservation ledger; its close set every git.md-carrying row to `min(previous ceiling, measured + 80)` — 80 being the headroom those rows carried before the series — and every later cut re-applied the rule. A row's headroom drifts below 80 whenever its measurement moves without its ceiling (the Jira and Linear rows have sat lower), so re-measure before quoting a headroom figure; the number narrows on every commit that touches `git.md`, either tracker contract or a provider reference. No per-component decomposition of a cut is recorded in the ceiling comments: three successive decompositions disagreed once, so measure the artifact instead.

`BUDGET_GIT_MD` is the single ceiling, superseding the retired phase-named companion `budget-git-md-p3`. The pluggable-tracker decision's merge-gate amendment kept that pair at its merge as a deliberate time-boxed exception to the leave-the-end-state rule with #326 as its exit; #326 collapsed it. The amendment's lesson stands: a phase-named ceiling is a transition artifact.

## The loaded-set formula

`providerLoadedSet(provider) = PRELOADED + contractTerm(provider) + worstCaseProviderLoad(provider).value`.

- **`PRELOADED`** is the always-loaded set: the agent plus the preloaded skills.
- **`contractTerm(provider)`** returns the sum of `referenceChars` over `contractTermRels(provider)`: `[CONTRACT_REL]` (`tracker/_contract.md`) on the GitHub path and `[CONTRACT_REL, MCP_CONTRACT_REL]` under an MCP-backed provider, in the order a spawn reads them. The GitHub row therefore bills `_contract.md` once per spawn, Jira and Linear bill both files, and no PR-host row bills either. `ensure-pr-ready` is both a PR-host and a tracker operation, and charging it `_contract.md` on the PR-host side would breach a cap that can only be lowered; its full cost, contract included, is priced through the tracker rows, where it is already a candidate. A provider's `_mcp.md` term is 0 on the GitHub path by proof: the re-scoped provider-scope arm in `tests/guards/provider-scope.test.ts` and a gate in this file assert no `tracker/github/{op}.md` names the tool-call contract.
- **`ownLoadForProvider(provider, op)`** is one op's own load: its provider mechanics file (if a tracker op), its `pr/{op}.md` (if a PR-host op) and whatever `MODEL_CROSS_CUTTING_REFS[op]` attributes to it. It deliberately excludes the per-spawn contract term, which `providerLoadedSet` carries once.
- **`summedForProvider(provider, op)`** adds, for each `MODEL_TRANSITIVE_REFS[provider][op]` target, that target's own load too (one hop through the table, proven complete by the closure scan rather than assumed).
- **`worstCaseProviderLoad`** maximises `summedForProvider` over the provider's ops. The GitHub row is scoped to TRACKER ops only (`D-LOADED-SET-SCOPE`, `TRACKER_GITHUB_OPS`) and each MCP-backed provider has its own row (`D-LOADED-SET-PER-PROVIDER`): a cost is priced once rather than folded into, and tripled across, the provider rows. Every row is the one-spawn load (`D-LOADED-SET-ONE-SPAWN`).

**Why there is no largest-file addend.** The formula once added a `max_op` term meant to catch whatever the scan missed. It survived only because it happened to be about the size of `setup-task`'s unpriced step-1c hop into `ensure-traceable-issue`; the largest mechanics file was itself already inside some op's one-spawn load, so the term double-counted a file no spawn pays for twice. It was replaced by `D-BODY-HOP-CLOSURE`; `largestTrackerReference()`/`largestProviderReference()` print as RECORDED rows so the biggest single file stays on the record without gating.

Each loaded-set row moves by the amount `git.md` moves, since `git.md` is a term of every row; tracker rows additionally carry the contract term, so moving text out of the agent into `_contract.md` lowers a tracker row by less than the agent fell, while the PR-host row, which bills neither contract file, falls by the full amount. Linear's row is the **largest of the three tracker rows**, because of `backlink-shipped-issues`' dedup ladder, of which three of four rungs are unreachable on a stock server (OD-12), now reached from `post-wave-report` through a Linear-only closure hop rather than as a phantom largest-file term. Largest is not binding: every row carries `git.md`, so an addition to the always-loaded agent is bound by the row with the least headroom.

**The PR-host row** is gated by `D-LOADED-SET-PER-PROVIDER`'s reasoning applied a fourth time: `references/pr/` installs under every tracker at the same cost, so a PR operation is priced once, and it cannot ride the GitHub row, which `D-LOADED-SET-SCOPE` scopes to tracker ops. Its formula has no `max_op` term because a PR-host op's own mechanics file is already inside its one-spawn load. **`LOADED_SET_WRITTEN_EXCLUSIONS = ['github-api.md']`** (declared in `budget-model.ts`) excludes `references/github-api.md` from the row: `fetch-review-threads` and `resolve-review-threads` loaded that file long before the PR-host split, which only moved the line that names it, and charging it would bury the `pr/` bodies the row exists to measure under a term several times their size. The exclusion is proven load-bearing by a dedicated arm asserting the unexcluded figure would exceed the ceiling, and it owes a recorded row in return: shape `2c-ex`, the same maximum with the file charged, printed and never gated. The excluded file is pinned by equality because nothing else notices it growing; when it goes red, re-measure and re-pin `GITHUB_API_MD_CHARS` in the SAME commit that edited the bytes, never later.

## Transitive hops and the closure scan

**`MODEL_TRANSITIVE_REFS`** is a flat per-provider table of sibling-op hops a loaded mechanics BODY makes without a `references/…` literal marking it: `setup-task` invoking `ensure-traceable-issue` under `ISSUE_REQUIRED`, and `gather-release-evidence` and `associate-release` invoking `backlink-shipped-issues`. Linear carries one row nothing else does, `post-wave-report → backlink-shipped-issues`, because only Linear's `post-wave-report` states its marker's second discriminator inside `backlink-shipped-issues`' own reference. A hop lives here only when NO literal already prices it: `setup-task`'s `learn-conventions` hop and `check-merge-readiness`'s `check-ci-status` hop are priced by `MODEL_CROSS_CUTTING_REFS` because a literal names them. A new provider needs a row here even if empty — the non-vacuity arm fails a provider with no row.

**`nameableFromProvider` is the closure scan, and it is DEFAULT-DENY.** Starting from an op's own load as `nameableFrom()` scans it, it reads every body the spawn can load and runs `collectOpMentions()` — every occurrence of `OP_MENTION_RE`, a longest-match-first alternation over every op name in `ALL_OPS`, bare or backticked, matched as a whole token — to find every OTHER operation the body names. Each mention is classified in order: naming its own op is never a hop (`namesItsOwnOp`); a mention an `INFORMATIONAL_OP_MENTIONS` row explains is not a hop; **every other mention is a hop**, priced or not, whether or not anyone modelled it. The scan enqueues each newly-hopped-to op's own load in turn, to a fixed point, with a visited set so a cycle terminates, and `CLOSURE_STEP_LIMIT` (`4 × ALL_OPS.length`) throws outright if it does not. `git.md`'s own `## Operation:` sections are never scanned (the agent is preloaded whole), and `references/decision-markers.md` is never a spawn's load (`D-CROSS-CUTTING-ON-DEMAND`), so an op it names is a glossary entry, not a hop. The bidirectional check (`collectUnpricedHops`, `collectDeadTransitiveRows`) fails a hop priced in the wrong table or in both, and fails a dead priced hop.

**`INFORMATIONAL_OP_MENTIONS`** is the exemption table. Each row pins a `file`, a `target`, a verbatim one-line **anchor** inside that file (so a reworded line breaks its own exemption rather than silently staying exempt) and a `why` clause (floor `INFORMATIONAL_WHY_MIN_CHARS`) that must carry no load verb (`LOAD_VERB_RE`: load, follow, invoke, run, read, consult, see, open). The verb check is a guard on the TABLE, not the hop detector: two real hops carry no verb, which is why the scan is default-deny rather than verb-keyed. Rows cover things like `create-release` citing the bound it shares with `backlink-shipped-issues` (provenance, not a load) and `ensure-pr-ready` naming which earlier op returned a value it already holds. The strictest class is always-loaded text: `alwaysLoadedBodies()` allows the `## Operations` dispatch table's own row for an op and a listed row, nothing else, because a hop from the always-loaded part would be paid by every spawn and no per-op row can express that.

**Nine seeded probes, P1–P9**, each a known-bad case injected in memory via `seededReader`/`alwaysLoadedBodies(content, readReference)`: a backticked sibling-op pointer in a tracker body (P1), the same but BARE (P2, since the frozen status-lines fixture samples a real bare mention), a pointer in a `pr/` body (P3), one in a cross-cutting reference (P4), a pointer inside a HOP TARGET followed to the fixed point (P5), a cycle that terminates and reports the unpriced half (P6), a priced hop whose pointer is removed, reported dead in the `MODEL_TRANSITIVE_REFS` direction (P7), a reworded informational anchor that loses its exemption and becomes a hop (P8), and the retired project-key pointer to `learn-conventions` seeded back into the always-loaded tracker contract, reported as an always-loaded hop (P9).

**Cross-cutting rows.** `learn-conventions.md` and `publication-gate.md` are named rows of the shape table. `decision-markers.md` is an on-demand glossary lookup, not a per-spawn load (`D-CROSS-CUTTING-ON-DEMAND`). `_contract.md` and `_mcp.md` are the opposite case: the loading section names each as a fixed per-spawn load, so `MODEL_CROSS_CUTTING_ASSERTED` lists both and they are summed terms of the tracker rows.

## The contract and loading-section arms

The compiled `_contract.md` must open with `## Tracker contract` and stay within `PREAMBLE_MAX_LINES` (a tracker spawn reads it whole, so length is a per-spawn cost); `contractBlock()` throws unless the title and both sections are present in order, and `loadingBlock()` throws unless `## Loading the mechanics` sits between the D4 block and the D11 scrub. Exactly one line of `dist/agents/git.md` names a `references/tracker/` path; it lives inside the loading section, composes the per-operation path from the provider token, names the tool-call contract as a fixed literal on that same line, and never contains `~/.claude` (references are addressed skill-relatively, so a `CLAUDE_CONFIG_DIR` install puts the skill elsewhere and still resolves). The written exclusions are asserted too: `## Comment-sink scrub (D11)` stays in the agent, and the two summary ops stay PR-host ops that name `references/publication-gate.md` from `git.md` with a real, non-empty `pr/` reference.

## The shape table

Printed, not asserted pass/fail; it records the shape decision so it is not re-argued: (1) the always-loaded preloaded set (the denominator of the `vs shape 1` column); (2) the per-op split on the GitHub path, the shipped worst-case formula; (3) a per-provider single file, DISQUALIFIED against shape 2; (4) per-op without `_mcp.md`, identical to shape 2 on the GitHub path; `2-jira` and `2-linear`, the per-provider rows; `2c`, the PR-host spawn, gated; `2c-ex`, the PR-host spawn with the written exclusion charged, recorded only; `2b`, shape 2 with the cross-cutting glossary as if mandatory, recorded only. A separate recorded **round-trip term** (#342) counts the `**Mechanics:**` and `**PR mechanics:**` pointer sites — printed and unasserted, deliberately setting no ceiling or floor on the count.

## Anti-Patterns

- **KB-AP-1, KB-AP-6** Re-derive rather than raise. The comment-and-registry pairing exists so that a lowered ceiling re-pins constant, `pattern` and `occurrences` together; the manifest guard's probe still proves an increment would go red. An equality baseline stops being evidence the moment it is re-pinned in a later commit than the edit it tracks.
- **KB-AP-2** The pre-closure formula's coincidence is the cautionary tale: a catch-all that is accidentally the right size hides the unpriced hop it stands in for, and goes stale silently when either changes.
- **KB-AP-3** Folding PR-host cost into a provider row would price one cost three times over while leaving "what does a PR spawn cost?" unanswerable from any single row; charging the contract to `ensure-pr-ready` on the PR-host side would bill a PR-only spawn for a file it never reads.
- **KB-AP-5** Probes are in-memory by construction; the real tree stays read-only under parallel workers.

## Gotchas

- **KB-INV-8** The reference-hop model has two tables and confusing them mis-prices a hop. `MODEL_CROSS_CUTTING_REFS` prices a mention a `references/…` LITERAL already names (`setup-task`'s `learn-conventions.md` mention, `check-merge-readiness`'s `pr/check-ci-status.md` mention), seen through `nameableFrom()`'s literal-mention pass. `MODEL_TRANSITIVE_REFS` prices a hop NO literal names, seen through the closure's `collectOpMentions()` pass. A hop priced in the wrong table, or both, fails the bidirectional check rather than passing silently.
- **KB-INV-2** Not every git.md-carrying row sits at exactly +80: a derivation comment records the measurement at its last re-derivation, and a tool-call row can hold with smaller room. Read each row's own derivation comment in `byte-budget.test.ts` before quoting its headroom.
- **KB-INV-9** The project-key rule is stated inside `_contract.md` so that no always-loaded text hops into `learn-conventions`; P9 holds this.
- **`BUDGET_SKILL_MD` gates the whole `SKILL.md`**, the one file preloaded on every Git spawn, so any addition spends real per-spawn characters; that is why its Extended References table gains no rows for documents named elsewhere (hub KB).
- **`PR_HOST_MAX_OP_LOAD` sits at zero headroom** for its worst op (`post-review-summary`) and can only be lowered; `check-merge-readiness` is charged its own file plus `check-ci-status`'s.

## Key Files

- `tests/tracker/byte-budget.test.ts` — every `BUDGET_*` ceiling and its derivation comment, `PREAMBLE_MAX_LINES`, `GITHUB_API_MD_CHARS`, the bidirectional formula-to-nameable-set check, `D-LOADED-SET-SCOPE`, `D-LOADED-SET-PER-PROVIDER`, the body-hop closure section (`collectUnpricedHops`, `collectDeadTransitiveRows`, `collectStaleRows`, `collectDirectiveWorded`, `collectShortWhys`, `collectUnconsultedRows`, `collectAlwaysLoadedHops`, probes P1–P9), the shape table and the recorded `2c`/`2c-ex`/`2b` rows, the round-trip term, `INFORMATIONAL_WHY_MIN_CHARS`, `LOAD_VERB_RE`
- `tests/tracker/budget-model.ts` — `CONTRACT_REL`, `contractTermRels`, `contractTerm`, `MODEL_CROSS_CUTTING_REFS`, `MODEL_CROSS_CUTTING_ASSERTED`, `contractBlock`, `loadingBlock`, `MODEL_TRANSITIVE_REFS`, `summedForProvider`, `ownLoadForProvider`, `nameableFromProvider`, `CLOSURE_STEP_LIMIT`, `OP_MENTION_RE`, `collectOpMentions`, `INFORMATIONAL_OP_MENTIONS`, `namesItsOwnOp`, `alwaysLoadedBodies`, `AGENT_ALWAYS_LOADED`, `dispatchRowOp`, `isPrHostOp`, `providerLoadedSet`, `worstCaseProviderLoad`, `worstCasePrHostLoad`, `prHostOpLoad`, `largestTrackerReference`, `largestProviderReference`, `LOADED_SET_WRITTEN_EXCLUSIONS`, `MCP_BACKED_PROVIDERS`, `PRELOADED`
- `tests/fixtures/numeric-floors.json` — the `ceilings` ids above and their derivations
- `src/assets/agents/git.mds`, `src/assets/skills/git/SKILL.md`, `src/assets/mds/tracker/_contract.mds` — the measured artifacts

## Related

- `.devflow/features/tracker-references/KNOWLEDGE.md` — the hub: what moved out of the agent and why a PR-only spawn reads no tracker contract
- `.devflow/features/tracker-references-guards/KNOWLEDGE.md`, `.devflow/features/tracker-references-build-install/KNOWLEDGE.md` — sibling facets
- `.devflow/features/test-harness/KNOWLEDGE.md` — numeric-floors ratchet conventions and the general guard conventions
- Per-spawn billing of shared agent prompts — the economic reason for every ceiling
- Parallel re-derivation of an equality baseline is how derived constants rot — every figure is re-derived from printed test output
- Seam injection over a `dist/` write — the closure probes seed through a reader in memory
- Default-deny is the only direction an absence-based check can be trusted in — `nameableFromProvider`'s classification order and `INFORMATIONAL_OP_MENTIONS`' anchor pinning both apply it
- Non-vacuity — a provider's `MODEL_TRANSITIVE_REFS` row and the closure's non-empty corpus keep the gate from passing on nothing
