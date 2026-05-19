# Architecture Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### HIGH

**Coder agent frontmatter lists optional skills as if always available** - `shared/agents/coder.md:4`
- Problem: The Coder agent frontmatter declares `skills: core-patterns, git-safety, implementation-patterns, git-workflow, typescript, react, test-patterns, input-validation, accessibility, frontend-design, go, python, java, rust`. All eight language/ecosystem skills (typescript, react, accessibility, frontend-design, go, python, java, rust) are now in optional plugins that may not be installed. The frontmatter implies these skills are always present, but the whole point of this PR is making them optional. On main, the same issue existed for typescript, react, accessibility, and frontend-design (they were bundled with core-skills), but this PR extends the problem to four more skills while simultaneously removing the bundle guarantee.
- Impact: If the agent runtime uses frontmatter `skills` to pre-load or validate skill availability, referencing uninstalled optional skills could cause errors or silent failures. The body text mitigates this somewhat with the "For non-TypeScript backends: load the corresponding language skill" guidance, but the frontmatter declaration is unconditional.
- Fix: Either (a) remove optional skills from the frontmatter and rely on the body's dynamic loading guidance, or (b) add a comment/convention that frontmatter skills are "preferred" not "required", or (c) document clearly in agent design that frontmatter skill references are hints and agents should gracefully handle missing skills. Option (a) is cleanest:
```markdown
skills: core-patterns, git-safety, implementation-patterns, git-workflow, test-patterns, input-validation
```
Then let the body's domain-hint logic dynamically load the relevant language skill.

### MEDIUM

**Go skill excludes test files from activation** - `shared/skills/go/SKILL.md:10`
- Problem: The Go skill has `"**/*_test.go"` in its `exclude` list, but no other language skill excludes test files. Python does not exclude `**/test_*.py`, Java does not exclude `**/*Test.java`, Rust does not exclude `**/*_test.rs` or `tests/**`. TypeScript (pre-existing) does exclude `**/*.d.ts` (declaration files, not tests). This is an inconsistency in the activation metadata across the new skills.
- Impact: The activation metadata is currently documented as "metadata hints for documentation" and not machine-read by Claude Code. However, if the build system or future tooling starts using these patterns, Go test files would be silently excluded while test files in every other language remain included.
- Fix: Remove `"**/*_test.go"` from the Go skill's exclude list to match the pattern of all other language skills, or add equivalent test-file exclusions to Python, Java, and Rust for consistency:
```yaml
# Option A: Remove from Go (match other skills)
exclude:
  - "vendor/**"

# Option B: Add to all (if test exclusion is desired)
# Python: exclude "**/*_test.py", "**/test_*.py"
# Java: exclude "**/*Test.java"
# Rust: exclude "**/tests/**"
```

**No skill availability guard in ambient-router for optional skills** - `shared/skills/ambient-router/SKILL.md:54`
- Problem: The ambient-router's BUILD intent skill selection references go, python, java, rust as secondary skills to load when matching file types are detected. Unlike the code-review commands (which explicitly add a "Skill availability check" paragraph instructing the agent to verify `~/.claude/skills/{focus}/SKILL.md` exists before loading), the ambient-router has no such guard. If a user is working in a Go codebase but hasn't installed `devflow-go`, the ambient router would attempt to read a non-existent skill file.
- Impact: The agent would fail to read the skill file and either error or silently skip it. This is a degraded experience but not catastrophic since the agent would still respond. However, the code-review commands explicitly handle this case, creating an inconsistency in how optional skills are handled across the system.
- Fix: Add a note to the ambient-router's Step 3 section similar to the code-review commands:
```markdown
**Skill availability check**: Language/ecosystem skills (typescript, react, go, python, java, rust, frontend-design) are optional plugins. Before loading a secondary skill, verify the skill file exists at `~/.claude/skills/{name}/SKILL.md`. If it doesn't exist, skip that skill — the language plugin isn't installed.
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Plugin definition structure is repetitive — 8 identical plugin shapes** - `src/cli/plugins.ts:86-152`
- Problem: Each new language plugin follows an identical pattern: `{ name, description, commands: [], agents: [], skills: [single-skill], optional: true }`. This is copy-paste boilerplate. While it works correctly, the pattern violates DRY and makes future language additions require identical ceremony.
- Impact: Not a bug, but adding the next language (e.g., C#, Swift, Kotlin) requires copying the same shape. A factory function or data-driven approach would reduce this. This is a YAGNI borderline — the current approach is simple and explicit.
- Fix: Consider a helper function in plugins.ts:
```typescript
function languagePlugin(name: string, skill: string, description: string): PluginDefinition {
  return {
    name: `devflow-${name}`,
    description,
    commands: [],
    agents: [],
    skills: [skill],
    optional: true,
  };
}
```
This is a suggestion, not a requirement. The current explicit approach has the advantage of being self-documenting.

**Reviewer agent frontmatter does not list language skills** - `shared/agents/reviewer.md:2-4`
- Problem: The Reviewer agent's frontmatter declares only `skills: review-methodology`. The body instructs the agent to dynamically read skill files based on the `Focus` parameter. This is actually the correct pattern — the Reviewer dynamically loads skills at runtime, not via frontmatter. This contrasts with the Coder agent which lists all skills in frontmatter (see BLOCKING issue above). The inconsistency between these two agents is confusing but the Reviewer's approach is the better one.
- Impact: No runtime impact since the Reviewer explicitly reads skill files during execution. This is the correct architectural pattern for conditional skill loading.
- Fix: No change needed for Reviewer. The Coder should adopt a similar pattern (see BLOCKING issue).

### LOW

**Marketplace.json version skew risk** - `.claude-plugin/marketplace.json`
- Problem: All 8 new plugins are added with `"version": "1.1.0"`, matching the current project version. This is correct for initial release, but the marketplace registry has no mechanism to track when individual plugin versions diverge from the main version. If a Go skill gets a bugfix, all plugins would need version bumps or the marketplace needs per-plugin versioning.
- Impact: Minor. Monorepo versioning is a valid strategy where all plugins share a version. This is only an issue if plugins start having independent release cycles.
- Fix: No immediate action needed. If independent versioning becomes necessary in the future, consider adding version management to the build system.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Coder agent already listed optional skills before this PR** - `shared/agents/coder.md:4` (pre-existing on main)
- Problem: On main, the Coder agent's frontmatter already lists `typescript, react, accessibility, frontend-design` which were bundled with core-skills. This PR correctly moves them to optional plugins but extends the same frontmatter pattern. The pre-existing architectural debt is the frontmatter listing skills that should be dynamically loaded.
- Impact: Works on main because core-skills bundled these skills by default. After this PR, the guarantee is removed — skills are only present if their optional plugin is installed.

### LOW

**Skill SKILL.md files are large relative to target** - `shared/skills/go/SKILL.md`, `shared/skills/python/SKILL.md`, `shared/skills/java/SKILL.md`, `shared/skills/rust/SKILL.md`
- Problem: The project convention states "Target: ~120-150 lines per SKILL.md with progressive disclosure to references/". The new skills are: Go (188 lines), Python (188 lines), Java (183 lines), Rust (193 lines). All are 20-40% over the 150-line target.
- Impact: Skills are loaded into agent context. Larger skill files consume more context tokens. The progressive disclosure pattern (main SKILL.md + references/) is correctly used, but the main files could be trimmed.
- Fix: Consider moving some of the longer code examples to reference files. For example, the Anti-Patterns table and Checklist could be moved to references, keeping the main SKILL.md closer to 120 lines.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 1 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Architecture Score**: 7/10

The core architectural decision is sound: extracting language-specific skills into optional plugins follows good modularity principles (ISP — users install only what they need). The plugin registry, marketplace, and build system changes are well-structured. The new skills follow the established SKILL.md pattern with proper frontmatter, iron laws, and progressive disclosure to reference files.

The main architectural concern is the Coder agent's frontmatter listing all language skills unconditionally. This creates a contract mismatch: the plugin system says these skills are optional, but the agent declaration says they're always needed. The Reviewer agent handles this correctly by dynamically loading skills at runtime, and the Coder should follow the same pattern.

The code-review commands properly guard against missing optional skills with availability checks, but the ambient-router does not, creating an inconsistent optional-skill handling pattern across the system.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Address the Coder agent frontmatter issue (HIGH) — either remove optional skills from frontmatter or add dynamic loading guidance
2. Add skill availability guard to ambient-router (MEDIUM) — match the pattern used by code-review commands
