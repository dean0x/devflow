---
feature: test-harness
name: Test Harness (agent-source resolver, goldens, seam and guard tests, integration helpers)
description: "Use when adding a new guard test, modifying the agent-source resolver, updating golden fixtures, extending the seam test or integration helpers, understanding the DIST_FILES vs COMMAND_HOSTS split, or working in tests/seams, tests/goldens, tests/guards, tests/fixtures, tests/tracker, tests/dynamic, tests/installer, or tests/integration. Keywords: guard, non-vacuity, golden, seam, agent-source resolver, resolveAgentSource, extractOpSectionFromCorpus, numeric-floor-manifest, ceilings, retired-wording, literal-agent-path, extended-references, capability-hoist, provider-scope, guard-census, heredoc-quoting, pr-link-handoff, depends-on-grammar, reference-overlay, subagent-skill-preload, clause-ii-file-residue, content-anchored, gitOp, between, singleLine, INLINE_BODY_SHAPES, joinContinuations, matchInlineBodyShapes, inlineBodyCorpus, STATUS_LINE_REFERENCE_FILES, requireBuiltCli, fail-loud, skipIf."
category: conventions
directories: [tests/helpers.ts, tests/git-agent.test.ts, tests/seams, tests/goldens, tests/guards, tests/fixtures, scripts/update-golden.ts, tests/integration, tests/tracker, tests/dynamic, tests/installer]
created: 2026-09-06
updated: 2026-09-15
---

# Test Harness

## Overview

The test harness (introduced in PR #327, issue #322 "Tracker Phase 0 — harness first") is the shared infrastructure every tracker-initiative test builds on. It lives in `tests/helpers.ts`, `tests/guards/`, `tests/goldens/`, `tests/seams/`, `tests/integration/`, `tests/tracker/`, `tests/dynamic/`, `tests/installer/`, and `tests/fixtures/`. It is designed around one principle: **a green test that exercises nothing is worse than no test**. Every major test has a non-vacuity probe that proves the detection logic is live.

Tracker Phase 2 (#324, PR #339) grew the harness along the same lines rather than adding new mechanisms: new guard/seam files reuse `helpers.ts`'s corpus builders, follow the same named-collector + known-bad-probe shape, and register their floors in the same manifest. The domain content those new files pin — provider-scope resolution, capability hoisting, byte budgets, containment — belongs to Tracker Phase 2's own architecture and is documented in depth in the sibling `tracker-references` KB; this file documents the harness mechanics only.

The harness has four cohesive pieces: (1) `helpers.ts` exports the shared API — agent-source resolver, corpus extractors, golden loader, fence parsers, and the isolated-MDS-build helpers; (2) guard tests pin source-file invariants, each with a known-bad synthetic probe; (3) golden tests assert byte equality between agent source and a committed fixture; (4) integration tests spawn real `claude` CLI sessions or full tarball installs to verify system-level properties.

## Code Organization Principles

**helpers.ts is the single source of shared logic.** No guard may inline its own collector; it must use the named function from `helpers.ts` or declare a named function in its own file and call it from both the main guard and the non-vacuity probe. A probe that reimplements the logic instead of calling the guard's real collector stays green after the guard breaks (PF-018 violation).

**Injectable `root` parameters enforce test isolation.** Every function that touches `dist/` or `src/` — `resolveAgentSource`, `resolveAllAgents`, `requireDistFile`, `requireDistFiles`, `gitAgentSinkCorpus` — accepts an optional `root` parameter (default `ROOT`). Pass `mkdtempSync(...)` roots in tests that verify throw behaviour or fixture creation; never write into the real `dist/` or `src/`. Vitest runs test files in parallel workers; cross-worker filesystem mutations corrupt other workers' results (PF-055).

**No literal `src/assets/agents/` paths in new test files.** The `literal-agent-paths` guard (`tests/guards/literal-agent-paths.test.ts`) scans `tests/seams/`, `tests/goldens/`, `tests/guards/`, `tests/tracker/`, `tests/dynamic/`, and `tests/installer/` (`SCAN_DIRS`, six entries) for non-comment lines containing `src/assets/agents/`. Use `resolveAgentSource(name)` for all agent content access. New guards under `tests/guards/` reach the agent directories through `agentSourceDirs()` / `agentsDir()` / `compiledAgentsDir()` / `compiledSkillRefsDir()` / `skillsDir()` / `commandsDir()` from `src/core/assets.ts`. Documented exceptions: `tests/helpers.ts` (doc comment only), the guard file itself, and `retired-wording.test.ts`'s `removedFrom` metadata.

## Standard Patterns

### resolveAgentSource / resolveAllAgents

Dist-preferred, src-fallback resolver. `resolveAgentSource(name, root?)` reads its directory order from `agentSourceDirs(root)` (the one owner of the dist-first policy, `src/core/assets.ts`): compiled `dist/agents/<name>.md` first, hand-authored source tree second, throws with a build hint naming both resolved paths when neither exists. `resolveAllAgents(root?)` covers every agent declared in `getAllAgentNames()` — currently 16.

The canonical anti-pattern has a name: `scanned > 0` over the agent corpus. 15 of 16 agents survive that assertion while coverage of `git` silently disappears (GAP-07). Always use the completeness assertion `expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))` and pin the expected count.

The resolver's `origin` field (`'dist' | 'src'`) distinguishes which path was used. `git` is compiled from the generator host `src/assets/agents/git.mds` and resolves with `origin: 'dist'`; the other 15 agents are hand-authored and resolve with `origin: 'src'`. `tests/guards/dist-agents.test.ts` asserts both arms against the real tree, and the loud-failure arm (an unbuilt tree) on the generated agent.

### extractOpSectionFromCorpus

Extracts `## Operation: <name>` sections from a corpus. Every call **must** name its mode explicitly with a one-line why-comment (DR-18):

- `{ mode: 'sole' }` — the contract authority is one file; throws naming both conflicting paths when the anchor appears in more than one corpus file. A first-match implementation would accept a key declared only by a non-authoritative provider, making the seam test permissive. Since Phase 2, `'sole'` lookups deliberately run over a **git.md-only** corpus (built as `gitCorpus = [{ path: git.path, content: git.content }]`, never `gitAgentSinkCorpus()`) — git.md is the single `**Input:**` contract authority. The generated references under `dist/skills/git/references/tracker/github/{op}.md` also open with a `## Operation:` anchor, so unioning them into a `'sole'` lookup would throw on every op that has a generated reference; that throw, if it ever happens by accident, is the intended signal that a `'sole'` call was pointed at the wrong corpus.
- `{ mode: 'union' }` — concatenates all matching sections and returns `matchCount`. A first-match implementation would silently undercount posting-op floors. Union guards (D11 forward/reverse/bypass, D4 detector pins, Guard 2's numeric-bound pins) read `gitAgentSinkCorpus()` so a floor keyed to `## Operation:` content stays valid when mechanics move into a generated reference file.

Sections end at the next `\n## ` in the file. When an op's Output template itself contains `## ` headings, the extracted section is truncated there. File-scope those assertions rather than using the corpus extractor (see AC-0.3 guard pattern in `git-agent.test.ts`, and Direction 3 of the seam test).

### loadGolden

`loadGolden(name)` reads from `tests/fixtures/golden/<name>` and throws with the update-command hint when absent. It never auto-regenerates — a guard that silently skips a missing fixture is not a guard (PF-018).

### requireDistFile / requireDistFiles / requireBuiltCli

All three throw with a build hint when the artifact is absent — `requireDistFile`/`requireDistFiles` for `dist/commands/`, `requireBuiltCli(root = ROOT)` for `dist/cli.js`. The injectable `root` parameter enables hermetic throw-behaviour tests without touching the real dist.

**Doctrine: build artifact → throw (fail-loud); external binary the repo cannot produce → `skipIf` capability gate.** A missing build artifact (anything `npm run build` produces) must fail the suite loudly — a skipped subprocess-CLI test proves nothing and a SKIP mark reads as "fine" in a CI log (PF-018). A missing external binary the repo has no way to produce (e.g. the `claude` CLI) is a legitimate `skipIf` capability gate. Every subprocess-CLI test file calls `requireBuiltCli()` at module scope, so an unbuilt tree is a collection error (exit 1), not a green SKIP. The remaining `skipIf` sites in `tests/` are capability gates: `isClaudeAvailable()`, `IS_WIN32`, `canRevokeWrite`/`canRevokeRead`. CI (`ci.yml`, `release.yml`) runs `npm run build` before `npm test` with no `pretest` hook, so the fail-loud gate only bites locally on an unbuilt tree.

### walkFiles

`walkFiles(dir, accept, maxDepth = 8)` — recursive `readdirSync(withFileTypes)`, deterministic (sorted) order. On `ENOENT` or `ENOTDIR` for a node: returns `[]`. Other errors rethrow. Descent stops at `maxDepth`. Accepts a predicate `accept(filename)` to filter by extension or name. Used by `gitAgentSinkCorpus` for recursive `references/` traversal, and by the Phase-2 guards (`capability-hoist`, `provider-scope`, `heredoc-quoting`) to build their own corpora.

### splitFrontmatter

`splitFrontmatter(text)` → `{ block, inner, body } | null` — splits a document at its leading `---…---` frontmatter block. Returns `null` when there is no block at byte offset 0. One owner for a shape that had been reimplemented per test file. Callers include `build.test.ts`, `build-mds.test.ts`, `build-mds-generator-hosts.test.ts`, `installer-new.test.ts`, and `tests/guards/provider-scope.test.ts` (the no-`tools:`-key frontmatter guard).

### gitAgentSinkCorpus

Builds the D11 sink-class corpus: `git.md` (via `resolveAgentSource('git', root)`) plus all `.md` files under `dist/skills/git/references/` (recursive via `walkFiles`; ENOENT-tolerant — returns `[]` when the directory is absent for Phase 0). The recursive descent covers Phase 2's `references/tracker/github/{op}.md` depth without any changes to the corpus builder. Accepts an injectable `root` parameter (default `ROOT`). Does NOT include `dist/commands` — that is Phase 3a-S14 work. Used by forward/reverse/bypass D11 guards, Guard 2's numeric-bound pins, and `capability-hoist`'s process-block corpus.

### Inline-body scan (joinContinuations / INLINE_BODY_SHAPES / matchInlineBodyShapes / collectInlineBodyOffenders / inlineBodyCorpus)

The D11 bypass guard (`tests/git-agent.test.ts`) reads a shell recipe the way a shell parses it, not the way a human skims it. `joinContinuations(text)` replaces every backslash-newline-indent with a single space BEFORE matching, so a `--body` flag written four lines below its `gh` verb is one command, not four separate lines — exactly how every real #341 offender was written. `INLINE_BODY_SHAPES` names five posting forms independently rather than folding them into one alternation: `long-flag` (`gh (pr|issue|release) <sub> … --(body|notes|comment)[ "]`) catches a comment attached to a close (`gh issue close … --comment`) as a posted body like any other; `short-flag` is verb-restricted to `create|comment|review|close|reopen|edit` so `gh pr checkout -b` is not read as a body flag; `api-field` matches `-f`/`-F`/`--field`/`--raw-field body=` not followed by `@`; `unscrubbed-file` and `unscrubbed-api-file` match a `--body-file`/`--notes-file`/`-F body=@` argument that is not exactly the scrubber's own variable. Each shape is proven live by its own known-bad sample (PF-018 — a five-way alternation inside one regex cannot say which branch carried a match, so a dead arm would be invisible behind the four that still work). `IN_COMMAND` (a character class excluding backticks, newlines, `|`, `;` and `&`) bounds every shape to ONE command — without it, `gh pr diff … | grep -n` would read as a `gh` invocation carrying a `-n` flag.

`matchInlineBodyShapes(text)` folds continuations then returns every shape name that fires. `collectInlineBodyOffenders(corpus)` is the named collector, parameterised on the corpus so the live guard, the shape-table probe, and the baseline known-bad probe all drive the SAME predicate (PF-018). `inlineBodyCorpus()` is the whole installed prompt surface, not just the Git agent's neighbourhood (#341's scope widening): every declared agent via `resolveAllAgents()` (dist-first) ∪ `gitAgentSinkCorpus()` (git.md plus the 13 generated references) ∪ every skill `.md` via `walkFiles(skillsDir(), …)` ∪ every compiled command in `dist/commands/*.md` ∪ every rule in `src/assets/rules/*.md` — deduped by path (~225 files), returning agent and generated counts for provenance. A posting recipe in the review-methodology skill was a publication path outside both the D10 gate and the D11 scrub before #341, with nothing scanning it; the widened scope is what would have caught it. `KNOWN_GITHUB_API_INLINE_BODIES` is an empty array — both `collectUndeclaredOffenders` (forward) and `collectStaleExclusions` (reverse) are asserted over it via known-bad probes seeded at `GITHUB_API_MD_PATH` and `SIBLING_REFERENCE_MD_PATH`, so the reverse arm is non-vacuous over an empty list rather than trivially green.

Three probes prove the arms live (ADR-024/PF-018): the **shape table probe** exercises each of the five `INLINE_BODY_SHAPES` entries against its own known-bad sample (including a backslash-continued `gh issue create` whose `--title`/`--label`/`--body` flags each start a new physical line, and a `gh issue close 12 --comment "## Archived` sample) and confirms the scrubbed forms, a pipe-terminated command, a branch-naming `-b`, and the shipped `gh issue view … --json body -q '.body'` size check do NOT fire; the **baseline known-bad probe** runs `collectInlineBodyOffenders` over the permanent pre-split baseline (`tests/fixtures/tracker/baseline/`) and asserts at least 17 offenders in `github-api.md` and at least 1 in `SKILL.md`, naming five exact #341 offender texts; the **corpus-reach probe** asserts `agents === getAllAgentNames().length`, `generated >= TRACKER_GITHUB_OPS.length + GIT_CROSS_CUTTING_DOCS.length`, five sentinel paths (`src/assets/agents/review.md`, `dist/agents/git.md`, review-methodology's `patterns.md`, `dist/commands/release.md`, one rule) are all reached, and the deduped corpus exceeds 200 files — sentinels rather than a count, so nothing here enters the floor manifest.

### Fence parsing helpers

`parseFences(content)` — extracts all triple-backtick code fences.
`isAgentBlock(fence, type)` — true when a fence spawns the named agent type (matches both `Agent(subagent_type="X")` and `agentType: "X"` forms).

These mirror `registry-integrity.test.ts:449-456` verbatim — that file holds the repo's canonical fence-parsing precedent.

### Isolated MDS builds (buildCommittedTree / runMdsBuild / copyCommittedSources)

A test that needs real compiled artifacts must never get them by rebuilding the repo's own `dist/`: vitest runs other files in parallel workers that read those same paths, so an unscoped build silently REPAIRS a stale `dist/` mid-suite and whichever reader lost the race reports a flake instead of the staleness (PF-055). Every build spawned from `helpers.ts` is redirected to a throwaway root via `DEVFLOW_MDS_ROOT`, over a COPY of the committed `src/assets/{commands,agents,mds}` trees (`copyCommittedSources`). `buildCommittedTree()` compiles the committed corpus once per test file (memoised — the promise, not the value, is cached so concurrent callers await the same build) and returns `{ run, root }`; pair with `cleanupCommittedTree()` in an `afterAll`. `collectSpawnScoping(source)` is a named collector every build-spawning test file runs against its own source, so a future `spawnSync(` site added without `DEVFLOW_MDS_ROOT` fails loud rather than silently repairing the real tree. `tests/seams/pr-link-handoff.test.ts` is the Phase-2 consumer of this pattern for reading deployed command text without touching the real `dist/`.

## Guard Conventions

Every guard in `tests/guards/` (and the Phase-2 additions in `tests/tracker/`, `tests/dynamic/`, `tests/installer/`) follows the same three-part structure:

**1. Named collector.** The violation-detection logic is a named function (e.g., `collectRetiredLiteralViolations`, `collectLiteralAgentPathViolations`, `collectCapabilityHoistViolations`, `collectForeignProviderLiterals`, `collectUnquotedHeredocs`, `countGuards`). This function is called by both the main guard assertion AND the non-vacuity probe. A probe that reimplements the loop inline stays green after the real collector changes (M12b, ADR-024).

**2. Corpus non-vacuity.** Before asserting zero violations, assert that the corpus is non-empty, AND — where a guard claims to scan two sources (e.g. git.md ∪ generated references) — assert by provenance that BOTH contributed, not just that the total crossed a floor. `capability-hoist` and `provider-scope` both split their non-vacuity check into "at least one block from the agent" and "at least one block from the references" for exactly this reason: a floor met by one source alone still claims to scan both (PF-018).

**3. Known-bad probe (mechanic 2 / H10).** Build a synthetic corpus entry or temp root that contains a real violation and confirm the collector flags it. This proves the detection logic is live without touching any committed source file. The probe must exercise the same collector the main guard uses — not an inline re-implementation. Several Phase-2 guards pair a RED probe with a GREEN control in the same test (`heredoc-quoting`'s quoted-delimiter control, `capability-hoist`'s hoisted-probe-above-the-loop control) so a collector that flags everything cannot pass either.

### De-vacuumed guard anti-pattern (AC-0.10 lesson)

The AC-0.10 containment guard had a combined predicate (`<untrusted-issue-body> || <external-thread>`) with floor 3. On unmodified `main`, three pre-existing `<external-thread>` ops satisfied the floor — the guard passed without ever touching any `<untrusted-issue-body>` op. When `setup-task` containment was added via commit `75f13e7`, the combined predicate could not detect that the guard had always been vacuous for the issue-body half.

The fix splits into two independent assertions with **named matching op sets**:
- Issue-body: predicate `<untrusted-issue-body>` ONLY, floor 3, named set `{setup-task, fetch-issue, fetch-issues-batch}`.
- External-thread: predicate `<external-thread>` ONLY, floor 3, named set `{fetch-review-threads, post-resolution-summary, post-wave-report}`.

Rule: when a guard predicate is a logical OR, you cannot tell which branch is carrying the floor. Split into independent assertions with named op sets. Never rely on a combined predicate to validate two distinct contracts.

### DIST_FILES vs COMMAND_HOSTS

The 13/14/14 count rule is owned by the `dynamic-workflow-engine` KB — see there for which number counts what and why the two 14s are different sets.

What the harness owns is how those sets are asserted. Both names are aliases of `tests/fixtures/mds-manifest.ts`, the single definition of *which* files the build owns (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `MDS_GENERATOR_HOSTS`, `DIST_COMMAND_FILES`, `ALL_MDS_HOSTS`). `MDS_PARTIALS` is now 12 entries (raised from 11 in P2-S9 when `_partials/_tracker.mds` landed); `MDS_GENERATOR_HOSTS` is `['git']`. Every assertion site compares against a manifest by set-equality in both directions rather than by a count literal, so a rename plus an addition in one commit cannot stay green; the length floors (`>= 13`, `>= 12`) sit alongside the set-equality and are what `numeric-floors.json` pins. Guards that test deployed behaviour take `DIST_FILES`; guards that test compilation rules take `COMMAND_HOSTS`. The seam test asserts `DIST_FILES.length === 14` as a non-vacuous floor.

### OPERATION: anchor regex

The correct regex for compiled fences is `/^[ \t]*"?OPERATION: (\S+)/m` — allowing leading whitespace and an optional opening double quote. A column-0 anchor (`/^OPERATION: /m`) matches zero of the Git spawn fences in `dist/commands/` and makes the forward/reverse directions iterate an empty map while staying green (PF-018 vacuity failure). The seam test includes an anchor-coverage assertion (`gitFencesMentioningOperation` vs `gitFencesOpMatched`) to catch this failure mode.

### Produces/Requires are DAG annotations, not spawn fields

`**Produces:**` and `**Requires:**` in command sources name principal upstream state for phase ordering. They are explicitly excluded from the seam test's key checks (PF-039). A key matching `PRODUCES` or `REQUIRES` in a fence is not a contract field.

## Goldens Lifecycle

Goldens are committed fixtures that assert file content remains stable. "A golden mismatch means the source is wrong, never the fixture" (H2).

**Two fixtures, current metrics:**
- `tests/fixtures/golden/git-agent.md` — byte-equals the resolved `git` agent (dist-preferred). Current: `GIT_MD_LINES = 904`, `GIT_MD_CHARS = 55_776` (`tests/goldens/github-status-lines.test.ts`), `GIT_AGENT_BYTES = 56_185` (`tests/goldens/git-agent-golden.test.ts`). The fixture regenerates whenever a change moves the compiled agent's bytes — never on a fixed per-phase cadence — always in its own fixture-only commit that also re-sets these three constants. Regenerated three times so far in Phase 2 (`2e019a5`, `10ac94c`, `65e5470`) as GitHub mechanics moved out into generated references and, most recently, as #341's D11 scope-sentence clause grew the agent by one phrase; it was 992 newlines / 65,677 chars / 66,180 bytes at the end of Phase 1.
- `tests/fixtures/golden/github-status-lines.txt` — equals `extractStatusLines()` output. Current: `FIXTURE_BYTES = 17_709`, `FIXTURE_NEWLINES = 249`. **FROZEN through Phase 3** — the `--unfreeze` refusal guard still enforces it. The freeze was overridden exactly ONCE for Phase 2, on an explicit user authorisation dated 2026-09-14 (option A, commit `e4876e0`, after the extractor retarget `dd42ea1`): P2-S4 rewrote sentences the fixture sampled directly, so preserving the fixture and making the contract/mechanics split were mutually exclusive. **That authorisation is spent — it covers this retarget and nothing after it, and is not a precedent for Phase 3.**

**Regeneration protocol:**
`npm run test:golden:update -- git-agent` (via `scripts/update-golden.ts`, tsx). The script resolves `git.md` through `resolveAgentSource` and logs the `origin` field. The **same commit** that runs the regeneration must also re-set `GIT_MD_LINES`/`GIT_MD_CHARS` in `tests/goldens/github-status-lines.test.ts` and `GIT_AGENT_BYTES` in `tests/goldens/git-agent-golden.test.ts` — these are equality baselines that must move atomically with the fixture.

`npm run test:golden:update -- github-status-lines --unfreeze` for the frozen fixture (refused without `--unfreeze`).

**GIT_MD_LINES / GIT_MD_CHARS / GIT_AGENT_BYTES / FIXTURE_BYTES / FIXTURE_NEWLINES are EQUALITY baselines, not floors** — asserted with `toBe`, and deliberately NOT registered in `tests/fixtures/numeric-floors.json` (a floor there would let the artifact grow unbounded; the JSON's own header comment states this explicitly).

**Frozen-fixture refusal re-derivation.** The `--unfreeze --out-dir` refusal test exercises the update script against a temp directory and re-derives the `github-status-lines.txt` fixture byte-for-byte on every `npm test`. Drift is caught mechanically: if the extractor's output has changed since the last freeze, this test fails. CI never regenerates goldens — the `--out-dir <dir>` flag exists specifically so tests can exercise the update script against a temp directory without rewriting the frozen fixture.

**`extractStatusLines()` is CONTENT-ANCHORED, not line-offset based.** The function locates each excerpt using **unique text anchors** rather than hard-coded line numbers — the old implementation used 21 hard-coded ranges like `getLines(git, 238, 252)`, which meant any line insertion above a range silently shifted every anchor below it. The three core helpers:
- `gitOp(opName)` — extracts a named operation section from `git.md`. Uses `\n## Operation:` as the boundary (not `\n## `) to avoid false splits at `## Issue #{n}:` headings inside output templates.
- `between(src, startAnchor, endAnchor)` — extracts content between two text anchors (multi-line anchors supported).
- `singleLine(src, anchor)` — extracts the single line containing an anchor.

`extractStatusLines(gitContent?)` accepts an optional `gitContent` parameter so callers can supply an alternative `git.md` body (e.g. a baseline snapshot for faithfulness-proof testing).

**Phase-2 retarget — generated references and the closed reference list.** Phase 2 moved GitHub mechanics out of `git.md` into generated skill references; nine of the pre-Phase-2 samples were sampling text that moved. Seven were recoverable by pointing the sample at the file the text moved to; two — `manage-debt` and `learn-conventions` — **straddle** the retained/moved boundary (their start anchor moved, their end anchor stayed), so no concatenation of the two files contains the original bytes as a contiguous substring. `D-STRADDLE-SPLIT`: those two are SPLIT into two samples each — the moved half read from the generated reference via `ref()`, the retained half read from `git.md` via `gitOp()` — rather than repointed to one side; the alternative cannot be expressed by `between()`, which slices one string, and dropping either half would silently shrink fixture coverage.

`STATUS_LINE_REFERENCE_FILES` is the closed list of six generated references the corpus samples (`learn-conventions.md`, `publication-gate.md`, `tracker/github/backlink-shipped-issues.md`, `tracker/github/ensure-traceable-issue.md`, `tracker/github/manage-debt.md`, `tracker/github/post-wave-report.md`), read through `compiledSkillRefsDir()` — never a hard-coded `dist/` string. Both directions are enforced: `ref()` refuses a path not on the list (a repoint back to git.md cannot be done quietly), and `extractStatusLines()` refuses to return unless every declared entry was actually read (a stale declared-but-unread entry is caught too).

`D-PROOF-TRANSITION`: the Phase-0 faithfulness gate ran the rewritten extractor over the `b6928e5` baseline and required the OLD fixture back byte-for-byte — that gate cannot be re-run across a deliberate re-capture, since the re-capture is exactly what changes those bytes. The standing proof going forward is the `--unfreeze --out-dir` DERIVATION test: it re-derives the whole fixture from the live tree on every run and compares byte-for-byte, and the inputs it derives from are themselves frozen (`git.md` by the git-agent.md golden; the generated references by the containment oracle's `101bda7` baselines in `tests/fixtures/tracker/baseline/`). A future extractor rewrite inherits this obligation unchanged, with the baseline tree being the re-capture commit rather than `b6928e5`.

**Safety map for `git.md` / generated-reference editors.** Sections still sampled directly from `git.md` (D4 degradation contract, D11 scrub rules, `ensure-pr-ready`, `validate-branch`, `setup-task`, `fetch-issue`, `fetch-issues-batch`, `post-review-summary`, the retained D4/Output halves of `manage-debt` and `learn-conventions`, `check-ci-status`, `create-release`, `gather-release-evidence`, `fetch-review-threads`, `resolve-review-threads`, `post-resolution-summary`, `check-merge-readiness`, plus 3 lines in `code.md` and lines in `dynamic-build.mds`/`resolve.mds`) stay content-anchored and safe to edit above/below the sampled range; editing text INSIDE a sampled anchor or heading needs a fixture-only regen. Sections sampled from the six generated references are sampled from the BUILT file — a source edit under `src/assets/mds/tracker/` needs `npm run build` before the fixture check can even run, and a wording change inside a sampled anchor still needs the fixture-only regen. `manage-debt` and `learn-conventions` need BOTH halves checked (git.md retained half + generated-reference moved half) since each is one straddling operation split across two files.

**Sanctioned post-capture source fix procedure:** Source fix commit → `npm run build` → fixture-only re-capture commit (authorised `--unfreeze` where applicable). Used three times in Phase 0, three more times in Phase 2 for `git-agent.md` (`2e019a5`/`10ac94c`, then source-fix `87c3283` → fixture-only regen `65e5470` for #341's D11 scope-sentence clause) and once for `github-status-lines.txt` (`e4876e0`, under the spent authorisation above).

## Seam Test (command-agent-input.test.ts)

The seam test (`tests/seams/command-agent-input.test.ts`) pins the command→agent input contract (PF-024). It checks three directions against the compiled command corpus (`DIST_FILES`):

1. **Forward** — every `KEY:` value passed in a Git fence is declared in that op's `**Input:**` line in `git.md` (sole corpus; git.md is the single authority).
2. **Reverse** — every non-optional `**Input:**` identifier for an op that has at least one caller fence is passed by at least one caller.
3. **Producer, PER OPERATION** — every entry in `ISSUE_CAPTURE_CONTRACT` names one or more `producerOps` (the git.md operations the command-layer partial says produce it), and `collectMissingProducers()` checks each `(label, op)` pair independently, reporting `{label} → {op}` on failure. The old concatenated form searched a JOIN of `fetch-issue` and `fetch-issues-batch`, so a key produced by only one op read as produced by "the issue-fetching ops" — exactly how `fetch-issues-batch` emitting no `### Handoff Values` block at all stayed invisible while batch flows captured three values from it.

**Ops with callers vs. without:** `git.md` defines 18 `## Operation:` sections; 13 have a live caller fence in `dist/commands/`. The five without are `learn-conventions` (internal, invoked by `setup-task` 1b), `check-ci-status` (prose-only in implement/resolve), `create-release`, `gather-release-evidence`, and `backlink-shipped-issues` (described only in hand-authored `release.md`). The reverse-direction floor is `toBeGreaterThanOrEqual(13)`, pinned as `seam-ops-with-callers` in `numeric-floors.json`.

**`issue_capture_contract()` — six keys, since P2-S9/S10.** `ISSUE_CAPTURE_CONTRACT` has six entries: `ISSUE_CONTENT`, `ACCEPTANCE_CRITERIA`, `ISSUE_REF` (producer ops `fetch-issue`/`fetch-issues-batch` and, for the first two, `setup-task`), plus the three `### Handoff Values` keys `ISSUE_ID`, `ISSUE_PR_LINK`, `ISSUE_BRANCH_TOKEN` — added in P2-S9/S10 when the `### Handoff Values` block was appended to `setup-task` and `fetch-issue` (GAP-15's fix: those two values had been consumed by `code.md` with no producer anywhere). `issue-capture-contract-size` in `numeric-floors.json` counts KEYS (raised 3 → 6); the check itself now ranges over `(key, op)` PAIRS, which is a larger and separately-verified count.

**The three Handoff Values are single-issue-only.** Their `producerOps` name only `setup-task` and `fetch-issue` — `fetch-issues-batch` deliberately does NOT emit them (a batch answers for many issues, so there is no one PR-link line or branch token to render), and a dedicated test asserts `fetch-issues-batch`'s section does NOT contain the `- **PR link line**:` / `- **Branch token**:` / `- **Issue ID**:` patterns, plus that `plan.md` states the single-issue scope in prose (`is emitted by the **single-issue** operations only`). Batch flows must treat these three as `(none)`.

**`'sole'` vs `'union'` corpora, by direction.** Directions 1/2 (`gitCorpus`, built in `beforeAll`) and Direction 3's `collectMissingProducers` both read `git.md` ALONE — `'sole'`-style, because `git.md` is the single `**Input:**`/producer contract authority; the generated references under `dist/skills/git/references/tracker/github/{op}.md` also open with a `## Operation:` anchor, so a union corpus would make every lookup match twice. A `'sole'` throw on a duplicated anchor is the intended signal that a call is pointed at the wrong corpus, not a bug to route around.

`parseInputIdentifiers(section)` scopes to the `**Input:**` line only. A key mentioned only in `**Process:**` is not declared and fails the forward check (MIS-8 failure mode).

Language-tagged fences (` ```js `) are recipe fences and are excluded — a recipe holds many agent calls of different types; attributing fence-level keys to the first `OPERATION:` encountered would be meaningless.

Excluded keys (with rationale): `OPERATION` (routing key), `COMPLIANCE` (injected by orchestrator), `WORKTREE_PATH` (cross-cutting optional), `PRODUCES`/`REQUIRES` (DAG annotations, PF-039), `D9` (decision-ledger annotation restated as a reminder).

## Numeric Floor Manifest (numeric-floors.json)

`tests/fixtures/numeric-floors.json` (DR-27a) is an occurrence-aware hand-registered manifest of pinned numbers, held in **two arrays with opposite directions**:

- `floors` (24 entries) — may only RISE, never fall. A floor pins a minimum the corpus must keep meeting as it grows (e.g. an operation count, a guard count, a manifest size).
- `ceilings` (4 entries, added in Phase 2) — may only be LOWERED, never raised. A ceiling pins a maximum (a byte budget, a preamble line count). §14.5's rule: "a budget raised to fit the artifact is not a budget" — the direction restriction is what keeps it a target rather than a description of whatever the file currently is. The four ceiling entries (`budget-git-md`, `budget-skill-md`, `budget-loaded-set`, `preamble-max-lines`, all in `tests/tracker/byte-budget.test.ts`) are Tracker Phase 2 content owned by the `tracker-references` KB — see there for the derivation of each number.

Both arrays share one mechanism, enforced by `tests/guards/numeric-floor-manifest.test.ts` and by `tests/guards/guard-census.test.ts`'s own self-check: each entry records `id`, `floor`/`ceiling`, `pattern` (the exact assertion string), `occurrences` (how many sites in `sourceFile` must contain the pattern — presence alone is insufficient when a pattern repeats), `sourceFile`, and `description`. The guard verifies the pattern appears at least `occurrences` times; the non-vacuity probe replaces the real pattern with a decremented/incremented one (per direction) and confirms the guard fails. To move an entry: update both the assertion in the source file AND the manifest fields together, and only in the permitted direction.

**Floors and ceilings must stay disjoint** — the same id cannot appear in both arrays with the two enforcing the same pattern in opposite directions. New entries are allowed in either array.

**Phase-2 floor changes of note (all in `floors`):**
- `partial-count`: 11 → 12 when `_partials/_tracker.mds` landed.
- `issue-capture-contract-size`: 3 → 6 for the three new `### Handoff Values` keys (see Seam Test section above); the check itself now ranges per-producer-op rather than over a concatenation.
- New entries: `generated-reference-manifest-size` (13, `tests/installer/reference-overlay.test.ts`), `issue-pr-link-forwarding-sites` (14, `tests/seams/pr-link-handoff.test.ts`), `packed-reference-manifest-size` (13, `tests/packaging.test.ts`), `capability-hoist-block-floor` (29, `tests/guards/capability-hoist.test.ts` — raised from an initial 18 once the guard was proven to scan the generated tree by provenance, not just by total), `git-agent-guard-count` (73, `tests/guards/guard-census.test.ts`), `min-reference-chars` (80, `tests/tracker/containment.test.ts`). The last three belong to Tracker Phase 2's own architecture (see `tracker-references` KB for the containment/byte-budget domain content); `git-agent-guard-count` is documented in full below since it pins the harness's OWN test file.
- `containment-ops-floor` (pre-Phase-2) was split into `containment-issue-body-floor` + `containment-external-thread-floor`, each floor 3 — same de-vacuuming lesson as the AC-0.10 section above.

**Entries are deliberately hand-registered** — automatic scanning would silently add floors for transient numbers and make the manifest untestable as a pinning device.

### git-agent-guard-count (guard-census.test.ts)

`tests/guards/guard-census.test.ts` counts every `it(` / `it.<modifier>(` declaration in `tests/git-agent.test.ts` (`countGuards`, anchored to line start so a `submit(` or a template-string `it(` cannot inflate the count) and asserts it against the `git-agent-guard-count` floor (73), separately from the file it counts — so raising the floor and adding the guard that enforces it are two different edits, not one. Phase 0 stood at 40; this floor is 73: P2-S7 widened the D11 inline-body guard, P2-S4 added four D4/D11 detector guards, `[DR-20]` REPLACED one D10 negative-scope guard with a successor pair of FOUR (two positive assertions, each with its own known-bad probe), and #341 added three: the five-shape inline-body table probe, the pre-split baseline known-bad probe, and the corpus-reach check — so the net effect is visibly not a loss. A second describe block in the same file (`PHASE0_OPERATION_NAMES`, 18 entries) asserts Registry Guard 6 stays green with the OPERATION roster UNCHANGED — Guard 6 checks that spawn-fence and heading names agree, not that the roster is the same roster, so a coordinated rename would keep it green while breaking every caller pinned to the old name.

## New Test Directories (Tracker Phase 2)

Four new directories, each holding one file so far, all following the same guard/seam conventions above:

- **`tests/tracker/`** — `byte-budget.test.ts` (the four Phase-2 ceilings) and `containment.test.ts` (`MIN_REFERENCE_CHARS` floor and the containment oracle over the `101bda7` baselines). Domain content owned by the `tracker-references` KB.
- **`tests/dynamic/`** — `depends-on-grammar.test.ts`: two writer↔reader pairs (`_ticket_template.mds` ↔ `_wave.mds` for the `Depends on:` grammar token; `plan.mds` ↔ `docs-framework/SKILL.md` for artifact naming) plus an AC-2.10 byte-identity battery over four deployed github-path renderings, each pinned by occurrence-COUNT equality (`collectOffCountSites`) rather than `toContain`, so a duplicated or dropped rendering is caught either direction.
- **`tests/installer/`** — `reference-overlay.test.ts`: the converge-not-merge reference overlay (`overlayGeneratedReferences`, `promoteUnitStagingTree`, `sweepOrphanedReferences`) — shadow-independence (AC-2.4a/UAC-28), atomic per-unit swap (AC-2.4b/DR-05), stale-prune and symlink-skip (GAP-24), and the `formatOverlaySummary` render site (PF-015). Fixtures are staged from REAL generated references via `requireBuiltReferences()` (fail-loud, mirrors `requireDistFile`), never invented ones (PF-043).
- **`tests/fixtures/tracker/baseline/`** — `git-agent.md`, `SKILL.md`, `github-api.md`: three Phase-0 baseline snapshots copied from commit `101bda7`. **NEVER regenerated** — they are the pre-split "what did the corpus look like before mechanics moved" reference, used by `pr-link-handoff.test.ts`'s known-bad probe (the Handoff Values were genuinely absent from this baseline) and by the containment oracle. Treat them the same as a golden fixture: a mismatch means something else is wrong, not that the baseline needs updating.

New guards in `tests/guards/`: `capability-hoist.test.ts` (no session-scoped capability probe runs inside a loop, [DR-11]), `provider-scope.test.ts` (Phase 2 is GitHub-only — no Jira/Linear literal outside the one allowlisted provider-map block, no `mcp__`/`MCP` literal on the Git spawn surface, no `tools:` frontmatter key on the Git agent, no `_mcp.md` generated), `guard-census.test.ts` (described above), `heredoc-quoting.test.ts` (no unquoted `<<EOF` heredoc delimiter ships in `src/assets/`, scanned via a frozen `KNOWN_UNQUOTED_HEREDOCS` shrink-only exclusion list for the three legitimate shell-script sites). New seam: `tests/seams/pr-link-handoff.test.ts` (the `### Handoff Values` producer/consumer pair between `git.md` and `code.md`, plus the `ISSUE_PR_LINK` forwarding-sibling check across every `ISSUE_NUMBER:` Code-spawn payload in `implement.md`/`dynamic-build.md`, floor 14).

## Retired-Wording Guard (retired-wording.test.ts)

One shared grep guard with a denylist that grows once per phase — never a new grep, never emptied. Each `RETIRED_LITERALS` entry now carries an optional `scope: readonly string[]` (corpus path-prefixes the literal is retired FROM; absent means the whole corpus). Phase 2 needed this: `gh issue` is retired from the compiled command layer (`dist/commands/`) but LEGITIMATE in `git.md` and its generated references, where it is the mechanics — an unscoped entry could only express the weaker of the two rules. The corpus (`buildCorpus()`) gained a fourth build-output directory, `dist/skills/` — without it, an entry scoped to a generated reference tree would be retired from a tree nothing scans, and the guard has a dedicated check (`every scoped entry names a scope the corpus actually reaches`) to catch exactly that.

Phase-2 denylist rows: `gh issue` (scope `dist/commands/`), `sleep 60` (scope `src/assets/skills/git/`, `dist/agents/git.md`, `dist/skills/git/references/` — GAP-25, three sites all rewritten in P2-S7/P2-S8), `<!-- devflow:` (scope `dist/commands/` — GAP-20, the operation owns the marker, a caller restating it diverged and produced duplicate comments), `{issue}` (scope `src/assets/skills/docs-framework/SKILL.md` — P2-S11 replaced the GitHub-bound placeholder with `{ISSUE_ID}`), plus nine retired §14.2 DEGRADED-reason synonyms (unscoped — a DEGRADED reason is user-visible wherever written, and the canonical table admits one spelling per condition, GAP-13).

## Dist-Agents Guard — AC-1.2 Absence Guard (dist-agents.test.ts)

The Phase-2 construct-absence guard matches **anchored regexes, not substrings**, over a corpus that includes `src/core/mds-variants.ts` and `scripts/build-mds.ts` (the two files whose whole subject is this machinery) alongside the agent sources — so a docblock merely NAMING a Phase-2 construct in prose is not a violation. `LEGALISED_IN_PHASE2 = ['expandVariants(', '(module, op)']` narrows the fence deliberately: those two calls/signatures became legal once the variant-expansion machinery landed. What did NOT become legal and stays forbidden: `@if` (conditional arms are Phase-3-or-later), `variants:` as a line-start YAML key (the roster is a typed registry, not frontmatter), `tracker-<provider>.md` as a filename token (the flat per-provider file shape was disqualified), `{provider}.md` as a templated output name, and `@import`/`@define` inside a compiled AGENT host (reference modules under `src/assets/mds/` use `@define` by design — the forbidden shape is only inside a compiled agent's own body).

## Integration Test Hazards

### Subagent skill preload (tests/integration/subagent-skill-preload.test.ts)

This file spawns real `claude` CLI sessions. Key constraints:

- **Suite is skipped when `claude` is absent** — CI skips the suite.
- **Prompts must stay read-only.** A spawned Git agent once made a real empty commit.
- **Session identity is deterministic.** `runClaudeAndWait` generates a UUID before spawning and passes it via `--session-id <uuid>`.
- **3-second post-SIGTERM wait.** The spawned subagent may still be writing its initialization transcript when the parent exits.
- **One bounded retry.** `MAX_SPAWN_ATTEMPTS = 2`.
- **Excluded from routine integration runs** by `exclude` in `vitest.integration.config.ts`. It spawns live `claude` against the developer's real `~/.claude` and has historically committed to this repo mid-run (PF-060, PF-055). The only way back in is `DEVFLOW_INTEGRATION_ALL` set to an explicit affirmative — `exclude` is applied at glob time, so naming the file on the command line cannot re-add it.

The `subagents/` path follows Claude Code's layout: `~/.claude/projects/-{encoded-cwd}/{sessionId}/subagents/agent-*.jsonl`.

### Clause (ii) file-residue (tests/integration/clause-ii-file-residue.test.ts)

Mechanises the file-residue half of the prefix-shippability clause (ii) acceptance criterion: packs the real tarball, installs into a scratch `$HOME`, creates a throwaway git repo, runs `devflow init --recommended`, and asserts `git status --porcelain` has no `??` (untracked) entries. Non-vacuity assertion: `.gitignore` shows as modified (`M`) so the test cannot pass by doing nothing.

Runtime: ~90–180 s on a warm machine. Run via `npx vitest run --config vitest.integration.config.ts tests/integration/clause-ii-file-residue.test.ts`.

## Anti-Patterns

**Using `scanned > 0` as a non-vacuity check.** Necessary but not sufficient. A corpus with 15 of 16 agents passes `scanned > 0` while `git` silently disappears. Assert completeness against a named set and pin the expected count. Where a guard claims to scan TWO sources, assert both contributed by provenance, not just that the total crossed a floor (capability-hoist, provider-scope).

**Inline reimplementation of collector logic in the probe.** The probe must call the same named collector as the main guard.

**Writing to real `dist/` or `src/` in tests.** Vitest runs files in parallel workers. Always use `mkdtempSync()` + injectable `root` params, or `buildCommittedTree()` for a real compiled corpus.

**Calling `npm run test:golden:update` in CI.** Goldens that regenerate on every run assert nothing about the source file.

**Passing mode-less to `extractOpSectionFromCorpus`.** No default; every call must document its choice.

**Using a bare line-start anchor for OPERATION:.** Use `/^[ \t]*"?OPERATION: (\S+)/m`.

**Combined OR predicate for two distinct contracts.** Split into two independent assertions with named matching op sets.

**Searching the consumer (compiled commands) for a producer signal.** Direction 3 of the seam test must search `git.md` (the emitter), never `DIST_FILES` (the consumer).

**Editing the golden fixture to match a new extractor before proving faithfulness.** Reproduce the existing frozen fixture from the baseline tree FIRST, then run against the newer tree.

**`skipIf` on a build artifact.** Use `requireBuiltCli()` / `requireDistFile(s)` (throw at module scope); reserve `skipIf` for capability gates on external binaries the repo cannot produce.

**A scope that matches no corpus file.** `retired-wording`'s per-entry scope check and `provider-scope`'s allowlist-liveness check both exist because a scope prefix matching nothing silences its entry completely — the same failure shape as a stale exclusion.

## Gotchas

**`extractOpSectionFromCorpus` truncates at `\n## `.** Ops whose Output template contains `## ` headings have their section truncated at the next heading. File-scope assertions for those ops (Direction 3 of the seam test, AC-0.3 in git-agent.test.ts).

**`4b.` step naming collision in `git.md`.** Two numbered `4b.` steps exist; guards that key off `4b.` must scope to the `setup-task` section.

**`extractStatusLines()` is content-anchored, not line-range based.** Adding or removing lines above a sampled section does not break the extractor; renaming a sampled heading or anchor text does — loudly. See the Goldens Lifecycle safety map above for which sections now live in a generated reference rather than `git.md` directly.

**`github-status-lines.txt` is frozen through Phase 3.** Overridden exactly once (2026-09-14, spent). Use `--out-dir <tmpdir>` to test the script safely.

**Fixture byte/line counts must move in the same commit as the fixture.** `FIXTURE_BYTES`/`FIXTURE_NEWLINES`, `GIT_MD_LINES`/`GIT_MD_CHARS`, and `GIT_AGENT_BYTES` are exact `toBe` pins that must move in their fixture's regeneration commit or the tree is red at that boundary.

**`'sole'` mode throwing on a duplicated anchor is a signal, not a bug.** Since Phase 2, git.md operations also have same-named `## Operation:` anchors in the generated references. A `'sole'` call accidentally pointed at a sink-wide corpus (`gitAgentSinkCorpus()`) instead of a git.md-only one will throw — that is the mechanism working, not a regression to route around.

**Known load-sensitive tests.** These flake under full-suite load and should be re-run in isolation before blaming a branch: `hud-render` pair, `capture-hooks memory-worker`, `compliance-e2e S16b`, `eager-memory-refresh S18`, `redact-secrets`, `ledger-ops`, `shell-hooks` (json-helper describe), `decisions-usage-scan`, `safe-delete-command`, goldens `--out-dir` refusal. A full `npm test` may show 10–12 failures across several files that all pass 3/3 in isolation — these are load-induced subprocess-spawn flakes, not regressions.

**No test writes the real `dist/`.** `tests/build-mds.test.ts` and `tests/build-mds-generator-hosts.test.ts` scope every spawn to a temp `DEVFLOW_MDS_ROOT`; each ends with a self-scan (`collectSpawnScoping`) that fails the file if a spawn is added without one. `buildCommittedTree()` in `tests/helpers.ts` gives every OTHER test file the same real-artifacts-without-a-real-dist-write property, memoised per file.

**PF-043 shape requirement.** Test fixtures must be built from real runtime shapes, never invented. `tests/installer/reference-overlay.test.ts`'s `requireBuiltReferences()`/`stageSource()` and the resolver tests' `copyFileSync` both stage from real generated or real agent files.

**`INLINE_BODY_SHAPES`' non-goals are written down, not inferred from a green run (PF-064).** An empty offender list proves only that none of the five named shapes fire on the scanned corpus — it does not prove no sink exists in any form. The table's own docblock names what it deliberately does not read as a sink: the `=` spellings (`--body=…`, `--body-file=…`, `--notes-file=…`), a quoted API field (`-f 'body=…'`), `gh api --input file.json`, and provider-composed notes (`--generate-notes`, `--notes-from-tag`) — each verified absent from the shipped corpus at the time it was written, and a non-goal only while nothing ships it. See the `tracker-references` KB for the domain-content half of #341 — which sinks actually got rewritten to scrub-then-post.

**Mutation-proof pattern (recorded 2026-09-15).** Reintroducing `--comment "x"` on the tech-debt archive's close in `_github.mds` turns the bypass guard red naming `manage-debt.md`; a bare `--body-file body.md` in `git/references/patterns.md` turns it red on `unscrubbed-file`; `-f body=` in review-methodology's `patterns.md` turns it red on `api-field` (proving corpus reach). Deleting a `#341.` containment exemption produces an "unaccounted" failure naming `github-api.md:149`; adding a bogus exemption at baseline line 194 fails "still fully contained" (that range was never touched). Marking one guard `xit` turns the census red: "declares 72 guards, floor 73".

## Key Files

- `tests/helpers.ts` — shared helper API: `resolveAgentSource`, `resolveAllAgents`, `extractOpSectionFromCorpus`, `walkFiles`, `splitFrontmatter`, `gitAgentSinkCorpus`, `loadGolden`, `extractStatusLines` (content-anchored; `STATUS_LINE_REFERENCE_FILES`, `gitOp`/`between`/`singleLine`/`ref` helpers inside), `parseFences`, `isAgentBlock`, `requireDistFile`, `requireDistFiles`, `requireBuiltCli`, `makeManifest`, `computeFpRatio`, and the isolated-build set — `runMdsBuild`, `copyCommittedSources`, `buildCommittedTree`/`cleanupCommittedTree`, `collectSpawnScoping`
- `tests/fixtures/mds-manifest.ts` — the name manifests (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS` = 12, `MDS_GENERATOR_HOSTS` = `['git']`, `HAND_AUTHORED_COMMAND_FILES`, `DIST_COMMAND_FILES`, `ALL_MDS_HOSTS`)
- `tests/guards/dist-agents.test.ts` — dist/agents parity, frontmatter-shape guard, and the AC-1.2 absence guard (`LEGALISED_IN_PHASE2`, anchored-regex forbidden-construct table)
- `tests/guards/agent-source-resolver.test.ts` — resolver unit tests; `extractOpSectionFromCorpus` sole/union mode tests
- `tests/guards/numeric-floor-manifest.test.ts` — floor/ceiling pinning guard; occurrence-aware, direction-aware probe
- `tests/guards/literal-agent-paths.test.ts` — six-entry `SCAN_DIRS`; `requireDistFile`/`requireDistFiles`/`requireBuiltCli` throw-contract tests
- `tests/guards/retired-wording.test.ts` — scoped denylist of retired literals (grows per phase, never emptied)
- `tests/guards/extended-references.test.ts` — SKILL.md Extended References table integrity; `references/tracker/` generated-path exception
- `tests/guards/capability-hoist.test.ts` — [DR-11] no session-scoped capability probe inside a loop; `capability-hoist-block-floor` = 29
- `tests/guards/provider-scope.test.ts` — Phase 2 is GitHub-only, mechanically enforced (4 negatives)
- `tests/guards/guard-census.test.ts` — `git-agent-guard-count` floor (73) and the unchanged 18-op Phase-0 roster
- `tests/guards/heredoc-quoting.test.ts` — unquoted `<<EOF` heredoc scan; shrink-only `KNOWN_UNQUOTED_HEREDOCS` exclusion list
- `tests/seams/command-agent-input.test.ts` — three-direction command→agent seam (PF-024); Direction 3 now per-`(key, op)` pair, floor `seam-ops-with-callers` = 13
- `tests/seams/pr-link-handoff.test.ts` — `### Handoff Values` producer/consumer pair + `ISSUE_PR_LINK` forwarding-sibling check, floor `issue-pr-link-forwarding-sites` = 14
- `tests/tracker/byte-budget.test.ts`, `tests/tracker/containment.test.ts` — Tracker Phase 2 ceilings and containment oracle; owned in depth by the `tracker-references` KB
- `tests/dynamic/depends-on-grammar.test.ts` — `Depends on:` grammar writer↔reader pair, wave fetch-discipline pins, AC-2.10 byte-identity battery
- `tests/installer/reference-overlay.test.ts` — converge-not-merge reference overlay (shadow-independence, atomic swap, prune, `formatOverlaySummary`)
- `tests/goldens/git-agent-golden.test.ts` — byte-equality guard; `GIT_AGENT_BYTES = 56_185` equality baseline
- `tests/goldens/github-status-lines.test.ts` — `extractStatusLines()` stability guard; `FIXTURE_BYTES = 17_709`, `FIXTURE_NEWLINES = 249`; `--unfreeze --out-dir` refusal/derivation test
- `tests/git-agent.test.ts` — 73 `it(` guards (floor pinned in `guard-census.test.ts`); Guard 2's learn-conventions bound pins and D4/D11 detector pins read `gitAgentSinkCorpus()` in `'union'` mode; `[DR-20]` D10 scope successor pair; the D11 bypass guard reads the whole installed prompt surface via `inlineBodyCorpus()` and matches five named `INLINE_BODY_SHAPES` after `joinContinuations()` folds shell line-continuations, with `KNOWN_GITHUB_API_INLINE_BODIES` an **empty** array (#340/#341 scrubbed every recipe to the `--body-file`/`-F body=@`/`--notes-file` chain) — `collectUndeclaredOffenders`/`collectStaleExclusions` and the `GITHUB_API_MD_PATH`/`SIBLING_REFERENCE_MD_PATH` seeded probes keep both arms non-vacuous over the empty list
- `tests/fixtures/golden/git-agent.md` — frozen byte-equal snapshot of the resolved `git` agent (904 newlines, 55,776 chars, 56,185 bytes)
- `tests/fixtures/golden/github-status-lines.txt` — frozen output of `extractStatusLines()`; refused by update script without `--unfreeze` (17,709 bytes / 249 newlines)
- `tests/fixtures/numeric-floors.json` — 28-entry occurrence-aware ratchet manifest: 24 `floors` (rise-only) + 4 `ceilings` (fall-only, Phase 2); floors/ceilings disjoint by id
- `tests/fixtures/tracker/baseline/` — three Phase-0 baseline snapshots copied from `101bda7`; never regenerated
- `scripts/update-golden.ts` — golden update script (tsx); named target required; `--out-dir` for safe test exercising; `--unfreeze` for frozen targets
- `tests/integration/helpers.ts` — `isClaudeAvailable`, `runClaudeAndWait`, `runClaudeStreaming`, `getSubagentPreloadResult`, `buildSubagentsPath`, `parseStreamEvent`
- `tests/integration/subagent-skill-preload.test.ts` — real claude CLI spawn tests; excluded from routine integration runs
- `tests/integration/clause-ii-file-residue.test.ts` — prefix-shippability clause (ii) file-residue guard

## Recorded Exceptions

These are deliberate, documented divergences from the general rules:

| File | Exception | Justification |
|------|-----------|---------------|
| `tests/helpers.ts` | `resolveAgentSource`'s doc comment names the fallback tree in prose; `extractStatusLines()` reads through the resolver and `compiledSkillRefsDir()` | The doc comment is the ONLY `src/assets/agents` mention remaining in tests/ |
| `tests/guards/literal-agent-paths.test.ts` | Self-excluded from its own scan | Defines `LITERAL`, error message strings, and non-vacuity probe corpus entry |
| `tests/guards/retired-wording.test.ts` | Contains `src/assets/agents/` in `removedFrom` metadata | Historical documentation of pre-Phase-0 paths, not code |
| `release.md:85` | Hand-authored in `DIST_FILES` | Inlines its own COMPLIANCE gate; not MDS-compiled |
| `references/tracker/` paths | Excepted from extended-references guard | Phase 2 generated-path; files created at build time, not in src/ |
| `tests/integration/subagent-skill-preload.test.ts` | Spawns real `claude` with `--dangerously-skip-permissions` | Required for subagent spawn; prompts are read-only by test design |
| Seam Direction 3 | Uses file-scoped slicing over `git.md`, not `extractOpSectionFromCorpus` | `fetch-issue`/`fetch-issues-batch` output templates contain `## Issue #` headings that truncate the section at `\n## ` |
| `references/github-api.md` inline bodies | `KNOWN_GITHUB_API_INLINE_BODIES` is empty (#340/#341 rewrote every recipe to scrub-then-post); both arms (`collectUndeclaredOffenders`/`collectStaleExclusions`) stay live via known-bad probes seeded at `GITHUB_API_MD_PATH` and `SIBLING_REFERENCE_MD_PATH` (`skillsDir()`-derived) | The empty array is the declaration point for any future named exception. `INLINE_BODY_SHAPES`' own docblock names its remaining non-goals (PF-064) — the `=` spellings, a quoted API field, `gh api --input`, provider-composed `--generate-notes`/`--notes-from-tag` — each verified absent from the corpus, a non-goal only while nothing ships it |
| `PROVIDER_MAP_ALLOWLIST` (provider-scope.test.ts) | `git.mds`/`git.md`'s provider-resolution preamble block is the one place `jira`/`linear` literals are legal | PF-023: exactly one convergence point where a provider token becomes a path |

## Related

- PF-018: Non-vacuity requirement — every guard must prove its collector is live, not merely that the corpus is non-empty
- PF-024: The command→agent boundary — what the seam test (`command-agent-input.test.ts`) enforces
- PF-035: The skim tool-rewrite hook substitutes a structural view for `cat`/`head`/`tail` reads — use the `Read` tool, not shell reads, when verifying test source files
- PF-039: `**Produces:**`/`**Requires:**` are phase-ordering DAG annotations, not spawn-block field contracts
- PF-043: Test fixtures must be built from real project runtime shapes, not invented
- PF-055: An unscoped rebuild of the real `dist/` silently repairs staleness that parallel workers are concurrently reading, turning it into a flake — `buildCommittedTree()` exists to avoid this
- PF-057: Parallel re-derivation of an equality baseline is how derived constants rot — re-derive from the fixture that already carries the number, not a second measurement
- PF-064: An absence-based guard stacks matcher-expressiveness, corpus-reach, and predicate-semantics claims — `INLINE_BODY_SHAPES`' own non-goals docblock in `tests/git-agent.test.ts` is its worked example
- PF-063: Byte-identical relocation is not semantics-preserving across a grammar boundary — a `##` heading is inert in `SKILL.md` but a section terminator in a generated reference; see `tracker-references` KB for the full entry, and this KB's `extractOpSectionFromCorpus` Gotcha for the mechanical consequence
- ADR-003: Leave-the-end-state-not-the-transition — guard tests must clean up tombstones from prior phases
- ADR-024: Prove-you-wrote-it — the ownership contract that drives non-vacuity probes; named collectors + known-bad probes are its mechanical expression here
- ADR-025: (Tracker Phase 2 architecture decision — see `tracker-references` KB)
- `tracker-references` feature knowledge — owns the Tracker Phase 2 domain content the new guards/seams pin: provider resolution, capability matrix, byte budgets, containment oracle, the generated-reference manifest, and `VARIANT_MODULES`/`expandVariants`
- `tests/registry-integrity.test.ts` — complementary seam test; pins OPERATION: name accuracy (Guard 6, unchanged roster asserted by `guard-census.test.ts`) and fence-parsing precedent (lines 449–456)
- `tests/build-mds.test.ts` — compilation guard that pins deployed behaviour; named collector pattern at `collectGhIssueProseViolations` is the cross-reference for M12a
