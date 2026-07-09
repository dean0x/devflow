# devflow-resolve

Review issue resolution plugin for Claude Code. Processes review findings through a validation/fix split — a dedicated Triager (opus) assigns blast-radius verdicts before any Coder touches code.

## Installation

```bash
# Via Devflow CLI
npx devflow-kit init --plugin=resolve

# Via Claude Code (when available)
/plugin install dean0x/devflow-resolve
```

## Usage

```
/resolve                           # Resolve issues from latest review
/resolve .devflow/docs/reviews/feature-x/  # Resolve from specific review
```

## Workflow

1. **Triage** — Triager (opus) applies the blast-radius disposition matrix to every issue: SECURITY GATE → FALSE_POSITIVE → BY_DESIGN → FIX_NOW → FIX_SEPARATE → TECH_DEBT / ESCALATED
2. **Fix** — Parallel Coder agents (sonnet, `OPERATION: issue-fix`) fix only FIX_NOW issues; same-file issues run sequentially, distinct-file issues run in parallel; max 5 issues per batch
3. **Simplify** — Simplifier refines changed code for clarity
4. **Verify** — Validator (haiku) runs build/typecheck/lint/test; up to 2 fix-retry cycles via Coder (`OPERATION: validation-fix`); single push fires after this gate regardless of outcome
5. **CI Gate** — Check PR CI status (skipped if no fixes or Verification Gate failed)
6. **Manage Debt** — FIX_SEPARATE and TECH_DEBT items become tracked manage-debt tickets via Git agent
7. **Report** — Resolution summary with Verification, By Design, Fix Separately, and Escalations sections

## Blast-Radius Disposition

| Verdict | When Applied |
|---------|-------------|
| SECURITY GATE | Any security finding — overrides everything; routes to FIX_NOW or ESCALATED |
| FALSE_POSITIVE | Reviewer factually wrong — requires file:line evidence |
| BY_DESIGN | Code is intentional — requires ADR or inline comment citation |
| FIX_NOW | File in diff, isolated fix, or security/correctness in touched path |
| FIX_SEPARATE | Valid but exceeds diff blast radius — becomes a tracked ticket |
| TECH_DEBT | Last resort — complete architectural overhaul only |
| ESCALATED | Security issues requiring human review — surfaced in report, never deferred to manage-debt |

## Components

### Command
- `/resolve` - Process and fix review issues

### Agents
- `git` - Branch validation, manage-debt, CI status
- `triager` - Blast-radius judgment (opus, validation-only — never edits code)
- `coder` - Fix implementation (issue-fix, validation-fix, and ci-fix modes)
- `simplifier` - Code refinement after fixes
- `validator` - Build/typecheck/lint/test verification gate

### Skills (6)
- `patterns` - Implementation guidance
- `security` - Security fix patterns
- `worktree-support` - Multi-worktree path resolution
- `feature-knowledge` - Feature context loading
- `apply-feature-knowledge` - Convention-aware fix application
- `apply-decisions` - ADR/PF citation in Triager verdicts

## Output

- Fixed issues committed to branch
- Tech debt items tracked in GitHub
- Resolution summary with Fix / False Positive / By Design / Fix Separately / Escalations breakdown

## Related Plugins

- [devflow-code-review](../devflow-code-review) - Generate review issues
- [devflow-implement](../devflow-implement) - Original implementation
