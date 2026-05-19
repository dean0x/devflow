# Documentation Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### HIGH

**CLAUDE.md missing rules system documentation** - `CLAUDE.md`
**Confidence**: 95%
- Problem: The rules system is a new first-class feature with its own build pipeline (`shared/rules/`), install path (`~/.claude/rules/devflow/`), CLI command (`devflow rules`), manifest tracking, and init flags (`--rules/--no-rules`). However, CLAUDE.md -- the primary developer guide -- has zero documentation of the rules system. Every other comparable feature (Working Memory, Ambient Mode, Self-Learning, Decisions, Feature Knowledge, Flags) has a dedicated bold paragraph in the Architecture Overview section. The rules system has none.
- Impact: Developers and AI agents relying on CLAUDE.md for authoritative project documentation will not know rules exist, how they flow through the build pipeline, or how to create/modify them. This contradicts the Iron Law: "Documentation must match reality."
- Fix: Add a **Rules** paragraph to the Architecture Overview section (after **Claude Code Flags** or **Feature Knowledge Bases**), covering: rules live in `shared/rules/`, declared in `plugin.json` `rules` array, built to `plugins/*/rules/`, installed to `~/.claude/rules/devflow/`, plugin-scoped (not universal like skills), shadow overrides at `~/.devflow/rules/{name}.md`, toggleable via `devflow rules --enable/--disable/--status` or `devflow init --rules/--no-rules`. Applies ADR-001 (no migration code -- `LEGACY_RULE_NAMES` starts empty).

**CLAUDE.md Project Structure tree missing `shared/rules/`** - `CLAUDE.md:71-88`
**Confidence**: 95%
- Problem: The Project Structure tree lists `shared/skills/` and `shared/agents/` but not `shared/rules/`. The new `shared/rules/` directory is a source-of-truth directory on par with skills and agents.
- Impact: Developers looking at the project structure overview will not know `shared/rules/` exists.
- Fix: Add `shared/rules/` to the tree:
```
devflow/
├── shared/skills/          # 57 skills (single source of truth)
├── shared/agents/          # 14 shared agents (single source of truth)
├── shared/rules/           # 11 rules (single source of truth)
```

**CLAUDE.md Install paths missing rules** - `CLAUDE.md:90`
**Confidence**: 95%
- Problem: The Install paths line reads: "Commands -> `~/.claude/commands/devflow/`, Agents -> `~/.claude/agents/devflow/`, Skills -> `~/.claude/skills/devflow:*/`, Scripts -> `~/.devflow/scripts/`". Rules are missing.
- Impact: Developers won't know the install target for rules.
- Fix: Append: Rules -> `~/.claude/rules/devflow/`

**CLAUDE.md Build System section missing rules** - `CLAUDE.md:232-237`
**Confidence**: 95%
- Problem: The Build System critical rules mention `shared/skills/` and `shared/agents/` as single source of truth, gitignored copies in `plugins/*/skills/`, and `plugin.json` declaring `skills` and `agents` arrays. Rules follow the same pattern but are not mentioned.
- Impact: A developer editing rules won't know they need `npm run build` or that `plugins/*/rules/` are gitignored build outputs.
- Fix: Update the Build System section to include:
  - `shared/rules/` is the single source of truth for rules
  - Generated copies in `plugins/*/rules/` are gitignored
  - Plugin manifests declare `rules` arrays

**CLAUDE.md CLI description missing `rules`** - `CLAUDE.md:79`
**Confidence**: 92%
- Problem: The CLI description reads "TypeScript CLI (init, list, uninstall, ambient, learn, decisions, flags, knowledge)" but does not include `rules`.
- Impact: Developers won't know the rules CLI command exists.
- Fix: Change to "TypeScript CLI (init, list, uninstall, ambient, learn, decisions, flags, knowledge, rules)"

**CLAUDE.md Two-Mode Init paragraph missing rules default** - `CLAUDE.md:65`
**Confidence**: 90%
- Problem: The Two-Mode Init paragraph lists recommended defaults: "ambient ON, memory ON, learn ON, decisions ON, HUD ON, teams OFF, default-ON flags, .claudeignore ON, auto-install safe-delete..." but does not mention rules ON (which is the default in the code).
- Impact: Developers won't know rules are enabled by default in recommended mode.
- Fix: Add "rules ON" to the recommended defaults list.

### MEDIUM

**docs/cli-reference.md missing rules command and init flags** - `docs/cli-reference.md`
**Confidence**: 92%
- Problem: The CLI reference document does not include: (1) the `devflow rules` command with its `--enable/--disable/--status/--list` subcommands, and (2) the `--rules/--no-rules` init flags in the Init Options table. Every other toggleable feature (ambient, memory, learn, hud) has both its command section and its init flags documented here. The `--knowledge/--no-knowledge` and `--decisions/--no-decisions` flags are also missing from the Init Options table, but those are pre-existing gaps, not introduced by this PR.
- Impact: Users consulting the CLI reference won't discover the rules management command. The `--rules/--no-rules` init flags are undiscoverable from docs.
- Fix: (1) Add a `## Rules` section after Skill Shadowing with usage examples. (2) Add `--rules / --no-rules` and `--knowledge / --no-knowledge` and `--decisions / --no-decisions` to the Init Options table.

**CLAUDE.md Development Loop missing rules workflow** - `CLAUDE.md:92-110`
**Confidence**: 82%
- Problem: The Development Loop shows editing skills as `vim shared/skills/security/SKILL.md` and mentions the build distributes "skills/agents to plugins". Rules follow the same edit-build-install flow but are not shown.
- Impact: A developer creating a new rule won't know the workflow.
- Fix: Add a rules example to the Development Loop and update the build description:
```bash
vim shared/rules/security.md   # Rules in shared/
```
And update build comment: "compiles CLI + distributes skills/agents/rules to plugins"

**CLAUDE.md Build commands description incomplete** - `CLAUDE.md:110`
**Confidence**: 80%
- Problem: Build commands line says `npm run build:plugins` does "skill/agent distribution only". It now also distributes rules.
- Impact: Minor documentation drift -- developer might not realize rules are distributed by the plugin build.
- Fix: Update to "skill/agent/rule distribution only"

## Issues in Code You Touched (Should Fix)

### MEDIUM

**README "17 plugins" count outdated** - `README.md:59`
**Confidence**: 85%
- Problem: README says "Everything is composable. 17 plugins (8 core + 9 language/ecosystem)." But the CLAUDE.md plugin table shows 20 plugins (11 core + 9 optional). This is a pre-existing miscount, but the README was modified in this PR (the rules paragraph was added at line 55), making this a "code you touched" issue.
- Impact: Users see inconsistent plugin counts between README sections.
- Fix: Update to "20 plugins (11 core + 9 optional language/ecosystem)" to match the actual DEVFLOW_PLUGINS count.

**README "18 parallel code reviewers" count** - `README.md:49`
**Confidence**: 80%
- Problem: The README claims "18 parallel code reviewers" but the reviewer agent system in the code-review orchestration reviews focus areas listed in the Conditional Activation table (this reviewer agent's system prompt lists 18 focus areas including language-specific ones). This is borderline -- the count may have been correct when written -- but worth verifying since the README was touched in this PR.
- Impact: Misleading count if inaccurate.
- Fix: Verify the actual reviewer count matches. If it's still 18, no change needed. If not, update the number.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs/cli-reference.md Init Options table missing several flags** - `docs/cli-reference.md:17-27`
**Confidence**: 88%
- Problem: The Init Options table is missing `--knowledge/--no-knowledge` and `--decisions/--no-decisions` flags that were added in prior PRs. These are not new to this PR but represent documentation drift.
- Impact: Users can't discover these flags from the CLI reference.
- Fix: Add the missing flags to the Init Options table in a separate PR.

## Suggestions (Lower Confidence)

- **CLAUDE.md "three independent self-learning systems" paragraph could mention rules** - `CLAUDE.md:60-63` (Confidence: 65%) -- The "Three independent self-learning systems" list might benefit from clarifying that rules are a separate, fourth system (not self-learning but always-on guidance). Currently the boundary between rules and the three learning systems is implicit.

- **Rule files lack JSDoc-style metadata comments** - `shared/rules/*.md` (Confidence: 62%) -- The 11 rule files have YAML frontmatter (`paths`) but no inline documentation explaining their relationship to the corresponding skill. A brief comment like "See devflow:security skill for detailed patterns" could help users who discover rules before skills.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 6 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

The code changes are well-implemented and internally consistent -- the rules system is thoroughly wired through init, uninstall, build, manifest, and tests. The feature knowledge base (`KNOWLEDGE.md`) is excellent and comprehensive. However, the primary developer-facing documentation (`CLAUDE.md` and `docs/cli-reference.md`) has not been updated to reflect the new feature. CLAUDE.md documents every other feature system in detail but has zero mention of rules. This is a significant documentation gap for a feature that loads on every prompt. The README was updated appropriately with a user-facing description. Applies ADR-001 (clean break -- `LEGACY_RULE_NAMES` correctly starts empty).
