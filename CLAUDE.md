# Devflow Development Guide

Instructions for developers and AI agents working on Devflow. For user docs, see README.md.

## Purpose

Devflow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Registry-driven CLI tool with 21 plugins (12 core + 9 optional). Plugins are entries in DEVFLOW_PLUGINS in `src/core/plugins.ts` — each entry declares its `commands`, `agents`, `skills`, and `rules` arrays. All assets live once in `src/assets/`; most install directly, and `.mds` sources compile via `npm run build:mds` — command hosts to `dist/commands/`, agent generator hosts to `dist/agents/`, and reference modules in `src/assets/mds/` to `dist/skills/git/references/`.

**LLM-vs-plumbing principle**: The LLM does all detection, semantic matching, materialization, and curation — and reads/edits the data files directly. Deterministic code is plumbing only: hooks, locks, throttles, file I/O, `assign-anchor`/`retire-anchor`/`refresh-anchor` ledger numbering and re-projection, `render-decisions` rendering (decisions.md + pitfalls.md + index.md), and `rotate-observations` archival. No detection or judgment logic lives in shell or TypeScript.

**Runtime data**: `.devflow/` is local by default except `features/` (`index.md` + `{slug}/KNOWLEDGE.md`) and `conventions.md`, which are git-tracked. `conventions.md` is the naming-conventions authority; re-learn it by deleting the file. The per-repo `tracker` key in `.devflow/config.json`: absent ≠ github — absent requests ref-grammar corroboration. `~/.devflow/tracker.md` is user content: kept on uninstall, moved aside as `tracker.md.{previous}.bak` on a provider change.

**Feature Knowledge Bases**: `.devflow/features/index.md` + every `{slug}/KNOWLEDGE.md` are git-tracked and shared through the root `.gitignore` carve-out (written byte-identically by `ensure-root-gitignore` / `ensureDevflowGitignore`). After writing, the **Knowledge agent commits those two paths to the current worktree branch itself** (scoped `commit --only` pathspec, never `git add -A`, **never push, never force**, no commit script). A user opts back out by re-adding `.devflow/features/` to their own `.gitignore`. `knowledge: true|false` in feature config gates write-back only; load is ungated, and explore/debug do NOT load up-front (intentional asymmetry). Freshness = write-through + verify-on-read (NO git-staleness, NO SessionEnd eval, NO Learning task).

**Rules**: plugin-scoped flat `.md` files in `src/assets/rules/`, installed to `~/.claude/rules/devflow/` for the selected plugins only (the compliance rule is feature-owned). Shadow overrides: `~/.devflow/rules/{name}.md`. `paths: []` YAML frontmatter must remain — it signals Claude Code to apply the rule globally.

**Selection-scoped Skill Installation**: skills install for the plugins you selected plus every skill those plugins declare in `requires:`, as `~/.claude/skills/devflow:{name}/`. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); a shadow whose skill is outside the selection is dormant — kept in `~/.devflow/skills/`, never installed, never deleted. Deselecting a plugin removes only the skills no remaining selected plugin owns or requires. Exception: the `compliance` skill is feature-owned (not plugin-scoped).

**Compliance**: feature-owned regulatory review (not a plugin), off by default; toggled by `devflow compliance --enable/--disable/--set <ids>`, installed by `src/targets/claude-code/compliance-install.ts` and composed from per-framework fragments by `src/core/compliance-compose.ts`.

**Claude Code Flags**: the typed registry and its rules live in `src/core/flags.ts` (registry + JSDoc); manage with `devflow flags`. `--enable`/`--disable` are boolean-only — non-boolean flags use `--set`. Enabling `suppress-attribution` overwrites any existing `attribution` value; disable only deletes the exact devflow shape, never a user's custom attribution. Narrow boolean flags with `isEnvBooleanFlag` — a `target.type` check does not narrow `onPayload`. The literal 'unset' is never a displayed value.

**Model Strategy**: an explicit `model:` in agent frontmatter overrides the user's session model. The Tracker agent's tier is a constant with no tuning config: the hook's `TRACKER_MODEL` literal is `case`-allowlisted and pinned equal to `loadShippedDefaults()['tracker']`. The memory worker runs `claude -p --model claude-sonnet-4-6`. Users override per agent via `devflow agents`; overrides persist in `~/.devflow/agent-models.json` and are re-applied on every `devflow init`.

**Review publication**: PR-comment publication is visibility-gated (D10, fail-closed to a counts-only stub on public/unknown repos; `reviewPublication: auto|full|off` in `.devflow/config.json`) and every posted body passes the deterministic secret scrubber (D11, unconditional; a missing or failing scrubber emits `TRACEABILITY: DEGRADED (redaction unavailable)` and suppresses the post rather than publishing unredacted content). File sinks chain the scrubber with `&&`, so a non-zero exit means the write does not happen. Tool-call sinks use `redact-secrets.cjs --emit`, which frames the result as `D11-OK <nonce> <sha256> <bytes> <n> [type:count,…]` with a per-invocation 32-hex nonce (an unframed `D11-OK` literal is forgeable by anyone who can write an issue comment), prints `D11-FAIL <reason>` with an **empty body** on every non-zero path, and requires the consumer to verify the received body's byte length against `<bytes>` before posting [DR-06]. Review-cycle convergence warnings never block the pipeline.

**Tracker**: Built-in issue-tracker provider selection (not a plugin) over `github | jira | linear`. The provider is chosen at `devflow init` (wizard, or `--tracker <id>`) and stored machine-wide in `manifest.features.tracker.provider`, default `github`. The build compiles every provider; the install is scoped to the selection. The installer overlays the PR-host, cross-cutting and `{github} ∪ {selected provider}` generated references onto the `devflow:git` skill — 21 files for `github`, 32 for `jira`/`linear` — and the tool-call contract `references/tracker/_mcp.md` and the Tracker agent file land only for `jira`/`linear`. Section 3 of `session-start-context` always installs and gates at runtime. Skills are scoped the same way: each plugin declares the skills it uses but does not own in a `requires:` list, a bidirectional closure guard holds that list against commands, agents and skill bodies, and the Review agent's focus-templated skill reference is the one classified exception. `/code-review`'s language focuses are presence-gated on the skill being installed.

**Tracker operations**: the Git agent resolves the provider once per spawn, reading BOTH the per-repo `tracker` key in `.devflow/config.json` and `manifest.features.tracker.provider` before it decides, falling back to `github`. Under a non-`github` provider `references/tracker/_mcp.md` is a fixed per-spawn load — the tool-call contract. Servers are scoped per capability: the unique qualifying server wins, two or more is a degraded run with no call. A reference renders by the resolved provider's own documented default; release evidence is gathered in the provider's own reference grammar with project-key equality, never a bare number. A refusal reports `TRACEABILITY: DEGRADED (<reason>)`, and each actionable reason implies its remedy: `tracker not configured` — select a provider; `tracker configuration mismatch (repository override)` or `(conventions file)` — the conventions file names another provider, so re-select or delete it; `tracker.md required fields incomplete` — edit `~/.devflow/tracker.md`; `no tracker tool for {capability}` — connect a server offering it; `redaction unavailable` — the scrubber could not run, so nothing posts. On Linear `dedup unavailable — duplicate possible` is permanent: the workspace cannot tell devflow which account it is, so a back-link posts with that warning rather than being withheld.

**Tracker lifecycle**: `devflow init --tracker <id>` selects non-interactively. `devflow tracker --set <id>` converges every artifact in a fixed order — references, stale-conventions rename, manifest, Tracker agent file, attempt counter, sentinel — in both directions, so selecting `github` removes what `jira`/`linear` installed; it exits 1 — manifest, sentinel and conventions untouched — when `devflow:git` is absent or the overlay fails. `devflow tracker --status` reports the provider, whether conventions have been learned, and a `Mechanics:` line counting the installed reference files. On a non-`github` provider a background Tracker agent runs once at a session start, takes an observable claim (`CLAIMED`, or `LOST` and an immediate exit if another run holds it), and writes `~/.devflow/tracker.md` exactly once or not at all, scrub-gated fail-closed, with `# UNRESOLVED:` lines for what it could not establish. That file is yours: hand-editable, kept on uninstall, moved aside as `tracker.md.{previous}.bak` on a provider change. `--tracker github` is the off switch.

## Development Loop

```bash
# 1. Edit source files
vim src/assets/commands/code-review.mds     # Commands (MDS sources; .md for static commands)
vim src/assets/agents/code.md              # Agents (hand-authored)
vim src/assets/agents/git.mds              # Agents (MDS generator host → dist/agents/git.md)
vim src/assets/mds/tracker/_github.mds      # Reference modules (→ dist/skills/git/references/; also mds/git/_pr.mds)
vim src/assets/skills/security/SKILL.md     # Skills
vim src/assets/rules/security.md            # Rules

# 2. Build
# Skills, rules, and hand-authored agents: no build step — edits take effect on next install
# Commands (.mds sources) → dist/commands/; agent generator hosts (.mds) → dist/agents/;
# reference modules (src/assets/mds/**.mds) → dist/skills/git/references/
npm run build:mds
# Full build (TypeScript + MDS):
npm run build

# 3. Reinstall to global context
node dist/cli.js init                       # All plugins
node dist/cli.js init --plugin=code-review       # Single plugin

# 4. Test immediately
/code-review
```

**Build commands**: `npm run build` (full — TypeScript + MDS), `npm run build:cli` (TypeScript only — **does not produce installable agents**; a generator host stays uncompiled and the installer has nothing in `dist/agents/` to prefer), `npm run build:mds` (compile every MDS host: command hosts in `src/assets/commands/` → `dist/commands/`, agent generator hosts in `src/assets/agents/` → `dist/agents/`, reference modules in `src/assets/mds/` → `dist/skills/git/references/`), `npm run test:golden:update -- <target>` (`git-agent` regenerates the Git-agent golden in a fixture-only commit; `github-status-lines` refuses without `--unfreeze`)

The host and partial rosters are named in `tests/fixtures/mds-manifest.ts` rather than counted, and the build's own printed counts are asserted against it.

## Key Conventions

### Skills

- Each skill has one non-negotiable **Iron Law** in its `SKILL.md`
- Skills default to read-only (`allowed-tools: Read, Grep, Glob`); exceptions: git/review skills add `Bash`, interactive skills add `AskUserQuestion`, `quality-gates` adds `Write` for state persistence
- Source directories in `src/assets/skills/` stay unprefixed — the `devflow:` prefix is applied at install time only

### Agents

- Reference skills via frontmatter, don't duplicate skill content
- Use `tools` frontmatter to platform-restrict agent tool access (prefer over prompt-level prohibitions)
- An agent is either a hand-authored `src/assets/agents/{name}.md` or an MDS generator host `{name}.mds` that declares `output-dir: dist/agents` in a leading steering block and compiles to `dist/agents/{name}.md`; an agent never has both
- Two agents are **hook-spawned, never workflow roster members** — `learning` (the session-start learning directive) and `tracker` (the session-start tracker-setup directive). Neither has a `_roster.mds` row, and no command spawns either; `tracker` sits in `devflow-core-skills`, whose empty `commands: []` is what makes the registry's reverse spawn check skip it structurally rather than by exemption.

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
- `src/assets/` is the single source of truth, and **generated files never live in `src/`** — every compiled artifact lands under `dist/`
- Skill, rule and hand-authored agent edits take effect on the next `node dist/cli.js init` with no rebuild required. An MDS generator host `src/assets/agents/{name}.mds` must be compiled to `dist/agents/{name}.md` first; the compiled artifact wins over the src tree for a generated agent
- Run `npm run build:mds` after editing any `.mds` file; reference modules compile to one file per (module, operation) pair, named from the registry in `src/core/mds-variants.ts`, which the installer overlays onto the installed `devflow:git` skill
- Plugins are registry entries in DEVFLOW_PLUGINS (`src/core/plugins.ts`) — `skills`, `agents`, `rules`, and `commands` arrays declare what each plugin owns
- Rules are flat `.md` files (no subdirectory nesting) in `src/assets/rules/{name}.md`; the installer validates against the registry

### Test Ratchets
- `tests/fixtures/numeric-floors.json` is a hand-registered ratchet manifest — floors raise, never lower; ceilings lower, never raise

## Reference Documents

For detailed specifications beyond this overview:

- **Skills architecture**: `docs/reference/skills-architecture.md` — tier catalog, templates, creation guide, activation patterns
- **Agent design**: `docs/reference/agent-design.md` — templates, anti-patterns, quality checklist
- **Adding commands**: `docs/reference/adding-commands.md` — command template, plugin registration
- **Release process**: `docs/reference/release-process.md` — CI-driven one-click releases via GitHub Actions `workflow_dispatch`
- **File organization**: `docs/reference/file-organization.md` — source tree, build distribution, install paths, settings
- **Docs framework skill**: `src/assets/skills/docs-framework/SKILL.md` — documentation naming conventions and templates
- **Platform assumptions**: `docs/reference/platform-assumptions.md` — Claude Code behavioural assumptions devflow agents and tests rely on, including subagent nesting and concurrency; each entry carries a date stamp and an observable drift symptom
- **Hooks & background workers**: `docs/reference/hooks.md` — Working Memory, Ambient Mode, Learning pipeline, Debug Tracing (`devflow debug --enable` or `DEVFLOW_HOOK_DEBUG=1`)
- **External model routing**: `docs/reference/proxy.md` — Devflow Proxy relay, routing config, enable/disable lifecycle
- **Init**: `docs/reference/init.md` — Two-Mode Init, wizard-step gating, state-aware re-init and `--reset`
