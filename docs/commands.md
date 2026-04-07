# Commands

Devflow provides five commands that orchestrate specialized agents. Commands spawn agents — they never do the work themselves.

## /implement

Executes a single task through the complete development lifecycle:

1. **Setup** — Auto-create feature branch (detects repo naming conventions)
2. **Exploration** — Analyze codebase for relevant patterns and dependencies
3. **Planning** — Design the implementation approach
4. **Implementation** — Write code on the feature branch
5. **Validation** — Build, typecheck, lint, and test
6. **Refinement** — Simplifier (code clarity) + Scrutinizer (9-pillar quality)
7. **Alignment** — Evaluator verifies implementation matches the original request
8. **QA Testing** — Tester executes scenario-based acceptance tests

Creates a PR when complete.

```
/implement add JWT auth      # From description
/implement #42               # From GitHub issue
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

Processes all issues from `/code-review` reports:

1. **Parse** — Extract all issues from the latest unresolved review
2. **Batch** — Group by file/function for efficient resolution
3. **Resolve** — Parallel resolver agents validate each issue, then:
   - **Fix** standard issues directly
   - **Fix carefully** (public API, shared state, core logic) with systematic test-first refactoring
   - **Won't Fix** impractical issues (e.g., micro-optimizing startup code)
   - **Defer** only genuine architectural overhauls to tech debt
4. **Simplify** — Clean up all modified files
5. **Report** — Write resolution summary with full decision audit trail

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

## Ambient Mode

Not a command — an always-on hook that classifies every prompt and loads proportional skill sets:

| Depth | When | What happens |
|-------|------|-------------|
| **QUICK** | Chat, git ops, trivial edits | Zero overhead — respond normally |
| **GUIDED** | Small implementations, focused debugging | Skills loaded, main session implements |
| **ORCHESTRATED** | Complex tasks, multi-file changes | Full agent pipeline (same as slash commands) |
