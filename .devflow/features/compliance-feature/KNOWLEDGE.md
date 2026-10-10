---
feature: compliance-feature
name: Compliance Feature & SDLC Traceability
description: "Use when changing the compliance feature: framework registry, converge, CLI, rule stamping, the settings-line lens, evidence floor. Keywords: COMPLIANCE_FRAMEWORKS, COMPLIANCE_ACTIVE, compliance_gate."
category: architecture
directories:
  - src/core/compliance.ts
  - src/core/compliance-compose.ts
  - src/targets/claude-code/compliance-install.ts
  - src/cli/commands/compliance.ts
  - src/cli/commands/compliance-prompts.ts
  - src/assets/skills/compliance
  - src/assets/rules/compliance.md
  - src/assets/scripts/resolve-evidence-policy.cjs
  - src/assets/commands/_partials/_compliance.mds
  - src/assets/commands/code-review.mds
  - src/assets/commands/plan.mds
  - src/assets/commands/implement.mds
  - src/assets/commands/resolve.mds
  - src/assets/commands/dynamic-build.mds
created: 2026-08-20
updated: 2026-10-10
---

# Compliance Feature & SDLC Traceability

## Rules

- **KB-AP-1** Never gate the lens on a file's presence: every machine carries the compliance skill and every framework reference, so gate on `COMPLIANCE_ACTIVE` and load `references/{id}.md` only for the ids in `COMPLIANCE_FRAMEWORKS`.
- **KB-AP-2** Never reintroduce a retired gate: the plugin's step-gated pre-flight, `COMPLIANCE_ENABLED`, `COMPLIANCE_SKILL_INSTALLED`, or an op-level `COMPLIANCE:` key on any spawn; `tests/build-mds.test.ts` asserts each absent, with known-bad probes.
- **KB-AP-3** Never let the compliance lens decide evidence: a missing ticket, test plan or approval is the evidence policy's gap, never a compliance finding.
- **KB-AP-4** Never seed a compliance skill or rule shadow from the installed copy: it is already stamped, so the shadow freezes the stamp and `compliance --set` can no longer re-stamp it. Seed from shipped source (`shadowSeedDir`; `seedRuleShadow`'s canonical-source tier).
- **KB-AP-5** Never hand-assemble converge options at a call site: `convergeFromManifest` is the one manifest-to-options site, and a bypass forgets `rulesEnabledOverride`.
- **KB-AP-6** Never chain the skill step and the rule step of `convergeComplianceArtifacts` with `&&` or `||`: each runs independently and warns instead of throwing.
- **KB-AP-7** Never clear `frameworks` on disable: re-enable restores the prior selection (pinned by the compliance e2e disable and re-enable scenarios); only `--set` replaces the list.
- **KB-AP-8** Never let a manifest- or user-sourced framework id reach a path segment or a stamp without `normalizeFrameworks`; strict `parseFrameworkList` is for CLI `--set` input only.
- **KB-AP-9** Never skip the evidence-policy floor on a compliance-enabled machine with zero frameworks: `complianceDefault()` checks only `enabled`.
- **KB-AP-10** Never import `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES` into the test that asserts them: use the independent literal `['compliance']`, or the test verifies the constant against itself.
- **KB-AP-11** A token-free skill shadow passes through byte-identical (C1) and loses every per-framework section; `--status` flags it `[shadowed, composition skipped]`. A skill shadow replaces SKILL.md only: references and fragments always come from canonical source.
- **KB-AP-12** Never align the compliance lens with the language-focus gate: a language focus is presence-gated on its installed skill, the lens never is.
- **KB-AP-13** Never parse `policy.json`: where `project.json` has no `evidence`, the file's mere presence resolves `required` (`invalid-file`), and a guard keeps the retired parser out of `src/`.
- **KB-INV-1** Compliance is a feature, not a plugin: skill and rule are owned by `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES`, disjoint from plugin-owned names; `devflow-compliance` lives only in `DELETED_PLUGIN_NAMES`.
- **KB-INV-2** The skill and every framework reference install in every state; the machine switch owns only the rule and the SKILL.md stamp.
- **KB-INV-3** The lens is the union of the machine's ids, the default branch's `project.json` ids and the worktree's: a branch adds a framework and never removes one, and an unreadable file never lowers it.
- **KB-INV-4** `COMPLIANCE_FRAMEWORKS` comes only from the settings line through `_partials/_compliance.mds`, and every Code spawn carries it (`tests/compliance-prompts.test.ts` sweeps every site).
- **KB-INV-5** Compliance only ever raises the evidence policy (`stricter(...)`); it never lowers a `required` file value.
- **KB-INV-6** `convergeComplianceArtifacts` warns instead of throwing, reports `converged: false` on any warn path, and returns early on a non-absolute `claudeDir`.
- **KB-INV-7** `src/core/compliance*.ts` is pure; every read, write and prompt lives in `src/targets/` or `src/cli/`.
- **KB-INV-8** A label written into an artifact comes from the registry's static labels, never from user input.

## Overview

Compliance is a built-in feature (not a plugin) with two interlinked capabilities: (1) a regulatory-framework skill system that applies framework-specific controls during code review, planning and design; (2) an SDLC traceability layer wired into Git agent operations that ties branches to issues, PR titles to project conventions, review threads to verified fixes and releases to shipped issues. This KB owns (1) and the evidence-floor boundary. Capability (2) is split across two siblings: `.devflow/features/compliance-feature-traceability/KNOWLEDGE.md` (the Git agent contract: D1-D11 markers, D4, D9, D10, D11, containment, Handoff Values) and `.devflow/features/compliance-feature-release-trace/KNOWLEDGE.md` (release evidence and `release-trace.cjs`).

The skill is **installed on every machine** by `convergeComplianceArtifacts` (not `installViaFileCopy`), always with every framework reference (`D-COMPLIANCE-INSTALL-ALWAYS`): a repository can turn the review lens on by itself (`compliance` in its committed `.devflow/project.json`), so the machine switch cannot decide what is installed. The machine switch owns only the **rule** (the one artifact Claude Code loads into every prompt) and the SKILL.md stamp. Host commands resolve the lens at runtime from the settings line through the shared `_partials/_compliance.mds` (`D-COMPLIANCE-REPO-LENS`): `COMPLIANCE_FRAMEWORKS` is `off`, `none` (generic controls) or framework ids, and an agent loads `references/{id}.md` only for the ids it is given. The Git agent's traceability operations take no compliance input at all: they key on the evidence policy's mechanism inputs (`ISSUE_REQUIRED`, `APPLY_CONVENTIONS`, `REQUIRE_NON_AUTHOR_APPROVAL`).

## System Context

Compliance replaced the retired `devflow-compliance` plugin. Its name is in `DELETED_PLUGIN_NAMES` (not `DEVFLOW_PLUGINS`); its skill and rule are managed only by `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES` in `src/core/plugins.ts`, never by the plugin install path. Both sets must stay disjoint from the plugin-owned names (`getAllSkillNames()`, `getAllRuleNames()`; guarded in `tests/plugins.test.ts`). `installViaFileCopy` unions `FEATURE_OWNED_SKILLS` into its orphan sweep's known names, so `devflow:compliance` is never swept as an orphan.

`resolveFeatureRedirect` handles `--plugin devflow-compliance` and `--plugin compliance`: it strips those names, emits a notice and continues with the remaining plugins (strip-and-continue), so a mixed `--plugin` list never silently no-ops.

State lives in `manifest.features.compliance: ComplianceFeatureState` (`{ enabled: boolean; frameworks: string[] }`), a named type shared by `manifest.ts`, `init-seed.ts`, `init.ts`, `compliance.ts` and `compliance-install.ts`. It is a manifest group (like proxy), not a `config.json` toggle. Absent or malformed fields self-heal to `{enabled:false, frameworks:[]}` through `normalizeComplianceFeature()`.

## Component Architecture

### Framework registry (`src/core/compliance.ts`, pure, no I/O)

Registry ids: `gdpr`, `hipaa`, `pci-dss`, `soc2`, `iso-27001`, `sox`. Each has a static `label` (used verbatim in stamped artifacts) and an `id` that matches the source directory `compliance/frameworks/{id}/` and the installed reference basename `references/{id}.md`.

- `COMPLIANCE_FRAMEWORKS` - readonly registry array (ids, labels, hints)
- `ComplianceFeatureState` - the single named type for all callers
- `ALWAYS_PRESENT_REFS` - `['detection.md', 'sources.md']`, installed whatever the selection
- `normalizeFrameworks(ids)` - **tolerant**: drops unknowns silently, deduplicates (first wins); the trust boundary inside `convergeComplianceArtifacts`, so no manifest-sourced id becomes an fs path segment or an artifact string without registry validation (AC-35, AC-36)
- `parseFrameworkList(input)` - **strict**: rejects unknowns with an error naming every unknown and every valid id; the boundary for CLI `--set`, called before any I/O so an invalid id leaves no partial state
- `normalizeComplianceFeature(raw)` - self-heal: absent or malformed becomes `{enabled:false, frameworks:[]}`
- `stampComplianceRule(content, ids)` - replaces `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` with static labels only (`composeComplianceRule` delegates to it)

### Dynamic composition (`src/core/compliance-compose.ts`, pure, no I/O)

SKILL.md and the rule are composed from per-framework fragments, not shipped as static blobs.

- **Fragment** (`src/assets/skills/compliance/frameworks/{id}/fragment.md`): required sections `## Mapping` (one table row with a cell per `COMPLIANCE_CONTROL_COLUMNS` entry), `## Reference` (single-line blurb), `## Checklist` (a couple of items at most) and `## Rule` (one bullet, length-capped; both limits enforced by `parseComplianceFragment`).
- **Skill tokens** (`COMPLIANCE_SKILL_TOKENS`): `${DEVFLOW_COMPLIANCE_SCOPE}`, `_ACTIVE`, `_MAPPING`, `_CHECKLIST`, `_REFERENCES`. **Rule token** (`COMPLIANCE_RULE_TOKENS`): `${DEVFLOW_COMPLIANCE_RULE_BULLETS}` (per-framework `Apply ...` bullets); `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` is then delegated to `stampComplianceRule`. `tests/compliance-compose.test.ts` holds each registry and its shipped template in bidirectional parity, because a typo'd token is otherwise stripped silently (C3).
- **The Active Frameworks section is a stamp plus a runtime rule** (`buildActiveSection`). The stamp names the MACHINE's selection (`**Machine frameworks: GDPR, SOC 2.**`, or `The machine declares no framework.` on a compliance-off machine), followed by `RUNTIME_SELECTION_LINES`: every `references/{id}.md` is installed, so presence decides nothing; the ids given (`COMPLIANCE_FRAMEWORKS`, the machine's plus the repository's) are the frameworks in force; load `references/{id}.md` for each given id and no other; `none` means generic controls only; never fabricate guidance for a framework not given. The stamp is informational: what a run applies is what its caller passes. A framework with no fragment still appears in the stamp; only its mapping row, checklist item and reference row are omitted (C5).
- **C1 passthrough**: a template with no `${DEVFLOW_COMPLIANCE_` tokens (a user shadow with static content) returns byte-identical.
- **Layout**: reference files live at `frameworks/{id}/reference.md` in source and install as `references/{id}.md`.

### Install orchestrator (`src/targets/claude-code/compliance-install.ts`)

`convergeComplianceArtifacts(opts)` is the single public converge function. The skill directory installs in EVERY state, always with `ALWAYS_PRESENT_REFS` plus a reference for every registry id (`D-COMPLIANCE-INSTALL-ALWAYS`).

| State | Outcome |
|---|---|
| `enabled + rulesEnabled` | Skill dir, SKILL.md stamped with the machine's frameworks, stamped rule |
| `enabled + !rulesEnabled` | Skill dir, machine stamp; remove a stale rule |
| `!enabled` | Skill dir, the neutral zero-framework stamp; remove the rule (warn-not-throw) |

- Fragments load once per convergence for the STAMPED frameworks only (none on a compliance-off machine) and are shared by SKILL.md and the rule.
- **Return value** `{ removedPreexisting, converged }`. `removedPreexisting` is true only when a pre-existing **rule** was found and removed on a compliance-off convergence (the skill is no signal, since every machine has it); init uses it for the legacy-upgrade notice ("Compliance rule removed - ..."). `converged` is `false` on any warn path, because the function never throws and a caller cannot detect partial failure by catching.
- **`claudeDir` guard**: a non-absolute `claudeDir` warns and returns `{ removedPreexisting: false, converged: false }` at once, so `fs.rm` can never resolve somewhere unexpected.
- **`convergeFromManifest`** takes a manifest slice `{ features: { compliance: ComplianceFeatureState; rules: boolean } }` plus an optional `rulesEnabledOverride` (used by `rules.ts`, where `rulesEnabled` reflects the actual install outcome rather than manifest state). Call sites: `init.ts`, `rules.ts`, `compliance.ts`.
- **Legacy-upgrade notice**: `init.ts` probes the rule target **before** `installViaFileCopy` runs (a full install wipes `rules/devflow/` before converge, so a later probe would miss it); `hadComplianceRule` combined with `convergeResult.removedPreexisting` drives the notice.
- **Unconditional convergence**: both artifact operations run independently; `installSkillDir` catches its own errors, so the rule step (install, or probe-then-remove) always runs. The disable path uses two independent try/catch blocks.
- **Temp-sibling+rename**: `installSkillDir` builds the new tree under `{target}.tmp`, removes the old target, then renames. That is two calls, not an atomic swap; it narrows the no-directory window to the gap between them. Orphaned `.tmp` directories from earlier crashes are cleaned at the start of each run.
- **Shadow semantics**: SKILL.md resolves shadow then canonical (shadow validated by `validateSkillShadow`) and is composed with the stamp frameworks either way. Reference files (`{id}.md`, `detection.md`, `sources.md`) always come from canonical source, and fragments (registry-owned content) load from canonical source even when SKILL.md comes from a shadow. The rule resolves shadow then canonical (`validateRuleShadow`), then `composeComplianceRule`; a token-free rule shadow passes through byte-identical.

### CLI (`src/cli/commands/compliance.ts`)

`resolveComplianceCliAction(current, action, setFrameworks?)` is a pure resolver mapping `(state x action)` to `(nextState, messages)`; the caller converges artifacts and writes the manifest. `disable` sets `enabled: false` and leaves `frameworks` unchanged; `enable` restores them; only `set` replaces the list. On a TTY, `--enable` with no prior frameworks shows a `@clack/prompts` multiselect (`frameworkChoices()` and `FRAMEWORK_SELECT_MESSAGE` from `compliance-prompts.ts`) before falling through to `set`.

`--disable` removes the rule and keeps the frameworks ("Compliance disabled - rule removed, frameworks remembered for re-enable"); the skill stays installed with the neutral stamp. `--status`:
- reports no reference-file drift (every install carries every reference, so an installed file says nothing about the selection);
- reports `unknownFrameworkIds(manifestFrameworks, registryIds)`: manifest ids the registry does not know (hand-edited, or from a newer devflow), which every install drops and only `--set` removes;
- reports the repository fold with `Repository:`, `Default branch:` and `Effective here:` lines (`repoComplianceStatusLines`, `src/core/evidence-policy.ts`) and a `Migration:` hint (from `serializeProjectSuggestion`) while the worktree still holds a `policy.json`;
- detects skill shadows with `skillShadowState()`: `'none'`, `'shadowed'` (tokens present, composition runs) or `'composition-skipped'` (token-free, C1); the Skill line shows `[shadowed]` or `[shadowed, composition skipped - per-framework sections absent]`.

### Init wizard (`src/cli/commands/compliance-prompts.ts`)

All prompt rendering for the compliance step of `devflow init` lives here.
- **`shouldRunComplianceStep(input)`** is a pure gate keyed on `modePromptShown`, never on the mode name: `hasCliOverride` gives `false`; `!isTTY` gives `false`; `mode === 'advanced'` gives `true`; `mode === 'recommended'` gives `modePromptShown` (set only when the mode-select prompt actually ran, so `--recommended` never sets it and stays promptless).
- **`runComplianceStep({ seed, prompts })`** is injectable and never calls `process.exit()` or throws. It emits a clack note "Current setting: {state}" for re-init legibility, asks enable with `p.select` Yes/No (`p.confirm` was dropped to avoid Enter-through ambiguity), then `p.multiselect` for frameworks seeded from prior state. It returns `{ kind: 'resolved', state, messages }` or `{ kind: 'cancelled' }`; every array is defensively copied.
- **`CompliancePromptIO`** (`note`, `select`, `multiselect`, each returning `PromptOutcome<T>`) mirrors `ProxyPreflightDeps`; `buildClackCompliancePrompts()` builds the real adapter.
- Shared by `init.ts` and `compliance.ts`: `FRAMEWORK_SELECT_MESSAGE`, `frameworkChoices()`, `formatFrameworkCatalogue()` and `formatComplianceSummary(enabled, frameworks)` (re-exported by `init.ts`).
- **In `init.ts`**: `modePromptShown` is set only in the `else` branch where the mode `p.select` actually runs. Both paths gate on `shouldRunComplianceStep`; on the Advanced path `isTTY` is guaranteed (the non-TTY guard already exited 1), so the predicate reduces to the CLI-override check. `--compliance` / `--no-compliance` populate `cliComplianceOverride`, which sets `hasCliOverride` and bypasses the wizard.

### Rule template and shadow seeding

`src/assets/rules/compliance.md` is a composition template with two tokens: `${DEVFLOW_COMPLIANCE_RULE_BULLETS}` (one `Apply ...` bullet per selected framework) and `${DEVFLOW_COMPLIANCE_FRAMEWORKS}`, delegated to `stampComplianceRule`: `Active frameworks: GDPR, SOC 2 - their controls are binding.` or `Active frameworks: none declared - generic controls only.`

**The skill shadow mirrors the rule shadow (`D-COMPLIANCE-SHADOW-SOURCE`).** `devflow skills shadow compliance` seeds through `shadowSeedDir(bareName, installedDir)` (`src/cli/commands/skills.ts`), which returns the shipped SOURCE for every `FEATURE_OWNED_SKILLS` member and the installed copy (else source) for every other skill. The installed SKILL.md is already composed, and a token-free shadow passes composition byte-identical (C1), so seeding from it would freeze that moment's stamp (AC-38). `devflow skills list` names its provenance `the compliance feature (every install)`.

`seedRuleShadow` (`rules.ts`) uses two tiers for `FEATURE_OWNED_RULES`: it **skips Tier 1** (the installed, already-composed file) and goes to **Tier 2**, the canonical source, which preserves both placeholders. Tier 1 would permanently disable per-framework composition whenever the shadow applied.

### The compliance lens (`_partials/_compliance.mds`, `D-COMPLIANCE-REPO-LENS`)

The lens comes from the settings line (`resolve-settings.cjs`), never from a file check. Its `COMPLIANCE` field is a union (D-LENS-UNION): the machine's ids, the default branch's `.devflow/project.json` `compliance` ids and the worktree's. The default branch's copy is read LOCALLY: `git symbolic-ref --quiet refs/remotes/origin/HEAD` names the branch D, then a bounded `git cat-file blob refs/remotes/origin/D:.devflow/project.json` goes through the strict parser, never over the network (D-SETTINGS-LOCAL-ONLY), so it is as fresh as the last fetch; with no tracking copy the lens is machine plus worktree. A branch can therefore ADD a framework and never remove one: a PR that deletes `"compliance":["hipaa"]` is still reviewed under hipaa. The value is `off` only when no layer declares compliance, `generic` when one declares it with no ids (a machine on at zero frameworks, an empty or malformed list), else the ids in registry order. A broken file affects only the keys it owns and never lowers the lens: an unreadable `config.json` owns no compliance, so the readable `project.json`'s and the default branch's ids stay in; an unreadable `project.json` reads as a malformed declaration (`generic`) while the machine's and default branch's ids stay in; any tracking-copy state git could not read is `generic` too.

`_compliance.mds` exports three defines:
- `compliance_frameworks()` - `COMPLIANCE_FRAMEWORKS` is that `COMPLIANCE` with `generic` written `none`: `off`, `none` or the ids the machine and repository declare.
- `compliance_lens()` - the `settings_resolve` block (`_partials/_settings.mds`, alias-imported), then "**Set the compliance lens** from that line: ..." (`compliance_frameworks()`), for a host that forwards the lens and gates nothing on it.
- `compliance_gate()` - `compliance_lens()`, then "`COMPLIANCE_ACTIVE` is `true` unless `COMPLIANCE_FRAMEWORKS` is `off`."

| Command | How it imports | Effect |
|---|---|---|
| `/code-review` | `compliance_gate()` at Step 0b (per worktree) | Adds the `compliance` Review focus when `COMPLIANCE_ACTIVE` AND the diff touches regulated surface (data models, auth flows, logging/observability, payments, IaC, retention); passes `COMPLIANCE_FRAMEWORKS` in that Review spawn |
| `/plan` | `compliance_gate()` in the gap-analysis phase | Adds a compliance Design agent to the single-issue and multi-issue rosters when `COMPLIANCE_ACTIVE`; passes `COMPLIANCE_FRAMEWORKS` in its spawn |
| `/implement` | alias-import, `compliance.compliance_frameworks()` | Passes `COMPLIANCE_FRAMEWORKS` to every Code spawn: the implementing ones, the validation-, alignment- and QA-fix loops, the CI-fix spawn and `pr-create`; gates nothing |
| `/resolve` | alias-import, `compliance.compliance_frameworks()` (per worktree root) | Passes `COMPLIANCE_FRAMEWORKS` to every Code spawn (issue-fix, validation-fix, CI-fix); gates nothing |
| `/dynamic-build` | alias-import, `compliance.compliance_lens()` at Pre-authoring step 0b | Authors the value into the workflow script as the shape-gated `COMPLIANCE_FRAMEWORKS` constant (anything but `off`, `none` or a registry-shaped id list becomes `off`), passed as `complianceFrameworks` and forwarded per ticket in WAVE mode; every engine Code prompt (implement and each fix template) carries it; gates nothing |
| `/release` | none | No compliance gate; release evidence and back-links key on `EVIDENCE_POLICY` |

Every compiled Code spawn carries the lens: install-all retired the skill-presence check a fix-phase Code agent once found it by, so a spawn without it runs with the lens `off`. `tests/compliance-prompts.test.ts` sweeps every Code spawn site in `dist/commands/` (fenced, prose and workflow-template shapes, per-host site floors, a known-bad probe per shape). Consumers: `code.mds` invokes the Compliance skill only when `COMPLIANCE_FRAMEWORKS` is not `off` (absent means `off`) AND the task touches regulated surface; `review` and `design` take `COMPLIANCE_FRAMEWORKS` as the compliance focus's input; `gap-analysis` section 7 and the compliance SKILL.md checklist load `references/{id}.md` only for the given ids. `/resolve`'s thread steps key on `EVIDENCE_POLICY` and its merge-readiness phase on `REQUIRE_NON_AUTHOR_APPROVAL`, never on the lens. No compiled command passes an op-level `COMPLIANCE:` key to the Git agent (the evidence policy's mechanism inputs replaced it); `tests/build-mds.test.ts` section 14 asserts it.

### Evidence-policy floor vs. review lens

Two independent things sit on `manifest.features.compliance` and must not be conflated.

- **The floor.** `resolve-evidence-policy.cjs`'s `complianceDefault(rawFeatureValue)` mirrors `normalizeComplianceFeature` exactly (a parity test pins it): a well-formed `{enabled: true, frameworks: [...]}` resolves `required` **whatever the framework count**, because an enable at zero frameworks ("generic controls only") still turns the lens on; only that `enabled` is `true` matters. Any malformed or `enabled: false` shape resolves `standard`. This value only ever **raises** the resolved policy (`stricter(policy, facts.compliance)`): it can turn a file or worktree `standard` into `required` (warning `raised-by-compliance`) and never lowers a `required` file value.
- **The repository floor (D-COMPLIANCE-REPO-FLOOR).** A `compliance` key in `.devflow/project.json` at R (the default branch), T (the tracking branch) or W (the worktree), with any value (empty list and malformed included), makes the repository's compliance default `required`, folded with the machine's as `stricter(C_machine, C_repo)`. HEAD alone never contributes; an unreadable project.json counts as declaring it (fail closed). Offline, T is the tracking copy of the branch `git ls-remote --symref origin HEAD` names, else the one the clone's local `refs/remotes/origin/HEAD` names (D-OFFLINE-ORIGIN-HEAD); with neither, only W is read.
- **Source precedence (D-POLICY-SOURCE-PRECEDENCE, D-POLICY-JSON-RETIRED).** At every source `project.json`'s `evidence` is the one authority: a valid value decides the policy; a present-but-malformed or duplicated `evidence` decides `invalid` (so `required`); a project.json that is not a JSON object is invalid outright. Only where project.json is absent or has no `evidence` key does the SAME source's `.devflow/policy.json` count, by presence alone and never parsed: an existing file (any bytes, `standard` included) makes that source `invalid` (`required`, `invalid-file`), none makes it absent. Presence reuses each source's existing call (contents GET: exit 0 or overflow present, 404 absent; `cat-file blob`: exit 0 present, answered non-zero absent, unanswered present; worktree: `lstat`, never opened), so the argv sequence is unchanged. `parsePolicyBytes`, `POLICY_GRAMMAR_RE` and `serializePolicy` must not return to `src/` (the TP-46 guard in `tests/evidence-policy/resolver.test.ts`). Precedence is per source, so `foldPolicy` folds sources unchanged.
- **The lens.** The compliance SKILL.md's `**Lens only.**` note (Scope Boundary section) states the other half: the skill's composed sections shape WHAT a compliance review looks for (regulatory gaps: retention, erasure/data-subject rights, audit-trail completeness, segregation of duties, framework mapping, IaC exposure), never HOW MUCH evidence a change must carry. Tracker links, test plans, approvals and release traces are governed solely by the resolved evidence policy (`resolve-evidence-policy.cjs`, `pr-evidence.cjs`, `verify-evidence.cjs`).

## Anti-Patterns

**KB-AP-1, KB-AP-2: gates.** The old plugin implemented a 4-step pre-flight gate; the correct model is the settings-line lens (`compliance_gate()` / `compliance_frameworks()`), resolved once per command (per worktree) and passed as `COMPLIANCE_FRAMEWORKS` to the agents that apply it. `COMPLIANCE_ENABLED` and `COMPLIANCE_SKILL_INSTALLED` are retired from every compiled command (`tests/build-mds.test.ts` section 14; for /release, `tests/tracker/compliance-gate.test.ts`). The Git agent's ops take the evidence policy's mechanism inputs instead of an op-level `COMPLIANCE:` key; the section 14 collector reports any `COMPLIANCE:` spawn line, with a known-bad probe of the retired shapes. `~/.claude/skills/devflow:compliance/SKILL.md` existing says nothing, and neither does a `references/{id}.md`.

**KB-AP-4: shadow seeding.** Seeding the rule shadow from the installed file permanently disables framework stamping (`seedRuleShadow` always uses Tier 2 for `FEATURE_OWNED_RULES`). Seeding `skills shadow compliance` from `~/.claude/skills/devflow:compliance/` freezes the stamp and makes `compliance --set` a no-op on a shadowed skill; pinned by TP-44 (`tests/skills.test.ts`, `tests/compliance-install.test.ts`, with a known-bad probe).

**KB-AP-5, KB-AP-6: converge.** Callers that bypass `convergeFromManifest` assemble the options struct inconsistently (a forgotten `rulesEnabledOverride`). Using `&&` or `||` between `installSkillDir` and the rule step would let the first result skip the second.

## Gotchas

**KB-AP-8: tolerant versus strict.** `normalizeFrameworks` drops unknowns silently (manifest-sourced ids, self-healing); `parseFrameworkList` errors loudly (CLI input).

**KB-AP-7: disable keeps frameworks.** A flow that resets `frameworks` on disable breaks the restore behaviour verified by e2e S4/S5.

**KB-AP-11: shadows.** A skill shadow replaces SKILL.md only; references and fragments are never user-overridable, because they are registry-owned. A token-free shadow installs a SKILL.md with no mapping, active list, checklist or references sections.

**Step 0b resolves the lens per worktree.** `compliance_gate()` runs at `/code-review` Step 0b and each worktree keeps its own `COMPLIANCE_ACTIVE` / `COMPLIANCE_FRAMEWORKS` for every downstream phase. The settings line reads that worktree's project.json, so two worktrees can resolve different lenses, each still carrying the default branch's frameworks.

**KB-AP-9: zero frameworks still floors at `required`.** `complianceDefault()` checks only `enabled: true`; an empty `frameworks: []` does not fall back to `standard`, because the review lens is already on (generic controls) at that state.

**KB-AP-10: the oracle trap.** Tests asserting the `FEATURE_OWNED_*` exclusions use the independent literal `['compliance']` (`tests/plugins.test.ts`).

**KB-AP-12: two gate shapes, deliberately.** `/code-review`'s language focuses stay presence-gated on `{claude_dir}/skills/devflow:{focus}/SKILL.md`, `{claude_dir}` being Claude Code's directory as the installer resolves it (`CLAUDE_CONFIG_DIR` when absolute, else `$HOME/.claude`; D-CLAUDE-DIR-PROMPTS, held by `tests/guards/claude-dir.test.ts`), because those skills install only with their optional plugin. The compliance lens is never presence-gated because every machine has its skill. The language-focus check reads the machine install, never anything per repository.

## Key Files

- `src/core/compliance.ts` - registry, `ComplianceFeatureState`, `ALWAYS_PRESENT_REFS`, tolerant/strict parsers, self-heal normalizer, rule stamper
- `src/core/compliance-compose.ts` - pure composition: `parseComplianceFragment`, `composeComplianceSkill`, `composeComplianceRule`, `buildActiveSection` (machine stamp plus `RUNTIME_SELECTION_LINES`), `COMPLIANCE_SKILL_TOKENS`, `COMPLIANCE_RULE_TOKENS`, `COMPLIANCE_CONTROL_COLUMNS`
- `src/assets/skills/compliance/frameworks/{id}/fragment.md` and `reference.md` - per-framework composition input and reference content (installed as `references/{id}.md`); `src/assets/skills/compliance/references/` holds `detection.md` and `sources.md`
- `src/targets/claude-code/compliance-install.ts` - `convergeComplianceArtifacts`, `convergeFromManifest`, claudeDir guard, `loadComplianceFragments`
- `src/cli/commands/compliance.ts` - `resolveComplianceCliAction` (pure), the Commander command, `--status`, `unknownFrameworkIds`, `skillShadowState`
- `src/cli/commands/compliance-prompts.ts` - wizard helpers: `shouldRunComplianceStep`, `runComplianceStep`, `CompliancePromptIO`, `buildClackCompliancePrompts`, `frameworkChoices`, `FRAMEWORK_SELECT_MESSAGE`, `formatComplianceSummary`
- `src/cli/commands/skills.ts` - `shadowSeedDir`, the `the compliance feature (every install)` provenance
- `src/cli/commands/rules.ts` - `seedRuleShadow` (Tier 1 skipped for `FEATURE_OWNED_RULES`)
- `src/core/plugins.ts` - `FEATURE_OWNED_SKILLS`, `FEATURE_OWNED_RULES`, `DELETED_PLUGIN_NAMES`, `resolveFeatureRedirect`
- `src/assets/commands/_partials/_compliance.mds` - `compliance_frameworks()`, `compliance_lens()`, `compliance_gate()`
- `src/assets/agents/code.mds`, `review.mds`, `design.mds`, `src/assets/skills/gap-analysis/SKILL.md` section 7, `src/assets/skills/compliance/SKILL.md` checklist - the lens's consumers
- `src/assets/commands/code-review.mds` (Step 0b, regulated-surface gate, spawn input), `plan.mds` (compliance Design agent; issue linking mandatory only under `EVIDENCE_POLICY` `required`), `implement.mds` and `dynamic-build.mds` (alias-import, forward the lens, no gate), `resolve.mds` (Phase 1b and 9b on `EVIDENCE_POLICY` `required`, Phase 9c on `REQUIRE_NON_AUTHOR_APPROVAL`), `release.mds` (Phase 1c evidence policy; no compliance gate)
- `src/assets/scripts/resolve-evidence-policy.cjs` - `complianceDefault()` (floor at any framework count, mirrors `normalizeComplianceFeature`), `projectReading()` / `withRetiredPolicy()` (repository floor at R/T/W, project.json-first precedence, retired policy.json by presence only)
- `tests/compliance-install.test.ts`, `tests/skills.test.ts` - TP-44: the skill and every reference install on every convergence, the rule only when enabled; a seeded-from-source shadow is re-stamped by `--set`
- `tests/compliance-prompts.test.ts`, `tests/compliance-e2e.test.ts` (S23) - TP-43: the lens from the settings line; a hipaa repository on a compliance-off machine resolves `COMPLIANCE=hipaa` and never installs or changes the machine rule
- `tests/scoped-install-e2e.test.ts` (TP-38: `EVERY_INSTALL_CARRIES` includes the skill and its references), `tests/evidence-policy/disposition.test.ts` (names `COMPLIANCE_ACTIVE` as the lens input)

## Related

- `.devflow/features/compliance-feature-traceability/KNOWLEDGE.md` - the Git agent traceability contract: D1-D11 markers, D4/D9/D10/D11, containment, Handoff Values, bounds
- `.devflow/features/compliance-feature-release-trace/KNOWLEDGE.md` - release evidence, `release-trace.cjs`, release notes caps
- `.devflow/features/tracker-references/KNOWLEDGE.md` - the contract/mechanics split machinery (MDS build, byte budget, containment oracle, installer overlay)
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` - shadow resolution for SKILL.md and the rule (`validateSkillShadow`, `validateRuleShadow`); `seedRuleShadow` tier logic lives in `rules.ts`
- `.devflow/features/resolve-pipeline/KNOWLEDGE.md` - `/resolve` gates Phase 1b/9b on `EVIDENCE_POLICY` and 9c on `REQUIRE_NON_AUTHOR_APPROVAL`, passes `COMPLIANCE_FRAMEWORKS` to every Code spawn; its resolution-summary format has a `## Third-Party Threads` section
- `src/core/compliance.ts`, `src/targets/claude-code/compliance-install.ts`, `src/assets/commands/_partials/_compliance.mds` - the code this KB describes
