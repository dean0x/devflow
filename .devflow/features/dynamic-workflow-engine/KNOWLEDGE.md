---
feature: dynamic-workflow-engine
name: Dynamic Workflow Engine
description: "Use when authoring or changing dynamic-build, dynamic-plan, dynamic-tickets, dynamic-profile or the engine and gate partials. Keywords: Workflow tool, agentType, Gate 1, Gate 2, review pass."
category: architecture
directories:
  - src/assets/commands/dynamic-build.mds
  - src/assets/commands/dynamic-plan.mds
  - src/assets/commands/dynamic-tickets.mds
  - src/assets/commands/dynamic-profile.mds
  - src/assets/commands/_partials/_engine.mds
  - src/assets/commands/_partials/_preamble.mds
  - src/assets/commands/_partials/_roster.mds
  - src/assets/commands/_partials/_plan_contract.mds
  - src/assets/commands/_partials/_factory.mds
  - src/assets/commands/_partials/_ticket_template.mds
  - dist/commands
  - tests/dynamic
created: 2026-07-07
updated: 2026-10-10
---

# Dynamic Workflow Engine

## Rules

- **KB-INV-1** Only Code agents write code: every implementation, review fix, Gate 2 fix, validation fix and merge-conflict resolution is a Code spawn whose prompt opens with `OPERATION: <mode>`.
- **KB-INV-2** Gate 1 runs Simplify, then Scrutinize, then Validate (last, unconditional), at exactly two points per ticket: after the implement bundle and as the final gate after the review pass. Never inside the pass or after individual fixes; no code merges before it.
- **KB-INV-3** Gate 2 (one Evaluate agent with two lenses, plus Test) fires once, at implementation acceptance before the review pass. A failure is fix-and-continue, recorded `FAIL-FIXED` and never re-evaluated; a ticket carrying `FAIL-FIXED` reports UNVERIFIED, never PASS.
- **KB-INV-4** The review pass runs exactly once per ticket over the full branch diff, with no base SHA and no delta re-review. Budget scales roster size and verification votes, never the number of passes.
- **KB-INV-5** Findings are adversarially verified (majority survives) before any fix. A chunk is FIXED only when `status === "fixed"`, `commitShas` is non-empty and `unresolved` is empty; otherwise the whole chunk stays in `survivingFindings`.
- **KB-INV-6** Nothing merges to main or master: all merges target the integration branch and the user merges to main. The workflow never opens a PR except the wave PR (see the waves KB).
- **KB-INV-7** No unauthorized tracker or remote side-effects: sub-agents create, comment on or push nothing the ticket, plan or user did not authorize, whichever tracker is resolved. Proposed follow-ups go in the run report.
- **KB-INV-8** Default is sequential. Parallel Code agents only when all three bars hold (different code areas, different feature logic, different goals); two Code agents never split one task. When in doubt, sequential.
- **KB-INV-9** Every `agent()` call sets `agentType` and never `opts.model`: the agent's frontmatter owns its tier, and no `Agent(subagent_type=...)` spawn carries `model=` either (`tests/guards/spawn-no-hardcoded-model.test.ts`).
- **KB-INV-10** The script body holds only `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, `args` and `budget`: no filesystem, Node or tracker CLI. `meta` is a pure literal. File, git and shell work happens only in spawned agents.
- **KB-INV-11** A workflow cannot pause: every `AskUserQuestion` happens at the command boundary after the workflow returns.
- **KB-INV-12** No deterministic feature code in the script body (no parsers, schedulers, topological sorts, dependency-graph helpers or confidence formulas): issue reading, dependency reasoning and scheduling are LLM judgment (the Iron Rule).
- **KB-INV-13** A ticket works on the branch its `setup-task` created and reported, verbatim in every phase and the merge. The engine mints no name; a missing branch stops the ticket (`branch-missing`).
- **KB-INV-14** Only the Validate agent runs the full test suite, once per HEAD; Code runs its affected tests, Simplify and Evaluate run no build, test or lint command.
- **KB-INV-15** Builds and tests run in the foreground under an explicit Bash `timeout`; never background and poll. A prompt names "your Running commands block", never copies it.
- **KB-AP-1** A dead Review agent (null, thrown, guard string or `reviewed !== true`) is a coverage gap that blocks PASS, never a clean pass; `filter(Boolean)` is crash-safety only.
- **KB-AP-2** One `agent()` call per Review focus, spawned in staggered chunks: never batch focuses into one call or fire the whole roster at once (429 batch death).
- **KB-AP-3** Never hand one Code agent an unbounded finding list or run two Code agents on the same file at once: group by file, sub-batch, same file sequential.
- **KB-AP-4** Never tell a Review or Evaluate agent to Skill-invoke the skill its frontmatter preloads: the re-entrancy guard string is read as terminal, returns zero tool uses and counts as success.
- **KB-AP-5** Never re-add `--dry-run` to dynamic-build, dynamic-plan or dynamic-tickets; it belongs to dynamic-profile only.
- **KB-AP-6** Never reuse the `node --check` scratch path: it is run-unique, `/tmp/df-wf-check-<meta.name>-<epoch-seconds>.js`, and `node --check` catches syntax errors only.
- **KB-AP-7** Never accept a criterion that is vague, implementation-coupled or untestable, and always include a negative criterion per ticket: Gate 2 has no other source of truth.

## Overview

The dynamic workflow engine is the `devflow-dynamic` plugin: a pipeline that turns a rough initiative into reviewed, merged code on an integration branch, in three sequential stages. Each is a Claude Code dynamic Workflow script that the main session authors inline and passes to the `Workflow` tool: **tickets** (decompose an initiative into a wave-structured ticket slate), **plan** (per-ticket implementation plans with acceptance criteria and a cross-plan conflict audit) and **build** (implement, review and verify each ticket under a bounded gate structure). `dynamic-profile` is a standalone agent that mines session history into a decision-preference profile that `dynamic-plan` consumes.

The commands are MDS sources in `src/assets/commands/`, compiled to `dist/commands/` (with a learning-off variant under `dist/learning-off/commands/`). Shared partials in `src/assets/commands/_partials/` export named blocks that hosts inline at compile time; the compiled `.md` files are the deployed artifacts and the test suite pins exact doctrine literals in them.

The knowledge is split across four KBs. This one holds the single-ticket engine doctrine (gates, review pass, factory, plan, roster, runtime contract). `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md` holds WAVE mode and the wave PR. `.devflow/features/dynamic-workflow-engine-contracts/KNOWLEDGE.md` holds the settings block, decisions step, learning arms, `_tracker.mds`, `COMMAND_INPUT`, issue vocabulary and tracker preflight. `.devflow/features/dynamic-workflow-engine-pins/KNOWLEDGE.md` holds the host/partial count rule, the pinned doctrine literals, marker ownership, the gh-issue exceptions and the `.mds` gotchas. The MDS build pipeline and learning-variant splitter belong to `feature-knowledge-system`, the tracker/git reference-module split to `tracker-references`, and installing or converging a variant to `installer-shadowing`.

## System Context

```
/devflow:dynamic-tickets  ->  [Gate: user reviews ticket slate]
/devflow:dynamic-plan     ->  [Gate: user answers DECISIONS-NEEDED.md]
/devflow:dynamic-build    ->  [Gate: user reviews wave-report.md and merges to main]
```

A workflow cannot pause mid-run (the F4 constraint), so all human-decision surfacing happens at the command boundary, after the workflow returns, never inside the script.

## Component Architecture

```
src/assets/commands/
  dynamic-build.mds       # engine + wave + roster + plan_contract + tracker partials, preamble/decisions,
                          #   settings alias; also evidence policy, compliance (alias), publication (alias pub), docs root
  dynamic-plan.mds        # preamble/decisions + roster + plan_contract + tracker, settings alias, docs root
  dynamic-tickets.mds     # preamble/decisions + roster + factory + ticket_template, settings alias,
                          #   evidence policy, docs root (NOT a _tracker.mds adopter)
  dynamic-profile.mds     # standalone agent spawn: preamble/decisions, settings alias
  _partials/
    _engine.mds           # gate1_postcode, gate2_acceptance, evaluator_panel, implement_bundle, review_pass,
                          #   concurrency_doctrine, build_execution_doctrine, engine_output_schema, engine_invariants
    _wave.mds             # wave_loop, branch_merge_model, merge_doctrine, escalation_model (waves KB)
    _preamble.mds         # authoring_preamble: workflow runtime contract, pre-flight checklist, budget scaling,
                          #   handoff convention, IRON RULE, SAFETY BANNER (no decisions text);
                          #   authoring_decisions: contracts KB
    _roster.mds           # agent_roster, agent_caveats (valid agentType values and tiers)
    _plan_contract.mds    # acceptance_criteria_contract (the Gate-2 shape shared by plan and build)
    _factory.mds          # factory_shape (draft, review, revise, critic, amend, tracking)
    _ticket_template.mds  # ticket_body_template (writes `Depends on: {ISSUE_REF}, {ISSUE_REF}`)
    _decisions.mds, _settings.mds, _tracker.mds   # contracts KB
```

Partials declare no `output-dir:`; hosts declare it as the last frontmatter key (details in the pins KB). The `Produces:` / `Requires:` annotations in `_engine.mds` and `_wave.mds` name principal upstream orchestrator state as a phase-ordering DAG, not a spawn-field contract. The handoff convention in `_preamble.mds`: when a ticket needs several sequential Code phases, each Code agent appends its own `## Phase {N} Implementation Summary` section of bounded size to `{toplevel}/.devflow/docs/handoff-{branch_slug}.md` (branch-scoped so concurrent sessions do not clobber) and never rewrites an earlier one; the next agent reads only the preceding phase's section via `HANDOFF_FILE`.

## Component Interactions

### The single-ticket engine (dynamic-build, SINGLE mode)

Pre-authoring step 0 resolves the evidence policy and authors `issueRequired` and `applyConventions` into the script (only an explicit "false" turns either off; absent or unrecognised fails closed), and step 0b authors `complianceFrameworks` (any value outside the framework-list grammar means no lens). `meta.phases` is `setup, implement, gate1, gate2, review, gate1-final, report`.

```
setup (Git setup-task: branch, issueId, prLinkLine)
  -> stops, in order: ticket-link-missing, branch-missing
  -> implement (Code: task + plan + DECISIONS_CONTEXT + ISSUE_PR_LINK + COMPLIANCE_FRAMEWORKS)
  -> gate1 #1  (Simplify -> Scrutinize -> Validate; Validate FAIL -> Code validation-fix, up to 2, each re-validated)
  -> gate2     (Evaluate + Test, ONCE, before review; fix-and-continue -> FAIL-FIXED)
  -> review    (single pass)
  -> gate1-final #2 (same sequence, after all fixes)
  -> report    (Synthesize)
```

**Setup.** `OPERATION: setup-task` returns `branch`, `issueId` and `prLinkLine` under its `Return:` JSON contract. `BRANCH` is `setup.branch` as reported, never a name the workflow synthesizes. `ISSUE_NUMBER` is the Issue ID only when it matches `ISSUE_ID_SHAPE` (a bare number or a KEY-number; anything else, "none" included, is no capture, so the stop fails closed), and `ISSUE_PR_LINK` is `prLinkLine` or `"(none)"`. Two `ESCALATED` stops sit before implement: `ticket-link-missing` (issues required but no Issue ID captured; the workflow cannot ask, so it never records an exception) then `branch-missing` (the branch is absent or `(none)`; a correctness stop, not a shape gate on the name).

**Gate 1** is order-load-bearing: Simplify, then Scrutinize, then Validate. Scrutinize returns `PASS | FIXED | BLOCKED`; BLOCKED, or a missing or unrecognised status counted as BLOCKED, stops the pass as `scrutiny-blocked` and Validate does not run on code Scrutinize could not accept. Validate runs last and unconditionally, one full run over the HEAD the two left, so it covers their commits whether or not Scrutinize changed code. A FAIL gets up to two Code `validation-fix` attempts, each followed by a Validate re-run, and the loop carries each recheck's latest failure details into the next attempt (`failureDetails = recheck?.details || failureDetails`) in both Gate 1 #1 and Gate 1 #2; still failing means `validation-exhausted`. Gate 1 holds no Evaluate or Test agent. A Gate 1 #1 escalation returns `ESCALATED` before Gate 2, so Gate 2 and the review pass never run on a broken or unfinished build; a Gate 1 #2 escalation lands in the final result's escalations. Depth scales to change size and budget. Gate 1 runs exactly twice per ticket and never inside the review pass, where fix Code agents self-verify their own builds.

**Gate 2** fires once at implementation acceptance, not after review fixes. One Evaluate agent carries two lenses in one spawn (acceptance criteria including the negative ones; scope and intent drift), so a ticket pays for one spawn and one read of the plan; a wave ticket runs the same skeleton. If no plan exists Evaluate is silently skipped; with no acceptance criteria and no test plan Test is silently skipped, and the build proceeds Gate-1-only (never refuse to build, never fabricate criteria). A failure is fix-and-continue: a Code agent applies the demanded fixes and self-verifies, the verdict becomes `FAIL-FIXED` (issues found, fixes applied, not re-evaluated by design), and the ticket reports UNVERIFIED rather than PASS.

**Verdict.** PASS needs no surviving findings, no coverage gaps, Gate 1 #2 not escalated and no `FAIL-FIXED` Gate 2 verdict. A clean ticket whose only blemish is `FAIL-FIXED` is UNVERIFIED; anything else is PARTIAL (a Gate 1 #2 escalation among it, listed in the result's escalations). The pre-implement stops and a Gate 1 #1 escalation return the verdict ESCALATED. In a wave, PASS and UNVERIFIED merge and every other value quarantines (`tests/dynamic/wave-flow.test.ts` holds that each verdict the engine schema declares has exactly one wave arm).

**Gate ownership.** The full suite has one owner. Each of the six gate agent bodies (Code, Simplify, Evaluate, Scrutinize, Test, Validate) carries one `**Gate ownership:**` row naming the checks that agent runs: Code its targeted tests in the TDD cycle plus one affected-tests run after its last edit (a fix mode compiles and runs only the named failing or regression tests, one build check per batch), Simplify and Evaluate no build, test or lint command, Scrutinize only a test file it added or changed, Test its scenario commands, Validate the whole suite. `tests/guards/gate-ownership.test.ts` pins each row (floor `gate-ownership-body-count`).

### Review pass

The pass runs exactly once per ticket; budget scales roster size and verification votes, never pass count.

1. **Scope**: the entire branch diff from the base branch to HEAD. No base SHA is tracked; Review agents compute the merge-base with the default branch at review time. Full branch, no delta scoping.
2. Spawn Review agents in staggered chunks (`chunkSize` in the script; `review_pass()` states the 4-6 band), sequential groups of parallel spawns, to avoid 429 batch death. The full roster is preserved, only paced.
3. The core focuses always run (security, architecture, performance, complexity, consistency, regression, testing, reliability); focuses for detected file types are added. **The roster is not diff-class gated.** `/dynamic-build` sits outside `/code-review`'s diff-class work: `review_pass()` and the inline script spawn every focus and drop none, with no reduced docs-only, tests-only or lockfile-only set, no language-focus suppression and no diff file or installed-language stamp.
4. **Dead-Review-agent handling**: a result is dead if null, thrown, a guard string, or `reviewed !== true`. Retry once sequentially; if still dead, record it in `coverageGaps`. Gaps block the PASS verdict downstream and do not block the early exit (which triggers on zero findings alone).
5. **Adversarial verification**: a panel of perspective-diverse lenses (`VERIFY_PANEL`: does it reproduce, real or false positive, does the rule apply here), majority-survives (more than half confirm); unconfirmed findings are stripped.
6. **Fix batching**: group confirmed findings by file, sub-batches capped at five findings. Sub-batches for the same file run sequentially, distinct files via `parallel()` in staggered chunks (`FIX_CHUNK`, the same pacing bar as the Review spawns). A finding with no `file` is a singleton batch.
7. **Evidence-gated disposition** (KB-INV-5): a non-empty `unresolved` list means the agent named work it could not finish, so the whole chunk goes to `survivingFindings` rather than guessing which findings the strings map to. `survivingFindings` = findings not addressed (fix Code agent dead, failed or blocked, or committed but left named work).

Early exit when there are no findings, or none survive verification; coverage gaps travel in the return.

### Waves

WAVE mode runs this engine once per ready ticket. The wave loop, merge and undo, quarantine, the untrusted-content wrap, the post-wave-report and the wave PR evidence refresh are in `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md`.

### Ticket-factory pipeline (dynamic-tickets)

Before the workflow runs, the main model proposes a candidate slate and waits for user confirmation, the human gate before the pipeline invests in drafting. Stages: `draft -> [2-lens review in parallel] -> revise -> whole-set critic -> per-ticket amend -> tracking-issue` (`meta.phases`: draft, review, revise, cross-critic, amend, tracking-issue). The two lenses per ticket are Planner-readiness (cold read) and an Accuracy/scope-discipline audit; the whole-set critic (one Design agent, opus) audits coverage, overlaps and contradictions, the dependency graph and acceptance-criteria coherence across the revised set. The `Depends on:` field each ticket writes uses `{ISSUE_REF}` grammar via `_ticket_template.mds` (see the contracts KB).

### Planning pipeline (dynamic-plan)

`AskUserQuestion` happens at the command boundary after the workflow returns. Phases: read-tickets, plan-parallel, plan-challenge, cross-plan-critic, preference-resolve, write-artifacts. The plan-challenge step uses a verbatim intent string (section 5.1 of the design doc); do not paraphrase it when authoring the challenger prompt. The Evaluate agent runs the challenge (not a Review agent). The cross-plan critic finds API conflicts, contradictory invariants, undeclared dependencies and scope overlap. `~/.devflow/preference-profile.md` auto-resolves decisions matching established taste; unresolved ones go to `DECISIONS-NEEDED.md` (under `{worktree}/.devflow/docs/design/{slug}/{ts}/`) for the user, read from the OUTDIR-scoped path the workflow returned. Which spawns receive the decisions index is in the contracts KB.

## Integration Patterns

### Agent `agentType` usage

Every `agent()` call uses `agentType` and never `opts.model`: the agent's frontmatter carries its own tier, honoured automatically, and overriding it defeats per-agent specialization. The tiers below are the shipped ones; a user's `devflow agents` override rewrites the installed frontmatter, and a model named at a spawn outranks that frontmatter, so the override would never reach the spawn.

| agentType | Tier | Role |
|---|---|---|
| Code | sonnet | Writes ALL code, the only agent that does |
| Validate | haiku | Build / typecheck / lint / test |
| Simplify | sonnet | Reduce complexity, remove duplication |
| Scrutinize | opus | 9-pillar self-review |
| Evaluate | opus | Plan-fidelity alignment |
| Test | sonnet | Scenario-based acceptance tests |
| Review | opus | Focus-parameterized review, one `agent()` per focus |
| Git | haiku | Git operations |
| Synthesize | haiku | Summarize and aggregate multi-agent outputs |
| Knowledge | sonnet | Codebase exploration / KB creation |
| Design | opus | Architecture, design, dependency reasoning |

### Workflow runtime contract

The script body has only `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()` and `workflow()`, with globals `args` and `budget`. There is no filesystem, no Node.js and no tracker CLI of any kind (`gh` included). `meta` is a pure literal: no variables, calls, spreads or template interpolation. The pre-flight self-check writes the authored script to the run-unique scratch path (KB-AP-6), runs `node --check`, then passes the script to `Workflow`. The manual checklist (pure `meta` literal, no undefined field access, `filter(Boolean)` before mapping agent results, `phase()` titles matching the declared phases) is the real safeguard for runtime type errors.

## Constraints

**Engine invariants** (`engine_invariants()` in `_engine.mds`) are carried by the Rules above: Code-only writing, verification before fixes, Gate 1 before any merge, Gate 2 once, never auto-merge, no unauthorized side-effects (neutralised from GitHub-bound wording to apply to whatever tracker is resolved; the Iron Rule beside it is unchanged) and the single review pass.

**Concurrency doctrine.** Default sequential. Parallel is the rare, tightly gated exception, only when all three bars hold; two Code agents splitting one task is a coherence hazard, and sequential Code agents passing a handoff artifact produce far more coherent code. "They look independent" is not sufficient; the cost of a wrong parallel call (incoherent merge, contended edits) dwarfs the wall-clock saved. This governs both Code agents on one ticket and multi-ticket scheduling in a wave.

**Budget scaling.** `budget` (a script global) governs Review roster size and verification vote count; never hardcode a roster size. It never changes the number of review passes.

## Anti-Patterns

**KB-AP-1.** `filter(Boolean)` before mapping over agent results prevents a crash; it must never convert a missing result into coverage.

**KB-AP-2.** Review chunks keep the full roster and only pace it, so dropping a focus to save time is a coverage loss, not pacing.

**KB-AP-3.** Same-file concurrent edits cause index contention and lost fixes; distinct-file sub-batches parallelize under the concurrency doctrine.

## Gotchas

### KB-INV-15: build execution doctrine, the shared `## Running commands` block

The Code, Validate and Test agent bodies each carry one byte-identical `## Running commands` block; `tests/guards/running-commands-parity.test.ts` holds it (exactly one block per body within its `BLOCK_MAX_BYTES` target, every normative element present, `build_execution_doctrine()` in `_engine.mds` rendering the same text). The dynamic-build prompt sites that run builds or tests (the Code implementation prompt, the Gate 1 Validate prompts and their re-checks, the Code fixes after Gate 2, the review-batch fix, the Test prompt, the post-merge Validate) each name "your Running commands block" exactly once in source and compiled command (floor `running-commands-site-count`), because a Workflow `agent()` spawn with an `agentType` loads that agent's body as its standing instruction. The doctrine:

1. Foreground, each with an explicit Bash `timeout` above its expected run time. The ceiling is 600000 ms, or `BASH_MAX_TIMEOUT_MS` when set (`echo ${BASH_MAX_TIMEOUT_MS:-600000}`); `devflow flags --set bash-max-timeout-ms=<ms>` (unset by default) raises it.
2. Capture then tail in ONE Bash call (shell state does not persist), echoing the log path first: `LOG=$(mktemp); echo "LOG=$LOG"; <command> >"$LOG" 2>&1; rc=$?; tail -n 40 "$LOG"; echo "EXIT=$rc"`. The printed `EXIT=` value is the result, never a grep count.
3. Never background a command and wait on it, and never poll across turns (no `sleep` or `true` turns, sentinel files or Monitor). Test's dev server is the one background process, in a separate `## Dev server (test.md only)` section after the block.
4. A run that reaches its timeout is BLOCKED: report its duration and log path, and do not wait on it, poll it or re-run it. A run expected to exceed the ceiling is split into parts under about 90% of it; if it cannot be split, report BLOCKED with the flag remedy.
5. Prefer the scoped command, and for the whole set one workspace-level command over a per-package loop. Never re-run a command when nothing it reads has changed. Never wrap a build or test command in `sh -c`, `bash -c`, `python3 -c` or `node -e` (permission rules deny wrapped commands they would allow directly). The engine adds cheapest-sufficient validation and one build gate per phase.

Why foreground is safe (`docs/reference/platform-assumptions.md` holds each row with its drift symptom, measured on Claude Code 2.1.294): a silent 250 s foreground call survived inside a Workflow sub-agent; the stall watchdog fires after about 600 s of model-stream silence after a tool result returns, never while a tool runs; a foreground call that reaches its timeout is moved to the background and finishes, so the printed log path stays valid; and the platform refuses a leading `sleep` (30 s or more on the first measurement, every N on a later one). A sub-agent killed for model silence leaves uncommitted work in its worktree: inspect `git status` there and resume the same task rather than respawning, and never wait on a sub-agent without a deadline. Backgrounding and polling is wrong twice over: the watchdog never fires while a tool runs, and every poll turn re-reads the whole context.

### KB-AP-6: scratch file for `node --check`

The scratch path must be unique per run because rewriting an existing file trips write guards. `node --check` catches syntax errors only.

### KB-AP-5: `--dry-run` only in dynamic-profile

The flag exists only in `dynamic-profile.mds`; the suite pins its absence from the other three compiled commands.

### KB-AP-4: skill re-entrancy in Review and Evaluate agents

An agent that preloads a skill via frontmatter `skills:` must never be told in its body prompt to invoke that same skill with the Skill tool. The guard returns a guard string (`devflow:X already running`), the agent treats it as terminal, returns with zero tool uses, and the Workflow counts it as success, silently masking zero review coverage. Give Review and Evaluate agents full context directly.

### KB-AP-7: acceptance criteria quality bar

A criterion is not acceptable if vague ("the feature should work correctly"), implementation-coupled ("the function must call X") or untestable. At least one negative criterion (what the system MUST NOT do) is required per ticket. These rules are load-bearing because Gate 2's Evaluate and Test agents have no other source of truth.

### KB-INV-13: the per-ticket branch is whatever setup-task reports

Each ticket's `setup-task` spawn creates the branch and reports it under its `### Branch` block (the `- **Branch name**:` line). The workflow binds `BRANCH` from that value for every later phase and the merge; neither the SINGLE-mode script nor the wave loop names a branch, and no `args.branch` override is read (setup-task's Input takes no requested name). Branching happens off integration HEAD at the moment the ticket becomes ready, not at wave start. When setup-task reports none, the workflow stops the ticket before implementing (`verdict: "ESCALATED"`, `escalations: [{ type: "branch-missing", description: "setup-task reported no branch name - check its Output, then re-run" }]`) rather than guess or fall back to a synthesized name (`tests/dynamic/wave-flow.test.ts` holds the binding and both stops).

## Key Files

- `src/assets/commands/_partials/_engine.mds`: canonical Gate 1, Gate 2, `evaluator_panel`, review pass, concurrency, build execution doctrine and invariants (source of truth for engine behavior).
- `src/assets/commands/_partials/_preamble.mds`: `authoring_preamble()` (runtime contract, pre-flight checklist, handoff convention, IRON RULE: no deterministic feature code, SAFETY BANNER: never merge to main).
- `src/assets/commands/_partials/_roster.mds`: valid agentType values, tiers and caveats.
- `src/assets/commands/_partials/_plan_contract.mds`: acceptance criteria and test plan shape shared by dynamic-plan and dynamic-build Gate 2.
- `src/assets/commands/_partials/_factory.mds` and `_ticket_template.mds`: the ticket-factory stages and the canonical ticket body.
- `src/assets/commands/dynamic-build.mds`: the build command with inline SINGLE and WAVE workflow scripts; `dist/commands/dynamic-build.md` is the compiled artifact the suite pins.
- `src/assets/agents/code.mds` (a generator host, compiled to `dist/agents/code.md`), `validate.md`, `test.md`: each carries the `## Running commands` block and its `**Gate ownership:**` row.
- `tests/dynamic/wave-flow.test.ts`: executes the shipped SINGLE script with stub agents (branch binding, both ESCALATED stops, verdict arms).
- `tests/guards/running-commands-parity.test.ts`, `tests/guards/gate-ownership.test.ts`, `tests/guards/spawn-no-hardcoded-model.test.ts`: the block, the six rows and the no-`model=` rule.

## Related

- `.devflow/features/dynamic-workflow-engine-waves/KNOWLEDGE.md`: WAVE mode, quarantine, the wave PR and its evidence refresh.
- `.devflow/features/dynamic-workflow-engine-contracts/KNOWLEDGE.md`: settings block, decisions step and learning arms, `_tracker.mds`, `COMMAND_INPUT`, issue vocabulary, tracker preflight.
- `.devflow/features/dynamic-workflow-engine-pins/KNOWLEDGE.md`: host and partial counts, pinned doctrine literals, marker ownership, gh-issue exceptions, `.mds` gotchas.
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the MDS build pipeline (`scripts/build-mds.ts`), the knowledge host commands and the reference-module host kind that share compilation infrastructure with the dynamic commands.
- `.devflow/features/tracker-references/KNOWLEDGE.md`: the tracker/git reference-module split and the Git agent's provider-resolution preamble.
- `.devflow/features/test-harness/KNOWLEDGE.md`: the guard shape (named collector, seeded probe, ratchet manifest) and the known full-suite-load timeouts.
- `.devflow/features/resolve-pipeline/KNOWLEDGE.md`: `/resolve` also spawns Code in fix modes under the same every-Code-spawn rule.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: installing the learning variant for the machine's learning switch.
- `docs/reference/platform-assumptions.md`: the dated platform facts the foreground doctrine rests on (stall watchdog threshold, timed-out foreground calls, `sleep` refusal, spawn body loading).
