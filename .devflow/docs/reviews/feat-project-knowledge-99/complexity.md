# Complexity Review Report

**Branch**: pr-140 -> main
**Date**: 2026-03-14
**PR**: #140 — feat: Wave 2 -- project knowledge system (decisions + pitfalls) (#99)

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated 7-step pitfall-recording procedure across 4 command files** - `plugins/devflow-code-review/commands/code-review.md:120-131`, `plugins/devflow-code-review/commands/code-review-teams.md:219-230`, `plugins/devflow-resolve/commands/resolve.md:91-103`, `plugins/devflow-resolve/commands/resolve-teams.md:151-163`
- Problem: The "Record Pitfalls" procedure (steps 1-7: read file, check count, regex for highest PF-NNN, append, deduplicate, update TL;DR, skip guard) is copied verbatim into 4 separate command files. The `debug.md` and `debug-teams.md` files have a nearly identical variant (6 steps instead of 7) for an additional 2 copies, making 6 total instances of essentially the same multi-step procedure.
- Impact: When the recording procedure changes (e.g., bumping the cap from 50, changing the lock path, adding a new field), every copy must be updated. This is the classic shotgun surgery smell. At 7 inline steps, this is a meaningful procedure being duplicated, not just a one-liner.
- Fix: Extract the pitfall-recording and decision-recording procedures into a shared reference document (e.g., `shared/skills/docs-framework/references/knowledge-procedures.md`) and reference it from each command with a single line like "Follow the Record Pitfalls procedure from `docs-framework/references/knowledge-procedures.md`." This pattern is already used elsewhere (e.g., review-methodology references). Similarly, the decision-recording procedure in `implement.md` / `implement-teams.md` could reference the same document.

**Duplicated knowledge-file-read instructions added to 4 explorer prompts** - `plugins/devflow-implement/commands/implement-teams.md:72-73`, `implement-teams.md:84-85`, `implement-teams.md:100-101`, `implement-teams.md:112-113`
- Problem: The instruction "Read `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md` if they exist. Consider prior decisions and known pitfalls relevant to this task." is copied identically into all 4 exploration teammate prompts (architecture-explorer, integration-explorer, reusable-code-explorer, edge-case-explorer). All 4 explorers read the same 2 files and perform the same analysis on them.
- Impact: This is moderate duplication within a single file. If the knowledge file paths or reading instructions change, 4 identical blocks must be updated. More importantly, having all 4 explorers independently read and consider the same knowledge files is wasteful -- the knowledge context could be injected once by the orchestrator and passed via the prompt, or a single explorer could be designated as the knowledge-aware one.
- Fix: Inject the knowledge file content into the shared `{skimmer output}` context block that all explorers already receive, or designate a single explorer (e.g., architecture-explorer) as responsible for knowledge integration. This avoids 4 redundant Read operations at runtime.

### MEDIUM

**Numbering collision in explorer prompts (duplicate step "5")** - `plugins/devflow-implement/commands/implement-teams.md:79-80`, `implement-teams.md:93-94`, `implement-teams.md:107-108`, `implement-teams.md:121-122`
- Problem: The renumbering after inserting step 2 (knowledge files) left two steps both numbered "5" in each explorer prompt. Step 5 is "Document findings with file:path references" and the following step 5 is "Report completion: SendMessage(...)". This happened in all 4 explorer prompts.
- Impact: Confusing instructions for agent execution. While agents can likely infer the intent, ambiguous step numbering reduces instruction clarity and could cause an agent to skip the second step 5 if it interprets the instructions literally.
- Fix: Renumber step 5 (Report completion) to step 6 in each of the 4 explorer prompts. Example for architecture-explorer:
  ```
  5. Document findings with file:path references.
  6. Report completion: SendMessage(type: "message", recipient: "team-lead",
     summary: "Architecture exploration done")
  ```

**Step numbering "2.5" used as a step identifier in reviewer prompts** - `plugins/devflow-code-review/commands/code-review-teams.md:88`, `code-review-teams.md:102`, `code-review-teams.md:116`, `code-review-teams.md:134`
- Problem: The pitfall-reading step is inserted as "2.5" between steps 2 and 3 across all 4 reviewer prompts. Fractional step numbers are an unusual convention that signals the step was squeezed in as an afterthought rather than integrated into the sequence.
- Impact: LOW cognitive overhead for humans reading the commands, but slightly more confusing for LLM agents parsing numbered instructions. The inconsistency between "2.5" in reviewers and "2 + renumber" in explorers (within the same PR) is a style inconsistency.
- Fix: Renumber steps sequentially (2.5 becomes 3, old 3 becomes 4, etc.) or accept the "2.5" convention and document it as intentional. The inconsistency across commands in the same PR is the real issue.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Session-start hook approaching complexity threshold** - `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory:1-172`
- Problem: The `session-start-memory` script is now 172 lines with 3 major sections (Working Memory, Project Knowledge TL;DR, Ambient Skill Injection), each with nested conditionals. The new Section 1.5 (lines 122-140) adds a loop with nested conditionals (`if dir exists` > `for file` > `if file exists` > `sed` + `grep -qv` > `if non-empty`). While the new section itself is only 19 lines and reasonably clean, the overall script is accumulating sections and should be watched.
- Impact: The script is still manageable but approaching the point where a new developer would need more than 5 minutes to understand the full flow. Each new section adds another conditional block.
- Fix: No immediate action required, but consider extracting each section into a sourced function (e.g., `inject_working_memory`, `inject_knowledge_tldr`, `inject_ambient_skill`) if another section is added. The script is at the "one more section and it needs refactoring" threshold.

### LOW

**Test file length growing** - `/Users/dean/Sandbox/devflow/tests/memory.test.ts:1-487`
- Problem: The test file grew from 344 to 487 lines with the addition of the `knowledge file format` describe block (143 lines). The file now covers 5 distinct concerns: `addMemoryHooks`, `removeMemoryHooks`, `hasMemoryHooks/countMemoryHooks`, `createMemoryDir`, `migrateMemoryFiles`, and `knowledge file format`.
- Impact: The file is still under the 500-line warning threshold but approaching it. The new test block tests file format conventions (TL;DR parsing, ADR numbering, deduplication) which are conceptually separate from memory hook management.
- Fix: Consider splitting into `memory-hooks.test.ts` and `memory-knowledge.test.ts` when the file next needs expansion. Not blocking now.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**implement-teams.md is a 626-line command file** - `/Users/dean/Sandbox/devflow/plugins/devflow-implement/commands/implement-teams.md:1-626`
- Problem: This is the largest command file in the project. It contains 13 phases (1 through 11.5), 4 team shutdown protocols, strategy selection logic, and loop-based retry mechanisms. The new changes added Phase 11.5 (12 lines) and knowledge-reading instructions to 4 explorer prompts (8 lines), bringing it from ~596 to ~626 lines.
- Impact: Well above the 500-line file length critical threshold. The file is becoming a monolith that's hard to review, diff, and maintain. However, command files are structured differently from code files -- they are orchestration scripts with inherently sequential phases, so the threshold is less strictly applicable.
- Fix: This is a pre-existing structural issue. Consider extracting phase definitions into separate files or using a shared reference for common patterns (team shutdown protocol, validation loops) that appear in both `implement.md` and `implement-teams.md`.

### LOW

**Knowledge tests validate format conventions without a shared parser** - `/Users/dean/Sandbox/devflow/tests/memory.test.ts:346-486`
- Problem: The knowledge file format tests inline the TL;DR parsing logic (`firstLine.replace(...)`, `matchAll(/^## ADR-(\d+)/gm)`, `includes()` for deduplication) directly in each test rather than testing a shared utility function. This means the "specification" of how to parse these files lives only in test assertions and in prose instructions within command files.
- Impact: If agents implement the parsing differently than the tests specify, there is no shared code to enforce consistency. This is a design observation, not a complexity issue per se -- the format is intentionally agent-interpreted, not machine-parsed.
- Fix: If the format becomes more complex, consider creating a small utility module that both the hook script and tests share. For now, the format is simple enough that inline parsing is acceptable.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | - | 0 | 1 | 1 |
| Pre-existing | - | 0 | 1 | 1 |

**Complexity Score**: 7/10

The changes are well-structured individually. The knowledge system design (TL;DR headers, append-only files, entry caps, deduplication, locking) is thoughtfully constrained. The primary complexity concern is the 6-way duplication of the recording procedures across command files, which creates a maintenance burden that will compound over time. The numbering errors in the explorer prompts (duplicate step 5) are a concrete bug introduced by the renumbering.

**Recommendation**: CHANGES_REQUESTED

Two blocking issues should be addressed:
1. Extract the duplicated recording procedures into a shared reference (reduces 6 copies to 1 source of truth)
2. Fix the duplicate step 5 numbering in all 4 explorer prompts in `implement-teams.md`
