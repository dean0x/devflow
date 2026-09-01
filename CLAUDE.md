# Devflow Development Guide

Instructions for developers and AI agents working on Devflow. For user docs, see README.md.

## Purpose

Devflow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Registry-driven CLI tool with 21 plugins (12 core + 9 optional). Plugins are entries in DEVFLOW_PLUGINS in `src/core/plugins.ts` — each entry declares its `commands`, `agents`, `skills`, and `rules` arrays. All assets live once in `src/assets/` and install directly; the only compile step is `.mds` command sources → `dist/commands/` via `npm run build:mds`.

| Plugin | Purpose |
|--------|---------|
| `devflow-implement` | Complete task implementation lifecycle |
| `devflow-plan` | Unified design planning with gap analysis |
| `devflow-code-review` | Comprehensive code review |
| `devflow-resolve` | Review issue resolution |
| `devflow-debug` | Competing hypothesis debugging |
| `devflow-explore` | Codebase exploration with knowledge base creation |
| `devflow-research` | Multi-type research with trust-aware synthesis |
| `devflow-release` | Adaptive project release with learned configuration |
| `devflow-self-review` | Self-review (Simplify + Scrutinize) |
| `devflow-bug-analysis` | Proactive bug finding with static and semantic analysis |
| `devflow-ambient` | Ambient mode — orchestrator charter + plan handoff |
| `devflow-core-skills` | Auto-activating quality enforcement |
| `devflow-dynamic` | Dynamic workflow recipes — dependency-aware tickets→plan→build delivery pipeline (optional) |
| `devflow-typescript` | TypeScript language patterns (optional) |
| `devflow-react` | React framework patterns (optional) |
| `devflow-accessibility` | Web accessibility patterns (optional) |
| `devflow-ui-design` | UI design patterns (optional) |
| `devflow-go` | Go language patterns (optional) |
| `devflow-python` | Python language patterns (optional) |
| `devflow-java` | Java language patterns (optional) |
| `devflow-rust` | Rust language patterns (optional) |

**LLM-vs-plumbing principle**: The LLM does all detection, semantic matching, materialization, and curation — and reads/edits the data files directly. Deterministic code is plumbing only: hooks, locks, throttles, file I/O, `assign-anchor`/`retire-anchor`/`refresh-anchor` ledger numbering and re-projection, `render-decisions` rendering (decisions.md + pitfalls.md + index.md), and `rotate-observations` archival. No detection or judgment logic lives in shell or TypeScript.

**Working Memory**: A capture/spawn split across always-on hooks in `src/assets/scripts/hooks/`. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`. Feature state is stored in `.devflow/config.json` (config-only; feature config is the sole source of truth per ADR-001). `capture-prompt` (UserPromptSubmit, always-on) and `capture-turn` (Stop, always-on) — append the user/assistant turn to `.devflow/memory/.pending-turns.jsonl` via the shared `queue-append` helper (dual-write; see Learning pipeline for the sibling learning queue), which uses mkdir-based locking for queue overflow truncation across concurrent sessions; each queue is gated independently by feature config; neither ever spawns anything. `memory-worker` (Stop, registered immediately after `capture-turn` so append-before-spawn ordering holds by array position) — after the 120s throttle (keyed by `.working-memory-last-trigger` mtime), touches the trigger then spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model claude-sonnet-4-6`). `background-memory-update` (detached worker, not a hook itself) — drains `.pending-turns.jsonl`, calls `claude -p` (prompt on stdin, never argv) with a reconciliation-aware prompt (bounded git evidence since last stamp, reconciliation/provenance sections, strict DONE definition per PF-010); writes to `WORKING-MEMORY.md.new` (staged file, never the real path directly); then compare-and-swaps: checksums `WORKING-MEMORY.md` before and after the LLM run — if unchanged, renames `.new` → `WORKING-MEMORY.md` (UPDATED) and touches `.last-refresh-ok`; if changed by a concurrent human edit, CONFLICT path keeps the human's version, discards `.new`, leaves `.processing` for retry; if staged file absent or un-stamped, FAIL path leaves `.processing` for session-start-memory crash recovery; holds a 300s-stale worker lock; user-only queue truncated without LLM run. `session-start-memory` (SessionStart) → injects previous memory with git-reconciled header (3-state: A in-sync / B drifted / C refresh-failing — State C queue depth now counts both `.pending-turns.jsonl` lines and any orphaned `.pending-turns.processing` lines) + optional pre-compact snapshot as `additionalContext`; stamp `<!-- memory-head: <sha> branch: <name> -->` on line 1 drives drift detection; also recovers a stale orphaned `.pending-turns.processing` itself (self-contained cold path, no external helper). PreCompact hook → saves git state + WORKING-MEMORY.md snapshot to backup.json; when WORKING-MEMORY.md is absent, bootstraps it with the line-1 stamp and the five canonical sections in fixed order (requires a non-empty branch name AND a 40-hex HEAD sha — detached HEAD and unborn branch skip bootstrap). Memory sections: `## Now`, `## Progress`, `## Decisions`, `## Context`, `## Session Log`. The background-memory-update worker uses rename-to-claim for queue consumption (atomically renames `.pending-turns.jsonl` → `.pending-turns.processing`). Disabling memory writes `memory: false` to feature config — hooks remain registered (shared across features). `removeMemoryHooks` (used by `devflow init --no-memory`) also removes legacy hooks from prior architectures. Use `devflow memory --clear` to clean up pending queue files across projects. Zero-ceremony context preservation.

**Ambient Mode**: Two-hook orchestrator system (git repos only) controlled by a single toggle (`devflow ambient --enable/--disable/--status` or `devflow init`). **`session-start-orchestrator`** (SessionStart, presence-gated) — injects the orchestrator charter (~600 tokens) as `additionalContext` at every session start (startup, `/clear`, resume, compact). The charter establishes the main session as a pure orchestrator: delegate work to model-tiered sub-agents (haiku=mechanical, sonnet=defined execution, opus=analysis/design/research) or full devflow workflow skills; keep only judgment work mainline. Also carries a plan-handoff fallback bullet (SessionStart provably fires even when UserPromptSubmit does not). **`preamble`** (UserPromptSubmit, presence-gated) — three behaviors: (1) if prompt begins `Implement the following plan:` (Claude Code's native plan-mode handoff prefix), injects a directive to immediately invoke `devflow:implement`; (2) slash commands (`/...`) are silenced; (3) all other prompts get a 2-line orchestrator reminder. Both hooks are silent outside git repos. Any legacy `commands.md` rule or `session-start-classification` hook from prior installs is auto-removed on every `devflow ambient --enable/--disable` or `devflow init`.

**Learning pipeline** (directive-spawned background Learning agent — scripts capture and trigger only): `capture-prompt`/`capture-turn`/`capture-question` (all always-on) append every user turn, assistant turn, and answered `AskUserQuestion` to `.devflow/learning/.pending-turns.jsonl`, gated by the `learning` field in feature config (config-only, mirroring memory's ADR-001). `session-start-context` Section 2 (SessionStart, always-on) — when the learning queue is non-empty, or a crashed run left a `.pending-turns.processing` batch older than 900s, it resolves the model (project `.devflow/learning/learning.json` → global `~/.devflow/learning.json` → `opus` default) and emits a `--- LEARNING MAINTENANCE ---` directive instructing the main model to **silently** spawn `Agent(subagent_type="Learning", model=<resolved>, run_in_background: true)` **(never narrated in user-visible text)**; a fresh `.processing` suppresses the directive (a live agent owns the batch); queue emptiness is the natural gate, so there is no throttle. The **Learning agent** (`src/assets/agents/learning.md`, opus, self-contained) claims the queue itself (atomic `mv` → `.processing`; merges a stale leftover and re-claims it; exits silently if the claim is lost; heartbeat `touch` at the detection→curation boundary), reads `decisions-log.jsonl`/`decisions.md`/`pitfalls.md`/`.decisions-usage.json` directly, appends/edits observations in the log directly (one JSONL row at a time, never whole-file rewrites), and calls only the ledger ops via its Bash tool: **decision**/**pitfall** detection via `assign-anchor` (internally self-locks `.decisions.lock`; assigns the next ADR-NNN/PF-NNN anchor number into `decisions-ledger.jsonl`, then deterministically renders `decisions.md`/`pitfalls.md`/`index.md` from the ledger — active entries only); post-promotion reinforcement via `refresh-anchor` (strictly re-projects an anchored log row through the same projector as `assign-anchor` and re-renders — the log is the content authority per ADR-022; content changes go to the log, never directly to the ledger); periodic curation via `retire-anchor` (flips `decisions_status`, never deletes) plus `rotate-observations`. Raw observations accumulate in the gitignored `.devflow/learning/decisions-log.jsonl` (rotated to `decisions-log.archive.jsonl`). No deterministic thresholds or confidence formulas — the LLM determines whether an observation warrants a new entry or should be reinforced into an existing one. The agent deletes `.processing` as its final act (consume-then-delete; a crash leaves the batch for the next session's stale-merge recovery) and ends with a 1–3 line summary — native background-task visibility, no status files. Global tuning config: `~/.devflow/learning.json`. Project tuning config: `.devflow/learning/learning.json` (`model` and `debug` only — no daily-run cap or throttle). `devflow learning --disable` flips the config field and drains `.devflow/learning/.pending-turns.jsonl`/`.pending-turns.processing` unconditionally (a mid-run agent whose files vanish aborts without changes — the desired outcome of disabling; mirrors memory.ts's disable-drain). Toggleable via `devflow learning --enable/--disable/--status` or `devflow init --learning/--no-learning`. Management subcommands: `devflow learning --list`, `devflow learning --configure`, `devflow learning --clear/--reset` (both resolve the git root explicitly).

Debug logs stored at `~/.devflow/logs/{project-slug}/`.

**Debug Tracing**: Single global toggle covering all hooks. Enabled via `devflow debug --enable/--disable/--status` CLI or by setting `DEVFLOW_HOOK_DEBUG=1` in `~/.claude/settings.json` env block (survives reinstalls). All hooks share the `src/assets/scripts/hooks/debug-trace` helper script (sourced via `hook-bootstrap`) so tracing behavior is consistent and updated in one place. Two-phase logging: pre-CWD traces go to global `~/.devflow/logs/.hook-debug.log`; post-CWD traces go to per-project `~/.devflow/logs/{project-slug}/.hook-debug.log`. A 5MB size guard prevents unbounded growth. applies ADR-007

**Claude Code Flags**: Typed registry (`src/core/flags.ts`) for managing Claude Code feature flags (env vars and top-level settings). Four kinds: `boolean` (on/off), `enum` (validated domain), `number` (bounded integer), `string` (validated with maxLength). 28 flags total: recommended (default ON) — `tui`, `tool-search`, `lsp`, `prompt-caching-1h`, `show-turn-duration`, `clear-context-on-plan`, `disable-bundled-skills`, `pin-sonnet-4-6`, `max-concurrent-subagents` (number, devflow default 40, upstream default 20); optional boolean (default OFF) — `brief`, `thinking-summaries`, `subprocess-env-scrub`, `disable-nonessential-traffic`, `forked-subagents`, `disable-adaptive-thinking`, `always-thinking`, `disable-git-instructions`, `disable-compact`, `disable-1m-context`, `disable-autoupdater`, `agent-teams`, `enable-todo-tools`; valued (default unset) — `subagent-spawn-depth` (number, upstream default 3), `workflow-size-guideline` (enum: `small|medium|large|unrestricted`), `default-model` (string), `goal-checkin-minutes` (number, upstream default 30 min), `spellcheck` (string), `view-mode` (enum: `default|verbose|focus`, devflow default `default`). Stored in manifest `features.flags: Record<flagId, value|null>` — entry-presence = known, `null` = deliberately unset (neutral, deletes the target key), absent = adopt-on-next-init. Pipeline: `applyFlags(settingsJson, FlagsRecord)` / `stripFlags(settingsJson)` — `applyViewMode`/`stripViewMode` retired; view-mode is an enum flag with `neutralValue: 'default'` (the `viewMode` settings.json key is written only when non-default); `resolveExistingViewMode`/`resolveFinalViewMode` remain exported for init.ts external-mode preservation. `devflow flags` bare on TTY launches the interactive flags editor TUI; bare on non-TTY prints a status table to stdout and exits 1. Registry entries carry a `blurb` field (≤30-char per-flag short hint) shown as a dim HINT column in the TUI and in `--status` rows. Display vocabulary via `effectiveDisplay`: booleans render 'on'/'off' (off is dim); neutral/unset enum shows `neutralValue` dim; unset number shows its applicable default dim with ' (default)' suffix; unset string shows '—' dim; an actively set non-boolean renders plain (at devflow default) or bold (deviating); the literal 'unset' is never a displayed value. TUI rendering: `RunTuiSpec.screen?: 'alt' | 'inline'`; flags editor runs inline (renders in-place in the normal scroll buffer, no alt-screen); agents-view defaults to alt. Manageable via `devflow flags --enable/--disable/--set <id=value>/--unset <ids>/--status/--list`; `--enable`/`--disable` are boolean-only — non-boolean flags are redirected to `--set`.

**Feature Knowledge Bases**: Per-feature `.devflow/features/` directory containing KNOWLEDGE.md files that capture area-specific patterns, conventions, architecture, and gotchas. Uses a **write-through** model: load = direct file-I/O reading `.devflow/features/index.md` (regenerable cache) with frontmatter-glob fallback over `features/*/KNOWLEDGE.md` (source of truth) + verify-against-code on read; save = in-command write-through via a simplified Knowledge agent that writes `KNOWLEDGE.md` + the `index.md` line directly (no `.create-result.json`, no external scripts, no lock). **Git-tracked & shared (amends ADR-021 for `features/`)**: the root `.gitignore` carve-out (`.devflow/*` + level-by-level `!` re-includes, written byte-identically by `ensure-root-gitignore` / `ensureDevflowGitignore`) un-ignores `.devflow/features/index.md` + every `{slug}/KNOWLEDGE.md` while the rest of `.devflow/` stays local; after writing, the **Knowledge agent commits those two paths to the current worktree branch itself** by running git via its Bash tool (scoped `commit --only` pathspec, never `git add -A`, **never push, never force**, no commit script — per the LLM-vs-plumbing principle the commit is the agent's, not a deterministic helper). A user opts back out by re-adding `.devflow/features/` to their own `.gitignore`. Existing installs upgrade once via the versioned `.root-gitignore-configured-v3` marker (v2→v3 adds the `!.devflow/conventions.md` re-include). Freshness = write-through + verify-on-read (NO git-staleness, NO SessionEnd eval, NO Learning task). `index.md` line format: `- **{slug}** — {areas} — {Use-when description}`; frontmatter is authoritative if the line is lost. MDS module: `src/assets/commands/_partials/_knowledge.mds` (defines/exports `knowledge_load` and `knowledge_writeback` partials) + 9 host `.mds` sources in `src/assets/commands/` compiled to `dist/commands/` by `scripts/build-mds.ts` (`npm run build:mds`). `knowledge_load` is used up-front by: implement, plan, resolve, code-review, self-review, research, bug-analysis. `knowledge_writeback` is used at workflow end by: implement, resolve, self-review, explore, debug. explore/debug do NOT load up-front (intentional asymmetry). Config gate: single `knowledge: true|false` in feature config (default true) — gates write-back only; load is ungated. CLI: `devflow knowledge list` (read index.md / frontmatter glob), `devflow knowledge --enable/--disable/--status` (flip config). Note: `/debug` keeps FEATURE_KNOWLEDGE orchestrator-local (investigation workers examine code without pre-loaded context). Toggleable via `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`.

**Rules**: Ultra-concise, always-on engineering principle files (~10-15 lines each) installed to `~/.claude/rules/devflow/` as flat `.md` files. Claude Code loads them automatically on every prompt — no hooks required — filling the guidance gap for quick edits that don't trigger a full skill pipeline. Rules live in `src/assets/rules/` (single source of truth, flat `.md` files) and install directly from there at `devflow init` time — no build step required. Unlike skills (which install universally from all plugins), rules are **plugin-scoped**: only rules belonging to selected plugins are installed. This keeps core rules (`security`, `engineering`, `quality`, `reliability` from `devflow-core-skills`) always present, and language/ecosystem rules (`typescript`, `react`, `go`, etc.) present only when the user has that plugin installed. Shadow overrides: `~/.devflow/rules/{name}.md` overrides the Devflow source. Shadow CLI: `devflow rules shadow <name>` (creates shadow from installed or built source), `devflow rules unshadow <name>` (removes shadow), `devflow rules list` (validity-annotated list). Toggleable via `devflow rules --enable/--disable/--status/--list` or `devflow init --rules/--no-rules`. Stored in manifest `features.rules: boolean` (self-heals to `true` on old manifests). Currently 13 rules: 4 core + 8 language/UI + 1 feature-owned (compliance — opt-in, installed when compliance is enabled and rules are enabled; not plugin-scoped; managed by the compliance feature). `paths: []` YAML frontmatter must remain — it signals Claude Code to apply the rule globally.

**Compliance**: Built-in regulatory compliance review feature (not a plugin). The compliance skill (`devflow:compliance`) and compliance rule are feature-owned (not plugin-scoped); installed by `convergeComplianceArtifacts` when compliance is enabled (`devflow compliance --enable` or `devflow init --compliance <list>`); opt-in, off by default; managed by `compliance-install.ts`. The skill self-activates when `~/.claude/skills/devflow:compliance/SKILL.md` exists AND the task or diff touches regulated surface (data models, auth flows, logging/observability, payments, IaC, retention); active frameworks = the `references/{id}.md` files present in the installed skill directory. Feature state stored in manifest `features.compliance`. CLI: `devflow compliance --enable/--disable/--status` (toggle the feature), `devflow compliance --set <comma-separated-ids>` (set active frameworks, e.g. `--set gdpr,hipaa`; `--set ""` clears all frameworks). **Dynamic composition** (`src/core/compliance-compose.ts`): SKILL.md and the rule file are composed at install time from per-framework fragment files (`frameworks/{id}/fragment.md` within the compliance skill source) rather than being static blobs. Each fragment has 4 sections — `## Mapping`, `## Reference`, `## Checklist`, `## Rule` — that feed 5 skill tokens (`SCOPE`, `ACTIVE`, `MAPPING`, `CHECKLIST`, `REFERENCES`) and 1 rule token (`RULE_BULLETS`). Reference files (`frameworks/{id}/reference.md` in source) are installed as `references/{id}.md` (installed layout unchanged). Shadow SKILL.md with no tokens passes through byte-identical (C1 passthrough) and `devflow compliance --status` shows `[shadowed, composition skipped]` to flag missing per-framework sections.

**One background pipeline** (toggleable):
- `devflow learning --enable/--disable` — Learning pipeline (decision + pitfall detection, materialized by the directive-spawned Learning agent from the captured queue)

Knowledge write-back is in-command (not a background pipeline): gated by `devflow knowledge --enable/--disable` (flips `knowledge` in feature config); Knowledge agent writes directly at workflow end.

**External Model Routing (Devflow Proxy)**: Routes Devflow agents through GPT models via an OpenAI/Codex subscription using a local relay. Feature state is manifest-gated (like ambient/hud/rules, per ADR-001): `manifest.features.proxy` is the source of truth; `~/.devflow/proxy.json` holds runtime authority (enabled, port, binPath, configPath, resolvedAt, devflowVersion). `~/.devflow/proxy-routing.json` holds the routing config; `buildRoutingConfigJson` writes port-only on a fresh write (no `anthropic` block injected — the relay's own default governs); user-set keys in `logLevel`/`anthropic`/`providers`/`limits` blocks are preserved from existing content; the 0.4.0 routing runtime rejects unrecognised top-level keys and hard-fails on registered legacy keys — `anthropic.streamIdleTimeoutMs`, `limits.connectTimeoutMs`, `limits.maxConcurrentRequests`, `limits.maxBodyBytes`, `limits.maxUpstreamSockets`, `limits.streamIdleTimeoutMs`, `limits.requestTimeoutMs`, `limits.maxSseEventBytes` — which `buildRoutingConfigJson` strips. The `ensure-proxy` hook (SessionStart + UserPromptSubmit, registered/removed by `addProxyHooks`/`removeProxyHooks`) auto-starts the relay when a session begins; hook removal is unconditional on disable. `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` are injected into (and stripped from) `settings.json` at CLI enable/disable time via `applyProxyEnv`/`applyProxyTeardownToSettings`, not by the hook; env stripping is evidence-gated on `~/.devflow/proxy.json` existing (`proxyJsonExists()`); the URL delete is port-scoped to avoid clobbering foreign gateways; preflight refuses a foreign `ANTHROPIC_BASE_URL` before adopting a healthy relay; the `ensure-proxy` hook re-resolves a missing `binPath` before warning. Toggle via `devflow proxy --enable/--disable/--status` or via the Advanced init wizard. Enabling runs `runProxyPreflight` (4 checks: bin, codex auth, port, settings), spawns the relay, then gates on a post-spawn doctor verification against the live relay (doctor requires a running relay to pass); on doctor failure the enable rolls back, killing the relay only if it spawned it. Init runs the same preflight but never spawns or runs doctor — the first session's ensure-proxy hook starts the relay; on init preflight failure: warning + force-disabled, init never aborted (avoids PF-009). Disabling reverts agent frontmatter to Claude defaults but preserves the model mapping for re-enable. Default OFF; Advanced-only — never part of Recommended defaults.

**Per-Agent Model Configuration**: User overrides to agent model assignments persist in `~/.devflow/agent-models.json` (deviations only — absent entry = shipped default). `reapplyAgentMapping` runs after every `devflow init` post-install to re-apply user overrides to freshly copied agent files. `revertExternalAgents` reverts all agents to shipped defaults (called on proxy disable and before agent removal on uninstall). GPT model assignments are **dormant** when routing is off — they are stored in `agent-models.json` but not written to agent frontmatter until routing is enabled. Manage via `devflow agents` TUI or `devflow agents --list/--set/--reset`. Core source files: `src/core/agent-frontmatter.ts` (pure rewrite engine), `src/core/agent-models.ts` (schema + apply/revert), `src/core/external-models.ts` (CLAUDE_MODEL_ALIASES, isClaudeModelName, isDormantExternalModel — leaf module), `src/core/model-discovery.ts` (discoverExternalModels, getExternalModelsCached, cache-warming), `src/core/cache.ts` (cache read/write, 0700/0600 permissions, parseRawEnvelope), `src/core/proxy-log.ts` (scrubChildEnv, openProxyLog, relay env allowlisting), `src/core/proxy-state.ts` (state I/O), `src/cli/commands/proxy.ts` (CLI + hook wiring), `src/cli/commands/agents.ts` (CLI), `src/cli/agents-view/` (TUI — state, render, terminal; thin adapter over the shared `src/cli/tui/` driver).

**Two-Mode Init**: `devflow init` offers Recommended (sensible defaults, quick setup) or Advanced (full interactive flow) after plugin selection. `--recommended` / `--advanced` CLI flags for non-interactive use. Recommended applies: ambient ON, memory ON, learning ON, rules ON, HUD ON, default-ON flags, .claudeignore ON, auto-install safe-delete if trash CLI detected, user-mode security deny list, viewMode preserved from existing settings.json. Both init paths apply seeded flag values non-interactively — fresh install: registry defaults; re-init: existing manifest values preserved, defaults adopted only for newly-added flags (ADR-014); `view-mode` resolved from existing settings.json at seed time — and emit an outcome line pointing to `devflow flags` for customization. Advanced path adds a proxy prompt (external model routing — default OFF, requires Codex auth; never part of Recommended defaults). Use `--learning/--no-learning` to toggle the learning agent independently. Use `--rules/--no-rules` to toggle rules independently. Use `--proxy/--no-proxy` to set external model routing (Advanced-only; init runs preflight on enable). Use `--compliance <list>`/`--no-compliance` to set compliance non-interactively (enable with comma-separated framework IDs or disable preserving frameworks; default: off; `--compliance`/`--no-compliance` bypasses the wizard entirely). The compliance wizard step (select which regulatory frameworks to install — GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX) runs in **both** init paths via `shouldRunComplianceStep`: Advanced always runs it; Recommended only runs it when the user reached the mode-select prompt interactively (`modePromptShown=true`) — `--recommended` flag and non-TTY invocations preserve their promptless contracts. The step shows a "Current setting:" note for re-init legibility, uses a `p.select` (Yes/No) instead of a confirm to avoid Enter-through ambiguity, and emits an outcome line for unambiguous state visibility (per PF-029). **State-aware re-init**: on re-init the wizard reads the prior manifest, config, and settings.json and pre-seeds every prompt with existing values, skipping the Recommended/Advanced question entirely. Use `--reset` for a factory reset that ignores all prior state (mutually exclusive with `--plugin`).

**Migrations**: Run-once migrations execute automatically on `devflow init`, tracked at `~/.devflow/migrations.json` (scope-independent; single file regardless of user-scope vs local-scope installs). To add a 2.x migration, append an entry to `MIGRATIONS` in `src/core/migrations.ts`. Scopes: `global` (runs once per machine, no project context) vs `per-project` (sweeps all discovered Claude-enabled projects in parallel). Failures are non-fatal — migrations retry on next init. The registry holds 2.x entries only (first: canonicalise-agent-keys-v1); no 1.x upgrade path.

## Project Structure

```
devflow/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── cli/                # CLI command modules (init, init-seed, uninstall, ambient, learning, flags, knowledge, rules, debug, hud, proxy, agents, compliance)
│   │   ├── tui/            # Generic TUI shell — runTui<S,A> driver, normalizeKey, cell helpers
│   │   ├── flags-view/     # Claude Code flags editor TUI — standalone `devflow flags` command, inline screen mode (state.ts, render.ts, terminal.ts, index.ts)
│   │   └── agents-view/    # Per-agent model config TUI (state.ts, render.ts, terminal.ts) — adapter over tui/
│   ├── core/               # Shared logic (plugins.ts registry, paths.ts, assets.ts, flags.ts, fs-atomic.ts, migrations.ts, agent-frontmatter.ts, agent-models.ts, external-models.ts, proxy-state.ts, …)
│   ├── hud/                # HUD module (TypeScript source — index.ts, render.ts, components/, …)
│   ├── targets/claude-code/ # Claude Code install target (installer, hooks.ts, post-install, claude-paths, legacy, templates/)
│   └── assets/             # All installable assets (single source of truth)
│       ├── skills/         # 41 skills
│       ├── agents/         # 16 agents
│       ├── rules/          # 13 rules (flat .md files)
│       ├── commands/       # MDS command sources (13 hosts + 11 partials in _partials/; 1 static .md)
│       └── scripts/hooks/  # Capture + memory + learning + ambient + proxy hooks (capture-prompt, capture-turn, capture-question, queue-append, memory-worker, background-memory-update [Stop-hook worker], learning-lock, session-start-memory, session-start-context, session-start-orchestrator, pre-compact-memory, preamble, ensure-proxy [SessionStart+UserPromptSubmit, registered/removed by addProxyHooks/removeProxyHooks], git-marker [sourced git-repo helper], get-mtime, hook-bootstrap, hook-log-init)
│           └── assets/     # Static prose assets shipped with hooks (orchestrator-charter.md)
├── scripts/                # Dev tooling (build-mds.ts, bump-version.ts)
├── docs/reference/         # Detailed reference documentation
├── .devflow/               # Per-project runtime data — local by default; EXCEPTION: features/ knowledge bases (index.md + {slug}/KNOWLEDGE.md) are tracked & shared via git (ensure-root-gitignore writes the carve-out)
│   ├── docs/               # Project docs (reviews, design)
│   ├── memory/             # Working memory files
│   ├── learning/           # Learning agent observations, queue, and ADR/PF files
│   └── features/           # Per-feature knowledge bases — index.md + {slug}/KNOWLEDGE.md tracked & shared via git; rest of .devflow/ local
├── .release/               # Release configuration (lazy-init)
│   ├── RELEASE-FLOW.md     # Learned release process config
│   ├── .gitignore          # Excludes .progress.json, .lock/
│   └── .progress.json      # Mid-release checkpoint (transient)
```

**Install paths**: Commands → `~/.claude/commands/devflow/`, Agents → `~/.claude/agents/devflow/`, Skills → `~/.claude/skills/devflow:*/` (namespaced), Rules → `~/.claude/rules/devflow/` (flat, plugin-scoped), Scripts → `~/.devflow/scripts/`

Compiled commands (`dist/commands/*.md` — output of `npm run build:mds`) are the deployed command artifacts installed under `~/.claude/commands/devflow/`.

## Development Loop

```bash
# 1. Edit source files
vim src/assets/commands/code-review.mds     # Commands (MDS sources; .md for static commands)
vim src/assets/agents/code.md              # Agents
vim src/assets/skills/security/SKILL.md     # Skills
vim src/assets/rules/security.md            # Rules

# 2. Build
# Skills, agents, and rules: no build step — edits take effect on next install
# Commands (.mds sources): compile to dist/commands/
npm run build:mds
# Full build (TypeScript + MDS):
npm run build

# 3. Reinstall to global context
node dist/cli.js init                       # All plugins
node dist/cli.js init --plugin=code-review       # Single plugin

# 4. Test immediately
/code-review
```

**Build commands**: `npm run build` (full — TypeScript + MDS), `npm run build:cli` (TypeScript only), `npm run build:mds` (compile all 13 MDS host commands from `src/assets/commands/` to `dist/commands/`)

## Documentation Artifacts

All generated docs live under `.devflow/docs/` in the project root:

```
.devflow/docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   ├── .last-review-head              # HEAD SHA for incremental reviews
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Review agent reports (security.md, etc.)
│       ├── review-summary.md          # Synthesize agent output
│       └── resolution-summary.md      # Written by /resolve
├── bug-analysis/{branch-slug}/         # Bug analysis reports per branch
│   ├── .last-analysis-head            # HEAD SHA for incremental analysis
│   └── {timestamp}/                   # Timestamped analysis directory
│       ├── {focus}.md                 # Analyzer reports (security.md, functional.md, etc.)
│       ├── static-findings.md         # Raw static analysis tool output
│       ├── bug-analysis-summary.md    # Synthesize agent output
│       └── resolution-summary.md      # Written by /resolve (when resolving bug-analysis issues)
├── design/                            # Design artifacts from /plan
├── tickets/{slug}/                    # Ticket sets from /dynamic-tickets
│   └── {YYYY-MM-DD_HHMM}/            # Timestamped ticket directory
│       ├── {ticket-slug}.md           # Individual ticket files
│       └── tracking-issue.md          # Tracking issue body (GitHub sync)
├── waves/{slug}/                      # Wave run reports from /dynamic-build
│   └── {YYYY-MM-DD_HHMM}/            # Timestamped wave directory
│       └── wave-report.md             # Wave run summary and status
└── research/{topic-slug}/             # Research artifacts per topic
    └── {YYYY-MM-DD_HHMM}/            # Timestamped research directory
        ├── {type}.md                  # Research agent outputs (codebase.md, external.md, etc.)
        └── research-summary.md        # Synthesize agent output
```

Per-project runtime files live under `.devflow/`:

```
.devflow/
├── memory/
│   ├── WORKING-MEMORY.md             # Auto-maintained by background-memory-update worker (claude -p sonnet 4.6); line 1: <!-- memory-head: <sha> branch: <name> --> (stamp written by the worker on every swap; also by the pre-compact-memory bootstrap when the file is absent)
│   ├── WORKING-MEMORY.md.new         # Staged file written by the worker; renamed to WORKING-MEMORY.md on successful CAS (transient, ADR-023)
│   ├── backup.json                   # Pre-compact git state snapshot (plain JSON — no stamp)
│   ├── .pending-turns.jsonl          # Queue of captured user/assistant turns (JSONL, ephemeral)
│   ├── .pending-turns.processing     # Atomic handoff during background processing (transient, D56c)
│   ├── .working-memory-last-trigger  # Mtime = last worker spawn time (120s throttle key, transient)
│   ├── .last-refresh-ok              # Mtime = last successful WORKING-MEMORY.md write (transient)
│   └── .working-memory.lock/         # Worker lock dir — 300s stale-break (transient, never tracked)
├── config.json                   # Feature toggles {memory, learning, knowledge, reviewPublication} — neutral root, not inside learning/
├── learning/
│   ├── decisions-ledger.jsonl    # Anchored ledger (gitignored by default) — anchor registry only (ADR-022); content authority is the log; one row per ADR/PF incl. retired
│   ├── decisions-log.jsonl       # Raw decision/pitfall observations — content authority (ADR-022); log rows are projected → ledger → .md by the four ledger ops (JSONL, gitignored)
│   ├── decisions-log.archive.jsonl # Archived observation rows >30d, moved by rotate-observations (gitignored)
│   ├── learning.json             # Project-level learning agent tuning config (model, debug only)
│   ├── .decisions.lock           # Lock directory for assign-anchor/retire-anchor/refresh-anchor writers (transient)
│   ├── .pending-turns.jsonl      # Learning detection queue (ephemeral)
│   ├── .pending-turns.processing # Learning agent's atomic claim — deleted as the agent's final act; treated as crashed at 900s
│   ├── decisions.md              # Architectural decisions (ADR-NNN) — rendered from decisions-ledger.jsonl (active only) by the Learning agent via assign-anchor + render-decisions
│   ├── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas) — rendered from decisions-ledger.jsonl (active only) by the Learning agent via assign-anchor + render-decisions
│   └── index.md                  # Compact write-time ADR/PF index rendered from decisions-ledger.jsonl by render-decisions.cjs alongside decisions.md/pitfalls.md; consumed by workflow commands via plain Read
├── conventions.md                # Naming conventions authority (Branch Naming, PR Titles, Version PR Titles, Version Names, Branching Model) — GIT-TRACKED; written by Git learn-conventions; re-learn by deleting the file
└── features/                     # Per-feature knowledge bases — index.md + {slug}/KNOWLEDGE.md tracked & shared via git; rest local
    ├── {slug}/KNOWLEDGE.md
    └── index.md                  # Regenerable cache (line format: `- **{slug}** — {areas} — {Use-when}`); frontmatter is authoritative if absent

~/.devflow/
├── proxy.json                         # Proxy runtime state (enabled, port, binPath, configPath, resolvedAt, devflowVersion) — global, not per-project
├── proxy-routing.json                 # Routing config (port-only by default; user-set anthropic/logLevel/providers/limits preserved) read by the ensure-proxy hook
├── proxy.pid                          # Relay PID — written by CLI enable and by the ensure-proxy hook spawn (transient)
├── .proxy-spawn.lock/                 # Hook spawn lock dir — prevents concurrent session double-spawn (transient)
├── agent-models.json                  # Per-agent model overrides (deviations only; absent = shipped default)
├── cache/models/                      # External model catalog cache (0700/0600) — populated by discoverExternalModels; removed on uninstall
├── logs/proxy.log                     # Proxy relay stdout/stderr — global path (single relay serves all projects)
└── logs/{project-slug}/
    ├── .capture-turn.log              # capture-turn (Stop hook) log
    └── .background-memory-update.log  # background-memory-update worker log
```

**Naming conventions**: Timestamps as `YYYY-MM-DD_HHMM`, branch slugs replace `/` with `-`, topic slugs are lowercase-dashes.

**Persisting agents**: Review → `.devflow/docs/reviews/{branch-slug}/{timestamp}/{focus}.md`, Synthesize → `.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (review mode) / `.devflow/docs/research/{topic-slug}/{timestamp}/research-summary.md` (research mode) / `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/bug-analysis-summary.md` (bug-analysis mode), Research → `.devflow/docs/research/{topic-slug}/{timestamp}/{type}.md`, Diagnose → `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/{focus}.md`, Code (issue-fix mode) → commits + `## Verification` block in resolution-summary.md, Working Memory → `.devflow/memory/WORKING-MEMORY.md` (automatic)

**Incremental Reviews**: `/code-review` writes reports into timestamped subdirectories (`YYYY-MM-DD_HHMM`) and tracks HEAD SHA in `.last-review-head` for incremental diffs. Second review only diffs from last reviewed commit. `/bug-analysis` has an analogous mechanism: it tracks HEAD SHA in `.last-analysis-head` and only analyzes commits since the last analysis run. `/resolve` defaults to the latest timestamped directory in whichever doc path (reviews or bug-analysis) matches the current workflow. `/code-review` auto-discovers git worktrees and processes all reviewable branches in parallel. `/bug-analysis` operates on the current branch only (single-worktree). Multi-cycle convergence detection: loads the prior `resolution-summary.md` as `PRIOR_RESOLUTIONS` so Review agents avoid re-raising resolved false positives; at cycle 3+ the FP ratio is computed and a warning is emitted when it exceeds 70% (suggesting merge or manual inspection). At MAX_REVIEW_CYCLES (10) a warning is emitted but the pipeline continues — convergence info is surfaced in the Synthesize agent's Convergence Status section, never blocking. PR-comment publication is visibility-gated (D10, fail-closed to a counts-only stub on public/unknown repos; `reviewPublication: auto|full|off` in `.devflow/config.json`) and every posted body passes the deterministic secret scrubber (D11, unconditional; a missing or failing scrubber emits `TRACEABILITY: DEGRADED (redaction unavailable)` and suppresses the post rather than publishing unredacted content).

**Code Agent Handoff Artifact**: Sequential Code agent phases write `.devflow/docs/handoff-{branch_slug}.md` after each phase (branch-scoped to prevent concurrent session clobber). Survives context compaction (unlike PRIOR_PHASE_SUMMARY). Every Code agent reads it via HANDOFF_FILE input. Deleted by `/implement` command after pipeline completes.

**Universal Skill Installation**: All skills from all plugins are always installed, regardless of plugin selection. Skills are tiny markdown files installed as `~/.claude/skills/devflow:{name}/` (namespaced to avoid collisions with other plugin ecosystems). Source directories in `src/assets/skills/` stay unprefixed — the `devflow:` prefix is applied at install-time only. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); when shadowed, the installer copies the user's version to the prefixed install target. Only commands and agents remain plugin-specific. Exception: the `compliance` skill is feature-owned (not plugin-scoped) and managed independently by the compliance feature via `compliance-install.ts`.

**Model Strategy**: Explicit model assignments in agent frontmatter override the user's session model. Opus for analysis agents (review, scrutinize, evaluate, design, research, diagnose, learning, triage), Sonnet for execution agents (code, simplify, skim, test, knowledge), Haiku for I/O agents (git, synthesize, validate). The Learning agent's spawn directive additionally resolves a per-project model override (project `.devflow/learning/learning.json` → global `~/.devflow/learning.json` → `opus`). Memory is refreshed by the detached `background-memory-update` worker (`claude -p --model claude-sonnet-4-6`), spawned by the `memory-worker` Stop hook. Knowledge is not a background worker — the Knowledge agent (sonnet) is spawned in-command by `knowledge_writeback()` at workflow end. **Per-agent overrides**: users can assign custom models (including GPT models when routing is enabled) via `devflow agents`. Overrides persist in `~/.devflow/agent-models.json` and are re-applied by `reapplyAgentMapping` on every `devflow init`.

## Agent & Command Roster

**Orchestration commands** (spawn agents, never do agent work in main session):
- `/plan` — Skim + Explore + Design + Synthesize + Plan + Design + Git (ensure-traceable-issue) → design artifact; consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/implement` — Git + Code + Validate + Simplify + Scrutinize + Evaluate + Test → PR (accepts plan documents, issues, or task descriptions)
- `/code-review` — 8-12 Review + Git + Synthesize; consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/resolve` — Triage (opus, global triage via blast-radius matrix) + Code × N (issue-fix, PUSH: false) + Validate (verification gate) + Git; consumes decisions via `DECISIONS_CONTEXT`; Triage cites ADR-NNN/PF-NNN in verdict ledger; resolution-summary.md includes `## Verification`, `## By Design`, `## Fix Separately`, `## Escalations`, `## Third-Party Threads` sections
- `/explore` — Skim + Explore + Synthesize + Knowledge (optional knowledge base creation)
- `/debug` — competing hypotheses debugging
- `/self-review` — Simplify then Scrutinize (sequential); consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/research` — Research + Skim + Synthesize + Knowledge; multi-type research with trust-aware synthesis
- `/release` — Git + Validate + Synthesize; adaptive release with learned configuration
- `/bug-analysis` — Diagnose + Git + Synthesize; proactive bug finding with static and semantic analysis, incremental by default

**Shared agents** (16): git, synthesize, skim, simplify, code, review, triage, evaluate, test, scrutinize, validate, design, knowledge, research, diagnose, learning

## Key Conventions

### Skills

- 3-tier system: Foundation (shared patterns), Specialized (auto-activate), Domain (language/framework)
- Each skill has one non-negotiable **Iron Law** in its `SKILL.md`
- Target: ~120-150 lines per SKILL.md with progressive disclosure to `references/`
- Skills default to read-only (`allowed-tools: Read, Grep, Glob`); exceptions: git/review skills add `Bash`, interactive skills add `AskUserQuestion`, `quality-gates` adds `Write` for state persistence
- All skills live in `src/assets/skills/` — add the skill name to the plugin's `skills` array in DEVFLOW_PLUGINS (`src/core/plugins.ts`); no rebuild required, edits take effect on next `node dist/cli.js init`

### Agents

- Target: 50-150 lines depending on type (Utility 50-80, Worker 80-120)
- Reference skills via frontmatter, don't duplicate skill content
- Use `tools` frontmatter to platform-restrict agent tool access (prefer over prompt-level prohibitions)
- Define clear input/output contracts and escalation boundaries
- Shared agents live in `src/assets/agents/` — add to the plugin's `agents` array in DEVFLOW_PLUGINS (`src/core/plugins.ts`)

### Commands

- Commands are orchestration-only — spawn agents, never do agent work in main session
- Author as `.mds` sources in `src/assets/commands/` (or static `.md` for commands with no MDS partials); compiled output lands in `dist/commands/`
- Register new plugins in `DEVFLOW_PLUGINS` in `src/core/plugins.ts`

### Commits

Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

## Critical Rules

### Git Safety
- Run git commands sequentially, never in parallel
- Never force push without explicit user request

### Build System
- `src/assets/skills/`, `src/assets/agents/`, and `src/assets/rules/` are the single source of truth — no generated copies anywhere in the repo
- Skill, agent, and rule edits take effect on the next `node dist/cli.js init` with no rebuild required
- Command sources (`.mds` and `.md` files in `src/assets/commands/`) compile to `dist/commands/` via `npm run build:mds`; run this after editing any `.mds` file
- Plugins are registry entries in DEVFLOW_PLUGINS (`src/core/plugins.ts`) — `skills`, `agents`, `rules`, and `commands` arrays declare what each plugin owns
- Rules are flat `.md` files (no subdirectory nesting) in `src/assets/rules/{name}.md`; the installer validates against the registry

### Token Optimization
- Subagent nesting is real since Claude Code 2.1.219 (upstream spawn-depth default 3, deliberately kept; tunable via `devflow flags --set subagent-spawn-depth=N`); nested fan-outs share the concurrency pool — `max-concurrent-subagents` default 40 is sized for typical devflow parallel waves
- Use parallel execution where possible
- Leverage `.claudeignore` for context reduction

## Reference Documents

For detailed specifications beyond this overview:

- **Skills architecture**: `docs/reference/skills-architecture.md` — tier catalog, templates, creation guide, activation patterns
- **Agent design**: `docs/reference/agent-design.md` — templates, anti-patterns, quality checklist
- **Adding commands**: `docs/reference/adding-commands.md` — command template, plugin registration
- **Release process**: `docs/reference/release-process.md` — CI-driven one-click releases via GitHub Actions `workflow_dispatch`
- **File organization**: `docs/reference/file-organization.md` — source tree, build distribution, install paths, settings
- **Docs framework skill**: `src/assets/skills/docs-framework/SKILL.md` — documentation naming conventions and templates
