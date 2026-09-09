---
feature: test-harness
name: Test Harness (agent-source resolver, goldens, seam and guard tests, integration helpers)
description: "Use when adding a new guard test, modifying the agent-source resolver, updating golden fixtures, extending the seam test or integration helpers, understanding the DIST_FILES vs ALL_HOSTS split, or working in tests/seams, tests/goldens, tests/guards, or tests/integration. Keywords: guard, non-vacuity, golden, seam, agent-source resolver, resolveAgentSource, extractOpSectionFromCorpus, numeric-floor-manifest, retired-wording, literal-agent-path, extended-references, subagent-skill-preload, clause-ii-file-residue, content-anchored, gitOp, between, singleLine."
category: conventions
directories: [tests/helpers.ts, tests/seams, tests/goldens, tests/guards, tests/fixtures, scripts/update-golden.ts, tests/integration]
created: 2026-09-06
updated: 2026-09-09
---

# Test Harness

## Overview

The test harness (introduced in PR #327, issue #322 "Tracker Phase 0 — harness first") is the shared infrastructure that all future tracker-initiative tests build on. It lives in `tests/helpers.ts`, `tests/guards/`, `tests/goldens/`, `tests/seams/`, `tests/integration/`, and `tests/fixtures/`. It is designed around one principle: **a green test that exercises nothing is worse than no test**. Every major test in this harness has a non-vacuity probe that proves the detection logic is live.

The harness has four cohesive pieces: (1) `helpers.ts` exports the shared API — agent-source resolver, corpus extractor, golden loader, and fence parsers; (2) guard tests pin source-file invariants and each includes a known-bad synthetic probe; (3) golden tests assert byte equality between agent source and a committed fixture; (4) integration tests spawn real `claude` CLI sessions or full tarball installs to verify system-level properties.

## Code Organization Principles

**helpers.ts is the single source of shared logic.** No guard may inline its own collector; it must use the named function from `helpers.ts` or declare a named function in its own file and call it from both the main guard and the non-vacuity probe. A probe that reimplements the logic instead of calling the guard's real collector stays green after the guard breaks (PF-018 violation).

**Injectable `root` parameters enforce test isolation.** Every function that touches `dist/` or `src/` — `resolveAgentSource`, `resolveAllAgents`, `requireDistFile`, `requireDistFiles` — accepts an optional `root` parameter (default `ROOT`). Pass `mkdtempSync(...)` roots in tests that verify throw behaviour or fixture creation; never write into the real `dist/` or `src/`. Vitest runs test files in parallel workers; cross-worker filesystem mutations corrupt other workers' results.

**No literal `src/assets/agents/` paths in new test files.** The `literal-agent-paths` guard (`tests/guards/literal-agent-paths.test.ts`) scans `tests/seams/`, `tests/goldens/`, and `tests/guards/` for non-comment lines containing `src/assets/agents/`. Use `resolveAgentSource(name)` for all agent content access. `resolveAgentSource` itself resolves both directories through `agentSourceDirs(root)` from `src/core/assets.ts`, so the only `src/assets/agents` mention left in `tests/helpers.ts` is its doc comment; the `removedFrom` metadata in `retired-wording.test.ts` is the other remaining literal. New guards under `tests/guards/` reach the agent directories through `agentSourceDirs()` / `agentsDir()` / `compiledAgentsDir()` from `src/core/assets.ts`. `tests/installer-new.test.ts` is not an exception: it pins the installer error strings `nonexistent-xyz-ws6a-agent.md` / `ensure the agent file exists`, not a resolution path. Documented exceptions: `tests/helpers.ts` (doc comment only) and the guard file itself.

## Standard Patterns

### resolveAgentSource / resolveAllAgents

Dist-preferred, src-fallback resolver. `resolveAgentSource(name, root?)` reads its directory order from `agentSourceDirs(root)` (the one owner of the dist-first policy, `src/core/assets.ts`): compiled `dist/agents/<name>.md` first, hand-authored source tree second, throws with a build hint naming both resolved paths when neither exists. `resolveAllAgents(root?)` covers every agent declared in `getAllAgentNames()` — currently 16.

The canonical anti-pattern has a name: `scanned > 0` over the agent corpus. 15 of 16 agents survive that assertion while coverage of `git` silently disappears (GAP-07). Always use the completeness assertion `expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))` and pin the expected count — `AGENTS_DIR`/`readAgent` are no longer used anywhere in tests.

The resolver's `origin` field (`'dist' | 'src'`) distinguishes which path was used. `git` is compiled from the generator host `src/assets/agents/git.mds` and resolves with `origin: 'dist'`; the other 15 agents are hand-authored and resolve with `origin: 'src'`. `tests/guards/dist-agents.test.ts` asserts both arms against the real tree, and the loud-failure arm (an unbuilt tree) on the generated agent.

### extractOpSectionFromCorpus

Extracts `## Operation: <name>` sections from a corpus. Every call **must** name its mode explicitly with a one-line why-comment (DR-18):

- `{ mode: 'sole' }` — the contract authority is one file; throws naming both conflicting paths when the anchor appears in more than one corpus file. A first-match implementation would accept a key declared only by a non-authoritative provider, making the seam test permissive.
- `{ mode: 'union' }` — concatenates all matching sections and returns `matchCount`. A first-match implementation would silently undercount posting-op floors.

Sections end at the next `\n## ` in the file. When an op's Output template itself contains `## ` headings, the extracted section is truncated there. File-scope those assertions rather than using the corpus extractor (see AC-0.3 guard pattern in `git-agent.test.ts`).

### loadGolden

`loadGolden(name)` reads from `tests/fixtures/golden/<name>` and throws with the update-command hint when absent. It never auto-regenerates — a guard that silently skips a missing fixture is not a guard (PF-018).

### requireDistFile / requireDistFiles

Both throw with a build hint when `dist/commands/` is absent or the named file does not exist. The injectable `root` parameter enables hermetic throw-behaviour tests without touching the real dist.

### walkFiles

`walkFiles(dir, accept, maxDepth = 8)` — recursive `readdirSync(withFileTypes)`, deterministic (sorted) order. On `ENOENT` or `ENOTDIR` for a node: returns `[]`. Other errors rethrow. Descent stops at `maxDepth`. Accepts a predicate `accept(filename)` to filter by extension or name. Used by `gitAgentSinkCorpus` for recursive `references/` traversal.

### splitFrontmatter

`splitFrontmatter(text)` → `{ block, inner, body } | null` — splits a document at its leading `---…---` frontmatter block: `block` is the whole block including both delimiters and the trailing newline, `inner` its text between them, `body` everything after. Returns `null` when there is no block at byte offset 0 (a block further down the file is body text, the same rule the Claude Code loader and the MDS build apply). One owner for a shape that had been reimplemented per test file, so every caller agrees on CRLF handling and on what counts as frontmatter. Callers: `build.test.ts` (agent `skills:` collector), `build-mds.test.ts` (host `output-dir:`-is-last assertion), `build-mds-generator-hosts.test.ts` (real-agent fixture derivation, compiled-shape and leaked-build-key collectors), `installer-new.test.ts` (agent fixture derivation).

### gitAgentSinkCorpus

Builds the D11 sink-class corpus: `git.md` (via `resolveAgentSource('git', root)`) plus all `.md` files under `dist/skills/git/references/` (recursive via `walkFiles`; ENOENT-tolerant — returns `[]` when the directory is absent for Phase 0). The recursive descent covers Phase 2's `references/tracker/github/{op}.md` depth without any changes to the corpus builder. Accepts an injectable `root` parameter (default `ROOT`) for test isolation. Does NOT include `dist/commands` — that is Phase 3a-S14 work. Used by forward/reverse/bypass D11 guards so the posting-op floor stays valid when mechanics split into compiled reference files in later phases.

### Fence parsing helpers

`parseFences(content)` — extracts all triple-backtick code fences.  
`isAgentBlock(fence, type)` — true when a fence spawns the named agent type (matches both `Agent(subagent_type="X")` and `agentType: "X"` forms).

These mirror `registry-integrity.test.ts:449-456` verbatim — that file holds the repo's canonical fence-parsing precedent.

## Guard Conventions

Every guard in `tests/guards/` follows the same three-part structure:

**1. Named collector.** The violation-detection logic is a named function (e.g., `collectRetiredLiteralViolations`, `collectLiteralAgentPathViolations`, `collectMissingReferences`). This function is called by both the main guard assertion AND the non-vacuity probe. A probe that reimplements the loop inline stays green after the real collector changes (M12b).

**2. Corpus non-vacuity.** Before asserting zero violations, assert that the corpus is non-empty. An empty corpus passes vacuously.

**3. Known-bad probe (mechanic 2 / H10).** Build a synthetic corpus entry or temp root that contains a real violation and confirm the collector flags it. This proves the detection logic is live without touching any committed source file. The probe must exercise the same collector the main guard uses — not an inline re-implementation.

### De-vacuumed guard anti-pattern (AC-0.10 lesson)

The AC-0.10 containment guard had a combined predicate (`<untrusted-issue-body> || <external-thread>`) with floor 3. On unmodified `main`, three pre-existing `<external-thread>` ops satisfied the floor — the guard passed without ever touching any `<untrusted-issue-body>` op. When `setup-task` containment was added via commit `75f13e7`, the combined predicate could not detect that the guard had always been vacuous for the issue-body half.

The fix splits into two independent assertions with **named matching op sets**:
- Issue-body: predicate `<untrusted-issue-body>` ONLY, floor 3, named set `{setup-task, fetch-issue, fetch-issues-batch}`. A named set prevents an unrelated op from satisfying the floor silently.
- External-thread: predicate `<external-thread>` ONLY, floor 3, named set `{fetch-review-threads, post-resolution-summary, post-wave-report}`.

Rule: when a guard predicate is a logical OR, you cannot tell which branch is carrying the floor. Split into independent assertions with named op sets. Never rely on a combined predicate to validate two distinct contracts.

### DIST_FILES vs ALL_HOSTS

A permanent divergence (SG-13) between two related counts:

| Name | Count | What it is |
|------|-------|-----------|
| `DIST_FILES` | 14 | Deployed `dist/commands/*.md` files — 13 MDS-compiled + `release.md` (hand-authored) |
| `ALL_HOSTS` | 13 | MDS **command** host files compiled into `dist/commands/` |

Both are aliases of `tests/fixtures/mds-manifest.ts`, which is the single definition of *which* files the build owns (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `MDS_GENERATOR_HOSTS`, `DIST_COMMAND_FILES`). The build discovers 14 hosts in total — the 13 command hosts plus the one generator host, `src/assets/agents/git.mds` → `dist/agents/git.md`. Sites that used to spell `toHaveLength(13)` / `toHaveLength(11)` / `toBe(14)` now assert set-equality against the manifest in both directions; the length floors (`>= 13`, `>= 11`) sit alongside them and are what `numeric-floors.json` pins.

Guards that test deployed behaviour use `DIST_FILES` (14). Guards that test compilation rules use `ALL_HOSTS` (13). Conflating them produces off-by-one failures. The seam test asserts `DIST_FILES.length === 14` as a non-vacuous floor.

### OPERATION: anchor regex

The correct regex for compiled fences is `/^[ \t]*"?OPERATION: (\S+)/m` — allowing leading whitespace and an optional opening double quote. Prompts inside Agent spawn blocks are often quoted and sometimes indented. A column-0 anchor (`/^OPERATION: /m`) matches zero of the 15 Git spawn fences in `dist/commands/` (15 fences across 18 ops) and makes the forward/reverse directions iterate an empty map while staying green (PF-018 vacuity failure). The seam test includes an anchor-coverage assertion to catch this failure mode.

### Produces/Requires are DAG annotations, not spawn fields

`**Produces:**` and `**Requires:**` in command sources name principal upstream state for phase ordering. They are explicitly excluded from the seam test's key checks (PF-039). A key matching `PRODUCES` or `REQUIRES` in a fence is not a contract field.

## Goldens Lifecycle

Goldens are committed fixtures that assert file content remains stable. "A golden mismatch means the source is wrong, never the fixture" (H2).

**Two fixtures:**
- `tests/fixtures/golden/git-agent.md` — byte-equals the resolved `git` agent, i.e. the compiled `dist/agents/git.md` (via `resolveAgentSource('git')`, dist-preferred). Current metrics: 992 newlines, 65,677 chars, 66,180 bytes. `GIT_AGENT_BYTES = 66_180` in `tests/goldens/git-agent-golden.test.ts` is an equality baseline on the fixture, derived once from `stat -f %z` and deliberately not a floor.
- `tests/fixtures/golden/github-status-lines.txt` — equals `extractStatusLines()` output. Current metrics: 17,914 bytes, 246 newlines. **FROZEN through Phase 3.**

**Regeneration protocol:**
`npm run test:golden:update -- git-agent` (via `scripts/update-golden.ts`, tsx). The script resolves `git.md` through `resolveAgentSource` and logs the `origin` field. The **same commit** that runs the regeneration must also re-set `GIT_MD_LINES = 992` and `GIT_MD_CHARS = 65_677` in `tests/goldens/github-status-lines.test.ts` — these are equality baselines that must move atomically with the fixture.

`npm run test:golden:update -- github-status-lines --unfreeze` for the frozen fixture (refused without `--unfreeze`).

**`GIT_MD_LINES` and `GIT_MD_CHARS` are EQUALITY baselines, not floors.** They assert the golden file's exact current size and are stored directly in `tests/goldens/github-status-lines.test.ts` as `toBe` assertions. They are deliberately NOT registered in `tests/fixtures/numeric-floors.json` (the four `git-md-*` entries that appeared in a prior draft were deleted by user decision D1 and are not a precedent for lowering).

**Frozen-fixture refusal re-derivation.** The `--unfreeze --out-dir` refusal test exercises the update script against a temp directory and re-derives the `github-status-lines.txt` fixture byte-for-byte on every `npm test`. Drift is caught mechanically: if the extractor's output has changed since the last freeze, this test fails.

**Frozen-fixture safety map for `git.md` editors.** `extractStatusLines` samples these specific ranges from `git.md`:
- `setup-task` — from `## Task Setup: {branch-name}` to `- **Acceptance Criteria**: {criteria}` (the Output block only)
- `fetch-issue` / `fetch-issues-batch` — from the `**Degradation (D4):** \`gh\` unauthenticated or absent, tracker unavailable` line to the end of the Output block (avoid reusing that anchor substring elsewhere)
- `learn-conventions` — from `   ## Version Names` to the `**Output:**` fence

Principles sections are not sampled. Process steps outside those ranges are safe to edit; after such an edit, the git-agent golden goes red for exactly one commit until the fixture-only regeneration commit — this is the accepted two-commit pattern.

CI never regenerates goldens. The `--out-dir <dir>` flag exists specifically so tests can exercise the update script against a temp directory without rewriting the frozen fixture — a test that runs the script against the live fixture directory regenerates it on every `npm test`.

**Sanctioned post-capture source fix procedure:**
Source fix commit → `npm run build` → fixture-only re-capture commit (authorised `--unfreeze`). This procedure was used three times during Phase 0: twice in the initial PR and once in commit `3a95c92` (authorised unfreeze after containment changes to `git.md` altered content inside sampled operation sections).

**`extractStatusLines()` is CONTENT-ANCHORED, not line-offset based.** The function locates each excerpt in the resolved `git` and `code` agent sources (via `resolveAgentSource`, so `git` comes from `dist/agents/git.md`) using **unique text anchors** rather than hard-coded line numbers. This is the single most important fact for maintainers: the old implementation used 21 hard-coded ranges like `getLines(git, 238, 252)`, which meant ANY line insertion above a range silently shifted every anchor below it.

The three core helpers:
- `gitOp(opName)` — extracts a named operation section from `git.md`. Uses `\n## Operation:` as the section boundary (deliberately NOT `\n## `) to avoid false splits at `## Issue #{n}:` headings inside output templates.
- `between(src, startAnchor, endAnchor)` — extracts content between two text anchors (multi-line anchors are supported). Used for cross-cutting sections and Guard-5 marker lines that use leading-space-specific anchors to skip search-step lines with similar text.
- `singleLine(src, anchor)` — extracts the single line containing an anchor.

`extractStatusLines(gitContent?)` accepts an optional `gitContent` parameter so callers can supply an alternative `git.md` body (e.g., a baseline snapshot for faithfulness proof testing).

**Faithfulness proof obligation.** Any future rewrite of an extractor MUST reproduce the existing fixture byte-for-byte from the tree the fixture was captured at, BEFORE being run against a newer tree. The proof gate for the content-anchored rewrite: pass the `b6928e5` baseline snapshot of `git.md` as `gitContent` and assert the result equals the frozen `github-status-lines.txt` byte-for-byte. This gate makes the rewrite trustworthy. Editing the fixture to match a new extractor inverts the proof and destroys the contract.

**Fixture freeze baselines** (in `tests/goldens/github-status-lines.test.ts`): `FIXTURE_BYTES = 17_914`, `FIXTURE_NEWLINES = 246`. These must move in the **same commit** as the fixture itself, or the tree is red at that boundary.

## Seam Test (command-agent-input.test.ts)

The seam test (`tests/seams/command-agent-input.test.ts`) pins the command→agent input contract (PF-024). It checks three directions against the compiled command corpus (`DIST_FILES`):

1. **Forward** — every `KEY:` value passed in a Git fence is declared in that op's `**Input:**` line in `git.md` (sole corpus; git.md is the single authority).
2. **Reverse** — every non-optional `**Input:**` identifier for an op that has at least one caller fence is passed by at least one caller.
3. **Producer** — every value in `issue_capture_contract()` has a greppable producer in the **git agent source** (`gitCorpus` built in `beforeAll`). The consumer (`plan.md`) is excluded by construction.

**Ops with callers vs. without:** `git.md` defines 18 `## Operation:` sections; 13 have a live caller fence in `dist/commands/`. The five without are `learn-conventions` (internal, invoked by `setup-task` 1b), `check-ci-status` (prose-only in implement/resolve), `create-release`, `gather-release-evidence`, and `backlink-shipped-issues` (described only in hand-authored `release.md`). The reverse-direction floor is `toBeGreaterThanOrEqual(13)`, and `seam-ops-with-callers` is pinned at floor 13 in `tests/fixtures/numeric-floors.json`.

**Direction 3 de-vacuumed:** The old producer check searched `DIST_FILES` (compiled commands) — the only matching lines were `plan.md`'s own capture lines (the consumer). This found the consumer and called it the producer, concealing that `ISSUE_ID` and `ISSUE_URL` had no producer at all. The fix: point the search at `git.md` via `gitCorpus`, exclude the consumer by construction. Uses file-scoped slicing (not `extractOpSectionFromCorpus`) because `fetch-issue` and `fetch-issues-batch` output templates contain `## Issue #` headings that would truncate the section at `\n## ` — the same pattern as Guard 10. `issue-capture-contract-size` was corrected from 5 → 3 (a deliberate DECREASE: the old value counted two entries that had no producer).

`parseInputIdentifiers(section)` scopes to the `**Input:**` line only. A key mentioned only in `**Process:**` is not declared and fails the forward check (MIS-8 failure mode). The old whole-section `includes()` check silently passed process-only keys.

Language-tagged fences (` ```js `) are recipe fences and are excluded. A recipe holds many agent calls of different types; attributing fence-level keys to the first `OPERATION:` encountered would be meaningless.

Excluded keys (with rationale):
- `OPERATION` — routing key, not an agent `**Input:**` field
- `COMPLIANCE` — injected by orchestrator
- `WORKTREE_PATH` — cross-cutting optional
- `PRODUCES`, `REQUIRES` — DAG annotations, not spawn fields (PF-039)
- `D9` — decision-ledger annotation restated in caller fence as a reminder

## Numeric Floor Manifest (numeric-floors.json)

`tests/fixtures/numeric-floors.json` is an occurrence-aware hand-registered manifest of pinned numeric floors. Each entry records:
- `id` — identifier
- `floor` — the pinned value
- `pattern` — the exact assertion string (e.g., `toBe(13)`) that spells the floor
- `occurrences` — how many sites in `sourceFile` contain the pattern (presence alone is insufficient when a pattern repeats)
- `sourceFile` — relative path to the source file
- `description` — human label

The guard (`tests/guards/numeric-floor-manifest.test.ts`) verifies the pattern appears at least `occurrences` times in `sourceFile`. Floors may never decrease; new entries (additions) are allowed. The non-vacuity probe replaces the real pattern with a decremented one and confirms the guard fails.

To raise a floor: update both the assertion in the source file AND the `floor`, `pattern`, and `occurrences` fields in the manifest.

**Current floor entries of note:**
- The manifest has **17 entries**. `dist-host-count` and `partial-count` were re-spelled in Phase 1 from `toHaveLength(N)` to `toBeGreaterThanOrEqual(N)` at the SAME floors, because the assertions they pinned became set-equalities against `tests/fixtures/mds-manifest.ts` and the floor moved onto the manifest's length. Re-registering a replaced pattern at an equal-or-higher floor is the sanctioned move; removing the entry is not. `GIT_MD_LINES` and `GIT_MD_CHARS` are NOT floor manifest entries — they are equality baselines stored directly in `tests/goldens/github-status-lines.test.ts` as `toBe` assertions. A prior draft referenced `git-agent-line-floor` and `git-agent-char-floor` ids; these never existed and were not added (user decision D1).
- `containment-ops-floor` was split (commit `c56c105`) into two entries: `containment-issue-body-floor` (predicate `<untrusted-issue-body>`, floor 3) and `containment-external-thread-floor` (predicate `<external-thread>`, floor 3). The old single entry could not distinguish which half was carrying the floor.
- `issue-capture-contract-size` was corrected 5 → 3 (a deliberate DECREASE; the old value counted two entries that had no actual producer in `git.md`).

Entries are **deliberately hand-registered** — automatic scanning would silently add floors for transient numbers and make the manifest untestable as a pinning device.

## Integration Test Hazards

### Subagent skill preload (tests/integration/subagent-skill-preload.test.ts)

This file spawns real `claude` CLI sessions. Key constraints:

- **Suite is skipped when `claude` is absent** — CI skips the suite.
- **Prompts must stay read-only.** A spawned Git agent once made a real empty commit.
- **Session identity is deterministic.** `runClaudeAndWait` generates a UUID before spawning and passes it via `--session-id <uuid>`. The subagents directory is then read at the known path rather than by directory-diff. Without `--session-id`, a concurrent devflow memory worker session can create a new UUID directory that the diff picks up instead.
- **3-second post-SIGTERM wait.** The spawned subagent runs independently and may still be writing its initialization transcript (skill preloads appear in the first JSONL lines) when the parent exits. Resolving immediately races with that write.
- **One bounded retry.** `MAX_SPAWN_ATTEMPTS = 2`. Haiku may occasionally answer the parent prompt directly without calling the Agent tool, leaving no `subagents/` directory. One retry almost always succeeds.
- **Excluded from routine integration runs** by `exclude` in `vitest.integration.config.ts`. It spawns live `claude` against the developer's real `~/.claude` and has historically committed to this repo mid-run. Still runnable by explicit path. Before Phase 1 the config had only an `include` filter, so the exclusion was carried out by naming the other files on the command line — i.e. it was a convention, not a config.

The `subagents/` path follows Claude Code's layout:  
`~/.claude/projects/-{encoded-cwd}/{sessionId}/subagents/agent-*.jsonl`  
where the cwd encoding replaces every `/` with `-` and ensures a leading `-`.

### Clause (ii) file-residue (tests/integration/clause-ii-file-residue.test.ts)

Mechanises the file-residue half of the prefix-shippability clause (ii) acceptance criterion. What this file does that neither `pack-install.test.ts` nor `init-e2e-flags.test.ts` does: packs the real tarball, installs into a scratch `$HOME`, creates a throwaway git repo, runs `devflow init --recommended`, and asserts `git status --porcelain` has no `??` (untracked) entries.

Non-vacuity assertion: `.gitignore` shows as modified (`M`) so the test cannot pass by doing nothing (init must have run and written the carve-out).

This test found a real leak on first run (`?? .claudeignore`) which was fixed by commit `7074733` (gitignore v4 carve-out adds `.claudeignore`). The `.fails()` marker was removed after the fix.

What remains manual: the "no new prompt" half, and the five-command walk-through (`/plan → /implement → /code-review → /resolve → /release`) require a live model and authenticated GitHub project.

Runtime: ~90–180 s on a warm machine. Run via `npx vitest run --config vitest.integration.config.ts tests/integration/clause-ii-file-residue.test.ts`.

## Anti-Patterns

**Using `scanned > 0` as a non-vacuity check.** Asserting the corpus is non-empty is necessary but not sufficient. A corpus with 15 of 16 agents passes `scanned > 0` while the `git` agent silently disappears. Assert `expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))` and pin the expected count.

**Inline reimplementation of collector logic in the probe.** The probe must call the same named collector as the main guard. A probe that reimplements the violation loop inline stays green after the real collector changes — proving only that the probe's inline code is correct, not that the guard is live.

**Writing to real `dist/` or `src/` in tests.** Vitest runs files in parallel workers. Tests that write into the shared `dist/` or `src/` tree corrupt other workers' state mid-run. Always use `mkdtempSync()` + injectable `root` params.

**Calling `npm run test:golden:update` in CI.** Goldens that regenerate on every run assert nothing about the source file.

**Passing mode-less to `extractOpSectionFromCorpus`.** The function requires an explicit `opts: { mode: ... }`. There is no default; every call must document its choice.

**Using a bare line-start anchor for OPERATION:.** The regex `/^OPERATION: /m` matches zero fences in the compiled corpus because fences are quoted and sometimes indented. Use `/^[ \t]*"?OPERATION: (\S+)/m`.

**Combined OR predicate for two distinct containment contracts.** Using `<untrusted-issue-body> || <external-thread>` with a single floor cannot distinguish which branch carries the load. Split into two independent assertions with named matching op sets.

**Searching the consumer (compiled commands) for a producer signal.** Direction 3 of the seam test must search `git.md` (the emitter), not `DIST_FILES` (which contains the consumer capture lines). Grepping the consumer and calling it the producer is vacuous and conceals missing producers.

**Editing the golden fixture to match a new extractor before proving faithfulness.** Any extractor rewrite must reproduce the existing frozen fixture from the baseline tree FIRST (the faithfulness proof), THEN be run against the newer tree. Editing the fixture to match skips the proof entirely.

## Gotchas

**`extractOpSectionFromCorpus` truncates at `\n## `.** Ops whose Output template contains `## ` headings (e.g., a multi-section output) have their section truncated at the next heading. File-scope assertions for those ops rather than using the corpus extractor on the full section. This is why Direction 3 of the seam test uses file-scoped slicing for `fetch-issue` and `fetch-issues-batch`.

**`learn-conventions` truncates at `## Conventions Learned`.** When using `extractOpSectionFromCorpus` to extract the `learn-conventions` section, the extractor truncates at the `## Conventions Learned` heading inside the Output fence. Assertions about content inside that heading (e.g., absence of `commit --only`) must use file-scoped slicing on the `learn-conventions` section directly rather than the corpus extractor.

**`4b.` step naming collision in `git.md`.** `git.md` has two numbered `4b.` steps: `ensure-pr-ready` has an unrelated `4b.` earlier in the file, and `setup-task` has its canonical `4b.` AFTER `git checkout -b "$DEVFLOW_BRANCH"`. The `collectConventionsCommitPlacementViolations` guard scopes its `4b.` check to the `setup-task` section to avoid the false positive from the earlier occurrence.

**`extractStatusLines()` is content-anchored, not line-range based.** Adding or removing lines in `git.md` above a sampled section does NOT break the extractor — `gitOp()` finds the section by heading text, `between()` by surrounding text anchors, and `singleLine()` by a unique anchor. If a section heading or anchor text is renamed, the extractor throws explicitly rather than silently extracting wrong content. Re-capture the fixture after any `git.md` change that alters text inside a sampled operation's heading or anchor strings.

**`github-status-lines.txt` is frozen through Phase 3.** The update script refuses the target without `--unfreeze`. A test that invokes the update script against the live fixture directory violates this freeze. Use `--out-dir <tmpdir>` to test the script safely.

**Goldens `--out-dir` refusal test is load-sensitive.** The `tsx` process spawned by the `--out-dir`/`--unfreeze` refusal test can exceed its timeout under full-suite load. It passes in isolation but flakes when run as part of `npm test`. Add it to the known load-sensitive list before attributing failures to a regression.

**Fixture byte/line counts must move in the same commit as the fixture.** `FIXTURE_BYTES` and `FIXTURE_NEWLINES` in `tests/goldens/github-status-lines.test.ts` are exact `toBe` pins. Moving them in a separate commit from the fixture leaves the tree red at that boundary commit. Similarly, `GIT_MD_LINES` and `GIT_MD_CHARS` must move in the same fixture-only regeneration commit as `tests/fixtures/golden/git-agent.md`.

**Known load-sensitive tests.** These tests flake under full-suite load and should be re-run in isolation before blaming a branch: `hud-render` pair, `capture-hooks memory-worker`, `compliance-e2e S16b`, `eager-memory-refresh S18`, `spawnSync npx ETIMEDOUT` in `build-mds`, `redact-secrets`, `ledger-ops`, `shell-hooks` (json-helper describe), `decisions-usage-scan`, goldens `--out-dir` refusal. A full `npm test` may show 10–12 failures across 7 files that all pass 3/3 in isolation — these are load-induced subprocess-spawn flakes, not regressions.

**Only `tests/build-mds.test.ts` still builds into the real `dist/`.** Its happy-path spawn (`:477`) and the `expected-command-set` `beforeAll` (`:515`) run `scripts/build-mds.ts` with no `DEVFLOW_MDS_ROOT`, so they REWRITE `dist/commands/` and `dist/agents/` while vitest runs other files in parallel workers that read those paths (`goldens/git-agent-golden`, `packaging`, `registry-integrity`, `seams/command-agent-input`, `build-mds-generator-hosts`). PID-scoping the build's staging file (`<dest>.<pid>.tmp`) fixed the writer/writer clash only; the writer/reader clash remains — a real-root build silently repairs a stale `dist/` mid-suite, so the staleness reports as a flake in whichever reader lost the race, never as itself (PF-055). `tests/build-mds-generator-hosts.test.ts` no longer does this: every spawn there is scoped to a temp root (`buildCommittedTree()` copies `src/assets/{commands,agents}` and builds the copy), and its scenario-12 self-scan fails the file if a spawn is added without `DEVFLOW_MDS_ROOT`. Applying the same treatment to `build-mds.test.ts` is open work.

**PF-043 shape requirement.** Test fixtures must be built from real runtime shapes — copy actual agent files rather than hand-authoring content. A fixture built from an invented shape asserts nothing about production code. The resolver tests use `copyFileSync` to populate the temp root from real agent files.

## Key Files

- `tests/helpers.ts` — shared helper API: `resolveAgentSource`, `resolveAllAgents`, `extractOpSectionFromCorpus`, `walkFiles(dir, accept, maxDepth = 8)`, `splitFrontmatter(text)`, `gitAgentSinkCorpus(root?)` (recursive references/**), `loadGolden`, `extractStatusLines(gitContent?)` (content-anchored; `gitOp`/`between`/`singleLine` helpers inside), `parseFences`, `isAgentBlock`, `requireDistFile`, `requireDistFiles`, `makeManifest`, `computeFpRatio`
- `tests/fixtures/mds-manifest.ts` — the name manifests (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `MDS_GENERATOR_HOSTS`, `HAND_AUTHORED_COMMAND_FILES`, `DIST_COMMAND_FILES`, `ALL_MDS_HOSTS`); consumed by `build-mds.test.ts`, `packaging.test.ts` and `build-mds-generator-hosts.test.ts`
- `tests/guards/dist-agents.test.ts` — dist/agents parity (both directions, fail-loud), escaped-brace guard, frontmatter-shape guard (every compiled agent starts with a block carrying `name:` — its collector emits one row **per header found**, not per file, so a headerless artifact shows up as a short array the caller compares against the file count rather than as a row whose flag someone forgot to assert; PF-018), no-.md-shadowing-an-.mds guard, resolver-origin proofs (AC-1.6/AC-1.3), and the AC-1.2 absence guard for Phase-2 constructs
- `tests/guards/agent-source-resolver.test.ts` — resolver unit tests; dist-preferred and src-fallback proofs; `extractOpSectionFromCorpus` sole/union mode tests
- `tests/guards/numeric-floor-manifest.test.ts` — floor pinning guard; occurrence-aware, decrement probe covers every entry
- `tests/guards/literal-agent-paths.test.ts` — forbids `src/assets/agents/` literals in new test files; exception list with justifications; `requireDistFile`/`requireDistFiles` throw-contract tests
- `tests/guards/retired-wording.test.ts` — denylist of retired literals (grows per phase, never emptied, never generates new greps); one shared grep guard (GAP-32); current entries include `ISSUE_NUMBERS`, `ISSUE: {issue`, `close milestone`, `may pre-fetch`, `issue-first gate`
- `tests/guards/extended-references.test.ts` — SKILL.md Extended References table integrity; generated-path exception list seeded for Phase 2 (`references/tracker/`)
- `tests/seams/command-agent-input.test.ts` — three-direction command→agent seam (PF-024); forward, reverse, producer (Direction 3 sources from git.md via gitCorpus, not DIST_FILES); `parseInputIdentifiers` scoped to `**Input:**`; 18 ops, 13 with caller fences, floor `toBeGreaterThanOrEqual(13)`
- `tests/goldens/git-agent-golden.test.ts` — byte-equality guard against `tests/fixtures/golden/git-agent.md`; `GIT_MD_LINES = 992` / `GIT_MD_CHARS = 65_677` are equality baselines (not floors; not in numeric-floors.json)
- `tests/goldens/github-status-lines.test.ts` — `extractStatusLines()` stability guard; `FIXTURE_BYTES = 17_914`, `FIXTURE_NEWLINES = 246`; `--unfreeze --out-dir` refusal test re-derives the fixture byte-for-byte on every run
- `tests/git-agent.test.ts` — includes `collectConventionsCommitPlacementViolations(corpus)`: asserts `setup-task` contains `commit --only -- .devflow/conventions.md`, `CONVENTIONS_COMMIT: skipped (no branch)`, and `4b.` AFTER `git checkout -b`; asserts `learn-conventions` has no `commit --only` (file-scoped slice); asserts `fetch-issues-batch`/`fetch-issue` contain `NOT_FOUND ({refs})` and `Strip a leading \`#\``
- `tests/fixtures/golden/git-agent.md` — frozen byte-equal snapshot of `git.md` (992 newlines, 65,677 chars, 66,180 bytes); regenerate via `npm run test:golden:update -- git-agent`
- `tests/fixtures/golden/github-status-lines.txt` — frozen output of `extractStatusLines()`; refused by update script without `--unfreeze`; 17,914 bytes / 246 newlines
- `tests/fixtures/numeric-floors.json` — 17-entry occurrence-aware floor manifest; hand-registered; `containment-issue-body-floor` + `containment-external-thread-floor` (split from old `containment-ops-floor`); `issue-capture-contract-size` = 3; `seam-ops-with-callers` = 13
- `scripts/update-golden.ts` — golden update script (tsx); named target required; `--out-dir` for safe test exercising; `--unfreeze` for frozen targets; resolves git.md through `resolveAgentSource` and logs `origin`
- `tests/integration/helpers.ts` — `isClaudeAvailable`, `runClaudeAndWait`, `runClaudeStreaming`, `getSubagentPreloadResult`, `buildSubagentsPath`, `parseStreamEvent`
- `tests/integration/subagent-skill-preload.test.ts` — real claude CLI spawn tests; `MAX_SPAWN_ATTEMPTS = 2`; skips when claude absent; must be excluded from routine integration runs
- `tests/integration/clause-ii-file-residue.test.ts` — prefix-shippability clause (ii) file-residue guard; packs real tarball, installs into scratch HOME, runs `devflow init --recommended`, asserts no `??` in `git status --porcelain`

## Recorded Exceptions

These are deliberate, documented divergences from the general rules:

| File | Exception | Justification |
|------|-----------|---------------|
| `tests/helpers.ts` | `resolveAgentSource`'s doc comment names the fallback tree in prose; `extractStatusLines()` reads git.md and code.md through the resolver | The doc comment is the ONLY `src/assets/agents` mention remaining in tests/ — the resolution paths come from `agentSourceDirs(root)` |
| `tests/guards/literal-agent-paths.test.ts` | Self-excluded from its own scan | Defines `LITERAL`, error message strings, and non-vacuity probe corpus entry |
| `tests/guards/retired-wording.test.ts` | Contains `src/assets/agents/` in `removedFrom` metadata | Historical documentation of pre-Phase-0 paths, not code |
| `release.md:85` | Hand-authored in `DIST_FILES` | Inlines its own COMPLIANCE gate; not MDS-compiled |
| `gh pr view` at `code-review.mds`, `bug-analysis.mds`, `resolve.mds:63` | Three occurrences allowlisted in `build-mds.test.ts` by filename | Legitimate traceability operations |
| `references/tracker/` paths | Excepted from extended-references guard | Phase 2 generated-path; files created at build time, not in src/ |
| `tests/integration/subagent-skill-preload.test.ts` | Spawns real `claude` with `--dangerously-skip-permissions` | Required for subagent spawn; prompts are read-only by test design |
| Direction 3 producer search | Uses file-scoped slicing over `git.md`, not `extractOpSectionFromCorpus` | `fetch-issue`/`fetch-issues-batch` output templates contain `## Issue #` headings that truncate the section at `\n## ` |

## Related

- PF-018: Non-vacuity requirement — every guard must prove its collector is live, not merely that the corpus is non-empty
- PF-024: The command→agent boundary — what the seam test (`command-agent-input.test.ts`) enforces
- PF-035: The skim tool-rewrite hook substitutes a structural view for `cat`/`head`/`tail` reads — use the `Read` tool, not shell reads, when verifying test source files
- PF-039: `**Produces:**`/`**Requires:**` are phase-ordering DAG annotations, not spawn-block field contracts — explicitly excluded from seam key checks
- PF-043: Test fixtures must be built from real project runtime shapes, not invented; the resolver tests copy actual agent files via `copyFileSync`
- ADR-003: Leave-the-end-state-not-the-transition — guard tests must clean up tombstones from prior phases
- ADR-024: Prove-you-wrote-it — the ownership contract that drives non-vacuity probes; named collectors + known-bad probes are its mechanical expression in this harness
- `tests/registry-integrity.test.ts` — complementary seam test; pins OPERATION: name accuracy (Guard 6) and fence-parsing precedent (lines 449–456)
- `tests/build-mds.test.ts` — compilation guard that pins deployed behaviour; named collector pattern at `collectGhIssueProseViolations` is the cross-reference for M12a
