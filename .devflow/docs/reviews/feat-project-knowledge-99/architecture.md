# Architecture Review Report

**Branch**: feat/project-knowledge-99 -> main
**Date**: 2026-03-14

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated knowledge extraction logic across 8 command files (DRY / SRP violation)** - `plugins/devflow-code-review/commands/code-review.md:120-131`, `plugins/devflow-code-review/commands/code-review-teams.md:219-230`, `plugins/devflow-debug/commands/debug.md:132-142`, `plugins/devflow-debug/commands/debug-teams.md:147-157`, `plugins/devflow-implement/commands/implement.md:347-357`, `plugins/devflow-implement/commands/implement-teams.md:534-544`, `plugins/devflow-resolve/commands/resolve.md:93-104`, `plugins/devflow-resolve/commands/resolve-teams.md:152-164`
**Confidence**: 88%
- Problem: The pitfall extraction procedure (steps 1-7: read file, check cap, find highest number, append, deduplicate, update TL;DR, skip condition) is copy-pasted verbatim across 6 command files (code-review, code-review-teams, debug, debug-teams, resolve, resolve-teams). The decision extraction procedure follows the same pattern and is duplicated across 2 more files (implement, implement-teams). Each copy specifies identical locking, capacity checks, deduplication, regex, and TL;DR update logic. If the format changes (e.g., entry schema gains a field, cap increases from 50, lock path changes), all 8 files must be updated in lockstep.
- Impact: Maintenance burden scales linearly with command count. A fix to one copy but not the others creates silent divergence. This is a textbook SRP violation -- the knowledge persistence concern is mixed into the orchestration concern of each command.
- Fix: Extract the knowledge extraction procedure into a shared skill or a shared reference document. Options:
  1. **Shared skill** (preferred): Create `shared/skills/knowledge-persistence/SKILL.md` that defines the canonical append procedure, entry schemas, locking protocol, and capacity rules. Commands then reference it: "Follow the knowledge persistence procedure from `~/.claude/skills/knowledge-persistence/SKILL.md` for pitfall/decision recording." This matches the existing pattern where agents reference skills rather than embedding logic.
  2. **Shared reference document**: Add `docs/reference/knowledge-persistence.md` with the canonical procedure, and have commands say "Follow the knowledge persistence procedure in `docs/reference/knowledge-persistence.md`."

  Either approach reduces the 8 copies to 1 authoritative source plus 8 one-line references.

**Inconsistent step numbering in implement-teams.md exploration teammates** - `plugins/devflow-implement/commands/implement-teams.md:78-79`, `plugins/devflow-implement/commands/implement-teams.md:93-94`, `plugins/devflow-implement/commands/implement-teams.md:107-108`
**Confidence**: 95%
- Problem: When steps were renumbered to accommodate the new step 2 (knowledge reading), the original step 5 ("Report completion") was not renumbered. It remains as step "5" even though the preceding step is now step "5" as well (formerly step 4). Each teammate prompt now has two consecutive steps numbered "5":
  ```
  4. Your deliverable: Find similar implementations...
  5. Document findings with file:path references.
  5. Report completion: SendMessage(...)
  ```
  The second "5" should be "6".
- Impact: While this is a prompt for an AI agent (not executable code), duplicate numbering creates ambiguity. An agent could interpret these as alternatives rather than sequential steps.
- Fix: Renumber the "Report completion" step to 6 in all four teammate prompts (architecture-explorer, integration-explorer, reusable-code-explorer, edge-case-explorer).

### MEDIUM

**Inconsistent lock specification across commands** - `plugins/devflow-debug/commands/debug-teams.md:157`, `plugins/devflow-debug/commands/debug.md:142`, `plugins/devflow-resolve/commands/resolve-teams.md:164`, `plugins/devflow-resolve/commands/resolve.md:104`
**Confidence**: 82%
- Problem: The lock instructions vary across commands. The code-review and implement commands specify full parameters: "mkdir-based lock at `.memory/.knowledge.lock` (30s timeout, 60s stale recovery)". But the debug and resolve commands use a shorter form: "mkdir-based lock at `.memory/.knowledge.lock` if writing" -- omitting timeout and stale recovery parameters. Since these are instructions for AI agents, the inconsistency means debug/resolve agents might implement locking differently (or skip timeout/stale recovery), leading to potential deadlocks or stale locks.
- Impact: If a debug session crashes mid-write, the lock may persist indefinitely with no stale recovery, blocking subsequent knowledge writes from any command.
- Fix: Standardize the lock specification across all 8 command files to include "(30s timeout, 60s stale recovery)" consistently. Better yet, this becomes a non-issue if the extraction logic is consolidated into a shared skill (see HIGH issue above).

**Knowledge injection only fires when WORKING-MEMORY.md exists** - `scripts/hooks/session-start-memory:122-140`
**Confidence**: 85%
- Problem: Section 1.5 (Project Knowledge TL;DR) fires unconditionally on the `KNOWLEDGE_DIR` check -- this part is correct. However, the `CONTEXT` variable is only initialized to a non-empty string inside the `if [ -f "$MEMORY_FILE" ]` block (line 27). If `.memory/WORKING-MEMORY.md` does not exist but `.memory/knowledge/decisions.md` does, the knowledge TL;DR will still be injected because `CONTEXT` starts as empty string `""` and gets appended to. But the section header `--- PROJECT KNOWLEDGE (TL;DR) ---` would be the entire context, with no preceding memory section. This actually works correctly due to the final `[ -z "$CONTEXT" ]` check at line 161. Upon closer inspection, the code path is:
  - `CONTEXT=""` at line 21
  - Section 1 skipped (no WORKING-MEMORY.md)
  - Section 1.5 appends to CONTEXT with knowledge TL;DR
  - Section 2 may append ambient
  - Line 161 checks non-empty and outputs

  The logic is sound, but the `CONTEXT` variable accumulates sections with inconsistent leading newlines. When Section 1 is skipped, Section 1.5 prepends `\n\n--- PROJECT KNOWLEDGE ---` to an empty string, resulting in leading blank lines in the injected context. This is cosmetic but slightly wasteful of tokens.
- Fix: Guard the newline prepend:
  ```bash
  if [ -n "$KNOWLEDGE_TLDR" ]; then
    if [ -n "$CONTEXT" ]; then
      CONTEXT="${CONTEXT}\n"
    fi
    CONTEXT="${CONTEXT}--- PROJECT KNOWLEDGE (TL;DR) ---
  $(printf '%b' "$KNOWLEDGE_TLDR")"
  fi
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Reviewer agent uses non-standard step numbering** - `shared/agents/reviewer.md:47`
**Confidence**: 84%
- Problem: The new responsibility is numbered "1.5" rather than being assigned a proper integer and renumbering subsequent steps. While the existing codebase has adopted fractional numbering for phase additions in commands (Phase 4.5, Phase 11.5, etc.), the reviewer agent's responsibility list uses standard integers (1, 2, 3...) and inserting "1.5" breaks the established sequential numbering pattern within this specific file.
- Impact: Minor readability issue. Agents parsing numbered instructions may treat "1.5" differently than integer steps, though in practice this is unlikely to cause behavioral problems.
- Fix: Renumber to use integers: the new step becomes 2, and existing steps 2-10 become 3-11. Alternatively, if fractional numbering is an intentional convention for non-breaking additions, document that convention somewhere.

**Skimmer reads only TL;DR line for decisions but Coder reads full file** - `shared/agents/skimmer.md:23` vs `shared/agents/coder.md:38`
**Confidence**: 80%
- Problem: The Skimmer is instructed to read only the first line (TL;DR) of `decisions.md` and report the count. The Coder reads the full `decisions.md` file. This asymmetry is intentional (skimmer is for orientation, coder needs detail), but the Skimmer's output section specifies `### Active Decisions` with "Count and key decisions from TL;DR", while the Coder's instructions say "Apply prior architectural decisions relevant to this task." There is no guidance for the Coder on how to determine which decisions are "relevant" -- it must read the entire file and make that judgment, which could be expensive if the file grows toward the 50-entry cap.
- Impact: At 50 ADR entries with full context/decision/consequences sections, `decisions.md` could reach several thousand tokens. The Coder reads this in full every time, which works against the token-conservative design stated in the PR description.
- Fix: Consider adding filtering guidance to the Coder: "Scan ADR titles (## ADR-NNN: title) for relevance to current task. Read full entries only for relevant decisions." This maintains token efficiency at scale while preserving the full-file-read as a fallback.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Knowledge files live in `.memory/` but are conceptually different from session memory** - `.memory/knowledge/` directory structure
**Confidence**: 70% (moved to Suggestions due to confidence level)

## Suggestions (Lower Confidence)

- **Knowledge files as a distinct concern from session memory** - `.memory/knowledge/` (Confidence: 70%) -- ADRs and pitfalls are persistent project artifacts with append-only semantics, while `.memory/WORKING-MEMORY.md` and `backup.json` are ephemeral session state that gets overwritten. Colocating these under `.memory/` mixes two different lifecycle patterns. A future refactoring might consider `.knowledge/` as a top-level directory, or even tracking these files in git (decisions especially are project-level artifacts that arguably belong in version control).

- **No programmatic knowledge management** - (Confidence: 65%) -- All knowledge extraction is implemented as natural-language instructions embedded in command markdown files, with no TypeScript code backing it. The locking, deduplication, capacity checks, and TL;DR updates are all described procedurally for the AI agent to interpret and execute. This works for the current agent-driven architecture but means there are no programmatic guarantees about format consistency, concurrent write safety, or capacity enforcement. As the system matures, a thin TypeScript utility (`src/cli/utils/knowledge.ts`) could codify these operations.

- **Deduplication relies on exact string match** - `plugins/devflow-code-review/commands/code-review.md:127` (Confidence: 68%) -- The deduplication check ("skip if same Area + Issue already exists") uses exact string matching. If the same pitfall is reported with slightly different wording (e.g., "Glob didn't match" vs "Glob pattern failed to match"), it will create a duplicate entry. Fuzzy matching would be more robust but may be over-engineering for the current scale.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core design is sound: lightweight TL;DR injection at session start, on-demand full reads by agents, append-only persistence with caps and deduplication. The system respects the existing plugin architecture and avoids introducing new agents or heavy infrastructure. However, the significant DRY violation (8 copies of the knowledge extraction procedure) is the primary architectural concern. Extracting this into a shared skill would bring the duplication to zero and align with the project's established pattern of skills as reusable knowledge. The step numbering inconsistency in implement-teams.md is a straightforward fix. The inconsistent lock specs across commands should be standardized to prevent subtle behavioral divergence.
