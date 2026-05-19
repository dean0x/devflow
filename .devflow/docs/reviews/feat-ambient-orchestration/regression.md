# Regression Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**Commits**: 2 (595cd05 feat(ambient): add agent orchestration, 15849ce fix(ambient): three-tier model)
**Files Changed**: 18 (+497, -141)

## Issues in Your Changes (BLOCKING)

### HIGH

**`test-driven-development` dropped from GUIDED/IMPLEMENT skill selection matrix** - `shared/skills/ambient-router/SKILL.md:57-61`
- Problem: On main, `test-driven-development` was a primary skill for BUILD (now IMPLEMENT) at GUIDED depth. The new GUIDED-depth skill matrix in Step 3 lists only `implementation-patterns, search-first` for IMPLEMENT. The `test-driven-development` skill is no longer selected by any entry in the matrix. Meanwhile, Step 4 (line 91) still contains the conditional "If test-driven-development is selected (IMPLEMENT intent), you MUST write the failing test before ANY production code" -- but this conditional is now dead code because the matrix never selects TDD. The README at `plugins/devflow-ambient/README.md:70` still advertises "test-driven-development -- TDD enforcement for IMPLEMENT (GUIDED + ORCHESTRATED)".
- Impact: IMPLEMENT/GUIDED prompts (main session implementation) will no longer enforce TDD. This was the signature quality behavior of ambient BUILD/GUIDED. The Coder agent retains TDD in its frontmatter (`shared/agents/coder.md:5`), so ORCHESTRATED mode is unaffected. But GUIDED mode -- the most common ambient tier for implementation -- loses TDD enforcement entirely.
- Fix: Add `test-driven-development` back to the GUIDED IMPLEMENT primary skills in `shared/skills/ambient-router/SKILL.md` Step 3:
  ```markdown
  | **IMPLEMENT** | implementation-patterns, search-first, test-driven-development | typescript (.ts)... |
  ```
  Also add it to `shared/skills/ambient-router/references/skill-catalog.md` IMPLEMENT table at GUIDED + ORCHESTRATED depth. Alternatively, if the intent is that TDD at GUIDED depth is enforced through the `test-driven-development` auto-activation file patterns rather than the ambient skill matrix, document that explicitly and remove the dead conditional from Step 4.

### MEDIUM

**marketplace.json description not updated** - `.claude-plugin/marketplace.json:94`
- Problem: The marketplace registry still reads `"Ambient mode -- auto-loads relevant skills for every prompt"` while `src/cli/plugins.ts:73` was updated to `"Ambient mode -- intent classification with proportional agent orchestration"` and `plugins/devflow-ambient/.claude-plugin/plugin.json:3` was updated similarly. The marketplace.json was not touched in this branch.
- Impact: Users browsing the marketplace see stale description that does not mention agent orchestration, the primary new capability.
- Fix: Update `.claude-plugin/marketplace.json` line 94:
  ```json
  "description": "Ambient mode — intent classification with proportional agent orchestration",
  ```
  Also consider updating the keywords array (lines 97-101) from `["ambient", "routing", "quality", "tdd"]` to include `"orchestration"` and `"agents"`.

**init.ts `--ambient` flag description not updated** - `src/cli/commands/init.ts:108`
- Problem: The `--ambient` CLI flag still reads `'Enable ambient mode (auto-loads relevant skills for every prompt)'`. This was not updated alongside the other description changes in `src/cli/plugins.ts` and `src/cli/commands/ambient.ts`.
- Impact: Users running `devflow init --help` see stale description.
- Fix: Update `src/cli/commands/init.ts:108`:
  ```typescript
  .option('--ambient', 'Enable ambient mode (intent classification with agent orchestration)')
  ```
  Also update the interactive prompt hint at line 228 which reads `'Auto-loads relevant skills for each prompt'`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**EXPLORE intent downgraded from split QUICK/GUIDED to always QUICK** - `shared/skills/ambient-router/SKILL.md:43`
- Problem: On main, EXPLORE was nuanced: simple exploration ("where is X?") was QUICK, but analytical exploration ("analyze our X", "discuss how Y works") was GUIDED with skill loading. In the new router, ALL EXPLORE is QUICK with zero overhead. This change is not mentioned in the CHANGELOG.
- Impact: Users asking "analyze our authentication pattern" or "explain how our caching layer works in detail" previously got skill-assisted analytical responses. Now they get bare zero-overhead responses. Power users who relied on skill-guided analysis lose that behavior.
- Fix: Either restore the analytical EXPLORE/GUIDED classification, or add a note to the CHANGELOG documenting this intentional simplification:
  ```markdown
  - **Ambient mode**: EXPLORE intent now always QUICK (analytical prompts previously could trigger GUIDED)
  ```

**"Update the README" reclassified from BUILD/GUIDED to QUICK** - `shared/skills/ambient-router/SKILL.md:40`
- Problem: On main, the ambiguous prompt guidance explicitly said `"Update the README" -> BUILD/GUIDED`. Now it says `"Update the README" -> QUICK`. While the CHANGELOG mentions the three-tier model change, it does not specifically call out this reclassification.
- Impact: Low direct impact -- README updates being QUICK is reasonable. But the shift in classification philosophy (more aggressive downclassification toward QUICK) is undocumented and could surprise users who noticed the old behavior.
- Fix: Document in the CHANGELOG:
  ```markdown
  - **Ambient mode**: Classification conservatism increased — simple edits like "update the README" now QUICK (previously BUILD/GUIDED)
  ```

### LOW

**`performance-patterns` added to explicit exclusion list** - `shared/skills/ambient-router/SKILL.md:82`
- Problem: The "Excluded from ambient" list now includes `performance-patterns` which was not explicitly listed on main. On main, performance-patterns was not in any ambient selection matrix and not in the explicit exclusion list. Now it is explicitly excluded.
- Impact: None -- this formalizes an implicit exclusion. No behavioral change.
- Fix: No code fix needed; informational only.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CONTRIBUTING.md skill count stale** - `CONTRIBUTING.md:27`
- Problem: Says "26 skills" but there are 35 skill directories on this branch (32 on main). The count was already stale before this branch.
- Impact: Misleading for contributors.

### LOW

**Coder agent `search-first` redundantly declared** - `shared/agents/coder.md:5`
- Problem: `search-first` was added to the Coder agent frontmatter skills. However, `search-first` is already distributed by the `devflow-core-skills` plugin (`src/cli/plugins.ts:27`), which is installed for all users. The skill would already be in context.
- Impact: No functional regression. Redundant declaration is harmless and provides defense-in-depth for edge cases where ambient plugin is installed without core-skills.

**Orchestration skills reference informal "Explore agents" and "Plan agent"** - `shared/skills/debug-orchestration/SKILL.md:34` and `shared/skills/plan-orchestration/SKILL.md:33,43`
- Problem: The orchestration skills reference "Explore agents" and "Plan agent" but no `explore.md` or `plan.md` exist in `shared/agents/`. These are ad-hoc sub-agent invocations.
- Impact: Terminology inconsistency with the project convention of formal agent definition files. Not a regression -- new code, new pattern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 1 |
| Pre-existing | 0 | 0 | 1 | 2 |

## Regression Checklist

- [x] No exports removed without deprecation (no TypeScript exports changed)
- [x] Return types backward compatible (N/A for markdown/skill files)
- [ ] **PARTIAL** -- Default values unchanged: EXPLORE depth default changed from split QUICK/GUIDED to always QUICK; "Update the README" reclassified
- [x] Side effects preserved -- ambient-prompt hook updated consistently with new taxonomy
- [x] All consumers of changed code updated (tests updated in second commit 15849ce)
- [x] Migration complete across codebase -- no stale BUILD/ELEVATE references in skills, plugins, or TypeScript code (only in CHANGELOG historical entries, which is correct)
- [x] CLI options preserved or deprecated
- [x] API endpoints preserved or versioned (N/A)
- [x] Commit message matches implementation (second commit clarifies: "three-tier model, search-first on Coder, debug agent budget")
- [x] Breaking changes documented in CHANGELOG (added in second commit)

## Behavioral Changes Summary

| Behavior | Before (main) | After (this branch) | Documented? |
|----------|--------------|---------------------|-------------|
| BUILD intent name | BUILD | IMPLEMENT | Yes (CHANGELOG) |
| ELEVATE tier name | ELEVATE | ORCHESTRATED | Yes (CHANGELOG) |
| ELEVATE behavior | Nudge to /implement | Full agent pipeline | Yes (CHANGELOG) |
| TDD in GUIDED/IMPLEMENT | Primary skill, always loaded | Not in selection matrix (dead conditional) | No -- README says it is still enforced |
| "Update the README" | BUILD/GUIDED | QUICK | No |
| EXPLORE with analysis | Could be GUIDED | Always QUICK | No |
| Agents in ambient | None (main session only) | 7 agents available for ORCHESTRATED | Yes (CHANGELOG) |
| performance-patterns exclusion | Implicit (not in any matrix) | Explicit (in exclusion list) | No |
| Coder agent skills | 6 skills | 8 skills (+test-driven-development, +search-first) | Yes (CHANGELOG) |

**Regression Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

This branch successfully renames BUILD to IMPLEMENT, replaces ELEVATE with ORCHESTRATED, introduces three new orchestration skills, and adds 7 agents to the ambient plugin. The taxonomy migration is thorough -- no stale BUILD/ELEVATE references remain in any active code files. Tests and helpers were properly updated in the second commit. The CHANGELOG documents the major changes.

The one HIGH blocking issue is the silent loss of `test-driven-development` from the GUIDED/IMPLEMENT skill selection matrix. TDD enforcement was the signature quality behavior of ambient BUILD/GUIDED mode, and its removal from the matrix (while keeping a dead conditional reference in Step 4 and advertising it in the README) creates an inconsistency that will silently degrade quality for the most common ambient usage path. The Coder agent preserves TDD for ORCHESTRATED mode, but GUIDED -- where the main session implements directly -- gets no TDD skill injection.

The MEDIUM blocking issues (stale marketplace.json and init.ts descriptions) are low-effort consistency fixes.
