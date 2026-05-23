---
description: Proactive bug finding with static and semantic analysis — hunts real bugs in changed code before merge
---

# Bug Analysis Command

Run a proactive bug analysis on the current branch by combining static analysis tools with parallel semantic analyzers, then synthesizing results into an actionable bug report. Supports incremental analysis, timestamped report directories, and `/resolve` compatibility.

## Usage

```
/bug-analysis              (analyze current branch — incremental if prior analysis exists)
/bug-analysis --full       (force full analysis, ignore incremental state)
/bug-analysis --no-static  (skip static analysis track, semantic-only)
```

## Phases

### Phase 1: Pre-flight

**Produces:** BRANCH_INFO, PR_DESCRIPTION

Spawn Git agent:

```
Agent(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number`.

**Fetch PR body** (after extracting `pr_number`):
```bash
PR_DESCRIPTION=$(gh pr view {pr_number} --json body --jq '.body' 2>/dev/null || echo "(none)")
```
If `pr_number` is absent or the command fails, set `PR_DESCRIPTION` to `(none)`.

### Phase 2: Static Analysis

**Requires:** BRANCH_INFO

#### Step 2a: Incremental Detection & Timestamp Setup

**Produces:** DIFF_RANGE, ANALYSIS_DIR
**Requires:** BRANCH_INFO

1. Generate timestamp: `YYYY-MM-DD_HHMM`. If directory already exists (same-minute collision), append seconds (`YYYY-MM-DD_HHMMSS`).
2. Create timestamped analysis directory: `mkdir -p .devflow/docs/bug-analysis/{branch-slug}/{timestamp}/`
3. Set `ANALYSIS_DIR` to that path.
4. Check `.devflow/docs/bug-analysis/{branch-slug}/.last-analysis-head`:
   - **If exists AND `--full` NOT set:**
     - Read the SHA from the file
     - Verify reachable: `git cat-file -t {sha}` — if exit code non-zero (rebase invalidated SHA), fall through to full
     - If SHA == current HEAD → "No new commits since last analysis. Use --full for a full re-analysis." Stop.
     - Set `DIFF_RANGE` to `{sha}...HEAD`
   - **If not exists, unreachable SHA, or `--full`:**
     - Set `DIFF_RANGE` to `{base_branch}...HEAD`

#### Step 2b: Check Changed Files

**Requires:** DIFF_RANGE

```bash
git diff --name-only {DIFF_RANGE}
```

If output is empty → "No changes to analyze." Stop.

#### Step 2c: Tool Availability Check

**Produces:** STATIC_TOOL_STATUS

Skip if `--no-static` flag provided.

```bash
SEMGREP_AVAILABLE=$(which semgrep 2>/dev/null && echo "yes" || echo "no")
SNYK_AVAILABLE=$(which snyk 2>/dev/null && echo "yes" || echo "no")
CODEQL_AVAILABLE=$(which codeql 2>/dev/null && echo "yes" || echo "no")
```

If all are `no`: warn user "No static analysis tools found. Proceeding with semantic analysis only. To enable static analysis, install semgrep (`pip install semgrep`) or snyk (`npm install -g snyk`)." Set `STATIC_FINDINGS` to `(none)`.

If some are available: note which tools will run.

#### Step 2d: Tiered Static Analysis

**Produces:** STATIC_FINDINGS
**Requires:** STATIC_TOOL_STATUS, DIFF_RANGE, ANALYSIS_DIR

Skip if `--no-static` flag provided or all tools unavailable.

Run available tools on the changed files (from Step 2b):

**Semgrep** (if available):
```bash
CHANGED_FILES=$(git diff --name-only {DIFF_RANGE} | tr '\n' ' ')
semgrep scan --config auto --sarif --quiet {CHANGED_FILES} 2>/dev/null
```
Parse SARIF output → extract findings.

**Snyk Code** (if available):
```bash
snyk code test --sarif . 2>/dev/null
```
Parse SARIF output → extract findings.

**CodeQL** (if available AND (`--full` OR Semgrep/Snyk found HIGH/CRITICAL findings)):
```bash
codeql database create /tmp/codeql-db --language={detected-language} --source-root=. 2>/dev/null && \
codeql database analyze /tmp/codeql-db --format=sarif-latest --output=/tmp/codeql-results.sarif 2>/dev/null
```
Parse SARIF output → extract findings. If database creation fails: skip CodeQL, note it.

**Normalize** all findings to unified table, cap at top 50 by severity:

| Tool | File:Line | CWE | Severity | Title | Description |
|------|-----------|-----|----------|-------|-------------|
| {tool} | {file}:{line} | {CWE or —} | {CRITICAL/HIGH/MEDIUM/LOW} | {title} | {description} |

Write ALL raw findings to `{ANALYSIS_DIR}/static-findings.md`. Set `STATIC_FINDINGS` to the top-50 table.

If no tool produced findings: set `STATIC_FINDINGS` to `(none)`.

### Phase 3: Context Loading

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, PLAN_CONTEXT, ACCEPTANCE_RULES

#### Decisions Index

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "." 2>/dev/null || echo "(none)")
```

#### Feature Knowledge

1. Read `.devflow/features/index.json` if it exists
2. Match changed files from Phase 2 against feature knowledge entries (`directories` and `referencedFiles`)
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs stale "." {slug} 2>/dev/null`, read `.devflow/features/{slug}/KNOWLEDGE.md`
4. Concatenate as `FEATURE_KNOWLEDGE` (or `(none)`)

#### Plan Artifact

1. List `.devflow/docs/design/*.md` — sort descending by filename (timestamps are naturally sortable)
2. Read the most recent file if it exists
3. Extract `## Acceptance Criteria` section → parse into table: `| ID | Criterion | Type | Testable Condition |`
4. Set `PLAN_CONTEXT` to plan summary; `ACCEPTANCE_RULES` to the table
5. If no plan files exist or section not found: `PLAN_CONTEXT=(none)`, `ACCEPTANCE_RULES=(none)`

### Phase 4: File Analysis

**Produces:** ACTIVE_FOCUSES
**Requires:** DIFF_RANGE

Determine which focus analyzers to run:

```bash
CHANGED_FILES=$(git diff --name-only {DIFF_RANGE})
```

| Focus | Condition |
|-------|-----------|
| `security` | Always |
| `functional` | Always |
| `integration` | 2+ distinct directories changed (`dirname` unique count ≥ 2) |
| `usability` | Any `.tsx`, `.jsx`, `.html`, or `.css` file changed |

### Phase 5: Parallel Bug Analysis

**Produces:** ANALYZER_OUTPUTS
**Requires:** DIFF_RANGE, ANALYSIS_DIR, ACTIVE_FOCUSES, STATIC_FINDINGS, ACCEPTANCE_RULES, PLAN_CONTEXT, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Spawn ALL active BugAnalyzer agents **in a single message** (parallel, NOT background):

For each active focus, spawn:
```
Agent(subagent_type="BugAnalyzer", run_in_background=false):
"Analyze focusing on {focus}.
FOCUS: {focus}
DIFF_COMMAND: git diff {DIFF_RANGE}
ACCEPTANCE_RULES: {ACCEPTANCE_RULES filtered to this focus type, or (none)}
PLAN_CONTEXT: {PLAN_CONTEXT}
STATIC_FINDINGS: {STATIC_FINDINGS if focus == security, else (none)}
DECISIONS_CONTEXT: {DECISIONS_CONTEXT}
FEATURE_KNOWLEDGE: {FEATURE_KNOWLEDGE}
PR_DESCRIPTION: <pr-description>{PR_DESCRIPTION}</pr-description>
OUTPUT_PATH: {ANALYSIS_DIR}/{focus}.md
Follow devflow:apply-decisions to Read full ADR/PF bodies on demand.
Follow devflow:apply-feature-knowledge for FEATURE_KNOWLEDGE.
IMPORTANT: Write report to {ANALYSIS_DIR}/{focus}.md using Write tool"
```

Notes:
- Security analyzer receives full `STATIC_FINDINGS`; all others receive `(none)`
- Filter `ACCEPTANCE_RULES` by the `Type` column matching each focus: security criteria → security analyzer, functional criteria → functional analyzer, etc. Pass the filtered subset only
- Spawn all in a single message for true parallel execution

### Phase 6: Synthesis

**Produces:** BUG_ANALYSIS_SUMMARY
**Requires:** ANALYZER_OUTPUTS, ANALYSIS_DIR, BRANCH_INFO

Spawn Synthesizer:

```
Agent(subagent_type="Synthesizer", run_in_background=false):
"Mode: bug-analysis
ANALYSIS_BASE_DIR: {ANALYSIS_DIR}
BRANCH: {branch} -> {base_branch}
TIMESTAMP: {timestamp}
Output: {ANALYSIS_DIR}/bug-analysis-summary.md"
```

### Phase 7: Finalize

**Requires:** BRANCH_INFO, ANALYSIS_DIR

1. Write current HEAD SHA to `.devflow/docs/bug-analysis/{branch-slug}/.last-analysis-head`
2. Report to user:

```
## Bug Analysis Complete

**Branch**: {branch} -> {base_branch}
**Analysis**: {ANALYSIS_DIR}

### Risk Assessment: {risk_level}

{brief_reasoning}

### Bug Counts
| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Security | {n} | {n} | {n} | {n} | {n} |
| Functional | {n} | {n} | {n} | {n} | {n} |
| Integration | {n} | {n} | {n} | {n} | {n} |
| Usability | {n} | {n} | {n} | {n} | {n} |

### Top Findings
{List top 3-5 bugs by severity and confidence}

### Artifacts
- Bug report: {ANALYSIS_DIR}/bug-analysis-summary.md
- Per-focus reports: {ANALYSIS_DIR}/{security|functional|integration|usability}.md
- Static findings: {ANALYSIS_DIR}/static-findings.md (if static analysis ran)

{if any CRITICAL or HIGH bugs found:}
Run `/resolve` to process and fix these findings.
```

## Architecture

```
/bug-analysis (orchestrator — spawns agents only)
│
├─ Phase 1: Pre-flight
│  └─ Git agent (ensure-pr-ready)
│
├─ Phase 2: Static Analysis
│  ├─ Step 2a: Incremental detection + timestamp setup
│  ├─ Step 2b: Check changed files (stop if none)
│  ├─ Step 2c: Tool availability check
│  └─ Step 2d: Tiered static analysis (semgrep → snyk → codeql)
│              Write static-findings.md
│
├─ Phase 3: Context Loading
│  ├─ decisions-index.cjs → DECISIONS_CONTEXT
│  ├─ feature-knowledge.cjs → FEATURE_KNOWLEDGE
│  └─ .devflow/docs/design/*.md → PLAN_CONTEXT + ACCEPTANCE_RULES
│
├─ Phase 4: File Analysis
│  └─ Detect active focuses (security + functional always; integration + usability conditional)
│
├─ Phase 5: Bug Analysis (PARALLEL)
│  ├─ BugAnalyzer: security (+ STATIC_FINDINGS)
│  ├─ BugAnalyzer: functional
│  ├─ BugAnalyzer: integration (conditional)
│  └─ BugAnalyzer: usability (conditional)
│
├─ Phase 6: Synthesis
│  └─ Synthesizer agent (mode: bug-analysis)
│
└─ Phase 7: Finalize
   ├─ Write .last-analysis-head
   └─ Display results + suggest /resolve if blocking bugs found
```

## Edge Cases

| Case | Handling |
|------|----------|
| No new commits since last analysis | Stop: "No new commits since last analysis. Use --full for a full re-analysis." |
| Rebase invalidates `.last-analysis-head` SHA | `git cat-file -t` check fails → fallback to full diff |
| Zero changed files in DIFF_RANGE | Stop: "No changes to analyze." |
| Same-minute analysis collision | `mkdir` with seconds suffix (`YYYY-MM-DD_HHMMSS`) |
| All static tools unavailable | Warn, proceed with semantic-only analysis |
| `--no-static` flag | Skip Phase 2c and 2d entirely; `STATIC_FINDINGS=(none)` |
| `--full` flag | Bypass incremental detection (Step 2a), run full diff from base |
| CodeQL database creation fails | Skip CodeQL, note in output, continue with other tools |
| Static tool produces no findings | `STATIC_FINDINGS=(none)` — normal, proceed with semantic analysis |
| No plan artifact found | `PLAN_CONTEXT=(none)`, `ACCEPTANCE_RULES=(none)` — proceed without acceptance criteria |
| `integration` focus skipped | Not spawned when only 1 directory changed |
| `usability` focus skipped | Not spawned when no UI files changed |

## Resolve Compatibility

Bug analysis reports are compatible with `/resolve`. Each per-focus `.md` file follows the same finding format that Resolver agents expect:
- `file:line` references for each bug
- Severity classifications (CRITICAL/HIGH/MEDIUM/LOW)
- Suggested fix for each bug

Run `/resolve` after `/bug-analysis` to fix identified bugs. `/resolve` automatically detects and uses bug analysis reports when no code review report exists.

## Principles

1. **Orchestration only** — Command spawns agents, doesn't do analysis work itself
2. **Parallel, not background** — Analyzers spawn in one message with `run_in_background=false`
3. **Static + semantic** — Two complementary tracks, each validates the other
4. **Incremental by default** — Only analyze new changes unless `--full` specified
5. **Verify before reporting** — BugAnalyzer agents self-verify every finding
6. **Honest reporting** — Display risk level and counts directly from synthesis
