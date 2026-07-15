---
feature: dynamic-workflow-engine
name: Dynamic Workflow Engine
description: "Use when authoring or modifying the dynamic-* commands (dynamic-build, dynamic-plan, dynamic-tickets, dynamic-wave, dynamic-profile), the shared engine/wave/preamble/factory MDS partials, or the build-mds test suite that pins doctrine literals. Keywords: dynamic-build, dynamic-plan, dynamic-tickets, dynamic-wave, dynamic-profile, Workflow tool, agentType, Gate 1, Gate 2, review loop, wave, tickets→plan→build, MDS, _engine.mds, _wave.mds."
category: architecture
directories:
  - commands/dynamic-build.mds
  - commands/dynamic-plan.mds
  - commands/dynamic-tickets.mds
  - commands/dynamic-wave.mds
  - commands/dynamic-profile.mds
  - commands/_partials/_engine.mds
  - commands/_partials/_wave.mds
  - commands/_partials/_preamble.mds
  - commands/_partials/_roster.mds
  - commands/_partials/_plan_contract.mds
  - commands/_partials/_factory.mds
  - commands/_partials/_ticket_template.mds
  - plugins/devflow-dynamic/commands
  - tests/build-mds.test.ts
created: 2026-07-07
updated: 2026-07-15
---

# Dynamic Workflow Engine

## Overview

The dynamic workflow engine is the `devflow-dynamic` plugin — a pipeline that turns a rough initiative description into fully reviewed, merged code on an integration branch. It operates in three sequential stages, each driven by a Claude Code dynamic Workflow script that the main session authors inline and passes to the `Workflow` tool: **tickets** (decompose an initiative into a wave-structured ticket slate), **plan** (write per-ticket implementation plans with acceptance criteria and a cross-plan conflict audit), and **build** (implement, review, and verify each ticket with a bounded gate structure). The `dynamic-wave` command is a thin driver that sequences these three commands with human-review gates between them; `dynamic-profile` is a standalone agent that mines session history to build a decision-preference profile consumed by `dynamic-plan`.

The commands are **authored as MDS sources** in `commands/` and compiled to `plugins/devflow-dynamic/commands/` at build time. Seven shared MDS partials in `commands/_partials/` define the canonical engine doctrine, wave protocol, workflow runtime contract, agent roster, plan–Gate-2 contract, ticket-factory shape, and ticket body template. Each partial exports named blocks that host commands import and inline-expand at compile time — the compiled `.md` files are the deployed artifacts, and the test suite pins exact doctrine literals in the compiled output.

## System Context

The four commands form a delivery pipeline:

```
/devflow:dynamic-tickets  →  [Gate: user reviews ticket slate]
/devflow:dynamic-plan     →  [Gate: user answers DECISIONS-NEEDED.md]
/devflow:dynamic-build    →  [Gate: user reviews wave-report.md and merges to main]
```

`dynamic-wave` sequences these by invoking them in turn with `AskUserQuestion` at each gate. A workflow cannot pause mid-run (F4 constraint), so all human-decision surfacing happens at the command boundary — after the workflow returns — never inside the script.

## Component Architecture

### MDS partial hierarchy

```
commands/
  dynamic-build.mds         # host: imports all engine + wave partials
  dynamic-plan.mds          # host: imports authoring_preamble + roster + plan_contract
  dynamic-tickets.mds       # host: imports authoring_preamble + roster + factory + ticket_template
  dynamic-wave.mds          # host: thin driver, imports only authoring_preamble
  dynamic-profile.mds       # host: standalone agent spawn, imports only authoring_preamble
  _partials/
    _engine.mds             # gate1_postcode, gate2_acceptance, evaluator_panel,
                            # implement_bundle, review_loop, concurrency_doctrine,
                            # build_execution_doctrine, engine_output_schema, engine_invariants
    _wave.mds               # wave_loop, branch_merge_model, merge_doctrine, escalation_model
    _preamble.mds           # authoring_preamble (workflow runtime contract, pre-flight checklist,
                            #   IRON RULE, SAFETY BANNER, budget scaling, DECISIONS_CONTEXT load)
    _roster.mds             # agent_roster, agent_caveats (valid agentType values + tiers)
    _plan_contract.mds      # acceptance_criteria_contract (shared Gate-2 shape)
    _factory.mds            # factory_shape (draft→review→revise→critic→amend→tracking)
    _ticket_template.mds    # ticket_body_template (canonical ticket markdown shape)
```

Partials declare **no** `output-dir:` frontmatter key. Host files declare it as the LAST frontmatter key. The build fails if the parent plugin directory does not exist.

### Compiled output and test pinning

`scripts/build-mds.ts` compiles all 14 host files (9 knowledge + 5 dynamic). The test file `tests/build-mds.test.ts` reads the compiled `plugins/devflow-dynamic/commands/dynamic-build.md` and greps for exact doctrine strings. Changing a doctrine literal in a partial immediately breaks the relevant test — by design. The test suite pins:
- `Simplifier` and `Scrutinizer` each appearing exactly **2 times** (Gate 1 #1 + Gate 1 #2 only)
- `DELTA REVIEW`, `reviewBaseSha`, `reviewed: true`, `coverageGaps.length === 0`, `FAIL-FIXED`, `ALWAYS ready`, `Cheapest-sufficient validation`, `One build gate per phase`, `NEVER wrapped in`, `Gate 1 #2`, `gate1-final`, `No unauthorized GitHub side-effects`
- `--dry-run` absent from build/plan/tickets/wave compiled outputs, present only in dynamic-profile

## Component Interactions

### The single-ticket engine (dynamic-build, SINGLE mode)

The engine for one ticket runs these phases in order:

```
setup (Git)
  → implement (Coder: full task + plan + DECISIONS_CONTEXT)
  → gate1 #1 (Validator → Coder retries ≤2 → Simplifier → Scrutinizer → re-Validator if Scrutinizer changed code)
  → gate2 (Evaluator panel + Tester — fires ONCE before review loop; fix-and-continue with FAIL-FIXED verdict)
  → review-loop (cycles until clean or maxCycles — see below)
  → gate1-final #2 (same Validator→Simplifier→Scrutinizer sequence, post-all-fixes)
  → report (Synthesizer)
```

Gate 1 runs exactly **twice per ticket**: once after initial implementation, once as the final build gate after all review-loop fixes are done. It never runs between review cycles — fix Coders self-verify their own builds instead.

Gate 2 fires **once**, at implementation acceptance (before the review loop), not after review fixes. If no plan exists, Evaluator is silently skipped. If no acceptance criteria exist, Tester is silently skipped. Gate 2 failures use fix-and-continue: the verdict becomes `FAIL-FIXED` (issues found, fixes applied) and the gate proceeds — never re-evaluate.

### Review loop

Each cycle:
1. Spawn reviewers in staggered **chunks of ~5** (sequential groups of parallel spawns) to avoid 429 rate-limit death
2. 8 core focuses always: security, architecture, performance, complexity, consistency, regression, testing, reliability; conditional focuses added by detected file type (.ts, .go, .py, etc.)
3. **Dead-reviewer handling**: a result is DEAD if null, threw, returned a guard string, or `reviewed !== true`. Retry once sequentially. If still dead: record in `coverageGaps`. A cycle with any coverage gap can never early-exit clean, and the run verdict can never be PASS.
4. **Adversarial verification**: 3-lens panel (reproduces?, real vs false positive?, rule actually applies here?) majority-survives (>50% confirm = surviving finding). Unconfirmed findings are stripped.
5. **preFixSha**: record `git rev-parse HEAD` via haiku Git agent before each fix phase. This SHA defines the next cycle's delta-review scope. Missing preFixSha → fall back to wider full-branch scope, never narrower.
6. **Fix batching**: group confirmed findings by file — one file per set of sub-batches, chunked at max 5 per sub-batch. Sub-batches for the SAME file run sequentially (never two Coders editing the same file concurrently). Sub-batches for DISTINCT files run in parallel (different code areas — safe per concurrency doctrine). A finding with no `file` field is a singleton batch. Never hand one Coder an unbounded list.
7. `survivingFindings` **accumulates** across cycles (never overwritten). Findings addressed by fix Coders are FIXED and trusted; a delta review in cycle N+1 re-checks earlier fixes for free.
8. **Scope**: Cycle 1 = full branch diff. Cycles 2+ = DELTA REVIEW (`reviewBaseSha..HEAD`) — only the fix commits are re-reviewed.

Early exit only when `allFindings.length === 0 && coverageGaps.length === 0`.

### Wave execution (dynamic-build, WAVE mode)

1. **Designer agent (opus)** reads all wave issues and applies the **vacuous-truth rule**: a ticket with no named unmet dependency is ALWAYS ready. "Nothing merged yet" is never a blocker. A blocked verdict without a NAMED blocking ticket ID is invalid.
2. Ready tickets run **sequentially by default** (concurrency doctrine: parallel only when all 3 bars hold — different code areas, different feature logic, different goals). The Designer reader, not a graph algorithm, decides order.
3. Each ticket runs inside a **try/catch** — one ticket's crash/stall never kills the wave; it quarantines that ticket only.
4. After engine PASS: merge to integration branch + Validator (build + test). Build red after merge → quarantine.
5. **Cascade quarantine**: when any ticket is quarantined, quarantine propagates to its direct and transitive dependents. Named explicitly in every subsequent Designer reader prompt.
6. After each round's merges: re-spawn the Designer reader ("given what's now merged, what's ready next?").
7. When nothing is ready but tickets remain: re-ask once with the vacuous-truth rule quoted verbatim. If the re-read names a specific blocker per ticket: declare deadlock with specific reasons. Otherwise continue.
8. `MAX_ROUNDS = ticket_count * 2 + 5` (minimum 10) — always finite.

Integration branch is `wave/<initiative>` — **never main or master**.

### Ticket-factory pipeline (dynamic-tickets)

Before the workflow runs, the main model proposes a candidate ticket slate and waits for user confirmation — this is the human gate before the pipeline invests in drafting.

The pipeline stages: `draft → [2-lens review in parallel] → revise → whole-set critic → per-ticket amend → tracking-issue`. Two review lenses per ticket: Planner-readiness (cold read) and Accuracy/scope-discipline audit. The whole-set critic (one Designer, opus) audits coverage, overlaps/contradictions, dependency graph, and acceptance-criteria coherence across the full revised set.

### Planning pipeline (dynamic-plan)

`AskUserQuestion` happens at the command boundary after the workflow returns — not inside the script (F4).

Phases: read-tickets → plan-parallel → plan-challenge → cross-plan-critic → preference-resolve → write-artifacts.

The plan-challenge step uses a verbatim intent string (§5.1) — do not paraphrase when authoring the challenger agent prompt. The Evaluator agent runs the challenge (not a Reviewer). The cross-plan critic finds API conflicts, contradictory invariants, undeclared dependencies, scope overlap.

The preference profile (`~/.devflow/preference-profile.md`) auto-resolves decisions matching established taste. Unresolved decisions go to `DECISIONS-NEEDED.md` for the user.

## Integration Patterns

### DECISIONS_CONTEXT loading

The main model reads `.devflow/learning/index.md` (the pre-rendered write-time artifact) **before authoring the workflow script** — the script body has no filesystem access. The returned index is injected into agent prompts using the `devflow:apply-decisions` algorithm. Only agents that need architectural context (Coder, Evaluator, Reviewer, Scrutinizer) need it injected; Validator and Simplifier do not.

### Agent agentType usage

Every `agent()` call uses `agentType` — **never `opts.model`**. The agent's frontmatter carries its own model tier and that tier is honored automatically. Overriding with `opts.model` defeats per-agent specialization.

Valid agentType values and their tiers:

| agentType | Tier | Role |
|---|---|---|
| Coder | sonnet | Writes ALL code — the ONLY agent that writes code |
| Validator | haiku | Build / typecheck / lint / test |
| Simplifier | sonnet | Reduce complexity, remove duplication |
| Scrutinizer | opus | 9-pillar self-review |
| Evaluator | opus | Plan-fidelity alignment |
| Tester | sonnet | Scenario-based acceptance tests |
| Reviewer | opus | Focus-parameterized review — one agent() per focus |
| Git | haiku | Git operations |
| Synthesizer | haiku | Summarize / aggregate multi-agent outputs |
| Knowledge | sonnet | Codebase exploration / KB creation |
| Designer | opus | Architecture, design, dependency reasoning |

A Coder writes every fix — no other agent type ever writes code.

### Workflow runtime contract

The script body has ONLY these hooks: `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`. Globals: `args`, `budget`. **No filesystem, no Node.js, no `gh` CLI in the script body.** File reads, git operations, and shell commands happen only inside spawned agents.

`meta` must be a pure literal — no variables, function calls, spreads, or template interpolation inside `meta`.

## Constraints

### Engine invariants (non-negotiable)

1. Code is written ONLY by Coders. No other agent type writes code.
2. Findings are verified before any fix is written. Adversarial verification is not optional.
3. All written code passes Gate 1. No code merge before Validator + Simplifier + Scrutinizer.
4. Gate 2 runs once, at implementation acceptance. It does not re-run after review fixes.
5. NEVER auto-merge to main or master. All merges target the integration branch. The user merges to main themselves.
6. No unauthorized GitHub side-effects. Sub-agents never create GitHub issues/PRs, comment, or push beyond the ticket-authorized branch unless the ticket, plan, or user explicitly authorizes that exact action.

### Concurrency doctrine

Default: **sequential**. Parallel is the rare, tightly-gated exception — only when ALL THREE bars hold: (1) completely different code areas, (2) different feature logic, (3) different goals. Two Coders splitting one task is a coherence hazard. When in doubt, sequential.

### Budget scaling

`budget` (available as a script global) governs reviewer roster size, review cycle count, and verification vote count. Never hardcode a roster size — let budget guide it.

## Anti-Patterns

- **Passing `opts.model` with `agentType`**: always wrong — overrides the agent's own model tier and defeats specialization.
- **Batching multiple focuses into one Reviewer call**: defeats parallel specialization. One `agent()` call per focus area.
- **Running Gate 1 between review cycles**: the cadence is twice per ticket only. Between cycles, fix Coders self-verify their own builds.
- **Re-running Gate 2 after review fixes**: Gate 2 fires once. The review loop is Gate-1-only after Gate 2 has fired.
- **Treating a DEAD reviewer as a clean pass**: a null/thrown/guard-string result means coverage gap, not clean. `filter(Boolean)` before mapping over agent results is crash-safety, never a coverage-to-success converter.
- **Authoring deterministic feature code in the script body**: no parsers, schedulers, topological-sort, cycle counters. All scheduling decisions are LLM judgment at runtime (ADR-008 Iron Rule from CLAUDE.md).
- **Overwriting survivingFindings each cycle**: findings from past cycles where the Coder failed or deferred must accumulate. A delta review does not re-surface them; overwriting would silently drop them and let the verdict falsely read PASS.
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

### Wave Designer reader must be opus tier

Using a haiku-tier reader for wave dependency reasoning is a known failure mode: a haiku reader once quarantined 10 independent tickets as "blocked" because nothing had merged yet. The wave step spawns a `Designer` (opus) agent — never downgrade this to a faster tier.

### Empty ready-set re-ask guard

When the Designer reader returns an empty ready set but tickets remain, the engine re-asks once with the vacuous-truth rule quoted verbatim before declaring deadlock. A second empty read that names a specific blocking ticket ID per remaining ticket ends the wave. Without the re-ask, a single hallucinated block causes premature deadlock.

### `--dry-run` only in dynamic-profile

The `--dry-run` flag is present ONLY in `dynamic-profile.mds`. It was removed from `dynamic-build`, `dynamic-plan`, `dynamic-tickets`, and `dynamic-wave` (C7 of PR #252). The test suite pins its absence. Do not re-add it to those commands.

### Skill re-entrancy in Reviewer and Evaluator agents

Agents that preload a skill via frontmatter `skills:` must never be instructed to invoke that same skill via the Skill tool in their body prompt. The re-entrancy guard returns a guard string (`devflow:X already running`), the agent treats it as a terminal instruction, returns with 0 tool uses, and the Workflow counts it as success — silently masking zero review coverage. Applies PF-002. When writing agent prompts for Reviewer and Evaluator, give full context directly; do not rely on Skill-tool re-invocation of a preloaded skill.

### Acceptance criteria quality bar

A criterion is not acceptable if: vague ("the feature should work correctly"), implementation-coupled ("the function must call X"), or untestable. At least one NEGATIVE criterion (what the system MUST NOT do) is required per ticket. These rules are load-bearing because Gate 2 uses them directly — the Evaluator and Tester agents have no other source of truth.

### Per-ticket branch branching time

Per-ticket branches (`ticket/<slug>`) are branched off integration HEAD at the moment the ticket becomes **ready**, not at wave start. This ensures the ticket branch already contains all merged dependencies when it starts.

## Key Files

- `commands/_partials/_engine.mds` — canonical Gate 1, Gate 2, review loop, concurrency, build execution doctrine (source of truth for all engine behavior)
- `commands/_partials/_wave.mds` — wave loop, branch/merge model, conflict resolution doctrine, escalation model
- `commands/_partials/_preamble.mds` — workflow runtime contract, pre-flight checklist, IRON RULE (no deterministic feature code), SAFETY BANNER (never merge to main)
- `commands/_partials/_roster.mds` — valid agentType values, model tiers, agent caveats
- `commands/_partials/_plan_contract.mds` — acceptance criteria + test plan shape (shared by dynamic-plan and dynamic-build Gate 2)
- `commands/_partials/_factory.mds` — ticket-factory pipeline stages (draft→review→revise→critic→amend→tracking)
- `commands/_partials/_ticket_template.mds` — canonical ticket body structure
- `commands/dynamic-build.mds` — main build command source with inline SINGLE + WAVE workflow scripts
- `plugins/devflow-dynamic/commands/dynamic-build.md` — compiled artifact pinned by test suite
- `tests/build-mds.test.ts` — doctrine-literal pinning tests (sections 10, 12, 13)
- `scripts/build-mds.ts` — unified MDS compiler (14 hosts → compiled .md files)

## Related

- ADR-003 (leave-the-end-state): applies to compiled output — when removing or renaming doctrine blocks, strip residue (tombstone comments, `*_old` names, guards for now-impossible states). The test suite pins the current doctrine literals; outdated pinned strings that remain after a partial rename fail tests rather than silently passing.
- PF-002 (skill re-entrancy guard-string bail): relevant to every `agent()` call with `agentType: "Reviewer"` or `"Evaluator"` — never instruct these agents to invoke via Skill tool the same skill their frontmatter preloads.
- `feature-knowledge-system` KB — covers the MDS build pipeline (`scripts/build-mds.ts`), the 9 knowledge host commands, and the `knowledge_load`/`knowledge_writeback` partials that share the MDS compilation infrastructure with the 5 dynamic commands.
