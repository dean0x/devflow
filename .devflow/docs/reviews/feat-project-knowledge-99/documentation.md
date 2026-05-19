# Documentation Review Report

**Branch**: feat/project-knowledge-99 -> main
**Date**: 2026-03-14

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicate step numbers in implement-teams.md exploration teammates** - `plugins/devflow-implement/commands/implement-teams.md:78-79, 92-93, 106-107, 120-121`
**Confidence**: 95%
- Problem: After inserting the new step 2 ("Read knowledge files"), the remaining steps were renumbered from 2->3, 3->4, 4->5, but step 5 ("Document findings") was not renumbered to 6. This creates two consecutive step 5s in all four exploration teammate prompts. The original file had the same pre-existing bug (steps 4, 4 duplicate), but this PR made it worse by renumbering some steps and leaving the duplication. Since the PR touched and renumbered these lines, this is a blocking issue.
- Fix: Renumber the second step 5 to step 6 in all four teammate prompts:
```
    5. Document findings with file:path references.
    6. Report completion: SendMessage(type: "message", recipient: "team-lead",
```
This applies to the architecture-explorer (line 78-79), integration-explorer (line 92-93), reusable-code-explorer (line 106-107), and edge-case-explorer (line 120-121).

### MEDIUM

**Reviewer agent uses non-standard step numbering "1.5"** - `shared/agents/reviewer.md:44`
**Confidence**: 82%
- Problem: The new responsibility is numbered "1.5." rather than using sequential integer numbering. While the intent is clear (insert between steps 1 and 2), this is inconsistent with the numbered list format (1, 2, 3, 4...) used in the rest of the document. Markdown renderers will not auto-number "1.5" correctly.
- Fix: Renumber to use sequential integers:
```markdown
1. **Load focus skill** - ...
2. **Check known pitfalls** - ...
3. **Identify changed lines** - ...
4. **Apply 3-category classification** - ...
```
Or, if renumbering all subsequent items is too invasive, add it as a sub-bullet under step 1.

**Code-review-teams.md uses non-standard step numbering "2.5" for teammate prompts** - `plugins/devflow-code-review/commands/code-review-teams.md:88,102,116,134`
**Confidence**: 82%
- Problem: Same pattern as the reviewer agent -- uses "2.5." step numbering in all four review teammate prompts. This is not valid Markdown numbered list syntax and breaks sequential ordering.
- Fix: Renumber the steps in each teammate prompt to use sequential integers (1, 2, 3, 4, 5, 6).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale counts in file-organization.md** - `docs/reference/file-organization.md:12,23`
**Confidence**: 90%
- Problem: The PR adds the new "Project Knowledge" section to `file-organization.md` but does not update the stale counts in the same file. Line 12 says "24 skills" but the actual count is 31. Line 23 says "8 plugins" but the actual count is 17. These were stale before this PR, but since this file is being actively modified, they should be corrected while here.
- Fix: Update the source tree comments:
```
│   ├── skills/                       # SINGLE SOURCE OF TRUTH (31 skills)
...
├── plugins/                          # Plugin collection (17 plugins)
```

**Stale hooks list in file-organization.md** - `docs/reference/file-organization.md:43-47`
**Confidence**: 85%
- Problem: The hooks directory listing in the source tree shows only 3 hooks (`stop-update-memory`, `session-start-memory`, `pre-compact-memory`) but is missing `ambient-prompt.sh` which was added in Wave 1. Since this file is being modified in this PR, this should also be corrected.
- Fix: Add the ambient hook to the directory tree:
```
│   └── hooks/                        # Working Memory + ambient hooks
│       ├── stop-update-memory       # Stop hook: writes WORKING-MEMORY.md
│       ├── session-start-memory     # SessionStart hook: injects memory + git state
│       ├── pre-compact-memory       # PreCompact hook: saves git state backup
│       └── ambient-prompt.sh        # UserPromptSubmit hook: ambient skill injection
```

**Skimmer agent output template lacks knowledge file entry format documentation** - `shared/agents/skimmer.md:67-68`
**Confidence**: 80%
- Problem: The new "Active Decisions" section in the Skimmer output template says `{Count and key decisions from .memory/knowledge/decisions.md TL;DR, or "None found" if file missing}`, but the responsibility (step 6) only says to "read its first line (TL;DR) and include active decision count." The output template placeholder is more detailed than the instruction, which could lead to inconsistent implementations. Also, the responsibility says "read its first line" but the TL;DR is an HTML comment, so agents need to know to parse the `<!-- TL;DR: ... -->` format.
- Fix: Align responsibility step 6 to explicitly mention parsing the HTML comment format:
```
6. **Check project knowledge** - If `.memory/knowledge/decisions.md` exists, read its first line and parse the `<!-- TL;DR: ... -->` comment. Include decision count and key decisions in orientation under "### Active Decisions". If file is missing, output "None found".
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**README.md not updated with Project Knowledge documentation** - `README.md`
**Confidence**: 75% (in Suggestions due to threshold)
- The README.md was not modified in this PR. Since this is a new user-facing feature (`.memory/knowledge/` files with ADR and PF formats), the README would benefit from a brief mention of the knowledge system, but this is not blocking since it is a pre-existing documentation gap that can be addressed separately.

### LOW

**No ADR/PF entry format template in docs** - N/A
**Confidence**: 70% (in Suggestions due to threshold)
- While the command files describe the fields for ADR and PF entries (Date, Status, Context, Decision, Consequences, Source for ADRs; Area, Issue, Impact, Resolution, Source for PFs), there is no centralized template showing the exact Markdown format an entry should take. Each command file repeats the field list independently. A template in `docs/reference/` or in the docs-framework skill would reduce duplication and ensure consistency.

## Suggestions (Lower Confidence)

- **README.md missing Project Knowledge section** - `README.md` (Confidence: 75%) -- New feature deserves a user-facing mention in the README, but can be a follow-up PR.

- **No centralized ADR/PF entry template** - N/A (Confidence: 70%) -- Command files repeat the entry field lists independently. A shared template would improve maintainability.

- **Coder agent "Key Decisions" output section placement** - `shared/agents/coder.md:94-95` (Confidence: 65%) -- The new "Key Decisions (if any)" section is placed between "PR (if created)" and "Blockers (if any)" in the standard (non-handoff) output. This is fine, but the same "Key Decisions" section already exists in the handoff output template (line 110). Could lead to confusion about which template to use when HANDOFF_REQUIRED is false but architectural decisions were made.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 3 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Documentation Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The documentation effort is thorough overall -- CLAUDE.md, docs-framework SKILL.md, file-organization.md, and all six command files (both base and teams variants) were updated consistently. The session-start hook correctly injects TL;DR lines, and the agent modifications (coder, reviewer, skimmer) coherently integrate the knowledge system.

The primary blocking issue is the duplicate step numbering in `implement-teams.md` which will cause agent confusion at runtime. The non-standard "1.5" and "2.5" numbering in `reviewer.md` and `code-review-teams.md` is a lesser concern but inconsistent with the sequential numbering pattern used everywhere else. The stale counts in `file-organization.md` should be corrected while the file is open for editing.
