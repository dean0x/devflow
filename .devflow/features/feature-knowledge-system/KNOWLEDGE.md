---
feature: feature-knowledge-system
name: Feature Knowledge Base System
description: "Use when adding a new knowledge base entry, modifying how knowledge is loaded into agents, changing the write-through save model, extending the CLI knowledge commands, or understanding the MDS knowledge module. Keywords: feature knowledge, KNOWLEDGE.md, write-through, knowledge_load, knowledge_writeback, build-knowledge, _knowledge.mds, index.md, apply-feature-knowledge, feature-knowledge."
category: architecture
directories:
  - src/cli/commands/knowledge
  - shared/skills/feature-knowledge
  - shared/skills/apply-feature-knowledge
  - shared/agents/knowledge.md
  - shared/knowledge
  - scripts/build-knowledge.ts
created: 2026-06-21
updated: 2026-06-28
---

# Feature Knowledge Base System

## Overview

The Feature Knowledge Base System uses a **write-through** model. Knowledge is authored
in-command (at workflow end) by a simplified Knowledge agent that writes directly to
`.devflow/features/{slug}/KNOWLEDGE.md` and updates the `index.md` cache line. There is
no background refresh pipeline, no SessionEnd hook, no Dream task, and no deterministic
CJS engine.

**Source of truth = `KNOWLEDGE.md` frontmatter.** The `index.md` is a regenerable cache:
if it is absent or incomplete, `knowledge_load` falls back to globbing frontmatter across
all `features/*/KNOWLEDGE.md` files. A clobbered `index.md` is non-fatal.

`.devflow/` is local by default, but feature knowledge is the ONE exception (amends ADR-021):
the root `.gitignore` carve-out (`.devflow/*` + level-by-level `!` re-includes) tracks
`.devflow/features/index.md` + every `{slug}/KNOWLEDGE.md`, and the Knowledge agent commits
those paths to the current branch itself (scoped pathspec, no push, no force, no script). A
team opts back out by re-adding `.devflow/features/` to their own `.gitignore`.

## System Context

**Purpose**: Give agents pre-computed codebase context for their specific task area without
requiring them to explore from scratch each session.

**Role in larger system**: One of two persistence layers under `.devflow/` (alongside the
Decisions pipeline). Knowledge is NOT a Dream task — it is written in-command. Working
memory is handled by the background-memory-update worker.

**External dependencies**: MDS compiler (`@mdscript/mds`) at build time to compile the
knowledge partials; `claude` agent at runtime (the Knowledge agent, model=sonnet) to write
KNOWLEDGE.md.

**Toggle**: `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`.
Feature state lives in `.devflow/dream/config.json` (field `knowledge`, default `true`).
Gates write-back ONLY — load is ungated (harmless). No sentinel file.

## Component Architecture

| Component | Path | Role |
|-----------|------|------|
| MDS partial module | `shared/knowledge/_knowledge.mds` | Defines + exports `knowledge_load` and `knowledge_writeback` |
| Host command sources (9) | `shared/knowledge/{name}.mds` | Command bodies that `@import "_knowledge.mds"` and call the partials |
| Build script | `scripts/build-knowledge.ts` | Compiles 9 `.mds` → 9 plugin `commands/*.md`; explicit SOURCE_TO_PLUGIN_MAP; hard-fails on any error |
| Author agent | `shared/agents/knowledge.md` | Writes KNOWLEDGE.md + updates index.md line directly; model=sonnet |
| Author skill | `shared/skills/feature-knowledge/SKILL.md` | 4-phase authoring + KNOWLEDGE.md template + index.md registration |
| Consumption skill | `shared/skills/apply-feature-knowledge/SKILL.md` | 3-step algorithm for agents loading FEATURE_KNOWLEDGE |
| CLI list | `src/cli/commands/knowledge/list.ts` | Reads index.md / falls back to frontmatter glob; no external scripts |
| CLI toggle | `src/cli/commands/knowledge/toggle.ts` | Flips `knowledge` key in dream config; no sentinel creation |

## Component Interactions

### Flow 1: Loading (consumption)

Invoked at the start of applicable workflows via `knowledge_load()` MDS call site.

1. **Read cache** — read `.devflow/features/index.md` if present
2. **Fallback** — if absent or thin, glob `features/*/KNOWLEDGE.md` frontmatter
3. **Select** — pick relevant KBs by comparing task area against each entry's `description` + `directories`
4. **Read bodies** — Read each selected `KNOWLEDGE.md`, verify-against-code on mismatch
5. **Set FEATURE_KNOWLEDGE** — concatenate under `--- Feature knowledge: {slug} ---` headers; `(none)` if no KBs found

**Zero subprocess calls** — load is pure file I/O; no git calls, no node scripts.

**Asymmetry** (hard requirement):
- `knowledge_load` used by: implement, plan, resolve, code-review, self-review, research, bug-analysis
- `knowledge_writeback` only (no load) used by: explore, debug (investigators read code fresh — no confirmation bias)

### Flow 2: Saving (write-through)

Invoked at the end of applicable workflows via `knowledge_writeback()` MDS call site.

1. **Gate** — if dream config `knowledge` is `false`, skip entirely
2. **Check scope** — if this workflow changed a documented area OR found durable cross-cutting knowledge, proceed
3. **Spawn Knowledge agent** — `Agent(subagent_type="Knowledge")` with WORKTREE_PATH, FEATURE_SLUG, FEATURE_NAME, DIRECTORIES, FILES_CHANGED, DECISIONS_CONTEXT, EXISTING_KB, EXPLORATION_OUTPUTS
4. **Agent writes KNOWLEDGE.md** — directly to `.devflow/features/{slug}/KNOWLEDGE.md`
5. **Agent updates index.md** — read-modify-write `index.md`; replace existing slug line or append; create file if absent
   - Line format: `- **{slug}** — {areas} — {Use-when description}`
6. **No result file** — no `.create-result.json`, no handoff artifact

### Flow 3: MDS build-time compilation

`npm run build:knowledge` (part of `npm run build` chain after `build:recipes`):

1. Reads `SOURCE_TO_PLUGIN_MAP` (9 entries, explicit — not a glob)
2. Validates each source `.mds` exists and each plugin `commands/` dir exists
3. Compiles each `.mds` file via `@mdscript/mds` `compileFile()`
4. Writes `{basename}.md` to the plugin's `commands/` dir (per-file clean: removes old output before recompile)
5. Hard-fails on any compile error — no stale command ever ships

The 9 host `.mds` files in `shared/knowledge/` are gitignored (generated build artifacts
in plugin `commands/` dirs are rebuilt on every `npm run build`).

## Integration Patterns

**index.md as regenerable cache**: If `index.md` is absent, `knowledge_load` globs
frontmatter and continues normally. Write-through recreates it on the next writeback.
There is no consistency risk from a missing index.

**knowledge_writeback conditionality**: The writeback call site is always present in the
compiled command, but the gate (`knowledge: false`) and the condition (documented area
changed / cross-cutting knowledge found) mean the Knowledge agent spawns only when useful.
If neither condition is met, write-back is a no-op.

**DECISIONS_CONTEXT injection**: `knowledge_writeback` passes `DECISIONS_CONTEXT` to the
Knowledge agent so it can cross-reference ADR/PF entries when authoring the KB.

**research.md bespoke knowledge**: `/research` Phase 7 (user-gated) has its own bespoke
knowledge creation block instead of using `knowledge_writeback()`, because the plan's
writeback list omits research. This is intentional — the bespoke block is the equivalent
of `knowledge_writeback` for the research workflow.

## Constraints

- **500-line cap**: KNOWLEDGE.md exceeding 500 lines must be split into focused sub-knowledge bases.
- **index.md line format**: `- **{slug}** — {areas} — {Use-when description}` — frontmatter is authoritative if the line format changes.
- **No sentinel gating**: The old `.devflow/features/.disabled` sentinel is removed. Config-only gate per ADR-001.
- **No concurrent lock**: `index.md` write-through may clobber concurrent writes, but the frontmatter fallback self-heals. `index.md` is git-tracked (shared), so it can also merge-conflict when two branches add different slugs — resolve by keeping both lines.

## Anti-Patterns

**Calling feature-knowledge.cjs**: This file no longer exists. All knowledge I/O is direct
file reads in `knowledge_load` (the MDS partial) and direct writes by the Knowledge agent.

**Writing to .create-result.json**: The handoff result file pattern is abolished. The
Knowledge agent writes KNOWLEDGE.md and index.md directly; no intermediate files.

**Passing FEATURE_KNOWLEDGE to /explore or /debug investigation workers**: These workflows
call `knowledge_writeback` only (no load). Investigators read code fresh to avoid
confirmation bias.

**Using index.json**: The old `index.json` (object keyed by slug) is deprecated. The new
`index.md` uses one line per KB in `- **{slug}** — {areas} — {Use-when}` format. If you
see `index.json`, it is a deprecated artifact — run `devflow init` to rename it.

**Depending on referencedFiles in frontmatter**: The `referencedFiles` field is no longer
used by the system (staleness detection is removed). Existing KBs may still have it in
their frontmatter — it is silently ignored. New KBs should omit it.

## Gotchas

**`knowledge_writeback()` is conditional, not unconditional**: The partial always checks
the config gate AND the area-change condition before spawning the Knowledge agent. A
workflow that changes no documented area and finds no cross-cutting knowledge skips the
agent spawn entirely. This is by design (P2: no unconditional spawns).

**index.md is the cache, not the source of truth**: `knowledge_load` uses it as a fast
path. If it is stale or absent, frontmatter glob is the authoritative fallback. Never
treat a missing `index.md` as a problem — write-through creates it lazily.

**The knowledge config key stays after pipeline removal**: ADR-001 requires config-only
gates. The `knowledge` key in `dream/config.json` still exists and gates write-back. The
old sentinel (`.devflow/features/.disabled`) is removed by the
`purge-feature-knowledge-pipeline-v1` migration.

**MDS brace-escaping**: In the `.mds` host files, every literal `{…}` in prose must be
escaped as `\{…\}`. Fenced code blocks (` ```bash `) use raw braces. Indented fences are
treated as prose — un-indent to avoid MDS interpolation errors.

## Key Files

- `shared/knowledge/_knowledge.mds` — defines and exports `knowledge_load` and `knowledge_writeback` partials; the single authoritative source for both algorithms
- `shared/knowledge/{name}.mds` (9 files) — host command sources that `@import "_knowledge.mds"` and call the partials; compiled to plugin commands at build time
- `scripts/build-knowledge.ts` — build script with explicit SOURCE_TO_PLUGIN_MAP; validates all 9 sources and dest dirs exist before compiling; hard-fails on any error
- `shared/agents/knowledge.md` — Knowledge agent contract: dual-write (KNOWLEDGE.md + index.md line), no result file, model=sonnet
- `shared/skills/feature-knowledge/SKILL.md` — Iron Law, 4-phase authoring, KNOWLEDGE.md template, index.md registration instructions
- `shared/skills/apply-feature-knowledge/SKILL.md` — 3-step consumption algorithm, skip guard, verify-against-code freshness
- `src/cli/commands/knowledge/list.ts` — reads index.md directly or falls back to frontmatter glob; no external scripts
- `src/cli/commands/knowledge/toggle.ts` — flips `knowledge` in dream config; no sentinel creation/deletion

## Related

- Working Memory (`.devflow/memory/WORKING-MEMORY.md`, `background-memory-update` worker) — sibling persistence layer; independent toggle.
- Decisions pipeline (`.devflow/decisions/`, `decisions-ledger.jsonl`) — sibling persistence layer; shares Dream marker protocol, independent toggle.
- ADR-021 (`.devflow/` local by default) — amended for `features/`: feature knowledge bases are git-tracked and committed by the Knowledge agent. See the carve-out in `scripts/hooks/ensure-root-gitignore` + `ensureDevflowGitignore`.
- `purge-knowledge-hooks-global-v1` migration — removes orphaned `eval-knowledge` + `feature-knowledge.cjs` from installed copies.
- `purge-feature-knowledge-pipeline-v1` migration — removes dream markers, lock/sentinel files, deprecates `index.json`.
