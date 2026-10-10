---
feature: learning-capture-system-delivery
name: Decisions delivery and learning variants
description: "Use when changing how DECISIONS_CONTEXT reaches agents, learning:on/off arms, dist/learning-off, the init and learning --enable/--disable converge, or the session-start Index line. Keywords: apply-decisions."
category: architecture
directories:
  - src/assets/commands/_partials/_decisions.mds
  - src/assets/commands/_partials/_preamble.mds
  - src/assets/skills/apply-decisions/SKILL.md
  - src/assets/agents/skim.mds
  - src/assets/agents/code.mds
  - src/core/learning-variants.ts
  - src/targets/claude-code/learning-install.ts
  - src/core/assets.ts
  - src/core/plugins.ts
created: 2026-10-10
updated: 2026-10-10
---

# Decisions Delivery and Learning Variants

## Rules

- **KB-INV-1** Decisions reach an agent on one route: the main model reads `{ledger}/.devflow/learning/index.md` and hands its content on as `DECISIONS_CONTEXT`; nothing parses the ledger and no agent reads the index itself.
- **KB-INV-2** `DECISIONS_CONTEXT` goes only to an agent type whose source lists it among its inputs; `tests/decisions/decisions-seam.test.ts` computes that set from the agent sources, and every Code spawn site carries the key.
- **KB-INV-3** All decisions text in commands and agents sits inside learning-on arms (`<!-- learning:on -->`), which the build resolves into two variants of each prompt; arms never nest and a marker is a whole line, removed whole.
- **KB-INV-4** `decisions_gate()` sets `DECISIONS_CONTEXT` to `(none)` and skips the step when the settings line says `LEARNING=off`, before it locates a ledger or reads an index; an unresolvable settings line keeps `LEARNING=on`.
- **KB-INV-5** The install and the toggle follow the MACHINE switch alone; a repository's narrowing changes no installed file, which is why the learning-on variants keep the run-time `LEARNING` gate.
- **KB-INV-6** The converge touches only installed files, writes byte-compared and atomically, isolates each item, and only warns on a skip or failure, never changing the exit code.
- **KB-INV-7** The converge carries an installed agent's `model:` and `effort:` and `/code-review`'s language-focus stamp into the variant before comparing, so `devflow agents` and proxy overrides survive and a no-op converge writes no agent.
- **KB-INV-8** The pass rule (`DECISIONS_PASS_RULE`) lives in the session-start decisions block, emitted only with an Index line, and the orchestrator charter holds no decisions text.
- **KB-INV-9** `LEARNING_VARIANT_HOSTS` in `tests/fixtures/mds-manifest.ts` names every host that carries an arm; the build's printed variant count, the files under `dist/learning-off` and the packed tarball are all asserted against it.
- **KB-INV-10** `LEARNING_GATED_SKILLS` (`apply-decisions`) is left out of a learning-off install but stays owned and required by its plugins in the registry, so a learning-off machine never reports it as a deselection.
- **KB-INV-11** A learning-off agent file carries no apply-decisions preload (the variant is the mechanism, with no install-time frontmatter rewrite), and a learning-on file keeps the preload plus the run-time gate.
- **KB-AP-1** Decisions text outside a learning-on arm (a `DECISIONS_CONTEXT` input bullet, an apply-decisions step or preload, a `decisions_load()` expansion, a pass site): it reaches learning-off machines, which are meant to carry none of it.
- **KB-AP-2** Handing `DECISIONS_CONTEXT` to an undeclared agent type, or to "all subsequent agents": the index is the largest single input a command can give an agent, so name the declared receivers.
- **KB-AP-3** Giving Code an index read of its own, or the apply-decisions Skip Guard a clause for one: a Code spawn without the key has no decisions.
- **KB-AP-4** Stating the pass rule in the orchestrator charter: the charter is paid in every session, learning or not.
- **KB-AP-5** Rewriting an installed agent's frontmatter to drop the preload on a toggle, or deciding the preload from a repository's narrowing: the installed agents are machine-wide.
- **KB-AP-6** Leaving a blank line outside the arm that owns its paragraph: it doubles in the other variant.
- **KB-AP-7** Adding or removing an arm without updating `LEARNING_VARIANT_HOSTS`: three assertions go red.
- **KB-AP-8** Expecting an off variant from a `build:cli`-only build: no `dist/learning-off` tree means a learning-off install falls through to the learning-on files.

## Overview

**Decisions reach agents on one route, and learning off removes the route.** The main model (a command, or the orchestrator on a direct delegation) reads the generated `index.md` and hands its content to an agent as `DECISIONS_CONTEXT`; no agent reads the index on its own initiative, and nothing parses the ledger. All the decisions text in the commands and agents sits in learning-on arms that the build resolves into two variants of each prompt: a machine with learning off installs the learning-off variants (no decisions text) and no `devflow:apply-decisions` skill, and `devflow learning --enable/--disable` converges the installed files either way. Only the learning-on variants gate at run time, because a repository can narrow learning off on a machine where it is on.

## Session-start Section 1: the TL;DR, the Index line and the pass rule

`session-start-context` Section 1 emits `--- PROJECT DECISIONS (TL;DR) ---`: the count line from each of `decisions.md` and `pitfalls.md` (`N decisions`, `N pitfalls`, cut from line 1 with sed), then, last, `Index: <ledger root>/.devflow/learning/index.md`. The Index line exists only when `DIRECTIVE_LEDGER_SAFE` admits the ledger root and the index is non-empty with a first line other than `(none)`; builtins only. Every file it reads goes through `df_file_below "$LEDGER_ROOT"`, so one a link leads to reads as absent and is logged once; an index a link leads to gets no Index line, since the model would read the file the link names and pass it on as `DECISIONS_CONTEXT`. The healing `mkdir -p` of a missing `learning/` runs only where `df_no_symlink_below` admits the path. The section is emitted when either part exists. The other sections are in `learning-capture-system-agent`.

**The pass rule follows the Index line** (D-DECISIONS-CHARTER-HANDOFF). `DECISIONS_PASS_RULE` is a static one-line literal (no input interpolated, so no shape gate): decisions are handed on for direct delegations only, workflow skills load their own, and the index is passed as `DECISIONS_CONTEXT`, its content read once, to every agent that takes it. It is emitted only with an Index line, since without an index there is nothing to pass; the same text reaches the jq and the node envelope. The rule lives here and not in the orchestrator charter: this section is already gated on the machine switch narrowed by the repository, so a learning-off machine or repository never pays for it, and it reaches sessions with ambient off, which the charter never did.

## Consumers of the decisions index

**The defines** (`_decisions.mds`; `authoring_decisions()` lives in `_preamble.mds`, which imports the module as `decisions`):

- `decisions_locate()` runs ONE `git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir` from `WORKTREE_PATH` or the cwd and picks `{ledger}`: the main worktree (line 2 without `/.git`, when the output is exactly two absolute lines, line 2 ends `/.git`, and the parent is not HOME and holds a `.devflow/`), else the toplevel (the line after the echoed flag on git < 2.31), else the start directory. It mirrors the hooks' rule (D-PROMPT-ROOT).
- `decisions_gate()` (D-DECISIONS-LEARNING-GATE) is one sentence: when the settings line says `LEARNING=off`, set `DECISIONS_CONTEXT` to `(none)` and skip the step before it locates a ledger or reads an index. An unresolvable settings line keeps `LEARNING=on`, as the fail-closed line does, so a failed resolution loads decisions exactly as it did before the gate. The partial imports nothing from `_settings.mds`: the gate reads the line the host's settings block resolved above, which in a multi-worktree run is the start root's.
- `decisions_load()` is the gate, the locate rule, a read of `{ledger}/.devflow/learning/index.md` (absent or empty gives `DECISIONS_CONTEXT` `(none)`), and, when it is not `(none)`, `devflow:apply-decisions`.
- `authoring_decisions()` (D-DECISIONS-AUTHORING-STEP) is the same load as a step that the four dynamic hosts expand right after their settings block, so its gate reads a line already resolved; `authoring_preamble()` carries no decisions text. `_engine.mds` passes the loaded index to Code.
- **Learning-on-only.** `decisions_load()` and `authoring_decisions()` wrap their whole bodies in a learning-on arm, so every expansion of either exists only in the learning-on build. `decisions_gate()` and `decisions_locate()` carry no arm of their own, since an arm cannot nest: they are leaves, expanded only from inside an arm (those two defines, and release's own on arm), so no learning-off build holds either.

**Hosts.** These import `{ decisions_load }`: bug-analysis, code-review, debug, plan, implement, explore, self-review, research, resolve. The four dynamic hosts (dynamic-build, dynamic-plan, dynamic-tickets, dynamic-profile) expand `authoring_decisions()`. release imports only `{ decisions_gate, decisions_locate }` and carries its own Phase 1b load text in an on arm (a test pins its locate text word for word to the define body). A learning-off build keeps the settings block only in the hosts with a consumer other than learning (code-review, debug, dynamic-build, explore, implement, plan, resolve, self-review); in the other hosts it sits inside the on arm.

**Declared receivers only (D-DECISIONS-DECLARED-ONLY).** `DECISIONS_CONTEXT` goes only to an agent type whose source lists it among its inputs: Code, Design, Diagnose, Knowledge, Research, Review, Scrutinize and Triage. `authoring_decisions()` names Code, Design, Knowledge, Review and Scrutinize, the declared types among a dynamic workflow's valid `agentType`s, and says every other type gets none. An Evaluate, Synthesize, Validate, Git or Explore spawn carries no index, and release's pass sentence says so for the Validate and Git agents it spawns. Every Code spawn site in implement, resolve and dynamic-build carries the key, because the Code agent does not read the index itself. `tests/decisions/decisions-seam.test.ts` computes the declared set from the agent sources and holds every Code spawn site and every sentence that passes the key to it; a sentence that names no receiver ("to all subsequent agents") fails.

**Agents and the skill.**

- `agents/code.mds`: when `DECISIONS_CONTEXT` is provided, follow `devflow:apply-decisions` on it; an absent key or `(none)` means no decisions context. Code has no index-read fallback of its own, so a spawn that omits the key leaves Code with no decisions. It states applied decisions in words, never by ID.
- `agents/skim.mds` Step 6 reads the decisions TL;DR (the first line of `{ledger}/.devflow/learning/decisions.md`, `<!-- TL;DR: N decisions -->`, reported as the active decision count) and nothing else of the file. An agent has no MDS partial, so Step 6 spells the locate rule out in prose: the same one `git -C "{start}" rev-parse --path-format=absolute --show-toplevel --git-common-dir` from `WORKTREE_PATH` or the cwd, then the main worktree, else the toplevel, else `{start}`. A linked worktree therefore reports the main worktree's count; `tests/decisions/command-adoption.test.ts` pins the three tiers in order. Skim's decisions text is learning-on only: the on variant takes a `LEARNING` input (`on` or `off`, from the orchestrator's settings line; explore, plan and research pass it) and Step 6 opens with the skip rule, `off` meaning skip and report `(none)` under "### Active Decisions"; the off variant has no Step 6, no `LEARNING` input and no Active Decisions line, and renumbers the summary step so there is no gap.
- The `apply-decisions` skill is a short grep-then-offset reader: it finds an entry's `## ADR-NNN:` or `## PF-NNN:` heading in the file the index footer names with `command grep -nF` (the ledger is git-ignored, so only a shell search finds the line) and Reads that section by offset and a limit of about 25 lines. Its Skip Guard is one sentence: skip when `DECISIONS_CONTEXT` is empty, `(none)` or not provided, and never load decisions files otherwise. It has no clause for an agent that reads the index itself, because no agent does. The Learning agent does not preload the skill, since its body never reads a decisions index.
- The main model's rule to pass the index on direct delegations is `DECISIONS_PASS_RULE` (above). The orchestrator charter holds no decisions text.

## Learning variants (D-LEARNING-VARIANTS)

On a machine with learning off the decisions text is ABSENT from every prompt it would have reached. The arms are whole-line markers: `<!-- learning:on -->` keeps its lines only in the learning-on variant, `<!-- learning:off -->` only in the learning-off variant (directly after an on arm it is that arm's else), `<!-- learning:end -->` closes (`LEARNING_MARKER_RE`, `src/core/learning-variants.ts`). A marker may be indented and may sit inside a fence, a list item, a define body or an agent's frontmatter, because MDS passes an HTML comment through untouched; it is removed whole and every other line is kept byte for byte, so a paragraph's blank line goes inside the arm that owns the paragraph.

`splitLearningVariants` runs in `scripts/build-mds.ts` (`materializeOutputs`) on the COMPILED body of each command and agent host, so it adds no compile call: the on variant lands at the host's usual path (`dist/commands/x.md`, `dist/agents/x.md`) and the off variant at `dist/learning-off/{commands,agents}/x.md` (`learningOffRelPath`), only for a host with an arm. The build refuses nesting, an unopened end, an unclosed or empty arm, a malformed marker and any marker in a reference module; an orphan prune keyed on the files actually written covers `dist/learning-off/`; no marker survives into `dist/`. The hosts with arms are the ones in `LEARNING_VARIANT_HOSTS`: the command hosts, and the agent hosts code, design, diagnose, knowledge, research, review, scrutinize, skim and triage, each a `.mds` generator host. The other agents hold no decisions text and have no variant; the Learning agent runs only when learning is on. Where a numbered step is dropped the later numbers are on/off pairs, so the off variant has no gap. The one learning token left in an off build is the settings grammar paragraph, which names `LEARNING=<on|off>` because the settings line's shape is pinned. The markers map one to one onto a native conditional (`on` is `@if learning:`, `off` is `@else:`, `end` is `@end`) for when MDS can place one inside a fence or an indented line.

## Which variant a machine runs (D-LEARNING-VARIANT-INSTALL)

The machine switch alone decides. `commandSourceDirs(learning)` and `agentSourceDirs(root, learning)` (`src/core/assets.ts`) put `dist/learning-off/<kind>` ahead of the normal order when learning is off, so a host with an arm installs its off variant and one without falls through to its single file; `loadShippedAgentDefaults` and the test harness keep reading the on variant, since the shipped model and effort are the same in both. `installViaFileCopy` takes a REQUIRED `learning`, which `devflow init` passes as its settled value, and leaves `LEARNING_GATED_SKILLS` (`omitLearningGatedSkills` in `src/core/plugins.ts`) out of the skill loop when it is false. The skill stays owned and required by its plugins in the registry, because the closure guard reasons over the on variant.

`convergeLearningVariants` (`src/targets/claude-code/learning-install.ts`) makes an already-installed tree match the switch. `devflow init` runs it right after the file copy, and `devflow learning --enable/--disable` runs it through `applyLearningToggle` after the switch is written.

- **Roster**: the `.md` files that exist under `dist/learning-off/{commands,agents}` (flat lowercase names, bounded by `MAX_LEARNING_ROSTER` per kind), so a new arm needs no edit here. A missing directory (a `build:cli`-only build) warns to run `npm run build:mds` and leaves the installed prompts as they are.
- **Only what is installed**: a file with no installed copy is left alone, so a toggle or a `--plugin` install never adds another plugin's file. A write is byte-compared (a file already holding the target bytes is untouched) and atomic, each item is isolated and every failure is a warning.
- **State carried into the variant before the comparison**: an agent's installed `model:` and `effort:` (D-AGENT-OVERRIDE-CARRY, `withInstalledState`, `carryAgentOverrides`) and `/code-review`'s language-focus stamp (D-LANGUAGE-FOCUS-STAMP). `reapplyAgentMapping` still runs after a toggle that rewrote an agent and stays the authority.
- **The skill**: removed on off; on on, installed only when the effective plugin selection's closure holds it. It is resolved through the installer's own `resolveSkillSource` from the same package root as the variants and swapped in through a staging directory under the Claude directory, never under `skills/`. Only skills and rules have shadows: a shadow of apply-decisions under learning off is dormant (kept in `~/.devflow/skills`, never installed, never deleted) and applied again on enable; commands and agents have none.
- **Skew and failure**: `applyLearningToggle` skips the converge with a "run `devflow init`" message when there is no readable manifest or `manifest.version` differs from the running CLI's (`learningToggleSkew`), since the variants in this package belong to this version. A skip or a failure only warns and never changes the exit code: either mismatch is safe, because an on variant is still gated at run time and an off variant loads no decisions.
- **D-LEARNING-PRELOAD-MACHINE-ONLY** (the apply-decisions preload follows the machine switch and never a repository's narrowing, because the installed agents are machine-wide) is met by the variant: the learning-off agent files do not preload the skill, with no install-time frontmatter rewrite, and the learning-on files keep the preload and the run-time gate. A repository whose `project.json` sets `learning: false` on a learning-on machine therefore changes nothing installed.

## Anti-Patterns

- **KB-AP-1, decisions text outside an arm**: nesting an arm, an empty arm, a marker in a reference module and a mid-line marker all fail the build; a stray `DECISIONS_CONTEXT` bullet, step or pass site outside `<!-- learning:on -->` does not, and it reaches learning-off machines.
- **KB-AP-2 and KB-AP-3, undeclared receivers and a Code index read**: the index is the largest single input a command can give an agent. Name the declared receivers. Do not give Code an index read of its own, or the Skip Guard a clause for one: a Code spawn without the key has no decisions, and every Code spawn carries the key.
- **KB-AP-4, the charter**: the rule belongs in the session-start decisions block, where the machine switch and the repository's narrowing already gate it.
- **KB-AP-5, the preload**: the learning-off variant is the file that carries no preload.

## Gotchas

- **The switch is install-time, a repository's narrowing is run-time (KB-INV-5).** A repository that narrows learning off changes no installed file; on a learning-on machine the `decisions_gate()` sentence and Skim's `LEARNING` skip, both present only in the learning-on variants, are what keep the decisions load from running. On a learning-off machine no prompt reads `LEARNING` at all.
- **Re-init keeps the recorded switch.** `devflow init` seeds the learning value from the manifest; only `--learning` / `--no-learning`, the wizard's answer or `devflow learning --enable/--disable` flips it, and the installed variants follow the settled value.
- **KB-AP-8: no `dist/learning-off` tree means no off variant.** A `build:cli`-only build writes none: a learning-off install then falls through to the learning-on files (still gated at run time) and the converge warns to run `npm run build:mds`. The skill is still left out.
- **A converge that changes nothing prints nothing.** The `Installed prompts:` line appears only when a command or agent was rewritten or the skill was installed or removed; a skip because of version skew always warns.
- **KB-AP-7: a host that gains or loses an arm changes the roster.** `LEARNING_VARIANT_HOSTS` is asserted against the build's printed `N learning-off variant(s) written` count, the files on disk under `dist/learning-off` and the packed tarball, so all three go red until it is updated.
- **Install surface.** The learning-off variants ride in the package under `dist/learning-off/` and are what a learning-off machine installs in place of the on files; the `devflow:apply-decisions` skill installs on a learning-on machine only.

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/commands/_partials/_decisions.mds` | `decisions_gate()`, `decisions_locate()` (leaves) and `decisions_load()` (a whole-body learning-on arm) |
| `src/assets/commands/_partials/_preamble.mds` | `authoring_decisions()`, the dynamic hosts' decisions step (a whole-body learning-on arm, declared receivers only) |
| `src/assets/agents/skim.mds` | Step 6 reads the decisions TL;DR through the main-worktree locate rule; the `LEARNING` input and Step 6 are learning-on arms |
| `src/assets/agents/code.mds` | `DECISIONS_CONTEXT` input and apply-decisions step in learning-on arms; no index-read fallback |
| `src/assets/skills/apply-decisions/SKILL.md` | Consumer algorithm: grep-then-offset read of one entry's body, the in-session citation rule, the Skip Guard |
| `src/assets/scripts/hooks/session-start-context` | Section 1 also carries `DECISIONS_PASS_RULE` (D-DECISIONS-CHARTER-HANDOFF) |
| `src/core/learning-variants.ts` · `scripts/build-mds.ts` | `splitLearningVariants`, `LEARNING_MARKER_RE`, `learningOffRelPath`; the build step that writes `dist/learning-off/` and prunes it |
| `src/targets/claude-code/learning-install.ts` · `src/core/assets.ts` · `src/core/plugins.ts` | `convergeLearningVariants`, `applyLearningToggle`, `learningToggleSkew`; `commandSourceDirs`/`agentSourceDirs`; `LEARNING_GATED_SKILLS` |
| `tests/decisions/decisions-seam.test.ts` · `tests/decisions/command-adoption.test.ts` · `tests/learning/learning-variants*.test.ts` | Declared receivers, Code spawn keys and gate order; the Skim locate tiers; the splitter, the arms of every host, the build output and the install and converge (temp trees and the built CLI under a temp HOME) |
| `tests/fixtures/mds-manifest.ts` | `LEARNING_VARIANT_HOSTS` and the other host rosters |

## Related

- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: the hub: the feature switches the converge follows and the table of D-series names.
- `.devflow/features/learning-capture-system-agent/KNOWLEDGE.md`: the other `session-start-context` sections and `devflow learning --enable/--disable`, which runs the converge.
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md`: the Knowledge agent write-back, whose agent file also carries learning arms.
- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md`: the preamble and engine partials that carry `authoring_decisions()` and pass the loaded index to Code.
- `.devflow/features/resolve-pipeline/KNOWLEDGE.md`: `/resolve` and `/code-review`, consumers of `decisions_load()`.
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md`: the charter injection; the decisions pass rule lives in the session-start decisions block, recorded here.
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: the installer side (the `learning` option of `installViaFileCopy`, `resolveSkillSource` in `src/targets/claude-code/installer.ts`); the converge is recorded here.
- `.devflow/features/test-harness/KNOWLEDGE.md`: the install snapshots (the all-off one omits the apply-decisions skill).
- `docs/reference/hooks.md`, `docs/reference/file-organization.md`: the learning-off variants (distribution table and the learning-switch paragraph).
- `src/targets/claude-code/learning-install.ts` (header), `src/core/learning-variants.ts` (header) and `src/assets/commands/_partials/_decisions.mds` (header): the converge, the marker grammar and the gate, each documented where it lives.
