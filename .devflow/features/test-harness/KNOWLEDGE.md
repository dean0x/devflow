---
feature: test-harness
name: Test Harness (core - agent-source resolver, fence-aware extraction, guard conventions, isolation helpers)
description: "Use when adding a guard, seam or golden test, changing the agent-source resolver or fence-aware section extraction, or isolating a test's HOME and dist. Keywords: guard, non-vacuity, resolveAgentSource, sandboxEnv."
category: conventions
directories: [tests/helpers.ts, tests/git-agent.test.ts, tests/seams, tests/goldens, tests/guards, tests/fixtures, scripts/update-golden.ts, tests/integration, tests/tracker, tests/dynamic, tests/installer, tests/evidence, tests/provider-literals.test.ts, tests/tracker-agent.test.ts, tests/commands, tests/install-bound-input.test.ts, tests/learning, tests/decisions]
created: 2026-09-06
updated: 2026-10-10
---

# Test Harness

## Rules

- **KB-INV-1** A green test that exercises nothing is worse than no test: every guard has a named collector that the guard AND its probe both call, a corpus non-vacuity assertion, and a known-bad probe that drives that collector over a synthetic violation.
- **KB-INV-2** `tests/helpers.ts` is the one home of shared logic: a guard never inlines its own collector or fence scanner; it imports the helper or names a function in its own file and calls it from the guard and the probe.
- **KB-INV-3** Every helper that touches `dist/` or `src/` takes an injectable `root` (default `ROOT`); a test that needs throw behaviour or fixtures passes an `mkdtempSync` root.
- **KB-INV-4** The unit suite runs under a fresh per-file temp HOME (`tests/setup/isolate-env.ts`): inside a test `os.homedir()` IS the temp HOME, so "not the real HOME" checks use `realHomes()` / `assertTempHome()`.
- **KB-INV-5** A spawned CLI or hook gets its env from `sandboxEnv(home, extra?)`, which throws unless `home` is under the OS temp dir and not a real home.
- **KB-INV-6** Section boundaries are fence-aware: a column-0 `## ` inside a fenced block is payload, and both ends of an operation section come from the same unfenced-heading index.
- **KB-INV-7** Every `extractOpSectionFromCorpus` call names its mode with a one-line why: `'sole'` where one file is the authority (throws on a duplicate anchor), `'union'` where the literal may live in any sink-corpus file.
- **KB-INV-8** A missing build artifact throws (`requireBuiltCli`, `requireDistFile(s)`, `loadGolden`, the resolver's build hint); only an external binary the repo cannot produce is a `skipIf` capability gate.
- **KB-INV-9** `resolveAgentSource` is dist-first through `agentSourceDirs` (the one owner of that policy): generator-host agents resolve `origin: 'dist'`, hand-authored ones `origin: 'src'`, and neither existing throws with a build hint.
- **KB-INV-10** Every CLI-spawning test file names one `SUBPROCESS_TIMEOUT_MS` and uses it for the `spawnSync` timeout AND every `it()` timeout.
- **KB-AP-1** `scanned > 0` over a corpus is necessary, not sufficient: assert completeness against a named set (`getAllAgentNames()`, a manifest) and, for a scan of two sources, by provenance that both contributed.
- **KB-AP-2** A probe that reimplements the collector inline, or names one member of a set the gate ranges over, stays green after the guard breaks: call the real collector and loop the probe over the whole set.
- **KB-AP-3** Never write into the real `dist/` or `src/` from a test, nor rebuild the repo's own `dist/`: parallel workers read those paths and an unscoped build repairs staleness mid-suite; use `buildCommittedTree()` or a temp root.
- **KB-AP-4** No literal `src/assets/agents/` path in a new test: generator-host agents are `.mds` there and a read over `*.md` silently misses them; use `resolveAgentSource(name)`.
- **KB-AP-5** A combined OR predicate carrying a floor hides which branch passes: split it into independent assertions with named op sets.
- **KB-AP-6** A de-vacuumed predicate must also be scoped to the op's own section (`extractOpSectionFromCorpus`), never to a hand-rolled "to the next anchor or EOF" region that sweeps in a shared trailer.
- **KB-AP-7** A scope or prefix that matches no corpus file silences its entry: pair every scoped denylist or allowlist with a liveness check.
- **KB-AP-8** A CLI-spawning test that times the spawn but leaves `it()` on vitest's default timeout reintroduces the flake one level up.
- **KB-AP-9** Fixtures are built from real runtime shapes, never invented; a stand-in name for a registry entry must be deliberately unregisterable.
- **KB-AP-10** `agent-name-guards.test.ts` (GAP-5) sweeps `.devflow/features/**` for two retired role-noun spellings with no trailing boundary, even in prose: paraphrase them in a KB.

## Overview

The test harness began as the "harness first" phase of the tracker initiative and is the shared infrastructure every tracker-initiative test builds on. It lives in `tests/helpers.ts` and the guard, golden, seam, tracker, dynamic, installer, evidence, integration and fixture trees under `tests/`. One principle governs it: **a green test that exercises nothing is worse than no test**, so every major test carries a non-vacuity probe proving its detection logic is live.

The harness grows by reuse, not by new mechanisms. Every guard or seam file reuses the `helpers.ts` corpus builders, follows the named-collector plus known-bad-probe shape, and registers its pinned numbers in the same manifest; `tests/evidence/` (release traceability and wave evidence) adopted the identical discipline. When a monolithic prompt splits further, every guard literal that moved is reclassified one at a time rather than the suite being widened. The domain content these files pin (provider semantics, reference mechanics, install shape, release/evidence semantics) belongs to the `tracker-feature`, `tracker-references` and `installer-shadowing` knowledge bases; this family owns the harness shape they all share.

Four cohesive pieces: (1) `helpers.ts` exports the shared API (agent-source resolver, corpus extractors, golden loader, fence parsers, isolated-MDS-build helpers); (2) guard tests pin source-file invariants, each with a known-bad synthetic probe; (3) golden tests assert byte equality between agent source and a committed fixture; (4) integration tests spawn real `claude` CLI sessions or full tarball installs.

**This knowledge family.** This hub holds the core API and conventions. Three facets (linked under Related), each with its own Rules, hold the rest: goldens, numeric floors and byte budgets; the `git-agent.test.ts` guard modes, the command-agent seam and the tracker and PR-host guards; prompt-corpus doctrine guards and the install-level regression net.

## Code Organization Principles

**`helpers.ts` is the single source of shared logic.** No guard may inline its own collector; it must use the named function from `helpers.ts` or declare a named function in its own file and call it from both the main guard and the non-vacuity probe. A probe that reimplements the logic stays green after the guard breaks.

**Injectable `root` parameters enforce test isolation.** Every function that touches `dist/` or `src/` (`resolveAgentSource`, `resolveAllAgents`, `requireDistFile`, `requireDistFiles`, `gitAgentSinkCorpus`) accepts an optional `root` (default `ROOT`). Pass `mkdtempSync(...)` roots in tests that verify throw behaviour or fixture creation. Vitest runs test files in parallel workers; cross-worker filesystem mutations corrupt other workers' results. The same discipline extends to `$HOME`: `feature-toggle-config.test.ts` and the `init-*` CLI-spawning suites each `mkdtempSync` BOTH a throwaway `$HOME` and a throwaway git repo per test, never the real ones, because a QA-agent run once wiped a real `~/.claude` by spawning `init` unscoped.

**The unit suite runs under a temp HOME by construction (D-TEST-HOME-ISOLATION).** `vitest.config.ts` `setupFiles` runs `tests/setup/isolate-env.ts` before EVERY test file. It records the original HOME in `DEVFLOW_TEST_ORIGINAL_HOME`, gives the file a fresh `mkdtemp` HOME (prefix `devflow-test-home-`, removed in `afterAll`), sets `USERPROFILE` to match, deletes `DEVFLOW_DIR` / `CLAUDE_CODE_DIR` / `CLAUDE_CONFIG_DIR`, and throws if `os.homedir()` does not then report the temp dir. devflow itself ignores `DEVFLOW_DIR` and `CLAUDE_CODE_DIR` (still stripped, for any older binary a test reaches) and honours `CLAUDE_CONFIG_DIR`, so a test isolates devflow's machine root with HOME alone and relocates the Claude directory with `CLAUDE_CONFIG_DIR`; `tests/guards/one-home.test.ts` bans both retired tokens from `src/` and `dist/` (one exemption: the settings template's `${DEVFLOW_DIR}` install-time token at its template and substitution site).

The setup file's pure half, `tests/setup/home-isolation.ts` (`REDIRECT_ENV_VARS`, `realHomes`, `assertTempHome`, `isolatedEnv`), imports nothing from `src/` or `helpers.ts`: a setup file shares the test file's module graph, so a `src/` module loaded before the redirect could freeze a real-home path into a constant. For a spawned CLI or hook, build the env with `sandboxEnv(home, extra?)` from `helpers.ts`: an allowlist (`SANDBOX_ENV_ALLOWLIST`: PATH, TMPDIR, locale, TERM, USER and similar) plus `HOME`/`USERPROFILE`, `FORCE_COLOR=0`, `NO_COLOR=1`, `CI=1`; it throws unless `home` is under `os.tmpdir()` and not a real home, and a sandbox env is never built by spreading `...process.env`. The integration config deliberately has no such setup file (its live-`claude` test needs the real `~/.claude`); its one `init` spawn (`clause-ii-file-residue.test.ts`) goes through `sandboxEnv` and echoes the resolved HOME first. `tests/setup/isolate-env.test.ts` is the TP-1 proof, including a red probe showing the redirect variables really do move `init`'s writes when left in place.

**No literal `src/assets/agents/` paths in new test files.** The `literal-agent-paths` guard (`tests/guards/literal-agent-paths.test.ts`) scans `tests/seams/`, `tests/goldens/`, `tests/guards/`, `tests/tracker/`, `tests/dynamic/` and `tests/installer/` (`SCAN_DIRS`) for non-comment lines containing `src/assets/agents/`. Use `resolveAgentSource(name)` for all agent content access: most agents are `.mds` generator hosts, so a read or grep over `src/assets/agents/*.md` silently misses them. New guards under `tests/guards/` reach the agent directories through `agentSourceDirs()` / `agentsDir()` / `compiledAgentsDir()` / `compiledSkillRefsDir()` / `skillsDir()` / `commandsDir()` from `src/core/assets.ts`. Documented exceptions: `tests/helpers.ts` (doc comment only), the guard file itself, and `retired-wording.test.ts`'s `removedFrom` metadata.

## Standard Patterns

### resolveAgentSource / resolveAllAgents

Dist-preferred, src-fallback resolver. `resolveAgentSource(name, root?)` reads its directory order from `agentSourceDirs(root)` (the one owner of the dist-first policy, `src/core/assets.ts`): compiled `dist/agents/<name>.md` first, the hand-authored source tree second, and a throw with a build hint naming both resolved paths when neither exists. `agentSourceDirs(root, learning = true)` takes a second parameter that puts `dist/learning-off/agents` first for a learning-off install; the harness never passes it. It reads the learning-on file through `resolveAgentSource` and a learning-off variant through `resolveLearningOffSource(kind, name, root?)`, which returns `null` for a host with no arm. `resolveAllAgents(root?)` covers every agent in `getAllAgentNames()` (the hook-spawned Tracker agent included), pinned by `agent-roster-count` in `numeric-floors.json`.

The canonical anti-pattern has a name: `scanned > 0` over the agent corpus (GAP-07). Most agents survive that assertion while coverage of one silently disappears. Use the completeness assertion `expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))` and pin the expected count.

The resolver's `origin` field (`'dist' | 'src'`) distinguishes which path was used. The generator-host agents (`MDS_GENERATOR_HOSTS` in `tests/fixtures/mds-manifest.ts`) compile from `src/assets/agents/{name}.mds` and resolve with `origin: 'dist'`; the hand-authored ones resolve with `origin: 'src'`. `tests/guards/dist-agents.test.ts` derives the host list from the `.mds` files on disk, asserts both arms against the real tree, and asserts the loud-failure arm (an unbuilt tree) on a generated agent. Its AC-1.2 ban on `@if`, `@import` and `@define` in an agent host still holds: the learning arms are `<!-- learning:on/off/end -->` marker lines split by `src/core/learning-variants.ts`, not an MDS conditional.

### extractOpSectionFromCorpus

Extracts `## Operation: <name>` sections from a corpus. Every call **must** name its mode explicitly with a one-line why-comment (DR-18):

- `{ mode: 'sole' }` - the contract authority is one file; throws naming both conflicting paths when the anchor appears in more than one corpus file. A first-match implementation would accept a key declared only by a non-authoritative provider, making the seam test permissive. `'sole'` lookups deliberately run over a **git.md-only** corpus (`gitCorpus = [{ path: git.path, content: git.content }]`, never `gitAgentSinkCorpus()`): git.md is the single `**Input:**` contract authority, and the generated references under `dist/skills/git/references/tracker/{provider}/{op}.md` and `dist/skills/git/references/pr/{op}.md` also open with a `## Operation:` anchor, so unioning them into a `'sole'` lookup throws on every op that has a generated reference. That throw, if it ever happens by accident, is the intended signal that a `'sole'` call was pointed at the wrong corpus.
- `{ mode: 'union' }` - concatenates all matching sections and returns `matchCount`. A first-match implementation would silently undercount posting-op floors. Union guards (D11 forward/reverse/bypass, D4 detector pins, Guard 2's numeric-bound pins) read `gitAgentSinkCorpus()` so a floor keyed to `## Operation:` content stays valid when mechanics move into a generated reference file.

The discipline behind the mode rule: classify every guard literal one at a time, widen a corpus only where its literal provably moved, never blanket-widen a whole suite to make it green. The worked examples are in `test-harness-tracker-guards`.

Both ends of a section, start AND end, are located through the SAME memoised unfenced-heading index (`unfencedH2Index`, private to `tests/helpers.ts`: a `collectUnfencedH2` call cached by exact document text, FIFO-evicted at `UNFENCED_H2_MEMO_LIMIT` so a long-running vitest worker does not retain every corpus file it ever extracted from). Sections end at the next UNFENCED column-0 `## ` line. The boundary rule lives in the named collector `collectUnfencedH2(text)`, shared by the extractor and by `tests/tracker/reference-structure.test.ts`'s structural guard, so neither can drift from the other. Two sites remain intentionally scoped outside the extractor, for reasons unrelated to truncation: Guard 10 (AC-0.10 containment) reads each op's own section via `opSection = extractOpSection(soleCorpus, op, 'sole')`, and the seam test's `collectMissingProducers` stays body-scoped because both of its known-bad probes mutate the `git.md` BODY under test, and a corpus-shaped signature would push the mutation into a fixture instead of the input under test.

### collectUnfencedH2 (fence-aware `## ` boundary)

`collectUnfencedH2(text)` (`tests/helpers.ts`) returns every column-0 `## ` heading line in `text` that sits OUTSIDE a fenced code block, in document order, as `{ line, index, text }`. It delegates to the harness's ONE fence scanner, `scanFences(text, accept)` (private), via the exported `collectUnfencedLines(text, accept)`: a caller passes its own line predicate (a `## ` heading, `capability-hoist`'s `PROCESS_CLOSE` terminator set) while the fence grammar itself lives in exactly one place. `collectUnclosedFences(text)` is `scanFences`'s sibling export: it returns the opening delimiter (at most one) of a fence `text` never closes, and `tests/guards/fence-grammar.test.ts` asserts it is empty across the whole always-loaded corpus.

Fence grammar, a deliberate CommonMark subset: a fence **opens** on a line whose first non-space characters, after at most 3 leading spaces, are 3+ backticks or 3+ tildes (a backtick fence's info string may not itself contain a backtick); it **closes** on a later line with at most 3 leading spaces carrying the same marker character, a run at least as long as the opening one, and nothing after it but whitespace; an **unclosed fence runs to end of text**. Written-down non-goals: 4-space-indented code blocks, HTML blocks, and fences opened 4+ spaces deep inside a list item are not modelled.

The need is real: `tracker/github/manage-debt.md`'s `## Items` is the literal body of the successor tech-debt issue, and `tracker/github/ensure-traceable-issue.md` carries six such lines across its `gh issue create` heredoc and its D3 template fence. Demoting any of them to `###` would change what GitHub renders, and every union-mode guard reaches the recipes below them because those headings do not end a section.

### loadGolden

`loadGolden(name)` reads from `tests/fixtures/golden/<name>` and throws with the update-command hint when absent. It never auto-regenerates: a guard that silently skips a missing fixture is not a guard.

### requireDistFile / requireDistFiles / requireBuiltCli

All three throw with a build hint when the artifact is absent: `requireDistFile`/`requireDistFiles` for `dist/commands/`, `requireBuiltCli(root = ROOT)` for `dist/cli.js`. The injectable `root` enables hermetic throw-behaviour tests without touching the real dist.

**Doctrine: build artifact -> throw (fail-loud); external binary the repo cannot produce -> `skipIf` capability gate.** A missing build artifact (anything `npm run build` produces) must fail the suite loudly. A missing external binary the repo has no way to produce (the `claude` CLI) is a legitimate `skipIf` gate. Every subprocess-CLI test file calls `requireBuiltCli()` at module scope, so an unbuilt tree is a collection error (exit 1), not a green SKIP.

**Every CLI-spawning test file names its own `SUBPROCESS_TIMEOUT_MS` constant.** A real `devflow init` (or a feature toggle) spawn under load runs past vitest's 5 s default (about 6.5 s was observed for `init-review-publication.test.ts`). One constant per file is shared between the `spawnSync` `timeout` option and every `it(...)`'s own third-argument timeout, so the two ceilings cannot drift apart: the `init-*` e2e files and `init-review-publication.test.ts` use `60_000`, and `scoped-install-e2e.test.ts` uses `120_000` for its heavier three-`$HOME` install. `feature-toggle-config.test.ts` carries the same `60_000` as literals on its spawn and its `it`s.

### walkFiles

`walkFiles(dir, accept, maxDepth = MAX_REFERENCE_SWEEP_DEPTH)`: recursive `readdirSync(withFileTypes)`, deterministic (sorted) order. TWO bounds, not one: the shared `MAX_REFERENCE_SWEEP_DEPTH` (from `src/core/reference-sweep.ts`) is a hard ceiling that THROWS when breached; the caller-supplied `maxDepth` is a narrower, silent scope cap that may only narrow, never widen past the shared bound. On `ENOENT` or `ENOTDIR` for a node it returns `[]`; other errors rethrow. Used by `gitAgentSinkCorpus` for recursive `references/` traversal and by the Phase-2/Phase-3 guards to build their own corpora.

### splitFrontmatter

`splitFrontmatter(text)` returns `{ block, inner, body } | null`, splitting a document at its leading `---...---` frontmatter block and returning `null` when there is no block at byte offset 0. One owner for a shape that had been reimplemented per test file.

### gitAgentSinkCorpus

Builds the D11 sink-class corpus: `git.md` (via `resolveAgentSource('git', root)`) plus all `.md` files under `dist/skills/git/references/` (recursive via `walkFiles`; ENOENT-tolerant, returns `[]` when the directory is absent). The recursive descent covers every provider's `references/tracker/{provider}/{op}.md` AND the provider-independent `references/pr/{op}.md` tree with no change to the builder. It accepts an injectable `root` and is used by the forward/reverse/bypass D11 guards, Guard 2's numeric-bound pins, and `capability-hoist`'s process-block corpus.

**`gitAgentSinkCorpus()` and `inlineBodyCorpus()` are memoised at MODULE scope inside `git-agent.test.ts`** (`cachedSinkCorpus()`), not inside `tests/helpers.ts` and not inside a `describe`. Both builders are pure functions of the on-disk tree that no guard in the file writes to. The memo stays out of `helpers.ts` deliberately: other test files run in their own vitest worker and may want a fresh read, and both builders take an injectable `root` that a shared cache inside the helper would silently ignore.

### Fence parsing helpers

`parseFences(content)` extracts all triple-backtick code fences; `isAgentBlock(fence, type)` is true when a fence spawns the named agent type (both `Agent(subagent_type="X"` and `agentType: "X"` forms). They mirror the Git-spawn fence scan in `tests/registry-integrity.test.ts`, the repo's canonical fence-parsing precedent.

### Isolated MDS builds (buildCommittedTree / runMdsBuild / copyCommittedSources)

A test that needs real compiled artifacts must never get them by rebuilding the repo's own `dist/`: vitest runs other files in parallel workers that read those same paths, so an unscoped build silently REPAIRS a stale `dist/` mid-suite. Every build spawned from `helpers.ts` is redirected to a throwaway root via `DEVFLOW_MDS_ROOT`, over a COPY of the committed `src/assets/{commands,agents,mds}` trees (`copyCommittedSources`). `buildCommittedTree()` compiles the committed corpus once per test file (memoised) and returns `{ run, root }`; pair it with `cleanupCommittedTree()` in an `afterAll`. `collectSpawnScoping(source)` is a named collector every build-spawning test file runs against its own source, so a future `spawnSync(` site added without `DEVFLOW_MDS_ROOT` fails loud. The spawn timeouts are pinned by `slow-test-timeout-ms` and `mds-build-spawn-timeout-ms` in `numeric-floors.json`.

## Guard Conventions

Every guard in `tests/guards/` (and the additions in `tests/tracker/`, `tests/dynamic/`, `tests/installer/`, `tests/evidence/`, plus the root-level `tests/provider-literals.test.ts` and `tests/tracker-agent.test.ts`) follows the same three-part structure:

**1. Named collector.** The violation-detection logic is a named function called by both the main guard assertion AND the non-vacuity probe. A probe that reimplements the loop inline stays green after the real collector changes (M12b).

**2. Corpus non-vacuity.** Before asserting zero violations, assert that the corpus is non-empty AND, where a guard claims to scan two sources, assert by provenance that BOTH contributed, not just that the total crossed a floor.

**3. Known-bad probe (mechanic 2 / H10).** Build a synthetic corpus entry or temp root that contains a real violation and confirm the collector flags it. This proves the detection logic is live without touching any committed source file.

### De-vacuumed guard anti-pattern (AC-0.10 lesson)

The AC-0.10 containment guard had a combined predicate (`<untrusted-issue-body> || <external-thread>`) with one floor. On unmodified `main`, three pre-existing `<external-thread>` ops satisfied the floor, so the guard passed without ever touching an `<untrusted-issue-body>` op. The fix splits it into two independent assertions with **named matching op sets**: issue-body (predicate `<untrusted-issue-body>` only, named set `{setup-task, fetch-issue, fetch-issues-batch}`) and external-thread (predicate `<external-thread>` only, named set `{fetch-review-threads, post-resolution-summary, post-wave-report}`), registered as `containment-issue-body-floor` and `containment-external-thread-floor`. Rule: when a guard predicate is a logical OR, you cannot tell which branch is carrying the floor.

### Guard 10: scope a de-vacuumed predicate to the op's own section

Guard 10 reads each operation through `opSection = extractOpSection(soleCorpus, op, 'sole')`, the op's own section cut at the next UNFENCED `## `, never through a region that runs "to the next `## Operation:` anchor, or EOF". The difference matters for the LAST operation in `git.md`: an EOF-bounded region sweeps in the shared `## Principles` trailer. **Lesson**: a named-set assertion proves an op is REACHABLE from the marker; it does not prove the marker lives in the op's OWN section unless the extraction is scoped to exactly that section.

## Shared Denylist and Absence Guards

**`retired-wording.test.ts`** is one shared grep guard with a denylist that grows over time, never a new grep and never emptied. Each `RETIRED_LITERALS` entry carries an optional `scope: readonly string[]` (corpus path-prefixes the literal is retired FROM; absent means the whole corpus). Rows include `gh issue` (scope `dist/commands/`), `sleep 60`, `<!-- devflow:`, `{issue}`, the retired section-14.2 DEGRADED-reason synonyms, and retired budget figures such as `77,824` scoped to `CHANGELOG.md`. Scoped rows exist because a number that WAS a live ceiling is legitimately still quotable in narrative prose about what changed; the guard's job is to stop it being quoted as a CURRENT one. The `77,824` row (the pre-split preloaded-set figure) holds because the loaded set is now priced PER PATH and every provider row sits BELOW the retired figure, so it cannot come back as a ceiling either.

**`dist-agents.test.ts` AC-1.2 absence guard.** The Phase-2 construct-absence guard matches **anchored regexes, not substrings**. `LEGALISED_IN_PHASE2 = ['expandVariants(', '(module, op)']` narrows the fence deliberately. What did NOT become legal and stays forbidden: `@if`, `variants:` as a line-start YAML key, `tracker-<provider>.md` as a filename token, `{provider}.md` as a templated output name, and `@import`/`@define` inside a compiled AGENT host.

## Cross-Cutting Lessons

- **A prose-only prohibition inside a prompt nobody observes at runtime is not a control.** Hold a rule with a guard, a hook or a tool restriction.
- **An absence-based guard stacks three claims**: matcher expressiveness, corpus reach and predicate semantics. `INLINE_BODY_SHAPES`' and `collectUnfencedH2`'s non-goals docblocks in `tests/helpers.ts` are worked examples; `sinkCorpusWithoutPrHost()`'s vacuity throw and `budget-model.ts`'s injected-reader probes for the body-hop closure are others (see the facet KBs).
- **Byte-identical relocation is not semantics-preserving across a grammar boundary.** Text moved byte-for-byte into a reference can change meaning (a `## ` line becomes a heading). The fence-aware `collectUnfencedH2` boundary and `tests/tracker/reference-structure.test.ts`'s structural guard are the remedy.
- **Leave the end-state, not the transition.** Guard tests clean up tombstones from prior phases rather than keeping wording that narrates what changed.
- **The skim tool-rewrite hook substitutes a structural view for `cat`/`head`/`tail` reads.** Use the `Read` tool, not shell reads, when verifying test source files.

## Anti-Patterns

**KB-AP-1, KB-AP-2: vacuous non-vacuity checks.** `scanned > 0` is satisfied by a corpus that has lost one of the sources the guard claims to cover. A probe that reimplements the loop inline stays green after the real collector changes (M12b); a probe that names ONE member of a set the gate ranges over (one provider, one op) leaves the others unproven.

**KB-AP-3: touching the real `dist/` or `src/`.** `buildCommittedTree()` gives every test file real artifacts without a real dist write, memoised per file. A test that builds in place repairs a stale `dist/` a sibling worker was concurrently reading, and the staleness bug turns into a flake.

**KB-AP-7: a scope that matches no corpus file.** `retired-wording`'s per-entry scope check and `provider-scope`'s allowlist-liveness check both exist because a scope prefix matching nothing silences its entry completely.

## Gotchas

**KB-AP-10: the GAP-5 sweep reads KBs.** `tests/agent-name-guards.test.ts`'s GAP-5 (not `retired-wording`) scans `.devflow/features/**` too, case-insensitive with NO trailing boundary, forbidding the noun "valid" + "ator" and "review" + "er" as literal spellings even in explanatory prose. Paraphrase when a KB needs to describe what one of these agents was renamed from.

**Mutation-proof pattern.** The strongest evidence a guard is live is a real mutation turning it red. Reintroducing `--comment "x"` on the tech-debt archive's close in `_github.mds` turns the bypass guard red naming `manage-debt.md`. Removing `post-wave-report`'s non-reproduction sub-bullet from `git.mds` turns Guard 10 red specifically on that op, not on a trailer 30 lines below it. Removing `_erg_drop_legacy_markers`'s `return 0` in `ensure-root-gitignore` turns a `tests/shell-hooks.test.ts` arm red: with no unversioned marker present, the helper's last `[ -e ]` test is false, and a FUNCTION's non-zero exit status IS fatal under `set -e` where an inlined loop's last test is not, so every `set -e` caller (`capture-prompt`, `capture-turn`, `capture-question`, `memory-worker`, `pre-compact-memory`) would die silently on both the stamping and the fast path without that `return 0`, and no test held it until that arm was added.

## Key Files

- `tests/helpers.ts` - shared helper API: `resolveAgentSource`, `resolveAllAgents`, `resolveLearningOffSource`, `collectCodeSpawnSites(file, text, agentType = 'Code')`, `collectUnfencedH2`, `collectUnfencedLines`/`collectUnclosedFences`, `extractOpSectionFromCorpus`, `walkFiles`, `splitFrontmatter`, `gitAgentSinkCorpus`, `collectTrackerNamingLines`, `loadGolden`, `extractStatusLines` and its closed reference list, `parseFences`, `isAgentBlock`, `requireDistFile`, `requireDistFiles`, `requireBuiltCli`, `sandboxEnv`/`SANDBOX_ENV_ALLOWLIST`, `prHostRel`/`isPrHostEntryPath` (the one spelling of the `pr/` path grammar), `makeManifest`, `computeFpRatio`, the isolated-build set, and the tracker schema and mechanics collectors (see `test-harness-tracker-guards`)
- `tests/setup/isolate-env.ts` / `tests/setup/home-isolation.ts` - the unit suite's per-file temp HOME setup file and its pure half; `tests/setup/isolate-env.test.ts` is its canary and red probe
- `tests/fixtures/mds-manifest.ts` - the build-ownership name manifests (`test-harness-goldens-budgets`)
- `tests/guards/dist-agents.test.ts` - dist/agents parity for every generator host, frontmatter-shape guard, AC-1.2 absence guard; `tests/guards/agent-source-resolver.test.ts` - resolver unit tests and the `extractOpSectionFromCorpus` sole/union mode tests; `agent-roster-count` is its floor
- `tests/guards/literal-agent-paths.test.ts` - the `SCAN_DIRS` literal-path guard
- `tests/guards/retired-wording.test.ts` - scoped denylist of retired literals
- `tests/guards/extended-references.test.ts` - SKILL.md Extended References table integrity
- `tests/guards/fence-grammar.test.ts` - no unclosed fence across the always-loaded corpus
- `tests/guards/one-home.test.ts` - the retired `DEVFLOW_DIR` / `CLAUDE_CODE_DIR` tokens stay out of `src/` and `dist/`
- `tests/guards/numeric-floor-manifest.test.ts` - floor/ceiling pinning guard (see `test-harness-goldens-budgets`)

## Recorded Exceptions

Deliberate, documented divergences from the general rules (the facet KBs record theirs):

| File | Exception | Justification |
|------|-----------|---------------|
| `tests/helpers.ts` | `resolveAgentSource`'s doc comment names the fallback tree in prose; `extractStatusLines()` reads through the resolver and `compiledSkillRefsDir()` | The doc comment is the ONLY `src/assets/agents` mention remaining in tests/ |
| `tests/guards/literal-agent-paths.test.ts` | Self-excluded from its own scan | Defines `LITERAL`, error message strings and the non-vacuity probe corpus entry |
| `tests/guards/retired-wording.test.ts` | Contains `src/assets/agents/` in `removedFrom` metadata | Historical documentation of pre-Phase-0 paths, not code |
| `references/tracker/` and `references/pr/` paths | Excepted from the extended-references guard | Generated paths; files are created at build time, not in src/ |

## Related

- `.devflow/features/test-harness-goldens-budgets/KNOWLEDGE.md` - goldens, numeric-floor manifest, byte budgets, body-hop closure
- `.devflow/features/test-harness-tracker-guards/KNOWLEDGE.md` - guard-mode classification, seam test, tracker and PR-host guards
- `.devflow/features/test-harness-prompt-install/KNOWLEDGE.md` - prompt-corpus doctrine guards, install-level regression net, full-suite load timeouts
- `.devflow/features/tracker-references/KNOWLEDGE.md` - owns the Tracker Phase 2/3 architecture the guards pin: provider resolution mechanics, the capability matrix, byte budgets, the containment oracle, the generated-reference manifest, `VARIANT_MODULES`/`expandVariants`, and the PR-host split's domain rationale
- `.devflow/features/tracker-feature/KNOWLEDGE.md` - owns the provider-selection substrate, the tool-call sink contract, per-provider mechanics semantics, the `~/.devflow/tracker/{provider}.md` schema's meaning and the hook-agent claim-staleness contract
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` - owns `mergeManagedConfig`/`writeManagedConfig`, `ensure-root-gitignore`'s domain behaviour and the learning-variant converge and language-stamp behaviour; this family owns only the test patterns that exercise them
- `tests/registry-integrity.test.ts` - complementary seam test; pins OPERATION: name accuracy (Guard 6) and the fence-parsing precedent
- `tests/build-mds.test.ts` - compilation guard that pins deployed behaviour; `collectGhIssueProseViolations` is its named-collector cross-reference
- `src/core/assets.ts` - `agentSourceDirs` and the other directory resolvers the harness reads through
