# Documentation Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Diff**: `git diff bd1c92f...HEAD`
**Date**: 2026-04-15 10:22

## Issues in Your Changes (BLOCKING)

### CRITICAL

**CHANGELOG `[Unreleased] ### Added` entry contradicts `### Changed` entry — describes superseded behavior as a feature** — `CHANGELOG.md:14`
**Confidence**: 95%
- Problem: The `[Unreleased] ### Added` block contains:
  > **`/resolve` project knowledge integration**: orchestrator reads `.memory/knowledge/decisions.md` + `pitfalls.md` per worktree (filtering Deprecated/Superseded sections) and **passes filtered content as `KNOWLEDGE_CONTEXT` to each parallel Resolver**. Resolvers cite matching ADR-NNN/PF-NNN IDs inline...
  This describes the **old** "fan out full filtered corpus" behavior. The very next section, `### Changed`, then states:
  > **Knowledge index + on-demand Read pattern across all four knowledge-consuming commands**: ... now fan a **compact ~250-token index** instead of the full ADR/PF corpus. ... Closes PF-011...
  Both entries cannot describe current reality. The "Added" entry was relocated from `2.0.0 ### Added` (per the diff in the surrounding context) without updating the wording, so it now misrepresents how `/resolve` actually works.
- Impact: Anyone reading the changelog to learn what landed in this release sees mutually contradictory descriptions of `/resolve` and may believe the orchestrator still passes filtered content (it does not — it now passes a 250-token index per `scripts/hooks/lib/knowledge-context.cjs:156-227`). Also misrepresents that PF-011 was the original behavior rather than the regression that this PR fixes.
- Fix: Rewrite the `[Unreleased] ### Added` `/resolve` entry to describe the resolve-time integration in **index-pattern terms**, OR fold it into the new `### Changed` entry on line 17 (which already covers `/resolve` correctly). Suggested rewrite if kept under `### Added`:
  ```markdown
  - **`/resolve` project knowledge integration**: orchestrator loads a compact knowledge index per worktree via `knowledge-context.cjs index` (Deprecated/Superseded entries pre-filtered) and passes it as `KNOWLEDGE_CONTEXT` to each Resolver. Resolvers follow `devflow:apply-knowledge` to Read full ADR/PF bodies on demand and cite matching IDs verbatim in Reasoning columns. Phase 5 extracts citations; Phase 8 aggregates them into a `## Knowledge Citations` bullet list at the top of `resolution-summary.md`.
  ```

### HIGH

**Stale "fan out full corpus" pattern in `/debug` and `/debug-teams` not updated to use index** — `plugins/devflow-debug/commands/debug.md:36`, `plugins/devflow-debug/commands/debug-teams.md:28`
**Confidence**: 90%
- Problem: Both files still instruct:
  > Read `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`. Known pitfalls from prior debugging sessions and code reviews can directly inform hypothesis generation — **pass their content as context to investigators in Phase 2.**
  This is the exact "fan-out full corpus" pattern that PF-011 documents and that this PR claims to eliminate. The PR's CHANGELOG `### Changed` entry (line 17) explicitly lists `/debug:orch` as having been moved to the index pattern, but the slash-command surfaces (`/debug` and `/debug-teams`) for `devflow-debug` were missed. Note the asymmetry: `shared/skills/debug:orch/SKILL.md` now uses the new pattern (Phase 0: `KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index ".")` and explicitly says "**Do NOT pass `KNOWLEDGE_CONTEXT` to Explore sub-agents**"), while the explicit slash-command variants still tell the orchestrator to pass full content to investigators.
- Impact: Documentation drift between the four surfaces (`debug.md`, `debug-teams.md`, `debug:orch/SKILL.md`, CLAUDE.md roster line). Users running `/debug` will get behavior that contradicts both `debug:orch` and the CHANGELOG. PF-011 is documented as "closed" in the CHANGELOG but is still present in two surfaces.
- Fix: Either (a) update `debug.md` and `debug-teams.md` Phase 1 to use the index pattern matching `debug:orch/SKILL.md` Phase 0, OR (b) explicitly scope this PR's claim. The CHANGELOG line 17 says "Closes PF-011 and fills pre-existing ambient gaps for plan:orch, review:orch, and debug:orch" — note that this scope is `:orch` skills only, not the slash-commands. If `/debug` and `/debug-teams` are intentionally out of scope, add a one-line note in CHANGELOG: `(Note: /debug and /debug-teams slash-commands still load knowledge inline — to be migrated in a follow-up.)` Otherwise, update both files.

**`docs/self-learning.md` "Commands using this pattern" table is incomplete and misleading for `debug:orch`** — `docs/self-learning.md:138-144`
**Confidence**: 85%
- Problem: The table at `docs/self-learning.md:138-144` lists:
  | `debug:orch` | Orchestrator-local (not fanned to Explore) |

  But it omits the slash-command variants `/debug` and `/debug-teams`, even though every other intent in the table includes both the `/foo` and `foo:orch` forms. Combined with the previous finding (those two surfaces still use the old pattern), the table effectively claims the entire debug area is on the index pattern when in fact only the orch skill is.
- Impact: Reinforces the misleading impression that `/debug` uses the index pattern. Readers using this table to audit which surfaces consume knowledge will miss the two non-orch debug files.
- Fix: Either (a) add a `/debug, /debug-teams` row noting they still inline-Read the corpus and reference an open follow-up, OR (b) qualify the existing row: `| `debug:orch` only (not `/debug` or `/debug-teams`) | Orchestrator-local ...|`.

### MEDIUM

**Skill description doesn't mention the 5-step algorithm it encodes** — `shared/skills/apply-knowledge/SKILL.md:3`
**Confidence**: 85%
- Problem: The frontmatter description is:
  > "Canonical algorithm for consuming KNOWLEDGE_CONTEXT index — scan index, identify relevant entries, Read full bodies on demand, cite verbatim IDs inline."
  This enumerates 4 of the 5 steps. Step 5 ("Use verbatim IDs only", which is also the Iron Law) is folded into "cite verbatim IDs inline", but Step 2 ("Identify plausibly-relevant entries") and Step 4 ("Cite inline") use slightly different wording than the section headers. The bigger gap: the Iron Law (`VERBATIM IDs ONLY — NEVER FABRICATE`) is the most distinctive contract of the skill but isn't reflected in the description, so the description doesn't tell consumers why this skill exists rather than how it works.
- Impact: Description quality affects skill discovery via `Skill` tool and routing. Consumers reading only the description won't know that the skill's primary value is hallucination-prevention via the verbatim-ID rule.
- Fix: Suggested rewrite:
  ```yaml
  description: When consuming KNOWLEDGE_CONTEXT index — scan index, identify relevant entries, Read full ADR/PF bodies on demand, cite only verbatim IDs (never fabricate). Used by Resolver/Reviewer/Designer/Simplifier/Scrutinizer agents.
  ```

**Worked example in `apply-knowledge/SKILL.md` shows `[Active]` status, but real corpus emits `[unknown]`** — `shared/skills/apply-knowledge/SKILL.md:33-34, 76`
**Confidence**: 85%
- Problem: The example index format shows:
  ```
  PF-004  Background hook god scripts  [Active]  —  scripts/hooks/foo.cjs
  ```
  Running `node scripts/hooks/lib/knowledge-context.cjs index "."` against the actual current corpus emits:
  ```
  PF-004  Background hook scripts become untestable god scripts  [unknown]  —  scripts/hooks/background-learning (560 lines)
  ```
  The status appears as `[unknown]` because pre-v2 seeded entries don't have a `- **Status**: Active` field — only newly-rendered self-learning entries get one (`scripts/hooks/json-helper.cjs:1377, 1770`). In a fresh corpus the example would be accurate, but for the current repo it is not.
- Impact: First-time readers diffing the worked example against `node scripts/hooks/lib/knowledge-context.cjs index .` output will see a mismatch and may believe the example is stale or the script is broken. Also, the truncated title in the worked example ("Background hook god scripts") is shorter than the actual truncation rule (60 chars) would produce ("Background hook scripts become untestable god scripts" is only 55 chars, fits without truncation).
- Fix: Two options: (a) Reword the example to acknowledge two states: "When entries lack a Status field (pre-v2 seeded entries), the tag shows `[unknown]`. New self-learning entries always include `- **Status**: Active` and display `[Active]`." Or (b) use a different worked example based on a real entry with accurate field values, e.g.:
  ```
  PF-004  Background hook scripts become untestable god scripts  [unknown]  —  scripts/hooks/background-learning (560 lines)
  ```

**`docs/self-learning.md` Step 1 example uses bare `Decisions (2):` count that may not match current state** — `docs/self-learning.md:113-125`
**Confidence**: 80%
- Problem: The example output shows:
  ```
  Decisions (2):
    ADR-001  Use Result types instead of thrown errors  [Active]
    ...

  Pitfalls (3):
    PF-004  Background hook god scripts  [Active] — scripts/hooks/
    ...
  ```
  Same issues as above:
  - `[Active]` doesn't match current corpus output (it shows `[unknown]`)
  - Pitfall count `(3)` is fictitious (corpus has 10)
  - The dash separator in the doc example is `— ` (em-dash + space), but the actual code emits `  —  ` (two spaces + em-dash + two spaces) per `formatPfLine` (`scripts/hooks/lib/knowledge-context.cjs:140`)
  - Title `Background hook god scripts` doesn't match real PF-004 title
- Impact: Readers comparing the docs example to actual `knowledge-context.cjs index` output will see formatting inconsistencies. None of these affect correctness of the algorithm description, but they erode trust in the docs.
- Fix: Either label the example explicitly as "illustrative" OR regenerate from real output. Recommend explicit labeling: prefix the code block with `*Example output (illustrative — actual counts and titles vary):*`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`CLAUDE.md` `/code-review` roster description doesn't note knowledge-loading phase happens at orchestrator vs reviewer** — `CLAUDE.md:147`
**Confidence**: 80%
- Problem: The updated line reads:
  > `/code-review` — 7-11 Reviewer agents + Git + Synthesizer; consumes knowledge via index + on-demand Read via `devflow:apply-knowledge`
  This is accurate but ambiguous about *who* loads the index. The corresponding `review:orch/SKILL.md` change (line 40) is explicit: "Phase 2b: Load Knowledge Index" runs at orchestrator, then "Pass `KNOWLEDGE_CONTEXT` to all Reviewer agents." A reader of CLAUDE.md alone might think each Reviewer loads its own index (which would be wasteful — the point of the index pattern is one orchestrator-side load).
- Impact: Low-risk misunderstanding. CLAUDE.md is for AI agents and contributors who will likely also Read the orch skills, but the roster line is the canonical short-form description.
- Fix: Suggested clarification:
  > `/code-review` — 7-11 Reviewer agents + Git + Synthesizer; orchestrator loads compact knowledge index, Reviewers Read full bodies on demand via `devflow:apply-knowledge`

**`docs/self-learning.md` Step 1 code block missing language tag is fine, but the example output filename in the footer shows `{worktree}/.memory/...` while the real script emits absolute paths** — `docs/self-learning.md:122-123`
**Confidence**: 80%
- Problem: Doc example footer:
  ```
  ADR-NNN entries live in {worktree}/.memory/knowledge/decisions.md
  PF-NNN  entries live in {worktree}/.memory/knowledge/pitfalls.md
  ```
  Actual output (verified via `node scripts/hooks/lib/knowledge-context.cjs index "."`):
  ```
  ADR-NNN entries live in /Users/dean/Sandbox/devflow/.memory/knowledge/decisions.md
  PF-NNN  entries live in /Users/dean/Sandbox/devflow/.memory/knowledge/pitfalls.md
  ```
  The script emits absolute paths (per `scripts/hooks/lib/knowledge-context.cjs:212, 217`), not the templated `{worktree}/...` form.
- Impact: Minor. Readers expecting `{worktree}` substitution syntax in real output will be confused.
- Fix: Either replace `{worktree}` with `<absolute path to worktree>` or explicitly note "the actual path is the absolute filesystem path of the worktree".

## Pre-existing Issues (Not Blocking)

None worth flagging — pre-existing knowledge documentation surfaces (README.md `.memory/knowledge/` references, `shared/skills/knowledge-persistence/SKILL.md`) describe stable, accurate behavior at a higher level of abstraction and aren't affected by the index-pattern change.

## Suggestions (Lower Confidence)

- **`apply-knowledge/SKILL.md` doesn't mention what to do when the index is *truncated***  — `shared/skills/apply-knowledge/SKILL.md:48` (Confidence: 70%) — Step 2 says "Titles are truncated to 60 characters — if a truncated title looks relevant, proceed to Step 3." But it doesn't tell agents what to do if the index *itself* is too long for context (the doc claims ~250 tokens, but a corpus with 50+ entries could exceed this). No size cap is documented.
- **CHANGELOG entry token-savings claim "~75K/run at 10 resolvers" is unsourced** — `CHANGELOG.md:17` (Confidence: 65%) — The claim is plausible but not backed by a benchmark in the diff. If accurate, consider adding a footnote pointing to the benchmark or test that produced it (or soften to "approx."). With current corpus of 12 entries, full-corpus-per-resolver would be 12×N×~600 tokens ≈ 72K at N=10, which roughly checks out, but the docs don't explain the math.
- **`apply-knowledge/SKILL.md` Citation Format Reference table missing case for "found in index but doesn't apply to my task"** — `shared/skills/apply-knowledge/SKILL.md:90-97` (Confidence: 60%) — The table covers "Entry not in index" and "Entry in index but not read yet" but not "Entry in index, Read, and confirmed not applicable." For consistency, add a row.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 2 | 3 | 0 |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Documentation Score**: 6.5/10
**Recommendation**: CHANGES_REQUESTED

The skill itself (`apply-knowledge/SKILL.md`) is well-structured, with a clear Iron Law, 5-step algorithm, worked example, skip guard, and citation reference. The orchestration surfaces (`resolve.md`, `resolve-teams.md`, `resolve:orch`, `plan:orch`, `review:orch`, `self-review.md`, shared agent files) are consistently updated to the index pattern. CLAUDE.md and `docs/self-learning.md` document the pattern accurately at the structural level.

However, two material accuracy problems block merge:

1. **CHANGELOG self-contradiction** (`### Added` line 14 vs `### Changed` line 17 of `[Unreleased]`): one of these descriptions is factually wrong, and the wrong one is presented as a new feature. This is the kind of changelog drift that misleads downstream consumers.

2. **`/debug` and `/debug-teams` left on the old pattern** while the CHANGELOG and `debug:orch` claim PF-011 is closed. Either fix the surfaces or scope the claim explicitly.

The medium-severity worked-example/output-format mismatches (status display `[Active]` vs `[unknown]`, fictitious counts, path templating) are individually minor but cluster into a "docs don't match implementation" pattern that is inconsistent with the project's brutal-honesty principle.
