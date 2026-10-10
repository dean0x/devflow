---
feature: feature-knowledge-system
name: Feature Knowledge Base System
description: "Use when changing knowledge load or write-back, Rules-plus-heading-index delivery, KB shape or size budget, or the Knowledge agent. Keywords: KNOWLEDGE.md, knowledge_load, knowledge_writeback, index.md."
category: architecture
directories:
  - src/cli/commands/knowledge
  - src/assets/skills/feature-knowledge
  - src/assets/skills/apply-feature-knowledge
  - src/assets/agents/knowledge.mds
  - src/assets/commands/_partials
  - tests/guards/feature-knowledge-delivery.test.ts
  - tests/guards/kb-shape.test.ts
created: 2026-06-21
updated: 2026-10-10
---

# Feature Knowledge Base System

## Rules

- **KB-INV-1** `KNOWLEDGE.md` frontmatter is the authority and `index.md` is a regenerable cache. When the index is absent, thin or clobbered, `knowledge_load` globs `features/*/KNOWLEDGE.md` frontmatter and carries on; a missing index is never a problem.
- **KB-INV-2** Freshness is write-through plus verify-on-read: the Knowledge agent writes in-command at workflow end, and a reader trusts the code over the KB on any mismatch. There is no git-staleness check, SessionEnd eval, Learning task, background refresh or deterministic CJS engine.
- **KB-INV-3** The settings line's `KNOWLEDGE=` is the sole write-back gate: the machine switch narrowed by the repository's `project.json` and the personal `config.json`, with a fail-closed `KNOWLEDGE=off`. The prompt reads no config file itself, and load is ungated.
- **KB-INV-4** Knowledge reaches an agent as Rules plus a heading index, by recipient tier. Review, Triage, Design, Code, Diagnose, Research and plan's Explore take Rules plus `Headings:`; Evaluate and Scrutinize take Rules only; Validate, Git and Test take nothing. `tests/guards/feature-knowledge-delivery.test.ts` holds it.
- **KB-INV-5** Explore and debug call `knowledge_writeback` only, never `knowledge_load`: investigators read code fresh, with no confirmation bias.
- **KB-INV-6** `{worktree}` is the checkout's toplevel from one `git rev-parse --show-toplevel` (start = `WORKTREE_PATH` or cwd), so a linked worktree loads and writes its own branch's KBs, and a session started in a subdirectory still works at the repository root.
- **KB-INV-7** The Knowledge agent commits only `index.md` and its `KNOWLEDGE.md`, with a scoped `commit --only`; it never pushes, forces or amends. On a detached HEAD it does not commit, and the workflow's final report names the uncommitted paths.
- **KB-INV-8** A KB leads with `## Rules`: one-line `KB-AP-n` / `KB-INV-n` bullets whose IDs never change or get reused, cited as `{slug} KB-AP-n`, with no volatile numbers (name the pinning test or constant). Size is curated to the skill's budget, never truncated, and an index line and its description have their own caps. `tests/guards/kb-shape.test.ts` holds the wording.
- **KB-INV-9** A decision or pitfall shaping a KB is stated in words, never by ledger ID: the KB is git-tracked and shared, and ledger IDs resolve only on the machine that recorded them.
- **KB-INV-10** The per-phase handoff is written by each Code agent, which appends only its own `## Phase {N} Implementation Summary` section within a byte cap and never rewrites an earlier one. It is read like a KB: locate headings with `command grep -n '^## '`, then Read with `offset`/`limit` (`tests/guards/handoff-sections.test.ts`).
- **KB-AP-1** Never deliver a whole `KNOWLEDGE.md` or the wrong tier: no concatenated files, no Rules-plus-index variable to Evaluate or Scrutinize, no variable to Validate, Git or Test.
- **KB-AP-2** A load text never names the Grep tool (a Bash-holding agent has none). `command grep -n '^## '` is a locator only, and KB text is quoted only from a Read view.
- **KB-AP-3** Never tell the Knowledge agent to load `devflow:feature-knowledge`: its `skills:` frontmatter already injects the body and it holds no Skill tool, so the instruction asks for a second copy it cannot fetch.
- **KB-AP-4** `knowledge_writeback` never spawns unconditionally: it needs a documented area changed or durable cross-cutting knowledge found, else it is a silent no-op.
- **KB-AP-5** Never revive a retired artifact: `feature-knowledge.cjs`, `.create-result.json`, `index.json`, the `.disabled` sentinel, or a `referencedFiles` frontmatter field.
- **KB-AP-6** The refresh rule is stated once, in the agent's Direct Write Protocol paragraph, never under Responsibilities, and no prompt tells the agent to cut or drop content to meet the budget (`kb-shape.test.ts`).
- **KB-AP-7** `index.md` is git-tracked and has no lock: two branches adding different slugs can conflict textually, so keep both lines; a concurrent clobber self-heals through the frontmatter fallback.
- **KB-AP-8** A legacy KB with no `## Rules` is valid: readers take one to three entries from its Anti-Patterns or Gotchas, labelled by section name with no ID, and Rules are added only when new work touches the KB.
- **KB-AP-9** `/research` Phase 7 (user-gated) deliberately has its own Knowledge-agent spawn block rather than `knowledge_writeback()`; do not fold it into the partial.

## Overview

The system is **write-through**. Knowledge is authored in-command, at workflow end, by a Knowledge agent that writes `.devflow/features/{slug}/KNOWLEDGE.md` and updates the `index.md` cache line directly. `.devflow/` is local by default, but feature knowledge is the one exception: the root `.gitignore` carve-out (`.devflow/*` plus level-by-level `!` re-includes, written by `ensure-root-gitignore` / `ensureDevflowGitignore`) tracks `.devflow/features/index.md` and every `{slug}/KNOWLEDGE.md`, and the agent commits those paths to the current branch itself (scoped pathspec, no push, no force, no script). A team opts back out by re-adding `.devflow/features/` to its own `.gitignore`.

This KB covers the knowledge side: load, write-back, delivery tiers, KB shape and the authoring and consumption contracts. The MDS build that compiles the command hosts, agent hosts and reference modules is split into two sibling KBs: `feature-knowledge-system-mds-build` (the compiler pipeline, learning variants, prune and `dist/` resolution) and `feature-knowledge-system-reference-modules` (the reference-module registry, the `_mcp.mds` generation gate and the manifests). It lives under this slug family because the knowledge partials (`_knowledge.mds`) are themselves MDS sources.

## System Context

**Purpose.** Give agents pre-computed codebase context for their task area without exploring from scratch each session.

**Role.** One of two persistence layers under `.devflow/`, beside the Decisions pipeline. Knowledge is not a Learning task; working memory is the background-memory-update worker's job.

**Dependencies.** The MDS compiler at build time (the partial and the hosts are `.mds`); the `claude` Knowledge agent (model sonnet) at runtime.

**Toggle.** `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`. The machine switch is `features.knowledge` in `~/.devflow/manifest.json` (default true); a repository's `project.json` or the personal `config.json` can narrow it with `features.knowledge: false` (D-FEATURES-NARROW-ONLY), and the write-back gate reads the folded value from the settings line. It gates write-back only, load is ungated (harmless), and there is no sentinel file.

## Component Architecture

| Component | Path | Role |
|-----------|------|------|
| MDS partial | `src/assets/commands/_partials/_knowledge.mds` | Defines and exports `knowledge_load` and `knowledge_writeback`. It imports nothing, not even `_settings.mds`: write-back Step 1 takes the settings line the host's own settings block resolved above (D-SETTINGS-LINE) |
| Host commands | `src/assets/commands/{name}.mds` | The ten hosts that import the partial. Load: bug-analysis, code-review, implement, plan, release, research, resolve, self-review. Write-back: debug, explore, implement, resolve, self-review. The dynamic hosts are not knowledge-specific |
| Author agent | `src/assets/agents/knowledge.mds` | Generator host (learning arms on its `DECISIONS_CONTEXT` input, its `apply-decisions` preload and its `CROSS_REFERENCES` line). Writes KNOWLEDGE.md and the index line directly; model sonnet |
| Author skill | `src/assets/skills/feature-knowledge/SKILL.md` | The four-phase authoring process, the Rules-first template and Worked Example, the Rules ID rules, the size budget, the refresh rule, the legacy-KB note and index registration (line and description caps) |
| Consumption skill | `src/assets/skills/apply-feature-knowledge/SKILL.md` | `allowed-tools: Read, Bash`. A three-step algorithm over the delivered `Rules:` blocks: cite `{slug} KB-AP-n` (a legacy bullet as `{slug} {section}`), read a section on demand with Read `offset`/`limit` from the `Headings:` line or `command grep -n '^## '`, quote KB text only from a Read view |
| CLI list | `src/cli/commands/knowledge/list.ts` | Reads `index.md`, falling back to a frontmatter glob; no external scripts |
| CLI toggle | `src/cli/commands/knowledge/toggle.ts` | Flips `features.knowledge` in `~/.devflow/manifest.json`; no sentinel |

## Component Interactions

### Flow 1: Loading

`knowledge_load()` runs at the start of the load hosts.

0. **Resolve the root.** `{worktree}` is the checkout's toplevel from one `git -C "{start}" rev-parse --show-toplevel`, else the start directory (D-PROMPT-ROOT). KBs are committed per branch, so a linked worktree reads its OWN toplevel, unlike `decisions_load`, which reads the main worktree's ledger. A session started in `packages/app` therefore loads, and writes back, at the repository root.
1. **Read the cache**: `.devflow/features/index.md`.
2. **Fallback**: if absent or thin, glob `features/*/KNOWLEDGE.md` frontmatter.
3. **Select** KBs by comparing the task area against each entry's `description` and `directories`; prefer specificity over breadth.
4. **Read each selected KB's Rules, never the whole file.** List its `##` headings with line numbers through Bash (`command grep -n '^## '`, a locator only), Read the `## Rules` range with `offset`/`limit`, and choose one to three bullets by judgment, per KB. A legacy KB with no `## Rules` yields one to three entries from its Anti-Patterns or Gotchas range instead (D-KB-LEGACY-FALLBACK). On any mismatch with the code, trust the code.
5. **Set the two variables**, one block per KB: `--- Feature knowledge: {slug} ---`, a `KB:` path line, the `Rules:` bullets verbatim with their IDs (a legacy KB's entries sit under `Rules ({section name}):` with no ID), and a `Headings:` line (`L5 Rules · L40 Overview · …`). `FEATURE_KNOWLEDGE` is the blocks; `FEATURE_KNOWLEDGE_RULES` is the same blocks without the `Headings:` line; both are `(none)` if no KB is relevant. Bullets are pasted from the Read view, never a shell view.

**Delivery is by tier (D-KB-DELIVERY-TIERS).** Every spawn line keeps the input name `FEATURE_KNOWLEDGE:` and names the variable its recipient's tier takes: Rules plus heading index (`{feature_knowledge}`) for Review, Triage, Design, Code, Diagnose, Research and plan's Explore; Rules only (`{feature_knowledge_rules}`) for Evaluate and Scrutinize; nothing for Validate, Git and Test. Every `**Produces:**` line that lists `FEATURE_KNOWLEDGE` lists `FEATURE_KNOWLEDGE_RULES` too. `tests/guards/feature-knowledge-delivery.test.ts` holds all of it, in both learning variants, through named collectors with known-bad probes (`LOAD_HOSTS` names the load hosts; release loads by the same delivery but spawns nothing that takes the variables). The orchestrator charter's Feature knowledge bullet hands a direct delegation the same block by hand (owned by `ambient-orchestrator`).

**One git call, then direct reads**: the root resolution, the index read and, per selected KB, one heading listing (Bash) and one Rules read. No node scripts.

**Asymmetry (hard requirement).** `knowledge_load` is used by the load hosts listed above; `knowledge_writeback` alone, with no load, by explore and debug, whose investigators read code fresh.

### Flow 2: Saving (write-through)

`knowledge_writeback()` runs at the end of the write-back hosts.

1. **Gate.** Take the settings line the host's settings block resolved for `{worktree}` (the hosts in `SETTINGS_BLOCK_HOSTS` expand `_partials/_settings.mds` `settings_resolve()` once, imported by the host itself as an alias, and the `SETTINGS_BLOCK_HOSTS_LEARNING_OFF` subset keeps it with learning off; the partial resolves the line with the block only if the run has not yet). `KNOWLEDGE=off` skips entirely. The line ANDs the machine switch with both repo files (D-FEATURES-NARROW-ONLY), and its fail-closed form says `KNOWLEDGE=off`, so an unresolvable line skips write-back. The gate reads no file itself (`tests/guards/no-config-read.test.ts`, `tests/commands/knowledge-writeback-gate.test.ts`).
2. **Check scope.** Proceed only if the workflow changed a documented area or surfaced durable cross-cutting knowledge (patterns, anti-patterns, integration points, gotchas not visible from one file).
3. **Spawn** `Agent(subagent_type="Knowledge")` with WORKTREE_PATH, FEATURE_SLUG, FEATURE_NAME, DIRECTORIES, FILES_CHANGED and, in the learning-on build only, DECISIONS_CONTEXT; the partial passes none of the agent's optional EXISTING_KB or EXPLORATION_OUTPUTS inputs. The prompt also states the index line's caps ("reword a longer one, never cut it"). It never tells the agent to load `devflow:feature-knowledge`: the agent lists it (with `apply-feature-knowledge`, `worktree-support` and, learning-on only, `apply-decisions`) in `skills:`, so the body is injected into every spawn. `tests/commands/knowledge-preload.test.ts` holds the preload, the absent Skill tool and the absence of the instruction in the write-back partial and `/research`.
4. **Agent writes** `.devflow/features/{slug}/KNOWLEDGE.md`, then read-modify-writes `index.md` (replace the slug's line or append; create the file if absent), in the line format `- **{slug}** — {areas} — {Use-when description}`. There is no result file and no handoff artifact.
5. **Commit, or surface why not.** The agent commits the two paths to the current branch. On a detached HEAD it never commits (the commit would be unreachable once HEAD moves) and reports `KB_COMMIT: skipped (detached HEAD) — uncommitted: <paths>`; `knowledge_writeback` Step 4 makes the workflow name those paths in its final report (D-DETACHED-HEAD; `tests/commands/knowledge-detached.test.ts`). A failed Knowledge agent never changes the workflow outcome.

## Integration Patterns

**index.md as regenerable cache.** If it is absent, `knowledge_load` globs frontmatter and continues; write-through recreates it on the next write-back. No consistency risk follows from a missing index.

**Write-back conditionality.** The call site is always present in the compiled command, but the settings-line gate and the changed-area or cross-cutting condition mean the agent spawns only when useful.

**DECISIONS_CONTEXT injection.** `knowledge_writeback` passes `DECISIONS_CONTEXT` so the agent can state each relevant decision or pitfall in words in the section it governs, never by ledger ID. That line, the agent's input, its `apply-decisions` preload and its `CROSS_REFERENCES` output line all sit inside learning arms, so a learning-off prompt carries none of them.

**/research bespoke block.** `/research` loads with `knowledge_load` but its Phase 7 offers creation through its own spawn (checks the index, asks the user, then spawns the Knowledge agent) because the write-back list omits research. The block is the research workflow's equivalent of `knowledge_writeback`.

**Handoff read like a KB (D-HANDOFF-CAP).** In sequential Code phases each Code agent appends its own phase section (at most 8,192 bytes) to `handoff-{branch_slug}.md` with a Bash `>>` redirect; the orchestrator writes no phase section. The next Code agent reads only the prior phase's section, with the KB-load idiom. `tests/guards/handoff-sections.test.ts` holds the Code agent, `/implement`'s Handoff Protocol and the dynamic commands' shared convention to one statement.

## Constraints

- **Size budget: curate, never truncate** (D-KB-RULES-SHAPE). Per KB, target 30,000 characters and ceiling 40,000; there is no line cap. Splitting into focused sub-KBs, each with its own index entry, is only for when curation cannot bring a KB under the ceiling. Nothing is cut or dropped to meet the budget.
- **Refresh rule.** With `EXISTING_KB`, change only the sections the new work touches, add or update Rules bullets for what changed, never renumber a bullet ID and never rewrite untouched sections to meet the budget. A KB still above the ceiling is written as it stands, and the agent's final message says so. The skill states the rule in full and the agent once, in its Direct Write Protocol paragraph.
- **KB shape.** A new KB leads with `## Rules` after the title, about 3–5K characters of `KB-AP-n` (anti-patterns and gotchas) and `KB-INV-n` (invariants) bullets; an ID is kept across rewrites and never reused once retired. `## Anti-Patterns` and `## Gotchas` stay below as the longer explanations, headed by the IDs they explain. A KB without `## Rules` stays valid until curated.
- **Index line.** `- **{slug}** — {areas} — {Use-when description}`: the whole line at most 300 characters and the description at most 220 (reword a longer one, never cut it). Frontmatter is authoritative if the format changes.
- **No sentinel gating.** The old `.devflow/features/.disabled` sentinel is gone (a clean break); the settings line's `KNOWLEDGE=` alone gates.
- **No concurrent lock.** A concurrent `index.md` write may clobber, and the frontmatter fallback self-heals.

## Anti-Patterns

**KB-AP-5, retired artifacts.** All knowledge I/O is direct file reads in the partial and direct writes by the agent, so `feature-knowledge.cjs` and the `.create-result.json` handoff pattern no longer exist. `index.json` (an object keyed by slug) is a retired artifact too: nothing reads, writes or migrates it (`tests/shell-hooks.test.ts` asserts the features directory is created without one), and `index.md` is the one-line-per-KB cache. The system silently ignores a `referencedFiles` field, since staleness detection is gone; existing KBs may still carry it, and new KBs omit it.

**KB-INV-5, no load for investigators.** Passing `FEATURE_KNOWLEDGE` to `/explore` or `/debug` workers would anchor them on what past agents concluded; those workflows only write back.

**KB-AP-1, the pre-block shapes.** `read KNOWLEDGE.md in full`, `Concatenate under slug headers` and the `{full KNOWLEDGE.md content}` placeholder are banned across the compiled commands, the release source, the charter and the consumer skill by the delivery guard.

## Gotchas

**KB-AP-4, write-back is conditional.** The partial checks the settings-line gate AND the area-change condition before spawning, so a workflow that changes no documented area and finds nothing cross-cutting skips the spawn entirely (no unconditional spawns).

**KB-INV-1, the index is a cache.** `knowledge_load` uses it as a fast path; the frontmatter glob is the authoritative fallback. Write-through creates the file lazily.

**KB-INV-3, the settings line is the sole gate.** The prompt never reads a config file. The old sentinel is gone, and no migration removes it because it was never deployed on this branch.

## Key Files

- `src/assets/commands/_partials/_knowledge.mds` — `knowledge_load` (Rules-block delivery, Flow 1) and `knowledge_writeback`; the single authoritative source for both; imports nothing
- `src/assets/commands/_partials/_docs_root.mds` — one `@define` resolving `{worktree}` the same way so every `.devflow/docs/` path is rooted there (D-DOCS-ROOT, extending D-PROMPT-ROOT); `tests/guards/docs-root.test.ts`
- `src/assets/commands/_partials/_settings.mds` — `settings_resolve()` runs `resolve-settings.cjs` for a worktree root and accepts only a `SETTINGS_LINE_RE`-shaped line, else the fail-closed line; the hosts alias-import it themselves and expand it once before their earliest consumer, and no partial (`_knowledge`, `_publication`, `_compliance`, `_decisions`) imports it
- `src/assets/commands/{name}.mds` — the ten hosts that call the partial, compiled to `dist/commands/` with a `dist/learning-off/commands/` variant beside each
- `src/assets/agents/knowledge.mds` — the Knowledge agent contract: dual write, no result file, the leading Rules section kept current, the refresh rule once in its Direct Write Protocol, the character budget and legacy-KB bullets under Boundaries, and a `Report cap:` line closing Output (the `KB_*` status block exempt and inline in full)
- `src/assets/skills/feature-knowledge/SKILL.md`, `src/assets/skills/apply-feature-knowledge/SKILL.md` — the authoring and consumption contracts
- `tests/guards/feature-knowledge-delivery.test.ts`, `tests/guards/kb-shape.test.ts` — the delivery guard (load elements, tier table, Produces lines, recipient Input lines, consumer skill, release) and the KB-shape guard (Rules first, IDs, budget, no truncation instruction, legacy and refresh rules), each arm a named collector with a known-bad probe
- `tests/guards/handoff-sections.test.ts`, `tests/commands/knowledge-preload.test.ts`, `tests/commands/knowledge-writeback-gate.test.ts`, `tests/commands/knowledge-detached.test.ts`, `tests/guards/no-config-read.test.ts` — the remaining knowledge guards
- `src/cli/commands/knowledge/list.ts`, `src/cli/commands/knowledge/toggle.ts` — the CLI

## Related

- `.devflow/features/feature-knowledge-system-mds-build/KNOWLEDGE.md` — the compiler pipeline for the command hosts, agent hosts and reference modules, including learning-on/off variants and the prune
- `.devflow/features/feature-knowledge-system-reference-modules/KNOWLEDGE.md` — the reference-module registry, generation gate and manifests
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md` — the orchestrator charter, whose Feature knowledge bullet hands a direct delegation the same Rules block by hand
- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md` — the command-host side: what the compiled workflow commands must say
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — how the installer and the learning toggle consume `dist/learning-off/`
- `.devflow/features/tracker-references/KNOWLEDGE.md`, `.devflow/features/tracker-feature/KNOWLEDGE.md` — reference-file content and the provider dimension
- `.devflow/features/test-harness/KNOWLEDGE.md` — the guard and golden conventions the knowledge tests build on
- Working Memory (`.devflow/memory/WORKING-MEMORY.md`, the `background-memory-update` worker) and the Decisions pipeline (`.devflow/learning/`, `decisions-ledger.jsonl`) — sibling persistence layers, each with an independent toggle
- `src/assets/scripts/hooks/ensure-root-gitignore` and `ensureDevflowGitignore` — the carve-out that makes `.devflow/features/` shared, amending the local-by-default rule
