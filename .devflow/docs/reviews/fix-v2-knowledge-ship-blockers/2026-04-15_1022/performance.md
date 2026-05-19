# Performance Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Date**: 2026-04-15 10:22
**Diff**: `git diff bd1c92f...HEAD` (14 commits, +1785 / -395, 36 files)

## Summary of the Change (perf framing)

This PR replaces the prior "fan the entire filtered corpus to every Resolver" model with a two-tier model:

1. **Orchestrator** runs `node scripts/hooks/lib/knowledge-context.cjs index "<worktree>"` once per worktree to produce a compact index (~250-token claim).
2. **Sub-agents** receive only the index and use the new `devflow:apply-knowledge` skill to `Read` the full ADR/PF body on demand.

This is the explicit resolution to **PF-011** ("/resolve fans KNOWLEDGE_CONTEXT to every Resolver without relevance filtering"), now extended to `/plan`, `/self-review`, and `/code-review`. From a performance standpoint the change is a net improvement; the questions are (a) how does the new tool itself perform at 8 invocations per pipeline, and (b) does the on-demand Read pattern accidentally regress into a per-agent N+1.

---

## Empirical Measurements (this corpus)

Measured against the live `.memory/knowledge/` corpus on this branch:

| Metric | Value |
|--------|-------|
| `decisions.md` size | 1,037 bytes (2 ADR entries) |
| `pitfalls.md` size | 11,098 bytes (10 PF entries) |
| Total corpus | 12,135 bytes |
| `index` output size | 1,859 bytes (≈465 tokens at 4 chars/tok) |
| `full` output size | 12,136 bytes (≈3,034 tokens) |
| **Token reduction** | **~6.5×** (corpus → index) |
| Single `index` invocation wall time | 27 ms (cold) |
| 8 sequential invocations wall time | 185 ms total (~23 ms each) |
| Knowledge test suite (66 tests) | 376 ms total; 263 ms in `index-generator.test.ts` (subprocess execSync) |

The doc claim "~250 tokens" understates the current real corpus by ~1.9×. With 12 entries and titles near the 60-char truncation cap, an empty-corpus index would be ~30 tokens; the per-entry cost is roughly 30–35 tokens. Extrapolation: at 50 entries the index would be ~1.7K tokens. At 100 entries it crosses 3K tokens and starts approaching what the "full" corpus is today. See **HIGH #1**.

The "~7.5K full corpus" claim in the same docs is also stale for the current state (real `full` = ~3K tokens). The 7.5K figure was probably pre-purge. Either is an order-of-magnitude correct argument that index < corpus, but the precise numbers need an update — see **MEDIUM #1**.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH

**HIGH #1 — `~250-token` claim in documentation is stale and degrades linearly with entry count** — Confidence: 92%
Locations:
- `scripts/hooks/lib/knowledge-context.cjs:21` (CLI usage block: `index <worktree>  → index format (~250 tokens)`)
- `scripts/hooks/lib/knowledge-context.cjs:147` (JSDoc on `loadKnowledgeIndex`: `~250-token summary`)
- `shared/skills/resolve:orch/SKILL.md:38` (`compact index (~250 tokens)`)

- Problem: Real measured output for the current 12-entry corpus is **~465 tokens**, not 250. The per-entry index cost is ~30 tokens, so the function grows linearly with `len(adrEntries) + len(pfEntries)`. At ~30 entries (the threshold PF-011 itself flagged as the design budget) the index reaches ~900 tokens; at 100 entries it reaches ~3K tokens — at which point the "index < corpus" margin starts to compress, because the corpus also grows linearly and the index keeps a constant per-entry overhead with no body.
- Why this matters for performance: the whole point of the redesign is bounded fan-out cost. A token claim that understates by 1.9× today and degrades linearly will mislead future maintainers when corpora grow. The math still works (index is far cheaper than fanning the full corpus to N agents), but the documented constant is wrong.
- Fix: Change the language to be honest about the scaling. Concrete suggestion:

  ```diff
  - // ~250 tokens summary
  + // Compact summary, ~30 tokens per entry (e.g., 12 entries ≈ 450 tokens).
  + // Scales O(n) with active ADR + PF count.
  ```

  And in `resolve:orch/SKILL.md:38`: `compact index (~30 tokens per entry, currently ~450 tokens for this project)`.

  Optionally: have the index footer print its own size summary so the value is self-documenting (`Index: 12 entries, ~465 tokens`).

**HIGH #2 — `extractIndexEntries` re-runs the same regex split as `filterKnowledgeContext`; CLI invocations call only one of them, but the in-process call sites do not benefit from any sharing** — Confidence: 80%
Location: `scripts/hooks/lib/knowledge-context.cjs:45-102`

- Problem: `filterKnowledgeContext` (line 45) and `extractIndexEntries` (line 69) each independently run `raw.split(/(?=^## (?:ADR|PF)-\d+:)/m)` and the same Deprecated/Superseded regex over the same input. For the in-process tests and any future caller that wants both filtered text *and* the index, this is 2× the regex work. Today nobody calls both for the same content — but `index` and `full` CLI subcommands re-spawn `node` from scratch each time anyway (see HIGH #3), so the duplicated logic is also a maintainability hazard, not just a perf one.
- Impact: At current corpus size this is sub-millisecond and invisible. The risk is regression: a future caller that wants both representations will either call both (paying 2× CPU) or duplicate the split logic again.
- Fix: Extract a single `parseSections(raw)` helper that returns `{ preamble, sections: Array<{ heading, id, title, status, area, body, isDeprecated }> }`. Both higher-level functions consume it. This is the canonical "parse once, project many" refactor and removes the two-regex-pass code smell.

**HIGH #3 — The 8-spawn-per-pipeline pattern fork-execs `node` 8 times, costing ~160 ms of pure interpreter startup** — Confidence: 88%
Locations: 8 call sites across `plugins/devflow-{plan,resolve,self-review,code-review}/commands/*.md` and `shared/skills/{plan,resolve,review,debug}:orch/SKILL.md`

- Problem: Each invocation pays the full Node.js cold-start cost. Measured at ~23 ms per call, ~185 ms for 8 sequential calls. The actual file I/O + regex work is sub-millisecond; ~95% of the time is interpreter boot and module load.
- Impact: Modest in absolute terms (~0.2 s wall time per pipeline) and dwarfed by the LLM token costs the redesign saves. But this is the kind of "death by a thousand cuts" overhead that PF-006 ("Per-line jq spawning in session-start hooks adds latency") explicitly warns against. The pattern is identical: a tiny CLI invoked many times per pipeline.
- Suggested mitigations (any one is sufficient):
  - **Cache per pipeline.** The orchestrator surfaces could call `index` once and pass `KNOWLEDGE_CONTEXT` through the pipeline rather than each phase recomputing it. This is the cleanest fix and matches how `KNOWLEDGE_CONTEXT` is already passed *between agents* — just lift the dedup one level higher to *between phases*.
  - **Filesystem-level cache.** Write the index to `.memory/.knowledge-index.cache` and use it when both `decisions.md` and `pitfalls.md` mtimes are older than the cache. Reuse the existing `scripts/hooks/get-mtime` helper.
  - **Accept it.** ~200 ms per pipeline is below the threshold worth optimizing if the orchestrator structure change is expensive. But document the choice.
- Note: The 8 invocations are mostly across *different* pipelines (plan, review, resolve, etc.), only some of which run in any single session. The "8 per session" framing in the prompt is upper-bound; typical sessions invoke 1–2 commands and pay 1–2 spawn costs.

### MEDIUM

**MEDIUM #1 — `~7.5K full corpus` claim in CHANGELOG/docs no longer reflects post-purge corpus** — Confidence: 85%
Locations: implied throughout `docs/self-learning.md` and `CHANGELOG.md` token-reduction narrative

- Problem: Real measured `full` output is ~3K tokens, not 7.5K. The 7.5K figure likely predates the v2/v3 legacy purge (which removed 4 ADR/PF IDs and orphan content). The qualitative argument (index << corpus × N agents) still holds, but quoting a 30× ratio when the real ratio is closer to 6.5× is inaccurate.
- Fix: Update the marketing/changelog numbers, or rephrase to "≥6× reduction at current corpus, scales with corpus growth."

**MEDIUM #2 — Synchronous `fs.readFileSync` is the right call here, not a concern** — Confidence: 95% (this is *not* an issue — explicit verdict)
Location: `scripts/hooks/lib/knowledge-context.cjs:173, 181, 256`

- Verdict: `readFileSync` is correct for this script. The CLI is a one-shot, exits immediately, has no event loop to block, and reads two ~10 KB files. Async would add Promise overhead with zero throughput benefit. The Engineering Principles ban on sync I/O applies to *request-path code* and *long-lived processes*, not to standalone CLI tools. Flagging this as a concern would be a false positive; explicitly noting it here so future reviewers don't try to "fix" it.

### LOW

**LOW #1 — Per-entry `knownStatuses` array is rebuilt on every call to `formatAdrLine` / `formatPfLine`** — Confidence: 78%
Location: `scripts/hooks/lib/knowledge-context.cjs:124, 137`

- Problem: `const knownStatuses = ['Active', 'Deprecated', 'Superseded'];` is a function-local literal allocated on each call. For 12 entries this is 12 throwaway 3-element arrays. Hoisting to module scope is cleaner.
- Impact: Imperceptible. Modern V8 likely escape-analyzes this away. Mention only because it's a trivial code-quality cleanup.
- Fix: Hoist to module-level `const KNOWN_STATUSES = Object.freeze(['Active', 'Deprecated', 'Superseded'])`.

---

## Issues in Code You Touched (Should Fix)

None — the touched files are net improvements over the prior state.

---

## Pre-existing Issues (Not Blocking)

**PF-011 verification — the redesign's resolution is real, not regressed** — Confidence: 95%
- Verified: `KNOWLEDGE_CONTEXT` passed to sub-agents is the index (~465 tokens) not the full corpus (~3K tokens). With 7–11 reviewers in `/code-review`, the savings is `(3034 − 465) × ~9 = ~23 K tokens` per review pipeline. Pre-existing N+1 fan-out pattern is closed.
- The on-demand Read pattern is bounded by relevance: each sub-agent that decides to read the full file does one Read of `decisions.md` (1 KB) or `pitfalls.md` (11 KB), not a Read per entry. This is *not* an N+1 — it's at most N×(1 file Read), where N is the number of agents that find a relevant entry, which is typically 0–2 per agent.
- **However**, observation: if every one of 10 agents in a pipeline decides to Read pitfalls.md fully (the worst case), the agent-side context cost is `10 × 11 KB ≈ 110 KB` of agent context. That's roughly the same as fanning the corpus directly. The redesign assumes *relevance filtering* by the agent — an assumption that holds only if the `apply-knowledge` skill is followed. The skill's "Skip Guard" and Step 2 ("Identify plausibly-relevant") are the load-bearing instructions. If agents over-Read defensively, the savings collapse. Worth a follow-up observability metric (e.g., count agent-side `Read .memory/knowledge/*.md` invocations per pipeline).

---

## Test Suite Performance

**Knowledge test suite (66 tests, 3 files) runs in 376 ms total — non-issue.** Confidence: 92%

Breakdown:
- `apply-knowledge-skill.test.ts` (13 tests, file-content checks): 4 ms
- `command-adoption.test.ts` (29 tests, file-content checks): 5 ms
- `index-generator.test.ts` (24 tests, including 6 subprocess `execSync` tests): 263 ms

The 263 ms in `index-generator.test.ts` is dominated by 6 `execSync` calls, each spawning a fresh Node process (~25 ms × 6 ≈ 150 ms). This is acceptable: subprocess testing of the CLI dispatch is the only honest way to verify the `process.exit(1)` and stderr observability behaviors. In-process tests of the exported functions would not exercise the dispatch code.

If the test suite ever needs to shrink: collapse the 6 subprocess tests into 1 parameterized test that handles all dispatch modes in a single subprocess (pipe a JSON command to stdin instead of new processes). Not worth doing today.

---

## Suggestions (Lower Confidence)

- **Suggestion 1** — `scripts/hooks/lib/knowledge-context.cjs:344-346` (Confidence: 70%) — The observability log re-runs two regex matches (`(result.match(/^\s+ADR-\d+/gm) || []).length`) over the just-formatted output to count entries, instead of returning the count from `loadKnowledgeIndex`. Have `loadKnowledgeIndex` return `{ text, adrCount, pfCount }` or expose a `loadKnowledgeIndexWithCounts` variant. Negligible perf, but eliminates a redundant scan and a second source of truth for entry counts.
- **Suggestion 2** — `scripts/hooks/lib/knowledge-context.cjs:314` (Confidence: 65%) — The bare-mode detection heuristic (`firstArg.startsWith('/') || firstArg.startsWith('.') || firstArg.startsWith('~') || firstArg.includes('/')`) is fragile — a future subcommand named `init` or `clear` could collide. Tighter alternative: explicit `--bare` flag, or just remove the bare mode now that the deprecation notice is in place.
- **Suggestion 3** — Consider exposing `loadKnowledgeIndex` over a JSON-RPC-style stdin pipe so a single long-lived helper process can serve all 8 pipeline calls. Pure speculation, low ROI at current invocation rate. Mentioned only because the pattern matches PF-006's "spawn-per-call" warning.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 1 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 (PF-011 follow-up) | 0 |

**Performance Score**: 8 / 10
- The architectural change resolves PF-011 cleanly and is a measurable improvement.
- Documentation overstates the win (~250 tokens vs measured ~465; 7.5K corpus vs measured 3K) — this is a documentation accuracy issue, not a perf bug.
- 8 spawn-per-pipeline pattern is a small but real recurrence of PF-006 territory; mitigation is optional.
- Code itself is clean, fast, and adequately tested.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions for merge:
1. Update `~250 tokens` references in `knowledge-context.cjs` JSDoc/comments and `resolve:orch/SKILL.md` to reflect O(n) scaling and a per-entry cost (HIGH #1). This is doc-only and trivial.
2. (Optional but recommended) Update the `~7.5K full corpus` figure in changelog/docs to match measured reality (MEDIUM #1).

The HIGH #2 (regex deduplication) and HIGH #3 (spawn caching) items are improvements worth a follow-up but should not block this PR.

**Cited prior knowledge**:
- `applies PF-011` — this PR implements the resolution documented in PF-011.
- `avoids PF-006` partially — the spawn-per-call pattern is present but at much lower rate than the per-line jq case PF-006 originally addressed.
