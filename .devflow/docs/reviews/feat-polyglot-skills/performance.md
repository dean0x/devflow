# Performance Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Sequential file-existence checks for up to 8 optional language skills before spawning reviewers** - `plugins/devflow-code-review/commands/code-review.md:53-54`
- Problem: The newly added "Skill availability check" instructs the orchestrator to Glob for `~/.claude/skills/{focus}/SKILL.md` for each of up to 8 optional language/ecosystem skills (typescript, react, accessibility, frontend-design, go, python, java, rust) *before* spawning reviewer sub-agents. If these checks run sequentially, this adds 8 file-system probes to Phase 1.
- Impact: Each Glob invocation is a tool call round-trip. With 8 optional skills to check, this could add noticeable latency to the review command startup (~2-4s depending on tool call overhead). This is amplified in the teams variant (`code-review-teams.md:53-54`) which has the same pattern.
- Fix: The command is markdown-based orchestration, so there is no code to change per se. However, the instruction could be restructured to batch all 8 checks into a single Glob pattern:
  ```
  Check skill availability in one Glob call:
  ~/.claude/skills/{typescript,react,accessibility,frontend-design,go,python,java,rust}/SKILL.md

  Only spawn conditional reviewers for skills that returned a match.
  ```
  Alternatively, explicitly instruct "check all 8 skill paths in a single message (parallel tool calls)" rather than leaving the execution order ambiguous. The current wording ("Before spawning a conditional Reviewer for these focuses, check if...") suggests one-at-a-time checking.

**Growing conditional reviewer count increases total sub-agent spawns** - `plugins/devflow-code-review/commands/code-review.md:60-84`
- Problem: The conditional reviewer table grew from 7 entries (typescript, react, accessibility, frontend-design, database, dependencies, documentation) to 11 entries (adding go, python, java, rust). In a polyglot repo with, say, `.ts`, `.go`, and `.py` files all changed, the code-review command would spawn 7 core + 6 conditional = 13 reviewer sub-agents, all in a single message. This is up from a previous maximum of 7 + 7 = 14 (but practically most repos triggered fewer conditionals since they were single-language).
- Impact: Each additional sub-agent consumes a full context window and model invocation. For truly polyglot repos this is working as intended. However, there is no documented upper bound or recommendation to limit to N concurrent reviewers. With all 11 conditionals triggering simultaneously, that is 18 parallel sub-agents.
- Fix: Consider documenting a practical cap (e.g., "if more than 4 conditional reviewers would be triggered, prioritize based on volume of changed lines per language") or add a note that the system gracefully handles this. This is MEDIUM rather than HIGH because the scenario (all 8 language file types changed in one PR) is rare, and the existing architecture already handles parallel spawns.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Go concurrency example uses loop variable capture pattern that is correct only for Go 1.22+** - `shared/skills/go/references/concurrency.md:8-21`
- Problem: The `FetchAll` errgroup example captures `i` and `url` from a `for i, url := range urls` loop directly in a closure without shadowing. In Go versions before 1.22, this would cause all goroutines to share the same loop variable, leading to data races and incorrect results. Go 1.22 changed loop variable semantics to per-iteration scoping.
- Impact: If this skill guides a developer working on a Go 1.21 or earlier codebase, they would introduce a performance-destroying data race (goroutines stomping each other's results). This is a correctness issue with performance implications (data corruption, non-deterministic results requiring debugging).
- Fix: Add a version note or show the pre-1.22 compatible pattern:
  ```go
  // Go 1.22+: loop variables are per-iteration (safe as-is)
  // Go <1.22: shadow the variable
  for i, url := range urls {
      i, url := i, url // Shadow for pre-1.22 compatibility
      g.Go(func() error {
          ...
      })
  }
  ```

**Python async reference appends to shared list from concurrent tasks** - `shared/skills/python/references/async.md:30-40`
- Problem: The `process_batch` TaskGroup example appends results to a shared `list[Result]` from concurrent tasks. While CPython's GIL makes `list.append` thread-safe in practice, this is not guaranteed by the language specification. More importantly, it is a poor pattern to teach because (1) it does not preserve input order, and (2) it encourages shared mutable state in async code.
- Impact: Developers following this pattern would get non-deterministic result ordering, which can cause subtle bugs. The performance impact is minor (no actual data race under CPython), but the pattern encourages architectures that scale poorly.
- Fix: Use the return value from tasks instead:
  ```python
  async def process_batch(items: list[Item]) -> list[Result]:
      async with asyncio.TaskGroup() as tg:
          tasks = [tg.create_task(process_item(item)) for item in items]
      return [task.result() for task in tasks]  # Preserves order
  ```

### LOW

**Coder agent now loads 4 additional skill references in frontmatter** - `shared/agents/coder.md:5`
- Problem: The `skills:` frontmatter line grew from 10 skills to 14 (adding go, python, java, rust). All 14 skills are listed regardless of the target language, meaning the coder agent's context includes metadata for all 14 skills at invocation time.
- Impact: Minimal. The frontmatter is a reference list, not actual file content. The coder agent's instructions already say "load the corresponding language skill" based on the task, so only the relevant skill file gets read at runtime. The 4 additional strings in the frontmatter add negligible token overhead.
- Fix: No action needed. The existing per-task skill selection logic in the coder agent instructions (line 41: "For non-TypeScript backends: load the corresponding language skill") already handles this efficiently. This is informational only.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`buildAssetMaps` iterates all plugins with nested loops on every call** - `src/cli/plugins.ts:121-140`
- Problem: `buildAssetMaps` does a double-nested iteration (plugins x skills + plugins x agents) every time it is called. With 17 plugins and up to 14 skills across them, this is a ~170-iteration loop.
- Impact: Negligible at current scale. This function is called once during `init` and the dataset is tiny. However, the function signature accepts a parameter (`plugins: PluginDefinition[]`) suggesting it could be called with arbitrary plugin lists. At 17 plugins this is fine; at 100+ it would warrant lazy evaluation or caching.
- Fix: No action needed at current scale. The function is O(P*S) where P=plugins and S=max skills per plugin, but both are small constants.

**`getAllSkillNames` and `getAllAgentNames` create new Sets on every call** - `src/cli/plugins.ts:99-116`
- Problem: These utility functions re-derive their results from the static `DEVFLOW_PLUGINS` array every time they are called rather than computing once.
- Impact: Negligible. These are called infrequently (list command, init). The array has 17 entries with at most ~30 unique skills total.
- Fix: Could memoize with a module-level cache, but not worth the complexity at current scale.

### LOW

**Ambient router skill selection matrix grows linearly with new languages** - `shared/skills/ambient-router/SKILL.md:57`
- Problem: The BUILD intent secondary skills row now lists 10 items (typescript, react, go, python, java, rust, frontend-design, input-validation, security-patterns). The ambient router must pattern-match file extensions against this list for every STANDARD-depth prompt.
- Impact: The matching is done by the LLM reading the skill file, not by code iteration. The additional 4 entries (go, python, java, rust) add ~20 tokens to the ambient router skill. This is well within acceptable overhead for STANDARD-depth classification.
- Fix: No action needed. The skill catalog reference file (`references/skill-catalog.md`) already provides the detailed mapping, and the main SKILL.md table is a concise summary.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 1 |
| Pre-existing | 0 | 0 | 2 | 1 |

**Performance Score**: 8/10

This PR is primarily additive content (4 new language skill files with ~750 lines of reference material each, 8 new plugin.json manifests, and registry updates). The performance profile is clean:

- **No algorithmic regressions**: No new loops, no N+1 patterns, no unbounded allocations
- **No I/O bottlenecks**: Skill files are read on-demand by sub-agents, not eagerly loaded
- **No memory concerns**: Plugin registry grows by 8 static entries (trivial)
- **Build-time only**: The `plugins.ts` changes affect install-time behavior, not runtime
- **Smart decomposition**: Moving language skills to optional plugins actually *improves* performance for users who do not need those languages, since fewer skills are installed and loaded

The two blocking MEDIUM items are about optimizing the orchestration instructions (batching Glob checks, noting reviewer scaling) rather than code-level performance bugs. The should-fix items in Go and Python reference materials address correctness patterns that could lead to performance-impacting bugs if developers follow them.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Restructure the skill availability check instruction in both `code-review.md` and `code-review-teams.md` to explicitly batch the 8 Glob checks into parallel tool calls or a single brace-expansion Glob pattern, rather than leaving sequential execution as the likely interpretation.
2. Add a Go version note to the errgroup loop variable capture example in `shared/skills/go/references/concurrency.md` to prevent data races on Go <1.22.
3. Fix the Python TaskGroup example in `shared/skills/python/references/async.md` to use task return values instead of shared mutable list appending.
