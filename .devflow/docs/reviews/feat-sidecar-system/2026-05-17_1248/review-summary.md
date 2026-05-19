# Review Summary — feat/sidecar-system (Incremental)

## Merge Recommendation
**BLOCK**

Reason: Two critical correctness issues (dropped artifact reinforcement, spurious marker writes) and four HIGH-severity bugs (retry budget leak, marker accumulation, config write race, sentinel regression) block merge. Fix these before proceeding.

---

## Critical Bugs Found

### CRITICAL

1. **Artifact reinforcement logic completely removed** — `scripts/hooks/sidecar-evaluate`
   - **Severity**: CRITICAL
   - **Confidence**: 95%
   - **What's broken**: The old `session-end-learning` hook's `reinforce_loaded_artifacts()` function (which updated `last_seen` timestamps on loaded artifacts) is completely absent from the new `sidecar-evaluate` hook. This is a documented behavior in CLAUDE.md that other subsystems (capacity review, deprecation lifecycle) depend on.
   - **Impact**: Without reinforcement, all loaded artifacts will appear equally "last seen" at creation date forever. The capacity review system and confidence penalties lose the signal they need to distinguish active from stale artifacts. This breaks the decay/deprecation lifecycle and violates the contract documented in CLAUDE.md.
   - **Fix**: Add a reinforcement section to `sidecar-evaluate` (before the learning evaluation block) that scans the transcript for `self-learning[:/][a-z0-9-]+` patterns and updates `last_seen` on matching observations in `learning-log.jsonl`.

2. **Empty array `"[]"` from transcript-filter causes spurious marker writes** — `scripts/hooks/lib/transcript-filter.cjs:201-204` + `scripts/hooks/sidecar-evaluate:156,237`
   - **Severity**: CRITICAL
   - **Confidence**: 90%
   - **What's broken**: The new CLI entry point in `transcript-filter.cjs` outputs `JSON.stringify(userSignals)` which produces the literal string `"[]"` for empty arrays. In `sidecar-evaluate`, the check `[ -n "$USER_SIGNALS" ]` treats `"[]"` as non-empty (it is a non-empty string) and writes a marker file. This triggers background agent spawns with empty payloads.
   - **Impact**: Wasteful background agent invocations on every session end when there are no signals to process. Triggers learning/decisions agents to run on `[]` data, burning tokens for no result.
   - **Fix**: In `transcript-filter.cjs` CLI handler, exit with empty stdout when results are empty: `if (userSignals.length === 0) process.exit(0);` so that `[ -n "" ]` fails and marker is skipped.

---

### HIGH

3. **Stale `.retries` file persists across independent marker cycles** — `scripts/hooks/sidecar-dispatch:86-97`
   - **Severity**: HIGH
   - **Confidence**: 85%
   - **What's broken**: When a `.processing` file is stale and retried, a `.retries` counter is created. After the marker eventually succeeds, the `.retries` file is never cleaned up. On the next failure cycle for the same task, the retry counter starts at the stale value, reducing the retry budget from 3 to (3 - previous_failures).
   - **Impact**: After one failed cycle that consumed 1-2 retries then succeeded, the next failure cycle only gets 1-2 retries. Over time, all task types trend toward zero retry tolerance, degrading the system's self-healing capability.
   - **Fix**: Clean up `.retries` file in `sidecar-evaluate` after writing a new marker, or reset it in `sidecar-dispatch` when a marker completes successfully (no `.processing` and no `.json` exists).

4. **sidecar-evaluate writes markers that sidecar-dispatch may never pick up** — `scripts/hooks/sidecar-evaluate:179,260`
   - **Severity**: HIGH
   - **Confidence**: 85%
   - **What's broken**: Markers written on SessionEnd are only consumed by `sidecar-dispatch` (UserPromptSubmit) on the *next* session's first prompt. If the user doesn't start a new session in the same project, markers persist indefinitely with no garbage collection or expiry logic.
   - **Impact**: Markers accumulate over multiple sessions without follow-up usage. Every subsequent `sidecar-dispatch` will try to process stale/outdated data (e.g., learning signals from weeks ago).
   - **Fix**: Add a timestamp field to each marker file and have `sidecar-dispatch` skip (or delete) markers older than 24 hours. The memory marker already has a `timestamp` field—extend to learning.json and decisions.json.

5. **init.ts writes full config atomically vs memory.ts uses read-modify-write** — `src/cli/commands/init.ts:1139-1144`, `src/cli/commands/memory.ts:335,344`
   - **Severity**: HIGH
   - **Confidence**: 88%
   - **What's broken**: `init.ts` calls `writeSidecarConfig()` (full atomic write) but `memory.ts` calls `updateFeature()` (read-modify-write). If these race on the same file, the init's full-write could clobber the memory disable, or vice versa, violating the single-writer assumption.
   - **Impact**: Not immediate data loss (user can re-run), but violates the documented single-writer contract and could silently enable/disable features differently than the user expected.
   - **Fix**: Document that `devflow init` should not run concurrently with feature toggle commands, or use `updateFeature` consistently in init by calling it four times sequentially, or introduce atomic write-then-rename in `writeConfig`.

6. **`session-start-memory` removed `.working-memory-disabled` sentinel check without migration** — `scripts/hooks/session-start-memory:21-26`
   - **Severity**: HIGH
   - **Confidence**: 88%
   - **What's broken**: The legacy sentinel check `[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0` was removed and replaced with sidecar config check. If a user previously disabled memory (creating this sentinel), they may have this file but no `config.json`. When config.json is absent, the hook defaults to `memory: true`, silently re-enabling memory without user consent.
   - **Impact**: Users upgrading from the old system who disabled memory will have memory automatically re-enabled. Behavioral regression.
   - **Fix**: This aligns with ADR-001 (clean break) but requires release notes. Alternatively, keep the sentinel check as a fallback: `if [ -f "$CWD/.memory/.working-memory-disabled" ]; then exit 0; fi` before the sidecar config read.

7. **sidecar-evaluate log assertions are conditional—tests pass trivially** — `tests/shell-hooks.test.ts:1862,1884,1913,1965,1995,2057,2079,2097`
   - **Severity**: HIGH
   - **Confidence**: 92%
   - **What's broken**: Eight tests wrap key assertions in `if (fs.existsSync(logFile))` guards. If the hook fails to create the log file, all assertions inside are skipped and the test passes green, hiding real regressions.
   - **Impact**: Tests that never fail. Regressions in logging or marker writing could go undetected.
   - **Fix**: Replace conditional guards with unconditional assertions. Assert log file existence first, then test contents.

8. **`devflow_log_dir` spawns 4 subprocesses on every stop hook invocation** — `scripts/hooks/sidecar-capture:56` (via `log-paths:8-10`)
   - **Severity**: HIGH
   - **Confidence**: 92%
   - **What's broken**: `devflow_log_dir` runs `sed` + `tr` + `mkdir -p` + `chmod 700` every invocation despite `mkdir -p` and `chmod` being idempotent after the first call. This is called on every assistant response.
   - **Impact**: 8-12ms latency per response from unnecessary subprocess forks.
   - **Fix**: Cache the computed log dir in a variable after first call. After first invocation, return cached value.

---

## Issue Counts
| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM | 18 |
| **Total** | **26** |

---

## Cross-Reviewer Consensus

### Issues flagged by multiple reviewers (highest confidence):

**Stale `.retries` persistence** (Reliability + Architecture):
- Reliability (HIGH, 85%) flagged retry budget leak
- Architecture (MEDIUM, 82%) flagged orphan `.retries` accumulation
- Combined confidence: 95%+ — this is a core issue

**`.working-memory-disabled` sentinel inconsistency** (Regression + Architecture):
- Regression (HIGH, 88%) flagged removal without migration path
- Architecture (MEDIUM, 83%) flagged session-start-memory inconsistency
- Combined confidence: 95%+ — needs unified fix across both hooks

**Marker accumulation without expiry** (Architecture flagged directly):
- Architecture (HIGH, 85%) — markers never garbage collected
- Performance (MEDIUM, 82%) — config re-read cost (related but separate)

**sidecar-dispatch not checking feature enablement at dispatch time** (Architecture):
- Architecture (MEDIUM, 82%) — injects directives for disabled features
- Related: Architecture flags decisions usage scan gated on wrong flag (80%)

**Empty USER_SIGNALS/DIALOG_PAIRS edge case**:
- Consistency (HIGH, 90%) flagged `"[]"` spurious writes directly
- Testing (MEDIUM, 80%) flagged missing test for boundary condition
- Combined confidence: 95%+

**Conditional test assertions**:
- Testing (HIGH, 92%) directly flagged 8 tests with trivial-pass conditionals
- No overlapping flagging but highest individual confidence score

---

## Detailed Category Breakdown

### Blocking Issues (Your Changes)

| Issue | Category | Severity | Confidence |
|-------|----------|----------|------------|
| Artifact reinforcement removed | Regression | CRITICAL | 95% |
| Empty `"[]"` string spurious writes | Consistency | CRITICAL | 90% |
| Stale `.retries` accumulation | Reliability | HIGH | 85% |
| Marker expiry never happens | Architecture | HIGH | 85% |
| init/memory config write race | Architecture | HIGH | 88% |
| Sentinel migration missing | Regression | HIGH | 88% |
| Conditional log test assertions | Testing | HIGH | 92% |
| devflow_log_dir subprocess overhead | Performance | HIGH | 92% |

### Should-Fix Issues (Code You Touched)

| Issue | Category | Severity | Confidence |
|-------|----------|----------|------------|
| Session ID dedup substring match | Security | MEDIUM | 82% |
| Retry count unvalidated arithmetic | Security | MEDIUM | 80% |
| `--enable` misleading message | Reliability | MEDIUM | 82% |
| Knowledge throttle never updated | Reliability | MEDIUM | 83% |
| Dispatch ignores disabled features | Architecture | MEDIUM | 82% |
| Capture gates decisions on memory | Architecture | MEDIUM | 80% |
| Decisions sentinel check removed | Regression | MEDIUM | 82% |
| `pre-compact-memory` config check missing | Regression | MEDIUM | 84% |
| JSDoc lists 4 hooks, config has 5 | TypeScript | MEDIUM | 95% |
| `any` type in test helper | TypeScript | MEDIUM | 82% |
| Stale-retry loop expensive unconditionally | Performance | MEDIUM | 85% |
| Queue file read twice | Performance | MEDIUM | 82% |
| 11 additional tests lacking coverage | Testing | MEDIUM | 80-85% |

### Pre-existing Issues (Not Blocking)

| Issue | Category | Severity | Confidence |
|-------|----------|----------|------------|
| Orphan queue auto-clean drops first turn | Reliability | MEDIUM | 80% |
| CLAUDE.md reinforcement docs inaccurate | Regression | MEDIUM | 90% |
| Config write could truncate on kill | TypeScript | MEDIUM | 65% |
| `devflow_log_dir` cache opportunity | Performance | MEDIUM | 85% |

---

## Reviewer Scores

| Reviewer | Score | Recommendation |
|----------|-------|-----------------|
| Security | 8/10 | APPROVED_WITH_CONDITIONS |
| Reliability | 7/10 | CHANGES_REQUESTED |
| Architecture | 6/10 | CHANGES_REQUESTED |
| Regression | 4/10 | CHANGES_REQUESTED |
| Consistency | 8/10 | CHANGES_REQUESTED |
| Testing | 6/10 | CHANGES_REQUESTED |
| TypeScript | 9/10 | APPROVED_WITH_CONDITIONS |
| Performance | 7/10 | APPROVED_WITH_CONDITIONS |

---

## Summary by Domain

### Architecture (6/10)
- **Critical gaps**: Marker lifecycle has no expiry, dispatch doesn't verify feature enablement at consumption time, memory config flag gates more than it should, race condition between init and subcommands
- **Key fix**: Add marker timestamp + expiry check in dispatch; gate features independently at dispatch time; standardize config write pattern

### Reliability (7/10)
- **Critical gaps**: Retry budget leaks over time, confusing UX messages despite correct behavior, throttle markers never updated, incomplete feature gating
- **Key fix**: Clean `.retries` on success; fix status check to read config first; update throttle timestamp after write; separate feature toggles

### Regression (4/10)
- **Critical gaps**: Artifact reinforcement completely dropped (documented behavior), sentinel migration path missing, inconsistent hook behavior across old/new systems
- **Key fix**: Add reinforcement scan back; keep sentinel fallbacks or document clean break clearly; sync pre-compact and session-start memory checks

### Testing (6/10)
- **Critical gaps**: 8 conditional log assertions that can pass trivially, missing coverage for decisions cap, transcript-filter error cases, memory disable, scanner skip path, empty signal edge case
- **Key fix**: Remove all conditional guards from assertions; add missing test cases for all new hooks

### Performance (7/10)
- **Critical gaps**: Unnecessary subprocess forks on every response (`mkdir`, `chmod`, `date`, `wc`), double reads of queue file, expensive stale-retry ops on every prompt even when no stale files exist
- **Key fix**: Cache log dir after first call; combine queue checks into single pass; guard expensive ops behind glob matches

### TypeScript (9/10)
- **Critical gaps**: `any` type in test helper, stale JSDoc comment lists wrong hook count
- **Key fix**: Use `unknown` with type guard; update JSDoc to list 5 hooks

### Consistency (8/10)
- **Critical gap**: New CLI outputs `"[]"` for empty arrays, old shell checks treat `"[]"` as non-empty, triggering spurious marker writes
- **Key fix**: Exit with empty stdout when no signals found

### Security (8/10)
- **Status**: SESSION_ID path traversal fix correctly implemented. Two MEDIUM findings (grep substring matching, unvalidated integer) are low-risk correctness issues, not exploitable vulnerabilities.

---

## Artifacts

- `security.md` — Security review (8/10)
- `reliability.md` — Reliability review (7/10)
- `architecture.md` — Architecture review (6/10)
- `regression.md` — Regression review (4/10)
- `consistency.md` — Consistency review (8/10)
- `testing.md` — Testing review (6/10)
- `typescript.md` — TypeScript review (9/10)
- `performance.md` — Performance review (7/10)

---

## Action Items (Priority Order)

**Block Merge — Fix Before Proceeding:**
1. Add artifact reinforcement scan to `sidecar-evaluate` (CRITICAL)
2. Fix empty `"[]"` handling in `transcript-filter.cjs` CLI (CRITICAL)
3. Add marker expiry check to `sidecar-dispatch` (HIGH)
4. Clean up `.retries` files on success (HIGH)
5. Fix config write race condition in `init.ts` (HIGH)
6. Handle `.working-memory-disabled` sentinel migration (HIGH)
7. Fix conditional log assertions in tests (HIGH)
8. Cache log dir to reduce subprocess overhead (HIGH)

**Should Fix — Add Before Merge:**
1. Validate retry count as integer before arithmetic
2. Check feature enablement at dispatch time (not just write time)
3. Update knowledge throttle marker after write
4. Fix `--enable` logic to check config state first
5. Add sentinel fallback to `pre-compact-memory` for consistency
6. Update JSDoc in `memory.ts` to list 5 hooks
7. Replace `any` type with `unknown` + type guard in tests
8. Add missing test cases (decisions cap, transcript-filter error, memory disable drain, scanner skip, empty signals)
9. Cache stale-now computation and optimize queue checks

---

## Overall Assessment

The sidecar system architecture is sound — three-hook decomposition (dispatch/capture/evaluate) cleanly separates concerns. However, **the implementation is incomplete** in critical areas:

1. **Dropped documented behaviors** (artifact reinforcement) that other subsystems depend on
2. **Incomplete lifecycle management** (markers accumulate, retries leak, no expiry)
3. **Incomplete migration path** for users upgrading from old system
4. **Test coverage gaps** that allow silent failures
5. **Performance regression** from unnecessary subprocess overhead

These are all fixable with focused work on the documented issues. The core logic is correct; the issues are in edge cases, lifecycle management, and test coverage.

**Recommendation**: Do not merge. Address all CRITICAL and HIGH findings, add missing test coverage, and verify against a full session lifecycle before re-review.
