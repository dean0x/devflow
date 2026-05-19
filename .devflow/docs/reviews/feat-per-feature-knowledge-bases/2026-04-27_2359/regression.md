# Regression Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Knowledge agent cannot update index when spawned by plan:orch (Phase 12)** - `shared/agents/knowledge.md:38`, `shared/skills/feature-kb/SKILL.md:107-117`
**Confidence**: 90%
- Problem: The Knowledge agent's Bash tool was removed and its responsibility #7 changed from "Run `node feature-kb.cjs update-index`" to "Write sidecar JSON file". The CLI `kb create`/`kb refresh` and `background-kb-refresh` correctly read the sidecar and call `updateIndex`. However, when `plan:orch` Phase 12 spawns the Knowledge agent, there is no host process to read the sidecar and call `updateIndex`. Previously the agent ran `update-index` directly via Bash. Now the sidecar file will be written but never consumed, leaving `.features/index.json` out of date after KB creation via `/plan`.
- Impact: KBs created during the `/plan` workflow will exist on disk (`.features/{slug}/KNOWLEDGE.md`) but will NOT appear in the index. Subsequent operations that rely on the index (staleness checks, `kb list`, `find-overlapping`, `apply-feature-kb`) will not see these KBs.
- Fix: Either (a) add post-agent sidecar handling in `plan:orch` Phase 12 — after the Knowledge agent returns, read the sidecar file and run `node scripts/hooks/lib/feature-kb.cjs update-index` with the sidecar data, or (b) restore Bash to the Knowledge agent's tool list so it can call `update-index` directly (the approach used before this PR).

### MEDIUM

**Skill still instructs agent to run Bash command it can no longer execute** - `shared/skills/feature-kb/SKILL.md:107-117`
**Confidence**: 92%
- Problem: The `## Integration` section of the `feature-kb` skill still contains a bash code block instructing the agent to run `node scripts/hooks/lib/feature-kb.cjs update-index`. The Knowledge agent no longer has Bash in its tool list (`shared/agents/knowledge.md` line 10-14). The agent's responsibility #7 correctly says to write a sidecar file, but the skill contradicts this by telling it to run a Bash command.
- Impact: Conflicting instructions between agent responsibility and skill reference. If the agent follows the skill, it will attempt a Bash call that will fail (tool not available). If it follows the agent prompt, it will correctly write the sidecar. In practice, agent prompt typically takes priority, but the contradiction introduces fragility.
- Fix: Update `shared/skills/feature-kb/SKILL.md` Integration section to match the new sidecar pattern:
  ```markdown
  ## Integration

  After writing KNOWLEDGE.md, write a sidecar JSON file for the host process:
  - For create: `.features/{slug}/.create-result.json`
  - For refresh: `.features/{slug}/.refresh-result.json`

  Sidecar format:
  ```json
  {
    "referencedFiles": ["file1", "file2"],
    "description": "Use when {trigger description}"
  }
  ```
  The host process will read this sidecar and update `.features/index.json`.
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Orphaned sidecar files if agent crashes mid-write** - `src/cli/commands/kb.ts:407,519` (Confidence: 65%) -- Both `create` and `refresh` clean up sidecar files on success and failure paths, but if the process is killed between agent completion and cleanup, sidecar files could accumulate in `.features/{slug}/`. Low practical risk since the files are small and subsequent operations clean up before writing.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The `category` field removal is complete and clean across all consumers (code, tests, fixtures, CLI output). The `get_mtime` deduplication is correct. The `readSidecar` helper is well-tested with proper type filtering. The `--model sonnet` addition is consistent with agent frontmatter. Shell script hardening (fail-on-source) is a positive change.

The blocking HIGH issue is the plan:orch regression: KBs created via `/plan` will not have their index updated because the Knowledge agent can no longer run `update-index` directly, and plan:orch does not read the sidecar post-spawn. This is a functional regression in the primary KB creation path.
