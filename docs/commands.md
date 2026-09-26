# Commands

Devflow provides commands that orchestrate specialized agents. Commands spawn agents — they never do the work themselves.

## /plan

Unified design planning from requirements discovery through implementation design:

1. **Gate 0** — Confirm understanding of the requirement
2. **Requirements Discovery** — Parallel exploration agents analyze codebase
3. **Gap Analysis** — Identify missing pieces, risks, and dependencies
4. **Gate 1** — Validate scope and gaps with user
5. **Implementation Design** — Parallel planning agents design the approach
6. **Design Review + Gate 2** — Review the design artifact, user approves the final plan

Produces a machine-readable design artifact in `.devflow/docs/design/` consumed by `/implement`, including a `## Test Plan` of TP lines — one per acceptance criterion — checked with `verify-evidence.cjs check tp` before the artifact is written. A multi-issue plan is named `multi-{topic-slug}.{timestamp}.md` with `issue: pending`. When the compliance skill is installed, gap analysis adds a compliance Design agent.

Under a `required` evidence policy, a linked tracker issue is created or enriched and the design artifact is attached to it as a collapsed comment — this is mandatory. Under `standard`, issue linking is optional and prompted. The policy is resolved once per run and reported at the end.

```
/plan add JWT auth           # From description
/plan #42                    # From a tracker issue
/plan #12 #15 #18           # Multi-issue
/plan                        # From conversation context
```

## /implement

Executes a single task through the complete development lifecycle. Accepts plan documents, tracker issues, or task descriptions.

1. **Setup** — Auto-create feature branch, parse plan document or fetch issue, and write the task's test plan (copied from the plan, or one TP line per stated acceptance criterion) to `.devflow/docs/evidence-{branch-slug}.md`. Under a `required` evidence policy, a missing ticket link or test plan is recorded as a self-attested exception or stops the run, before any code is written
2. **Implementation** — Write code on the feature branch
3. **Validation** — Build, typecheck, lint, and test
4. **Refinement** — Simplify (code clarity) + Scrutinize (9-pillar quality)
5. **Alignment** — Evaluate verifies implementation matches the original request
6. **QA Testing** — Test executes scenario-based acceptance tests and records one claim per TP line
7. **CI Gate** — Poll the PR's checks and fix failures (skipped when Code agents ran in parallel)
8. **Evidence** — Push, then refresh the PR's test-plan block and post its evidence comment

Creates a PR when complete; its body carries the test-plan block and any `## Evidence Exceptions`.

```
/implement .devflow/docs/design/42-jwt-auth.2026-04-07_1430.md  # From plan document
/implement #42               # From a tracker issue
/implement add JWT auth      # From description
/implement                   # From conversation context
```

## /code-review

Multi-perspective code review with up to 20 specialized Review agents running in parallel:

**Always active:** Security, Architecture, Performance, Complexity, Consistency, Regression, Testing, Reliability

**Conditionally active** (when relevant files detected): TypeScript, React, Accessibility, UI Design, Go, Python, Java, Rust, Database, Dependencies, Documentation. The eight language focuses run only when their optional plugin's skill is installed.

**Diff-driven** (when compliance skill installed and diff touches regulated surface): Compliance

Before reviewing, the Git agent commits, pushes and opens the PR if none exists — pasting `/implement`'s test-plan block into a PR it creates and, under a `required` evidence policy, retitling the PR to the learned naming conventions. `/code-review` carries no ticket gate.

Each Review agent produces findings with:
- **Category**: Blocking (must-fix), Should-Fix, Pre-existing (informational)
- **Severity**: CRITICAL, HIGH, MEDIUM, LOW
- **Location**: Exact file:line reference
- **Fix**: Specific code solution

Supports multi-worktree auto-discovery — one command reviews all active branches. After each review cycle, a consolidated summary comment is posted to the PR (marker-deduped — skipped if a comment for the current cycle is already present).

```
/code-review                 # Review current branch (or all worktrees)
/code-review #42             # Review specific PR
```

### PR-comment publication

Applies to `/code-review` and `/resolve`. On public repositories, Devflow posts a counts-only stub comment by default (visibility is probed at run time; the gate fails closed to the stub on any error). Set `reviewPublication: full` in `.devflow/config.json` to post the full report regardless of repo visibility, or `off` to disable comment posting (`auto` is the default). Under a `required` evidence policy, `off` resolves to `stub`: the counts-only stub still posts, so a record reaches the PR (`stub` is not a value you can configure). The test-plan evidence comment — posted by `/implement`, `/resolve` and `/dynamic-build`'s wave PR — makes no visibility probe: it is the stub under `auto`, full only under `full`, and absent under `off` unless the policy turned `off` into `stub`. Every body posted to GitHub — whether a full report or a stub — is run through the `redact-secrets.cjs` scrubber unconditionally; if the scrubber is missing (stale `~/.devflow` before running `devflow init`) or exits non-zero, the post is suppressed and `TRACEABILITY: DEGRADED (redaction unavailable)` is reported rather than publishing unredacted content.

## /resolve

Processes all issues from `/code-review` reports through a validation/fix split:

1. **Triage** — A single Triage agent (opus) applies the blast-radius disposition matrix to every issue: FIX_NOW / FALSE_POSITIVE / BY_DESIGN / FIX_SEPARATE / TECH_DEBT / ESCALATED / DUPLICATE
2. **Fix** — Parallel Code agents (sonnet) fix only FIX_NOW issues using Standard or Careful protocols
3. **Verify** — A Validate agent (haiku) gate runs build/typecheck/lint/test; up to 2 fix-retry cycles; single push fires after this gate (pass or fail)
4. **CI Gate** — Check PR CI status (conditional — skipped if no fixes or Verification Gate failed)
5. **Manage Debt** — FIX_SEPARATE and TECH_DEBT items become tracked manage-debt tickets
6. **External Threads** — Under a `required` evidence policy, review threads from other authors are fetched before triage; after the fix, each gets a reply, and only verifiably fixed ones are resolved
7. **Resolution Comment** — Post the resolution summary as a single consolidated PR comment (marker-deduped — skipped if already posted; always runs when a PR is known)
8. **Evidence** — When this run moved the PR's head, re-test the test-plan lines the push made stale, then refresh the PR's test-plan block and evidence comment
9. **Merge Readiness** — Under a `required` evidence policy, a report-only check: no unresolved threads, an approving review, passing CI, every TP verified (or a test-plan exception) and a trusted non-author approval
10. **Report** — Write resolution summary with Verification, By Design, Fix Separately, and Escalations sections; duplicate findings reported by multiple Review agents are collapsed via the DUPLICATE verdict so Statistics counts reflect unique issues

```
/resolve                     # Resolve latest review (or all worktrees)
/resolve #42                 # Resolve specific PR's review
/resolve --review 2026-03-28_0900  # Resolve specific review run
```

## /debug

Investigates bugs using competing hypotheses:

1. **Hypothesis Generation** — Identify 3-5 plausible explanations
2. **Parallel Investigation** — Each hypothesis investigated independently by separate agents
3. **Evidence Evaluation** — Hypotheses ranked by supporting evidence
4. **Root Cause** — Best-supported explanation with fix recommendation

```
/debug "login fails after session timeout"
/debug #42                   # Investigate from GitHub issue
```

## /self-review

Self-review workflow that runs two sequential quality passes:

1. **Simplify** — Code clarity, reuse opportunities, efficiency
2. **Scrutinize** — 9-pillar quality evaluation (correctness, security, performance, etc.)

```
/self-review                 # Review recent changes
```

## /explore

Structured codebase exploration with optional feature knowledge base creation:

1. **Orient** — Skim identifies relevant files and patterns
2. **Deep Dive** — Explore agents analyze architecture, flows, and conventions
3. **Synthesize** — Combine findings into a structured summary
4. **Persist** — Optionally create a feature knowledge base in `.devflow/features/`

```
/explore "how does the auth middleware work"
/explore "map the data pipeline"
```

## /research

Multi-type research with parallel investigators and trust-aware synthesis:

1. **Classify** — Determine research types needed (codebase, external, competitor, market, technology)
2. **Investigate** — Parallel Research agents explore each domain
3. **Synthesize** — Trust-aware synthesis weights sources by reliability
4. **Report** — Structured findings in `.devflow/docs/research/`

```
/research "what rate limiting libraries exist for Node.js"
/research "how do competitors handle file uploads"
```

## /release

Adaptive project release with learned configuration:

1. **Pre-flight** — Validate branch state, changelog, and version. The last release tag comes from `release-trace.cjs last-tag`, which ignores tags that are not `vX.Y.Z` versions
2. **Traceability** — Under a `required` evidence policy (and on every `--dry-run`), gather the release evidence and a per-commit trace map before the confirm. Untraced commits, or unknown coverage, are either recorded as self-attested exceptions in the release notes or halt the release
3. **Execute** — Version bump, changelog, release commit, tag and GitHub release. Under `required`, the notes carry the commit list and any exceptions, each shipped issue gets a back-link comment, and the shipped issues are added to the release marker — a GitHub milestone, Jira fixVersion or Linear label, added and never replaced
4. **Report** — Summary of release outcome

Release notes over 60,000 characters drop the commit list first, then cut the changelog at a line boundary with a truncation note; the exceptions are never dropped. Configuration is learned from prior releases and stored in `.release/RELEASE-FLOW.md`.

```
/release                     # Release using learned config
/release patch               # Specify version bump type
/release --dry-run           # Show the plan and the trace map, change nothing
```

## /bug-analysis

Proactive bug finding with static and semantic analysis. Runs specialized analyzers in parallel to find bugs before code review:

1. **Pre-flight** — The Git agent commits, pushes and opens the PR if none exists (retitled to the learned naming conventions under a `required` evidence policy); no ticket is required
2. **Static Analysis** — Detect incremental analysis via `.last-analysis-head`, then run the available tools: Semgrep and Snyk in parallel, CodeQL when `--full` is set or they found HIGH/CRITICAL issues
3. **Semantic Analysis** — Parallel Diagnose agents examine the diff: security and functional always, integration when two or more directories changed, usability when UI files changed
4. **Synthesize** — Combine static and semantic findings into actionable report
5. **Report** — Write findings to `.devflow/docs/bug-analysis/`

Incremental by default — only analyzes commits since the last run. Findings are compatible with `/resolve` for automatic issue resolution.

```
/bug-analysis                # Analyze current branch (incremental)
/bug-analysis --full         # Full analysis (ignore previous runs)
```

## Running the full pipeline

The three dynamic commands form a sequential delivery pipeline — each stage produces output consumed by the next:

```
/dynamic-tickets <initiative>   # decompose initiative into tickets
                                # ↓ review the ticket slate
/dynamic-plan <ticket-dir>      # plan + challenge each ticket
                                # ↓ answer DECISIONS-NEEDED.md
/dynamic-build <ticket-dir>     # implement, review, and verify
                                # ↓ review wave-report.md and merge
```

The command boundary is the human gate: each stage returns to you before the next begins — there is no automatic hand-off between them.

## /dynamic-tickets

Generalized ticket-factory — turn an initiative or spec into a reviewed, wave-structured ticket slate with a tracking issue.

Breaks an initiative or feature spec into discrete, dependency-ordered implementation tickets. Each ticket gets an acceptance-criteria block and a wave assignment. Produces the ticket files and a tracking-issue document, written by the Synthesize agent, under `.devflow/docs/tickets/{slug}/{timestamp}/`.

Under a `required` evidence policy, once the workflow returns, the Git agent files the tracking issue and then one issue per ticket in dependency order, at most 50 in all. Each reference is written back into its file as an `**Issue:**` line, and each ticket's issue names its dependencies by reference; `/dynamic-build` reads those lines. Under `standard` nothing is filed. An issue the Git agent cannot file stays a local file and is reported `TRACEABILITY: DEGRADED`.

Typical flow: write a spec (`spec.md`), run `/dynamic-tickets` over it, then deliver wave by wave — `/dynamic-plan` on a wave, `/dynamic-build` on that plan, and repeat for the next wave until the spec is shipped. Suited to system-scale work; for a single feature, prefer the orchestrated `/plan` → `/implement` flow.

```
/dynamic-tickets <initiative-description-or-file>
```

## /dynamic-plan

Parallel wave planning — plan-challenge every ticket, produce acceptance criteria + test plans, auto-resolve decisions against the preference profile, output DECISIONS-NEEDED.md.

Takes a ticket directory (from `/dynamic-tickets`) or a list of tracker issues and runs a parallel planning pass: for each ticket, challenges the design, writes detailed acceptance criteria and a test plan of TP lines, and resolves known decisions against `~/.devflow/preference-profile.md`. After the workflow, each plan's test plan is checked with `verify-evidence.cjs check tp`, and a malformed one is named in the report. Plans and `DECISIONS-NEEDED.md` land under `.devflow/docs/design/{slug}/{timestamp}/`; unresolved decisions go to the user for review.

```
/dynamic-plan <ticket-dir>
```

## /dynamic-build

Dependency-aware build engine — implement, review, and verify a single ticket or a full wave of tickets using devflow agents.

Executes the devflow implement→review→verify pipeline for one ticket or all tickets in a wave, respecting dependency order. Each ticket runs as a separate Code agent on the branch the Git agent's setup-task created for it — the engine never names a branch itself, and a ticket whose setup reports no branch stops; cross-ticket dependencies block until their prerequisites are merged into the integration branch.

**Tracking-issue argument (optional)**: pass an explicit issue reference or URL, or the command reads the `**Issue:**` line of the `tracking-issue.md` written by `/dynamic-tickets`. The tracking issue never reaches a ticket — each ticket builds against its own issue. After the wave, the Git agent posts the wave report as a comment on the tracking issue. If none is found, the run continues and notes `TRACEABILITY: DEGRADED (no tracking issue for this run)` in the summary.

**Wave PR**: after a wave that merged at least one ticket, the end-of-run questions include one asking whether to open a PR from the `wave/{slug}` integration branch. Its body closes each merged ticket's issue, references each quarantined one, and names the tracking issue only in a `Refs` line — never `Closes`, because it outlives the wave. It also carries a Wave Evidence table and the wave's combined test plan. Under a `required` evidence policy, a merged ticket without a ticket link or a usable test plan blocks the wave PR. Once it is open, a Test agent runs the wave test plan on the integration branch and the PR's test-plan block and evidence comment are refreshed. The wave PR is never merged by devflow — you merge it.

```
/dynamic-build <ticket-dir>          # Build all tickets in a wave
/dynamic-build <ticket-file>         # Build a single ticket
```

## /dynamic-profile

Decision-preference profile distiller — mine past session transcripts across all projects to write `~/.devflow/preference-profile.md`.

Scans Claude Code session transcripts from all known projects, extracts repeated design and implementation preferences (style choices, library selections, architectural patterns), and writes a structured preference profile. Consumed by `/dynamic-plan` to auto-resolve common decisions without human intervention.

```
/dynamic-profile
```

## Ambient Mode

Not a command — a two-hook orchestrator system (git repos only):

**Orchestrator charter** — A `SessionStart` hook (`session-start-orchestrator`) injects a ~500-token charter that establishes the main session as a pure orchestrator, routing each delegation to the roster agent that fits the kind of work — never pinning a model, so each agent runs on its configured model — and listing devflow workflows for real-scale work.

**Per-prompt dispatch** — A `UserPromptSubmit` hook (`preamble`) handles three cases: (1) prompts beginning `Implement the following plan:` invoke `devflow:implement`; (2) slash commands are silenced; (3) all other prompts get a 2-line orchestrator reminder. Both hooks are silent outside git repos.
