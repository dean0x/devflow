---
name: docs-framework
description: This skill should be used when the user asks to "create a review report", "write a status log", "add documentation", "name this artifact", or creates files in the .devflow/docs/ directory. Provides naming conventions, templates, and directory structure for reviews, debug sessions, design docs, and all persistent Devflow documentation artifacts.
user-invocable: false
allowed-tools: Read, Bash, Glob
---

# Documentation Framework

The canonical source for documentation conventions in Devflow. All agents that persist artifacts must follow these standards.

## Iron Law

> **ALL ARTIFACTS FOLLOW NAMING CONVENTIONS**
>
> Timestamps are `YYYY-MM-DD_HHMM`. Branch slugs replace `/` with `-`. Topic slugs are
> lowercase alphanumeric with dashes. No exceptions. Inconsistent naming breaks tooling,
> searching, and automation. Follow the pattern or fix the pattern for everyone.

---

## Directory Structure

All generated documentation lives under `.devflow/docs/` in the project root:

```
.devflow/docs/
├── reviews/{branch-slug}/              # Code review reports per branch
│   ├── .last-review-head              # HEAD SHA of last completed review (for incremental)
│   ├── {timestamp}/                   # Timestamped review directory (YYYY-MM-DD_HHMM)
│   │   ├── {focus}.md                 # Reviewer report (e.g., security.md, architecture.md)
│   │   ├── review-summary.md          # Synthesizer output
│   │   └── resolution-summary.md      # Written by /resolve (if run)
│   └── {timestamp}/                   # Second review (incremental)
│       ├── {focus}.md
│       └── review-summary.md
├── bug-analysis/{branch-slug}/          # Bug analysis reports per branch
│   ├── .last-analysis-head            # HEAD SHA of last analysis (for incremental)
│   └── {timestamp}/                   # Timestamped analysis directory (YYYY-MM-DD_HHMM)
│       ├── {focus}.md                 # Analyzer report (e.g., security.md, functional.md)
│       ├── static-findings.md         # Raw static analysis tool output
│       ├── bug-analysis-summary.md    # Synthesizer output
│       └── resolution-summary.md      # Written by /resolve (if run)
├── design/                             # Design artifacts from /plan
│   └── {issue}-{topic-slug}.{timestamp}.md  # Design document
├── tickets/{slug}/                     # Ticket sets from /dynamic-tickets
│   └── {YYYY-MM-DD_HHMM}/             # Timestamped ticket directory
│       ├── {ticket-slug}.md            # Individual ticket files
│       └── tracking-issue.md           # Tracking issue body (GitHub sync)
├── waves/{slug}/                       # Wave run reports from /dynamic-wave
│   └── {YYYY-MM-DD_HHMM}/             # Timestamped wave directory
│       └── wave-report.md              # Wave run summary and status
├── research/{topic-slug}/              # Research artifacts per topic
│   └── {YYYY-MM-DD_HHMM}/             # Timestamped research directory
│       ├── {type}.md                  # Researcher outputs (codebase.md, external.md, etc.)
│       └── research-summary.md        # Synthesizer output
├── status/                             # Development logs
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
└── swarm/                              # Swarm operation state
    ├── state.json
    └── plans/

.devflow/memory/
├── WORKING-MEMORY.md                   # Auto-maintained by Stop hook (overwritten)
└── backup.json                         # Pre-compact git state snapshot

.devflow/decisions/
├── decisions.md                        # Architectural decisions (ADR-NNN format)
└── pitfalls.md                         # Known pitfalls (PF-NNN format)
```

---

## Naming Conventions

### Timestamps
Format: `YYYY-MM-DD_HHMM` (sortable, readable)
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)  # Example: 2025-12-26_1430
```

### Branch Slugs
Replace `/` with `-`, sanitize special characters:
```bash
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")
```

### Topic Slugs
Lowercase, dashes, alphanumeric only, max 50 chars:
```bash
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)
```

### File Naming Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Special indexes | `UPPERCASE.md` | `WORKING-MEMORY.md`, `INDEX.md` |
| Review reports | `{focus}.md` in timestamped dir | `2025-12-26_1430/security.md` |
| Review summary | `review-summary.md` in timestamped dir | `2025-12-26_1430/review-summary.md` |
| Resolution summary | `resolution-summary.md` in timestamped dir | `2025-12-26_1430/resolution-summary.md` |
| Review head marker | `.last-review-head` | Plain text file with SHA |
| Status logs | `{timestamp}.md` | `2025-12-26_1430.md` |
| Design documents | `{issue}-{topic-slug}.{timestamp}.md` | `42-jwt-auth.2026-04-07_1430.md` |
| Research outputs | `{type}.md` in timestamped dir | `2025-12-26_1430/codebase.md` |
| Research summary | `research-summary.md` in timestamped dir | `2025-12-26_1430/research-summary.md` |
| Bug analysis reports | `{focus}.md` in timestamped dir | `2025-12-26_1430/security.md` |
| Bug analysis summary | `bug-analysis-summary.md` in timestamped dir | `2025-12-26_1430/bug-analysis-summary.md` |
| Static findings | `static-findings.md` in timestamped dir | `2025-12-26_1430/static-findings.md` |
| Analysis head marker | `.last-analysis-head` | Plain text file with SHA |

---

## Helper Functions

Source helpers for consistent naming:

```bash
source .devflow/scripts/docs-helpers.sh 2>/dev/null || {
    get_timestamp() { date +%Y-%m-%d_%H%M; }
    get_branch_slug() { git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone"; }
    get_topic_slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50; }
    ensure_docs_dir() { mkdir -p ".devflow/docs/$1"; }
}
```

---

## Agent Persistence Rules

### Agents That Persist Artifacts

| Agent | Output Location | Behavior |
|-------|-----------------|----------|
| Reviewer | `.devflow/docs/reviews/{branch-slug}/{timestamp}/{focus}.md` | Creates new in timestamped dir |
| Synthesizer (review) | `.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md` | Creates new in timestamped dir |
| Resolve cmd | `.devflow/docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md` | Written by /resolve orchestrator (Phase 5) |
| Code-review cmd | `.devflow/docs/reviews/{branch-slug}/.last-review-head` | Overwrites with HEAD SHA |
| Working Memory | `.devflow/memory/WORKING-MEMORY.md` | Overwrites (auto-maintained by Stop hook) |
| Decisions | `.devflow/decisions/decisions.md` | Rendered from `decisions-ledger.jsonl` (active ADR-NNN rows; retired rows dropped) |
| Pitfalls | `.devflow/decisions/pitfalls.md` | Rendered from `decisions-ledger.jsonl` (active PF-NNN rows; retired rows dropped) |
| Designer (via /plan) | `.devflow/docs/design/{issue}-{topic-slug}.{timestamp}.md` | Creates new design artifact |
| Researcher | `.devflow/docs/research/{topic-slug}/{timestamp}/{type}.md` | Creates new in timestamped dir |
| Synthesizer (research) | `.devflow/docs/research/{topic-slug}/{timestamp}/research-summary.md` | Creates new in timestamped dir |
| BugAnalyzer | `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/{focus}.md` | Creates new in timestamped dir |
| Synthesizer (bug-analysis) | `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/bug-analysis-summary.md` | Creates new in timestamped dir |
| Bug-analysis cmd | `.devflow/docs/bug-analysis/{branch-slug}/.last-analysis-head` | Overwrites with HEAD SHA |

### Agents That Don't Persist

- Git (fetch-issue: read-only, comment-pr: PR comments only)
- Coder (commits to git, no .devflow/docs/ output)

---

## Implementation Checklist

When creating or modifying persisting agents:

- [ ] Use standard timestamp format (`YYYY-MM-DD_HHMM`)
- [ ] Sanitize branch names (replace `/` with `-`)
- [ ] Sanitize topic names (lowercase, dashes, alphanumeric)
- [ ] Create directory with `mkdir -p .devflow/docs/{subdir}`
- [ ] Document output location in agent's final message
- [ ] Follow special file naming (UPPERCASE for indexes)
- [ ] Use helper functions when possible
- [ ] Update relevant index files

---

## Integration

This framework is used by:
- **Review agents**: Creates review reports
- **Bug analysis agents**: Creates bug analysis reports
- **Working Memory hooks**: Auto-maintains `.devflow/memory/WORKING-MEMORY.md`
- **Dream agent**: background LLM agent (spawned via the session-start directive) promotes observations to ADRs/PFs via `assign-anchor`, which renders `decisions.md` / `pitfalls.md`

All persisting agents should load this skill to ensure consistent documentation.

---

## Extended References

For detailed patterns and violation examples:

- **[patterns.md](./references/patterns.md)** - Full templates, helper functions, naming examples, edge cases
- **[violations.md](./references/violations.md)** - Common violations with detection patterns and fixes
