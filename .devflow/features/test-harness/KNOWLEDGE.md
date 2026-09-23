---
feature: test-harness
name: Test Harness (agent-source resolver, goldens, seam and guard tests, integration helpers)
description: "Use when adding a new guard test, modifying the agent-source resolver, updating golden fixtures, extending the seam test, integration helpers, or the fence-aware section-boundary guard, understanding the DIST_FILES vs COMMAND_HOSTS split, adding a tracker-provider guard or seam file (mcp-sink-bypass, provider-scope, no-control-bytes, provider-literals, tracker-agent, schema-scope, hostile-values, jira-module/linear-module parity, tracker-key-path, tracker-claim-staleness), reclassifying a git-agent.test.ts guard between 'sole' and 'union' mode after a PR-host split, or working in tests/seams, tests/goldens, tests/guards, tests/fixtures, tests/tracker, tests/dynamic, tests/installer, tests/integration, tests/provider-literals.test.ts, or tests/tracker-agent.test.ts. Keywords: guard, non-vacuity, golden, seam, agent-source resolver, resolveAgentSource, extractOpSectionFromCorpus, collectUnfencedH2, fence-aware, reference-structure, numeric-floor-manifest, ceilings, retired-wording, literal-agent-path, extended-references, capability-hoist, provider-scope, heredoc-quoting, pr-link-handoff, depends-on-grammar, reference-overlay, subagent-skill-preload, clause-ii-file-residue, content-anchored, gitOp, between, singleLine, INLINE_BODY_SHAPES, joinContinuations, matchInlineBodyShapes, inlineBodyCorpus, STATUS_LINE_REFERENCE_FILES, requireBuiltCli, fail-loud, skipIf, fence-grammar, scanFences, collectUnfencedLines, collectUnclosedFences, unfencedH2Index, collectCrossCuttingSections, PROVIDER_DETECTORS, statusLineRefReader, isStatusLineReference, collectTrackerNamingLines, gitAuthorityCorpus, TSX_BIN, TRACKER_SCHEMA_SECTIONS, collectTrackerTemplate, collectTrackerTemplateHeadings, collectTrackerSchemaRows, TrackerSchemaRow, TOOL_CALL_MECHANICS_CLAIMS, collectMissingMechanicsClaims, ProviderRefVocabulary, ProviderMechanicsClaim, PER_ITEM_FETCH_SHAPES, collectPerItemFetchVerbs, PROVIDER_OWNED_PATHS, ownsToken, collectForeignProviderLiterals, mcp-sink-bypass, no-control-bytes, provider-literals, tracker-agent, schema-scope, hostile-values, jira-module, linear-module, tracker-key-path, tracker-claim-staleness, GITHUB_ONLY_REASONS, collectDegradedReasons, collectTrackerFileReaders, PROVIDER_LITERALS, collectLiteralViolations, collectHookStaleSecs, collectAgentSecondLiterals, budget-loaded-set-jira, budget-loaded-set-linear, budget-loaded-set-pr-host, tracker-section-max-chars, TRACKER_OP_DECLARING_FILES, GIT_OPERATION_ROSTER, collectOperationNames, SHARED_LITERAL_REGISTRY, MCP_SHARED_LITERAL_REGISTRY, MIN_RATIONALE_CHARS, collectUnderJustified, requires-closure, single-authority, reference-reachability, install-shape, tracker-install, scoped-install-e2e, claude-md-tracker-section, ALL_MDS_PARTIALS, MDS_REFERENCE_PARTIALS, PR_HOST_OPS, PR_HOST_DESTINATION_ROOT, gitPlusPrHostCorpus, sinkCorpusWithoutPrHost, seedPrHostFile, isPostingSection, d10Reaches, D10_FAIL_CLOSED_LITERAL, REMOTE_PLACEHOLDER_RE, PR_HOST_LEGACY_REASONS, anchorsOnLineOne, LOADED_SET_WRITTEN_EXCLUSIONS, worstCasePrHostLoad, prRefRel, collectPointerSites, D-STRADDLE-SPLIT."
category: conventions
directories: [tests/helpers.ts, tests/git-agent.test.ts, tests/seams, tests/goldens, tests/guards, tests/fixtures, scripts/update-golden.ts, tests/integration, tests/tracker, tests/dynamic, tests/installer, tests/provider-literals.test.ts, tests/tracker-agent.test.ts]
created: 2026-09-06
updated: 2026-09-23
---

# Test Harness

## Overview

The test harness (introduced in PR #327, issue #322 "Tracker Phase 0 — harness first") is the shared infrastructure every tracker-initiative test builds on. It lives in `tests/helpers.ts`, `tests/guards/`, `tests/goldens/`, `tests/seams/`, `tests/integration/`, `tests/tracker/`, `tests/dynamic/`, `tests/installer/`, and `tests/fixtures/`. It is designed around one principle: **a green test that exercises nothing is worse than no test**. Every major test has a non-vacuity probe that proves the detection logic is live.

The tracker work grew the harness along the same lines rather than adding new mechanisms: every guard/seam file reuses `helpers.ts`'s corpus builders, follows the same named-collector + known-bad-probe shape, and registers its floors in the same manifest. PR #326 (the PR-host reference split) grew it again the same way, and is the harness's most recent worked example of ADR-025's classification discipline: when a monolithic prompt splits further — the eight PR/review operation bodies moving from `dist/agents/git.md` into a provider-independent `references/pr/{op}.md` tree — every guard literal that moved is reclassified one at a time, from `'sole'` to `'union'` mode, each paired with a known-bad probe proving the widening is honest rather than a blanket "make it green" pass. The domain content those files pin — provider semantics, reference mechanics, install shape — belongs to the `tracker-feature`, `tracker-references` and `installer-shadowing` knowledge bases; what lives here is the harness shape they all share.

Three tracker providers (github/jira/linear) are covered by the same shape: guard files (`mcp-sink-bypass`, `provider-scope`, `no-control-bytes`, `provider-literals`, `requires-closure`, `tracker-agent`), tracker files (`schema-scope`, `hostile-values`, `jira-module`/`linear-module`, `single-authority`, `reference-reachability`), seams (`tracker-key-path`, `tracker-claim-staleness`) and install proofs (`install-shape`, `tracker-install`, `scoped-install-e2e`). A fourth tree, `references/pr/` (`PR_HOST_OPS`, 8 ops, under no provider — pull requests stay on GitHub whatever the tracker is), converges, is reachable-scanned, and is single-authority-scanned by the SAME test files as the three provider trees, widened rather than duplicated: `provider-scope`'s `PROVIDER_OWNED_PATHS`/`FORBIDDEN_SCOPES`, `single-authority.test.ts`'s `providerReferenceCorpus()`, `reference-reachability.test.ts`'s reachability set, `schema-scope.test.ts`'s scoped-exemption registry, and `installer/reference-overlay.test.ts`'s converge-not-merge arms all treat `pr/` as a peer subtree, not a special case.

The section-boundary rule is fence-aware: a `## ` heading inside a fenced code block is payload, not structure, and never terminates an operation's section (PF-063). `manage-debt`'s successor-issue body and `ensure-traceable-issue`'s heredoc/D3-template headings are the shipped cases that depend on it — every union-mode guard reaches the recipes below them, and `git-agent.test.ts` needs no file-scoped workaround for either. Guard 10 (AC-0.10 containment) is scoped to an operation's own section for the same reason; see the Guard 10 note under Guard Conventions.

The harness has four cohesive pieces: (1) `helpers.ts` exports the shared API — agent-source resolver, corpus extractors, golden loader, fence parsers, and the isolated-MDS-build helpers; (2) guard tests pin source-file invariants, each with a known-bad synthetic probe; (3) golden tests assert byte equality between agent source and a committed fixture; (4) integration tests spawn real `claude` CLI sessions or full tarball installs to verify system-level properties.

## Code Organization Principles

**helpers.ts is the single source of shared logic.** No guard may inline its own collector; it must use the named function from `helpers.ts` or declare a named function in its own file and call it from both the main guard and the non-vacuity probe. A probe that reimplements the logic instead of calling the guard's real collector stays green after the guard breaks (PF-018 violation).

**Injectable `root` parameters enforce test isolation.** Every function that touches `dist/` or `src/` — `resolveAgentSource`, `resolveAllAgents`, `requireDistFile`, `requireDistFiles`, `gitAgentSinkCorpus` — accepts an optional `root` parameter (default `ROOT`). Pass `mkdtempSync(...)` roots in tests that verify throw behaviour or fixture creation; never write into the real `dist/` or `src/`. Vitest runs test files in parallel workers; cross-worker filesystem mutations corrupt other workers' results (PF-055).

**No literal `src/assets/agents/` paths in new test files.** The `literal-agent-paths` guard (`tests/guards/literal-agent-paths.test.ts`) scans `tests/seams/`, `tests/goldens/`, `tests/guards/`, `tests/tracker/`, `tests/dynamic/`, and `tests/installer/` (`SCAN_DIRS`, six entries) for non-comment lines containing `src/assets/agents/`. Use `resolveAgentSource(name)` for all agent content access. New guards under `tests/guards/` reach the agent directories through `agentSourceDirs()` / `agentsDir()` / `compiledAgentsDir()` / `compiledSkillRefsDir()` / `skillsDir()` / `commandsDir()` from `src/core/assets.ts`. Documented exceptions: `tests/helpers.ts` (doc comment only), the guard file itself, and `retired-wording.test.ts`'s `removedFrom` metadata.

## Standard Patterns

### resolveAgentSource / resolveAllAgents

Dist-preferred, src-fallback resolver. `resolveAgentSource(name, root?)` reads its directory order from `agentSourceDirs(root)` (the one owner of the dist-first policy, `src/core/assets.ts`): compiled `dist/agents/<name>.md` first, hand-authored source tree second, throws with a build hint naming both resolved paths when neither exists. `resolveAllAgents(root?)` covers every agent declared in `getAllAgentNames()` — 17 since the hook-spawned Tracker agent registered in Phase 3 (raised from 16; `agent-roster-count` in `numeric-floors.json`).

The canonical anti-pattern has a name: `scanned > 0` over the agent corpus. Most agents survive that assertion while coverage of one silently disappears (GAP-07). Always use the completeness assertion `expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()))` and pin the expected count.

The resolver's `origin` field (`'dist' | 'src'`) distinguishes which path was used. `git` is compiled from the generator host `src/assets/agents/git.mds` and resolves with `origin: 'dist'`; the other agents are hand-authored and resolve with `origin: 'src'`. `tests/guards/dist-agents.test.ts` asserts both arms against the real tree, and the loud-failure arm (an unbuilt tree) on the generated agent.

### extractOpSectionFromCorpus

Extracts `## Operation: <name>` sections from a corpus. Every call **must** name its mode explicitly with a one-line why-comment (DR-18):

- `{ mode: 'sole' }` — the contract authority is one file; throws naming both conflicting paths when the anchor appears in more than one corpus file. A first-match implementation would accept a key declared only by a non-authoritative provider, making the seam test permissive. Since Phase 2, `'sole'` lookups deliberately run over a **git.md-only** corpus (built as `gitCorpus = [{ path: git.path, content: git.content }]`, never `gitAgentSinkCorpus()`) — git.md is the single `**Input:**` contract authority. The generated references under `dist/skills/git/references/tracker/{provider}/{op}.md` and, since #326, `dist/skills/git/references/pr/{op}.md` also open with a `## Operation:` anchor, so unioning them into a `'sole'` lookup would throw on every op that has a generated reference; that throw, if it ever happens by accident, is the intended signal that a `'sole'` call was pointed at the wrong corpus. This mode-naming discipline — classify every guard literal one at a time, widen a corpus only where its literal provably moved, never blanket-widen a whole suite to make it green — is what ADR-025 records; it is the decision this rule, `gitAuthorityCorpus()`'s deliberately un-widened scope (see Gotchas), and the PR-host reclassification pattern below all apply.
- `{ mode: 'union' }` — concatenates all matching sections and returns `matchCount`. A first-match implementation would silently undercount posting-op floors. Union guards (D11 forward/reverse/bypass, D4 detector pins, Guard 2's numeric-bound pins) read `gitAgentSinkCorpus()` so a floor keyed to `## Operation:` content stays valid when mechanics move into a generated reference file.

**A hardcoded corpus-multiplicity assumption ages badly across a provider addition.** `git-agent.test.ts`'s `fetch-issue` union-match-count assertion used to read `toBe(2)` (git.md plus its one generated reference) when GitHub was the only tracker provider. It is now `TRACKER_OP_DECLARING_FILES = 1 + VARIANT_MODULES.filter(mod => mod.subdir.startsWith('tracker/')).length` — derived from the module registry rather than typed as a literal — so registering a second or third provider raises the expected count automatically instead of turning a correct guard red with a message that reads like an extractor regression.

Both ends of a section — start AND end — are located through the SAME memoised unfenced-heading index (`unfencedH2Index`, private to `tests/helpers.ts`: a `collectUnfencedH2` call cached by exact document text, FIFO-evicted at 64 entries so a long-running vitest worker doesn't retain every corpus file it ever extracted from). Sections end at the next UNFENCED column-0 `## ` line — a `## ` line inside a fenced code block (3+ backticks/tildes, closed by a later same-or-longer same-character marker run; an unclosed fence runs to end of text) is payload, not structure (PF-063). The boundary rule lives in the named collector `collectUnfencedH2(text)` (see below), shared by the extractor and by `tests/tracker/reference-structure.test.ts`'s structural guard, so neither can drift from the other (PF-018). Two sites remain intentionally scoped outside the extractor, for reasons unrelated to truncation: Guard 10 (AC-0.10 containment) reads each op's own section via `opSection = extractOpSection(soleCorpus, op, 'sole')` — see the Guard 10 follow-up section below — and the seam test's `collectMissingProducers` stays body-scoped because both of its known-bad probes mutate the `git.md` BODY under test, and a corpus-shaped signature would push the mutation into a fixture instead of the input under test.

### The ADR-025 reclassification pattern for a PR-host-style split (git-agent.test.ts, #326)

When a split moves guard-literal-carrying text out of `git.md` into a new reference tree, the harness's response is per-literal reclassification, never a blanket corpus widening — and #326 (the eight PR/review op bodies moving into `references/pr/{op}.md`) is the second worked example after Phase 2's tracker split. `git-agent.test.ts` names three helpers for this, module-scoped and built on the memoised `cachedSinkCorpus()`:

- `gitPlusPrHostCorpus()` — `git.md` UNION exactly the `references/pr/` tree, and nothing else. Used only by DETECTION guards, where the corpus decides WHICH ops are the subject (AC-0.6b's remote-I/O sweep). The full sink corpus would detect `setup-task` as remote-I/O through its unrelated PROVIDER mechanics, silently changing the guard's subject; `gitPlusPrHostCorpus()` sees exactly what #326 moved and no further.
- `sinkCorpusWithoutPrHost()` — the sink corpus with the `references/pr/` tree filtered out; throws if filtering removes nothing (PF-018: an empty filter means the tree the build should have emitted is missing, and every probe built on this helper would be vacuous). This is the known-bad probe every `'sole'`→`'union'` reclassification is checked against: a widening is only honest if dropping what it widened TO turns the guard red. Without this check, `'union'` is indistinguishable from `'sole'` on a corpus that happens to still contain the literal somewhere, and ADR-025's classification collapses into "widen everything until green."
- `seedPrHostFile(op, transform)` — a copy of the sink corpus with one `references/pr/{op}.md` entry's content replaced by `transform(content)`. Used to seed a defect (a dropped D11 clause, a smuggled `{title}` placeholder) into exactly one PR-host file and drive the live guard's own predicate over the result, proving a per-op containment claim reports the SEEDED op and not its sibling.

Every literal this split moved carries a paired positive/negative test built on these three: post-review-summary's and post-resolution-summary's 60000-char caps, resolve-review-threads' `≤50` bound and fetch-review-threads' `≤2-page` bound (each pinned by step literals only the PR-host half carries — the loop sentence; the step-1 `bounds:` wording and the cursor-correctness trap — because `git.md`'s own Output enum and purpose line still spell the bare tokens), the review/resolution dedup marker FORM, ensure-pr-ready's D11 scrub, and the containment negative arm's `{body}/{description}/{title}` check are all `extractOpSection(cachedSinkCorpus(), op, 'union')` reads with a `sinkCorpusWithoutPrHost()` (or `seedPrHostFile`) known-bad sibling. Four shared rules are named once, at describe scope, so the live guard and its probe read the identical rule rather than two copies that could drift (PF-018): `isPostingSection(sec)` (does a section post a body via `--body-file` or `-F body=@`?), `d10Reaches(corpus, op, literal)` (the D10 per-op containment predicate), `REMOTE_PLACEHOLDER_RE` (`/\{body\}|\{description\}|\{title\}/`, the remote-body placeholder the summary/reply ops' negative arm forbids), and `summaryComposeSurface(corpus, op)` (the surface that negative arm scans — the op's section across every corpus file, mode `'union'` — so its probe exercises the arm's corpus choice, not only its regex). That live arm also pins an in-scope witness, the `60000` cap every compose template states and none of those ops' `git.md` sections does, so a scope that shrinks back to `git.md` goes red instead of passing an absence check over less text. `D10_FAIL_CLOSED_LITERAL` (`'treat as PUBLIC'`) is likewise named once so the D10 per-op literal table and its known-bad probe cannot restate it apart. D4 evidence (`**Degradation (D4):**` / `TRACEABILITY: DEGRADED`) stays `'sole'`-scoped over `git.md` even inside the widened detection guard — a degradation clause living only in a loadable reference is a clause a spawn can decline to load (PF-027), so the agent alone must answer for it while the wider corpus only decides which ops count as remote-I/O in the first place.

### collectUnfencedH2 (fence-aware `## ` boundary, PF-063)

`collectUnfencedH2(text)` (`tests/helpers.ts`) returns every column-0 `## ` heading line in `text` that sits OUTSIDE a fenced code block, in document order, as `{ line, index, text }`. It delegates to the harness's ONE fence scanner, `scanFences(text, accept)` (private), via the exported `collectUnfencedLines(text, accept)` — a caller passes its own line predicate (a `## ` heading, `capability-hoist`'s `PROCESS_CLOSE` terminator set) while the fence grammar itself lives in exactly one place. `collectUnclosedFences(text)` is `scanFences`'s sibling export: it returns the opening delimiter (at most one) of a fence `text` never closes, and is what `tests/guards/fence-grammar.test.ts` asserts is empty across the whole always-loaded corpus.

Fence grammar — a deliberate CommonMark subset: a fence **opens** on a line whose first non-space characters, after at most 3 leading spaces, are 3+ backticks or 3+ tildes (a backtick fence's info string may not itself contain a backtick); it **closes** on a later line with at most 3 leading spaces carrying the same marker character, a run at least as long as the opening one, and nothing after it but whitespace; an **unclosed fence runs to end of text**. Deliberate non-goals, written down rather than inferred from a green run (PF-064): 4-space-indented code blocks, HTML blocks, and fences opened 4+ spaces deep inside a list item are not modelled.

Real-world necessity, not a hypothetical: `tracker/github/manage-debt.md`'s `## Items` is the literal body of the successor tech-debt issue, and `tracker/github/ensure-traceable-issue.md` carries six such lines across its `gh issue create` heredoc and its D3 template fence — demoting any of them to `###` would change what GitHub renders.

### loadGolden

`loadGolden(name)` reads from `tests/fixtures/golden/<name>` and throws with the update-command hint when absent. It never auto-regenerates — a guard that silently skips a missing fixture is not a guard (PF-018).

### requireDistFile / requireDistFiles / requireBuiltCli

All three throw with a build hint when the artifact is absent — `requireDistFile`/`requireDistFiles` for `dist/commands/`, `requireBuiltCli(root = ROOT)` for `dist/cli.js`. The injectable `root` parameter enables hermetic throw-behaviour tests without touching the real dist.

**Doctrine: build artifact → throw (fail-loud); external binary the repo cannot produce → `skipIf` capability gate.** A missing build artifact (anything `npm run build` produces) must fail the suite loudly. A missing external binary the repo has no way to produce (e.g. the `claude` CLI) is a legitimate `skipIf` capability gate. Every subprocess-CLI test file calls `requireBuiltCli()` at module scope, so an unbuilt tree is a collection error (exit 1), not a green SKIP.

### walkFiles

`walkFiles(dir, accept, maxDepth = MAX_REFERENCE_SWEEP_DEPTH)` — recursive `readdirSync(withFileTypes)`, deterministic (sorted) order. TWO bounds, not one: the shared `MAX_REFERENCE_SWEEP_DEPTH` (imported from `src/core/reference-sweep.ts`) is a hard ceiling that THROWS when breached; the caller-supplied `maxDepth` is a narrower, silent scope cap. `maxDepth` may only narrow, never widen past the shared bound. On `ENOENT` or `ENOTDIR` for a node: returns `[]`. Other errors rethrow. Used by `gitAgentSinkCorpus` for recursive `references/` traversal, and by the Phase-2/Phase-3 guards to build their own corpora.

### splitFrontmatter

`splitFrontmatter(text)` → `{ block, inner, body } | null` — splits a document at its leading `---…---` frontmatter block. Returns `null` when there is no block at byte offset 0. One owner for a shape that had been reimplemented per test file.

### gitAgentSinkCorpus

Builds the D11 sink-class corpus: `git.md` (via `resolveAgentSource('git', root)`) plus all `.md` files under `dist/skills/git/references/` (recursive via `walkFiles`; ENOENT-tolerant — returns `[]` when the directory is absent). The recursive descent covers every provider's `references/tracker/{provider}/{op}.md` depth AND the provider-independent `references/pr/{op}.md` tree with no changes to the corpus builder — `pr/` joined the corpus automatically the moment the build started emitting it; nothing in `gitAgentSinkCorpus` itself changed for #326. Accepts an injectable `root` parameter (default `ROOT`). Used by forward/reverse/bypass D11 guards, Guard 2's numeric-bound pins, and `capability-hoist`'s process-block corpus.

**`gitAgentSinkCorpus()` and `inlineBodyCorpus()` are memoised at MODULE scope inside `git-agent.test.ts`** (`cachedSinkCorpus()`) — not inside `tests/helpers.ts`, and not inside a `describe` block. Both builders are pure functions of the on-disk tree that no guard in the file writes to. The memo stays out of `helpers.ts` deliberately: other test files run in their own vitest worker and may legitimately want a fresh read, and both builders take an injectable `root` a shared cache inside the helper would silently ignore.

### Inline-body scan (joinContinuations / INLINE_BODY_SHAPES / matchInlineBodyShapes / collectInlineBodyOffenders / inlineBodyCorpus)

The D11 bypass guard (`tests/git-agent.test.ts`) reads a shell recipe the way a shell parses it, not the way a human skims it. `joinContinuations(text)` replaces every backslash-newline-indent with a single space BEFORE matching. `INLINE_BODY_SHAPES` names five posting forms independently: `long-flag`, `short-flag` (verb-restricted to `create|comment|review|close|reopen|edit`), `api-field`, `unscrubbed-file`, `unscrubbed-api-file`. `IN_COMMAND` (a character class excluding backticks, newlines, `|`, `;` and `&`) bounds every shape to ONE command.

`matchInlineBodyShapes(text)` folds continuations then returns every shape name that fires. `collectInlineBodyOffenders(corpus)` is the named collector, parameterised on the corpus so the live guard, the shape-table probe, and the known-bad posting probe all drive the SAME predicate (PF-018). `inlineBodyCorpus()` is the whole installed prompt surface: every declared agent via `resolveAllAgents()` ∪ `gitAgentSinkCorpus()` (git.md plus every generated reference, `pr/` included by construction) ∪ every skill `.md` ∪ every compiled command ∪ every rule — deduped by path, returning agent and generated counts for provenance.

### collectCrossCuttingSections / PROVIDER_DETECTORS (git-agent.test.ts)

A named collector local to `git-agent.test.ts`, not `tests/helpers.ts`. `collectCrossCuttingSections(text)` walks `collectUnfencedH2(text)` and buckets everything before the first `## Operation:` heading as `'(header)'`, then every remaining unfenced heading that is not itself an `## Operation:` line, by label, to end of file or the next such heading. `PROVIDER_DETECTORS` is a small table of `{ label, pattern, justification }` rows, each pattern a **labelled, word-boundary-bounded regex** rather than a bare substring test.

The live guard asserts TWO things over the real `git.md`: the cross-cutting label set equals the NAMED list `['(header)', 'Principles', 'Boundaries']`, and `collectProviderDetectors` returns empty (no GitHub-specific signal survives in text every spawn loads whatever provider it resolved to). A paired known-bad probe seeds a synthetic operation body with the SAME heading both fenced and unfenced, proving the fence-awareness is live in both directions.

### Tracker schema & mechanics collectors (helpers.ts, Tracker Phase 3)

`~/.devflow/tracker.md` has a WRITER — the Tracker agent's embedded template — and a READER — git.md's preamble. `TRACKER_SCHEMA_SECTIONS` (11 entries) lives once in `tests/helpers.ts`, imported by `tests/tracker-agent.test.ts` (writer arm) and `tests/tracker/schema-scope.test.ts` (reader arm). `collectTrackerTemplate(content)` addresses the embedded template fence BY TAG (`tracker-md-template`). `collectTrackerTemplateHeadings(template)` lists its `##`/`###` headings. `collectTrackerSchemaRows(content)` parses the agent's own schema/shape-check table, splitting on UNESCAPED pipes only; `tests/tracker/hostile-values.test.ts`'s payload matrix drives the corresponding shape-check cell this collector returns directly, so the agent's own table is the single authority a hostile payload is checked against (PF-018).

`TOOL_CALL_MECHANICS_CLAIMS` / `collectMissingMechanicsClaims` is the shared claim table for AC-3.3, AC-3.11 and §14.3, parameterised on a `ProviderRefVocabulary` (`refToken`/`refNoun`) so jira's and linear's generated mechanics are checked against the SAME clause text with only the vocabulary substituted. `PER_ITEM_FETCH_SHAPES` / `collectPerItemFetchVerbs` is the analogous shared table for [DR-08]'s per-item-fetch negative. All three tables live in `helpers.ts` rather than in any one provider's suite, since the claim is the SAME claim per provider.

### Fence parsing helpers

`parseFences(content)` — extracts all triple-backtick code fences. `isAgentBlock(fence, type)` — true when a fence spawns the named agent type. These mirror `registry-integrity.test.ts:449-456` verbatim — that file holds the repo's canonical fence-parsing precedent.

### Isolated MDS builds (buildCommittedTree / runMdsBuild / copyCommittedSources)

A test that needs real compiled artifacts must never get them by rebuilding the repo's own `dist/`: vitest runs other files in parallel workers that read those same paths, so an unscoped build silently REPAIRS a stale `dist/` mid-suite (PF-055). Every build spawned from `helpers.ts` is redirected to a throwaway root via `DEVFLOW_MDS_ROOT`, over a COPY of the committed `src/assets/{commands,agents,mds}` trees (`copyCommittedSources`). `buildCommittedTree()` compiles the committed corpus once per test file (memoised) and returns `{ run, root }`; pair with `cleanupCommittedTree()` in an `afterAll`. `collectSpawnScoping(source)` is a named collector every build-spawning test file runs against its own source, so a future `spawnSync(` site added without `DEVFLOW_MDS_ROOT` fails loud.

## Guard Conventions

Every guard in `tests/guards/` (and the additions in `tests/tracker/`, `tests/dynamic/`, `tests/installer/`, plus the two root-level files `tests/provider-literals.test.ts` and `tests/tracker-agent.test.ts`) follows the same three-part structure:

**1. Named collector.** The violation-detection logic is a named function. This function is called by both the main guard assertion AND the non-vacuity probe. A probe that reimplements the loop inline stays green after the real collector changes (M12b, PF-018).

**2. Corpus non-vacuity.** Before asserting zero violations, assert that the corpus is non-empty, AND — where a guard claims to scan two sources — assert by provenance that BOTH contributed, not just that the total crossed a floor.

**3. Known-bad probe (mechanic 2 / H10).** Build a synthetic corpus entry or temp root that contains a real violation and confirm the collector flags it. This proves the detection logic is live without touching any committed source file.

### De-vacuumed guard anti-pattern (AC-0.10 lesson)

The AC-0.10 containment guard had a combined predicate (`<untrusted-issue-body> || <external-thread>`) with floor 3. On unmodified `main`, three pre-existing `<external-thread>` ops satisfied the floor — the guard passed without ever touching any `<untrusted-issue-body>` op.

The fix splits into two independent assertions with **named matching op sets**:
- Issue-body: predicate `<untrusted-issue-body>` ONLY, floor 3, named set `{setup-task, fetch-issue, fetch-issues-batch}`.
- External-thread: predicate `<external-thread>` ONLY, floor 3, named set `{fetch-review-threads, post-resolution-summary, post-wave-report}`.

Rule: when a guard predicate is a logical OR, you cannot tell which branch is carrying the floor. Split into independent assertions with named op sets.

### Guard 10: a de-vacuumed predicate must also be scoped to the op's own section

Guard 10 reads each operation through `opSection = extractOpSection(soleCorpus, op, 'sole')` — the op's own section, cut at the next UNFENCED `## ` (PF-063) — never through a region that runs "to the next `## Operation:` anchor, or EOF". The difference matters for the LAST operation in `git.md` (`post-wave-report`): an EOF-bounded region sweeps in the shared `## Principles` trailer. **Lesson**: a named-set assertion proves an op is REACHABLE from the marker; it does not prove the marker lives in the op's OWN section unless the extraction is scoped to exactly that section.

### DIST_FILES vs COMMAND_HOSTS

The 13/14/14 count rule is owned by the `dynamic-workflow-engine` KB — see there for which number counts what and why the two 14s are different sets.

What the harness owns is how those sets are asserted. Both names are aliases of `tests/fixtures/mds-manifest.ts`, the single definition of *which* files the build owns (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `MDS_GENERATOR_HOSTS`, `DIST_COMMAND_FILES`, `ALL_MDS_HOSTS`, `MDS_REFERENCE_MODULES`). `MDS_PARTIALS` is 13 entries (`ALL_MDS_PARTIALS`); `MDS_GENERATOR_HOSTS` is `['git']`; `MDS_REFERENCE_MODULES` is **six** — the GitHub/Jira/Linear tracker fan-outs, the gated tool-call contract (`_mcp.mds`), `git/_pr.mds` (the PR-host fan-out over `PR_HOST_OPS`, added #326, installed under every provider), and the cross-cutting-documents module. `ALL_DISCOVERED_HOSTS` (`MDS_COMMAND_HOSTS ∪ MDS_GENERATOR_HOSTS ∪ MDS_REFERENCE_MODULES`) is 20. Every assertion site compares against a manifest by set-equality in both directions rather than by a count literal.

### OPERATION: anchor regex

The correct regex for compiled fences is `/^[ \t]*"?OPERATION: (\S+)/m` — allowing leading whitespace and an optional opening double quote. A column-0 anchor (`/^OPERATION: /m`) matches zero of the Git spawn fences in `dist/commands/` (PF-018 vacuity failure).

### Produces/Requires are DAG annotations, not spawn fields

`**Produces:**` and `**Requires:**` in command sources name principal upstream state for phase ordering. They are explicitly excluded from the seam test's key checks (PF-039).

## Goldens Lifecycle

Goldens are committed fixtures that assert file content remains stable. "A golden mismatch means the source is wrong, never the fixture" (H2).

**Two fixtures, current metrics (after #326's PR-host split):**
- `tests/fixtures/golden/git-agent.md` — byte-equals the resolved `git` agent (dist-preferred). Current: `GIT_MD_LINES = 801`, `GIT_MD_CHARS = 45_103`, `TOTAL_CHARS = 54_626`, `TOTAL_LINES = 1_106` (`tests/goldens/github-status-lines.test.ts`), `GIT_AGENT_BYTES = 45_435` (`tests/goldens/git-agent-golden.test.ts`). The fixture regenerates in a FIXTURE-ONLY commit, never folded into a prose commit.
- `tests/fixtures/golden/github-status-lines.txt` — equals `extractStatusLines()` output. Current: `FIXTURE_BYTES = 18_270`, `FIXTURE_NEWLINES = 249`, unchanged by #326 (see below). **FROZEN** — regenerating it needs `--unfreeze` AND a fresh explicit authorisation. Three have been granted and **all three are spent**; the log lives in the test file's header.

**Regeneration protocol:**
`npm run test:golden:update -- git-agent` (via `scripts/update-golden.ts`, tsx). The script resolves `git.md` through `resolveAgentSource` and logs the `origin` field. The **same commit** that runs the regeneration must also re-set `GIT_MD_LINES`/`GIT_MD_CHARS` in `tests/goldens/github-status-lines.test.ts` and `GIT_AGENT_BYTES` in `tests/goldens/git-agent-golden.test.ts`.

`npm run test:golden:update -- github-status-lines --unfreeze` for the frozen fixture (refused without `--unfreeze`).

**GIT_MD_LINES / GIT_MD_CHARS / GIT_AGENT_BYTES / FIXTURE_BYTES / FIXTURE_NEWLINES are EQUALITY baselines, not floors** — asserted with `toBe`, and deliberately NOT registered in `tests/fixtures/numeric-floors.json`.

**Frozen-fixture refusal re-derivation.** The `--unfreeze --out-dir` refusal test exercises the update script against a temp directory and re-derives the `github-status-lines.txt` fixture byte-for-byte on every `npm test`. CI never regenerates goldens.

**`extractStatusLines()` is CONTENT-ANCHORED, not line-offset based.** The function locates each excerpt using **unique text anchors** rather than hard-coded line numbers. The three core helpers:
- `gitOp(opName)` — extracts a named operation section from `git.md`. Routed through `extractOpSectionFromCorpus` in `'sole'` mode over a one-entry corpus (`[{ path: 'git.md', content: git }]`).
- `between(src, startAnchor, endAnchor)` — extracts content between two text anchors (multi-line anchors supported).
- `singleLine(src, anchor)` — extracts the single line containing an anchor.
- `ref(relPath)` — reads a generated reference through `compiledSkillRefsDir()`, refused for any path not on `STATUS_LINE_REFERENCE_FILES` via the type predicate `isStatusLineReference`.

`extractStatusLines(gitContent?)` accepts an optional `gitContent` parameter so callers can supply an alternative `git.md` body.

**Generated references and the closed reference list.** `STATUS_LINE_REFERENCE_FILES` is the closed list of **twelve** generated references the corpus samples: `learn-conventions.md`, `publication-gate.md`, six `pr/{op}.md` files (`check-ci-status`, `check-merge-readiness`, `fetch-review-threads`, `post-resolution-summary`, `post-review-summary`, `resolve-review-threads` — NOT `ensure-pr-ready` or `validate-branch`, which are sampled from Output templates that stayed in `git.md`; declaring an unread entry trips the unread-entry refusal), and four `tracker/github/{op}.md` files. Both directions are enforced: `ref()` refuses a path not on the list, and `extractStatusLines()` refuses to return unless every declared entry was actually read.

**D-STRADDLE-SPLIT: a sample that spans the retained/moved boundary is SPLIT into two (or three) reads, never repointed to one side.** Five operations straddle since #326: `manage-debt` and `learn-conventions` (Phase 2's pre-existing pair — retained D4/Output half in `git.md`, moved Process half in the reference), plus three new to #326 — `check-ci-status` (`**Input:**` line stayed, its six steps moved), `fetch-review-threads` (its steps moved, its `**Output:**` header stayed), and `resolve-review-threads`, the first **three-part** straddle: steps 1–2 and step 4 moved to `pr/resolve-review-threads.md` while step 3 — applying the D9 gate — stayed in `git.md` by rule (D9 has one authority), so the sample reads reference / git.md / reference in step order, the same order a spawn executes it in.

**No authorisation was spent moving these samples.** `github-status-lines.txt` is byte-unchanged across the #326 retarget — every sampled byte still exists, in the same order; the split is in the SLICING (which file each anchor is read from), never in the content. Verified both ways in the commit that made the move (`git show main:…/github-status-lines.txt | cmp -` against the working fixture, and a scratch `--unfreeze --out-dir` re-derivation).

**Safety map for `git.md` / generated-reference editors.** Sections still sampled directly from `git.md` include the D4 degradation contract, D11 scrub rules, the retained halves of `ensure-pr-ready`/`validate-branch`/`check-ci-status`/`fetch-review-threads`/`resolve-review-threads`/`manage-debt`/`learn-conventions`, `setup-task`, `fetch-issue`, `fetch-issues-batch`, `create-release`, `gather-release-evidence`, plus lines in `code.md`/`dynamic-build.mds`/`resolve.mds`. Sections sampled from the twelve generated references are sampled from the BUILT file — a source edit under `src/assets/mds/tracker/` or `src/assets/mds/git/_pr.mds` needs `npm run build` before the fixture check can even run.

**Sanctioned post-capture source fix procedure:** Source fix commit → `npm run build` → fixture-only re-capture commit. The fixture-only regen commit and the `numeric-floors.json`/equality-baseline update that pins its new size land TOGETHER, never with the ratchet entry arriving a commit early.

## Seam Test (command-agent-input.test.ts)

The seam test (`tests/seams/command-agent-input.test.ts`) pins the command→agent input contract (PF-024). It checks three directions against the compiled command corpus (`DIST_FILES`):

1. **Forward** — every `KEY:` value passed in a Git fence is declared in that op's `**Input:**` line in `git.md` (sole corpus; git.md is the single authority).
2. **Reverse** — every non-optional `**Input:**` identifier for an op that has at least one caller fence is passed by at least one caller.
3. **Producer, PER OPERATION** — every entry in `ISSUE_CAPTURE_CONTRACT` names one or more `producerOps`, and `collectMissingProducers()` checks each `(label, op)` pair independently.

**Ops with callers vs. without:** `git.md` defines 18 `## Operation:` sections; 13 have a live caller fence in `dist/commands/`. The five without are `learn-conventions`, `check-ci-status`, `create-release`, `gather-release-evidence`, and `backlink-shipped-issues`. The reverse-direction floor is `toBeGreaterThanOrEqual(13)`, pinned as `seam-ops-with-callers`.

**`issue_capture_contract()` — six keys.** `ISSUE_CAPTURE_CONTRACT` has six entries: `ISSUE_CONTENT`, `ACCEPTANCE_CRITERIA`, `ISSUE_REF`, plus the three `### Handoff Values` keys `ISSUE_ID`, `ISSUE_PR_LINK`, `ISSUE_BRANCH_TOKEN`. `issue-capture-contract-size` counts KEYS (6); the check itself ranges over `(key, op)` PAIRS.

**The three Handoff Values are single-issue-only.** Their `producerOps` name only `setup-task` and `fetch-issue` — `fetch-issues-batch` deliberately does NOT emit them.

**`'sole'` vs `'union'` corpora, by direction.** Directions 1/2 (`gitCorpus`) and Direction 3's `collectMissingProducers` both read `git.md` ALONE, because `git.md` is the single `**Input:**`/producer contract authority — the generated references also open with a `## Operation:` anchor, so a union corpus would make every lookup match twice.

`parseInputIdentifiers(section)` scopes to the `**Input:**` line only. Language-tagged fences are recipe fences and are excluded. Excluded keys: `OPERATION`, `COMPLIANCE`, `WORKTREE_PATH`, `PRODUCES`/`REQUIRES`, `D9`.

**`fencesScanned` carries a THIRD tracked type, `['Tracker', 0]`, as a CEILING rather than a floor.** The Tracker agent is spawned only by the SessionStart hook's directive, never by a compiled command, so its count must stay exactly 0.

## Numeric Floor Manifest (numeric-floors.json)

`tests/fixtures/numeric-floors.json` (DR-27a) is an occurrence-aware hand-registered manifest of pinned numbers, held in **two arrays with opposite directions**:

- `floors` (**30 entries**) — may only RISE, never fall. A floor pins a minimum the corpus must keep meeting as it grows.
- `ceilings` (**9 entries**) — may only be LOWERED, never raised. A ceiling pins a maximum. §14.5's rule: "a budget raised to fit the artifact is not a budget."

Both arrays share one mechanism, enforced by `tests/guards/numeric-floor-manifest.test.ts`: each entry records `id`, `floor`/`ceiling`, `pattern`, `occurrences`, `sourceFile`, and `description`. To move an entry: update both the assertion in the source file AND the manifest fields together, and only in the permitted direction.

**Floors and ceilings must stay disjoint.**

**Floor entries of note:**
- `partial-count` is **13**, counting `ALL_MDS_PARTIALS`; `dist-host-count` also pins 13 in the same file, each pattern naming its own receiver.
- `issue-capture-contract-size`: 3 → 6 for the three new `### Handoff Values` keys.
- `manage-debt-archive-cap` (60000, `tests/git-agent.test.ts`): occurrences **7** — the manage-debt archive threshold, the post-wave-report cap, each summary op's `'union'` positive assertion PLUS its `sinkCorpusWithoutPrHost()` known-bad probe (the literal appears negated too, in a `.not.toContain('60000')` — the pattern is a substring of both forms, which is why the probes count), and the containment negative arm's in-scope witness.
- `generated-reference-manifest-size`/`packed-reference-manifest-size`: 34 → **42** (10 GitHub + 10 Jira + 10 Linear ops + **8 PR-host ops** [PR_HOST_OPS, under no provider] + 3 cross-cutting documents + the tool-call contract). `capability-hoist-block-floor`: 49 → **57** (18 git.md + 1 learn-conventions + 30 provider blocks + **8 PR-host blocks**).
- `installed-reference-count-github`/`installed-reference-count-provider`: 13/24 → **21/32**, each +8 for the now-installed `pr/` tree (installed under every provider — PR hosting does not move with the tracker).
- `min-reference-chars` (80, `tests/tracker/reference-floor.ts`), `min-fenced-h2` (7, `tests/tracker/reference-structure.test.ts`) are harness-owned; `min-fenced-h2` now ranges over `TRACKER_GITHUB_OPS ∪ PR_HOST_OPS` (`PER_OP_REFERENCES`), not tracker ops alone — every per-op reference is extracted the same fence-aware way, `pr/` files included.
- **New**: `git-agent-remote-io-ops` (floor **14**, `tests/git-agent.test.ts`) — AC-0.6b's REQUIRED_OPS remote-I/O detection count, over `gitPlusPrHostCorpus()`. Replaces a bare `> 0` non-vacuity check, which one detected op satisfies and which therefore could not have caught #326 silently narrowing the set from 14 to 13 had the detection stayed `'sole'` (post-resolution-summary's `gh` indicators all moved with its body).
- `containment-issue-body-floor` + `containment-external-thread-floor`, each floor 3 — two floors rather than one shared ops floor, so neither set can pass on the other's count.

**Ceiling entries of note (all four `budget-*` git.md/loaded-set rows re-derived DOWNWARD by #326):**
- `budget-git-md` (`tests/tracker/byte-budget.test.ts`): 55_750 → **45_150** (measured 45_103). Supersedes the phase-named companion ceiling `budget-git-md-p3` (58_870, retired — the split it gated no longer exists; the two-ceiling Phase-2/Phase-3 pair collapsed into this one number once #326 cut the agent enough that the earlier delta-from-a-base bookkeeping stopped being necessary).
- `budget-loaded-set` (GitHub path): 80_200 → **67_200** (measured 67_123). `budget-loaded-set-jira`: 89_500 → **76_500** (measured 76_427). `budget-loaded-set-linear`: 91_700 → **78_700** (measured 78_610, still the largest of the four rows). Every term but the preloaded set is unchanged by the move; the whole of each fall is git.md's.
- **New**: `budget-loaded-set-pr-host` (ceiling **59_100**, measured 59_033 on `post-review-summary`) — its own row, for the reason each provider has one (D-LOADED-SET-PER-PROVIDER): `references/pr/` is installed under EVERY tracker, so folding it into a per-provider row would price one cost three times. Formula: preloaded set + `max over PR_HOST_OPS of (chars(pr/{op}.md) + every reference that op's own section names)` — no separate `max_op` term, since a PR-host op's own mechanics file is already inside its one-spawn load. Carries ONE written exclusion, `references/github-api.md` (`LOADED_SET_WRITTEN_EXCLUSIONS` in `tests/tracker/budget-model.ts`) — two ops loaded it long before any split existed and charging its 21_166 ch here would bury the `pr/` bodies the row measures; the exclusion is proven load-bearing by a companion test asserting the unexcluded figure would NOT fit under the ceiling, and RECORDED (never hidden) as the `2c-ex` shape in the printed four-shape table, which is now a seven-shape table (`shapes` length `7 + MCP_BACKED_PROVIDERS.length`).

**Entries are deliberately hand-registered** — automatic scanning would silently add floors for transient numbers and make the manifest untestable as a pinning device.

### The operation roster (`tests/git-agent.test.ts`)

`GIT_OPERATION_ROSTER` (18 names) and `collectOperationNames` live in a SECOND top-level describe at the tail of `tests/git-agent.test.ts`. They name the property — which operations the agent declares — rather than counting guard declarations.

## Tracker & install test directories

Four directories, each holding one or more files, all following the same guard/seam conventions above:

- **`tests/tracker/`** — `byte-budget.test.ts` (every `BUDGET_*` ceiling and the shape table), `single-authority.test.ts` and `reference-reachability.test.ts` (the two questions the generated tree answers, one file each — both now scan `references/pr/` as a peer tree to `references/tracker/`), `schema-scope.test.ts`, `hostile-values.test.ts`, `jira-module.test.ts` / `linear-module.test.ts`, `schema-oracle.test.ts`, `budget-model.ts` (the shared byte-cost model, not a test file — `nameableFrom`/`summedFor`/`worstCasePrHostLoad` live here), and `reference-structure.test.ts` (PF-063's structural remedy, ranging `PER_OP_REFERENCES` = `TRACKER_GITHUB_OPS ∪ PR_HOST_OPS`).
- **`tests/docs/`** — docs guards over repository prose: the CLAUDE.md Tracker block's cap and the selection-scoped naming.
- **`tests/dynamic/`** — `depends-on-grammar.test.ts`.
- **`tests/installer/`** — `reference-overlay.test.ts` (converge-not-merge: shadow-independence, atomic per-unit swap, stale-prune, symlink-skip, the render sites — `references/pr/` converges exactly like `references/tracker/`, its own `describe` block, D-CONVERGED-SUBTREES) and `install-shape.test.ts` (the selection-scoped install shape).

New guards in `tests/guards/`: `capability-hoist.test.ts` (no session-scoped capability probe runs inside a loop, floor now 57), `provider-scope.test.ts` (`PROVIDER_OWNED_PATHS`/`FORBIDDEN_SCOPES` now also cover `dist/skills/git/references/pr/` — PR-host is provider-NEUTRAL, so a jira/linear literal there would leak to every third-provider user, a STRONGER reason than github's), `heredoc-quoting.test.ts`. New seam: `tests/seams/pr-link-handoff.test.ts`.

## Tracker & install guard/seam files

One line each; every file follows the guard/seam conventions above.

- **`tests/guards/mcp-sink-bypass.test.ts`** — every tool-call posting mechanic under `tracker/{jira,linear}/` names all four D11 clauses; the corpus-reach arm asserts, PER MEMBER of `MCP_BACKED_PROVIDER_SUBDIRS`, that a mechanics file under that specific provider was actually read.
- **`tests/guards/provider-scope.test.ts`** — `PROVIDER_OWNED_PATHS`, an ordered `{prefix, token}` table enforcing AC-3.12's provider-neutral scopes plus the `_mcp.md` generation-gate arms. `FORBIDDEN_SCOPES` (the sites a jira/linear literal must never reach) includes the PR-host tree.
- **`tests/guards/no-control-bytes.test.ts`** — no shipped `src/` file carries a raw control byte in `0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F, 0x7F`.
- **`tests/provider-literals.test.ts`** (repo root) — AC-3.13's cross-provider literal matrix: 5 literals × 3 providers, each pinned by presence in its owning provider(s) AND absence from every other, against BOTH the source `.mds` and the generated tree.
- **`tests/tracker-agent.test.ts`** (repo root) — 50 static content guards on the Tracker agent's own prompt. Also owns the WRITER half of the `~/.devflow/tracker.md` schema seam.
- **`tests/tracker/schema-scope.test.ts`** — the READER half of the same schema seam; the AC-3.16 exactly-ONE-reader sweep; the §14.2 DEGRADED-reason registry, now **two scoped exemption lists**: `GITHUB_ONLY_REASONS` and `GIT_AGENT_LEGACY_REASONS` (pre-§14.2 wording, scoped to `git.md` alone) plus, since #326, `PR_HOST_LEGACY_REASONS` (`'5xx on post-review-summary'`, `'5xx on post-resolution-summary'` — the same class of pre-§14.2 literal, now emitted from `references/pr/{op}.md` rather than `git.md`) scoped by PATH PREFIX via `isPrHostEntryPath()` (`tests/helpers.ts`). The two legacy lists stay SEPARATE registries, never folded together: folding them would excuse the wording anywhere either file appears, when the shipped property is narrower — each literal is excused only in the tree that emits it, reported everywhere else (applies ADR-025). Scoped by prefix rather than basename because `ensure-pr-ready.md` legitimately exists under both `pr/` and every provider's tree.
- **`tests/tracker/hostile-values.test.ts`** — the field × nine-hostile-payload matrix, shape-check cells read from the Tracker agent's own schema table.
- **`tests/tracker/jira-module.test.ts`** / **`tests/tracker/linear-module.test.ts`** — cross-provider define-set parity, §14.4 capability-matrix coverage, comment-marker namespacing, the shared AC-3.3/AC-3.11/§14.3 mechanics-claim table.
- **`tests/seams/tracker-key-path.test.ts`** — `features.tracker.provider`'s two readers, checked as an OUTCOME equivalence.
- **`tests/tracker/single-authority.test.ts`** — `SHARED_LITERAL_REGISTRY` (7 rows) and `MCP_SHARED_LITERAL_REGISTRY` (5 rows). `providerReferenceCorpus()` now scans TWO trees, `tracker/` and `references/pr/` — the PR-host tree is scanned for the identical reason (a restatement there is worse, since it is loadable under every provider) and by the identical provenance-proof shape: the walker takes its tree list (`MECHANICS_TREES`), a non-vacuity arm asserts through the named predicate `readsPrHostTree` that at least one `pr/`-labelled entry was actually read, not just that the count crossed a floor, and the known-bad probe drives the same walker over the real tree with `pr/` left out and requires `readsPrHostTree` to report false.
- **`tests/tracker/reference-reachability.test.ts`** — structural parity (every op has a file, every file has an op), now including a dedicated **PR-host parity** block: every `PR_HOST_OPS` entry emits a non-trivial, size-floored file that opens with its own `## Operation:` anchor on line 1 (`anchorsOnLineOne`, proven by a probe that checks both a displaced and a well-formed anchor), plus its own forward/reverse **reachability** direction (`reachableSetFrom()`, a fourth arm added to the three module-kind arms — fanout/tracker, named, contract — for the PR-host fan-out, which is NOT templated like the provider fan-outs: the file is the same under every provider, so there is nothing to instantiate, and a second templated instruction would reopen the single provider→path convergence point PF-023 protects). 42-file reachability asserted in both directions.
- **`tests/guards/requires-closure.test.ts`** — the bidirectional `requires:` closure.
- **`tests/installer/install-shape.test.ts`** — the scoped install shape: manifest == `{github} ∪ {provider}` in both directions against the 21/32 floors.
- **`tests/tracker-install.test.ts`** — `convergeTrackerArtifacts`; a swap between providers now also asserts the PR-host tree's contents are unchanged (converges, never added/removed by a provider switch).
- **`tests/scoped-install-e2e.test.ts`** — real `dist/cli.js init` under three mkdtemp `HOME`s. Install-set counts in its assertions are read from `installedReferenceManifest({ provider })` rather than typed as literals, so the e2e's subject (steady-state re-init) stays distinct from the install-set SIZE, which a future module can move without touching this file.
- **`tests/docs/claude-md-tracker-section.test.ts`** — the CLAUDE.md Tracker block's character cap and its zero-internal-identifier rule.
- **`tests/seams/tracker-claim-staleness.test.ts`** — the claim-file staleness bound has two deciders that never talk to each other at runtime.

## Retired-Wording Guard (retired-wording.test.ts)

One shared grep guard with a denylist that grows once per phase — never a new grep, never emptied. Each `RETIRED_LITERALS` entry carries an optional `scope: readonly string[]` (corpus path-prefixes the literal is retired FROM; absent means the whole corpus).

Phase-3 CHANGELOG-scoped rows include `77,824` (the pre-split preloaded-set figure) with a refreshed justification: the loaded set is now priced PER PATH, not per provider — `BUDGET_LOADED_SET 67,200` on the GitHub path, `76,500` under jira, `78,700` under linear, `59,100` for a PR-host spawn — and every one of those rows sits BELOW the retired figure, so it cannot come back as a ceiling either. Scoped rows exist because a number that WAS a live ceiling is legitimately still quotable in narrative prose about what changed (`CHANGELOG.md`); the guard's job is to stop it being quoted as a CURRENT one.

Phase-2 denylist rows: `gh issue` (scope `dist/commands/`), `sleep 60`, `<!-- devflow:`, `{issue}`, plus nine retired §14.2 DEGRADED-reason synonyms.

## Dist-Agents Guard — AC-1.2 Absence Guard (dist-agents.test.ts)

The Phase-2 construct-absence guard matches **anchored regexes, not substrings**. `LEGALISED_IN_PHASE2 = ['expandVariants(', '(module, op)']` narrows the fence deliberately. What did NOT become legal and stays forbidden: `@if`, `variants:` as a line-start YAML key, `tracker-<provider>.md` as a filename token, `{provider}.md` as a templated output name, and `@import`/`@define` inside a compiled AGENT host.

## Integration Test Hazards

### Subagent skill preload (tests/integration/subagent-skill-preload.test.ts)

This file spawns real `claude` CLI sessions. Key constraints:

- **Suite is skipped when `claude` is absent** — CI skips the suite.
- **Prompts must stay read-only.** A spawned Git agent once made a real empty commit.
- **Session identity is deterministic.** `runClaudeAndWait` generates a UUID before spawning and passes it via `--session-id <uuid>`.
- **3-second post-SIGTERM wait.**
- **One bounded retry.** `MAX_SPAWN_ATTEMPTS = 2`.
- **Excluded from routine integration runs** by `exclude` in `vitest.integration.config.ts`. The only way back in is `DEVFLOW_INTEGRATION_ALL` set to an explicit affirmative.

### Clause (ii) file-residue (tests/integration/clause-ii-file-residue.test.ts)

Mechanises the file-residue half of the prefix-shippability clause (ii) acceptance criterion: packs the real tarball, installs into a scratch `$HOME`, creates a throwaway git repo, runs `devflow init --recommended`, and asserts `git status --porcelain` has no `??` (untracked) entries.

## Anti-Patterns

**Using `scanned > 0` as a non-vacuity check.** Necessary but not sufficient. Assert completeness against a named set and pin the expected count. Where a guard claims to scan TWO sources, assert both contributed by provenance.

**A non-vacuity probe that names ONE member of a set the gate ranges over.** Loop the probe over the set, not over one member of it.

**Inline reimplementation of collector logic in the probe.** The probe must call the same named collector as the main guard.

**Writing to real `dist/` or `src/` in tests.** Always use `mkdtempSync()` + injectable `root` params, or `buildCommittedTree()`.

**Calling `npm run test:golden:update` in CI.** Goldens that regenerate on every run assert nothing about the source file.

**Passing mode-less to `extractOpSectionFromCorpus`.** No default; every call must document its choice.

**Widening a `'sole'` corpus to `'union'` without a `sinkCorpusWithoutPrHost()`-style known-bad probe.** A widening proves nothing about where the literal lives unless dropping what it widened TO turns the guard red (#326's pattern, avoids PF-018 — see the ADR-025 reclassification pattern above).

**A de-vacuumed predicate still scoped too widely.** Scope to `extractOpSectionFromCorpus`'s own section, never a hand-rolled region.

**Searching the consumer (compiled commands) for a producer signal.** Direction 3 of the seam test must search `git.md` (the emitter), never `DIST_FILES` (the consumer).

**`skipIf` on a build artifact.** Use `requireBuiltCli()` / `requireDistFile(s)`; reserve `skipIf` for capability gates on external binaries the repo cannot produce.

**A scope that matches no corpus file.** `retired-wording`'s per-entry scope check and `provider-scope`'s allowlist-liveness check both exist because a scope prefix matching nothing silences its entry completely.

## Gotchas

**`extractOpSectionFromCorpus` truncates at the next UNFENCED column-0 `## ` line, never a fenced one.** (PF-063, `collectUnfencedH2`). Two sites stay scoped outside the extractor for reasons unrelated to truncation: Guard 10's `opSection` helper and the seam test's body-scoped `collectMissingProducers`.

**`4b.` step labels span files.** `git.md` carries one numbered `4b.` (`setup-task`'s conventions commit); `ensure-pr-ready`'s `4b.` lives in each `tracker/{provider}/ensure-pr-ready.md`, and `pr/ensure-pr-ready.md` carries its PR-host half unnumbered. A guard that keys off `4b.` must name its op section and corpus; `tests/tracker/reference-reachability.test.ts` asserts no step label is supplied by two files loaded for the same op.

**`github-status-lines.txt` is frozen, and every authorisation granted so far is spent.** Three one-time overrides: 2026-09-14 (`e4876e0`), 2026-09-15 (`c0b9860`), 2026-09-20 (nine lines). A fourth needs a fresh authorisation. The #326 retarget spent none of them — see the D-STRADDLE-SPLIT note in Goldens Lifecycle.

**Fixture byte/line counts must move in the same commit as the fixture.**

**`'sole'` mode throwing on a duplicated anchor is a signal, not a bug.** git.md operations also have same-named `## Operation:` anchors in the generated references — once per registered provider, plus once under `references/pr/` for the eight PR-host ops. A `'sole'` call accidentally pointed at a sink-wide corpus will throw — that is the mechanism working.

**A DIFFERENT sweep (`tests/agent-name-guards.test.ts`'s GAP-5, not `retired-wording`) scans `.devflow/features/**` too, case-insensitive with NO trailing boundary,** forbidding the noun "valid" + "ator" and "review" + "er" as literal spellings even in explanatory prose. Paraphrase when a KB needs to describe what one of these agents was renamed from.

**A synthetic fixture provider name can silently become real.** `tests/installer/reference-overlay.test.ts`'s fixture provider is the deliberately-unregisterable `probe-provider` (PF-043).

**No test writes the real `dist/`.** `buildCommittedTree()` in `tests/helpers.ts` gives every test file a real-artifacts-without-a-real-dist-write property, memoised per file.

**PF-043 shape requirement.** Test fixtures must be built from real runtime shapes, never invented.

**`INLINE_BODY_SHAPES`' non-goals are written down, not inferred from a green run (PF-064).**

**`gitAuthorityCorpus()`'s scan surface is a written non-goal, not an oversight (PF-064, GAP-25's Guard 7b).** It reads `dist/agents/git.md ∪ src/assets/skills/git/**` — the AUTHORED preload surface only, not the sink corpus. Widening it was rejected under ADR-025 for the same reason a blanket `'union'` widening is rejected: the property under test is scoped to the text a spawn PRELOADS, and a joined corpus would prove the literal exists somewhere while losing the scope that makes the count mean anything.

**Mutation-proof pattern.** Reintroducing `--comment "x"` on the tech-debt archive's close in `_github.mds` turns the bypass guard red naming `manage-debt.md`. Removing `post-wave-report`'s non-reproduction sub-bullet from `git.mds` turns Guard 10 red specifically on that op, not on a trailer 30 lines below it.

**A `LOADED_SET_WRITTEN_EXCLUSIONS` entry only means something while it is still reached.** `tests/tracker/byte-budget.test.ts` asserts the excluded file (`github-api.md`) is named by `summedFor(op)` for the exact NAMED pair of ops (`fetch-review-threads`, `resolve-review-threads`) — not a count — because a count of 2 is equally satisfied by losing one op and gaining an unrelated one.

## Key Files

- `tests/helpers.ts` — shared helper API: `resolveAgentSource`, `resolveAllAgents`, `collectUnfencedH2`, `collectUnfencedLines`/`collectUnclosedFences`, `extractOpSectionFromCorpus`, `walkFiles`, `splitFrontmatter`, `gitAgentSinkCorpus`, `collectTrackerNamingLines`, `loadGolden`, `extractStatusLines` (`STATUS_LINE_REFERENCE_FILES` = 12 entries incl. six `pr/*.md`; `gitOp`/`between`/`singleLine`/`ref`/`isStatusLineReference`/`statusLineRefReader`), `parseFences`, `isAgentBlock`, `requireDistFile`, `requireDistFiles`, `requireBuiltCli`, `prHostRel`/`isPrHostEntryPath` (the one spelling of the `pr/` path grammar), `makeManifest`, `computeFpRatio`, the isolated-build set, and the Tracker Phase 3 additions (`TRACKER_SCHEMA_SECTIONS`, `collectTrackerTemplate`/`collectTrackerTemplateHeadings`/`collectTrackerSchemaRows`, `TOOL_CALL_MECHANICS_CLAIMS`/`collectMissingMechanicsClaims`, `PER_ITEM_FETCH_SHAPES`/`collectPerItemFetchVerbs`)
- `tests/fixtures/mds-manifest.ts` — the name manifests (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS` = 13, `MDS_GENERATOR_HOSTS` = `['git']`, `MDS_REFERENCE_MODULES` = 6, `ALL_DISCOVERED_HOSTS` = 20)
- `tests/git-agent.test.ts` — the Git-agent guard suite; `gitPlusPrHostCorpus()`, `sinkCorpusWithoutPrHost()`, `seedPrHostFile()` (the #326 reclassification helpers); `isPostingSection`, `d10Reaches`, `D10_FAIL_CLOSED_LITERAL`, `REMOTE_PLACEHOLDER_RE` (shared predicates); `GIT_OPERATION_ROSTER` (18 names) in a second top-level describe
- `tests/guards/dist-agents.test.ts` — dist/agents parity, frontmatter-shape guard, AC-1.2 absence guard
- `tests/guards/agent-source-resolver.test.ts` — resolver unit tests; `extractOpSectionFromCorpus` sole/union mode tests; the `agent-roster-count` = 17 floor
- `tests/guards/numeric-floor-manifest.test.ts` — floor/ceiling pinning guard
- `tests/guards/literal-agent-paths.test.ts` — six-entry `SCAN_DIRS`
- `tests/guards/retired-wording.test.ts` — scoped denylist of retired literals
- `tests/guards/extended-references.test.ts` — SKILL.md Extended References table integrity
- `tests/guards/capability-hoist.test.ts` — [DR-11] no session-scoped capability probe inside a loop; `capability-hoist-block-floor` = 57
- `tests/guards/provider-scope.test.ts` — `PROVIDER_OWNED_PATHS`/`FORBIDDEN_SCOPES` (now including `dist/skills/git/references/pr/`)
- `tests/guards/heredoc-quoting.test.ts` — unquoted `<<EOF` heredoc scan
- `tests/guards/mcp-sink-bypass.test.ts` — D11-clause + bypass-shape guard over the tool-call sink class
- `tests/guards/no-control-bytes.test.ts` — raw-control-byte absence guard over shipped `src/`
- `tests/provider-literals.test.ts` (repo root) — AC-3.13 cross-provider literal matrix
- `tests/tracker-agent.test.ts` (repo root) — 50 static guards on the Tracker agent
- `tests/seams/command-agent-input.test.ts` — three-direction command→agent seam; floor `seam-ops-with-callers` = 13
- `tests/seams/pr-link-handoff.test.ts` — `### Handoff Values` producer/consumer pair; floor `issue-pr-link-forwarding-sites` = 14
- `tests/seams/tracker-key-path.test.ts` — TS↔shell `features.tracker.provider` seam
- `tests/seams/tracker-claim-staleness.test.ts` — hook↔agent claim-staleness seam
- `tests/tracker/byte-budget.test.ts` — the byte-budget ceilings and the (now seven-shape) table
- `tests/tracker/budget-model.ts` — the shared byte-cost model: `nameableFrom` (one-hop into a `pr/` body), `summedFor`/`summedForProvider`, `worstCasePrHostLoad`, `LOADED_SET_WRITTEN_EXCLUSIONS`, `isPrHostOp` (a type predicate)
- `tests/tracker/single-authority.test.ts` / `tests/tracker/reference-reachability.test.ts` — one owner per normative sentence over `tracker/ ∪ pr/`; every generated file nameable by a consumer, PR-host parity + reachability arms
- `tests/tracker/reference-structure.test.ts` — PF-063 structural guard over `PER_OP_REFERENCES` (`TRACKER_GITHUB_OPS ∪ PR_HOST_OPS`)
- `tests/tracker/schema-scope.test.ts` — reader half of the `tracker.md` schema seam; `GITHUB_ONLY_REASONS`, `GIT_AGENT_LEGACY_REASONS`, `PR_HOST_LEGACY_REASONS` (three separate scoped exemption lists)
- `tests/tracker/hostile-values.test.ts` — field × nine-payload hostile-value matrix
- `tests/tracker/jira-module.test.ts` / `tests/tracker/linear-module.test.ts` — cross-provider define-set parity
- `tests/dynamic/depends-on-grammar.test.ts` — `Depends on:` grammar writer↔reader pair
- `tests/installer/reference-overlay.test.ts` — converge-not-merge reference overlay; `probe-provider` fixture self-check; `pr/` converges like `tracker/` (D-CONVERGED-SUBTREES)
- `tests/goldens/git-agent-golden.test.ts` — byte-equality guard; `GIT_AGENT_BYTES = 45_400`
- `tests/goldens/github-status-lines.test.ts` — `extractStatusLines()` stability guard; `FIXTURE_BYTES = 18_270`, `FIXTURE_NEWLINES = 249`
- `tests/fixtures/golden/git-agent.md` — frozen byte-equal snapshot of the resolved `git` agent (801 lines, 45,103 chars, 45,435 bytes)
- `tests/fixtures/golden/github-status-lines.txt` — frozen output of `extractStatusLines()` (18,270 bytes / 249 newlines)
- `tests/guards/requires-closure.test.ts` — the bidirectional `requires:` closure
- `tests/installer/install-shape.test.ts` · `tests/tracker-install.test.ts` · `tests/scoped-install-e2e.test.ts` — the scoped install shape, `convergeTrackerArtifacts`, and the real-CLI three-provider diff
- `tests/docs/claude-md-tracker-section.test.ts` — the CLAUDE.md Tracker block cap
- `tests/fixtures/numeric-floors.json` — occurrence-aware ratchet manifest: `floors` (30, rise-only) + `ceilings` (9, fall-only)
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
| `references/tracker/` and `references/pr/` paths | Excepted from extended-references guard | Generated-path; files created at build time, not in src/ |
| `tests/integration/subagent-skill-preload.test.ts` | Spawns real `claude` with `--dangerously-skip-permissions` | Required for subagent spawn; prompts are read-only by test design |
| Seam Direction 3 | Uses body-scoped slicing over a `git.md` BODY, not `extractOpSectionFromCorpus` | Both known-bad probes drive `collectMissingProducers` with a mutated copy of the git.md body; a corpus-shaped signature would push the mutation into a fixture instead of the input under test |
| `references/github-api.md` inline bodies | `KNOWN_GITHUB_API_INLINE_BODIES` is empty | The empty array is the declaration point for any future named exception |
| `PROVIDER_MAP_ALLOWLIST` (provider-scope.test.ts) | `git.mds`/`git.md`'s provider-resolution preamble block is the one place `jira`/`linear` literals are legal | PF-023: exactly one convergence point where a provider token becomes a path |
| `EXTRA_PROVIDER_MANIFEST` fixture (reference-overlay.test.ts) | Named `probe-provider`, deliberately unregisterable, with its own guard asserting it stays absent from the real manifest | A prior fixture literally named `jira` became a real provider mid-Phase-3 and silently inverted what its arms proved (PF-043) |
| `LOADED_SET_WRITTEN_EXCLUSIONS` (budget-model.ts) | `references/github-api.md` is excluded from the PR-host loaded-set gate's charge, but RECORDED via the `2c-ex` shape and pinned by an equality constant | Two ops loaded it long before any split existed; charging its ~21k chars here would bury the `pr/` bodies the row exists to measure (applies ADR-025) |

## Related

- PF-018: Non-vacuity requirement — every guard must prove its collector is live, not merely that the corpus is non-empty
- PF-024: The command→agent boundary — what the seam test (`command-agent-input.test.ts`) enforces
- PF-035: The skim tool-rewrite hook substitutes a structural view for `cat`/`head`/`tail` reads — use the `Read` tool, not shell reads, when verifying test source files
- PF-039: `**Produces:**`/`**Requires:**` are phase-ordering DAG annotations, not spawn-block field contracts
- PF-043: Test fixtures must be built from real project runtime shapes, not invented
- PF-045: Simulating a missing tool by subtracting it from `PATH` is platform-dependent
- PF-055: An unscoped rebuild of the real `dist/` silently repairs staleness that parallel workers are concurrently reading, turning it into a flake
- PF-057: Parallel re-derivation of an equality baseline is how derived constants rot — re-derive from the fixture that already carries the number
- PF-060: A prose-only prohibition inside a prompt nobody observes at runtime is not a control
- PF-064: An absence-based guard stacks matcher-expressiveness, corpus-reach, and predicate-semantics claims — `INLINE_BODY_SHAPES`' and `collectUnfencedH2`'s own non-goals docblocks in `tests/helpers.ts` are worked examples; `sinkCorpusWithoutPrHost()`'s vacuity throw and `budget-model.ts`'s injected-reader probe for the one-hop `nameableFrom` are #326's
- PF-063: Byte-identical relocation is not semantics-preserving across a grammar boundary — resolved by the fence-aware `collectUnfencedH2` boundary and `tests/tracker/reference-structure.test.ts`'s structural guard
- PF-065: A decision-ledger citation is an assertion about another document's contents, not a tag — miscited anchors have previously propagated into git-tracked KNOWLEDGE.md files across this repo; the explicit ADR-024 disclaimer below exists because of it
- ADR-003: Leave-the-end-state-not-the-transition — guard tests must clean up tombstones from prior phases
- ADR-024 is the settings.json prove-you-wrote-it ownership contract (deletion vs overwrite of shared config keys) — it does NOT govern this file's testing doctrine and is not cited elsewhere in this KB. Every probe-doctrine claim here (named collectors, known-bad probes, non-vacuity) traces to PF-018 and/or PF-064 instead.
- ADR-025: When a monolithic prompt splits further, classify every guard literal one at a time and widen a guard corpus ONLY where its literal provably moved — never blanket-widen a whole suite to make it green. Applies to `extractOpSectionFromCorpus`'s 'sole'/'union' mode-naming rule, `gitAuthorityCorpus()`'s deliberately un-widened scope, the #326 ADR-025 reclassification pattern above, and `PR_HOST_LEGACY_REASONS` staying a separate registry from `GIT_AGENT_LEGACY_REASONS`; the domain-content history of the splits themselves is owned by `tracker-references`/`tracker-feature`.
- `tracker-references` feature knowledge — owns the Tracker Phase 2/3 architecture the new guards/seams pin: provider resolution mechanics, the capability matrix, byte budgets, the containment oracle, the generated-reference manifest, `VARIANT_MODULES`/`expandVariants`, and the #326 PR-host split's domain rationale
- `tracker-feature` feature knowledge — owns the Tracker Phase 3 provider-selection substrate, the tool-call sink contract, per-provider (Jira/Linear) mechanics semantics, the `~/.devflow/tracker.md` schema's meaning, and the hook↔agent claim-staleness contract
- `tests/registry-integrity.test.ts` — complementary seam test; pins OPERATION: name accuracy (Guard 6) and fence-parsing precedent
- `tests/build-mds.test.ts` — compilation guard that pins deployed behaviour; named collector pattern at `collectGhIssueProseViolations` is the cross-reference for M12a
