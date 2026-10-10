---
feature: test-harness-goldens-budgets
name: Test Harness - Goldens, Numeric Floors, Byte Budgets
description: "Use when regenerating a golden, moving a numeric floor or ceiling, touching a byte-budget row, pricing a body hop, or editing the MDS host manifest. Keywords: golden, numeric-floors.json, byte-budget."
category: conventions
directories: [tests/goldens, tests/fixtures, scripts/update-golden.ts, tests/guards/numeric-floor-manifest.test.ts, tests/tracker/byte-budget.test.ts, tests/tracker/budget-model.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Test Harness - Goldens, Numeric Floors, Byte Budgets

## Rules

- **KB-INV-1** A golden mismatch means the source is wrong, never the fixture: `loadGolden` never auto-regenerates, and CI never runs `test:golden:update`.
- **KB-INV-2** A fixture regenerates in a FIXTURE-ONLY commit that also re-sets the equality baselines pinning its size (`GIT_MD_LINES`, `GIT_MD_CHARS`, `TOTAL_CHARS`, `TOTAL_LINES`, `GIT_AGENT_BYTES`); split across commits the tree is red between them.
- **KB-INV-3** `github-status-lines.txt` is FROZEN: regenerating it needs `--unfreeze` AND a fresh explicit authorisation, and every authorisation granted so far is spent.
- **KB-INV-4** The equality baselines (`GIT_MD_*`, `TOTAL_*`, `GIT_AGENT_BYTES`, `FIXTURE_BYTES`, `FIXTURE_NEWLINES`) are asserted with `toBe` and are NOT registered in `numeric-floors.json`.
- **KB-INV-5** `extractStatusLines()` is content-anchored (`gitOp`/`between`/`singleLine`/`ref` over unique text anchors), never line-offset based, and reads generated references only from the closed `STATUS_LINE_REFERENCE_FILES` list, enforced in both directions.
- **KB-INV-6** A status-line sample that straddles the retained/moved boundary is SPLIT into one read per side, rejoined in step order, never repointed to one side (D-STRADDLE-SPLIT).
- **KB-INV-7** `numeric-floors.json` holds two arrays with opposite directions: floors only RISE, ceilings only get LOWERED, and the two stay disjoint; moving an entry updates the source assertion and the manifest fields together.
- **KB-INV-8** Manifest entries are hand-registered, never scanned: automatic scanning would add floors for transient numbers and make the manifest untestable as a pinning device.
- **KB-INV-9** Loaded-set budgets are priced per path: one row per provider plus its own PR-host row, because `references/pr/` installs under every tracker and a per-provider fold would price one cost three times.
- **KB-INV-10** The body-hop closure follows every op a loaded body mentions to a fixed point (bounded by `CLOSURE_STEP_LIMIT`) and is default-deny: a mention no `INFORMATIONAL_OP_MENTIONS` row explains is a hop.
- **KB-AP-1** Never fold a golden regeneration into a prose commit, and never regenerate on every run: a golden that regenerates asserts nothing about the source.
- **KB-AP-2** A budget raised to fit the artifact is not a budget: ceilings never rise (the one recorded raise is `write-fence-allowlist-size`, on explicit maintainer authorisation) and floors never fall.
- **KB-AP-3** A ratchet entry must not arrive a commit before the fixture-only regeneration that pins its new size: the entry and the fixture land together.
- **KB-AP-4** Parallel re-derivation of an equality baseline is how derived constants rot: re-derive from the fixture that already carries the number.
- **KB-AP-5** A `LOADED_SET_WRITTEN_EXCLUSIONS` entry means something only while it is still reached: pin the exact NAMED op pair that reaches it, never a count.
- **KB-AP-6** A sample read from a generated reference reads the BUILT file: after a source edit under `src/assets/mds/`, run `npm run build` before the fixture check can even run.

## Overview

Three families of pinned numbers live here. **Goldens** are committed fixtures asserting that file content stays stable ("a golden mismatch means the source is wrong, never the fixture"). **The numeric-floor manifest** (`tests/fixtures/numeric-floors.json`) is a hand-registered ratchet of pinned numbers. **The byte budgets** (`tests/tracker/byte-budget.test.ts`, priced by `tests/tracker/budget-model.ts`) cap what a spawn loads. The core resolver, extractor and guard conventions they share are in `test-harness`; the git-agent guard classification they cooperate with is in `test-harness-tracker-guards`.

## Goldens Lifecycle

**Fixtures and equality baselines:**

- `tests/fixtures/golden/git-agent.md` byte-equals the resolved `git` agent (dist-preferred). Its baselines are `GIT_MD_LINES`, `GIT_MD_CHARS`, `TOTAL_CHARS` and `TOTAL_LINES` in `tests/goldens/github-status-lines.test.ts` and `GIT_AGENT_BYTES` in `tests/goldens/git-agent-golden.test.ts`. Splitting the Git agent (which shrank git.md) did not move the frozen status-lines fixture. The fixture regenerates in a FIXTURE-ONLY commit, never folded into a prose commit, and that commit also re-pins both test files; the golden test's own failure message says to move `GIT_AGENT_BYTES` in the SAME commit as the fixture, or the tree is red at that boundary.
- `tests/fixtures/golden/github-status-lines.txt` equals `extractStatusLines()` output; its baselines are `FIXTURE_BYTES` and `FIXTURE_NEWLINES`. It is **FROZEN**: regenerating it needs `--unfreeze` AND a fresh explicit authorisation. Eight have been granted and **all eight are spent**: the extractor retarget (2026-09-14), two `**Mechanics:**` pointer lines (2026-09-15), Refs #350 nine lines (2026-09-20), Refs #359 two of four granted lines (2026-09-24), Refs #352 the check-ci-status bucket-classification lines (2026-09-25), #389 line 241, the Code agent's D11 scrub path (2026-09-27), #383 four lines, the legacy escapes the MDS 0.4.4 migration removed (2026-09-28), and #411 line 207, reply evidence that no longer lists ledger IDs (2026-10-03). Changes that only reach `git-agent.md`, and sampler retargets that change how a sample is read without changing any sampled line, spend none: the fixture then still re-derives byte for byte.
- `tests/fixtures/golden/install-snapshot-{github,jira-hipaa,all-off}.txt` and `hook-matrix.txt` are not frozen, but move only through `npm run test:golden:update -- install-snapshot` in a fixture-only `test(snapshot):` commit; see `test-harness-prompt-install`.

**Regeneration protocol.** `npm run test:golden:update -- git-agent` runs `scripts/update-golden.ts` (tsx); the script resolves `git.md` through `resolveAgentSource` and logs the `origin` field. A named target is required (`git-agent`, `github-status-lines`, `install-snapshot`). `npm run test:golden:update -- github-status-lines --unfreeze` regenerates the frozen fixture and is refused without `--unfreeze`; `--out-dir` exercises the script safely against a temp directory. `install-snapshot` accepts `--only <config>[,<config>]`.

**Frozen-fixture refusal re-derivation.** The `--unfreeze --out-dir` refusal test exercises the update script against a temp directory and re-derives the `github-status-lines.txt` fixture byte-for-byte on every `npm test`. CI never regenerates goldens.

**The equality baselines are NOT floors.** `GIT_MD_LINES`, `GIT_MD_CHARS`, `GIT_AGENT_BYTES`, `FIXTURE_BYTES` and `FIXTURE_NEWLINES` are asserted with `toBe` and deliberately NOT registered in `numeric-floors.json`; fixture byte and line counts move in the same commit as the fixture.

**`extractStatusLines()` is CONTENT-ANCHORED, not line-offset based.** It locates each excerpt with unique text anchors rather than hard-coded line numbers, through these helpers:

- `gitOp(opName)` extracts a named operation section from `git.md`, routed through `extractOpSectionFromCorpus` in `'sole'` mode over a one-entry corpus (`[{ path: 'git.md', content: git }]`).
- `between(src, startAnchor, endAnchor)` extracts content between two text anchors (multi-line anchors supported).
- `singleLine(src, anchor)` extracts the single line containing an anchor.
- `ref(relPath)` reads a generated reference through `compiledSkillRefsDir()`, refused for any path not on `STATUS_LINE_REFERENCE_FILES` via the type predicate `isStatusLineReference`.

`extractStatusLines(gitContent?)` accepts an optional `gitContent` so callers can supply an alternative `git.md` body.

**Generated references and the closed reference list.** `STATUS_LINE_REFERENCE_FILES` is the closed list of generated references the corpus samples: `learn-conventions.md`, `publication-gate.md`, six `pr/{op}.md` files (`check-ci-status`, `check-merge-readiness`, `fetch-review-threads`, `post-resolution-summary`, `post-review-summary`, `resolve-review-threads`; NOT `ensure-pr-ready` or `validate-branch`, which are sampled from Output templates that stayed in `git.md`, and declaring an unread entry trips the unread-entry refusal) and five `tracker/github/{op}.md` files (`backlink-shipped-issues`, `ensure-traceable-issue`, `gather-release-evidence`, `manage-debt`, `post-wave-report`). Both directions are enforced: `ref()` refuses a path not on the list, and `extractStatusLines()` refuses to return unless every declared entry was actually read.

**D-STRADDLE-SPLIT: a sample that spans the retained/moved boundary is SPLIT into two (or three) reads, never repointed to one side.** The straddling operations:

- `manage-debt` and `learn-conventions`: the retained D4/Output half stays in `git.md`, the moved Process half is in the reference.
- `check-ci-status`: the `**Input:**` line stayed, its six steps moved. `fetch-review-threads`: its steps moved, its `**Output:**` header stayed.
- `resolve-review-threads`, the first **three-part** straddle: steps 1-2 and step 4 are in `pr/resolve-review-threads.md` while step 3, applying the D9 gate, stays in `git.md` by rule (D9 has one authority), so the sample reads reference / git.md / reference in step order, the order a spawn executes it in.
- `gather-release-evidence`: the Input line, D4 clause, Mechanics pointer and `**Output:**` label stay in `git.md`; steps 1, 2, 3 and 5 sit in the GitHub reference between the provider's own steps, each one line read by its own anchor and rejoined in step order.
- `post-wave-report`: the moved step 2 sits between the dedup line and the compose opener, so those two are read separately and rejoined with the original single newline.

The last two moved with the provider-neutral step text (D-NEUTRAL-STEP-MOVE, see `test-harness-tracker-guards`); both re-derive the frozen fixture byte for byte, and no other sample reads moved text.

**Safety map for `git.md` / generated-reference editors.** Sections still sampled directly from `git.md` include the D4 degradation contract, the D11 scrub rules, the retained halves of `ensure-pr-ready`/`validate-branch`/`check-ci-status`/`fetch-review-threads`/`resolve-review-threads`/`manage-debt`/`learn-conventions`/`gather-release-evidence`, `setup-task`, `fetch-issue`, `fetch-issues-batch` and `create-release`, plus lines in `code.md` (read as `dist/agents/code.md`), `dynamic-build.mds` and `resolve.mds`. Sections sampled from the generated references are sampled from the BUILT file, so a source edit under `src/assets/mds/tracker/` or `src/assets/mds/git/_pr.mds` needs `npm run build` before the fixture check can even run.

**Sanctioned post-capture source fix procedure:** source fix commit, then `npm run build`, then a fixture-only re-capture commit. The fixture-only regeneration commit and the `numeric-floors.json` / equality-baseline update that pins its new size land TOGETHER, never with the ratchet entry arriving a commit early.

## Numeric Floor Manifest (numeric-floors.json)

`tests/fixtures/numeric-floors.json` (DR-27a) is an occurrence-aware, hand-registered manifest of pinned numbers, held in **two arrays with opposite directions**:

- `floors` may only RISE, never fall. A floor pins a minimum the corpus must keep meeting as it grows.
- `ceilings` may only be LOWERED, never raised. A ceiling pins a maximum; the rule is that a budget raised to fit the artifact is not a budget.

Both arrays share one mechanism, enforced by `tests/guards/numeric-floor-manifest.test.ts`: each entry records `id`, `floor`/`ceiling`, `pattern`, `occurrences`, `sourceFile` and `description`. To move an entry, update both the assertion in the source file AND the manifest fields together, and only in the permitted direction. Floors and ceilings must stay disjoint. Entries are deliberately hand-registered: automatic scanning would silently add floors for transient numbers and make the manifest untestable as a pinning device.

**Floor entries of note.**

- `partial-count` pins `ALL_MDS_PARTIALS`; `dist-host-count` and `dist-files-count` pin the compiled-hosts and `DIST_FILES` assertions of the same file, each pattern naming its own receiver (roster definitions are in `test-harness`).
- `issue-capture-contract-size` counts the KEYS of `ISSUE_CAPTURE_CONTRACT` (the check itself ranges over `(key, op)` pairs).
- `manage-debt-archive-cap` (the 60000-character body cap, `tests/git-agent.test.ts`) has an `occurrences` field that counts: the manage-debt archive threshold, the post-wave-report cap, each summary op's `'union'` positive assertion PLUS its `sinkCorpusWithoutPrHost()` known-bad probe (the literal appears negated too, in a `.not.toContain('60000')`, and the pattern is a substring of both forms, which is why the probes count), and the containment negative arm's in-scope witness.
- `generated-reference-manifest-size` / `packed-reference-manifest-size`: the GitHub, Jira and Linear ops (`TRACKER_OPS`) plus the PR-host ops (`PR_HOST_OPS`) plus the cross-cutting documents (`GIT_CROSS_CUTTING_DOCS`) plus the two contract documents (the tool-call contract and the tracker contract). `capability-hoist-block-floor` counts the `git.md` operation blocks, the `learn-conventions` block, one block per op per provider and the PR-host blocks.
- `installed-reference-count-github` / `installed-reference-count-provider`: since every install carries every provider's tree, the PR-host tree, the cross-cutting documents and both contract documents, whatever the machine selected (D-INSTALL-ALL-PROVIDERS), both ids pin ONE shared constant, `INSTALLED_REFS` (`tests/mds-variants.test.ts`), equal to the build's reference manifest size.
- `min-reference-chars` (`tests/tracker/reference-floor.ts`) and `min-fenced-h2` (`tests/tracker/reference-structure.test.ts`) are harness-owned; `min-fenced-h2` ranges over `TRACKER_GITHUB_OPS ∪ PR_HOST_OPS` (`PER_OP_REFERENCES`), not tracker ops alone, because every per-op reference is extracted the same fence-aware way, `pr/` files included.
- `git-agent-remote-io-ops` (`tests/git-agent.test.ts`) is AC-0.6b's REQUIRED_OPS remote-I/O detection count over `gitPlusPrHostCorpus()`. It replaces a bare `> 0` non-vacuity check, which one detected op satisfies and which therefore could not have caught the PR-host split silently narrowing the set had detection stayed `'sole'`. The D4-evidence half of the same guard stays `git.md`-only on purpose (a spawn can decline to load a reference), so the two halves deliberately read different corpora.
- `issue-pr-link-forwarding-sites` (`tests/seams/pr-link-handoff.test.ts`) counts Code-agent spawn sites carrying `ISSUE_NUMBER` across `implement.md` (the parallel-strategy pr-create spawn included) and `dynamic-build.md`.
- `containment-issue-body-floor` and `containment-external-thread-floor` are two floors rather than one shared ops floor, so neither named set can pass on the other's count.
- The prompt-doctrine rows (`gate-ownership-body-count`, `report-cap-roster-count`, `running-commands-site-count`, `spawn-no-model-agent-type-floor`) are described in `test-harness-prompt-install`. `charter-char-max` is not a floor: it is a maximum, so it sits among the ceilings.

**Ceiling entries of note.**

- The git.md-carrying rows (`budget-git-md`, `budget-loaded-set`, `budget-loaded-set-jira`, `budget-loaded-set-linear`, `budget-loaded-set-pr-host`) are re-derived DOWNWARD whenever a split shrinks the agent, and each sits at exactly the measured size plus a fixed 80-character headroom. Each tracker row carries the tracker contract once per spawn (`contractTerm`), which the git.md cut more than repaid; the Linear row is the largest of the four.
- `budget-loaded-set-pr-host` is its own row (D-LOADED-SET-PER-PROVIDER): `references/pr/` is installed under EVERY tracker, so folding it into a per-provider row would price one cost three times. Formula: preloaded set + `max over PR_HOST_OPS of (chars(pr/{op}.md) + every reference that op's own section names)`, with no separate `max_op` term since a PR-host op's own mechanics file is already inside its one-spawn load. It carries ONE written exclusion, `references/github-api.md` (`LOADED_SET_WRITTEN_EXCLUSIONS` in `tests/tracker/budget-model.ts`), proven load-bearing by a companion test and RECORDED (never hidden) as the `2c-ex` shape in the printed shape table (`shapes.length === 7 + MCP_BACKED_PROVIDERS.length`).
- `budget-skill-md` fell when the skill description shrank. `pr-host-max-op-load` and `mcp-contract-max-chars` are unchanged. `preamble-max-lines` was re-scoped from the agent's preamble to the compiled `tracker/_contract.md` that the provider resolution moved to (the number held, not raised). `tracker-section-max-chars` and `claude-md-tracker-block-max-chars` pre-date all of it.
- Maximums that are not budget rows: `charter-char-max` (the orchestrator charter's character count, 75% of the hook's 4,096-character cap), `arguments-once-max` (`$ARGUMENTS` placeholders per compiled command), `code-preload-max-bytes` (the preloaded skill files of Code, with a learning-off arm in `code-preload.test.ts` whose total is the on total less `apply-decisions`), `ci-wait-max-seconds` (the longest one `ci-wait.cjs` call may wait, under the Bash timeout) and `compact-directive-max-chars` (the compaction resume directive `session-start-context` Section 5 emits on every compact SessionStart; it is a single-quoted constant that interpolates nothing, so the pin holds the EMITTED text, where `tracker-section-max-chars` pins a template). All lower, never rise.
- `write-fence-allowlist-size` is the one ceiling with a recorded raise: 11 to 12 on the maintainer's authorisation of 2026-10-10, for the learning-variant surface; see "Write-set fence" in `test-harness-prompt-install` for why the roster counts as one entry.

## Build Ownership Manifest (tests/fixtures/mds-manifest.ts)

`tests/fixtures/mds-manifest.ts` is the single definition of which files the build owns: `MDS_COMMAND_HOSTS`, `MDS_PARTIALS` (the `_partials/` directory alone), `MDS_REFERENCE_PARTIALS`, `ALL_MDS_PARTIALS` (those two together), `MDS_GENERATOR_HOSTS`, `MDS_REFERENCE_MODULES`, `DIST_COMMAND_FILES` (`MDS_COMMAND_HOSTS` mapped to `.md`), `ALL_MDS_HOSTS`, `ALL_DISCOVERED_HOSTS` (`MDS_COMMAND_HOSTS ∪ MDS_GENERATOR_HOSTS ∪ MDS_REFERENCE_MODULES`), and the learning rosters `LEARNING_VARIANT_HOSTS` (commands plus agents that carry arms; `LEARNING_OFF_FILES` names their files), `SETTINGS_BLOCK_HOSTS` and `SETTINGS_BLOCK_HOSTS_LEARNING_OFF`. The host and partial rosters are named rather than counted, and every assertion site compares against a manifest by set-equality in both directions instead of by a count literal; the settings-block counts are test-local constants beside their assertions, not manifest rows.

- Every command is an MDS host (`release` included), so there is no hand-authored command-file list; `dist-host-count` and `dist-files-count` pin the compiled-hosts and `DIST_FILES` sets, and `build-mds.test.ts` holds a no-static-`.md`-command guard with a known-bad probe: a command that is not a host fails instead of being silently skipped.
- `MDS_REFERENCE_PARTIALS` are the partials parked OUTSIDE `_partials/`: `tracker/_common.mds` (the lines every tracker module writes identically) and `tracker/_steps.mds` (the provider-neutral step text, a module of its own because the resolver's compile cost is exponential in a module's define count). The `partial-count` floor pins `ALL_MDS_PARTIALS`; its discovery assertion is a set-equality against the manifest over a repo-wide walk that classifies by the build's own rule (no `output-dir:` key), so a partial parked outside `_partials/` is named rather than merely counted.
- `MDS_REFERENCE_MODULES` are the GitHub/Jira/Linear tracker fan-outs, the two contract documents (the gated tool-call contract `_mcp.mds` and the ungated tracker contract `_contract.mds`), `git/_pr.mds` (the PR-host fan-out over `PR_HOST_OPS`, installed under every provider) and the cross-cutting-documents module (`GIT_CROSS_CUTTING_DOCS`).

## Body-Hop Closure (byte-budget.test.ts section 4b, D-BODY-HOP-CLOSURE)

Section 4 of `tests/tracker/byte-budget.test.ts` prices what an operation's own reference LITERALS name. Section 4b prices what a LOADED BODY's *prose* points a spawn at: the hop `setup-task` step 1c makes into `ensure-traceable-issue` was a real in-spawn load that no `references/...` literal marked, so nothing priced it until this section existed (D-LOADED-SET-ONE-SPAWN: it happened to fit only because the largest-file term was coincidentally about that size).

- **`MODEL_TRANSITIVE_REFS`** (`tests/tracker/budget-model.ts`) is a per-provider table of `op -> [sibling ops its body hops to]`, FLAT (never a chain), covering only hops no reference literal already prices (`setup-task` to `ensure-traceable-issue`, `gather-release-evidence` / `backlink-shipped-issues` / `associate-release` among themselves, and Linear's `post-wave-report` to `backlink-shipped-issues`, which no other provider states). `summedForProvider(provider, op, transitive?)` is the formula: an op's own load plus the own load of every hop-target; the `transitive` parameter lets the non-vacuity arm re-run the SAME formula with the table emptied.
- **`nameableFromProvider(provider, op, options?)`** is the SCAN half: it reads bodies for real (starting from the op's own load) and follows every op a body mentions to a FIXED POINT (not one hop), with a visited set for cycle termination and `CLOSURE_STEP_LIMIT = 4 * ALL_OPS.length` as a hard throw-bound. It returns a `BodyHopClosure` (`files`, `visited`, `hops`, `informational`, `scanned`, `unreadable`, `steps`). Classification order: a body naming its own op is not a hop; a mention an `INFORMATIONAL_OP_MENTIONS` row explains is not a hop; EVERY OTHER mention is a hop. It is default-deny, so a new pointer lands in `hops` whether or not anyone modelled it.
- **`OP_MENTION_RE` / `collectOpMentions(file, body)`** read a bare op name or a backticked one (not a longer op name that merely contains it as a substring), globally per line.
- **`INFORMATIONAL_OP_MENTIONS`** is the exemption table for mentions that are prose ABOUT another op, never a load directive. Each row is `{file, target, anchor, why}`, checked four ways: `collectStaleRows` (the anchor still exists and still names the target), `collectDirectiveWorded` (`LOAD_VERB_RE`: the clause around the anchor may not say "load", "follow", "run" and the like), `collectShortWhys` (`why` at least `INFORMATIONAL_WHY_MIN_CHARS`, the same floor `single-authority.test.ts` holds its own justifications to) and `collectUnconsultedRows` (a row no live scan actually read is reported, not silently kept).
- **Seeded-reader probes P1-P9** (`describe('byte budget: body-hop closure - seeded-reader probes...')`) drive the exact same collectors over an in-memory `seededReader({...})`, never a `dist/` write. P1/P2 seed a backticked and a bare sibling-op pointer into a tracker body; P3 a pointer inside a `pr/` body, unpriced on every provider at once; P4 a pointer inside a cross-cutting reference (`learn-conventions.md`), unpriced for every op that loads it; P5 a pointer INSIDE a hop's own target, followed to the fixed point rather than one hop deep; P6 a cycle (closing `gather-release-evidence` / `backlink-shipped-issues`) terminates and still reports the half nothing prices; P7 a priced hop whose pointer text is removed is reported dead in `collectDeadTransitiveRows` AND by the scan; P8 a reworded (but still present) anchor loses its `INFORMATIONAL_OP_MENTIONS` exemption and the mention becomes a hop; P9 seeds the earlier `learn-conventions` pointer phrasing back into the always-loaded tracker contract (`tracker/_contract.md`, where the project-key rule lives and which `alwaysLoadedBodies` therefore covers) and shows it would be reported as an always-loaded hop, proving the self-contained UNTRUSTED-strings rewrite was load-bearing, not cosmetic.

## Anti-Patterns

**KB-AP-1: regenerating goldens casually.** Goldens that regenerate on every run assert nothing about the source file, so `npm run test:golden:update` never runs in CI. A frozen fixture is regenerated only under a new explicit authorisation passed alongside `--unfreeze`.

**KB-AP-2: raising a ceiling to fit.** The fix for an over-budget artifact is to cut the artifact; a ceiling is lowered when a split shrinks the agent and is never raised to meet it.

## Gotchas

**KB-INV-2, KB-AP-3: fixture and pin move together.** Fixture byte and line counts must move in the same commit as the fixture. The sanctioned post-capture procedure (source fix, build, fixture-only re-capture) keeps the ratchet entry for the new size in that re-capture commit.

**KB-AP-5: a written exclusion needs a reach check.** `tests/tracker/byte-budget.test.ts` asserts the excluded file (`github-api.md`) is named by `summedFor(op)` for the exact NAMED pair of ops (`fetch-review-threads`, `resolve-review-threads`), not a count, because a count of two is equally satisfied by losing one op and gaining an unrelated one.

## Key Files

- `tests/goldens/git-agent-golden.test.ts` - byte-equality guard (`GIT_AGENT_BYTES`); `tests/goldens/github-status-lines.test.ts` - `extractStatusLines()` stability guard (`GIT_MD_*`, `TOTAL_*`, `FIXTURE_*`) and the authorisation log
- `tests/fixtures/golden/git-agent.md` - byte-equal snapshot of the resolved `git` agent; `tests/fixtures/golden/github-status-lines.txt` - frozen output of `extractStatusLines()`
- `scripts/update-golden.ts` - golden update script (tsx); named target required; `--out-dir` for safe test exercise; `--unfreeze` for frozen targets
- `tests/helpers.ts` - `loadGolden`, `extractStatusLines`, `STATUS_LINE_REFERENCE_FILES`, `gitOp`/`between`/`singleLine`/`ref`/`isStatusLineReference`/`statusLineRefReader`
- `tests/fixtures/mds-manifest.ts` - the build-ownership name manifests (hosts, partials, reference modules, learning rosters)
- `tests/fixtures/numeric-floors.json` - the occurrence-aware ratchet manifest (`floors` rise-only, `ceilings` fall-only); `tests/guards/numeric-floor-manifest.test.ts` - its pinning guard
- `tests/tracker/byte-budget.test.ts` - every `BUDGET_*` ceiling, the section 4b body-hop closure with its P1-P9 probes and the printed shape table
- `tests/tracker/budget-model.ts` - the shared byte-cost model: `nameableFrom`/`summedFor` (GitHub-path reference literals), `nameableFromProvider`/`summedForProvider`/`MODEL_TRANSITIVE_REFS`/`INFORMATIONAL_OP_MENTIONS`/`CLOSURE_STEP_LIMIT` (the body-hop closure), `worstCasePrHostLoad`, `LOADED_SET_WRITTEN_EXCLUSIONS`, `isPrHostOp` (a type predicate), and the tracker-contract terms (`CONTRACT_REL`, `contractTermRels`, `contractTerm` = `_contract.md` on every provider plus `_mcp.md` off the GitHub path, billed to every tracker row and to no PR-host row; `MODEL_CROSS_CUTTING_ASSERTED` = both contracts; `contractBlock()` / `loadingBlock()`)

## Recorded Exceptions

| Where | Exception | Justification |
|-------|-----------|---------------|
| `LOADED_SET_WRITTEN_EXCLUSIONS` (`tests/tracker/budget-model.ts`) | `references/github-api.md` is excluded from the PR-host loaded-set gate's charge, but RECORDED via the `2c-ex` shape and pinned by an equality constant | Two ops loaded it long before any split existed; charging its roughly 21k characters here would bury the `pr/` bodies the row exists to measure |
| `write-fence-allowlist-size` ceiling | The one ceiling raised after registration (11 to 12) | Explicit maintainer authorisation for the learning-variant surface |

## Related

- `.devflow/features/test-harness/KNOWLEDGE.md` - the hub: resolver, extractor modes, guard conventions, build-ownership manifest
- `.devflow/features/test-harness-tracker-guards/KNOWLEDGE.md` - `gitPlusPrHostCorpus()`, `sinkCorpusWithoutPrHost()`, the neutral-step move and the seam test that these numbers pin
- `.devflow/features/test-harness-prompt-install/KNOWLEDGE.md` - install-snapshot goldens and the doctrine rows
- `.devflow/features/tracker-references/KNOWLEDGE.md` - the domain content behind the byte budgets: provider resolution, the generated-reference manifest, the PR-host split rationale
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` - the install shape the installed-reference counts pin
- `tests/mds-variants.test.ts` - `INSTALLED_REFS`
- `src/core/mds-variants.ts` - `GIT_CROSS_CUTTING_DOCS` and the variant module registry
