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

## Overview

Ambient mode turns the main Claude Code session into an orchestrator: it coordinates sub-agents rather than performing work directly, with one bounded inline exception (see the charter below). The feature is a two-hook system, both managed by a single `devflow ambient --enable/--disable` toggle: `session-start-orchestrator` (SessionStart) injects a static charter as `additionalContext` at the start of every session, and `preamble` (UserPromptSubmit) reinforces the orchestrator contract per prompt and handles the plan-handoff fast-path. Both hooks are presence-gated — they only fire in git repositories — and share three cross-cutting safety contracts: a `DEVFLOW_BG_UPDATER` re-entrancy guard, a bounded pure-bash git-repo check, and fail-open `exit 0` on all error paths.

Three more pieces share the hook directory but not the toggle. `session-start-context` (SessionStart, always-on) carries the rule that hands the decisions index to delegations, a compaction resume directive (Section 5) and the CLAUDE.md import audit (Section 6). `src/core/claude-md-audit.ts` is the CLI's typed seam onto the same audit script. The opt-in `auto-compact-window` flag in `src/core/flags.ts` (31 flags in the registry) is the one knob devflow offers over when Claude Code compacts, the event the resume directive recovers from. The design is a charter injected once at session start, with no per-prompt heavyweight detection.

## Component Architecture

### Hook 1: session-start-orchestrator (SessionStart, timeout 10)

Reads `src/assets/scripts/hooks/assets/orchestrator-charter.md` at runtime and emits its content as `additionalContext` via `json_session_output` (one argument, so no `systemMessage`). The charter is static — it never interpolates user input. The hook reads only `cwd` from its input and never looks at the SessionStart `source`, so the charter is injected on startup, resume, clear and compact alike. A missing, empty or oversized (over 4096 characters, `${#CHARTER}`) charter exits 0 silently. It logs `Injecting charter (N chars)` through `hook-log-init`, like the sibling SessionStart hooks.

### Hook 2: preamble (UserPromptSubmit, timeout 5)

Pure-bash dispatch on the first 256 bytes of the prompt (after leading whitespace strip). Three behaviors plus the empty-prompt skip, no subprocess in the dispatch block:

| Prompt condition | Output |
|---|---|
| Empty after whitespace strip | Silent exit 0 |
| Begins `Implement the following plan:` | Fixed devflow:implement handoff directive |
| Begins `/` (slash command) | Silent exit 0 |
| Anything else | Fixed 2-line orchestrator reminder ("coordinate, don't produce") |

The plan-handoff directive tells the model to invoke `devflow:implement` through the Skill tool with **no arguments**: the handoff prompt is the plan, already in the conversation, and passing it as skill input would put a second copy in the main-thread context. No plan body or path is parsed; detection stays the literal prefix. The directive is a double-quoted bash string (no dollar sign, no unescaped backtick) and must equal `HANDOFF_TEMPLATE` in `tests/fixtures/ambient-templates.ts` byte for byte.

### orchestrator-charter.md

A static markdown file at `src/assets/scripts/hooks/assets/orchestrator-charter.md` consumed at runtime by `session-start-orchestrator`. Contains the full orchestrator contract:

- **Never-mainline rule.** File edits, builds, multi-file reads, codebase orientation and debug loops are delegated work, with one bounded-inline exception in a single sentence: the main thread may run only a single git, gh or script command whose output stays under about 40 lines, never a diff, log or test run.
- **Routing keyed by kind of work, not by model.** Search and listing go to Explore, codebase orientation to Skim. Execution against a spec goes to Code (the prompt opens with `OPERATION: <mode>`: `edit` for mechanical changes such as renames, moves and boilerplate, `issue-fix` for pre-classified review issues, else `implement`), Validate (build, typecheck, lint, test) or Git. Analysis, design and research go to Design, Research, Review or Triage (validates review issues against the blast-radius matrix). Real-scale work that matches a workflow invokes the full skill instead: devflow:implement, plan, research, explore, debug, code-review, resolve. Each agent runs on its own configured model; the charter pins none.
- **Stays mainline (judgment work).** Conversation, decisions, routing, synthesizing agent reports, answers already in loaded context, one targeted Read to scope a delegation.
- **Six operating rules.** (1) Decompose mainline: subagents cannot spawn subagents, so the orchestrator breaks work down and delegates leaf tasks. (2) Self-contained delegation: subagents see none of the conversation, so each delegation supplies goal, constraints, relevant session decisions and facts, and exact paths, with the substance of any conversation-derived deliverable in the prompt, not a pointer. (3) Report cap: every direct delegation is asked for a final report of at most about 1,500 tokens (findings, paths, verdicts, no file dumps). (4) Parallelize independent delegations in one message; Git operations stay sequential. (5) Feature knowledge (below). (6) Plan handoff: when the first message begins with `Implement the following plan:`, say so in one sentence, then invoke `devflow:implement` through the Skill tool with no arguments.

**The Feature knowledge rule** (direct delegations only — workflow skills handle their own): before delegating non-trivial code work, match the task area against `.devflow/features/index.md` and pass each matching KB's one to three most relevant `## Rules` bullets (verbatim, IDs included; for a KB without a Rules section, its Anti-Patterns or Gotchas entries, cited by section), the KB's path and its `##` heading index as `FEATURE_KNOWLEDGE`; after delegated changes to a covered area, spawn Knowledge to refresh that KB. A delegation gets the lines that govern its task and Reads further sections itself, not the whole file. `collectCharterKnowledgeDefects` (`tests/agent-name-guards.test.ts`) holds the three limits, the Rules delivery and the legacy fallback, and rejects a bullet that passes whole `KNOWLEDGE.md` content.

**The charter has no Decisions bullet** (D-DECISIONS-CHARTER-HANDOFF). The charter is paid for in every ambient session, learning on or off, and a decisions rule matters only with an index to pass, so the rule follows the `Index:` line of `session-start-context` Section 1 (see that subsection). A `shell-hooks` test pins that the charter holds neither `DECISIONS_CONTEXT` nor `PROJECT DECISIONS`.

**Length.** The charter is 2,683 characters (2,699 bytes: eight em dashes of three bytes each; the hook's `${#CHARTER}` reads 2,682 because command substitution drops the final newline), against the 3,072-character ceiling (see Constraints), so about 390 characters of headroom remain. `docs/commands.md`'s "Orchestrator charter" line mirrors the kind-of-work, no-model-pinning framing; keep both in sync if the routing changes.

### git-marker (sourced helper)

`src/assets/scripts/hooks/git-marker` exports `df_has_git_marker <dir>`. Pure bash — no subprocess, no `git` binary invocation — making it safe on the UserPromptSubmit hot path. Bounded 64-level upward walk using `-e $dir/.git` (works for both `.git` directories and `.git` files from worktrees/submodules).

It also exports `df_is_project_root <root>` (D-HOOKS-GIT-ONLY, D-HOOKS-TOPLEVEL-ONLY): the root holds its own `.git` entry (no upward walk, so a subdirectory git could not resolve is refused) AND its physical path is not HOME's. Physical paths come from `cd -P` + `$PWD` (builtins; the caller's directory is restored), because git reports toplevels with symlinks resolved while `$HOME` keeps its given spelling (macOS `/var` → `/private/var`). Zero forks. `session-start-context` (carve-out, Sections 1–2, Section 4, and Section 6's project roots, all through the `PROJECT_OK` flag) and `ensure-devflow-init` (every capture/memory hook) gate on it, so no hook scaffolds `.devflow/` or a `.gitignore` outside a git project or in a HOME-rooted repo. The ambient hooks and `session-start-context` Section 3 keep the plain marker gate. The file also holds the zero-fork `df_no_symlink_below` and `df_file_below` (D-HOOKS-NO-SYMLINK), behind every hook read or write under a project's `.devflow/`.

### session-start-context: pass rule, Section 5 and Section 6 (SessionStart, timeout 10, always-on)

Registered unconditionally by `addContextHook` (`src/cli/commands/context.ts`), outside the ambient toggle. Sections 1–4 belong to `learning-capture-system` and `tracker-feature`; these pieces couple to the charter and to compaction. With neither jq nor node the hook returns before Section 5, so there is no directive then (accepted).

**`source` is parsed per section.** One top-level `json_extract_cwd_field "source"` returns `cwd` and `source` (`startup|resume|clear|compact`) in a single subprocess, so Section 5 costs no fork. Sections 3 and 4 each still read `source` with `json_field` and gate on `startup|clear` (a resume or compact never spawns the Tracker agent or prints the legacy notice); Section 5 gates on `compact`; Section 6 ignores `source`. Every gate is a positive `case`, so an absent or unknown `source` emits nothing.

**Decisions pass rule (D-DECISIONS-CHARTER-HANDOFF).** The `--- PROJECT DECISIONS (TL;DR) ---` block ends with the `Index:` line and, directly after it, the static `DECISIONS_PASS_RULE`: "Decisions (direct delegations only — workflow skills load their own): pass this index as DECISIONS_CONTEXT — its content, read once — to every agent that takes it." It is appended inside the same `if` as the `Index:` line (shape-gated ledger root; a non-empty regular file that is not `(none)`, no symlink on its path), so a block without an index never carries it. The block is gated on the learning switch, so a learning-off machine or repo never pays for the rule and an ambient-off session still gets it. The text is the same through the jq and node envelopes.

**Section 5, compaction resume directive (D-COMPACT-RESUME-DIRECTIVE).** After a compaction nothing tells the model to re-read the devflow command it was running (Claude Code is believed to re-inject a long command only in part; unverified here). On a `compact` start one fixed line is appended to `CONTEXT`, never sent as a `systemMessage`:

`If a devflow command was running: re-read {$CLAUDE_CONFIG_DIR or ~/.claude}/commands/devflow/<name>.md, list headings, read from current phase, take input (COMMAND_INPUT/ARGUMENTS) from the summary, resume after the last finished phase. Else ignore.`

It is 249 ASCII characters against a 250 ceiling (`compact-directive-max-chars` in `tests/fixtures/numeric-floors.json`, via `COMPACT_DIRECTIVE_MAX_CHARS` in `tests/session-start-compact.test.ts`, which also holds its five elements: if-clause with an ignore clause, command file by rule, headings then the phase in progress, input from the summary, resume after the last finished phase). It is re-sent on every compaction for every user, so lower the ceiling after a pass that cuts the text and never raise it. The line is a single-quoted constant (`$CLAUDE_CONFIG_DIR` reaches the model as text), names both `COMMAND_INPUT` and `ARGUMENTS` because only some commands bind `COMMAND_INPUT`, is emitted on every compact in every project, and leaves "was a command running?" to the model. On the same compact `session-start-orchestrator` re-injects the charter.

**Section 6, CLAUDE.md import audit (D-CLAUDE-MD-IMPORT-AUDIT, D-AUDIT-STAMP).** A CLAUDE.md `@path` import loads its file into every thread at launch. Section 6 tells the user once, in a top-level `systemMessage`, never in `additionalContext`, so the model pays nothing.

- **Roots and findings.** `CLAUDE.md` in the Claude config directory (`$CLAUDE_CONFIG_DIR` when absolute, else `~/.claude`) always; with `PROJECT_OK` also the project's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`. A file finding is an import over 10,000 bytes; a chain finding is a root whose chain totals over 40,000 bytes ("at least" when the caps stopped the walk).
- **The stamp** `~/.devflow/.claude-md-audit` holds rows `V 1`, `R <root>` (the gated root set), `P <flag> <path>` (each examined path: 0 absent, 1 regular file, 2 exists but not regular), `K <key>` (a finding already shown; at most 256) and `E <reason>`.
- **Three paths, in order.** (1) *Fresh stamp*: the R rows equal the current roots and every P row holds (`-e` agrees with the flag; a regular file is not `-nt` the stamp, in whole seconds). Builtins only: no fork, no node. (2) *No-root shortcut*: none of the roots exists (`_sc_audit_no_root`), so the stamp is written with builtins (`_sc_audit_shell_stamp absent`) and node never starts; a test pins it equal to the script's `renderStamp`. (3) *Otherwise* ONE node process, `claude-md-audit.cjs hook <home> <stamp> <roots…>`, printing a framed block (`devflow-claude-md-audit 1`, `M <line>` message rows, the stamp rows, `END`) that the hook parses with builtins, no JSON parse.
- **Failure shows nothing.** Node failing, a missing or throwing script, or an incomplete block records the R rows, the previous K rows and `E audit-failed` (no P rows): an unchanged broken state starts no node, a changed root set retries. The section is skipped silently with no node on PATH, no `~/.devflow` (a session never creates the machine root), or a link or non-regular stamp path.
- **Recording** happens after the output is emitted and only if the output call succeeded (`_sc_audit_record`): an owner-only sibling temp is renamed over the stamp, refused when either name is a link or not a regular file. A lost update can repeat a message and never hides a new finding; a run with nothing to show still records, which makes the next unchanged start free.
- **No new exit path.** Sections 5 and 6 never call `exit`; the hook ends with `exit "$_SC_OUT_RC"`, the status of the output call. Accepted gaps: an mtime moved back before the stamp, or a write landing during an audit, is missed until the file's next forward change.

**The audit script owns the logic once.** `src/assets/scripts/claude-md-audit.cjs` holds the grammar, bounds, thresholds, display text and stamp format, and only reads; the hook runs the copy under `~/.devflow/scripts/`, the CLI reaches the same file through `src/core/claude-md-audit.ts`. **`MAX_HOPS` is 4** (the root is hop 0), following the current upstream memory docs, whose older snapshots said five: the audit must count what Claude Code loads now, and a fifth hop would count bytes it does not load. It is the one constant to change if upstream moves. Other bounds: 64 paths per root, 64 KiB scanned per file, 1 MiB read per run, a file over 4 MiB neither counted nor followed; the visited set is keyed by realpath, so a diamond counts once and a cycle ends. The header lists each decided difference from upstream (escaped spaces not followed, an approval-gated import counted, `@path` inside an HTML comment counted, ancestors, `rules/` and `AGENTS.md` not audited).

**The envelope (D-SYSTEMMESSAGE-ENVELOPE).** `json_session_output "$CONTEXT" ["$SYSTEM_MESSAGE"]` in `json-parse` (node twin: `session-output <ctx> [message]` in `json-helper.cjs`) takes an optional second argument, a user-facing message carried in the top-level `systemMessage` beside, never inside, `hookSpecificOutput`. One argument or an empty message gives the envelope every other caller (`ensure-proxy`, `session-start-orchestrator`, `session-start-memory`, Sections 1–5) has always received, byte for byte. A message with a context gives both keys, `hookSpecificOutput` first; a message with an empty context gives `systemMessage` alone, with no `hookSpecificOutput` key. jq pretty-prints and node prints compact, so parity means equal JSON content, not equal bytes.

### TypeScript management layer (src/cli/commands/ambient.ts)

**Exact hook ownership (D-AMBIENT-EXACT-HOOK, #391)** is the ambient instance of the shared D-EXACT-HOOK-OWNER rule in `src/targets/claude-code/hooks.ts`, which every hook module (capture, memory, context, proxy, legacy-hooks) uses. A hook is devflow's only when its command ENDS in one of the suffixes in `AMBIENT_HOOK_SUFFIXES` — `/scripts/hooks/run-hook <marker>` for `preamble`, `session-start-orchestrator`, `session-start-classification` and `ambient-prompt`, plus the pre-run-hook `/scripts/hooks/ambient-prompt.sh` — under any directory, with backslashes read as slashes. A user's `~/bin/preamble-logger.sh` or `echo preamble` is theirs. The predicates (`isPreamble`, `isLegacy`, `isAmbient`, `isClassification`, `isOrchestrator`) come from `endsWithAny`.

`removeHooks(settings, event, predicate)` (hooks.ts) removes single HOOKS, not matcher groups: a group keeps the user's sibling hooks and is dropped only when it ends up empty. Hook registration goes through `ensureHook(settings, eventName, predicate, entry)` (hooks.ts), which adds the entry unless a hook matching the same predicate is registered — a user hook that merely mentions the word no longer suppresses registration.

`convergeAmbientHooks(settingsJson, enabled, devflowDir)` is the one ambient transform `devflow init`'s settings pass applies: remove-then-add with ambient on, remove with it off (mirrors `convergeMemoryHooks`).

**Canonical directory (D-AMBIENT-CANONICAL-DIR, #391).** `ambient --enable` registers the hooks under `getDevFlowDirectory()` (`$HOME/.devflow`), where init installs `run-hook`. It never infers a directory from settings.json: the first Stop hook is whichever hook the user listed first, and a path derived from it names a `run-hook` that does not exist. Hooks an older install registered under another directory are still recognised by suffix: `--disable` removes them, and `addAmbientHook` (so `--enable` and init's remove-then-add alike) removes a preamble or orchestrator hook whose command is not the canonical `run-hook <marker>` under `devflowDir` and re-registers it there, one hook at a time. The command is built by `createAmbientCommand()` (exported for per-test isolation); `ambientCommand` is its one instance.

The `ambientCommand` action parses `settings.json` once up front with a dedicated `try/catch`, the single error boundary: a corrupt file logs a clean error and returns without touching the filesystem. The parsed `Settings` object goes straight to `hasAmbientHook` and `hasOrchestratorHook`, which accept `string | Settings` (a raw string is parsed inside the function). `hasAmbientHook` is preamble-authoritative (see State Machine section).

### CLI side of compaction and the audit (claude-md-audit.ts, init, uninstall, flags.ts)

**The facade is a seam, not a second implementation.** `src/core/claude-md-audit.ts` loads the package's own `claude-md-audit.cjs` (`scriptsDir()`, never the installed copy, which may be older than the CLI) through the evidence-policy seam's `loadScript` against an explicit surface map. Nothing throws: a load failure, a throwing script and an unwritable stamp are `Result` errors.

**init runs the audit once, after the install, on both the Recommended and the Advanced path** (`claudeMdAuditStep`, one call site in `run`, because the Recommended summary prints before the install). init uses `showAll`, stating everything currently flagged even if a session start already showed it, then records the stamp with the earlier keys kept so the first SessionStart repeats nothing. Output is at most one `CLAUDE.md import audit` note or one degraded warning; the exit code never changes. The stamp is written only under an existing `~/.devflow`, owner-only, after an `lstat` regular-file check (the atomic writer does not refuse a symlink at the target). **uninstall** removes it through `installArtifactPaths`: the exact entry `.claude-md-audit` and the prefix entry `.claude-md-audit.tmp.` (a SIGKILL between the temp write and the rename leaves a temp behind).

**`auto-compact-window` is an opt-in flag (D-AUTO-COMPACT-WINDOW-OPT-IN, `src/core/flags.ts`).** The registry holds 31 flags; this one follows `bash-max-timeout-ms`. It is `kind: 'number'` on the env key `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, an integer from 100000 to 1000000 (devflow's own bound; no `upstreamDefault`, because Claude Code's default window and the variable's value grammar were not observed), `recommended: false`, `defaultValue: undefined` (manifest null, key never written unless set). Set it with `devflow flags --set auto-compact-window=N` (`--enable`/`--disable` are boolean-only); `unset` deletes the key. Init applies a seeded flag record without asking, which is why the default is neutral and `recommended` stays false: a smaller window compacts sooner, and a compaction mid-command is what the Section 5 directive recovers from, so it is not recommended until a forced mid-`/implement` `/compact` is seen to resume at the right phase. The percent-based auto-compact override is a different variable that devflow never writes, manages or names: `tests/guards/no-autocompact-pct-override.test.ts` fails on any spelling of its name under `src/`, so comments describe it in words. The env name is confirmed present in Claude Code 2.1.296 and takes precedence over the in-app setting (`docs/reference/claude-code-flags-probe.md`); if a release ignored it the flag would silently do nothing (`docs/reference/platform-assumptions.md`).

## Component Interactions

```
devflow ambient --enable
  → parse settings.json once (try/catch — clean error on corrupt file)
  → addAmbientHook(settingsJson, devflowDir): sweep legacy ambient-prompt and stale
      session-start-classification; ensureHook preamble (UserPromptSubmit) and
      session-start-orchestrator (SessionStart); removeLegacyCommandsRule() (best-effort)
  → writes updated settings.json

Per-session (SessionStart):
  session-start-orchestrator fires
    → DEVFLOW_BG_UPDATER guard (exit 0 if set)
    → hook-bootstrap sourced (debug logging)
    → json-parse sourced; exit 0 if neither jq nor node available
    → CWD resolved; hook-log-init sourced
    → df_has_git_marker (exit 0 if not a git repo)
    → reads orchestrator-charter.md into CHARTER var
    → size check: exit 0 if > 4096 characters
    → log "Injecting charter (N chars)"
    → json_session_output "$CHARTER"   ← additionalContext injected

Per-prompt (UserPromptSubmit):
  preamble fires
    → DEVFLOW_BG_UPDATER guard (exit 0 if set)
    → json-parse sourced; exit 0 if neither jq nor node available
    → json_extract_cwd_prompt → CWD + PROMPT
    → df_has_git_marker (exit 0 if not a git repo)
    → HEAD="${PROMPT:0:256}" then strip leading whitespace
    → dispatch: empty-skip | plan-handoff | slash-skip | reminder

Per-session (SessionStart), session-start-context (always-on, not under the toggle):
  stdin drained → DEVFLOW_BG_UPDATER guard → json-parse (exit 0 if no jq and no node)
    → json_extract_cwd_field "source" → CWD + SESSION_SOURCE
    → Sections 1–4 (decisions block with pass rule, learning, tracker, legacy notice)
    → Section 5 on compact → Section 6 (stamp fresh | no root | one node process)
    → json_session_output "$CONTEXT" "$SYSTEM_MESSAGE" (or exit 0 when both empty)
    → record the stamp after the output → exit "$_SC_OUT_RC"
```

## State Machine (partial states)

The system can land in two kinds of partial state. Both are repaired by `--enable`.

| State | preamble hook | orchestrator hook | `hasAmbientHook` | `--status` output |
|---|---|---|---|---|
| Fully enabled | present | present | true | `enabled` |
| Partial — preamble only | present | absent | true | `enabled (partial — run devflow ambient --enable to repair)` |
| Partial — orchestrator only | absent | present | **false** | `disabled (partial — run devflow ambient --enable to repair)` |
| Disabled | absent | absent | false | `disabled` |

`hasAmbientHook` is preamble-authoritative: orchestrator-only (without preamble) is treated as disabled, not enabled. This is intentional — the preamble hook is the per-prompt behavioral core; the orchestrator hook alone provides no prompt-level behavior. The repair hint is appended to both the `enabled` and `disabled` lines whenever `hasAmbientHook` and `hasOrchestratorHook` disagree. `--enable` checks each hook independently via `ensureHook` and adds whichever is missing, so it repairs both partial states without duplicating hooks already present.

## Literal Duplication: Plan-Handoff Prefix

The string `Implement the following plan:` appears verbatim in two places:

1. `src/assets/scripts/hooks/preamble` — the fast-path match condition in the UserPromptSubmit dispatch
2. `src/assets/scripts/hooks/assets/orchestrator-charter.md` — the plan-handoff fallback bullet under SessionStart

This is intentional. SessionStart provably fires (via `SessionStart:clear`) in plan-handoff sessions even if UserPromptSubmit does not fire for Claude Code's auto-injected handoff prompt, and the charter's fallback bullet covers that gap. Both files carry a cross-reference comment; if Claude Code changes the handoff format, update both together.

## Constraints

**4096-character charter cap, 3,072-character ceiling**: `session-start-orchestrator` compares `${#CHARTER}` (characters, not bytes) with `-gt 4096` and exits silently above it, so 4096 is accepted and anything longer disables the charter with no visible error. The test suite pins the exact-4096 boundary as an accept case and holds the charter itself to 75% of the cap, 3,072 characters (`charter-char-max` in `tests/fixtures/numeric-floors.json`, asserted in `tests/agent-name-guards.test.ts`), so the ceiling trips first. The ceiling is a ratchet: it may be lowered, never raised to fit an edit, and it pins the literal `3072` exactly once in that test file, so a second `3072` literal there breaks it. The charter's em dashes count one character each but three bytes, so measure characters (`wc -m`, or `${#CHARTER}`, which is one less because command substitution drops the trailing newline), not bytes.

**The bounded-inline exception and the report cap are guarded as shapes** (`tests/agent-name-guards.test.ts`, GAP-3 block): one sentence must hold every bound word (single, git, gh, 40 lines, diff, log, test), because two sentences would let an edit keep the grant and lose the bound; a delegation report cap must carry a token figure; and the handoff line must invoke `devflow:implement` without the words "full plan". Known-bad probes seed each defect; `tests/commands/report-caps.test.ts` holds the same figure on the built-in Explore and Plan spawns.

**256-byte prompt head**: The preamble dispatch window is the first 256 bytes post-whitespace-strip. Plan-handoff prompts have zero leading whitespace by definition; the strip is defensive. The window fits the known prefix and is not semantic detection.

**Bash 3.2 compatibility**: Preamble uses only POSIX-compatible bash; a test (C5 in shell-hooks.test.ts) verifies absence of bash-4-only `${var,,}` and `${var^^}`.

**Zero user-text interpolation**: Both hook output strings are byte-fixed templates. No user prompt content is interpolated into hook output. This is the fuzz-test invariant: arbitrary prompt bytes cannot modify hook behavior beyond the dispatch branches. The `session-start-context` pass rule and compaction directive are static literals too. The audit's `systemMessage` shows file data (an import path and its size, read from CLAUDE.md files, never from the prompt), and a path in it must be printable ASCII or it is replaced by `<path not shown>`.

**json-parse dependency**: The ambient hooks, and `session-start-context`, source `json-parse` and exit 0 if neither `jq` nor `node` is available. This is the fail-open contract for environments lacking JSON tooling; for `session-start-context` it also means no compaction directive without one of them.

## Anti-Patterns

**Adding detection logic to preamble**: The old ambient design used keyword detection in the hook — `implement`, `explore`, `research`, etc. This was removed because it triggered heavyweight workflows on small prompts. The current design is charter-based: the model decides how to delegate, not the hook. Do not re-add semantic detection to the dispatch block.

**Interpolating prompt content into hook output**: `json_prompt_output` must receive only fixed string literals. Passing `$HEAD` or any user-controlled variable enables prompt injection via hook output (see the fuzz test in tests/shell-hooks.test.ts).

**Letting the hook call `git` directly**: `git status`, `git rev-parse`, etc. spawn a subprocess on every UserPromptSubmit call. `git-marker` is a pure-bash bounded walk precisely to avoid this; never replace it with a `git` invocation on the hot path.

**Growing orchestrator-charter.md, or putting text in it that applies only sometimes**: Past 4096 characters the hook exits 0 silently, with no error visible to the user, so keep the charter under the 3,072-character ceiling and recompute its length after any edit (see Constraints). The charter is paid for in every ambient session, which is why the decisions pass rule lives in `session-start-context` Section 1, behind the learning switch and the `Index:` line; a test fails if the charter names `DECISIONS_CONTEXT` or `PROJECT DECISIONS` again.

**Pinning a model in the charter's routing table**: The routing table dispatches by kind of work (search/listing, codebase orientation, execution, analysis/design/research, real-scale workflow) — never by model tier. Each roster agent's model comes from its own frontmatter (e.g. Code, Skim and Knowledge are each `model: sonnet` in their agent files), not from the charter. Do not reintroduce a haiku/sonnet/opus routing table into the charter; `docs/commands.md`'s charter line documents this no-pinning behavior and must stay in sync.

**Crossing the two SessionStart channels**: the resume directive is model-facing (`additionalContext`); the audit message is user-facing (`systemMessage`). Swapped, the model pays for the audit and never sees the directive.

**Section 5 and 6 shortcuts**: recording the audit stamp before the output can hide a finding the user never saw; calling `exit` breaks the "no new exit path" invariant a test holds; a second copy of the audit grammar or thresholds outside `claude-md-audit.cjs` drifts from the script the hook runs.

**Loosening the pinned limits**: raising `MAX_HOPS` to the older docs' five, raising `compact-directive-max-chars`, recommending `auto-compact-window` before a forced mid-command `/compact` is checked, or writing or naming the percent-based auto-compact override (a guard scans `src/`).

**Adding a third presence-gate separately**: The two hooks are managed together by `addAmbientHook`/`removeAmbientHook`. A third ambient hook must be added to both (via `ensureHook`) and to the `hasAmbientHook` / `--status` partial-state detection, or it survives `--disable` as noise in settings.json.

**Matching a hook by substring, or re-implementing the check-then-push**: `h.command.includes(marker)` claims any user hook that mentions the word, and the old group-level filter then deleted every sibling in its matcher group (#391). Match with `endsWithAny` against `AMBIENT_HOOK_SUFFIXES` (or `devflowHookOwner` in other hook modules), register through `ensureHook`, and filter per hook with `removeHooks`.

## Gotchas

**DEVFLOW_BG_UPDATER guard must be first**: The re-entrancy guard appears before `hook-bootstrap` is sourced in every hook here, `session-start-context` included. This is load-order-critical: `hook-bootstrap` initializes per-project debug logging, which reads from `CWD`. Background sessions (memory worker's `claude -p`) must be silenced before any initialization runs, not after.

**Legacy cleanup runs unconditionally**: `removeLegacyCommandsRule()` is called by both `addAmbientHook` and `removeAmbientHook` whether or not hooks changed, so a stale `~/.claude/rules/devflow/commands.md` from a pre-charter install is purged even on an idempotent re-enable.

**`session-start-classification` is a stale marker**: The `AMBIENT_HOOK_SUFFIXES.classification` suffix (`/scripts/hooks/run-hook session-start-classification`) refers to a hook from a previous ambient design that no longer exists. Both `addAmbientHook` (via `removeHooks(settings, 'SessionStart', isClassification)`) and `removeAmbientHook` sweep it, so enable and disable are symmetric about classification-hook debris from pre-charter installs. Do not re-register it.

**The audit's channel was not observed live.** `systemMessage` is documented upstream as a warning shown to the user (`additionalContext` is the field that reaches Claude's context), but the page does not say per event whether SessionStart shows it and no live display was seen. If SessionStart discarded the field the failure would be silent; the `docs/reference/platform-assumptions.md` row records the drift symptom.

**Section 6 test plumbing.** The fork-count differentials in `tests/shell-hooks-tracker.test.ts` call `primeAuditStamp` first so Section 6 costs the same in baseline and measured runs; HOME-rooted-repo scaffolding checks treat the stamp as machine data; `tests/session-start-compact.test.ts` builds its PATH farms once per file, so a test that edits a farm wrapper must restore it.

**A plan handoff sends the plan once.** The hook directive and the charter bullet both invoke `devflow:implement` with no arguments. `/implement` binds its input once as `COMMAND_INPUT`; when that is empty (the handoff case) there is nothing to name the branch from and the Git agent sees none of the conversation, so the orchestrator writes a one-line task description itself, from the plan's title or the conversation, and sends it as the `setup-task` `TASK_DESCRIPTION`.

**The main thread loads no companion skills.** `/implement`, `/code-review`, `/debug` and `/plan` orchestrate and delegate, so their main threads load none; only `/release`, whose main thread drives git, loads one (`devflow:git`). `docs/reference/skill-catalog.md` keeps all five intent rows, "(none)" included, held to the compiled commands in both directions by `collectCompanionDrift` (`tests/skill-references.test.ts`). A `requires:` list in `DEVFLOW_PLUGINS` names only skills the plugin actually reads, and the closure guard rejects an unread entry.

**UserPromptSubmit may not fire for auto-injected plan handoff**: Whether Claude Code fires it for its own auto-injected "start-of-plan-session" prompt is an empirical unknown; the charter's SessionStart fallback bullet covers the gap, and the preamble fast-path handles explicit user-typed handoffs.

## Key Files

- `src/assets/scripts/hooks/preamble` — UserPromptSubmit hook: dispatch, plan-handoff fast-path, orchestrator reminder
- `src/assets/scripts/hooks/session-start-orchestrator` — SessionStart hook: charter read, size guard, injection log, additionalContext output
- `src/assets/scripts/hooks/assets/orchestrator-charter.md` — static charter (2,683 characters, ceiling 3,072): bounded-inline exception, kind-of-work routing, six operating rules; no decisions rule
- `src/assets/scripts/hooks/session-start-context` — always-on SessionStart hook: Section 1's pass rule after the `Index:` line, Section 5 (compact resume directive), Section 6 (import audit and stamp)
- `src/assets/scripts/claude-md-audit.cjs` — the audit: grammar, `MAX_HOPS`, thresholds, bounds, display gate, stamp format, framed hook output, upstream-agreement notes
- `src/core/claude-md-audit.ts` — typed facade over that script for `devflow init`
- `src/core/flags.ts` — the flag registry (31 flags), including the opt-in `auto-compact-window` and its decision comment
- `src/assets/scripts/hooks/json-parse`, `json-helper.cjs` — `json_session_output "$ctx" ["$msg"]` and its node twin `session-output`, `json_extract_cwd_field`, `json_prompt_output`
- `src/assets/scripts/hooks/git-marker` — `df_has_git_marker`, `df_is_project_root`, `df_no_symlink_below`, `df_file_below`; a PATH-shim fork counter holds the zero-fork claim (tests/shell-hooks-tracker.test.ts, TP-22)
- `src/cli/commands/ambient.ts` — `AMBIENT_HOOK_SUFFIXES`, `addAmbientHook`, `removeAmbientHook`, `convergeAmbientHooks` (init's step), `hasAmbientHook`, `createAmbientCommand` / `ambientCommand`; the shared `endsWithAny`, `removeHooks`, `ensureHook` live in `src/targets/claude-code/hooks.ts`
- `docs/commands.md` — "Orchestrator charter" line: keep in sync with the charter's routing
- `tests/agent-name-guards.test.ts` — charter integrity: the 3,072-character ceiling, bounded-inline, report-cap and no-argument-handoff shape guards, `collectCharterKnowledgeDefects`
- `tests/fixtures/ambient-templates.ts` — `HANDOFF_TEMPLATE` and `REMINDER_TEMPLATE`, shared by the shell and integration tests; `tests/fixtures/numeric-floors.json` holds the `charter-char-max` (3072) and `compact-directive-max-chars` (250) ceilings
- `tests/shell-hooks.test.ts` (preamble, session-start-orchestrator, the pass-rule pins and dual-backend envelope test), `tests/session-start-compact.test.ts` (Sections 5 and 6), `tests/core/claude-md-audit.test.ts` and `tests/init-claude-md-audit.test.ts` (the audit script including `MAX_HOPS`, init's step), `tests/guards/no-autocompact-pct-override.test.ts`, `tests/ambient.test.ts` and `tests/integration/ambient-activation.test.ts`

## Related

- Decision to pivot from detection-based to charter-based ambient mode
- Leave-the-end-state principle; the old keyword/3-marker detection was deleted clean, no tombstones
- Plan-handoff schema undocumented/mutable — match by prefix only; the `tests/fixtures/ambient-templates.ts` constants are full output strings, not detection substrings
- Feature knowledge: `learning-capture-system` — the memory worker fires UserPromptSubmit and SessionStart hooks too, and the `DEVFLOW_BG_UPDATER` re-entrancy guard is the coupling point; it also describes `session-start-context` Sections 1–4 and the decisions index the pass rule points at
- Feature knowledge: `tracker-feature` — Section 3 of `session-start-context`, the tracker setup directive that gates on `startup|clear`
- Feature knowledge: `dynamic-workflow-engine` — the bind-once `COMMAND_INPUT` convention that makes a no-argument plan handoff safe, and the guards that hold it
- Feature knowledge: `feature-knowledge-system` — how the entries the charter's Feature knowledge rule passes (Rules bullets, heading index) are written and consumed
- Feature knowledge: `installer-shadowing` — `composeScripts` copies `src/assets/scripts/` (including `claude-md-audit.cjs`) to `~/.devflow/scripts/`, and init and uninstall handle the stamp
- `docs/reference/hooks.md`, `docs/reference/platform-assumptions.md`, `docs/reference/claude-code-flags-probe.md` — prose reference for Sections 5 and 6, the `source`, `systemMessage` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` assumptions, and the flag probe
- `src/assets/scripts/hooks/hook-bootstrap`, `hook-log-init` — shared hook initialization (debug logging, per-project log paths) and the injection log sourced by the SessionStart hooks
