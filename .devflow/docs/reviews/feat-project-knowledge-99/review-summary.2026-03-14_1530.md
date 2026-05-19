# Review Summary: feat/project-knowledge-99

**PR**: #140
**Date**: 2026-03-14
**Reviewers**: 9 (security, architecture, performance, complexity, consistency, regression, tests, typescript, documentation)

## Merge Recommendation

CHANGES_REQUESTED

Two issues warrant changes before merge: (1) duplicate step numbering in implement-teams.md exploration prompts is a concrete bug that will cause agent confusion at runtime, and (2) the knowledge extraction procedure is duplicated verbatim across 8 command files, creating a significant maintenance burden that should be consolidated into a shared skill or reference document.

## Consolidated Findings

### BLOCKING

**1. Duplicate step number "5" in all four exploration teammate prompts** — HIGH
- Sources: architecture, complexity, consistency, regression, documentation (5 reviewers)
- Location: `plugins/devflow-implement/commands/implement-teams.md` lines 78-79, 92-93, 106-107, 120-121
- Problem: When inserting the new knowledge-reading step 2 and renumbering steps 2->3, 3->4, 4->5, the original step 5 ("Report completion: SendMessage...") was not renumbered to 6. All four explorer prompts (architecture-explorer, integration-explorer, reusable-code-explorer, edge-case-explorer) now have two consecutive steps numbered "5". Agents may skip the SendMessage completion report, which is a behavioral requirement for the team-lead to know when exploration is done.
- Fix: Renumber the final "Report completion" step from 5 to 6 in all four explorer prompts.

**2. Duplicated knowledge extraction procedure across 8 command files (DRY violation)** — HIGH
- Sources: architecture, complexity (2 reviewers)
- Locations: code-review.md, code-review-teams.md, debug.md, debug-teams.md, implement.md, implement-teams.md, resolve.md, resolve-teams.md
- Problem: The pitfall-recording procedure (7 steps: read file, check cap, find highest ID, append, deduplicate, update TL;DR, lock) is copied verbatim across 6 command files. The decision-recording procedure follows the same pattern across 2 more files. If the format changes (cap, lock path, new field), all 8 files must be updated in lockstep — a textbook shotgun surgery smell.
- Fix: Extract into a shared skill (e.g., `shared/skills/knowledge-persistence/SKILL.md`) or shared reference document. Commands reference it with a single line. This matches the project's established pattern of skills as reusable knowledge.

**3. Tests validate inline logic, not exported functions** — HIGH
- Sources: tests, typescript (2 reviewers)
- Location: `tests/memory.test.ts:345-486`
- Problem: The `knowledge file format` test suite (8 tests, ~142 lines) tests parsing logic that exists only within the test bodies — TL;DR extraction, ADR numbering regex, dedup detection, TL;DR updates. These tests are self-referential: they define the algorithm in the test and assert it works, but no production code is exercised. If the shell hook or command instructions diverge from these patterns, the tests will still pass.
- Fix: Extract knowledge file parsing into a TypeScript module (`src/cli/utils/knowledge.ts`) with typed functions (`parseTldr()`, `extractHighestEntryNumber()`, `isDuplicatePitfall()`, `updateTldr()`) and test those exports. Alternatively, add integration tests that invoke the session-start hook with fixture data.

**4. Inconsistent lock specification across commands** — MEDIUM
- Sources: security, architecture, consistency (3 reviewers)
- Locations: debug.md, debug-teams.md, resolve.md, resolve-teams.md
- Problem: The code-review and implement commands specify `(30s timeout, 60s stale recovery)` for the mkdir-based lock, but debug and resolve commands omit these parameters entirely. Without explicit stale recovery, a crashed debug/resolve session could leave an orphaned lock that blocks all future knowledge writes indefinitely.
- Fix: Add `(30s timeout, 60s stale recovery)` to all four commands that omit it. This becomes a non-issue if the extraction logic is consolidated (see issue #2).

**5. Fractional step numbering "2.5" in code-review-teams reviewer prompts** — MEDIUM
- Sources: complexity, consistency, regression, documentation (4 reviewers)
- Location: `plugins/devflow-code-review/commands/code-review-teams.md` lines 88, 102, 116, 134
- Problem: The pitfalls-reading step is inserted as "2.5." between steps 2 and 3 in each reviewer teammate prompt. This breaks sequential integer numbering used everywhere else in agent prompts and is inconsistent with implement-teams.md which renumbered sequentially.
- Fix: Renumber steps sequentially (2.5 becomes 3, subsequent steps increment).

**6. Fractional step numbering "1.5" in reviewer agent responsibilities** — MEDIUM
- Sources: architecture, complexity, regression, documentation (4 reviewers)
- Location: `shared/agents/reviewer.md:44-47`
- Problem: The new pitfall-checking responsibility is inserted as "1.5." between responsibilities 1 and 2, breaking the sequential integer list. Markdown renderers will not auto-number this correctly.
- Fix: Renumber responsibilities sequentially from 1 to 11.

**7. Inconsistent template header detail across commands** — MEDIUM
- Sources: consistency (1 reviewer)
- Locations: debug.md, debug-teams.md, resolve.md, resolve-teams.md
- Problem: Code-review variants provide the full pitfalls.md template header inline, while debug and resolve variants just say "create with template header if missing" without specifying the template content. Agents running debug/resolve must guess the header format.
- Fix: Add the explicit template header to debug and resolve variants, matching code-review.

**8. No test coverage for session-start hook's knowledge injection** — MEDIUM
- Sources: tests (1 reviewer)
- Location: `scripts/hooks/session-start-memory:122-140`
- Problem: 20 lines of new shell logic (TL;DR parsing, grep filtering, printf injection) have zero test coverage. The shell hook is the actual production consumer of the knowledge file format.
- Fix: Add an integration test that invokes the session-start-memory hook with fixture knowledge files and asserts the JSON output includes the `PROJECT KNOWLEDGE (TL;DR)` section.

### Should Fix

**9. No input sanitization on TL;DR content injected into session context** — MEDIUM (security)
- Location: `scripts/hooks/session-start-memory:122-140`
- Problem: TL;DR content is read from knowledge files and injected directly into Claude's session context. An attacker with filesystem write access to `.memory/knowledge/` could inject arbitrary instructions. Mitigated by requiring local filesystem access.
- Fix: Add a length cap (200 chars) and format validation on the extracted TL;DR content.

**10. Knowledge integrity verification absent** — MEDIUM (security)
- Location: `shared/agents/coder.md:38-39`
- Problem: The Coder agent reads decisions.md and pitfalls.md as authoritative guidance with no mechanism to verify integrity. Append-only constraint is enforced only by instruction, not code.
- Fix: Acceptable risk for the current trust model. Consider adding a line count in the TL;DR header for basic validation.

**11. Skimmer reads TL;DR only but Coder reads full file — no documented rationale** — MEDIUM (architecture, consistency)
- Locations: `shared/agents/skimmer.md:23`, `shared/agents/coder.md:38`
- Problem: The asymmetry is intentional (skimmer for orientation, coder for detail) but undocumented. At 50 entries, the full decisions.md could be several thousand tokens, which works against token-conservative design.
- Fix: Document the rationale; add filtering guidance to the Coder ("scan titles for relevance, read full entries only for relevant decisions").

**12. Session-start hook leading newlines when Section 1 skipped** — MEDIUM (architecture)
- Location: `scripts/hooks/session-start-memory:122-140`
- Problem: When WORKING-MEMORY.md does not exist but knowledge files do, the CONTEXT variable starts empty and Section 1.5 prepends `\n\n---` to an empty string, producing leading blank lines.
- Fix: Guard the newline prepend with `if [ -n "$CONTEXT" ]`.

**13. Stale counts in file-organization.md** — MEDIUM (documentation)
- Location: `docs/reference/file-organization.md:12,23`
- Problem: Says "24 skills" (actual: 31) and "8 plugins" (actual: 17). Since the file is actively modified in this PR, counts should be corrected.
- Fix: Update to accurate counts.

**14. Stale hooks list in file-organization.md** — MEDIUM (documentation)
- Location: `docs/reference/file-organization.md:43-47`
- Problem: Missing `ambient-prompt.sh` from the hooks directory listing. File is being modified in this PR.
- Fix: Add the ambient hook entry.

**15. Skimmer output template misaligned with responsibility instruction** — MEDIUM (documentation)
- Location: `shared/agents/skimmer.md:67-68`
- Problem: Output template is more detailed than the instruction. Responsibility step 6 does not mention parsing the `<!-- TL;DR: ... -->` HTML comment format.
- Fix: Align responsibility step 6 with the output template.

**16. `createMemoryDir` catches all exceptions silently** — MEDIUM (typescript)
- Location: `src/cli/utils/post-install.ts:479-485`
- Problem: The catch block swallows all errors including genuine failures (permissions, disk full), not just "already exists" which `recursive: true` already handles. The PR adds a second `mkdir` call into this same silent catch.
- Fix: Log the error in verbose mode.

**17. Missing test for `createMemoryDir` failure path** — MEDIUM (tests)
- Location: `tests/memory.test.ts:258-271`
- Problem: Only happy-path tests exist. The silent catch block in production code masks real errors with no test verification.

**18. Phase ordering inconsistency between code-review variants** — MEDIUM (regression)
- Locations: code-review.md (pitfalls recorded after display) vs code-review-teams.md (pitfalls recorded before display)
- Problem: Non-teams variant records pitfalls after displaying results; teams variant records before. Should be standardized.

**19. Missing knowledge integration in `/specify` and `/self-review`** — MEDIUM (regression)
- Problem: The PR adds knowledge reading to `/implement`, `/code-review`, `/debug`, and `/resolve`, but `/specify` and `/self-review` are not updated. This may be intentional scoping but creates an incomplete migration.
- Fix: Either add knowledge reading to these commands or document the intentional exclusion.

**20. Sequential subprocess spawns in session-start hook** — HIGH (performance)
- Location: `scripts/hooks/session-start-memory:126-132`
- Problem: The hook runs `head -1` and `sed` as separate subprocesses per knowledge file on the session-start critical path. Can be combined into a single `sed` invocation, halving subprocess spawns.
- Fix: `sed -n '1s/<!-- TL;DR: \(.*\) -->/\1/p'` replaces both `head -1` and `sed`.

### Suggestions

- **Lock timeouts disproportionate to operation** (performance, confidence: 80%) — 30s timeout / 60s stale recovery for operations completing in <1s. Consider reducing to 5s/15s.
- **Deduplication bypass via minor wording changes** (security, architecture, confidence: 68-70%) — Exact string matching on Area+Issue fields. Near-duplicate entries could accumulate with minor variations.
- **Knowledge files in `.memory/` vs separate `.knowledge/` directory** (architecture, confidence: 70%) — ADRs and pitfalls are persistent project artifacts with different lifecycle than ephemeral session memory.
- **No programmatic knowledge management** (architecture, confidence: 65%) — All operations specified as natural-language instructions. A thin TypeScript utility could codify locking, dedup, and capacity enforcement.
- **Duplicated knowledge-read instructions in 4 explorer prompts** (complexity, confidence: 85%) — All 4 explorers independently read the same 2 knowledge files. Could inject once via orchestrator.
- **Session-start hook approaching complexity threshold** (complexity, confidence: 80%) — Now 172 lines with 3 major sections. Consider extracting into sourced functions if another section is added.
- **README.md missing Project Knowledge section** (documentation, confidence: 75%) — New user-facing feature deserves mention in README.
- **No centralized ADR/PF entry format template** (documentation, confidence: 70%) — Command files repeat field lists independently.
- **`let` used where `const` pipeline sufficient** in test code (typescript, confidence: 75%).
- **No cap enforcement in session-start hook** (security, confidence: 65%) — Hook does not verify the 50-entry cap is respected.

## Issue Counts

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 5 | 0 |
| Should Fix | 0 | 1 | 11 | 0 |

## Scores by Focus

| Focus | Score | Recommendation |
|-------|-------|---------------|
| Security | 8/10 | APPROVED_WITH_CONDITIONS |
| Architecture | 7/10 | CHANGES_REQUESTED |
| Performance | 8/10 | APPROVED_WITH_CONDITIONS |
| Complexity | 7/10 | CHANGES_REQUESTED |
| Consistency | 7/10 | CHANGES_REQUESTED |
| Regression | 7/10 | CHANGES_REQUESTED |
| Tests | 5/10 | CHANGES_REQUESTED |
| TypeScript | 7/10 | APPROVED_WITH_CONDITIONS |
| Documentation | 7/10 | CHANGES_REQUESTED |

## Key Themes

**1. Procedure duplication is the dominant architectural concern.** The knowledge extraction procedure (7-step pitfall recording, 6-step decision recording) is copied verbatim across 8 command files. Five of nine reviewers flagged issues that would be resolved or mitigated by extracting this into a single shared skill or reference document — the DRY violation itself, the inconsistent lock specs, the inconsistent template headers, and the duplicated explorer read instructions. This is the single highest-leverage fix in the PR.

**2. Step numbering errors introduced by incomplete renumbering.** The duplicate step 5 in implement-teams.md was flagged by 5 of 9 reviewers as a concrete bug. The fractional "1.5" and "2.5" numbering in reviewer.md and code-review-teams.md was flagged by 4 reviewers as inconsistent. Both are mechanical errors from inserting steps without completing the renumbering pass. All are straightforward text fixes.

**3. Tests validate format contracts but lack production code connection.** The knowledge file format tests define parsing logic inline rather than testing exported functions. Two reviewers (tests, typescript) independently identified that this creates a coverage illusion — the tests prove a regex works in isolation but do not prove the shell hook or agent instructions implement the same logic. Extracting parsing into a TypeScript utility module would connect the tests to production code and eliminate the self-referential pattern.
