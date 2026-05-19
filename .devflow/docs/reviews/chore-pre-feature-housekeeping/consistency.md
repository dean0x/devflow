# Consistency Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent `get_mtime()` detection strategy across scripts** - `scripts/statusline.sh:16`
**Confidence**: 90%
- Problem: The new `get_mtime()` helper in `statusline.sh` uses a "try the flag itself" detection approach (`stat -f %m "$1" &>/dev/null 2>&1`) to distinguish macOS vs Linux. However, the existing `get_mtime()` in `scripts/hooks/background-memory-update` (line 35) and the inline mtime logic in `scripts/hooks/session-start-memory` (line 31) and `scripts/hooks/stop-update-memory` (line 39) all use `stat --version &>/dev/null` as the detection mechanism (GNU stat supports `--version`, BSD stat does not). This creates two different mtime detection strategies in the same project's shell scripts.
- Fix: Align `statusline.sh` with the existing pattern used in all three hook scripts:
```bash
get_mtime() {
    if stat --version &>/dev/null 2>&1; then
        stat -c %Y "$1"  # Linux (GNU stat)
    else
        stat -f %m "$1"  # macOS (BSD stat)
    fi
}
```

**Skimmer Task invocation in `plan-orchestration` skill not updated** - `shared/skills/plan-orchestration/SKILL.md:26`
**Confidence**: 85%
- Problem: The Skimmer Task invocations in `implement.md`, `implement-teams.md`, `specify.md`, and `specify-teams.md` were all updated to say "Run rskim on source directories (NOT repo root)". However, the `plan-orchestration/SKILL.md` skill (line 26) still uses the generic phrasing `Spawn Task(subagent_type="Skimmer") to get codebase overview` without the rskim-specific instructions. Since this skill also spawns a Skimmer agent, it should use consistent invocation wording.
- Fix: Update `shared/skills/plan-orchestration/SKILL.md` line 26-29 to include the rskim directive:
```markdown
Spawn `Task(subagent_type="Skimmer")` to get codebase overview relevant to the planning question.
Include in the task prompt: "Run rskim on source directories (NOT repo root) to find:"

- Existing patterns and conventions in the affected area
```

### MEDIUM

**Residual "via skim" references in command flow diagrams** (4 occurrences) -- Confidence: 85%
- `plugins/devflow-specify/commands/specify.md:140`, `plugins/devflow-specify/commands/specify-teams.md:273`, `plugins/devflow-implement/commands/implement.md:363`, `plugins/devflow-implement/commands/implement-teams.md:550`
- Problem: The Task invocation text in these commands was updated from "Use skim" to "Run rskim", but the ASCII flow diagrams at the bottom of each file still say "via skim" instead of "via rskim". The agent description in the shared source (`shared/agents/skimmer.md`) was renamed from "skim" to "rskim", so all references should match.
- Fix: Update each flow diagram line to say "via rskim" instead of "via skim". For example:
```
│  └─ Skimmer agent (codebase context via rskim)
```

**`specify/README.md` still references old "skim" name** - `plugins/devflow-specify/README.md:32`
**Confidence**: 85%
- Problem: The README says `skimmer - Codebase orientation using skim for file/function discovery` while the agent description now says "using rskim". Plugin READMEs should reflect the current agent descriptions.
- Fix: Update to `skimmer - Codebase orientation using rskim for file/function discovery`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Skimmer agent at 143 lines exceeds Utility agent target** - `shared/agents/skimmer.md`
**Confidence**: 80%
- Problem: Per `docs/reference/agent-design.md` line 51, Utility agents (including Skimmer) have a target of 50-80 lines. The rewritten Skimmer is now 143 lines, which is in Worker/Orchestration territory (80-150). The agent-design doc itself was updated in this PR to add the `tools` section, but the Length Guidelines table still lists Skimmer as a Utility agent example.
- Fix: Either reclassify Skimmer as a Worker agent in the Length Guidelines table, or refactor the rskim Reference table and detailed mode descriptions into a `references/` file to bring the agent closer to the 80-line target.

**Skimmer is the only agent with `tools` restriction -- no migration pattern for others** - `shared/agents/skimmer.md:4`, `docs/reference/agent-design.md:34`
**Confidence**: 80%
- Problem: The new `tools` frontmatter field and accompanying documentation in `agent-design.md` recommends using platform-enforced tool restrictions ("prefer platform-enforced restriction over prompt instructions"). However, Skimmer is the only agent that uses it. Other agents that could benefit from tool restrictions (e.g., Validator, which "never fixes issues" but has access to all tools; Shepherd, which "never fixes code" but has full tool access) remain unrestricted. This creates a pattern that is documented as recommended but applied to only 1 of 10 agents.
- Fix: This is not blocking, but consider adding a follow-up task to audit other agents for appropriate `tools` restrictions. At minimum, `Validator` (which should never write) and `Shepherd` (which should never write) are candidates.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Inconsistent mtime detection across hook scripts (no shared helper)** - `scripts/hooks/session-start-memory:31`, `scripts/hooks/stop-update-memory:39`
**Confidence**: 82%
- Problem: Three hook scripts (`background-memory-update`, `session-start-memory`, `stop-update-memory`) each implement their own mtime detection inline. `background-memory-update` already has a `get_mtime()` function, but the other two use inline if/else blocks. Now `statusline.sh` adds a fourth implementation with a different detection approach. There is no shared utility for portable mtime across these scripts.
- Fix: Informational only. A shared `lib/portable-stat.sh` could be sourced by all scripts, but this is out of scope for this PR.

## Suggestions (Lower Confidence)

- **`sort -V` portability** - `scripts/statusline.sh:192` (Confidence: 65%) -- `sort -V` (version sort) is available on macOS via coreutils and on most Linux distros, but some minimal environments may lack it. Given the script already gates on `command -v jq` and `command -v npm`, this is likely acceptable, but worth noting.

- **Test file naming convention** - `tests/skimmer-agent.test.ts` (Confidence: 60%) -- Most test files are named after the module they test (e.g., `plugins.test.ts`, `manifest.test.ts`, `skills.test.ts`). The new `skimmer-agent.test.ts` is the only test file with a hyphenated compound name that tests a non-TypeScript artifact (a markdown agent file). This is a minor naming pattern deviation and may be intentional since it tests a different kind of asset.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The primary consistency concerns are: (1) the `get_mtime()` detection strategy diverges from the established pattern used in all other hook scripts, and (2) the skim-to-rskim rename was applied to the agent and Task invocations but not carried through to flow diagrams, READMEs, or the `plan-orchestration` skill. These are straightforward fixes that would bring the PR into full alignment.
