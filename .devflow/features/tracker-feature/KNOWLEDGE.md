---
feature: tracker-feature
name: "Tracker Feature (provider selection, machine default, conventions lifecycle)"
description: "Use when changing how the issue-tracker provider is selected or resolved: features.tracker, project.json tracker, devflow tracker, --tracker, the sentinel and attempt counters. Keywords: TrackerProvider, parseTrackerId."
category: architecture
directories: [src/core/tracker.ts, src/cli/commands/tracker.ts, src/cli/commands/tracker-prompts.ts, src/cli/commands/init.ts, src/cli/commands/init-seed.ts, src/cli/commands/uninstall.ts, src/core/manifest.ts, src/core/feature-config.ts, src/core/migrations.ts, tests/core/tracker.test.ts, tests/core/feature-config-managed-write.test.ts, tests/feature-toggle-config.test.ts, tests/tracker-prompts.test.ts, tests/tracker-cli.test.ts, tests/seams/tracker-key-path.test.ts, tests/guards/no-control-bytes.test.ts]
created: 2026-09-17
updated: 2026-10-10
---

# Tracker Feature

## Rules

- **KB-AP-1** Never repair a provider token (trim, case-fold, alias, `?? id`): `parseTrackerId` is byte-exact and the validated token selects a hardcoded static-map row, never a path segment.
- **KB-AP-2** Never add `features.tracker` to `readManifest`'s hard-null set: every pre-tracker manifest would read as "no prior install"; `normalizeTrackerFeature` heals silently to `github`.
- **KB-AP-3** Never inline an `fs.rm` of an attempts counter or write `.tracker.enabled` without its removal arm: `rearmTrackerInference` and `applyTrackerSentinel` are the single owners.
- **KB-AP-4** Never re-arm only the machine provider's counter: a repository-selected provider's counter would stay capped.
- **KB-AP-5** No command moves, renames or deletes a conventions file; only the `tracker-conventions-per-provider-v1` migration moves the legacy file, and it never overwrites.
- **KB-AP-6** Never write `.devflow/config.json` as a whole-file replacement: only `writeManagedConfig` / `mergeManagedConfig`, or a hand-written `tracker` override and every unknown key is silently deleted.
- **KB-AP-7** Never type `FeatureConfig.tracker` narrower than `unknown`, and never consume it directly: always `parseTrackerOverride`, or a wrong-typed value is deleted before its `invalid` verdict.
- **KB-AP-8** Never collapse `absent` and `github` in the personal override: absent defers to the other layers, a chosen `github` narrows.
- **KB-AP-9** Never add `--no-tracker`, an `enabled` field on `TrackerFeatureState`, or a `TrackerError` taxonomy: `provider: 'github'` is the off position.
- **KB-AP-10** Never fuse selection (configuration) with conventions (inference): fusing forces every read site to define "selected but not yet learned".
- **KB-AP-11** A `grep` guard over a file holding a raw control byte silently skips it ("Binary file matches"); `tests/guards/no-control-bytes.test.ts` is the detector, and a passing guard must be confirmed to have read the file.
- **KB-AP-12** Adding or removing an agent, or changing tracker behaviour, means sweeping the instruction docs (CLAUDE.md and the agent docs): a stale statement or missing paragraph misroutes an agent.
- **KB-INV-1** A GitHub user sees nothing change: no prompt, no new file, no altered byte (held by the frozen status-lines golden, `provider-scope.test.ts` and the hook's zero-fork differential).
- **KB-INV-2** Precedence is project.json, then the personal config override (narrow-only), then the manifest, then `github`; only `resolve-settings.cjs` folds them.
- **KB-INV-3** `.tracker.enabled` holds the machine provider's NAME (removed for `github`) and the hook never opens the manifest; `tests/seams/tracker-key-path.test.ts` owns the TypeScript-to-shell seam.
- **KB-INV-4** `--set` and `init` converge in one order: manifest, then counters, then sentinel, all gated on the manifest write landing; a failed step warns and never aborts.
- **KB-INV-5** Both `devflow tracker --set` and `--status` re-arm the counters, plus any `devflow init`; each call site is pinned by source-level assertions.
- **KB-INV-6** Every install carries every provider's references, `_contract.md`, `_mcp.md` and the Tracker agent file, whatever the machine's provider.
- **KB-INV-7** Conventions are one file per provider; counters are per provider; the claim file `.tracker.processing` is global (one Tracker agent per machine).
- **KB-INV-8** A stale conventions file is safe to preserve as user content only because the reader-side mismatch guard removes the silence; dropping the guard requires reclassifying the files as install artifacts in the same change.
- **KB-INV-9** `src/core/tracker.ts` (pure domain plus lifecycle) never throws and never calls `process.exit()`; it returns `TrackerResult` and callers own rendering.

## Overview

Devflow speaks to one of three issue trackers: `github`, `jira` or `linear`. The feature is **two independent things that must never be conflated**:

- **Selection** is configuration, never inference. The MACHINE default is a manifest enum, `manifest.features.tracker = { provider }` over `github | jira | linear`, default `github`. A REPOSITORY may select its own tracker in its committed `.devflow/project.json` (`tracker: {provider, site, key}`), trusted automatically by user decision. `resolve-settings.cjs` folds the layers into one settings line (project.json, then the personal `.devflow/config.json` override, narrow-only: to `github` or the provider already resolved, anything else ignored and flagged `TRACKER_WARN=mismatch`, then the manifest, then `github`), and that line is the Git agent's only source of the provider. The session-start hook reads the machine default from the `.tracker.enabled` sentinel and forks the same resolver only when the repository's project.json (or a narrowing config.json) shows a tracker. Nothing infers it.
- **Conventions** are inferred, one file PER PROVIDER (`~/.devflow/tracker/{provider}.md`), written once per provider by a background agent and existing only for `jira`/`linear`. One machine can meet more than one provider (a github machine working in a jira repo), so a provider change moves nothing aside: each provider's file stays correct for the repositories that use it.

That separation is what makes the silent-`github` path, the hook gate and the zero-change GitHub guarantee trivial.

**Every install carries all three providers** (`D-INSTALL-ALL-PROVIDERS`): every generated reference (provider-independent `references/tracker/_contract.md` included; the count is pinned by `INSTALLED_REFS`), `references/tracker/_mcp.md` and the Tracker agent file (`agents/devflow/tracker.md`). A repository can select a provider the machine never did, and its Git spawns must find those mechanics. The trees are inert until a spawn resolves a provider and names one of its files, so carrying them costs disk, never context. A Git spawn running a tracker operation reads `_contract.md` once; a PR-host-only spawn reads neither contract. `github` needs no tool calls; `jira` and `linear` reach their tracker through connected tool servers and also load `_mcp.md`. The installer half belongs to `installer-shadowing`.

**Known limitation:** a provider's conventions are learned from the first repository that triggers inference for it; a second repository on the same provider with a different project reads the same file. Its project.json `site` and `key` outrank the file (as do the key's explicit-ref and git-history rungs), so such a repository should declare them.

**Facets of this feature** (one KB each, all under `.devflow/features/`):

- this hub: provider selection, the machine-default lifecycle, the personal override, uninstall classification and the cross-cutting flows;
- `tracker-feature-inference/KNOWLEDGE.md`: the background Tracker agent and hook Section 3 (the silent setup directive);
- `tracker-feature-reader/KNOWLEDGE.md`: the Git-agent side, i.e. `tracker/_contract.md`, `_mcp.md`, `redact-secrets.cjs --emit`, the DEGRADED registry and the byte budget;
- `tracker-feature-providers/KNOWLEDGE.md`: what registering a provider drags with it, plus the Jira and Linear mechanics.

`tracker-references` owns the contract/mechanics split, the generated reference tree and the installer overlay. **This feature owns the provider dimension**: how a provider is chosen, how conventions are inferred, how a reader resolves and refuses.

## System Context

Every user-visible claim of the feature reduces to one sentence: **a GitHub user sees nothing change.** Three mechanical controls carry it, none of them prose:

1. `tests/fixtures/golden/github-status-lines.txt` is **frozen**: regenerating it refuses without `--unfreeze`, and each re-capture is a logged authorisation. A single added status line breaks it, which is how an unconditional `- **Tracker**:` template line was caught. Moving step text between the Git agent and the references re-captures nothing: the status-lines sampler follows moved text by the documented straddle split, and `tracker/github/gather-release-evidence.md` is in `STATUS_LINE_REFERENCE_FILES` for that reason.
2. `tests/guards/provider-scope.test.ts` forbids `/\bjira\b/i` and `/\blinear\b/i` across the agents, commands and skills trees, and asserts no generated GitHub mechanics file names `_mcp.md`.
3. Under provider `github`, hook Section 3 performs **zero subprocess invocations**, proven differentially at runtime rather than by a source scan (see the inference facet).

The economic frame is `tracker-references`' too: `dist/agents/git.md` is re-sent on every Git spawn and most spawns run a PR-host operation that never touches the tracker, so the reader half lives in `references/tracker/_contract.md`, read once and only by a spawn that runs a tracker operation (`D-TRACKER-CONTRACT-ON-DEMAND`; see the reader facet).

## Component Architecture

### 1. The selection substrate: `src/core/tracker.ts` plus two CLI modules

`src/core/tracker.ts` holds two halves in one module, deliberately: a **pure domain** half (registry, `TrackerProvider`, `parseTrackerId`, `normalizeTrackerFeature`, path derivation, `parseTrackerFrontmatter`) with zero I/O, and a **lifecycle** half (`rearmTrackerInference`, `applyTrackerSentinel`, `migrateLegacyTrackerConventions`, the never-throwing `readBoundedHead`) that owns the `~/.devflow` tracker files. The lifecycle half sits in `src/core/` rather than a target adapter because `~/.devflow` is devflow-global, not Claude-Code-specific (the same reason `manifest.ts`'s read/write live there).

**`D-TRACKER-PAIR`:** `src/core/tracker.ts` (domain) plus `src/cli/commands/tracker.ts` (CLI) mirrors the `compliance.ts` pair exactly, and `src/cli/commands/tracker-prompts.ts` mirrors `compliance-prompts.ts`. The duplication of names is deliberate (pure-core / I/O-target split); anyone reviewing several `tracker*` files in one commit should not "merge" them. The wizard step is a four-part injectable contract (`shouldRunTrackerStep`, `TrackerPromptIO`, `buildClackTrackerPrompts`, `runTrackerStep`), so the gating predicate is testable without a terminal.

**Two parsers, not interchangeable** (the single most important distinction in the module):

| Function | Input | Behaviour | Emits DEGRADED? |
|---|---|---|---|
| `parseTrackerId(input: string)` | a CLI argument, or (in TypeScript) the personal config value via `parseTrackerOverride` | **byte-exact** membership against the registry: no trim, no case fold, no alias. `JIRA`, `jira `, ` jira`, `jira-cloud`, `GitHub` all **error** | the CLI path exits 1; a malformed repository value reaches the Git agent as the settings line's `TRACKER_WARN=invalid`, rendered `unknown tracker provider` |
| `normalizeTrackerFeature(raw: unknown)` | whatever is in the manifest | **tolerant**: every malformed shape heals to `{provider:'github'}` | **No.** Silent (re-init preserves existing values, so an unreadable one self-heals to the default) |

`D-TRACKER-STRICT`: repair is forbidden for `provider` ("reject, never repair"). Copying compliance's `normalizeId` (trim, lowercase, space-to-dash, alias) is explicitly forbidden: a normaliser here would mean `jira-cloud` silently selecting `jira`, the echo the static path map exists to prevent.

**`features.tracker` is absent-tolerant and deliberately NOT in `readManifest`'s hard-null set**; the prohibition is carried in the field's own doc comment. A bare string, `null`, a number, an array, `{}`, `{provider:null}` and `{provider:'../../etc/passwd'}` all parse non-null and heal to `github`. Do not conflate this silence with the per-repo config value's `unknown tracker provider`: different input, different authority, different outcome.

`D-TRACKER-NO-ENABLED`: `TrackerFeatureState` carries **only** `provider`. `provider: 'github'` **is** the off position (no inference, no background agent, no conventions file), so `{enabled:false, provider:'jira'}` would be an incoherent state every reader would have to keep interpreting. The same decision at the CLI: there is no `--no-tracker`, because a flag whose only meaning is "github" is a second spelling of an existing value. `TrackerResult<T>` is one local `{ok:true;value} | {ok:false;error:string}`; no `TrackerError` taxonomy exists because it would have no consumer (`parseFrameworkList` in `src/core/compliance.ts` sets the string-error precedent for a boundary parser). Nothing in the module calls `process.exit()` and nothing throws.

**One sentinel, two languages.** TypeScript's `applyTrackerSentinel` writes the machine provider's NAME into `.tracker.enabled` (one line, removed for github) and hook Section 3 reads it with the `read` builtin. `tests/seams/tracker-key-path.test.ts` owns the seam END TO END: for every registry provider the bytes the TypeScript writer leaves produce a directive naming that provider if and only if it is not github; it asserts Section 3 never reads the manifest's tracker key, and reads the allowlist arm out of the hook (`collectAdmittedProviders`). Its second section pins the personal `tracker` key's seam: `readConfig` plus `parseTrackerOverride` and `resolve-settings.cjs` classify the same bytes the same way, and `writeManagedConfig` leaves them on disk.

**`init.ts`'s tracker edit sites include one that is easy to miss**: the **hud-only manifest write**, which preserves the existing feature block on `--hud-only`; miss it and `devflow init --hud-only` silently drops a user's provider. The others: `resolveTrackerInitState`, `InitOptions.tracker`, the `--tracker <id>` option and its boundary parse (before any prompt), both wizard call sites, the Recommended summary row, the Advanced outcome loop (`trackerOverrideMessage`), and `persistManifestThenConvergeTracker`, which treats the manifest write and the tracker lifecycle as ONE unit (`D-TRACKER-CONVERGE`): write the manifest, install the Tracker agent, then re-arm the counters and converge the sentinel in parallel, all gated on the write having landed.

**The wizard gating predicate** (`shouldRunTrackerStep`) short-circuits in a fixed order and the order is the contract: `if (input.hasCliOverride) return false;` (`--tracker` wins on both paths), `if (!input.isTTY) return false;` (non-TTY is never asked), `if (input.mode === 'advanced') return true;`, else `return input.modePromptShown;` (Recommended asks only after an active choice). `modePromptShown` is the whole point: the `--recommended` flag and the non-TTY fallback never set it, so both keep their promptless contracts. This matches `shouldRunComplianceStep` and deliberately diverges from `shouldRunAttributionStep`, which is Advanced-only.

### 2. Single owners, and the conventions files nobody moves

`D-TRACKER-OWNER`: the attempt counters and the machine-provider sentinel have exactly **one** owner each in `src/core/tracker.ts`. Callers call; they never inline an `fs.rm`, because a bare "also delete this file" buried in a very large `init.ts` is the same policy expressed twice with no owner. The conventions files are the Tracker agent's to write and the user's to edit: **no command moves, renames or deletes one**.

| Owner | File | Rule |
|---|---|---|
| `applyTrackerSentinel(devflowDir, provider)` | `.tracker.enabled` | Holds the MACHINE provider's **name** on one line, written whenever it differs from `github` and **removed** when it is. A name rather than a bare marker, so the hook never opens the manifest to learn which provider it gates. Converged in **both directions by one function** (no write-without-remove asymmetry) |
| `rearmTrackerInference(devflowDir)` | `.tracker.{provider}.attempts`, every provider's (`TRACKER_ATTEMPTS_NAMES`, derived from the registry) | Removes **every** provider's counter, not only the machine's: a repository's project.json can select a provider the machine never did, and its counter is the one a user in that repository is capped on. Idempotent when absent, never throws |
| `migrateLegacyTrackerConventions(devflowDir)` | `tracker.md` to `tracker/{provider}.md` | Called only by the global migration `tracker-conventions-per-provider-v1` (`src/core/migrations.ts`). Returns `none \| moved \| kept \| failed`. Moves the legacy file to the provider its frontmatter names with `fs.rename` (which moves a SYMLINK itself, never its target, so a relative link then resolves one level deeper), **never overwrites** an existing provider file, and leaves a file with no registry provider (or a non-regular one) in place as user content with **one warning**. `failed` makes the migration THROW so it is not marked applied and retries on the next init. Every run that reaches the end also removes the legacy single counter `.tracker.attempts` |

Counters are per provider so a broken connection for one provider spends only its own attempts; the claim file stays global. `TRACKER_ATTEMPTS_MAX` is spelled twice (the hook cannot import TypeScript): the literal in the hook is the enforcer and the constant in `src/core/tracker.ts` is the number `devflow tracker --status` quotes back; `tests/core/tracker.test.ts` pins the two spellings together. `.bak` files an earlier release left beside `tracker.md` stay where they are as user content; nothing reads, moves or deletes them.

`init.ts` (`persistManifestThenConvergeTracker`) and `devflow tracker --set` (`runTrackerSet`, after `syncManifest`) each call the sentinel and re-arm owners exactly once. **Both `devflow tracker` subcommands re-arm (`D-F`):** `--status` additionally calls `rearmTrackerInference` after printing provenance, before its `return`. The reason an inspection command carries a write: `--status` is what a capped user reaches for to find out why nothing is being learned, and if it changed nothing the only escape from the cap would be deleting an undocumented dotfile by hand. The counters therefore have three callers (`init`, `--set`, `--status`) and the sentinel two. Call sites are pinned by source-level assertions (`tests/init-seed.test.ts`, `tests/tracker-cli.test.ts`): each owner is bound once into its I/O seam, `runTrackerSet` reaches none of them directly (only through `io`), and one `rearmTrackerInference` call is pinned in **each** `devflow tracker` branch rather than two in the file, so a re-arm drifting out of either branch goes red. The `--status` test drives the command as a subprocess against a seeded temp HOME and asserts the counter is actually gone.

### 3. The personal per-repo `tracker` key (`src/core/feature-config.ts`)

The Git agent never reads `.devflow/config.json`; `resolve-settings.cjs` folds the personal key into the settings line, narrow-only.

```ts
export type TrackerConfigOverride =
  | { kind: 'absent' }                            // NO override: defer to what the other layers resolved
  | { kind: 'valid'; provider: TrackerProvider }
  | { kind: 'invalid'; raw: string };             // carries the raw value for the DEGRADED
export interface FeatureConfig { /* ... */ tracker?: unknown }   // the RAW JSON value, verbatim
```

`FeatureConfig.tracker` is typed `unknown`, not `string`, and **the declared type IS the retention policy.** A field typed narrower than the file can hold becomes a silent delete: `tracker?: string` once type-filtered a numeric or boolean value away inside `coerceConfig` before `parseTrackerOverride` saw it, making its documented `invalid` verdict unreachable from the only place such a value is written. `parseTrackerOverride` gives a present-but-wrong-typed value (`42`, `true`, `null`, an array, an object) its own `invalid` verdict with `raw` set to `JSON.stringify`d text. Membership delegates to `parseTrackerId` (ONE authority). `BooleanFeature` needed `-?`, since a mapped type over an optional property yields `K | undefined`.

**`absent` is not `github`.** Absent defers to what project.json and the manifest resolved; a chosen `github` narrows to github. The field is carried through `coerceConfig` **by key presence** (`Object.prototype.hasOwnProperty`, never `in`, at a `JSON.parse` trust boundary) because every writer of the file is a read-modify-write over the whole config and a silently dropped key is a key a re-init **deletes**. A config.json that git TRACKS is not personal and is read as absent by every consumer (`D-PERSONAL-UNTRACKED`: `git ls-files --error-unmatch`, only when the file exists; git not answering fails its keys closed); `devflow tracker --status` warns with the `git rm --cached` fix.

**`D-CONFIG-PRESERVE-UNMANAGED`: every writer of `.devflow/config.json` goes through `mergeManagedConfig`, and the personal `tracker` override is why it exists.** A whole-file replacement holding only the keys devflow manages silently deleted a hand-written override (and any key devflow does not know), taking with it the DEGRADED report an invalid value would have produced. `mergeManagedConfig(existing: unknown, managed: ManagedConfig)` reads the file's own JSON object, drops only `RETIRED_CONFIG_KEYS` (`memory`, `learning`, `knowledge`, `decisions`, `autoCommit`), overwrites the one managed key, `reviewPublication`, **by name** (`ManagedConfig = Omit<FeatureConfig, 'tracker'>`, so a caller holding a whole `FeatureConfig` cannot clobber the override with its in-memory copy) and carries every other key from disk untouched. `writeManagedConfig(projectRoot, managed)` (`init`'s call) is the only production writer. The rule holds under `devflow init --reset` too. `tests/core/feature-config-managed-write.test.ts` and `tests/feature-toggle-config.test.ts` assert the override and an unknown key survive on disk (the latter drives the compiled CLI end to end under a scratch HOME, across every feature toggle).

## Component Interactions

**Selection flow.** `devflow init` and `devflow tracker --set` set only the MACHINE default, in one order. `--set` (`runTrackerSet`, `D-TRACKER-CONVERGE-SET`) writes exactly three things: the manifest, the re-armed attempt counters, the sentinel, and nothing else (no reference tree to swap, no agent file to add or remove, no conventions file to move aside). The sentinel follows the manifest because it ADVERTISES the value the manifest records and must never get ahead of it. `--set` always exits 0; its re-arm and sentinel steps warn rather than abort. `init`'s `persistManifestThenConvergeTracker` is the same order with the Tracker agent install between the manifest write and the two owners. Neither command touches a repository's project.json selection (the `src/cli/commands/tracker.ts` header says so in words).

**`devflow tracker --status`** prints `Provider:` (the machine default), an `Effective:   {provider} ({source})` line **only when a repository layer selects the tracker** (`repoTrackerSelection` over the resolver, from the cwd), `Conventions:` and `File:` for the EFFECTIVE provider's conventions path (`readTrackerStatusConventions`; both read `none` on GitHub), `Mechanics:` (installed reference files counted against the full install manifest: `installed (N file(s))` on every provider including GitHub, `MISSING — run devflow init`, or `unreadable (<errno>)`) and `Inference:` (the D-F re-arm). `devflow tracker` with no flag prints usage and returns 0; it is not an error path and its note says "github is the default, `devflow tracker --set github` turns the rest off" rather than naming a nonexistent `--no-tracker`.

**Inference flow.** SessionStart (`startup`/`clear`) → hook Section 3 resolves the provider (sentinel, plus one resolver fork only when project.json names a tracker) → positive allowlist → `tracker/$P.md` absent → the gates → `.tracker.$P.attempts` incremented → `--- TRACKER SETUP ---` in `additionalContext` → the main model **silently** spawns `Agent(subagent_type="Tracker", model="sonnet", run_in_background: true, prompt: "… Provider: {token}. Devflow directory: {abs}. Conventions file: {abs}. Project root: {abs}")` → the agent claims, probes, infers, writes that provider's file once, deletes the counter, deletes the claim. The next session sees the file and exits at one `stat` forever after.

**Read flow.** A Git spawn that runs a tracker operation reads `references/tracker/_contract.md` **once** (a PR-host-only spawn reads nothing of this), runs `resolve-settings.cjs` **once** as the contract directs, takes `TRACKER`, `TRACKER_SOURCE`, `TRACKER_WARN`, `SITE` and `KEY` from the line it accepts (else the fail-closed line), under a non-github provider reads the static map's conventions file if present (Read tool), compares its frontmatter `provider:` with the resolved provider and **refuses on mismatch**, then reads `references/tracker/{provider}/{op}.md` via the op's `**Mechanics:**` pointer. Body-posting steps pass the D11 scrub (an `&&` chain for file sinks, `--emit` for tool-call sinks) before the provider's post command.

**Uninstall flow.** The conventions directory `~/.devflow/tracker/` is **user content** (`userContentPaths` / `enumerateUserDevFlowContent`), together with a legacy `tracker.md` the migration left in place and every `tracker.md.{provider}.bak` an earlier release wrote (names derived from the registry). `resolveDevflowDirCleanup` flips a user-scope **interactive** uninstall from `'artifacts-only'` to `'prompt'` when any is present. `.tracker.processing`, every `.tracker.{provider}.attempts`, the legacy `.tracker.attempts`, `.tracker.enabled` and the `.tracker-staged.` prefix are **install artifacts** (`installArtifactPaths`), removed by an artifacts-only sweep that **keeps** the conventions. The two lists must stay disjoint. `tests/uninstall-logic.test.ts` pins the user-content item set (case 9f) and the residue-equality set (case 9c, which includes `tracker`, `tracker.md` and `tracker.md.jira.bak`).

**The user-content reversal condition is a live obligation (`KB-INV-8`).** The classification copies the `agent-models.json` reclassification, in which "silently" is the load-bearing word: stale per-agent overrides re-apply *silently*, so they were demoted to an install artifact. A stale conventions file is safe to preserve **only because the mismatch guard removes the silence** (`tracker configuration mismatch (conventions file)`). If that guard is ever dropped, descoped or softened, then in the same change move the conventions entries from `userContentPaths` to `installArtifactPaths` (the reversal note is at the code site) and adjust tests 9f and 9c. The guard ships, so the condition is currently satisfied and nothing needs reverting.

## Anti-Patterns

- **KB-AP-1 and KB-AP-2.** The validated token selects a **hardcoded path prefix from a static map** and is never concatenated into a path; falling back to the raw ID (`?? id`) is exactly the echo the map prevents. Compliance's `normalizeId` is the shape *not* to copy. Adding the manifest key to the hard-null set is tempting for symmetry with other features and wrong: the tolerant parse is the design.
- **KB-AP-3 and KB-AP-4.** The write-without-remove asymmetry leaves a GitHub user paying forever for a provider they switched away from; re-arming only the machine provider's counter is the per-provider form of the same mistake.
- **KB-AP-5.** Each provider owns `tracker/{provider}.md`, so a provider change has nothing to move aside; the files are the agent's to write and the user's to edit.
- **KB-AP-6.** Every writer must go through `mergeManagedConfig`; a whole-file write deletes the per-repo override and any key devflow does not know.
- **KB-AP-9.** `D-E` is the same decision at the CLI: a flag whose only meaning is "github" is a second spelling of an existing value, and a named error interface here has no consumer.
- **KB-AP-12.** Instruction docs are an execution surface: the CLAUDE.md Tracker paragraphs are capped by the `claude-md-tracker-block-max-chars` ceiling (`tests/docs/claude-md-tracker-section.test.ts`), which may be lowered and never raised, so a new tracker detail funds itself with a cut.

## Gotchas

- **KB-AP-11.** `src/core/tracker.ts` once wrote `describeTrackerValue`'s character class with **raw** `\x00`/`\x1f`/`\x7f` bytes, so `grep -n "^export" src/core/tracker.ts` returned `Binary file matches` and every repo-wide grep guard over `src/core/` silently missed the file. It is now `/[\x00-\x1f\x7f]/g` (behaviour-identical) with `no-control-bytes.test.ts` as the permanent detector. When a guard "passes" over a file, confirm the file was actually read.
- **Machine default versus repository selection** places `features.tracker` (manifest, machine-wide, beside `proxy` and `compliance`) opposite a repository's committed `project.json` selection and the personal narrow-only `config.json` override. They are different authorities with different precedence, folded in one place (`resolve-settings.cjs`), not two spellings of one setting.
- **Document the shape of any file that gates an action, and keep absent distinct from malformed.** The attempt counter's three-state handling (absent, malformed, well-formed) is the hook's; see the inference facet.

## Key Files

- `src/core/tracker.ts`: registry, `TrackerProvider`, `TrackerFeatureState`, `TrackerResult`, `parseTrackerId` (strict), `normalizeTrackerFeature` (tolerant), `describeTrackerValue`, the artifact basenames (`TRACKER_CONVENTIONS_DIR`, `TRACKER_LEGACY_CONVENTIONS_FILE`, `TRACKER_LEGACY_ATTEMPTS_FILE`, `TRACKER_ENABLED_FILE`, `TRACKER_CLAIM_FILE`, `TRACKER_STAGED_PREFIX`, `trackerAttemptsName` / `TRACKER_ATTEMPTS_NAMES`, `TRACKER_ATTEMPTS_MAX`), `trackerConventionsDir` / `trackerConventionsPath` / `trackerAttemptsPath` / `trackerEnabledSentinelPath`, `parseTrackerFrontmatter`, `TRACKER_CONVENTIONS_READ_BYTES`, `readBoundedHead`, and the lifecycle owners `rearmTrackerInference` / `applyTrackerSentinel` / `migrateLegacyTrackerConventions`
- `src/cli/commands/tracker.ts`: `runTrackerSet` + `TrackerSetIO` + `buildTrackerSetIO`, `formatTrackerStatus`, `readTrackerMechanics` / `formatTrackerMechanics` / `TrackerMechanicsState`, `readTrackerProvenance` / `formatTrackerProvenance`, the D-F re-arm on both subcommands
- `src/cli/commands/tracker-prompts.ts`: `shouldRunTrackerStep`, `TrackerPromptIO` (a sibling `selectProvider` rather than a widened boolean `select`), `buildClackTrackerPrompts`, `runTrackerStep`, `formatTrackerSummary`, `formatProviderCatalogue`
- `src/cli/commands/init.ts`: the tracker edit sites, `persistManifestThenConvergeTracker` + `TrackerLifecycleIO`, `resolveTrackerInitState`, `--tracker <id>` and its boundary parse
- `src/core/migrations.ts`: `tracker-conventions-per-provider-v1` (global): `moved` an info line, `kept` one warning, `failed` a throw so the runner retries
- `src/core/manifest.ts`: `features.tracker`, `normalizeTrackerFeature` on read, the hard-null-set prohibition in the field's doc comment
- `src/core/feature-config.ts`: `TrackerConfigOverride`, `parseTrackerOverride`, `FeatureConfig.tracker?: unknown`, `BooleanFeature`'s `-?`, `mergeManagedConfig` / `writeManagedConfig` / `ManagedConfig`, `RETIRED_CONFIG_KEYS`
- `src/assets/scripts/resolve-settings.cjs`: the settings line (`TRACKER`, `TRACKER_SOURCE`, `TRACKER_WARN`, `SITE`, `KEY`, ...), `SETTINGS_LINE_RE`, `foldTracker`
- `src/cli/commands/uninstall.ts`: `tracker/`, the legacy `tracker.md` and every `tracker.md.{provider}.bak` in `userContentPaths` (reversal note at the code site); the claim file, every counter, the legacy counter, the sentinel and the staging prefix in `installArtifactPaths`
- `tests/core/tracker.test.ts`: registry, the hostile-payload table, the self-heal table, lifecycle, the key-path walk, the `TRACKER_ATTEMPTS_MAX` pin
- `tests/tracker-prompts.test.ts`, `tests/tracker-cli.test.ts`, `tests/init-seed.test.ts`: the wizard gate matrix and step semantics; the CLI resolver, provenance and the call-site assertions
- `tests/core/feature-config-managed-write.test.ts`, `tests/feature-toggle-config.test.ts`: override and unknown-key survival
- `tests/seams/tracker-key-path.test.ts`: the TypeScript-to-shell sentinel seam and the TypeScript-to-resolver seam
- `tests/guards/no-control-bytes.test.ts`: no raw control byte in any shipped source under `src/`
- `docs/cli-reference.md` (`## Issue Tracker`)

## Related

- `.devflow/features/tracker-feature-inference/KNOWLEDGE.md`: the Tracker agent and hook Section 3
- `.devflow/features/tracker-feature-reader/KNOWLEDGE.md`: `_contract.md`, `_mcp.md`, `--emit`, the DEGRADED registry, the byte budget
- `.devflow/features/tracker-feature-providers/KNOWLEDGE.md`: registering a provider; the Jira and Linear mechanics
- `.devflow/features/tracker-references/KNOWLEDGE.md`: the contract/mechanics split, the generated references, the installer overlay, the byte-budget discipline this feature's provider dimension sits on
- `.devflow/features/compliance-feature/KNOWLEDGE.md`: the feature whose `src/core` + `src/cli/commands` + `*-prompts.ts` shape this one copies, and the owner of the traceability semantics the mismatch guard extends
- `.devflow/features/installer-shadowing/KNOWLEDGE.md`: `resolveSeedFeatures`, `applyCliToggles`, `resolveDevflowDirCleanup`, `enumerateUserDevFlowContent`, `installArtifactPaths`, and the wizard-step seam (`WizardPromptIO`, `shouldRunComplianceStep`) the tracker step mirrors
- `.devflow/features/learning-capture-system/KNOWLEDGE.md`: hook Sections 1-2 and Learning's own claim-staleness constant
- `.devflow/features/test-harness/KNOWLEDGE.md`: named-collector-plus-known-bad-probe guard conventions, `numeric-floors.json`'s floors-versus-ceilings discipline, the goldens lifecycle
- `index.md` + `{slug}/KNOWLEDGE.md` are git-tracked while the rest of `.devflow/` stays ignored, so this file and its index line are shared with the team; the feature's runtime state is not
