---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when changing installViaFileCopy, InstallReport, installAllRules, composeScripts, skill/rule shadow overrides, asset accessors, orphan sweeps or devflow skills/rules. Keywords: installer, shadow, sweep."
category: architecture
directories: [src/targets/claude-code/installer.ts, src/targets/claude-code/legacy.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/core/plugins.ts, src/core/assets.ts, src/core/paths.ts, src/core/orphan-sweep.ts]
created: 2026-07-13
updated: 2026-10-30
---

# Installer & Skill/Rule Shadowing

## Rules

- **KB-AP-1** A missing declared source (command, agent, skill or rule) is never a skip: it throws. `RuleInstallOutcome` `'skipped'` means a copy-level failure (EACCES, ENOSPC) only.
- **KB-AP-2** Registry-diff sweeps never intersect `knownNames` with the selected-plugin subset: a partial reinstall would delete other plugins' assets. `knownNames` spans ALL plugins.
- **KB-AP-3** `installAllRules` and `installRuleFile` take no `pluginsDir` or `ownerPlugin`: rule source is `rulesDir()` alone (flat `src/assets/rules/`).
- **KB-AP-4** Never scope the reference overlay, the Tracker agent file or the compliance skill to the machine's provider or compliance switch: a committed `.devflow/project.json` can turn each on by itself. Only the compliance RULE follows the machine switch. The one exception is the posting references, which the compliance switch alone removes (KB-INV-11).
- **KB-AP-5** `composeScripts` never `chmod`s the whole `scriptsTarget`: only the top-level entries step (a) copied, or a second `devflow init` is no longer a no-op on disk.
- **KB-AP-6** Keep `validateRuleShadow`'s `isFile()` guard: a directory at the shadow path passes the size check on some filesystems and `copyFile` then throws EISDIR.
- **KB-AP-7** The `devflow:*` skill sweep never touches bare `~/.claude/skills/{name}` dirs (the folder is shared): the `LEGACY_SKILLS_*` lists in `legacy.ts` only name candidates, and a bare folder moves to the backup folder only when its `SKILL.md` hash is a released one (backups KB).
- **KB-AP-8** `DELETED_PLUGIN_NAMES` is an in-memory filter over the prior manifest's plugin list, applied BEFORE the `LEGACY_PLUGIN_NAMES` rename map; it is never a filesystem delete.
- **KB-AP-9** A feature-owned skill shadow (compliance) is never seeded from its installed copy: that copy is already stamped, so `compliance --set` could never re-stamp it. Seed from shipped source.
- **KB-AP-10** Never import the production `EXCLUDED` set as a test oracle: pin an independent literal beside it, or the invariant guard becomes a tautology.
- **KB-AP-11** Never install from an unbuilt tree: compiled commands and generator-host agents are absent and the install throws. Run `npm run build` or `npm run build:mds` first.
- **KB-AP-12** Synthetic `PluginDefinition` literals in tests need `requires: []`: omission fails at runtime (`plugin.requires is not iterable`), never at typecheck.
- **KB-AP-13** A live `devflow init` in a test or agent run sets `HOME=<tmp>` explicitly; never touch the real `~/.claude`.
- **KB-AP-14** Never stamp tracker servers into a shipped agent source, and never write an installed Git or Tracker copy without the stamp: `installViaFileCopy` stamps Git as it writes it, and every converge either stamps or carries the installed stamp (tracker-feature KB).
- **KB-INV-1** An invalid or missing shadow warns and installs the shipped source; init never exits non-zero for a shadow.
- **KB-INV-2** Every source path comes from an accessor in `src/core/assets.ts`; `getPackageRoot()` throws when `package.json` is absent at the resolved root.
- **KB-INV-3** `agentSourceDirs(root?, switches)` and `commandSourceDirs(switches, root?)` return directories most-preferred first and every consumer takes the list as given; `tests/guards/agent-source-precedence.test.ts` pins it.
- **KB-INV-4** The skill, command and agent registry-diff sweeps run on every install shape, partial installs included.
- **KB-INV-5** Skills install for the closure `skills ∪ requires` of the effective selection, and the removal set is computed from `effectivePlugins`; `tests/guards/requires-closure.test.ts` guards the closure in both directions.
- **KB-INV-6** Shadow dirs are unprefixed (`~/.devflow/skills/{name}/`), installed skills are `devflow:`-prefixed, and `~/.devflow/skills|rules` are user-owned.
- **KB-INV-7** Per-item failure isolation: a failed rule copy, sweep removal or overlay unit warns or is reported and the rest proceeds.
- **KB-INV-8** The install never overwrites a user's own agent of a built-in type: devflow's `Explore` is skipped, with a warning, when any other file under the agents directory defines the exact name `Explore`; matching is byte-exact (`explore` is a different agent), the user's file is only ever read, and an unreadable agents directory installs rather than withholds.
- **KB-INV-9** The agent registry-diff sweep runs BEFORE the commands-and-agents copy; a partial install whose sweep removed a file widens the copy to `effectivePlugins` and rebuilds the agents map for it, and an ordinary partial init that removes nothing writes only the selected plugins (`tests/agent-rename-orphan-sweep.test.ts`).
- **KB-INV-10** Devflow never writes through a link at or below its own install folders (`linked-folder.ts`, `lstat` only): it refuses the folder or replaces the link, and reports it in `InstallReport.replacedLinks` or `refusedFolders`. A link is reported only after a real entry stands there (`emptyDirectoryExcept` returns `{replacedLinks, awaitingWrite}`; `reportLinksOnceWritten`). `writeFileReplacingLink` writes mode 0o644 over a link, never the target's mode. `devflow rules --enable` calls `refuseUnrealFolder` and skips the write when a rules-folder link stays.
- **KB-INV-11** With compliance off the installed `devflow:git` references omit the posting operation files and `publication-gate.md`. The three flat files of `COMPLIANCE_OFF_REMOVED_SKILL_FILES` are never copied (`complianceOffCopyExclusions` feeds the `copyDirectory` exclude set). An absent compliance-off root refuses the install, with no fallback to the on references. Enabling compliance restores each file byte for byte. The posting recipes live in `github-posting.md`, not `github-api.md`.
- **KB-INV-12** Every removal in a folder devflow installs into goes through the backup session: files devflow did not ship move to `~/.devflow/install-backups/` first, removal is by the scan's list then a plain `rmdir`, and a kept entry blocks a folder swap (`installer-shadowing-backups`).

## Overview

Devflow installs skills, rules, agents, commands and scripts through one path: `installViaFileCopy` in `src/targets/claude-code/installer.ts`. File copy is the only install mechanism. Every source path comes from a named accessor in `src/core/assets.ts`, backed by `getPackageRoot()` in `src/core/paths.ts`. `installViaFileCopy` returns an `InstallReport` that `init.ts` renders (shadow, skip, orphan-sweep and reference-overlay events).

The shadow override system lets users place personal versions of skills or rules under `~/.devflow/`. On every `devflow init` or `devflow rules --enable` a valid shadow is installed instead of the Devflow source; an invalid one warns and the source installs, so init never fails on it.

Skills are scoped to the selection: they install for the selected plugins plus every skill those plugins declare in `requires:`. Two things are deliberately NOT selection-scoped, because a repository can turn them on by itself in its committed `.devflow/project.json`: the generated skill-reference overlay (every provider's tree converges into the installed `devflow:git` skill) together with the Tracker agent file (`D-INSTALL-ALL-PROVIDERS`), and the feature-owned compliance skill with every framework reference (`D-COMPLIANCE-INSTALL-ALWAYS`, owned by the `compliance-feature` KB; the machine switch decides only the rule and the SKILL.md stamp). A third install condition is neither selection nor repository choice: the machine's curation switch picks the curation-off variant of every command and agent that has one and drops the `apply-decisions` skill (`D-LEARNING-VARIANT-INSTALL`). The machine's compliance switch likewise picks the compliance-off prompts and the compliance-off reference set (KB-INV-11). Tests pin roster sizes (`tests/fixtures/mds-manifest.ts`, `tests/fixtures/numeric-floors.json`).

This KB is the hub for the install-to-uninstall lifecycle and owns the core pipeline and shadowing. Facets live in sub-KBs (paths under Related):

- `installer-shadowing-reference-overlay` — generated reference overlay and its prune.
- `installer-shadowing-curation-variants` — curation-aware install/converge and the `/code-review` language-focus stamp.
- `installer-shadowing-uninstall` — uninstall lifecycle and the managed security deny-list removal.
- `installer-shadowing-backups` — the install backup session, shipped and retired sets, folder swaps, the bare legacy skill hash gate.
- `installer-shadowing-init-seed` — init seeding, manifest snapshots, managed config write, drain, proxy preflight order, migrations.
- `installer-shadowing-init-artifacts` — the `.gitignore` carve-out block and the CLAUDE.md import audit.
- `installer-shadowing-wizard-flags` — prompt-IO seam, compliance, attribution and gate-level wizard steps, flags CLI/TUI, the managed-shape oracle.
- `installer-shadowing-tracker-wiring` — tracker manifest group, wizard step, `devflow tracker`, Tracker agent install.

## System Context

The installer is reached from three entry points:
- **`devflow init`** calls `installViaFileCopy` (passing the settled `curation` switch), then `convergeCurationVariants` straight after it; it consumes `InstallReport` for the post-install summary and prints the CLAUDE.md import audit note last.
- **`devflow rules --enable`** calls `installAllRules` directly, mirroring init's rules block without re-running skill install.
- **`devflow curation --enable/--disable`** never calls `installViaFileCopy`; `applyCurationToggle` re-points the installed commands, agents and the `apply-decisions` skill at the new variant.

Shadow state is also read by `devflow skills list` and `devflow rules list` for the status display, and by `uninstall.ts` to enumerate user-authored content before cleanup.

## Component Architecture

### Asset Directory Accessors (`src/core/assets.ts`)

Every path to a source asset comes through a named accessor; there are no scattered `path.resolve(__dirname, '../..')` lookups in the installer.

| Accessor | Resolves to |
|----------|-------------|
| `skillsDir(root?)` | `{root}/src/assets/skills/` — flat, one subdir per skill. The `root` parameter lets the curation converge read the skill from the same package root as its other sources |
| `agentsDir(root?)` | `{root}/src/assets/agents/` — hand-authored `.md` agents plus `.mds` generator hosts |
| `compiledAgentsDir(root?)` | `{root}/dist/agents/` — compiled output of the `.mds` generator hosts (the roster is named in `tests/fixtures/mds-manifest.ts`) |
| `compiledSkillRefsDir(root?)` | `{root}/dist/skills/git/references/` — generated reference tree, spelled from `SKILL_REFS_OUTPUT_DIR` in `mds-variants.ts` |
| `skillRefsSourceDir(compliance, root?)` | `compiledSkillRefsDir()` on; off, `{root}/dist/compliance-off/skills/git/references/`, a complete tree |
| `rulesDir()` | `{root}/src/assets/rules/` — flat, one `.md` per rule |
| `scriptsDir()` | `{root}/src/assets/scripts/` — `hooks/` and `hud.sh` |
| `commandsDir()` | `{root}/dist/commands/` — compiled output of the command hosts (every command is an `.mds` host). The installer reads it through `commandSourceDirs`, not directly |
| `curationOffDir(kind, root?)` (also `complianceOffDir`, `bothOffDir`) | `{root}/dist/curation-off/{commands,agents}/` (or `compliance-off`, `curation-compliance-off`) — the off variant of each prompt with the matching arm, and only those; absent until the build has run, so readers tolerate it |
| `commandSourceDirs(switches, root?)` | `[dist/commands]` with both `VariantSwitches` on; the matching off dirs first otherwise — non-empty tuple `CommandSourceDirs` |
| `agentSourceDirs(root?, switches = ALL_SWITCHES_ON)` | `[compiledAgentsDir(), agentsDir()]` most-preferred first; with an axis off, its off dirs are prepended. The single owner of the dist-first agent-resolution policy. Returns the non-empty tuple `AgentSourceDirs`, so an empty list is a compile error at every call site |

Every accessor resolves against `getPackageRoot()` by default; all but `rulesDir`, `scriptsDir` and `commandsDir` take an injectable `root`, so a caller on a temp tree reads the layout from here instead of spelling it. `commandSourceDirs` and `agentSourceDirs` compose the others rather than spelling a path.

### Package Root Resolution (`src/core/paths.ts`)

`getPackageRoot()` resolves the package root from `import.meta.url` depth (two levels up from compiled `dist/core/paths.js`) and **throws loudly** if `package.json` is absent at the resolved root, so a depth mismatch surfaces at install time instead of producing wrong paths. `isContainedIn(parent, candidate)` is a pure containment predicate (no filesystem access): both paths resolved, `candidate` strictly inside `parent` (non-empty relative, no `..` prefix, not absolute outside). `reapplyAgentMapping` uses it against path-traversal mapping keys, and the reference prune uses it to scope recovery-copy checks.

### Hard-Error Policy for Declared Sources

All four asset types **throw** when a declared source is absent; registered assets have no silent skips.

| Asset | Source checked | Error trigger |
|-------|---------------|---------------|
| Command | `dist/commands/{name}.md`; with curation off, `dist/curation-off/commands/{name}.md` first | `fs.access` fails for every candidate in `commandSourceDirs(switches)` |
| Agent | `dist/agents/{name}.md`, then `src/assets/agents/{name}.md`; with curation off, `dist/curation-off/agents/{name}.md` first | `fs.access` fails for every candidate |
| Skill | `src/assets/skills/{name}/` | `stat` not a directory |
| Rule | `src/assets/rules/{name}.md` | `fs.access` fails |

Agents resolve **dist-first with a src fallback**: `installCommandsAndAgents` (the copy `installViaFileCopy` delegates to) walks `options.agentSourceDirs ?? agentSourceDirs(undefined, curation)` through the module-level `firstExisting(candidates)` helper and installs the first `{name}.md` that `fs.access` accepts, so a generator host's compiled artifact wins and hand-authored agents install unchanged. An injected `options.agentSourceDirs` wins as given and is not made curation-aware. Commands resolve the same way over `commandSourceDirs(switches)`. When no candidate exists the install throws, naming the curation-ON compiled path rather than the first candidate searched: a curation-off file exists only for a host with an arm, so naming it would point at a path that never existed for most hosts. An agent error lists every location searched and leads with `npm run build:mds`.

**The ordering convention has one owner.** Both production consumers take `agentSourceDirs()` as-is: the installer resolves first-hit-wins, and `loadShippedAgentDefaults` (`src/core/agent-models.ts`) merges first-wins over the same order. The `switches` argument is the installer's and the converge's alone; the other consumers keep the all-on default, because the shipped model and effort are identical in both variants. Order is invisible to the type system, so `tests/guards/agent-source-precedence.test.ts` pins that both consumers resolve every registry agent out of the same tree, with a reversed-list known-bad probe.

Shadow paths stay tolerant (warn and install source). The hard-error policy applies only to declared Devflow sources; the reference overlay has its own narrower throw path (see the reference-overlay KB).

### Orphan Sweeps

`src/core/orphan-sweep.ts` holds `sweepOrphanedAssets(dir, knownNames, extractRegistryName, mayRemove?, removal?) => Promise<SweepResult>`, the single compute site for flat registry-diff sweeps, imported by both `installer.ts` and `uninstall.ts`. `SweepResult = { scanned, removed: string[], failed: ReadonlyArray<{ name; error }> }`.
- **`scanned`** counts entries accepted by the predicate, NOT removals; tests assert `scanned > 0` so a sweep that matched nothing cannot pass.
- **Per-item isolation**: the `readdir` and each removal are independently try/caught. A missing directory is a no-op; a failed removal lands in `failed`.
- **`removal`** is `recursive` (default; uninstall) or `unlink` (files and links only; an entry that became a folder stays and is recorded in `failed`). The installer's `mayRemove` admits only entries the backup session classifies as devflow's own.
- `mdFileName(name)` / `mdEntryName(entry)` are the inverse pair for `.md` registry names. `src/core/reference-sweep.ts`'s `sweepOrphanedReferences` is the path-keyed sibling (two providers may both carry a `comment.md`); see the reference-overlay KB.

`installViaFileCopy` runs three ungated sweeps through it on every install shape, partial installs included; each `knownNames` spans ALL plugins, so only assets absent from the whole registry go:
- **Skills**: any `devflow:*` directory whose bare name is absent from `getAllSkillNames()`, after the backup pre-pass has moved the files devflow did not ship. Bare (pre-namespace) dirs are not touched here: `sweepLegacySkillFolders` moves one only on a released `SKILL.md` hash (backups KB). Shadow dirs are unaffected.
- **Commands**: any `.md` in `commands/devflow/` absent from `getAllCommandNames()`.
- **Agents**: any `.md` in `agents/devflow/` absent from `getAllAgentNames()`. Agents have no legacy name list; this sweep is their whole orphan cleanup, and it runs before the copy.

**Retired-agent widening.** The commands-and-agents copy is the shared `installCommandsAndAgents` (the plugins it is given and nothing else: no sweep, stamp or skills; the selective uninstall calls it too). A removed agent file means an older release is installed, and its commands for the plugins that stay still spawn the retired name. So when `isPartialInstall` and the agent sweep removed a file, the copy widens to `effectivePlugins` and the agents map is rebuilt with `buildAssetMaps`. An ordinary partial init removes nothing and rewrites only the selection.

A full install cleans `commands/devflow/`, `rules/devflow/`, `agents/devflow/` (around `tracker.md`, which `convergeTrackerArtifacts` alone owns) and the reinstalled skill folders through the backup session, never by recursive removal (backups KB). A link at a root is unlinked, never walked. A partial install has no pre-clean, so `refuseUnrealFolder` proves each folder first.

Results fold into `InstallReport.sweptOrphans` and `sweepFailures` through `recordSweep(report, kind, sweep)`, which every sweep call site uses, the reference prune included. `SweptAssetKind` has four values (`'skill' | 'command' | 'agent' | 'reference'`); `formatSweepSummary`'s `"{kind} {name}"` disambiguates them.

### InstallReport

`installViaFileCopy` returns an `InstallReport` with:
- `shadowedSkills`, `shadowedRules` (bare names that had a valid shadow applied);
- `skippedShadows: ShadowSkip[]` (`{ kind: 'skill'|'rule', name, reason: ShadowSkipReason }`, invalid shadows that were bypassed);
- `sweptOrphans` and `sweepFailures` (above; failures come from the skill, command and agent sweeps and the reference prune);
- `removedSkills` (skills removed because no selected plugin owns or requires them) and `dormantShadows` (shadows kept in `~/.devflow/skills/` for skills outside the selection: never installed, never deleted);
- `overlaidRefs` (manifest-relative paths the reference overlay WROTE this run), `unchangedRefs` (paths whose unit already held the staged bytes and was not promoted: no summary line renders it, but it tells "already correct" from a failed unit and makes a re-init that wrote nothing assertable), and `overlayFailures: OverlayFailure[]` (`{ unit, state, error }`);
- `replacedLinks` (a link replaced by a real entry) and `refusedFolders` (a path left alone, a link that stays or not a folder); `formatLinksSummary` renders both.

`init.ts` iterates `skippedShadows` and warns per entry via an exhaustive switch on `ShadowSkipReason` with a `never` guard; an invalid shadow never makes init exit non-zero. The report carries nothing from the curation converge: that run's warnings go to init's `installWarnings`.

### Agent Install: the Explore Override and the Tracker-server Stamp

Two things happen in the per-agent copy loop of `installCommandsAndAgents` beyond a plain `copyFile`.

**Explore override (`D-EXPLORE-OVERRIDE`, `D-EXPLORE-NO-CLOBBER`; `src/targets/claude-code/agent-type-owner.ts`).** Devflow ships an agent whose frontmatter `name:` is `Explore`, the type of the Claude Code built-in. Claude Code merges its agent sources into one map keyed by the exact `name:` string (a later source replaces an earlier one), so a user-level agent of that name replaces the built-in machine-wide, plan mode included; uninstalling restores the built-in. Two user-level agents of one type fall back to file load order, so `skipsForUserOwnedType` asks `findForeignAgentOwner` first: `BUILTIN_OVERRIDE_AGENTS` maps the registry name (`explore`) to the type it takes over, and the scan reads only a bounded head of each `.md` under the agents directory (bounded depth and entry count, sorted order, symlinks never followed, devflow's own directory skipped). A hit skips devflow's copy, removes any earlier devflow copy, and warns with the path and the remedy; every other outcome installs. `parseAgentType` reads only the top-level `name:` key and errs toward installing. Re-verify the merge order on a Claude Code upgrade.

**Tracker-server stamp (`D-TRACKER-SERVER-ALLOWLIST`; `src/targets/claude-code/tracker-servers.ts`).** `isTrackerStampedAgent` (Git and Tracker) routes the copy through `writeStampedAgent`, which writes the source with `stampAgentTools(source, trackerServerTools(servers))` applied in one step, so no unstamped copy of it ever sits on disk. `FileCopyOptions.trackerServers` carries the manifest's list (absent means the default). A source that cannot take the stamp is installed as shipped with a warning: an install must not die on a stamp. The other write paths and the list itself belong to the tracker-feature KB.

### Shadow States, Validation and Rule Install

- `SkillShadowState = 'valid' | 'missing-skill-md' | 'none'`; `RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none'`. Both are exported from `installer.ts` and imported by `skills.ts` and `rules.ts` for the exhaustive `buildSkillShadowTag` / `buildRuleShadowTag` display switches (with `never` guards).
- `validateSkillShadow(shadowDir)`: `'none'` when the dir is absent, `'valid'` when it holds a non-empty `SKILL.md`, `'missing-skill-md'` when `SKILL.md` is absent, empty or not a file. On `'valid'` the user's copy installs; on `'missing-skill-md'` the skip is recorded in `skippedShadows` and the Devflow source installs. Before any copy the skill source directory is stat-checked and throws if absent. The install loop and the curation converge both reach this through `resolveSkillSource`, so the shadow decision has one spelling (see the curation-variants KB).
- `validateRuleShadow(shadowFile)`: `'none'`, `'valid'`, `'empty-shadow-file'` or `'not-a-file'`. `installRuleFile(ruleName, devflowDir, rulesTarget)` uses it and resolves the source internally as `path.join(rulesDir(), `${ruleName}.md`)`; the declared source is `fs.access`-checked after shadow validation, so a valid shadow bypasses that check.
- `installRuleFile` returns a discriminated `RuleInstallOutcome` per rule; `installViaFileCopy` decodes the outcomes into `InstallReport.skippedShadows`. A per-rule try/catch isolates copy-level failures.
- `installAllRules` is the single compute site for rule installation: `installViaFileCopy` and `rules --enable` both call it, and callers only present the outcomes.

### composeScripts

`composeScripts(scriptsTarget)` assembles `~/.devflow/scripts/` from three sources in order: **(a)** `src/assets/scripts/` verbatim (`hooks/` and `hud.sh` via `copyDirectory`) except two files, then chmod 0755 on non-Windows. The two files are `hooks/assets/orchestrator-charter.md` and the `hooks/assets/implement-installed` sentinel: `copyDirectory` gets them as its exclude set, and `installRenderedCharter` (`charter-render.ts`) is their only writer. `installViaFileCopy` and a `--hud-only` run call `installScripts` (`installer.ts`), which runs `composeScripts` and then that writer (D-CHARTER-INSTALL-RENDER), so a verbatim copy cannot put the full source charter or a stale sentinel over a render; **(b)** the transitive `dist/hud/` import graph: starting at `dist/hud/index.js` it walks every relative JS import/export specifier and copies each reachable module to `scriptsTarget`, preserving its `dist/`-relative path; **(c)** a `package.json` with `{"type":"module"}`, written with `flag: 'wx'` (exclusive create; an existing file is left as-is).

**`D-SCRIPTS-EXEC-SCOPE`**: the chmod in (a) covers exactly the top-level entries `src/assets/scripts/` copied (`readdir` that source dir, chmod each corresponding destination entry), never a `chmodRecursive` or sweep of the whole `scriptsTarget`. A whole-tree chmod also re-stamps what (b) and (c) wrote earlier, so a second `devflow init` would give `package.json` an exec bit the first never did and re-init would stop being a no-op on disk. The install-snapshot goldens' re-init diff pins it (`test-harness` KB). `chmodRecursive` is bounded by the shared `MAX_REFERENCE_SWEEP_DEPTH`, and `composeScripts` swallows a breach silently.

Frozen externally-referenced paths: `~/.devflow/scripts/hooks/run-hook` and `~/.devflow/scripts/hud.sh`.

### Skill Namespace and Selection-scoped Skill Install

Skills install under `~/.claude/skills/devflow:{name}`; `prefixSkillName` / `unprefixSkillName` apply the prefix at install time, source directories in `src/assets/skills/` stay unprefixed, and shadow dirs stay unprefixed at `~/.devflow/skills/{name}/`.

Skills are plugin-scoped, as rules already were. Each `PluginDefinition` carries `requires: readonly string[]` beside `skills` — the skills it uses but does not own, hand-declared rather than derived, because a generated map cannot be reviewed and a wrong entry in it is invisible.

| Export (`src/core/plugins.ts`) | Answers |
|---|---|
| `skillsOf(plugins)` | the ONE spelling of `skills ∪ requires` over a plugin list |
| `skillOwners(name)` | which plugins provide a skill (drives the `devflow skills list` provenance column) |
| `buildScopedSkillsMap(plugins)` | the install map for a selection; `buildFullSkillsMap()` is a thin wrapper over it |
| `resolveSkillInstallPlan({effectivePlugins, isPartialInstall, shadowedSkills})` | pure → `{ install, remove, dormantShadows }` |
| `PRESENCE_GATED_SKILLS` | derived: the skills of command-less optional plugins. `/code-review` spawns one of their focuses only when the installer stamped it into the command; there is no run-time probe of Claude Code's directory |
| `installedLanguageFocuses(effectivePlugins)` | pure: `PRESENCE_GATED_SKILLS` filtered by the keys of `buildScopedSkillsMap(effectivePlugins)`, in registry order |
| `CURATION_GATED_SKILLS`, `omitCurationGatedSkills(map, curation)` | `['apply-decisions']`: owned and required in the registry but not installed when curation is off |
| `TEMPLATE_SKILL_REFS` | the classified exceptions to the closure guard, each with its site and reason |
| `FEATURE_OWNED_SKILLS`, `FEATURE_OWNED_RULES` | `['compliance']` each: owned by a feature, not a plugin |

`installViaFileCopy` still takes `skillsMap` as the install driver and has an OPTIONAL `effectivePlugins` (defaulting to `plugins`). Letting the plan drive the loop would break the many call sites that pass a deliberately narrow map (for example `plugins: []` plus `skillsMap: {git}`); on a full install the two lists agree, and the removal set, the only place the distinction bites, is always computed from `effectivePlugins`. It also takes a REQUIRED `curation: boolean` with no default (curation-variants KB).

`tests/guards/requires-closure.test.ts` guards the closure in BOTH directions: every `devflow:` reference in a plugin's corpus (its commands ∪ agents ∪ the bodies of every skill already in the closure, iterated to a fixed point) must resolve inside `skills ∪ requires`, and every declared `requires` entry must be reachable from that corpus. Non-skill `devflow:` spellings are classified out by LEFT CONTEXT (`/devflow:…` is a slash command, `<!-- devflow:…` a marker comment), never by an allowlist of names, so a misspelt skill still fails. The one reference no literal can resolve, the Review agent's focus-templated `devflow:{focus}`, is registered in `TEMPLATE_SKILL_REFS`. The guard reasons over the curation-ON variant (the superset): `apply-decisions` stays in its plugins' `requires`, and a separate describe pins that every `CURATION_GATED_SKILLS` entry is a registry skill some plugin requires, that the curation-on corpus references it (non-vacuity), and that no prompt a curation-off machine installs does.

### Registry Symbol Split: LEGACY_*, DELETED_*, EXCLUDED

| Symbol | File | Role |
|--------|------|------|
| `LEGACY_SKILL_NAMES` (composed from `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`) | `src/targets/claude-code/legacy.ts` | load-bearing candidate names for pre-namespace bare dirs at `~/.claude/skills/{name}/`; a name alone deletes nothing, the hash gate decides |
| `LEGACY_PLUGIN_NAMES` (rename map), `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES` | `src/core/plugins.ts` | load-bearing upgrade cleanup; both files' lists must be retained across upgrades |
| `DELETED_PLUGIN_NAMES` (currently `['devflow-audit-claude']`) | `src/core/plugins.ts` | in-memory filter, NOT an `fs.rm` |

`DELETED_PLUGIN_NAMES` is a plain string array, not a rename map. `resolvePluginList` in `manifest.ts` filters the prior manifest's plugin array with it during partial reinstalls, BEFORE the rename map, so a name in both lists is dropped, not migrated. `devflow-audit-claude` is listed here so stale manifest entries prune on the next partial reinstall.

`EXCLUDED: ReadonlySet<string>` is a module-level export of `plugins.ts` (not a function-local const) so the `EXCLUDED ∩ optional === ∅` invariant is assertable from tests; tests must pin an independent literal beside the import.

## Integration Patterns

### Shadow Paths (canonical)

| Asset | Shadow path | Install target |
|-------|-------------|----------------|
| Skill | `~/.devflow/skills/{name}/` (unprefixed) | `~/.claude/skills/devflow:{name}/` |
| Rule | `~/.devflow/rules/{name}.md` | `~/.claude/rules/devflow/{name}.md` |

### `devflow skills` CLI

`shadow <name>` validates the name against the registry ∪ `FEATURE_OWNED_SKILLS`, then seeds `~/.devflow/skills/{name}/` from `shadowSeedDir(bareName, installedDir)`: the installed copy `~/.claude/skills/devflow:{name}/` when there is one, else the shipped source. A feature-owned skill (compliance) always seeds from the shipped source (`D-COMPLIANCE-SHADOW-SOURCE`, mirroring `seedRuleShadow`'s Tier-1 skip), because the installed compliance SKILL.md is already stamped and a token-free shadow passes composition byte-identical, so a shadow seeded from it would stop `devflow compliance --set` from ever re-stamping it. A skill outside the selection is shadowed from source and reported DORMANT. `unshadow <name>` removes `~/.devflow/skills/{name}/`; the Devflow source returns on next init. `list` pre-reads `shadowDirSet` from `~/.devflow/skills/`, uses `shadowDirSet.has(skill)` as a short-circuit before `validateSkillShadow`, and renders a provenance column per row from `skillOwners` (`installed because: …` / `not installed — provided by: …`), memoised into an owners map built once before the row loop. A feature-owned skill has no plugin owner and says `the compliance feature (every install)`. Exports: `hasShadow(skillName, devflowDir?)`, `shadowSeedDir`.

### `devflow rules` CLI

`shadow <name>` validates against `allRules` and seeds via `seedRuleShadow` (three-tier, no `pluginsDir` parameter). `unshadow <name>` validates against `allRules` and exits 1 on unknown names. `list` delegates to `printRulesList`. In `--enable`, `installAllRules` is wrapped in try/catch (error isolation). Exports: `hasRuleShadow`, `listShadowedRules`, `seedRuleShadow`.

## Anti-Patterns

- **KB-AP-1, KB-AP-2, KB-AP-3, KB-AP-10, KB-AP-11** The Rules bullets state each in full: a missing declared source throws, `knownNames` spans every plugin (a single-plugin reinstall would otherwise delete the others' assets), rule source is `rulesDir()` alone, tests pin an independent literal beside `EXCLUDED`, and an unbuilt tree throws.
- **KB-AP-4, scoping the overlay, Tracker agent or compliance skill to the machine's selection** — a repository can select its own tracker and turn the compliance lens on in its committed `.devflow/project.json`, so a machine-scoped install would leave that repository's Git spawns without mechanics and its compliance agents without references. `installedReferenceManifest()` carries every provider, `convergeTrackerArtifacts` and `convergeComplianceArtifacts` install everywhere; only the compliance RULE follows the machine switch (`D-INSTALL-ALL-PROVIDERS`, `D-COMPLIANCE-INSTALL-ALWAYS`).
- **KB-AP-13, live installs against the real HOME** — an agent-run `devflow init` once wiped devflow dirs under the real `~/.claude`. Force `HOME=<tmp>` and a sandbox cwd inside the same Bash call (cwd resets between calls) and echo-check it.

## Gotchas

- **KB-AP-6, `validateRuleShadow`'s `isFile()` guard is load-bearing.** Without `stat.isFile()`, a directory at `~/.devflow/rules/{name}.md` passes the `size > 0` check on some filesystems and returns `'valid'`, so `copyFile(shadowDir, targetFile)` throws `EISDIR`.
- **KB-AP-7, orphan sweeps run on every install shape.** A partial reinstall still prunes assets absent from the full registry, and the overlay's prune still converges `references/tracker/**` to the manifest. Agents have no legacy name list; `LEGACY_SKILL_NAMES` and the `LEGACY_SKILLS_*` lists REMAIN load-bearing as the candidate names for pre-namespace bare dirs, which move only on a released `SKILL.md` hash.
- **KB-AP-8, `DELETED_PLUGIN_NAMES` is not a deletion.** See the symbol table; the filter-before-rename order is what makes a name in both maps drop.
- **A consumer still matching a three-value `SweptAssetKind` fails type-checking** now that `'reference'` is a member.
- **KB-AP-12, test plugin literals.** A synthetic `PluginDefinition` without `requires: []` throws at runtime because `tsconfig` does not include `tests/`.
- **Per-item isolation can mask systematic errors.** Per-item catches keep one failure from aborting the batch, but a systematic TypeError from an un-narrowed optional property is swallowed with them (uninstall KB has the concrete case).
- **A raw control byte in any `src/` file makes `grep` silently skip it** as a binary match, so repo-wide guards pass green while checking nothing; `tests/guards/no-control-bytes.test.ts` is the detector (scoped to all of `src/**`). When a guard passes over a file that legitimately carries control-character logic, confirm the file was actually read.

## Key Files

- `src/core/orphan-sweep.ts` — `sweepOrphanedAssets`, `SweepResult`, `mdFileName` / `mdEntryName`; shared by installer and uninstall
- `src/targets/claude-code/installer.ts` — `installViaFileCopy`, `installCommandsAndAgents` (`CommandsAndAgentsOptions`), `installAllRules`, `installRuleFile`, `composeScripts`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport`, `SweptAssetKind`, `SweepFailure`, `ShadowSkip`, `RuleInstallOutcome`, `SkillShadowState`, `RuleShadowState`, `copyDirectory`, `chmodRecursive`, `firstExisting`, `FileCopyOptions` (`curation` and `compliance` REQUIRED, `effectivePlugins`, `agentSourceDirs`, `warn`), `resolveSkillSource`; the overlay, curation and stamp pieces are covered by their own KBs
- `src/targets/claude-code/agent-type-owner.ts` — `BUILTIN_OVERRIDE_AGENTS`, `parseAgentType`, `findForeignAgentOwner`, the scan bounds; `src/targets/claude-code/tracker-servers.ts` — `TRACKER_STAMPED_AGENTS`, `isTrackerStampedAgent`, `restampTrackerAgents`; `tests/installer/explore-no-clobber.test.ts`, `tests/explore-agent.test.ts`, `tests/tracker-servers.test.ts` — their pins
- `src/core/assets.ts` — every accessor in the table above; the dist-first agent order and the curation-aware command/agent source order live here
- `src/core/paths.ts` — `getPackageRoot()` (hard `package.json` assertion), `isContainedIn`
- `src/targets/claude-code/linked-folder.ts` — `refuseUnrealFolder`, `removeReportingLink`, `writeFileReplacingLink`, `LinkReport`; `compliance-off-files.ts` beside it — the compliance-off copy exclusions, removal and restore
- `src/targets/claude-code/legacy.ts` — `LEGACY_SKILL_NAMES` and its component lists (candidate names; the backups KB lists the files that act on them)
- `src/core/plugins.ts` — `DEVFLOW_PLUGINS` (every entry carries `requires`), the skill-namespace and scoped-skill exports in the table above, `buildRulesMap`, `getAllSkillNames` / `getAllCommandNames` / `getAllAgentNames`, `partitionSelectablePlugins`, `EXCLUDED`, `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES`, `DELETED_PLUGIN_NAMES`
- `src/cli/commands/skills.ts` — `devflow skills shadow|unshadow|list`, `hasShadow`, `shadowSeedDir`, `buildSkillShadowTag`
- `src/cli/commands/rules.ts` — `devflow rules shadow|unshadow|list|--enable`, `hasRuleShadow`, `listShadowedRules`, `seedRuleShadow`, `buildRuleShadowTag`, `printRulesList`
- `tests/guards/requires-closure.test.ts`, `tests/guards/agent-source-precedence.test.ts`, `tests/scoped-install-e2e.test.ts`, `tests/installer/install-shape.test.ts` — the pinning tests for closure, source order, scoped install and install shape

## Related

- `.devflow/features/installer-shadowing-reference-overlay/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-curation-variants/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-backups/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-init-seed/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-init-artifacts/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-wizard-flags/KNOWLEDGE.md`, `.devflow/features/installer-shadowing-tracker-wiring/KNOWLEDGE.md` — the facets of this lifecycle
- `.devflow/features/compliance-feature/KNOWLEDGE.md` — owner of the always-installed compliance skill and its references
- `.devflow/features/tracker-references/KNOWLEDGE.md` — build side of the generated reference tree the overlay converges
- `.devflow/features/tracker-feature/KNOWLEDGE.md` — what a tracker selection means at read time
- `.devflow/features/curation-capture-system/KNOWLEDGE.md` — the machine feature switch and the build-side curation-variant splitter
- `.devflow/features/external-model-routing/KNOWLEDGE.md` — proxy mechanics; this KB family covers only proxy's footprint in install, uninstall and init seeding
- `.devflow/features/test-harness/KNOWLEDGE.md` — install-snapshot goldens that pin re-init idempotency
- `src/core/mds-variants.ts`, `src/core/agent-models.ts` — manifest source for the overlay and the second consumer of the agent source order
