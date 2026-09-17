---
feature: tracker-feature
name: "Tracker Feature (provider selection, the background Tracker agent, hook Section 3, the tool-call contract and the reader-side preamble)"
description: "Use when changing how the issue-tracker provider is selected or resolved, editing src/core/tracker.ts or src/cli/commands/tracker.ts or tracker-prompts.ts, touching the tracker wizard step or --tracker in init.ts, modifying the Tracker agent or the ~/.devflow/tracker.md schema, editing session-start-context Section 3, working on redact-secrets.cjs --emit or src/assets/mds/tracker/_mcp.mds, changing the Git agent's provider-resolution preamble or the mismatch guard, editing src/assets/mds/tracker/_jira.mds or _linear.mds, adding a FOURTH tracker provider, or re-deriving the Phase-3 byte budget. Keywords: features.tracker, TrackerProvider, parseTrackerId, normalizeTrackerFeature, TRACKER_PROVIDER_KEY_PATH, TrackerFeatureState, TrackerResult, rearmTrackerInference, applyTrackerSentinel, renameStaleTrackerConventions, trackerAttemptsPath, trackerConventionsPath, trackerEnabledSentinelPath, shouldRunTrackerStep, runTrackerStep, TrackerPromptIO, resolveTrackerCliAction, readTrackerProvenance, devflow tracker, --tracker, .tracker.enabled, .tracker.attempts, .tracker.processing, tracker.md, TRACKER SETUP, TRACKER_PROCESSING_STALE_SECS, TRACKER_ATTEMPTS_MAX, TRACKER_MODEL, TRACKER_DEVFLOW_DIR, TRACKER_SCHEMA_SECTIONS, Tracker agent, _mcp.mds, MCP_CONTRACT_MODULE, MCP_BACKED_PROVIDER_SUBDIRS, mcpContractIsGenerated, resolveVariantModules, GATED_REFERENCE_MODULE_SOURCES, validateContractOutputName, --emit, D11-OK, D11-FAIL, D11_FAIL_REASONS, NONCE_HEX_CHARS, TrackerConfigOverride, parseTrackerOverride, tracker configuration mismatch, unknown tracker provider, BUDGET_GIT_MD_P3, BUDGET_LOADED_SET_P3, BUDGET_LOADED_SET_JIRA, BUDGET_LOADED_SET_LINEAR, PRICED_PROVIDERS, _jira.mds, _linear.mds, TRACKER_OPS, deferredReferenceModuleSources, PROVIDER_OWNED_PATHS, reasonSpellings, isProviderSubdir, D-OVERLAY-PROVIDER-SHAPE, D-LOADED-SET-PER-PROVIDER, devflow:shipped, devflow:wave, devflow:traceability, MARKER_REFS, RATELIMITED, Known Unknowns, rank 4, MCP_SHARED_LITERAL_REGISTRY, PER_ITEM_FETCH_SHAPES, OD-9, OD-10, OD-11, OD-12, OD-14, OD-15, B-6, D-E, D-F, DR-01, DR-02, DR-06, DR-08, DR-09, DR-10, DR-15, DR-19, DR-21, DR-22, DR-25, DR-26."
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

Commit group 3a covers selection, the agent, the hook and the reader-side substrate; **3b adds the Jira provider** and with it the first generated `references/tracker/_mcp.md`; **3c adds Linear at rank 4** and, with a third column to compare, turns the parity and literal scans from scaffolds into checks. All three providers ship.

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

`init.ts` (inside the single `Tracker selection lifecycle` block, immediately before the manifest write) and `devflow tracker --set` (after `syncManifestFeature`) each call each of the three exactly once; `devflow tracker --status` additionally calls `rearmTrackerInference` (D-F), so the counter has **three** callers and the other two owners have two. Every call site is pinned by source-level assertions that **also** assert the literal `.tracker.attempts` does *not* appear in any caller — `tests/init-seed.test.ts` and `tests/tracker-cli.test.ts`.

**`renameStaleTrackerConventions`'s `previous` comes from the REAL `existingManifest`, never from the `--reset`-gated seed** (EC-62). Under `--reset` the resolved provider collapses to `github` while the prior provider is still `jira` — and that *is* a transition the rename must fire on. A failure warns and init continues (avoids PF-009): a failed init is strictly worse than a renamed file.

**Both `devflow tracker` subcommands re-arm the counter (decision `D-F`).** `--status` calls `rearmTrackerInference` after printing provenance and before its `return`; `--set` calls it after `syncManifestFeature`. The three re-arm paths are `devflow init` (any run, any path), `devflow tracker --set <id>` and `devflow tracker --status`. The reason an inspection command carries a write: `--status` is what a capped user reaches for to find out why nothing is being learned, and if that command changed nothing the only escape from the cap would be deleting an undocumented dotfile by hand. `tests/tracker-cli.test.ts` pins one `rearmTrackerInference` call in **each** branch rather than two in the file, so a re-arm that drifts out of either branch goes red, and drives `--status` as a subprocess against a seeded temp HOME to assert the counter is actually gone.

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

**★ AC-3.1 ⇔ AC-3.11: the Output templates' `#` is a RENDERING, and the rule that says so lives here.** The templates read `- **Issue**: #{number}`, `- **Number**: #{number}` and `### Issue #{number}:`, and line 48 of the frozen `github-status-lines.txt` is the first of them — so AC-3.1 makes them **uneditable for the life of this phase** while AC-3.11 wants `- **Issue**: PROJ-123` under Jira. The two criteria meet on the same bytes. §14.1 is the arbiter: `#`-prefixing is a property of the **github rendering** of `ISSUE_REF`, not of the field. The resolution is therefore a RULE and not a template edit — one bullet in `## Tracker input contract`: *every rendered ref takes `## Reference Rendering`'s form, **never `#`-prefixed** — the Output templates' `#` is github's rendering, not a literal.* Zero template bytes, both criteria satisfied, and `tests/tracker/schema-scope.test.ts` claim 6 pins it with a companion arm asserting the three slots still carry the `#` (if they lost it the rule would be a rule about nothing, and the frozen fixture would already have broken).

**The branch half of AC-3.11 is deliberately NOT in the preamble.** `{type}/{KEY}-{slug}` with the type exact-matched against `## Issue Types` is stated by each provider's own `setup-task` mechanics, and a second copy in the always-loaded file is what the byte budget refuses and GAP-37 forbids. It is pinned per provider instead, from the shared claim table in `tests/helpers.ts`. **When a rendering rule must be always-loaded and a shape rule need not be, the test is whether the always-loaded text would be WRONG without it** — the templates are wrong without the `#` rule and silent without the branch rule.

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

- **`LIVE_REASONS` (18)** — has an emitting site now. `foreign issue reference {ref}` and `no tracking issue for this run` were LIVE from 3a; the remaining seven moved here in 3b, each in the commit that authored its site — `no tracker tool for {capability}` from the tool-call contract itself, and the other six from the Jira mechanics (the dedup ladder's bottom rung, the ref pre-flight's per-ref and aggregate arms, the site shape gate, the transition exact-match rule, and the unsupported-capability cell).
- **`DEFERRED_REASONS` (0)** — empty, and kept as a declared half rather than deleted: the partition assertion is what makes it the ONLY way a row may sit outside the forward arm, so a row deleted from both halves would shrink the registry silently. Its mirror arm ranges over nothing, so it carries its own known-bad probe. **3c added no row** — Linear's reasons are the same canonical rows, and `unsupported by linear` became admissible the moment the provider was registered, because the `{provider}` token set is derived from the registry.
- **★ Two placeholders are INSTANTIATED, and both token sets are derived.** §14.2 states a reason as a template (`unsupported by {provider}`) while §14.4 fixes the per-provider cell as the instantiated form (`unsupported by jira`); both spellings are correct and they are different strings. `reasonSpellings()` admits a template plus its instantiations, with `{provider}` tokens read from the module registry's provider rows and `{capability}` tokens read from the tool-call contract's own capability table. Both sets are therefore CLOSED — `unsupported by asana` and `no tracker tool for frobnicate` are still reported — and registering Linear admits its spelling with no registry edit. `{ref}` and `{p}` are deliberately NOT instantiated: their values are runtime data with no closed domain.
- **The reason collector collapses whitespace.** A reason is a one-line status string and the prose stating it is hard-wrapped; the contract's capability clause wraps mid-reason, so the raw capture was `"no\ntracker tool for {capability}"` — a string matching no registry entry and describing no defect. Normalising beats reflowing the source, which would pin where a sentence happens to break (PF-057).
- **`PRE_PHASE3_REASONS` (1)** — `tech-debt archive failed for #…`, emitted by `references/tracker/github/manage-debt.md` and appearing **nowhere** in §14.2's canonical table. Registered **with its provenance** rather than papered over, because the reverse arm is "no reason outside the registry" and changing a Phase-2 literal that `manage-debt`'s own guards pin is out of scope for a behaviour-neutral subtask. **Treat this row as canonical until the appendix gains it or the literal is retired** — it is a real §14.2 gap, not a mistake in the registry.

Literals the preamble added, all in `TRACEABILITY: DEGRADED (…)` form: `unknown tracker provider` · `tracker configuration unreadable` · `tracker configuration mismatch` · `tracker not configured` · `ambiguous issue reference` · `tracker.md required fields incomplete — edit ~/.devflow/tracker.md`. (`tracker mechanics unavailable` and `tracker.md exceeds size bound` were already present and stay byte-identical as literals.) Phase-3 status lines asserted emitted [DR-01]: `SECRET-EXPOSED (rotate {type} credential — the source file still holds it)` and `SCRUB: N [type:count,…]`.

### 8. The byte budget — and the one decision 3b must make before it starts

Measured on the 3a tree:

| | Phase 2 | Phase 3a | Phase 3c | Alignment pass |
|---|---|---|---|---|
| `git.md` chars | 55,664 | 58,776 | 58,751 | **58,782** |
| `git.md` **outside** the preamble | 52,279 | 52,279 — byte-identical | 52,254 | **52,100** |
| preamble chars / lines | 3,385 / 29 | 6,497 / 34 | 6,497 / 34 | **6,682 / 37** |
| worst-case tracker spawn, GitHub path (shape 2) | 77,719 | 80,831 | 80,806 | **80,837** |

The 3c column moves DOWNWARD because #325's neutralisation of the tracker ops' wording deleted a duplicated sentence: the always-loaded file got smaller while gaining a provider. The alignment column moves back UP by 31 ch, and how it was paid for is the point: the M2 rendering rule and the M4 cut that funded it net +21 — 177 ch of always-loaded preamble against 156 recovered by deleting `backlink-shipped-issues`' restatement of the D4 rate-limit rung — and the second alignment pass's issue-ref scoping added the remaining 10, one word inside an existing bullet. **`BUDGET_GIT_MD_P3` stays at 58,870** (headroom **88**) — a ceiling is re-derived downward or not at all, and nothing about these changes earns a lower one.

**Re-measure before spending, and read the LINEAR row, not this one.** Four figures in this section had drifted by the time the alignment pass measured them (git.md by 9 ch, Linear's `max_op` by 27, both provider sums with them), which is why the pass re-derived every "measured"/"headroom" number in `byte-budget.test.ts` and `numeric-floors.json` from the printed table. And the binding constraint is no longer the `git.md` ceiling's 88 ch: it is the **Linear loaded-set row's 16**, because that row contains `git.md`. A character added to the always-loaded agent is a character added to all four gates, and the smallest margin decides.

```ts
const BUDGET_GIT_MD      = 55_750;   // Phase-2 base, UNRAISED — still the live gate OUTSIDE the preamble
const BUDGET_GIT_MD_P3   = 58_870;   // = 55_750 + measured 3_120 preamble growth; headroom 88
const PREAMBLE_CHARS_P2  =  3_385;   // measured at e66ef30
const PREAMBLE_MAX_LINES =     40;   // UNCHANGED — the ≤70 raise was NOT taken
const BUDGET_LOADED_SET_P3 = BUDGET_LOADED_SET + (BUDGET_GIT_MD_P3 - BUDGET_GIT_MD);  // computed = 80_944
```

Four properties, each of which a future subtask will be tempted to break:

- **The ≤70-line preamble ceiling was NOT added.** §14.10 called 70 "the honest number"; the re-derivation says **34**. A `<= 70` assertion would be strictly *weaker* than the `<= 40` already in place. **It was not added in 3b, 3c or the alignment pass either** — it would be a raise wearing a new name. The preamble is now **37** lines: three of the forty are left, and the next always-loaded rule either fits in one line or replaces one.
- **The P3 revision is spendable on the preamble ONLY, mechanically.** A companion gate asserts `chars(git.md) − chars(preamble) <= BUDGET_GIT_MD − PREAMBLE_CHARS_P2` (= 52,365, measured **52,100** — **265** ch of headroom). **Text added to an operation section still funds itself against Phase 2's number**; the neutralisation and then the alignment pass's M4 cut both went the other way, which is why that margin grew from Phase 2's 86 to 265.
- **`BUDGET_LOADED_SET_P3` is computed, never typed** — no literal, so it is unregisterable and unwalkable. `budget-git-md-p3` is the single ratcheted number governing both gates. §14.10 says "only the `git.md` component is further revised", but `BUDGET_LOADED_SET` is `PRELOADED` at Phase 0 and `PRELOADED` *contains* `git.md`, so the plan's arithmetic cannot hold both; deriving the loaded-set ceiling from the git.md revision is the resolution that does not misclassify a containment control as an optional load. [DR-13(c)]'s `_resolution.md` escape was **measured and rejected**: moving text into a per-op-summed reference is **NET ZERO** on that gate.
- **★ `_mcp.md` is billed at 0 on the GitHub row and priced PER PROVIDER elsewhere — shipped in 3b.** `MCP_TERM = 0` on the GitHub-scoped row **by construction**, because no github op file names `_mcp.md`; the re-scoped AC-2.7 guard proves it and a byte-budget arm re-proves it beside the gate. Each MCP-backed provider therefore gets its OWN loaded-set row and its OWN new ceiling entry derived from the printed table, and **no existing ceiling was raised**: the GitHub row still measures 80,837 ≤ 80,944. See each `## Provider:` section's loaded-set table for the numbers and `budget-loaded-set-jira` / `budget-loaded-set-linear` for the entries. A named arm fails any registered MCP-backed provider that has no ceiling of its own — it is what made 3c's ceiling land in the commit that registered the provider rather than after it — and the two per-provider gates are generated from one `PRICED_PROVIDERS` table, so a fourth provider adds a row rather than a copied pair of `it`s.

## Component Interactions

**Selection flow.** `devflow init` (or `devflow tracker --set`) resolves a provider → `renameStaleTrackerConventions` moves a stale file aside → the manifest is written → `rearmTrackerInference` clears the counter → `applyTrackerSentinel` converges `.tracker.enabled`. Order matters: the rename reads the *prior* provider, so it must run before the write.

**Inference flow.** SessionStart (`startup`/`clear`) → Section 3's five gates → counter incremented → `--- TRACKER SETUP ---` in `additionalContext` → the main model **silently** spawns `Agent(subagent_type="Tracker", model="sonnet", run_in_background: true, prompt: "… Provider: {token}. Devflow directory: {abs}. Project root: {abs}")` → the agent claims, probes, infers, writes `tracker.md` once, deletes the counter, deletes the claim. The next session's gate 0 sees `tracker.md` and exits at one `stat` forever after.

**Read flow.** A Git agent spawn resolves `TRACKER_PROVIDER` **once** in the preamble (per-repo key → corroboration → manifest → github) → reads `tracker.md` if present (Read tool, absolute path) → compares its frontmatter `provider:` against the resolved provider and **refuses on mismatch** → an op's `**Mechanics:**` pointer triggers a single Read of `references/tracker/{provider}/{op}.md` → body-posting steps pass the D11 scrub (chain for file sinks, `--emit` for tool-call sinks) before the provider's post command.

**Uninstall flow.** `~/.devflow/tracker.md` is **user content** (OD-15), sitting between `preference-profile.md` and `learning.json` in `enumerateUserDevFlowContent`. `resolveDevflowDirCleanup` needed no change — adding a `userContent` entry automatically flips a user-scope **interactive** uninstall from `'artifacts-only'` to `'prompt'`. `.tracker.processing` / `.tracker.attempts` / `.tracker.enabled` are **install artifacts** (`installArtifactPaths`), removed by an artifacts-only sweep, which **keeps** `tracker.md`. The two lists must stay disjoint (@D8). `tests/uninstall-logic.test.ts`'s 9f floor moved 5 → 6 and 9c's residue-equality set gained `tracker.md`.

**⚠ The OD-15 reversal condition, recorded as a live obligation.** The user-content classification copies the `agent-models.json` reclassification, in which **"silently" is the load-bearing word**: stale per-agent overrides re-apply *silently*, so they were demoted to an install artifact. A stale `tracker.md` is safe to preserve **only because the mismatch guard removes the silence**. If that guard is ever dropped, descoped or softened, then **in the same change**: move `tracker.md` from `enumerateUserDevFlowContent` to `installArtifactPaths` (the reversal note is already at the code site), lower test 9f's floor back to 5, and drop `tracker.md` from 9c's residue set. The guard shipped in 3a-4, so the condition is currently **satisfied** and nothing needs reverting.

## Integration Patterns — what registering a provider drags with it

**Registering a provider module whose `subdir` is one of `MCP_BACKED_PROVIDER_SUBDIRS` is what OPENS the `_mcp.md` generation gate — and it is the only edit that does.** There is no flag and no frontmatter change. Two such providers are registered, and every row below is what one registration drags with it — the checklist a FOURTH provider reads, written as the end state three providers reached.

1. **The `.mds` roster.** `MDS_REFERENCE_MODULES` in `tests/fixtures/mds-manifest.ts` holds all five reference modules; `MDS_DEFERRED_REFERENCE_MODULES` is gone, replaced by `deferredReferenceModuleSources()` in `src/core/mds-variants.ts` — the build's own deferral predicate, exported so the build and the two count guards read ONE owner. It answers `[]`, and the guards prove it still discriminates by asking it about a registry with **every gated sub-directory** removed. That probe had to be re-scoped in 3c: it named `tracker/jira` alone, so with two tool-call providers registered, dropping the first left the second holding the gate open and the arm reported the predicate as broken when it was the probe that had gone stale. **A probe that names one member of a set the gate ranges over stops discriminating the moment the set grows.** `ALL_DISCOVERED_HOSTS` is 19 and the build prints `0 reference module(s) deferred`.
2. **Floors.** `generated-reference-manifest-size` and `packed-reference-manifest-size` rose 13 → 24 → **34** (10 github + 10 jira + 10 linear + 3 cross-cutting + the contract). They pin one manifest at its two sinks and **must move together**, or a provider could ship un-packed. `capability-hoist-block-floor` moved 29 → 39 → **49** on the same rhythm: a provider adds its whole roster at once, so these floors rise by a provider rather than by a file.
3. **`tests/guards/mcp-sink-bypass.test.ts` is LIVE.** The `★ the live corpus is EMPTY at this boundary` assertion is deleted; in its place the corpus is asserted non-empty, to REACH every member of `MCP_BACKED_PROVIDER_SUBDIRS` by name, AND to hold at least one file spelling `{SCRUBBED_BODY}`: every clause arm is an empty-difference assertion, a read-only tree would clear a bare non-emptiness check, and a count is satisfied by one provider while a second provider’s tree is missing entirely (PF-064’s corpus claim — proven RED by moving `tracker/linear/` aside). Two further strengthenings landed with it: `collectBypassSites` now runs over the live corpus (it had only ever run against its own seeds — PF-064), and `POSTING_VERBS` admits a SPACE separator, because the contract mandates selection by capability DESCRIPTION (*add comment*) rather than by tool name, so `[_-]?` matched every tool name and no compliant mechanics file.
4. **`tests/guards/provider-scope.test.ts`'s AC-2.7 describe is inverted and re-armed.** The gate is OPEN for the shipped registry and SHUT for an injected registry with no tool-call provider, so GAP-02's original claim still has an assertion behind it. The *no generated GitHub mechanics file names `_mcp.md`* arm **did not relax**.
5. **`DEFERRED_REASONS` is empty** — see `### 7`.
6. **Provider literals are allowlisted per (path, token), never per token** (ADR-025). `PROVIDER_OWNED_PATHS` carries two entries per provider — the module and its generated directory — each admitting **one** token: the Jira module naming Linear is still a violation, and so is the reverse. Each entry must reach a scanned file that really carries its token, or it is deleted. AC-3.12's five forbidden scopes are asserted individually with one seeded probe each. `_mcp.mds` needed no entry — it names no provider at all. **This is what the Linear module's `## Known Unknowns` prose had to be justified against:** the rank-4 statement is about one provider specifically, so the entry's rationale says so rather than the prose being moved out of the module.
7. **The loaded set is priced per provider** — see `### 8` and the Jira table.
8. `tests/tracker/hostile-values.test.ts` ships **all four** of its named describes. `refs per provider` (row 25) needed an anchored grammar for EVERY provider, and GitHub's only came into existence in the #325 neutralisation — which is why that describe landed with it rather than with either provider module. The JQL/filter describe models §14.9-10's escape-then-drop rule as written, and scopes the drop claim to the four characters that can END a quoted literal: a query sink is not a shell, so dropping `$(id)` would cost search results while protecting nothing, and containment by POSITION is the other half of the same rule.
9. **★ `planOverlayUnits` needed a production fix in 3b, and Linear needed nothing from it** — `tracker/linear/` is an ordinary provider directory, which is the point: the shape rule below is what makes a normal provider normal. `tracker/_mcp.md` is a file landing directly in `tracker/`, and the installer overlay bucketed it as a provider directory named `tracker` — a unit whose atomic swap renames `tracker/` itself over every provider directory beside it, with a staging sibling OUTSIDE the subtree the prune converges. `D-OVERLAY-PROVIDER-SHAPE` now classifies by SHAPE (`tracker/{provider}` exactly), and everything else is a FLAT SET carrying the directory it lands in (`''` for the references root, `tracker` for the contract), with one staging name per directory. The release-blocker arm in `reference-overlay.test.ts` was widened from `tracker/github/` to EVERY manifest entry under `tracker/` — the narrow loop was green for a manifest shape the overlay could not install.
10. **`tests/installer/reference-overlay.test.ts`'s fixture provider is now `probe-provider`, not `jira`.** Its stale-prune and isolation arms need a provider the real manifest does NOT list; `jira` was one and then became real, which inverted those arms silently from "the orphan is removed" to "the real provider survives". A guard now asserts the fixture name is absent from the real manifest, so it fails loudly instead of the next time.
11. **`MARKER_REFS` in `tests/skill-references.test.ts` gained `wave` and `traceability`.** A marker namespace is not a skill, and that set is the existing mechanism for saying so — but note it is now keyed on the NAMESPACE rather than on HTML-comment syntax, because Jira's markers are visible first lines.

12. **★ The tool-call contract got its own shared-literal registry in 3c [DR-19].** `MCP_SHARED_LITERAL_REGISTRY` in `tests/tracker/containment.test.ts` — five normative sentences `tracker/_mcp.md` OWNS (the framing line's composition, where the gated bytes come from, the transformation prohibition, select-by-description, a capability-table row), asserted present in the contract, absent from the three cross-cutting documents, and **restated in no provider `{op}.md`**. A SEPARATE registry, not rows on the sibling one, whose ownership arm asserts its owners are exactly `GIT_CROSS_CUTTING_DOCS`: folding the contract in would have relaxed that arm to admit a fourth owner instead of classifying the case (ADR-025). **The distinction that makes it work:** the contract also MANDATES literals every posting mechanic must name — `D11-OK`, `<bytes>`, `SCRUB: N`, `SECRET-EXPOSED` — and a named arm asserts those are absent from the registry AND present in every posting mechanic, so this guard and `mcp-sink-bypass` cannot be satisfied only one at a time. Twenty per-op provider files written against a contract they are told to "name, not restate" will restate it; the containment oracle cannot see it, because it accounts for lines that existed pre-split.

**Decided in 3c (#325) — the two GitHub literals Phase 2 reserved.** They were reserved because neither could be decided with one provider registered: a cell reading "Fetch GitHub issue" was simply true.

- **`git.mds`'s `## Operations` table and two op descriptions: NEUTRALISED.** "Fetch GitHub issue", "Fetch multiple GitHub issues" and "Create or enrich a GitHub issue" are tracker operations whose provider is resolved per spawn, so the cells were right for one of three. Now "tracker issue(s)". The two op-body descriptions that duplicate those cells moved with them — left alone the table would have contradicted the operation two hundred lines below it. GitHub literals that are NOT a tracker fact stayed: `create-release` and `fetch-review-threads` name GitHub because PR and release hosting stay there under every provider.
- **`git.mds`'s digits-only `SHIPPED_ISSUES` gate: NEUTRALISED, and this one was a live defect.** Step 0 of `backlink-shipped-issues` required every entry to be "digits only" — a GitHub SHAPE in a provider-blind, always-loaded position, so under jira and linear every `PROJ-1` was dropped and the operation was unreachable. It now defers to the resolved provider's anchored reference grammar, and **the github grammar `^#?[1-9][0-9]{0,8}$` moved INTO the github reference** with the same drop rule and the canonical per-ref DEGRADED reason. **The gate is relocated, not weakened:** the operation always loads its provider reference, and an absent reference already means `tracker mechanics unavailable` with no tracker call, so the fail-closed property holds. The metacharacter rationale went with it — all three provider mechanics say the anchored form is what keeps a reference out of a query or a command, and `## Tracker input contract` already states shape-gate-at-the-sink once, so restating it in step 0 was the duplication GAP-37 forbids.
- **`backlink-shipped-issues`' own D4 line no longer names a GitHub signal, and that is the LAST always-loaded site (#325 alignment pass).** The op-level clause read *"Secondary rate limit (403/429 rate-limit response or `X-RateLimit-Remaining` < 10) → stop immediately"* in a provider-blind position, so under jira and linear the winning contract keyed the full-STOP rung on a header neither provider sends while both modules state there is no pre-emptive rung at all. It was **deleted rather than reworded**: the always-loaded D4 block already states the rung provider-neutrally and defers the signal to "the resolved provider's reference", names this op among its two batch ops, and `### Provider signals (GitHub)` in the github mechanics holds both thresholds. A pointer sentence restating an always-loaded rule is the GAP-37 duplication the step-0 pass on this same operation already removed once. **`resolve-review-threads` keeps both thresholds** — PR-thread hosting is GitHub under every provider — and `tests/provider-literals.test.ts` asserts exactly that split per file, with a control arm so an agent scrubbed of backpressure entirely cannot satisfy the absence half. **Why the P2-S4 detector guard never caught it:** `collectCrossCuttingSections` scans `(header)`, `## Principles` and `## Boundaries` only. Excluding op bodies is right for a non-tracker op, whose provider is fixed — and wrong for a TRACKER op, whose provider is resolved per spawn. Look at tracker-op bodies by hand; the guard will not.
- **`src/assets/skills/git/SKILL.md`'s `X-RateLimit-Remaining` threshold: KEPT, deliberately.** It is a load-bearing GitHub D4 mitigation in a file the GitHub path preloads, `SKILL.md` has 19 ch of headroom, and the skill carries GitHub doctrine rather than provider-neutral contract. **Recorded here as a retained GitHub literal so its survival reads as a decision rather than an oversight.**

Net effect on the always-loaded file: **58,776 → 58,751 ch and one line shorter**, so every budget row gained headroom rather than spending it — which matters because the Jira row had 51 ch and an earlier, wordier draft of the same neutralisation breached it. Six baseline lines are booked in `CONTAINMENT_EXEMPTIONS` tagged `#325.`; these are rewrites, not moves.

**Not taken in 3a, recorded so the absence reads as a decision:** the optional per-run **capability attestation line** [GAP-48]. P3a-S14 calls it optional; it has no named consumer and every always-loaded character costs against 94 ch of headroom (ADR-003). It was not added in 3b or 3c either; if a later phase wants it, it belongs in a **per-op Output block**, never the preamble.

## Provider: Jira (3b)

`src/assets/mds/tracker/_jira.mds` → `dist/skills/git/references/tracker/jira/{op}.md`, one file per tracker op. Registered in `VARIANT_MODULES` with `subdir: 'tracker/jira'`, `kind: 'fanout'`, `ops: TRACKER_OPS`. Guards: `tests/tracker/jira-module.test.ts` (31 cases).

### Parity is structural, not asserted

`TRACKER_OPS` is the roster and **every provider row reads it**, so file-set parity across providers is a compile-time property: a provider cannot gain or lose an operation without every provider moving with it. `TRACKER_GITHUB_OPS` remains as a named **alias** of the same list, because several guards genuinely mean *the GitHub path's ops* rather than *the roster* — the GitHub-scoped loaded-set row, the re-scoped AC-2.7 arm, the containment oracle's github corpus. The two are asserted identical by `toBe` at the registration sites, so this is one list with two readings rather than a synonym nobody maintains.

**Define-set parity is asserted**, both directions, because a `@define` name is visible to no type. At three providers the scan is what §8.11 calls non-vacuous, and its shape changed with the third column: `PROVIDERS` is now **derived from the registry's provider rows** (so a fourth joins by construction) and the two hand-written directions became one loop over every **ordered pair** — six directions, not two, because writing them out would be six places a message could drift. `providers.length === 3` and the column names are both asserted, so a registry that lost a provider shrinks the scan loudly.

Three claims ride with it: the define roster equals the op roster with hyphens as underscores; every define body clears an 80-character floor (three modules can agree perfectly on a set of empty defines); and **every §14.4 matrix cell is filled** — each define either states what the operation does on that provider or names why it cannot, with the two known-undefined cells (`closing_refs_for_commit` on Linear and on Jira) asserted POSITIVELY so "no blanks" cannot be met by a module quietly claiming support it does not have.

### Provider facts, and the ones that must be ABSENT

| Fact | Value | Why the absence matters as much as the presence |
|---|---|---|
| `size_cap` | `32767` | The truncation floor derives from it and from the Bash-result limit in `platform-assumptions.md` [DR-06(c)] |
| rate-limit signal | `Retry-After`, honoured **verbatim**, STOP on 429 | **Reactive only.** `X-RateLimit-Remaining` is **absent from the module**: Jira publishes no remaining-request count, so a pre-emptive rung keyed on one would never engage and would read as coverage while providing none |
| GitHub's cap | `60000` **absent** | §14.2 resolves GAP-13 by rendering the 60k sentence verbatim on the GitHub path and each other provider's own cap elsewhere — one number per provider, never a parameterised one |

### The dedup ladder, and the marker

Rungs in order, each named by **capability description, never by tool name** (the contract's rule, and what keeps [DR-08]'s negative unambiguous): *entity property read/write* → *edit comment in place* → *list comments with authors* filtered on the hoisted `accountId` from *identify current user* → **post-with-warning** (`TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)` and post anyway).

**The marker is the comment's FIRST LINE and nothing else.** Jira's comment format has no HTML-comment node — which is also why `render_collapsed_block` degrades to a pointer sentence — so the marker is visible prose on line 1, matched for equality. A marker on any later line **does not suppress**: a marker at line 5 of a third-party comment is quoted prose, and a substring search over the whole comment is exactly how a quoter acquires the power to silence a release note.

**Markers are namespaced per comment kind, and each namespace has exactly one owning operation:**

| Namespace | Owner | Line-1 form |
|---|---|---|
| `devflow:shipped` | `backlink-shipped-issues` | `devflow:shipped v{BARE_VERSION}` |
| `devflow:wave` | `post-wave-report` | `devflow:wave {WAVE_ID}` |
| `devflow:traceability` | `ensure-traceable-issue` | `devflow:traceability {ISSUE_REF}` |

A single global marker would make the three kinds **mutually suppress** (GAP-20) — one kind's comment satisfying another kind's dedup predicate. A guard asserts the namespace appears in its owner and **in no other op file**, so a second namer is caught as the caller-restated literal it is.

### The call budget [DR-09] — a product, pinned as three literals

`backlink-shipped-issues`: **`≤50` items × `≤2` pages = `≤100`** marker calls; exceeding it ⇒ `TRUNCATED ({n} not processed)`. Under GitHub each item's marker check is one call; under Jira rung 3 is the *default* landing rung and each check is a paged comment listing filtered client-side, so the op-level cost is a product no per-call bound expresses. All three literals are pinned and a test asserts the arithmetic (a page bound raised to `≤4` with the product left at `≤100` is the drift that catches). The module also states the **structural** preference [DR-09] names: hoist one bounded *list by filter* read over the ≤50 keys and match markers in memory — one read instead of a hundred.

### `fetch-issues-batch` is ONE query [DR-08]

`key in (KEY-1, KEY-2, …)` with an explicit `maxResults`, bounded `≤50` with `TRUNCATED ({n} not processed)`, **never a per-item loop**. The guard forbids two classes of per-item shape in that file: tool-name verbs (`getJiraIssue`, `get_issue`) and the single-key **capability** name (`fetch by key`) — a guard covering only the first would be inert against the module this repo's own capability-first doctrine steers an author towards writing. `fetch-issue` is in the table too, so the batch reference names the sibling op by description rather than by name; both classes are driven by seeded fixtures.

### JQL / filter safety — stated once, where free prose reaches a query

`ensure-traceable-issue`'s `### Query safety`, and nowhere else: it is the only op where caller-supplied prose reaches a query (`manage-debt`'s search uses a structured filter, and the batch filter carries only pre-flight-anchored keys, so neither has an escaping question). Prefer a structured filter argument; a value may appear **only as a quoted string literal** and only in value position, never as a field, an operator or an ordering clause; escape `\` first and then `"`; after escaping **drop** anything still carrying `"`, `\`, a newline or a backtick — repair is forbidden; every query carries the `≤50` bound plus `TRUNCATED`.

### The ref grammar, and AC-3.4

`^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$`, **anchored at both ends** — never `^A|B$`. The pre-flight drops what fails with `issue reference "{ref}" does not match jira reference grammar` per entry and emits `no parseable refs for provider {p}` when everything is dropped [DR-04(c)].

**AC-3.4's mechanism:** `SHIPPED_ISSUES="PROJ-1 PROJ-2"` is not digits-only, so the always-loaded step-0 entry gate drops every entry — and `backlink-shipped-issues` therefore states **never report the status as `COMPLETE`**. `gather-release-evidence` states it too, for a different reason: `closing_refs_for_commit` is `DEGRADED (unsupported by jira)`, so its enrichment is incomplete by construction.

> ⚠ **Open for the orchestrator.** `git.md`'s `backlink-shipped-issues` step 0 says *"every entry of `SHIPPED_ISSUES` must be digits only"* — a GitHub-specific shape sitting in a provider-blind, always-loaded position. The Jira reference states its anchored grammar as *that gate instantiated for this provider* (the metacharacter guarantee the gate exists for is what the anchored form provides), which is the only reading that does not require editing `git.mds`. A cleaner end state moves the digits-only clause into the github reference; that is a preamble-adjacent edit and was deliberately not taken here.

### Every op carries a named DEGRADED (AC-3.3)

Jira absent or denied yields a **named** DEGRADED at each tracker op — `no tracker tool for {capability}`, with the capability named — while **the branch is still cut and the PR is still opened**, carrying `Tracked (pending)` and the reason. **Never a GitHub issue as a fallback:** a different tracker is not a degraded version of this one, and a stray issue on another system is worse than an honest gap. `setup-task` additionally owns `unusable site` (the `## Project` site shape gate), `tracker not configured` (no site or key), `ambiguous issue reference` (a bare number) and `unsupported transition` (a state `## Transitions` names that this run did not enumerate).

### Posting: the contract is NAMED, never restated

Four ops post (`manage-debt`, `backlink-shipped-issues`, `ensure-traceable-issue`, `post-wave-report`). Each carries a `### Posting gate` that **names `references/tracker/_mcp.md`** and lists its steps without restating its rules: compose into a fresh `mktemp` `$DEVFLOW_BODY_RAW`, run `redact-secrets.cjs --emit`, require a `D11-OK` line, verify `<bytes>`, echo `SCRUB: N […]`, emit `SECRET-EXPOSED (rotate {type} credential — the source file still holds it)` when N > 0, and post with the body argument `{SCRUBBED_BODY}`. AC-3.18 holds absolutely: no `curl`, no `wget`, no `Authorization:`, no credential from the environment, no command-line client anywhere in the tree.

### The Jira loaded-set row

Re-measured after the second alignment pass, and printed by `tests/tracker/byte-budget.test.ts`'s shape table:

| Term | ch |
|---|---|
| always-preloaded set (`git.md` 58,782 + git `SKILL.md` 6,581 + worktree-support 2,942) | 68,305 |
| `references/tracker/_mcp.md` — **0 on the GitHub path**, per-spawn here | 6,402 |
| `max_op` `tracker/jira/{op}.md` (`backlink-shipped-issues`) | 6,087 |
| max over jira ops of the one-spawn load (`setup-task` + `learn-conventions.md`) | 7,821 |
| **worst-case Jira spawn** | **88,615** |

*(Measured 88,609 at the 3b boundary; the preloaded set then shrank by 25 ch in #325 and grew by 31 across the two alignment passes, so this row moved with it each time. Headroom 45, not the 51 it had.)*

`BUDGET_LOADED_SET_JIRA = 88_660` — headroom **45**, a NEW registered ceiling (`budget-loaded-set-jira`), never a raise of an existing one. The GitHub row is **unchanged at 80,837 ≤ 80,944**: `MCP_TERM` stays 0 there **by construction**, because no github op file names the contract, and a byte-budget arm re-proves that beside the AC-2.7 guard. A companion arm holds the delta over the GitHub ceiling to what this provider actually adds, so the number cannot be set freely, and a third arm fails any registered MCP-backed provider that has no ceiling of its own — which is what made Linear's ceiling land in the commit that registered it.

**The gate went red once during authoring** and the response is the precedent: a 197-character rewrite of the contract's truncation clause breached it, and the clause was condensed back to 47 characters of growth rather than the ceiling being moved.

## Provider: Linear (3c)

`src/assets/mds/tracker/_linear.mds` → `dist/skills/git/references/tracker/linear/{op}.md`, one file per tracker op. Registered in `VARIANT_MODULES` with `subdir: 'tracker/linear'`, `kind: 'fanout'`, `ops: TRACKER_OPS`. Guards: `tests/tracker/linear-module.test.ts` (35 cases) plus the cross-provider files below.

### ★ Rank 4 is a property of the SERVER, and every mechanic is written for it (OD-12)

**Three of the four dedup rungs are unreachable on a stock official Linear server, and the module says so rung by rung** rather than presenting rank 4 as a choice:

| Rung | Reachable? | Why |
|---|---|---|
| 1. entity property | No | no capability records an invisible property on an issue |
| 2. edit comment in place | No | not exposed on a stock server |
| 3. first-line marker + author filter | No | **no viewer/"me" tool**, so the current-user identity an author filter compares against cannot be resolved at all. The URL-form remote link that would otherwise give idempotency is out for a related reason: the attachment create takes a **binary payload**, not a URL |
| **4. post with a warning** | **Yes — this is the rung** | `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)` on every run, whether the scan suppressed or posted |

Ranks 1 and 3 need a non-stock server, so a deployment that has one is **not** a reason to soften rung 4's prose: `## Dedup Strategy` may be read as a **hint that only narrows the probe order** and the live probe is the sole authority (OD-11).

**Suppress only on positive evidence; never on missing evidence (B-6).** The absent identity capability is never a reason to suppress — missing evidence is not evidence of a prior post, and a silently skipped release back-link is worse than a second one when the reader is told which it is. The one place the fail-closed direction wins instead is `post-wave-report`'s FULL scan: a truncated scan says the evidence exists and was not read, which is a different condition from a capability that is absent, and a duplicate wave report is worse than a missing one because the next run cannot tell which is authoritative. **Both rules ship, and the module states the distinction where they meet.**

### The marker, and the second discriminator rank 4 makes load-bearing

Line 1 is exactly `devflow:shipped v{BARE_VERSION} · https://github.com/dean0x/devflow` (and the `devflow:wave` / `devflow:traceability` equivalents), matched for equality. Two halves answering two different failures:

- **The first-line binding** defeats a quoter, who prefixes line 1 with `> ` and breaks the exact match. A marker on any later line **does not suppress** — a substring search over a whole comment is precisely how a quoter acquires the power to silence a release note.
- **The URL** defeats a coincidence. With no author column to compare against, the marker is the only evidence a comment is devflow's, and `devflow:shipped v1.2.3` is a first line somebody discussing a release might plausibly type. A full project URL on the same line is not. Danger JS's `"Generated by"` trick, hardened.

**The URL is part of the MARKER, not a visible footer.** `git.md`'s attribution rule confines the `*Posted by [devflow](…)*` footer to `post-review-summary` and `post-resolution-summary`; these three comment kinds "use the marker only", and a footer here would contradict an always-loaded rule. A guard asserts every namespace appears on a line that also carries the URL, in all three kinds, because a kind that dropped it would dedup on the marker alone and inherit the false positive rank 4 cannot otherwise rule out.

**§14.4's spellings, not GitHub's.** `devflow:wave`, deliberately, against GitHub's frozen `devflow:wave-report` — and a negative arm asserts GitHub's spelling never leaks in, so it cannot be "fixed" by copying the sibling across. No reader crosses providers, so they cannot collide.

### Provider facts, and the ones that must be ABSENT

| Fact | Value | Note |
|---|---|---|
| `size_cap` | `32767` | **BORROWED, not measured** — see `## Known Unknowns` below |
| rate-limit signal | HTTP **`400`** carrying `RATELIMITED` | **not a 429**, and it arrives as error TEXT rather than a status line |
| `Retry-After` | **absent** | Jira's signal; honouring a header this provider never sends |
| `X-RateLimit-Remaining` | **absent** | a pre-emptive count this provider does not publish |
| `60000` | **absent** | GitHub's cap (§14.2 renders that sentence verbatim on the GitHub path only) |

**Why the `400` has to be named explicitly.** D4's rule is status-shaped: a generic 4xx means "degrade this item and continue". An unnamed `400` is therefore answered by continuing to fan out **into** the window the rung exists to stop, which is the one way this provider's backpressure is missed entirely. The module names the code, the token, the error-text form, and `STOP` — and states that there is **no pre-emptive rung**, because an omitted rung reads as an oversight and the next author adds GitHub's.

### The ref grammar — two anchored forms, never one alternation

`^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$` **or** `^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$`, each anchored at both ends, after **ASCII-upper normalisation** (a reference copied out of a branch name or a URL arrives lowercased). §14.1's "never `^A|B$`" is the whole point: an alternation inside one anchor pair anchors the left branch at the start only and the right at the end only, and `tests/tracker/hostile-values.test.ts` drives that exact shape as a probe to show it admits a payload every shipped form rejects.

The always-loaded entry gate in `backlink-shipped-issues` step 0 now defers to this grammar rather than requiring digits — see `## Component Interactions`' note on the #325 neutralisation.

### The call budget [DR-09] — the common path, not the edge

`≤50` items × `≤2` pages = **`≤100`** marker calls, with the hoisted single-pass alternative stated beside it. The difference from Jira is not the numbers but their status: rung 4 is this provider's **only** rung, so the paged comment listing is what every run does rather than the fallback a probe might avoid.

### The Linear loaded-set row

| Term | ch |
|---|---|
| always-preloaded set (`git.md` 58,782 + git `SKILL.md` 6,581 + worktree-support 2,942) | 68,305 |
| `references/tracker/_mcp.md` — **0 on the GitHub path**, per-spawn here | 6,402 |
| `max_op` `tracker/linear/{op}.md` (`backlink-shipped-issues`) | 7,706 |
| max over linear ops of the one-spawn load (`setup-task` + `learn-conventions.md`) | 8,571 |
| **worst-case Linear spawn** | **90,984** |

`BUDGET_LOADED_SET_LINEAR = 91_000` — headroom **16** after the second alignment pass, a NEW registered ceiling (`budget-loaded-set-linear`), never a raise. **★ This is the thinnest of the four gates and therefore the one that binds.** It contains `git.md`, so every character added to the always-loaded agent is charged here as well as to its own ceiling — and the `git.md` ceiling's 88 ch of apparent slack is unspendable while this row has 16. Check this number, not that one, before adding always-loaded text. **This provider's `max_op` is the largest of the three by 2,699 ch over GitHub's, and that is content rather than slack:** `backlink-shipped-issues` is where the ladder is stated, three of its four rungs need their unavailability explained (or the next reader treats rank 4 as a misconfiguration), and the marker predicate needs both halves written down. The two per-provider gates are now generated from one `PRICED_PROVIDERS` table, so a fourth provider adds a row rather than a copied pair of `it`s.

### `## Known Unknowns` — and why it is module-level prose

The section lives **above the first section marker** in `_linear.mds`, which the build emits **nowhere**. That is not a filing preference: a column-0 `## ` inside a generated reference terminates its operation section for every guard reading it through `extractOpSectionFromCorpus`, so everything below would go silently invisible while the bytes stayed on disk (PF-063). A guard asserts the heading is above the first marker AND absent from all ten generated files. The user-facing copy is `docs/cli-reference.md`'s `### Known Unknowns — Linear`, which carries the rank-4 statement in plain words.

**GAP-48 — the optional per-op capability-attestation line (P3a-S14) is DEFERRED, not shipped.** It would have made the author-filter and no-HTTP-fallback controls auditable in the artifact rather than only assertable in prose. It is not shipped because it has **no reachable consumer at the 3c boundary** — nothing reads a per-run attestation line — and **no budget headroom**: it is always-loaded text, and the binding Linear loaded-set row has 16 ch. Owner **dean0x**; revisit with **#342** (the prompt-diet pass), which is where always-loaded bytes get freed rather than borrowed. Recorded here so its absence reads as a decision rather than an omission.

Contents: the borrowed `32767`, the rank-4 reality, and **issue #343** as the owner and artifact — named from the module so a measurement lands in one change rather than being hunted for. `tests/provider-literals.test.ts` is the other place the borrowed value is pinned, and the issue names both.

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
- **Giving a tool-call provider's comment a visible `*Posted by [devflow](…)*` footer.** `git.md` confines that footer to `post-review-summary` and `post-resolution-summary`; `post-wave-report`, `backlink-shipped-issues` and `ensure-traceable-issue` "use the marker only". Linear needs a second discriminator on top of its marker (rank 4 has no author column), and the answer was to put the project URL **inside the marker line** rather than to add a footer — a footer would contradict an always-loaded rule to solve a problem the marker can solve itself.
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
- **The bypass regex reads `word:` as an argument assignment, and prose is full of them.** `tests/guards/mcp-sink-bypass.test.ts` matches `(body|description|content|text|markdown|adf|comment_body)\s*[:=]\s*` followed by anything other than the gated placeholder. A sentence like *"the detector must read the text: a status-shaped rule…"* is therefore reported as a posting mechanic assigning an ungated body — it caught three prose false positives in 3b and one more in 3c. **Write mechanics, not prose that looks like a call**: "read that error text and not the status" costs nothing and the guard stays unambiguous. Do not widen the regex to exclude prose; the widening would exclude the real shapes too.
- **A provider module's `max_op` is what the byte budget prices, so the LARGEST op file is the one to watch.** Linear's `backlink-shipped-issues` is 7,706 ch — 2,699 more than GitHub's largest file — because the dedup ladder and the rank-4 marker predicate are both stated there. That is priced on its own row and justified in the ceiling's JSDoc, but the lesson generalises: content added to whichever op file is already the biggest moves a ceiling, while the same content in any other op file moves nothing. Check `max_op` before choosing where a cross-cutting paragraph goes.
- **The agent is 334+ lines against the plan's ~250 estimate, and that is a decision.** 82 lines are irreducible contract (the 11-row shape-gate table plus the 46-line template); the rest is prose whose every paragraph carries a rule *with* its reason, because PF-037 argues for self-containment for an agent that runs unattended with no orchestrator to ask. One trimming pass was attempted and immediately tripped two guards. Do not trim into mandated rationale; if a pin trips, pin a stable literal rather than a reflow-fragile phrase.

## Key Files

- `src/core/tracker.ts` — `TRACKER_PROVIDERS`, `TrackerProvider`, `TrackerFeatureState`, `TrackerResult`, `parseTrackerId` (strict), `normalizeTrackerFeature` (tolerant), `describeTrackerValue`, `TRACKER_PROVIDER_KEY_PATH`, the four artifact basenames, `trackerConventionsPath` / `trackerAttemptsPath` / `trackerEnabledSentinelPath` / `trackerConventionsBackupPath`, and the three lifecycle owners `rearmTrackerInference` / `applyTrackerSentinel` / `renameStaleTrackerConventions`
- `src/cli/commands/tracker.ts` — `resolveTrackerCliAction` (pure), `readTrackerProvenance`, `formatTrackerProvenance`, `trackerCommand`; `D-TRACKER-PAIR` is recorded in its header [DR-25]
- `src/cli/commands/tracker-prompts.ts` — `shouldRunTrackerStep`, `TrackerPromptIO` (a sibling `selectProvider` rather than a widened boolean `select`), `buildClackTrackerPrompts`, `runTrackerStep`, `formatTrackerSummary`, `formatProviderCatalogue`
- `src/cli/commands/init.ts` — the eleven tracker edit sites; the single `Tracker selection lifecycle` block; `resolveTrackerInitState`; `--tracker <id>` and its boundary parse
- `src/cli/commands/uninstall.ts` — `tracker.md` in `enumerateUserDevFlowContent` with the OD-15 reversal note at the code site; the three `.tracker.*` files in `installArtifactPaths`
- `src/core/manifest.ts` — `features.tracker: TrackerFeatureState`, `normalizeTrackerFeature` on read, and the hard-null-set prohibition in the field's doc comment
- `src/core/feature-config.ts` — `TrackerConfigOverride`, `parseTrackerOverride`, `FeatureConfig.tracker?: string` (RAW, carried verbatim), `BooleanFeature`'s `-?`
- `src/core/mds-variants.ts` — `TRACKER_OPS` (the roster) and `TRACKER_GITHUB_OPS` (its provider-scoped alias), the three provider rows of `VARIANT_MODULES`, `MCP_BACKED_PROVIDER_SUBDIRS`, `MCP_CONTRACT_MODULE`, `mcpContractIsGenerated`, `resolveVariantModules`, `GATED_REFERENCE_MODULE_SOURCES`, `deferredReferenceModuleSources`, `validateContractOutputName`, the `_?` section-marker regex
- `src/assets/mds/tracker/_jira.mds` — the Jira mechanics; 10 defines named identically to `_github.mds`'s, the dedup ladder and first-line namespaced markers, `32767` / `Retry-After`, the single-query batch, the `≤50 × ≤2 = ≤100` budget, `### Query safety`, and a `### Posting gate` in each of the four posting ops
- `src/targets/claude-code/installer.ts` — `D-OVERLAY-PROVIDER-SHAPE`: `isProviderSubdir`, the flat arm's `dir`, and one staging name per flat directory
- `src/assets/agents/tracker.md` — the agent; Iron Law, read-only boundary, Environment (prefer the directive's `Devflow directory:`), Step 0 (600 s), capability probe, bounded inference, the 11-row shape-gate table, the `tracker-md-template` fence, the write chain, Finishing
- `src/assets/agents/git.mds` — the reader half: resolution order, ref-grammar corroboration, the project key, the mismatch guard, the `# UNRESOLVED:` hard sentinel, the `- **Tracker**:` rendering rule
- `src/assets/mds/tracker/_mcp.mds` — the tool-call contract; the 15-row capability table, no-HTTP-fallback, scrub-before-render, the `SCRUB:`/`SECRET-EXPOSED` echo, the `<bytes>` verification refusal [DR-06]
- `src/assets/scripts/hooks/session-start-context` — Section 3; `TRACKER_DEVFLOW_DIR` captured **above** the project `DEVFLOW_DIR` assignment; five gates; `TRACKER_ATTEMPTS_MAX=5`; `TRACKER_PROCESSING_STALE_SECS=600`; the positive `jira|linear` allowlist; the allowlisted `TRACKER_MODEL="sonnet"`
- `src/assets/scripts/redact-secrets.cjs` — `--emit`, `NONCE_HEX_CHARS`, `D11_FAIL_REASONS`, exit code 5, `parseArgs` / `scrubTwice` / `frameEmit` / `readInput` / `runFileMode` / `runEmitMode`
- `tests/core/tracker.test.ts` — registry, the hostile-payload table, the self-heal table, lifecycle, the key-path walk
- `tests/tracker-prompts.test.ts` · `tests/tracker-cli.test.ts` — the 8-row gate matrix and step semantics; the CLI resolver, provenance, and the `--set` call-site assertions
- `tests/tracker-agent.test.ts` — 49 static content guards, each negative driven by a named collector with a known-bad probe
- `tests/tracker/schema-scope.test.ts` — the schema table, [DR-21]'s two-sided headings, the AC-3.16/3.18 sweeps, and the three-list DEGRADED registry with its partition assertion
- `tests/tracker/hostile-values.test.ts` — the field × payload matrix, the per-provider ref-grammar table (register row 25, three providers × eight payloads) and §14.9-10's escape-then-drop model; all four named describes are live
- `tests/seams/tracker-key-path.test.ts` — the TS↔shell key-path seam, 14 shapes × 2 json backends
- `tests/seams/tracker-claim-staleness.test.ts` — the agent↔shell claim-staleness seam
- `tests/guards/mcp-sink-bypass.test.ts` — contract clauses against the SOURCE `.mds`, the bypass regex run over the LIVE provider corpus, the forward arm
- `tests/guards/provider-scope.test.ts` — `PROVIDER_OWNED_PATHS` (per path, per token), AC-3.12's five forbidden scopes with a seeded probe each, and the AC-2.7 gate in both directions
- `tests/tracker/jira-module.test.ts` — registration and the gate it opens, the **cross-provider** define-set parity scan (ordered pairs, derived `PROVIDERS`, matrix-cell completeness), the Jira literals, [DR-08], [DR-09], AC-3.14, AC-3.4, AC-3.18
- `src/assets/mds/tracker/_linear.mds` — the Linear mechanics; the rung-by-rung ladder ending at rank 4, the URL-bearing first-line marker, `32767` / `400 RATELIMITED`, the two anchored ref forms after ASCII-upper, `issues(filter: …)` with `first:`, and the module-level `## Known Unknowns` naming issue #343
- `tests/tracker/linear-module.test.ts` — rank 4 and why the higher rungs are unreachable, the marker predicate's two halves, the `400` signal in all three forms, the ref-grammar payload table, `## Known Unknowns` placement (above the first marker, absent from all ten generated files), [DR-08], [DR-09], AC-3.18
- `tests/provider-literals.test.ts` — the 5 × 3 provider-literal matrix over sources AND generated trees, with the cross-provider [DR-08] negative and the tool-call-scoped bound arm
- `tests/helpers.ts` (`PER_ITEM_FETCH_SHAPES` / `collectPerItemFetchVerbs`) — one authority for what a per-item fetch looks like, because the [DR-08] claim is made per provider and across providers
- `tests/guards/no-control-bytes.test.ts` — no raw control byte in any shipped source under `src/`
- `tests/tracker/byte-budget.test.ts` — `BUDGET_GIT_MD_P3`, `PREAMBLE_CHARS_P2`, the computed `BUDGET_LOADED_SET_P3`, the non-preamble gate, the re-derivation guard, and the per-provider row (`BUDGET_LOADED_SET_JIRA`, `providerLoadedSet`, the every-provider-has-a-ceiling arm)
- `tests/fixtures/numeric-floors.json` — ceilings `budget-git-md-p3`, `budget-loaded-set-jira` (88,660), `budget-loaded-set-linear` (91,000) and `tracker-section-max-chars` (800); floors `agent-roster-count` (17), `generated-reference-manifest-size` and `packed-reference-manifest-size` (both 34), `capability-hoist-block-floor` (49)
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
- **Manifest-group vs config-gated feature state** is the distinction that places `features.tracker` (manifest, machine-wide, alongside `proxy` and `compliance`) opposite the per-repo `tracker` key (`.devflow/config.json`, per-repo, alongside `memory`/`learning`/`knowledge`). They are different authorities with different precedence, not two spellings of one setting. `src/cli/commands/tracker.ts`'s header states the rule in plain words and cites no ledger anchor for it: no ADR in `.devflow/learning/decisions.md` records the manifest-group/config-gated split, so the distinction stands on its own merits (avoids PF-065 — a real anchor attached to a claim its body does not make is worse than silence)
- ADR-003: leave the end state, and every field needs a reachable consumer — why `learned:` was dropped from the template, why there is no `TrackerError` taxonomy, why the capability attestation line was not added, and why the agent now reads the directive's `Devflow directory:` field instead of leaving it unread
- ADR-013: pure-core / I/O-target split — the reason `src/core/tracker.ts` and `src/cli/commands/tracker.ts` both exist, and the reason the `~/.devflow` lifecycle lives in core rather than the Claude Code target
- ADR-014: re-init preserves existing values, defaults adopted only for newly-added settings — the frame for the manifest's silent self-heal to `github` [DR-26]
- ADR-025: classify each guard literal individually; widen only where a literal provably moved — the discipline `PROVIDER_OWNED_PATHS` applies per (path, token) rather than per token — and the discipline that kept the `_mcp.md` shared-literal registry a SEPARATE registry in 3c instead of a relaxed arm on the sibling one
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
