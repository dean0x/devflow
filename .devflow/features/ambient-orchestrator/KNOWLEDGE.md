---
feature: ambient-orchestrator
name: Ambient Orchestrator Mode
description: "Use when modifying the ambient mode hooks (preamble, session-start-orchestrator), the orchestrator charter file (including the feature-knowledge operating rule), the git-marker helper, the ambient CLI toggle, or the plan-handoff fast-path. Keywords: ambient, preamble, orchestrator, charter, plan-handoff, session-start-orchestrator, git-marker, DEVFLOW_BG_UPDATER, devflow ambient, UserPromptSubmit, SessionStart, feature-knowledge."
category: architecture
directories: [src/assets/scripts/hooks, src/cli/commands/ambient.ts, src/core/plugins.ts]
created: 2026-07-04
updated: 2026-09-29
---

# Ambient Orchestrator Mode

## Overview

Ambient mode turns the main Claude Code session into a pure orchestrator: it coordinates sub-agents rather than performing work directly. The feature is a two-hook system, both managed by a single `devflow ambient --enable/--disable` toggle: `session-start-orchestrator` (SessionStart) injects a static charter as `additionalContext` at the start of every session, and `preamble` (UserPromptSubmit) reinforces the orchestrator contract per prompt and handles the plan-handoff fast-path. Both hooks are presence-gated — they only fire in git repositories — and share three cross-cutting safety contracts: a `DEVFLOW_BG_UPDATER` re-entrancy guard, a bounded pure-bash git-repo check, and fail-open `exit 0` on all error paths.

This design replaced two previous detection-based approaches (first-word keyword dispatch and 3-marker plan detection) with a simpler charter injection that constructs the model's behavior once at session start, eliminating per-prompt heavyweight detection. Applies ADR-004.

## Component Architecture

### Hook 1: session-start-orchestrator (SessionStart, timeout 10)

Reads `src/assets/scripts/hooks/assets/orchestrator-charter.md` at runtime and emits its content as `additionalContext` via `json_session_output`. The charter is static — it never interpolates user input. Hard caps: charter must be present, non-empty, and under 4096 bytes; missing or oversized charter exits 0 silently. Sources `hook-log-init` after CWD is resolved and emits `log "Injecting charter (N chars)"` immediately before the JSON output — consistent with the sibling SessionStart hooks (`session-start-memory`, `session-start-context`).

### Hook 2: preamble (UserPromptSubmit, timeout 5)

Pure-bash dispatch on the first 256 bytes of the prompt (after leading whitespace strip). Three branches, no subprocess in the dispatch block:

| Prompt condition | Output |
|---|---|
| Empty after whitespace strip | Silent exit 0 |
| Begins `Implement the following plan:` | Fixed devflow:implement handoff directive |
| Begins `/` (slash command) | Silent exit 0 |
| Anything else | 2-line orchestrator delegation reminder |

The orchestrator reminder is a fixed two-line string reinforcing "coordinate, don't produce" — it carries no per-prompt logic beyond the three-way dispatch above.

### orchestrator-charter.md

A static markdown file at `src/assets/scripts/hooks/assets/orchestrator-charter.md` consumed at runtime by `session-start-orchestrator`. Contains the full orchestrator contract: a never-mainline rule (explicitly naming codebase orientation as delegated work alongside file edits, builds, multi-file reads, and debug loops), a routing table keyed by **kind of work, not by model** — search/listing to Explore, codebase orientation to Skim, execution against a spec to Code (write code to a plan, including mechanical edits — renames, moves, boilerplate; also fixes pre-classified review issues in issue-fix mode)/Validate (build, typecheck, lint, test)/Git (git/GitHub operations), analysis/design/research to Design/Research/Review/Triage (validate review issues against the blast-radius matrix), and real-scale work matching a workflow to the full skill instead (devflow:implement, devflow:plan, devflow:research, devflow:explore, devflow:debug, devflow:code-review, devflow:resolve) — so each agent keeps running on its own configured model rather than the charter pinning one. It also holds the self-contained-delegation operating rule (subagents start with blank context, so every delegation must supply goal, constraints, relevant session decisions and facts, and exact paths — deliverables that draw on the conversation need the substance in the prompt, not a pointer to it), the plan-handoff fallback bullet, and a feature-knowledge operating rule. The feature-knowledge rule (direct delegations only — workflow skills handle their own) instructs the orchestrator to: (1) before delegating non-trivial code work, match the task area against `.devflow/features/index.md` and pass matching KNOWLEDGE.md content as `FEATURE_KNOWLEDGE`; (2) after delegated changes to a covered area, spawn Knowledge (sonnet) to refresh that KB. The charter is 2116 bytes (~530 tokens), well under the 4096-byte runtime cap enforced by the hook. `docs/commands.md`'s "Orchestrator charter" line mirrors this kind-of-work, no-model-pinning framing — keep both in sync if the charter's routing changes.

### git-marker (sourced helper)

`src/assets/scripts/hooks/git-marker` exports `df_has_git_marker <dir>`. Pure bash — no subprocess, no `git` binary invocation — making it safe on the UserPromptSubmit hot path. Bounded 64-level upward walk using `-e $dir/.git` (works for both `.git` directories and `.git` files from worktrees/submodules).

It also exports `df_is_project_root <root>` (D-HOOKS-GIT-ONLY): the marker walk AND "the root's physical path is not HOME's physical path". The physical paths come from `cd -P` + `$PWD` (builtins; the caller's directory is restored), because git reports toplevels with symlinks resolved while `$HOME` keeps its given spelling (macOS `/var` → `/private/var`, a symlinked home). Zero forks, like the walk. `session-start-context` (carve-out + Sections 1–2) and `ensure-devflow-init` (every capture/memory hook) gate on it, so no hook scaffolds `.devflow/` or a `.gitignore` outside a git project or in a HOME-rooted repo. The ambient hooks keep the plain marker gate.

### TypeScript management layer (src/cli/commands/ambient.ts)

**Exact hook ownership (D-AMBIENT-EXACT-HOOK, #391).** A hook is devflow's only when its command ENDS in one of the suffixes in `AMBIENT_HOOK_SUFFIXES` — `/scripts/hooks/run-hook <marker>` for `preamble`, `session-start-orchestrator`, `session-start-classification` and `ambient-prompt`, plus the pre-run-hook `/scripts/hooks/ambient-prompt.sh` — under any directory, with backslashes read as slashes. Never match by substring: a user's `~/bin/preamble-logger.sh` or `echo preamble` is theirs. The per-hook predicates (`isPreamble`, `isLegacy`, `isAmbient`, `isClassification`, `isOrchestrator`) come from `endsWithAny(suffixes)`.

`filterHookEntries(settings, event, predicate)` removes single HOOKS, not matcher groups: a group keeps the user's sibling hooks and is dropped only when it ends up empty. Hook registration goes through `ensureHook(settings, eventName, predicate, entry)`, which adds the entry unless a hook matching the same predicate is registered — a user hook that merely mentions the word no longer suppresses registration. Both `addAmbientHook` (preamble + orchestrator) and any future hooks should use this helper rather than duplicating the check-then-push pattern.

`convergeAmbientHooks(settingsJson, enabled, devflowDir)` is the one ambient transform `devflow init`'s settings pass applies: remove-then-add with ambient on, remove with it off (mirrors `convergeMemoryHooks`).

`addAmbientHook` additionally sweeps stale `session-start-classification` entries from `SessionStart` (symmetric with `removeAmbientHook`, which has always cleaned them). This makes re-enable and disable symmetric for classification-hook debris from pre-charter installs.

**Canonical directory (D-AMBIENT-CANONICAL-DIR, #391).** `ambient --enable` registers the hooks under `getDevFlowDirectory()` (`$HOME/.devflow`), where init installs `run-hook`. It never infers a directory from settings.json: the first Stop hook is whichever hook the user listed first, and a path derived from it names a `run-hook` that does not exist. The command is built by `createAmbientCommand()` (exported for per-test isolation, like `createHudCommand`); `ambientCommand` is its one instance.

The `ambientCommand` action now parses `settings.json` once up front with a dedicated `try/catch`: a corrupt file logs a clean error and returns without touching the filesystem. The parsed `Settings` object is passed directly to `hasAmbientHook` and `hasOrchestratorHook`, avoiding re-parsing. `hasAmbientHook` is preamble-authoritative (see State Machine section).

## Component Interactions

```
devflow ambient --enable
  → parse settings.json (try/catch — clean error on corrupt file)
  → addAmbientHook(settingsJson, devflowDir)
      1. Remove legacy ambient-prompt from UserPromptSubmit (always)
      2. Sweep stale session-start-classification from SessionStart (always)
      3. ensureHook → add preamble to UserPromptSubmit (if absent)
      4. ensureHook → add session-start-orchestrator to SessionStart (if absent)
      5. removeLegacyCommandsRule() — best-effort, swallows all errors
      → writes updated settings.json

Per-session (SessionStart):
  session-start-orchestrator fires
    → DEVFLOW_BG_UPDATER guard (exit 0 if set)
    → hook-bootstrap sourced (debug logging)
    → json-parse sourced; exit 0 if neither jq nor node available
    → CWD resolved; hook-log-init sourced
    → df_has_git_marker (exit 0 if not a git repo)
    → reads orchestrator-charter.md into CHARTER var
    → size check: exit 0 if > 4096 bytes
    → log "Injecting charter (N chars)"
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
| Fully enabled | present | present | true | `enabled` |
| Partial — preamble only | present | absent | true | `enabled (partial — run devflow ambient --enable to repair)` |
| Partial — orchestrator only | absent | present | **false** | `disabled (partial — run devflow ambient --enable to repair)` |
| Disabled | absent | absent | false | `disabled` |

`hasAmbientHook` is preamble-authoritative: orchestrator-only (without preamble) is treated as disabled, not enabled. This is intentional — the preamble hook is the per-prompt behavioral core; the orchestrator hook alone provides no prompt-level behavior.

The repair hint (`partial — run devflow ambient --enable to repair`) is appended whenever `hasAmbientHook` and `hasOrchestratorHook` disagree (one true, one false). It appears on both the `enabled` and `disabled` lines to surface both partial cases.

`--enable` checks each hook independently via `ensureHook` and adds whichever is missing, so it repairs both partial states without duplicating hooks already present.

## Literal Duplication: Plan-Handoff Prefix

The string `Implement the following plan:` appears verbatim in two places:

1. `src/assets/scripts/hooks/preamble` — the fast-path match condition in the UserPromptSubmit dispatch
2. `src/assets/scripts/hooks/assets/orchestrator-charter.md` — the plan-handoff fallback bullet under SessionStart

This is intentional. SessionStart provably fires (via `SessionStart:clear`) in plan-handoff sessions even if UserPromptSubmit does not fire for Claude Code's auto-injected handoff prompt. The charter's fallback bullet covers that gap. Both files carry a cross-reference comment flagging the duplication. If Claude Code changes the handoff format, both files must be updated together.

## Constraints

**4096-byte charter cap**: `session-start-orchestrator` exits silently if the charter exceeds 4096 bytes. The test suite pins the exact-4096-byte boundary as an accept case (the hook uses `-gt 4096`, so 4096 is accepted). Growing the charter beyond this cap silently disables it — always check `${#CHARTER}` after edits. The charter is currently 2116 bytes, leaving ~1980 bytes of headroom.

**256-byte prompt head**: The preamble dispatch window is the first 256 bytes post-whitespace-strip. Plan-handoff prompts have zero leading whitespace by definition; the strip is defensive. The window is wide enough for the known prefix but is not semantic detection.

**Bash 3.2 compatibility**: Preamble uses only POSIX-compatible bash constructs. The test suite explicitly verifies absence of bash-4-only `${var,,}` and `${var^^}` constructs (test C5 in shell-hooks.test.ts).

**Zero user-text interpolation**: Both hook output strings are byte-fixed templates. No user prompt content is interpolated into hook output. This is the fuzz-test invariant: arbitrary prompt bytes cannot modify hook behavior beyond the three dispatch branches.

**json-parse dependency**: Both hooks source `json-parse` and exit 0 if neither `jq` nor `node` is available. This is the fail-open contract for environments lacking JSON tooling.

## Anti-Patterns

**Adding detection logic to preamble**: The old ambient design used keyword detection in the hook — `implement`, `explore`, `research`, etc. This was removed because it triggered heavyweight workflows on small prompts. The current design is charter-based: the model decides how to delegate, not the hook. Do not re-add semantic detection to the dispatch block.

**Interpolating prompt content into hook output**: `json_prompt_output` must receive only fixed string literals. Passing `$HEAD` or any user-controlled variable breaks the security invariant and enables prompt injection via hook output. See the fuzz test in tests/shell-hooks.test.ts.

**Letting the hook call `git` directly**: `git status`, `git rev-parse`, etc. spawn subprocesses on every UserPromptSubmit call. `git-marker` exists precisely to avoid this — it's a pure-bash bounded walk. Never replace it with a `git` invocation on the hot path.

**Growing orchestrator-charter.md past 4096 bytes**: The hook exits 0 silently if the charter is too large. There is no error visible to the user. Keep the charter well under the cap; recompute `${#CHARTER}` after any edit (see Constraints for current headroom).

**Adding a third presence-gate separately**: The two hooks are managed together by `addAmbientHook`/`removeAmbientHook`. If a third hook is added to ambient mode, it must be added to both functions (via `ensureHook`) and to the `hasAmbientHook` / `--status` partial-state detection logic. Orphaned hooks that survive `--disable` create noise in settings.json.

**Matching a hook by substring**: `h.command.includes(marker)` claims any user hook that mentions the word, and the old group-level filter then deleted every sibling in its matcher group (#391). Match with `endsWithAny` against `AMBIENT_HOOK_SUFFIXES`, and filter per hook.

**Duplicating the ensureHook check-then-push pattern inline**: The `ensureHook(settings, eventName, predicate, entry)` helper exists to avoid duplicating the existence-check logic. Always use it when adding new hook registrations to `addAmbientHook`.

**Pinning a model in the charter's routing table**: The routing table dispatches by kind of work (search/listing, codebase orientation, execution, analysis/design/research, real-scale workflow) — never by model tier. Each roster agent's model comes from its own frontmatter (e.g. Code, Skim and Knowledge are each `model: sonnet` in their agent files), not from the charter. Do not reintroduce a haiku/sonnet/opus routing table into the charter; `docs/commands.md`'s charter line documents this no-pinning behavior and must stay in sync.

## Gotchas

**DEVFLOW_BG_UPDATER guard must be first**: The re-entrancy guard appears before `hook-bootstrap` is sourced in both hooks. This is load-order-critical: `hook-bootstrap` initializes per-project debug logging, which reads from `CWD`. Background sessions (memory worker's `claude -p`) must be silenced before any initialization runs, not after.

**Legacy cleanup runs unconditionally**: `removeLegacyCommandsRule()` is called by both `addAmbientHook` and `removeAmbientHook` regardless of whether hooks changed. This ensures stale `~/.claude/rules/devflow/commands.md` files from pre-charter installs are always purged, even in idempotent re-enable calls.

**`hasAmbientHook` and `hasOrchestratorHook` accept both string and Settings**: Both functions accept `string | Settings`. The `ambientCommand` action parses `settings.json` once up front and passes the parsed `Settings` object to both helpers — no re-parsing. When called from external code with a raw JSON string, parsing happens inside the function. Passing the object avoids double-parsing and ensures the `try/catch` in the command action is the single error boundary for corrupt files.

**`addAmbientHook` sweeps session-start-classification symmetrically**: As of the resolve pass, `addAmbientHook` now also calls `filterHookEntries(settings, 'SessionStart', isClassification)`. This makes enable and disable symmetric: both purge the stale classification hook. This was a prior asymmetry — only `removeAmbientHook` did the sweep.

**devflow-dir resolution**: `ambient --enable` always passes `getDevFlowDirectory()` to `addAmbientHook` (D-AMBIENT-CANONICAL-DIR). Hooks an older install registered under another directory are still recognised by suffix: `--disable` removes them, and `addAmbientHook` (so `--enable` and init's remove-then-add alike) removes a preamble or orchestrator hook whose command is not the canonical `run-hook <marker>` under `devflowDir` and re-registers it there, one hook at a time, so user hooks and matcher-group siblings stay put.

**`session-start-classification` is a stale marker**: The `AMBIENT_HOOK_SUFFIXES.classification` suffix (`/scripts/hooks/run-hook session-start-classification`) refers to a hook from a previous ambient design that no longer exists. Both `addAmbientHook` and `removeAmbientHook` clean it up to handle upgrades from those installs. Do not re-register it.

**UserPromptSubmit may not fire for auto-injected plan handoff**: Whether Claude Code fires UserPromptSubmit for its own auto-injected "start-of-plan-session" prompt is an empirical unknown as of this writing. The charter's fallback bullet under SessionStart covers this gap. The preamble fast-path handles explicit user-typed plan handoffs.

## Key Files

- `src/assets/scripts/hooks/preamble` — UserPromptSubmit hook: dispatch logic, plan-handoff fast-path, orchestrator reminder
- `src/assets/scripts/hooks/session-start-orchestrator` — SessionStart hook: charter file read, size guard, hook-log-init injection log, additionalContext output
- `src/assets/scripts/hooks/assets/orchestrator-charter.md` — Static charter content; the plan-handoff fallback bullet, kind-of-work routing table (no model pinning), self-contained-delegation operating rule, and feature-knowledge operating rule live here
- `src/assets/scripts/hooks/git-marker` — Sourced pure-bash helper: `df_has_git_marker <dir>` bounded upward walk, plus `df_is_project_root <root>` (marker + physical-path HOME check, zero forks); direct behavioral tests, a no-subprocess source scan, and a PATH-shim fork counter (tests/shell-hooks-tracker.test.ts, TP-22)
- `src/cli/commands/ambient.ts` — TypeScript management: `AMBIENT_HOOK_SUFFIXES` + `endsWithAny` (exact ownership), `filterHookEntries` (per-hook), `ensureHook`, `addAmbientHook`, `removeAmbientHook`, `convergeAmbientHooks` (init's step), `hasAmbientHook`, `createAmbientCommand` / `ambientCommand` (parses settings.json once with try/catch; canonical devflow dir)
- `docs/commands.md` — "Orchestrator charter" reference line: documents the kind-of-work routing and no-model-pinning behavior; keep in sync with orchestrator-charter.md
- `tests/fixtures/ambient-templates.ts` — Shared constants: `HANDOFF_TEMPLATE` and `REMINDER_TEMPLATE`; imported by shell-hooks.test.ts and integration tests to keep both test layers byte-synchronized
- `tests/shell-hooks.test.ts` — Shell integration tests (suites 1–4 for preamble, suite for session-start-orchestrator)
- `tests/ambient.test.ts` — TypeScript unit tests for hook enable/disable/status/partial-state logic
- `tests/integration/ambient-activation.test.ts` — Integration tests; imports template constants from tests/fixtures/ambient-templates.ts

## Related

- ADR-004: Decision to pivot from detection-based to charter-based ambient mode (applies ADR-004)
- ADR-003: Leave-the-end-state principle; the old keyword/3-marker detection was deleted clean, no tombstones (applies ADR-003)
- PF-001: Plan-handoff schema undocumented/mutable — match by prefix only; the `tests/fixtures/ambient-templates.ts` constants are full output strings, not detection substrings (avoids PF-001)
- Feature knowledge: `learning-capture-system` — the memory worker fires UserPromptSubmit and SessionStart hooks too; the `DEVFLOW_BG_UPDATER` re-entrancy guard is the coupling point between that system and this one
- Feature knowledge: `feature-knowledge-system` — the charter's feature-knowledge operating rule instructs the orchestrator to load KNOWLEDGE.md entries as FEATURE_KNOWLEDGE and spawn the Knowledge agent after changes; that system's KB covers how those entries are written and consumed
- `src/assets/scripts/hooks/json-parse` — shared JSON output helpers (`json_prompt_output`, `json_session_output`, `json_extract_cwd_prompt`)
- `src/assets/scripts/hooks/hook-bootstrap` — shared hook initialization: debug logging, per-project log paths
- `src/assets/scripts/hooks/hook-log-init` — shared injection log initialization sourced by session-start-orchestrator (and sibling SessionStart hooks)
