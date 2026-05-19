# Code Review Summary

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09_0130

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces a meaningful architectural improvement (queue-based turn capture replacing fragile transcript extraction) but carries several blocking issues that must be resolved before merge:

1. **Per-line subprocess spawning in turn-parsing loop** (HIGH, Blocking) — Reintroduces PF-006 anti-pattern
2. **Concurrent append race on queue file** (HIGH, Blocking) — Data integrity risk under rapid-fire prompts
3. **Missing test coverage for critical paths** (HIGH, Blocking) — Content array format and overflow truncation untested
4. **Shell injection in test helper** (HIGH, Blocking) — Unsafe JSON serialization pattern

All reviewers were unanimously aligned on the first three issues (flagged by 4+ reviewers each). These must be fixed before merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 4 | 4 | 0 | 8 |
| Should Fix | 0 | 0 | 5 | 0 | 5 |
| Pre-existing | 0 | 0 | 4 | 2 | 6 |

**Breakdown by domain:**
- Security: 1 HIGH + 2 MEDIUM blocking
- Architecture: 2 HIGH + 1 MEDIUM blocking
- Performance: 1 HIGH + 1 MEDIUM blocking
- Complexity: 1 HIGH + 2 MEDIUM blocking
- Consistency: 2 HIGH + 2 MEDIUM blocking
- Regression: 0 critical (1 MEDIUM blocking)
- Testing: 2 HIGH + 2 MEDIUM blocking
- TypeScript: 1 HIGH blocking
- Documentation: 1 HIGH + 2 MEDIUM blocking

---

## Blocking Issues

### 1. Per-Line Subprocess Spawning (HIGH)
**Files**: `scripts/hooks/background-memory-update:148-181`
**Confidence**: 95% (flagged by 4 reviewers: architecture, performance, complexity, regression)

The turn-building while-read loop calls `json_field` twice per JSONL entry (role + content). Each invocation spawns a jq or node subprocess. With 20-line cap (10 turns × 2), this creates **40 subprocess spawns per invocation**. This is the exact pattern documented in PF-006 as adding 1-3s latency.

**Impact**: Measurable latency (100-500ms with jq, 2-4s with node fallback), increased CPU cost, extends lock hold time.

**Fix**: Use single-pass `jq -s` (slurp) to extract all roles/contents at once:

```bash
if [ "$_HAS_JQ" = "true" ]; then
  PARSED=$(echo "$ENTRIES" | jq -r '[.[] | .role, .content] | @tsv')
else
  PARSED=$(echo "$ENTRIES" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      d.trim().split('\n').filter(Boolean).forEach(l=>{
        try{const o=JSON.parse(l);console.log(o.role+'\t'+o.content)}catch(e){}
      })
    })")
fi

CURRENT_USER=""
while IFS=$'\t' read -r ROLE CONTENT; do
  # ... same pairing logic, but ROLE/CONTENT already extracted
done <<< "$PARSED"
```

---

### 2. Concurrent Append Race on Queue File (HIGH)
**Files**: `scripts/hooks/preamble:33`, `scripts/hooks/stop-update-memory:76`
**Confidence**: 85% (flagged by 4 reviewers: security, architecture, performance, consistency)

Both preamble (UserPromptSubmit) and stop-update-memory (Stop) append to `.pending-turns.jsonl` using shell `>>` without locking. While POSIX `O_APPEND` is atomic for small writes, the jq/node output with escaping can approach PIPE_BUF (4096 bytes, 512 on some macOS). Concurrent invocations (e.g., rapid prompts overlapping with stop) could interleave partial lines on systems where atomicity breaks.

**Impact**: Corrupted JSONL entries cause silent data loss (turns discarded by json_field parsing failures). Not catastrophic (stale memory, not data loss) but defeats queue purpose.

**Fix**: Use write-to-tempfile-then-rename pattern for defense in depth:

```bash
_TMP=$(mktemp "$CWD/.memory/.pending-turns.XXXXXX")
jq -n -c --arg role "user" --arg content "$_TRUNCATED_PROMPT" --argjson ts "$_TS" \
  '{role: $role, content: $content, ts: $ts}' > "$_TMP"
cat "$_TMP" >> "$CWD/.memory/.pending-turns.jsonl"
rm -f "$_TMP"
```

Alternatively, document the PIPE_BUF assumption explicitly with a comment noting macOS caveat.

---

### 3. Missing Test for Content Array Format (HIGH)
**File**: `tests/shell-hooks.test.ts`
**Confidence**: 85% (flagged by testing reviewer)

The stop hook handles two `assistant_message` formats:
- Plain string: `assistant_message: 'text'`
- Content array: `assistant_message: [{type: 'text', text: '...'}]`

Tests only exercise the string format. The content array branch (jq path `.assistant_message[] | select(.type == "text")` and node fallback) is completely untested.

**Fix**: Add test case:

```typescript
it('stop_reason end_turn with content array — extracts text blocks', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

  const input = JSON.stringify({
    cwd: tmpDir,
    session_id: 'test-session-005',
    stop_reason: 'end_turn',
    assistant_message: [
      { type: 'text', text: 'First paragraph' },
      { type: 'tool_result', content: 'ignored' },
      { type: 'text', text: 'Second paragraph' },
    ],
  });

  execSync(`bash "${STOP_HOOK}"`, {
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
  const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]);
  expect(entry.content).toContain('First paragraph');
  expect(entry.content).toContain('Second paragraph');
});
```

---

### 4. Missing Test for Queue Overflow Truncation (HIGH)
**File**: `tests/shell-hooks.test.ts`
**Confidence**: 82% (flagged by testing reviewer)

The stop hook implements queue overflow safety: when `.pending-turns.jsonl` exceeds 200 lines, truncate to last 100. This safety mechanism has zero test coverage. Bugs in overflow handling (data corruption, off-by-one errors) would go undetected.

**Fix**: Add test:

```typescript
it('queue overflow — truncates to last 100 when > 200 lines', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

  const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
  const entries = Array.from({ length: 201 }, (_, i) =>
    JSON.stringify({ role: 'user', content: `msg-${i}`, ts: 1000 + i })
  );
  fs.writeFileSync(queueFile, entries.join('\n') + '\n');

  const input = JSON.stringify({
    cwd: tmpDir,
    session_id: 'test-overflow',
    stop_reason: 'end_turn',
    assistant_message: 'overflow trigger',
  });

  execSync(`bash "${STOP_HOOK}"`, {
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
  expect(lines.length).toBeLessThanOrEqual(101);
});
```

---

### 5. Shell Injection in Test Helper (HIGH)
**File**: `tests/shell-hooks.test.ts:772, 791, 816, 840`
**Confidence**: 82% (flagged by TypeScript reviewer)

The test pattern `echo '${input.replace(/'/g, "'\\''")}' | bash ...` escapes single quotes but does not guard against backticks, `$()`, or newlines that could appear in JSON values. While test-only, the pattern is fragile and could break if test data evolves.

**Fix**: Use `execSync` with `input` option to pipe via stdin instead of shell interpolation:

```typescript
execSync(`bash "${STOP_HOOK}"`, {
  input: JSON.stringify({ cwd: tmpDir, stop_reason: 'end_turn', assistant_message: 'test' }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

This pattern already exists elsewhere in the same file (temporal-decay tests). Use consistently.

---

### 6. Unvalidated `$CWD` Path Construction (HIGH)
**File**: `scripts/hooks/stop-update-memory:23`, `scripts/hooks/background-memory-update:13`
**Confidence**: 80% (flagged by security reviewer)

`$CWD` is extracted from hook input JSON via `json_field "cwd" ""` and used directly in path construction without validation. While hook input comes from Claude Code harness (trusted boundary), a `-d` directory existence check provides defense in depth.

**Fix**: Add one-line check:

```bash
CWD=$(echo "$INPUT" | json_field "cwd" "")
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then exit 0; fi
```

---

## Should-Fix Issues (Lower Priority)

### 1. Node Argument Parsing (MEDIUM)
**File**: `scripts/hooks/preamble:35`, `scripts/hooks/stop-update-memory:78`
**Confidence**: 82% (security reviewer)

User-controlled content (`$_TRUNCATED_PROMPT`, `$ASSISTANT_MSG`) passed to `node -e` via positional args. While `process.argv` is safe from injection, if content starts with `--`, node could misinterpret it as flags.

**Fix**: Add `--` separator:

```bash
node -e "process.stdout.write(JSON.stringify({role:'user',content:process.argv[1],ts:parseInt(process.argv[2])})+'\n')" \
  -- "$_TRUNCATED_PROMPT" "$_TS" >> "$CWD/.memory/.pending-turns.jsonl"
```

---

### 2. Preamble Header Comment Inaccuracy (MEDIUM)
**Files**: `scripts/hooks/preamble:5`
**Confidence**: 95% (flagged by 3 reviewers: architecture, consistency, documentation)

Header states "Zero file I/O beyond stdin -- static injection only." but new code appends to `.memory/.pending-turns.jsonl`. Comment is now factually incorrect and misleads future maintainers.

**Fix**: Update to:

```bash
# Injects a detection-only preamble. Classification rules only — skill mappings live in devflow:router.
# Also captures user prompts to .memory/.pending-turns.jsonl for working memory.
```

---

### 3. CLAUDE.md Hook Count and Architecture (MEDIUM)
**File**: `CLAUDE.md:41`
**Confidence**: 82% (documentation reviewer)

Text says "Three shell-script hooks" but the new architecture involves four: preamble (user), stop-update-memory (assistant), background-memory-update (processor), session-start-memory (injector).

**Fix**: Change to "Four shell-script hooks" or rephrase to avoid counting.

---

### 4. Inconsistent JSON Construction Abstraction (MEDIUM)
**Files**: `scripts/hooks/stop-update-memory:74-79`, `scripts/hooks/preamble:31-36`
**Confidence**: 85% (consistency reviewer)

Both hooks construct JSON using raw `jq -n -c --arg` and node fallback. The `json-parse` library provides `json_construct` helper that wraps this pattern. Using raw approach duplicates abstraction, means future changes need updating in 4 places.

**Fix**: Replace with `json_construct`:

```bash
json_construct --arg role "assistant" --arg content "$ASSISTANT_MSG" --argjson ts "$TS" >> "$QUEUE_FILE"
```

---

### 5. Duplicated Mtime Extraction Logic (MEDIUM)
**Files**: `scripts/hooks/stop-update-memory:96-100`, `scripts/hooks/background-memory-update:41-47`
**Confidence**: 82% (complexity, consistency reviewers)

The Linux/macOS `stat` mtime extraction is duplicated. Stop hook inlines it, background-memory-update wraps it in `get_mtime()` function. If detection logic needs a fix, it must be applied in two places.

**Fix**: Extract to shared helper or source `get_mtime()` from background-memory-update.

---

## Pre-Existing Issues (Informational)

| Issue | Severity | Count |
|-------|----------|-------|
| Monolithic background-memory-update script (PF-004 pattern) | MEDIUM | 2 |
| Full prompt logged to `.devflow/logs/` (sensitive data) | MEDIUM | 1 |
| Crash recovery `.processing` file lacks max-age check | MEDIUM | 1 |
| Queue file as implicit contract between scripts (no schema) | MEDIUM | 1 |

These do not block the PR but should be tracked for future refactoring.

---

## Testing Coverage Summary

**New Tests Added** (4 comprehensive test blocks):
- ✅ Stop hook with tool_use filtering
- ✅ Stop hook with end_turn capture
- ✅ Preamble hook user capture
- ✅ Missing .memory/ graceful exit
- ✅ JSONL format schema validation

**Coverage Gaps** (introduced by this PR):
- ❌ Content array format for assistant_message (HIGH)
- ❌ Queue overflow truncation (HIGH)
- ❌ Empty assistant_message skip behavior (MEDIUM)
- ❌ Message truncation to 2000 chars (MEDIUM)
- ❌ Background updater turn-pairing logic (MEDIUM, shell-only)

---

## Action Plan

**Before Merge (Blocking):**
1. Fix per-line subprocess spawning with single-pass jq -s (HIGH priority, all domains affected)
2. Add concurrent append safety via tempfile-then-rename pattern (HIGH priority, data integrity)
3. Add test for content array format (HIGH priority, missing coverage)
4. Add test for queue overflow truncation (HIGH priority, safety mechanism untested)
5. Fix shell injection in test helper (HIGH priority, TypeScript vulnerability)

**Before Merge (Should-Fix):**
6. Update preamble header comment to reflect file I/O
7. Add `-d "$CWD"` directory check
8. Add `--` separator in node invocations
9. Fix CLAUDE.md hook count reference
10. Replace raw JSON construction with json_construct helper

**Post-Merge (Tech Debt):**
- Extract get_mtime to shared helper
- Add post-merge ADR for queue file schema
- Plan refactoring to move JSON logic from shell scripts to TypeScript (PF-004 follow-up)

---

## Scores by Domain

| Domain | Score | Status |
|--------|-------|--------|
| Security | 7/10 | APPROVED_WITH_CONDITIONS |
| Architecture | 7/10 | CHANGES_REQUESTED |
| Performance | 7/10 | CHANGES_REQUESTED |
| Complexity | 7/10 | APPROVED_WITH_CONDITIONS |
| Consistency | 6/10 | CHANGES_REQUESTED |
| Regression | 9/10 | APPROVED_WITH_CONDITIONS |
| Testing | 6/10 | CHANGES_REQUESTED |
| TypeScript | 7/10 | APPROVED_WITH_CONDITIONS |
| Documentation | 6/10 | CHANGES_REQUESTED |

**Overall Score**: 7/10 — Significant improvement in architecture (queue-based capture), but blocking issues with subprocess performance and test coverage must be resolved.

---

## Summary

The PR makes a meaningful architectural improvement by replacing fragile transcript extraction with a queue-based turn capture system. The atomic mv-based handoff and crash recovery patterns are well-designed. However, the implementation reintroduces the PF-006 per-line subprocess spawning anti-pattern in a new location (turn parsing loop), introduces a concurrent append race without mitigation, and lacks test coverage for two critical paths (content array format and overflow safety). These must be fixed before merge to avoid carrying forward known performance issues and untested code paths.
