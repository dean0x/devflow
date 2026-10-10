---
feature: ambient-orchestrator
name: Ambient orchestrator (session-start hooks and charter)
description: "Use when editing the orchestrator charter, the preamble or session-start hooks, the compact resume directive, the CLAUDE.md import audit or the auto-compact flag. Keywords: ambient, charter, compact, systemMessage."
category: architecture
directories: [src/assets/scripts/hooks, src/assets/scripts/hooks/assets, src/assets/scripts/claude-md-audit.cjs, src/core/claude-md-audit.ts, src/core/flags.ts, src/cli/commands/ambient.ts, src/core/plugins.ts]
created: 2026-07-04
updated: 2026-10-10
---

# Ambient Orchestrator (session-start hooks and charter)

## Rules

- **KB-AP-1** Never add keyword or semantic detection to `preamble`: it fired heavyweight workflows on small prompts; the charter lets the model decide.
- **KB-AP-2** Never interpolate prompt content into hook output: `json_prompt_output` takes fixed literals only (fuzz test in `tests/shell-hooks.test.ts`).
- **KB-AP-3** Never call `git` on the UserPromptSubmit path: use the pure-bash `df_has_git_marker`, not a subprocess per prompt.
- **KB-AP-4** Never grow the charter or add text that applies only sometimes: every ambient session pays for it and `charter-char-max` is a ratchet.
- **KB-AP-5** Never put a decisions rule in the charter: it lives in `session-start-context` Section 1, behind the learning switch and the `Index:` line (a `shell-hooks` test fails otherwise).
- **KB-AP-6** Never pin a model in the charter's routing: dispatch is by kind of work. Keep `docs/commands.md` in sync.
- **KB-AP-7** Never swap the SessionStart channels: the resume directive is model-facing `additionalContext`, the audit message user-facing `systemMessage`.
- **KB-AP-8** Never keep a second copy of the audit grammar, bounds or thresholds outside `claude-md-audit.cjs`; the hook runs that script.
- **KB-AP-9** Never loosen a pinned limit: `MAX_HOPS`, `compact-directive-max-chars`, the `auto-compact-window` recommendation, or the ban on naming the percent-based override.
- **KB-AP-10** Never add an ambient hook outside `ensureHook` (add and remove paths) and the `hasAmbientHook` / `--status` partial-state detection.
- **KB-AP-11** Never match a hook by substring or hand-roll check-then-push: use `endsWithAny` over `AMBIENT_HOOK_SUFFIXES`, `ensureHook` and per-hook `removeHooks`.
- **KB-AP-12** Keep the `DEVFLOW_BG_UPDATER` guard before `hook-bootstrap` in every hook here: background sessions must be silenced before any initialization.
- **KB-AP-13** The charter hook fails silent on a missing, empty or oversized charter; measure characters, not bytes.
- **KB-AP-14** Never re-register `session-start-classification`; enable and disable sweep it and the legacy commands rule unconditionally.
- **KB-AP-15** Display of `systemMessage` on SessionStart was never observed live; if upstream discarded it, the audit would fail silently.
- **KB-AP-16** A plan handoff sends the plan once, with no skill argument; with empty `COMMAND_INPUT` the orchestrator writes the one-line `TASK_DESCRIPTION` itself.
- **KB-AP-17** The main thread loads no companion skills except `/release`'s `devflow:git`; `requires:` names only skills actually read.
- **KB-AP-18** UserPromptSubmit may not fire for the auto-injected handoff prompt; the charter's fallback bullet covers it.
- **KB-INV-1** Both ambient hooks are git-gated and share the `DEVFLOW_BG_UPDATER` guard, a bounded pure-bash git check and fail-open `exit 0`.
- **KB-INV-2** Hook output is byte-fixed; the handoff directive equals `HANDOFF_TEMPLATE` byte for byte, with no dollar sign or unescaped backtick.
- **KB-INV-3** The prefix `Implement the following plan:` stays literal in both `preamble` and the charter; change both together.
- **KB-INV-4** The bounded-inline exception is one sentence holding every bound word, report caps carry a token figure, and the handoff passes no arguments (GAP-3 guards).
- **KB-INV-5** The Feature knowledge rule passes one to three `## Rules` bullets verbatim with IDs, plus path and heading index, never whole KB content.
- **KB-INV-6** The decisions pass rule follows the `Index:` line inside the same shape-gated `if`; a block without an index never carries it.
- **KB-INV-7** `hasAmbientHook` is preamble-authoritative; `--enable` repairs both partial states without duplicates.
- **KB-INV-8** Ambient hooks register under the canonical `getDevFlowDirectory()`, never a directory inferred from settings.json.
- **KB-INV-9** Every `source` gate in `session-start-context` is a positive `case`; an absent or unknown `source` emits nothing.
- **KB-INV-10** Sections 5 and 6 never call `exit`; the hook ends with `exit "$_SC_OUT_RC"`, and the stamp is recorded only after a successful output call.
- **KB-INV-11** `claude-md-audit.cjs` owns the audit logic and only reads; the CLI facade loads the package's copy and returns `Result` errors, never throws.
- **KB-INV-12** An audit failure shows nothing and records `E audit-failed`: an unchanged broken state starts no node, a changed root set retries.
- **KB-INV-13** `json_session_output` with one argument or an empty message keeps every other caller's envelope byte for byte; a message goes in top-level `systemMessage`, beside `hookSpecificOutput`.
- **KB-INV-14** `auto-compact-window` stays opt-in (`recommended: false`, no default, no `upstreamDefault`), set only through `--set`.

## Overview

Ambient mode turns the main Claude Code session into an orchestrator that coordinates sub-agents instead of doing work directly, with one bounded inline exception. Two hooks sit under one `devflow ambient --enable/--disable` toggle: `session-start-orchestrator` (SessionStart) injects a static charter as `additionalContext`, and `preamble` (UserPromptSubmit) reinforces the contract per prompt and handles the plan-handoff fast-path. The design is a charter injected once, with no per-prompt heavyweight detection. Both hooks are presence-gated (git repositories only) and share the `DEVFLOW_BG_UPDATER` guard, a bounded pure-bash git check and fail-open `exit 0`.

Three more pieces share the hook directory but not the toggle. `session-start-context` (SessionStart, always-on) carries the rule that hands the decisions index to delegations (Section 1), a compaction resume directive (Section 5) and the CLAUDE.md import audit (Section 6). `src/core/claude-md-audit.ts` is the CLI's typed seam onto the same audit script. The opt-in `auto-compact-window` flag in `src/core/flags.ts` is the one knob devflow offers over when Claude Code compacts, the event the resume directive recovers from.

## Component Architecture

### Hook 1: session-start-orchestrator (SessionStart, timeout 10)

Reads `src/assets/scripts/hooks/assets/orchestrator-charter.md` at runtime and emits it as `additionalContext` via `json_session_output` with one argument, so no `systemMessage`. The charter is static. The hook reads only `cwd`, never `source`, so the charter is injected on startup, resume, clear and compact alike. A missing, empty or oversized charter (`${#CHARTER}` above the hook's 4096 cap) exits 0 silently. It logs `Injecting charter (N chars)` through `hook-log-init`.

### Hook 2: preamble (UserPromptSubmit, timeout 5)

Pure-bash dispatch on the first 256 bytes of the prompt after a leading-whitespace strip, with no subprocess in the dispatch block. The window fits the known prefix; it is not semantic detection, and native handoffs have no leading whitespace. An empty prompt and a slash command (`/…`) exit 0 silently; a prompt beginning `Implement the following plan:` gets the fixed handoff directive; anything else gets a fixed 2-line reminder ("coordinate, don't produce").

The handoff directive tells the model to invoke `devflow:implement` through the Skill tool with **no arguments**: the handoff prompt is the plan, already in the conversation, and passing it as skill input would put a second copy in the main-thread context. No plan body or path is parsed. Claude Code's handoff schema is undocumented and mutable, so detection stays the literal prefix, and `HANDOFF_TEMPLATE` and `REMINDER_TEMPLATE` in `tests/fixtures/ambient-templates.ts` are full output strings, not detection substrings.

### orchestrator-charter.md

A static file read at runtime by `session-start-orchestrator`. It holds:

- the **never-mainline rule** (edits, builds, multi-file reads, codebase orientation and debug loops are delegated) with one bounded-inline exception in a single sentence: one git, gh or script command whose output stays under about 40 lines, never a diff, log or test run;
- **routing by kind of work, not by model**: Explore (search, listing), Skim (orientation), Code (the prompt opens `OPERATION: <mode>`: `edit` for renames, moves and boilerplate, `issue-fix` for pre-classified review issues, else `implement`), Validate, Git, and Design, Research, Review or Triage (validates review issues against the blast-radius matrix); real-scale work matching a workflow invokes that full skill instead;
- what **stays mainline**: conversation, decisions, routing, synthesis of agent reports, answers already in loaded context, one targeted Read to scope a delegation;
- the **operating rules**: decompose mainline (subagents cannot spawn subagents); self-contained delegations (subagents see none of the conversation, so the prompt carries goal, constraints, session decisions, exact paths and the substance, not a pointer, of any conversation-derived deliverable); a final-report cap of about 1,500 tokens on every direct delegation; independent delegations in parallel, Git sequential; the Feature knowledge rule; and plan handoff.

**The Feature knowledge rule** (direct delegations only; workflow skills handle their own): before delegating non-trivial code work, match the task area against `.devflow/features/index.md` and pass each matching KB's one to three most relevant `## Rules` bullets (verbatim, IDs included; for a KB without Rules, its Anti-Patterns or Gotchas entries, cited by section), the KB's path and its `##` heading index as `FEATURE_KNOWLEDGE`; the delegation Reads further sections itself. After delegated changes to a covered area, spawn Knowledge to refresh that KB. `collectCharterKnowledgeDefects` (`tests/agent-name-guards.test.ts`) holds the limits, the Rules delivery and the legacy fallback, and rejects a bullet that passes whole `KNOWLEDGE.md` content.

**No Decisions bullet** (D-DECISIONS-CHARTER-HANDOFF). The charter is paid for in every ambient session, learning on or off, and a decisions rule matters only with an index to pass, so the rule follows the `Index:` line of `session-start-context` Section 1. `docs/commands.md`'s "Orchestrator charter" line mirrors the kind-of-work, no-model-pinning framing; keep both in sync when routing changes. Length limits are under Constraints.

### git-marker (sourced helper)

`src/assets/scripts/hooks/git-marker` exports `df_has_git_marker <dir>`: pure bash with no `git` invocation, safe on the UserPromptSubmit hot path. It walks upward a bounded 64 levels testing `-e $dir/.git`, which covers `.git` directories and the `.git` files of worktrees and submodules.

It also exports `df_is_project_root <root>` (D-HOOKS-GIT-ONLY, D-HOOKS-TOPLEVEL-ONLY): the root holds its own `.git` entry (no upward walk, so a subdirectory git could not resolve is refused) AND its physical path is not HOME's. Physical paths come from `cd -P` + `$PWD` (builtins), because git reports toplevels with symlinks resolved while `$HOME` keeps its given spelling (macOS `/var` to `/private/var`). Zero forks. `session-start-context` (the `.gitignore` carve-out, Sections 1, 2 and 4, and Section 6's project roots, all through the `PROJECT_OK` flag) and `ensure-devflow-init` (every capture/memory hook) gate on it, so no hook scaffolds `.devflow/` or a `.gitignore` outside a git project or in a HOME-rooted repo. The ambient hooks and Section 3 keep the plain marker gate. The file also holds the zero-fork `df_no_symlink_below` and `df_file_below` (D-HOOKS-NO-SYMLINK), behind every hook read or write under a project's `.devflow/`.

### session-start-context: pass rule, Section 5 and Section 6 (SessionStart, timeout 10, always-on)

Registered unconditionally by `addContextHook` (`src/cli/commands/context.ts`), outside the ambient toggle. Sections 1–4 belong to `learning-capture-system` and `tracker-feature`; the pieces below couple to the charter and to compaction. With neither jq nor node the hook returns before Section 5, so there is no directive then (accepted).

**`source` is parsed per section.** One top-level `json_extract_cwd_field "source"` returns `cwd` and `source` (`startup|resume|clear|compact`) in a single subprocess, so Section 5 costs no fork. Sections 3 and 4 still read `source` with `json_field` and gate on `startup|clear` (a resume or compact never spawns the Tracker agent or prints the legacy notice); Section 5 gates on `compact`; Section 6 ignores `source`.

**Decisions pass rule (D-DECISIONS-CHARTER-HANDOFF).** The `--- PROJECT DECISIONS (TL;DR) ---` block ends with the `Index:` line and, directly after it, the static `DECISIONS_PASS_RULE`: for direct delegations only (workflow skills load their own), pass the index as `DECISIONS_CONTEXT`, its content read once, to every agent that takes it. It sits inside the same `if` as the `Index:` line (shape-gated ledger root; a non-empty regular file that is not `(none)`, no symlink on its path), and the block is gated on the learning switch: a learning-off machine or repo never pays for the rule, an ambient-off session still gets it. The text is identical through the jq and node envelopes.

**Section 5, compaction resume directive (D-COMPACT-RESUME-DIRECTIVE).** After a compaction nothing tells the model to re-read the devflow command it was running (Claude Code is believed to re-inject a long command only in part; unverified here). On a `compact` start one fixed line is appended to `CONTEXT`, never sent as a `systemMessage`:

`If a devflow command was running: re-read {$CLAUDE_CONFIG_DIR or ~/.claude}/commands/devflow/<name>.md, list headings, read from current phase, take input (COMMAND_INPUT/ARGUMENTS) from the summary, resume after the last finished phase. Else ignore.`

The ceiling is `compact-directive-max-chars` in `tests/fixtures/numeric-floors.json`, via `COMPACT_DIRECTIVE_MAX_CHARS` in `tests/session-start-compact.test.ts`, which also holds the five elements: if-clause with an ignore clause, command file by rule, headings then the phase in progress, input from the summary, resume after the last finished phase. The line is re-sent on every compaction for every user, so lower the ceiling after a pass that cuts the text and never raise it. It is a single-quoted constant (`$CLAUDE_CONFIG_DIR` reaches the model as text), names both `COMMAND_INPUT` and `ARGUMENTS` because only some commands bind `COMMAND_INPUT`, and is emitted on every compact in every project, leaving "was a command running?" to the model. On the same compact `session-start-orchestrator` re-injects the charter.

**Section 6, CLAUDE.md import audit (D-CLAUDE-MD-IMPORT-AUDIT, D-AUDIT-STAMP).** A CLAUDE.md `@path` import loads its file into every thread at launch. Section 6 tells the user once, in a top-level `systemMessage`, never in `additionalContext`, so the model pays nothing.

- **Roots and findings.** `CLAUDE.md` in the Claude config directory (`$CLAUDE_CONFIG_DIR` when absolute, else `~/.claude`) always; with `PROJECT_OK` also the project's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`. A file finding is an import over `FILE_THRESHOLD_BYTES`; a chain finding is a root whose chain totals over `CHAIN_THRESHOLD_BYTES` ("at least" when the caps stopped the walk).
- **The stamp** `~/.devflow/.claude-md-audit` (format specified in `claude-md-audit.cjs`) holds rows `V 1`, `R <root>` (the gated root set), `P <flag> <path>` (each examined path: 0 absent, 1 regular file, 2 exists but not regular), `K <key>` (a finding already shown, capped by `MAX_KEYS`) and `E <reason>`.
- **Three paths, in order.** (1) *Fresh stamp*: the R rows equal the current roots and every P row holds (`-e` agrees with the flag; a regular file is not `-nt` the stamp, in whole seconds); builtins only, no fork, no node. (2) *No-root shortcut*: none of the roots exists (`_sc_audit_no_root`), so the stamp is written with builtins (`_sc_audit_shell_stamp absent`, pinned by a test equal to the script's `renderStamp`) and node never starts. (3) *Otherwise* ONE node process, `claude-md-audit.cjs hook <home> <stamp> <roots…>`, printing a framed block (`devflow-claude-md-audit 1`, `M <line>` message rows, the stamp rows, `END`) that the hook parses with builtins, no JSON parse.
- **Failure shows nothing.** Node failing, a missing or throwing script, or an incomplete block records the R rows, the previous K rows and `E audit-failed` (no P rows). The section is skipped silently with no node on PATH, no `~/.devflow` (a session never creates the machine root), or a link or non-regular stamp path.
- **Recording** (`_sc_audit_record`) happens after the output is emitted and only if the output call succeeded: an owner-only sibling temp is renamed over the stamp, refused when either name is a link or not a regular file. A lost update can repeat a message and never hides a new finding; a run with nothing to show still records, so the next unchanged start is free.
- **No new exit path.** The hook ends with `exit "$_SC_OUT_RC"`, the status of the output call. Accepted gaps: an mtime moved back before the stamp, or a write landing during an audit, is missed until the file's next forward change.
- **Test plumbing.** Fork-count differentials in `tests/shell-hooks-tracker.test.ts` call `primeAuditStamp` first so Section 6 costs the same in baseline and measured runs; HOME-rooted-repo scaffolding checks treat the stamp as machine data; `tests/session-start-compact.test.ts` builds its PATH farms once per file, so a test that edits a farm wrapper must restore it.

**The audit script owns the logic once.** `src/assets/scripts/claude-md-audit.cjs` holds the grammar, bounds, thresholds, display text and stamp format, and only reads; the hook runs the copy under `~/.devflow/scripts/`, the CLI the same file through `src/core/claude-md-audit.ts`. **`MAX_HOPS` is currently 4** (the root is hop 0), following the current upstream memory docs, whose older snapshots said five: the audit must count what Claude Code loads now, and a fifth hop would count bytes it does not load. It is the one constant to change if upstream moves. The other bounds are named constants (`MAX_PATHS_PER_ROOT`, `SCAN_BYTES` per file, `MAX_BYTES_READ` per run, `SKIP_FILE_BYTES`: a larger file is neither counted nor followed); the visited set is keyed by realpath, so a diamond counts once and a cycle ends. The script header lists each decided difference from upstream (escaped spaces, approval-gated imports, `@path` in HTML comments, ancestors, `rules/` and `AGENTS.md`).

**The envelope (D-SYSTEMMESSAGE-ENVELOPE).** `json_session_output "$CONTEXT" ["$SYSTEM_MESSAGE"]` in `json-parse` (node twin: `session-output <ctx> [message]` in `json-helper.cjs`) takes an optional user-facing message, carried in the top-level `systemMessage` beside, never inside, `hookSpecificOutput`. One argument or an empty message gives every other caller (`ensure-proxy`, `session-start-orchestrator`, `session-start-memory`, Sections 1–5) the envelope it has always received, byte for byte. A message with a context gives both keys, `hookSpecificOutput` first; with an empty context, `systemMessage` alone. jq pretty-prints and node prints compact, so parity means equal JSON content, not equal bytes.

### TypeScript management layer (src/cli/commands/ambient.ts)

**Exact hook ownership (D-AMBIENT-EXACT-HOOK, #391)** is the ambient instance of the shared D-EXACT-HOOK-OWNER rule in `src/targets/claude-code/hooks.ts`, used by every hook module. A hook is devflow's only when its command ENDS in one of the `AMBIENT_HOOK_SUFFIXES` (`/scripts/hooks/run-hook <marker>` for `preamble`, `session-start-orchestrator`, `session-start-classification` and `ambient-prompt`, plus the pre-run-hook `/scripts/hooks/ambient-prompt.sh`) under any directory, with backslashes read as slashes; a user's `~/bin/preamble-logger.sh` or `echo preamble` is theirs. The predicates (`isPreamble`, `isLegacy`, `isAmbient`, `isClassification`, `isOrchestrator`) come from `endsWithAny`. `removeHooks(settings, event, predicate)` removes single HOOKS, not matcher groups: a group keeps the user's sibling hooks and is dropped only when it ends up empty. `ensureHook(settings, eventName, predicate, entry)` adds the entry unless a hook matching the same predicate is registered. `convergeAmbientHooks(settingsJson, enabled, devflowDir)` is the one transform `devflow init`'s settings pass applies: remove-then-add with ambient on, remove with it off (mirrors `convergeMemoryHooks`).

**Canonical directory (D-AMBIENT-CANONICAL-DIR, #391).** `ambient --enable` registers the hooks under `getDevFlowDirectory()` (`$HOME/.devflow`), where init installs `run-hook`. It never infers a directory from settings.json: the first Stop hook is whichever hook the user listed first, and a path derived from it names a `run-hook` that does not exist. Hooks an older install registered elsewhere are still recognised by suffix: `--disable` removes them, and `addAmbientHook` (so `--enable` and init's remove-then-add alike) removes a preamble or orchestrator hook whose command is not the canonical `run-hook <marker>` under `devflowDir` and re-registers it there, one hook at a time. `createAmbientCommand()` builds the command (exported for per-test isolation); `ambientCommand` is its one instance. The action parses `settings.json` once, in a dedicated `try/catch` that is the single error boundary (a corrupt file logs a clean error and touches nothing), and passes the parsed `Settings` to `hasAmbientHook` and `hasOrchestratorHook`, which accept `string | Settings`.

### CLI side of compaction and the audit (claude-md-audit.ts, init, uninstall, flags.ts)

**The facade is a seam, not a second implementation.** `src/core/claude-md-audit.ts` loads the package's own `claude-md-audit.cjs` (`scriptsDir()`, never the installed copy, which may be older than the CLI) through the evidence-policy seam's `loadScript` against an explicit surface map. Nothing throws: a load failure, a throwing script and an unwritable stamp are `Result` errors.

**init runs the audit once, after the install, on both the Recommended and the Advanced path** (`claudeMdAuditStep`, one call site in `run`, because the Recommended summary prints before the install). It uses `showAll`, stating everything currently flagged even if a session start already showed it, then records the stamp with the earlier keys kept so the first SessionStart repeats nothing. Output is at most one `CLAUDE.md import audit` note or one degraded warning; the exit code never changes. The stamp is written only under an existing `~/.devflow`, owner-only, after an `lstat` regular-file check (the atomic writer does not refuse a symlink at the target). **uninstall** removes it through `installArtifactPaths`: the entry `.claude-md-audit` and the prefix entry `.claude-md-audit.tmp.` (a SIGKILL between temp write and rename leaves a temp).

**`auto-compact-window` is an opt-in flag (D-AUTO-COMPACT-WINDOW-OPT-IN, `src/core/flags.ts`).** The registry count is pinned in `tests/flags.test.ts`; this flag follows `bash-max-timeout-ms`. It is `kind: 'number'` on the env key `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, an integer within devflow's own `min`/`max` sanity bounds (no `upstreamDefault`: Claude Code's default window and the variable's value grammar were not observed), `recommended: false`, `defaultValue: undefined` (manifest null, key never written unless set). Set it with `devflow flags --set auto-compact-window=N` (`--enable`/`--disable` are boolean-only); `unset` deletes the key. Init applies a seeded flag record without asking, which is why the default is neutral and `recommended` stays false: a smaller window compacts sooner, and a compaction mid-command is what the Section 5 directive recovers from, so it is not recommended until a forced mid-`/implement` `/compact` is seen to resume at the right phase. The percent-based auto-compact override is a different variable that devflow never writes, manages or names (`tests/guards/no-autocompact-pct-override.test.ts` fails on any spelling of its name under `src/`, so comments describe it in words). The env name is confirmed present in Claude Code 2.1.296 and takes precedence over the in-app setting (`docs/reference/claude-code-flags-probe.md`); a release that ignored it would leave the flag silently inert (`docs/reference/platform-assumptions.md`).

## Component Interactions

```
devflow ambient --enable
  → parse settings.json once (clean error on corrupt file)
  → addAmbientHook: sweep legacy ambient-prompt and stale session-start-classification;
      ensureHook preamble (UserPromptSubmit) + session-start-orchestrator (SessionStart);
      removeLegacyCommandsRule() (best-effort) → write settings.json

session-start-orchestrator and preamble: BG_UPDATER guard → (hook-bootstrap) → json-parse
  → CWD → df_has_git_marker → charter read and size check | prompt dispatch

session-start-context (always-on, not under the toggle):
  stdin drained → BG_UPDATER guard → json-parse (exit 0 without jq and node)
  → json_extract_cwd_field "source" → Sections 1–4 (decisions block with pass rule,
  learning, tracker, legacy notice) → Section 5 on compact → Section 6
  (stamp fresh | no root | one node process) → json_session_output "$CONTEXT"
  "$SYSTEM_MESSAGE" (exit 0 when both empty) → record the stamp → exit "$_SC_OUT_RC"
```

## State Machine (partial states)

The system can land in two kinds of partial state, both repaired by `--enable`.

| State | preamble hook | orchestrator hook | `hasAmbientHook` | `--status` output |
|---|---|---|---|---|
| Fully enabled | present | present | true | `enabled` |
| Partial — preamble only | present | absent | true | `enabled (partial — run devflow ambient --enable to repair)` |
| Partial — orchestrator only | absent | present | **false** | `disabled (partial — run devflow ambient --enable to repair)` |
| Disabled | absent | absent | false | `disabled` |

`hasAmbientHook` is preamble-authoritative: the preamble hook is the per-prompt behavioral core, so orchestrator-only reads as disabled. The repair hint is appended to both lines whenever `hasAmbientHook` and `hasOrchestratorHook` disagree. `--enable` checks each hook independently via `ensureHook` and adds whichever is missing.

## Literal Duplication: Plan-Handoff Prefix

`Implement the following plan:` appears verbatim in `src/assets/scripts/hooks/preamble` (the fast-path match) and in `src/assets/scripts/hooks/assets/orchestrator-charter.md` (the plan-handoff fallback bullet). This is intentional: whether UserPromptSubmit fires for Claude Code's own auto-injected "start-of-plan-session" prompt is an empirical unknown, while SessionStart provably fires (via `SessionStart:clear`) in plan-handoff sessions; the preamble handles explicit user-typed handoffs and the charter bullet covers the rest. The preamble and the orchestrator hook carry cross-reference comments; if Claude Code changes the handoff format, update both places together.

## Constraints

**Charter cap and ceiling.** `session-start-orchestrator` compares `${#CHARTER}` (characters, not bytes) with `-gt 4096`, so exactly 4096 is accepted and anything longer disables the charter with no visible error. The suite pins the exact-4096 boundary as an accept case and holds the charter to 75% of the cap (`MAX_CHARTER_CHARS` in `tests/agent-name-guards.test.ts`, the `charter-char-max` row of `tests/fixtures/numeric-floors.json`), so the ceiling trips first. It is a ratchet, lowered and never raised to fit an edit, and its literal appears exactly once in that test file. Em dashes count one character but three bytes, so measure characters (`wc -m`, or `${#CHARTER}`, which is one less because command substitution drops the trailing newline) and recompute after any edit.

**The bounded-inline exception and the report cap are guarded as shapes** (GAP-3 block, `tests/agent-name-guards.test.ts`): one sentence must hold every bound word (single, git, gh, 40 lines, diff, log, test), because two sentences would let an edit keep the grant and lose the bound; a delegation report cap must carry a token figure; the handoff line must invoke `devflow:implement` without the words "full plan". Known-bad probes seed each defect; `tests/commands/report-caps.test.ts` holds the same figure on the built-in Explore and Plan spawns.

**Fixed output, Bash 3.2, fail-open.** Both hook output strings are byte-fixed templates, so arbitrary prompt bytes cannot change hook behavior beyond the dispatch branches (the fuzz-test invariant); the pass rule and compaction directive are static literals too. The audit's `systemMessage` shows file data (an import path and its size, never the prompt), and a path in it must be printable ASCII or it is replaced by `<path not shown>`. The preamble uses only POSIX-compatible bash (test C5 in `shell-hooks.test.ts` rejects `${var,,}` and `${var^^}`). The ambient hooks and `session-start-context` exit 0 if neither `jq` nor `node` is available, so without one of them there is no compaction directive either.

## Anti-Patterns

**KB-AP-1 to KB-AP-3.** The old design matched keywords (`implement`, `explore`, `research`, a three-marker scheme) in the hook and was deleted clean, with no tombstones; the end-state is the charter. A user-controlled variable such as `$HEAD` in `json_prompt_output` is prompt injection through hook output, and `git status` or `git rev-parse` spawn a subprocess on every prompt, which `git-marker` exists to avoid.

**KB-AP-4 to KB-AP-6.** Charter growth is a silent outage past the hook's cap as well as a per-session cost, which is why the decisions pass rule sits in Section 1. Each roster agent's `model:` comes from its own frontmatter in `src/assets/agents/` (hand-authored `.md` or MDS host `.mds`; Skim, for instance, runs a lighter model than Code) and `devflow agents` overrides it per user, so no haiku/sonnet/opus table belongs in the charter.

**KB-AP-7 to KB-AP-9.** Swapped channels make the model pay for the audit and never see the directive. Recording the stamp before the output can hide a finding the user never saw. A pinned limit has a decision behind it: `MAX_HOPS` follows what Claude Code loads now, and the directive ceiling is a per-compaction cost for every user.

**KB-AP-10 and KB-AP-11.** A hook outside `addAmbientHook` / `removeAmbientHook` survives `--disable`. `h.command.includes(marker)` claimed any user hook that mentioned the word, and the old group-level filter then deleted every sibling in its matcher group (#391). Use `endsWithAny` against `AMBIENT_HOOK_SUFFIXES` (or `devflowHookOwner` in other hook modules), `ensureHook`, and per-hook `removeHooks`.

## Gotchas

**KB-AP-12.** `hook-bootstrap` initializes per-project debug logging from `CWD`, so the guard comes first in `preamble`, `session-start-orchestrator` and `session-start-context`. The memory worker's own `claude -p` session fires these hooks and must receive neither the reminder nor a handoff directive it would act on.

**KB-AP-13 and KB-AP-14.** Only `dbg` records why the charter was dropped, so check its length after every edit. `removeLegacyCommandsRule()` runs in both `addAmbientHook` and `removeAmbientHook` whether or not hooks changed, so a stale `~/.claude/rules/devflow/commands.md` from a pre-charter install is purged even on an idempotent re-enable. The `classification` suffix in `AMBIENT_HOOK_SUFFIXES` names a hook from a previous design; both functions sweep it (`removeHooks(settings, 'SessionStart', isClassification)`), keeping enable and disable symmetric.

**KB-AP-15.** `systemMessage` is documented upstream as a warning shown to the user (`additionalContext` is the field that reaches Claude's context), but the page does not say per event whether SessionStart shows it. The `docs/reference/platform-assumptions.md` row records the drift symptom.

**KB-AP-16.** `/implement` binds its input once as `COMMAND_INPUT`. In the handoff case that is empty, so there is nothing to name the branch from and the Git agent sees none of the conversation; the orchestrator writes a one-line task description itself, from the plan's title or the conversation, and sends it as the `setup-task` `TASK_DESCRIPTION`.

**KB-AP-17.** `/implement`, `/code-review`, `/debug` and `/plan` orchestrate and delegate, so their main threads load no skill; `/release`, whose main thread drives git, loads `devflow:git`. `docs/reference/skill-catalog.md` keeps all five intent rows, "(none)" included, held to the compiled commands both ways by `collectCompanionDrift` (`tests/skill-references.test.ts`), and the closure guard rejects an unread `requires:` entry in `DEVFLOW_PLUGINS`.

## Key Files

- `src/assets/scripts/hooks/preamble`, `session-start-orchestrator` — the UserPromptSubmit dispatch and the SessionStart charter injection
- `src/assets/scripts/hooks/assets/orchestrator-charter.md` — the static charter (no decisions rule)
- `src/assets/scripts/hooks/session-start-context` — always-on hook: Section 1's pass rule, Section 5 (resume directive), Section 6 (import audit and stamp)
- `src/assets/scripts/claude-md-audit.cjs` and `src/core/claude-md-audit.ts` — the audit (grammar, `MAX_HOPS`, thresholds, bounds, stamp format, framed output) and its typed facade for `devflow init`
- `src/core/flags.ts` — the flag registry, including `auto-compact-window` and its decision comment
- `src/assets/scripts/hooks/json-parse`, `json-helper.cjs` — `json_session_output` and its node twin `session-output`, `json_extract_cwd_field`, `json_prompt_output`
- `src/assets/scripts/hooks/git-marker` — the zero-fork gates; a PATH-shim fork counter holds the claim (`tests/shell-hooks-tracker.test.ts`, TP-22)
- `src/cli/commands/ambient.ts` — `AMBIENT_HOOK_SUFFIXES`, `addAmbientHook`, `removeAmbientHook`, `convergeAmbientHooks`, `hasAmbientHook`, `createAmbientCommand`; the shared `endsWithAny`, `removeHooks`, `ensureHook` live in `src/targets/claude-code/hooks.ts`
- `docs/commands.md` — "Orchestrator charter" line, in sync with the charter's routing
- `tests/agent-name-guards.test.ts` — charter integrity guards and `collectCharterKnowledgeDefects`; `tests/fixtures/ambient-templates.ts` — `HANDOFF_TEMPLATE`, `REMINDER_TEMPLATE`; `tests/fixtures/numeric-floors.json` — `charter-char-max`, `compact-directive-max-chars`
- Pinning tests named inline above; start with `tests/shell-hooks.test.ts` (preamble, orchestrator hook, pass-rule pins, envelope), `tests/session-start-compact.test.ts` (Sections 5 and 6), `tests/core/claude-md-audit.test.ts`, `tests/init-claude-md-audit.test.ts` and `tests/ambient.test.ts`

## Related

- Feature knowledge: `learning-capture-system` — the memory worker fires UserPromptSubmit and SessionStart hooks too, with the `DEVFLOW_BG_UPDATER` guard as the coupling point; also covers `session-start-context` Sections 1–4 and the decisions index the pass rule points at
- Feature knowledge: `tracker-feature` — Section 3 of `session-start-context`, the tracker setup directive that gates on `startup|clear`
- Feature knowledge: `dynamic-workflow-engine` — the bind-once `COMMAND_INPUT` convention that makes a no-argument plan handoff safe, and the guards that hold it
- Feature knowledge: `feature-knowledge-system` — how the entries the charter's Feature knowledge rule passes (Rules bullets, heading index) are written and consumed
- Feature knowledge: `installer-shadowing` — `composeScripts` copies `src/assets/scripts/` (including `claude-md-audit.cjs`) to `~/.devflow/scripts/`; init and uninstall handle the stamp
- `docs/reference/hooks.md`, `docs/reference/platform-assumptions.md`, `docs/reference/claude-code-flags-probe.md` — prose reference for Sections 5 and 6 and the `source`, `systemMessage` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` assumptions
- `src/assets/scripts/hooks/hook-bootstrap`, `hook-log-init` — shared hook initialization and the injection log
