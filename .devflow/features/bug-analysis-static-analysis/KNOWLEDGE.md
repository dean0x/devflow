---
feature: bug-analysis-static-analysis
name: /bug-analysis static analysis (scanner fences, status contract and guards)
description: "Use when editing Phase 2 or Phase 7 of bug-analysis.mds, a scanner fence, the exit-status rule, STATIC_FINDINGS/STATIC_STATUS, or tests/bug-analysis Group 3b. Keywords: semgrep, snyk, codeql, bound, exit=."
category: domain-knowledge
directories: [src/assets/commands/, tests/bug-analysis/]
created: 2026-10-23
updated: 2026-10-23
---

# /bug-analysis static analysis (scanner fences, status contract and guards)

## Rules

- **KB-AP-1** Never run a scanner unbounded: with neither `timeout` nor `gtimeout` found, no scanner runs and `STATIC_FINDINGS` says static analysis did not run.
- **KB-AP-2** Never set `STATIC_FINDINGS` to `(none)` because a scanner printed nothing: `(none)` means every tool that was to run completed and found nothing.
- **KB-AP-3** Never put a command between `codeql database analyze` and `CODEQL_EXIT=$?`: it replaces `$?` and a timed-out run reads as complete.
- **KB-AP-4** Never report Semgrep's exit as a named meaning: it passes through `xargs`, which remaps it, so it is reported as a number only.
- **KB-AP-5** Never make CodeQL wait on Semgrep or Snyk completing, or skip it: `--full` always runs CodeQL.
- **KB-AP-6** Never build a scanner file list from `CHANGED_FILES` or unterminated `git diff` output: names reach a scanner only through `-z`, `xargs -0` and after `--`.
- **KB-AP-7** Never wrap a local command in GNU `timeout` by name: stock macOS lacks it; Phase 2 probes `timeout` then `gtimeout`.
- **KB-AP-8** Never add text to the compiled command without cutting some first: it sits at its byte bound in both builds and the guard ceilings are never raised.
- **KB-AP-9** Never add a guard as one broad test: one named collector per concern, each with an `it.each` over both builds and known-bad probes through the same collector.
- **KB-INV-1** A missing `exit=` line means "did not complete": every scanner fence opens with `cd "{worktree}" || exit`, so a failed `cd` prints no status and fails closed.
- **KB-INV-2** Each scanner runs in its own foreground Bash call whose stated Bash timeout is above its bound plus the `-k` grace.
- **KB-INV-3** Completion rule: Semgrep 0, Snyk 0 or 1 (1 means issues, only with SARIF output), CodeQL 0. Any other status, or no status line, did not complete.
- **KB-INV-4** Step 2d produces `STATIC_FINDINGS` and `STATIC_STATUS`; Phase 7 requires `STATIC_STATUS` for the per-tool `**Static analysis**:` report line.
- **KB-INV-5** Snyk scans the project once into `S`; the scope filter and fallback `|| printf '%s' "$S"` come after that single scan, and a missing `jq` is noted as unfiltered.

## Overview

`/bug-analysis` Phase 2 runs up to three external scanners (Semgrep, Snyk Code, CodeQL) against the branch diff and feeds the result to the security analyzer as `STATIC_FINDINGS`; Phase 7 reports a per-tool outcome. The original bug was that a scanner that timed out, never started or had its output clipped produced an empty result, and the command read that as "no findings". The fix makes silence mean failure: each scanner's call prints a final `exit=<n>` line, and only a recognized completing status lets a tool count toward `(none)`.

All of it lives in `src/assets/commands/bug-analysis.mds` (Phase 2 steps 2c and 2d, Phase 7 report, edge-case table, checklist) and is pinned by Group 3b of `tests/bug-analysis/structural.test.ts`. The markdown is compiled twice (curation-on and curation-off); every guard runs against both builds.

## Phase 2 flow

- **Step 2c** prints one `tool=path|no` line per scanner, then probes `command -v timeout || command -v gtimeout` as the fence's last line. All three `no`: warn and set `STATIC_FINDINGS` to `(none)`. Some available: note which run; `{bound}` is the probed binary. No bound: run nothing, set `STATIC_FINDINGS` to "Static analysis did not run: neither timeout nor gtimeout is installed (install coreutils)." Step 2d skips on `--no-static`, no tools or no `{bound}` so it cannot overwrite that sentence with `(none)`.
- **Step 2d** runs Semgrep, Snyk, then CodeQL, each in its own Bash call. Bounds are `{bound} -k 10 <seconds> ...`; the stated Bash timeouts are 300000 ms (Semgrep, Snyk) and 600000 ms (CodeQL, whose two bounded commands share it). Bash timeouts never exceed 600000.
- CodeQL runs when `--full` OR Semgrep/Snyk found HIGH/CRITICAL findings. The gate line contains no "complet" or "skip" wording; a sentence skipping CodeQL anywhere in the command is a defect.
- After the fences: parse each SARIF, normalize to a top-50 table (descriptions cut to 200 chars), write all raw findings to `{ANALYSIS_DIR}/static-findings.md`. For each tool that did not complete, add under any table "Static analysis did not complete: {tool}: exit {n} ({meaning})." or "no exit status." Exit meanings: 124 bound fired, 125 bound failed, 126-127 scanner did not start, 137 killed after `-k`, else failed. Findings the SARIF still holds are kept. Clipped output means the tool is named, never `(none)`.

## Scanner fence shapes

Each fence prints its status in its own shape, and the order is load-bearing:

- **Semgrep**: one pipeline line, `set -o pipefail; git diff --name-only -z --diff-filter=d {DIFF_RANGE} | {bound} -k 10 280 xargs -0 -r semgrep scan ... -- 2>/dev/null; printf '\nexit=%s\n' "$?"`. The status is read on the same line as the pipeline; `pipefail` makes a failing `git diff` visible. Because the status passes through `xargs` (GNU 123/124/125, BSD 1) it is a number only.
- **Snyk**: `S=$({bound} -k 10 280 snyk code test --sarif 2>/dev/null); E=$?` then a `jq` scope filter then `printf ... "$E"`. The name list comes from `git diff --name-only -z {DIFF_RANGE} | jq -Rs 'split("\u0000")'`. The filter `.runs[].results |= map(select(...))` keeps results whose artifact URI is a changed file; `|| printf '%s' "$S"` prints the SARIF unfiltered if `jq` fails or is absent, instead of printing nothing (which would read as clean). Whether Snyk's URI form always matches repo-relative git paths is unconfirmed (umbrella issue 652).
- **CodeQL**: `CODEQL_TMP=$(mktemp -d) || exit`, a trap, `database create ... --source-root="{worktree}"` chained with `&&` to `database analyze`, then `CODEQL_EXIT=$?` on the very next line, then `cat` of the SARIF, the exit line printing `"$CODEQL_EXIT"`, then cleanup. Status first, `cat` and `rm -rf` after.

## Anti-Patterns

- **KB-AP-1, KB-AP-7**: bounds come from the probe, never a hard-coded `timeout N` (a guard rejects `timeout <digit>` anywhere in Phase 2). The probe is the last line of its fence so the "last line printed" reading is unambiguous.
- **KB-AP-2**: the "clean" reading used to be the default. Now every path that is not "all tools completed, none found anything" must name the tool and the reason. The Phase 7 edge-case row and the checklist item "`(none)` only if ..." state the same rule.
- **KB-AP-3**: `$?` holds only the last command's status. `cat` and cleanup both succeed, so reading `$?` after them turns a 124 into 0.
- **KB-AP-4**: do not translate a Semgrep number with the 124/125/137 table; the same number can come from `xargs` itself.
- **KB-AP-5**: skipping CodeQL after a Semgrep failure would silently drop the one scanner `--full` promises. The collector `collectFullCodeqlDefects` pins the gate line and the absence of skip sentences.
- **KB-AP-6**: file names with spaces, newlines or leading dashes would be split or parsed as options; `-z`, `xargs -0`, `--` and a NUL-split JSON list in `jq` keep them whole.
- **KB-AP-8**: both compiled builds are exactly at their byte bound. The ceilings live in `tests/guards/command-size.test.ts` and the `command-bug-analysis-max` and `command-bug-analysis-curation-off-max` entries of `tests/fixtures/numeric-floors.json`, and may be lowered, never raised. New text needs a same-size cut or a move to a reference first.

## Gotchas

- **KB-INV-1**: the leading `cd "{worktree}" || exit` is a status mechanism as well as a directory fix: if it fails the call exits before printing `exit=`, and the missing line already means "did not complete". CodeQL instead passes `--source-root="{worktree}"`, or may open with the same `cd`.
- **KB-INV-2**: the Bash tool kills a call at its own timeout; a bound that reaches it would lose the status line. The collector computes `(grace + bound)` per `-k k n` pair in ms and requires it below the stated timeout (CodeQL: sum of both pairs).
- **KB-INV-3**: Snyk exits 1 when it finds issues, so 1 counts as completed only when SARIF was requested; any other nonzero (2, 3, 124 ...) did not complete.
- **KB-INV-4**: the saved `static-findings.md` and the Debug agents' input do not carry the status lines (open follow-up 662). Full SARIF printed into a clipped Bash output can hide the `exit=` line and cause a false "did not complete" (open follow-up 661). Umbrella: 652.
- **KB-INV-5**: the Snyk scope filter exists because `snyk code test` scans the whole project; without it, findings in untouched files reach the analyzer.

## Guard architecture (tests/bug-analysis/structural.test.ts, Group 3b)

Constants (`SCANNER_TOOLS`, `BOUND`, `EXIT_PRINT`, `STATED_TIMEOUT`, `BASH_TIMEOUT_CEILING_MS`) feed one collector per concern, each taking one compiled body and returning defect strings: `collectStaticBoundDefects`, `collectDidNotRunDefects` (with `collectProbeFenceDefects` and `collectDidNotRunBranchDefects`), `collectStatusLineDefects`, `collectExitLineOrderDefects`, `collectStaticReportDefects`, `collectOutcomeDeclarationDefects`, `collectFullCodeqlDefects`, `collectCodeqlScratchDefects`, `collectStatusRuleDefects`, `collectScannerRootDefects`, `collectFileNameHandoffDefects`, `collectSnykScopeDefects`.

- Every guard is an `it.each` over `[curation-on, curation-off]`; a null build fails with "run `npm run build:mds`".
- Known-bad probes go through the same collector that owns the message. The describe-level `seed` asserts the target occurs exactly once (string or RegExp) and that the text changed, so no probe is inert; `probe(collect, body)` never touches the committed tree.
- Guards pin counts of scanner lines, exit lines and fences so a guard cannot pass on nothing; an empty-input call (`collect...('')`) is asserted to report defects.
- The shipped Snyk `jq` name-reader and scope filter are extracted from the fence and executed on a fixture SARIF with awkward names (spaces, accents, CJK). The test skips with a printed reason when `jq` is not installed. It throws if the fence changes shape, so reshaping the fence means updating `shippedSnykPrograms`.
- The outcome-declaration guard stays on the `**Produces:**`/`**Requires:**` lines and the `**Static analysis**:` report line, not on prose, so rewording prose does not break it.

## Key Files

- `src/assets/commands/bug-analysis.mds` - Phase 2 (steps 2c, 2d) and Phase 7; source of both builds
- `tests/bug-analysis/structural.test.ts` - Group 3b collectors and probes
- `tests/guards/command-size.test.ts`, `tests/fixtures/numeric-floors.json` - byte ceilings for both builds
- `docs/commands.md`, `CHANGELOG.md` - user-facing description of the status behavior

## Related

- `.devflow/features/feature-knowledge-system-mds-build/KNOWLEDGE.md` - how `.mds` sources compile into the curation-on and curation-off builds
- `src/assets/commands/debug.mds` - the Debug agents that consume `STATIC_FINDINGS`
