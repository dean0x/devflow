# Dependencies Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Coder agent frontmatter lists optional skills as hard dependencies** - `shared/agents/coder.md:4`
- Problem: The `skills:` frontmatter now lists `go, python, java, rust` (along with pre-existing `typescript, react, accessibility, frontend-design`) as required skills for the Coder agent. These skills live in optional plugins that are not installed by default (`optional: true` in `src/cli/plugins.ts`). If Claude Code resolves agent skill references at load time, the Coder agent could fail or emit warnings when any of these 8 optional skill plugins are not installed.
- Impact: Users who install `devflow-implement` (which bundles the Coder agent) without also installing all 8 optional language plugins will reference non-existent skill files. The Coder agent's body text already handles this gracefully (step 3 says "load the corresponding language skill"), but the frontmatter `skills:` line unconditionally declares all of them as dependencies.
- Fix: Either (a) remove the optional language skills from the frontmatter and rely on the body text to instruct the agent to dynamically read the relevant `SKILL.md` if it exists, or (b) add a note in the Coder agent body that missing skill files from uninstalled optional plugins should be silently skipped. The code-review commands already demonstrate the correct pattern with their "Skill availability check" paragraph.

```diff
 ---
 name: Coder
 description: Autonomous task implementation on feature branch. Implements, tests, and commits.
 model: inherit
-skills: core-patterns, git-safety, implementation-patterns, git-workflow, typescript, react, test-patterns, input-validation, accessibility, frontend-design, go, python, java, rust
+skills: core-patterns, git-safety, implementation-patterns, git-workflow, test-patterns, input-validation
 ---
```

Then in the body, the existing step 3 (domain skill loading) already handles dynamic loading. The frontmatter should only list skills that are always available.

---

**Reviewer agent frontmatter lists optional skills as hard dependencies** - `shared/agents/reviewer.md:4` (inferred from diff)
- Problem: Same issue as the Coder agent. The Reviewer agent's skill-path table now includes `go`, `java`, `python`, and `rust` entries pointing to `~/.claude/skills/{lang}/SKILL.md`. However, the Reviewer agent body already handles this correctly by reading the skill file dynamically based on the `focus` parameter -- the table is just a lookup reference. The risk here is lower than the Coder agent because the Reviewer is invoked with a specific focus, and the code-review command already includes the "Skill availability check" gate.
- Impact: Low functional risk since the code-review orchestrator already gates on file existence. However, the reviewer agent's own `skills:` frontmatter (if it lists these) should be verified.
- Fix: Confirm the reviewer agent frontmatter does not unconditionally list optional skill names. The diff shows table additions in the body, which is the correct approach (reference table, not frontmatter declaration).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`devflow-implement` plugin.json removed `accessibility` and `frontend-design` but Coder agent still lists them in frontmatter** - `plugins/devflow-implement/.claude-plugin/plugin.json:14-15` + `shared/agents/coder.md:4`
- Problem: The `devflow-implement` plugin manifest had `accessibility` and `frontend-design` removed from its `skills` array (correctly, since those are now optional plugins). But the Coder agent (which is bundled with `devflow-implement` via its `agents` array) still declares `accessibility` and `frontend-design` in its frontmatter `skills:` line. This means the agent references skills that its own plugin no longer ships.
- Impact: When `devflow-implement` is installed without the optional `devflow-accessibility` and `devflow-frontend-design` plugins, the Coder agent will reference skill files (`~/.claude/skills/accessibility/SKILL.md`, `~/.claude/skills/frontend-design/SKILL.md`) that may not exist on disk.
- Fix: Same as the BLOCKING issue above -- strip optional skills from Coder frontmatter. The domain-loading logic in the body handles this correctly.

### LOW

**`devflow-code-review` plugin.json removed `react` skill but Reviewer may still receive `react` focus** - `plugins/devflow-code-review/.claude-plugin/plugin.json:17-22`
- Problem: The `devflow-code-review` plugin manifest removed `accessibility`, `frontend-design`, and `react` from its `skills` array. The code-review commands (both `.md` and `-teams.md`) now include the "Skill availability check" paragraph that instructs the orchestrator to verify `~/.claude/skills/{focus}/SKILL.md` exists before spawning a reviewer with that focus. This is the correct mitigation.
- Impact: Minimal -- the orchestrator-level gate handles the missing-plugin case. This is informational to confirm the mitigation is in place and working correctly.
- Fix: No action needed; the skill availability check pattern is the correct approach. This is well-designed.

## Pre-existing Issues (Not Blocking)

### LOW

**No npm dependency changes in this PR** - `package.json`
- Observation: This PR adds zero new npm dependencies. The 8 new plugins and 4 new skills (Go, Python, Java, Rust) are purely content (Markdown files and JSON manifests). This is excellent from a supply chain perspective -- no new attack surface introduced.

### LOW

**Version consistency verified** - all `plugin.json` files and `marketplace.json`
- Observation: All 17 plugins (9 core + 8 optional) report version `1.1.0` in both their individual `plugin.json` files and the central `marketplace.json`. Version synchronization is correct.

### LOW

**`optional` field properly gated in init flow** - `src/cli/commands/init.ts:318`
- Observation: The existing init command filters out optional plugins by default (`DEVFLOW_PLUGINS.filter(p => !p.optional)`), requiring explicit `--plugin=` flags to install them. This correctly prevents the new language plugins from being installed unless requested. The pre-existing `devflow-audit-claude` plugin uses the same `optional: true` pattern, so this is a proven mechanism.

### LOW

**Build-time asset distribution handles new plugins** - `plugins/devflow-*/`
- Observation: New plugins follow the established convention: `plugin.json` with `skills` array referencing `shared/skills/` entries, then `npm run build:plugins` distributes the skill files. No deviation from the existing pattern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 1 |
| Pre-existing | 0 | 0 | 0 | 4 |

**Dependencies Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

This PR introduces zero new npm dependencies, which is excellent. The new plugins are pure content (Markdown skills + JSON manifests) with no supply chain impact. Version consistency is properly maintained. The `optional: true` gating mechanism correctly prevents unwanted installations.

The one blocking issue is the Coder agent's frontmatter unconditionally declaring all 14 skills (including 8 from optional plugins) as dependencies. The code-review commands demonstrate the correct pattern: dynamically check for skill file existence before loading. The Coder agent body already contains the right logic for domain-based skill loading, but the frontmatter contradicts this by listing all skills as required. Aligning the frontmatter with the dynamic loading approach would make the dependency chain clean.

### Key Findings

1. **No npm changes** -- purely content-based PR, zero supply chain risk
2. **Plugin isolation model is sound** -- `optional: true` + `--plugin=` flag is well-designed
3. **Coder agent frontmatter overstates its skill dependencies** -- lists optional skills as required
4. **Code-review commands have the right pattern** -- "Skill availability check" gates are correct
5. **Version sync is clean** -- all 17 plugins at `1.1.0`
