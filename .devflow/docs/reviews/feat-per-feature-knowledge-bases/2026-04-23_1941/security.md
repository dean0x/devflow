# Security Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23

## Issues in Your Changes (BLOCKING)

### HIGH

**`--dangerously-skip-permissions` flag used in `devflow kb create` and `devflow kb refresh`** - `src/cli/commands/kb.ts:206-207,288-289`
**Confidence**: 92%
- Problem: The `kb create` and `kb refresh` commands invoke `claude -p` with `--dangerously-skip-permissions`, which bypasses all permission checks for the spawned claude process. The spawned process receives a prompt that includes user-provided values (`slug`, `name`, `directoriesRaw`) which are interpolated into a multi-line prompt string passed via `-p`. While `execFileSync` with array args prevents shell injection at the OS level, the spawned `claude` process receives a prompt containing user-controlled strings (`name`, `slug`, `directories`) that shape its behavior. An adversarial feature name or directory value could instruct the LLM to perform unintended actions with full tool access (prompt injection). The `--allowedTools` whitelist (`Read,Grep,Glob,Write,Bash`) includes `Bash` and `Write`, giving the injected instructions broad filesystem access with no permission gates.
- Fix: Consider removing `--dangerously-skip-permissions` and relying on the standard permission model. If that is not feasible (e.g., non-interactive context), restrict `--allowedTools` to exclude `Bash` (the KB Builder agent's `tools` frontmatter already lists its needed tools; the prompt could use `--allowedTools Read,Grep,Glob,Write` instead). Additionally, validate that `name` and `directoriesRaw` do not contain prompt injection payloads (e.g., reject values containing backticks, markdown code fences, or "Instructions:" preambles).

```typescript
// Current (kb.ts:203-208):
execFileSync('claude', [
  '-p', prompt,
  '--allowedTools', 'Read,Grep,Glob,Write,Bash',
  '--dangerously-skip-permissions',
], { ... });

// Suggested: remove Bash from allowedTools, or remove --dangerously-skip-permissions
execFileSync('claude', [
  '-p', prompt,
  '--allowedTools', 'Read,Grep,Glob,Write',
], { ... });
```

---

**User-controlled `name` and `directoriesRaw` interpolated into LLM prompt without sanitization** - `src/cli/commands/kb.ts:178-200,270-285`
**Confidence**: 85%
- Problem: In both `kb create` (line 178-200) and `kb refresh` (line 270-285), the user-provided `name` (from interactive prompt) and `directoriesRaw` are directly interpolated into the prompt string sent to `claude -p`. Combined with `--dangerously-skip-permissions`, a malicious or unintentionally adversarial value in the feature name (e.g., containing LLM control tokens like `\n\nIgnore previous instructions...`) could manipulate the spawned agent's behavior. This is a prompt injection vector.
- Fix: Sanitize user inputs before interpolation into the prompt: strip control characters, limit to alphanumeric + common punctuation, and cap length. Alternatively, pass structured data via a temporary JSON file rather than embedding it in the prompt string.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No validation on `worktreePath` argument in CLI interface** - `scripts/hooks/lib/feature-kb.cjs:372,384,403,437,450`
**Confidence**: 82%
- Problem: The CLI interface accepts `argv[1]` as `worktreePath` and passes it through `path.resolve()` but does not validate that the resolved path is a real directory or within expected boundaries. While the architecture exception comment (lines 9-14) correctly notes this is a developer-facing tool invoked by trusted orchestration scripts, the CLI interface is also directly invocable by anyone with shell access (e.g., `node feature-kb.cjs remove /etc slug`). The `validateSlug` function prevents path traversal via the slug, but the worktree path itself is unchecked. The `removeEntry` function at line 307-310 calls `fs.rmSync(kbDir, { recursive: true, force: true })` where `kbDir = path.join(featuresDir, slug)` and `featuresDir = path.join(worktreePath, '.features')`. A crafted worktree path could target unexpected filesystem locations.
- Fix: Add a basic existence check for the worktree argument in the CLI interface:
```javascript
if (!fs.existsSync(worktreePath) || !fs.statSync(worktreePath).isDirectory()) {
  process.stderr.write(`Error: worktree path does not exist or is not a directory: ${worktreePath}\n`);
  process.exit(1);
}
```
This follows the defense-in-depth principle noted in the D52 comment. The risk is LOW given the trusted caller context, but the check is cheap and prevents accidental misuse.

---

**Lock stale detection uses `mtimeMs` which can be manipulated** - `scripts/hooks/lib/feature-kb.cjs:180-184`
**Confidence**: 80%
- Problem: The lock staleness check uses `stat.mtimeMs` to determine if a lock directory is stale (older than 60s). On shared filesystems or in edge cases, mtime can be unreliable or manipulated, potentially causing premature lock release. However, this follows the same pattern as the existing `.memory/.knowledge.lock` mechanism, so it is consistent with the codebase.
- Fix: This is informational — the pattern is accepted in the codebase (knowledge-context.cjs uses the same approach). No change needed unless the project moves to a more robust locking mechanism.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing security issues found in reviewed files._

## Suggestions (Lower Confidence)

- **JSON.parse of untrusted index.json content** - `scripts/hooks/lib/feature-kb.cjs:82,234,298` (Confidence: 65%) -- `loadIndex` parses `.features/index.json` without schema validation. A malformed or malicious index could contain unexpected field types (e.g., `referencedFiles` as a string instead of array). Zod or manual validation of the parsed structure would add defense-in-depth, though the file is project-controlled and committed to git.

- **`Atomics.wait` fallback comment mentions "Node < 16 fallback: busy-wait"** - `scripts/hooks/lib/feature-kb.cjs:191-192` (Confidence: 60%) -- The fallback comment says "busy-wait" but actually just continues to the next loop iteration after the catch. This is fine behavior-wise, but the comment is misleading. Minor documentation concern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core runtime module (`feature-kb.cjs`) demonstrates strong security practices: `execFileSync` with array args (not shell strings), comprehensive slug validation with path traversal prevention, and proper defense-in-depth documentation. The primary concern is the CLI command (`kb.ts`) using `--dangerously-skip-permissions` with user-controlled prompt content, which creates a prompt injection surface. The KB Builder agent and orchestration skills (markdown files) are not executable code and pose no direct security risk. PF-001 (Promise resolver naming) is not relevant to this review -- the changed code does not involve Promise callbacks in the affected area.
