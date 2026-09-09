---
feature: dynamic-workflow-engine
name: Dynamic Workflow Engine
description: "Use when authoring or modifying the dynamic-* commands (dynamic-build, dynamic-plan, dynamic-tickets, dynamic-profile), the shared engine/wave/preamble/factory MDS partials, or the build-mds test suite that pins doctrine literals. Keywords: dynamic-build, dynamic-plan, dynamic-tickets, dynamic-profile, Workflow tool, agentType, Gate 1, Gate 2, review pass, wave, tickets→plan→build, MDS, _engine.mds, _wave.mds."
category: architecture
directories:
  - src/assets/commands/dynamic-build.mds
  - src/assets/commands/dynamic-plan.mds
  - src/assets/commands/dynamic-tickets.mds
  - src/assets/commands/dynamic-profile.mds
  - src/assets/commands/_partials/_engine.mds
  - src/assets/commands/_partials/_wave.mds
  - src/assets/commands/_partials/_preamble.mds
  - src/assets/commands/_partials/_roster.mds
  - src/assets/commands/_partials/_plan_contract.mds
  - src/assets/commands/_partials/_factory.mds
  - src/assets/commands/_partials/_ticket_template.mds
  - dist/commands
  - tests/build-mds.test.ts
created: 2026-07-07
updated: 2026-08-22
---

# Dynamic Workflow Engine

## Overview

The dynamic workflow engine is the `devflow-dynamic` plugin — a pipeline that turns a rough initiative description into fully reviewed, merged code on an integration branch. It operates in three sequential stages, each driven by a Claude Code dynamic Workflow script that the main session authors inline and passes to the `Workflow` tool: **tickets** (decompose an initiative into a wave-structured ticket slate), **plan** (write per-ticket implementation plans with acceptance criteria and a cross-plan conflict audit), and **build** (implement, review, and verify each ticket with a bounded gate structure). `dynamic-profile` is a standalone agent that mines session history to build a decision-preference profile consumed by `dynamic-plan`.

The commands are **authored as MDS sources** in `src/assets/commands/` and compiled to `dist/commands/` at build time. Seven shared MDS partials in `src/assets/commands/_partials/` define the canonical engine doctrine, wave protocol, workflow runtime contract, agent roster, plan–Gate-2 contract, ticket-factory shape, and ticket body template. Each partial exports named blocks that host commands import and inline-expand at compile time — the compiled `.md` files are the deployed artifacts, and the test suite pins exact doctrine literals in the compiled output.

## System Context

The three commands form a delivery pipeline:

```
/devflow:dynamic-tickets  →  [Gate: user reviews ticket slate]
/devflow:dynamic-plan     →  [Gate: user answers DECISIONS-NEEDED.md]
/devflow:dynamic-build    →  [Gate: user reviews wave-report.md and merges to main]
```

A workflow cannot pause mid-run (F4 constraint), so all human-decision surfacing happens at the command boundary — after the workflow returns — never inside the script.

## Component Architecture

### MDS partial hierarchy

```
src/assets/commands/
  dynamic-build.mds         # host: imports all engine + wave partials
  dynamic-plan.mds          # host: imports authoring_preamble + roster + plan_contract
  dynamic-tickets.mds       # host: imports authoring_preamble + roster + factory + ticket_template
  dynamic-profile.mds       # host: standalone agent spawn, imports only authoring_preamble
  _partials/
    _engine.mds             # gate1_postcode, gate2_acceptance, evaluator_panel,
                            # implement_bundle, review_pass, concurrency_doctrine,
                            # build_execution_doctrine, engine_output_schema, engine_invariants
    _wave.mds               # wave_loop, branch_merge_model, merge_doctrine, escalation_model
    _preamble.mds           # authoring_preamble (workflow runtime contract, pre-flight checklist,
                            #   IRON RULE, SAFETY BANNER, budget scaling, DECISIONS_CONTEXT load)
    _roster.mds             # agent_roster, agent_caveats (valid agentType values + tiers)
    _plan_contract.mds      # acceptance_criteria_contract (shared Gate-2 shape)
    _factory.mds            # factory_shape (draft→review→revise→critic→amend→tracking)
    _ticket_template.mds    # ticket_body_template (canonical ticket markdown shape)
```

Partials declare **no** `output-dir:` frontmatter key. Host files declare it as the LAST frontmatter key. The build fails if the `dist/` parent directory does not exist.

### Compiled output and test pinning

`scripts/build-mds.ts` compiles all 13 host files (9 knowledge + 4 dynamic) — `ALL_HOSTS = 13`. **`DIST_FILES` = 14**: the 13 compiled outputs plus `release.md`, which is hand-authored and copied verbatim by the build; the divergence is permanent (SG-13). Compilation-scope guards use `ALL_HOSTS`; deployed-behaviour guards (gh-issue scope, compliance_gate, retired wording) use `DIST_FILES`. The test file `tests/build-mds.test.ts` reads the compiled `dist/commands/dynamic-build.md` and greps for exact doctrine strings. Changing a doctrine literal in a partial immediately breaks the relevant test — by design. The test suite pins:
- `Simplify` and `Scrutinize` each appearing exactly **2 times** (Gate 1 #1 + Gate 1 #2 only)
- **C1 (single-pass review):** presence: `The review pass runs exactly ONCE`, `The pass runs exactly ONCE`, `Never author additional cycles or a delta re-review of fix commits` (invariant #7 unique), `Budget scales roster and verification votes, NEVER the number of passes` (review_pass prose unique); absence: `DELTA REVIEW`, `reviewBaseSha`, `preFixSha`, `maxCycles`, `cyclesRun`, `fixedInCycle`, `allCoverageGaps`, `for (let cycle` (skeleton guard), `review_loop`, `/review[- ]loop/i`
- `reviewed: true`, `coverageGaps.length === 0`, `FAIL-FIXED`, `ALWAYS ready`, `Cheapest-sufficient validation`, `One build gate per phase`, `NEVER wrapped in`, `Gate 1 #2`, `gate1-final`, `No unauthorized GitHub side-effects`
- **C10 (post-wave-report block):** `OPERATION: post-wave-report`, `TRACKING_ISSUE:`, `WAVE_REPORT_PATH: .devflow/docs/waves/`, `WAVE_ID:`, `WORKTREE_PATH:`, `skip this step entirely in SINGLE mode`, `TRACEABILITY: DEGRADED (no tracking issue for this run)`, `<!-- devflow:wave-report wave:`
- **meta.phases↔phase() agreement:** phases array in SINGLE-mode meta matches every `phase("…",` call site (structural check, not a literal pin)
- `--dry-run` absent from build/plan/tickets compiled outputs, present only in dynamic-profile

## Component Interactions

### The single-ticket engine (dynamic-build, SINGLE mode)

The engine for one ticket runs these phases in order:

```
setup (Git)
  → implement (Code agent: full task + plan + DECISIONS_CONTEXT)
  → gate1 #1 (Validate → Code retries ≤2 → Simplify → Scrutinize → re-Validate if Scrutinize changed code)
  → gate2 (Evaluate panel + Test — fires ONCE before review pass; fix-and-continue with FAIL-FIXED verdict)
  → review (single pass — see below)
  → gate1-final #2 (same Validate→Simplify→Scrutinize sequence, post-review-pass)
  → report (Synthesize)
```

Gate 1 runs exactly **twice per ticket**: once after initial implementation, once as the final build gate after all review-pass fixes are done. It never runs inside the review pass — fix Code agents self-verify their own builds instead.

Gate 2 fires **once**, at implementation acceptance (before the review pass), not after review fixes. If no plan exists, Evaluate is silently skipped. If no acceptance criteria exist, Test is silently skipped. Gate 2 failures use fix-and-continue: the verdict becomes `FAIL-FIXED` (issues found, fixes applied) and the gate proceeds — never re-evaluate.

### Review pass

The review pass runs **exactly ONCE** per ticket. Budget scales roster size and verification votes, never the number of passes.

1. **Review scope**: the entire branch diff from the base branch to HEAD. No base SHA is tracked — Review agents compute the merge-base with the default branch at review time. Full-branch, no delta scoping.
2. Spawn Review agents in staggered **chunks of ~5** (sequential groups of parallel spawns) to avoid 429 rate-limit death
3. 8 core focuses always: security, architecture, performance, complexity, consistency, regression, testing, reliability; conditional focuses added by detected file type (.ts, .go, .py, etc.)
4. **Dead-Review-agent handling**: a result is DEAD if null, threw, returned a guard string, or `reviewed !== true`. Retry once sequentially. If still dead: record in `coverageGaps`. Coverage gaps block the PASS verdict downstream — they do NOT block the early exit (which triggers on zero findings alone).
5. **Adversarial verification**: 3-lens panel (reproduces?, real vs false positive?, rule actually applies here?) majority-survives (>50% confirm = surviving finding). Unconfirmed findings are stripped.
6. **Fix batching**: group confirmed findings by file — one file per set of sub-batches, chunked at max 5 per sub-batch. Sub-batches for the SAME file run sequentially (never two Code agents editing the same file concurrently). Sub-batches for DISTINCT files run via `parallel()` in staggered chunks of ~5 (`FIX_CHUNK = 5`, same pacing bar as the Review spawn path) — not all at once. A finding with no `file` field is a singleton batch. Never hand one Code agent an unbounded list.
7. **Evidence-gated disposition**: a chunk is FIXED only when `result.status === "fixed"` AND `commitShas` is non-empty AND `result.unresolved` is empty. A non-empty `unresolved` list means the agent named work it could not complete — the whole chunk moves into `survivingFindings` (never guess which findings the strings map to). `survivingFindings` = findings not addressed: fix Code agent dead/failed/blocked OR committed but left work named in `unresolved`.

Early exit when `allFindings.length === 0` — return immediately. Any `coverageGaps` are carried in the return and block a PASS verdict downstream, not the early exit itself.

### Wave execution (dynamic-build, WAVE mode)

1. **Design agent (opus)** reads all wave issues and applies the **vacuous-truth rule**: a ticket with no named unmet dependency is ALWAYS ready. "Nothing merged yet" is never a blocker. A blocked verdict without a NAMED blocking ticket ID is invalid.
2. Ready tickets run **sequentially by default** (concurrency doctrine: parallel only when all 3 bars hold — different code areas, different feature logic, different goals). The Design agent reader, not a graph algorithm, decides order.
3. Each ticket runs inside a **try/catch** — one ticket's crash/stall never kills the wave; it quarantines that ticket only.
4. After engine PASS: merge to integration branch + Validate (build + test). Build red after merge → quarantine.
5. **Cascade quarantine**: when any ticket is quarantined, quarantine propagates to its direct and transitive dependents. Named explicitly in every subsequent Design agent reader prompt.
6. After each round's merges: re-spawn the Design agent reader ("given what's now merged, what's ready next?").
7. When nothing is ready but tickets remain: re-ask once with the vacuous-truth rule quoted verbatim. If the re-read names a specific blocker per ticket: declare deadlock with specific reasons. Otherwise continue.
8. `MAX_ROUNDS = ticket_count * 2 + 5` (minimum 10) — always finite.

Integration branch is `wave/<initiative>` (the initiative slug, `{slug}`) — **never main or master**.

**Post-wave-report and traceability** (WAVE mode only): Before authoring the workflow, the main model resolves an optional tracking-issue number — checking the user's input first, then `/dynamic-tickets`'s `tracking-issue.md` at `.devflow/docs/tickets/{slug}/{ts}/tracking-issue.md`. After the workflow returns, if a tracking-issue number was resolved and the wave report exists, the main model spawns a Git agent with `OPERATION: post-wave-report`, `TRACKING_ISSUE: <n>`, `WAVE_REPORT_PATH: <repo-relative path>` (resolved against `WORKTREE_PATH` when the wave ran in a linked worktree), `WAVE_ID: <ts>`, and `WORKTREE_PATH` when applicable. The Git agent deduplicates via a `<!-- devflow:wave-report wave:{WAVE_ID} -->` marker and degrades gracefully on API failure (`TRACEABILITY: DEGRADED (<reason>)`). If no tracking issue was resolved: state `TRACEABILITY: DEGRADED (no tracking issue for this run)` in the run summary — never skip silently.

### Ticket-factory pipeline (dynamic-tickets)

Before the workflow runs, the main model proposes a candidate ticket slate and waits for user confirmation — this is the human gate before the pipeline invests in drafting.

The pipeline stages: `draft → [2-lens review in parallel] → revise → whole-set critic → per-ticket amend → tracking-issue`. Two review lenses per ticket: Planner-readiness (cold read) and Accuracy/scope-discipline audit. The whole-set critic (one Design agent, opus) audits coverage, overlaps/contradictions, dependency graph, and acceptance-criteria coherence across the full revised set.

### Planning pipeline (dynamic-plan)

`AskUserQuestion` happens at the command boundary after the workflow returns — not inside the script (F4).

Phases: read-tickets → plan-parallel → plan-challenge → cross-plan-critic → preference-resolve → write-artifacts.

The plan-challenge step uses a verbatim intent string (§5.1) — do not paraphrase when authoring the challenger agent prompt. The Evaluate agent runs the challenge (not a Review agent). The cross-plan critic finds API conflicts, contradictory invariants, undeclared dependencies, scope overlap.

The preference profile (`~/.devflow/preference-profile.md`) auto-resolves decisions matching established taste. Unresolved decisions go to `DECISIONS-NEEDED.md` for the user.

## Integration Patterns

### DECISIONS_CONTEXT loading

The main model reads `.devflow/learning/index.md` (the pre-rendered write-time artifact) **before authoring the workflow script** — the script body has no filesystem access. The returned index is injected into agent prompts using the `devflow:apply-decisions` algorithm. Only agents that need architectural context (Code, Evaluate, Review, Scrutinize) need it injected; Validate and Simplify do not.

### Agent agentType usage

Every `agent()` call uses `agentType` — **never `opts.model`**. The agent's frontmatter carries its own model tier and that tier is honored automatically. Overriding with `opts.model` defeats per-agent specialization.

Valid agentType values and their tiers:

| agentType | Tier | Role |
|---|---|---|
| Code | sonnet | Writes ALL code — the ONLY agent that writes code |
| Validate | haiku | Build / typecheck / lint / test |
| Simplify | sonnet | Reduce complexity, remove duplication |
| Scrutinize | opus | 9-pillar self-review |
| Evaluate | opus | Plan-fidelity alignment |
| Test | sonnet | Scenario-based acceptance tests |
| Review | opus | Focus-parameterized review — one agent() per focus |
| Git | haiku | Git operations |
| Synthesize | haiku | Summarize / aggregate multi-agent outputs |
| Knowledge | sonnet | Codebase exploration / KB creation |
| Design | opus | Architecture, design, dependency reasoning |

A Code agent writes every fix — no other agent type ever writes code.

### Workflow runtime contract

The script body has ONLY these hooks: `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`. Globals: `args`, `budget`. **No filesystem, no Node.js, no `gh` CLI in the script body.** File reads, git operations, and shell commands happen only inside spawned agents.

`meta` must be a pure literal — no variables, function calls, spreads, or template interpolation inside `meta`.

## Constraints

### Engine invariants (non-negotiable)

1. Code is written ONLY by Code agents. No other agent type writes code.
2. Findings are verified before any fix is written. Adversarial verification is not optional.
3. All written code passes Gate 1. No code merge before Validate + Simplify + Scrutinize.
4. Gate 2 runs once, at implementation acceptance. It does not re-run after review fixes.
5. NEVER auto-merge to main or master. All merges target the integration branch. The user merges to main themselves.
6. No unauthorized GitHub side-effects. Sub-agents never create GitHub issues/PRs, comment, or push beyond the ticket-authorized branch unless the ticket, plan, or user explicitly authorizes that exact action.
7. The review pass runs exactly ONCE per ticket. Never author additional cycles or a delta re-review of fix commits. Fix commits are covered by the fixing Code agent's self-verification and the final Gate 1 #2. Budget scales roster size and verification votes, never pass count.

### Concurrency doctrine

Default: **sequential**. Parallel is the rare, tightly-gated exception — only when ALL THREE bars hold: (1) completely different code areas, (2) different feature logic, (3) different goals. Two Code agents splitting one task is a coherence hazard. When in doubt, sequential.

### Budget scaling

`budget` (available as a script global) governs Review-agent roster size and verification vote count. Never hardcode a roster size — let budget guide it. Budget never changes the number of review passes — it is always exactly one.

## Anti-Patterns

- **Passing `opts.model` with `agentType`**: always wrong — overrides the agent's own model tier and defeats specialization.
- **Batching multiple focuses into one Review call**: defeats parallel specialization. One `agent()` call per focus area.
- **Running Gate 1 inside the review pass**: the cadence is twice per ticket only. Inside the pass, fix Code agents self-verify their own builds.
- **Re-running Gate 2 after review fixes**: Gate 2 fires once. The review pass is Gate-1-only after Gate 2 has fired.
- **Treating a DEAD Review agent as a clean pass**: a null/thrown/guard-string result means coverage gap, not clean. `filter(Boolean)` before mapping over agent results is crash-safety, never a coverage-to-success converter.
- **Authoring deterministic feature code in the script body**: no parsers, schedulers, no topological-sort, no dependency-graph helpers, no confidence formulas. ALL issue reading, dependency reasoning, and scheduling decisions are LLM judgment at runtime (ADR-008 Iron Rule from CLAUDE.md).
- **Adding extra review passes or delta re-reviews**: the pass runs exactly once per ticket. Never author a second pass, DELTA REVIEW, or budget-scaled pass count. Fix commits are covered by the fixing Code agent's self-verification and the final Gate 1 #2.
- **Merging to main or master from the workflow**: the workflow targets `wave/<initiative>` only. The user merges to main themselves.
- **Asking questions mid-workflow**: F4 constraint — a workflow cannot pause. `AskUserQuestion` always happens at the command boundary after the workflow returns.

## Gotchas

### Build execution doctrine — 180s watchdog

The Workflow runtime kills any sub-agent that emits no output for 180 seconds. Cold `cargo build`, `tsc`, `gradle build`, etc. routinely run silent far longer. The mandatory procedure:

1. **Pre-load Monitor** via ToolSearch (`select:Monitor`) before launching any background task.
2. Launch with `run_in_background: true`: `<cmd> > <BASE>.log 2>&1; echo "EXIT=$?" > <BASE>.done`
3. Arm ONE Monitor with a 25s heartbeat (`until [ -f <BASE>.done ]; do echo building; sleep 25; done`).
4. **Exit-code honesty**: the background task's own exit status is meaningless. ALWAYS read `EXIT=` inside `<BASE>.done` — that is the authoritative result.
5. **Bounded re-arm**: arm ONE Monitor then stop. Re-arm at most 2× (3 total). If still not done: escalate. Never babysit.

Build commands are **NEVER wrapped** in `sh -c`, `bash -c`, or inline interpreters (`python3 -c`, `node -e`). Invoke directly — permission systems deny wrapper-invoked commands that would be allowed directly.

**`BASE` path must be unique per run**: `/tmp/df-build-<ticket-slug>`. Reusing a path from a prior run trips write guards.

### Scratch file for node --check must be run-unique

The pre-flight self-check writes the authored script to a scratch path, runs `node --check`, then passes the script to `Workflow`. The scratch path MUST be unique per run: `/tmp/df-wf-check-<meta.name>-<epoch-seconds>.js`. Rewriting an existing file trips write guards. `node --check` catches syntax errors only — the manual checklist (pure `meta` literal, no undefined field access, `filter(Boolean)` before map over agent results, `phase()` titles match declared phases) is the real safeguard for runtime type errors.

### MDS literal braces and template expressions

In `.mds` source files:
- Literal `{` and `}` in prose MUST be escaped as `\{` and `\}` — otherwise MDS interprets them as partial call sites.
- `${...}` template expressions are only valid inside `js` fences. Outside a js fence, `${}` is treated as a literal string.
- Fences (`` ``` ``) MUST start at column 0 — indented fences are not recognized as code blocks by the MDS compiler and leak as prose.
- `output-dir:` MUST be the LAST key in the frontmatter block. No non-blank lines may follow it inside the `---` block.

### Wave Design Agent Reader Must Be Opus Tier

Using a haiku-tier reader for wave dependency reasoning is a known failure mode: a haiku reader once quarantined 10 independent tickets as "blocked" because nothing had merged yet. The wave step spawns a `Design` (opus) agent — never downgrade this to a faster tier.

### Empty ready-set re-ask guard

When the Design agent reader returns an empty ready set but tickets remain, the engine re-asks once with the vacuous-truth rule quoted verbatim before declaring deadlock. A second empty read that names a specific blocking ticket ID per remaining ticket ends the wave. Without the re-ask, a single hallucinated block causes premature deadlock.

### `--dry-run` only in dynamic-profile

The `--dry-run` flag is present ONLY in `dynamic-profile.mds`. It was removed from `dynamic-build`, `dynamic-plan`, and `dynamic-tickets` (C7 of PR #252). The test suite pins its absence. Do not re-add it to those commands.

### Skill re-entrancy in Review and Evaluate agents

Agents that preload a skill via frontmatter `skills:` must never be instructed to invoke that same skill via the Skill tool in their body prompt. The re-entrancy guard returns a guard string (`devflow:X already running`), the agent treats it as a terminal instruction, returns with 0 tool uses, and the Workflow counts it as success — silently masking zero review coverage. Applies PF-002. When writing agent prompts for Review and Evaluate, give full context directly; do not rely on Skill-tool re-invocation of a preloaded skill.

### Acceptance criteria quality bar

A criterion is not acceptable if: vague ("the feature should work correctly"), implementation-coupled ("the function must call X"), or untestable. At least one NEGATIVE criterion (what the system MUST NOT do) is required per ticket. These rules are load-bearing because Gate 2 uses them directly — the Evaluate and Test agents have no other source of truth.

### Per-ticket branch branching time

Per-ticket branches (`ticket/<slug>`) are branched off integration HEAD at the moment the ticket becomes **ready**, not at wave start. This ensures the ticket branch already contains all merged dependencies when it starts.

### Gate 1 #2 retry tracks latest failure details

In the SINGLE mode workflow's final Gate 1 (#2, `gate1-final` phase), retry attempt 2 receives the **latest** recheck failure details — the Gate 1 #2 loop updates `failureDetails = recheck.details || failureDetails` after each recheck. This means the Code agent on attempt 2 sees a failure description that reflects any partial progress from attempt 1's fixes. Gate 1 #1 (inside `gate1`) does not update failure details between attempts — only Gate 1 #2 does.

## Key Files

- `src/assets/commands/_partials/_engine.mds` — canonical Gate 1, Gate 2, review pass, concurrency, build execution doctrine (source of truth for all engine behavior)
- `src/assets/commands/_partials/_wave.mds` — wave loop, branch/merge model, conflict resolution doctrine, escalation model
- `src/assets/commands/_partials/_preamble.mds` — workflow runtime contract, pre-flight checklist, IRON RULE (no deterministic feature code), SAFETY BANNER (never merge to main)
- `src/assets/commands/_partials/_roster.mds` — valid agentType values, model tiers, agent caveats
- `src/assets/commands/_partials/_plan_contract.mds` — acceptance criteria + test plan shape (shared by dynamic-plan and dynamic-build Gate 2)
- `src/assets/commands/_partials/_factory.mds` — ticket-factory pipeline stages (draft→review→revise→critic→amend→tracking)
- `src/assets/commands/_partials/_ticket_template.mds` — canonical ticket body structure
- `src/assets/commands/dynamic-build.mds` — main build command source with inline SINGLE + WAVE workflow scripts
- `dist/commands/dynamic-build.md` — compiled artifact pinned by test suite
- `tests/build-mds.test.ts` — doctrine-literal pinning tests (sections 10, 12, 13)
- `scripts/build-mds.ts` — unified MDS compiler (13 compiled hosts `ALL_HOSTS`; `DIST_FILES` = 14 including hand-authored `release.md` — SG-13 permanent divergence)

## Deliberate Exceptions (AC-0.4 gh-issue scope guard)

Two categories of deliberate exceptions to the AC-0.4 guard (`tests/build-mds.test.ts §21`) that bars `gh issue` invocations or descriptive mentions from deployed commands outside Git spawn fences:

**`gh pr view` at three prose sites** — `code-review.md` (source: `code-review.mds:76-78`), `bug-analysis.md` (source: `bug-analysis.mds:43-45`), and `resolve.md` (source: `resolve.mds:63`) each fetch a PR description via `gh pr view {pr_number}` in a bash prose block, not inside a Git spawn fence. This is an explicit allowlisted PR-hosting exception: `gh pr` is not `gh issue`, and fetching the PR body for display is unrelated to the issue-routing contract. Encoded in the guard's `GH_PR_VIEW_EXCEPTION_FILES` set.

**`release.md:85` conventions read** — `release.md:85` instructs the release orchestrator to consult `.devflow/conventions.md` directly for version/tag naming conventions (a local file, not a GitHub API call). This is a local-file read that does not route through the Git agent; it is exempt from the AC-0.4 guard by definition (no `gh` CLI involved). Recorded here so future guard authors do not flag it as an oversight.

## Related

- ADR-003 (leave-the-end-state): applies to compiled output — when removing or renaming doctrine blocks, strip residue (tombstone comments, `*_old` names, guards for now-impossible states). The test suite pins the current doctrine literals; outdated pinned strings that remain after a partial rename fail tests rather than silently passing.
- PF-002 (skill re-entrancy guard-string bail): relevant to every `agent()` call with `agentType: "Review"` or `"Evaluate"` — never instruct these agents to invoke via Skill tool the same skill their frontmatter preloads.
- `feature-knowledge-system` KB — covers the MDS build pipeline (`scripts/build-mds.ts`), the 9 knowledge host commands, and the `knowledge_load`/`knowledge_writeback` partials that share the MDS compilation infrastructure with the 4 dynamic commands.
