# Performance Review Report

**Branch**: feat/project-knowledge-99 -> main
**Date**: 2026-03-14
**PR**: #140 — feat: Wave 2 — project knowledge system (decisions + pitfalls)

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Sequential file reads in session-start hook when parallel is possible** - `scripts/hooks/session-start-memory:126-132`

- Problem: The hook iterates over `decisions.md` and `pitfalls.md` sequentially using a `for` loop, running `head -1` and `sed` for each file. While this is a shell script and the files are small, the design opens the door to latency on slow filesystems (e.g., NFS-mounted home directories or encrypted volumes). More importantly, each iteration spawns two subprocesses (`head` and `sed`) that could be combined into one.
- Impact: Adds 2-4 subprocess spawns to the session-start critical path. Session-start hooks run synchronously before Claude becomes interactive, so every millisecond here delays the user.
- Fix: Combine `head -1` and `sed` into a single `sed` invocation, reducing subprocess spawns by half:

```bash
for kf in "$KNOWLEDGE_DIR"/decisions.md "$KNOWLEDGE_DIR"/pitfalls.md; do
  if [ -f "$kf" ]; then
    TLDR_LINE=$(sed -n '1s/<!-- TL;DR: \(.*\) -->/\1/p' "$kf")
    if [ -n "$TLDR_LINE" ]; then
      KNOWLEDGE_TLDR="${KNOWLEDGE_TLDR}${TLDR_LINE}\n"
    fi
  fi
done
```

This eliminates the separate `head -1` call and the `grep -qv '^#'` check (which is redundant since a valid TL;DR comment line never starts with `#` after the sed substitution extracts the inner content — if the sed doesn't match, `TLDR_LINE` is empty).

**Severity**: HIGH (session-start is hot path for user-perceived responsiveness)

---

### MEDIUM

**Regex-based ADR/PF number extraction scans entire file on every append** - `plugins/devflow-implement/commands/implement.md:349-355` and `plugins/devflow-code-review/commands/code-review.md:125-131`

- Problem: The instruction to "Find highest ADR-NNN number via regex (`/^## ADR-(\d+)/`)" requires scanning the entire `decisions.md` or `pitfalls.md` file on each append. With the 50-entry cap, this is bounded, but it is an O(n) scan that could be avoided.
- Impact: LOW for now (50-entry cap keeps n small), but the design pattern sets a precedent. If the cap were raised or the regex were applied during session-start rather than during infrequent append operations, it would matter more.
- Fix: Consider storing the current highest ID in the TL;DR comment itself (e.g., `<!-- TL;DR: 3 decisions. Next: ADR-004. Key: ... -->`). This makes append O(1) by reading only line 1. However, given the 50-entry cap and the fact that appends happen only at the end of `/implement` or `/code-review` flows (not on the hot path), this is an acceptable trade-off in the current design.

**Severity**: MEDIUM (bounded by cap, infrequent operation, but sets a suboptimal pattern)

---

**Mkdir-based lock with 30s timeout and 60s stale recovery** - `plugins/devflow-implement/commands/implement.md:355`, `plugins/devflow-code-review/commands/code-review.md:133`

- Problem: The lock strategy (`mkdir -based lock at .memory/.knowledge.lock (30s timeout, 60s stale recovery)`) is specified but the implementation details are left to the agent. The 30s timeout is unusually long for a lock that guards 2-3 Read/Write operations on small files. If an agent hangs or crashes without cleanup, other commands will block for up to 60 seconds before stale recovery kicks in.
- Impact: In the worst case, a crashed `/implement` session could delay the next `/code-review` pitfall recording by 60 seconds. This is unlikely but worth noting since these are interactive workflows.
- Fix: Reduce the timeout to 5s and stale recovery to 15s. These are small file append operations that should complete in under 1 second:

```
Use mkdir-based lock at `.memory/.knowledge.lock` (5s timeout, 15s stale recovery) if writing.
```

**Severity**: MEDIUM (rare worst-case scenario, but the specified timeouts are disproportionate to the operation)

---

### LOW

**Reviewer agents instructed to read full pitfalls.md on every review** - `shared/agents/reviewer.md:45`

- Problem: Step 1.5 instructs the reviewer agent to "Read `.memory/knowledge/pitfalls.md` if it exists." With up to 50 entries, each containing Area, Issue, Impact, Resolution, and Source fields, this file could grow to several KB. Every reviewer agent (7-11 spawn per `/code-review`) reads the full file.
- Impact: With 7-11 parallel reviewer agents each reading the same file, this is 7-11 redundant file reads. However, these are small files (a few KB at most), the reads are parallel, and the file is on local disk, so the actual wall-clock impact is negligible. The larger concern is token consumption — injecting 50 pitfall entries into each of 7-11 agent contexts adds token overhead.
- Fix: This is more of a token-efficiency concern than a performance concern. Consider having the orchestrator read pitfalls.md once and pass only relevant pitfalls (filtered by files in diff) to each reviewer agent. However, this would require changes to the orchestration layer and is not worth blocking for. The current approach is simple and correct.

**Severity**: LOW (technically redundant I/O, but negligible real-world impact)

---

**Coder agent reads both decisions.md and pitfalls.md sequentially** - `shared/agents/coder.md:38-39`

- Problem: The coder agent is instructed to read `decisions.md` and then `pitfalls.md` as separate operations. These are independent reads that could be done in parallel.
- Impact: Minimal. These are small local file reads, and the coder agent has many other setup operations. The sequential nature adds a few milliseconds at most.
- Fix: Not worth changing — the instruction format naturally reads as sequential, and the performance difference is negligible for local file I/O.

**Severity**: LOW (micro-optimization, not actionable)

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Session-start hook reads entire WORKING-MEMORY.md into shell variable** - `scripts/hooks/session-start-memory:28`

- Problem: `MEMORY_CONTENT=$(cat "$MEMORY_FILE")` reads the entire working memory file into a shell variable. This is pre-existing behavior, but the PR adds more content to the CONTEXT variable (knowledge TL;DR section), increasing the total size of the string being assembled and ultimately passed through `jq`.
- Impact: Shell variables and `jq` string processing are not optimized for large strings. With the cumulative additions (working memory + patterns + git state + compact note + knowledge TL;DR + ambient skill), the CONTEXT variable could reach 10-20KB in a mature project, all processed through `jq -n --arg`.
- Fix: This is pre-existing and the knowledge TL;DR adds only ~30-50 tokens (~200-400 bytes). Not worth refactoring the entire hook for this PR.

**Severity**: MEDIUM (pre-existing pattern, this PR adds marginal overhead)

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Session-start hook spawns multiple subprocesses for git state** - `scripts/hooks/session-start-memory:83-86`

- Problem: Three separate git commands (`git branch`, `git status`, `git log`) are run sequentially. These could potentially be combined or at least run with minimal forking.
- Impact: Adds ~50-100ms to session startup on typical repositories. Not introduced by this PR.

### LOW

**createMemoryDir makes two sequential mkdir calls** - `src/cli/utils/post-install.ts:480-481`

- Problem: `fs.mkdir(memoryDir, { recursive: true })` followed by `fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true })` — the second call is redundant since `recursive: true` would create both directories in one call if the path were specified directly.
- Impact: One extra async I/O operation during install (one-time cost). Negligible.
- Fix: Could use a single `mkdir` with the full `knowledge` subpath, since `recursive: true` creates all intermediate directories. But this runs once during install, so it does not matter.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 2 |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 1 |

**Performance Score**: 8/10

This PR introduces a lightweight knowledge system that is well-bounded (50-entry caps, TL;DR-only injection at session start, full reads only when contextually relevant). The session-start hook addition is the most performance-sensitive change and adds minimal overhead (~30-50 tokens of TL;DR content, 2-4 extra subprocess spawns). The lock timeouts are conservative but affect rare edge cases only.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Consider combining `head -1 | sed` into a single `sed` invocation in the session-start hook to reduce subprocess spawns on the hot path (HIGH issue).
2. Consider reducing mkdir-based lock timeouts from 30s/60s to 5s/15s since the guarded operations are trivially fast (MEDIUM issue).

Both conditions are straightforward, low-risk changes. The overall performance design is sound — the TL;DR injection pattern keeps session-start overhead to ~30-50 tokens, the 50-entry cap prevents unbounded growth, and append operations happen on non-critical paths (end of workflow commands). No critical performance regressions detected.
