# Consistency Review Report

**Branch**: refactor-rename-kb-to-knowledge -> main
**Date**: 2026-05-04

## Issues in Your Changes (BLOCKING)

### HIGH

**`removeKnowledgeHook` does not clean up old `session-end-kb-refresh` hooks** - `src/cli/commands/knowledge/toggle.ts:10,60`
**Confidence**: 95%
- Problem: The `KNOWLEDGE_HOOK_MARKER` was changed from `'session-end-kb-refresh'` to `'session-end-knowledge-refresh'`. The `removeKnowledgeHook` function uses `h.command.includes(KNOWLEDGE_HOOK_MARKER)` to filter hooks. Users upgrading from pre-rename installations have the old `session-end-kb-refresh` hook in their `settings.json`. The init.ts comment says "remove-then-add for upgrade safety" (line 953), but the remove function will not match the old marker. Result: users end up with BOTH the old (broken, script no longer exists) and new hooks after `devflow init`.
- Fix: Add a secondary marker or compound check in `removeKnowledgeHook` to also match the old name:
```typescript
const KNOWLEDGE_HOOK_MARKER = 'session-end-knowledge-refresh';
const LEGACY_KB_HOOK_MARKER = 'session-end-kb-refresh';

// In the filter:
const filtered = matchers.filter(
  (m) => !m.hooks.some((h) =>
    h.command.includes(KNOWLEDGE_HOOK_MARKER) ||
    h.command.includes(LEGACY_KB_HOOK_MARKER)
  ),
);
```
Similarly update `hasKnowledgeHook` to detect the legacy marker.

### MEDIUM

**`Feature KBs:` label in init.ts recommended-mode summary** - `src/cli/commands/init.ts:434`
**Confidence**: 90%
- Problem: The display label still says `Feature KBs:` instead of `Feature Knowledge:` or `Knowledge Bases:`. All other user-facing strings in the knowledge subcommands were renamed (e.g., "Knowledge Base Staleness Check", "Feature Knowledge Bases", etc.), making this one inconsistent.
- Fix: Change to match the terminology used elsewhere:
```typescript
`Knowledge Bases: ${knowledgeEnabled ? 'enabled' : 'disabled'}`,
```

**Incomplete rename of local variable names in `refresh.ts`** - `src/cli/commands/knowledge/refresh.ts:45-93`
**Confidence**: 82%
- Problem: Local variables `kbSlug`, `kbEntry`, `kbDirectories` retain the old `kb` prefix while the file, function names, user-facing strings, and types in the same module were all renamed to use `knowledge`. The file was moved from `kb/refresh.ts` to `knowledge/refresh.ts` and all other identifiers were updated, but these loop variables were left behind.
- Fix: Rename to `entrySlug`/`slug`, `entry`, `directories` (or `knowledgeEntry`/`knowledgeDirectories` if explicitness is preferred). The variable `kbs` in check.ts, list.ts, toggle.ts has the same issue but is a shorter abbreviation that's less jarring.

**Two remaining "KB creation" references in CLAUDE.md** - `CLAUDE.md:24,153`
**Confidence**: 88%
- Problem: Line 24 (`Codebase exploration with KB creation`) and line 153 (`optional KB creation`) still use the "KB" abbreviation while the rest of CLAUDE.md was updated to use "knowledge base" (e.g., line 50 now says "Knowledge bases are created" and "devflow knowledge list|create|check|refresh|remove").
- Fix:
```markdown
| `devflow-explore` | Codebase exploration with knowledge base creation | Optional |
- `/explore` -- Skimmer + Explore + Synthesizer + Knowledge (optional knowledge base creation)
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Incomplete prose rename: "KBs" and "KB" abbreviations remain across ~65 locations in shared skills and command files (10 files)** - Multiple files
**Confidence**: 85%
- Problem: The rename changed all code-level identifiers (file names, function names, skill names, CLI commands, env vars, lock files) but left the prose abbreviation "KB" and "KBs" intact in many locations. These are in files that were modified by this PR (changed lines share the same functions/sections). Examples:
  - `shared/skills/implement:orch/SKILL.md`: 15+ remaining "KB" references (e.g., "Feature KB Generation", "STALE_KB_SLUGS", "New KB creation", "Refresh stale KBs")
  - `shared/skills/explore:orch/SKILL.md`: 14+ remaining (e.g., "Suggest KB Creation", "KB_STATUS", "No feature KB exists")
  - `shared/agents/knowledge.md`: 10 remaining (e.g., "EXISTING_KB", "KB_STATUS", "KB_SLUG", "KB_NAME", "sub-KBs")
  - `shared/skills/plan:orch/SKILL.md`: 5+ remaining (e.g., "available feature KBs", "Feature KB: {slug}")
  - `shared/skills/review:orch/SKILL.md`, `resolve:orch/SKILL.md`, `debug:orch/SKILL.md`: 1-3 each
  - `shared/skills/feature-knowledge/SKILL.md`: 15+ (e.g., "A KB exists to save", "it doesn't need a KB", "Related KBs")
  - `shared/skills/apply-feature-knowledge/SKILL.md`: 12+ (e.g., "Feature KB: {slug}", "A feature KB captures", "Use the KB as")
  - Command files mirror the shared skills (implement.md, implement-teams.md, explore.md, explore-teams.md, etc.)
- The inconsistency is that user-facing CLI output and documentation strings were renamed to "knowledge base" but the orchestration prose and skill documentation retained "KB". Some of these are variable names in the orchestration protocol (e.g., `STALE_KB_SLUGS`, `KB_STATUS`, `EXISTING_KB`, `KB_SLUG`) which would require a coordinated rename across all consumers.
- Fix: This is a judgment call about scope. The variable-like names (`STALE_KB_SLUGS`, `KB_STATUS`, `EXISTING_KB`) form a protocol between orchestrators and agents and require a broader rename. The prose "KBs" could be updated in a follow-up pass.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`kbs` variable name in check.ts, list.ts, toggle.ts, refresh.ts** - Multiple files (Confidence: 65%) -- Short local variable names like `kbs` and `kb` are common abbreviations in loop variables and may be intentional for brevity. Less disruptive to leave as-is than the other variable renames.

- **`kbPath` variable in feature-knowledge.cjs:133** - `scripts/hooks/lib/feature-knowledge.cjs:133` (Confidence: 62%) -- Internal local variable `kbPath` inside `loadKnowledgeContent` could be renamed to `knowledgePath` for consistency, but is private implementation detail.

- **`DEVFLOW_BG_KB_REFRESH` env var not checked for backward compat** - `scripts/hooks/session-end-knowledge-refresh:14` (Confidence: 70%) -- The guard clause now only checks `DEVFLOW_BG_KNOWLEDGE_REFRESH`. Any in-flight old background processes using the old env var name would not be properly guarded. This is a very narrow race condition window (only during the upgrade moment) and likely not worth addressing.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The HIGH issue (old hook not cleaned up during upgrade) is a real backward-compatibility regression that will leave orphan hooks in user settings. The MEDIUM issues are about incomplete rename consistency -- the PR renamed all code-level identifiers correctly but left significant prose and some variable-level "KB" references that create a mixed-terminology codebase. The protocol-level variable names (`STALE_KB_SLUGS`, `KB_STATUS`, `EXISTING_KB`, etc.) in the orchestration skills are the most impactful remaining inconsistency since they appear in user-visible orchestration output and agent prompts.
