---
feature: ambient-orchestrator
name: Ambient Orchestrator Mode
description: "Use when modifying the ambient mode hooks (preamble, session-start-orchestrator), the orchestrator charter file, the git-marker helper, the ambient CLI toggle, or the plan-handoff fast-path. Keywords: ambient, preamble, orchestrator, charter, plan-handoff, session-start-orchestrator, git-marker, DEVFLOW_BG_UPDATER, devflow ambient, UserPromptSubmit, SessionStart."
category: architecture
directories: [scripts/hooks, src/cli/commands/ambient.ts, plugins/devflow-ambient]
created: 2026-07-04
updated: 2026-07-04
---

# Ambient Orchestrator Mode

## Overview

Ambient mode turns the main Claude Code session into a pure orchestrator: it coordinates sub-agents rather than performing work directly. The feature is a two-hook system, both managed by a single `devflow ambient --enable/--disable` toggle: `session-start-orchestrator` (SessionStart) injects a static charter as `additionalContext` at the start of every session, and `preamble` (UserPromptSubmit) reinforces the orchestrator contract per prompt and handles the plan-handoff fast-path. Both hooks are presence-gated — they only fire in git repositories — and share three cross-cutting safety contracts: a `DEVFLOW_BG_UPDATER` re-entrancy guard, a bounded pure-bash git-repo check, and fail-open `exit 0` on all error paths.

This design replaced two previous detection-based approaches (first-word keyword dispatch and 3-marker plan detection) with a simpler charter injection that constructs the model's behavior once at session start, eliminating per-prompt heavyweight detection. Applies ADR-004.

## Component Architecture

### Hook 1: session-start-orchestrator (SessionStart, timeout 10)

Reads `scripts/hooks/assets/orchestrator-charter.md` at runtime and emits its content as `additionalContext` via `json_session_output`. The charter is static — it never interpolates user input. Hard caps: charter must be present, non-empty, and under 4096 bytes; missing or oversized charter exits 0 silently.

### Hook 2: preamble (UserPromptSubmit, timeout 5)

Pure-bash dispatch on the first 256 bytes of the prompt (after leading whitespace strip). Three branches, no subprocess in the dispatch block:

| Prompt condition | Output |
|---|---|
| First word begins `Implement the following plan:` | Fixed devflow:implement handoff directive |
| First word is `/` | Silent exit 0 (slash commands pass through) |
| Anything else (including empty-after-strip) | 2-line orchestrator delegation reminder |

### orchestrator-charter.md

A static markdown file at `scripts/hooks/assets/orchestrator-charter.md` consumed at runtime by `session-start-orchestrator`. Contains the full orchestrator contract: model-tier routing table (haiku/sonnet/opus), judgment-work carve-outs, delegation rules, and the plan-handoff fallback bullet. The 4096-byte runtime cap in the hook enforces a minimum footprint.

### git-marker (sourced helper)

`scripts/hooks/git-marker` exports `df_has_git_marker <dir>`. Pure bash — no subprocess, no `git` binary invocation — making it safe on the UserPromptSubmit hot path. Bounded 64-level upward walk using `-e $dir/.git` (works for both `.git` directories and `.git` files from worktrees/submodules).

### TypeScript management layer (src/cli/commands/ambient.ts)

`addAmbientHook` / `removeAmbientHook` / `hasAmbientHook` operate on `settings.json` JSON strings. `addAmbientHook` is idempotent and repairs partial states. `hasAmbientHook` is preamble-authoritative (see State Machine section).

## Component Interactions

```
devflow ambient --enable
  → addAmbientHook(settingsJson, devflowDir)
      1. Remove legacy ambient-prompt from UserPromptSubmit (always)
      2. Add preamble to UserPromptSubmit (if absent)
      3. Add session-start-orchestrator to SessionStart (if absent)
      4. removeLegacyCommandsRule() — best-effort, swallows all errors
      → writes updated settings.json

Per-session (SessionStart):
  session-start-orchestrator fires
    → DEVFLOW_BG_UPDATER guard (exit 0 if set)
    → df_has_git_marker (exit 0 if not a git repo)
    → reads orchestrator-charter.md into CHARTER var
    → size check: exit 0 if > 4096 bytes
    → json_session_output "$CHARTER"   ← additionalContext injected

Per-prompt (UserPromptSubmit):
  preamble fires
    → DEVFLOW_BG_UPDATER guard (exit 0 if set)
    → json-parse sourced; exit 0 if neither jq nor node available
    → json_extract_cwd_prompt → CWD + PROMPT
    → df_has_git_marker (exit 0 if not a git repo)
    → HEAD="${PROMPT:0:256}" then strip leading whitespace
    → dispatch: plan-handoff | slash-skip | reminder
```

## State Machine (partial states)

The system can land in two kinds of partial state. Both are repaired by `--enable`.

| State | preamble hook | orchestrator hook | `hasAmbientHook` | `--status` output |
|---|---|---|---|---|
| Fully enabled | present | present | true | enabled |
| Partial — preamble only | present | absent | true | enabled (partial note) |
| Partial — orchestrator only | absent | present | **false** | disabled |
| Disabled | absent | absent | false | disabled |

`hasAmbientHook` is preamble-authoritative: orchestrator-only (without preamble) is treated as disabled, not enabled. This is intentional — the preamble hook is the per-prompt behavioral core; the orchestrator hook alone provides no prompt-level behavior.

`--enable` checks each hook independently and adds whichever is missing, so it repairs both partial states without duplicating the hooks that are already present.

## Literal Duplication: Plan-Handoff Prefix

The string `Implement the following plan:` appears verbatim in two places:

1. `scripts/hooks/preamble` — the fast-path match condition in the UserPromptSubmit dispatch
2. `scripts/hooks/assets/orchestrator-charter.md` — the plan-handoff fallback bullet under SessionStart

This is intentional. SessionStart provably fires (via `SessionStart:clear`) in plan-handoff sessions even if UserPromptSubmit does not fire for Claude Code's auto-injected handoff prompt. The charter's fallback bullet covers that gap. Both files carry a cross-reference comment flagging the duplication. If Claude Code changes the handoff format, both files must be updated together.

## Constraints

**4096-byte charter cap**: `session-start-orchestrator` exits silently if the charter exceeds 4096 bytes. Growing the charter beyond this cap silently disables it — always check `${#CHARTER}` after edits.

**256-byte prompt head**: The preamble dispatch window is the first 256 bytes post-whitespace-strip. Plan-handoff prompts have zero leading whitespace by definition; the strip is defensive. The window is wide enough for the known prefix but is not semantic detection.

**Bash 3.2 compatibility**: Preamble uses only POSIX-compatible bash constructs. The test suite explicitly verifies absence of bash-4-only `${var,,}` and `${var^^}` constructs (test C5 in shell-hooks.test.ts).

**Zero user-text interpolation**: Both hook output strings are byte-fixed templates. No user prompt content is interpolated into hook output. This is the fuzz-test invariant: arbitrary prompt bytes cannot modify hook behavior beyond the three dispatch branches.

**json-parse dependency**: Both hooks source `json-parse` and exit 0 if neither `jq` nor `node` is available. This is the fail-open contract for environments lacking JSON tooling.

## Anti-Patterns

**Adding detection logic to preamble**: The old ambient design used keyword detection in the hook — `implement`, `explore`, `research`, etc. This was removed because it triggered heavyweight workflows on small prompts. The current design is charter-based: the model decides how to delegate, not the hook. Do not re-add semantic detection to the dispatch block.

**Interpolating prompt content into hook output**: `json_prompt_output` must receive only fixed string literals. Passing `$HEAD` or any user-controlled variable breaks the security invariant and enables prompt injection via hook output. See the fuzz test in tests/shell-hooks.test.ts.

**Letting the hook call `git` directly**: `git status`, `git rev-parse`, etc. spawn subprocesses on every UserPromptSubmit call. `git-marker` exists precisely to avoid this — it's a pure-bash bounded walk. Never replace it with a `git` invocation on the hot path.

**Growing orchestrator-charter.md past 4096 bytes**: The hook exits 0 silently if the charter is too large. There is no error visible to the user. Keep the charter well under the cap; use the cross-reference maintenance comment at the top of the file as the editorial gate.

**Adding a third presence-gate separately**: The two hooks are managed together by `addAmbientHook`/`removeAmbientHook`. If a third hook is added to ambient mode, it must be added to both functions and to the `hasAmbientHook` / `--status` partial-state detection logic. Orphaned hooks that survive `--disable` create noise in settings.json.

## Gotchas

**DEVFLOW_BG_UPDATER guard must be first**: The re-entrancy guard appears before `hook-bootstrap` is sourced in both hooks. This is load-order-critical: `hook-bootstrap` initializes per-project debug logging, which reads from `CWD`. Background sessions (memory worker's `claude -p`) must be silenced before any initialization runs, not after.

**Legacy cleanup runs unconditionally**: `removeLegacyCommandsRule()` is called by both `addAmbientHook` and `removeAmbientHook` regardless of whether hooks changed. This ensures stale `~/.claude/rules/devflow/commands.md` files from pre-charter installs are always purged, even in idempotent re-enable calls.

**`hasAmbientHook` accepts both string and Settings**: The function signature is `input: string | Settings`. When called during an `init` flow that already has a parsed Settings object, pass the object directly to avoid double-parsing. When called from `--status`, pass the raw JSON string.

**devflow-dir resolution fallback**: `addAmbientHook` resolves the devflow scripts directory from `getDevFlowDirectory()` with a fallback: if the inferred path from the Stop hook command differs from the canonical default, the inferred path wins. This handles legacy installs where devflow was installed to a non-standard location.

**`session-start-classification` is a stale marker**: The `CLASSIFICATION_HOOK_MARKER` constant (`session-start-classification`) refers to a hook from a previous ambient design that no longer exists. `removeAmbientHook` still cleans it up to handle upgrades from those installs. Do not re-register it.

**UserPromptSubmit may not fire for auto-injected plan handoff**: Whether Claude Code fires UserPromptSubmit for its own auto-injected "start-of-plan-session" prompt is an empirical unknown as of this writing. The charter's fallback bullet under SessionStart covers this gap. The preamble fast-path handles explicit user-typed plan handoffs.

## Key Files

- `scripts/hooks/preamble` — UserPromptSubmit hook: dispatch logic, plan-handoff fast-path, orchestrator reminder
- `scripts/hooks/session-start-orchestrator` — SessionStart hook: charter file read, size guard, additionalContext output
- `scripts/hooks/assets/orchestrator-charter.md` — Static charter content; the plan-handoff fallback bullet lives here
- `scripts/hooks/git-marker` — Sourced pure-bash helper: `df_has_git_marker <dir>` bounded upward walk
- `src/cli/commands/ambient.ts` — TypeScript management: `addAmbientHook`, `removeAmbientHook`, `hasAmbientHook`, `ambientCommand`
- `tests/shell-hooks.test.ts` — Shell integration tests (suites 1–4 for preamble, suite for session-start-orchestrator)
- `tests/ambient.test.ts` — TypeScript unit tests for hook enable/disable/status/partial-state logic

## Related

- ADR-004: Decision to pivot from detection-based to charter-based ambient mode (applies ADR-004)
- ADR-003: Leave-the-end-state principle; the old keyword/3-marker detection was deleted clean, no tombstones (applies ADR-003)
- Feature knowledge: `dream-capture-system` — the memory worker fires UserPromptSubmit and SessionStart hooks too; the `DEVFLOW_BG_UPDATER` re-entrancy guard is the coupling point between that system and this one
- `scripts/hooks/json-parse` — shared JSON output helpers (`json_prompt_output`, `json_session_output`, `json_extract_cwd_prompt`)
- `scripts/hooks/hook-bootstrap` — shared hook initialization: debug logging, per-project log paths
