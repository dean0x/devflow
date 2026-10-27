---
name: docs-framework
description: This skill should be used when creating files in the .devflow/docs/ directory.
user-invocable: false
allowed-tools: Read, Bash, Glob
---

# Documentation Framework

The canonical source for what Devflow names under `.devflow/docs/`. A command that writes or looks up a doc path follows it, and the one place a command differs is stated here as an exception, never left implicit.

## Iron Law

> **ALL ARTIFACTS FOLLOW NAMING CONVENTIONS**
>
> A run directory is `YYYY-MM-DD_HHMM` in local time; a second run in the same minute takes
> seconds (`YYYY-MM-DD_HHMMSS`). Branch slugs replace `/` with `-`. Topic slugs are lowercase
> alphanumeric with single dashes, at most 50 characters. The exceptions are the ones listed
> under Naming Conventions, and no others. Inconsistent naming breaks tooling, searching, and
> automation. Follow the pattern or fix the pattern for everyone.

---

## Directory Structure

All generated documentation lives under `.devflow/docs/` at the checkout's toplevel:

```
.devflow/docs/
├── reviews/{branch-slug}/              # /code-review, per branch
│   └── {timestamp}/                   # one directory per review
│       ├── {focus}.md                 # Review agent report (security.md, architecture.md, ...)
│       ├── review-summary.md          # Synthesize agent output
│       ├── resolution-summary.md      # /resolve
│       ├── evidence.md                # /resolve: appended test-plan claims
│       └── stale-plan.md              # /resolve: stale test-plan lines
├── bug-analysis/{branch-slug}/         # /bug-analysis, per branch
│   └── {timestamp}/
│       ├── {focus}.md                 # Debug agent report
│       ├── static-findings.md         # Top 50 static findings and the status of each tool
│       ├── {tool}.sarif               # Scanner SARIF file (semgrep, snyk, codeql); snyk-all.json is Snyk before its scope filter, changed.z the changed names for that filter
│       ├── codeql.log                 # CodeQL output, kept out of the call output
│       ├── findings.tsv               # Every static finding, one row each; findings-{tool}.tsv holds one tool's rows, findings-top.tsv the top 50
│       ├── bug-analysis-summary.md    # Synthesize agent output
│       └── resolution-summary.md      # /resolve (evidence.md and stale-plan.md as in reviews)
├── research/{topic-slug}/{timestamp}/  # /research
│   ├── {type}.md                      # Research agent output (codebase.md, external.md, ...)
│   └── research-summary.md            # Synthesize agent output
├── design/
│   ├── {ISSUE_ID}-{topic-slug}.{timestamp}.md  # /plan, one issue
│   ├── multi-{topic-slug}.{timestamp}.md       # /plan, several issues (frontmatter issue: pending)
│   ├── {topic-slug}.{timestamp}.md             # /plan, no issue
│   └── {slug}/{timestamp}/            # /dynamic-plan run
│       ├── {ticket-slug}-plan.md      # one plan per ticket
│       └── DECISIONS-NEEDED.md
├── tickets/{slug}/{timestamp}/         # /dynamic-tickets
│   ├── {ticket-slug}.md
│   └── tracking-issue.md
├── waves/{slug}/{timestamp}/wave-report.md   # /dynamic-build
├── handoff-{branch-slug}.md            # Code agent phase handoff; deleted once the PR exists
├── evidence-{branch-slug}.md           # /implement test plan and claims; stays after the PR
└── evidence-wave-{slug}.md             # /dynamic-build wave test plan and claims

.devflow/memory/
├── WORKING-MEMORY.md                   # Auto-maintained by Stop hook (overwritten)
└── backup.json                         # Pre-compact git state snapshot

.devflow/curation/
├── decisions.md                        # Architectural decisions (ADR-NNN format)
└── pitfalls.md                         # Known pitfalls (PF-NNN format)
```

`{ISSUE_ID}` is the filesystem-safe issue identifier the Git agent emits as `- **Issue ID**:` under `### Handoff Values`. A multi-issue batch fetch returns none, which is why that variant is named `multi-`.

The head markers for incremental runs are not part of this tree. `/code-review` and `/bug-analysis` keep each one under the git directory of the worktree, at `<git dir>/devflow/reviews/{branch-slug}/.last-review-head` and `<git dir>/devflow/bug-analysis/{branch-slug}/.last-analysis-head`. `<git dir>` is the path that `git rev-parse --absolute-git-dir` prints, so each worktree has its own markers.

---

## Naming Conventions

### Timestamps

`YYYY-MM-DD_HHMM`, local time (sortable, readable), computed once per run and reused for every path of that run:
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)  # Example: 2025-12-26_1430
```
- **Same-minute collision.** `/code-review`, `/bug-analysis` and `/research` create their run directory themselves: when it already exists, the second run appends seconds (`2025-12-26_143005`). It sorts after its minute, so newest-first listings stay correct.
- **Workflow runs** (`tickets/`, `design/{slug}/`, `waves/`) are stamped in local time by the workflow that creates them and take no collision suffix: a second run in the same minute writes into the first's directory.
- A design document's timestamp is the suffix before `.md`, so a listing sorts by that suffix, not by the leading `{ISSUE_ID}`.

### Branch Slugs

The branch name with every `/` replaced by `-`; case, dots and underscores are kept. A detached HEAD has no name and uses `standalone`:
```bash
BRANCH_SLUG=$(b=$(git branch --show-current 2>/dev/null); echo "${b:-standalone}" | sed 's/\//-/g')
```
A slug builds a path or reaches a shell only when it matches `^[A-Za-z0-9._-]{1,200}$`. Every command derives `{branch_slug}` (the underscore spelling in `handoff-*` and `evidence-*`) this way, from the branch the work is on.

### Topic Slugs

One rule for every topic and initiative `{slug}`: lowercase; each run of characters outside `a-z0-9` becomes one `-`; leading and trailing `-` are trimmed; at most 50 characters (trim again after the cut); `untitled` when nothing is left:
```bash
TOPIC_SLUG=$(s=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-50 | sed -E 's/-+$//'); echo "${s:-untitled}")
```
`/plan` and `/research` take `{topic-slug}` from it. `/dynamic-tickets` uses it for the initiative `{slug}`, and `/dynamic-plan` reuses the `{slug}` of the ticket set it plans (`wave` for any other source).

### Exceptions

- **`{ticket-slug}`** (`tickets/…/{ticket-slug}.md`, `design/…/{ticket-slug}-plan.md`): the ticket title lowercased with each run outside `a-z0-9` as one `-`, nothing trimmed and no length cap. `/dynamic-tickets` matches a ticket file by this name when it amends the ticket, so trimming would rename a file its own amend phase already wrote.
- **Wave `{slug}`** (`waves/`, `evidence-wave-{slug}.md`): the part of the integration branch after `wave/`, at most 60 characters, not derived by the topic rule. It makes `evidence-wave-{slug}.md` the `evidence-{branch-slug}.md` of the branch `wave/{slug}`.

### File Naming Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Special indexes | `UPPERCASE.md` | `WORKING-MEMORY.md`, `INDEX.md` |
| Reports and summaries | `{focus}.md`, `review-summary.md`, `bug-analysis-summary.md`, `research-summary.md`, `static-findings.md`, `resolution-summary.md` in the run directory | `2025-12-26_1430/security.md` |
| Head markers | `<git dir>/devflow/reviews/{branch-slug}/.last-review-head`, `<git dir>/devflow/bug-analysis/{branch-slug}/.last-analysis-head` | Plain text file with SHA |
| Status logs | `{timestamp}.md` | `2025-12-26_1430.md` |
| Design documents | `{ISSUE_ID}-{topic-slug}.{timestamp}.md` | `42-jwt-auth.2026-04-07_1430.md` |
| Design (several issues) | `multi-{topic-slug}.{timestamp}.md` | `multi-jwt-auth.2026-04-07_1430.md` |
| Design (no issue) | `{topic-slug}.{timestamp}.md` | `jwt-auth.2026-04-07_1430.md` |
| Per-ticket plan | `{ticket-slug}-plan.md` in `design/{slug}/{timestamp}/` | `design/wave/2026-04-07_1430/add-login-plan.md` |
| Handoff, evidence | `handoff-{branch-slug}.md`, `evidence-{branch-slug}.md`, `evidence-wave-{slug}.md` | `evidence-feat-jwt-auth.md` |

---

## Helper Functions

Define these inline, in the Bash call that needs them, for consistent naming. `.devflow/docs/` lives at the checkout's toplevel, never under a subdirectory the session started in:

```bash
get_timestamp() { date +%Y-%m-%d_%H%M; }
get_run_stamp() { local t; t=$(get_timestamp); [ -e "$1/$t" ] && t=$(date +%Y-%m-%d_%H%M%S); echo "$t"; }  # $1: parent of the run directory
get_branch_slug() { local b; b=$(git branch --show-current 2>/dev/null); echo "${b:-standalone}" | sed 's/\//-/g'; }
get_topic_slug() { local s; s=$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-50 | sed -E 's/-+$//'); echo "${s:-untitled}"; }
get_docs_root() { git rev-parse --show-toplevel 2>/dev/null || pwd; }
ensure_docs_dir() { mkdir -p "$(get_docs_root)/.devflow/docs/$1"; }
```

---

## Agent Persistence Rules

### Who Writes What

- **Reviews**: the Review agents and the Synthesize agent (review mode) write into `reviews/{branch-slug}/{timestamp}/`; `/resolve` adds `resolution-summary.md` (Phase 5); `/code-review` overwrites its `.last-review-head` marker, under the git directory, with the HEAD SHA.
- **Bug analysis**: the Debug agents and the Synthesize agent (bug-analysis mode) write into `bug-analysis/{branch-slug}/{timestamp}/`; the scanner calls write the SARIF files, the changed-name list for the Snyk filter and the CodeQL log, and the counts step writes the findings tables, all into that run folder; `/bug-analysis` overwrites its `.last-analysis-head` marker, under the git directory, with the HEAD SHA only when every tool that was to run completed, or `--no-static` is set.
- **Research**: the Research agents write `{type}.md`, and the Synthesize agent (research mode) writes `research-summary.md` through `RESEARCH_BASE_DIR`, both into `research/{topic-slug}/{timestamp}/`.
- **Design**: `/plan` writes the design document; `/dynamic-plan` writes `design/{slug}/{timestamp}/`, `/dynamic-tickets` `tickets/{slug}/{timestamp}/`, `/dynamic-build` `waves/{slug}/{timestamp}/` and `evidence-wave-{slug}.md`.
- **Handoff and evidence**: `/implement` writes `evidence-{branch-slug}.md`, which stays after the PR, and the handoff file, to which each Code agent appends one phase section and which is deleted once the PR exists.
- **Memory and curation**: the Stop hook overwrites `.devflow/memory/WORKING-MEMORY.md`; `decisions.md` and `pitfalls.md` are rendered from `decisions-ledger.jsonl` (active entries in full, inactive ones in an Inactive table).

### Agents That Don't Persist

- Git (fetch-issue: read-only, post-review-summary: consolidated review comment only)
- Code agent (commits to git; its only file is the handoff section it appends when `HANDOFF_FILE` is given)

---

## Implementation Checklist

When creating or modifying persisting agents or commands:

- [ ] Use the run-directory timestamp (`YYYY-MM-DD_HHMM`, local time, seconds on a same-minute collision)
- [ ] Derive the branch slug (replace `/` with `-`) and gate it before it builds a path
- [ ] Derive topic slugs with the one rule (lowercase, single dashes, at most 50)
- [ ] Create directory with `mkdir -p .devflow/docs/{subdir}`
- [ ] Document output location in agent's final message
- [ ] Follow special file naming (UPPERCASE for indexes)
- [ ] Use helper functions when possible
- [ ] Update relevant index files

---

## Integration

This framework is used by:
- **`/plan` and `/research`**: load it at the step that names the document, and build the path by its rules
- **Commands that hand paths to agents** (`/code-review`, `/bug-analysis`, `/implement`, `/resolve`, the `/dynamic-*` commands): follow it, with the exceptions above
- **Working Memory hooks**: Auto-maintains `.devflow/memory/WORKING-MEMORY.md`
- **Curate agent**: background LLM agent (spawned via the session-start directive) promotes observations to ADRs/PFs via `assign-anchor`, which renders `decisions.md` / `pitfalls.md`

---

## Extended References

For detailed patterns and violation examples:

- **[patterns.md](./references/patterns.md)** - Full templates, helper functions, naming examples, edge cases
- **[violations.md](./references/violations.md)** - Common violations with detection patterns and fixes
