# Plugin Manifest, Build, and Registry Consistency Audit

**Branch**: feat/project-knowledge-99 -> main
**Date**: 2026-03-14
**Scope**: Plugin manifests, marketplace registry, build distribution, CLI registration

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical blocking issues found.

### HIGH

**CLAUDE.md skill count is stale (31 vs actual 32)** - `/Users/dean/Sandbox/devflow/CLAUDE.md:47`
- Problem: Line 47 states `# 31 skills (single source of truth)` but `shared/skills/` contains 32 directories. The `knowledge-persistence` skill was added in commit `40b167b` on this branch without updating the count.
- Fix:
  ```
  # Before
  ├── shared/skills/          # 31 skills (single source of truth)
  # After
  ├── shared/skills/          # 32 skills (single source of truth)
  ```

**CLAUDE.md core/optional plugin split is wrong (9+8 vs actual 8+9)** - `/Users/dean/Sandbox/devflow/CLAUDE.md:15,49`
- Problem: Line 15 and line 49 state "9 core + 8 optional" but `src/cli/plugins.ts` marks `devflow-audit-claude` as `optional: true`, making the actual split 8 core + 9 optional.
  - Core (8): core-skills, specify, implement, code-review, resolve, debug, self-review, ambient
  - Optional (9): audit-claude, typescript, react, accessibility, frontend-design, go, java, python, rust
- Fix:
  ```
  # Before (lines 15, 49)
  9 core + 8 optional language/ecosystem
  # After
  8 core + 9 optional
  ```

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**devflow-audit-claude plugin.json agents array mismatch with CLI** - `/Users/dean/Sandbox/devflow/plugins/devflow-audit-claude/.claude-plugin/plugin.json:17` vs `/Users/dean/Sandbox/devflow/src/cli/plugins.ts:82`
- Problem: The `plugin.json` declares `"agents": []` but `plugins.ts` declares `agents: ['claude-md-auditor']`. The build script (`scripts/build-plugins.ts`) reads `plugin.json` to copy shared agents from `shared/agents/`. The CLI installer (`src/cli/utils/installer.ts`) reads `plugins.ts` to copy agents from the plugin's `agents/` directory. Since `claude-md-auditor` is a plugin-specific agent (already committed at `plugins/devflow-audit-claude/agents/claude-md-auditor.md`), both paths work correctly -- the build script has nothing to copy and the installer finds the file in the plugin directory.
- Impact: No functional bug. But the `plugin.json` is misleading about the plugin's agent dependencies. A developer reading plugin.json would incorrectly conclude this plugin has no agents.
- Fix: Add `"agents": ["claude-md-auditor"]` to `plugin.json`. The build script already handles missing agents gracefully (it prints an error but continues).

**Three plugin.json files missing standard metadata fields**
- `/Users/dean/Sandbox/devflow/plugins/devflow-ambient/.claude-plugin/plugin.json`
- `/Users/dean/Sandbox/devflow/plugins/devflow-audit-claude/.claude-plugin/plugin.json`
- `/Users/dean/Sandbox/devflow/plugins/devflow-self-review/.claude-plugin/plugin.json`
- Problem: These three plugins lack `homepage`, `repository`, `license`, and `keywords` fields that all other 14 plugins include.
- Fix: Add the standard fields:
  ```json
  "homepage": "https://github.com/dean0x/devflow",
  "repository": "https://github.com/dean0x/devflow",
  "license": "MIT",
  "keywords": [...]
  ```

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Marketplace descriptions diverge from plugin.json descriptions (13 of 17 plugins)** - `/Users/dean/Sandbox/devflow/.claude-plugin/marketplace.json`
- Problem: The marketplace uses shorter, parenthesized summaries while plugin.json uses longer, dash-separated descriptions. A third variant exists in `src/cli/plugins.ts` (used by `devflow list`). Examples:
  - `devflow-specify`:
    - marketplace.json: "Interactive feature specification - creates well-defined GitHub issues"
    - plugin.json: "Interactive feature specification - creates well-defined GitHub issues through requirements exploration and clarification"
    - plugins.ts: "Interactive feature specification"
  - Only 4 plugins have matching descriptions across marketplace and plugin.json: `devflow-debug`, `devflow-self-review`, `devflow-ambient`, `devflow-audit-claude`.
- Impact: Not a functional issue. But three divergent description sources makes maintenance error-prone.
- Fix: Consider having the build script validate description consistency, or choose plugin.json as the canonical source and derive shorter versions programmatically.

### LOW

**Dual source of truth for plugin metadata (plugin.json vs plugins.ts)** - Multiple files
- Problem: Plugin metadata exists in two independent sources:
  1. `plugin.json` (used by build script for shared asset distribution and by Claude plugin system)
  2. `DEVFLOW_PLUGINS` in `plugins.ts` (used by CLI installer for deduplication and installation)
  These can drift independently. Currently they are in sync for skills and agents (except the audit-claude agents issue above).
- Impact: Future changes to one source may not be reflected in the other.
- Fix: Consider generating `plugins.ts` data from `plugin.json` files at build time, or adding a CI validation step.

---

## Verified Correct

The following areas passed all consistency checks:

### 1. Skills Coverage (32/32)
All 32 shared skills in `shared/skills/` are referenced by at least one plugin manifest. No plugin references a skill that does not exist.

| Shared Skill | Referenced By |
|-------------|--------------|
| `accessibility` | devflow-accessibility |
| `agent-teams` | devflow-code-review, devflow-implement, devflow-resolve, devflow-debug, devflow-specify |
| `ambient-router` | devflow-ambient |
| `architecture-patterns` | devflow-code-review |
| `complexity-patterns` | devflow-code-review |
| `consistency-patterns` | devflow-code-review |
| `core-patterns` | devflow-core-skills, devflow-self-review |
| `database-patterns` | devflow-code-review |
| `dependencies-patterns` | devflow-code-review |
| `docs-framework` | devflow-core-skills |
| `documentation-patterns` | devflow-code-review |
| `frontend-design` | devflow-frontend-design |
| `git-safety` | devflow-core-skills, devflow-debug |
| `git-workflow` | devflow-core-skills |
| `github-patterns` | devflow-core-skills |
| `go` | devflow-go |
| `implementation-patterns` | devflow-implement, devflow-resolve |
| `input-validation` | devflow-core-skills |
| `java` | devflow-java |
| `knowledge-persistence` | devflow-code-review, devflow-implement, devflow-resolve, devflow-debug |
| `performance-patterns` | devflow-code-review |
| `python` | devflow-python |
| `react` | devflow-react |
| `regression-patterns` | devflow-code-review |
| `review-methodology` | devflow-code-review |
| `rust` | devflow-rust |
| `search-first` | devflow-core-skills |
| `security-patterns` | devflow-code-review, devflow-resolve |
| `self-review` | devflow-implement, devflow-self-review |
| `test-driven-development` | devflow-core-skills |
| `test-patterns` | devflow-core-skills, devflow-code-review |
| `typescript` | devflow-typescript |

### 2. Agents Coverage (10/10 shared + 1 plugin-specific)
All 10 shared agents are referenced by at least one plugin. The `claude-md-auditor` plugin-specific agent exists in its plugin directory and is tracked in git.

### 3. Command Files
All plugins with commands have the corresponding `.md` files:

| Plugin | Commands | Teams Variants |
|--------|----------|---------------|
| devflow-specify | specify.md | specify-teams.md |
| devflow-implement | implement.md | implement-teams.md |
| devflow-code-review | code-review.md | code-review-teams.md |
| devflow-resolve | resolve.md | resolve-teams.md |
| devflow-debug | debug.md | debug-teams.md |
| devflow-self-review | self-review.md | (none by design) |
| devflow-ambient | ambient.md | (none by design) |
| devflow-audit-claude | audit-claude.md | (none by design) |

No orphaned teams variants. All teams files have matching base files.

### 4. Build System
`npm run build` completes successfully with zero errors:
- TypeScript compilation: clean
- Skill distribution: 45 skill copies across 17 plugins
- Agent distribution: 20 agent copies across 17 plugins
- Total: 32 unique skills, 10 unique agents

### 5. Gitignore
- `plugins/*/skills/` correctly gitignored (generated copies)
- All 10 shared agent filenames individually gitignored under `plugins/*/agents/`
- Plugin-specific agent `claude-md-auditor.md` is NOT gitignored (correctly tracked)

### 6. CLI Registration
All 17 plugins registered in `DEVFLOW_PLUGINS` array in `src/cli/plugins.ts`.
CLI commands registered in `cli.ts`: init, uninstall, list, ambient, memory, skills.

### 7. Marketplace Registry
All 17 plugins listed in `.claude-plugin/marketplace.json` with correct `source` paths.

### 8. Version Consistency
All manifests synchronized at `1.5.0`:
- `package.json`: 1.5.0
- All 17 `plugin.json` files: 1.5.0
- All 17 marketplace entries: 1.5.0

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | 0 | 1 | 1 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The two HIGH-severity blocking issues are documentation errors in CLAUDE.md (stale skill count, wrong core/optional split) introduced by changes on this branch. These should be fixed before merge. The Should-Fix items (audit-claude plugin.json agents array, missing metadata on 3 plugins) are minor consistency gaps that would be best addressed while the codebase is being modified.
