# Complexity Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### HIGH

**Repetitive plugin definitions in `DEVFLOW_PLUGINS` array create linear growth scaling problem** - `src/cli/plugins.ts:88-152`
- Problem: 8 new optional language plugins are defined as individual object literals with identical structure (`commands: [], agents: [], skills: ['{name}'], optional: true`). The `DEVFLOW_PLUGINS` array grew from 86 lines to 152 lines (+77%) with purely repetitive data. Each new language plugin requires adding another 7-line object that is structurally identical to its siblings, differing only in `name`, `description`, and `skills[0]`.
- Impact: Adding the next language (e.g., C#, Swift, Kotlin) requires copy-pasting the same shape yet again. The array is now 130+ lines of largely boilerplate data, making it harder to scan for the core plugins that actually define commands and agents. This is not blocking in isolation but establishes a pattern that degrades further with each addition.
- Fix: Extract optional skill-only plugins into a data-driven helper:
```typescript
const LANGUAGE_PLUGINS: Array<{ name: string; description: string; skill: string }> = [
  { name: 'devflow-typescript', description: 'TypeScript language patterns (type safety, generics, utility types)', skill: 'typescript' },
  { name: 'devflow-react', description: 'React framework patterns (hooks, state, composition, performance)', skill: 'react' },
  { name: 'devflow-go', description: 'Go language patterns (error handling, interfaces, concurrency)', skill: 'go' },
  // ...remaining entries
];

const optionalPlugins: PluginDefinition[] = LANGUAGE_PLUGINS.map(({ name, description, skill }) => ({
  name,
  description,
  commands: [],
  agents: [],
  skills: [skill],
  optional: true,
}));

export const DEVFLOW_PLUGINS: PluginDefinition[] = [
  ...CORE_PLUGINS,       // the 9 plugins with commands/agents
  ...optionalPlugins,    // generated from compact data
];
```
This eliminates the structural duplication while keeping the data explicit.

### MEDIUM

**SKILL.md files exceed target size guideline** - `shared/skills/go/SKILL.md` (188 lines), `shared/skills/python/SKILL.md` (188 lines), `shared/skills/java/SKILL.md` (183 lines), `shared/skills/rust/SKILL.md` (193 lines)
- Problem: The project's CLAUDE.md specifies "Target: ~120-150 lines per SKILL.md with progressive disclosure to references/". All four new SKILL.md files exceed the 150-line upper bound (183-193 lines), making them 22-29% over the guideline.
- Impact: SKILL.md files are loaded into agent context windows. The 30-40 extra lines per file are modest individually, but when multiple language reviews run in parallel (a polyglot repo could trigger all four simultaneously), the cumulative overhead adds up. The reference files are properly structured for progressive disclosure already, so the main files could be trimmed.
- Fix: Move the Anti-Patterns tables and/or the Checklists at the end of each SKILL.md into a `references/checklist.md` file. Each of those sections is 15-25 lines and is a natural candidate for progressive disclosure since checklists are used at the end of a review, not during initial pattern matching. This would bring all four files comfortably within the 120-150 line target.

**Coder agent skill list growing linearly in frontmatter** - `shared/agents/coder.md:5`
- Problem: The coder agent's `skills:` frontmatter line now lists 14 skills: `core-patterns, git-safety, implementation-patterns, git-workflow, typescript, react, test-patterns, input-validation, accessibility, frontend-design, go, python, java, rust`. This is a single line that grows with every new language. The agent already has conditional loading logic in its body (line 41: "For non-TypeScript backends: load the corresponding language skill"), which means all 14 are declared but only a subset is used per invocation.
- Impact: The frontmatter declares a superset of what will actually be loaded. As more languages are added this line keeps growing, and the declaration becomes less meaningful since most skills will be conditionally skipped. This is LOW severity from a runtime perspective but adds conceptual overhead when understanding what the agent actually uses.
- Fix: This is acceptable for now given how frontmatter is consumed. Consider documenting in the agent design reference that frontmatter lists the maximum set, with body logic defining the actual subset. No code change required.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Skill availability check is prose instruction, not enforced programmatically** - `plugins/devflow-code-review/commands/code-review.md:52` and `plugins/devflow-code-review/commands/code-review-teams.md:50`
- Problem: The new "Skill availability check" paragraph instructs the orchestrating agent to use Glob to check if `~/.claude/skills/{focus}/SKILL.md` exists before spawning a conditional reviewer. This is a natural-language instruction embedded in a markdown command file. If the agent skips this check (agents are probabilistic), a reviewer sub-agent will be spawned for a language whose skill file does not exist, causing it to fail when it tries to `Read` the SKILL.md.
- Impact: The failure mode is graceful (the reviewer agent would report it cannot find its skill file), but the wasted token expenditure of spawning an agent that immediately fails is non-trivial. This was not an issue before because language skills were bundled with the plugin and always present.
- Fix: Consider adding a concrete example to the instruction: "For each conditional focus in [typescript, react, accessibility, frontend-design, go, python, java, rust], run `Glob ~/.claude/skills/{focus}/SKILL.md` and only proceed if the result is non-empty." A worked example reduces the chance of the agent skipping the check. Alternatively, this could be enforced at the CLI level during init by writing a manifest of installed skills.

## Pre-existing Issues (Not Blocking)

### LOW

**`getAllSkillNames()` and `getAllAgentNames()` are structurally duplicated** - `src/cli/plugins.ts:144-164`
- Problem: These two functions have identical structure, differing only in the property name (`skills` vs `agents`). With the registry now containing 17 plugins and 30 skills, this duplication is more visible.
- Fix: Could be generalized into `function getUniqueAssets(key: 'skills' | 'agents'): string[]` but this is cosmetic and not worth changing in this PR.

**`LEGACY_SKILL_NAMES` array is 39 entries and growing** - `src/cli/plugins.ts:100-139`
- Problem: This is a maintenance cost list that will never shrink. It is pure data (no logic complexity) but takes up visual space.
- Fix: No action needed. Legacy lists are inherently append-only. Could be moved to a separate file if it grows further.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 2 |

**Complexity Score**: 8/10

This PR is fundamentally well-structured. The key architectural decision -- extracting language/ecosystem skills into optional plugins -- actually *reduces* complexity for users who do not need them. The new SKILL.md files follow a consistent template with proper progressive disclosure to reference files. The TypeScript code changes are mechanical additions to a data registry.

The one genuine complexity concern is the repetitive plugin definition pattern in `plugins.ts`. It is not severe enough to block, but addressing it now (before even more languages are added) would prevent the array from becoming unwieldy. The SKILL.md length overruns are minor and easily addressed by pushing checklists into reference files.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Consider refactoring the optional plugin definitions in `plugins.ts` to use a data-driven pattern (HIGH). Can be done in a follow-up PR if preferred.
2. Trim SKILL.md files to target range by moving checklists/anti-pattern tables to references (MEDIUM). Can be done in this PR or follow-up.
