# Code Review Summary

**Branch**: feat/evaluator-rename-tester-agent → main
**Date**: 2026-04-03_0155
**Reviewers**: 9 agents (security, architecture, performance, complexity, consistency, regression, testing, typescript, documentation)

## Merge Recommendation: CHANGES_REQUESTED

This is a well-structured, high-quality PR that executes a clean architectural decomposition (Shepherd → Evaluator + Tester) with thorough integration and solid test coverage. The new QA skill follows established patterns. However, there are **3 actionable blocking issues** that must be fixed before merge: two in documentation (duplicate step number, stale skill count) and one in TypeScript (variable shadowing). An additional **3 architectural improvements** are recommended for code quality.

---

## Issue Summary by Category

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking Issues** | 0 | 4 | 5 | 0 | **9** |
| **Should-Fix Issues** | 0 | 0 | 3 | 0 | **3** |
| **Pre-existing Issues** | 0 | 0 | 2 | 0 | **2** |

---

## Blocking Issues (Must Fix)

### CRITICAL SEVERITY
None.

### HIGH SEVERITY (4 issues, multiple reviewers)

#### 1. Duplicate Step Number in Implement README (95% confidence)
**Location**: `plugins/devflow-implement/README.md:32-33`
**Found by**: Architecture, Consistency, Regression, Testing, Documentation reviewers

**Problem**: Steps 8 (Simplification) and 8 (PR Creation) have the same number. After inserting QA Testing as step 7 and renumbering Simplification to step 8, the subsequent "PR Creation" step was not renumbered.

**Fix**:
```markdown
# Line 33, change from:
8. **PR Creation** - Git agent creates pull request

# To:
9. **PR Creation** - Git agent creates pull request
```

---

#### 2. Tester Agent Bash Execution Without Explicit Safeguards (85% confidence)
**Location**: `shared/agents/tester.md:44-66`
**Found by**: Security reviewer

**Problem**: The Tester agent is instructed to "Execute the action via Bash" for test scenarios and "Set up preconditions" (line 44, 62-63). The agent has Bash access through the `devflow:qa` skill (`allowed-tools: Read, Grep, Glob, Bash`). Since test scenarios are derived from external input (GitHub issue bodies via ORIGINAL_REQUEST), a malicious issue could induce the Tester to execute destructive commands (rm -rf, sudo, eval, exec) or write outside the project directory.

**Fix**: Add explicit boundary constraints to tester.md. Add to the "Boundaries" section:

```markdown
**Bash Command Restrictions:**
- NEVER execute destructive commands: rm -rf, sudo, eval, exec, dd, mkfs, mount
- NEVER write to directories outside /tmp/devflow-tester-*
- NEVER install packages or modify system state (apt, brew, pip install, etc.)
- ONLY run: test runners (npm test, pytest, cargo test), curl, read-only file inspection, build commands (npm run build)
```

Alternatively, add `tools` frontmatter to restrict Bash access at the platform level (consistent with pattern used by other agents in the codebase).

---

#### 3. Duplicate Step Numbering Inconsistency in README Workflow (95% confidence)
**Location**: `plugins/devflow-implement/README.md:25-33`
**Found by**: Architecture, Documentation reviewers

**Problem**: README workflow order does not match actual command phases. README shows: Exploration → Planning → Implementation → Validation → Self-Review → Alignment → QA → **Simplification** → PR. Actual commands show: Exploration → Planning → Implementation → Validation → **Simplification** → Self-Review → Alignment → QA → PR. The Simplifier runs at Phase 9 (before Scrutinizer and Evaluator) but README places it after QA Testing.

**Fix**: Reorder README workflow to match actual phase order:

```markdown
1. **Exploration** - Skimmer + Explore agents understand the codebase
2. **Planning** - Plan agents design implementation approach
3. **Implementation** - Coder agent implements on feature branch
4. **Validation** - Validator runs build/test/lint checks
5. **Simplification** - Simplifier refines code clarity
6. **Self-Review** - Scrutinizer evaluates against 9-pillar framework
7. **Alignment Check** - Evaluator validates against original request
8. **QA Testing** - Tester executes scenario-based acceptance tests
9. **PR Creation** - Git agent creates pull request
```

---

#### 4. README Skills Count Stale After Adding `qa` Skill (90-92% confidence)
**Location**: `plugins/devflow-implement/README.md:51`
**Found by**: Consistency, Testing, Documentation reviewers

**Problem**: The heading says "### Skills (9)" but `plugin.json` now declares 6 skills (agent-teams, implementation-patterns, knowledge-persistence, qa, self-review, worktree-support). The new `qa` skill was added to `plugin.json` but not reflected in the README skills list, and the count was not updated. Additionally, the README lists skills from other plugins (typescript, react, accessibility) that are not in this plugin's own `plugin.json` skills array.

**Fix**: Add `qa` to the README skills list and update the count:

```markdown
### Skills (10)
- `software-design` - Result types, DI, immutability, workaround labeling
- `git` - Git safety, atomic commits, PR descriptions
- `implementation-patterns` - CRUD, API, events
- `testing` - Test quality, coverage
- `boundary-validation` - Boundary validation
- `self-review` - 9-pillar framework
- `qa` - Scenario-based acceptance testing
- `typescript` - TypeScript patterns
- `react` - React patterns
- `accessibility` - Keyboard, ARIA, focus management
```

---

### MEDIUM SEVERITY (5 issues)

#### 5. Variable Shadowing in Installer (82% confidence)
**Location**: `src/cli/utils/installer.ts:196, 215`
**Found by**: TypeScript reviewer

**Problem**: `agentsTarget` is declared in two scopes — once inside the for-loop at line 196 and again after the loop at line 215. Both resolve to the same `path.join(claudeDir, 'agents', 'devflow')` value. While TypeScript allows this due to block scoping, it creates maintenance hazard.

**Fix**: Hoist `agentsTarget` before the loop:

```typescript
// Before the for-loop (around line 167):
const agentsTarget = path.join(claudeDir, 'agents', 'devflow');

// Inside the for-loop (line 196): remove the declaration, just use agentsTarget
// After the for-loop (line 215): remove the declaration, just use agentsTarget
```

---

#### 6. Tester Agent Exceeds Agent Line Limit (90% confidence)
**Location**: `shared/agents/tester.md`
**Found by**: Architecture, Complexity reviewers

**Problem**: Tester agent is 195 lines, exceeding the project convention of 50-150 lines for agents (Worker type target: 80-120 lines). The agent embeds three distinct concerns: (1) scenario design/execution (50 lines), (2) dev server lifecycle management (37 lines), (3) browser-based testing via Chrome MCP (17 lines). The procedural dev server lifecycle and browser execution sections could move to a reference document.

**Fix**: Extract Dev Server Lifecycle + Browser Execution to `shared/skills/qa/references/browser-testing.md` and reference from agent with a brief summary. This brings agent from 195 to ~140 lines (within 150-line limit) while preserving all procedural knowledge accessible on demand.

---

#### 7. Shell Scripts Still Pipe Through JSON Parsers Without Input Sanitization (80% confidence)
**Location**: `scripts/hooks/background-learning:2438-2450`, `scripts/hooks/background-memory-update:2460-2468`
**Found by**: Security reviewer

**Problem**: The change from `echo` to `printf '%s\n'` prevents interpretation of escape sequences — good improvement. However, piped data flows into `json_valid` and `json_extract_messages` which use jq/node to parse. If transcript or LLM response contains adversarial content exploiting jq or node JSON parser, the `printf` sanitization is insufficient.

**Fix**: Defense-in-depth improvement — add input size limits before piping to JSON processing. Example: `head -c 100000` to cap input size and prevent potential resource exhaustion from oversized transcript entries.

---

#### 8. Dev Server Log Written to Predictable /tmp Path (82% confidence)
**Location**: `shared/agents/tester.md:94`
**Found by**: Security reviewer

**Problem**: Tester agent writes dev server output to `/tmp/devflow-tester-server.log` — a predictable path vulnerable to symlink attack (CWE-59). A local attacker on multi-user systems could pre-create a symlink, causing dev server output to overwrite an arbitrary file.

**Fix**: Use `mktemp` to create a unique temporary file:

```markdown
- Run in background: `LOG=$(mktemp /tmp/devflow-tester-XXXXXX.log); npm run dev > "$LOG" 2>&1 &`
```

---

#### 9. Tester Reads .env Files During Port Detection Without Restriction (80% confidence)
**Location**: `shared/agents/tester.md:89`
**Found by**: Security reviewer

**Problem**: Tester agent is instructed to detect port from `.env` files (line 89: "Framework config: vite.config.ts (server.port), next.config.js, .env (PORT)"). Reading `.env` may inadvertently expose secrets in agent context if the file contains sensitive credentials alongside PORT. Agent only needs the PORT value but instruction does not restrict which `.env` keys are read.

**Fix**: Specify to extract only the PORT variable:

```markdown
- `.env` file: extract only `PORT=` value via `grep ^PORT= .env | cut -d= -f2` — do not read entire .env
```

---

## Should-Fix Issues (Recommended, Not Blocking)

### MEDIUM SEVERITY (3 issues)

#### 10. Missing Test Coverage for New Agent/Skill Dependencies (85% confidence)
**Location**: `tests/plugins.test.ts`
**Found by**: Testing reviewer

**Problem**: The `devflow-implement` and `devflow-ambient` plugins now declare `evaluator` and `tester` agents and `qa` skill, but no test verifies these dependencies are declared in the registries. The existing test pattern verifies ambient plugin review/resolve dependencies, but implement plugin dependencies are not tested.

**Recommendation**: Add tests:

```typescript
it('devflow-implement declares evaluator and tester agent dependencies', () => {
  const implement = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-implement');
  expect(implement).toBeDefined();
  expect(implement!.agents).toContain('evaluator');
  expect(implement!.agents).toContain('tester');
  expect(implement!.skills).toContain('qa');
});

it('devflow-ambient declares evaluator and tester agent dependencies', () => {
  const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
  expect(ambient).toBeDefined();
  expect(ambient!.agents).toContain('evaluator');
  expect(ambient!.agents).toContain('tester');
});
```

---

#### 11. Shell Pipeline Removes `tail -3` Pre-Filter, Unbounding Subprocess Loop (83% confidence)
**Location**: `scripts/hooks/background-memory-update:3-9`
**Found by**: Performance reviewer

**Problem**: The `tail -3` pre-filter was removed from the grep pipeline, causing the while-loop to spawn `printf` + `json_extract_messages` subprocess for every matching line instead of just the last 3. For large transcript files (thousands of lines), this significantly increases subprocess spawning.

**Recommendation**: Re-add `tail -3` pre-filter while preserving the `echo` → `printf` fix:

```bash
last_user=$(grep '"type":"user"' "$transcript" 2>/dev/null \
  | tail -3 \
  | while IFS= read -r line; do printf '%s\n' "$line" | json_extract_messages; done \
  | awk 'NF' \
  | tail -1)
```

---

#### 12. Main README Skill Count Stale (90% confidence)
**Location**: `README.md:293, 307`
**Found by**: Documentation reviewer

**Problem**: README states "35 skills grounded in expert material" but `shared/skills/` contains 38 skill directories. The count was wrong before this PR (34 when there were 37). This PR incremented by 1 (to 35 for `qa` skill) but the base count was already stale. Additionally, "35 skills" appears in HUD example.

**Recommendation**: Verify intended definition (all skills vs. expert-material-backed only) and update accordingly. If counting all skills: change to 38. If expert-material-backed only: recount and clarify scope.

---

## Pre-existing Issues (Not Blocking, Informational)

### MEDIUM SEVERITY (2 issues)

#### 13. Evaluator Agent Has Duplicated Frontmatter Blocks
**Location**: `shared/agents/evaluator.md`
**Found by**: Documentation reviewer

**Problem**: The file shows 3 separate frontmatter blocks and 3 headings (# Evaluator Agent) — the rename from shepherd to evaluator was applied to all 3 instances. Pre-existing structural issue, not introduced by this PR.

---

#### 14. PF-006: Per-Line jq Spawning in Session-Start Hooks (Tracked)
**Location**: `.memory/knowledge/pitfalls.md`
**Found by**: Performance reviewer

**Problem**: Per-line jq spawning in while-read loops adds 1-3s latency. The resolution (single-pass `jq -s` slurp) has not been applied. This PR's `background-memory-update` changes actually make the pattern slightly worse by removing `tail -3` pre-filter.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total Issues Found** | 14 |
| **Blocking Issues** | 9 (4 HIGH, 5 MEDIUM) |
| **Should-Fix Issues** | 3 (all MEDIUM) |
| **Pre-existing Issues** | 2 (informational) |
| **Security Findings** | 3 HIGH, 4 MEDIUM |
| **Architecture Findings** | 1 HIGH, 2 MEDIUM |
| **Documentation Findings** | 2 HIGH, 1 MEDIUM |
| **Test Coverage Gaps** | 1 MEDIUM |
| **Performance Issues** | 1 HIGH, 2 MEDIUM |

---

## Merge-Blocking Issues Prioritized by Impact

**HIGH PRIORITY** (Must fix before merge):
1. **Duplicate step number in README** (lines 32-33) — documentation correctness
2. **Tester agent Bash safeguards** (security boundary constraint)
3. **README workflow order** (documentation consistency)
4. **README skill count** (documentation accuracy)

**MEDIUM PRIORITY** (Should fix, high confidence):
5. Variable shadowing in installer.ts
6. Tester agent line limit (extract browser testing to reference)
7. Security: input sanitization in JSON pipelines
8. Security: predictable /tmp log path
9. Security: .env file reading without restriction

---

## Architecture Quality Assessment

**Strengths**:
- Clean SRP decomposition: Shepherd split into Evaluator (alignment validation) and Tester (QA execution)
- New `qa` skill properly follows 3-tier architecture with progressive disclosure (SKILL.md + 4 references)
- QA skill backed by 12 canonical sources and properly integrated into `implementation-orchestration`
- Both `implement.md` and `implement-teams.md` consistently updated with Phase 13 (QA Testing)
- Legacy cleanup via `LEGACY_AGENT_NAMES` and `LEGACY_PLUGIN_NAMES` registries properly structured
- All 581 tests pass with 3 new tests for legacy plugin name remapping

**Areas for Improvement**:
- Tester agent at 195 lines exceeds project convention (80-120 for Worker agents)
- Implement command files approaching maintainability threshold (663 lines for teams variant)
- `devflow-ambient` plugin.json missing `qa` skill declaration (violates explicit-dependency pattern)

---

## Recommendations Summary

### Before Merge (Blocking)
1. Fix duplicate step number in README (line 33: change `8.` to `9.`)
2. Fix README workflow order to match actual command phases
3. Update README skill count and list to include `qa`
4. Add explicit Bash safeguards to Tester agent Boundaries section
5. Fix variable shadowing in installer.ts:196/215

### Recommended (Should-Fix, High Confidence)
6. Extract Dev Server Lifecycle + Browser Execution to QA skill reference (reduces agent to ~140 lines)
7. Add `qa` to devflow-ambient plugin.json skills array
8. Add tests for new agent/skill dependencies in plugin registries
9. Re-add `tail -3` pre-filter in background-memory-update script
10. Update main README skill count from 35 to 38
11. Use `mktemp` for dev server log (security improvement)
12. Extract only PORT from .env via grep (security improvement)
13. Add input size limits to JSON pipeline parsing (defense-in-depth)

### Post-Merge (Optional, Lower Urgency)
- Fix pre-existing duplicated frontmatter blocks in evaluator.md
- Refactor duplicate implement.md/implement-teams.md phase logic into shared pattern
- Consolidate per-line jq spawning per PF-006

---

## Test Coverage Status

- **Build Status**: ✅ All 581 tests pass
- **New Tests Added**: ✅ 3 tests for legacy plugin name remapping (init-logic, manifest)
- **Coverage Gaps**: ⚠️ Missing tests for new agent/skill registry declarations (recommend adding 2 tests)
- **Missing Test Paths**: ⚠️ `LEGACY_AGENT_NAMES` cleanup path not directly tested (recommend adding 1 test)

---

## Final Assessment

This PR executes a high-quality architectural change with strong implementation and integration. The shepherd-to-evaluator decomposition is well-motivated and thoroughly propagated through 35+ changed files. The new Tester agent and QA skill follow established patterns. The rename from `devflow-frontend-design` to `devflow-ui-design` includes proper legacy support.

The blocking issues are primarily documentation (duplicate numbering, stale skill count) and one straightforward TypeScript fix (variable shadowing). The security findings are actionable and well-contained to boundary constraints and input handling. The "should-fix" recommendations are high-confidence improvements that would enhance code quality, particularly agent sizing and test coverage.

**Approval is conditional on fixing the 5 blocking issues identified above.** With those fixes, this PR is well-positioned for merge and should not introduce regressions.

