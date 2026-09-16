---
feature: tracker-feature
name: "Tracker Feature (provider selection, the background Tracker agent, hook Section 3, the tool-call contract and the reader-side preamble)"
description: "Use when changing how the issue-tracker provider is selected or resolved, editing src/core/tracker.ts or src/cli/commands/tracker.ts or tracker-prompts.ts, touching the tracker wizard step or --tracker in init.ts, modifying the Tracker agent or the ~/.devflow/tracker.md schema, editing session-start-context Section 3, working on redact-secrets.cjs --emit or src/assets/mds/tracker/_mcp.mds, changing the Git agent's provider-resolution preamble or the mismatch guard, adding the Jira (3b) or Linear (3c) provider modules, or re-deriving the Phase-3 byte budget. Keywords: features.tracker, TrackerProvider, parseTrackerId, normalizeTrackerFeature, TRACKER_PROVIDER_KEY_PATH, TrackerFeatureState, TrackerResult, rearmTrackerInference, applyTrackerSentinel, renameStaleTrackerConventions, trackerAttemptsPath, trackerConventionsPath, trackerEnabledSentinelPath, shouldRunTrackerStep, runTrackerStep, TrackerPromptIO, resolveTrackerCliAction, readTrackerProvenance, devflow tracker, --tracker, .tracker.enabled, .tracker.attempts, .tracker.processing, tracker.md, TRACKER SETUP, TRACKER_PROCESSING_STALE_SECS, TRACKER_ATTEMPTS_MAX, TRACKER_MODEL, TRACKER_DEVFLOW_DIR, TRACKER_SCHEMA_SECTIONS, Tracker agent, _mcp.mds, MCP_CONTRACT_MODULE, MCP_BACKED_PROVIDER_SUBDIRS, mcpContractIsGenerated, resolveVariantModules, GATED_REFERENCE_MODULE_SOURCES, validateContractOutputName, --emit, D11-OK, D11-FAIL, D11_FAIL_REASONS, NONCE_HEX_CHARS, TrackerConfigOverride, parseTrackerOverride, tracker configuration mismatch, unknown tracker provider, BUDGET_GIT_MD_P3, BUDGET_LOADED_SET_P3, OD-9, OD-10, OD-11, OD-14, OD-15, D-E, D-F, DR-01, DR-02, DR-06, DR-10, DR-15, DR-21, DR-22, DR-25, DR-26."
category: architecture
directories: [src/core/tracker.ts, src/cli/commands/tracker.ts, src/cli/commands/tracker-prompts.ts, src/cli/commands/init.ts, src/cli/commands/init-seed.ts, src/cli/commands/uninstall.ts, src/core/manifest.ts, src/core/feature-config.ts, src/core/mds-variants.ts, src/assets/agents/tracker.md, src/assets/agents/git.mds, src/assets/mds/tracker, src/assets/scripts/hooks/session-start-context, src/assets/scripts/redact-secrets.cjs, tests/core/tracker.test.ts, tests/tracker-agent.test.ts, tests/tracker-prompts.test.ts, tests/tracker-cli.test.ts, tests/tracker, tests/seams/tracker-key-path.test.ts, tests/seams/tracker-claim-staleness.test.ts, tests/guards/mcp-sink-bypass.test.ts, tests/guards/no-control-bytes.test.ts]
created: 2026-09-17
updated: 2026-09-17
---

# Tracker Feature

## Overview

Phases 0–2 left a provider-shaped hole in the Git agent with exactly one provider in it. Phase 3 (issue #325, tracking #321) fills the hole with **two independent things that must never be conflated**:

- **Selection** is a manifest enum — `manifest.features.tracker = { provider }` over `github | jira | linear`, default `github`. It is read by a hook and by a prompt preamble. Nothing infers it.
- **Conventions** are an inferred global file — `~/.devflow/tracker.md`, written once by a background agent, existing only for a non-GitHub user.

That separation is load-bearing, not cosmetic: it is what makes the silent-`github` path, the hook gate and the zero-change GitHub guarantee all trivial. A design that fused them would have to decide what "selected but not yet learned" means at every read site.

Commit group 3a is complete and covers selection, the agent, the hook and the reader-side substrate. **Providers 3b (Jira) and 3c (Linear) are not implemented** — see `## Provider: Jira (3b)` and `## Provider: Linear (3c)` below, which exist as the named slots those subtasks fill.

`tracker-references` owns the Phase-2 contract/mechanics split, the generated GitHub references, the installer overlay and the Phase-2 byte-budget discipline. **This KB owns the provider dimension**: how a provider is chosen, how conventions are inferred, and how a reader resolves and refuses.

## System Context

Every user-visible claim of the feature reduces to one sentence: **a GitHub user sees nothing change.** No prompt, no new file, no altered byte. Three mechanical controls carry it, and none of them is prose:

1. `tests/fixtures/golden/github-status-lines.txt` is **frozen** and `cmp`-identical to `ecfc141` — the Phase-2 merge point. A single added status line breaks it, which is exactly how an unconditional `- **Tracker**:` template line was caught during 3a-4.
2. `tests/guards/provider-scope.test.ts` forbids `/\bjira\b/i` and `/\blinear\b/i` across the agents, commands and skills trees, and asserts no generated GitHub mechanics file names `_mcp.md`.
3. Under provider `github`, Section 3 of the session-start hook performs **zero subprocess invocations** — proven differentially at runtime, not by a source scan (see `### 4`).

The economic frame is `tracker-references`' too: `dist/agents/git.md` is re-sent on every Git spawn, so the reader-side preamble is the only place Phase 3 may spend always-loaded characters, and it must fund itself (see `### 8`).

## Component Architecture

### 1. The selection substrate — `src/core/tracker.ts` + two CLI modules

`src/core/tracker.ts` holds two halves in one module, deliberately: a **pure domain** half (registry, `TrackerProvider`, `parseTrackerId`, `normalizeTrackerFeature`, path derivation) with zero I/O, and a **lifecycle** half that owns the three `~/.devflow` tracker files. The lifecycle half sits in `src/core/` rather than a target adapter because `~/.devflow` is devflow-global, not Claude-Code-specific — the same reason `manifest.ts`'s read/write live there (ADR-013).

**`D-TRACKER-PAIR` [DR-25], recorded at the code site and restated here because anyone reviewing five `tracker*` files in one commit otherwise has no signal the duplication is deliberate:** `src/core/tracker.ts` (domain) + `src/cli/commands/tracker.ts` (CLI) mirrors the `compliance.ts` pair exactly; ADR-013's pure-core / I/O-target split is the reason both names exist. `src/cli/commands/tracker-prompts.ts` is the third name and mirrors `compliance-prompts.ts` for the same reason — the wizard step is a four-part injectable contract (`shouldRunTrackerStep`, `TrackerPromptIO`, `buildClackTrackerPrompts`, `runTrackerStep`), so the gating predicate is testable without a terminal.

**Two parsers, and they are not interchangeable.** This is the single most important distinction in the module:

| Function | Input | Behaviour | Emits DEGRADED? |
|---|---|---|---|
| `parseTrackerId(input: string)` | a CLI argument or a per-repo config value | **byte-exact** membership against the registry — no trim, no case fold, no alias. `JIRA`, `jira `, ` jira`, `jira-cloud`, `GitHub` all **error** | the per-repo config path emits `unknown tracker provider`; the CLI path exits 1 |
| `normalizeTrackerFeature(raw: unknown)` | whatever is in the manifest | **tolerant** — every malformed shape heals to `{provider:'github'}` | **No.** Silent, per [DR-26] and ADR-014 |

`D-TRACKER-STRICT`: repair is forbidden for `provider`. §14.9 constraint 6 ("Reject, never repair") settles it, and copying compliance's `normalizeId` (trim + lowercase + space→dash + alias) is explicitly forbidden by the plan — a normaliser here would mean `jira-cloud` silently selecting `jira`, which is the echo the static path map exists to prevent.

**`features.tracker` is absent-tolerant and is deliberately NOT in `readManifest`'s hard-null set.** The prohibition is carried in the field's own doc comment, because adding it would make **every pre-tracker manifest read as "no prior install"**. A bare string (`features.tracker: "jira"`), `null`, a number, an array, `{}`, `{provider:null}`, `{provider:'../../etc/passwd'}` all parse non-null and heal to `github`. Do not conflate this silence with the per-repo config value's `unknown tracker provider` — different input, different authority, different outcome.

`D-TRACKER-NO-ENABLED`: `TrackerFeatureState` carries **only** `provider`. There is no `enabled` field, unlike compliance's sibling state. `provider: 'github'` **is** the off position — GitHub is the default and needs no inference, no background agent and no conventions file — so `{enabled:false, provider:'jira'}` would be an incoherent state every reader would have to keep interpreting. `D-E` is the same decision at the CLI: there is no `--no-tracker`, because a flag whose only meaning is "⇒ github" is a second spelling of an existing value.

`TrackerResult<T>` is one local `{ok:true;value} | {ok:false;error:string}`. There is no `TrackerError` taxonomy: a named error interface here would have no consumer (ADR-003), and `parseFrameworkList` in `src/core/compliance.ts` already establishes the string-error channel for a boundary parser. Nothing in the module calls `process.exit()` and nothing throws (avoids PF-014), so callers own their own rendering.

**One manifest key path, two readers.** `TRACKER_PROVIDER_KEY_PATH = 'features.tracker.provider'` is a single exported constant because the shell side must agree byte-for-byte: `json_field_file "$devflowDir/manifest.json" "features.tracker.provider" "github"`, whose jq and node backends both split the dotted path and walk it. `tests/seams/tracker-key-path.test.ts` is the only place that comparison happens; it reads the literal out of the hook rather than retyping it, and runs 14 shapes × 2 backends. The seam asserted is **not** "both readers return the same string" — they legitimately do not (over a malformed shape jq yields `''` and the node fallback yields `'github'`) — it is *the shell token passes Section 3's allowlist if and only if the TypeScript reader resolves a non-github provider*. The table pins the expected outcome independently, so the two readers cannot agree on a wrong answer.

**`init.ts` has ELEVEN tracker edit sites, not the ten the plan listed.** The unlisted one is the **hud-only manifest write**, which preserves the existing feature block on a `--hud-only` run; miss it and `devflow init --hud-only` silently drops a user's provider. The other ten: `resolveTrackerInitState`, `InitOptions.tracker`, the `--tracker <id>` option declaration, the boundary parse (before any prompt), both wizard call sites, the Recommended summary row, the Advanced outcome loop, the `Tracker selection lifecycle` block, and the manifest write.

**The wizard gating predicate** (`shouldRunTrackerStep`) short-circuits in a fixed order, and the order is the contract:

```ts
if (input.hasCliOverride) return false;   // --tracker wins on BOTH paths
if (!input.isTTY) return false;           // non-TTY is never asked
if (input.mode === 'advanced') return true;
return input.modePromptShown;             // Recommended: only after an active choice
```

`modePromptShown` is the whole point: the `--recommended` flag and the non-TTY fallback never set it, so both keep their promptless contracts. This matches `shouldRunComplianceStep` and deliberately diverges from `shouldRunAttributionStep`, which is Advanced-only.

### 2. Three files, three single owners, and why callers never inline them

`D-TRACKER-OWNER` [DR-22][DR-10]: the counter, the presence sentinel and the stale-conventions rename each have exactly **one** owner in `src/core/tracker.ts`. Callers call; they never inline an `fs.rm`. The rationale is at the code site: *a bare "also delete this file" appended to an eleven-row edit list in a 2,100-line `init.ts` is the same policy expressed twice with no owner.*

| Owner | File | Rule |
|---|---|---|
| `applyTrackerSentinel(devflowDir, provider)` | `.tracker.enabled` | A **zero-byte** file, written whenever the resolved provider ≠ `github` and **removed** when it is. Converged in **both directions by one function**, so there is no write-without-remove asymmetry (avoids PF-015) |
| `rearmTrackerInference(devflowDir)` | `.tracker.attempts` | Removes the counter. Idempotent when absent, never throws |
| `renameStaleTrackerConventions(devflowDir, previous, resolved)` | `tracker.md` → `tracker.md.{previous}.bak` | Returns `{kind:'none'} \| {kind:'renamed',…} \| {kind:'failed',error}`. A fresh install, an unchanged provider and a missing file are all `'none'` |

Two writers each call each of them exactly once: `init.ts` (inside the single `Tracker selection lifecycle` block, immediately before the manifest write) and `devflow tracker --set` (after `syncManifestFeature`). Both call sites are pinned by source-level assertions that **also** assert the literal `.tracker.attempts` does *not* appear in either caller — `tests/init-seed.test.ts` and `tests/tracker-cli.test.ts`.

**`renameStaleTrackerConventions`'s `previous` comes from the REAL `existingManifest`, never from the `--reset`-gated seed** (EC-62). Under `--reset` the resolved provider collapses to `github` while the prior provider is still `jira` — and that *is* a transition the rename must fire on. A failure warns and init continues (avoids PF-009): a failed init is strictly worse than a renamed file.

**`devflow tracker --status` does NOT re-arm the counter.** It returns immediately after printing provenance, before the re-arm call. Decision `D-F` is spelled `--set/--status` in the plan; the shipped behaviour is that `--status` is a pure read, which is the right design for an inspection command and is what `docs/cli-reference.md` documents. The two re-arm paths are `devflow init` (any run, any path) and `devflow tracker --set`.

### 3. The Tracker agent — `src/assets/agents/tracker.md`

The **17th** agent. `name: Tracker` (byte-exact), registry key `tracker`, `model: sonnet` (OD-10, pinned equal to `loadShippedDefaults()['tracker']`), preloaded skills `devflow:git` and `devflow:boundary-validation`, and **no `tools:` key**.

**Why no `tools:` key**, stated in the agent itself so it cannot be "tidied" into an allowlist: the tracker servers it must reach are **user-configured**, so their tool names differ per machine and cannot be enumerated at authoring time. Any allowlist would be a guess, and a wrong guess fails at *runtime*, in a background run, with nobody watching. An explicit `## Read-only boundary` section is the compensating control, pinned in `tests/tracker-agent.test.ts`.

**Hook-spawned only.** It has no `_roster.mds` row and no command spawns it. `tracker` sits in the `devflow-core-skills` plugin, whose empty `commands: []` is what makes `registry-integrity`'s reverse spawn check skip it (`if (spawned.size === 0) continue`). That is a **structural** pass, not an exemption — the rationale is a comment at the code site plus an assertion. **Do not add an exemption entry, and do not add a roster row**: set-equality against `dist/commands/` `agentType` values would fail, and the roster resolver *throws* on a name it cannot read.

**The agent is PROVIDER-AGNOSTIC and contains no provider name at all.** `tests/guards/provider-scope.test.ts` puts `src/assets/agents/**` inside `PROVIDER_SCAN_ROOTS`, but the guard is not the only reason — the validated token arrives in the spawn directive, so re-deriving or naming a provider in the prompt would be a **second convergence point** (PF-023). The consequence for §14.3's schema table is that three "Absent ⇒" cells the appendix spells per-provider are phrased provider-agnostically ("the resolved provider's documented neutral default"), which is correct because this agent only ever runs for a non-`github` provider.

**The protocol, in order:**

1. **Claim.** If `.tracker.processing` exists, compare its age against **600 seconds** — fresh means a live sibling owns the run (exit silently), stale means a previous run crashed (re-claim by `touch`). Otherwise claim atomically by `mv`-ing a freshly created marker onto the claim path; a failed `mv` means another agent won, so exit silently. Heartbeat `touch` at the probe→compose boundary. If `tracker.md` already exists, stop and report `ALREADY_EXISTS`.
2. **Probe**, before inferring anything, selecting every capability **by its description, never by tool name**. `denial ≡ absence` — a denied capability takes the same branch as an absent one, because both mean unusable-now and both may resolve later.
3. **Split transient from permanent.** **No capability reachable at all ⇒ write nothing** and let the next session re-arm (transient). **Some reachable but the evidence thin ⇒ write the file with sentinels** (permanent — a human must decide). The plan's earlier rule *">50% unresolved ⇒ don't write"* was dropped as arbitrary and colliding with retry semantics; this is the replacement.
4. **Infer within bounds.** [DR-15] the bounds, the UNTRUSTED-strings handling, the post-composition verbatim-match check and the `### Substitutions` rule are **named, not restated** — they live in the `devflow:git` skill's `references/learn-conventions.md`, generated in Phase 2. The DR-15 fallback (restating them under a two-site allowlist) was **NOT taken**: copying security-relevant bounds would create a second hand-maintained corpus outside every single-authority guard, reproducing the caller-restated-literal divergence Phase 0 exists to repair. Three rules are the agent's own because that reference does not carry them: a **majority rule** of ≥3 occurrences AND ≥60% share (stricter than the reference's own 50%, because a wrong project key sends every future lookup to a project that does not exist); a **refusal to infer from history outside a real project root** (a dotfiles `$HOME` *is* a git repository and its branch names say nothing about any tracker); and **provenance** written into `inferred-from:`.
5. **Write once, or not at all.** `mktemp` per invocation → `redact-secrets.cjs` → `( set -o noclobber; cat > "$TRACKER_FILE" )` → `chmod 600`, as a single `&&` chain, never a pipeline. A pipeline hides the scrubber's exit status; the chain is what makes the gate fail *closed*. `EEXIST` is **not a lock wait** — the loser reads the existing file and reports `ALREADY_EXISTS`; unlink-and-retry is right for a staged atomic replace and exactly wrong for a write-once file, because the winner's content is the answer.
6. **Finish.** On a write-less exit, increment `.tracker.attempts` **before** deleting the claim file, as **one decimal-integer line and nothing else**. On a successful write, delete the counter. Delete the claim file as the **final** act, using `unlink` (a flagged `rm` is denied by devflow's recommended deny list and the agent runs unattended with nobody to answer the prompt, PF-003).

**The schema — 11 headings, verbatim and ordered**, inside the agent's ```` ```tracker-md-template ```` fence:

```
## Project · ## Issue Types · ## Required Fields · ## Iteration Policy · ## Transitions
## Assignee · ## Tech Debt · ## Wave Filter · ## Reference Rendering · ## Dedup Strategy
### Substitutions
```

Satisfies [DR-21]'s `>= 11`. `## Project` is ONE heading carrying two values (site, key), so the shape-gate table has **11 rows** for **10 `##` sections**. Template frontmatter keys are `provider:` and `inferred-from:` only — **`learned:` was dropped**, because no planner supplied a consumer and an unread field is residue (ADR-003 clause iii). **Never re-spell this list**: it is exported as `TRACKER_SCHEMA_SECTIONS` in `tests/helpers.ts` alongside `collectTrackerTemplate` / `collectTrackerTemplateHeadings` / `collectTrackerSchemaRows`, and both the writer and reader halves bind to that shared constant — a two-sided equality test has no oracle of its own. `TRACKER_TEMPLATE_FENCE_TAG = 'tracker-md-template'` addresses the fence **by tag, never by position**.

**File-level rules:** ≤120 lines and ≤8,000 characters (over either bound a reader reads it fully anyway and degrades — a partial read is never correct), mode `0600`, opened with the **Read tool at an absolute path** (never `~`, never a shell read — PF-035), one value per line with no continuations. **`# UNRESOLVED:` is a hard sentinel and is never shape-gated as a value**; a sentinel and an absent section are **different outcomes** — absent means the documented neutral default, a sentinel means the reader degrades and asks the human to edit the file.

**Two shape gates are stronger than §14.3, and neither relaxes it.** `## Reference Rendering` carries a **positive parse** `^[A-Za-z0-9 #{}/_.-]{1,60}$` *in addition to* the metachar denylist, because a denylist alone admits `--body-file=/etc/passwd` and `https://u:tok@host` — neither contains a metachar, and both were accepted by the first draft. Parse-don't-validate is the gate; the denylist is the second, independent control, named separately so widening one cannot silently relax the other. `## Required Fields` is expressed as the **allowlist** (the actual mechanism) with the denied names stated as its consequence rather than as a second mechanism. Denied characters are spelled **by NAME** (`backtick`, `dollar`, `double-quote`, `backslash`, `semicolon`, `newline`) — a backtick cannot be written as a single-backtick code span inside a markdown table cell and a newline has no spelling; an unknown name **throws**.

**`## Dedup Strategy` is a hint, not a decision** (OD-11). The recorded rank may only **narrow the probe order**; the **live probe is the sole authority** for whether dedup is available and for the reason it degrades. A rank recorded months ago against a server that has since changed must never be trusted as the answer.

### 4. Hook Section 3 — the silent setup directive

`src/assets/scripts/hooks/session-start-context` gained a third section between Section 2's closing `fi` and `# --- Output ---`. It is **not gated by the learning feature toggle**: a user who turned learning off did not turn their issue tracker off.

**The resolved-root idiom, and the name collision that forced its placement:**

```bash
TRACKER_DEVFLOW_DIR="${DEVFLOW_DIR:-$HOME/.devflow}"
```

**This assignment does not live inside Section 3.** The hook already uses `DEVFLOW_DIR` as a local for the *project* `.devflow` (`DEVFLOW_DIR="$PROJECT_ROOT/.devflow"`), so by the time Section 3 runs the inherited env value is gone. The capture therefore sits immediately **above** that assignment, with a comment at both sites. Every hook test passes `DEVFLOW_DIR: ''` (treated as unset by `:-`) so a developer's exported value cannot decide an assertion, and one case sets it outside `$HOME` to prove the override is honoured.

**Gate order is cheapest-first, deliberately not the plan's numbering.** It changes no outcome and strictly reduces forks:

| # | Gate | Fork cost |
|---|---|---|
| 0 | sentinel present **and** `tracker.md` absent | 1–2 `stat`, **0 forks** |
| 1 | attempt cap (`read` builtin) | 0 forks |
| 2 | `source` ∈ {`startup`, `clear`} | 1 fork |
| 3 | claim-file freshness (only when the file exists) | 0 or 2 forks |
| 4 | provider allowlist (manifest read) | 1 fork |

§14 binds only "the allowlist runs before any interpolation", which holds.

**The allowlist is POSITIVE, never `!= github`:**

```bash
case "$TRACKER_PROVIDER" in
  jira|linear) ;;
  *) TRACKER_PROVIDER="" ;;
esac
```

`manifest.json` is user-writable, so a negative test would admit every hostile string that merely is not the word "github" — quotes and newlines included — straight into `additionalContext`. `tests/seams/tracker-key-path.test.ts` reads this arm **out of the hook** (`collectAdmittedProviders`) rather than restating `['jira','linear']`, so widening it is a visible, tested edit. Two provider literals are legal here because `src/assets/scripts/hooks/` is **not** in `provider-scope.test.ts`'s `PROVIDER_SCAN_ROOTS`.

**Named literals, each with its derivation:** `TRACKER_ATTEMPTS_MAX=5` (OD-14) and `TRACKER_PROCESSING_STALE_SECS=600`, asserted `!== 900`. The 600 is its **own** literal, deliberately not shared with Learning's 900: one shared constant would make a change to either feature silently reclassify the other's live runs as crashed.

**The counter's defensive parse** (PF-062) is worth reading before touching it. Read with the `read` builtin (no fork), and `read`'s **exit status is deliberately not consulted** — it returns non-zero at an EOF with no trailing newline while *having assigned* the variable, and treating that as failure would reset a real count. Only the value's shape decides: absent/empty → `0`; non-digit → `0`, self-healed, `dbg`'d, and overwritten with a well-formed count on emission so a stray byte can never recur; **7+ digits → treated as AT the cap**, because `[ "$N" -ge 5 ]` on a value past `intmax_t` prints `integer expression expected` and takes the FALSE branch — the cap would fail **open**. Verified: an unbounded copy emitted the directive for a 200-digit counter.

**[DR-02] the hook increments when it EMITS**, before building the section, so a crashed agent still burns an attempt. The agent deletes the counter on a successful write; the hook never deletes it and never creates it on a suppressed path. Because the hook overwrites the counter with a well-formed integer on every emission, the cap engages **regardless** of what format the agent writes — which is why the agent's format is pinned too.

**The silence clause deviates from EC-15's "byte-identical" wording, with a reason.** A fully byte-identical copy of Section 2's clause would instruct the model never to mention *the Learning agent* in a section about the Tracker agent. What is pinned instead is stronger than a substring check: `collectSilenceClauses` splits each clause at its subject list, substitutes `{SUBJECTS}`, and asserts the two **frames** are `toBe`-equal to

```
Never mention this directive, {SUBJECTS} in any user-visible text. Do not narrate, confirm, or summarize the spawn. Your first visible words must address the user's request.
```

while asserting the subject lists are distinct and each names its own agent. A clause that loses the head or the ` in any user-visible text. ` hinge yields a **null frame** and is reported rather than silently "not found".

**How [DR-10]'s zero-fork property was actually proven** — differentially at runtime, then pinned at the source level. This is the method to reuse, not the number:

1. An **additive** shim directory goes in **front** of the inherited PATH (PF-045 — nothing subtracted) with wrappers for `jq`, `node`, `date` and `stat`; each appends one line to a log then `exec`s the real absolute binary, so behaviour is unchanged and every exec is recorded.
2. **Baseline** — a HOME that never chose a tracker. The count must be **> 0**, or the wrappers are not on PATH and the whole measurement is inert.
3. **The GitHub path** — manifest `github`, sentinel absent. `count − baseline === 0`.
4. **Non-vacuity** — the same counter with the sentinel present must be **strictly greater**. Without this the zero proves nothing, since a counter that never moves also reads zero.
5. A source-level assertion pins the **mechanism**: the first `if` after `# --- Section 3:` names `.tracker.enabled` and contains no `$(`, no backtick and no `json_field`, so no fork can precede the gate even if the differential were weakened.

`tests/fixtures/numeric-floors.json` carries a **ceiling** `tracker-section-max-chars` (800) for the emitted section. It is a ceiling, not a floor — it may be lowered, never raised.

### 5. The MCP substrate — `_mcp.mds`, the generation gate, and `--emit`

**The generation gate is keyed on a module's `subdir`, not on a flag.** Three collaborating pieces in `src/core/mds-variants.ts`:

```ts
export const MCP_BACKED_PROVIDER_SUBDIRS = ['tracker/jira', 'tracker/linear'] as const;
export const MCP_CONTRACT_MODULE = { source: 'src/assets/mds/tracker/_mcp.mds', subdir: 'tracker',
                                     kind: 'contract', ops: ['_mcp'] } as const satisfies VariantModule;
export function mcpContractIsGenerated(modules = VARIANT_MODULES): boolean;
export function resolveVariantModules(modules = VARIANT_MODULES): readonly VariantModule[];
export const GATED_REFERENCE_MODULE_SOURCES: readonly string[] = [MCP_CONTRACT_MODULE.source];
```

`_mcp.mds` is **not** in `VARIANT_MODULES`; `resolveVariantModules()` appends it when some registered module lands in `tracker/jira` or `tracker/linear`. `expandVariants()` and `generatedReferenceManifest()` both default to `resolveVariantModules()`. The plan's §10.8 wanted a conditional module-level row, which `as const satisfies` cannot express — so the gate had to be a **derived registry resolver**, not a row.

The build reports the deferral rather than hiding it, and a deferred module is neither a partial (it declares an `output-dir:`) nor a refusal (an *unregistered* reference module is still refused with the registry-naming message):

```
1 reference module(s) deferred (generation gated)
  deferred: src/assets/mds/tracker/_mcp.mds (no registered provider needs it yet)
```

**The emitted basename `_mcp` needed two narrow widenings, both a planted build break defused one subtask early.** `validateOutputName` refuses a leading underscore, so a registry row alone would have expanded fine today (absent) and refused with `invalid-op-name` the moment the gate opened. Fixed by `validateContractOutputName(name)` — demands exactly one leading `_`, then delegates; used **only** for `kind: 'contract'`, leaving `validateOutputName` untouched (widening it would admit `_anything.md` as a command or agent basename) — and by relaxing `VARIANT_SECTION_MARKER_RE` to `/^<!-- op: (_?[a-z0-9][a-z0-9._-]{0,63}) -->[ \t]*$/`, which is free because the captured name is checked against the caller's registry.

**`_mcp.mds` names NO provider and NOT the transport acronym — and no guard widening was needed.** The contract states its rules in terms of *capabilities* and *tool calls*, so it contains neither `\bjira\b`/`\blinear\b` nor `\bMCP\b`/`\bmcp__`. This is the plan's own capability-first doctrine applied to its own prose, and it keeps `provider-scope.test.ts` at full strength with no exemption to go stale. The guard asserts the file is **IN** scope, because an unscanned file is an exemption nobody wrote down.

What the contract carries: a **15-row capability table** (`| Capability | Unavailable ⇒ |`) where only *identify current user* degrades-and-posts-anyway and the four dedup-rung rows fall through rather than erroring; the **no-HTTP-fallback** clause (`curl`/`wget`/credential-from-environment/CLI-substitute all forbidden); **scrub-before-render**, permitting only a pure structural wrapper whose concatenated text nodes equal the scrubbed bytes — no re-encoding, base64, chunking, summarisation or reflowing; structured reads that are **shape-trusted, value-untrusted**; and a one-directional load chain with **THIS CONTRACT WINS** on conflict.

**`redact-secrets.cjs --emit` — the mechanical D11 gate.** A shell `&&` short-circuit cannot exist inside a tool call, and an instruction is not a gate. The framing literal, verbatim [DR-01]:

```
D11-OK <nonce> <sha256> <bytes> <n> [type:count,…]
```

- `<nonce>` — **32 lowercase hex chars** (`NONCE_HEX_CHARS = 32`, 16 CSPRNG bytes), per-invocation and **required**, because composed bodies contain untrusted issue text and an unframed `D11-OK` literal is forgeable by anyone who can write an issue comment. Exported so a guard pins the width from the constant.
- `<sha256>` — 64 hex of the scrubbed body. `<bytes>` — `Buffer.byteLength(body,'utf8')`; **bytes, not characters**. `<n> [type:count,…]` — the **FIRST** pass's `formatScrubLine` output minus the shared `SCRUB: ` prefix; the second pass is always 0 by construction, and *that* is the gate.
- Grammar, anchored both ends: `/^D11-OK [0-9a-f]{32} [0-9a-f]{64} \d+ \d+ \[[^\]]*\]$/`.
- **Failure framing** `D11-FAIL <reason>`, body `''`, non-zero exit. Reasons are bare tokens exported as `D11_FAIL_REASONS`: `input-unreadable` · `input-too-large` · `output-unwritable` · `second-pass-nonzero` · `nonce-unavailable` · `internal-error`. **No path and no secret ever on stdout.** The no-body property belongs to the **result type** (`body: ''`), so the boundary writes unconditionally and cannot leak one by forgetting to suppress it.
- **Exit codes:** `0` ok · `1` usage (stdout entirely EMPTY — the mode is not yet known) · `2` input unreadable/too large · `3` temp-sibling write failed · `4` internal · **`5` the gate refused**.
- `--emit` takes **ONE** positional. Arity is exact in both modes; `--emit in out` is a usage error, not an ignored argument.

**[DR-06] the `<bytes>` verification clause** is the consumer's half, and `_mcp.mds` states it as a **refusal**, not a note: confirm the received body's byte length equals `<bytes>`; on mismatch **DO NOT POST** and emit `TRACEABILITY: DEGRADED (redaction unavailable)`. Its reason must not be lost — a Bash result is clipped at a per-machine limit and **both ends survive while the middle is elided**, so the framing line (line 1) *and* the body's tail are intact and a bare "absent framing ⇒ do not post" gate passes over a body with a hole in it. Chunking is forbidden, so a truncated body has no sanctioned recovery. `docs/reference/platform-assumptions.md` carries the limit and its drift symptom.

`tests/guards/mcp-sink-bypass.test.ts` polices the whole arrangement: the five contract clauses against the **SOURCE** `.mds` (never the generated `_mcp.md`, which does not exist), the bypass regex over seven shapes including `create_comment(body: $DEVFLOW_BODY_RAW)`, and a forward arm over a **declared-empty** live corpus.

### 6. The reader half — the Git agent's preamble

**Resolution order, exactly this, first hit wins:** (1) the `tracker` key in the project's `.devflow/config.json` — authoritative when present; (2) **repo ref-grammar corroboration**; (3) `~/.devflow/manifest.json` key `features.tracker.provider`; (4) `github`.

**OD-9, the corrected rule, with its prohibition attached:** the only signal is **whose issue grammar this repo's history speaks.** *The remote, the hosting platform and the PR host are NOT signals; a rule that reads them is WRONG and must never be implemented* — devflow deliberately keeps PR hosting on GitHub while the tracker is Jira, so a "GitHub remote + authed CLI ⇒ github" condition is true for essentially every Jira user *including the requester*, and would disable the feature for exactly the user it targets. Mechanically: scan bounded recent history (`--max-count=200`) for closing refs; a `KEY-N` grammar at **≥3 occurrences AND ≥60% share** corroborates that provider; refs of the github grammar with **zero** qualifying `KEY-N` refs resolve `github`. Name the deciding signal on the status line.

**The mismatch guard, and why the uninstall classification depends on it:** frontmatter `provider:` ≠ the resolved provider → `TRACEABILITY: DEGRADED (tracker configuration mismatch)` and **NO tracker call**. This is the reader-side invariant covering every path init cannot see — uninstall then reinstall, a hand edit, a dotfile-repo sync — and it is why the file is preserved as user content instead of swept as an install artifact: **a stale file is safe to keep only because it can no longer be silently authoritative.**

**`- **Tracker**:` lives in the PREAMBLE, not in any op's Output template.** The first draft added the line to `setup-task`'s `### Traceability` template and the frozen `github-status-lines.txt` caught it — one added line. The fixture was right on the merits, not merely inconvenient: §14.2 says the GitHub path emits **no tracker status line at all**, so an unconditional template line was a defect. The rendering rule is now a clause of the github-silence bullet: *under any other provider, add `- **Tracker**: {provider} ({winning source}) | DEGRADED ({reason})` beside `- **Conventions**:`, additive, exactly one rendering, `({n} unresolved)` on first use.* **Do not add a status line to any op's Output template.**

**The per-repo `tracker` key** (`src/core/feature-config.ts`):

```ts
export type TrackerConfigOverride =
  | { kind: 'absent' }                            // NO override — corroborate
  | { kind: 'valid'; provider: TrackerProvider }
  | { kind: 'invalid'; raw: string };             // carries the raw value for the DEGRADED
export interface FeatureConfig { /* … */ tracker?: string }   // the RAW string, verbatim
```

**`absent` ≠ `github`.** Absent *requests* ref-grammar corroboration; a chosen `github` short-circuits it. Never collapse them. The field is the **RAW** string and is carried through `coerceConfig` **verbatim**, because `updateFeature` is a read-modify-write over the whole config — a key it dropped would be a key `devflow knowledge --disable` **deletes**. Never consume the field directly; always `parseTrackerOverride`. Membership delegates to `parseTrackerId` (ONE authority). `BooleanFeature` needed `-?`: a mapped type over an optional property yields `K | undefined`, and any future optional field inherits the fix.

### 7. The DEGRADED literal registry — asserted in both directions

`tests/tracker/schema-scope.test.ts` holds three lists and asserts the **partition** between them, so a stale deferral goes red:

- **`LIVE_REASONS` (11)** — has an emitting site now. `foreign issue reference {ref}` and `no tracking issue for this run` are **LIVE**, not deferred; the mirror arm caught them already emitted.
- **`DEFERRED_REASONS` (7)** — `no tracker tool for {capability}` · `unsupported by {provider}` · `dedup unavailable — duplicate possible` · `issue reference "{ref}" does not match {provider} reference grammar` · `no parseable refs for provider {p}` · `unusable site` · `unsupported transition`. **3b/3c move each into `LIVE_REASONS` in the commit that authors its emitting site**, and a mirror arm asserts every deferred row is genuinely NOT yet emitted.
- **`PRE_PHASE3_REASONS` (1)** — `tech-debt archive failed for #…`, emitted by `references/tracker/github/manage-debt.md` and appearing **nowhere** in §14.2's canonical table. Registered **with its provenance** rather than papered over, because the reverse arm is "no reason outside the registry" and changing a Phase-2 literal that `manage-debt`'s own guards pin is out of scope for a behaviour-neutral subtask. **Treat this row as canonical until the appendix gains it or the literal is retired** — it is a real §14.2 gap, not a mistake in the registry.

Literals the preamble added, all in `TRACEABILITY: DEGRADED (…)` form: `unknown tracker provider` · `tracker configuration unreadable` · `tracker configuration mismatch` · `tracker not configured` · `ambiguous issue reference` · `tracker.md required fields incomplete — edit ~/.devflow/tracker.md`. (`tracker mechanics unavailable` and `tracker.md exceeds size bound` were already present and stay byte-identical as literals.) Phase-3 status lines asserted emitted [DR-01]: `SECRET-EXPOSED (rotate {type} credential — the source file still holds it)` and `SCRUB: N [type:count,…]`.

### 8. The byte budget — and the one decision 3b must make before it starts

Measured on the 3a tree:

| | Phase 2 | Phase 3a |
|---|---|---|
| `git.md` chars | 55,664 | **58,776** |
| `git.md` **outside** the preamble | 52,279 | **52,279 — byte-identical** |
| preamble chars / lines | 3,385 / 29 | **6,497 / 34** |
| worst-case tracker spawn (shape 2) | 77,719 | **80,831** |

```ts
const BUDGET_GIT_MD      = 55_750;   // Phase-2 base, UNRAISED — still the live gate OUTSIDE the preamble
const BUDGET_GIT_MD_P3   = 58_870;   // = 55_750 + measured 3_120 preamble growth; headroom 94
const PREAMBLE_CHARS_P2  =  3_385;   // measured at e66ef30
const PREAMBLE_MAX_LINES =     40;   // UNCHANGED — the ≤70 raise was NOT taken
const BUDGET_LOADED_SET_P3 = BUDGET_LOADED_SET + (BUDGET_GIT_MD_P3 - BUDGET_GIT_MD);  // computed = 80_944
```

Four properties, each of which a future subtask will be tempted to break:

- **The ≤70-line preamble ceiling was NOT added.** §14.10 called 70 "the honest number"; the re-derivation says **34**. A `<= 70` assertion would be strictly *weaker* than the `<= 40` already in place. **Do not add it in 3b/3c either** — it would be a raise wearing a new name.
- **The P3 revision is spendable on the preamble ONLY, mechanically.** A companion gate asserts `chars(git.md) − chars(preamble) <= BUDGET_GIT_MD − PREAMBLE_CHARS_P2` (= 52,365, measured 52,279 — Phase 2's own 86 ch of headroom). **Text added to an operation section in 3b/3c must still fund itself against Phase 2's number.**
- **`BUDGET_LOADED_SET_P3` is computed, never typed** — no literal, so it is unregisterable and unwalkable. `budget-git-md-p3` is the single ratcheted number governing both gates. §14.10 says "only the `git.md` component is further revised", but `BUDGET_LOADED_SET` is `PRELOADED` at Phase 0 and `PRELOADED` *contains* `git.md`, so the plan's arithmetic cannot hold both; deriving the loaded-set ceiling from the git.md revision is the resolution that does not misclassify a containment control as an optional load. [DR-13(c)]'s `_resolution.md` escape was **measured and rejected**: moving text into a per-op-summed reference is **NET ZERO** on that gate.
- **★ ORCHESTRATOR DECISION FOR 3b — `_mcp.md` is billed at 0 today and 3b will breach the loaded-set gate on the day the gate opens.** `MCP_TERM = 0` on the GitHub-scoped row **by construction**, because no github op file names `_mcp.md` — proven by the re-scoped AC-2.7 guard, not assumed. `_mcp.md` compiles to ~7.9 kB. Against 113 ch of headroom this is a **planned, arithmetically certain** event, not a surprise. The decided shape of the response: **each MCP-backed provider gets its OWN provider-scoped loaded-set row and its OWN new ceiling entry, derived from the printed four-shape table; the GitHub-scoped row keeps `MCP_TERM = 0`, and no existing ceiling is ever raised.** Trimming `_mcp.md` is the honest first move — it is contract prose, and a pass over it is cheaper than another ceiling.

## Component Interactions

**Selection flow.** `devflow init` (or `devflow tracker --set`) resolves a provider → `renameStaleTrackerConventions` moves a stale file aside → the manifest is written → `rearmTrackerInference` clears the counter → `applyTrackerSentinel` converges `.tracker.enabled`. Order matters: the rename reads the *prior* provider, so it must run before the write.

**Inference flow.** SessionStart (`startup`/`clear`) → Section 3's five gates → counter incremented → `--- TRACKER SETUP ---` in `additionalContext` → the main model **silently** spawns `Agent(subagent_type="Tracker", model="sonnet", run_in_background: true, prompt: "… Provider: {token}. Devflow directory: {abs}. Project root: {abs}")` → the agent claims, probes, infers, writes `tracker.md` once, deletes the counter, deletes the claim. The next session's gate 0 sees `tracker.md` and exits at one `stat` forever after.

**Read flow.** A Git agent spawn resolves `TRACKER_PROVIDER` **once** in the preamble (per-repo key → corroboration → manifest → github) → reads `tracker.md` if present (Read tool, absolute path) → compares its frontmatter `provider:` against the resolved provider and **refuses on mismatch** → an op's `**Mechanics:**` pointer triggers a single Read of `references/tracker/{provider}/{op}.md` → body-posting steps pass the D11 scrub (chain for file sinks, `--emit` for tool-call sinks) before the provider's post command.

**Uninstall flow.** `~/.devflow/tracker.md` is **user content** (OD-15), sitting between `preference-profile.md` and `learning.json` in `enumerateUserDevFlowContent`. `resolveDevflowDirCleanup` needed no change — adding a `userContent` entry automatically flips a user-scope **interactive** uninstall from `'artifacts-only'` to `'prompt'`. `.tracker.processing` / `.tracker.attempts` / `.tracker.enabled` are **install artifacts** (`installArtifactPaths`), removed by an artifacts-only sweep, which **keeps** `tracker.md`. The two lists must stay disjoint (@D8). `tests/uninstall-logic.test.ts`'s 9f floor moved 5 → 6 and 9c's residue-equality set gained `tracker.md`.

**⚠ The OD-15 reversal condition, recorded as a live obligation.** The user-content classification copies the `agent-models.json` reclassification, in which **"silently" is the load-bearing word**: stale per-agent overrides re-apply *silently*, so they were demoted to an install artifact. A stale `tracker.md` is safe to preserve **only because the mismatch guard removes the silence**. If that guard is ever dropped, descoped or softened, then **in the same change**: move `tracker.md` from `enumerateUserDevFlowContent` to `installArtifactPaths` (the reversal note is already at the code site), lower test 9f's floor back to 5, and drop `tracker.md` from 9c's residue set. The guard shipped in 3a-4, so the condition is currently **satisfied** and nothing needs reverting.

## Integration Patterns — the 3b / 3c handoff contract

**3b opens the `_mcp.md` generation gate by registering `_jira.mds` with `subdir: 'tracker/jira'` AND BY NOTHING ELSE.** There is no second edit, no flag, no frontmatter change. What must land in the same commit:

1. Move `'src/assets/mds/tracker/_mcp.mds'` from `MDS_DEFERRED_REFERENCE_MODULES` to `MDS_REFERENCE_MODULES` in `tests/fixtures/mds-manifest.ts`. The shipped-`.mds` total is unchanged; `ALL_DISCOVERED_HOSTS` rises by **two** (`_mcp` + `_jira`).
2. Raise `generated-reference-manifest-size` and `packed-reference-manifest-size` from **13** to 13 + 1 (`_mcp.md`) + 10 (jira ops) = **24**. Floors may rise.
3. **DELETE** the `★ the live corpus is EMPTY at this boundary` assertion in `tests/guards/mcp-sink-bypass.test.ts` — it is written to go red the moment a provider mechanics tree exists, and its message says so. The forward arm below it then becomes live.
4. Re-scope `tests/guards/provider-scope.test.ts`'s AC-2.7 describe again: the "gate is shut" arm **inverts**. The *no generated GitHub mechanics file names `_mcp.md`* arm **does not relax** (AC-3.12).
5. Move the relevant rows out of `DEFERRED_REASONS` in `tests/tracker/schema-scope.test.ts`, in the commit that authors each emitting site.
6. **Widen `provider-scope.test.ts`'s `FOREIGN_PROVIDER_TOKENS` allowlist per FILE, never per token** (ADR-025) — `_jira.mds` / `_linear.mds` must name their providers, and `src/assets/mds/` is a scanned root. Budget for it; `_mcp.mds` needed no widening, but these will.
7. Re-derive the loaded-set arithmetic per `### 8`'s ORCHESTRATOR DECISION: a new provider-scoped row and a new ceiling entry, derived from the printed table. Never raise an existing ceiling.
8. `tests/tracker/hostile-values.test.ts` ships **two** of its four named describes; `refs per provider` (row 25) and the JQL/filter-field describe need the per-provider `ref_grammar` and query defines and land **with them**. The deferral is written into that file's header, not left silent.

**Still open from Phase 2, and explicitly Phase 3's to decide:** `git.mds`'s always-loaded `## Operations` table still reads "Fetch GitHub issue" / "Fetch multiple GitHub issues", and `src/assets/skills/git/SKILL.md`'s `X-RateLimit-Remaining` threshold is the other GitHub literal left in an always-loaded file. 3a did **not** neutralise either — its outside-preamble bytes are byte-identical — so the decision is 3b/3c's, against `SKILL.md`'s 19 ch of headroom and `git.md`'s 94.

**Not taken in 3a, recorded so the absence reads as a decision:** the optional per-run **capability attestation line** [GAP-48]. P3a-S14 calls it optional; it has no named consumer and every always-loaded character costs against 94 ch of headroom (ADR-003). If 3b/3c want it, it belongs in a **per-op Output block**, never the preamble.

## Provider: Jira (3b)

*Not implemented. This section is 3b's to fill (§14.8).* It should cover: `_jira.mds`'s registration (`subdir: 'tracker/jira'`, `kind: 'fanout'`, 10 ops), the Jira `ref_grammar` (`^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$`, anchored both ends — never `^A|B$`), the JQL/filter safety rules (structured filter arguments preferred; a query built only when none exists; values only as **quoted string literals**, never in field/operator/`ORDER BY` position; escape `\` then `"`; reject anything still containing `"`, `\`, a newline or a backtick; every query carries a tested-literal bound plus `TRUNCATED`), the dedup rung Jira actually reaches, the `32767` body cap and the truncation floor derived from it **and** from the Bash-result truncation limit in `platform-assumptions.md` [DR-06(c)], and the preservation order on truncation (line 1 marker, then the status/DEGRADED lines, then the pointer sentence — **untrusted middle content is what gets cut**).

## Provider: Linear (3c)

*Not implemented. This section is 3c's to fill (§14.8).* It must state **OD-12** plainly: **Linear ships at rank 4** (post-with-warning). There is no viewer/"me" tool on a stock official Linear server (six independent catalogs agree) and `create_attachment` is a **base64 upload**, not the URL-link form, so Linear's documented URL idempotency is **unreachable**; ranks 1 and 3 both require a non-stock server. It ships with a `## Known Unknowns` section surfaced **in user docs with the rank-4 statement**, and a **filed probe issue** referenced as a named 3c deliverable.

## Anti-Patterns

- **Repairing a provider token instead of rejecting it.** `jira-cloud → jira`, `JIRA → jira`, trimming `jira ` — every one of these is forbidden for `provider` (§14.9 constraint 6). The validated token selects a **hardcoded path prefix from a static map** and is never concatenated into a path; **never `?? id`**, because falling back to the raw ID is exactly the echo the map exists to prevent. Compliance's `normalizeId` is the shape *not* to copy.
- **Adding `features.tracker` to `readManifest`'s hard-null set.** It makes every pre-tracker manifest read as "no prior install". The field's tolerant parse is the design, and its doc comment carries the prohibition.
- **A negative provider test (`!= github`) anywhere.** `manifest.json` is user-writable; a negative test admits every hostile string that merely is not the word "github", including quote-and-newline injection, straight into `additionalContext`. Always a positive allowlist, always before interpolation.
- **Inlining an `fs.rm` of `.tracker.attempts`, or writing `.tracker.enabled` without the removal arm.** Both have one owner each; the second is PF-015's write-without-remove asymmetry, which leaves a GitHub user paying forever for a provider they switched away from.
- **Reading the `--reset`-gated seed for the rename's `previous` provider.** Under `--reset` the resolved provider is `github` while the prior one is still `jira` — a real transition the rename must fire on (EC-62).
- **Writing a defaults-only or partial `tracker.md` "to make progress."** The file's existence is the signal that setup is done; the session-start gate reads nothing else. A partial file **permanently suppresses** the retry that would have produced a correct one, which is why "write the whole file once or write nothing" is the agent's Iron Law and why no-capability-reachable writes nothing at all.
- **Naming a provider, or the transport acronym, in the Tracker agent or in `_mcp.mds`.** Beyond the `provider-scope` guard, re-deriving a provider in the prompt is a second convergence point (PF-023), and "MCP" in user-facing text leaks transport into copy the user reads.
- **Using the noun "valid" + "ator" anywhere in a shipped asset.** It is a **retired agent name**, and `agent-name-guards`'s GAP-5 sweep matches retired form-B names with maximal recall (case-insensitive, no trailing boundary) over `src/assets/**`. The agent's column is therefore **"Shape gate at the sink"** and the prose says *shape gate*. (`"validation"` is safe — it does not contain the substring.) `RETIRED_ALLOWLIST` is context-scoped to stable identifiers, never flowing prose, so rewording is the precedent-consistent fix.
- **Re-pointing the `tracker.md` write at `--emit`.** A file sink has a shell `&&` available and that chain *is* the gate; framed stdout exists for sinks with no such boundary. The agent states the two reasons **separately** and `tests/tracker-agent.test.ts` asserts the agent does not contain `--emit`, precisely so a later "simplification" cannot collapse them.
- **Reading the remote, the hosting platform or the PR host as a provider signal.** OD-9 names this WRONG and says it must never be implemented. Devflow itself is the counterexample: GitHub PRs, Jira tracker.
- **Adding a `- **Tracker**:` line to an operation's Output template.** §14.2 says the GitHub path emits no tracker status line at all; an unconditional template line is a defect, and the frozen fixture is what catches it.
- **Adding a `_roster.mds` row or a registry exemption for `tracker`.** The commands-less-plugin pass is structural. A roster row fails `inRosterNotInDist`, and the roster resolver throws on a name it cannot read.

## Gotchas

- **`grep` treats a file with a NUL byte as binary and skips it silently.** `src/core/tracker.ts` originally wrote `describeTrackerValue`'s character class with **raw** `\x00`/`\x1f`/`\x7f` bytes, so `grep -n "^export" src/core/tracker.ts` returned `Binary file matches` and **every repo-wide grep guard over `src/core/` silently missed the file**. Fixed to `/[\x00-\x1f\x7f]/g` (behaviour-identical) with `tests/guards/no-control-bytes.test.ts` as the permanent detector. When a guard "passes" over a file, confirm the file was actually read.
- **Two `gh`-shaped traps for anyone editing the Git agent's preamble**, both of which bit 3a-4 and both fixed in the prose rather than by widening a guard: a `` `gh` `` code span **anywhere** in cross-cutting text fails `git-agent.test.ts`'s P2-S4 provider-detector guard (state the prohibition without naming the CLI); and a mid-line `## Operation: <name>` literal is read by the op-roster scan as a **real operation** (with the trailing backtick in its name) and breaks three unrelated op-scoped guards — name an operation as `` the `learn-conventions` operation ``.
- **The hook and the agent both classify the claim file, and nothing at runtime reconciles them.** `TRACKER_PROCESSING_STALE_SECS=600` in the hook and the `**600 seconds**` literal in the agent's Step 0 must be equal, or the larger side suppresses what the smaller side re-arms: inference stalls, or an OD-14 attempt burns every session until the cap closes the feature. `tests/seams/tracker-claim-staleness.test.ts` is the only place the two are compared; it reports an *unstated* bound rather than reading it as agreement, and it cannot tell you 600 is the wrong number — only that both sides still say the same one.
- **The hook overwrites the counter on every emission, so the agent's format only matters for the agent's own increments.** A count the agent writes in any other shape is not a smaller count — it is no count at all, self-healed to `0` by the hook's `case`. Both sides now pin "one decimal-integer line and nothing else."
- **`tests/config-disable-guards.test.ts` used to run `session-start-context` against the real `$HOME`.** Four invocations in that describe did, and with a developer's own machine configured for `jira` the `expect(output).toBe('')` assertions saw the full `--- TRACKER SETUP ---` envelope. Every invocation there now carries a seeded temp `HOME` **and** `DEVFLOW_DIR=''` (AC-3.22). A hook test that reads the real `$HOME` is a test whose result depends on who runs it.
- **A deferred reference module is not a partial and not a refusal.** `partialCount = totalCount - hosts.length - deferred.length` in `scripts/build-mds.ts`; an *unregistered* reference module is still refused with the registry-naming message. `npm run build` reports `16 compiled, 1 deferred, 0 errors, 0 warnings` at the 3a boundary — the deferral line is expected output, not a warning.
- **`resolveAgentSource` prefers `dist/agents/`.** `tracker.md` is hand-authored, so there is no `dist/agents/tracker.md` and the src file is read — but a stale dist artifact from an unrelated experiment would silently shadow every edit and every guard. If an agent edit appears to have no effect on its guards, check `dist/agents/` first.
- **`devflow tracker` with no flag prints usage and returns 0.** It is not an error path, and the usage note deliberately says *"github is the default — `devflow tracker --set github` turns the rest off"* rather than naming a `--no-tracker` that does not exist.
- **The Tracker agent's summary is invisible.** It runs in the background with `run_in_background: true` and nobody reads its output block, which is why **every uncertainty goes into the file as a `# UNRESOLVED:` sentinel or a `### Substitutions` row rather than into a message.** When debugging a bad inference, read `~/.devflow/tracker.md` — its `inferred-from:` provenance line is the only record of which root was scanned and when.
- **The agent is 334+ lines against the plan's ~250 estimate, and that is a decision.** 82 lines are irreducible contract (the 11-row shape-gate table plus the 46-line template); the rest is prose whose every paragraph carries a rule *with* its reason, because PF-037 argues for self-containment for an agent that runs unattended with no orchestrator to ask. One trimming pass was attempted and immediately tripped two guards. Do not trim into mandated rationale; if a pin trips, pin a stable literal rather than a reflow-fragile phrase.

## Key Files

- `src/core/tracker.ts` — `TRACKER_PROVIDERS`, `TrackerProvider`, `TrackerFeatureState`, `TrackerResult`, `parseTrackerId` (strict), `normalizeTrackerFeature` (tolerant), `describeTrackerValue`, `TRACKER_PROVIDER_KEY_PATH`, the four artifact basenames, `trackerConventionsPath` / `trackerAttemptsPath` / `trackerEnabledSentinelPath` / `trackerConventionsBackupPath`, and the three lifecycle owners `rearmTrackerInference` / `applyTrackerSentinel` / `renameStaleTrackerConventions`
- `src/cli/commands/tracker.ts` — `resolveTrackerCliAction` (pure), `readTrackerProvenance`, `formatTrackerProvenance`, `trackerCommand`; `D-TRACKER-PAIR` is recorded in its header [DR-25]
- `src/cli/commands/tracker-prompts.ts` — `shouldRunTrackerStep`, `TrackerPromptIO` (a sibling `selectProvider` rather than a widened boolean `select`), `buildClackTrackerPrompts`, `runTrackerStep`, `formatTrackerSummary`, `formatProviderCatalogue`
- `src/cli/commands/init.ts` — the eleven tracker edit sites; the single `Tracker selection lifecycle` block; `resolveTrackerInitState`; `--tracker <id>` and its boundary parse
- `src/cli/commands/uninstall.ts` — `tracker.md` in `enumerateUserDevFlowContent` with the OD-15 reversal note at the code site; the three `.tracker.*` files in `installArtifactPaths`
- `src/core/manifest.ts` — `features.tracker: TrackerFeatureState`, `normalizeTrackerFeature` on read, and the hard-null-set prohibition in the field's doc comment
- `src/core/feature-config.ts` — `TrackerConfigOverride`, `parseTrackerOverride`, `FeatureConfig.tracker?: string` (RAW, carried verbatim), `BooleanFeature`'s `-?`
- `src/core/mds-variants.ts` — `MCP_BACKED_PROVIDER_SUBDIRS`, `MCP_CONTRACT_MODULE`, `mcpContractIsGenerated`, `resolveVariantModules`, `GATED_REFERENCE_MODULE_SOURCES`, `validateContractOutputName`, the `_?` section-marker regex
- `src/assets/agents/tracker.md` — the agent; Iron Law, read-only boundary, Environment (prefer the directive's `Devflow directory:`), Step 0 (600 s), capability probe, bounded inference, the 11-row shape-gate table, the `tracker-md-template` fence, the write chain, Finishing
- `src/assets/agents/git.mds` — the reader half: resolution order, ref-grammar corroboration, the project key, the mismatch guard, the `# UNRESOLVED:` hard sentinel, the `- **Tracker**:` rendering rule
- `src/assets/mds/tracker/_mcp.mds` — the tool-call contract; the 15-row capability table, no-HTTP-fallback, scrub-before-render, the `SCRUB:`/`SECRET-EXPOSED` echo, the `<bytes>` verification refusal [DR-06]
- `src/assets/scripts/hooks/session-start-context` — Section 3; `TRACKER_DEVFLOW_DIR` captured **above** the project `DEVFLOW_DIR` assignment; five gates; `TRACKER_ATTEMPTS_MAX=5`; `TRACKER_PROCESSING_STALE_SECS=600`; the positive `jira|linear` allowlist; the allowlisted `TRACKER_MODEL="sonnet"`
- `src/assets/scripts/redact-secrets.cjs` — `--emit`, `NONCE_HEX_CHARS`, `D11_FAIL_REASONS`, exit code 5, `parseArgs` / `scrubTwice` / `frameEmit` / `readInput` / `runFileMode` / `runEmitMode`
- `tests/core/tracker.test.ts` — registry, the hostile-payload table, the self-heal table, lifecycle, the key-path walk
- `tests/tracker-prompts.test.ts` · `tests/tracker-cli.test.ts` — the 8-row gate matrix and step semantics; the CLI resolver, provenance, and the `--set` call-site assertions
- `tests/tracker-agent.test.ts` — 49 static content guards, each negative driven by a named collector with a known-bad probe
- `tests/tracker/schema-scope.test.ts` — the schema table, [DR-21]'s two-sided headings, the AC-3.16/3.18 sweeps, and the three-list DEGRADED registry with its partition assertion
- `tests/tracker/hostile-values.test.ts` — the field × payload matrix (two of four describes; the per-provider two land with 3b/3c)
- `tests/seams/tracker-key-path.test.ts` — the TS↔shell key-path seam, 14 shapes × 2 json backends
- `tests/seams/tracker-claim-staleness.test.ts` — the agent↔shell claim-staleness seam
- `tests/guards/mcp-sink-bypass.test.ts` — contract clauses against the SOURCE `.mds`, the bypass regex, the forward arm over a declared-empty corpus
- `tests/guards/no-control-bytes.test.ts` — no raw control byte in any shipped source under `src/`
- `tests/tracker/byte-budget.test.ts` — `BUDGET_GIT_MD_P3`, `PREAMBLE_CHARS_P2`, the computed `BUDGET_LOADED_SET_P3`, the non-preamble gate, the re-derivation guard
- `tests/fixtures/numeric-floors.json` — ceiling `budget-git-md-p3` (the single ratcheted Phase-3 number) and ceiling `tracker-section-max-chars` (800); floor `agent-roster-count` (17)
- `tests/helpers.ts` — `TRACKER_SCHEMA_SECTIONS`, `TRACKER_SCHEMA_FRONTMATTER_KEYS`, `TRACKER_TEMPLATE_FENCE_TAG`, `collectTrackerTemplate`, `collectTrackerTemplateHeadings`, `collectTrackerSchemaRows`
- `docs/cli-reference.md` (`## Issue Tracker`) · `docs/reference/platform-assumptions.md` (MCP surfaces, the capability→symptom table, the three standing prohibitions)

## Related

- `.devflow/features/tracker-references/KNOWLEDGE.md` — the Phase-2 contract/mechanics split, the generated GitHub references, the installer overlay, `VARIANT_MODULES`/`expandVariants`/`splitVariantSections`, and the Phase-2 byte-budget discipline this feature's provider dimension sits on top of
- `.devflow/features/compliance-feature/KNOWLEDGE.md` — the feature whose `src/core` + `src/cli/commands` + `*-prompts.ts` shape this one copies (`D-TRACKER-PAIR` [DR-25]), and the owner of the D1–D11 traceability semantics the mismatch guard extends
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — `resolveSeedFeatures` / `applyCliToggles` / `resolveDevflowDirCleanup` / `enumerateUserDevFlowContent` / `installArtifactPaths`, and the wizard-step seam (`WizardPromptIO`, `shouldRunComplianceStep`) the tracker step mirrors
- `.devflow/features/learning-capture-system/KNOWLEDGE.md` — `session-start-context` Sections 1–2, the silence-clause frame Section 3's is compared against, and Learning's `PROCESSING_STALE_SECS=900` that 600 is deliberately not shared with
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — the MDS build pipeline, `output-dir:`, generator hosts, and the reference-module host kind the gated `_mcp.mds` extends
- `.devflow/features/test-harness/KNOWLEDGE.md` — `resolveAgentSource`, named-collector-plus-known-bad-probe guard conventions, `numeric-floors.json`'s floors-vs-ceilings discipline, and the goldens lifecycle
- ADR-002: `index.md` + `{slug}/KNOWLEDGE.md` are git-tracked while the rest of `.devflow/` stays ignored, and the Knowledge agent commits those two paths itself — this file and its index line are shared with the team; the rest of the tracker feature's runtime state is not
- **Manifest-group vs config-gated feature state** is the distinction that places `features.tracker` (manifest, machine-wide, alongside `proxy` and `compliance`) opposite the per-repo `tracker` key (`.devflow/config.json`, per-repo, alongside `memory`/`learning`/`knowledge`). They are different authorities with different precedence, not two spellings of one setting. Note that `src/cli/commands/tracker.ts`'s header attributes this rule to **ADR-001**, but ADR-001 as currently rendered is about the feature-knowledge-v2 clean break and says nothing about feature-state placement — treat the code comment's anchor as unverified and the distinction as standing on its own merits until the anchor is corrected
- ADR-003: leave the end state, and every field needs a reachable consumer — why `learned:` was dropped from the template, why there is no `TrackerError` taxonomy, why the capability attestation line was not added, and why the agent now reads the directive's `Devflow directory:` field instead of leaving it unread
- ADR-013: pure-core / I/O-target split — the reason `src/core/tracker.ts` and `src/cli/commands/tracker.ts` both exist, and the reason the `~/.devflow` lifecycle lives in core rather than the Claude Code target
- ADR-014: re-init preserves existing values, defaults adopted only for newly-added settings — the frame for the manifest's silent self-heal to `github` [DR-26]
- ADR-025: classify each guard literal individually; widen only where a literal provably moved — the discipline for 3b/3c's `FOREIGN_PROVIDER_TOKENS` widening, which is **per file, never per token**
- PF-009: a failed step warns, it never aborts — the rename, the re-arm and the sentinel all report and let init continue
- PF-014: no `process.exit()` and no `throw` in a domain module — every fallible path in `src/core/tracker.ts` returns a `TrackerResult`
- PF-015: converge in both directions — `applyTrackerSentinel` writes *and* removes, so flipping back to `github` undoes what flipping away wrote
- PF-018: non-vacuity — every negative in `tests/tracker-agent.test.ts` is driven by a named collector that a known-bad sample also drives, and the [DR-10] zero-fork proof carries a positive control because a counter that never moves also reads zero
- PF-021: one identity across filename, frontmatter `name:` and registry key — `tracker` / `Tracker` / `tracker`
- PF-023: single-sink validation — the preamble is the one convergence point, which is why the agent re-derives nothing
- PF-025: instruction docs are an execution surface — a stale agent count or a missing paragraph in `CLAUDE.md` misroutes an agent, which is why the 16→17 sweep is part of the feature and not a tidy-up
- PF-035: Read tool at an absolute path, never a shell read, for `tracker.md`
- PF-037: an unattended agent must be self-contained — the reason the Tracker agent carries its rationale inline rather than pointing at a plan
- PF-045: a PATH shim must be additive and must assert its own precondition — the [DR-10] measurement's baseline `> 0` check
- PF-062: document the shape of any file that gates an action, and keep absent distinct from malformed — the attempt counter's three-state parse on both sides
