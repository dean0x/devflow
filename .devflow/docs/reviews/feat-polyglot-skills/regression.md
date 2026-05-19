# Regression Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### CRITICAL

None found.

### HIGH

**Breaking change: 4 skills removed from default installation without migration path** - `src/cli/plugins.ts:27`
- Problem: The skills `typescript`, `react`, `accessibility`, and `frontend-design` were previously bundled in `devflow-core-skills` and installed by default (`optional: false`). They are now moved to separate optional plugins (`devflow-typescript`, `devflow-react`, `devflow-accessibility`, `devflow-frontend-design`) with `optional: true`. Users who run `devflow init` (upgrade) will no longer receive these skills. Existing installations will retain stale copies (since these skill names are not in `LEGACY_SKILL_NAMES`), but the skills will not be refreshed on upgrade, silently drifting from source. New installations will not get them at all.
- Impact: Any user relying on auto-activation of TypeScript, React, accessibility, or frontend-design patterns will lose that functionality after a clean install unless they explicitly pass `--plugin=typescript,react,accessibility,frontend-design`. This is a silent regression -- no error, just missing enforcement.
- Fix: Either (a) add a migration notice in the init command that detects previously-installed optional skills and prompts the user, or (b) document the breaking change prominently and add a note in the upgrade output, or (c) auto-install these 4 skills for existing users during upgrade by checking if they already exist in `~/.claude/skills/`. Minimum viable fix:
```typescript
// In init.ts, after computing pluginsToInstall, auto-include
// optional language plugins that are already installed (upgrade path)
for (const p of DEVFLOW_PLUGINS) {
  if (p.optional && !pluginsToInstall.includes(p)) {
    const skillDir = path.join(skillsDir, p.skills[0]);
    if (await fs.stat(skillDir).catch(() => null)) {
      pluginsToInstall.push(p);
    }
  }
}
```

**Coder agent references 14 skills that may not be installed** - `shared/agents/coder.md:5`
- Problem: The coder agent frontmatter declares `skills: core-patterns, git-safety, implementation-patterns, git-workflow, typescript, react, test-patterns, input-validation, accessibility, frontend-design, go, python, java, rust`. Eight of these (`typescript`, `react`, `accessibility`, `frontend-design`, `go`, `python`, `java`, `rust`) are now optional plugins. If a user runs `/implement` without installing the relevant language plugin, the coder agent will reference skills that do not exist on disk. On main, the first 4 were always installed via core-skills, so this was not an issue. This PR creates a new failure mode.
- Impact: The coder agent may fail to load skill context or produce warnings. The `/implement` command does not have the same skill-availability-check guard that was added to `/code-review`.
- Fix: Add the same availability check pattern to the coder agent or the implement command, OR make the skill references conditional in the coder agent body rather than the frontmatter. For example, in the coder agent body, only read the skill file if it exists:
```markdown
3. **Load domain skills**: Based on DOMAIN hint, apply relevant patterns. Before loading a language skill, verify `~/.claude/skills/{skill}/SKILL.md` exists (use Glob). Skip missing skills silently.
```

### MEDIUM

**Go skill excludes test files from activation** - `shared/skills/go/SKILL.md:11`
- Problem: The Go skill's activation metadata includes `exclude: ["**/*_test.go"]`. This means the skill will not activate when a user is working on Go test files. However, Go test files share the same package and follow the same patterns (error handling, interfaces, etc.). None of the other new language skills exclude their test file patterns -- Python doesn't exclude `test_*.py`, Java doesn't exclude `*Test.java`, Rust doesn't exclude `*_test.rs`.
- Impact: Inconsistent behavior across language skills. Users working on Go tests won't get Go pattern guidance, while users working on Python/Java/Rust tests will. Low practical impact since activation metadata is currently informational (not enforced by Claude Code), but it sets the wrong precedent.
- Fix: Remove `"**/*_test.go"` from the exclude list to match the behavior of other language skills:
```yaml
activation:
  file-patterns:
    - "**/*.go"
  exclude:
    - "vendor/**"
```

**README skill count breakdown is misleading** - `README.md:27`
- Problem: The README states "8 auto-activating core" skills. The actual `devflow-core-skills` plugin now has 8 skills: `core-patterns, docs-framework, git-safety, git-workflow, github-patterns, input-validation, test-driven-development, test-patterns`. While the count is technically correct, the previous version described these same skills as "12 auto-activating" (which included the 4 now-optional ones). Users upgrading may notice the reduction and wonder what happened. The phrase "auto-activating" is also imprecise since language skills are also auto-activating (they have activation file-patterns).
- Impact: Minor user confusion. The changelog / release notes should explain the restructuring.
- Fix: Consider: "8 foundation skills (always installed), 8 optional language/ecosystem skills (install what you need)..."

## Issues in Code You Touched (Should Fix)

### HIGH

**Implement command not updated with skill availability check** - `plugins/devflow-implement/commands/implement.md` (not modified)
- Problem: The `/code-review` and `/code-review-teams` commands both received a "Skill availability check" paragraph instructing the orchestrator to verify `~/.claude/skills/{focus}/SKILL.md` exists before spawning a reviewer. The `/implement` command (and `/implement-teams`) were NOT updated with an equivalent check, despite the coder agent now referencing 8 optional skills. The implement command spawns the coder agent which has these skills in its frontmatter.
- Impact: The implement workflow may produce unexpected behavior when language plugins are not installed. Inconsistent treatment of the same problem across commands.
- Fix: Add a similar skill-availability note to the implement command, or handle it in the coder agent itself (see blocking issue above).

### MEDIUM

**Ambient router references optional skills without availability check** - `shared/skills/ambient-router/SKILL.md:57`
- Problem: The ambient router's BUILD intent secondary skills now include `go (.go), python (.py), java (.java), rust (.rs)`. The ambient router instructs Claude to "read the selected skills" for STANDARD-depth responses. If a language plugin is not installed, the skill file won't exist at `~/.claude/skills/{lang}/SKILL.md` and the read will fail or produce an error.
- Impact: Ambient mode BUILD responses for Go/Python/Java/Rust will attempt to read non-existent skill files when the corresponding optional plugin is not installed. This was also true for TypeScript/React on main (they were in core-skills), but is now extended to 8 languages.
- Fix: Add a note to the ambient router: "Before reading a secondary skill, verify the skill file exists. Skip silently if missing (the optional language plugin is not installed)."

**Skill catalog lists optional skills without availability caveat** - `shared/skills/ambient-router/references/skill-catalog.md:19-22`
- Problem: The skill catalog for ambient mode's BUILD intent lists `go`, `python`, `java`, `rust` without noting they are optional plugins. A developer reading this catalog would expect these skills to always be available.
- Impact: Documentation inconsistency.
- Fix: Add a note: "Language skills (typescript, react, go, python, java, rust, frontend-design, accessibility) require their optional plugin to be installed."

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Coder agent already referenced optional skills on main** - `shared/agents/coder.md:5`
- Problem: On main, the coder agent already referenced `typescript, react, accessibility, frontend-design` in its frontmatter. These were always installed via core-skills, so it worked. But the pattern of hardcoding skill names in agent frontmatter without availability guards was already fragile.
- Impact: Pre-existing design weakness now amplified by this PR.

**Ambient router already referenced TypeScript/React without availability check on main** - `shared/skills/ambient-router/SKILL.md:57`
- Problem: The BUILD intent line already included `typescript (.ts), react (.tsx/.jsx)` which were core skills. Now that they are optional, the same lack of availability check applies to them too.
- Impact: Pre-existing issue, now affects 8 skills instead of 2.

### LOW

**No CHANGELOG or migration guide for breaking restructure** - (no file)
- Problem: The restructuring of 4 core skills into optional plugins is a breaking change to installation behavior. There is no CHANGELOG entry or migration guide.
- Impact: Users upgrading from v1.1.0 may be surprised by missing skills.
- Fix: Add a CHANGELOG entry or release notes describing the migration.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 1 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 1 |

**Regression Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

This PR adds 4 well-structured language skills (Go, Python, Java, Rust) and restructures existing language/ecosystem skills into optional plugins. The new skill content is comprehensive and follows established patterns. However, the restructuring creates a **silent regression for existing users**: 4 skills that were auto-installed are now optional, with no migration path, no upgrade detection, and no availability guards in the coder agent or ambient router. The `/code-review` command correctly handles this with a skill-availability check, but `/implement` and ambient mode do not.

The two HIGH blocking issues should be addressed before merge:
1. Add an upgrade migration path so existing users don't silently lose 4 skills
2. Add availability guards (or make references conditional) for the coder agent's optional skill dependencies

The MEDIUM issues (Go test file exclusion inconsistency, implement command parity, ambient router guards) are lower priority but should ideally be fixed in this PR to avoid follow-up work.
