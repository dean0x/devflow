---
feature: feature-knowledge-system
name: Feature Knowledge Base System
description: "Use when adding a new knowledge base entry, modifying how knowledge is loaded into agents, changing the write-through save model, extending the CLI knowledge commands, or working on the MDS build pipeline and generator hosts (build-mds.ts, mds-variants.ts, git.mds). Keywords: feature knowledge, KNOWLEDGE.md, write-through, knowledge_load, knowledge_writeback, build-mds, _knowledge.mds, index.md, apply-feature-knowledge, generator host, output-dir, dist/agents, mds-variants, validateOutputName, resolveOutputDir, stripGeneratorFrontmatter, mds-manifest."
category: architecture
directories:
  - src/cli/commands/knowledge
  - src/assets/skills/feature-knowledge
  - src/assets/skills/apply-feature-knowledge
  - src/assets/agents/knowledge.md
  - src/assets/commands/_partials
  - scripts/build-mds.ts
  - src/core/mds-variants.ts
  - src/assets/agents/git.mds
  - tests/fixtures/mds-manifest.ts
  - tests/build-mds-generator-hosts.test.ts
  - tests/guards/dist-agents.test.ts
created: 2026-06-21
updated: 2026-09-09
---

# Feature Knowledge Base System

## Overview

The Feature Knowledge Base System uses a **write-through** model. Knowledge is authored
in-command (at workflow end) by a simplified Knowledge agent that writes directly to
`.devflow/features/{slug}/KNOWLEDGE.md` and updates the `index.md` cache line. There is
no background refresh pipeline, no SessionEnd hook, no Learning task, and no deterministic
CJS engine.

**Source of truth = `KNOWLEDGE.md` frontmatter.** The `index.md` is a regenerable cache:
if it is absent or incomplete, `knowledge_load` falls back to globbing frontmatter across
all `features/*/KNOWLEDGE.md` files. A clobbered `index.md` is non-fatal.

`.devflow/` is local by default, but feature knowledge is the ONE exception (amends ADR-021):
the root `.gitignore` carve-out (`.devflow/*` + level-by-level `!` re-includes) tracks
`.devflow/features/index.md` + every `{slug}/KNOWLEDGE.md`, and the Knowledge agent commits
those paths to the current branch itself (scoped pathspec, no push, no force, no script). A
team opts back out by re-adding `.devflow/features/` to their own `.gitignore`.

This knowledge base also covers the **MDS build pipeline** (`scripts/build-mds.ts` +
`src/core/mds-variants.ts`) that compiles `.mds` sources into `dist/commands/` (13 command
hosts) and `dist/agents/` (1 generator host, the Git agent). The build pipeline is grouped
here because the knowledge partials (`_knowledge.mds`) are themselves MDS hosts, and the
generator-host convention that lets an *agent* be compiled from `.mds` was introduced in
the same tracker phase (#323/PR #334) as this KB's last refresh.

## System Context

**Purpose**: Give agents pre-computed codebase context for their specific task area without
requiring them to explore from scratch each session.

**Role in larger system**: One of two persistence layers under `.devflow/` (alongside the
Decisions pipeline). Knowledge is NOT a Learning task — it is written in-command. Working
memory is handled by the background-memory-update worker.

**External dependencies**: MDS compiler (`@mdscript/mds`) at build time to compile the
knowledge partials AND the Git agent generator host; `claude` agent at runtime (the
Knowledge agent, model=sonnet) to write KNOWLEDGE.md.

**Toggle**: `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`.
Feature state lives in `.devflow/config.json` (field `knowledge`, default `true`; see `src/core/feature-config.ts`).
Gates write-back ONLY — load is ungated (harmless). No sentinel file.

## Component Architecture

| Component | Path | Role |
|-----------|------|------|
| MDS partial module | `src/assets/commands/_partials/_knowledge.mds` | Defines + exports `knowledge_load` and `knowledge_writeback` |
| Host command sources (9) | `src/assets/commands/{name}.mds` | Command bodies that `@import "_partials/_knowledge.mds"` and call the partials |
| Host command sources (4 dynamic) | `src/assets/commands/dynamic-*.mds` | Dynamic workflow commands — `@import` various `_partials/*.mds`; not knowledge-specific |
| Build script | `scripts/build-mds.ts` | Frontmatter-driven: walks the whole repo (minus `IGNORE_DIRS`, to a bounded depth) for `.mds` files declaring a non-empty `output-dir:`, validates the destination + emitted filename via `src/core/mds-variants.ts`, and compiles each to `{output-dir}/{name}.md` (or `{output-name}.md`); refuses two hosts claiming one destination; prunes unclaimed `.md` files from `dist/agents/` after a clean build; hard-fails on any error |
| Output validation module | `src/core/mds-variants.ts` | Pure, zero-I/O core module: `validateOutputName` (filename charset/traversal) and `resolveOutputDir` (two-entry allowlist + backslash + canonical-spelling + containment check, returning `{ variant, abs }`); returns `Result`, never throws or exits — the shell (`build-mds.ts`) owns every `process.exit` (avoids PF-014, applies ADR-013) |
| Generator host | `src/assets/agents/git.mds` | The Git agent's `.mds` source; declares `output-dir: dist/agents` in a first frontmatter block, carries the agent's real frontmatter (name/description/model/skills) in a second block; compiles to `dist/agents/git.md` |
| MDS name manifest | `tests/fixtures/mds-manifest.ts` | `MDS_COMMAND_HOSTS` (13), `MDS_PARTIALS` (11), `MDS_GENERATOR_HOSTS` (`['git']`), `ALL_MDS_HOSTS` (14), `DIST_COMMAND_FILES` (14, incl. hand-authored `release.md`) — the single named-set source every count-literal test compares against, in both directions |
| Author agent | `src/assets/agents/knowledge.md` | Writes KNOWLEDGE.md + updates index.md line directly; model=sonnet |
| Author skill | `src/assets/skills/feature-knowledge/SKILL.md` | 4-phase authoring + KNOWLEDGE.md template + index.md registration |
| Consumption skill | `src/assets/skills/apply-feature-knowledge/SKILL.md` | 3-step algorithm for agents loading FEATURE_KNOWLEDGE |
| CLI list | `src/cli/commands/knowledge/list.ts` | Reads index.md / falls back to frontmatter glob; no external scripts |
| CLI toggle | `src/cli/commands/knowledge/toggle.ts` | Flips `knowledge` key in `.devflow/config.json` via `feature-config.ts`; no sentinel creation |

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

1. **Gate** — if `.devflow/config.json` `knowledge` is `false`, skip entirely
2. **Check scope** — if this workflow changed a documented area OR found durable cross-cutting knowledge, proceed
3. **Spawn Knowledge agent** — `Agent(subagent_type="Knowledge")` with WORKTREE_PATH, FEATURE_SLUG, FEATURE_NAME, DIRECTORIES, FILES_CHANGED, DECISIONS_CONTEXT, EXISTING_KB, EXPLORATION_OUTPUTS
4. **Agent writes KNOWLEDGE.md** — directly to `.devflow/features/{slug}/KNOWLEDGE.md`
5. **Agent updates index.md** — read-modify-write `index.md`; replace existing slug line or append; create file if absent
   - Line format: `- **{slug}** — {areas} — {Use-when description}`
6. **No result file** — no `.create-result.json`, no handoff artifact

### Flow 3: MDS build-time compilation

`npm run build:mds` (part of `npm run build` = `build:cli` + `build:mds`):

1. Walks the repo from root, skipping `IGNORE_DIRS`: `node_modules`, `dist`, `.git`, `.devflow`, `.claude`, `.release`, `tmp`, `tests`, `coverage` (`tests` and `coverage` are skipped so a `.mds` committed under either — a fixture or a coverage artifact, never a shipped host — can never be compiled into the real `dist/` tree; the skip is by directory **name**, so it holds under `DEVFLOW_MDS_ROOT` as well, and a fixture host planted at `<tmpRoot>/tests/` is likewise invisible. A `DEVFLOW_MDS_ROOT` env var lets negative-path tests redirect the whole walk to a throwaway temp root instead of the real repo). The recursion is bounded by `MAX_WALK_DEPTH` (12, counting the root as depth 0; the deepest `.mds` in the shipped tree sits at depth 4 and the deepest directory under `src/assets/` at depth 6). The bound **throws**, it does not truncate: a host skipped for being too deep would compile nothing while the build still printed its counts and exited 0, and no test could distinguish "not there" from "never looked" (PF-018). `readdirSync` tolerates `ENOENT`/`ENOTDIR` (an entry can vanish between the parent's readdir and the descent) and rethrows everything else
2. For each `.mds` file: reads the FIRST `---…---` frontmatter block with a scalar regex (`readFrontmatterKey`, not a YAML parse — the build must not gain a YAML dependency); if it declares a non-empty `output-dir:` key, treats it as a host, else a partial (skipped). `BUILD_KEYS` (`output-dir`, `output-name`) is the one list of keys the build consumes; it drives both the read here and the strip in step 5, so a key the build reads can never leak into a shipped artifact. A build key that is present but **valueless** is a malformed host and hard-fails during discovery with an explicit message (`output-dir: is empty …`, `output-name: is empty …`) — `readFrontmatterKey` returns `''` (not null) for a bare key, so `?? basename` would not fire and a silent basename fallback would hide the authoring mistake. Discovery precedes every plan and every write, so this exit leaves `dist/` wholly untouched
3. Validates the declared `output-dir` via `resolveOutputDir(root, declared)` from `src/core/mds-variants.ts`: containment (`isContainedIn`) → backslash rejection (declarations are POSIX-spelled by contract; `path.posix.normalize` leaves `\` untouched, so `dist\commands` would pass the canonical check on win32) → canonical-spelling check (POSIX-normalized, no trailing slash — `dist/commands/`, `./dist/agents`, `dist/skills/../commands` all refused) → allowlist match. On success it returns `{ variant, abs }` — the resolved absolute directory plus the `HostVariant` (`'commands' | 'agents'`) the matching allowlist entry declares, which is what selects the strip strategy in step 5. All four error kinds (`escapes-root`, `backslash-separator`, `non-canonical`, `not-allowlisted`) are rendered by an exhaustive `switch` with a `never` default in `build-mds.ts` and **thrown**, so `main()`'s aggregation reports every refusal and exits 1 once after the loop — no mid-loop `process.exit` leaving `dist/` half-updated. Message text: "escapes the repo root", "is not spelled canonically — write '…' instead", "is not the expected 'dist/commands' or 'dist/agents' — typo?"
4. Validates the filename that will be emitted (source basename, or the optional `output-name:` key's value) via `validateOutputName` — charset `^[a-z0-9][a-z0-9._-]{0,63}$`, refuses `..`/`.` segments and path separators — before it is joined onto the destination ("… is not a valid output filename"). Steps 3–4 run as a **plan pass over every host before the first byte is written**: `planHost` resolves a `{variant, outAbs, dest}` and the loop records each `dest` in a `Map<destAbs, HostEntry[]>`. A destination claimed by two or more hosts disqualifies **every** claimant (letting the first win would pick arbitrarily between two equally-declared intents and write it) — the build errors naming all claimants and writes none of them, while unrelated healthy hosts still compile. `output-name:` makes the collision reachable from one directory; two same-basename hosts in different source directories reach it with no key at all
5. Compiles each host via `@mdscript/mds` `compileFile()`, THEN strips frontmatter — dispatched by an exhaustive `switch` over the `HostVariant` returned in step 3 (`never` default), never by comparing the resolved path against a re-derived `dist/agents` constant. For a **command host** (variant `commands`), `stripBuildKeys` removes every `BUILD_KEYS` line from the single real frontmatter block (every other key, including `|`, `[]`, em-dashes, survives byte-untouched — no YAML round-trip); for a **generator host** (variant `agents`), `stripGeneratorFrontmatter` removes the ENTIRE first frontmatter block, promoting the second block (the artifact's real frontmatter, which the compiler treated as ordinary body text since only byte-offset-0 is frontmatter) into place with its trailing blank line intact. The generator strip verifies **both ends** of the transform: a leading block must exist before the slice (PRE), and a second block must be what the slice exposes (POST). A single-block generator host — the shape every hand-authored agent has, so the likeliest thing an author converting an agent will write — would otherwise lose its whole frontmatter (`name:`/`description:`/`model:`) and ship headerless with the build reporting success (PF-061). Both strips run AFTER `compileFile` — the compiler emits a byte-0 frontmatter block verbatim (never interpolated), so block 1 survives compilation unchanged and is safe to slice off afterward.
6. Writes `{basename}.md` — or `{output-name}.md` — to the declared `output-dir` via a temp file (`{dest}.{pid}.tmp` — scoped to the writing process so two concurrent builds never share one staging path) + `renameSync` (per-file atomic; the `.tmp` is cleaned up on rename failure; concurrent readers, e.g. parallel vitest workers, never see a partial write)
7. Hard-fails on any compile error — no stale command ever ships. Prints `N partial(s) skipped (no output-dir:)` and `N host(s) to compile:` — both lines are parsed by `tests/build-mds-generator-hosts.test.ts` §6 (AC-1.8); do not reword them.
8. **Prunes `dist/agents/`** (`pruneOrphanAgents`, only after step 7 finds zero errors): every `.md` there that no host in this build emitted is deleted, one `pruned:   {path} (no generator host)` line each. That directory is gitignored and outranks `src/assets/agents/` in both the installer's resolve and `loadShippedDefaults`'s merge, so a file left behind — a renamed host's old output, a hand-dropped one — is installed in preference to the audited source on every `devflow init`; the CI parity check catches it a commit later, which is too late for the machine that ran the build. Scope is deliberate: **`dist/commands/` is never pruned** (it also receives `release.md`, copied verbatim from a hand-authored source that is not a host, so "unclaimed" there does not mean "orphan"), non-`.md` entries are left alone (a concurrent build's `{dest}.{pid}.tmp` staging file lives there), and a refused build prunes nothing — `dist/` is left exactly as the refusal found it. The directory comes from `AGENTS_OUTPUT_DIR` in `mds-variants.ts` (the allowlist table's own spelling) rather than a second hardcoded path, because a build with zero generator hosts — where every file in the directory is an orphan — cannot derive it from the plan.

13 MDS-compiled **command** hosts (`MDS_COMMAND_HOSTS` in `tests/fixtures/mds-manifest.ts`): 9 knowledge hosts (`src/assets/commands/{name}.mds`) + 4 dynamic hosts (`src/assets/commands/dynamic-*.mds`). One further host is a **generator host** outside `commands/` — `src/assets/agents/git.mds`, which declares `output-dir: dist/agents` and compiles to `dist/agents/git.md` — so the build reports 14 hosts total (`ALL_MDS_HOSTS`, command hosts + generator hosts). `DIST_COMMAND_FILES` = 14 counts `dist/commands/` only: the 13 compiled command outputs plus `release.md`, which is hand-authored and copied verbatim (not MDS-compiled; SG-13 permanent divergence; see `dynamic-workflow-engine` KB). `ALL_MDS_HOSTS` (14, command+generator) and `DIST_COMMAND_FILES` (14, dist/commands/ only, incl. release.md) are different sets that happen to share a length — never conflate them. `MDS_PARTIALS` (11, `src/assets/commands/_partials/`) have no `output-dir:` and are skipped automatically; the `_` prefix convention is also enforced structurally — `validateOutputName` would refuse a filename starting with `_` if a partial were ever mistakenly treated as a host, since the regex requires `[a-z0-9]` as the first character.

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

**dist/agents as a shipping artifact directory**: Compiling the Git agent from a generator
host makes `dist/agents/` a second build output directory alongside `dist/commands/`, with
the same three properties `tests/guards/dist-agents.test.ts` enforces: (a) source↔output
parity in both directions, fail-loud (never a silent `catch { return }` skip on a missing
build — PF-018), (b) no leaked `\{`/`\}` escape sequences in compiled output (PF-024), (c)
no agent with both a hand-authored `.md` and a generator `.mds` source (the resolver would
silently pick a winner). Downstream consumers of `dist/agents`: `compiledAgentsDir()` in
`src/core/assets.ts`; the installer's agent-source loop (dist-first, `agentsDir()` as
fallback — first hit wins, and a hit on neither throws naming both dirs plus an
`npm run build:mds` hint); `loadShippedDefaults()` (merges dist over src for defaults;
ENOENT tolerated on the dist side only); the test resolver `resolveAgentSource` in
`tests/helpers.ts` (returns `origin: 'dist'` for the Git agent, `origin: 'src'` for every
other agent, and throws with a build hint when neither source resolves). `npm run
build:cli` alone no longer produces installable agents — `npm run build:mds` (or the
combined `npm run build`) is required.

## Constraints

- **500-line cap**: KNOWLEDGE.md exceeding 500 lines must be split into focused sub-knowledge bases.
- **index.md line format**: `- **{slug}** — {areas} — {Use-when description}` — frontmatter is authoritative if the line format changes.
- **No sentinel gating**: The old `.devflow/features/.disabled` sentinel is gone (clean break). Config-only gate per ADR-001 — the `knowledge` key in `.devflow/config.json` is the sole toggle.
- **No concurrent lock**: `index.md` write-through may clobber concurrent writes, but the frontmatter fallback self-heals. `index.md` is git-tracked (shared), so it can also merge-conflict when two branches add different slugs — resolve by keeping both lines.
- **Output-dir allowlist is closed**: `ALLOWED_OUTPUT_DIRS` in `mds-variants.ts` holds exactly `{ dir: 'dist/commands', variant: 'commands' }` and `{ dir: 'dist/agents', variant: 'agents' }`. Adding a third build destination means adding it to that one table — there is no other extension point, and `satisfies` forces the new entry to declare a `HostVariant`. Reusing an existing variant is a one-line change; introducing a new one widens the union and breaks every exhaustive dispatch over it until the new case is handled (that is the intended friction, not an obstacle to route around).
- **Phase-1 scope fence (AC-1.2)**: The generator-host mechanism intentionally has no variant expansion, `@if` conditionals, or per-provider templated filenames (`{provider}.md`). `tests/guards/dist-agents.test.ts` asserts their absence across the `.mds` host(s), `mds-variants.ts`, and `build-mds.ts` — a later phase that introduces them must update that guard deliberately, not accrete past it.

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

**De-indenting an MDS fence to "simplify" it**: Column-0 ` ``` ` fences are the only raw
(non-interpolated) text in an `.mds` source. Indenting a fence — or de-indenting one that
was deliberately indented — flips its interpolation treatment and is NOT byte-preserving.
`git.mds` carries 10 indented fences (notably the `post-review-summary` FULL/STUB fences
holding the D7 marker `cycle:\{CYCLE_NUMBER\} ts:\{REVIEW_TIMESTAMP\}`) whose braces are
deliberately escaped so the golden byte-count survives compilation; escaping is the only
valid treatment, never re-indentation.

**Adding a new build destination without editing `mds-variants.ts`**: `resolveOutputDir`'s
allowlist is the single gate on where the build may write. A host declaring an
unlisted `output-dir:` (even a real, sensible-looking path) is refused with the `typo?`
message — this is by design, not a bug to route around by hardcoding a path elsewhere.

## Gotchas

**`knowledge_writeback()` is conditional, not unconditional**: The partial always checks
the config gate AND the area-change condition before spawning the Knowledge agent. A
workflow that changes no documented area and finds no cross-cutting knowledge skips the
agent spawn entirely. This is by design (P2: no unconditional spawns).

**index.md is the cache, not the source of truth**: `knowledge_load` uses it as a fast
path. If it is stale or absent, frontmatter glob is the authoritative fallback. Never
treat a missing `index.md` as a problem — write-through creates it lazily.

**The knowledge config key is the sole gate**: ADR-001 requires config-only gates. The
`knowledge` key in `.devflow/config.json` gates write-back. The old sentinel
(`.devflow/features/.disabled`) is gone via the clean break — no migration removes it
because it was never deployed on this branch.

**MDS brace-escaping**: In the `.mds` host files, every literal `{…}` in prose (including
inline code and prose inside indented fences) must be escaped as `\{…\}`; only column-0
` ``` ` fences are raw. `~~~` fences, inline code, and prose are all interpolated —
`\{x\}` compiles to the literal `{x}`, an unescaped `{x}` is treated as a param
reference, and 2+ blank lines collapse to 1 (even inside fences). `git.mds` has 171
escaped brace pairs outside its column-0 fences. `stripGeneratorFrontmatter` and
`stripBuildKeys` both run on the compiler's OUTPUT, after this interpolation has
already happened — they never see or touch escape sequences.

**Converting a hand-authored agent to a generator host is not a re-emit**: The conversion
method that produced `git.mds` was `git mv` + a scripted fence-state-machine transform +
`cmp` against the golden fixture, never a fresh re-write of the body — regenerating the
body from scratch risks losing exact byte parity with `tests/fixtures/golden/git-agent.md`
(66,180 bytes, `GIT_AGENT_BYTES` derived once via `stat`, never hand-typed — PF-057: goldens
are compared, never regenerated by hand).

**output-dir: is kept as the last frontmatter key in host .mds files (test convention, not a strip requirement)**:
A `build-mds.test.ts` case asserts `output-dir:` is the last key in every command host's frontmatter, so keep it
last to satisfy the test. This is a style convention only — `stripBuildKeys`'s block-scoped regex removes
each build-owned key line regardless of its position, so key ordering does not affect byte-identity of the
compiled output. Generator hosts are exempt: their entire first block is a dedicated steering block
(`---\noutput-dir: dist/agents\n---`), not a shared block with other real keys.

**A generator host's first block may not smuggle extra keys through to the artifact**:
Whatever the first frontmatter block of a generator host carries (`output-dir:`, and
optionally `output-name:`) is stripped WHOLE. There is no key-level filtering for
generator hosts the way `stripBuildKeys` does for command hosts — adding an unrelated
key to a generator host's first block is harmless (it never reaches the compiled artifact)
but also pointless; put real agent metadata in the second block only.

**`output-name:` names one file; it does not template one**: The key that lets a host emit
a filename other than its source basename is spelled `output-name:`, matching what it does.
`name-template:` stays unclaimed for Phase 2, where variant expansion gives a templating
spelling real semantics — `src/core/mds-variants.ts` explicitly disclaims templating today,
so a key promising it would mislead the next author (applies ADR-003: name the end state,
not the intended future). No shipped host declares `output-name:`; its exercisers are the
build's own fixtures, which is deliberate — they are the end-to-end proof that
`validateOutputName` is wired into the write path at all.

**No test in `tests/build-mds-generator-hosts.test.ts` writes the real `dist/`**: every
build that file spawns is scoped to a temp `DEVFLOW_MDS_ROOT`, and its scenario-12 self-scan
(`collectSpawnScoping`, with a known-bad probe) is the mechanical proof — a spawn added
without `DEVFLOW_MDS_ROOT` fails the file. The two assertions that need the WHOLE committed
corpus (AC-1.8's printed host/partial census, and the dist/-is-in-sync check) get it from
`buildCommittedTree()`: `src/assets/{commands,agents}` are `fs.cp`-copied into a temp root
and built there, memoised so both share ONE spawn. Earlier these ran against the real repo
root; PID-scoping the staging file (`<dest>.<pid>.tmp`) closed the writer/writer clash, but
the writer/reader clash outlived it — a real-root build silently REPAIRS a stale `dist/`
while parallel workers read it, so the staleness surfaces as a flake in whichever reader
lost the race rather than as itself (PF-055). `tests/build-mds.test.ts` still spawns
real-root builds (`:477`, and a `beforeAll` at `:515`); it is the remaining writer.

**What the dist/-staleness check does and does not prove**: `dist/` is gitignored
(`git ls-files dist` → 0), so the check compares a fresh build of the committed `src/`
against whatever `dist/` the working tree holds — not against reviewed bytes frozen in git.
It catches "src/ changed and nobody rebuilt", a hand-edited `dist/`, and stale orphans; it
cannot catch a `src/` change that was rebuilt before review. AC-1.5's pre-S1 SHA-256 list
was verified by hand and lives only in the PR #334 body, so the check carries that claim
forward exactly as long as `dist/` carries the reviewed bytes (PF-019: the PR-body list is
a claim, not re-runnable evidence). The byte-idempotence test it replaced proved a property
of the build agreeing with itself, not a property of the artifacts (PF-057).

## Key Files

- `src/assets/commands/_partials/_knowledge.mds` — defines and exports `knowledge_load` and `knowledge_writeback` partials; the single authoritative source for both algorithms
- `src/assets/commands/{name}.mds` (9 files) — knowledge host command sources that `@import "_partials/_knowledge.mds"` and call the partials; compiled to `dist/commands/` at build time
- `scripts/build-mds.ts` — unified frontmatter-driven build script; discovers hosts by `output-dir:` key across the whole-repo walk from the repo root (`DEVFLOW_MDS_ROOT` overrides the root for isolated tests; minus `IGNORE_DIRS`, which skips `tests` and `coverage` so a `.mds` committed under either can never be compiled into the real tree; bounded by `MAX_WALK_DEPTH = 12`, which throws rather than truncating, and tolerates `ENOENT`/`ENOTDIR` on readdir); owns the single `process.exit`, reached only from `main()` after the loop; prunes unclaimed `.md` files from `dist/agents/` once that exit is passed (`pruneOrphanAgents`); renders errors from `mds-variants.ts` Result values through per-kind exhaustive switches (`outputDirRefusal`, `outputNameRefusal`) and throws them for aggregation
- `src/core/mds-variants.ts` — pure, zero-I/O core module: `validateOutputName` (filename charset/traversal guard) and `resolveOutputDir` (two-entry allowlist `dist/commands`/`dist/agents`, containment + backslash + canonical-spelling checks, returning `{ variant, abs }`); exports `HostVariant` and `AGENTS_OUTPUT_DIR` (the table's own spelling of the agents destination, consumed by the build's prune step); returns `Result<T, E>`, never throws for expected refusals and never calls `process.exit`. The `-variants` filename is a Phase-2 reservation recorded in its docblock (DR-16), not a description of today's contents
- `src/assets/agents/git.mds` — the Git agent's generator-host source: first block `---\noutput-dir: dist/agents\n---`, second block the agent's real frontmatter; compiles to `dist/agents/git.md`; 171 escaped brace pairs, 10 indented fences
- `tests/fixtures/mds-manifest.ts` — named-set manifest (`MDS_COMMAND_HOSTS`, `MDS_PARTIALS`, `MDS_GENERATOR_HOSTS`, `ALL_MDS_HOSTS`, `DIST_COMMAND_FILES`) that every count-literal assertion across `build-mds.test.ts`, `build-mds-generator-hosts.test.ts`, and `packaging.test.ts` compares against in both directions; floors only ever rise
- `tests/build-mds-generator-hosts.test.ts` — generator-host convention tests: whole-block strip, byte-unchanged command outputs, dest-allowlist negatives, filename-validation negatives, `IGNORE_DIRS` coverage, the `MAX_WALK_DEPTH` bound (a host one level past the bound fails the build naming it; the non-vacuity arm compiles the same host one level shallower), printed host/partial counts vs. the manifest (AC-1.8), and the `dist/agents/` orphan prune (an unclaimed artifact is deleted and reported; a claimed one, a non-`.md` entry, a `dist/commands/` file, and every file in a refused build all survive)
- `tests/guards/dist-agents.test.ts` — `dist/agents/` shipping-artifact guards: source↔output parity (fail-loud both directions), no leaked `\{`/`\}` escapes, no `.md`/`.mds` shadowing, resolver-origin assertions, and the AC-1.2 Phase-1 scope fence (no `@if`/`variants:`/provider templating)
- `src/assets/agents/knowledge.md` — Knowledge agent contract: dual-write (KNOWLEDGE.md + index.md line), no result file, model=sonnet
- `src/assets/skills/feature-knowledge/SKILL.md` — Iron Law, 4-phase authoring, KNOWLEDGE.md template, index.md registration instructions
- `src/assets/skills/apply-feature-knowledge/SKILL.md` — 3-step consumption algorithm, skip guard, verify-against-code freshness
- `src/cli/commands/knowledge/list.ts` — reads index.md directly or falls back to frontmatter glob; no external scripts
- `src/cli/commands/knowledge/toggle.ts` — flips `knowledge` in `.devflow/config.json` (`feature-config.ts`); no sentinel creation/deletion

## Related

- Working Memory (`.devflow/memory/WORKING-MEMORY.md`, `background-memory-update` worker) — sibling persistence layer; independent toggle.
- Decisions pipeline (`.devflow/learning/`, `decisions-ledger.jsonl`) — sibling persistence layer; independent toggle.
- ADR-021 (`.devflow/` local by default) — amended for `features/`: feature knowledge bases are git-tracked and committed by the Knowledge agent. See the carve-out in `src/assets/scripts/hooks/ensure-root-gitignore` + `ensureDevflowGitignore`.
- ADR-003 (end-state prose, clause iii — no artifact without a reachable consumer) — applies to the AC-1.2 Phase-1 scope fence in `tests/guards/dist-agents.test.ts`: forbidden Phase-2 constructs are pinned absent until a deliberate later change introduces them.
- ADR-013 (pure core modules, I/O at edges) — `src/core/mds-variants.ts` is zero-I/O; `scripts/build-mds.ts` is the shell that owns every filesystem call and `process.exit`.
- ADR-024 (named collectors + known-bad probes) — both `tests/build-mds-generator-hosts.test.ts` and `tests/guards/dist-agents.test.ts` follow this pattern (e.g. `collectAgentParity`, `collectEscapedBraceLeaks`, `collectForbiddenConstructs`, each with a paired known-bad probe).
- PF-014 (no `process.exit` in core) — `mds-variants.ts` returns `Result`; only `build-mds.ts` exits.
- PF-018 (non-vacuous guards) — `dist-agents.test.ts` deliberately avoids Guard 4's `catch { return }` skip-on-missing-build shape.
- PF-024 (escaped-brace leakage into dist) — guarded by `collectEscapedBraceLeaks` in `dist-agents.test.ts`.
- PF-035 (skim hook — use Read) — applies to this session's tool hygiene when reading `.mds`/`.ts` sources for verification.
- PF-043 (fixtures from real shapes) — `realAgentShape()` in `build-mds-generator-hosts.test.ts` derives its fixture from the live Git agent rather than inventing one.
- PF-057 (goldens compared, never regenerated) — `tests/fixtures/golden/git-agent.md` (`GIT_AGENT_BYTES`, derived once via `stat`) is the oracle for the generator-host conversion.
- `dynamic-workflow-engine` KB — covers `DIST_COMMAND_FILES` / `ALL_HOSTS` split and the SG-13 `release.md` hand-authored divergence in more depth.
- `test-harness` KB — covers `resolveAgentSource`, `requireDistFile(s)`, and the guard/goldens test-directory conventions these tests build on.
