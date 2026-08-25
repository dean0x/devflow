# Changelog

All notable changes to Devflow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-08-25

### Added
- **Typed flag registry**: the flag surface is now a discriminated-union registry of 28 Claude Code flags — `boolean`, `enum`, `number`, and `string` kinds with per-flag validation, defaults, and display metadata. Eight new upstream-verified flags including `max-concurrent-subagents` (devflow default 40; upstream 20), `subagent-spawn-depth`, `workflow-size-guideline`, `goal-checkin-minutes`, `default-model`, `spellcheck`, and `enable-todo-tools`.
- **Flags editor TUI**: bare `devflow flags` on a TTY opens a full-keyboard settings-page editor rendering inline in the scroll buffer (no alt-screen), with effective-value display and per-flag hint blurbs. The agents view now runs on the same generic TUI shell.
- **Typed flags CLI**: `devflow flags --list/--status/--enable/--disable/--set/--unset` with input validation; `--enable/--disable` are boolean-only — non-boolean flags route through `--set`.

### Changed
- **Init seeding**: both init paths apply seeded flag values non-interactively — fresh installs get registry defaults; re-inits preserve existing values and adopt defaults only for newly added flags. The flags editor step was removed from the Advanced wizard.
- **`viewMode` folded into the registry** as the `view-mode` enum flag (`default|verbose|focus`); the `viewMode` settings key is written only when non-default. Old `flags: string[]` manifests heal in-reader on first read — no migration entry needed.

### Fixed
- **viewMode silently lost on re-init**: `resolveExistingViewMode` now runs before `stripFlags` in the settings apply block; the prior order stripped `viewMode` from settings before reading it (PF-015).
- **Published bin not executable**: `prepublishOnly` now sets the execute bit on `dist/cli.js` — the bin shipped as 0644, breaking npm 6 and constrained environments (Docker non-root users, some CI runners) that do not auto-chmod on install.

### Breaking Changes
- **Bare `devflow flags` on non-TTY** now prints a status table and exits 1 (was: usage line, exit 0). Scripts should call `devflow flags --status`.
- **Seven settings.json/env keys become Devflow-managed**: `ANTHROPIC_DEFAULT_MODEL`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`, `CLAUDE_CODE_ENABLE_TODO_TOOLS` (env); `workflowSizeGuideline`, `spellcheck` (settings). Hand-set values are preserved — adopted into the manifest on the next `devflow init` or flags mutation; `max-concurrent-subagents` adopts the devflow default of 40 only when the key is absent. All keys are removed on `devflow uninstall`.

---

## [2.0.1] - 2026-08-23

### Changed
- **Release workflow hardening**: the version-bump commit stages `package.json`, `package-lock.json`, and `CHANGELOG.md` explicitly instead of `git add -A` (the 2.0.0 release committed the `release-notes.md` CI artifact this way; the file is now also gitignored), and `actions/checkout`/`actions/setup-node` are bumped v4 → v7 to clear the Node 20 runtime deprecation.
- **npm tarball changelog**: the bundled CHANGELOG.md now carries the corrected 2.0.0 section (the 2.0.0 tarball predated the release-notes fix).

### Fixed
- **`bump-version.ts` stale-header guard**: the script treated any pre-existing `## [{version}]` header as "already bumped" and skipped stamping `[Unreleased]` — which is how the 2.0.0 release initially shipped an aborted April bump's section as its release notes. It now fails loudly when a `## [{version}]` header coexists with a non-empty `[Unreleased]` section, and only skips when `[Unreleased]` is empty.

---

## [2.0.0] - 2026-08-23

### BREAKING CHANGES

#### Agent rename — 13 agents renamed to action-verb form

All 13 non-immutable devflow agents have been renamed from noun form to
action-verb form. The three unchanged agents are `git`, `knowledge`, and
`learning`.

| Old name (Form A slug) | New name (Form A slug) | Old Form B (`name:`) | New Form B (`name:`) |
|------------------------|------------------------|----------------------|----------------------|
| `coder`       | `code`      | `Coder`       | `Code`      |
| `designer`    | `design`    | `Designer`    | `Design`    |
| `evaluator`   | `evaluate`  | `Evaluator`   | `Evaluate`  |
| `researcher`  | `research`  | `Researcher`  | `Research`  |
| `reviewer`    | `review`    | `Reviewer`    | `Review`    |
| `scrutinizer` | `scrutinize`| `Scrutinizer` | `Scrutinize`|
| `simplifier`  | `simplify`  | `Simplifier`  | `Simplify`  |
| `skimmer`     | `skim`      | `Skimmer`     | `Skim`      |
| `synthesizer` | `synthesize`| `Synthesizer` | `Synthesize`|
| `tester`      | `test`      | `Tester`      | `Test`      |
| `triager`     | `triage`    | `Triager`     | `Triage`    |
| `validator`   | `validate`  | `Validator`   | `Validate`  |
| `bug-analyzer`| `diagnose`  | `BugAnalyzer` | `Diagnose`  |

**What devflow migrates automatically:**
- All devflow-owned agent files (`~/.claude/agents/devflow/`), command
  sources (`~/.claude/commands/devflow/`), and skill files are
  updated on `devflow init`. No manual action needed for devflow's own
  files.
- `agent-models.json` key migration: old slug keys in
  `~/.devflow/agent-models.json` (e.g. `coder`, `reviewer`) are
  rewritten to their canonical new form (e.g. `code`, `review`) both on
  read by `readAgentMapping` and by the one-time global migration
  `canonicalise-agent-keys-v1` that runs on the first `devflow init`
  after this upgrade.

**What you must migrate by hand:**
- Any `subagent_type` values in your **own** custom commands or agents
  that reference the old Form B names (`Coder`, `Reviewer`, etc.) must
  be updated by you — devflow cannot migrate files it does not own. For
  example: `agentType: "Coder"` → `agentType: "Code"`.
- Any references to old agent names in your **own** CLAUDE.md or project
  files — devflow never edits your CLAUDE.md.

**Downgrade warning — per-agent model overrides stop silently:**
If you upgrade to this version and then **downgrade** to a prior devflow
version, any per-agent model overrides saved under the new canonical key
names (e.g. `code`, `review`) will silently stop applying — the older
version does not know the new names and will not find the override
entries. Retroactive version-detection is impossible: `readAgentMapping`
never reads the `version` field from `agent-models.json`, and a test
pins that behaviour. There is no mechanism that could warn you. If you
downgrade, verify your overrides with `devflow agents --list`.

**Open-session warning:**
A Claude Code session left **open across the upgrade** holds a stale
orchestrator charter that still names the old agents. Restart any open
session after running `devflow init` so the new charter is injected.

**Claude Code built-in name collision check:**
The new agent names were verified against the Claude Code built-in
`subagent_type` registry (checked 2026-08-18). The Claude Code built-in
agent types are `Explore` and `Plan`. None of the 13 new devflow names
(`code`, `design`, `evaluate`, `research`, `review`, `scrutinize`,
`simplify`, `skim`, `synthesize`, `test`, `triage`, `validate`,
`diagnose`) collide with either. Note: `Plan` is a Claude Code built-in;
devflow has no `plan` agent (only a `/plan` command).
**Re-check on each major Claude Code upgrade** — a new built-in can
silently shadow a devflow agent and no in-repo guard can detect it.

#### `/dynamic-wave` command removed

The thin full-pipeline driver command is removed. Run the three stages directly:

```
/dynamic-tickets <initiative>   # 1. decompose initiative into tickets
/dynamic-plan <ticket-dir>      # 2. plan + challenge each ticket
/dynamic-build <ticket-dir>     # 3. implement, review, and verify
```

The `post-wave-report` Git-agent spawn that `/dynamic-wave` formerly handled is
now owned by `/dynamic-build`, which also owns `.devflow/docs/waves/{slug}/`
output. The stale installed command file is removed automatically by the orphan
sweep on the next `devflow init`.

#### Single-pass review in `/dynamic-build`

The review pass now runs exactly **once** per ticket. The following context
variables and machinery are removed: `maxCycles`, `reviewBaseSha`, `preFixSha`,
`cyclesRun`, `fixedInCycle`, and DELTA REVIEW. Fix commits are covered by the
fixing Code agent's self-verification and the final Gate 1 #2.

**Custom MDS host migration**: the `review_loop` export in `_engine.mds` is
renamed `review_pass`. Any custom MDS host that imports `_engine.mds` and calls
`{review_loop()}` must update the call site to `{review_pass()}`.

### Added
- **External model routing** (`devflow proxy --enable/--disable/--status`): Routes Devflow agents through GPT models (via an OpenAI/Codex subscription) using a local relay that intercepts Claude Code's model requests by injecting `ANTHROPIC_BASE_URL` into `settings.json`. `--enable` runs a four-check preflight in order — ① relay binary resolvable from Devflow's `node_modules`, ② Codex auth present at `~/.codex/auth.json`, ③ target port free or already occupied by a Devflow relay (adopted path skips spawn), ④ `settings.json` parseable with no foreign `ANTHROPIC_BASE_URL` — then spawns the relay with a 50×100ms bounded probe loop, then runs a post-spawn doctor verification gate; on doctor failure the relay is killed (self-spawned only — an adopted relay is never killed) and the enable rolls back. `--disable` strips `ANTHROPIC_BASE_URL` from `settings.json`, reverts installed agent frontmatter to Claude defaults, and emits a `kill <pid>` hint; the relay process is intentionally left running for in-flight sessions. `--status` shows relay identity, port, Codex auth content (expiry and account, not just file existence), external-mapped agent count, and the cached routable model registry. The `ensure-proxy` hook (registered on both `SessionStart` and `UserPromptSubmit`) auto-revives a down relay at session start; the `UserPromptSubmit` path exits before any proxy-state I/O to avoid per-prompt overhead. Feature state is manifest-gated (`manifest.features.proxy`); runtime authority lives in `~/.devflow/proxy.json`. Default OFF; Advanced init only. New dependency: `subswitch@0.2.0` (exact-pinned). **Upgrade**: run `devflow init` (Advanced path) to configure, or `devflow proxy --enable` after install.
- **Per-agent model and effort configuration** (`devflow agents`): Interactive TUI and CLI (`--list`, `--set <agent> --model <model>`, `--set <agent> --effort <level>`, `--reset`) for assigning models and effort levels to individual Devflow agents. Overrides are stored deviations-only in `~/.devflow/agent-models.json`; absent entries resolve to shipped defaults read live from agent source files. The routable model catalog is discovered live from the relay binary and cached at `~/.devflow/cache/models/` (24h TTL, at most 3 versioned entries keyed by runtime version, stale entries serve as fallback on discovery failure) — there is no hardcoded model list. Model aliases (e.g. `sol`, `terra`, `luna`) auto-track current model generations. GPT model assignments are **dormant** while routing is disabled — saved to disk but not materialized into agent frontmatter until `devflow proxy --enable`. Effort overrides (`low`/`medium`/`high`/`xhigh`/`max`) are orthogonal to dormancy and apply regardless of proxy state. `reapplyAgentMapping` re-applies all saved overrides after every `devflow init` so customizations survive reinstalls.
- **Ambient mode — orchestrator charter + plan handoff** (BREAKING): Two-hook orchestrator system replaces both old ambient detection paths (first-word keyword dispatch and 3-marker plan detection). A `SessionStart` hook (`session-start-orchestrator`) injects a static ~200-token charter establishing the main model as a pure orchestrator, grading sub-agents by complexity. A `UserPromptSubmit` hook (`preamble`) handles three cases: prompts beginning `Implement the following plan:` auto-run `devflow:implement`; slash commands are silenced; all other prompts get a 2-line orchestrator reminder. Both hooks are silent outside git repos. A sourced `git-marker` helper provides a pure-bash bounded upward walk (64 levels, no subprocess). **Upgrade**: run `devflow init` to register the new `session-start-orchestrator` hook.
- **`agent-teams` Claude Code flag**: bespoke Agent Teams machinery removed; teammate-mode enablement now via the optional `agent-teams` flag (`devflow flags --enable agent-teams`), which sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. The flag defaults to OFF.
- **Triager agent** (opus, blast-radius judgment): dedicated validation-only agent that classifies every review issue using a first-match-wins disposition matrix — SECURITY GATE → FALSE_POSITIVE → BY_DESIGN → FIX_NOW → FIX_SEPARATE → TECH_DEBT / ESCALATED — before any Coder touches code. Reads 30-line context around each reported file:line to verify issues; requires file:line evidence for FALSE_POSITIVE and an ADR or inline comment citation for BY_DESIGN. Never edits code.
- **Coder `issue-fix` mode** for `/resolve`: Coder receives pre-classified FIX_NOW issues from the Triager and applies fixes without re-litigating dispositions (`OPERATION: issue-fix`, `PUSH: false`). A `validation-fix` mode handles Validator gate failures; a `ci-fix` mode handles CI failures.
- **Verification Gate** in `/resolve` Phase 7: Validator (haiku) runs build/typecheck/lint/test against changed files; up to 2 Coder validation-fix retries on FAIL; single `git push` fires at the end of this gate (pass or fail) — never before.
- **New `resolution-summary.md` sections**: `## Decisions Citations`, `## By Design`, `## Fix Separately`, `## Escalations`, `## Verification` — all strictly additive over the existing convergence-parser contract (`## Fixed Issues`, `## False Positives` headings and Statistics table rows unchanged). The Triage agent aggregates cited ADR-NNN/PF-NNN IDs from its reasoning column into `## Decisions Citations`; the section is omitted when no citations were made.
- **Rules shadow CLI** (`rules shadow <name>` / `rules unshadow <name>` / `rules list`): shadow a rule with your own version (seeded from the installed rule or built plugin source as fallback), remove a shadow override, and list all known rules with install status and shadow state.
- **Install-report shadow warnings on `devflow init`**: invalid shadows (missing `SKILL.md`, empty rule file, or a directory at the shadow path) are surfaced in the post-install summary without failing init.
- **PR-comment publication gate (D10) and secret scrubber (D11)** for `/code-review` and `/resolve`: Summary comments posted to GitHub are now visibility-gated and secret-scrubbed unconditionally. D10 — the Git agent probes `gh repo view --json visibility` before posting; `PRIVATE` or `INTERNAL` repos receive the full report, everything else (including `PUBLIC`, command error, or unauthenticated) receives a counts-only stub. Fail-closed: any probe error defaults to STUB, never FULL. Configurable via `reviewPublication: auto|full|off` in `.devflow/config.json` (no CLI subcommand; default `auto`). D11 — every body posted to GitHub passes `redact-secrets.cjs` (installed at `~/.devflow/scripts/`) before being sent; the scrubber runs unconditionally, regardless of visibility mode, compliance config, or `reviewPublication` value. If the scrubber exits non-zero or is missing, the post is suppressed and `TRACEABILITY: DEGRADED (redaction unavailable)` is reported — the post never fires. **Stale-install note**: with a `~/.devflow` directory installed before this version (no `redact-secrets.cjs` present), all posting ops report DEGRADED and post nothing; re-run `devflow init` to install the scrubber and restore posting.

- **Compliance wizard step in both init paths** (`src/cli/commands/compliance-prompts.ts`): The compliance framework selection step now runs in **both** the Advanced and Recommended init paths (previously Advanced-only). `shouldRunComplianceStep` gates the step: Advanced always runs it; Recommended only runs it when the mode-select prompt actually fired (`modePromptShown=true`), so `--recommended` and non-TTY invocations remain promptless. The step shows a "Current setting:" note for re-init legibility, uses `p.select` (Yes/No) instead of a `p.confirm` to eliminate Enter-through ambiguity, and emits an outcome line after each answer. Framework-selection prompt choices and the multiselect message are now shared from `compliance-prompts.ts` between `init.ts` and `compliance.ts` (extracted from both). The `--compliance`/`--no-compliance` CLI flags bypass the wizard entirely when passed. The injectable `CompliancePromptIO` seam (mirrors `ProxyPreflightDeps`) enables unit tests to drive all step branches without a real TTY.

- **Dynamic compliance composition** (`src/core/compliance-compose.ts`): The compliance skill (`devflow:compliance/SKILL.md`) and compliance rule are now composed at install time from per-framework fragment files (`src/assets/skills/compliance/frameworks/{id}/fragment.md`) rather than being installed as static all-six blobs. Each fragment provides `## Mapping` (6-column control row), `## Reference` (reference-table blurb), `## Checklist` (0–2 items), and `## Rule` (one ≤200-char bullet) sections that populate 5 SKILL.md tokens (`SCOPE`, `ACTIVE`, `MAPPING`, `CHECKLIST`, `REFERENCES`) and 1 rule token (`RULE_BULLETS`). The existing `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` rule placeholder is retained as a second token and handled by the existing `stampComplianceRule`. Installed artifact layout is unchanged — `references/{id}.md` basenames are preserved even though source files moved to `frameworks/{id}/reference.md`. Shadow SKILL.md without composition tokens passes through byte-identical (C1 passthrough); `devflow compliance --status` now shows `[shadowed, composition skipped — per-framework sections absent]` for such shadows (and `[shadowed]` for shadows that do contain tokens). The `--status` Skill line shows `[shadowed]` when a shadow with tokens is present.

- **`devflow:explore` skill** — structured codebase exploration with optional knowledge-base creation

### Changed
- **`devflow skills list-shadowed` renamed to `devflow skills list`** (BREAKING): `skills list` now shows all known skills with install and shadow state via `validateSkillShadow`. The `list-shadowed` subcommand is removed.
- **`/resolve` pipeline split** (BREAKING): the monolithic Resolver agent (which both validated and fixed issues) is replaced by a Triage + Code pair. The Triage agent (opus) runs a blast-radius disposition pass; the Code agent (sonnet, `OPERATION: issue-fix`) applies fixes. Plugins that declared the `resolver` agent must update their agent list to `[git, triage, code, simplify, validate]`.
- **`devflow init` (Advanced path)**: A proxy prompt (external model routing, default OFF) is now offered after the Claude Code flags selector. On enable during init, the same four-check preflight runs but no relay is spawned and no doctor runs — the first session's `ensure-proxy` hook starts the relay; preflight failure warns and forces proxy off without aborting init. `reapplyAgentMapping` now runs after every post-install file-copy to re-apply saved agent model overrides to freshly installed agent files.
- **`devflow uninstall`**: Now removes proxy artifacts on uninstall — `ensure-proxy` hook registrations, `ANTHROPIC_BASE_URL` from `settings.json`, and the model discovery cache (`~/.devflow/cache/models/`) — in addition to standard command/agent/skill/rule removal.
- **Knowledge index + on-demand Read pattern across all knowledge-consuming commands**: `/resolve`, `/plan`, `/self-review`, `/code-review`, and `/debug` (plus ambient orch equivalents `resolve:orch`, `plan:orch`, `review:orch`, `debug:orch`) now fan a compact index instead of the full ADR/PF corpus. Downstream agents (`triage`, `design`, `simplify`, `scrutinize`, `review`) Read full entry bodies on demand via `devflow:apply-decisions` and `devflow:apply-feature-knowledge`. For `/debug`, knowledge stays orchestrator-local (hypothesis generation) and is not fanned to Explore investigators. Unified placeholder convention: all 11 invocation sites use `"{worktree}"`. Closes PF-011 and fills pre-existing ambient gaps for plan:orch, review:orch, and debug:orch. Token savings: ~75K/run at 10 resolvers with current corpus; scales as O(1) instead of O(entries × agents) as corpus grows.
- **Multi-cycle review loop in `/dynamic-build`** (BREAKING): the review pass now runs exactly once per ticket. `maxCycles`, `reviewBaseSha`, `preFixSha`, `cyclesRun`, `fixedInCycle`, and DELTA REVIEW machinery are removed; the `review_loop` MDS export is renamed `review_pass` (custom MDS hosts importing `review_loop` must update the call site). Fix commits are covered by the fixing Code agent's self-verification and the final Gate 1 #2. See Breaking Changes for the migration path.
- **Learning**: Moved from Stop → SessionEnd hook with 3-session batching (adaptive: 5 at 15+ observations)
- **Learning**: Raised procedural thresholds from 2 to 3 observations with 24h+ temporal spread for both types
- **Learning**: Reduced default `max_daily_runs` from 10 to 5
- **Learning**: Renamed artifact paths: `commands/learned/` → `commands/self-learning/`, `skills/learned-{name}/` → `skills/{name}/`
- **Learning**: Skill artifacts now include `user-invocable: false`, Iron Law section, and `self-learning:` name prefix

- **State-aware re-init** (`devflow init`): re-running init now reads the prior manifest, feature config, and `settings.json` and pre-seeds every prompt with your existing choices — your installed plugin set, feature toggles, Claude Code flags, and view mode are preserved instead of reset to defaults. The Recommended/Advanced question is skipped entirely on re-init. Use `--reset` for a factory reset that ignores all prior state (mutually exclusive with `--plugin`).
- **`self-review` skill** renamed to `quality-gates`

### Removed
- **`/dynamic-wave` command** (BREAKING): the thin full-pipeline driver is removed. Run the three stages directly: `/dynamic-tickets` → `/dynamic-plan` → `/dynamic-build`. The `post-wave-report` Git-agent spawn moved into `dynamic-build`, which now owns `.devflow/docs/waves/{slug}/` output. The stale installed command file is removed automatically by the orphan sweep on the next `devflow init`. See Breaking Changes for the migration path.
- **`devflow-audit-claude` plugin and `/audit-claude` command** (BREAKING): The CLAUDE.md audit plugin is removed. `--plugin=audit-claude` is now rejected by `devflow init`; stale `devflow-audit-claude` entries in existing manifests are silently pruned by `DELETED_PLUGIN_NAMES` on the next partial reinstall. The `claude-md-auditor` agent and `audit-claude.md` command are deleted; the orphan sweep removes any previously installed copies automatically.
- **Non-selectable optional carry mechanism**: `resolveNonSelectableOptionalCarry` and `applyNonSelectableCarry` deleted from `init-seed.ts`. The carry was guarding a now-impossible state (the only non-selectable optional plugin was `devflow-audit-claude`). A structural invariant test (`EXCLUDED ∩ optional === ∅`) ensures this state stays impossible. No behavior change for users.
- **1.x migration registry and helper modules** (BREAKING): all 20 run-once 1.x upgrade migrations removed from `MIGRATIONS`; helper modules `legacy-decisions-purge.ts`, `decisions-ledger-migration.ts`, `marketplace-cleanup.ts`, and `mkdir-lock.ts` deleted. The migration framework stays for future 2.x entries. No 1.x → 2.0 upgrade path.
- **Native `claude plugin install` path** (BREAKING): the `claude plugin install` code path is removed; `installViaFileCopy` (file copy) is the sole install mechanism for all Devflow assets.
- **`extraKnownMarketplaces` registration from settings template**: the Devflow marketplace entry is no longer written to `~/.claude/settings.json` on install.
- **SHADOW_RENAMES migration machinery**: the `SHADOW_RENAMES` constant and associated migration logic for renaming skill shadow directories are removed; no active renames remain.
- **Agent Teams init flags** (BREAKING): `--teams` / `--no-teams` flags removed from `devflow init`. Projects that were using Devflow-managed `teammateMode: "auto"` will have that setting cleaned up automatically on the next `devflow init` or `devflow uninstall` run.
- **Resolver agent**: retired in favor of the Triage + Code split. The `resolver` agent file is removed from installs on `devflow init` by the orphan sweep.

- **`implementation-patterns` skill** (merged into `patterns`)
- **`search-first` skill** (merged into `research`)

### Fixed
- **`devflow agents` TUI — four defects fixed**:
  - **Fix 1 (alias rendering)**: GPT model aliases (`sol`, `terra`, `luna`) previously rendered with a parenthetical canonical-id annotation (`sol (gpt-5.6-sol)`). The picker cycle is now built from `pickerNames(catalog.models)` — aliases only; canonical id only when a model has no aliases. Aliases render bare. Stored canonical ids (e.g. `gpt-5.6-sol` saved via `--set`) are normalized to their alias on read by `buildPickerNameMap` — no disk write. `catalog.aliasToId` is no longer referenced in `render.ts`.
  - **Fix 2 (inertness at selection time)**: `mergeTuiRowsIntoMapping` extracted from `applyTuiSave` as an exported pure helper — only dirty rows modify the mapping (inertness guarantee). `rowState(row, proxyEnabled)` added to `state.ts` as a single source of truth for TUI row state. Save outro wording aligned with `--set` output (dropped "Saved. " prefix).
  - **Fix 3 (install state + orphan visibility)**: `AgentRow` and `InitRowInput` gain required `installed` and `inRegistry` fields. `buildTuiState` calls `readInstalledAgentNames` (one `readdir`, no per-agent `fs.access`) and appends orphan rows — arbitrary keys from `agent-models.json` not present in the registry — with `inRegistry: false`. A 4th **STATE** column is added to the TUI frame (AGENT 18, MODEL 32, EFFORT 13, STATE 14 = 79 ≤ 80), showing `active` / `saved-inactive` / `not installed` / `unknown`. `stripAnsi(row.name)` is mandatory before name-cell rendering to prevent ANSI injection via hostile JSON keys.
  - **Fix 4 (capitalized names)**: `formatAgentName` added to `render.ts` with exactly ONE call site — title-cases each hyphen-separated segment of the agent name for TUI display only (e.g. `bug-analyzer` → `Bug-Analyzer`). `--list` output remains lowercase because the AGENT column is an identifier users copy into `--set`, which exact-matches.
- **Learning**: reject observations with empty id/type/pattern fields
- **Learning**: Handle string-typed `.message.content` in transcript extraction (was only handling arrays)
- **Learning**: Eliminate empty-array loop noise when Sonnet returns no observations
- **Learning**: Race condition in batch file handoff (atomic `mv` replaces `cp`+`rm`)
- **Learning**: `--enable` now auto-upgrades legacy Stop hook to SessionEnd
- **Learning**: `--status` detects legacy hook and shows upgrade instructions

---

## [1.8.3] - 2026-03-22

### Fixed
- **HUD**: version upgrade notice persists after install — cache now stores only npm `latest`, reads installed version live

---

## [1.8.2] - 2026-03-22

### Fixed
- **Ambient mode**: skills not loading despite correct classification — reordered instructions so Skill tool invocations happen before any text output

---

## [1.8.1] - 2026-03-22

### Changed
- **Init wizard**: individual feature prompts with explanatory notes replace extras multiselect
- **Init wizard**: scope-aware `.claudeignore` batch install across all discovered projects (user scope)
- **Init wizard**: project discovery via `~/.claude/history.jsonl` to find all Claude-used git repos
- **Init wizard**: managed settings sudo confirmation moved to prompt phase (before spinner)
- **Init wizard**: safe-delete prompt moved to prompt phase for uninterrupted install

### Added
- `--hud` flag for `devflow init` to explicitly enable HUD
- `discoverProjectGitRoots()` utility for finding projects from Claude history

### Removed
- Extras multiselect (`buildExtrasOptions`) — replaced by individual feature prompts

---

## [1.8.0] - 2026-03-22

### Added
- **Configurable HUD** replacing bash statusline — 14 components, on/off model (#155)
- **HUD components**: directory, git branch, ahead/behind, diff stats, release info, worktree count, model, context usage, version badge, session duration, session cost, usage quota, todo progress, config counts
- **`--hud-only` flag** for standalone HUD install
- **`--no-hud` flag** to skip HUD during init
- **`devflow hud` command** (--status, --enable, --disable, --detail, --no-detail)
- **Version upgrade notification**: `✦ Devflow vX.Y.Z · update: npx devflow-kit init` (yellow, always visible even when HUD disabled)
- **Skill shadowing docs** and HUD options added to README (#156)
- **Simplifier agent** — 8 structured slop detection categories (#120)
- **Scrutinizer agent** — stub detection patterns with reference file (#121)
- **Shepherd agent** — goal-backward verification, artifact depth checking, stub type, re-verification (#124)

### Changed
- Init flow: HUD preset picker (5 options) → simple yes/no confirm
- `--disable` keeps statusLine registered (version badge still renders)
- Manifest `features.hud` field: `string|false` → `boolean`

### Fixed
- HUD base branch detection matching raw commit hashes from reflog (#156)
- HUD comparing main vs main (0/0 always) — now compares against origin/main

### Removed
- HUD preset system (minimal/classic/standard/full)
- `--configure`, `--preset`, `--hud <preset>` flags
- `speed`, `tool-activity`, `agent-activity` components

---

## [1.7.0] - 2026-03-20

### Added
- **Version update notification** — statusline shows magenta `⬆ X.Y.Z` badge when newer devflow-kit is available (24h cached npm check, fully async)

### Fixed
- **Skimmer agent** — enforce rskim usage via `tools: ["Bash", "Read"]` platform restriction and strict sequential workflow; prevents fallback to Grep/Glob
- **Init multiselect** — remove redundant "(optional)" suffix from plugin hints
- **Init multiselect** — hide `audit-claude` plugin (not production-ready; still installable via `--plugin=audit-claude`)
- **Statusline portability** — replace macOS-only `stat -f %m` with portable `get_mtime()` helper (macOS + Linux)

---

## [1.6.1] - 2026-03-20

### Added
- **`--dry-run` flag** for `devflow uninstall` — preview removal plan without deleting anything

### Fixed
- **Ambient skill loading** — removed `allowed-tools` restriction from ambient-router so skills actually load via the Skill tool
- **Ambient hook preamble** — explicit Skill tool instruction ensures models invoke skills rather than responding directly
- **Init wizard** — hide `devflow-ambient` from plugin multiselect (auto-included via ambient prompt)
- **Working memory** — replaced broken `--resume` with transcript-based background updater

---

## [1.6.0] - 2026-03-19

### Added
- **Ambient agent orchestration**: ORCHESTRATED tier spawns agent pipelines for IMPLEMENT, DEBUG, PLAN intents
- **Orchestration skills**: `implementation-orchestration`, `debug-orchestration`, `plan-orchestration` for ambient agent pipelines
- **`knowledge-persistence` skill** (#145) — extraction procedure, lock protocol, loading instructions for project knowledge
- **Knowledge loading phase** (#145) — `/debug`, `/specify`, `/self-review` now load project knowledge at startup
- **Pitfall recording phase** (#145) — `/code-review`, `/resolve` record pitfalls to `.memory/knowledge/pitfalls.md`
- **Knowledge directory** (#145) — `.memory/knowledge/` with `decisions.md` (ADR-NNN, append-only) and `pitfalls.md` (area-specific gotchas)

### Changed
- **Ambient mode**: Three depth tiers (QUICK/GUIDED/ORCHESTRATED) replacing old QUICK/GUIDED/ELEVATE
- **Ambient mode**: GUIDED tier for small-scope IMPLEMENT (≤2 files), simple DEBUG, focused PLAN, and REVIEW — main session with skills + Simplifier
- **Ambient mode**: BUILD intent renamed to IMPLEMENT for clarity
- **Coder agent**: Added `test-driven-development` and `search-first` to permanent skills
- **Command phase numbering** (#145) — renumbered fractional phases to sequential integers across 12 command files

### Fixed
- **Agent metadata** (#146) — fixed `subagent_type` in debug, added missing YAML frontmatter
- **Plugin count** (#146) — corrected to "8 core + 9 optional"
- **Skills catalog** (#146) — cataloged 3 missing skills in reference
- **Debug command** (#147) — removed non-standard `name=` parameter
- **Plugin descriptions** (#147, #148) — synced across plugin.json, plugins.ts, marketplace.json
- **Simplifier agent** (#148) — added Output/Boundaries sections
- **Plugin metadata** (#148) — added homepage/repository/license/keywords to 3 plugins

### Removed
- **`/ambient` command**: Ambient mode is now hook-only. Use `devflow ambient --enable` to activate.

### Behavioral Changes
- EXPLORE intent now always classifies as QUICK (was split QUICK/GUIDED)
- Simple text edits ("Update the README") classify as QUICK (was BUILD/GUIDED)
- Debug agent budget cap removed — agents scale to investigation needs

---

## [1.5.0] - 2026-03-13

### Added
- **Search-first skill** (#111) — New skill enforcing research before building custom utility code. 4-phase loop: Need Analysis → Search (via Explore subagent) → Evaluate → Decide (Adopt/Extend/Compose/Build)
- **Reviewer confidence thresholds** (#113) — Each review finding now includes a visible confidence score (0-100%). Only ≥80% findings appear in main sections; lower-confidence items go to a capped Suggestions section. Adds consolidation rules to group similar issues and skip stylistic preferences
- **Version manifest** (#91) — Tracks installed version, plugins, and features in `manifest.json`. Enables upgrade detection during `devflow init` and shows install status in `devflow list`

### Fixed
- **Synthesizer review glob** — Fixed `${REVIEW_BASE_DIR}/*-report.*.md` glob that matched zero reviewer files; now uses `${REVIEW_BASE_DIR}/*.md` with self-exclusion

---

## [1.4.0] - 2026-03-09

### Added
- **Smart branch naming** — `/implement #42` auto-derives branch names from issue labels and title (e.g., `feature/42-add-jwt-auth`); free-text tasks infer type from keywords (e.g., `/implement fix login bug` → `fix/login-bug`)

### Fixed
- **Code review file detection** — Corrected file detection and skill check logic in `/code-review`

### Changed
- **Author standardization** — Unified author name to Dean0x across marketplace and plugin manifests

---

## [1.3.3] - 2026-03-09

### Changed
- **Sudo trust prompt** — Managed settings now shows a clear explanation, a copy-pasteable verification prompt, and an explicit fallback option before any password prompt

### Added
- **Managed settings test coverage** — Unit tests for `installManagedSettings` two-stage write logic

---

## [1.3.2] - 2026-03-08

### Changed
- **Init prompt improvements** — Agent Teams marked as experimental with recommendation to disable; ambient mode now defaults to enabled (recommended)
- **Init flags documented** — Added `--ambient`/`--no-ambient` and `--memory`/`--no-memory` to README

---

## [1.3.1] - 2026-03-08

### Fixed
- **Background memory updater silent Write failures** — Added Read permission for memory files (Claude Code enforces Read-before-Write), read-only git commands for fresh context, mtime validation to detect silent failures, and stdout logging for debugging

---

## [1.3.0] - 2026-03-08

### Added
- **Skill shadowing** — `devflow skills shadow <name>` copies a skill for personal overrides
  - `devflow skills unshadow <name>` restores the original
  - `devflow skills list-shadowed` shows active overrides
  - Shadowed skills are preserved during `devflow init` (not overwritten)
  - Uninstall warns about remaining shadow files
- **Cross-platform hook wrapper** — `run-hook` polyglot entry point for Windows compatibility
  - Discovers bash on Windows (Git Bash, WSL, MSYS2) via standard paths
  - All hook scripts renamed to drop `.sh` extension
- **Ambient skill injection at session start** — `session-start-memory` hook injects `ambient-router` SKILL.md directly into context
  - Eliminates the need for a Read tool call to load the ambient router
  - Only activates when ambient mode is enabled
- **Skill activation integration tests** — `vitest.integration.config.ts` + helpers for live classification tests
  - Separate `npm run test:integration` for tests requiring `claude` CLI

### Changed
- **Ambient depth labels renamed** — STANDARD→GUIDED, ESCALATE→ELEVATE for clarity
  - GUIDED: skills guide the response; ELEVATE: elevate to a full workflow
- **Hook commands use `run-hook` dispatch** — Settings template and CLI now register hooks via `run-hook <name>` instead of direct `.sh` paths
- **`devflow init` auto-upgrades hook format** — Removes old `.sh`-style hooks before re-adding, ensuring existing installs migrate seamlessly
- **Skill descriptions audited** — All 12 review-only skills updated to trigger-format (`"This skill should be used when..."`)
- **Skills architecture docs** — Added description rules section with good/bad examples
- **`chmod` skipped on Windows** — `chmodRecursive` no longer runs on `win32` platform

### Fixed
- **Ambient preamble missing skill path** — Hook now tells Claude to `Read` skills from `~/.claude/skills/<name>/SKILL.md`
- **Ambient `--status` hook path parsing** — Handles `run-hook <name>` format instead of assuming direct `.sh` path

---

## [1.2.0] - 2026-03-05

### Added
- **Polyglot language skills** — Go, Java, Python, and Rust skill plugins with comprehensive patterns
  - Go: error handling, interfaces, concurrency (errgroup, worker pools, fan-out/fan-in)
  - Java: records, sealed classes, streams, composition over inheritance
  - Python: type hints, protocols, dataclasses, async patterns
  - Rust: ownership, error handling (`thiserror`/`anyhow`), type system, concurrency
  - Skills: 26 → 30, Plugins: 9 → 17
- **Optional plugin architecture** — Language/ecosystem plugins (`optional: true`) not installed by default
  - Install selectively: `devflow init --plugin=go --plugin=python`
  - Existing skills (typescript, react, accessibility, frontend-design) moved to optional plugins
  - `devflow-core-skills` no longer bundles language-specific skills
- **Conditional language reviews** in `/code-review` command
  - Spawns language-specific Reviewer agents when matching files are in the diff
  - Skill availability check: skips review if optional plugin not installed
- **Dynamic skill loading in Coder agent** — Reads language skills at runtime based on DOMAIN hint instead of static frontmatter dependencies

### Changed
- **`devflow-core-skills`** no longer includes typescript, react, accessibility, or frontend-design skills (moved to optional plugins)
- **Coder agent** frontmatter trimmed from 14 skills to 6 core skills; language skills loaded dynamically

### Fixed
- **Deprecated `grpc.WithInsecure()`** in Go concurrency examples → replaced with `grpc.WithTransportCredentials(insecure.NewCredentials())`
- **Deprecated `datetime.utcnow`** in Python dataclass example → replaced with `datetime.now(timezone.utc)`
- **SQL injection** in Python async streaming example → replaced raw query with parameterized query
- **Deprecated `<Context.Provider>`** in React examples → replaced with `<Context>` (React 19+)
- **Deprecated `useRef<T>()`** without argument in React patterns → replaced with `useRef<T | undefined>(undefined)` (React 19+)
- **Non-portable `NodeJS.Timeout`** in TypeScript debounce/throttle → replaced with `ReturnType<typeof setTimeout>`
- **Unsafe `Function` type** in TypeScript type guard → replaced with `(...args: unknown[]) => unknown`
- **Go test file exclusion** removed from go skill activation (test files are valid Go code)

---

## [1.1.0] - 2026-03-04

### Added
- **Ambient mode** — New `devflow-ambient` plugin with `/ambient` command for proportional quality enforcement
  - Intent classification (BUILD/DEBUG/REVIEW/PLAN/EXPLORE/CHAT) auto-loads relevant skills
  - Three depth tiers: QUICK (zero overhead), GUIDED (2-3 skills), ELEVATE (nudge to workflows)
  - Always-on mode via `devflow ambient --enable` or `devflow init --ambient`
  - New `ambient-router` skill for intent/depth classification
  - New `test-driven-development` skill (auto-activates for BUILD tasks)
  - Skills: 24 → 26, Plugins: 8 → 9
- **Working memory enhancements** — Structured cross-session context preservation
  - Structured sections: Now, Progress, Decisions, Modified Files, Context, Session Log
  - Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`
  - `PROJECT-PATTERNS.md` extraction — background hook accumulates patterns across sessions
  - Directory separation: `.memory/` (session state) vs `.docs/` (reviews/design artifacts)
  - Auto-migration from `.docs/` to `.memory/` with no-clobber semantics
  - Auto-adds `.memory/` and `.docs/` to `.gitignore` on first hook run

### Changed
- **Background agent permissions** — Replaced `--dangerously-skip-permissions` with `--tools "Write"` + `--allowedTools` for restricted file access in memory update hooks
- **Safe-delete auto-upgrade** — `devflow init` now detects outdated safe-delete blocks and silently upgrades them; no manual uninstall/reinstall needed

### Fixed
- **Ambient depth classification** — Intent now drives depth exclusively; removed 20-word threshold that silently downgraded ~32% of BUILD/DEBUG prompts to QUICK (#73)
- **Safe-delete file existence** — Filter non-existent files before calling `trash` in bash/zsh, fish, and PowerShell Unix blocks; prevents noisy `trash: file doesn't exist` errors on `rm -f` of missing files (#74)
- **Safe-delete deny list** — Expanded `rm` deny patterns from 8 to 21, covering `rm -r`, `rm -fr`, and `rm -f` flag variations that could bypass the `rm -rf`-only patterns (#74)

---

## [1.0.0] - 2026-02-25

### Added
- **Agent Teams integration** - Peer-to-peer agent collaboration across workflows
  - `/code-review` uses adversarial review team with debate round and consensus findings
  - `/implement` uses exploration and planning teams with debate, Shepherd↔Coder direct dialogue
  - New `/debug` command for competing hypothesis investigation with agent teams
  - `agent-teams` foundation skill with team spawning, challenge protocol, consensus formation
  - Graceful fallback to parallel subagents when Agent Teams is unavailable
- **`devflow-debug` plugin** - New plugin for bug investigation
  - `/debug` command spawns 3-5 hypothesis investigators
  - Adversarial debate where agents actively disprove each other's theories
  - Root cause analysis report with confidence levels
- **`accessibility` skill** - WCAG 2.1 AA patterns for keyboard navigation, ARIA, contrast
  - Iron Law: EVERY INTERACTION MUST BE POSSIBLE WITHOUT A MOUSE
  - Auto-triggers when creating UI components, forms, or interactive elements
- **`frontend-design` skill** - Intentional visual design patterns (Anthropic's 4 Dimensions)
  - Iron Law: AESTHETICS MUST HAVE INTENT
  - AI slop detection (purple-pink gradients, Inter without rationale, everything centered)
  - Auto-triggers when working with CSS, styling, or visual design
- **Enhanced `react` skill** - Added 5 new categories from Vercel best practices
  - Async Parallelization (Promise.all for independent fetches)
  - Bundle Size (no barrel imports, lazy loading)
  - Re-render Optimization (primitive deps, stable callbacks)
  - Image Optimization (dimensions, lazy loading, aspect-ratio)
  - Data Structure Performance (Set/Map for O(1) lookups)
- **Conditional frontend reviews** in `/code-review` command
  - `react` review (if .tsx/.jsx files changed)
  - `accessibility` review (if .tsx/.jsx files changed)
  - `frontend-design` review (if .tsx/.jsx/.css/.scss files changed)
- **Glob pattern activation schema** for skills
  - Skills can declare `activation.file-patterns` and `activation.exclude` in frontmatter
  - Future-proofs for conditional skill loading
- **`github-patterns` skill** - Foundation skill for GitHub API interactions
  - Rate limiting patterns (1-2s delays, 60s wait if <10 remaining)
  - Comment deduplication algorithms
  - Line-in-diff validation for PR comments
  - Issue data parsing (acceptance criteria, dependencies)
  - Branch name generation from issues
  - Tech debt management patterns (archive on overflow)
  - Iron Law: RESPECT RATE LIMITS OR FAIL GRACEFULLY
- **Unified `Git` agent** - Single parameterized agent for all git/GitHub operations
  - `fetch-issue` operation: Fetches GitHub issue details with acceptance criteria and suggested branch name
  - `comment-pr` operation: Creates PR inline comments with deduplication and rate limiting
  - `manage-debt` operation: Updates tech debt backlog issue with semantic deduplication
  - `create-release` operation: Creates GitHub release with version tag
  - Replaces: GetIssue, Comment, TechDebt agents
- **`git-workflow` skill** - Unified commit and PR patterns (atomic commits, message format, PR quality)
  - Iron Law: ATOMIC COMMITS OR NO COMMITS
  - Auto-triggers when staging files, creating commits, or opening PRs
- **Iron Laws** - Every skill now has a single, non-negotiable core principle
  - 24 Iron Laws across all skills (e.g., "NEVER THROW IN BUSINESS LOGIC", "NO FAKE SOLUTIONS")
  - Automatically enforced when skills activate
  - Consistent format: `## Iron Law` section in each SKILL.md
- **Clarification Gates** for `/specify` command
  - Gate 0: Confirm understanding before exploration
  - Gate 1: Validate scope and priorities after exploration
  - Gate 2: Confirm acceptance criteria before issue creation
  - No gate may be skipped - explicit user approval required
- **Security deny list** via OS-level managed settings (140 blocked operations)
  - System destruction (rm -rf, dd, mkfs, shred)
  - Code execution (curl|bash, eval, exec)
  - Privilege escalation (sudo, su, doas, pkexec)
  - Permission changes (chmod 777, chown root)
  - System control (kill -9, reboot, shutdown)
  - Data exfiltration (netcat, socat, telnet)
  - Sensitive file reads (.env, SSH keys, AWS credentials)
  - Package globals (npm -g, pip --system)
  - Resource abuse (fork bombs, crypto miners)
- **`ENABLE_TOOL_SEARCH`** environment variable in settings
  - Deferred MCP tool loading until needed
  - ~85% token reduction for conversations with many MCP tools
- **Context usage percentage** in statusline
  - Replaces binary "exceeds 200k" warning
  - Color-coded: Green (<50%), Yellow (50-80%), Red (>80%)
  - Calculated from `context_window.current_usage` data
- **Working Memory hooks** — Automatic session continuity via stop/session-start/pre-compact hooks (#59)
  - Background haiku updater writes `.docs/WORKING-MEMORY.md` asynchronously
  - SessionStart hook injects previous memory + git state on startup
  - mkdir-based locking for concurrent session safety
- **Teams/no-teams command variants** — Install-time selection of Agent Teams vs parallel subagents (#61)
  - `--teams`/`--no-teams` CLI flags with TTY confirmation prompt
  - Variant-aware installer copies correct `.md` files
  - `stripTeamsConfig()` removes teams env vars when disabled

### Changed
- **Lean agent and command redesign** - Major refactoring reducing 3,653 lines to 844 (-77%)
  - Commands: `/implement` (479→182), `/specify` (631→179), `/devlog` (408→113), `/code-review` (312→136)
  - Agents: Coder, Synthesizer, Reviewer, Git, Devlog, CatchUp, Skimmer, Simplifier
  - Removed embedded bash scripts, verbose templates, redundant explanations
  - Preserved all workflows, agent invocations, and architecture
- **Agent model assignments** - Simplified to inherit vs haiku
  - `inherit`: Coder, Reviewer, Simplifier, Skimmer (use orchestrator's model)
  - `haiku`: Synthesizer, Git, Devlog, CatchUp (fast, simple operations)
- `/specify` now requires explicit user confirmation at each gate
- Statusline shows actual percentage instead of just large context warning
- Settings template includes permissions.deny and env configuration
- Commit and PR patterns now auto-activate via skills instead of requiring explicit commands
- **Skills consolidation** — 28 skills merged to 24
  - `test-design` + `tests-patterns` → `test-patterns`
  - `commit` + `pull-request` → `git-workflow`
  - `code-smell` absorbed into `core-patterns`
  - `codebase-navigation` removed (redundant with Explore agent)
  - `devflow-` prefix dropped from all skill names
- **Managed settings** replace `--override-settings` flag — OS-level deny list installed to system-managed path, non-overridable by user settings
- **CLAUDE.md creation removed** — opinionated template no longer forced on users during init
- **`--teams` default flipped to off** — Agent Teams now opt-in via `--teams` flag
- **`/review` renamed to `/code-review`** — Plugin directory, command files, CLI registry, and all cross-references updated for clarity
- **Landing page** — Reference badge and repo homepage URL added

### Removed
- **`/commit` command** - Replaced by `git-workflow` skill (use `git commit` directly)
- **`/pull-request` command** - Replaced by `git-workflow` skill (use `gh pr create` directly)
- **`/breakdown` command** - Removed (use natural conversation or TodoWrite directly)
- **`/release` command** - Removed (use manual release process)
- **`/resolve-comments` command** - Removed (address PR comments directly)
- **`/run` command** - Removed (use `/implement` for full lifecycle)
- **`Commit` agent** - Patterns moved to `git-workflow` skill
- **`PullRequest` agent** - Patterns moved to `git-workflow` skill
- **`Release` agent** - Removed (use manual release process)
- **`/catch-up` command** - Superseded by Working Memory hooks (automatic context restoration)
- **`/devlog` command** - Superseded by Working Memory hooks (automatic session logging)
- **`catch-up` agent** - No longer needed with automatic Working Memory
- **`devlog` agent** - No longer needed with automatic Working Memory
- **`GetIssue` agent** - Replaced by Git agent (operation: fetch-issue)
- **`Comment` agent** - Replaced by Git agent (operation: comment-pr)
- **`TechDebt` agent** - Replaced by Git agent (operation: manage-debt)

### Fixed
- **Statusline base branch detection** — Layered 4-tier fallback (branch reflog → HEAD reflog → `gh pr view` cache → main/master) replaces hardcoded main/master check; fixes incorrect diff stats for branches off `develop`, `staging`, etc. (#70)
- **Stale CLAUDE.md in files array** — Removed from `package.json` after CLAUDE.md creation was dropped
- **Skimmer agent** — Use `npx rskim` to eliminate global install requirement (#60)
- **Working Memory throttle race** — Marker file prevents concurrent updater spawns during Agent Teams sessions (#62)
- **Working Memory diagnostics** — stderr captured to log file instead of swallowed (#62)

---

## [0.9.0] - 2025-12-04

### Added
- **`/get-issue` command** - Fetch GitHub issue details and create working branch
  - Fetch issue by number (`/get-issue 42`) or search term (`/get-issue fix login`)
  - Display comprehensive issue details (title, body, labels, assignees, comments)
  - Auto-generate branch names: `{type}/{number}-{slug}`
  - Branch type derived from labels (feature, fix, docs, refactor, chore)
  - Pre-flight checks for gh authentication and repository validation
- **`get-issue` sub-agent** - Specialized agent for GitHub issue workflow

### Changed
- Optimized sub-agent model selection - 5 sub-agents switched to haiku model (get-issue, pull-request, project-state, tech-debt, pr-comments)
- Minimized command files - `/get-issue` (16 lines) and `/pull-request` (20 lines) delegate to sub-agents

---

## [0.8.1] - 2025-12-02

### Added
- **`--verbose` flag for `devflow init`** - Clean, command-focused output by default
  - Default output shows only version, available commands, and docs link
  - Use `--verbose` for detailed installation progress, paths, and skills list
  - Improves first-run experience by reducing noise

### Changed
- Refactored init command output rendering into separate functions
- Extracted command and skill lists into maintainable constants

---

## [0.8.0] - 2025-11-21

### Added
- PR comments and tech debt tracking for code-review command
- Robustness improvements (rate limiting, auto-archive for tech debt)

### Changed
- Split code-review into three specialized sub-agents (code-review, pr-comments, tech-debt)
- Simplified code-review Phase 1 setup

---

## [0.7.0] - 2025-11-16

### Added
- **`/brainstorm` command** - Explore design decisions and architectural approaches
  - Launches brainstorm sub-agent for structured exploration
  - Analyzes trade-offs between different approaches
  - Saves exploration to `.docs/brainstorm/`
- **`/design` command** - Create detailed implementation plans with integration points
  - Launches design sub-agent for concrete planning
  - Studies existing codebase patterns
  - Saves implementation plan to `.docs/design/`
- **`/breakdown` command** - Quick task decomposition without interaction
  - Renamed from `/plan-next-steps` for conciseness
  - Extracts action items from conversation
  - Saves todos immediately without triage

### Changed
- **`/plan` command** - Redesigned for deliberate issue triage
  - Examine each issue individually (what, why, severity)
  - Three-way decision: implement now, defer to GitHub issue, or skip
  - Creates and locks actual GitHub issues via `gh` CLI
  - Applies orchestration principle (minimal tools)
- **`/commit` command** - Execute immediately without user confirmation
  - Trust agent judgment after safety checks pass
  - Only abort for genuine issues (secrets, credentials)
  - Faster workflow without back-and-forth
- **`/run` command** - Streamlined from 507 to ~100 lines (renamed from `/implement`)
  - Removed over-engineered interactive triage
  - Focus on efficient task execution
  - Only stop for genuine design decisions
- **Documentation framework** - Standardized across all agents
  - Timestamps: YYYY-MM-DD_HHMM (sortable, readable)
  - Branch slugs: sanitize `/` to `-` for file paths
  - Consistent `.docs/` directory structure
- **Research skill** - Updated to use brainstorm agent
  - Auto-launches brainstorm for unfamiliar features
  - Suggests `/design` after exploration completes

### Removed
- **`/research` command** - Replaced by `/brainstorm` + `/design` workflow
- **`/plan-next-steps` command** - Renamed to `/breakdown`
- **research sub-agent** - Replaced by brainstorm and design agents

### Breaking Changes
- `/plan-next-steps` renamed to `/breakdown`
- `/research` command removed (use `/brainstorm` + `/design`)
- `/plan` behavior completely changed (triage vs batch selection)

## [0.6.1] - 2025-11-04

### Fixed
- Skills installation structure for auto-discovery - Skills are now installed directly under `~/.claude/skills/` instead of `~/.claude/skills/devflow/`, enabling Claude Code to properly discover and auto-activate them
- Uninstall command now correctly removes individual skill directories
- Migration cleanup for users upgrading from nested to flat skill structure

## [0.6.0] - 2025-11-03

### Added

#### Complete PR Workflow Commands
- **`/plan` command** - Interactive planning with design decisions
  - Extracts actionable tasks from discussion
  - Presents tasks to user for selection via interactive UI
  - Saves only chosen tasks to todo list
  - Enables focused, intentional work sessions
- **`/pull-request` command** - Smart PR creation with auto-generated descriptions
  - Analyzes all commits and changes in branch
  - Generates comprehensive PR description automatically
  - Includes summary, key changes, and test plan
  - Supports `--draft` flag and custom base branch
  - Uses new pull-request sub-agent for deep analysis
- **`/resolve-comments` command** - Systematic PR feedback resolution
  - Fetches PR review comments via GitHub CLI
  - Triages comments with user (implement, respond, defer)
  - Implements changes and updates PR
  - Posts replies to reviewers
  - Tracks completion status

#### Enhanced Audit System
- **Three-category reporting** - All 9 review agents refactored for clearer feedback
  - **🔴 Issues in Your Changes** - NEW vulnerabilities/problems introduced (BLOCKING)
  - **⚠️ Issues in Code You Touched** - Problems near your changes (SHOULD FIX)
  - **ℹ️ Pre-existing Issues** - Legacy problems unrelated to PR (INFORMATIONAL)
  - Prevents scope creep in code reviews by clearly separating what you introduced
- **New pull-request sub-agent** - Comprehensive PR analysis specialist
  - Analyzes commit history and code changes
  - Generates structured PR descriptions
  - Identifies breaking changes and migration paths
  - Creates test plans and verification steps

### Changed

#### Code Review Command Rewrite
- **Completely rewritten `/code-review` command** - Better orchestration and synthesis
  - Orchestrates all review sub-agents in parallel for faster execution
  - Synthesizes findings from three-category reports
  - Generates actionable summary with clear priorities
  - Separates blocking issues from informational findings
  - Provides focused feedback on what actually needs fixing

#### Type Safety Improvements
- **Enhanced error handling in CLI** - Proper TypeScript type guards
  - Added `NodeSystemError` interface with proper typing
  - Created `isNodeSystemError()` type guard function
  - Replaced `error: any` with `error: unknown` in init command
  - Safely checks `error.code` property with type guard
  - Maintains runtime behavior while improving type safety

### Fixed

#### Documentation
- **README CLI examples** - Corrected command invocation format
  - Fixed examples to use `npx devflow-kit` instead of `devflow`
  - Ensures users can successfully run installation commands
- **Statusline metrics** - Fixed container-specific resource monitoring
  - Now reads container-specific CPU and memory metrics correctly
  - Removed redundant CPU and memory metrics from statusline implementation
  - Improved accuracy for Docker container environments

---

[0.6.0]: https://github.com/dean0x/devflow/compare/v0.5.0...v0.6.0

## [0.5.0] - 2025-10-24

### Added

#### Installation Scope Support
- **Two-tier installation strategy** - Choose between user-wide and project-specific installation
  - **User scope** (default): Install to `~/.claude/` for all projects
  - **Local scope**: Install to `<git-root>/.claude/` for current project only
  - Interactive prompt with clear descriptions when `--scope` flag not provided
  - CLI flag: `devflow init --scope <user|local>`
  - Automatic .gitignore updates for local scope (excludes `.claude/` and `.devflow/`)
  - Perfect for team projects where Devflow should be project-specific

#### Smart Uninstall with Scope Detection
- **Auto-detection of installed scopes** - Intelligently finds and removes Devflow installations
  - Automatically detects which scopes have Devflow installed (user and/or local)
  - Default behavior: Remove from all detected scopes
  - Manual override: `--scope <user|local>` to target specific scope
  - Clear feedback showing which scopes are being uninstalled
  - Graceful handling when no installation found

### Changed

#### Code Quality Improvements
- **Extracted shared utilities** - Eliminated code duplication between init and uninstall commands
  - Created `src/cli/utils/paths.ts` for path resolution functions
  - Created `src/cli/utils/git.ts` for git repository operations
  - Reduced duplication by ~65 lines
  - Single source of truth for path and git logic

#### Performance Optimizations
- **Eliminated redundant git detection** - Cache git root result for reuse
  - Previously called `git rev-parse` twice during installation
  - Now cached once and reused throughout installation process
  - Faster installation, especially in large repositories

### Fixed

#### CI/CD Compatibility
- **TTY detection for interactive prompts** - Prevents hanging in non-interactive environments
  - Detects when running in CI/CD pipelines, Docker containers, or automated scripts
  - Falls back to default scope (user) when no TTY available
  - Clear messaging when non-interactive environment detected
  - Explicit instructions for CI/CD usage: `devflow init --scope <user|local>`

#### Security Hardening
- **Environment variable path validation** - Prevents malicious path overrides
  - Validates `CLAUDE_CODE_DIR` and `DEVFLOW_DIR` are absolute paths
  - Warns when paths point outside user's home directory
  - Prevents path traversal attacks via environment variables
  - Security-first approach to custom path configuration

### Documentation
- **Installation Scopes section** in README with clear use cases
- **Updated CLI commands table** with scope options for init and uninstall
- **Migration guide** for existing users (scope defaults to user for compatibility)
- **.gitignore patterns** documented for local scope installations

---

## [0.4.0] - 2025-10-21

### Added

#### Skills Infrastructure
- **Auto-activating skills system** - Intelligent context-aware capabilities that activate when relevant
  - Skills replace standalone commands with intelligent activation patterns
  - 7 new skills: research, debug, devlog, test-generation, api-integration, data-migration, refactoring-assistant
  - Skills displayed on devflow init with clear descriptions
  - Installed to `~/.claude/skills/devflow/` directory
  - Automatic activation based on conversation context

#### Smart Interactive Commands
- **/run command** - Orchestrator for guided feature implementation (originally `/implement`)
  - Interactive workflow for planning, research, and execution
  - Integrates with project-state agent for context gathering
  - Guides through research, design, implementation, and testing phases
  - Prevents blind coding by requiring user approval at each stage

#### Command→Agent→Skill Architecture
- **Dual-mode pattern** - Commands for explicit invocation, skills for auto-activation
  - Commands: `/research`, `/debug` for explicit user requests
  - Skills: Auto-activated versions when conversation context matches
  - Clear separation of concerns and activation modes
  - Documented pattern for extending Devflow functionality

#### Enhanced /devlog Command
- **Orchestrator pattern** - Refactored to use project-state agent
  - Delegates project analysis to specialized agent
  - Cleaner separation of orchestration vs analysis logic
  - More maintainable and extensible architecture
  - Comprehensive session documentation with context gathering

### Changed
- **Skills-first approach** - research and debug migrated to dual-mode (command + skill)
  - Commands remain for explicit invocation
  - Skills provide automatic activation based on context
  - No loss of functionality, enhanced discoverability

### Fixed
- **Security vulnerability** - Added input validation for execSync to prevent command injection
  - Validates all user input before shell execution
  - Proper escaping and sanitization
  - Security hardening in CLI commands

- **Uninstall bug** - Fixed cleanup issue and refactored CLI to namespace pattern
  - Proper cleanup of all installed assets
  - Consistent namespace pattern across CLI
  - Improved error handling and user feedback

### Documentation
- **Comprehensive skills guide** - Added to README and CLAUDE.md
  - Detailed explanation of skills infrastructure
  - How to create new skills
  - When to use skills vs commands
  - Auto-activation patterns and best practices

- **Development guide updates** - Enhanced CLAUDE.md for contributors
  - Skills development patterns
  - Command→Agent→Skill architecture explanation
  - Testing guidelines for dual-mode functionality

- **Documentation gap fixes** - Addressed critical gaps from code review
  - Improved clarity and completeness
  - Fixed missing examples and use cases
  - Better organization and navigation

---

## [0.3.3] - 2025-10-19

### Fixed
- **Statusline path resolution** - Use absolute paths instead of tilde (~) for reliable execution
- **Audit report organization** - Formalized structured storage for all review reports
  - Branch-specific directories: `.docs/reviews/<branch-name>/`
  - Timestamped reports for historical tracking
  - Standardized naming: `<review-type>-report.<timestamp>.md`
  - Standalone directory for direct agent invocations
  - Applied consistently across all 9 review agents

### Added
- **Release notes persistence** - Save comprehensive release notes to `.docs/releases/RELEASE_NOTES_v<version>.md`
- **Documentation verification** - Release agent now verifies documentation alignment
  - Checks version references across ROADMAP, READMEs, CHANGELOG
  - Detects monorepo subpackages
  - Provides search-and-replace commands for fixing mismatches
- **Production build standards** - Global CLAUDE.md guidelines for production optimization
  - Never ship test files, debug symbols, or sourcemaps
  - Separate dev/prod build configurations
- **Test suite safety** - Sequential test execution standards to prevent Claude Code crashes
  - Memory limits and resource cleanup requirements
  - Framework-specific configuration flags

---

## [0.3.2] - 2025-10-17

### Changed
- **Simplified init command output** - Reduced installation output from ~60-80 lines to ~10-15 lines
- **Unified review commands** - Consolidated /pre-commit and /pre-pr into single /code-review command
- **Streamlined statusline** - Removed cost/API metrics, added CPU/memory monitoring (28% code reduction)

### Improved
- Replaced /catch-up suggestion with comprehensive commands reference for better initial UX

---

## [0.3.1] - 2025-10-17

### Fixed
- **catch-up agent crashes** - Prevent Claude Code session crashes from expensive operations
  - Replaced full-project filesystem scans with surgical `git diff --name-only HEAD~1`
  - Removed automatic test suite execution (prevents timeout crashes)
  - Removed automatic build execution (prevents resource exhaustion)
  - Scoped TODO/FIXME search to recently modified files only (git-based)
  - Maintains user-preferred 5 status document limit
  - Cleaner code with reduced safety comment overhead
  - Critical fix for large codebases that caused Claude Code to hang/crash

## [0.3.0] - 2025-10-16

### Added

#### Language-Agnostic Global CLAUDE.md
- **Global engineering principles** - Universal CLAUDE.md works across all programming languages
  - Strips language-specific syntax, focuses on concepts (Result types, DI, immutability, pure functions)
  - Critical anti-patterns enforcement (NO FAKE SOLUTIONS, FAIL HONESTLY, BE TRANSPARENT)
  - Code quality enforcement (root cause analysis over workarounds)
  - Architecture documentation standards (document patterns, boundaries, exceptions)
  - Type safety best practices, security requirements, naming conventions
  - Structured as ~330 lines of precise, non-bloated global instructions

#### Smart CLAUDE.md Installation
- **Intelligent mounting logic** - Preserves user's existing global configuration
  - Fresh install: Directly installs CLAUDE.md (no conflicts)
  - Existing CLAUDE.md: Preserves user file, creates CLAUDE.devflow.md with merge instructions
  - `--force` flag: Prompts for confirmation, backs up to .backup before override
  - `-y` flag: Auto-approves prompts for automation/CI/CD workflows
  - Parallel implementation to settings.json (consistent UX across installations)
  - Never overwrites without explicit permission

#### TypeScript Auditor Sub-Agent
- **review-typescript** - Specialized TypeScript code quality and type safety auditor
  - Conditional execution: Runs only if .ts/.tsx files changed OR tsconfig.json exists
  - Built-in detection logic (gracefully skips non-TypeScript projects)
  - Comprehensive reviews: type safety config, `any` usage, type assertions, branded types
  - Advanced patterns: discriminated unions, immutability, Result types
  - Code quality: naming conventions, dependency injection, pure functions
  - Severity-based reporting (CRITICAL/HIGH/MEDIUM/LOW) with file:line references
  - Integrated into `/pre-commit` and `/pre-pr` workflows

#### Release Automation Workflow
- **`/release` command** - Project-agnostic release automation for professional releases
  - Multi-step interactive workflow with user confirmations
  - Preview changes before committing, pushing, or publishing
  - Clear rollback instructions if any step fails
  - Comprehensive final summary with verification links

- **release sub-agent** - Specialized agent for safe, automated release management
  - Universal project detection (10+ ecosystems supported)
  - Intelligent version bumping based on conventional commit analysis
  - Auto-generated changelogs from git history
  - Built-in safety checks (clean directory, builds, tests)
  - Platform integration (creates GitHub/GitLab releases via gh/glab)

#### Supported Release Ecosystems
- Node.js (package.json + npm)
- Rust (Cargo.toml + cargo)
- Python (pyproject.toml/setup.py + pip/twine)
- Go (go.mod + git tags)
- Ruby (gemspec + gem)
- PHP (composer.json + composer)
- Java/Maven (pom.xml + mvn)
- Java/Gradle (build.gradle + gradle)
- Swift (Package.swift + git tags)
- Generic (VERSION file + git tags)

#### Release Workflow Steps
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze commits since last release
4. Generate changelog entry from commit history
5. Update version files (automatic detection)
6. Build and test project
7. Preview changes and await user confirmation
8. Commit version bump
9. Push to remote repository
10. Publish to package registry (npm, crates.io, PyPI, etc.)
11. Create annotated git tag
12. Create platform release (GitHub/GitLab)
13. Provide verification links and next steps

### Changed
- **Pre-commit workflow** - Integrated review-typescript into 5-agent review
  - Conditionally executes for TypeScript projects
  - No manual configuration needed
- **Pre-PR workflow** - Integrated review-typescript into comprehensive review
  - Automatic TypeScript detection and execution
  - Preserves existing review orchestration patterns

### Documentation
- Added `/release` command to README commands table
- Added `release` sub-agent to README sub-agents table
- Added `review-typescript` sub-agent to README sub-agents table
- Created "Creating a Release" workflow section in README
- Documented smart CLAUDE.md installation behavior
- Included release automation in integration examples


## [0.2.0] - 2025-10-16

### Added
- **review-documentation sub-agent** - Ensures documentation stays aligned with code
  - Validates README accuracy (installation, usage, examples)
  - Checks API documentation matches actual function signatures
  - Detects stale code comments and commented-out code
  - Verifies code examples actually work
  - Language-agnostic documentation pattern detection
  - Severity-based reporting (CRITICAL/HIGH/MEDIUM/LOW)
- **Smart settings.json management** - 3-tier backup strategy prevents data loss
  - First install: Direct installation
  - Existing settings: Backup to managed-settings.json
  - Both exist: Save as settings.devflow.json with clear instructions
  - User maintains control of their configuration
- **Surgical test execution** - Prevents Claude Code session crashes
  - Static analysis by default (80% value, 0% crash risk)
  - Smart test selection based on git changes
  - Individual test file execution with 30s timeouts
  - Max 10 test files per run with resource limits
  - Early termination on repeated error patterns
- **Language-agnostic agents** - Works with any programming language
  - Auto-detection for 9+ package managers
  - Universal ORM and database patterns
  - Smart test command detection from manifests
  - Generic file search patterns for all ecosystems

### Changed
- **Pre-commit strategy** - Lightweight 5-agent review for fast feedback
  - Core reviews: Security, Performance, Architecture, Tests, Complexity
  - Typical execution: 30-60 seconds
  - Additional reviews available on explicit request
- **Pre-pr strategy** - Comprehensive 7-8 agent review
  - All core reviews plus Dependencies and Documentation
  - Conditional Database review (only if DB files changed)
  - Typical execution: 2-3 minutes
  - Thorough branch review before PR creation
- **Path handling** - No longer assumes HOME environment variable
  - Uses Node.js homedir() as fallback
  - Environment variable overrides: CLAUDE_CODE_DIR, DEVFLOW_DIR
  - Cross-platform compatibility improvements

### Fixed
- **Git lock file conflicts** - Wait-based prevention instead of deletion
  - Implemented wait_for_lock_release() with 10s timeout
  - Explicit wait commands after each git operation
  - Command substitution patterns for synchronous execution
  - Prevents zombie process lock file issues
  - No more `.git/index.lock` errors
- **Settings overwrite issue** - User settings preserved with backup strategy
- **Hardcoded path assumptions** - Proper fallbacks and environment overrides

### Documentation
- Added review-documentation to sub-agents table in README
- Clarified review strategies for pre-commit vs pre-pr
- Updated workflow examples with refined command usage

## [0.1.2] - 2025-10-05

### Added
- `/research [topic]` - Comprehensive pre-implementation research and planning command
- `research` sub-agent - Specialized agent for systematic implementation research with 10-step workflow
  - Analyzes multiple implementation approaches with pros/cons/trade-offs
  - Studies official documentation and code examples
  - Reviews existing codebase patterns and conventions
  - Designs integration strategy with specific file paths
  - Identifies risks and creates actionable implementation plans
  - Saves research reports to `.docs/research/`

### Documentation
- Updated README.md with `/research` command in workflow examples
- Added research sub-agent to sub-agents table

## [0.1.1] - 2025-10-03

### Changed
- **Simplified Installation**: Single command installation using `npx devflow-kit init` (no global install needed)
- **Improved Documentation**: Commands and sub-agents now displayed in easy-to-scan tables
- **Better Organization**: Separated user documentation (README.md) from developer guide (CLAUDE.md)
- **Reduced Duplication**: Eliminated redundant information throughout README

### Documentation
- Reorganized README.md with table-based layout for commands and sub-agents
- Moved developer/AI agent instructions to CLAUDE.md
- Updated installation to promote npx usage over global install
- Reduced README from 289 lines to 204 lines while preserving all information

## [0.1.0] - 2024-10-03

### 🎉 Initial Release

Devflow is an Agentic Development Toolkit designed to enhance Claude Code with intelligent commands and workflows for AI-assisted development.

### Added

#### Core Commands
- `/catch-up` - Smart summaries for starting new sessions with status validation
- `/devlog` - Development log for comprehensive session documentation (formerly note-to-future-self)
- `/plan-next-steps` - Extract actionable next steps from current discussion
- `/pre-commit` - Review uncommitted changes using specialized sub-agents
- `/pre-pr` - Comprehensive branch review for PR readiness assessment
- `/commit` - Intelligent atomic commit creation with safety checks
- `/debug [issue]` - Systematic debugging with issue-specific investigation

#### Sub-Agents (Audit Specialists)
- `review-security` - Security vulnerability detection and analysis
- `review-performance` - Performance optimization and bottleneck detection
- `review-architecture` - Software architecture and design pattern analysis
- `review-tests` - Test quality and coverage analysis
- `review-dependencies` - Dependency management and security analysis
- `review-complexity` - Code complexity and maintainability assessment
- `review-database` - Database design and optimization review

#### Workflow Sub-Agents
- `catch-up` - Project status and context restoration with validation
- `commit` - Intelligent commit creation with safety checks

#### Features
- **Smart Statusline** - Real-time project context display with git status and cost tracking
- **Security & Optimization** - Automatic `.claudeignore` file creation for token efficiency
- **Parallel Sub-Agent Execution** - Run multiple reviews simultaneously for better performance
- **Git Safety** - Sequential git operations to prevent lock file conflicts
- **Structured Documentation** - Organized tracking in `.docs/` directory

### Technical Details
- Built with TypeScript and Commander.js
- Supports Claude Code on macOS, Linux, and Windows
- Requires Node.js 18.0.0 or higher
- Modular architecture with isolated sub-agents

### Installation
```bash
npm install -g devflow-kit
devflow init
```

### Documentation
- Comprehensive guide in README.md
- Quick reference in README.md
- Self-documenting commands

---

[Unreleased]: https://github.com/dean0x/devflow/compare/v2.0.0...HEAD
[2.1.0]: https://github.com/dean0x/devflow/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/dean0x/devflow/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/dean0x/devflow/compare/v1.8.3...v2.0.0
[1.8.3]: https://github.com/dean0x/devflow/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/dean0x/devflow/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/dean0x/devflow/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/dean0x/devflow/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/dean0x/devflow/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/dean0x/devflow/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/dean0x/devflow/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/dean0x/devflow/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dean0x/devflow/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/dean0x/devflow/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/dean0x/devflow/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/dean0x/devflow/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/dean0x/devflow/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dean0x/devflow/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dean0x/devflow/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dean0x/devflow/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/dean0x/devflow/releases/tag/v0.9.0
[0.8.1]: https://github.com/dean0x/devflow/releases/tag/v0.8.1
[0.8.0]: https://github.com/dean0x/devflow/releases/tag/v0.8.0
[0.7.0]: https://github.com/dean0x/devflow/releases/tag/v0.7.0
[0.6.1]: https://github.com/dean0x/devflow/releases/tag/v0.6.1
[0.6.0]: https://github.com/dean0x/devflow/releases/tag/v0.6.0
[0.5.0]: https://github.com/dean0x/devflow/releases/tag/v0.5.0
[0.4.0]: https://github.com/dean0x/devflow/releases/tag/v0.4.0
[0.3.3]: https://github.com/dean0x/devflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/dean0x/devflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/dean0x/devflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/dean0x/devflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/dean0x/devflow/releases/tag/v0.2.0
[0.1.2]: https://github.com/dean0x/devflow/releases/tag/v0.1.2
[0.1.1]: https://github.com/dean0x/devflow/releases/tag/v0.1.1
[0.1.0]: https://github.com/dean0x/devflow/releases/tag/v0.1.0
