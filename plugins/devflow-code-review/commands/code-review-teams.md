---
description: Comprehensive branch review using agent teams for adversarial peer review with debate and consensus
---

# Code Review Command

Run a comprehensive code review of the current branch by spawning a review team where agents debate findings, then synthesize consensus results into PR comments.

## Usage

```
/code-review           (review current branch)
/code-review #42       (review specific PR)
```

## Phases

### Phase 0: Pre-Flight (Git Agent)

Spawn Git agent to validate and prepare branch:

```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

**If BLOCKED:** Stop and report the blocker to user.

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number` for use in subsequent phases.



### Phase 1: Analyze Changed Files

Detect file types in diff to determine conditional reviews:

| Condition | Adds Perspective |
|-----------|-----------------|
| Any .ts or .tsx files | typescript |
| .tsx or .jsx files (React components) | react |
| .tsx or .jsx files (React components) | accessibility |
| .tsx/.jsx/.css/.scss files | frontend-design |
| .go files | go |
| .java files | java |
| .py files | python |
| .rs files | rust |
| DB/migration files | database |
| Dependency files changed | dependencies |
| Docs or significant code | documentation |

**Skill availability check**: Language/ecosystem reviews (typescript, react, accessibility, frontend-design, go, java, python, rust) require their optional skill plugin to be installed. Before adding a conditional perspective, use Read to check if `~/.claude/skills/{focus}/SKILL.md` exists. If Read returns an error (file not found), **skip that perspective** — the language plugin isn't installed. Non-language reviews (database, dependencies, documentation) use skills bundled with this plugin and are always available.

### Phase 2: Spawn Review Team

Create an agent team for adversarial review. Always include 4 core perspectives; conditionally add more based on Phase 1 analysis.

**Core perspectives (always):**
- **Security**: vulnerabilities, injection, auth, crypto issues
- **Architecture**: SOLID violations, coupling, layering, modularity
- **Performance**: queries, algorithms, caching, I/O bottlenecks
- **Quality**: complexity, tests, consistency, regression, naming

**Conditional perspectives (based on changed files):**
- **TypeScript**: type safety, generics, utility types (if .ts/.tsx changed)
- **React**: hooks, state, rendering, composition (if .tsx/.jsx changed)
- **Accessibility**: ARIA, keyboard nav, focus management (if .tsx/.jsx changed)
- **Frontend Design**: visual consistency, spacing, typography (if .tsx/.jsx/.css changed)
- **Go**: error handling, interfaces, concurrency (if .go changed)
- **Java**: records, sealed classes, composition (if .java changed)
- **Python**: type hints, protocols, data modeling (if .py changed)
- **Rust**: ownership, error handling, type system (if .rs changed)
- **Database**: schema, queries, migrations, indexes (if DB files changed)
- **Dependencies**: CVEs, versions, licenses, supply chain (if package files changed)
- **Documentation**: doc drift, missing docs, stale comments (if docs or significant code changed)

```
Create a team named "review-{branch_slug}" to review PR #{pr_number}.

Spawn review teammates with self-contained prompts:

- Name: "security-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    1. Read your skill: `Read ~/.claude/skills/security-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git diff {base_branch}...HEAD`
    5. Apply the 6-step review process from review-methodology
    6. Focus: injection, auth bypass, crypto misuse, OWASP vulnerabilities
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to .docs/reviews/{branch_slug}/security.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Security review done")

- Name: "architecture-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    1. Read your skill: `Read ~/.claude/skills/architecture-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git diff {base_branch}...HEAD`
    5. Apply the 6-step review process from review-methodology
    6. Focus: SOLID violations, coupling, layering issues, modularity problems
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to .docs/reviews/{branch_slug}/architecture.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Architecture review done")

- Name: "performance-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    1. Read your skill: `Read ~/.claude/skills/performance-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git diff {base_branch}...HEAD`
    5. Apply the 6-step review process from review-methodology
    6. Focus: N+1 queries, memory leaks, algorithm issues, I/O bottlenecks
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to .docs/reviews/{branch_slug}/performance.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Performance review done")

- Name: "quality-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    1. Read your skills:
       - `Read ~/.claude/skills/complexity-patterns/SKILL.md`
       - `Read ~/.claude/skills/consistency-patterns/SKILL.md`
       - `Read ~/.claude/skills/test-patterns/SKILL.md`
       - `Read ~/.claude/skills/regression-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git diff {base_branch}...HEAD`
    5. Apply the 6-step review process from review-methodology
    6. Focus: complexity, test gaps, pattern violations, regressions, naming
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to .docs/reviews/{branch_slug}/quality.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Quality review done")

[Add conditional perspectives based on Phase 1 — follow same pattern:
 explicit skill path, diff command, output path, SendMessage for completion]
```

### Phase 3: Debate Round

After all reviewers complete initial analysis, lead initiates adversarial debate:

Lead initiates debate via broadcast:

```
SendMessage(type: "broadcast", summary: "Debate: share and challenge findings"):
"All reviewers: Share your top 3-5 findings. Then challenge findings
from other reviewers you disagree with. Provide counter-evidence with
file:line references.

Rules:
- Security: challenge architecture claims that affect attack surface
- Architecture: challenge performance suggestions that break separation
- Performance: challenge complexity assessments with benchmarking context
- Quality: validate whether tests cover security and performance concerns

Max 2 exchange rounds. Then submit final findings with confidence:
- HIGH: Unchallenged or survived challenge with evidence
- MEDIUM: Majority agreed, dissent noted
- LOW: Genuinely split, both perspectives included"
```

Reviewers message each other directly using SendMessage:
- `SendMessage(type: "message", recipient: "{reviewer-name}", summary: "Challenge: {topic}")` to challenge a specific finding
- `SendMessage(type: "message", recipient: "{reviewer-name}", summary: "Validate: {topic}")` to validate alignment
- `SendMessage(type: "message", recipient: "team-lead", summary: "Escalation: {topic}")` for unresolvable disagreements
- Update or withdraw findings based on peer evidence

### Phase 4: Synthesis and PR Comments

**WAIT** for debate to complete, then lead produces outputs.

Spawn 2 agents **in a single message**:

**Git Agent (PR Comments)**:
```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: comment-pr
Read reviews from .docs/reviews/{branch_slug}/
Create inline PR comments. Deduplicate overlapping findings.
Consolidate skipped findings into summary comment.
Include confidence levels from debate consensus."
```

**Lead synthesizes review summary** (written to `.docs/reviews/{branch_slug}/review-summary.{timestamp}.md`):

```markdown
## Review Summary: {branch}

### Merge Recommendation
{APPROVE / REQUEST_CHANGES / BLOCK}

### Consensus Findings (HIGH confidence)
{Findings all reviewers agreed on or that survived challenge}

### Majority Findings (MEDIUM confidence)
{Findings most agreed on, with dissenting view noted}

### Split Findings (LOW confidence)
{Genuinely contested, both perspectives with evidence}

### Issue Counts
- 🔴 Blocking: {count}
- ⚠️ Should-fix: {count}
- ℹ️ Pre-existing: {count}

### Debate Summary
{Key exchanges that changed findings}
```

### Phase 4.5: Record Pitfalls (if blocking issues found)

If the review summary contains CRITICAL or HIGH blocking issues:
1. Read `~/.claude/skills/knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls to `.memory/knowledge/pitfalls.md`
2. Source field: `/code-review {branch}`
3. Skip entirely if no CRITICAL/HIGH blocking issues

### Phase 5: Cleanup and Report

Shut down all review teammates explicitly:

```
For each teammate in [security-reviewer, architecture-reviewer, performance-reviewer, quality-reviewer, ...conditional]:
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Review complete")
  Wait for shutdown_response (approve: true)

TeamDelete
Verify TeamDelete succeeded. If failed, retry once after 5s. If retry fails, HALT.
```

Display results:
- Merge recommendation with confidence level
- Issue counts by category (🔴 blocking / ⚠️ should-fix / ℹ️ pre-existing)
- PR comments created/skipped (from Git agent)
- Key debate highlights
- Artifact paths

## Architecture

```
/code-review (orchestrator - creates team, coordinates debate)
│
├─ Phase 0: Pre-flight
│  └─ Git agent (ensure-pr-ready)
│
├─ Phase 1: Analyze changed files
│  └─ Detect file types for conditional perspectives
│
├─ Phase 2: Spawn review team
│  ├─ Security Reviewer (teammate)
│  ├─ Architecture Reviewer (teammate)
│  ├─ Performance Reviewer (teammate)
│  ├─ Quality Reviewer (teammate)
│  └─ [Conditional: TypeScript, React, A11y, Design, Go, Java, Python, Rust, DB, Deps, Docs]
│
├─ Phase 3: Debate round
│  └─ Reviewers challenge each other (max 2 rounds)
│
├─ Phase 4: Synthesis
│  ├─ Git agent (comment-pr with consensus findings)
│  └─ Lead writes review-summary with confidence levels
│
├─ Phase 4.5: Record Pitfalls (inline, if blocking issues)
│
└─ Phase 5: Cleanup and display results
```

## Principles

1. **Adversarial review** - Reviewers challenge each other's findings, not just report independently
2. **Consensus confidence** - Findings classified by agreement level (HIGH/MEDIUM/LOW)
3. **Orchestration only** - Command spawns team, coordinates debate, doesn't do review work itself
4. **Git agent for git work** - All git operations go through Git agent
5. **Bounded debate** - Max 2 exchange rounds, then converge
6. **Honest reporting** - Report disagreements with evidence, don't paper over conflicts
7. **Cleanup always** - Team resources released even on failure

