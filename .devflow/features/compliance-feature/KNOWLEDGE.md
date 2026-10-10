---
feature: compliance-feature
name: Compliance Feature & SDLC Traceability
description: "Use when adding or modifying the compliance feature (framework registry, converge contract, CLI, rule stamping), changing how host commands resolve the compliance lens (COMPLIANCE_FRAMEWORKS / COMPLIANCE_ACTIVE from the settings line) or how agents load framework references, modifying traceability SEMANTICS in the Git agent (D1-D11 decision markers, D4 degradation contract, D9 resolution gate, containment, Handoff Values), or extending the D4 DEGRADED contract. Keywords: compliance, COMPLIANCE_FRAMEWORKS, COMPLIANCE_ACTIVE, compliance_gate, compliance_lens, compliance_frameworks, D-COMPLIANCE-INSTALL-ALWAYS, D-COMPLIANCE-REPO-LENS, D-COMPLIANCE-SHADOW-SOURCE, shadowSeedDir, RUNTIME_SELECTION_LINES, unknownFrameworkIds, convergeComplianceArtifacts, convergeFromManifest, frameworks, FEATURE_OWNED_SKILLS, traceability, D4, D9, gather-release-evidence, conventions.md, resolve-review-threads, ensure-traceable-issue, stamper, manifest-group, ComplianceFeatureState, Handoff Values, ISSUE_PR_LINK, issue_ref_grammar, issue_capture_contract, _tracker.mds, Provider signals, decision-markers.md, publication-gate.md, learn-conventions.md, tracker/github, PR_HOST_OPS, references/pr, PR mechanics, sinkCorpusWithoutPrHost, gitPlusPrHostCorpus, release-trace.cjs, messageBody, D-TRACE-FULL-MESSAGE, D-TRACE-REVERT-BODY, MESSAGE_LOG_FLAGS, complianceDefault, resolve-evidence-policy, evidence policy floor, review lens only, Branch token."
category: architecture
directories:
  - src/core/compliance.ts
  - src/targets/claude-code/compliance-install.ts
  - src/cli/commands/compliance.ts
  - src/assets/skills/compliance
  - src/assets/rules/compliance.md
  - src/assets/agents/git.mds
  - src/assets/mds/tracker/_github.mds
  - src/assets/mds/git
  - src/assets/scripts/release-trace.cjs
  - src/assets/scripts/resolve-evidence-policy.cjs
  - src/assets/commands/_partials/_tracker.mds
  - src/assets/commands/code-review.mds
  - src/assets/commands/plan.mds
  - src/assets/commands/implement.mds
  - src/assets/commands/resolve.mds
  - src/assets/commands/dynamic-build.mds
  - src/assets/commands/_partials/_compliance.mds
  - src/assets/commands/release.mds
created: 2026-08-20
updated: 2026-09-29
---

# Compliance Feature & SDLC Traceability

## Overview

Compliance is a built-in feature (not a plugin) that provides two interlinked capabilities:
(1) a regulatory-framework skill system that applies framework-specific controls during code review, planning, and design; and (2) an SDLC traceability layer — wired into Git agent operations — that ties branches to issues, PR titles to project conventions, review threads to verified fixes, and releases to shipped issues.

The compliance skill is **installed on every machine** by `convergeComplianceArtifacts` (not by `installViaFileCopy`), with all six framework references (`D-COMPLIANCE-INSTALL-ALWAYS`) — a repository can turn the review lens on by itself (`compliance` in its committed `.devflow/project.json`), so the machine switch cannot decide what is installed. The machine switch owns only the **rule** (the one artifact Claude Code loads into every prompt) and the SKILL.md stamp. Host commands resolve the lens at runtime from the settings line through the shared `_partials/_compliance.mds` (`D-COMPLIANCE-REPO-LENS`): `COMPLIANCE_FRAMEWORKS` is `off`, `none` (generic controls) or framework ids, and an agent loads `references/{id}.md` only for the ids it is given — presence of a file decides nothing. The traceability operations in the Git agent take no compliance input at all: they key on the evidence policy's mechanism inputs (`ISSUE_REQUIRED`, `APPLY_CONVENTIONS`, `REQUIRE_NON_AUTHOR_APPROVAL`).

**Tracker Phase 2 (#324, PR #339)** split the Git agent's traceability text into a provider-independent contract (semantics — stays in `git.mds`) and per-provider GitHub mechanics (generated references, loaded on demand). This KB owns the traceability **semantics** — the D1–D11 decision markers, the D4 degradation contract, the D9 resolution gate, containment discipline, and bounds — and says where each now physically lives. The sibling `.devflow/features/tracker-references/KNOWLEDGE.md` owns the split **mechanics**: the MDS build machinery, the byte budget, the containment oracle, and the installer overlay. Read that KB for "how the split works"; read this one for "what the rules mean and where to find them."

**#326 (PR #353)** added a second, disjoint mechanics split on top of Tracker Phase 2: the 8 PR/review ops' `### Process` bodies (`PR_HOST_OPS`) moved to provider-independent **PR-host mechanics** under `references/pr/`, installed unconditionally under every provider — pull requests, PR reviews, and PR checks stay on GitHub regardless of which issue tracker is selected. This discharged the prior obligation that the D10/D11 sinks (`post-review-summary`, `post-resolution-summary`) could only move together with their guards: the same PR widened those guards to `'union'` extraction mode. See below for what stays inline per operation and which of the two splits (tracker vs. PR-host) each moved piece belongs to.

## System Context

Compliance replaced the retired `devflow-compliance` plugin. The plugin entry is in `DELETED_PLUGIN_NAMES` (not `DEVFLOW_PLUGINS`), and its skill/rule are managed exclusively by `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES` in `src/core/plugins.ts`. Nothing in the compliance system uses the plugin install path.

`resolveFeatureRedirect` in `plugins.ts` handles the case where a user passes `devflow-compliance` or `compliance` via `--plugin`: it strips those names from the requested list, emits a notice, and continues with the remaining plugins (strip-and-continue). This prevents a mixed `--plugin` list from silently no-oping.

State lives in `manifest.features.compliance: ComplianceFeatureState` — a named type (`{ enabled: boolean; frameworks: string[] }`) shared across `manifest.ts`, `init-seed.ts`, `init.ts`, `compliance.ts`, and `compliance-install.ts`. This is a manifest-group (like proxy), not a `config.json` toggle. Absent or malformed fields self-heal to `{enabled:false, frameworks:[]}` via `normalizeComplianceFeature()`.

## Component Architecture

### Framework registry (`src/core/compliance.ts` — pure, no I/O)

Six frameworks: `gdpr`, `hipaa`, `pci-dss`, `soc2`, `iso-27001`, `sox`. Each has a static `label` (used verbatim in stamped artifacts) and an `id` (matches the source directory under `compliance/frameworks/{id}/` and the installed reference file basename `references/{id}.md`).

Key exports:

| Export | Behaviour |
|---|---|
| `COMPLIANCE_FRAMEWORKS` | Readonly registry array — IDs, labels, hints |
| `ComplianceFeatureState` | Named type `{ enabled: boolean; frameworks: string[] }` — single definition for all callers |
| `ALWAYS_PRESENT_REFS` | `['detection.md', 'sources.md']` — always installed regardless of framework selection; single definition |
| `normalizeFrameworks(ids)` | **Tolerant** — drops unknowns silently; deduplicates (first wins) |
| `parseFrameworkList(input)` | **Strict** — rejects unknowns with an error naming every unknown and every valid ID |
| `normalizeComplianceFeature(raw)` | Self-heal: absent/malformed → `{enabled:false, frameworks:[]}` |
| `stampComplianceRule(content, ids)` | Replaces `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` with static labels only (delegated-to by `composeComplianceRule`) |

### Dynamic composition (`src/core/compliance-compose.ts` — pure, no I/O)

Introduced in A8 to compose SKILL.md and the rule file from per-framework fragments rather than shipping static all-six blobs.

**Fragment format** (`src/assets/skills/compliance/frameworks/{id}/fragment.md`): 4 required sections — `## Mapping` (1 table row, 6 cells), `## Reference` (single-line blurb), `## Checklist` (0–2 items), `## Rule` (1 bullet, ≤200 chars).

**5 skill tokens** resolved into the SKILL.md template: `${DEVFLOW_COMPLIANCE_SCOPE}`, `${DEVFLOW_COMPLIANCE_ACTIVE}`, `${DEVFLOW_COMPLIANCE_MAPPING}`, `${DEVFLOW_COMPLIANCE_CHECKLIST}`, `${DEVFLOW_COMPLIANCE_REFERENCES}`.

**The Active Frameworks section is a stamp plus a runtime rule** (`buildActiveSection`): the stamp names the MACHINE's selection — `**Machine frameworks: GDPR, SOC 2.**`, or `The machine declares no framework.` on a compliance-off machine — followed by `RUNTIME_SELECTION_LINES`: every `references/{id}.md` is installed, so presence decides nothing; the ids given (`COMPLIANCE_FRAMEWORKS`, the machine's plus the repository's) are the frameworks in force; load `references/{id}.md` for each given id and no other; `none` means generic controls only; never fabricate guidance for a framework you were not given. The stamp is informational — what a run applies is what its caller passes.

**1 rule token** resolved into the rule template: `${DEVFLOW_COMPLIANCE_RULE_BULLETS}` (per-framework `Apply ...` bullets); `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` is then delegated to `stampComplianceRule`.

**C1 passthrough**: if the template contains no `${DEVFLOW_COMPLIANCE_` tokens (e.g. a user shadow with static content), the function returns the content byte-identical. This is deliberately flagged by `--status` as `[shadowed, composition skipped]`.

**Source layout vs installed layout**: reference files live at `frameworks/{id}/reference.md` in source, but are installed as `references/{id}.md` (installed artifact layout is unchanged from pre-A8 installs).

`normalizeFrameworks` is the trust boundary used inside `convergeComplianceArtifacts`, ensuring no user-supplied or manifest-sourced ID ever becomes an fs path segment or is written into an installed artifact without registry validation (AC-35, AC-36).

`parseFrameworkList` is the boundary for CLI `--set` input — called before any I/O so an invalid ID fails loudly and leaves no partial state on disk.

### Install orchestrator (`src/targets/claude-code/compliance-install.ts`)

`convergeComplianceArtifacts(opts)` is the single public function. Convergence matrix (`D-COMPLIANCE-INSTALL-ALWAYS`) — the skill directory is installed in EVERY state, always with `ALWAYS_PRESENT_REFS` plus all six framework references (`references/{id}.md` for every registry id, whatever the machine selected):

| State | Outcome |
|---|---|
| `enabled + rulesEnabled` | Skill dir, SKILL.md stamped with the machine's frameworks + stamped rule |
| `enabled + !rulesEnabled` | Skill dir, machine stamp; remove a stale rule |
| `!enabled` | Skill dir, the neutral zero-framework stamp; remove the rule (warn-not-throw) |

Fragments are loaded once per convergence for the STAMPED frameworks only (none on a compliance-off machine) and shared by SKILL.md and the rule.

**Return value:** `{ removedPreexisting: boolean; converged: boolean }`.  `removedPreexisting` is true only when a pre-existing **rule** was found and removed on a compliance-off (disable) convergence — the skill is no signal, since every machine has it (init uses this for the legacy-upgrade notice, "Compliance rule removed — …"). `converged` is `false` when any warn path was taken — callers cannot detect partial failure via a catch block since the function is warn-not-throw; this field makes the outcome truthful.

**claudeDir guard:** If `claudeDir` is not an absolute path, warn and return `{ removedPreexisting: false, converged: false }` immediately. This prevents `fs.rm` from resolving to an unexpected location — an assert-preconditions-in-production-code pattern per reliability.md.

**`convergeFromManifest` wrapper:** The single manifest→options site, eliminating hand-assembly at each call site (`init.ts`, `rules.ts`, `compliance.ts`). Accepts a manifest slice `{ features: { compliance: ComplianceFeatureState; rules: boolean } }` and an optional `rulesEnabledOverride` (used by `rules.ts` where `rulesEnabled` reflects actual install outcome rather than manifest state).

**Legacy-upgrade notice:** `init.ts` probes the compliance rule target **before** `installViaFileCopy` runs (the full install wipes `rules/devflow/` before converge, so a post-install probe would miss it). `hadComplianceRule` combined with `convergeResult.removedPreexisting` drives the notice.

**Unconditional convergence:** both artifact operations always execute independently: `installSkillDir` catches its own errors internally, so the rule step (install, or probe-then-remove) always runs.

**Temp-sibling+rename:** `installSkillDir` builds the new tree under `{target}.tmp`, then removes old → renames. That is two calls, not an atomic swap: it narrows the window with no skill directory to the gap between them. Orphaned `.tmp` directories from prior crashes are cleaned up at the start of each run.

**Shadow semantics:** SKILL.md source resolves as shadow → canonical (validates via `validateSkillShadow`), and is composed with the stamp frameworks either way. Reference files (`{id}.md`, `detection.md`, `sources.md`) always come from canonical source — framework refs are not user-overridable. Fragment files are always loaded from canonical source even when SKILL.md comes from a shadow (fragments are registry-owned content). Rule source resolves as shadow → canonical (validates via `validateRuleShadow`), then `composeComplianceRule` (which delegates `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` to `stampComplianceRule`) is called. C1 passthrough: a token-free shadow passes through byte-identical without composition.

**Installer sweep and FEATURE_OWNED_SKILLS:** `installViaFileCopy` unions `FEATURE_OWNED_SKILLS` into the known-names set for its orphan sweep. This means `devflow:compliance` is never incorrectly swept as an orphan. The formerly exported `shouldSurfaceFeatureOwnedSkillOrphan` and `filteredSweepReport` functions have been deleted — no caller needed them after the union approach.

### CLI (`src/cli/commands/compliance.ts`)

`resolveComplianceCliAction(current, action, setFrameworks?)` is a pure resolver — no I/O. It maps `(state × action)` → `(nextState, messages)`. The caller owns the I/O: converge artifacts, write manifest.

Disable-keeps-frameworks: `disable` sets `enabled: false` but leaves `frameworks` unchanged. `enable` restores those frameworks. Only `set` replaces the framework list.

Interactive TTY path: when `--enable` is called on a TTY with no prior frameworks, the CLI presents a `@clack/prompts` multiselect before falling through to the `set` action. The multiselect options and prompt message are now imported from `compliance-prompts.ts` (`frameworkChoices()` and `FRAMEWORK_SELECT_MESSAGE`).

`--disable` removes the rule and keeps the frameworks ("Compliance disabled — rule removed, frameworks remembered for re-enable"); the skill stays installed with the neutral stamp. `--status` reports no reference-file drift — every install carries all six references, so an installed file says nothing about the selection; it reports `unknownFrameworkIds(manifestFrameworks, registryIds)` — manifest ids the registry does not know (a hand-edited or newer-devflow manifest), which every install drops and only `--set` removes.

`--status` shadow detection: the `skillShadowState()` helper reads the shadow SKILL.md and checks for any `${DEVFLOW_COMPLIANCE_...}` token. Returns `'none'` (no shadow), `'shadowed'` (shadow with tokens — composition runs), or `'composition-skipped'` (token-free shadow — C1 passthrough). The Skill line in `--status` shows `[shadowed]` or `[shadowed, composition skipped — per-framework sections absent]` accordingly.

### Init wizard (`src/cli/commands/compliance-prompts.ts`)

Shared helpers for the compliance step in `devflow init`. All prompt-rendering logic lives here (CLI-layer code in `src/cli/commands/`).

**`shouldRunComplianceStep(input)`** — pure gate predicate:
- `hasCliOverride` → `false` (CLI flags bypass wizard entirely)
- `!isTTY` → `false` (non-interactive contract)
- `mode === 'advanced'` → `true` (always run in Advanced path)
- `mode === 'recommended'` → `modePromptShown` (only when the mode-select prompt actually ran — `--recommended` flag never sets this)

**`runComplianceStep({ seed, prompts })`** — injectable runner (never calls `process.exit()`, never throws):
- Emits a clack note with "Current setting: {state}" for re-init legibility
- `p.select` (Yes/No) for enable — `p.confirm` was replaced to avoid Enter-through ambiguity
- If Yes: `p.multiselect` for framework selection (seeded from prior state)
- Returns `{ kind: 'resolved', state, messages }` or `{ kind: 'cancelled' }`
- All arrays are defensively copied (no alias of seed arrays)

**`CompliancePromptIO`** — injectable interface (mirrors `ProxyPreflightDeps`):
- `note(message, title)`, `select(opts)`, `multiselect(opts)` — each returns `PromptOutcome<T>`
- `buildClackCompliancePrompts()` builds the real (clack) adapter

**Shared constants** used by both `init.ts` and `compliance.ts`:
- `FRAMEWORK_SELECT_MESSAGE` — the canonical multiselect message string
- `frameworkChoices()` — maps `COMPLIANCE_FRAMEWORKS` → `{value, label, hint}` options array
- `formatFrameworkCatalogue()` — padded catalogue string for the wizard note
- `formatComplianceSummary(enabled, frameworks)` — canonical summary for re-export in `init.ts`

**Integration in `init.ts`:**
- `modePromptShown` is set to `true` only inside the `else` branch where `p.select` for mode actually runs
- Both the Recommended path and the Advanced path gate on `shouldRunComplianceStep`; on the Advanced path `isTTY` is guaranteed true (the non-TTY guard already exited with code 1 at the top of the Advanced block), so the predicate reduces to the CLI-override check (`hasCliOverride`)
- Recommended path: `shouldRunComplianceStep` additionally requires `modePromptShown` (when `mode === 'recommended'`), which is `false` under `--recommended` — preserving the promptless contract
- `--compliance`/`--no-compliance` flags populate `cliComplianceOverride`, which bypasses the wizard (`hasCliOverride=true`)

### Rule template and seedRuleShadow

`src/assets/rules/compliance.md` is a composition template with two dynamic tokens:
- `${DEVFLOW_COMPLIANCE_RULE_BULLETS}` — replaced with per-framework `Apply ...` bullets (one per selected framework)
- `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` — delegated to `stampComplianceRule` → `Active frameworks: GDPR, SOC 2 — their controls are binding.` (non-empty) or `Active frameworks: none declared — generic controls only.` (empty)

**The skill shadow mirrors it (`D-COMPLIANCE-SHADOW-SOURCE`).** `devflow skills shadow compliance` seeds through `shadowSeedDir(bareName, installedDir)` (`src/cli/commands/skills.ts`), which returns the shipped SOURCE for every `FEATURE_OWNED_SKILLS` member and the installed copy (else source) for every other skill. The installed compliance SKILL.md is composed — its `${DEVFLOW_COMPLIANCE_*}` tokens already replaced — and a token-free shadow passes composition byte-identical (C1), so seeding from the installed copy would freeze that moment's stamp: a later `devflow compliance --set` could never re-stamp a shadowed skill (AC-38). `devflow skills list` names its provenance `the compliance feature (every install)`.

`seedRuleShadow` in `rules.ts` uses a two-tier strategy for `FEATURE_OWNED_RULES`: it **skips Tier 1** (the installed file) and goes directly to **Tier 2** (canonical source at `src/assets/rules/compliance.md`). This preserves both placeholders in the shadow — if Tier 1 were used, the already-composed file (tokens replaced) would permanently disable per-framework composition whenever the shadow was applied.

### The compliance lens (`_partials/_compliance.mds`, `D-COMPLIANCE-REPO-LENS`)

The lens comes from the settings line (`resolve-settings.cjs`), never from a file check. Its `COMPLIANCE` field is a union (D-LENS-UNION, user ruling D-A): the machine's ids ∪ the default branch's `.devflow/project.json` `compliance` ids ∪ the worktree's. The default branch's copy is read LOCALLY — `git symbolic-ref --quiet refs/remotes/origin/HEAD` names the branch D, then a bounded `git cat-file blob refs/remotes/origin/D:.devflow/project.json` through the strict parser — never over the network (D-SETTINGS-LOCAL-ONLY), so it is as fresh as the last fetch; with no tracking copy the lens is machine ∪ worktree. A branch can therefore ADD a framework and never remove one: a PR that deletes `"compliance":["hipaa"]` is still reviewed under hipaa. `off` only when no layer declares compliance, `generic` when one declares it with no ids (a machine on at zero frameworks, an empty or malformed list), else the ids in registry order. A broken file affects only the keys it owns and never lowers the lens: an unreadable config.json owns no compliance, so the readable project.json's and the default branch's ids stay in; an unreadable project.json reads as a malformed declaration (`generic`) and the machine's and default branch's ids stay in; any tracking-copy state git could not read is `generic` too. `devflow compliance --status` mirrors this fold: `Repository:`, `Default branch:` and `Effective here:` lines (`repoComplianceStatusLines`, `src/core/evidence-policy.ts`). `_compliance.mds` exports three defines:

- `compliance_frameworks()` — `COMPLIANCE_FRAMEWORKS` is that `COMPLIANCE` with `generic` written `none`: `off`, `none`, or the framework ids the machine and this repository declare.
- `compliance_lens()` — the `settings_resolve` block (`_partials/_settings.mds`, alias-imported), then "**Set the compliance lens** from that line: …" (`compliance_frameworks()`). For a host that forwards the lens and gates nothing on it.
- `compliance_gate()` — `compliance_lens()`, then "`COMPLIANCE_ACTIVE` is `true` unless `COMPLIANCE_FRAMEWORKS` is `off`."

Host command usage:

| Command | How it imports | Effect |
|---|---|---|
| `/code-review` | `compliance_gate()` at Step 0b (per worktree) | Adds the `compliance` Review focus when `COMPLIANCE_ACTIVE` AND the diff touches regulated surface; passes `COMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}` in that Review spawn |
| `/plan` | `compliance_gate()` in the gap-analysis phase | Adds the compliance Design agent when `COMPLIANCE_ACTIVE` (4 → 5 agents single-issue, 6 → 7 multi-issue); passes `COMPLIANCE_FRAMEWORKS` in its spawn |
| `/implement` | alias-import, `compliance.compliance_frameworks()` | Passes `COMPLIANCE_FRAMEWORKS` to every Code spawn — the five implementing ones, the validation-, alignment- and QA-fix loops, the CI-fix spawn and `pr-create`; gates nothing |
| `/resolve` | alias-import, `compliance.compliance_frameworks()` (per worktree root) | Passes `COMPLIANCE_FRAMEWORKS` to every Code spawn — issue-fix, validation-fix and the CI-fix spawn; gates nothing |
| `/dynamic-build` | alias-import, `compliance.compliance_lens()` at Pre-authoring step 0b | Authors the value into the workflow script as the shape-gated `COMPLIANCE_FRAMEWORKS` constant (anything but `off`, `none` or a registry-shaped id list is `off`), passed as `complianceFrameworks` and forwarded per ticket in WAVE mode; every engine Code prompt — implement and each fix template — carries it; gates nothing |
| `/release` | none | No compliance gate; release evidence and back-links key on `EVIDENCE_POLICY` |

Every compiled Code spawn carries the lens: install-all retired the skill-presence check a fix-phase Code agent once found it by, so a spawn without it runs with the lens `off`. `tests/compliance-prompts.test.ts` sweeps every Code spawn site in `dist/commands/` (fenced, prose and workflow-template shapes, per-host site floors, a known-bad probe per shape). Consumers: `code.md` invokes the Compliance skill only when `COMPLIANCE_FRAMEWORKS` is not `off` (absent means `off`) AND the task touches regulated surface; `review.md` and `design.md` take `COMPLIANCE_FRAMEWORKS` as the compliance focus's input; `gap-analysis` §7 and the compliance SKILL.md checklist load `references/{id}.md` only for the given ids. /resolve's thread steps key on `EVIDENCE_POLICY` and its merge-readiness phase on `REQUIRE_NON_AUTHOR_APPROVAL`, never on the lens. No compiled command passes an op-level `COMPLIANCE:` key to the Git agent (retired by #362 in favour of the evidence policy's mechanism inputs); `tests/build-mds.test.ts` §14 asserts it, with a known-bad probe.

### Evidence-policy floor vs. review lens

Two independent things sit on `manifest.features.compliance` and must not be conflated:

- **The floor.** `src/assets/scripts/resolve-evidence-policy.cjs`'s `complianceDefault(rawFeatureValue)` mirrors `normalizeComplianceFeature` exactly (a parity test pins this): a well-formed `{enabled: true, frameworks: [...]}` resolves `required` **whatever the framework count** — an enable with zero frameworks selected ("generic controls only") still turns the review lens on, so which frameworks are listed never matters, only that `enabled` is `true`. Any malformed or `enabled: false` shape resolves `standard`. This compliance-derived value only ever **raises** the resolved policy (`stricter(policy, facts.compliance)`) — it can turn a file/worktree `standard` into `required` (flagged with the `raised-by-compliance` warning) but never lowers a `required` file value.
- **The repository floor (D-COMPLIANCE-REPO-FLOOR).** A `compliance` key in `.devflow/project.json` at R (the default branch), T (the tracking branch) or W (the worktree) — any value, an empty list and a malformed one included — makes the repository's compliance default `required`, folded with the machine's as `stricter(C_machine, C_repo)`. HEAD alone never contributes. A project.json that cannot be read counts as declaring it (fail closed). So a repository that declares compliance is held to the same floor as a machine with compliance enabled at zero frameworks. Offline, T is the tracking copy of the branch `git ls-remote --symref origin HEAD` names, else the one the clone's local `refs/remotes/origin/HEAD` names (D-OFFLINE-ORIGIN-HEAD, user ruling D-C); with neither, only W is read.
- **Source precedence (D-POLICY-SOURCE-PRECEDENCE, D-POLICY-JSON-RETIRED).** At every source, `project.json`'s `evidence` is the one authority: a valid value decides the policy, and a present-but-malformed or duplicated `evidence` decides `invalid` (⇒ `required`); a project.json that is not a JSON object is invalid outright. Only where project.json is absent or has no `evidence` key does the SAME source's `.devflow/policy.json` count — by presence alone, never parsed: an existing file (any bytes, `standard` included) makes that source `invalid` (⇒ `required`, `invalid-file`), none makes it absent. Presence reuses each source's existing call (contents GET: exit 0 or overflow present, 404 absent; `cat-file blob`: exit 0 present, answered non-zero absent, unanswered present; worktree: `lstat`, never opened), so the argv sequence is unchanged. `parsePolicyBytes`, `POLICY_GRAMMAR_RE` and `serializePolicy` are deleted, and a TP-46 guard in `tests/evidence-policy/resolver.test.ts` keeps them out of `src/`. The precedence is per source, so each source says one thing and `foldPolicy` folds them unchanged. `compliance --status` prints a `Migration:` hint (from `serializeProjectSuggestion`) while the worktree holds the file.
- **The lens.** The compliance SKILL.md's own `**Lens only.**` note (Scope Boundary section) states the other half of the boundary: the skill's composed sections shape WHAT a compliance review looks for — regulatory-specific gaps (retention, erasure/data-subject rights, audit-trail completeness, segregation of duties, framework mapping, IaC exposure) — never HOW MUCH evidence a change must carry. Tracker links, test plans, approvals and release traces are governed solely by the resolved evidence policy (`resolve-evidence-policy.cjs`, `pr-evidence.cjs`, `verify-evidence.cjs`), never by a compliance finding. A missing ticket, test plan, or approval must never be reported as a compliance finding — that is the evidence policy's gap to report, not the lens's.

## Integration Patterns: Traceability Operations (git.md) — post-split semantics

`src/assets/agents/git.mds` (compiles to `dist/agents/git.md`) is a provider-independent **contract**. Two disjoint mechanics splits load underneath it: **tracker mechanics** (per-provider, `TRACKER_PROVIDER`-gated, generated under `dist/skills/git/references/tracker/{provider}/`) and **PR-host mechanics** (provider-independent, generated under `dist/skills/git/references/pr/`, installed unconditionally under every provider). This section documents what the contract still says and where each kind of mechanics lives — for the split machinery itself (MDS build, byte budget, containment oracle, installer overlay) see `.devflow/features/tracker-references/KNOWLEDGE.md`.

**What stays in `git.md` per operation:** the `## Operation: {name}` heading, prose, `**Input:**`, `**Degradation (D4):**` (where present), `**Output:**` (including any `### Handoff Values` block), and one or both of two fixed mechanics pointers. `**Mechanics:**` (a fixed 56-character line, *"load this operation's provider reference"*) points at tracker mechanics; `**PR mechanics:**` (`load \`references/pr/{op}.md\``) points at PR-host mechanics — the *where* and *when* for both belong to `## Tracker input contract`, so neither pointer restates them. An operation carrying neither pointer states its steps inline in full. `learn-conventions`'s `**Mechanics:**` line is the one long-form exception, since it states a conditional load and the `ALREADY_EXISTS` early return.

**Tracker mechanics (provider-gated, selected by `TRACKER_PROVIDER`):** the GitHub `gh`/GraphQL invocations and `### Process` step bodies for the 10 `TRACKER_GITHUB_OPS`: `setup-task`, `fetch-issue`, `fetch-issues-batch`, `manage-debt`, `create-release` (only its `## Shipped Issues` / commit-list enrichment bullet), `gather-release-evidence`, `backlink-shipped-issues`, `ensure-traceable-issue`, `post-wave-report`, `ensure-pr-ready` (only step 4b's tracker half — resolving the verified issue and rendering its link line). Source: `src/assets/mds/tracker/_github.mds` → `dist/skills/git/references/tracker/github/{op}.md`.

**PR-host mechanics (provider-independent, installed under every provider):** the `### Process` step bodies for the 8 `PR_HOST_OPS`: `ensure-pr-ready` (everything but step 4b's tracker half — branch/commit/push pre-flight, PR creation and D11 scrub, step 4b's PR-host half with the open-PR lookup and the scrub-then-edit, the compliance-gated retitle, base-branch and slug derivation), `validate-branch`, `post-review-summary`, `check-ci-status`, `fetch-review-threads`, `resolve-review-threads` (all steps except step 3, the D9 gate application — see below), `post-resolution-summary`, `check-merge-readiness`. Source: `src/assets/mds/git/_pr.mds` → `dist/skills/git/references/pr/{op}.md`. `pr/` is not a per-provider directory the way `tracker/{provider}/` is — every install carries it, and the agent names each file by a fixed literal, composing nothing from `TRACKER_PROVIDER`.

**Retained controls (written exclusions — never move, regardless of which split is in play):** three sentences stay in an op's `git.md` section rather than in its mechanics file, because a guard that reads `git.md` alone must still see them: both summary ops' sentence naming `references/publication-gate.md` ("the step order in those mechanics instantiates it" — D10); `post-resolution-summary`'s op-local non-reproduction clause (the body those mechanics compose MUST NOT reproduce verbatim `<external-thread>`/`<untrusted-issue-body>` content); `resolve-review-threads`' step 3 (the D9 gate application — the D9 predicate has a single authority and interleaves with the moved steps by number). `## Comment-sink scrub (D11)` itself — heading, shell-discipline `&&` chain, and the `mktemp`-per-invocation rule — stays inline in `git.md` in full and never moved (a containment control must never become loadable). This obligation — that the D10/D11 sinks may only move together with their guards — was discharged by #326 (PR #353): the D10/D11 guards in `tests/git-agent.test.ts` were widened to `'union'` extraction mode over `gitAgentSinkCorpus()` in the same PR that moved the surrounding Process bodies.

`learn-conventions` is a further partial exception, independent of both splits above: its `**Process:**` scan, heuristics, file template, and post-composition verification live in `references/learn-conventions.md` (source: `src/assets/mds/git/_references.mds`), loaded **conditionally** — only when `.devflow/conventions.md` is absent; when the file already exists the operation returns `Status: ALREADY_EXISTS` without reading it.

**The Git agent resolves the provider once per spawn** via the `## Tracker provider resolution` preamble (between the D4 block and `## Comment-sink scrub (D11)` in `git.md`) — it takes `TRACKER` from the `resolve-settings.cjs` settings line (accepting only the script's own line shape, else the fail-closed `github` line — reject, never repair) and selects (never concatenates) a hardcoded mechanics directory. This resolution governs `**Mechanics:**` pointers only; a `**PR mechanics:**` pointer names a fixed literal path under `references/pr/` unconditionally and loads the same file under every provider. See `tracker-references` for the full preamble mechanics; this KB only needs the observable contract: an operation with no `**Mechanics:**` pointer loads nothing tracker-specific. There is no mechanics-unavailable DEGRADED at all: every install carries every provider's mechanics, so only a damaged install could leave one absent (`tracker mechanics unavailable` is a retired literal).

### D1–D11 Decision Marker Legend

The inline legend at the bottom of the `## Operations` table in `git.md` now keeps **only the D4 and D11 rows** — the two whose controls every spawn must already have loaded before it can act:

| Marker | Meaning |
|--------|---------|
| D4 | Degradation contract — every remote-dependent op degrades gracefully with `TRACEABILITY: DEGRADED ({reason})`, never aborting the caller's workflow |
| D11 | Comment-sink scrub — unconditional secret redaction on every body-posting op; fail-closed (`TRACEABILITY: DEGRADED (redaction unavailable)`) on scrubber error or missing script |

D1–D3 and D5–D10 moved to a glossary reference, `references/decision-markers.md` (source: `_references.mds`'s `decision_markers()` define, `kind: 'named'` — not ranged over, named at exactly one site). Full table (read there for detail; summarized here so this KB stays self-contained for semantics lookups):

| Marker | Operation | Meaning |
|--------|-----------|---------|
| D1 | `learn-conventions` | Bounded scan → writes `.devflow/conventions.md` once |
| D2 | `fetch-review-threads`, `resolve-review-threads` | GraphQL thread fetch and reply/resolve cycle |
| D3 | `ensure-traceable-issue` | Three-section issue template (see below) |
| D5 | `ensure-traceable-issue` | Issue creation/enrichment, returns issue number |
| D6 | `check-merge-readiness` | Report-only — never takes action |
| D7 | `post-review-summary` | Dedup: one comment per cycle+timestamp pair, marker-keyed, never edited after posting |
| D8 | `post-resolution-summary` | Dedup: one comment per workflow run, marker-keyed (`ts:`-prefixed), never edited after posting |
| D9 | `resolve-review-threads` | Thread-resolution gate (table below) |
| D10 | `post-review-summary`, `post-resolution-summary` | Publication gate — probe visibility before posting; fail-closed to STUB |

**D4 degradation contract** — the always-loaded block keeps the provider-neutral **invariants**; GitHub's concrete **detectors** live in one place, `tracker/github/backlink-shipped-issues.md`'s `### Provider signals (GitHub)` section (it "owns the fan-out", per that file's own comment — the backpressure rung is stated there and restated only in the agent's inline `resolve-review-threads` clause, since D4 names those two as the batch ops):

| Condition (invariant, in `git.md`) | GitHub detector (in `tracker/github/backlink-shipped-issues.md`) | Action |
|---|---|---|
| No remote / tracker unauthenticated or unreachable / no PR | `gh` absent or unauthenticated, or no remote | Emit `TRACEABILITY: DEGRADED ({reason})`, warn, continue — never abort |
| Provider-signalled secondary rate limit | 403/429 with a rate-limit body, or `X-RateLimit-Remaining` < 10 | **STOP** the current fan-out immediately; report remaining items as `THROTTLED ({n} not processed)`; emit `TRACEABILITY: DEGRADED (rate limited)` |
| Provider backpressure rung (batch ops only) | `X-RateLimit-Remaining` < 50 | Raise inter-operation delay from 1s to **3s** for the remainder of the batch |
| Other 4xx (deleted issue, closed PR, permissions) | — (provider-neutral) | DEGRADED for that item, continue |
| 5xx | — (provider-neutral) | 1 retry; if still 5xx → DEGRADED for that item, continue |

**D4 carve-out for create-release:** The global "never abort" clause does NOT apply to the primary release effects (tag push, release create) — steps 1–6 of `create-release` stay inline in `git.md` and are hard failures. Only traceability adornments (`COMMIT_LIST`/`SHIPPED_ISSUES` enrichment, `backlink-shipped-issues`) degrade per D4.

**D11 comment-sink scrub — split, but the control itself never moved.** `## Comment-sink scrub (D11)` stays inline in `git.md` in full, including the scrubber invocation (`node …redact-secrets.cjs …`) — the containment control itself must never become loadable/optional. Only each op's concrete `&& <post command>` half relocated: for the 10 `TRACKER_GITHUB_OPS`, into `tracker/github/{op}.md` (e.g. `backlink-shipped-issues.md`'s "Scrub-then-post chain" section: `&& gh issue comment {number} --body-file "$DEVFLOW_BODY"`); for the `PR_HOST_OPS` that post a body (`post-review-summary`, `post-resolution-summary`, `resolve-review-threads`, `ensure-pr-ready` step 4a and step 4b's PR-host half), into `pr/{op}.md`'s own Process steps. The rule is unchanged wherever it lands: `&&` only, never a pipeline (a pipeline's exit status swallows a scrubber crash); non-zero scrubber exit or missing script → DO NOT POST, emit `TRACEABILITY: DEGRADED (redaction unavailable)`; always post the scrubbed `$DEVFLOW_BODY`, never `$DEVFLOW_BODY_RAW`. The D11 block also states a `$DEVFLOW_NOTES_RAW`/`$DEVFLOW_NOTES` producer — "Create `DEVFLOW_NOTES_RAW`/`DEVFLOW_NOTES` the same way" — under the same never-a-fixed-path `mktemp`-per-invocation rule as the body pair (B31/security-04), so notes-file sinks (release notes, PR review notes) carry the identical containment guarantee as body sinks. `ensure-pr-ready`'s two PR-body sinks — step 4a's create and step 4b's PR-host half (`gh pr edit --body-file`) — both sit in `pr/ensure-pr-ready.md` beside the calls they gate; the provider reference's step 4b only resolves the issue and renders the link line, then publishes through that half, and `## Comment-sink scrub (D11)` governs both from the agent.

**D3 issue template.** The three sections (`## Initial Request`, `## Product Requirements`, `## Implementation Plan`) are still named at the D3 legend row, but the template body itself now lives in `tracker/github/ensure-traceable-issue.md` under `### Traceability Issue Template (D3)` (demoted from `##` to `###` on the move — a `##` heading is a section terminator inside a generated reference; see `tracker-references`' grammar-boundary gotcha).

**D9 resolution gate — single authority (the gate table is stated once, inline in `git.md`; `resolve-review-threads`' Process moved to `references/pr/resolve-review-threads.md` except step 3, the gate application itself, which stays inline and interleaves with the moved steps by number):**

| Condition | Required value | Action |
|-----------|----------------|--------|
| `VERIFICATION_STATUS` | `PASS` | prerequisite; if not met → reply-only for all verdicts |
| Verdict `FIXED` | `commit_sha` non-empty | resolve via `resolveReviewThread` mutation + attribution reply |
| Verdict `FALSE_POSITIVE` | `evidence` non-empty | **reply-only** with cited evidence; leave unresolved — thread author closes |
| Verdict `BY_DESIGN` | `evidence` non-empty | **reply-only** with cited evidence; leave unresolved — thread author closes |
| Verdict `ESCALATED` | — | reply-only; leave unresolved |
| `VERIFICATION_STATUS` `FAILED` or `SKIPPED` | — | reply-only for all verdicts; leave unresolved |

`resolveReviewThread` is called ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty. FALSE_POSITIVE and BY_DESIGN are the thread author's call to close.

**D10 publication gate.** Applies to `post-review-summary` and `post-resolution-summary` only — no other op probes repo visibility. The 7-step order (dedup check → resolve `REVIEW_PUBLICATION` → probe visibility fail-closed to STUB → compose body → scrub per D11 → re-check 60000-char cap after scrub → post, 5xx retry-once) lives once in `references/publication-gate.md` (`_references.mds`'s `publication_gate()` define). Each op's own concrete 7-step composition now lives in its PR-host mechanics file (`references/pr/post-review-summary.md`, `references/pr/post-resolution-summary.md`); the sentence naming the gate ("The publication gate this operation applies is the `devflow:git` skill's `references/publication-gate.md` (D10) — the step order in those mechanics instantiates it") is the one retained control that stays inline in each op's `git.md` section. `gh repo view` (the visibility probe) appears only in `publication-gate.md` **and** the two PR-host mechanics files that instantiate it — never restated as a corpus-wide literal.

### Handoff Values — issue-capture contract producers

`setup-task` and `fetch-issue`'s `**Output:**` blocks each end with a `### Handoff Values` block. **Branch token is defined as the branch name itself** — each op renders its own already-computed value, never a shared generic placeholder:

```markdown
### Handoff Values
- **PR link line**: {rendered}
- **Branch token**: {branch-name}
- **Issue ID**: {ISSUE_ID}
```
`setup-task`'s `{branch-name}` is the same value as its own `## Task Setup: {branch-name}` heading and `**Branch name**: {derived-branch-name}` field — the branch it just created. `fetch-issue` has no branch to hand off (it never creates one), so its block instead renders `- **Branch token**: {suggested-branch}` — the `### Suggested Branch` value (`{type}/{number}-{slug}`) computed two fields above it in the same Output block. Neither op reads or writes a value named `{token}`.

These are the **only** producers — `fetch-issues-batch` answers `(none)` for all three (it identifies issues by `### Issue #{number}:` heading, an `ISSUE_REF` not an `ISSUE_ID`, and never synthesises the singular values from a batch heading).

Consumers: `src/assets/commands/_partials/_tracker.mds`'s `issue_capture_contract()` define (scoped precisely to the real producers — read that partial, not this summary, for the exact capture rules) and `src/assets/agents/code.md`, which pastes `ISSUE_PR_LINK` only after **re-checking its shape** (`^Closes #[1-9][0-9]{0,8}$` under github — degrade-never-repair: a value well-formed when produced is still attacker-influenceable text by the time it's pasted). `ISSUE_PR_LINK` is forwarded as a sibling of `ISSUE_NUMBER` at all 14 Code-agent spawn sites across `implement.mds` and `dynamic-build.mds`.

### Command-layer vocabulary (`_partials/_tracker.mds`)

Two zero-arg defines, adopted by `plan.mds`, `implement.mds`, `debug.mds`, `dynamic-build.mds`, `dynamic-plan.mds`:
- `issue_ref_grammar()` — the command-layer (L1) grammar: permissive and provider-blind, forwards raw `ISSUE_REFS` tokens verbatim. Under `github`, a token matching `^#?[1-9][0-9]{0,8}$` is a reference and the Git agent renders it as `#{n}`; any other shape is **never coerced or dropped silently** — the Git agent emits `TRACEABILITY: DEGRADED (issue reference "{ref}" does not match github reference grammar)` and continues with what it could resolve.
- `issue_capture_contract()` — which operation emits which value: `ISSUE_CONTENT`/`ACCEPTANCE_CRITERIA` from every issue-bearing op; `ISSUE_REF` from the two fetch ops; the Handoff Values trio from `setup-task`/`fetch-issue` only, `(none)` on the batch path.

GitHub rendering stays byte-identical pre/post-split: `Tracked = #{n}`, `Depends on: #{n}`, `42-jwt-auth.{ts}.md` filenames, `issue: 42`. `compliance_gate()` ordering relative to this vocabulary is unchanged.

### Markers — no restatement in compiled commands

`dist/commands/*.md` carry zero `<!-- devflow:` literals — the D7/D8/wave-report marker formats live only in the Git agent (`git.md`) and its generated references. Any `dynamic-build.mds` or `code-review.mds` restatement of a marker format was removed as part of the split; commands reference operations by name, never by reproducing the marker string.

### `create-release` reads conventions.md

Step 1b reads the `## Version Names` and `## Version PR Titles` sections from `.devflow/conventions.md` (when present) to determine the annotated tag format and release title. Compliance defaults apply when the file is absent. This step stays inline in `git.md` (only the `## Shipped Issues` enrichment bullet moved to the generated reference).

Step 5 composes the release notes body: `CHANGELOG_CONTENT` first, then an optional `## Commits` section (first ≤100 entries), then `TRACEABILITY_EXCEPTIONS` verbatim last (the cap below never drops it). The 60000-char cap degrades in two stages, in order: drop the `## Commits` section first, noting `Commit list omitted (release notes size limit)`; if still over, cut only `CHANGELOG_CONTENT` itself **at a line boundary**, ending `…truncated` — never a mid-line cut, which could split a markdown fence or table row and corrupt the rendered release. Step 6 re-applies step 5's cap a second time, after the D11 scrub — a scrub substitution can push a body that was exactly at the cap back over it — so the size check is written at step 6 itself, beside the scrub call, not left implicit in step 5's text.

### Release evidence: `release-trace.cjs` (full-message scan, revert exemption scoped to the body)

`gather-release-evidence`'s shared `_common.mds` steps — `last_release_tag_step` (step 1a) and `trace_map_step` (step 6), both loaded by every provider's generated reference — shell out to `src/assets/scripts/release-trace.cjs`: `last-tag` for the last RELEASE tag (`LAST_TAG {tag}` / `LAST_TAG none`), and `map --from {last_tag} {grammar-args}` for the per-commit trace map. Only `exit=0` with the pinned `TRACE from:<ref> scanned:<n> traced:<n> untraced:<n> exempt:<n> unmatched:<n> bound:<ok|hit>` header is accepted; anything else is `TRACEABILITY: DEGRADED (trace map unavailable)` and status `INDETERMINATE`. `create-release`'s own step 1a (`last_release_tag_step`) shells out to the same `last-tag` subcommand rather than `git describe`, which can return a non-release marker tag.

**D-TRACE-FULL-MESSAGE:** `release-trace.cjs`'s reference search (`findReference`) reads `%B` — the whole raw commit message — never `%s` + `%b`. Git folds a wrapped subject paragraph onto one `%s` line, so a keyword ending the subject's first line and a reference opening its second would read as one line under `%s`+`%b` and as two lines under a `%B` scan; a commit whose reference only a `%B` scan can see must be traced the same way by both this script and the mechanics step that gathers `COMMIT_LIST`, so both read `%B`. `MESSAGE_LOG_FLAGS` carries `--format=%H%x00%an%x00%ae%x00%s%x00%B%x1e` (`%s` is kept alongside `%B` only for the exempt rules, which match the subject as git renders it); `tests/evidence/release-trace-parity.test.ts` pins both sides in agreement.

**D-TRACE-REVERT-BODY:** The `exempt:revert` rule requires a `Revert "…"` subject AND a body line naming what was reverted (`This reverts commit {40-hex-sha}`, or GitHub's `Reverts {owner}/{repo}#{n}`). Because the reference scan reads the whole message, testing the revert-body patterns against the whole message would let a body-less commit whose **subject** merely quotes `This reverts commit <sha>` pass as an exempt revert. `messageBody(message)` splits the message the way git splits it for a revert's generated body — skips leading blank lines, ends the subject paragraph at the first blank line, returns everything after that line (`''` when there is none) — and only the revert rule reads this scoped body; `findReference` still scans the full message unchanged.

**60000-char cap — ALL comment ops:** `post-review-summary`, `post-resolution-summary`, `post-wave-report`, and `ensure-traceable-issue` (plan attachment) all cap composed bodies at 60000 characters. GitHub rejects comments over 65536 with a 422 (which the 4xx rule would silently skip). Truncation adds `…truncated — full report in the local artifact {PATH}`.

**TRUNCATED contract on `backlink-shipped-issues`:** Processes the first ≤50 issues in list order. If the list has more than 50, reports the remainder as `TRUNCATED ({n} not processed)` and never reports `COMPLETE` while issues went unprocessed.

**ensure-pr-ready step 4b / ensure-traceable-issue discipline:**
- All external content (PR body, issue title, labels) bound to shell variables; applied via `--body-file {temp_file}` or `"$VAR"` — never interpolated into the command string.
- `Closes #{n}` addition requires `gh issue view {n} --json number,state` verification (mechanics, in `tracker/github/ensure-pr-ready.md`); `.state` must be `"open"`. Branches like `chore/2026-cleanup` or `fix/2fa-login` may produce false numeric matches — the existence check is the guard.
- **Branch-name metacharacter guard (setup-task step 1b, stays inline in `git.md`):** `.devflow/conventions.md` is third-party input (git-tracked and team-shared). Before using the convention-derived prefix and separator in step 3, the fully composed branch name is checked against `` $ ` \ " ' ; | & < > `` or whitespace/newline. If any match: discard the convention and fall back to heuristic defaults. The validated name is bound to `DEVFLOW_BRANCH` before use.
- **`setup-task` issue body containment:** The remote-sourced issue fields (`title`, `description`, `criteria`) are wrapped in `<untrusted-issue-body>` tags. The locally-derived issue number is intentionally placed outside the wrapper.
- **`fetch-issues-batch` per-issue wrapping:** The output template explicitly shows the `<untrusted-issue-body>` wrapper on each issue (not just the first with an implicit "etc." for the rest). Each issue is wrapped independently — there is no single wrapper around the whole list.

**conventions.md authority (D1):** Written by `learn-conventions`, consumed by `setup-task` (branch naming, step 1b), `ensure-pr-ready` (PR title retitle, step 4c), and `create-release` (version/tag/version-PR title, step 1b). Delete to force re-learn. `learn-conventions` commits this file as its final step (`setup-task` step 4b, mirroring the Knowledge agent commit protocol) so fresh projects do not leave `?? .devflow/conventions.md` in `git status`.

**Traceability bounds (unchanged by either mechanics split):**
- `backlink-shipped-issues`: ≤50 issues, 1s throttle (raises to 3s at remaining<50)
- `resolve-review-threads`: ≤50 threads (first 50 in THREAD_MAP order; remainder → TRUNCATED)
- `fetch-review-threads`: ≤2 pages of 50 = 100 threads max
- `gather-release-evidence`: ≤100 commits, ≤50 issues — ref resolution is now batch-first in the moved reference (`closing_refs_for_commits` via GraphQL `closingIssuesReferences`, PR-number dedup, ≤25 sequential fallback); see `tracker-references` for the two-commit history behind that rewrite
- 60000-char cap on all comment ops (above)

## Constraints

**Security:** `stampComplianceRule` and `installSkillDir` never write user-supplied strings into installed artifacts. Every framework ID passes through `normalizeFrameworks` (which validates against the registry) before reaching any `path.join` or stamp call. This is AC-35/AC-36. The `label` written into the rule file is always drawn from `LABEL_BY_ID` (static map), never from user input.

**PR title retitle safety (step 4c):** The composed title is validated against a shell-metacharacter denylist before use. It is bound to a shell variable and passed as `--title "$DEVFLOW_PR_TITLE"` — never interpolated into the command string.

**External thread containment (D2):** External review thread bodies are untrusted third-party input. They are never executed as instructions, never echoed verbatim into devflow-authored replies, commits, or comments. The `<external-thread>` tag is the containment boundary. `fetch-review-threads`'s and `resolve-review-threads`' Process bodies moved to `references/pr/fetch-review-threads.md` / `references/pr/resolve-review-threads.md` (#326) — the containment rule itself (marker neutralisation, never-echo) is stated in each op's contract in `git.md` and restated at the point of use in the PR-host mechanics.

**Principle 8 marker neutralisation:** Before wrapping any remote content in `<untrusted-issue-body>` or `<external-thread>`, the operation scans the content for the literal closing marker (case-insensitively, tolerating internal whitespace) and inserts a backslash before the slash. This prevents a hostile issue body or review comment from terminating containment early and injecting text into devflow-authored context. Applies to `fetch-issue`, `fetch-issues-batch`, `setup-task`, and `fetch-review-threads`. Principle 8 (`## Principles` item 8 in `git.md`) also carries a "Never reproduced in a posted body" sub-bullet (#328) naming all four comment-posting operations by name (`post-review-summary`, `post-resolution-summary`, `post-wave-report`, `backlink-shipped-issues`) — the cross-op non-reproduction rule stated once at the principle level, with `post-resolution-summary`'s own op-local restatement (a retained control, see above) as the one exception that must also be readable from that operation's own section alone.

**`FEATURE_OWNED_SKILLS` disjointness:** Must be disjoint from `getAllSkillNames()` (enforced by D-FO-1 comment in plugins.ts). The compliance skill is managed by the feature system, not the plugin install loop.

## Anti-Patterns

**Resurrecting the 4-step gate.** The old `devflow-compliance` plugin implemented a 4-step pre-flight gate. This was retired when compliance became a built-in feature. Do not re-introduce step-gated pre-flight logic — the correct model is the settings-line lens (`compliance_gate()` / `compliance_frameworks()` from the shared partial), resolved once per command (per worktree) and passed as `COMPLIANCE_FRAMEWORKS` to the agents that apply it.

**Using COMPLIANCE_ENABLED or COMPLIANCE_SKILL_INSTALLED.** Both are retired and must not appear in any compiled command; `tests/build-mds.test.ts` §14 (and, for /release, `tests/tracker/compliance-gate.test.ts`) assert their absence. The current variables are `COMPLIANCE_FRAMEWORKS` and `COMPLIANCE_ACTIVE`, set from the settings line by `_compliance.mds`.

**Gating the lens on a file's presence.** Every machine carries the compliance skill and all six framework references (`D-COMPLIANCE-INSTALL-ALWAYS`), so `~/.claude/skills/devflow:compliance/SKILL.md` existing says nothing, and a `references/{id}.md` existing says nothing about whether that framework is in force. Gate on `COMPLIANCE_ACTIVE`; load references for the ids in `COMPLIANCE_FRAMEWORKS` and no other.

**Passing an op-level `COMPLIANCE:` key to any spawn.** Retired by #362: the Git agent's traceability ops take the evidence policy's mechanism inputs (`ISSUE_REQUIRED`, `APPLY_CONVENTIONS`, `REQUIRE_NON_AUTHOR_APPROVAL`) instead. The build-mds §14 collector reports any `COMPLIANCE:` spawn line in a compiled command (with a known-bad probe of the retired shapes).

**Echoing external thread body content.** Reply bodies in `resolve-review-threads` must cite only internal evidence (commit SHAs, file:line from the codebase) — never verbatim content from `<external-thread>` blocks.

**Short-circuiting converge with ||.** `installSkillDir` and the rule step in `convergeComplianceArtifacts` must execute independently. Using `&&` or `||` would let the first operation's result skip the second.

**Overwriting conventions.md.** `learn-conventions` checks for file existence first and returns `ALREADY_EXISTS` if present. Never add logic that rewrites it conditionally — delete to force re-learn.

**Seeding FEATURE_OWNED_RULES shadow from the installed file.** The installed compliance rule is already stamped (placeholder replaced). Seeding a shadow from it permanently disables framework stamping. `seedRuleShadow` always uses Tier 2 (canonical source) for `FEATURE_OWNED_RULES`.

**Seeding a FEATURE_OWNED skill shadow from the installed copy.** The same trap for SKILL.md: `shadowSeedDir` returns the shipped source for `FEATURE_OWNED_SKILLS`; seeding `skills shadow compliance` from `~/.claude/skills/devflow:compliance/` would freeze the stamp and make `compliance --set` a no-op on a shadowed skill. Pinned by TP-44 (`tests/skills.test.ts`, `tests/compliance-install.test.ts`, with a known-bad probe).

**Hand-assembling converge options at each call site.** `convergeFromManifest` is the single manifest→options site. Callers that bypass it risk assembling the options struct inconsistently (e.g., forgetting `rulesEnabledOverride`).

**Wrapping an entire issue list in a single containment tag.** The correct model is per-issue wrapping — each issue body gets its own `<untrusted-issue-body>...</untrusted-issue-body>` pair. A single outer wrapper around the whole list would allow the attacker's first issue to close the outer tag and escape containment for all subsequent issues.

**Moving a containment or publication control's retained sentence out of `git.md`.** `## Comment-sink scrub (D11)`, the D10 gate-naming sentence, the D9 gate-application step, and the cross-op non-reproduction clause are written exclusions — they stay inline in `git.md` even though the surrounding Process bodies for `post-review-summary`, `post-resolution-summary`, `resolve-review-threads`, and the other `PR_HOST_OPS` moved to `references/pr/{op}.md` in #326 (PR #353). That move was safe only because the D10/D11 guards in `tests/git-agent.test.ts` were widened to `'union'` extraction mode over `gitAgentSinkCorpus()` in the same PR and held non-vacuous against `sinkCorpusWithoutPrHost()`. If you relocate a retained sentence, or move a Process body without checking whether its guard's extraction mode needs to change, that is the signal to stop and re-read `tracker-references`' Anti-Patterns instead.

## Gotchas

**normalizeFrameworks silently drops unknowns; parseFrameworkList errors loudly.** Use `normalizeFrameworks` for manifest-sourced IDs (tolerant, self-heals); use `parseFrameworkList` for user CLI input (strict, errors on unknowns).

**Disable keeps frameworks in manifest.** `enabled: false` does not clear `frameworks: [...]`. Re-enabling restores the prior selection. If you add a flow that resets frameworks on disable, you break the restore behaviour verified by e2e S4/S5.

**Shadow overrides SKILL.md only; refs and fragments always canonical.** A skill shadow replaces SKILL.md in the installed directory, but reference files (`references/*.md`) are always sourced from the canonical `frameworks/{id}/reference.md` — and fragments (`frameworks/{id}/fragment.md`) are always loaded from canonical source even when the shadow provides SKILL.md. There is no user-overridable path for framework reference or fragment files.

**Token-free skill shadow suppresses composition.** If a skill shadow's SKILL.md has no `${DEVFLOW_COMPLIANCE_` tokens, `composeComplianceSkill` returns it byte-identical (C1 passthrough). The installed SKILL.md will have no per-framework sections (mapping, active list, checklist, references). `devflow compliance --status` flags this with `[shadowed, composition skipped]`.

**Step 0b resolves the lens per worktree in code-review.** `compliance_gate()` runs at Step 0b and each worktree keeps its own `COMPLIANCE_ACTIVE` / `COMPLIANCE_FRAMEWORKS` for every downstream phase — the settings line reads that worktree's project.json, so two worktrees can resolve different lenses — each still carrying the default branch's frameworks.

**VERIFICATION_STATUS == SKIPPED is treated like FAILED for thread resolution.** SKIPPED means the Validate gate did not run (zero fixes applied). In `resolve-review-threads`, SKIPPED → reply-only, no `resolveReviewThread` mutation.

**D4 does NOT apply to primary create-release effects.** Tag push and GitHub release create are hard failures — they stop the release. Only traceability adornments degrade per D4.

**D7 dedup is a full cycle+timestamp pair.** Checking only the cycle number (not the timestamp) would suppress a legitimate re-review comment posted in the same cycle from a different review run. Both tokens must appear in the marker search.

**D8 marker is ts:-prefixed.** The resolution-summary dedup marker is `<!-- devflow:resolution-summary ts:`. Using any other prefix breaks idempotency for existing comments.

**60000-char cap is on ALL comment ops.** GitHub's 65536-char limit applies uniformly. The cap is not just on summary comments — it applies to `post-review-summary`, `post-resolution-summary`, `post-wave-report`, and plan-attachment comments from `ensure-traceable-issue`. Tests in `git-agent.test.ts` pin each individually.

**EXCLUDED-as-oracle trap in tests.** Tests that assert `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES` exclusions use independent literal `['compliance']` — they do not import the constant. Importing the constant would make the test verify the constant against itself.

**Principle 8 neutralisation must run before the wrapper is applied.** Scanning for the closing marker after wrapping is too late — the wrapped content already contains the literal tag. Scan the raw remote content first, escape any closing marker occurrence, then wrap.

**A D4/D11 sentence that "reads GitHub-specific" may actually be the invariant, not the detector.** When editing the always-loaded block in `git.md`, check whether the sentence names a concrete provider signal (status code, header name, `gh` invocation — belongs in `tracker/github/backlink-shipped-issues.md`) or a provider-neutral rule (STOP-on-secondary-rate-limit, THROTTLED reporting, never-COMPLETE-while-unprocessed — belongs inline). Getting this wrong re-creates the GAP-03 defect (two authorities on one path) that Tracker Phase 2 fixed.

**Handoff Values' Branch token has no shared name — it IS the branch name.** `setup-task` renders `{branch-name}` (identical to its own header and `**Branch name**` fields); `fetch-issue` renders `{suggested-branch}` (its own `### Suggested Branch` value). There is no third, generic `{token}` placeholder anywhere in either block — do not reintroduce one.

**`release-trace.cjs`'s revert exemption reads the commit BODY, not the full `%B` message.** The reference scan (`findReference`) intentionally reads the whole message, but `classify()`'s revert rule tests `messageBody(commit.message)` only. A commit whose subject merely quotes `This reverts commit <sha>` without an actual git- or GitHub-generated body sentence is `untraced`, not `exempt:revert` — this is by design (`D-TRACE-REVERT-BODY`), not a gap.

**A compliance-enabled repo with zero frameworks selected still floors the evidence policy at `required`.** `resolve-evidence-policy.cjs`'s `complianceDefault()` only checks `enabled: true` — an empty `frameworks: []` array does not fall back to `standard`. Do not "optimize" this to skip the floor when no framework is selected; the review lens is already on (generic controls) at that state.

**The compliance lens and the language-focus gate are different shapes, deliberately.** `/code-review`'s eight language focuses stay presence-gated on `{claude_dir}/skills/devflow:{focus}/SKILL.md`, `{claude_dir}` being Claude Code's directory as the installer resolves it — `CLAUDE_CONFIG_DIR` when absolute, else `$HOME/.claude` (D-CLAUDE-DIR-PROMPTS, held by `tests/guards/claude-dir.test.ts`) — because those skills install only with their optional plugin. The compliance lens is never presence-gated: every machine has its skill, so presence would say nothing. The language-focus check reads the machine install, never anything per repository.

**Release notes truncation order matters.** The 60000-char cap on `create-release`'s composed body drops `## Commits` before it ever touches `CHANGELOG_CONTENT`, and when `CHANGELOG_CONTENT` itself must be cut, the cut lands on a line boundary — never mid-line. The cap is also re-applied at step 6 (post-scrub), so a body sized exactly at the cap pre-scrub can still be trimmed again after redaction.

## Key Files

| File | Purpose |
|---|---|
| `src/core/compliance.ts` | Framework registry, `ComplianceFeatureState`, `ALWAYS_PRESENT_REFS`, tolerant/strict parsers, self-heal normalizer, rule stamper |
| `src/core/compliance-compose.ts` | Pure composition: `parseComplianceFragment`, `composeComplianceSkill`, `composeComplianceRule`; `buildActiveSection` (the machine stamp + `RUNTIME_SELECTION_LINES`); `COMPLIANCE_SKILL_TOKENS`, `COMPLIANCE_RULE_TOKENS`, `COMPLIANCE_CONTROL_COLUMNS` |
| `src/assets/skills/compliance/frameworks/{id}/fragment.md` | Per-framework composition inputs (6 files): Mapping, Reference, Checklist, Rule sections |
| `src/assets/skills/compliance/frameworks/{id}/reference.md` | Per-framework reference content (source location; installed as `references/{id}.md`) |
| `src/targets/claude-code/compliance-install.ts` | `convergeComplianceArtifacts` (`D-COMPLIANCE-INSTALL-ALWAYS`: skill + every reference always, rule only when enabled && rulesEnabled; returns `{removedPreexisting, converged}`), `convergeFromManifest` wrapper, claudeDir guard, `loadComplianceFragments` |
| `src/cli/commands/compliance.ts` | CLI: `resolveComplianceCliAction` (pure), Commander command, `--status` (with `unknownFrameworkIds`; no reference-file drift), `skillShadowState`; imports shared choices/message from `compliance-prompts.ts` |
| `src/cli/commands/skills.ts` | `shadowSeedDir` (`D-COMPLIANCE-SHADOW-SOURCE`: FEATURE_OWNED skills seed from source), the `the compliance feature (every install)` provenance |
| `src/cli/commands/compliance-prompts.ts` | Shared wizard helpers: `shouldRunComplianceStep`, `runComplianceStep`, `CompliancePromptIO`, `buildClackCompliancePrompts`, `frameworkChoices`, `FRAMEWORK_SELECT_MESSAGE`, `formatComplianceSummary` |
| `src/core/plugins.ts` | `FEATURE_OWNED_SKILLS`, `FEATURE_OWNED_RULES`, `DELETED_PLUGIN_NAMES`, `resolveFeatureRedirect` |
| `src/cli/commands/rules.ts` | `seedRuleShadow` (Tier 1 skipped for FEATURE_OWNED_RULES; Tier 2 = canonical source preserves placeholder) |
| `src/assets/commands/_partials/_compliance.mds` | `compliance_frameworks()` (`COMPLIANCE_FRAMEWORKS` from the settings line's `COMPLIANCE`, `generic` → `none`), `compliance_lens()` (settings resolve + the lens) and `compliance_gate()` (the lens + `COMPLIANCE_ACTIVE`) — `D-COMPLIANCE-REPO-LENS` |
| `src/assets/agents/code.md`, `review.md`, `design.md` · `src/assets/skills/gap-analysis/SKILL.md` §7 · `src/assets/skills/compliance/SKILL.md` checklist | The lens's consumers: `COMPLIANCE_FRAMEWORKS` input; load `references/{id}.md` only for the given ids |
| `src/assets/agents/git.mds` (compiles to `dist/agents/git.md`) | The traceability **contract**: D4/D11 legend, D4 invariants, D9 gate, D3 legend row, per-op `**Input:**`/`**Output:**`/`**Mechanics:**`/`**PR mechanics:**` pointers, Tracker provider resolution + input contract preamble |
| `src/assets/mds/tracker/_github.mds` | The GitHub **mechanics** for the 10 `TRACKER_GITHUB_OPS` — `### Process` bodies, `### Provider signals (GitHub)` (D4 detectors, D11 scrub-then-post chain), `### Traceability Issue Template (D3)` |
| `src/assets/mds/git/_pr.mds` (compiles to `dist/skills/git/references/pr/{op}.md`) | The provider-independent **PR-host mechanics** for the 8 `PR_HOST_OPS` (`ensure-pr-ready`, `validate-branch`, `post-review-summary`, `check-ci-status`, `fetch-review-threads`, `resolve-review-threads`, `post-resolution-summary`, `check-merge-readiness`) — installed under every provider; added by #326 / PR #353 |
| `src/assets/mds/git/_references.mds` | The 3 cross-cutting glossary/gate documents — `decision-markers.md` (D1–D10 full table), `learn-conventions.md` (D1 scan/heuristics/template), `publication-gate.md` (D10 7-step order) |
| `src/assets/commands/_partials/_tracker.mds` | `issue_ref_grammar()`, `issue_capture_contract()` — command-layer issue-reference vocabulary |
| `src/assets/commands/code-review.mds` | Step 0b (imports `compliance_gate`, per worktree), Phase 1 regulated-surface gate on `COMPLIANCE_ACTIVE`, `COMPLIANCE_FRAMEWORKS` in the compliance Review spawn |
| `src/assets/commands/resolve.mds` | Phase 1b (fetch-review-threads) and 9b (resolve-review-threads) on `EVIDENCE_POLICY` `required`, Phase 9c (check-merge-readiness) on `REQUIRE_NON_AUTHOR_APPROVAL`; `COMPLIANCE_FRAMEWORKS` to every Code spawn |
| `src/assets/commands/plan.mds` | `compliance_gate()` for the compliance Design agent (`COMPLIANCE_ACTIVE`, `COMPLIANCE_FRAMEWORKS` in its spawn); issue linking is mandatory only under `EVIDENCE_POLICY` `required` |
| `src/assets/commands/implement.mds` | alias-imports `_compliance.mds`; `COMPLIANCE_FRAMEWORKS` to every Code spawn, fix-phase and `pr-create` included (no gate) |
| `src/assets/commands/dynamic-build.mds` | alias-imports `_compliance.mds`; `compliance_lens()` at Pre-authoring step 0b, the shape-gated `COMPLIANCE_FRAMEWORKS` constant, `COMPLIANCE_FRAMEWORKS` in every engine Code prompt (no gate) |
| `src/assets/commands/release.mds` | Phase 1c (the evidence policy), gather-release-evidence and backlink-shipped-issues on `EVIDENCE_POLICY` — no compliance gate |
| `src/assets/skills/git/SKILL.md` | Extended References table row for `references/tracker/{provider}/{op}.md`; naming-conventions authority pointer to `learn-conventions` |
| `tests/git-agent.test.ts` | Static guards: required ops list, 60000-char caps, D9 gate, D4 backpressure, D7/D8 dedup markers, AC-0.10 containment (split into issue-body and external-thread guards); reads the joined corpus via `gitAgentSinkCorpus()` for guards whose literal moved, and via `sinkCorpusWithoutPrHost()`/`gitPlusPrHostCorpus()` for PR-host-specific non-vacuity and detection guards (#326) |
| `tests/compliance-install.test.ts` · `tests/skills.test.ts` | TP-44: the skill and all six references install on every convergence, the rule only when enabled; a shadow seeded from source is re-stamped by `--set` (known-bad probe: a shadow seeded from the installed copy) |
| `tests/compliance-prompts.test.ts` · `tests/compliance-e2e.test.ts` (S23) | TP-43: the lens from the settings line; a hipaa repository on a compliance-off machine resolves `COMPLIANCE=hipaa` and never installs or changes the machine rule |
| `tests/scoped-install-e2e.test.ts` · `tests/evidence-policy/disposition.test.ts` | TP-38's `EVERY_INSTALL_CARRIES` includes the compliance skill and its references; the disposition gate names `COMPLIANCE_ACTIVE` as the lens input |
| `tests/registry-integrity.test.ts` | Guard 6: OPERATION: values in compiled commands ↔ `## Operation:` headings in git.md (spawn↔op integrity) |
| `src/assets/scripts/release-trace.cjs` | Pure git-history classifier backing `gather-release-evidence`'s trace map and `create-release`'s `LAST_TAG` lookup — `classify`, `messageBody` (D-TRACE-REVERT-BODY), `findReference` (D-TRACE-FULL-MESSAGE), `MESSAGE_LOG_FLAGS` |
| `src/assets/scripts/resolve-evidence-policy.cjs` | `complianceDefault()` — the compliance-enabled-at-any-framework-count `required` floor, mirroring `normalizeComplianceFeature`; `projectReading()`/`withRetiredPolicy()` — the repository floor from a project.json `compliance` key at R/T/W (D-COMPLIANCE-REPO-FLOOR) and project.json-first precedence with the retired policy.json counted by presence only (D-POLICY-SOURCE-PRECEDENCE, D-POLICY-JSON-RETIRED) |

## Related

- Unconditional convergence: `convergeComplianceArtifacts` applies this for both the disable path (two independent try/catch blocks) and the enable path.
- Warn-not-throw: per-artifact failures are reported via the injected `warn` callback, never thrown. `converged: false` in the return value surfaces partial failure to callers.
- Temp-sibling+rename: `installSkillDir` uses `{target}.tmp` to build the new skill directory tree, then removes the old one and renames the new one into place — two calls, not atomic, which narrows the window with no directory to the gap between them.
- Real-path tests: `git-agent.test.ts` static guards pin the ops list, bounds, D9 gate, and dedup markers in the source file directly (no build step required).
- Leave-the-end-state-not-the-transition / reachable-consumer bar: the post-split KB describes the end state only — no tombstone notes about where text "used to be"; consult `tracker-references` for transition history.
- Pure helpers in `src/core/`, I/O orchestration in `src/targets/`: `compliance.ts` is pure; `compliance-install.ts` owns all I/O.
- Non-vacuity / no hand-enumerated rosters: the generated-reference manifest (`generatedReferenceManifest()`) is derived from `expandVariants()` itself, never hand-listed, so it cannot silently drift from the build registry.
- Guard-mode classification discipline for a contract/mechanics split: when a literal moves, its guard repoints to `'union'` mode; when it stays, the guard stays `'sole'`. This is the rule behind every `D{N}` boundary drawn in this section.
- Body-instructed skill: external thread bodies are untrusted and must not drive agent behaviour.
- Non-vacuity: also backs the D4/D11 legend's set-relation assertion (no surviving `D{N}` label may lack a definition somewhere).
- Single-sink validation: the provider-resolution preamble is the one convergence point traceability filename composition now goes through.
- Per-spawn billing of shared agent prompts: the economic reason the contract/mechanics split exists at all.
- Containment controls must never become loadable/optional: why `## Comment-sink scrub (D11)` never moved out of `git.md`.
- Containment is four separate obligations (every producer, every repetition, every escape, and the untrusted-vs-local boundary): the Principle 8 marker-neutralisation rule, its "Never reproduced in a posted body" sub-bullet (#328), and the per-issue (never per-list) wrapping discipline documented above under Anti-Patterns/Constraints are this pitfall's direct fix.
- Byte-identical relocation is not semantics-preserving across a grammar boundary: the direct cause of the `###`-heading-depth rule applied to the moved D3 template.
- Feature knowledge: **tracker-references** — owns the split mechanics in full detail: MDS build machinery (`VARIANT_MODULES`, `expandVariants`, `splitVariantSections`), the byte budget (`BUDGET_GIT_MD`, `BUDGET_SKILL_MD`, `BUDGET_LOADED_SET`, `PREAMBLE_MAX_LINES`), the single-authority and reachability guards (`SHARED_LITERAL_REGISTRY`, `MCP_SHARED_LITERAL_REGISTRY`, `MIN_RATIONALE_CHARS`), and the installer overlay (`overlayGeneratedReferences`, converge-not-merge, prune). Read it before touching build-side plumbing; read this KB for what the contract means at runtime.
- Feature knowledge: **installer-shadowing** — shadow resolution for SKILL.md and rule file follows `validateSkillShadow` / `validateRuleShadow` from the installer; `seedRuleShadow` tier logic lives in `rules.ts`.
- Feature knowledge: **resolve-pipeline** — `/resolve` gates Phase 1b/9b on `EVIDENCE_POLICY` and 9c on `REQUIRE_NON_AUTHOR_APPROVAL`, and passes `COMPLIANCE_FRAMEWORKS` to every Code spawn; resolution-summary.md format includes a `## Third-Party Threads` section.
</content>
