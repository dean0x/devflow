---
feature: test-harness
name: Test Harness (agent-source resolver, goldens, seam and guard tests, integration helpers)
description: "Use when adding a new guard test, modifying the agent-source resolver, updating golden fixtures, extending the seam test or integration helpers, understanding the DIST_FILES vs ALL_HOSTS split, or working in tests/seams, tests/goldens, tests/guards, or tests/integration. Keywords: guard, non-vacuity, golden, seam, agent-source resolver, resolveAgentSource, extractOpSectionFromCorpus, numeric-floor-manifest, retired-wording, literal-agent-path, extended-references, subagent-skill-preload."
category: conventions
directories: [tests/helpers.ts, tests/seams, tests/goldens, tests/guards, tests/fixtures, scripts/update-golden.ts, tests/integration]
created: 2026-09-06
updated: 2026-09-06
---

# Test Harness

## Overview

The test harness (introduced in PR #327, issue #322 "Tracker Phase 0 — harness first") is the shared infrastructure that all future tracker-initiative tests build on. It lives in `tests/helpers.ts`, `tests/guards/`, `tests/goldens/`, `tests/seams/`, `tests/integration/`, and `tests/fixtures/`. It is designed around one principle: **a green test that exercises nothing is worse than no test**. Every major test in this harness has a non-vacuity probe that proves the detection logic is live.

The harness has four cohesive pieces: (1) `helpers.ts` exports the shared API — agent-source resolver, corpus extractor, golden loader, and fence parsers; (2) guard tests pin source-file invariants and each includes a known-bad synthetic probe; (3) golden tests assert byte equality between agent source and a committed fixture; (4) integration tests spawn real `claude` CLI sessions to verify subagent skill preloading.

## Code Organization Principles

**helpers.ts is the single source of shared logic.** No guard may inline its own collector; it must use the named function from `helpers.ts` or declare a named function in its own file and call it from both the main guard and the non-vacuity probe. A probe that reimplements the logic instead of calling the guard's real collector stays green after the guard breaks (PF-018 violation).

**Injectable `root` parameters enforce test isolation.** Every function that touches `dist/` or `src/` — `resolveAgentSource`, `resolveAllAgents`, `requireDistFile`, `requireDistFiles` — accepts an optional `root` parameter (default `ROOT`). Pass `mkdtempSync(...)` roots in tests that verify throw behaviour or fixture creation; never write into the real `dist/` or `src/`. Vitest runs test files in parallel workers; cross-worker filesystem mutations corrupt other workers' results.

**No literal `src/assets/agents/` paths in new test files.** The `literal-agent-paths` guard (`tests/guards/literal-agent-paths.test.ts`) scans `tests/seams/`, `tests/goldens/`, and `tests/guards/` for non-comment lines containing `src/assets/agents/`. Use `resolveAgentSource(name)` for all agent content access. Documented exceptions: `tests/helpers.ts` (reads `src/assets/agents/git.md` by design for `extractStatusLines()`), `tests/installer-new.test.ts` (pins an error message string, not a resolution path), and the guard file itself.

## Standard Patterns

### resolveAgentSource / resolveAllAgents

Dist-preferred, src-fallback resolver. `resolveAgentSource(name, root?)` checks `dist/agents/<name>.md` first, falls back to `src/assets/agents/<name>.md`, throws with a build hint when neither exists. `resolveAllAgents(root?)` covers every agent declared in `getAllAgentNames()` — currently 16.

The canonical anti-pattern has a name: `scanned > 0` over the agent corpus. 15 of 16 agents survive that assertion while coverage of `git` silently disappears (GAP-07). Always use `resolveAllAgents() ⊇ getAllAgentNames()` as the non-vacuous floor instead.

The resolver's `origin` field (`'dist' | 'src'`) distinguishes which path was used. In Phase 0, before `dist/agents/` is built, all agents resolve from `src` — this is expected and the non-vacuity probe in `agent-source-resolver.test.ts` accounts for it.

### extractOpSectionFromCorpus

Extracts `## Operation: <name>` sections from a corpus. Every call **must** name its mode explicitly with a one-line why-comment (DR-18):

- `{ mode: 'sole' }` — the contract authority is one file; throws naming both conflicting paths when the anchor appears in more than one corpus file. A first-match implementation would accept a key declared only by a non-authoritative provider, making the seam test permissive.
- `{ mode: 'union' }` — concatenates all matching sections and returns `matchCount`. A first-match implementation would silently undercount posting-op floors.

Sections end at the next `\n## ` in the file. When an op's Output template itself contains `## ` headings, the extracted section is truncated there. File-scope those assertions rather than using the corpus extractor (see AC-0.3 guard pattern in `git-agent.test.ts`).

### loadGolden

`loadGolden(name)` reads from `tests/fixtures/golden/<name>` and throws with the update-command hint when absent. It never auto-regenerates — a guard that silently skips a missing fixture is not a guard (PF-018).

### requireDistFile / requireDistFiles

Both throw with a build hint when `dist/commands/` is absent or the named file does not exist. The injectable `root` parameter enables hermetic throw-behaviour tests without touching the real dist.

### gitAgentSinkCorpus

Builds the D11 sink-class corpus: `git.md` (always) plus compiled skill references under `dist/skills/git/references/*.md` (ENOENT-tolerant for Phase 0). Used by forward/reverse/bypass D11 guards so the posting-op floor stays valid when mechanics split into compiled reference files in later phases.

### Fence parsing helpers

`parseFences(content)` — extracts all triple-backtick code fences.  
`isAgentBlock(fence, type)` — true when a fence spawns the named agent type (matches both `Agent(subagent_type="X")` and `agentType: "X"` forms).

These mirror `registry-integrity.test.ts:449-456` verbatim — that file holds the repo's canonical fence-parsing precedent.

## Guard Conventions

Every guard in `tests/guards/` follows the same three-part structure:

**1. Named collector.** The violation-detection logic is a named function (e.g., `collectRetiredLiteralViolations`, `collectLiteralAgentPathViolations`, `collectMissingReferences`). This function is called by both the main guard assertion AND the non-vacuity probe. A probe that reimplements the loop inline stays green after the real collector changes (M12b).

**2. Corpus non-vacuity.** Before asserting zero violations, assert that the corpus is non-empty. An empty corpus passes vacuously.

**3. Known-bad probe (mechanic 2 / H10).** Build a synthetic corpus entry or temp root that contains a real violation and confirm the collector flags it. This proves the detection logic is live without touching any committed source file. The probe must exercise the same collector the main guard uses — not an inline re-implementation.

### DIST_FILES vs ALL_HOSTS

A permanent divergence (SG-13) between two related counts:

| Name | Count | What it is |
|------|-------|-----------|
| `DIST_FILES` | 14 | Deployed `dist/commands/*.md` files — 13 MDS-compiled + `release.md` (hand-authored) |
| `ALL_HOSTS` | 13 | MDS host files compiled by `npm run build:mds` |

Guards that test deployed behaviour use `DIST_FILES` (14). Guards that test compilation rules use `ALL_HOSTS` (13). Conflating them produces off-by-one failures. The seam test asserts `DIST_FILES.length === 14` as a non-vacuous floor.

### OPERATION: anchor regex

The correct regex for compiled fences is `/^[ \t]*"?OPERATION: (\S+)/m` — allowing leading whitespace and an optional opening double quote. Prompts inside Agent spawn blocks are often quoted and sometimes indented. A column-0 anchor (`/^OPERATION: /m`) matches zero of the 18 Git fences in `dist/commands/` and makes the forward/reverse directions iterate an empty map while staying green (PF-018 vacuity failure). The seam test includes an anchor-coverage assertion to catch this failure mode.

### Produces/Requires are DAG annotations, not spawn fields

`**Produces:**` and `**Requires:**` in command sources name principal upstream state for phase ordering. They are explicitly excluded from the seam test's key checks (PF-039). A key matching `PRODUCES` or `REQUIRES` in a fence is not a contract field.

## Goldens Lifecycle

Goldens are committed fixtures that assert file content remains stable. "A golden mismatch means the source is wrong, never the fixture" (H2).

**Two fixtures:**
- `tests/fixtures/golden/git-agent.md` — byte-equals `dist/agents/git.md` (dist-preferred) or `src/assets/agents/git.md` (Phase 0 fallback)
- `tests/fixtures/golden/github-status-lines.txt` — equals `extractStatusLines()` output

**Regeneration protocol:**  
`npm run test:golden:update -- git-agent` (via `scripts/update-golden.ts`, tsx).  
`npm run test:golden:update -- github-status-lines --unfreeze` (frozen through Phase 3; refused without `--unfreeze`).

CI never regenerates goldens. The `--out-dir <dir>` flag exists specifically so tests can exercise the update script against a temp directory without rewriting the frozen fixture — a test that runs the script against the live fixture regenerates it on every `npm test`.

**Sanctioned post-capture source fix procedure:**  
Source fix commit → `npm run build` → re-anchor line references (for `extractStatusLines`) → fixture-only re-capture commit. This was done twice in this PR (`a5dd078`, `38db29e`).

**`extractStatusLines()` is line-range sensitive.** It reads specific line ranges from `src/assets/agents/git.md`, `src/assets/agents/code.md`, `src/assets/commands/dynamic-build.mds`, and `src/assets/commands/resolve.mds`. Any edit that shifts those line numbers requires re-deriving the anchors by content and re-capturing the golden.

## Seam Test (command-agent-input.test.ts)

The seam test (`tests/seams/command-agent-input.test.ts`) pins the command→agent input contract (PF-024). It checks three directions against the compiled command corpus (`DIST_FILES`):

1. **Forward** — every `KEY:` value passed in a Git fence is declared in that op's `**Input:**` line in `git.md` (sole corpus; git.md is the single authority).
2. **Reverse** — every non-optional `**Input:**` identifier for an op that has at least one caller fence is passed by at least one caller.
3. **Producer** — every value in `issue_capture_contract()` has a greppable producer in `DIST_FILES`.

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

Entries are **deliberately hand-registered** — automatic scanning would silently add floors for transient numbers and make the manifest untestable as a pinning device.

## Integration Test Hazards

`tests/integration/subagent-skill-preload.test.ts` spawns real `claude` CLI sessions. Key constraints:

- **Suite is skipped when `claude` is absent** — CI skips the suite.
- **Prompts must stay read-only.** A spawned Git agent once made a real empty commit.
- **Session identity is deterministic.** `runClaudeAndWait` generates a UUID before spawning and passes it via `--session-id <uuid>`. The subagents directory is then read at the known path rather than by directory-diff. Without `--session-id`, a concurrent devflow memory worker session can create a new UUID directory that the diff picks up instead.
- **3-second post-SIGTERM wait.** The spawned subagent runs independently and may still be writing its initialization transcript (skill preloads appear in the first JSONL lines) when the parent exits. Resolving immediately races with that write.
- **One bounded retry.** `MAX_SPAWN_ATTEMPTS = 2`. Haiku may occasionally answer the parent prompt directly without calling the Agent tool, leaving no `subagents/` directory. One retry almost always succeeds.

The `subagents/` path follows Claude Code's layout:  
`~/.claude/projects/-{encoded-cwd}/{sessionId}/subagents/agent-*.jsonl`  
where the cwd encoding replaces every `/` with `-` and ensures a leading `-`.

## Anti-Patterns

**Using `scanned > 0` as a non-vacuity check.** Asserting the corpus is non-empty is necessary but not sufficient. A corpus with 15 of 16 agents passes `scanned > 0` while the `git` agent silently disappears. Assert `resolveAllAgents() ⊇ getAllAgentNames()` and pin the expected count.

**Inline reimplementation of collector logic in the probe.** The probe must call the same named collector as the main guard. A probe that reimplements the violation loop inline stays green after the real collector changes — proving only that the probe's inline code is correct, not that the guard is live.

**Writing to real `dist/` or `src/` in tests.** Vitest runs files in parallel workers. Tests that write into the shared `dist/` or `src/` tree corrupt other workers' state mid-run. Always use `mkdtempSync()` + injectable `root` params.

**Calling `npm run test:golden:update` in CI.** Goldens that regenerate on every run assert nothing about the source file.

**Passing mode-less to `extractOpSectionFromCorpus`.** The function requires an explicit `opts: { mode: ... }`. There is no default; every call must document its choice.

**Using a bare line-start anchor for OPERATION:.** The regex `/^OPERATION: /m` matches zero fences in the compiled corpus because fences are quoted and sometimes indented. Use `/^[ \t]*"?OPERATION: (\S+)/m`.

## Gotchas

**`extractOpSectionFromCorpus` truncates at `\n## `.** Ops whose Output template contains `## ` headings (e.g., a multi-section output) have their section truncated at the next heading. File-scope assertions for those ops rather than using the corpus extractor on the full section.

**`extractStatusLines()` is line-range bound.** It reads specific line numbers from four source files. A source edit that shifts those line numbers silently changes the extractor's output, making `github-status-lines.txt` stale. Re-derive anchors by content and re-capture after any source edit touching those ranges.

**`github-status-lines.txt` is frozen through Phase 3.** The update script refuses the target without `--unfreeze`. A test that invokes the update script against the live fixture directory violates this freeze. Use `--out-dir <tmpdir>` to test the script safely.

**Known load-sensitive tests.** These tests flake under full-suite load and should be re-run in isolation before blaming a branch: `hud-render` pair, `capture-hooks memory-worker`, `compliance-e2e S16b`, `eager-memory-refresh S18`, `spawnSync npx ETIMEDOUT` in `build-mds`.

**PF-043 shape requirement.** Test fixtures must be built from real runtime shapes — copy actual agent files rather than hand-authoring content. A fixture built from an invented shape asserts nothing about production code. The resolver tests use `copyFileSync` to populate the temp root from real agent files.

## Key Files

- `tests/helpers.ts` — shared helper API: `resolveAgentSource`, `resolveAllAgents`, `extractOpSectionFromCorpus`, `gitAgentSinkCorpus`, `loadGolden`, `extractStatusLines`, `parseFences`, `isAgentBlock`, `requireDistFile`, `requireDistFiles`, `makeManifest`, `computeFpRatio`
- `tests/guards/agent-source-resolver.test.ts` — resolver unit tests; dist-preferred and src-fallback proofs; `extractOpSectionFromCorpus` sole/union mode tests
- `tests/guards/numeric-floor-manifest.test.ts` — floor pinning guard; occurrence-aware, decrement probe covers every entry
- `tests/guards/literal-agent-paths.test.ts` — forbids `src/assets/agents/` literals in new test files; exception list with justifications; `requireDistFile`/`requireDistFiles` throw-contract tests
- `tests/guards/retired-wording.test.ts` — Phase-0 allowlist of renamed/deleted literals; one shared grep guard (GAP-32); allowlist: `ISSUE_NUMBERS`, `ISSUE: {issue`, `close milestone`, `may pre-fetch`, `issue-first gate` (NOT `step 1c`)
- `tests/guards/extended-references.test.ts` — SKILL.md Extended References table integrity; generated-path exception list seeded for Phase 2 (`references/tracker/`)
- `tests/seams/command-agent-input.test.ts` — three-direction command→agent seam (PF-024); forward, reverse, producer; `parseInputIdentifiers` scoped to `**Input:**`
- `tests/goldens/git-agent-golden.test.ts` — byte-equality guard against `tests/fixtures/golden/git-agent.md`
- `tests/goldens/github-status-lines.test.ts` — `extractStatusLines()` stability guard against `tests/fixtures/golden/github-status-lines.txt`
- `tests/fixtures/golden/git-agent.md` — frozen byte-equal snapshot of `git.md`
- `tests/fixtures/golden/github-status-lines.txt` — frozen output of `extractStatusLines()`; refused by update script without `--unfreeze`
- `tests/fixtures/numeric-floors.json` — occurrence-aware floor manifest; hand-registered, never auto-generated
- `scripts/update-golden.ts` — golden update script (tsx); named target required; `--out-dir` for safe test exercising; `--unfreeze` for frozen targets
- `tests/integration/helpers.ts` — `isClaudeAvailable`, `runClaudeAndWait`, `runClaudeStreaming`, `getSubagentPreloadResult`, `buildSubagentsPath`, `parseStreamEvent`
- `tests/integration/subagent-skill-preload.test.ts` — real claude CLI spawn tests; `MAX_SPAWN_ATTEMPTS = 2`; skips when claude absent

## Recorded Exceptions

These are deliberate, documented divergences from the general rules:

| File | Exception | Justification |
|------|-----------|---------------|
| `tests/helpers.ts` | Reads `src/assets/agents/git.md` by literal path in `extractStatusLines()` | `github-status-lines` fixture is frozen against the *source* file (AC-0.9); must always read src |
| `tests/installer-new.test.ts` | Contains literal `src/assets/agents/` path | Not a Phase-0 file; pins an installer error message, not a content-resolution path |
| `tests/goldens/git-agent-golden.test.ts` | Mentions literal path in test description string | Human-readable label, not a file-reading path; uses `resolveAgentSource()` for all content access |
| `tests/guards/literal-agent-paths.test.ts` | Self-excluded from its own scan | Defines `LITERAL`, error message strings, and non-vacuity probe corpus entry |
| `tests/guards/retired-wording.test.ts` | Contains `src/assets/agents/` in `removedFrom` metadata | Historical documentation of pre-Phase-0 paths, not code |
| `release.md:85` | Hand-authored in `DIST_FILES` | Inlines its own COMPLIANCE gate; not MDS-compiled |
| `gh pr view` at `code-review.mds`, `bug-analysis.mds`, `resolve.mds:63` | Three occurrences allowlisted in `build-mds.test.ts` by filename | Legitimate traceability operations |
| `references/tracker/` paths | Excepted from extended-references guard | Phase 2 generated-path; files created at build time, not in src/ |
| `tests/integration/subagent-skill-preload.test.ts` | Spawns real `claude` with `--dangerously-skip-permissions` | Required for subagent spawn; prompts are read-only by test design |

## Related

- PF-018: Non-vacuity requirement — every guard must prove its collector is live, not merely that the corpus is non-empty
- PF-024: The command→agent boundary — what the seam test (`command-agent-input.test.ts`) enforces
- PF-039: `**Produces:**`/`**Requires:**` are phase-ordering DAG annotations, not spawn-block field contracts — explicitly excluded from seam key checks
- PF-043: Test fixtures must be built from real project runtime shapes, not invented; the resolver tests copy actual agent files via `copyFileSync`
- PF-035: The skim tool-rewrite hook substitutes a structural view for `cat`/`head`/`tail` reads — use the `Read` tool, not shell reads, when verifying test source files
- ADR-003: Leave-the-end-state-not-the-transition — guard tests must clean up tombstones from prior phases
- ADR-024: Prove-you-wrote-it — the ownership contract that drives non-vacuity probes
- `tests/registry-integrity.test.ts` — complementary seam test; pins OPERATION: name accuracy (Guard 6) and fence-parsing precedent (lines 449–456)
- `tests/build-mds.test.ts` — compilation guard that pins deployed behaviour; named collector pattern at `collectGhIssueProseViolations` is the cross-reference for M12a
