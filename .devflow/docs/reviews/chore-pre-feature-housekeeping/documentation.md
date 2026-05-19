# Documentation Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20
**PR**: #153

## Issues in Your Changes (BLOCKING)

### CRITICAL

_None._

### HIGH

_None._

### MEDIUM

**CLAUDE.md does not document the new `tools` frontmatter field for agents** - `CLAUDE.md:133-138`
**Confidence**: 85%
- Problem: The PR introduces `tools` as a new agent frontmatter field (documented in `docs/reference/agent-design.md` and used in `shared/agents/skimmer.md`), but `CLAUDE.md` section "### Agents" (lines 133-138) does not mention this convention. CLAUDE.md is the primary entry point for developers and AI agents and lists agent conventions (target lines, skills via frontmatter, input/output contracts, escalation boundaries). The `tools` restriction is a meaningful behavioral difference -- agents with `tools` set are platform-restricted, which is quite different from the default unrestricted access. This is analogous to how "### Skills" documents the `allowed-tools` convention.
- Fix: Add a bullet under `### Agents` in CLAUDE.md mentioning the `tools` frontmatter field:
```markdown
### Agents

- Target: 50-150 lines depending on type (Utility 50-80, Worker 80-120)
- Reference skills via frontmatter, don't duplicate skill content
- Define clear input/output contracts and escalation boundaries
- Use `tools` frontmatter to platform-restrict agent tool access (prefer over prompt-level prohibitions)
- Shared agents live in `shared/agents/` -- add to plugin `plugin.json` `agents` array
```

## Issues in Code You Touched (Should Fix)

_None._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Statusline script header comment could document the update-badge feature** - `scripts/statusline.sh:3-5`
**Confidence**: 80%
- Problem: The file header comment (line 4) was updated to include "update badge" in the display list, which is good. However, the new version-check section (lines 173-218) contains no function-level comment explaining the cache strategy (24h TTL, async background refresh, `~/.cache/devflow/latest-version` file). The existing sections of the script (git branch detection, context usage) have inline comments explaining their approach, but the version-check block only has a single-line comment. This is a minor alignment gap -- the code is readable, but a 2-line comment block at the top of the section explaining the cache TTL strategy would match the documentation density of the rest of the file.

### LOW

**README does not mention the version update notification feature** - `README.md`
**Confidence**: 80%
- Problem: The changelog entry adds "Version update notification" as an Added feature, but the README (which describes devflow's features to end users) does not mention the statusline or its capabilities at all. This is a pre-existing gap -- the statusline was already undocumented in the README before this PR. Not blocking since this is a housekeeping PR, not a feature release, and the changelog adequately describes the change.

## Suggestions (Lower Confidence)

- **Skimmer agent Step 4 says "Use this instead of Read" but `tools` allows Read** - `shared/agents/skimmer.md:62` (Confidence: 65%) -- Step 4 advises "Use this instead of Read for code files" when doing deep inspection via `npx rskim --mode full`. Since `tools: ["Bash", "Read"]` explicitly allows Read, this guidance could be confusing. The intent is clear (prefer rskim for consistency), but the wording implies Read should not be used at all for code files, which contradicts the tool allowlist. Consider rewording to "Prefer this over Read for code files to maintain consistent token statistics."

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Documentation Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

This PR is a well-structured housekeeping batch with 4 commits covering distinct concerns. Documentation quality is generally strong:

- **Changelog**: All four changes are properly documented in `[Unreleased]` under correct categories (Added/Fixed). Descriptions are concise and include relevant technical detail.
- **Agent design reference**: The new "Tool Restrictions" section in `docs/reference/agent-design.md` is well-written, includes a concrete example, and clearly explains the platform-enforcement advantage over prompt-level instructions.
- **Skimmer agent**: The rewrite from 50-line loose guidance to a 144-line structured 6-step workflow with rskim reference table is a significant documentation improvement. Sequential steps are clear, the CRITICAL warning about root scanning is prominent, and the fallback path for older rskim versions is documented.
- **Command alignment**: All four Skimmer invocation sites (implement, implement-teams, specify, specify-teams) were updated consistently to reference rskim with the root-scan warning.
- **Test documentation**: `tests/skimmer-agent.test.ts` has good JSDoc on the helper function and descriptive test names.

The single blocking item (CLAUDE.md not mentioning `tools` frontmatter) is a minor gap that should be addressed to keep the primary developer guide aligned with the new convention.
