# Code Review Summary

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20 16:30
**PR**: #153

## Merge Recommendation: CHANGES_REQUESTED

This PR is well-structured housekeeping with clear improvements to the codebase (Skimmer tool enforcement, portability, version notification). However, multiple reviewers identified overlapping issues in documentation consistency, test isolation, and validation logic that require fixes before merge. All issues are straightforward to address.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 5 | 7 | 0 | **12** |
| Should Fix | 0 | 0 | 4 | 0 | **4** |
| Pre-existing | 0 | 0 | 3 | 1 | **4** |

---

## Blocking Issues (Must Fix Before Merge)

### CRITICAL
_None._

### HIGH (5 issues)

**1. Skimmer agent exceeds Utility agent target line count (143 lines)**
- **Location**: `shared/agents/skimmer.md`
- **Confidence**: 82% (flagged by 3 reviewers)
- **Problem**: Agent design guidelines define Utility agents as 50-80 lines, with "ideally under 120" per quality checklist. Skimmer was rewritten from ~55 to 143 lines. The addition of a 6-step workflow with code blocks and reference table violates the target.
- **Impact**: Increased token overhead on every invocation. Utility agents should be lean orientation tools.
- **Fix**: Extract the "rskim Reference" table (lines 74-85) and detailed fallback instructions into `shared/agents/references/rskim-usage.md`, keeping agent body under 120 lines.

**2. Incomplete "skim" → "rskim" migration in diagram comments (4 occurrences)**
- **Locations**:
  - `plugins/devflow-implement/commands/implement.md:363`
  - `plugins/devflow-implement/commands/implement-teams.md:550`
  - `plugins/devflow-specify/commands/specify.md:140`
  - `plugins/devflow-specify/commands/specify-teams.md:273`
- **Confidence**: 90% (flagged by 4 reviewers)
- **Problem**: Skimmer agent prompt text was updated to reference "rskim" (lines ~55-56), but ASCII pipeline diagrams at bottom still say `Skimmer agent (codebase overview via skim)` instead of "via rskim". Files were already modified in this PR.
- **Impact**: Confusing mixed messaging within the same PR. Developers read "rskim" in prompt, "skim" in diagram.
- **Fix**: Update all 4 diagram lines to use "via rskim":
  ```
  # implement.md:363 and implement-teams.md:550
  │  └─ Skimmer agent (codebase overview via rskim)

  # specify.md:140 and specify-teams.md:273
  │  └─ Skimmer agent (codebase context via rskim)
  ```

**3. Unsanitized npm registry output in version cache and terminal**
- **Location**: `scripts/statusline.sh:210-212,194`
- **Confidence**: 82%
- **Problem**: Output of `npm view devflow-kit version` is written to cache and later interpolated into ANSI escape sequence without validation. If npm registry returns unexpected content or is compromised, could result in terminal injection.
- **Impact**: Terminal injection vulnerability via malicious package metadata.
- **Fix**: Validate fetched version matches semver pattern before caching and displaying:
  ```bash
  FETCHED=$(npm view devflow-kit version 2>/dev/null)
  if [[ "$FETCHED" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
      echo "$FETCHED" > "$VERSION_CACHE_FILE"
  fi
  # Similarly validate LATEST_VERSION after reading from cache
  ```

**4. Test ordering dependency in skimmer-agent.test.ts (HIGH × 2 reviewers)**
- **Location**: `tests/skimmer-agent.test.ts:21-26`
- **Confidence**: 85-90% (flagged by 2 reviewers independently)
- **Problem**: `content` and `tools` variables declared with `let` at suite scope, assigned only in first `it()` block. All subsequent tests depend on test execution order. If tests run in isolation (`.only`, shuffle, or parallel), 5 of 6 tests fail with `undefined`.
- **Impact**: Fragile test suite. Violates independent test principle.
- **Fix**: Move file loading to `beforeAll()` hook:
  ```typescript
  describe('skimmer agent', () => {
    let content: string;
    let tools: string[];

    beforeAll(async () => {
      content = await fs.readFile(AGENT_PATH, 'utf-8');
      tools = parseToolsFromFrontmatter(content);
    });

    it('has tools restricted to Bash and Read only', () => {
      expect(tools).toHaveLength(2);
      expect(tools).toContain('Bash');
      expect(tools).toContain('Read');
    });
    // ... remaining tests
  });
  ```

### MEDIUM (7 issues)

**5. Inconsistent `get_mtime()` detection strategy across scripts**
- **Location**: `scripts/statusline.sh:16`
- **Confidence**: 90%
- **Problem**: New `get_mtime()` in statusline.sh uses "try the flag itself" detection (test `stat -f %m`), but existing `get_mtime()` in `background-memory-update` (line 35) and inline logic in `session-start-memory` (line 31) and `stop-update-memory` (line 39) all use `stat --version &>/dev/null` as detection (GNU stat supports `--version`, BSD does not). Two different strategies in the same project.
- **Impact**: Maintenance confusion. If one pattern breaks, others don't automatically break together.
- **Fix**: Align statusline.sh with existing pattern used in all hook scripts:
  ```bash
  get_mtime() {
      if stat --version &>/dev/null 2>&1; then
          stat -c %Y "$1"  # Linux (GNU stat)
      else
          stat -f %m "$1"  # macOS (BSD stat)
      fi
  }
  ```

**6. `get_mtime()` calls `stat` twice on the happy path (MEDIUM × 2 reviewers)**
- **Location**: `scripts/statusline.sh:15-23`
- **Confidence**: 82-85% (flagged by 2 reviewers)
- **Problem**: Function runs `stat -f %m "$1"` to test if flag works (output discarded to `/dev/null`), then runs the same `stat` command again to capture value. Two `stat` syscalls per invocation on success path. Function called twice per statusline render (lines 83, 203) = 4 stat processes instead of 2 on macOS.
- **Impact**: Minor per-invocation cost (~4ms extra fork overhead). Runs on every prompt render, accumulates across session.
- **Fix**: Capture output on first attempt, only re-run on failure:
  ```bash
  get_mtime() {
      local result
      if result=$(stat -f %m "$1" 2>/dev/null); then
          echo "$result"
      elif result=$(stat -c %Y "$1" 2>/dev/null); then
          echo "$result"
      else
          echo 0
      fi
  }
  ```

**7. Skimmer Task invocation in `plan-orchestration` skill not updated**
- **Location**: `shared/skills/plan-orchestration/SKILL.md:26`
- **Confidence**: 85%
- **Problem**: Skimmer Task invocations in implement.md, implement-teams.md, specify.md, and specify-teams.md all updated to "Run rskim on source directories (NOT repo root)", but plan-orchestration/SKILL.md still uses generic "Spawn Task(subagent_type="Skimmer") to get codebase overview" without rskim-specific instructions.
- **Impact**: Inconsistent directive language. Orchestrators using this skill don't get the critical "NOT repo root" warning.
- **Fix**: Update plan-orchestration/SKILL.md line 26-29 to include rskim directive:
  ```markdown
  Spawn `Task(subagent_type="Skimmer")` to get codebase overview relevant to the planning question.
  Include in the task prompt: "Run rskim on source directories (NOT repo root) to find:"

  - Existing patterns and conventions in the affected area
  ```

**8. CLAUDE.md does not document the new `tools` frontmatter field for agents**
- **Location**: `CLAUDE.md:133-138`
- **Confidence**: 85%
- **Problem**: PR introduces `tools` as new agent frontmatter field (documented in `docs/reference/agent-design.md` and used in `shared/agents/skimmer.md`), but CLAUDE.md's "### Agents" section doesn't mention it. CLAUDE.md is the primary developer entry point. The `tools` restriction is a significant behavioral change (platform-enforced tool access), analogous to how "### Skills" documents `allowed-tools`.
- **Impact**: Developers won't know about the `tools` convention when creating or modifying agents.
- **Fix**: Add bullet under `### Agents` in CLAUDE.md:
  ```markdown
  ### Agents

  - Target: 50-150 lines depending on type (Utility 50-80, Worker 80-120)
  - Reference skills via frontmatter, don't duplicate skill content
  - Define clear input/output contracts and escalation boundaries
  - Use `tools` frontmatter to platform-restrict agent tool access (prefer over prompt-level prohibitions)
  - Shared agents live in `shared/agents/` -- add to plugin `plugin.json` `agents` array
  ```

**9. `statusline.sh` version-check block has 4 levels of nesting, needs extraction**
- **Location**: `scripts/statusline.sh:173-218`
- **Confidence**: 85%
- **Problem**: Script is now 222 lines with no function decomposition beyond the new `get_mtime()` helper. Version-check block adds a third major feature section (after git-info and context-usage) with 4 levels of nesting and ~46 lines of procedural logic. File approaching unmaintainability threshold.
- **Impact**: Next feature added to this script will push well past 300-line warning. Hard to test sections in isolation due to shared global state.
- **Fix**: Extract version-check logic into a function (following pattern started with `get_mtime()`):
  ```bash
  get_version_badge() {
      local manifest_file="${DEVFLOW_DIR}/manifest.json"
      local cache_dir="${HOME}/.cache/devflow"
      local cache_file="${cache_dir}/latest-version"

      [ -f "$manifest_file" ] && command -v jq &>/dev/null || return
      local local_version
      local_version=$(jq -r '.version // empty' "$manifest_file" 2>/dev/null)
      [ -z "$local_version" ] && return

      # Read cached latest version (fast path)
      local latest_version=""
      [ -f "$cache_file" ] && latest_version=$(cat "$cache_file" 2>/dev/null)

      # Compare
      if [ -n "$latest_version" ] && [ "$local_version" != "$latest_version" ]; then
          local lowest
          lowest=$(printf '%s\n%s' "$local_version" "$latest_version" | sort -V | head -n1)
          [ "$lowest" = "$local_version" ] && printf '  \033[35m⬆ %s\033[0m' "$latest_version"
      fi

      # Background refresh if stale
      local refresh=false
      if [ ! -f "$cache_file" ]; then
          refresh=true
      else
          local cache_age=$(($(date +%s) - $(get_mtime "$cache_file")))
          [ "$cache_age" -ge 86400 ] && refresh=true
      fi

      if [ "$refresh" = true ] && command -v npm &>/dev/null; then
          ( mkdir -p "$cache_dir" 2>/dev/null
            local fetched
            fetched=$(npm view devflow-kit version 2>/dev/null)
            [ -n "$fetched" ] && echo "$fetched" > "$cache_file"
          ) & disown 2>/dev/null
      fi
  }
  ```
  Then main body becomes: `VERSION_BADGE=$(get_version_badge)` -- single line.

**10. `specify/README.md` still references old "skim" name**
- **Location**: `plugins/devflow-specify/README.md:32`
- **Confidence**: 85%
- **Problem**: README says `skimmer - Codebase orientation using skim for file/function discovery` while agent description now says "using rskim". Plugin READMEs should reflect current agent descriptions. File was in scope of PR changes.
- **Impact**: Documentation inconsistency in user-facing README.
- **Fix**: Update to: `skimmer - Codebase orientation using rskim for file/function discovery`

**11. Predictable /tmp cache path without ownership check (touched in this PR)**
- **Location**: `scripts/statusline.sh:82-88`
- **Confidence**: 80%
- **Problem**: Pre-existing `/tmp/devflow-base-${REPO_NAME}-${GIT_BRANCH}` cache path is predictable and world-writable. While only change in this PR was replacing `stat -f %m` with `get_mtime()` (line 83), surrounding code reads/writes without ownership check. On shared system, another user could symlink this path and cause `echo "$PR_BASE" > "$CACHE_FILE"` to write to arbitrary file. Additionally, `cat "$CACHE_FILE"` (line 84) reads untrusted content into `$BASE_BRANCH` used in git commands.
- **Impact**: Symlink attack possible on shared systems. Git command injection via untrusted cache.
- **Fix**: Use user-private cache directory or add ownership check:
  ```bash
  CACHE_DIR="${HOME}/.cache/devflow"
  mkdir -p "$CACHE_DIR" 2>/dev/null
  CACHE_FILE="${CACHE_DIR}/base-${REPO_NAME}-${GIT_BRANCH}"
  ```
  (Note: New version-check cache correctly uses `${HOME}/.cache/devflow/` -- apply same pattern here for consistency.)

---

## Should-Fix Issues (Recommended, Not Blocking)

### MEDIUM (4 issues)

**12. Skimmer escalation boundary prohibits all fallbacks when rskim fails**
- **Location**: `shared/agents/skimmer.md:141`, `docs/reference/agent-design.md:34`
- **Confidence**: 80%
- **Problem**: Escalation boundary says "If npx rskim fails, report the error (do not attempt manual fallbacks with other tools)." Combined with `tools: ["Bash", "Read"]`, Skimmer cannot use Grep/Glob even if rskim unavailable. Single point of failure -- if npm registry down or npx not installed, entire orientation phase of `/implement` and `/specify` halts.
- **Impact**: Reduced resilience. Tool restriction is architecturally sound; gap is in orchestrator's recovery path.
- **Fix**: Document intentional trade-off in agent or add note for orchestrators about recovery (e.g., spawn ad-hoc exploration agent with full tools if Skimmer escalates rskim failure).

**13. `sort -V` not universally available in minimal environments**
- **Location**: `scripts/statusline.sh:192`
- **Confidence**: 80%
- **Problem**: Version comparison uses `sort -V` (version sort), which is GNU coreutils extension. Available on macOS and most Linux, but not POSIX. Will fail on minimal/older environments (Alpine, BusyBox).
- **Impact**: On systems without `sort -V`, version comparison produces lexicographic sort, potentially showing/hiding update badge incorrectly. Informational feature only, so not critical.
- **Fix**: Document GNU sort requirement or use shell-native version comparison:
  ```bash
  # Simple shell version compare (works everywhere)
  version_lt() {
      [ "$1" = "$2" ] && return 1
      [ "$1" = "$(printf '%s\n%s' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" ]
  }
  ```

**14. Skimmer's "does NOT use root scan" classification now conflicts with tools access**
- **Location**: `shared/agents/skimmer.md:4`, `docs/reference/agent-design.md:34`
- **Confidence**: 80%
- **Problem**: New `tools: ["Bash", "Read"]` frontmatter and agent-design.md documentation recommend "prefer platform-enforced tool restrictions over prompt instructions". However, Skimmer is only agent using this pattern. Other agents that could benefit (e.g., Validator never writes, Shepherd never writes) remain unrestricted. Documented as recommended but applied to 1 of 10 agents -- creates incomplete pattern.
- **Impact**: Inconsistent pattern. Other agents' designs would benefit from same tool restriction.
- **Fix**: Not blocking. Consider follow-up task to audit Validator and Shepherd for appropriate `tools` restrictions.

**15. Skimmer test conflates setup with assertion**
- **Location**: `tests/skimmer-agent.test.ts:23-26`
- **Confidence**: 85%
- **Problem**: `it('loads the agent file')` test exists purely as setup step with no meaningful assertion. Violates Arrange-Act-Assert pattern. If file fails to load, error appears generic; 5 downstream tests fail silently with `undefined`.
- **Impact**: Misleading test failure messages.
- **Fix**: Move load to `beforeAll()` (resolves HIGH issue #4 above). If dedicated "file exists" assertion needed, make independent test that reads file in isolation.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM (3 issues)

- **Pre-existing: 522-line `initCommand.action()` function** - `src/cli/commands/init.ts:112-634` -- Exceeds 200-line CRITICAL threshold, but PR changes only 2 lines in filter expression. Noted for future refactoring (extract to `promptForScope()`, `promptForPlugins()`, `installPlugins()`, etc.).

- **Pre-existing: statusline.sh base-branch detection has 4-layer nesting** - `scripts/statusline.sh:57-99` -- 42 lines of procedural logic with nested git commands. PR only changed line 83 to use new `get_mtime()` helper (strict improvement). Future PR should extract to `detect_base_branch()` function.

- **Pre-existing: macOS-only `stat -f %m` in 3 hook scripts** - `scripts/hooks/background-memory-update:38`, `scripts/hooks/session-start-memory:34`, `scripts/hooks/stop-update-memory:42` -- CHANGELOG documents fixing portability in statusline, but hooks still use macOS-only `stat -f %m`. Pattern is already implemented (`get_mtime()`) but not applied to hooks. Follow-up PR should extract `get_mtime()` to shared shell helper.

### LOW (1 issue)

- **Pre-existing: README does not mention version update notification** - README.md -- Changelog entry added, but README (end-user docs) doesn't describe statusline or version notification feature. Pre-existing gap; not blocking housekeeping PR.

---

## Action Plan

**Before Merge (BLOCKING)**
1. Extract Skimmer agent reference material to reduce from 143 to ~120 lines (Issue #1)
2. Update 4 diagram comments to say "via rskim" instead of "via skim" (Issue #2)
3. Add semver validation for npm registry output before caching/display (Issue #3)
4. Move skimmer-agent test setup to `beforeAll()` hook (Issue #4)
5. Align `get_mtime()` detection strategy with existing hook scripts (Issue #5)
6. Optimize `get_mtime()` to avoid double stat call (Issue #6)
7. Add rskim directive to plan-orchestration skill Skimmer invocation (Issue #7)
8. Document `tools` frontmatter in CLAUDE.md Agents section (Issue #8)
9. Extract version-check block from statusline.sh into `get_version_badge()` function (Issue #9)
10. Update specify/README.md to say "rskim" instead of "skim" (Issue #10)
11. Move cache path from `/tmp` to `${HOME}/.cache/devflow` for security (Issue #11)

**Recommended Before Merge (SHOULD-FIX)**
- Document Skimmer escalation strategy and orchestrator recovery path (Issue #12)
- Choose: document `sort -V` requirement OR implement shell-native version comparison (Issue #13)
- Fix skimmer test to remove confusing "loads the agent file" setup test (Issue #15)

**Follow-up PRs (NOT BLOCKING)**
- Audit other agents (Validator, Shepherd) for appropriate `tools` restrictions
- Refactor init.ts action handler into focused functions
- Extract `get_mtime()` to shared shell helper and apply to all hook scripts
- Document version notification feature in README

---

## Summary by Reviewer

| Reviewer | Category | CRITICAL | HIGH | MEDIUM | Total Issues |
|----------|----------|----------|------|--------|--------------|
| Architecture | Blocking | 0 | 2 | 1 | 3 |
| Complexity | Blocking | 0 | 1 | 1 | 2 |
| Consistency | Blocking | 0 | 2 | 2 | 4 |
| Documentation | Blocking | 0 | 0 | 1 | 1 |
| Performance | Blocking | 0 | 0 | 1 | 1 |
| Regression | Blocking | 0 | 0 | 1 | 1 |
| Security | Blocking | 0 | 0 | 1 | 1 |
| Tests | Blocking | 0 | 1 | 2 | 3 |
| TypeScript | Blocking | 0 | 1 | 0 | 1 |

---

## Quality Observations

**Strengths**
- Well-structured housekeeping batch with 4 focused commits
- Skimmer rewrite significantly improves clarity (from vague ~55-line guidance to explicit 6-step workflow with warnings)
- Platform-enforced tool restrictions (`tools` frontmatter) are architecturally superior to prompt-level prohibitions
- Version notification feature has clean async/cache design with proper 24h TTL
- Comprehensive test additions for new functionality
- No security vulnerabilities in new code (validation issues are fixable)

**Weaknesses**
- Incomplete rename migration (skim → rskim) leaves dangling references in 5 files
- Test ordering dependency violates independent test principle
- Validation gaps in npm output handling
- Inconsistent patterns introduced (two mtime detection strategies)
- Cache security not uniformly applied

**Architecture Score**: 7/10 (clear improvements offset by consistency gaps)
**Test Quality**: 7/10 (good behavioral testing, but ordering dependency needs fix)
**Security**: 8/10 (version output validation and symlink risk both fixable)
**Documentation**: 8/10 (good overall, but CLAUDE.md gap and incomplete rename migration)
**Performance**: 8/10 (properly async, one minor optimization available)

