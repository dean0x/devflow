---
feature: tracker-references-guards
name: "Tracker References: Guard Corpora, Single-Authority and Reachability Guards, Floors and Goldens"
description: "Use when moving text between git.mds and references, or editing the git-agent, single-authority, reachability, capability-hoist or provider-scope guards or the status-lines golden. Keywords: sole, union."
category: architecture
directories: [tests/git-agent.test.ts, tests/tracker, tests/guards/capability-hoist.test.ts, tests/guards/provider-scope.test.ts, tests/guards/requires-closure.test.ts, tests/guards/report-cap.test.ts, tests/seams/pr-link-handoff.test.ts, tests/fixtures/agent-config.ts, tests/fixtures/golden]
created: 2026-10-10
updated: 2026-10-10
---

# Tracker References: Guards, Corpora and Goldens

## Rules

- **KB-INV-1** Every corpus extraction names its mode ([DR-18]): `'sole'` throws when the anchor matches more than one corpus file; `'union'` concatenates and returns a match count.
- **KB-INV-2** After a contract/mechanics split, classify every guard literal individually and widen `'sole'` to `'union'` only where the literal provably moved. Each widening carries a `sinkCorpusWithoutPrHost()` known-bad probe proving it is load-bearing.
- **KB-INV-3** Guards that decide which ops are the subject (the remote-I/O sweep behind `git-agent-remote-io-ops`) read `gitPlusPrHostCorpus()`; literal-presence guards (a fixed op, "can it reach this text?") read the full `gitAgentSinkCorpus()`.
- **KB-INV-4** `extractOpSectionFromCorpus` is fence-aware: a `## ` inside a fenced block does not end the op section, a column-0 `## ` outside one does.
- **KB-INV-5** A degradation clause a spawn can decline to load is not a contract: the remote-I/O guard's D4-evidence half reads `git.md` only, while its detection half reads `gitPlusPrHostCorpus()`.
- **KB-INV-6** The D10 `gh repo view` scope property is a successor pair, not a corpus-wide search: `publication-gate.md` is named from exactly `['post-resolution-summary', 'post-review-summary']` and `gh repo view` appears only in that file.
- **KB-INV-7** Every shipped recipe that posts a body posts the scrubber's output: the `d11-posting-ops` floor spans `git.mds` and the generated references, tracker and PR-host, and `KNOWN_GITHUB_API_INLINE_BODIES` stays empty.
- **KB-INV-8** One normative sentence has one owner: single-authority registries pin every shared literal to the file that owns it, and the three generated copies of a neutral step stay byte-identical.
- **KB-INV-9** Non-vacuity floors rise with the roster and never fall; a provider adds its whole roster at once, so a floor moves by a module rather than by a file.
- **KB-INV-10** `tests/fixtures/golden/github-status-lines.txt` is frozen and `STATUS_LINE_REFERENCE_FILES` is a closed list (its reader, `statusLineRefReader().read`, refuses an undeclared path); each authorisation to re-capture is one-time, and every authorisation to date is spent.
- **KB-AP-1** Blanket-widening a guard corpus to a joined union just to turn it green, without a probe that fails when the moved tree is dropped.
- **KB-AP-2** Widening a detection guard to the full union even when it passes: `setup-task` is then detected as remote-I/O through its TRACKER mechanics, silently changing the subject of a guard about the agent's own degradation contract.
- **KB-AP-3** Editing one provider's copy of a `_steps.mds` step in place, or stripping a gated step's condition from one provider: the single-authority `NEUTRAL_STEPS` arm fails both.
- **KB-AP-4** Letting a shared step open a loop ahead of a provider's hoisted identity lookup: the capability-hoist guard's known-bad probe reports it, which is why `backlink-shipped-issues`' loop bound stayed in the agent.
- **KB-AP-5** Moving text a status-lines sample reads without turning that sample into a straddle sample: re-capturing the fixture needs a fresh authorisation.
- **KB-AP-6** Restating a Principle-8 or D11 containment obligation only in a generated body: the op's own section must carry it.

## Overview

The guards that keep the contract/mechanics split honest read two corpora: `dist/agents/git.md` and the generated reference tree. Their central discipline is corpus classification: after a split, a literal that used to be readable from `git.md` may now live in a reference, and a guard must be pointed at exactly the corpus where the literal provably lives. The hub is `.devflow/features/tracker-references/KNOWLEDGE.md`; the ceilings are `.devflow/features/tracker-references-byte-budget/KNOWLEDGE.md`; the registry and overlay are `.devflow/features/tracker-references-build-install/KNOWLEDGE.md`. General harness conventions (`extractOpSectionFromCorpus`, `collectUnfencedH2`, `gitAgentSinkCorpus`, goldens lifecycle, `walkFiles`) are owned by `.devflow/features/test-harness/KNOWLEDGE.md`.

**The classification rule shaped every guard.** The original tracker split moved only `fetch-issues-batch` step 2 and left `fetch-issue` step 1, specifically so their retained literals could stay `'sole'`-scoped. The PR-host split did the same: every guard it re-pointed from `'sole'` to `'union'` carries its own `sinkCorpusWithoutPrHost()` probe. That is the lens for reading every `extractOpSectionFromCorpus(..., { mode })` call in `tests/git-agent.test.ts`.

**Verification order at PR time.** Byte budget, including the body-hop closure's bidirectional check → single-authority and reachability (each scanning the PR-host tree alongside the provider trees) → the D11, D10, Guard-2 and AC-0.6b corpus guards in `tests/git-agent.test.ts` → the installer overlay tests (both `tracker/` and `pr/` converge and swap atomically) → packaging (the tarball carries the full manifest).

## The corpora

- `gitAgentSinkCorpus()` — the full union of `git.md` and every generated reference; used by literal-presence guards.
- `gitPlusPrHostCorpus()` — `git.md` ∪ the PR-host tree and nothing else; the detection-scoped corpus for guards that decide which ops are the subject.
- `sinkCorpusWithoutPrHost()` — the known-bad probe corpus: drop the PR-host tree and the widened guard must turn red.
- `seedPrHostFile(op, transform)` — returns the corpus with one PR-host file's content transformed in memory, for probes.
- Mode is explicit at every call. `'sole'` throws on a multi-file anchor match; `'union'` returns a count.

`extractOpSectionFromCorpus` is fence-aware, which is the structural remedy for text moved byte-identically across a grammar boundary: a `## ` heading inside a generated reference is safe as a real `##` line only inside a fenced code block; outside any fence it terminates the op's section for every union-mode guard. Every PR-host `### Process` heading and the compose-fence `## ` lines inside the two summary operations' templates follow this rule exactly as the tracker references do. `tests/tracker/reference-structure.test.ts` holds the fence-aware boundary over both trees.

## The guard suites

- **`tests/tracker/single-authority.test.ts`** keeps one normative sentence to one owner. `SHARED_LITERAL_REGISTRY` and `MCP_SHARED_LITERAL_REGISTRY` pin shared literals, each with a rationale of at least `MIN_RATIONALE_CHARS` (`collectUnderJustified`). §5 `TRACKER_CONTRACT_LITERAL_REGISTRY`: every registry sentence lives in `_contract.md` and in no other generated reference or the agent. §6 `NEUTRAL_STEPS` (`D-NEUTRAL-STEP-MOVE`): each `_steps.mds` define is expanded by every provider module and spelled out in none, the three generated copies are byte-identical (`collectDivergentCopies`), and each gated step's condition is present in all three (`collectDroppedConditions`, AC-526), each with a known-bad probe — a copy edited in place in one provider, a condition stripped from one provider's copy. `providerReferenceCorpus()` walks `MECHANICS_TREES` (`tracker/` AND `pr/`), with a non-vacuity arm proving through `readsPrHostTree` that the `pr/` half was read and a known-bad probe walking the real tree without `pr/` that requires the check to fail.
- **`tests/tracker/reference-reachability.test.ts`** — structural parity for both the provider trees and `PR_HOST_OPS` (its own two-directional reachability pair: `collectPrHostNames`, `anchorsOnLineOne`, `reachableSetFrom`), `gather-release-evidence` batch-first, full-manifest reachability in both directions (every generated file is nameable by something the agent reads, every name resolves), and the loading-section arms (`contractsNamedByTheLoadingSection`, `collectLoadingPlacementDefects`, `collectMissingContractRules`): one load instruction and it is the template, the two contracts are fixed loads no operation file names, AC-519 no stop rule for a missing contract, AC-524 the PR-mechanics rule and merged step order stay in the agent. It also holds that every "same logic as `{op}`" in a `pr/` file names that op's `pr/` file and that no step label is supplied by two files loaded for the same op under any provider.
- **`tests/guards/capability-hoist.test.ts`** — session-scoped capabilities must be hoisted before a loop; per-item capabilities inside a bounded loop are the loop's payload (`D-CAPABILITY-PROBE-SCOPE`, `PER_ITEM_PAYLOAD`). Its non-vacuity floor `capability-hoist-block-floor` counts the process blocks of `git.md`, `learn-conventions`, one block per tracker op per provider and one per PR-host op, so it moves by a module rather than a file. The moved neutral steps expand inside each provider's existing `### Process` block, which is why that split left the floor unchanged; known-bad probe 5 reports a shared step that opens a loop ahead of the hoisted lookup. `LOOP_MARKERS`' fan-out justification cites `references/pr/{fetch,resolve}-review-threads.md`.
- **`tests/guards/provider-scope.test.ts`** — the provider-token scope over the Git spawn surface, `ALLOWLISTED_PROVIDER_REGIONS`, and a widened corpus scanning `dist/skills/git/references/pr/` for a stray jira or linear literal (a hostile literal there would be read by every provider's users). It also holds that no `tracker/github/{op}.md` names the tool-call contract.
- **`tests/git-agent.test.ts`** — the D11, D10, Guard-2 and AC-0.6b guards. The conventions-commit placement guard reads `setup-task`'s steps from each provider reference (`PROVIDER_SETUP_TASK_PATH`) and asserts they are absent from `git.md` — the union is load-bearing.
- **`tests/guards/requires-closure.test.ts`** — the bidirectional `requires:` closure over commands ∪ agents ∪ skill bodies and `TEMPLATE_SKILL_REFS`, the classified exception for the Review agent's focus-templated skill reference.
- **`tests/guards/report-cap.test.ts`** and **`tests/fixtures/agent-config.ts`** — Git's frontmatter row and report-cap roster membership (hub KB).
- **`tests/tracker/compliance-gate.test.ts`** — operations never decide compliance: a caller gates and passes a mechanism input (`ISSUE_REQUIRED`, `APPLY_CONVENTIONS`), and the whole op surface (`git.md` plus every generated reference) holds zero condition-shaped compliance mentions.

## Floors

Registered under `floors` in `tests/fixtures/numeric-floors.json` (floors rise, never fall): `generated-reference-manifest-size` and `packed-reference-manifest-size` (build and tarball scope), `installed-reference-count-github` and `installed-reference-count-provider` (one shared `INSTALLED_REFS`, since an install no longer depends on the machine's provider), `min-reference-chars`, `capability-hoist-block-floor`, `git-agent-remote-io-ops` (AC-0.6b, asserted over `gitPlusPrHostCorpus()` with zero headroom), `d11-posting-ops` (zero headroom, over the corpus spanning `git.mds` and the generated references), `report-cap-roster-count`, `manage-debt-archive-cap` and `requires-closure-token-floor`.

## Goldens and the status-lines fixture

`tests/fixtures/golden/github-status-lines.txt` is sampled by `extractStatusLines()` against the closed `STATUS_LINE_REFERENCE_FILES` list in `tests/helpers.ts`. Re-captures have been made only under explicit, one-time user authorisations and every one to date is spent; a further one needs a fresh authorisation. `extractStatusLines()` still equals the frozen fixture byte for byte with zero residual lines. When a split moves a line a sample reads, the sample becomes a `D-STRADDLE-SPLIT` sample: each moved line is read by its own anchor and rejoined in its original order, and the moved-to file joins `STATUS_LINE_REFERENCE_FILES` (the neutral-step move did this for `gather-release-evidence` steps 1, 2, 3 and 5 and `post-wave-report` step 2, which is why it needed no authorisation). The `git-agent.md` golden (`tests/fixtures/golden/git-agent.md`) is regenerated in its own fixture-only commit via `npm run test:golden:update -- git-agent`, and the install-snapshot goldens gain a line when the installed tree gains a file.

## Anti-Patterns

- **KB-AP-1, KB-AP-2** The probe is what separates a relocation from a cosmetic widening. Dropping the PR-host tree from the corpus must turn the guard red, or the guard never needed the tree. Over the full union a detection guard's subject set changes silently, so detection reads the narrower corpus even though the wider one would pass.
- **KB-AP-3** The three provider copies carry the same bytes by construction; an in-place edit in one provider breaks the construction, and a stripped condition leaves a gated step ungated in one provider only.
- **KB-AP-4** The capability-hoist guard's probe verbs are session-scoped only; the loop bound is the loop's payload and not a hoist violation, but a loop line ahead of the hoisted identity lookup is.
- **KB-AP-5** A moved line a sample reads should become a straddle sample read through its own anchor instead of being regenerated into the golden.
- **KB-AP-6** A control cited by name in one section is not a control that lives there. `post-wave-report`'s non-reproduction clause and `post-resolution-summary`'s op-local clause both illustrate it.

## Gotchas

- **KB-INV-3, KB-INV-5** The two halves of the AC-0.6b guard deliberately read different corpora: widening the detection half to `git.md` alone would narrow the detected set silently, because `post-resolution-summary`'s `gh` indicators all moved with its body into `references/pr/post-resolution-summary.md`; widening the D4-evidence half would accept a clause a spawn can decline to load.
- **KB-INV-6** The scope property is unaffected by the PR-host split or the step moves: neither summary op's D10 naming sentence left `git.md`.
- **KB-INV-7** `KNOWN_GITHUB_API_INLINE_BODIES` (`D-INLINE-BODY-EXCLUSIONS`) is an empty array; the guard mechanics (`joinContinuations`, `INLINE_BODY_SHAPES`, `inlineBodyCorpus`) are owned by the test-harness KB.
- **KB-INV-10** The `git-agent.md` and install-snapshot goldens are the ones a split regenerates, in a fixture-only commit; the status-lines fixture is not among them.
- **KB-INV-9** `check-ci-status` stays defined though no command spawns it. `ci-wait.cjs` replaced the Git CI re-spawn, so no command fence names it; it stays for two non-command readers. Its Output `**Status**:` enum is the authority `ci-wait.cjs` is pinned to (`tests/evidence/merge-readiness.test.ts`), and `check-merge-readiness` step 3 loads its PR-host reference for the classification. Removing it would lower `capability-hoist-block-floor` (a floor cannot fall), break PR-host roster parity and ci-wait enum parity, and force a status-lines fixture re-capture. In the agent's `## Output` exempt list its `**Status**:` is classified as "the enum `ci-wait.cjs` is pinned to", not as a field a command reads (`tests/guards/report-cap.test.ts` asserts the operation is still defined and that classification). The PR-only op `/resolve` spawns is `check-merge-readiness`.

## Key Files

- `tests/git-agent.test.ts` — `gitPlusPrHostCorpus()`, `sinkCorpusWithoutPrHost()`, `seedPrHostFile()`, `PROVIDER_SETUP_TASK_PATH`, `joinContinuations`, `INLINE_BODY_SHAPES`, `inlineBodyCorpus`, `KNOWN_GITHUB_API_INLINE_BODIES`, the `d11-posting-ops` and `git-agent-remote-io-ops` floors
- `tests/helpers.ts` — `extractOpSectionFromCorpus`, `gitAgentSinkCorpus`, `STATUS_LINE_REFERENCE_FILES`, `statusLineRefReader`, `extractStatusLines`
- `tests/tracker/single-authority.test.ts`, `tests/tracker/reference-reachability.test.ts`, `tests/tracker/reference-structure.test.ts` — the three tracker suites above
- `tests/guards/capability-hoist.test.ts`, `provider-scope.test.ts`, `requires-closure.test.ts`, `report-cap.test.ts`, `mcp-sink-bypass.test.ts` — the guard suites (the last requires each tool-call posting mechanic to spell its own D11 clauses)
- `tests/seams/pr-link-handoff.test.ts` — Branch token producer pins
- `tests/fixtures/numeric-floors.json` — `floors` listed above
- `tests/fixtures/golden/github-status-lines.txt`, `tests/fixtures/golden/git-agent.md` — the frozen sampling fixture and the Git-agent golden

## Related

- `.devflow/features/tracker-references/KNOWLEDGE.md` — hub; `.devflow/features/tracker-references-byte-budget/KNOWLEDGE.md`, `.devflow/features/tracker-references-build-install/KNOWLEDGE.md` — sibling facets
- `.devflow/features/test-harness/KNOWLEDGE.md` — the general guard conventions this feature's tests follow
- `.devflow/features/test-harness-tracker-guards/KNOWLEDGE.md` — the harness-side view of git-agent guard modes, the command-agent seam and the tracker and PR-host guards; `.devflow/features/test-harness-goldens-budgets/KNOWLEDGE.md` — goldens and budget ratchets
- Guard-mode classification discipline for a contract/mechanics split — the rule this suite follows, including every `sole` to `union` widening
- Non-vacuity — `MIN_VARIANT_PAIRS`, structural parity for both trees, the shared-literal registries' justification floor and the capability-hoist floor all keep a guard from passing on an empty or trivial corpus
- Byte-identical relocation is not semantics-preserving across a grammar boundary — the fence-aware section-boundary rule, applied identically to the PR-host tree
- Containment controls must never become loadable/optional — why the D11 scrub section, the op-local non-reproduction clause and the D9 gate application stay readable from the agent
- Seam injection over a `dist/` write — probes seed bodies in memory rather than mutating a built artifact mid-suite
