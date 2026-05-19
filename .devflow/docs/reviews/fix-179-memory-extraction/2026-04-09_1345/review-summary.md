# Code Review Summary

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09_1345

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces a well-architected queue-based working memory system and fixes the per-line subprocess spawning issue (PF-006). However, three blocking MEDIUM issues span testing, performance, and consistency and must be resolved before merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 2 | 6 | 0 | 8 |
| Should Fix | 0 | 0 | 4 | 0 | 4 |
| Pre-existing | 0 | 1 | 5 | 2 | 8 |

---

## Blocking Issues (Must Fix)

### CRITICAL
None.

### HIGH

**1. Queue cleanup tests duplicate production logic instead of exercising it** — `tests/memory.test.ts:202-245`
**Confidence**: 85%
- **Problem**: The `queue file cleanup` test block reimplements the cleanup logic (`fs.unlink(...).then(() => true).catch(() => false)`) rather than importing and calling the actual function. Tests validate their own inlined copy, not production code. If the cleanup handler changes, tests pass silently while code diverges.
- **Category**: Testing — Issue in your changes
- **Fix**: Extract `cleanupQueueFiles(memoryDir)` into an exported utility in `memory.ts`, then test that function directly:
  ```typescript
  // src/cli/commands/memory.ts
  export async function cleanupQueueFiles(memoryDir: string): Promise<{ queueDeleted: boolean; procDeleted: boolean }> {
    const queueDeleted = await fs.unlink(path.join(memoryDir, '.pending-turns.jsonl')).then(() => true).catch(() => false);
    const procDeleted = await fs.unlink(path.join(memoryDir, '.pending-turns.processing')).then(() => true).catch(() => false);
    return { queueDeleted, procDeleted };
  }
  ```
  Update `init.ts:1413-1415` and `memory.ts:213-215` to call this function.

**2. Per-prompt subprocess overhead in prompt-capture-memory hook** — `scripts/hooks/prompt-capture-memory:18,23`
**Confidence**: 85%
- **Problem**: The new hook spawns 2 subprocess invocations per user prompt (one `json_field` for `cwd`, one for `prompt`). Each adds ~10-30ms latency on warm systems. This runs on every prompt, not throttled. Combined with 2 more in the preamble, users now pay for 4 subprocess calls per prompt (up from 3 previously).
- **Category**: Performance — Issue in your changes
- **Fix**: Consolidate both field extractions into a single jq/node invocation using shell variables:
  ```bash
  if [ "$_HAS_JQ" = "true" ]; then
    eval "$(echo "$INPUT" | jq -r '@sh "CWD=\(.cwd // "") PROMPT=\(.prompt // "")"' 2>/dev/null)"
  else
    eval "$(echo "$INPUT" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{const o=JSON.parse(d);
        console.log('CWD='+JSON.stringify(o.cwd||'')+ ' PROMPT='+JSON.stringify(o.prompt||''))
        }catch(e){console.log('CWD=\"\" PROMPT=\"\"')}
      })" 2>/dev/null)"
  fi
  ```

### MEDIUM (4 blocking issues)

**3. `addMemoryHooks` re-serializes JSON unconditionally on partial state** — `src/cli/commands/memory.ts:61` and `src/cli/commands/typescript.ts:14`
**Confidence**: 90% (flagged by 4+ reviewers: typescript, consistency, regression)
- **Problem**: The `changed` flag was removed, so when hooks are partially present (1-3 of 4), the function always re-serializes JSON via `JSON.stringify(settings, null, 2)` even if nothing was added. The early return at line 27 only covers the "all 4 present" case. This can reformat user-edited settings.json whitespace, triggering spurious "enabled" messages and unnecessary file writes when callers compare `updated === settingsContent`.
- **Category**: Consistency/Regression — Issue in your changes
- **Fix**: Restore `changed` tracking to match `removeMemoryHooks` pattern:
  ```typescript
  let changed = false;
  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    // ...existing logic...
    if (!alreadyPresent) {
      // ...add entry...
      changed = true;
    }
  }
  if (!changed) {
    return settingsJson;
  }
  return JSON.stringify(settings, null, 2) + '\n';
  ```

**4. Queue cleanup uses `process.cwd()` — not guaranteed to be project root** — `src/cli/commands/memory.ts:213` and `src/cli/commands/init.ts:1413`
**Confidence**: 88% (flagged by 3 reviewers: typescript, architecture)
- **Problem**: Both disable handler (memory.ts:213) and init handler (init.ts:1413) resolve `.memory/` via `path.join(process.cwd(), '.memory')`. If user runs `devflow memory --disable` from a subdirectory, cleanup targets the wrong path and silently fails to delete queue files.
- **Category**: TypeScript — Issue in your changes
- **Fix**: Use git root detection (already available in init.ts) for consistent path resolution:
  ```typescript
  const gitRoot = await getGitRoot();
  const memoryDir = gitRoot
    ? path.join(gitRoot, '.memory')
    : path.join(process.cwd(), '.memory');
  ```

**5. Missing tests for critical feedback-loop guards** — `scripts/hooks/prompt-capture-memory:10` and `scripts/hooks/stop-update-memory` (similar)
**Confidence**: 82%
- **Problem**: Both hooks have guard clauses (`if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi`) preventing infinite feedback loops when background updater's haiku session triggers hooks. These critical safeguards have zero test coverage. A regression removing this guard would cause infinite memory captures.
- **Category**: Testing — Issue in your changes
- **Fix**: Add tests for both guards:
  ```typescript
  it('prompt-capture-memory skips when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    const input = JSON.stringify({ cwd: tmpDir, session_id: 'bg', prompt: 'test' });
    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, {
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DEVFLOW_BG_UPDATER: '1' },
    });
    expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(false);
  });
  ```

**6. Missing tests for prompt truncation boundary** — `scripts/hooks/prompt-capture-memory:27-29` and `scripts/hooks/stop-update-memory:75-77`
**Confidence**: 82%
- **Problem**: Both hooks truncate inputs at 2000 chars with `[truncated]` suffix. This meaningful behavior affecting memory fidelity has zero test coverage. No validation that truncation actually occurs or that the suffix is present.
- **Category**: Testing — Issue in your changes
- **Fix**: Add boundary tests:
  ```typescript
  it('prompt-capture-memory truncates prompts over 2000 chars', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    const longPrompt = 'x'.repeat(2500);
    const input = JSON.stringify({ cwd: tmpDir, session_id: 'test-trunc', prompt: longPrompt });
    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    const entry = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'), 'utf-8').trim()
    );
    expect(entry.content.length).toBeLessThan(2500);
    expect(entry.content).toContain('... [truncated]');
  });
  ```

**7. No integration test for background-memory-update extraction refactor** — `scripts/hooks/background-memory-update`
**Confidence**: 82%
- **Problem**: The core performance fix of this PR (single-pass jq/node extraction replacing per-line subprocess spawning) has zero automated tests. Only syntax check (`bash -n`) exists. While the script is hard to test fully (invokes `claude -p`), the TSV extraction logic could be isolated and validated.
- **Category**: Testing — Issue in your changes
- **Fix**: Create a test validating TSV extraction without invoking claude:
  ```typescript
  it('single-pass extraction produces correct TSV from JSONL', () => {
    const entries = [
      '{"role":"user","content":"hello","ts":1}',
      '{"role":"assistant","content":"world","ts":2}',
    ].join('\n');
    // Mock the jq extraction and validate output structure
    const result = execSync(
      `echo '${entries}' | jq -r '(.role // "") + "\\t" + ((.content // "") | gsub("\\n"; " "))'`,
      { stdio: 'pipe' },
    ).toString().trim();
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^user\t/);
    expect(lines[1]).toMatch(/^assistant\t/);
  });
  ```

---

## Should-Fix Issues (Lower Priority, Still Address)

### MEDIUM (4 should-fix issues)

**1. Duplicated queue cleanup logic — inline in two locations** — `src/cli/commands/memory.ts:213-215` and `src/cli/commands/init.ts:1413-1415`
**Confidence**: 85% (flagged by architecture + complexity reviewers)
- **Problem**: Identical cleanup code (`fs.unlink(...).then(() => true).catch(() => false)` on same two files) in both handlers. If queue format changes, one location could be missed.
- **Fix**: Extract to shared function (see Blocking Issue #1 above).

**2. Duplicated `get_mtime` function across two shell scripts** — `scripts/hooks/stop-update-memory:30-36` and `scripts/hooks/background-memory-update:48-54`
**Confidence**: 90% (flagged by architecture + complexity + performance)
- **Problem**: GNU/BSD portable stat wrapper copy-pasted in both scripts. Two locations to update if portability logic changes.
- **Fix**: Extract to `scripts/hooks/portable-stat` and source from both:
  ```bash
  # scripts/hooks/portable-stat
  get_mtime() {
    if stat --version &>/dev/null 2>&1; then
      stat -c %Y "$1"
    else
      stat -f %m "$1"
    fi
  }
  ```

**3. Double-parse of `settingsJson` in `addMemoryHooks`** — `src/cli/commands/memory.ts:25-27`
**Confidence**: 80%
- **Problem**: Calls `JSON.parse(settingsJson)` on line 25, then `hasMemoryHooks(settingsJson)` which parses again. JSON is parsed twice on every call.
- **Fix**: Extract parsed object and pass to helper:
  ```typescript
  const settings = JSON.parse(settingsJson);
  const hookCount = countFromParsed(settings);
  if (hookCount === Object.keys(MEMORY_HOOK_CONFIG).length) {
    return settingsJson;
  }
  ```

**4. Hardcoded `process.cwd()` for queue cleanup** — `src/cli/commands/memory.ts:213`
**Confidence**: 82%
- **Problem**: Duplicates the path resolution pattern from init.ts:1413 without shared utility. Also addressed in Blocking Issue #4.
- **Fix**: Extract as Blocking Issue #4 and share between both files.

---

## Documentation Issues (Must Address)

### HIGH

**1. `stop-update-memory` File column is misleading in hook table** — `docs/reference/file-organization.md:164`
**Confidence**: 85%
- **Problem**: Hook table lists `.memory/WORKING-MEMORY.md` as the File, but this hook writes to `.pending-turns.jsonl` and spawns background updater. File column contradicts Purpose column.
- **Fix**: Change File column to:
  ```markdown
  | `stop-update-memory` | Stop | `.memory/.pending-turns.jsonl` | Captures assistant turns to queue. Throttled...Spawns background updater. |
  ```

### MEDIUM

**2. `background-memory-update` omitted from file-organization.md hook listing** — `docs/reference/file-organization.md:45-55`
**Confidence**: 85%
- **Problem**: Directory tree lists 9 hook entries but omits `background-memory-update`, which is key to the queue pipeline. New `prompt-capture-memory` was correctly added.
- **Fix**: Add to directory tree:
  ```
  │       ├── background-memory-update  # Background: queue-based WORKING-MEMORY.md updater
  ```

**3. `background-memory-update` omitted from CLAUDE.md hook listing** — `CLAUDE.md:60`
**Confidence**: 82%
- **Problem**: Parenthetical hooks listing updated to add `prompt-capture-memory` but omitted `background-memory-update`.
- **Fix**: Add to list:
  ```
  │   └── hooks/              # Working Memory + ambient + learning hooks (prompt-capture-memory, stop-update-memory, background-memory-update, session-start-memory, session-start-classification, pre-compact-memory, preamble, session-end-learning, background-learning)
  ```

---

## Pre-existing Issues (Informational, Not Blocking)

### HIGH

- **PF-005: HookEntry/HookMatcher/Settings interfaces duplicated 4x** — Partially resolved; memory.ts now imports from shared module
- **PF-002: Init command monolith** — This PR adds 5 lines; acknowledged architectural debt

### MEDIUM

- **Concurrent append to `.pending-turns.jsonl` without locking** (Confidence: 80%) — Acceptable for local POSIX filesystems; atomic under PIPE_BUF
- **`--dangerously-skip-permissions` grants unrestricted access** — Known architectural trade-off; mitigated by 120s timeout, restricted scope, content truncation
- **PF-006 partially addressed** — Per-line subprocess spawning eliminated in `background-memory-update` via single-pass extraction

### LOW

- Queue file permissions (chmod 600) could harden shared system safety
- Node fallback `catch {}` silently swallows parse errors (resilience vs logging trade-off)
- Overflow threshold (200/100) cross-referenced in comments but could be a shared constant

---

## What Went Well

1. **Architectural decomposition is clean**: Extracting prompt capture from preamble into dedicated `prompt-capture-memory` hook correctly applies SRP. Preamble is now zero-file-I/O (classification only).

2. **PF-006 addressed**: Per-line subprocess spawning eliminated in `background-memory-update` with single-pass jq/node TSV extraction — a clear performance win.

3. **CWD validation added consistently**: All hooks now validate that CWD exists before proceeding (defensive improvement).

4. **Test coverage expanded**: 51 memory tests + 70 shell-hook tests added; all pass. Upgrade path, toggle cycles, content-array handling all tested.

5. **Documentation updated**: CLAUDE.md, file-organization.md, memory.ts JSDoc, and test descriptions all updated from "3 hooks" to "4 hooks".

---

## Action Plan

1. **Extract `cleanupQueueFiles` utility** — Fixes Blocking Issues #1 and Should-Fix #1
2. **Consolidate `prompt-capture-memory` json_field calls** — Fixes Blocking Issue #2
3. **Restore `changed` flag to `addMemoryHooks`** — Fixes Blocking Issue #3
4. **Use git root for `.memory/` path resolution** — Fixes Blocking Issue #4
5. **Add feedback-loop guard tests** — Fixes Blocking Issue #5
6. **Add truncation boundary tests** — Fixes Blocking Issue #6
7. **Add background-memory-update extraction test** — Fixes Blocking Issue #7
8. **Extract `get_mtime` to shared helper** — Fixes Should-Fix #2
9. **Fix documentation references** — Fixes Documentation Issues #1-3

---

## Summary

The PR represents solid architectural work: queue-based memory extraction, preamble simplification, and PF-006 resolution. The prompt-capture-memory hook is well-designed and focused. However, 7 blocking issues must be resolved: test quality gaps (queue cleanup, feedback-loop guards, truncation boundaries, extraction refactor), performance consolidation (json_field subprocess overhead), and reliability improvements (path resolution, idempotency tracking). These are straightforward to address. Once resolved, this will be a strong addition to the working memory system.

**Recommendation**: Resubmit after addressing blocking issues.
