---
description: Comprehensive branch review using agent teams for adversarial peer review with debate and consensus
---

# Code Review Command

Run a comprehensive code review of the current branch by spawning a review team where agents debate findings, then synthesize consensus results into PR comments. Supports incremental reviews, timestamped report directories, and multi-worktree auto-discovery.

## Usage

```
/code-review           (review current branch — or all worktrees if multiple found)
/code-review #42       (review specific PR)
/code-review --full    (force full-branch review, ignore previous review state)
/code-review --path /path/to/worktree  (review a specific worktree only)
```

## Phases

### Phase 0: Worktree Discovery & Pre-Flight

#### Step 0a: Discover Worktrees

1. Run `git worktree list --porcelain` to discover all worktrees
2. For each worktree, extract path and branch
3. **Filter to reviewable worktrees:**
   - Must be on a named branch (skip detached HEAD)
   - Must NOT be on a protected branch (main, master, develop, release/*, staging, production)
   - Must NOT be mid-rebase or mid-merge (check `git -C {path} status` for "rebase in progress" / "merging")
4. **If `--path` flag provided:** use only that worktree, skip discovery
5. **If only 1 reviewable worktree** (the common case): proceed as single-worktree flow — zero behavior change
6. **If multiple reviewable worktrees:** report "Found N worktrees with reviewable branches: {list with paths and branches}" and proceed with multi-worktree flow
7. **Deduplicate by branch:** if two worktrees are on the same branch, use only the first worktree's path

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

For each reviewable worktree, spawn Git agent:

```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report. In multi-worktree mode, report the failure but continue with other worktrees.

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number` per worktree.

#### Step 0c: Incremental Detection & Timestamp Setup

For each worktree:

1. Generate timestamp: `YYYY-MM-DD_HHMM`. If directory already exists (same-minute collision), append seconds (`YYYY-MM-DD_HHMMSS`).
2. Create timestamped review directory: `mkdir -p {worktree}/.docs/reviews/{branch-slug}/{timestamp}/`
3. Check if `{worktree}/.docs/reviews/{branch-slug}/.last-review-head` exists:
   - **If yes AND `--full` NOT set:**
     - Read the SHA from the file
     - Verify reachable: `git -C {worktree} cat-file -t {sha}` (handles rebases — if unreachable, fallback to full)
     - Check if SHA == current HEAD → if so, skip review: "No new commits since last review. Use --full for a full re-review."
     - Set `DIFF_RANGE` to `{last-review-sha}...HEAD`
   - **If no (first review), or `--full`:**
     - Set `DIFF_RANGE` to `{base_branch}...HEAD`

### Phase 1: Analyze Changed Files

Per worktree, detect file types in diff using `DIFF_RANGE` to determine conditional reviews:

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

**Per worktree**, create an agent team for adversarial review. Always include 4 core perspectives; conditionally add more based on Phase 1 analysis.

**Note**: In multi-worktree mode, process worktrees sequentially for Agent Teams (one team per session constraint). Each worktree gets its own team lifecycle: create → debate → synthesize → cleanup.

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
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    1. Read your skill: `Read ~/.claude/skills/security-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git {-C worktree_path} diff {DIFF_RANGE}`
    5. Apply the 6-step review process from review-methodology
    6. Focus: injection, auth bypass, crypto misuse, OWASP vulnerabilities
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to {worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/security.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Security review done")

- Name: "architecture-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    1. Read your skill: `Read ~/.claude/skills/architecture-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git {-C worktree_path} diff {DIFF_RANGE}`
    5. Apply the 6-step review process from review-methodology
    6. Focus: SOLID violations, coupling, layering issues, modularity problems
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to {worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/architecture.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Architecture review done")

- Name: "performance-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    1. Read your skill: `Read ~/.claude/skills/performance-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git {-C worktree_path} diff {DIFF_RANGE}`
    5. Apply the 6-step review process from review-methodology
    6. Focus: N+1 queries, memory leaks, algorithm issues, I/O bottlenecks
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to {worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/performance.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Performance review done")

- Name: "quality-reviewer"
  Prompt: |
    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    1. Read your skills:
       - `Read ~/.claude/skills/complexity-patterns/SKILL.md`
       - `Read ~/.claude/skills/consistency-patterns/SKILL.md`
       - `Read ~/.claude/skills/test-patterns/SKILL.md`
       - `Read ~/.claude/skills/regression-patterns/SKILL.md`
    2. Read review methodology: `Read ~/.claude/skills/review-methodology/SKILL.md`
    3. Read `.memory/knowledge/pitfalls.md` if it exists. Check for known pitfall patterns in the diff.
    4. Get the diff: `git {-C worktree_path} diff {DIFF_RANGE}`
    5. Apply the 6-step review process from review-methodology
    6. Focus: complexity, test gaps, pattern violations, regressions, naming
    7. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    8. Include file:line references for every finding
    9. Write your report: `Write to {worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/quality.md`
    10. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "Quality review done")

[Add conditional perspectives based on Phase 1 — follow same pattern:
 explicit skill path, diff command with DIFF_RANGE, output path in timestamped dir, SendMessage for completion]
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
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Read reviews from {worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/
Create inline PR comments. Deduplicate overlapping findings.
Consolidate skipped findings into summary comment.
Include confidence levels from debate consensus.
Check for existing inline comments at same file:line before creating new ones."
```

**Lead synthesizes review summary** (written to `{worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/review-summary.md`):

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

### Phase 5: Write Review Head Marker

Per worktree, after successful completion:
1. Write current HEAD SHA to `{worktree_path}/.docs/reviews/{branch-slug}/.last-review-head`

### Phase 6: Record Pitfalls (Sequential)

**IMPORTANT**: Run sequentially across all worktrees (not in parallel) to avoid GitHub API conflicts.

Per worktree, if the review summary contains CRITICAL or HIGH blocking issues:
1. Read `~/.claude/skills/knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls to `.memory/knowledge/pitfalls.md`
2. Source field: `/code-review {branch}`
3. Skip entirely if no CRITICAL/HIGH blocking issues

### Phase 7: Cleanup and Report

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

In multi-worktree mode, report results per worktree with aggregate summary.

## Architecture

```
/code-review (orchestrator - creates team, coordinates debate)
│
├─ Phase 0: Worktree Discovery & Pre-flight
│  ├─ Step 0a: git worktree list → filter reviewable
│  ├─ Step 0b: Git agent (ensure-pr-ready) per worktree [parallel]
│  └─ Step 0c: Incremental detection + timestamp setup per worktree
│
├─ Phase 1: Analyze changed files per worktree
│  └─ Detect file types for conditional perspectives
│
├─ Phase 2: Spawn review team (per worktree, sequential for teams)
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
│  ├─ Git agent (comment-pr with consensus findings + dedup)
│  └─ Lead writes review-summary with confidence levels
│
├─ Phase 5: Write .last-review-head per worktree
│
├─ Phase 6: Record Pitfalls (SEQUENTIAL across worktrees)
│
└─ Phase 7: Cleanup and display results
```

## Edge Cases

| Case | Handling |
|------|----------|
| No new commits since last review | Skip review, report: "No new commits since last review. Use --full for a full re-review." |
| Rebase invalidates `.last-review-head` SHA | `git cat-file -t` check fails → fallback to full diff |
| Same-minute review collision | `mkdir` fails → retry with seconds appended (`YYYY-MM-DD_HHMMSS`) |
| Worktree in detached HEAD | Filtered out (no branch name → not reviewable) |
| Worktree mid-rebase or mid-merge | Filtered out by status check |
| Two worktrees on same branch | Deduplicate by branch — review once, use first worktree's path |
| Worktree on protected branch | Filtered out (not reviewable) |
| Worktree pre-flight fails | Report failure, continue with other worktrees |
| `--full` in multi-worktree mode | Applies to all worktrees (global modifier) |
| Multi-worktree with Agent Teams | Process worktrees sequentially (one team per session) |
| Duplicate PR comments | Git agent checks for existing comments at same file:line |

## Backwards Compatibility

- **Single worktree**: Auto-discovery finds only one worktree → proceeds exactly as before. Zero behavior change.
- **Legacy flat layout**: New runs create timestamped subdirectories. Old flat files remain untouched.

## Principles

1. **Adversarial review** - Reviewers challenge each other's findings, not just report independently
2. **Consensus confidence** - Findings classified by agreement level (HIGH/MEDIUM/LOW)
3. **Orchestration only** - Command spawns team, coordinates debate, doesn't do review work itself
4. **Git agent for git work** - All git operations go through Git agent
5. **Bounded debate** - Max 2 exchange rounds, then converge
6. **Honest reporting** - Report disagreements with evidence, don't paper over conflicts
7. **Cleanup always** - Team resources released even on failure
8. **Incremental by default** - Only review new changes unless `--full` specified
9. **Auto-discover worktrees** - One command handles all reviewable branches
