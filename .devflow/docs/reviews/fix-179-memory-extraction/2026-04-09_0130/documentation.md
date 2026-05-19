# Documentation Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09_0130

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Preamble header comment contradicts new behavior** - `scripts/hooks/preamble:5`
**Confidence**: 95%
- Problem: The file header states "Zero file I/O beyond stdin -- static injection only." but this PR adds a subshell (lines 22-37) that writes to `.memory/.pending-turns.jsonl` on every user prompt. This is file I/O, directly contradicting the header's claim. The comment will actively mislead anyone reading the file to understand its side effects.
- Fix: Update the header to reflect the new dual responsibility:
```bash
# Devflow Preamble: UserPromptSubmit Hook
# 1. Queues the user prompt to .memory/.pending-turns.jsonl for working memory capture.
# 2. Injects a detection-only preamble for ambient classification.
```

### MEDIUM

**CLAUDE.md `.memory/` tree comment still says "Auto-maintained by Stop hook (overwritten each session)"** - `CLAUDE.md:108`
**Confidence**: 85%
- Problem: Line 108 says `WORKING-MEMORY.md` is "Auto-maintained by Stop hook (overwritten each session)". After this PR, it is maintained by the background updater processing a queue fed by both the preamble hook and the stop hook. "Overwritten each session" is also no longer accurate since the queue-based model accumulates turns across multiple stop events. The parenthetical is misleading.
- Fix: Update the comment to:
```
├── WORKING-MEMORY.md         # Auto-maintained by background updater (queue-fed by preamble + stop hooks)
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CLAUDE.md Working Memory paragraph says "Three shell-script hooks" but the system now involves four scripts** - `CLAUDE.md:41`
**Confidence**: 82%
- Problem: The updated paragraph at line 41 begins with "Three shell-script hooks" but the new architecture involves four distinct hook scripts contributing to working memory: (1) preamble (captures user prompt), (2) stop-update-memory (captures assistant response, spawns updater), (3) background-memory-update (processes queue), (4) session-start-memory (injects memory). The count "Three" was accurate before this PR (stop, session-start, pre-compact) but the preamble now participates in memory capture too, making the count wrong.
- Fix: Update the opening to "Four shell-script hooks" or rephrase to avoid counting (e.g., "Shell-script hooks in `scripts/hooks/` provide automatic session continuity").

**Removed comments reduce understanding of locking mechanism** - `scripts/hooks/background-memory-update` (section header at former line ~264)
**Confidence**: 80%
- Problem: The old comment `# --- Locking (mkdir-based, POSIX-atomic) ---` was shortened to `# --- Locking ---`. The parenthetical "(mkdir-based, POSIX-atomic)" was useful documentation explaining the locking strategy at a glance -- it told readers both the mechanism and why it was chosen. The replacement loses this context.
- Fix: Restore the informative parenthetical:
```bash
# --- Locking (mkdir-based, POSIX-atomic) ---
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Hooks listing in Project Structure omits `background-memory-update` and uses shorthand `stop` instead of `stop-update-memory`** - `CLAUDE.md:60`
**Confidence**: 85%
- Problem: The hooks parenthetical lists `stop` but the actual file is `stop-update-memory`. It lists `background-learning` but omits `background-memory-update`. This predates this PR (confirmed same on `main`), but given that this PR substantially changes both `stop-update-memory` and `background-memory-update`, the drift is worth noting.

### LOW

**WORKING-MEMORY.md comment says "overwritten each session"** - `CLAUDE.md:108`
**Confidence**: 80%
- Problem: This was partially addressed above but as a pre-existing issue: the "overwritten each session" phrasing was already slightly inaccurate before this PR (the background updater merges, not overwrites), and is now further from reality with the queue model. Already captured as a blocking MEDIUM above for the portion changed in this PR.

## Suggestions (Lower Confidence)

- **Background updater inline comments could document the turn-pairing algorithm** - `scripts/hooks/background-memory-update:~80-120` (Confidence: 65%) -- The while-read loop that pairs user/assistant turns handles orphans but has no block comment explaining the pairing contract or expected JSONL structure.

- **New `.pending-turns.jsonl` and `.pending-turns.processing` files are documented in the tree but lack a one-line explanation of the queue protocol** - `CLAUDE.md:116-117` (Confidence: 70%) -- The tree comments say "ephemeral" and "transient" but do not explain the atomic handoff pattern (mv-based). A reader unfamiliar with the code would not understand the relationship between the two files.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The CLAUDE.md Working Memory paragraph was properly updated with the new architecture (queue-based, atomic handoff, crash recovery) -- good work. However, the preamble header comment now actively contradicts its behavior (claims zero file I/O while performing file writes), and secondary documentation artifacts (tree comments, hook count) have drifted from the new reality. The preamble header is the most urgent fix since it will mislead anyone reading the file to understand its side effects.
