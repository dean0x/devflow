# Security Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**PR**: #181
**Date**: 2026-04-13_2208
**Scope**: Incremental review of 10 commits (0dd9e24..HEAD) — security hardening follow-up

## Review Summary

This is an **incremental review** of commits that resolved prior review findings. The PR hardens three areas:

1. **TOCTOU hardening** in 4 atomic-write sites (`{ flag: 'wx' }` with EEXIST-retry-once)
2. **Shell/JS injection** mitigation for background-learning's staleness pass (later extracted to `lib/staleness.cjs`)
3. **Path-traversal** fix for `knowledge-usage-scan.cjs` (rejects relative cwd before resolve)
4. **Command injection** mitigation in learn.ts (`execSync` → `execFileSync` with argv array)
5. **CPU resource-abuse** mitigation in knowledge-usage-scan.cjs (`Atomics.wait` replacing busy-spin)
6. **Runtime JSON validation** via `isNotificationMap` / `isCountActiveResult` / `isRawObservation` guards

All claimed fixes implement the stated security property correctly. No new security vulnerabilities introduced. Known pre-existing issues (documented in `.memory/knowledge/pitfalls.md` as PF-007, PF-009, PF-010) are partially or fully addressed.

**Known pitfalls check**: PF-007 (migrations-after-installer) resolved via cdec1cd. PF-009 (busy-wait in per-turn hooks) resolved via ab20b47's `Atomics.wait`. PF-010 (unvalidated JSON.parse) partially addressed — new guards cover `.notifications.json` and `count-active` result, but multiple `JSON.parse ... as Settings` casts remain in `learn.ts` (lines 122, 156, 189, 298, 866, 1127, 1309) as pre-existing issues.

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

### LOW

**`$transcript` shell interpolation into `node -e` JS string** — `scripts/hooks/background-learning:172`
**Confidence**: 90%
- Problem: `readFileSync('$transcript', 'utf8')` interpolates `$transcript = $projects_dir/$sid.jsonl` directly into a single-quoted JS string. If `$CWD` (passed from hook JSON) contains a single quote, it breaks out of the JS string literal enabling arbitrary code execution in the node -e context.
- Origin: Pre-existing at 0dd9e24. The PR's staleness extraction (595d1a9) actually REMOVED one similar instance (`${stale_ref}` in `staleReason`), so the PR is strictly better.
- Mitigation: `$sid` is validated to `^[a-zA-Z0-9_-]+$` by `session-end-learning` before being written to `.learning-batch-ids` (so `$sid` is safe). But `$CWD` embedded in `$encoded_cwd` has no such validation — a user with a `'`-containing pwd would trigger the vulnerability.
- Recommended fix (separate PR): Pass `transcript` as argv:
  ```bash
  filter_result=$(node -e "
    const { extractChannels } = require(process.argv[1]);
    const content = require('fs').readFileSync(process.argv[2], 'utf8');
    const result = extractChannels(content);
    process.stdout.write(JSON.stringify(result.userSignals) + '\t' + JSON.stringify(result.dialogPairs));
  " "$filter_module" "$transcript" 2>>"$LOG_FILE" || echo "[]	[]")
  ```

**Path-existence probe via user-controlled strings** — `scripts/hooks/lib/staleness.cjs:37-43`
**Confidence**: 85%
- Problem: `FILE_REF_RE` extracts any string matching `[A-Za-z0-9_/.-]+\.(ts|tsx|...)` from `details`/`evidence` fields (LLM output, indirectly user-controlled). For absolute paths, `fs.existsSync(ref)` probes any filesystem location. For relative paths, `path.join(cwd, ref)` allows `../../etc/passwd.sh`-style traversal. Side effect is limited to yes/no existence disclosure written into the log's `staleReason` field.
- Origin: Behavior identical to the pre-existing shell implementation. Not introduced by this PR.
- Severity rationale: Info disclosure only (existence probe, no read/write). The log file is user-local, so the "attacker" is the user themselves. Not exploitable in practice but worth tightening.
- Recommended fix (separate PR): Normalise `ref` via `path.resolve(cwd, ref)` then require `absPath.startsWith(cwd)` before calling `existsSync`. Skip absolute refs entirely — they are almost certainly LLM hallucinations, not real project paths.

## Suggestions (Lower Confidence)

- **`applyConfigLayer` trusts `JSON.parse` output without Zod validation** — `src/cli/commands/learn.ts:297` (Confidence: 75%) — Per-field `typeof` guards catch wrong types, but a malicious `learning.json` with prototype pollution keys (e.g., `__proto__`) or unbounded `max_daily_runs` values still pass. Project pitfall PF-010 calls out this class of bug; matches CLAUDE.md "Validate at boundaries (Zod schemas)" principle. This PR introduces `isNotificationMap`/`isCountActiveResult` for other reads but leaves `applyConfigLayer` unchanged — minor inconsistency.

- **`writeExclusive` EEXIST retry: unbounded-recursion risk if attacker wins the race twice** — `scripts/hooks/json-helper.cjs:137-146` (Confidence: 65%) — The retry only runs once; second EEXIST throws. This is correct fail-closed behavior, but a determined attacker could cause repeated writeJsonlAtomic failures by racing a symlink plant after each unlink. Practical impact is limited (DoS of the learning log update, which is already tolerant of failures). Worth documenting the failure mode in the function's JSDoc.

- **`$filter_module` interpolation** — `scripts/hooks/background-learning:171` (Confidence: 60%) — Same injection class as `$transcript` but lower risk because `$SCRIPT_DIR = $(cd "$(dirname "$0")" && pwd)` normalises the path. If `$SCRIPT_DIR` contains a single quote, the installation directory is already hostile. Marginal hardening opportunity.

## Detailed Verification of Claimed Fixes

### Fix #1: `scripts/hooks/lib/staleness.cjs` (new module, 99 lines)

Extracted from background-learning's inline shell `check_staleness` loop. Exports `checkStaleEntries(entries, cwd)` for test import, with a CLI mode (`require.main === module`) invoked from background-learning via `node "$staleness_module" "$LEARNING_LOG" "$CWD"`.

**Security analysis**:
- `staleRef` is only ever used as a JS template literal inside pure JS (`code-ref-missing:${staleRef}`). No shell or `node -e` interpolation occurs. The ab20b47 fix (process.argv[1] shell-escape) is obsolete in the new module — there is no shell interpolation boundary.
- CLI boundary receives `logFile` and `cwd` via argv; both go through `path.join` and `fs.readFileSync` without shell eval. Safe.
- Error path: parse failures `exit 0` (non-fatal), matching the comment "Staleness failures are non-fatal". Good defensive design.
- The existence-probe via user-controlled refs is an info-disclosure artifact that carried over unchanged from the shell version — see LOW finding above.

**Verdict**: The extraction is a security improvement. The removed shell `node -e "d.staleReason='code-ref-missing:' + process.argv[1]"` pattern, even with the ab20b47 process.argv[1] fix, still had the JS source string interpolated into shell-quoted strings. The .cjs module eliminates that entire class of boundary.

### Fix #2: `{ flag: 'wx' }` in 4 atomic-write sites

Files:
1. `src/cli/utils/migrations.ts:170-177` (`writeAppliedMigrations`)
2. `src/cli/utils/legacy-knowledge-purge.ts:50-61` (`writeFileAtomic`)
3. `src/cli/commands/learn.ts:395-409` (`writeFileAtomic`)
4. `scripts/hooks/json-helper.cjs:137-146` (`writeExclusive`, consumed by `writeJsonlAtomic` and `writeFileAtomic`)
5. `scripts/hooks/knowledge-usage-scan.cjs:113-123` (inline in main flow)

**Security analysis**:
- `wx` flag = `O_CREAT | O_EXCL | O_WRONLY | O_TRUNC`. `O_EXCL` causes `open(2)` to fail with `EEXIST` if the path already exists as a regular file, directory, or symlink. This defeats the TOCTOU symlink-follow attack: an attacker who plants a symlink at `.tmp` pointing to `/etc/passwd` cannot cause the write to follow it.
- EEXIST handling: unlink the stale path then retry with `wx`. If the attacker plants another symlink between unlink and the retry, the second `wx` open fails again and the function throws (fail-closed). No silent degradation.
- All 4 sites use the identical pattern; no drift between implementations.
- Test coverage: `tests/legacy-knowledge-purge.test.ts:218-244` validates the symlink-at-.tmp path is unlinked and not followed. Good regression protection.

**Verdict**: Correct implementation. The TOCTOU fix is real and tested.

### Fix #3: `process.argv[1]` in background-learning

Originally the ab20b47 commit hardened `d.staleReason='code-ref-missing:${stale_ref}'` by passing `stale_ref` via `process.argv[1]`. Commit 595d1a9 then replaced the entire shell-based staleness pass with `node lib/staleness.cjs`, making the process.argv[1] fix moot.

**Security analysis**:
- The new CLI invocation `node "$staleness_module" "$LEARNING_LOG" "$CWD"` uses proper argv boundaries (no shell interpolation into JS strings).
- Remaining shell-interpolation-to-JS patterns at lines 169-175 (extract_batch_messages), 185 (decoded_signals), 197-201 (DIALOG_PAIRS merge), and 221 (dialog pairs count) are mixed: line 185 and 197-201 correctly use `process.argv[N]`, but lines 169-175 still interpolate `$filter_module` and `$transcript` directly into the JS string.
- This is **pre-existing behavior** (see 0dd9e24 at same line numbers) — not introduced by this PR.

**Verdict**: Fix applied correctly where claimed. Remaining interpolation is pre-existing (see LOW findings).

### Fix #4: Path-traversal fix in `knowledge-usage-scan.cjs`

Commit ab20b47 changed:
```js
// Before
const cwd = path.resolve(rawCwd);
if (!path.isAbsolute(cwd)) process.exit(0);
// After
if (!path.isAbsolute(rawCwd)) {
  console.error('cwd must be absolute, got:', rawCwd);
  process.exit(2);
}
const cwd = path.resolve(rawCwd);
```

**Security analysis**:
- The commit message's rationale is accurate: `path.resolve()` always returns an absolute path, so `isAbsolute()` after resolve is a tautology. The original guard was a no-op.
- The fix rejects relative input first (correct), then resolves to normalise traversal sequences. A relative `rawCwd` like `../../etc/` would have been accepted before (since `path.resolve(..., '../../etc')` produces an absolute path starting from cwd).
- Exit code changed from 0 (silent) to 2 (error). Acceptable — distinguishes legitimate callers from misconfigured ones.
- Does NOT fully prevent `/etc/passwd`-style attacks — an absolute `/etc` still passes the guard. But legitimate callers (`stop-hook` passing hook JSON `cwd`) always provide a valid project root, and any inappropriate cwd results in `memoryDir` not existing (exit 0). No exploitable write to unintended paths.

**Verdict**: Fix does what it claims. Guard now functions as originally intended.

### Fix #5: `Atomics.wait` replacing busy-spin

Commit ab20b47 replaced:
```js
// Before
const end = Date.now() + 10;
while (Date.now() < end) { /* spin */ }
// After
syncSleep(10);  // Atomics.wait on freshly-allocated SharedArrayBuffer
```

**Security analysis**:
- Correctness: `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)` waits on a freshly-allocated buffer that no other thread holds a reference to. The buffer's initial value is 0, we pass `value=0`, so the wait engages. Since no `Atomics.notify` can ever fire on this buffer, the wait times out after `ms` milliseconds with return value `'timed-out'`. This yields the thread to the OS scheduler during the sleep, eliminating the CPU pegging.
- Node compatibility: `Atomics.wait` on the main thread is supported in Node.js (verified: `node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); console.log('OK')"` prints `OK`). No Node version issue.
- Resource budget: The 2-second timeout budget is unchanged, just not CPU-burning.
- Security-relevant property: Addresses project pitfall PF-009 (synchronous busy-wait locks in per-turn hook scripts) — this hook fires on every Stop event, so the fix eliminates a 100% CPU burst on every assistant turn.

**Verdict**: Correct and addresses a documented pitfall.

### Fix #6: `execFileSync` replacing `execSync`

Commit cf593b3 changed:
```ts
// Before
const result = JSON.parse(
  execSync(
    `node "${jsonHelperPath}" count-active "${filePath}" "${type}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim(),
);
// After
const raw = JSON.parse(
  execFileSync('node', [jsonHelperPath, 'count-active', filePath, type], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim(),
);
const activeCount = isCountActiveResult(raw) ? raw.count : 0;
```

**Security analysis**:
- `execFileSync('node', [...args])` passes the argv array directly to execvp(3) without shell interpretation. No quoting, no injection possible through arg values.
- Input sources: `jsonHelperPath = path.join(getDevFlowDirectory(), 'scripts', 'hooks', 'json-helper.cjs')`, `filePath ∈ { decisionsPath, pitfallsPath }` (constructed via `path.join(memoryDir, 'knowledge', ...)`), `type ∈ { 'decision', 'pitfall' }` (hardcoded). All values are either deterministic or derived from local paths, none are user-controlled from untrusted sources. Migration is defense-in-depth.
- Additionally added `isCountActiveResult` runtime guard before indexing `raw.count` — eliminates the prior silent `undefined ?? 0` fallback when json-helper returns unexpected shapes.

**Verdict**: Correct. Shell-interpolation eliminated; runtime shape check added.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 2 |

**Security Score**: 9/10
**Recommendation**: APPROVED

**Rationale**: All six claimed security fixes correctly implement the stated security properties. No new vulnerabilities introduced; no regressions in existing security posture. The remaining LOW findings are pre-existing shell-interpolation concerns that this PR does not make worse. The test coverage added in 595d1a9 (symlink TOCTOU test, staleness module import, runMigrations seam tests) provides regression protection for the hardening work.

**Points of excellence**:
- The `wx`+EEXIST-retry pattern is consistent across all 5 atomic-write sites (no drift).
- The `staleness.cjs` extraction removes an entire shell-interpolation boundary — more valuable than the incremental ab20b47 fix it supersedes.
- Runtime type guards (`isNotificationMap`, `isCountActiveResult`, `isRawObservation`) move toward the "parse, don't validate" principle from CLAUDE.md.
- The path-traversal fix in `knowledge-usage-scan.cjs` correctly identifies and fixes a no-op guard.
