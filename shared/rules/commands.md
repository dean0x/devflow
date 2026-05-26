---
name: commands
description: Available devflow workflow commands and plan auto-execution
paths: []
---

# Devflow Workflow Commands

Use `/devflow:<name>` to trigger a workflow:

- `plan` — Design implementation plans with gap analysis and design review
- `implement` — Execute tasks through implementation, quality gates, and PR creation
- `code-review` — Branch review with specialized parallel reviewers
- `resolve` — Process review/analysis issues — validate, fix, or defer
- `debug` — Competing hypothesis investigation with parallel agents
- `explore` — Codebase exploration with structured analysis
- `research` — Multi-type research with trust-aware synthesis
- `release` — Adaptive release with learned configuration
- `self-review` — Simplifier (code clarity) then Scrutinizer (9-pillar quality)
- `bug-analysis` — Proactive bug finding in changed code

## Plan Auto-Execution

When a prompt is a structured implementation plan (contains `## Goal`, `## Steps`,
and `## Files` sections), this is a plan handoff from a prior planning session.
Invoke `devflow:implement` via the Skill tool to execute it.
