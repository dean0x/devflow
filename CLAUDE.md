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

Invariants:

1. LLM-vs-plumbing: the LLM does all detection, matching and curation. Shell and TypeScript hold no detection or judgment logic.
2. Read and write curation data only through the curation ops. Never edit those files. Never read the old `.devflow/learning/` folder as a ledger. Only move it.
3. Ledger IDs are machine-local. Committed and posted text states a decision in words, never by ID.
4. One install per machine, no install scope. `DEVFLOW_DIR` is ignored. `init --scope local` exits 1.
5. devflow never writes `project.json` or `policy.json`. The team commits them.
6. A git-tracked `.devflow/config.json` counts as absent, with a warning (D-PERSONAL-UNTRACKED).
7. Repo files only narrow the memory, curation and knowledge switches (D-FEATURES-NARROW-ONLY).
8. `features.behavior` is off unless set (D-BEHAVIOR-OPT-IN).
9. Prompts never read `project.json` or `config.json`. They take the `resolve-settings.cjs` line (`_partials/_settings.mds`).
10. Learn `conventions.md` only when `APPLY_CONVENTIONS` is `true`.
11. Uninstall keeps `~/.devflow/tracker/{provider}.md`. It is user content.
12. The Knowledge agent commits only `features/index.md` and `{slug}/KNOWLEDGE.md` (`commit --only`). Never `git add -A`, push or force.
13. `ensure-root-gitignore` and `ensureDevflowGitignore` write the same bytes.
14. `KNOWLEDGE` gates write-back only. Explore and debug do not load up-front. Freshness: write-through and verify-on-read only.
15. Rules install only for selected plugins and keep `paths: []` frontmatter.
16. The `compliance` skill and rule and the `behavior` rule are feature-owned. No plugin lists them.
17. Skills install for selected plugins and their `requires:`. Never install or delete a dormant shadow.
18. The compliance lens is the union of all layers. A branch never removes a framework; an unreadable file never lowers it (D-LENS-UNION).
19. The compliance directive goes into a spawn prompt only when the lens is on. No agent body names the compliance skill (D-COMPLIANCE-INJECT).
20. Enabled compliance, or a repo `compliance` key (never HEAD), makes `required` the evidence floor. The lens never decides evidence.
21. Flag `--enable`/`--disable` are boolean-only. Narrow with `isEnvBooleanFlag`. Never display `'unset'`.
22. Disable and uninstall remove only devflow's exact value. Init adopts a user's own value as off (D-ADOPT-RESPECTS-USER).
23. `TRACKER_MODEL` and the memory hook fallbacks equal their shipped rows.
24. PR-comment publication is visibility-gated and fails closed to a stub (D10). `project.json` only caps it. `required` turns `off` into `stub`.
25. The test-plan comment makes no visibility probe: STUB under `auto`, FULL under `full`, none under `off`.
26. Every posted body passes the scrubber (D11). If it fails, post nothing and emit `TRACEABILITY: DEGRADED (redaction unavailable)`.
27. File sinks chain the scrubber with `&&`. Tool-call sinks use `--emit` and check the byte count [DR-06].
28. Review-cycle convergence warnings never block.
29. Evidence policy comes only from the default branch's `project.json` (D-OFFLINE-ORIGIN-HEAD). Failures resolve `required`.
30. Never parse `policy.json`. Its presence resolves `required` (D-POLICY-JSON-RETIRED).
31. Operations see only `ISSUE_REQUIRED`, `APPLY_CONVENTIONS` and `REQUIRE_NON_AUTHOR_APPROVAL`. No prompt restates the mapping.
32. Only `pr-evidence.cjs` and `verify-evidence.cjs` assign test-plan states.
33. `/code-review` and `/bug-analysis` carry no ticket gate.
34. Every install carries every tracker provider. `session-start-context` Section 3 always installs and gates at runtime.
35. `requires:` lists used, unowned skills. The closure guard has one exception: Review's focus reference.
36. Tracker settings come from the settings line. `config.json` only narrows them.
37. A tracker spawn reads `_contract.md` once, and `_mcp.md` once off GitHub. A PR-host spawn reads neither.
38. Two or more qualifying servers: degraded run, no call.
39. Release evidence matches the project key, never a bare number.
40. A refusal reports `TRACEABILITY: DEGRADED (<reason>)`. On Linear, post the back-link with the dedup warning.
41. `tracker --set` changes only the machine default.
42. The Tracker agent claims first, then writes its conventions file once or not at all, scrub-gated.
43. The manifest keeps the curation switch in `curation` and `learning`. Every write sets both. False wins.
44. When git tracks the curation or memory folder, or does not answer, that feature reads and writes no file there.

Descriptions of these rules: `docs/reference/architecture.md`. The rules here bind; the doc explains them.


## Development Loop

```bash
# 1. Edit source files
vim src/assets/commands/code-review.mds     # Commands (MDS sources)
vim src/assets/agents/evaluate.md          # Agents (hand-authored)
vim src/assets/agents/git.mds              # Agents (MDS generator host → dist/agents/git.md)
vim src/assets/mds/tracker/_github.mds      # Reference modules (→ dist/skills/git/references/; also mds/git/_pr.mds; operation contracts live once in mds/git/_ops*.mds)
vim src/assets/skills/security/SKILL.md     # Skills
vim src/assets/rules/security.md            # Rules

# 2. Build
# Skills, rules, and hand-authored agents: no build step — edits take effect on next install
npm run build:mds
# Full build (TypeScript + MDS):
npm run build

# 3. Reinstall to global context
node dist/cli.js init                       # All plugins
node dist/cli.js init --plugin=code-review       # Single plugin

# 4. Test immediately
/code-review
```

**Build commands**: `npm run build` (full — TypeScript + MDS), `npm run build:cli` (TypeScript only — **does not produce installable agents**; a generator host stays uncompiled and the installer has nothing in `dist/agents/` to prefer), `npm run build:mds` (every MDS host, to the `dist/` paths above), `npm run test:golden:update -- <target>` (`git-agent` regenerates the Git-agent golden in a fixture-only commit; `github-status-lines` refuses without `--unfreeze`; `install-snapshot` rewrites the install-snapshot and hook-matrix goldens from the built CLI)

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
- Two agents are **hook-spawned, never workflow roster members** — `curate` (the session-start curation directive) and `tracker` (the session-start tracker-setup directive). Neither has a `_roster.mds` row, and no command spawns either; `tracker` sits in `devflow-core-skills`, whose empty `commands: []` is what makes the registry's reverse spawn check skip it structurally rather than by exemption.
- An agent with `omitClaudeMd: true` loads neither CLAUDE.md nor `~/.claude/rules/**`, so its body carries a `## Core rules` digest of exactly the lines its `CORE_RULES_DIGEST` row declares (`tests/fixtures/agent-config.ts`); Curate reads CLAUDE.md and the rule files itself
- `explore` ships `name: Explore` and overrides Claude Code's built-in Explore machine-wide, plan mode included (exact-name match); install skips it when the user already has an `Explore` agent, and uninstall restores the built-in
- Code ships as three compiled variants from `src/assets/agents/_partials/_code.mds`: `Code` (implement, issue-fix), `Fix` (validation-fix, alignment-fix, qa-fix, ci-fix) and `Refactor` (edit). A mode lives in exactly one variant, each variant has its own preload and its own `devflow agents` slug, and no variant selects a skill at run time
- Agent- and command-owned reference files live in the `agent-references` skill (`user-invocable: false`, `disable-model-invocation: true`) and are never preloaded; the agent or command reads one by explicit path. No plugin lists `agent-references` in `requires:`

### Commands

- Commands are orchestration-only — spawn agents, never do agent work in main session. `/code-review` spawns a language focus only when the installer stamped it into the installed command (re-stamped on every install and `uninstall --plugin`).
- Author as `.mds` sources in `src/assets/commands/`; compiled output lands in `dist/commands/`. A host or partial that carries curation arms also builds a curation-off variant under `dist/curation-off/`, which a curation-off machine installs and `devflow curation --enable/--disable` converges
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

- **Architecture**: `docs/reference/architecture.md` — the descriptions behind the Architecture Overview rules
- **Skills architecture**: `docs/reference/skills-architecture.md` — tier catalog, templates, creation guide, activation patterns
- **Agent design**: `docs/reference/agent-design.md` — templates, anti-patterns, quality checklist
- **Adding commands**: `docs/reference/adding-commands.md` — command template, plugin registration
- **Release process**: `docs/reference/release-process.md` — CI-driven one-click releases via GitHub Actions `workflow_dispatch`
- **File organization**: `docs/reference/file-organization.md` — source tree, build distribution, install paths, settings
- **Docs framework skill**: `src/assets/skills/docs-framework/SKILL.md` — documentation naming conventions and templates
- **Platform assumptions**: `docs/reference/platform-assumptions.md` — Claude Code behavioural assumptions devflow agents and tests rely on, including subagent nesting and concurrency; each entry carries a date stamp and an observable drift symptom
- **Hooks & background workers**: `docs/reference/hooks.md` — Working Memory, Ambient Mode, Curation pipeline, Debug Tracing (`devflow debug --enable` or `DEVFLOW_HOOK_DEBUG=1`)
- **External model routing**: `docs/reference/proxy.md` — Devflow Proxy relay, routing config, enable/disable lifecycle
- **Init**: `docs/reference/init.md` — Two-Mode Init, wizard-step gating, state-aware re-init and `--reset`
