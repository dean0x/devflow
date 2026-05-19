# Documentation Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Missing KB hooks from file-organization.md source tree** - `docs/reference/file-organization.md:45-57`
**Confidence**: 92%
- Problem: The hooks listing in the source tree diagram still ends at `json-parse`. The two new hooks (`session-end-kb-refresh`, `background-kb-refresh`) were added to CLAUDE.md's inline hooks list (line 64) but NOT added to the detailed hooks listing in `file-organization.md:45-57`. This is the authoritative reference for hook files and must stay in sync with CLAUDE.md.
- Fix: Add entries to the source tree listing in `docs/reference/file-organization.md`:
```
│       ├── session-end-kb-refresh  # SessionEnd hook: spawns background KB refresh
│       ├── background-kb-refresh   # Background: stale KB refresh via Sonnet
│       ├── json-helper.cjs          # Node.js jq-equivalent operations
│       └── json-parse               # Shell wrapper: jq with node fallback
```

**Missing KB hooks from file-organization.md hooks table** - `docs/reference/file-organization.md:157-169`
**Confidence**: 92%
- Problem: The "Working Memory Hooks" section documents memory and learning hooks in a table but does not mention the new KB SessionEnd hook. The section title says "Working Memory Hooks" and the preamble says "A fifth hook..." for learning, but there is no mention of the sixth hook for KB refresh. This is the reference that developers consult to understand hook behavior.
- Fix: Add a paragraph after line 161 and an entry to the hooks table:
```
A sixth hook (`session-end-kb-refresh`) provides feature KB auto-refresh. Toggleable via `devflow kb --enable/--disable/--status` or `devflow init --kb/--no-kb`:
```
And add to the hooks table:
```
| `session-end-kb-refresh` | SessionEnd | `.features/` KBs | Checks for stale KBs, spawns background refresh (throttled to once per 2h, max 3 KBs). |
```

**Missing `feature-kb.cjs` from file-organization.md source tree** - `docs/reference/file-organization.md:45-57`
**Confidence**: 85%
- Problem: The `hooks/lib/` subdirectory is not listed in the source tree at all. `feature-kb.cjs` and `knowledge-context.cjs` are key infrastructure files referenced throughout orchestration skills, but the `lib/` subdirectory is invisible in the file organization reference. While this predates this PR, the PR adds two new CLI subcommands (`stale-slugs`, `refresh-context`) to `feature-kb.cjs` and the omission grows more misleading.
- Fix: Add `lib/` subdirectory to the hooks source tree, or at minimum add a comment referencing it:
```
│       ├── lib/                    # Node.js helpers
│       │   ├── feature-kb.cjs      # Feature KB index operations
│       │   ├── knowledge-context.cjs # Knowledge index builder
│       │   └── transcript-filter.cjs # Learning transcript splitter
```

### LOW

**Settings Override section omits KB hook** - `docs/reference/file-organization.md:150`
**Confidence**: 80%
- Problem: Line 150 says "hooks - Working Memory hooks (UserPromptSubmit, Stop, SessionStart, PreCompact) + Learning Stop hook" but does not mention the KB SessionEnd hook that is now also installed via `devflow init`.
- Fix: Update to: "hooks - Working Memory hooks (UserPromptSubmit, Stop, SessionStart, PreCompact) + Learning SessionEnd hook + KB SessionEnd hook"

## Issues in Code You Touched (Should Fix)

### MEDIUM

**review:orch Phase 5 cross-reference says "Phase 3 file analysis" but should say "Phase 4"** - `shared/skills/review:orch/SKILL.md:99`
**Confidence**: 95%
- Problem: The diff shows that `- 99 **Conditional reviewers** (from Phase 3 file analysis):` was changed to `+ 99 **Conditional reviewers** (from Phase 4 file analysis):`. This is correct and was fixed in this PR. No action needed -- documenting as a positive finding.

**plan:orch GUIDED step numbering was broken, now fixed** - `shared/skills/plan:orch/SKILL.md:29-31`
**Confidence**: 95%
- Problem: The GUIDED behavior list had duplicate numbering (steps 1, 1, 2, 3) which was corrected to (1, 2, 3, 4, 5) in this PR. Positive finding -- this is a documentation bug fix.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**file-organization.md skills count outdated** - `docs/reference/file-organization.md:12`
**Confidence**: 82%
- Problem: Line 12 says "SINGLE SOURCE OF TRUTH (41 skills)" but CLAUDE.md says "44 skills". The skill count appears to have drifted since the last file-organization update. Not introduced in this PR.

## Suggestions (Lower Confidence)

- **Missing `log-paths` mention in hook docs** - `scripts/hooks/session-end-kb-refresh:49` (Confidence: 65%) -- Both new hooks source `log-paths` for log file resolution, but this shared helper is not documented alongside other hook helpers (`get-mtime`, `json-parse`). Consider adding it to the source tree listing.

- **`background-kb-refresh` prompt documentation** - `scripts/hooks/background-kb-refresh:116-139` (Confidence: 62%) -- The inline prompt sent to `claude -p` references "You are the Knowledge agent" but the agent is running without frontmatter skills or the actual agent definition. The prompt is functional but could confuse readers -- a comment explaining this is a lightweight claude -p invocation (not the full Knowledge agent) would help.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 3 | 1 |
| Should Fix | - | - | 0 | - |
| Pre-existing | - | - | 1 | - |

**Documentation Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR does a thorough job of updating CLAUDE.md (the primary developer reference) with all new KB features -- toggleability, hooks, and the `.disabled` sentinel. Agent renames from "KB Builder" to "Knowledge" are consistently applied across all 6+ files. The orchestration skills (plan:orch, implement:orch, explore:orch, review:orch, pipeline:orch) are properly updated with the new KNOWLEDGE_CONTEXT flow and Phase numbering corrections.

The main gap is `docs/reference/file-organization.md` which was only partially updated (agent count and source tree hooks list in CLAUDE.md mirror) but the detailed hooks table, source tree hook listing, and settings override section within file-organization.md itself were not updated to reflect the two new hooks. Since file-organization.md is the authoritative reference for the hook system, these omissions create documentation drift.
