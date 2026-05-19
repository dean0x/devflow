# Security Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Date**: 2026-04-15 10:22
**Diff**: `git diff bd1c92f...HEAD`
**Primary focus**: knowledge index + on-demand Read implementation
  - `scripts/hooks/lib/knowledge-context.cjs`
  - 8 orchestration surfaces invoking `knowledge-context.cjs index "<worktree>"` via Bash
  - `src/cli/utils/legacy-knowledge-purge.ts`

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

_None._

### HIGH

**Shell-substitution placeholder leaks across all 8 orchestration surfaces** — Confidence: 88%
- `plugins/devflow-code-review/commands/code-review.md:97`
- `plugins/devflow-code-review/commands/code-review-teams.md:90`
- `plugins/devflow-resolve/commands/resolve.md:75`
- `plugins/devflow-resolve/commands/resolve-teams.md:68`
- `plugins/devflow-plan/commands/plan.md:78`
- `plugins/devflow-plan/commands/plan-teams.md:78`
- `plugins/devflow-self-review/commands/self-review.md:26`
- `shared/skills/review:orch/SKILL.md:45`, `shared/skills/resolve:orch/SKILL.md:38`, `shared/skills/plan:orch/SKILL.md:42`, `shared/skills/debug:orch/SKILL.md:32`, `docs/self-learning.md:108`
- Problem: Every surface ships the literal template
  `KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "<worktree>")`
  (or `"{worktree}"`, or `"."` in the in-place orch skills). The orchestrator LLM is expected to substitute `<worktree>` / `{worktree}` with the actual path before executing the bash. Substitution is performed by an LLM with **no quoting normalization** on the value before it lands inside the double-quoted shell argument. If a worktree path contains a literal `"` or `$(...)` or `` ` ``, the resulting expansion executes attacker-chosen commands inside the orchestrator's session. Worktree paths are typically chosen by the user, but `git worktree list` output is also consumed verbatim by the discovery flow (`devflow:worktree-support`), and the discovery flow does not sanitize either.
- Impact: Command injection via crafted worktree path. Examples that break the template under naive substitution:
  - `/tmp/foo"; rm -rf $HOME; echo "` — closes the quote, runs arbitrary command, reopens a quote
  - `/tmp/foo$(id)`  — runs `id` even inside double quotes (because `$(...)` is expanded inside `"..."` in bash)
  - `/tmp/foo`` `id```` `` — same with backticks
  - The newer `"."` literal in `shared/skills/{review,resolve,plan,debug}:orch/SKILL.md` and `self-review.md` is safe (cwd literal, no substitution), but the `<worktree>` / `{worktree}` form on the other 8 surfaces is not. The risk is real even in single-worktree mode any time the user invokes commands from a worktree path containing shell metacharacters.
- Fix: Three options, in order of preference:
  1. **Use `--` and `printf %q` (safest)**: Have the orchestrator construct the path via a here-doc or `printf %q`-quoted form before substitution, e.g.
     ```bash
     WT=$(printf %q "<worktree>")
     KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index -- "$WT")
     ```
     and update `knowledge-context.cjs` to skip the leading `--`.
  2. **Pin to cwd via `git -C` pattern**: Several surfaces already use `"."` — extend this to all surfaces, with the orchestrator `cd`ing into the worktree first under a controlled cwd assignment that itself uses `printf %q`.
  3. **Add an explicit "reject paths with shell metacharacters" instruction** in the orchestration prose (defensive but easy to bypass).

  Either way, add a note in `devflow:worktree-support` SKILL.md instructing the orchestrator to validate worktree paths against `[\x00-\x1f"`$\\]` before any shell substitution.

**`legacy-knowledge-purge.ts:212-217` unconditionally `fs.unlink`s `${memoryDir}/PROJECT-PATTERNS.md` without symlink rejection** — Confidence: 82%
- `src/cli/utils/legacy-knowledge-purge.ts:212-217`
- Problem: The purge step calls `await fs.unlink(projectPatternsPath)` directly. If `${memoryDir}/PROJECT-PATTERNS.md` is a symlink (placed by an attacker with write access to `.memory/`, or accidentally by the user), `fs.unlink` removes the symlink itself — which is fine — but the broader pattern in this file (`writeFileAtomicExclusive` in `fs-atomic.ts`) explicitly defends against symlink TOCTOU on writes via `O_EXCL`. The `unlink` here has no equivalent guard, and the path is assembled via plain `path.join` without an `lstat` + `S_ISREG` check.
  Concretely, an attacker who controls a sibling project's `.memory/` (e.g., shared CI cache, multi-user dev box, restored backup) could pre-create `${memoryDir}/PROJECT-PATTERNS.md` as a symlink to e.g. `~/.aws/credentials`. The `unlink` would silently remove the credentials file. This is a low-likelihood scenario (requires hostile filesystem state) but the codebase has explicitly recognized this attack class for writes (D39 in `fs-atomic.ts` cites TOCTOU symlink defense), so the unlink site is inconsistent.
- Fix: Add an `lstat` + symlink check before unlink, or use `fs.rm` with `{ force: false }` and follow with explicit symlink guard:
  ```typescript
  try {
    const st = await fs.lstat(projectPatternsPath);
    if (!st.isFile()) {
      // Skip — not a regular file (symlink, dir, device). Don't delete.
    } else {
      await fs.unlink(projectPatternsPath);
      result.removed++;
      result.files.push(projectPatternsPath);
    }
  } catch { /* doesn't exist — fine */ }
  ```

### MEDIUM

**`knowledge-context.cjs:188` index counter regex matches inside truncated titles** — Confidence: 80%
- `scripts/hooks/lib/knowledge-context.cjs:343-346`
- Problem: The observability log counts entries by re-parsing its own already-rendered output:
  ```javascript
  const adrCount = (result.match(/^\s+ADR-\d+/gm) || []).length;
  const pfCount  = (result.match(/^\s+PF-\d+/gm)  || []).length;
  ```
  The format functions emit lines like `  ADR-001  Title …  [Active]` where `Title` is `truncate(entry.title, 60)`. Because the regex matches `^\s+ADR-\d+` (just the leading whitespace + ID prefix), a malicious or accidentally-crafted title that, after truncation, happens to start with `ADR-NNN` or `PF-NNN` will inflate the counter. More importantly: the count loses fidelity once knowledge files contain user-controlled content that mentions the literal patterns. Today the only writers are the trusted background-learning extractor and the human user editing `pitfalls.md` — but the threat model the SKILL describes ("malicious ADR/PF content") includes hand-edited entries.
- Impact: Observability data poisoning, not exploitation. The stderr log lines `[knowledge-context] mode=index ... entries=N` could overcount; downstream tooling that scrapes this log (today none, but the line is part of the public CLI surface per the file header) would see inflated counts.
- Fix: Use the structured `extractIndexEntries()` data directly rather than reparsing the rendered string:
  ```javascript
  if (mode === 'index') {
    // Re-extract structured entries for accurate count, independent of formatting.
    // (Or thread the count out of loadKnowledgeIndex via a richer return shape.)
    const entries = adrEntries.length + pfEntries.length;
    ...
  }
  ```
  Alternatively, anchor the regex to the fixed two-space prefix used by `formatAdrLine` / `formatPfLine`: `/^ {2}(?:ADR|PF)-\d+ /gm`.

### LOW

_None._

---

## Issues in Code You Touched (Should Fix)

**`json-helper.cjs:204-209` `sliceKnowledgeSection` rebuilds a `RegExp` per call from caller-supplied input** — Confidence: 80%
- `scripts/hooks/json-helper.cjs:204-209`
- Problem: The new shared helper accepts an `anchorId` from the manifest (or — in the heal path — from a regex match against the on-disk knowledge file) and builds a `RegExp` from it. The author already recognized the risk and added `safe = anchorId.replace(/[^A-Z0-9-]/gi, '');`, which is the right guard. However, the regex pattern itself is `(##\\s+${safe}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)`. The `[\s\S]*?` (lazy any-char) followed by an alternation lookahead is a known ReDoS-hostile construct **when the input alternative is large and the lookahead can fail repeatedly**. With knowledge files realistically under ~50 KB and only 2 alternatives in the lookahead, the worst-case backtracking is bounded — so this is not exploitable today. But the pattern is structurally identical to several CVE-class ReDoS templates and should be tightened to remove the doubt.
- Fix: Replace the regex with an `indexOf`-based slice (mirrors what `findUnmanagedAnchors` already does at lines 292-296):
  ```javascript
  function sliceKnowledgeSection(content, anchorId) {
    const safe = anchorId.replace(/[^A-Z0-9-]/gi, '');
    const headingMarker = `## ${safe}`;
    const start = content.indexOf(headingMarker);
    if (start === -1) return null;
    const next = content.indexOf('\n## ', start + 1);
    return next === -1 ? content.slice(start) : content.slice(start, next);
  }
  ```
  This is faster, has no regex backtracking surface at all, and matches the style already used a few lines later in the same file.

---

## Pre-existing Issues (Not Blocking)

_None within scope of this review._

---

## Suggestions (Lower Confidence)

- **Worktree-arg consistency** — `scripts/hooks/lib/knowledge-context.cjs:314` (Confidence: 70%) — The bare-form heuristic (`firstArg.startsWith('/') || firstArg.startsWith('.') || firstArg.startsWith('~') || firstArg.includes('/')`) treats any path-shaped first arg as the deprecated bare form. A worktree literally named `index` or `full` (perfectly legal) would be misinterpreted as a subcommand request with a missing path. Low likelihood, but a strict opt-in would be safer than a heuristic.
- **`extractIndexEntries` returns unbounded `area` strings** — `scripts/hooks/lib/knowledge-context.cjs:96-98` (Confidence: 65%) — `area` is captured with `(.+)` (greedy, no truncation at extraction time) and only truncated at format time (`formatPfLine: truncate(entry.area, 80)`). If a future caller of `extractIndexEntries` consumes `area` directly, an attacker-controlled multi-KB area line would bloat memory. Defensive truncation at the extraction boundary would be cleaner.
- **`knowledge-context.cjs` stderr observability log emits the absolute worktree path** — `scripts/hooks/lib/knowledge-context.cjs:347-349` (Confidence: 60%) — The line `[knowledge-context] mode=index worktree=${worktreePath} entries=N` writes the full absolute path to stderr. In a CI environment that captures stderr into build logs, this leaks workspace layout (often containing usernames, tickets, secret-bearing paths). Consider logging only the basename or a stable hash.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 7 / 10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The knowledge-context module itself is well-designed: the read paths (`fs.readFileSync` on hardcoded `.memory/knowledge/{decisions,pitfalls}.md` joined onto a `path.resolve`'d worktree) have no path-traversal surface, the regexes operate on bounded knowledge files with small alternations, and the `--purge` filesystem ops correctly use `mkdir`-based locking + `writeFileAtomicExclusive` (which is itself defensive against TOCTOU symlink attacks per its D39 design note). The CJS shell-injection-by-content concern is largely neutralized by the fact that the only sinks for the index string are LLM contexts and stderr — never `eval` or `exec` shells.

The two HIGH issues are about the **shell glue connecting the module to its callers**:

1. The 8-surface `<worktree>` template substitution is a real injection vector on any path containing shell metacharacters, and the substitution is performed by an LLM that has not been instructed to quote.
2. The `unlink` in the v2 migration is symlink-vulnerable in a codebase that has explicitly hardened its writes against the same attack class — internal inconsistency that should be resolved.

The MEDIUM index-counter regex is observability-only (no exploitation path) but is a clean fix.

The Should-Fix `sliceKnowledgeSection` regex is a defense-in-depth tightening; it is not exploitable today but trades regex backtracking for a faster `indexOf` slice that matches the rest of the file's idiom.

PF-011 is **directly resolved by this PR** (the index+Read redesign) — `applies PF-011`.
