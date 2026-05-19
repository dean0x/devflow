# Architecture Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23T19:41

## Issues in Your Changes (BLOCKING)

### HIGH

**`devflow kb create` hardcodes `--dangerously-skip-permissions` with no user consent** - `src/cli/commands/kb.ts:203-207`
**Confidence**: 90%
- Problem: The `create` and `refresh` subcommands spawn `claude -p` with `--dangerously-skip-permissions`, which bypasses all safety prompts. While this is a developer-facing CLI tool, the user typing `devflow kb create <slug>` may not realize they are granting unrestricted tool access to a subprocess. The existing project convention (e.g., `background-learning`, `background-memory-update`) uses `--dangerously-skip-permissions` in background hooks that users explicitly opted into via `devflow init`. A direct CLI command is different — the user invokes it ad hoc and may not expect the elevated privileges.
- Fix: Either (a) document the elevated permissions in the CLI help text and spinner message so the user sees it before the subprocess runs, or (b) prompt for confirmation before spawning. Option (a) is lighter:
  ```typescript
  s.start('Running KB Builder agent (unrestricted tool access)...');
  ```
  And add `.description('Create a new KB via claude -p exploration (uses --dangerously-skip-permissions)')` on the command.

**`devflow kb create` constructs shell-interpolated prompt string with user-provided `slug` and `name`** - `src/cli/commands/kb.ts:178-199`
**Confidence**: 82%
- Problem: The `slug` is validated by `validateSlug()` (kebab-case only), but `name` comes from an interactive text prompt with only a 3-character length check. The `name` value is interpolated directly into the prompt string that is passed as an argument to `execFileSync('claude', ['-p', prompt, ...])`. Since `execFileSync` with an array avoids shell interpretation, this is NOT a command injection vector. However, malicious or unusual `name` values (containing backticks, markdown directives, or prompt injection patterns) could influence the LLM's behavior during KB creation. This is a defense-in-depth concern at the boundary between user input and LLM prompt.
- Fix: Sanitize `name` to strip or escape markdown/prompt-injection patterns, or validate more strictly (e.g., alphanumeric + spaces + hyphens only):
  ```typescript
  validate: (v) => {
    if (v.trim().length < 3) return 'Name must be at least 3 characters';
    if (!/^[a-zA-Z0-9 \-]+$/.test(v.trim())) return 'Name must contain only letters, numbers, spaces, and hyphens';
    return undefined;
  },
  ```

### MEDIUM

**Duplicate `feature-kb` and `apply-feature-kb` in `devflow-core-skills` plugin manifest may cause confusion** - `src/cli/plugins.ts:50`
**Confidence**: 85%
- Problem: `feature-kb` and `apply-feature-kb` are listed in both `devflow-core-skills` (line 50) and `devflow-plan` (line 57), `devflow-ambient` (line 125-126), etc. The `buildFullSkillsMap()` function deduplicates via a `Map`, so there is no functional bug. However, listing `feature-kb` (a creation skill that requires `Bash` + `Write`) in `devflow-core-skills` (described as "auto-activating quality enforcement") implies it auto-activates, when it should only be used by the KB Builder agent. The `apply-feature-kb` skill (read-only consumption) does belong in core-skills, but `feature-kb` (the creation skill) belongs exclusively in plugins that spawn the KB Builder agent.
- Fix: Remove `feature-kb` from the `devflow-core-skills` skills array. Keep `apply-feature-kb` there since it is a consumption-only skill that any agent may reference:
  ```typescript
  {
    name: 'devflow-core-skills',
    skills: ['apply-knowledge', 'apply-feature-kb', 'software-design', ...],
    // feature-kb removed — it belongs in devflow-plan and devflow-ambient only
  },
  ```

**`checkAllStaleness` calls `checkStaleness` per slug, each re-parsing the index and spawning a `git log` process** - `scripts/hooks/lib/feature-kb.cjs:153-161`
**Confidence**: 83%
- Problem: `checkAllStaleness` iterates all slugs and calls `checkStaleness` for each. Each call: (1) re-reads and re-parses `index.json`, (2) spawns a `git rev-parse --git-dir` subprocess, (3) spawns a `git log` subprocess. For N feature KBs, this is N index parses + N git-dir checks + N git-log invocations. With a small number of KBs this is fine, but the architecture doesn't scale efficiently.
- Fix: Refactor `checkAllStaleness` to load the index once and batch the git operations:
  ```javascript
  function checkAllStaleness(worktreePath) {
    const index = loadIndex(worktreePath);
    if (!index) return {};
    // Single git-dir check
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktreePath, stdio: 'pipe' });
    } catch { return {}; }
    const results = {};
    for (const [slug, entry] of Object.entries(index.features)) {
      // Inline staleness check without re-loading index or re-checking git
      results[slug] = checkStalenessForEntry(worktreePath, entry);
    }
    return results;
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`FEATURE_KNOWLEDGE` loading logic is duplicated across 7+ orchestration skills and commands (3 occurrences are near-identical multi-step instructions)** - `shared/skills/plan:orch/SKILL.md:71-92`, `shared/skills/review:orch/SKILL.md:60-64`, `shared/skills/resolve:orch/SKILL.md:46-49`, `shared/skills/explore:orch/SKILL.md:35-39`, `shared/skills/debug:orch/SKILL.md:40-44`, `plugins/devflow-code-review/commands/code-review-teams.md:108-114`, `plugins/devflow-self-review/commands/self-review.md:31-35`
**Confidence**: 88%
- Problem: The `FEATURE_KNOWLEDGE` loading pattern (read index.json, match file paths, check staleness, read KNOWLEDGE.md, concatenate) is duplicated verbatim or near-verbatim across 7+ locations. This violates DIP and DRY — any change to the loading algorithm (e.g., adding caching, changing the staleness check command, or adding a new matching heuristic) requires updating all 7+ locations. By contrast, the existing `KNOWLEDGE_CONTEXT` pattern consolidated loading into a single `knowledge-context.cjs index` CLI call. The `FEATURE_KNOWLEDGE` loading pattern should follow the same consolidation approach — a single script entry point that returns concatenated content, rather than inline multi-step instructions in each orchestration skill.
- Fix: Add a `load` subcommand to `feature-kb.cjs` that accepts a worktree path and a list of changed files (or a task description), performs the full index-read + match + staleness-check + content-concatenation pipeline, and returns the concatenated `FEATURE_KNOWLEDGE` string on stdout. Then each orchestration skill replaces its 4-5 step inline instructions with a single line:
  ```bash
  FEATURE_KNOWLEDGE=$(node scripts/hooks/lib/feature-kb.cjs load "{worktree}" --files='[...]')
  ```
  This mirrors the `KNOWLEDGE_CONTEXT` consolidation pattern and ensures all consumers stay in sync.

**KB Builder agent has no `apply-feature-kb` skill but KB Builder can be spawned for refresh with EXISTING_KB context** - `shared/agents/kb-builder.md:5-7`
**Confidence**: 80%
- Problem: The KB Builder agent lists `devflow:feature-kb` (creation) and `devflow:worktree-support` as skills, but not `devflow:apply-feature-kb` (consumption). When the agent is spawned for a refresh operation with `EXISTING_KB` content, it would benefit from the `apply-feature-kb` consumption algorithm to properly parse and understand the existing KB structure before updating it. The agent should also list `devflow:apply-knowledge` since it receives `KNOWLEDGE_CONTEXT` and is expected to cross-reference ADR/PF entries.
- Fix: Add the two consumption skills to the KB Builder agent frontmatter:
  ```yaml
  skills:
    - devflow:feature-kb
    - devflow:worktree-support
    - devflow:apply-feature-kb
    - devflow:apply-knowledge
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Asymmetric `FEATURE_KNOWLEDGE` propagation: debug:orch keeps it local, all others pass to sub-agents** - `shared/skills/debug:orch/SKILL.md:40-44`
**Confidence**: 82%
- Problem: `debug:orch` explicitly states "Do NOT pass to Explore sub-agents" for both `KNOWLEDGE_CONTEXT` and `FEATURE_KNOWLEDGE`. This follows the same asymmetric pattern that existed for `KNOWLEDGE_CONTEXT` in debug:orch before this PR, and the comment explains the rationale (hypothesis generation stays in orchestrator). However, this is an unusual architectural exception that is not documented in any shared reference. A developer adding a new orchestration skill or modifying debug:orch may not understand why the propagation pattern differs here.
- This is informational. The debug:orch asymmetry is an intentional design choice, not a bug. It should ideally be documented in a shared conventions reference to prevent accidental breakage.

## Suggestions (Lower Confidence)

- **Feature KB index.json schema has no validation at load time** - `scripts/hooks/lib/feature-kb.cjs:78-86` (Confidence: 65%) -- `loadIndex` parses JSON and returns it without validating the schema (version field, features object structure). A corrupt or hand-edited index could cause downstream failures with unhelpful error messages.

- **`.features/` directory is committed to git but `.features/.kb.lock` is gitignored; no `.gitkeep` for empty directory** - `src/cli/utils/post-install.ts:476` (Confidence: 70%) -- After `devflow init`, if no KBs have been created yet, git may not track the empty `.features/` directory. The init code creates `index.json` which would track the directory, but if a user runs `git clean`, they could lose the directory. Minor -- init recreates it.

- **`markStale` uses path prefix matching that could produce false positives** - `scripts/hooks/lib/feature-kb.cjs:270-271` (Confidence: 72%) -- The overlap check `f.startsWith(ref) || ref.startsWith(f)` could match `src/cli/commands/init.ts` against a KB referencing `src/cli/commands/init-wizard.ts` if one is a prefix of the other. The `===` check handles exact matches, but the `startsWith` bidirectional check is overly broad.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 2 | 1 | - |
| Should Fix | - | - | 2 | - |
| Pre-existing | - | - | 1 | - |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The feature introduces a well-structured per-feature knowledge base system with clear separation between creation (`feature-kb` skill, KB Builder agent), consumption (`apply-feature-kb` skill), and runtime management (`feature-kb.cjs`). The index.json + KNOWLEDGE.md + staleness detection design is sound and follows existing project patterns (comparable to the knowledge-context system).

Key architectural strengths:
- Clean producer/consumer split (feature-kb vs apply-feature-kb)
- mkdir-based lock for concurrent index writes (follows existing .knowledge.lock pattern)
- Slug validation with path traversal defense-in-depth
- Non-blocking KB generation in plan:orch (failure does not break the plan workflow)
- `pipeline:orch` correctly delegates KB loading to inner orchestrators rather than loading itself

Key concerns:
- The `FEATURE_KNOWLEDGE` loading pattern is duplicated across 7+ orchestration locations instead of being consolidated into a single script entry point (the way `KNOWLEDGE_CONTEXT` uses `knowledge-context.cjs index`)
- The `devflow kb create/refresh` commands use `--dangerously-skip-permissions` without informing the user
- The `feature-kb` creation skill is incorrectly listed in `devflow-core-skills` (auto-activating layer) when it should only appear in plugins that spawn the KB Builder agent
