# Code Review Summary

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-07_2319
**Reviewers**: 9 specialists (security, architecture, performance, complexity, consistency, regression, testing, typescript, documentation)

---

## Merge Recommendation: **CHANGES_REQUESTED**

The PR introduces a well-architected `/plan` command with thoughtful design exploration and gap analysis capabilities. However, **critical metadata drift** across plugin manifests, missing test coverage for the new plugin, and several security boundary validation issues require fixes before merge. These are straightforward corrections that will bring manifests into alignment with actual behavior.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| **Blocking** (in your changes) | 1 | 6 | 0 | - |
| **Should Fix** (code you touched) | 0 | 3 | 5 | - |
| **Pre-existing** (legacy issues) | 0 | 1 | 6 | 3 |

**Total Blocking Issues**: 7 (1 CRITICAL, 6 HIGH)

---

## Blocking Issues (Must Fix Before Merge)

### CRITICAL

**1. Stale agents in devflow-implement plugin manifest** - Multiple files
- **Confidence**: 95% (flagged by Architecture, Consistency, Regression, Testing)
- **Location**: `plugins/devflow-implement/.claude-plugin/plugin.json:20-22`, `src/cli/plugins.ts:70`
- **Problem**: The implement command removed exploration/planning phases (Skimmer, Synthesizer agents are no longer spawned), but both plugin.json and plugins.ts still declare them in the agents array. This means the build system will unnecessarily copy these agents into the implement plugin directory and creates dead weight that violates the clean separation principle.
- **Impact**: Stale metadata that violates project conventions. Users reading the manifest will misunderstand what agents the command uses.
- **Fix**: Remove `"skimmer"` and `"synthesizer"` from:
  - `plugins/devflow-implement/.claude-plugin/plugin.json` agents array
  - `devflow-implement` entry in `src/cli/plugins.ts` agents array

---

### HIGH

**2. Stale description in devflow-implement plugin.json** - `plugins/devflow-implement/.claude-plugin/plugin.json:3`
- **Confidence**: 92% (Regression review)
- **Problem**: Description still reads "orchestrates exploration, planning, coding, validation, and PR creation" but exploration and planning were moved to `/plan`. The plugins.ts version was updated but plugin.json was not.
- **Fix**: Update to match plugins.ts: "Complete task implementation workflow - accepts plan documents, issues, or task descriptions"

**3. Missing `worktree-support` skill in devflow-plan plugin.json** - `plugins/devflow-plan/.claude-plugin/plugin.json:24-29`
- **Confidence**: 98% (flagged by Architecture + Consistency)
- **Problem**: Every other plugin using the Git agent (implement, code-review, resolve, debug, self-review, ambient) includes `worktree-support` in skills. The new devflow-plan plugin uses Git but omits it. The Designer agent explicitly declares it in frontmatter. While skills are universally installed, the manifest must be self-documenting and consistent.
- **Fix**: Add `"worktree-support"` to skills array in `plugin.json` and mirror in `src/cli/plugins.ts`

**4. Path traversal via arbitrary file read in /implement plan document handling** - `plugins/devflow-implement/commands/implement.md:51-56`
- **Confidence**: 82% (Security review)
- **Problem**: The `/implement` command reads an `.md` file path from $ARGUMENTS without validating that the path is within the project root or .docs/design/ directory. A user could pass `/etc/passwd`, `~/.ssh/id_rsa`, or `../../.env` and the agent will read and process it, potentially exposing sensitive content in agent context.
- **Fix**: Add explicit path validation:
  ```
  **Plan Document Handling** (when $ARGUMENTS is a path ending in `.md`):
  0. Validate the path is relative and within the project root (reject absolute paths and paths containing `..`)
  1. Verify the file exists and is under `.docs/design/` or the project working directory
  ```

**5. Stale description drift across multiple files for devflow-implement** - `plugins/devflow-implement/.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:36`, `plugins/devflow-implement/README.md:3`
- **Confidence**: 92% (Consistency review)
- **Problem**: Description inconsistencies across manifests:
  - plugin.json: "orchestrates exploration, planning, coding, validation, and PR creation"
  - marketplace.json: "Complete task implementation workflow with exploration, planning, and coding"
  - README.md: "Orchestrates exploration, planning, coding, validation, and PR creation"
  - plugins.ts (updated): "Complete task implementation workflow - accepts plan documents, issues, or task descriptions"
- **Fix**: Update all three files to match plugins.ts. Remove "exploration, planning" from all descriptions.

**6. Missing test assertions for devflow-plan plugin dependency declarations** - `tests/plugins.test.ts`
- **Confidence**: 92% (Testing review)
- **Problem**: The PR introduces a new `devflow-plan` plugin with a new `designer` agent and new skills (`gap-analysis`, `design-review`). The project has an established pattern of testing cross-plugin dependencies (see tests for devflow-implement and devflow-ambient), but devflow-plan has no corresponding tests. Additionally, devflow-ambient was updated with `designer` and `gap-analysis`/`design-review` skills but these dependency updates are not tested.
- **Impact**: Regressions in plugin manifests (e.g., accidentally removing `designer` from ambient) would go undetected.
- **Fix**: Add test cases following established pattern:
  ```typescript
  it('devflow-plan declares designer agent and gap-analysis/design-review skills', () => {
    const plan = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-plan');
    expect(plan).toBeDefined();
    expect(plan!.agents).toContain('designer');
    expect(plan!.agents).toContain('git');
    expect(plan!.agents).toContain('skimmer');
    expect(plan!.agents).toContain('synthesizer');
    expect(plan!.skills).toContain('gap-analysis');
    expect(plan!.skills).toContain('design-review');
    expect(plan!.skills).toContain('patterns');
    expect(plan!.skills).toContain('knowledge-persistence');
  });

  it('devflow-ambient declares designer agent and plan-related skill dependencies', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    expect(ambient!.agents).toContain('designer');
    expect(ambient!.skills).toContain('gap-analysis');
    expect(ambient!.skills).toContain('design-review');
  });
  ```

**7. Ambient skill test coverage outdated** - `tests/integration/ambient-activation.test.ts:101-112`, `tests/integration/ambient-activation.test.ts:194-204`
- **Confidence**: 85% (Testing review)
- **Problem**: The router was updated to add `devflow:design-review` to PLAN/GUIDED and PLAN/ORCHESTRATED skill lists, but the integration tests still expect only the old skill set. The tests use soft-assertion (logging only, not failing), so regressions would go undetected.
- **Fix**: 
  - Line 102: Update `expected` array to include `'design-review'`: `['test-driven-development', 'patterns', 'software-design', 'security', 'design-review']`
  - Line 204: Update `required` array to include `'design-review'`: `['plan:orch', 'patterns', 'design-review']`

---

## Should-Fix Issues (Code You Touched)

### HIGH

**1. No integrity validation of plan document consumed by /implement** - `plugins/devflow-implement/commands/implement.md:51-56`
- **Confidence**: 80% (Security review)
- **Problem**: The `/implement` command reads a plan document and trusts its content entirely. There is no validation that the document was actually produced by `/plan` or that it has not been tampered with. A compromised file could inject arbitrary instructions into the Coder agent's EXECUTION_PLAN, controlling what code gets written.
- **Fix**: Add validation for YAML frontmatter:
  ```
  - Verify frontmatter contains `type: design-artifact` and `version: 1`
  - Verify `execution-strategy` is one of: SINGLE_CODER, SEQUENTIAL_CODERS, PARALLEL_CODERS
  - Verify `context-risk` is one of: LOW, MEDIUM, HIGH, CRITICAL
  - Warn user if `status` is not APPROVED
  ```

**2. Issue number injection via YAML frontmatter** - `plugins/devflow-implement/commands/implement.md:54-55`
- **Confidence**: 80% (Security review)
- **Problem**: The `issue` field from plan document YAML is passed to the Git agent as ISSUE_INPUT and used in `gh issue view {number}` commands without explicit validation. If hand-edited, the field could contain shell metacharacters.
- **Fix**: In the Git agent's `fetch-issue` operation, add explicit validation that ISSUE_INPUT is a positive integer before use in any shell command. Document that the `issue` frontmatter field must be a bare integer.

**3. Sequential issue fetching in `fetch-issues-batch` operation** - `shared/agents/git.md:~line 93-103`
- **Confidence**: 85% (Performance review)
- **Problem**: The new `fetch-issues-batch` operation describes fetching each issue via individual `gh issue view {number}` calls in a loop. For multi-issue planning, this creates N sequential GitHub API round-trips instead of a single batch fetch. At 3 issues the impact is minor, but the design supports arbitrary batch sizes without stated upper bounds (~300-800ms per call overhead).
- **Fix**: Use a single GraphQL batch call instead:
  ```bash
  gh api graphql -f query='
    query($ids: [ID!]!) {
      nodes(ids: $ids) { ... on Issue { number title body labels { nodes { name } } } }
    }' -f ids="[...]"
  ```
  Also add explicit upper bound (e.g., max 10 issues) to prevent unbounded batches.

### MEDIUM

**4. CLAUDE.md missing `/specify` deprecation notice** - `CLAUDE.md:141`
- **Confidence**: 85% (Documentation + Consistency reviews)
- **Problem**: The README.md marks `/specify` as deprecated, and the command files include deprecation blockquotes, but CLAUDE.md (the primary developer reference) lists `/specify` without any deprecation marker. Agents reading CLAUDE.md won't know it's deprecated.
- **Fix**: Add deprecation annotation:
  ```markdown
  - `/specify` — _(deprecated: use /plan)_ Skimmer + Explore + Synthesizer + Plan + Synthesizer → GitHub issue
  ```

**5. Implement example uses non-canonical timestamp in design artifact path** - `plugins/devflow-implement/commands/implement.md` (multiple occurrences)
- **Confidence**: 90% (Documentation review)
- **Problem**: Example path `.docs/design/42-jwt.2026-04.md` uses truncated timestamp `2026-04` instead of canonical `YYYY-MM-DD_HHMM` format. Appears 4 times across two files.
- **Fix**: Replace with realistic example: `.docs/design/42-jwt-auth.2026-04-07_1430.md`

**6. CLAUDE.md `/implement` description omits Validator agent** - `CLAUDE.md:143`
- **Confidence**: 85% (Documentation review)
- **Problem**: Description lists "Git + Coder + Simplifier + Scrutinizer + Evaluator + Tester" but actual pipeline uses Validator agent (Phases 3, 6). This line was modified in this PR, so fixing the omission is appropriate.
- **Fix**: Update to: "Git + Coder + Validator + Simplifier + Scrutinizer + Evaluator + Tester → PR (accepts plan documents, issues, or task descriptions)"

**7. `/implement` lost exploration/planning capability without warning** - `plugins/devflow-implement/commands/implement.md:50-58`
- **Confidence**: 82% (Architecture review)
- **Problem**: The previous `/implement` was a self-contained lifecycle command. The refactored version removes all exploration and planning phases. When invoked with just a task description and no prior plan, the Coder operates without exploration context. This is an intentional design change but the fallback behavior may produce lower quality implementations.
- **Fix**: Add a note in Phase 2 of implement.md: "For best results when no plan document is provided, run `/plan` first to produce a design artifact, then pass it to `/implement`." This makes the behavioral change explicit.

---

## Suggestions (Lower Confidence)

The following issues have 60-79% confidence and are informational only:

- **Multi-issue parsing could accept non-numeric tokens** - `plugins/devflow-plan/commands/plan.md:22-27` (65%) — The parsing says "space-separated #N tokens" but doesn't specify handling of malformed tokens like `#abc`. The `gh` CLI would likely reject these, but explicit validation would be cleaner.

- **Design artifacts written without restricted file permissions** - `plugins/devflow-plan/commands/plan.md` Phase 15 (62%) — Artifacts written to `.docs/design/` without specifying file permissions. In shared environments, these could be readable/writable by others. Minor concern since they contain design plans, not secrets.

- **Gap analysis security focus could miss runtime-only vulnerabilities** - `shared/skills/gap-analysis/SKILL.md:68-81` (60%) — Security focus detection patterns are design-time only. Runtime concerns like timing attacks or side channels are not mentioned. Reasonable for design-level check.

- **Designer agent model assignment is `opus` for potentially lightweight analysis** - `shared/agents/designer.md:3` (65%) — Assigned highest-cost model for checklist-driven analysis. Follows project's established model strategy, likely intentional.

- **Synthesizer `design` mode confidence boosting math could overflow** - `shared/agents/synthesizer.md:~line 85` (62%) — With 6 designers boosting by 50%, cap at 100% is correct. Relies on LLM math without hard enforced ceiling.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

- **`/specify` is deprecated but not scheduled for removal** - Plugin still in registry (Architecture, 85%)
- **PF-002 (init handler monolith) exacerbated by new plugin** - Architectural concern (Architecture, 80%)
- **Implement-teams.md still contains exploration/planning teams reference** - Confirmed consistent upon review (Regression, 80%)
- **17-phase pipeline in plan.md is the most complex command** - Inherent to the problem domain (Complexity, 85%)
- **plan-teams.md amplifies pipeline complexity with structural duplication** - Follows established project pattern (Complexity, 88%)

### LOW

- **Non-null assertions on `find()` results in tests** - Pre-existing pattern (TypeScript, 82%)
- **LEGACY_SKILL_NAMES list continues unbounded growth** - Maintenance concern (Complexity, 65%)
- **Git agent operation count growing** - File at 324 lines (Complexity, 62%)

---

## Action Plan (Priority Order)

1. **Remove stale agents from devflow-implement** — 2 files (plugin.json, plugins.ts)
2. **Update descriptions across 4 files** — plugin.json, marketplace.json, README.md, CLAUDE.md
3. **Add worktree-support to devflow-plan manifests** — plugin.json, plugins.ts
4. **Add path validation for plan document reading** — implement.md
5. **Add plan document integrity checks** — implement.md
6. **Fix issue fetching performance** — git.md
7. **Add missing test assertions** — tests/plugins.test.ts
8. **Update ambient activation tests** — ambient-activation.test.ts (2 locations)
9. **Add deprecation notice to CLAUDE.md** — CLAUDE.md
10. **Fix example timestamps and agent list** — implement.md, CLAUDE.md

---

## Summary

The unified `/plan` command is well-architected with thoughtful design patterns (7-block pipeline, mandatory gates, Designer agent with gap/review modes). The architectural direction (plan-first workflow) is sound. However, metadata drift across plugin manifests, missing test coverage for the new plugin, and security boundary validation gaps require straightforward fixes. These corrections align manifests with actual behavior and close security boundaries without architectural changes.

**No CRITICAL security vulnerabilities found** — all flagged issues have clear mitigations. The PR is safe to merge after the 7 blocking issues are resolved.
