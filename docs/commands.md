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

Produces a machine-readable design artifact in `.devflow/docs/design/` consumed by `/implement`.

```
/plan add JWT auth           # From description
/plan #42                    # From GitHub issue
/plan #12 #15 #18           # Multi-issue
/plan                        # From conversation context
```

## /implement

Executes a single task through the complete development lifecycle. Accepts plan documents, GitHub issues, or task descriptions.

1. **Setup** — Auto-create feature branch, parse plan document or fetch issue
2. **Implementation** — Write code on the feature branch
3. **Validation** — Build, typecheck, lint, and test
4. **Refinement** — Simplifier (code clarity) + Scrutinizer (9-pillar quality)
5. **Alignment** — Evaluator verifies implementation matches the original request
6. **QA Testing** — Tester executes scenario-based acceptance tests

Creates a PR when complete.

```
/implement .devflow/docs/design/42-jwt-auth.2026-04-07_1430.md  # From plan document
/implement #42               # From GitHub issue
/implement add JWT auth      # From description
/implement                   # From conversation context
```

## /code-review

Multi-perspective code review with up to 18 specialized reviewers running in parallel:

**Always active:** Security, Architecture, Performance, Complexity, Consistency, Regression, Testing

**Conditionally active** (when relevant files detected): TypeScript, React, Accessibility, Go, Python, Java, Rust, Database, Dependencies, Documentation

Each reviewer produces findings with:
- **Category**: Blocking (must-fix), Should-Fix, Pre-existing (informational)
- **Severity**: CRITICAL, HIGH, MEDIUM, LOW
- **Location**: Exact file:line reference
- **Fix**: Specific code solution

Supports multi-worktree auto-discovery — one command reviews all active branches.

```
/code-review                 # Review current branch (or all worktrees)
/code-review #42             # Review specific PR
```

## /resolve

Processes all issues from `/code-review` reports through a validation/fix split:

1. **Triage** — A single Triager (opus) applies the blast-radius disposition matrix to every issue: FIX_NOW / FALSE_POSITIVE / BY_DESIGN / FIX_SEPARATE / TECH_DEBT / ESCALATED
2. **Fix** — Parallel Coder agents (sonnet) fix only FIX_NOW issues using Standard or Careful protocols
3. **Verify** — A Validator (haiku) gate runs build/typecheck/lint/test; up to 2 fix-retry cycles; single push fires after this gate (pass or fail)
4. **CI Gate** — Check PR CI status (conditional — skipped if no fixes or Verification Gate failed)
5. **Manage Debt** — FIX_SEPARATE and TECH_DEBT items become tracked manage-debt tickets
6. **Report** — Write resolution summary with Verification, By Design, Fix Separately, and Escalations sections

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

1. **Simplifier** — Code clarity, reuse opportunities, efficiency
2. **Scrutinizer** — 9-pillar quality evaluation (correctness, security, performance, etc.)

```
/self-review                 # Review recent changes
```

## /explore

Structured codebase exploration with optional feature knowledge base creation:

1. **Orient** — Skimmer identifies relevant files and patterns
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
2. **Investigate** — Parallel researcher agents explore each domain
3. **Synthesize** — Trust-aware synthesis weights sources by reliability
4. **Report** — Structured findings in `.devflow/docs/research/`

```
/research "what rate limiting libraries exist for Node.js"
/research "how do competitors handle file uploads"
```

## /release

Adaptive project release with learned configuration:

1. **Pre-flight** — Validate branch state, changelog, and version
2. **Execute** — Run release steps (version bump, tag, publish)
3. **Report** — Summary of release outcome

Configuration is learned from prior releases and stored in `.release/RELEASE-FLOW.md`.

```
/release                     # Release using learned config
/release patch               # Specify version bump type
```

## /bug-analysis

Proactive bug finding with static and semantic analysis. Runs specialized analyzers in parallel to find bugs before code review:

1. **Setup** — Determine branch diff, check for incremental analysis via `.last-analysis-head`
2. **Static Analysis** — Run available static analysis tools (Snyk, CodeQL, etc.)
3. **Semantic Analysis** — Parallel BugAnalyzer agents examine code for functional, security, performance, and reliability issues
4. **Synthesize** — Combine static and semantic findings into actionable report
5. **Report** — Write findings to `.devflow/docs/bug-analysis/`

Incremental by default — only analyzes commits since the last run. Findings are compatible with `/resolve` for automatic issue resolution.

```
/bug-analysis                # Analyze current branch (incremental)
/bug-analysis --full         # Full analysis (ignore previous runs)
```

## Ambient Mode

Not a command — a two-hook orchestrator system (git repos only):

**Orchestrator charter** — A `SessionStart` hook (`session-start-orchestrator`) injects a ~535-token charter that establishes the main session as a pure orchestrator, grading sub-agents by complexity (haiku/sonnet/opus) and listing devflow workflows for real-scale work.

**Per-prompt dispatch** — A `UserPromptSubmit` hook (`preamble`) handles three cases: (1) prompts beginning `Implement the following plan:` invoke `devflow:implement`; (2) slash commands are silenced; (3) all other prompts get a 2-line orchestrator reminder. Both hooks are silent outside git repos.
