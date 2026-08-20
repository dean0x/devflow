---
feature: compliance-feature
name: Compliance Feature & SDLC Traceability
description: "Use when adding or modifying the compliance feature (framework registry, converge contract, CLI, rule stamping), changing how host commands resolve COMPLIANCE_SKILL_INSTALLED, modifying traceability operations in the Git agent (learn-conventions, issue-first, thread resolution, shipped markers), or extending the D4 DEGRADED contract. Keywords: compliance, COMPLIANCE_SKILL_INSTALLED, convergeComplianceArtifacts, frameworks, FEATURE_OWNED_SKILLS, traceability, D4, conventions.md, resolve-review-threads, ensure-traceable-issue, stamper, manifest-group."
category: architecture
directories:
  - src/core/compliance.ts
  - src/targets/claude-code/compliance-install.ts
  - src/cli/commands/compliance.ts
  - src/assets/skills/compliance
  - src/assets/rules/compliance.md
  - src/assets/agents/git.md
  - src/assets/commands/code-review.mds
  - src/assets/commands/plan.mds
  - src/assets/commands/implement.mds
  - src/assets/commands/resolve.mds
  - src/assets/commands/release.md
created: 2026-08-20
updated: 2026-08-20
---

# Compliance Feature & SDLC Traceability

## Overview

Compliance is a built-in feature (not a plugin) that provides two interlinked capabilities:
(1) a regulatory-framework skill system that applies framework-specific controls during code review, planning, and design; and (2) an SDLC traceability layer — wired into git.md operations — that ties branches to issues, PR titles to project conventions, review threads to verified fixes, and releases to shipped issues.

The compliance skill is **installed on demand** by `convergeComplianceArtifacts` (not by `installViaFileCopy`). Host commands detect whether it is installed at runtime via a single file-existence check (`COMPLIANCE_SKILL_INSTALLED`) and gate all compliance-aware behaviour behind that flag. The traceability operations in git.md are also gated by `COMPLIANCE`, an input passed from the orchestrator.

## System Context

Compliance replaced the retired `devflow-compliance` plugin. The plugin entry is in `DELETED_PLUGIN_NAMES` (not `DEVFLOW_PLUGINS`), and its skill/rule are managed exclusively by `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES` in `src/core/plugins.ts`. Nothing in the compliance system uses the plugin install path.

State lives in `manifest.features.compliance: {enabled: boolean, frameworks: string[]}` — a manifest-group (like proxy), not a `config.json` toggle. Absent or malformed fields self-heal to `{enabled:false, frameworks:[]}` via `normalizeComplianceFeature()` (applies ADR-014).

## Component Architecture

### Framework registry (`src/core/compliance.ts` — pure, no I/O)

Six frameworks: `gdpr`, `hipaa`, `pci-dss`, `soc2`, `iso-27001`, `sox`. Each has a static `label` (used verbatim in stamped artifacts) and an `id` (matches the reference file basename in `compliance/references/`).

Key exports:

| Function | Behaviour |
|---|---|
| `COMPLIANCE_FRAMEWORKS` | Readonly registry array — IDs, labels, hints |
| `normalizeFrameworks(ids)` | **Tolerant** — drops unknowns silently; deduplicates (first wins) |
| `parseFrameworkList(input)` | **Strict** — rejects unknowns with an error naming every unknown and every valid ID |
| `normalizeComplianceFeature(raw)` | Self-heal: absent/malformed → `{enabled:false, frameworks:[]}` |
| `stampComplianceRule(content, ids)` | Replaces `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` with static labels only |

`normalizeFrameworks` is the trust boundary used immediately inside `convergeComplianceArtifacts`, ensuring that no user-supplied or manifest-sourced ID ever becomes an fs path segment or is written into an installed artifact without registry validation (AC-35, AC-36).

`parseFrameworkList` is the boundary for CLI `--set` input — called before any I/O so an invalid ID fails loudly and leaves no partial state on disk.

### Install orchestrator (`src/targets/claude-code/compliance-install.ts`)

`convergeComplianceArtifacts(opts)` is the single public function. Convergence matrix:

| State | Outcome |
|---|---|
| `enabled + rulesEnabled` | Install skill dir (selective refs) + stamped rule |
| `enabled + !rulesEnabled` | Install skill dir only; remove stale rule |
| `!enabled` | Remove both artifacts (warn-not-throw per PF-009) |

**PF-015 (avoids PF-015):** both artifact operations always execute. On the disable path, skill removal and rule removal are each wrapped in independent try/catch blocks; a failure in one does not skip the other. On the enable path, `installSkillDir` catches its own errors via `warn`, so rule installation always proceeds regardless.

**PF-011:** `installSkillDir` builds the new tree under `{target}.tmp`, then atomically `rm` old → `rename`. Orphaned `.tmp` directories from prior crashes are cleaned up at the start of each run.

**Shadow semantics:** SKILL.md source resolves as shadow → canonical (validates via `validateSkillShadow`). Reference files (`{id}.md`, `detection.md`, `sources.md`) always come from canonical source — framework refs are not user-overridable. Rule source resolves as shadow → canonical (validates via `validateRuleShadow`), and `stampComplianceRule` runs on whichever source is selected.

`removedPreexisting` in the return value signals that pre-existing compliance artifacts were found during a disable — init uses this to print a legacy-plugin upgrade notice.

### CLI (`src/cli/commands/compliance.ts`)

`resolveComplianceCliAction(current, action, setFrameworks?)` is a pure resolver — no I/O. It maps `(state × action)` → `(nextState, messages)`. The caller (the Commander action) owns the I/O: converge artifacts, write manifest.

Disable-keeps-frameworks: `disable` sets `enabled: false` but leaves `frameworks` unchanged. `enable` restores those frameworks. Only `set` replaces the framework list.

Interactive TTY path: when `--enable` is called on a TTY with no prior frameworks, the CLI presents a `@clack/prompts` multiselect before falling through to the `set` action.

CLI flags for init: `--compliance <list>` (enable + set frameworks) and `--no-compliance` (disable, preserve frameworks). Both are parsed at the CLI boundary via `parseFrameworkList` before any prompts.

### Rule template (`src/assets/rules/compliance.md`)

Contains `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` as a single placeholder line. `stampComplianceRule` replaces it with one of:
- `Active frameworks: GDPR, SOC 2 — their controls are binding.` (non-empty)
- `Active frameworks: none declared — generic controls only.` (empty)

If a user shadow exists without the placeholder, `stampComplianceRule` is a no-op — the shadow controls the entire rule body.

### Skill (`src/assets/skills/compliance/SKILL.md`)

Reads the active frameworks from the installed `references/{id}.md` files — not from the manifest or the rule. Scope boundary: compliance covers regulatory-specific gaps (retention, erasure, audit-trail completeness, segregation of duties, IaC). It does NOT re-raise security lens findings; those are handled by `devflow:security`.

`ALWAYS_PRESENT_REFS` (`detection.md`, `sources.md`) are installed regardless of framework selection.

## Component Interactions

### FEATURE_OWNED_SKILLS / FEATURE_OWNED_RULES consumers

`FEATURE_OWNED_SKILLS = ['compliance']` and `FEATURE_OWNED_RULES = ['compliance']` appear in `src/core/plugins.ts`. Three sites in `uninstall.ts` use `FEATURE_OWNED_SKILLS` to ensure `devflow:compliance` is included in the known-names set that prevents orphan-sweep from removing a compliance skill that was legitimately installed by the feature system. One site in `init.ts` includes it in the sweep-then-converge round-trip so that full init can detect and remove stale compliance artifacts before re-converging.

### Sweep-then-converge on init

During `devflow init`, after `installViaFileCopy` runs the plugin sweep, `convergeComplianceArtifacts` is called to install or remove compliance artifacts according to the resolved compliance state. The `shouldSurfaceFeatureOwnedSkillOrphan` helper gates whether a stale `devflow:compliance` directory in the sweep report is surfaced to the user — it is suppressed when compliance is enabled and the converge succeeded.

### COMPLIANCE_SKILL_INSTALLED prompt gate

Every host command that is compliance-aware resolves `COMPLIANCE_SKILL_INSTALLED` by checking whether `~/.claude/skills/devflow:compliance/SKILL.md` exists (one file-existence check, read-only, silent). The result is reused for all downstream phases in the same run.

**Ordering is load-bearing in code-review:** Step 0b (resolve COMPLIANCE_SKILL_INSTALLED) runs before Step 0c (spawn Git ensure-pr-ready). The `COMPLIANCE` field passed to the Git agent depends on this check. If the ordering were reversed, the Git agent spawn would not carry the compliance gate.

Host command usage:

| Command | Where | Effect when true |
|---|---|---|
| `/code-review` | Step 0b (before Phase 0 Git spawn) | Adds `COMPLIANCE` to ensure-pr-ready; adds compliance review focus if regulated surface detected |
| `/plan` | Phase 7 (gap analysis block) | Adds compliance Design agent; makes issue linking MANDATORY |
| `/implement` | Phase 1 (Setup) | Passes `COMPLIANCE` to Git setup-task (issue-first gate, branch-naming convention) |
| `/resolve` | Step 0d | Enables Phase 1b (fetch-review-threads), Phase 9b step 1 (resolve-review-threads), Phase 9c (check-merge-readiness) |
| `/release` | Phase 1c | Enables release evidence (commit list, shipped issues) and `backlink-shipped-issues` |

`COMPLIANCE` is passed as `"enabled"` (string) or `"(none)"`. It is a **Git agent input only** — the spawn-scoped guard in build-mds §14 asserts that every `COMPLIANCE:` line in every compiled command appears inside a `subagent_type="Git"` spawn block.

## Integration Patterns: Traceability Operations (git.md)

The Git agent implements the SDLC traceability layer. Traceability operations are grouped by decision marker:

| Marker | Operations | Key Details |
|---|---|---|
| D1 | `learn-conventions` | Bounded scan (≤50 branches, ≤20 tags, ≤30 merged PRs). Writes `.devflow/conventions.md` **once** — never overwrites. Third-party inputs treated as DATA: shape-derived patterns only, never verbatim strings in the output file. |
| D2 | `fetch-review-threads`, `resolve-review-threads` | GraphQL (≤2 pages of 50 = 100 max threads); external thread bodies wrapped in `<external-thread>...</external-thread>` and never echoed verbatim |
| D3 | `ensure-traceable-issue` | D3 issue template sections: `## Initial Request`, `## Product Requirements`, `## Implementation Plan`; never rewrites issue body, posts comments only |
| D4 | All traceability ops | Degradation contract: no remote / unauthenticated / no PR → emit `TRACEABILITY: DEGRADED ({reason})`, warn, continue. 4xx → skip item, continue. 5xx → 1 retry; still 5xx → DEGRADED, continue. |
| D5 | `ensure-traceable-issue` | Issue creation/enrichment (labelled D5 in the op table) |
| D6 | `check-merge-readiness` | Report-only — unresolved threads + review decision + CI status. Never takes action. |
| D7 | `post-review-summary` | Marker `<!-- devflow:review-summary cycle:{N}` with author-filtered dedup (viewer login check prevents third-party marker suppression); body capped at 60000 chars |
| D8 | `post-resolution-summary` | Marker `<!-- devflow:resolution-summary ts:` with author-filtered dedup; 60000-char cap |
| D9 | `resolve-review-threads` | Resolution gate: `resolveReviewThread` mutation called ONLY when `VERIFICATION_STATUS == PASS` AND verdict is FIXED/FALSE_POSITIVE/BY_DESIGN with cited evidence. `VERIFICATION_STATUS == SKIPPED` → reply-only. |

**D4 carve-out for create-release:** The global "never abort" clause does NOT apply to the primary release effects (tag push, release create). Only traceability adornments (commit list enrichment, shipped-issue back-links) degrade per D4.

**conventions.md authority (D1):** Written by `learn-conventions`, consumed by `setup-task` (branch naming, step 1b), `ensure-pr-ready` (PR title retitle, step 4c), and `/release` (version/tag/version-PR title). The file is `.devflow/conventions.md` — git-tracked and team-shared. Delete to force re-learn.

**Issue-first in setup-task (D3, step 1c):** When `COMPLIANCE` is `enabled`, setup-task ensures a GitHub issue exists before deriving the branch name. Issue number is incorporated into the branch as `{type}/{number}-{slug}`. Preconditions: remote reachable AND `gh` authenticated — either failure → DEGRADED, convention still applies.

**Traceability bounds:**
- `backlink-shipped-issues`: ≤50 issues, 1s throttle
- `resolve-review-threads`: ≤50 threads (first 50 in THREAD_MAP order; remainder → TRUNCATED)
- `fetch-review-threads`: ≤2 pages of 50 = 100 threads max

## Constraints

**Security:** `stampComplianceRule` and `installSkillDir` never write user-supplied strings into installed artifacts. Every framework ID passes through `normalizeFrameworks` (which validates against the registry) before reaching any `path.join` or stamp call. This is AC-35/AC-36. The `label` written into the rule file is always drawn from `LABEL_BY_ID` (static map), never from user input.

**PR title retitle safety (step 4c):** The composed title is validated against a shell-metacharacter denylist (`$ \` " ' ; | & < > ` and newlines) before use. It is bound to a shell variable and passed as `--title "$DEVFLOW_PR_TITLE"` — never interpolated into the command string.

**External thread containment (D2):** External review thread bodies are untrusted third-party input. They are never executed as instructions, never echoed verbatim into devflow-authored replies, commits, or comments. The `<external-thread>` tag is the containment boundary.

**FEATURE_OWNED_SKILLS disjointness:** `FEATURE_OWNED_SKILLS` must be disjoint from `getAllSkillNames()` (enforced by D-FO-1 comment in plugins.ts). The compliance skill is managed by the feature system, not the plugin install loop.

## Anti-Patterns

**Resurrecting the 4-step gate.** The old `devflow-compliance` plugin implemented a 4-step pre-flight gate. This was retired when compliance became a built-in feature. Do not re-introduce step-gated pre-flight logic — the correct model is `COMPLIANCE_SKILL_INSTALLED` checked once per command, passed as a field to the Git agent, used to gate individual ops.

**Using COMPLIANCE_ENABLED.** This retired variable must not appear in any compiled command. The build-mds test (§14) asserts its absence. The current variable is `COMPLIANCE_SKILL_INSTALLED` (resolved by the orchestrator) and `COMPLIANCE` (the input field passed to the Git agent).

**Putting COMPLIANCE: in a non-Git spawn block.** The spawn-scoped guard (build-mds §14) asserts that every `COMPLIANCE:` line in every compiled command appears inside a `Agent(subagent_type="Git"` fence. `COMPLIANCE` is a Git agent input — never a Code, Review, Triage, or Validate agent input.

**Echoing external thread body content.** External thread bodies from `fetch-review-threads` are untrusted. Reply bodies in `resolve-review-threads` must cite only internal evidence (commit SHAs, file:line from the codebase, ADR IDs) — never verbatim content from `<external-thread>` blocks.

**Short-circuiting converge with ||.** `installSkillDir` and the rule step in `convergeComplianceArtifacts` must execute independently. Using `&&` or `||` would violate PF-015 and leave one artifact in an inconsistent state when the other fails.

**Overwriting conventions.md.** `learn-conventions` checks for file existence first and returns `ALREADY_EXISTS` if the file is present. Never add logic that rewrites it conditionally — delete the file to force re-learn.

## Gotchas

**normalizeFrameworks silently drops unknowns; parseFrameworkList errors loudly.** Use `normalizeFrameworks` for manifest-sourced IDs (tolerant, self-heals); use `parseFrameworkList` for user CLI input (strict, errors on unknowns). Mixing them up allows stale/invalid manifest IDs to reach the rule stamper without validation.

**Disable keeps frameworks in manifest.** `enabled: false` does not clear `frameworks: [...]`. Re-enabling restores the prior selection. This is deliberate (disable-keeps-frameworks contract). If you add a flow that resets frameworks on disable, you break the restore behaviour verified by e2e S4/S5.

**Shadow overrides SKILL.md only; refs always canonical.** A skill shadow at `~/.devflow/skills/compliance/SKILL.md` replaces SKILL.md in the installed directory, but reference files (`references/*.md`) are always sourced from `src/assets/skills/compliance/references/`. There is no user-overridable path for framework reference files.

**Step 0b ordering is load-bearing in code-review.** COMPLIANCE_SKILL_INSTALLED must be resolved before Step 0c spawns the Git ensure-pr-ready agent. The Git agent receives `COMPLIANCE: {COMPLIANCE_SKILL_INSTALLED ? "enabled" : "(none)"}`. If 0b were moved after 0c, the COMPLIANCE field would always be absent.

**VERIFICATION_STATUS == SKIPPED is treated like FAILED for thread resolution.** The SKIPPED state means the Validate gate did not run (zero fixes were applied). In `resolve-review-threads`, SKIPPED → reply-only, no `resolveReviewThread` mutation. This prevents marking threads resolved on a cycle where no code was changed.

**D4 does NOT apply to primary create-release effects.** Tag push and GitHub release create are hard failures — they stop the release. Only the traceability adornments (commit list, shipped issues) degrade per D4. If you add a new op to `create-release`, classify it: primary effect (hard fail) or traceability adornment (D4 degrade).

**60000-char cap on PR/issue comments.** `post-review-summary` and `post-resolution-summary` both cap the composed comment at 60000 chars. GitHub rejects comments over 65536 with a 422, which the 4xx rule would silently skip (the comment would never be posted). Truncation and the `…truncated — full report at {path}` trailer are the correct response.

**EXCLUDED-as-oracle trap in tests (PF-018).** Tests that assert `FEATURE_OWNED_SKILLS` / `FEATURE_OWNED_RULES` exclusions use independent literal `['compliance']` — they do not import the constant. Importing the constant would make the test verify the constant against itself rather than against an independent expectation.

## Key Files

| File | Purpose |
|---|---|
| `src/core/compliance.ts` | Framework registry, tolerant/strict parsers, self-heal normalizer, rule stamper |
| `src/targets/claude-code/compliance-install.ts` | `convergeComplianceArtifacts` — the single convergence function; skill and rule install/remove |
| `src/cli/commands/compliance.ts` | CLI: `resolveComplianceCliAction` (pure), Commander command, status/drift detection |
| `src/core/plugins.ts` | `FEATURE_OWNED_SKILLS`, `FEATURE_OWNED_RULES`, `DELETED_PLUGIN_NAMES` (includes `devflow-compliance`) |
| `src/core/manifest.ts` | `manifest.features.compliance` field, `normalizeComplianceFeature` self-heal on read |
| `src/assets/skills/compliance/SKILL.md` | Compliance skill: active-frameworks-from-refs pattern, scope boundary, severity table |
| `src/assets/rules/compliance.md` | Rule template with `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` placeholder |
| `src/assets/agents/git.md` | All traceability operations (D1–D9 markers, DEGRADED contract) |
| `src/assets/commands/code-review.mds` | Step 0b (COMPLIANCE_SKILL_INSTALLED resolution), Phase 1 regulated-surface gate, Git COMPLIANCE field |
| `src/assets/commands/resolve.mds` | Phase 1b (fetch-review-threads), Phase 9b (resolve-review-threads), Phase 9c (check-merge-readiness) |
| `src/assets/commands/plan.mds` | COMPLIANCE_SKILL_INSTALLED gate for compliance Design agent and mandatory issue linking |
| `src/assets/commands/implement.mds` | COMPLIANCE_SKILL_INSTALLED resolution, Git setup-task COMPLIANCE field |
| `src/assets/commands/release.md` | Phase 1c (COMPLIANCE_SKILL_INSTALLED), release evidence gathering, backlink-shipped-issues |
| `tests/compliance-e2e.test.ts` | S1–S20 end-to-end scenarios covering the full compliance lifecycle |
| `tests/build-mds.test.ts` | §14 (COMPLIANCE_SKILL_INSTALLED gate, spawn-scoped guard), §15 (review markers), §16 (resolve traceability) |

## Related

- **PF-015** — Unconditional convergence: `convergeComplianceArtifacts` applies this for both the disable path (two independent try/catch blocks) and the enable path (installSkillDir's own error handling prevents skipping the rule step).
- **PF-009** — Warn-not-throw: per-artifact failures in `convergeComplianceArtifacts` and `installSkillDir` are reported via the injected `warn` callback, never thrown.
- **PF-011** — Temp-sibling+rename: `installSkillDir` uses `{target}.tmp` to build the new skill directory tree before atomically swapping it into place.
- **ADR-013** — Pure helpers in `src/core/`, I/O orchestration in `src/targets/`: `compliance.ts` is pure; `compliance-install.ts` owns all I/O.
- **ADR-014** — Self-heal idiom: `normalizeComplianceFeature` self-heals absent/malformed manifest fields on read.
- **PF-002** — Body-instructed skill: external thread bodies are untrusted and must not drive agent behaviour.
- Feature knowledge: **installer-shadowing** — shadow resolution for SKILL.md and rule file follows `validateSkillShadow` / `validateRuleShadow` from the installer.
- Feature knowledge: **resolve-pipeline** — `/resolve` depends on `COMPLIANCE_SKILL_INSTALLED` for Phase 1b/9b/9c; resolution-summary.md format includes `## Third-Party Threads` section gated by this flag.
