# Architecture Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Diff range**: bd1c92f...HEAD
**Date**: 2026-04-15 10:22

## Scope

This review examines the architectural boundaries introduced by the v2 knowledge ship-blockers PR:

- New shared skill `shared/skills/apply-knowledge/SKILL.md` (consumer algorithm)
- New CJS module `scripts/hooks/lib/knowledge-context.cjs` (orchestrator-side index loader)
- Orchestrator-local vs fan-out pattern across 4 `*:orch` skills
- Consumer agent contract (5 agents: resolver, designer, simplifier, scrutinizer, reviewer)
- Layering between low-level hook libraries and high-level orchestration concerns
- Cross-orchestrator consistency

The architecture is generally sound: the skill/orchestrator/consumer separation is the right abstraction layer, the CJS module is appropriately decoupled from orchestration, and the new index-pattern eliminates the fan-out tax. The blocking issues below are about consistency of adoption — several user-invocable surfaces are out-of-step with the new pattern in ways that will produce silent failure modes.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent knowledge adoption: `/debug` and `/implement` commands silently bypass the new pattern** — `plugins/devflow-debug/commands/debug.md:34-36`, `plugins/devflow-implement/commands/implement.md`, `shared/skills/implement:orch/SKILL.md:91-93`, `shared/skills/pipeline:orch/SKILL.md`
**Confidence**: 92%

- Problem: The PR establishes a clear contract — orchestrators run `node scripts/hooks/lib/knowledge-context.cjs index "<worktree>"` and pass `KNOWLEDGE_CONTEXT` to consumer agents that declare `devflow:apply-knowledge` in frontmatter. The PR updates `code-review.md`, `code-review-teams.md`, `plan.md`, `plan-teams.md`, `resolve.md`, `resolve-teams.md`, `self-review.md`, and the four `*:orch` skills. It does **not** update:
  - `plugins/devflow-debug/commands/debug.md:34-36` — Phase 1 still says "Read `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`" via raw Read, the pre-PR pattern. This is the OLD path that bypasses D-A filtering of Deprecated/Superseded entries — the very thing `knowledge-context.cjs` was built to centralize.
  - `plugins/devflow-implement/commands/implement.md` and `shared/skills/implement:orch/SKILL.md:91-93` — these spawn Simplifier and Scrutinizer (which now declare `devflow:apply-knowledge` and document `KNOWLEDGE_CONTEXT` as expected input per `shared/agents/simplifier.md:17` and `shared/agents/scrutinizer.md:17`) but pass NO `KNOWLEDGE_CONTEXT`. Consumers will silently fall through their "skip when (none) or absent" guard, so the feature is effectively dark on the implementation pipeline — exactly the workflow where avoiding-known-pitfalls would have the highest leverage.
  - `shared/skills/pipeline:orch/SKILL.md` — chains implement → review → resolve. Same gap propagates.
  - `debug:orch` Phase 5 also spawns a Simplifier on the fix without forwarding the knowledge it loaded in Phase 0.
- Impact: Architectural contract drift. The "consumer agents follow `devflow:apply-knowledge` to consume `KNOWLEDGE_CONTEXT`" contract is asserted in five agent files but only honored by four of seven orchestration surfaces. The half-adopted state is worse than no adoption: code review will catch a known pitfall while the very next /implement won't, producing a reintroduction-detection regression on the most common authoring workflow. Also creates two competing patterns in the codebase (raw read in `/debug`, indexed read elsewhere) that future contributors will copy from inconsistently.
- Fix: Either (a) extend the same Phase-N-Load-Knowledge step to `/implement`, `implement:orch`, `pipeline:orch`, and `/debug`, plus thread `KNOWLEDGE_CONTEXT` through Coder, Simplifier, Scrutinizer spawn blocks, OR (b) explicitly document in `shared/skills/apply-knowledge/SKILL.md` and the four updated commands that knowledge-aware consumption is intentionally scoped to {plan, code-review, resolve, self-review} for v2 and that {implement, debug, pipeline} are deferred — with the rationale. Option (a) is preferred because the consumer-agent frontmatter has already been changed; the agents declare a capability their primary spawner does not exercise.

**Layering inversion: `apply-knowledge` SKILL hardcodes `.memory/knowledge/decisions.md` paths, breaking the abstraction the index footer was supposed to provide** — `shared/skills/apply-knowledge/SKILL.md:36-38, 54-58`
**Confidence**: 86%

- Problem: The skill's purpose is to consume the index that `knowledge-context.cjs` produces. The CJS module already writes a footer ("ADR-NNN entries live in {decisionsFile}", `knowledge-context.cjs:211-218`) so the consumer doesn't need to hardcode paths. But the skill body duplicates that information at lines 36-38 and 54-58 (`.memory/knowledge/decisions.md → find ## ADR-NNN: heading`). This creates two sources of truth for "where do knowledge files live": the runtime footer (canonical, computed from `worktreePath`) and the static skill text (assumes default layout, ignores `opts.decisionsFile` overrides used by tests, ignores `WORKTREE_PATH` resolution).
- Impact: A consumer agent following the skill's static instructions in a worktree (`WORKTREE_PATH={path}` set per `devflow:worktree-support`) will Read `.memory/knowledge/decisions.md` relative to cwd — wrong directory in multi-worktree mode. The footer says the right path; the skill body contradicts it. Skill authors must keep both in sync forever (Stevens-Myers content coupling [8]). The skill should defer to the index's footer ("Read the file path listed in the footer", which it already says at line 38 — but then immediately contradicts at lines 54-58 by giving paths again).
- Fix: Remove the hardcoded paths from Step 1 (lines 36-37) and Step 3 (lines 54-58). Replace with: "the path is in the footer of `KNOWLEDGE_CONTEXT` — Read that file." This makes the footer the single source of truth and inherits worktree-correctness for free, since `loadKnowledgeIndex` (`knowledge-context.cjs:212, 217`) emits absolute paths derived from the worktree argument.

**CLI dispatch detection heuristic in `knowledge-context.cjs` is fragile and has a footgun for relative paths** — `scripts/hooks/lib/knowledge-context.cjs:302-321`
**Confidence**: 88%

- Problem: The dispatch logic at lines 302-321 detects "bare invocation" (deprecated) versus subcommand by inspecting whether the first arg looks like a path: `firstArg.startsWith('/') || firstArg.startsWith('.') || firstArg.startsWith('~') || firstArg.includes('/')`. This is heuristic, not structural. Footguns:
  - A subdirectory worktree name like `foo` (single token, no slash) would fall through `else if (!KNOWN_SUBCOMMANDS.has(firstArg))` to `usageExit()` — silently swallows what looks like a valid path arg.
  - A bare arg of `~` (without a slash) is treated as a path; `path.resolve('~')` does NOT expand `~` (Node doesn't), so it resolves to `cwd/~` — a directory that almost certainly doesn't exist, returning `(none)`.
  - The dispatch rejects unknown subcommands (`foo`) but accepts them as paths if they contain a slash (`foo/`). Two different rejection paths for "garbage input" depending on whether it has a `/` is surprising.
- Impact: The bare/deprecated form is fragile. Most callers pass `"."` (which has the `.` prefix and works) or absolute paths (which start with `/` and work), but documentation in the file header (`knowledge-context.cjs:13-15`) advertises the bare form as backwards-compatible — promising a contract the heuristic doesn't reliably honor. Also the dispatch is a Stevens content-coupling [8] hazard: every change to add a subcommand requires updating both `KNOWN_SUBCOMMANDS` and re-thinking the heuristic.
- Fix: Drop the heuristic. The deprecation can be enforced more cleanly:
  ```javascript
  if (firstArg !== 'index' && firstArg !== 'full') {
    process.stderr.write(
      '[knowledge-context] DEPRECATED: bare invocation. Use `index` or `full` subcommand. ' +
      'For now, treating as bare and emitting full corpus.\n'
    );
    mode = 'bare';
    worktreeArg = firstArg;
  } else {
    mode = firstArg;
    worktreeArg = argv[1];
  }
  ```
  This treats anything-not-a-known-subcommand as a path, with a deprecation notice. No path-shape inference. Or, alternatively, drop the bare form entirely — none of the orchestrators in this PR use it, and `git log -p` shows no production callers. The CLI is internal-only.

### MEDIUM

**Subcommand dispatch duplicates `json-helper.cjs` style without sharing infrastructure — coupling without consolidation** — `scripts/hooks/lib/knowledge-context.cjs:269-365`, `scripts/hooks/json-helper.cjs:8-44`
**Confidence**: 82%

- Problem: The header comment at `knowledge-context.cjs:20-24` explicitly says "CLI dispatch mirrors json-helper.cjs:8-36 subcommand style." Mirror-by-comment is a documentation-coupling smell [8]: there's no shared dispatcher, no shared usage helper, and no shared exit-code convention — just two files that "look similar." Both manually parse `process.argv.slice(2)`, both maintain their own `KNOWN_SUBCOMMANDS` set, both write usage-to-stderr-and-exit-1 in custom helpers, both emit observability log lines with bracketed prefixes (`[knowledge-context]` vs `[json-helper]`-style messages elsewhere). If a third hook library appears (likely given the trajectory), it will also be a mirror.
- Impact: This is acceptable today — the duplication is small (~40 LOC) and the modules are deliberately separated by domain. But the comment "mirrors X" is a future-coupling tax: any change to dispatch conventions in `json-helper.cjs` (e.g., adding `--help`, JSON output mode) means manually re-mirroring here. Worse, the *correctness* of the mirror cannot be tested — there's no shared contract to assert against.
- Fix (preferred): Introduce a tiny shared helper at `scripts/hooks/lib/cli-dispatch.cjs` exporting `dispatch({ subcommands, usage, handlers })`. ~30 LOC. Both files use it. Eliminates the "mirror this style" coupling.
- Fix (acceptable for v2): Leave as-is, but remove the "mirrors json-helper.cjs:8-36" comment — a comment that asserts a constraint without an enforcement mechanism is liability, not documentation. Replace with: "Subcommand dispatch (CLI). Standalone — no shared dispatcher exists yet."

**`apply-knowledge` skill duplicates the index format documentation that `knowledge-context.cjs` controls** — `shared/skills/apply-knowledge/SKILL.md:25-39`
**Confidence**: 83%

- Problem: The skill at lines 25-39 hardcodes the exact format of the index (`Decisions (N):`, `  ADR-001  Title truncated to 60 chars  [Active]`, etc.). The producer is `knowledge-context.cjs:122-141` (`formatAdrLine`, `formatPfLine`). If anyone changes the format — adds a column, switches to JSON output mode, changes truncation widths from 60→80 — the skill will be wrong but consumer agents will still follow it as gospel. The producer (CJS) and the consumer-instruction (skill) drift apart silently.
- Impact: Format-coupling without enforcement. The producer/consumer pair has no integration test asserting "the format the skill describes is the format the producer emits." `tests/knowledge/index-generator.test.ts` tests the producer; `tests/knowledge/apply-knowledge-skill.test.ts` tests the skill prose for keyword presence — neither asserts they agree.
- Fix: Add an integration test that runs `loadKnowledgeIndex` against a fixture and asserts the output matches the schema described in the skill (regex like `/^  (ADR|PF)-\d{3}  .{1,61}  \[(Active|Deprecated|Superseded|unknown)\]/m`). Or, better, lift the format documentation to a shared `references/index-format.md` that both the skill and the CJS module link to (single source of truth) [9].

**`debug:orch` knowledge-local pattern is documented but not justified at the cross-orchestrator level** — `shared/skills/debug:orch/SKILL.md:27-35`
**Confidence**: 80%

- Problem: `debug:orch` declares "Do NOT pass `KNOWLEDGE_CONTEXT` to Explore sub-agents — knowledge context stays in the orchestrator, not in the investigation workers." This is correct for debugging (orchestrator generates hypotheses, workers gather evidence on each — workers are scoped to one hypothesis and don't need cross-cutting knowledge). The other three orchs (`plan:orch`, `review:orch`, `resolve:orch`) fan out the index to workers. The distinction is asymmetric and load-bearing, but the rationale exists only inline in `debug:orch:35`. There's no cross-orchestrator design document explaining "load locally vs fan out: when to choose which" — the implicit rule is "fan out when workers categorize against the index, keep local when workers do narrow point-investigation." Without that rule written down, future orch-skill authors will copy whichever happened to be open in their editor.
- Impact: Architectural decision (Parnas [1]) without persistence. The file-by-file inconsistency looks like a bug to first-time readers. `tests/knowledge/command-adoption.test.ts:51-64` enforces the asymmetry as a contract ("debug:orch Explore spawn blocks do NOT pass KNOWLEDGE_CONTEXT") but the test doesn't explain *why*.
- Fix: Add a 3-line "When to fan out vs keep local" subsection to `shared/skills/apply-knowledge/SKILL.md` (the canonical consumer skill), citing both patterns. E.g.:
  ```
  ## Orchestrator Pattern: Local vs Fan-Out
  - **Fan out** (plan:orch, review:orch, resolve:orch): workers classify their work against the index — pass KNOWLEDGE_CONTEXT to each.
  - **Keep local** (debug:orch): orchestrator uses knowledge to *generate* worker tasks; workers don't need it. Fan-out would be wasted tokens per worker.
  ```
  This makes the asymmetry a deliberate, documented choice rather than apparent inconsistency.

## Issues in Code You Touched (Should Fix)

**Designer agent in `plugins/devflow-plan/agents/designer.md` is a stale duplicate of `shared/agents/designer.md`** — `plugins/devflow-plan/agents/designer.md` (whole file)
**Confidence**: 81%

- Problem: The PR diff shows IDENTICAL changes to both `shared/agents/designer.md` and `plugins/devflow-plan/agents/designer.md` — same skill addition, same KNOWLEDGE_CONTEXT input docs, same Apply Knowledge step. Per CLAUDE.md ("Build-time asset distribution: Skills and agents are stored once in `shared/skills/` and `shared/agents/`, then copied to each plugin at build time"), the plugin copy should be gitignored and generated, not committed and edited in parallel. The fact that both files needed to be edited identically by hand here is a layering smell — the build-time copy is being treated as a source.
- Impact: Two-file maintenance burden for every shared agent change. The next contributor who edits only `shared/agents/designer.md` (correctly following the build-system docs in CLAUDE.md) will produce a working tree where the plugin copy diverges silently. The build will overwrite it on next `npm run build`, but in the gap, anyone consulting the plugin copy gets stale content.
- Fix: Verify whether `plugins/devflow-plan/agents/designer.md` SHOULD be in git (per CLAUDE.md it should not be — "Generated copies in `plugins/*/skills/` and shared agent files are gitignored"). If it shouldn't, add to `.gitignore` and remove from this PR. If there's a reason this specific file is checked in (e.g., plugin-specific override), document it in CLAUDE.md or the file itself. Same applies to other duplicated agent files in `plugins/devflow-implement/agents/` (scrutinizer.md, simplifier.md per the grep above).

## Pre-existing Issues (Not Blocking)

**`json-helper.cjs` is a 1700+ line god module** — `scripts/hooks/json-helper.cjs:1-1700+`
**Confidence**: 85%

- Problem: `json-helper.cjs` has grown to >1700 lines covering JSON manipulation, learning-log accounting, knowledge-file appending, lock management, manifest reconciliation, atomic file writes, and now (with this PR's `sliceKnowledgeSection` and `emptyReconcileResult` extraction) more shared knowledge-file utilities. The new `knowledge-context.cjs` was the right move — pulling knowledge concerns out into their own module. But `json-helper.cjs` still owns `knowledge-append`, the manifest reconciler, and `sliceKnowledgeSection` — all of which are knowledge-domain operations co-located with unrelated JSON utilities.
- Impact: Pre-existing god-module pattern. This PR does not worsen it materially, but the new `knowledge-context.cjs` creates an opportunity for follow-up extraction (`knowledge-append`, `reconcile-manifest`, `render-ready` could all migrate into `knowledge-context.cjs` or a sibling `knowledge-mutate.cjs`). Not blocking — the module works and is well-tested — but the next PR that touches knowledge concerns should extract.
- Fix: Track as tech debt: "Extract knowledge mutation operations from `json-helper.cjs` into a `lib/knowledge-mutate.cjs` sibling of `lib/knowledge-context.cjs`." Outside the scope of v2 ship-blockers.

## Suggestions (Lower Confidence)

- **`KnowledgeFilePair` type alias hides a primitive obsession** - `src/cli/utils/legacy-knowledge-purge.ts:42` (Confidence: 70%) — `readonly [string, 'ADR' | 'PF']` would be clearer as `{ filePath: string; prefix: 'ADR' | 'PF' }`. Tuples with semantic positions are a known readability anti-pattern; tagged objects make call sites self-documenting.
- **`loadKnowledgeIndex` and `loadKnowledgeContext` share 80% of file-reading boilerplate** - `scripts/hooks/lib/knowledge-context.cjs:156-227, 242-267` (Confidence: 70%) — Both functions resolve paths, try-read both files, swallow errors silently. The duplication is small but invites drift; a shared `readBothKnowledgeFiles(worktreePath, opts)` helper returning `{ adrRaw, pfRaw }` would consolidate it. Not urgent — both functions are simple and well-tested.
- **Migration ID suffix conventions are documented but not enforced** - `src/cli/utils/migrations.ts:135-150` (Confidence: 65%) — The new comment block describes `-vN` and `-vN-{tag}` conventions but nothing validates that migration IDs follow them. A simple regex assertion in a unit test would prevent typo-IDs from being silently re-run on every machine.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 3 | - |
| Should Fix | - | 1 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Architecture Score**: 7/10

The new abstraction (skill + CJS module + orchestrator-side load + agent-side consume) is the right shape. The CJS module is properly decoupled from orchestration concerns — it knows about file paths and section formats but not about which orchestrator is calling it. The skill correctly defines a consumer algorithm without leaking into orchestrator responsibilities. The contract is testable and tested.

The blocking concerns are about consistency of adoption, not the design itself. The PR introduces a clean pattern but leaves three high-traffic surfaces (`/implement`, `/debug`, `pipeline:orch`) on the OLD pattern (or no pattern at all), creating a half-adopted architectural state that will fragment future work. The skill body also contradicts the runtime footer about file paths — a small but real layering inversion. The CLI dispatch heuristic is fragile enough to be a footgun.

The orchestrator-local vs fan-out distinction (debug vs other three) is correctly implemented and tested but lacks the cross-orchestrator design rationale that would let future authors choose correctly.

**Recommendation**: CHANGES_REQUESTED

Address the three HIGH findings before merge:
1. Either complete adoption across `/implement`, `/debug`, `pipeline:orch`, OR document the v2 scope explicitly
2. Remove hardcoded paths from `apply-knowledge/SKILL.md` and defer to the index footer
3. Replace the path-shape heuristic in CLI dispatch with structural detection

The MEDIUM findings (dispatch consolidation, format coupling, fan-out rationale) can be deferred but should be tracked. The Should-Fix designer-duplicate is a build-system question that needs a quick yes/no decision.
