---
feature: compliance-plugin
name: Compliance Plugin & Installed-Gate Pattern
description: "Use when adding the devflow-compliance optional plugin to a project, implementing plugin-presence gates for future optional plugins, modifying the compliance reviewer/designer/coder integration surfaces, changing the CLAUDE.md Frameworks declaration convention, or adding new framework references to the compliance skill. Keywords: compliance, GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX, compliance_gate, COMPLIANCE_ENABLED, plugin-presence gate, optional plugin, regulated data, audit trail."
category: component-patterns
directories:
  - src/assets/skills/compliance
  - src/assets/rules/compliance.md
  - src/assets/commands/_partials/_compliance.mds
  - src/core/plugins.ts
  - src/assets/commands/code-review.mds
  - src/assets/commands/plan.mds
  - src/assets/commands/implement.mds
created: 2026-07-18
updated: 2026-07-19
---

# Compliance Plugin & Installed-Gate Pattern

## Overview

The `devflow-compliance` optional plugin adds regulatory compliance analysis (GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX) to three workflow commands: `/code-review`, `/plan`, and `/implement`. It is the **first optional-plugin integration** in devflow to gate its behavior entirely inside command markdown — no deterministic helper scripts, no subprocess calls, no LLM — making it the canonical template for future optional-plugin gates (applies ADR-007).

The gate (`compliance_gate` partial) is resolved once per run and cached as `COMPLIANCE_ENABLED`. Downstream agents receive this flag as an input field; the orchestrator decides whether compliance work happens, not the agents themselves. The compliance skill is intentionally body-instructed inside coder.md rather than frontmatter-preloaded, so the full skill payload only loads when the task actually touches regulated surface (avoids PF-002).

## Core Responsibilities

The compliance plugin does three things, each in a distinct layer:

- **Rule** (`src/assets/rules/compliance.md`): Always-on, global reminder installed for any project that has the plugin. Keeps compliance mindset active during quick edits that don't trigger a full workflow.
- **Skill** (`src/assets/skills/compliance/SKILL.md` + `references/`): Loaded on-demand by agents when they detect regulated-data surface. Provides the full control catalog, severity guidance, framework-specific reference files, and the clean-report contract.
- **Gate** (`src/assets/commands/_partials/_compliance.mds`): Orchestrator-only, resolved once per command run. Controls whether the compliance focus/reviewer/designer is activated downstream.

## Plugin-Presence Gate (`compliance_gate`)

The `compliance_gate` partial (`src/assets/commands/_partials/_compliance.mds`) is imported by all three host commands. It resolves `COMPLIANCE_ENABLED` before Phase 1 of each command and must not be called more than once per run.

**4-step resolution (verified against `_compliance.mds`):**

**Step 1 — Manifest (scope-aware):** Read `{worktree}/.devflow/manifest.json`. If it parses and its `plugins` array contains `"devflow-compliance"`, proceed to Step 2 using local-scope paths. If `"devflow-compliance"` is absent, stop with `COMPLIANCE_ENABLED=false`. If the file is absent/unreadable, repeat with `~/.devflow/manifest.json`. If both are absent, fall through to Step 3.

**Step 2 — Asset verify (self-healing):** Uninstall never rewrites the `plugins` array, so a manifest hit may be stale. Verify the skill asset exists:
- Local scope: `{worktree}/.claude/skills/devflow:compliance/SKILL.md`
- Home scope: `~/.claude/skills/devflow:compliance/SKILL.md`

Missing asset → `COMPLIANCE_ENABLED=false`, stop. Asset present → `COMPLIANCE_ENABLED=true`, proceed to Step 4.

**Step 3 — No-manifest fallback:** Check whether either installed-rule file exists:
- `~/.claude/rules/devflow/compliance.md`
- `{worktree}/.claude/rules/devflow/compliance.md`

Neither exists → `COMPLIANCE_ENABLED=false`, stop. Either exists → `COMPLIANCE_ENABLED=true`, proceed to Step 4.

**Step 4 — Project opt-out:** Only reached when `COMPLIANCE_ENABLED=true`. Read `{worktree}/CLAUDE.md`. If a `## Compliance` section exists and its body contains a `Frameworks: none` line, set `COMPLIANCE_ENABLED=false`.

**Constraints:** Silent (no user-visible output), read-only (never writes files), ≤3 file reads total, no subprocess, no LLM call. Resolved once; reused for every worktree in multi-worktree flows.

## Integration Surfaces

### `/code-review`

The `compliance_gate()` call appears near the top of `code-review.mds` (after Phase 0 git context). When `COMPLIANCE_ENABLED=true`, a `compliance` focus is appended to `REVIEWER_LIST` for every worktree. The `compliance` Reviewer loads `devflow:compliance` and applies the clean-report contract, scope boundary rules, and the framework mapping from the declared `## Compliance` section in the project CLAUDE.md.

Reviewer cap: 8 always-active + up to 11 diff-driven conditional + 1 `compliance` when `COMPLIANCE_ENABLED` = **max 20 total per worktree** (verified against `code-review.mds`).

### `/plan`

The `compliance_gate()` call appears in the gap-analysis phase of `plan.mds`. When `COMPLIANCE_ENABLED=true`:
- Single-issue tasks: spawn **5** gap-analysis Designers (vs. 4); the 5th has `Focus: compliance`
- Multi-issue tasks: spawn **7** gap-analysis Designers (vs. 6)

The compliance focus maps to gap-analysis SKILL.md §7, which detects regulatory gaps that security doesn't cover: missing audit trails on regulated mutations, PII flows without retention/erasure specification, missing encryption requirements, sensitive data in observability, IaC exposure, and self-approval flows (SOX/SOC 2 CC8.1).

### `/implement`

`implement.mds` calls `compliance_gate()` during Phase 1 setup. The `COMPLIANCE_ENABLED` value flows into all **8 Coder spawn templates** as `COMPLIANCE: {enabled|(none)}`. All 3 fix templates (validation-fix, alignment-fix, qa-fix) are symmetric: `COMPLIANCE` appears after `SCOPE` in every fix template block.

| Template | Context |
|----------|---------|
| SINGLE_CODER | Primary implementation |
| SEQUENTIAL Phase 1 | First of multi-phase chain |
| SEQUENTIAL Phase 2+ | Continuation Coders |
| PARALLEL Coder 1 | Independent subtask 1 |
| PARALLEL Coder 2 | Independent subtask 2 |
| validation-fix Coder | Fix validation failures |
| alignment-fix Coder | Fix evaluator misalignments |
| qa-fix Coder | Fix QA test failures |

**Backward-compatibility note:** `/resolve` and `/dynamic-build` spawners do NOT pass `COMPLIANCE` to Coder. The coder.md contract treats an absent `COMPLIANCE` field as a no-op — no compliance work is triggered. This means the compliance gate is `/implement`-only; adding it to resolve/dynamic-build is a future integration decision.

**Coder behavior when `COMPLIANCE: enabled`:** The Coder conditionally invokes `Skill(skill="devflow:compliance")` when (a) the project CLAUDE.md declares frameworks in a `## Compliance` section OR (b) the task touches regulated surface — data models, auth flows, logging/observability, IaC, retention logic. The relevant `references/{framework}.md` files are loaded alongside the main skill. This is body-instructed, not frontmatter-preloaded (avoids PF-002).

## Skill Contracts

### Clean-Report Contract

When a diff/design has no regulated-data surface — no PII/PHI/payment fields, no sensitive data in logs, no IaC, no auth/audit/retention changes — the compliance Reviewer/Designer emits **zero findings** with a single-line "no compliance-relevant surface detected" note. Never manufacture compliance findings. This contract is defined in `src/assets/skills/compliance/SKILL.md` (not in reviewer.md frontmatter).

### Scope Boundary vs. Security Lens

Compliance covers: retention, erasure/data-subject rights, audit-trail completeness (actor/purpose fields), segregation of duties, framework mapping, IaC exposure. It does **not** re-raise security lens findings (injection, secret handling, authN/Z). When a gap straddles both, reference the security finding via framework mapping rather than duplicating it.

### Synthesizer Merge-Don't-Boost Rule

When a compliance finding and a security finding point to the **same file:line or design element**, the Synthesizer merges them into one finding rather than applying the usual multi-reviewer confidence boost. The same gap seen from two regulatory angles is one issue, not corroboration.

### CLAUDE.md `## Compliance` Declaration Convention

| CLAUDE.md state | Behavior |
|----------------|---------|
| `Frameworks: GDPR, SOC 2` | Apply generic controls + load `references/gdpr.md` and `references/soc2.md` |
| `Frameworks: none` | All compliance integrations disabled for this project (opt-out) |
| `## Compliance` absent | Generic controls only; suggest declaring (LOW severity, at most once) when regulated data is clearly present |
| Unknown framework name | Generic controls + explicit coverage-gap note; never fabricate framework specifics |

### Triager Disposition Default

Compliance issues are often policy/architecture-level (missing retention policy, absent audit-trail design, IaC control gap) — the Triager defaults to `FIX_SEPARATE` or `TECH_DEBT`. The exception: a finding that is directly code-local (a specific log statement, a missing field, an isolated function) and contained within the diff's blast radius may be assigned `FIX_NOW`.

## Rule Characteristics

`src/assets/rules/compliance.md` has `paths: []` frontmatter — making it a **global** rule that activates on every file, not path-scoped like the language rules (TypeScript uses `paths: ["**/*.ts", "**/*.tsx"]`). This is the **first optional plugin-scoped rule with `paths: []`**; the four core rules also have `paths: []` but come from `devflow-core-skills` (always installed). Compliance being global is intentional: regulated data surfaces across all file types (IaC, SQL, config files, not just application code).

## Framework Reference Edition Policy

The compliance skill and its reference files use specific edition identifiers. Always cite these when adding or modifying framework content — do not regress to older editions:

| Framework | Authoritative edition | Key notes |
|-----------|----------------------|-----------|
| ISO 27001 | ISO/IEC 27001:2022 + Amd 1:2024 (e.g., A.5.12, A.8.15, A.8.24, A.8.25) | Amd 1:2024 adds climate-action guidance; Annex A control numbering is unchanged from the 2022 edition. Never cite 2013 Annex A IDs (A.12.x, etc.). |
| PCI DSS | PCI DSS v4.0.1 (June 2024 — v4.0 is retired; sub-requirement numbering unchanged) | Key sub-reqs: 3.3.1.x (SAD non-storage), 3.5.1 (PAN must be rendered unreadable), 3.2.1 (need-based retention). PCI DSS sets **no fixed retention period** — never write a numeric "3-year" PCI retention anchor. |
| GDPR | Articles 17, 25, 30, 32, 33 | |
| HIPAA | §164.312 safeguards | The 6-year figure is required-documentation retention under §164.530(j) — it is NOT a PHI retention mandate. State law governs PHI retention periods. |
| SOC 2 | AICPA TSC CC6/CC7/CC8.1 | |
| SOX | ITGC, §802 | |

**Watch items — verified not in force as of 2026-07-19; do not cite as active requirements:**

- **HIPAA Security Rule final rule**: Jan 2025 NPRM remains in proposed status; no final rule issued.
- **NIST SSDF v1.2**: draft published Dec 2025; not yet finalized.
- **GDPR Digital Omnibus Art. 30(5)**: proposed SME processing-records threshold change; not adopted.
- **OWASP ASVS 5.0.1**: anticipated patch release; 5.0.0 remains current.

## Anti-Patterns

**Reinstantiating the gate per worktree.** The `compliance_gate()` call is designed for once-per-run invocation. Its result must be carried to every worktree in multi-worktree flows — do not re-resolve it inside per-worktree loops. This is how `code-review.mds` handles it: gate before Phase 1, carry `COMPLIANCE_ENABLED` through Phase 2's per-worktree reviewer construction.

**Frontmatter-preloading the compliance skill in agents.** The compliance skill (~138 lines + 8 reference files) should not be added to agent `skills:` frontmatter. It is intentionally body-instructed so it only loads when there is genuine regulated-data surface. Adding it to frontmatter would bloat every agent invocation regardless of whether compliance is relevant (avoids PF-002 — now test-enforced by `tests/build.test.ts`).

**Letting Coder re-verify plugin installation.** The compliance field arriving as `COMPLIANCE: enabled` is the Coder's sole signal. The Coder must not re-read the manifest or check skill files — that check already happened in the orchestrator's gate step. Duplicate verification adds reads without safety benefit.

**Adding compliance findings to the security reviewer's output.** The scope boundary is strict: compliance findings (retention gaps, audit completeness, segregation of duties) belong in the compliance reviewer's report only. Cross-posting them into security creates duplicates that the Synthesizer merge-don't-boost rule cannot fully resolve.

**Citing outdated framework editions.** Using ISO 27001:2013 control IDs (e.g., A.12.x) instead of ISO 27001:2022 Annex A IDs (e.g., A.8.x), or PCI DSS v3.x requirement numbers, produces incorrect compliance references. Always use the authoritative editions in the table above.

## Gotchas

**Stale manifest hit.** `devflow uninstall` does not rewrite the `manifest.json` `plugins` array. A project that had `devflow-compliance` installed and then uninstalled will still show `"devflow-compliance"` in the manifest — Step 2's asset verify is what catches this and prevents false-positive `COMPLIANCE_ENABLED=true`. Never short-circuit Step 2 when a manifest hit is found.

**`Frameworks: none` is not the same as an absent `## Compliance` section.** An absent section triggers generic controls + a one-time suggestion to declare frameworks when regulated data is present. `Frameworks: none` is an explicit opt-out that disables the gate entirely (Step 4). Only write `Frameworks: none` when a project actively does not want any compliance analysis.

**Post-namespace skills must NOT get bare `LEGACY_SKILLS_V2X` entries.** `LEGACY_SKILL_NAMES` (the exported union of `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, and `LEGACY_SKILLS_V2X`) is a frozen list covering only the 39 skills that existed before the namespace migration (commit dcecda3, 2026-03-30). `tests/skill-namespace.test.ts` enforces this with an inverse guard (Assertion B) that fails the test if any post-namespace skill — including `compliance` — appears bare in the list. The `'compliance'` bare entry has been removed. Do not add bare entries for any skill born after the namespace migration.

**`_compliance.mds` counts toward the partial assertion.** `tests/build-mds.test.ts` asserts `src/assets/commands/_partials/` contains exactly **10** partials. Adding another partial requires updating this count (was 9 before `_compliance.mds` was added).

**Test allowedOptional set must be updated.** `tests/plugins.test.ts` has an `allowedOptional` Set that gates which plugins are permitted to have `optional: true`. Adding a new optional plugin requires adding its name to this Set, or the test fails.

**`DEVFLOW_PLUGINS` skills+rules must stay in sync with installed files.** `tests/build.test.ts` asserts that every plugin entry's `skills` and `rules` arrays in `DEVFLOW_PLUGINS` (`src/core/plugins.ts`) are consistent with files present in `src/assets/`. When adding a skill or rule, declare it in the registry entry or the sync test fails.

**COMPLIANCE_ENABLED guard in `build-mds.test.ts`.** `tests/build-mds.test.ts` asserts that all three compiled host commands (code-review, plan, implement) contain the string `COMPLIANCE_ENABLED`. If you rename the gate variable or restructure the `_compliance.mds` partial, this test will fail. Update the guard literal to match.

**Frontmatter skills guard in `build.test.ts` enforces PF-002.** `tests/build.test.ts` asserts that no `src/assets/agents/*.md` file lists `devflow:compliance` in its frontmatter `skills:` block. This guard exists specifically to prevent accidental frontmatter-preloading — adding the compliance skill to agent frontmatter triggers the re-entrancy guard (PF-002) and silently produces no output. The test parses only the YAML frontmatter block, not body text, so body-instruction (the correct pattern) passes the guard.

## Key Files

- `src/assets/commands/_partials/_compliance.mds` — the `compliance_gate` MDS partial; imported by all 3 host commands; defines the full 4-step gate resolution
- `src/assets/skills/compliance/SKILL.md` — main compliance skill; 6 control categories, severity table, framework mapping, checklist, reference index, and clean-report contract
- `src/assets/skills/compliance/references/` — 8 reference files: `gdpr.md`, `hipaa.md`, `pci-dss.md`, `soc2.md`, `iso-27001.md`, `sox.md`, `detection.md`, `sources.md`
- `src/assets/rules/compliance.md` — global always-on rule (`paths: []`); 6 compliance reminders
- `src/core/plugins.ts` — `devflow-compliance` entry in DEVFLOW_PLUGINS; declares `skills: ["compliance"]`, `rules: ["compliance"]`, no agents
- `src/assets/agents/coder.md` — body-instructs compliance skill invocation (line ~75); COMPLIANCE field contract
- `src/assets/agents/reviewer.md` — compliance activation row is condition-only (the clean-report contract lives in SKILL.md, not in this file's frontmatter or the row text)
- `src/assets/agents/synthesizer.md` — merge-don't-boost rule for compliance+security overlaps (line ~214, ~315)
- `src/assets/agents/triager.md` — compliance disposition default (FIX_SEPARATE/TECH_DEBT) at line ~63
- `src/assets/agents/designer.md` — compliance focus as the 5th gap-analysis Designer
- `src/assets/skills/gap-analysis/SKILL.md` — §7 compliance detection patterns (regulatory gaps, IaC, segregation of duties)
- `src/core/plugins.ts` — `DEVFLOW_PLUGINS` registry entry; `LEGACY_SKILL_NAMES` frozen list (39 pre-namespace skills; `compliance` is NOT in this list — it is a post-namespace skill)
- `tests/skill-namespace.test.ts` — Assertion A (pre-namespace skills need bare entries) + Assertion B inverse guard (post-namespace skills must not appear bare in `LEGACY_SKILL_NAMES`)
- `tests/skill-references.test.ts` — allowlist extended to the frozen historical pre-namespace skill set
- `tests/build.test.ts` — skills+rules sync tests (parameterized via `it.each`); frontmatter compliance guard (enforces PF-002)
- `tests/build-mds.test.ts` — COMPLIANCE_ENABLED wiring guard for all 3 compiled host commands

## Related

- ADR-007: Gate is command-markdown only — no deterministic helper scripts; `compliance_gate` follows this exactly
- ADR-010: `installViaFileCopy` sole install path — plugin registration is pure registry data; `devflow-compliance` uses the standard install path
- PF-002: Compliance skill is body-instructed in coder.md, deliberately NOT frontmatter-preloaded — now test-enforced by `tests/build.test.ts`
- PF-011: `build-mds.ts` uses tmp+rename to avoid delete-then-write ENOENT race; error-path now cleans orphaned `.tmp` files on `renameSync` failure
- ADR-003: End-state docs — no tombstone comments when modifying compliance references
- Feature knowledge: `resolve-pipeline` — Triager disposition rules for compliance issues
- Feature knowledge: `installer-shadowing` — install/uninstall mechanics that explain why Step 2 asset verify is necessary
