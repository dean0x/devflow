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

**LLM-vs-plumbing principle**: The LLM does all detection, semantic matching, materialization, and curation — it reads the learning data through the `list`/`show` ops and writes it through `put-observation` and the other ops, never by editing the files. Deterministic code is plumbing only: hooks, locks, throttles, file I/O, the learning ops' input validation, `assign-anchor` numbering, re-projection and status changes, `claim-due` due selection, the queue claim, `render-decisions` rendering (decisions.md + pitfalls.md + index.md), and `rotate-observations` archival. No detection or judgment logic lives in shell or TypeScript. Ledger IDs are machine-local, so committed and posted text states a decision in words, never by its ID.

**Runtime data**: one install per machine, no install scope: `~/.devflow` is the machine root (`DEVFLOW_DIR` is ignored) and the Claude Code directory is `$CLAUDE_CONFIG_DIR` (absolute) else `~/.claude`. `init --scope local` exits 1; `uninstall --scope local` removes a legacy repo-local install without touching HOME. A repo's `.devflow/` is local by default except `features/` (`index.md` + `{slug}/KNOWLEDGE.md`), `conventions.md`, `policy.json` and `project.json`, which are git-tracked. `conventions.md` is the naming-conventions authority, learned only when `APPLY_CONVENTIONS` is `true`; re-learn it by deleting the file. `project.json` holds the team's settings (evidence, compliance, tracker, a `reviewPublication` ceiling, `features` switches) and `policy.json` is retired, kept tracked only so a committed copy still holds its repo at `required`: the team commits them, devflow never writes them. `.devflow/config.json` holds personal per-repo facts only (`reviewPublication`, the narrow-only `tracker` override, `features`); a copy git tracks is not personal and is ignored as absent, with a warning to `git rm --cached` it (D-PERSONAL-UNTRACKED). Memory, learning and knowledge are machine switches in `~/.devflow/manifest.json` that either repo file can only narrow (D-FEATURES-NARROW-ONLY). Prompts never read `project.json` or `config.json`: they take the one `resolve-settings.cjs` line through `_partials/_settings.mds`, and `tests/guards/no-config-read.test.ts` holds them to it. `~/.devflow/tracker/{provider}.md` (per-provider conventions) is user content, kept on uninstall.

**Feature Knowledge Bases**: `.devflow/features/index.md` + every `{slug}/KNOWLEDGE.md` are git-tracked and shared through the root `.gitignore` carve-out (written byte-identically by `ensure-root-gitignore` / `ensureDevflowGitignore`). After writing, the **Knowledge agent commits those two paths to the current worktree branch itself** (scoped `commit --only` pathspec, never `git add -A`, **never push, never force**, no commit script). A user opts back out by re-adding `.devflow/features/` to their own `.gitignore`. The settings line's `KNOWLEDGE` (the machine switch — `devflow init --[no-]knowledge` or `devflow knowledge --enable/--disable` — narrowed by either repo file) gates write-back only; load is ungated, and explore/debug do NOT load up-front (intentional asymmetry). Freshness = write-through + verify-on-read (NO git-staleness, NO SessionEnd eval, NO Learning task).

**Rules**: plugin-scoped flat `.md` files in `src/assets/rules/`, installed to `~/.claude/rules/devflow/` for the selected plugins only (the compliance rule is feature-owned). Shadow overrides: `~/.devflow/rules/{name}.md`. `paths: []` YAML frontmatter must remain — it signals Claude Code to apply the rule globally.

**Selection-scoped Skill Installation**: skills install for the plugins you selected plus every skill those plugins declare in `requires:`, as `~/.claude/skills/devflow:{name}/`. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); a shadow whose skill is outside the selection is dormant — kept in `~/.devflow/skills/`, never installed, never deleted. Deselecting a plugin removes only the skills no remaining selected plugin owns or requires. Exception: the `compliance` skill is feature-owned (not plugin-scoped).

**Compliance**: feature-owned regulatory review (not a plugin), off by default; toggled by `devflow compliance --enable/--disable/--set <ids>`, installed by `src/targets/claude-code/compliance-install.ts` and composed from per-framework fragments by `src/core/compliance-compose.ts`. Every install carries the skill and all six framework references; the machine switch owns only the rule (installed and stamped when on) and the SKILL.md stamp (the machine's frameworks, or a neutral stamp when off). The review lens runs from the settings line's `COMPLIANCE` — the union of the machine's ids and the `project.json` `compliance` ids of the default branch (its local tracking copy) and the worktree, so a branch adds frameworks and never removes one and an unreadable file never lowers the lens (D-LENS-UNION); `off` only when no layer declares compliance, `generic` when one does with no valid ids — and an agent loads `references/{id}.md` only for the ids it is given (`COMPLIANCE_FRAMEWORKS`). Enabled at any framework count, zero included, it makes `required` the evidence-policy floor on that machine, and any repository `compliance` key, empty or malformed included, raises it too; the lens never decides evidence.

**Claude Code Flags**: the typed registry and its rules live in `src/core/flags.ts` (registry + JSDoc); manage with `devflow flags`. `--enable`/`--disable` are boolean-only — non-boolean flags use `--set`. Enabling `suppress-attribution` overwrites any existing `attribution` value; disable only deletes the exact devflow shape, never a user's custom attribution. Narrow boolean flags with `isEnvBooleanFlag` — a `target.type` check does not narrow `onPayload`. The literal 'unset' is never a displayed value.

**Model Strategy**: an explicit `model:` in agent frontmatter overrides the user's session model. The Tracker agent's tier is a constant with no tuning config: the hook's `TRACKER_MODEL` literal is `case`-allowlisted and pinned equal to `loadShippedDefaults()['tracker']`. The memory worker runs `claude -p --model claude-sonnet-4-6`. Users override per agent via `devflow agents`; overrides persist in `~/.devflow/agent-models.json` and are re-applied on every `devflow init`.

**Review publication**: PR-comment publication is visibility-gated (D10, fail-closed to a counts-only stub on public/unknown repos; `reviewPublication: auto|full|off` in `.devflow/config.json`; the team's `project.json` value only caps it, never raises it, so a branch cannot lift publication above `auto`). Under a `required` evidence policy a resolved `off` becomes `stub`, so a counts-only record still reaches the PR; `stub` is never a config value. The test-plan evidence comment makes no visibility probe: it is a STUB under `auto` as well, FULL only under `full`, and not posted under `off`. Every posted body passes the deterministic secret scrubber (D11, unconditional; a missing or failing scrubber emits `TRACEABILITY: DEGRADED (redaction unavailable)` and suppresses the post rather than publishing unredacted content). File sinks chain the scrubber with `&&`, so a non-zero exit means the write does not happen. Tool-call sinks use `redact-secrets.cjs --emit`, which frames the result as `D11-OK <nonce> <sha256> <bytes> <n> [type:count,…]` with a per-invocation 32-hex nonce (an unframed `D11-OK` literal is forgeable by anyone who can write an issue comment), prints `D11-FAIL <reason>` with an **empty body** on every non-zero path, and requires the consumer to verify the received body's byte length against `<bytes>` before posting [DR-06]. Review-cycle convergence warnings never block the pipeline.

**Evidence policy**: `resolve-evidence-policy.cjs` resolves `EVIDENCE_POLICY` (`required` | `standard`) once per run from the `evidence` key of `.devflow/project.json` as committed on the default branch — the only authority. Offline it names that branch from the local `origin/HEAD` and folds its tracking copy (D-OFFLINE-ORIGIN-HEAD); only with no `origin/HEAD` does the worktree's file govern, flagged `remote-unavailable`. HEAD feeds only the `pr-changes-policy` warning. Where a source's `project.json` has no `evidence`, a `.devflow/policy.json` there is never parsed: its presence alone resolves `required` with `invalid-file` (D-POLICY-JSON-RETIRED). It writes nothing, every failure resolves `required`, and local sources (enabled compliance, the worktree's file) only raise it. A `compliance` key in `project.json` on the default branch, the tracking branch or the worktree — never HEAD — raises the floor to `required`, whatever its value. Operations never see the policy, only `ISSUE_REQUIRED`, `APPLY_CONVENTIONS` and `REQUIRE_NON_AUTHOR_APPROVAL`, mapped in the resolver alone, so no prompt restates the mapping. Test-plan states are assigned only by `pr-evidence.cjs` (the pure core: grammars, markers, the state ladder) and `verify-evidence.cjs` (its I/O half), never by a prompt; `release-trace.cjs` computes the git-only release trace map. `/code-review` and `/bug-analysis` carry no ticket gate.

**Tracker**: Built-in issue-tracker provider selection (not a plugin) over `github | jira | linear`. The machine default is chosen at `devflow init` (wizard, or `--tracker <id>`) and stored in `manifest.features.tracker.provider`, default `github`; a repository selects its own in `.devflow/project.json` (`tracker` provider, site, key), trusted automatically. Every install carries every provider: all generated references on the `devflow:git` skill, the tool-call contract `references/tracker/_mcp.md` and the Tracker agent file. Section 3 of `session-start-context` always installs and gates at runtime. Skills are scoped by selection: each plugin declares the skills it uses but does not own in a `requires:` list, a bidirectional closure guard holds that list against commands, agents and skill bodies, and the Review agent's focus-templated skill reference is the one classified exception. `/code-review`'s language focuses are presence-gated on the skill being installed.

**Tracker operations**: the Git agent runs `resolve-settings.cjs` once per spawn and takes provider, site and key from its settings line — the repository's choice, else the machine default, else `github`; a personal `config.json` override can only narrow it. Under a non-`github` provider `references/tracker/_mcp.md` is a fixed per-spawn load — the tool-call contract. Servers are scoped per capability: the unique qualifying server wins, two or more is a degraded run with no call. A reference renders by the resolved provider's own documented default; release evidence is gathered in the provider's own reference grammar with project-key equality, never a bare number. A refusal reports `TRACEABILITY: DEGRADED (<reason>)`, and each actionable reason implies its remedy: `tracker not configured` — select a provider; `tracker configuration mismatch (repository override)` or `(conventions file)` — another source names another provider, so re-select or drop it; `tracker.md required fields incomplete` — edit the conventions file in `~/.devflow/tracker/`; `no tracker tool for {capability}` — connect a server offering it; `redaction unavailable` — the scrubber could not run, so nothing posts. On Linear `dedup unavailable — duplicate possible` is permanent: the workspace cannot tell devflow which account it is, so a back-link posts with that warning rather than being withheld.

**Tracker lifecycle**: `devflow init --tracker <id>` selects non-interactively. `devflow tracker --set <id>` sets only the machine default: manifest, attempt counters, sentinel. `devflow tracker --status` reports the machine provider, an `Effective:` line when a repository selects one, whether conventions have been learned, and a `Mechanics:` line counting the installed reference files. When a session's provider is not `github` a background Tracker agent runs once, takes an observable claim (`CLAIMED`, or `LOST` and an immediate exit if another run holds it), and writes `~/.devflow/tracker/{provider}.md` exactly once or not at all, scrub-gated fail-closed, with `# UNRESOLVED:` lines for what it could not establish. Each provider's conventions are learned from the first repository that uses it. Those files are yours: hand-editable, kept on uninstall.

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

**Build commands**: `npm run build` (full — TypeScript + MDS), `npm run build:cli` (TypeScript only — **does not produce installable agents**; a generator host stays uncompiled and the installer has nothing in `dist/agents/` to prefer), `npm run build:mds` (compile every MDS host: command hosts in `src/assets/commands/` → `dist/commands/`, agent generator hosts in `src/assets/agents/` → `dist/agents/`, reference modules in `src/assets/mds/` → `dist/skills/git/references/`), `npm run test:golden:update -- <target>` (`git-agent` regenerates the Git-agent golden in a fixture-only commit; `github-status-lines` refuses without `--unfreeze`; `install-snapshot` rewrites the install-snapshot and hook-matrix goldens from the built CLI)

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
