# Security Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07_1147

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Removal of user confirmation gates in pipeline:orch allows auto-resolution of CRITICAL findings** - `shared/skills/pipeline:orch/SKILL.md:13-17,49-52`
**Confidence**: 85%
- Problem: The previous pipeline:orch Iron Law was "USER GATES BETWEEN STAGES" -- requiring explicit user confirmation before auto-resolving review findings. The new Iron Law is "FULL PIPELINE, NO INTERRUPTIONS" and auto-proceeds from review to resolve without any human judgment gate. `AskUserQuestion` was removed from `allowed-tools`. When review discovers CRITICAL security vulnerabilities (e.g., SQL injection, hardcoded credentials), the pipeline now auto-resolves them without human review of the findings. An AI Resolver agent deciding how to "fix" a CRITICAL security issue without human oversight could introduce a worse vulnerability (e.g., a Resolver might suppress a security warning rather than truly fixing the underlying issue, or apply an incomplete patch that appears to fix but leaves a variant exploitable).
- Fix: Restore user confirmation gate specifically for CRITICAL severity blocking issues while allowing auto-proceed for HIGH/MEDIUM/LOW. In Phase 4 of pipeline:orch, add a conditional check: if any CRITICAL blocking issues were found, prompt the user; otherwise auto-proceed. This preserves the streamlined flow for non-critical findings while maintaining human oversight for the most dangerous issues.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shell script reads and injects file content without size bounds** - `scripts/hooks/session-start-classification:19-23`
**Confidence**: 82%
- Problem: The session-start-classification hook reads `classification-rules.md` (or falls back to the full router SKILL.md via `awk`) and injects the entire content as `additionalContext`. While the classification-rules.md is currently small (~30 lines), the fallback path at line 23 strips only YAML frontmatter from the full SKILL.md and injects the rest. If the SKILL.md grows or if a user creates a shadow override at `~/.devflow/skills/router/SKILL.md` with arbitrary content, there is no size check before injection. This is a defense-in-depth concern -- a maliciously large file could bloat session context.
- Fix: Add a size guard before injection. For example, after line 26:
```bash
# Guard: skip if content exceeds reasonable bounds (e.g., 4KB)
if [ ${#CONTEXT} -gt 4096 ]; then
  exit 0
fi
```

**Router SKILL.md removed `allowed-tools` from frontmatter** - `shared/skills/router/SKILL.md:1-5`
**Confidence**: 80%
- Problem: The old router SKILL.md had a comment `# No allowed-tools: orchestrator requires unrestricted access` which documented the intentional omission. The new version simply omits `allowed-tools` without any documentation of why. While this is functionally unchanged (omitting `allowed-tools` means unrestricted per project conventions), the previous version's comment served as security documentation explaining why an unrestricted skill is acceptable. Removing the comment reduces auditability.
- Fix: Re-add the explanatory comment in the frontmatter:
```yaml
---
name: router
description: This skill should be used after ambient classification...
user-invocable: false
# No allowed-tools: router orchestrates skill loading and requires unrestricted tool access
---
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell hook uses `cat` to read stdin without input validation** - `scripts/hooks/session-start-classification:13-15`
**Confidence**: 80%
- Problem: The pattern `INPUT=$(cat)` followed by `echo "$INPUT" | json_field "cwd" ""` is consistent with other hooks in the project (session-start-memory, preamble, etc.), but none of these hooks validate that the input is valid JSON before extracting fields. A malformed input could cause unexpected `json_field` behavior. This is pre-existing across all hooks in the project, not specific to this PR.
- Fix: Add JSON validation before field extraction (applies to all hooks, not just this one):
```bash
if ! echo "$INPUT" | jq empty 2>/dev/null; then exit 0; fi
```

## Suggestions (Lower Confidence)

- **Classification rules contain intent signal words that could be manipulated** - `shared/skills/router/references/classification-rules.md:7-14` (Confidence: 65%) -- A user could craft prompts containing signal words ("implement", "pipeline") to trigger ORCHESTRATED classification and spawn 15+ agents when they only wanted a quick answer. This is a prompt injection adjacent concern, though the user is also the attacker in this single-user tool, so impact is self-inflicted resource consumption.

- **`awk` fallback in session-start-classification may extract more than intended** - `scripts/hooks/session-start-classification:23` (Confidence: 70%) -- The `awk '/^---$/{n++; next} n>=2'` pattern extracts everything after the second `---` fence. If the SKILL.md contains multiple `---` separators (e.g., in code blocks or horizontal rules within the content), the extraction may include or exclude unexpected content. The current SKILL.md does not have this issue, but it is fragile against future edits.

- **Pipeline auto-resolve could mask review findings from user awareness** - `shared/skills/pipeline:orch/SKILL.md:49-52` (Confidence: 75%) -- When the pipeline auto-resolves blocking issues without a user gate, the user may never see the review findings at all if they are resolved successfully. The Phase 6 summary should always include the full list of what was found and resolved, not just counts. Currently the summary section (lines 63-67) lists "issues fixed vs deferred vs false positives" which is appropriate, but there is no explicit requirement to include the original finding descriptions.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The most significant security concern is the removal of the user confirmation gate in pipeline:orch for CRITICAL findings. The auto-resolve pattern means security vulnerabilities flagged by reviewers are automatically "fixed" by AI agents without human judgment. For a tool whose stated purpose is "developer empowerment without replacing judgment" (CLAUDE.md), this change moves in the opposite direction for the highest-severity security findings. All other changes (Task->Agent renaming, three-layer architecture refactoring, classification rules extraction) are security-neutral.
