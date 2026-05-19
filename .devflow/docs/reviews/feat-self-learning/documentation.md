# Documentation Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23

## Issues in Your Changes (BLOCKING)

### HIGH

**`.memory/` tree structure not updated in README or CLAUDE.md to include `learning-log.jsonl`** - `README.md:222`, `CLAUDE.md:96`
**Confidence**: 92%
- Problem: Both README.md and CLAUDE.md include a `.memory/` directory tree that shows the structure users will see on disk. The self-learning feature writes `learning-log.jsonl`, `.learning-update.log`, `.learning-runs-today`, `.learning-last-trigger`, `.learning-notified-at`, and optionally `learning.json` into `.memory/`, but neither tree listing mentions any of these files. A user reading the "Documentation Structure" section in README.md or the `.memory/` tree in CLAUDE.md will not know these files exist or what they are for.
- Fix: Add `learning-log.jsonl` (and optionally the config file `learning.json`) to both tree listings. The dot-prefixed transient files (`.learning-update.log`, `.learning-runs-today`, etc.) can be omitted as implementation details, but the primary data file should be documented:

```markdown
.memory/
├── WORKING-MEMORY.md         # Auto-maintained by Stop hook (overwritten each session)
├── backup.json               # Pre-compact git state snapshot
├── learning-log.jsonl        # Self-learning observations (confidence scores, temporal decay)
├── learning.json             # Optional: project-level learning config overrides
└── knowledge/
    ├── decisions.md           # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md            # Known pitfalls (PF-NNN, area-specific gotchas)
```

### MEDIUM

**CHANGELOG.md `[Unreleased]` section is empty -- no entry for self-learning feature** - `CHANGELOG.md:10`
**Confidence**: 90%
- Problem: This is a significant new feature (1,581 lines added across 11 files) with new CLI commands, hooks, and file formats. The CHANGELOG `[Unreleased]` section has no entry for it. The project uses Keep a Changelog format, and previous releases document features at this scale (e.g., Working Memory, Ambient mode, HUD all have changelog entries).
- Fix: Add an entry under `[Unreleased]`:

```markdown
## [Unreleased]

### Added
- **Self-Learning**: Background agent detects repeated workflows and procedural knowledge across sessions, automatically creating slash commands (`.claude/commands/learned/`) and skills (`.claude/skills/learned-*/`) when confidence thresholds are met
- `devflow learn` CLI command with `--enable`, `--disable`, `--status`, `--list`, `--configure`, `--clear` subcommands
- `--learn` / `--no-learn` flags for `devflow init`
```

**`docs/reference/file-organization.md` not updated with new hooks or CLI command** - `docs/reference/file-organization.md:45-56`
**Confidence**: 88%
- Problem: The file-organization reference doc describes the full source tree, hooks directory, and CLI commands directory. It lists 4 hooks (`stop-update-memory`, `session-start-memory`, `pre-compact-memory`, `ambient-prompt.sh`) but the branch adds 2 new ones (`stop-update-learning`, `background-learning`). It lists CLI commands (`init.ts`, `list.ts`, `memory.ts`, `hud.ts`, `uninstall.ts`) but omits `learn.ts`. The hooks section header says "Working Memory + ambient hooks" but does not mention learning hooks. The Settings Override section lists hooks as "Working Memory hooks (Stop, SessionStart, PreCompact)" without mentioning the learning Stop hook.
- Fix: Update the source tree in `docs/reference/file-organization.md`:
  - Add `stop-update-learning` and `background-learning` to the hooks listing
  - Add `learn.ts` to the CLI commands listing
  - Update the hooks directory comment to include "learning"
  - Add a "Self-Learning Hooks" section parallel to the existing "Working Memory Hooks" section, or expand that section to cover the learning hook

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`session-start-memory` learned behaviors section lacks inline documentation for its injection format** - `scripts/hooks/session-start-memory:130-160`
**Confidence**: 82%
- Problem: The new "Section 1.75: Learned Behaviors" block in the session-start hook (113 lines) assembles context strings for learned commands and skills, but the only section-level comment is `# --- Section 1.75: Learned Behaviors ---`. Unlike the existing memory injection sections which have flow descriptions in `docs/reference/file-organization.md`, there is no documentation of what gets injected into `additionalContext` or the format of the `--- LEARNED BEHAVIORS ---` / `--- NEW LEARNED BEHAVIORS ---` blocks. Future maintainers modifying the context injection pipeline will need to understand this format.
- Fix: Add a brief comment block at the start of the section describing the injection format, e.g.:

```bash
# --- Section 1.75: Learned Behaviors ---
# Injects into additionalContext:
#   --- LEARNED BEHAVIORS ---
#   Commands: /learned/{name} ({confidence}), ...
#   Skills: learned-{name} ({confidence}), ...
#   Edit or delete: .claude/commands/learned/ and .claude/skills/
#   --- NEW LEARNED BEHAVIORS --- (only if new artifacts since last notification)
#   NEW: /learned/{name} command created from repeated workflow
#   TIP: Type the command name to use it. ...
```

**`background-learning` script: 560-line shell script with complex logic lacks architectural overview comment** - `scripts/hooks/background-learning:1-8`
**Confidence**: 80%
- Problem: The header comment (lines 1-7) describes the high-level purpose but does not document the script's major phases or data flow. The script has 7 distinct phases (config loading, daily cap check, transcript extraction, temporal decay processing, LLM invocation, observation processing, artifact creation) across 560 lines. The existing Working Memory hooks follow a similar pattern but are shorter (~200 lines). At 560 lines, a brief architectural overview in the header would help maintainers navigate the file.
- Fix: Expand the header comment to include a phase summary:

```bash
# Background Learning Agent
# Called by stop-update-learning as a detached background process.
# Reads user messages from the session transcript, then uses a fresh `claude -p`
# invocation with Sonnet to detect patterns and update learning-log.jsonl.
# On failure: logs error, does nothing (missing patterns are better than fake data).
#
# Phases:
#   1. Lock acquisition + config loading
#   2. Daily run cap check
#   3. Transcript extraction (user messages only, truncated to 12k chars)
#   4. Temporal decay on existing observations (30-day half-life periods)
#   5. LLM analysis (claude -p with timeout watchdog)
#   6. Observation upsert (new/existing with confidence calculation)
#   7. Artifact creation (commands/skills) for ready observations
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`docs/reference/file-organization.md` skill count (31) is stale vs CLAUDE.md (35)** - `docs/reference/file-organization.md:12`
**Confidence**: 85%
- Problem: The file-organization doc says "31 skills" in the source tree comment, while CLAUDE.md says "35 skills". This predates this PR and is not caused by it, but the discrepancy means any skill count added for this feature could inherit the wrong number.

## Suggestions (Lower Confidence)

- **JSDoc for `LearningObservation.confidence` could document the scale** - `src/cli/commands/learn.ts:1009-1021` (Confidence: 72%) -- The interface defines `confidence: number` but does not document whether this is 0-1 or 0-100. The shell scripts use 0.00-0.95 (fractional), the `--list` command multiplies by 100 for display, and the CLAUDE.md/README docs say "confidence scores" without specifying the range. A JSDoc `@example` or range note would prevent future confusion.

- **`background-learning` prompt template could be extracted to a separate file** - `scripts/hooks/background-learning:332-379` (Confidence: 65%) -- The 47-line LLM prompt is embedded inline in the shell script. Extracting it to a template file (e.g., `scripts/hooks/learning-prompt.txt`) would make it easier to iterate on the prompt without modifying executable code.

- **README Self-Learning section could document the learning-log.jsonl schema** - `README.md:192-210` (Confidence: 62%) -- The section mentions "confidence scores and temporal decay" but does not show the JSONL record format. A brief schema example would help users who want to inspect or script against their learning log.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The core user-facing documentation (README, CLAUDE.md) covers the feature well at a conceptual level, with a clear command reference table and behavioral explanation. However, the `.memory/` directory tree -- a key reference artifact that users consult to understand what files DevFlow creates -- omits the new `learning-log.jsonl` file entirely in both README.md and CLAUDE.md. The `docs/reference/file-organization.md` detailed reference is also not updated with the new hooks, CLI command, or settings. The missing CHANGELOG entry is a process gap for a feature of this scale. The shell scripts themselves have adequate inline comments for individual functions but would benefit from higher-level architectural documentation given their length.
