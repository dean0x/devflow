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

**Produces:** WORKTREES

1. **Discover reviewable worktrees** using the `devflow:worktree-support` skill discovery algorithm:
   - Run `git worktree list --porcelain` → parse, filter (skip protected/detached/mid-rebase), dedup by branch, sort by recent commit
   - See `~/.claude/skills/devflow:worktree-support/SKILL.md` for the full 7-step algorithm and canonical protected branch list
2. **If `--path` flag provided:** use only that worktree, skip discovery
   **`--path` validation**: Before proceeding, verify the path exists as a directory and appears in `git worktree list` output. If not: report error and stop.
3. **If only 1 reviewable worktree** (the common case): proceed as single-worktree flow — zero behavior change
4. **If multiple reviewable worktrees:** report "Found N worktrees with reviewable branches: {list with paths and branches}" and proceed with multi-worktree flow

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

**Produces:** BRANCH_INFO, PR_INFO
**Requires:** WORKTREES

For each reviewable worktree, spawn Git agent:

```
Agent(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report. In multi-worktree mode, report the failure but continue with other worktrees.

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number` per worktree.

#### Step 0c: Incremental Detection & Timestamp Setup

**Produces:** DIFF_RANGE, REVIEW_DIR, TIMESTAMP
**Requires:** BRANCH_INFO

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

**Produces:** REVIEWER_LIST
**Requires:** DIFF_RANGE

Per worktree, detect file types in diff using `DIFF_RANGE` to determine conditional reviews:

| Condition | Adds Perspective |
|-----------|-----------------|
| Any .ts or .tsx files | typescript |
| .tsx or .jsx files (React components) | react |
| .tsx or .jsx files (React components) | accessibility |
| .tsx/.jsx/.css/.scss files | ui-design |
| .go files | go |
| .java files | java |
| .py files | python |
| .rs files | rust |
| DB/migration files | database |
| Dependency files changed | dependencies |
| Docs or significant code | documentation |

**Skill availability check**: Language/ecosystem reviews (typescript, react, accessibility, ui-design, go, java, python, rust) require their optional skill plugin to be installed. Before adding a conditional perspective, use Read to check if `~/.claude/skills/devflow:{focus}/SKILL.md` exists. If Read returns an error (file not found), **skip that perspective** — the language plugin isn't installed. Non-language reviews (database, dependencies, documentation) use skills bundled with this plugin and are always available.

### Phase 1b: Load Decisions Index

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Load the decisions index for the current worktree before spawning the review team:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

This produces a compact index of active ADR/PF entries. Pass `DECISIONS_CONTEXT` to each reviewer teammate prompt. Reviewers use `devflow:apply-decisions` to Read full entry bodies on demand.

**Load Feature Knowledge:**
1. Read `.features/index.json` if it exists
2. Based on changed files from Phase 1 analysis, identify relevant KBs (match file paths against KB `directories` and `referencedFiles`)
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`
4. Set `FEATURE_KNOWLEDGE` (or `(none)` if no KBs exist or none are relevant)

Pass `FEATURE_KNOWLEDGE` to each reviewer teammate alongside `DECISIONS_CONTEXT`.

### Phase 2: Spawn Review Team

**Produces:** REVIEWER_OUTPUTS
**Requires:** DIFF_RANGE, REVIEW_DIR, TIMESTAMP, DECISIONS_CONTEXT, REVIEWER_LIST

**Per worktree**, create an agent team for adversarial review. Always include 4 core perspectives; conditionally add more based on Phase 1 analysis.

**Note**: In multi-worktree mode, process worktrees sequentially for Agent Teams (one team per session constraint). Each worktree gets its own team lifecycle: create → debate → synthesize → cleanup.

**Core perspectives (always):**
- **Security**: vulnerabilities, injection, auth, crypto issues
- **Architecture**: SOLID violations, coupling, layering, modularity
- **Performance**: queries, algorithms, caching, I/O bottlenecks
- **Quality**: complexity, testing, consistency, regression, naming

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

Spawn review teammates. For each teammate, compose a self-contained prompt using the template below, substituting the per-reviewer values from the table.

**Reviewer prompt template:**

    You are reviewing PR #{pr_number} on branch {branch} (base: {base_branch}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    DECISIONS_CONTEXT: {decisions_context}
    FEATURE_KNOWLEDGE: {feature_knowledge}
    1. Read your skill(s): `Read {SKILL_PATHS}`
    2. Read review methodology: `Read ~/.claude/skills/devflow:review-methodology/SKILL.md`
    3. Follow devflow:apply-decisions to scan DECISIONS_CONTEXT index and Read full ADR/PF bodies on demand. Skip if (none).
    4. Follow devflow:apply-feature-kb for FEATURE_KNOWLEDGE — feature-specific patterns and anti-patterns inform findings. Skip if (none).
    5. Get the diff: `git -C {WORKTREE_PATH} diff {DIFF_RANGE}`
    6. Apply the 6-step review process from devflow:review-methodology
    7. Focus: {FOCUS}
    8. Classify each finding: 🔴 BLOCKING / ⚠️ SHOULD-FIX / ℹ️ PRE-EXISTING
    9. Include file:line references for every finding
    10. Write your report: `Write to {worktree_path}/.docs/reviews/{branch_slug}/{timestamp}/{REPORT_NAME}.md`
    11. Report completion: SendMessage(type: "message", recipient: "team-lead", summary: "{SUMMARY}")

**Core reviewers (always spawn):**

| Name | SKILL_PATHS | FOCUS | REPORT_NAME | SUMMARY |
|------|-------------|-------|-------------|---------|
| security-reviewer | `~/.claude/skills/devflow:security/SKILL.md` | injection, auth bypass, crypto misuse, OWASP vulnerabilities | security | Security review done |
| architecture-reviewer | `~/.claude/skills/devflow:architecture/SKILL.md` | SOLID violations, coupling, layering issues, modularity problems | architecture | Architecture review done |
| performance-reviewer | `~/.claude/skills/devflow:performance/SKILL.md` | N+1 queries, memory leaks, algorithm issues, I/O bottlenecks | performance | Performance review done |
| quality-reviewer | `~/.claude/skills/devflow:complexity/SKILL.md`, `~/.claude/skills/devflow:consistency/SKILL.md`, `~/.claude/skills/devflow:testing/SKILL.md`, `~/.claude/skills/devflow:regression/SKILL.md` | complexity, test gaps, pattern violations, regressions, naming | quality | Quality review done |

**Conditional reviewers** — add based on Phase 1 changed-file analysis, using the same template:

| Name | Condition | SKILL_PATHS | FOCUS | REPORT_NAME |
|------|-----------|-------------|-------|-------------|
| typescript-reviewer | .ts/.tsx changed | `devflow:typescript` | type safety, generics, utility types | typescript |
| react-reviewer | .tsx/.jsx changed | `devflow:react` | hooks, state, rendering, composition | react |
| accessibility-reviewer | .tsx/.jsx changed | `devflow:accessibility` | ARIA, keyboard nav, focus management | accessibility |
| frontend-design-reviewer | .tsx/.jsx/.css changed | `devflow:ui-design` | visual consistency, spacing, typography | frontend-design |
| go-reviewer | .go changed | `devflow:go` | error handling, interfaces, concurrency | go |
| java-reviewer | .java changed | `devflow:java` | records, sealed classes, composition | java |
| python-reviewer | .py changed | `devflow:python` | type hints, protocols, data modeling | python |
| rust-reviewer | .rs changed | `devflow:rust` | ownership, error handling, type system | rust |
| database-reviewer | DB files changed | `devflow:database` | schema, queries, migrations, indexes | database |
| dependencies-reviewer | package files changed | `devflow:dependencies` | CVEs, versions, licenses, supply chain | dependencies |
| documentation-reviewer | docs or significant code changed | `devflow:documentation` | doc drift, missing docs, stale comments | documentation |
```

### Phase 2b: Debate Round

**Requires:** REVIEWER_OUTPUTS

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

### Phase 3: Synthesis and PR Comments

**Produces:** REVIEW_SUMMARY
**Requires:** REVIEWER_OUTPUTS, REVIEW_DIR, PR_INFO

**WAIT** for debate to complete, then lead produces outputs.

Spawn 2 agents **in a single message**:

**Git Agent (PR Comments)**:
```
Agent(subagent_type="Git", run_in_background=false):
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

### Phase 4: Write Review Head Marker

**Requires:** BRANCH_INFO, REVIEW_DIR

Per worktree, after successful completion:
1. Write current HEAD SHA to `{worktree_path}/.docs/reviews/{branch-slug}/.last-review-head`

<!-- D8: "Record Pitfalls" phase removed — decisions-format skill no longer has Write
     capability; pitfall recording is handled by the background-learning extractor. -->

### Phase 5: Cleanup and Report

**Requires:** REVIEW_SUMMARY

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
├─ Phase 2b: Debate round
│  └─ Reviewers challenge each other (max 2 rounds)
│
├─ Phase 3: Synthesis
│  ├─ Git agent (comment-pr with consensus findings + dedup)
│  └─ Lead writes review-summary with confidence levels
│
├─ Phase 4: Write .last-review-head per worktree
│
└─ Phase 5: Cleanup and display results
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
| Many worktrees (5+) | Report count and proceed — user manages their worktree count |
| Duplicate PR comments | Git agent checks for existing comments at same file:line before creating |

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
