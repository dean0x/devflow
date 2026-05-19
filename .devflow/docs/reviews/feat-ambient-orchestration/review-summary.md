# Review Summary: feat/ambient-orchestration

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**Commits**: 595cd05, 15849ce
**Files Changed**: 18 (+497, -141)
**Reviews Synthesized**: 7 (Security, Architecture, Performance, Complexity, Consistency, Regression, Tests)

---

## Merge Recommendation: CHANGES_REQUESTED

Three blocking issues must be resolved before merge. The remaining should-fix items can be addressed in this PR or a fast-follow, at the author's discretion.

---

## Score Summary

| Dimension | Score | Recommendation |
|-----------|-------|----------------|
| Security | 8/10 | APPROVED_WITH_CONDITIONS |
| Architecture | 6/10 | CHANGES_REQUESTED |
| Performance | 7/10 | CHANGES_REQUESTED |
| Complexity | 7/10 | APPROVED_WITH_CONDITIONS |
| Consistency | 6/10 | CHANGES_REQUESTED |
| Regression | 6/10 | CHANGES_REQUESTED |
| Tests | 5/10 | CHANGES_REQUESTED |
| **Aggregate** | **6.4/10** | **CHANGES_REQUESTED** |

---

## Blocking Issues

These must be resolved before merge. Deduplicated across all 7 reviews.

### B1: `test-driven-development` dropped from GUIDED/IMPLEMENT skill selection matrix
**Severity**: HIGH | **Sources**: Consistency H1/H2, Regression H1

The `test-driven-development` skill was a primary skill for BUILD (now IMPLEMENT) at GUIDED depth on main. The new GUIDED-depth skill matrix in the ambient-router lists only `implementation-patterns, search-first` for IMPLEMENT -- TDD is absent. Meanwhile, Step 4 still contains a dead conditional ("If test-driven-development is selected..."), the README still advertises TDD enforcement at GUIDED+ORCHESTRATED, and the skill-catalog.md removed TDD entirely. This creates a broken contract: three documents say TDD is enforced, the router never loads it.

GUIDED is the most common ambient tier for implementation tasks. Losing TDD enforcement here is a silent quality regression for the primary use case.

**Fix**: Add `test-driven-development` to the GUIDED IMPLEMENT primary skills in `shared/skills/ambient-router/SKILL.md` Step 3. Add a corresponding row to `shared/skills/ambient-router/references/skill-catalog.md`.

### B2: Hook preamble bloat contradicts "QUICK = zero overhead" promise
**Severity**: HIGH | **Sources**: Performance H1, Complexity S1, Architecture S2

The `PREAMBLE` injected via the `UserPromptSubmit` hook grew from ~4 lines / ~40 words to ~18 lines / ~150 words. This preamble hits **every qualifying user prompt** -- including the majority that classify as QUICK. The preamble contains full scope-based criteria, GUIDED instructions, ORCHESTRATED instructions, and conservatism rules -- all duplicating content already present in the `ambient-router` SKILL.md loaded in session context. Over a 50-prompt session, this burns ~7,500 input tokens on preamble alone.

**Fix**: Trim the preamble to a minimal trigger (~25 words) that references the ambient-router skill already in context. Move full classification logic to the router skill where it belongs. The hook should provide the enum values and a one-line conservatism reminder, nothing more.

### B3: IMPLEMENT pipeline has no agent budget cap (asymmetry with DEBUG)
**Severity**: HIGH | **Sources**: Performance H2, Security M3 (partial)

The `debug-orchestration` skill correctly defines an 8-agent hard cap. The `implementation-orchestration` skill has no equivalent budget. Worst-case with retries: up to 12 agent invocations for a single ambient prompt (Coder + Validator retries + Coder fixes + Simplifier + Scrutinizer + re-Validate + Shepherd retries). A single ORCHESTRATED/IMPLEMENT prompt can consume 300K-600K tokens and take 5-15 minutes.

**Fix**: Add an explicit agent budget section to `implementation-orchestration/SKILL.md` with a hard cap (e.g., 8 total agent spawns) and per-phase allocation table, matching the pattern established in `debug-orchestration`.

---

## Should-Fix Issues

Recommended for this PR or a fast-follow. Not blocking merge if the three blocking issues above are resolved.

### SF1: Pipeline duplication between orchestration skills and explicit commands (DRY violation)
**Sources**: Architecture H1

`implementation-orchestration` and `debug-orchestration` substantially overlap with `/implement` and `/debug` command pipelines respectively. Two sources of truth for the same conceptual workflow will drift over time.

**Fix**: Document the delta explicitly at the top of each orchestration skill (what is included, what is excluded, why) so the relationship is clear. Optionally extract shared quality gate steps into a common reference.

### SF2: Missing Explore agent in ambient plugin manifest
**Sources**: Architecture H2, Consistency M2, Regression (LOW)

The `devflow-ambient` plugin.json omits the Explore agent, yet `debug-orchestration` and `plan-orchestration` both spawn Explore agents. While Claude Code spawns these as ephemeral Task sub-agents (functional without a declaration), the architectural contract is unclear.

**Fix**: Either add a lightweight `shared/agents/explore.md` and include `explore` in the ambient plugin manifest, or add a note in each orchestration skill clarifying "Explore agent" means an ephemeral Task sub-agent.

### SF3: No explicit test for ambient plugin's new agents and orchestration skills
**Sources**: Tests H1

The PR's headline structural change (7 agents + 3 orchestration skills added to devflow-ambient) has no targeted test. Existing build tests provide only implicit coverage via filesystem scanning.

**Fix**: Add an explicit test in `tests/plugins.test.ts` asserting the ambient plugin declares the expected agents and orchestration skills.

### SF4: DEBUG integration test can pass with zero assertions
**Sources**: Tests H2

The DEBUG classification test wraps all assertions inside `if (hasClassification(output))` with no fallback. If the LLM does not emit a classification marker, the test passes vacuously.

**Fix**: Add a fallback assertion (e.g., `expect(output.length).toBeGreaterThan(20)`) to ensure the test always verifies something.

### SF5: Classification tables duplicated across 4 files
**Sources**: Complexity M1, Complexity M3

Intent-to-depth classification logic and skill-selection matrices are repeated with slight variations in `ambient-router/SKILL.md`, `ambient.md`, `README.md`, and `ambient-prompt`. The ambient-router is authoritative -- other files should reference it, not duplicate its tables.

**Fix**: Replace duplicated tables in `ambient.md` Phase 4 and the hook preamble with directives referencing the router as the single source of truth.

### SF6: Cross-skill coupling -- debug-orchestration dynamically loads implementation-orchestration
**Sources**: Architecture M1

`debug-orchestration` Phase 5 instructs the agent to load `implementation-orchestration` at runtime. This creates an implicit peer dependency not declared in any manifest.

**Fix**: Either inline the fix pipeline in debug-orchestration or document the dependency explicitly.

### SF7: Stale descriptions in marketplace.json and init.ts
**Sources**: Regression M1, Regression M2

`marketplace.json` still reads "auto-loads relevant skills for every prompt" and `init.ts` `--ambient` flag description is similarly stale. Both miss the "agent orchestration" capability.

**Fix**: Update both to match the `plugins.ts`/`plugin.json` description.

### SF8: EXPLORE intent downgraded from split QUICK/GUIDED to always QUICK (undocumented)
**Sources**: Regression SF1

Analytical exploration prompts ("analyze our authentication pattern") previously triggered GUIDED with skill loading. Now all EXPLORE is QUICK. This behavioral change is not documented in the CHANGELOG.

**Fix**: Either restore analytical EXPLORE/GUIDED or add a CHANGELOG entry documenting the intentional simplification.

### SF9: Bash usage scope not documented in orchestration skills
**Sources**: Security H1

All three orchestration skills declare `Bash` in `allowed-tools` without documenting expected shell operations. The blast radius of ORCHESTRATED (active agent execution with Bash) is significantly wider than the previous ELEVATE tier (passive recommendation).

**Fix**: Add a "Bash Usage Scope" section to each orchestration skill listing expected operations (git commands, build validation).

### SF10: Test assertion relaxation weakens scope-based split validation
**Sources**: Architecture M3, Tests S4

The "add a login form" test changed from asserting `GUIDED` to accepting either `GUIDED` or `ORCHESTRATED`. This weakens validation of the scope-based split -- the core architectural contribution of the PR.

**Fix**: Restore the strict `GUIDED` assertion for small-scope prompts. Add a separate test for ORCHESTRATED classification using a large-scope prompt.

---

## Informational

These are noted for awareness. No action required for merge.

| ID | Finding | Sources |
|----|---------|---------|
| I1 | `ambient-router` SKILL.md is at 141 lines with 7 tables -- at the density warning threshold; consider progressive disclosure of ORCHESTRATED tables to `references/` | Complexity M2 |
| I2 | Classification is LLM-determined with no programmatic enforcement; user is operator, prompt injection against own CLI is a foot-gun, not an attack | Security M2 |
| I3 | Debug agent budget is advisory (markdown instruction), not programmatically enforced | Security L1 |
| I4 | `HOME` fallback uses literal tilde (`~`) which `path.join` does not expand; use `os.homedir()` | Security SF2 |
| I5 | `settings.json` written via `fs.writeFile` (not atomic); corruption risk on crash | Security PE1, PE2 |
| I6 | No formal Explore or Plan agent definitions despite usage across 4+ commands | Architecture P2, Consistency M2 |
| I7 | `Task` tool in `allowed-tools` has no precedent across 32 existing skills; document or remove | Consistency M1 |
| I8 | Agent frontmatter skill references have no validation test (typo = silent failure) | Tests S3 |
| I9 | Integration tests are `skipIf(!isClaudeAvailable())` -- documentation, not CI regression guards | Tests P4 |
| I10 | CONTRIBUTING.md skill count stale (says 26, actual is 35) | Regression PE |
| I11 | Coder agent skills grew to 8 without documented budget or body text update | Architecture S1, Consistency S1 |
| I12 | `performance-patterns` explicitly excluded from ambient (was implicitly excluded) -- no behavioral change | Regression LOW |
| I13 | "Update the README" reclassified from BUILD/GUIDED to QUICK -- undocumented but reasonable | Regression SF2 |
| I14 | No dedicated test for ORCHESTRATED depth path (the headline feature) | Tests S2 |
| I15 | Test helper duplicates classification regex three times | Tests S1 |

---

## Cross-Cutting Themes

### 1. TDD enforcement gap (B1)
The most impactful finding. It appears across Consistency and Regression reviews as a HIGH issue. The `test-driven-development` skill was the signature quality behavior of ambient BUILD/GUIDED mode. Its silent removal from the router's selection matrix -- while three other documents still reference it -- creates a broken contract that degrades quality for the most common ambient usage path.

### 2. Preamble bloat vs. zero-overhead promise (B2)
Appears across Performance, Complexity, and Architecture reviews. The hook preamble duplicates classification logic already in the ambient-router skill. This is both a performance issue (tokens wasted per prompt) and a complexity issue (classification rules stated in 4 places that must stay synchronized). Trimming the preamble to a minimal trigger resolves both.

### 3. Missing agent budget symmetry (B3)
The debug pipeline has a budget cap; the implementation pipeline does not. This asymmetry was noted in Performance and Security reviews. The fix is straightforward: mirror the debug-orchestration budget pattern.

### 4. DRY violations in the markdown architecture
Multiple reviews (Architecture, Complexity, Consistency, Regression) note that classification rules, skill-selection matrices, and pipeline definitions are duplicated across files. The ambient-router should be the single source of truth, with other files referencing it.

### 5. Unclear agent contracts (Explore, Plan)
Architecture, Consistency, and Tests reviews all note that "Explore agent" and "Plan agent" are referenced informally without formal definitions or documented invocation patterns. This creates contributor confusion across 4+ commands that use these agents.

---

## What Was Done Well

1. **Thorough taxonomy migration**: The BUILD-to-IMPLEMENT and ELEVATE-to-ORCHESTRATED renames are applied completely across all 18 files. No stale references remain in active code.

2. **Conservative classification defaults**: The design explicitly prefers QUICK over GUIDED and GUIDED over ORCHESTRATED. The Iron Laws in each orchestration skill reinforce correctness over speed. This is the right philosophy for an ambient system.

3. **Debug agent budget cap**: The 8-agent hard cap in `debug-orchestration` (added in the second commit) demonstrates proper performance awareness and sets a good pattern for other pipelines to follow.

4. **Clean TypeScript code**: The CLI changes (`ambient.ts`, `plugins.ts`) are minimal and focused. The test helpers were correctly updated to match the new vocabulary.

5. **Shell hook security**: The `ambient-prompt` hook uses `jq --arg` for safe JSON construction, never interpolates user input into commands, and uses `execFileSync` with array arguments in tests. No injection surfaces found.

6. **Phased orchestration design**: The three new orchestration skills follow a consistent internal structure (frontmatter, phases, Iron Law, error handling) within line-count budgets. Each phase is short and self-contained.

7. **Scope-based depth classification**: The GUIDED vs. ORCHESTRATED split criteria (single-module vs. cross-cutting, 1-3 files vs. 4+) are clear, practical, and well-documented in the ambient-router.

8. **AskUserQuestion fallback**: When the debug agent budget is exhausted, the system asks the user to narrow scope rather than silently failing. Good UX pattern.

---

## Action Items (Priority Order)

| Priority | Item | Effort |
|----------|------|--------|
| **MUST** | B1: Restore `test-driven-development` to GUIDED/IMPLEMENT skill matrix + skill-catalog | Small |
| **MUST** | B2: Trim hook preamble to minimal trigger (~25 words) | Small |
| **MUST** | B3: Add agent budget cap to `implementation-orchestration` | Small |
| SHOULD | SF1: Document orchestration skill vs. explicit command delta | Small |
| SHOULD | SF3: Add explicit plugin manifest test for ambient orchestration | Small |
| SHOULD | SF4: Add fallback assertion to DEBUG integration test | Small |
| SHOULD | SF7: Update stale descriptions in marketplace.json and init.ts | Small |
| SHOULD | SF5: Deduplicate classification tables (reference router from other files) | Medium |
| SHOULD | SF10: Restore strict GUIDED assertion for small-scope test | Small |
| SHOULD | SF9: Document Bash usage scope in orchestration skills | Small |
| COULD | SF2: Clarify Explore agent contract (formal definition or documentation) | Medium |
| COULD | SF6: Document or inline debug-to-implementation cross-skill dependency | Small |
| COULD | SF8: Document EXPLORE QUICK-only simplification in CHANGELOG | Small |
