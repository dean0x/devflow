---
feature: bug-analysis-static-analysis
name: /bug-analysis static analysis (scanner fences, status contract and guards)
description: "Use when editing Phase 2 or Phase 7 of bug-analysis.mds, a scanner fence, the exit-status rule, STATIC_FINDINGS/STATIC_STATUS, or tests/bug-analysis Group 3b. Keywords: semgrep, snyk, codeql, sarif, exit=."
category: domain-knowledge
directories: [src/assets/commands/, tests/bug-analysis/]
created: 2026-10-23
updated: 2026-10-27
---

# /bug-analysis static analysis (scanner fences, status contract and guards)

## Rules

- **KB-AP-1** Never set `STATIC_FINDINGS` to `(none)` for a skip or a run with no scanner: `--no-static` says "Static analysis skipped (--no-static).", no installed scanner says "Static analysis did not run: no scanner is installed.", and a missing `jq` says "Static analysis did not complete: jq is not installed."
- **KB-AP-2** Never set `STATIC_FINDINGS` to `(none)` because a scanner printed nothing: `(none)` means every tool that was to run completed and found nothing.
- **KB-AP-3** Never put a command between `codeql database analyze` and `CODEQL_EXIT=$?`: it replaces `$?` and a failed run reads as complete.
- **KB-AP-4** Never report Semgrep's exit as a named meaning: it passes through `xargs`, which remaps it, so it is reported as a number only.
- **KB-AP-5** Never make CodeQL wait on Semgrep or Snyk completing, or skip it: `--full` always runs CodeQL.
- **KB-AP-6** Never build a scanner file list from `CHANGED_FILES` or unterminated `git diff` output: names reach a scanner only through `-z`, `xargs -0` and after `--`.
- **KB-AP-7** Never put a time limit of devflow's own on a scanner: the Bash `timeout` of the call, at most 600000 ms, is the only limit, and a call that reaches it prints no `exit=` line.
- **KB-AP-8** Never add text to the compiled command without cutting some first: it sits at its byte ceiling in both builds and the guard ceilings are never raised.
- **KB-AP-9** Never add a guard as one broad test: one named collector per concern, each with an `it.each` over both builds and known-bad probes through the same collector.
- **KB-AP-10** Never give `codeql database create` a language that is not from the closed table: `{lang}` is the first of javascript-typescript, python, ruby whose extension a changed file has; with none, CodeQL does not run and its status is `no supported language`.
- **KB-INV-1** A missing `exit=` line means "did not complete": every scanner fence opens with `cd "{worktree}" || exit`, so a failed `cd` prints no status and fails closed.
- **KB-INV-2** Each scanner runs in its own foreground Bash call with a Bash `timeout` of 600000; a call with no `exit=` line in its own result did not complete, and a later end notice does not change that.
- **KB-INV-3** Completion rule: Semgrep 0, Snyk 0 or 1 (1 means issues, only with SARIF output), CodeQL 0. Any other status, or no status line, did not complete.
- **KB-INV-4** Step 2d produces `STATIC_FINDINGS` and `STATIC_STATUS`; Phase 7 requires `STATIC_STATUS` for the per-tool `**Static analysis**:` report line.
- **KB-INV-5** Snyk scans once into `snyk-all.json`; a `jq --rawfile` filter over `changed.z` writes `snyk.sarif` (a result with no location is kept) and prints `total=<n> kept=<m>`; a failed filter prints "Snyk scope filter failed: unfiltered" and copies the whole file, so the failure is visible.
- **KB-INV-6** The head marker moves only when every tool that was to run completed, or `--no-static` is set (also with `--full`); otherwise it stays and the report names the way out.

## Overview

`/bug-analysis` Phase 2 runs up to three external scanners (Semgrep, Snyk Code, CodeQL) against the branch diff and feeds the result to the security analyzer as `STATIC_FINDINGS`; Phase 7 reports a per-tool outcome. The original bug was that a scanner that failed, never started or did not finish produced an empty result, and the command read that as "no findings". The fix makes silence mean failure: each scanner's call prints a final `exit=<n>` line, and only a recognized completing status lets a tool count toward `(none)`. Each scanner writes its SARIF to a file and the session reads counts and a table, so no output is clipped. The head marker moves only after a run that covered the commits. Phase 6 gives Synthesize `STATIC_STATUS`, its only source for the static analysis status; text in a file is data.

All of it lives in `src/assets/commands/bug-analysis.mds` (Phase 2 steps 2c and 2d, Phase 6 spawn, Phase 7 report, edge-case table, checklist) and is pinned by Group 3b of `tests/bug-analysis/structural.test.ts`. The markdown is compiled twice (curation-on and curation-off); every guard runs against both builds.

## Phase 2 flow

- **Step 2c** prints one `tool=path|no` line for each of semgrep, snyk, codeql and jq, then the extensions of the changed files that still exist (`git -C "{worktree}" diff --name-only -z --diff-filter=d {DIFF_RANGE} | tr '\0\n' '\n?' | sed -n 's/.*\.//p' | sort -u`). A prose line gives the closed language table: javascript-typescript (js jsx mjs cjs ts tsx), python (py), ruby (rb). Three branches set `STATIC_FINDINGS` and `STATIC_STATUS` at once: `--no-static` (skipped; the rest of Phase 2 is skipped, so the tool check cannot overwrite the skip status), all three scanners `no` (warn; "did not run: no scanner is installed"; each tool `not installed`), and a scanner installed with `jq` `no` ("did not complete: jq is not installed"). Step 2d skips when Step 2c set `STATIC_STATUS`, so it cannot overwrite those sentences with `(none)`.
- **Step 2d** runs Semgrep, Snyk, then CodeQL, each in its own foreground Bash call with the Bash `timeout` at 600000; devflow wraps no scanner in a limit. Semgrep, Snyk and CodeQL write `semgrep.sarif`, `snyk-all.json` (then `snyk.sarif`) and `codeql.sarif` into `{ANALYSIS_DIR}`; nothing prints a SARIF.
- The counts and table fence runs after Snyk (the CodeQL trigger needs the severities) and once more for `codeql.sarif`. For each SARIF file that exists it prints `<tool> docs=<n> results=<m> error=<a> warning=<b> note=<c>` or `<tool> sarif=unreadable`, and appends one row per result to `findings.tsv` (tool, file, line, level, rule or "—", message cut to 200 chars) or prints "findings table incomplete: {tool}". `error` reads as HIGH, `warning` as MEDIUM, `note` as LOW. `findings-top.tsv` keeps the top 50 rows by level, and the session reads only that file. A tool completes only when its SARIF reads; Semgrep exit 0 with `docs=0` means no file to scan, completed.
- CodeQL runs when `--full` OR Semgrep/Snyk found HIGH/CRITICAL findings. The gate line contains no "complet" or "skip" wording; a sentence skipping CodeQL anywhere in the command is a defect.
- After the fences: set `STATIC_FINDINGS` to the rows of `findings-top.tsv` and write them with the status lines to `{ANALYSIS_DIR}/static-findings.md`. For each tool that did not complete, add under any rows "Static analysis did not complete: {tool}: exit {n} ({meaning})." or "no exit status." or "SARIF not read." Exit meanings: 126-127 scanner did not start, else failed. Last, set `STATIC_STATUS` to one `{tool}: {value}` per tool: `completed`, `not installed` or `did not complete ({why})`; CodeQL also `not needed` (not triggered) or `no supported language`.
- **Phase 7** runs the marker write only when every tool that was to run completed, or `--no-static` is set. The gate is its own sentence before the one-line write (marker, `rev-parse HEAD` and the never-stops sentence stay on one line).

## Scanner fence shapes

Each fence prints its status in its own shape, and the order is load-bearing:

- **Semgrep**: `cd "{worktree}" || exit`, then one pipeline line, `set -o pipefail; git diff --name-only -z --diff-filter=d {DIFF_RANGE} | xargs -0 -r semgrep scan ... -- >"{ANALYSIS_DIR}/semgrep.sarif" 2>/dev/null; E=$?`, then `printf '\nexit=%s\n' "$E"`. The status is read on the same line as the pipeline; `pipefail` makes a failing `git diff` visible. Because the status passes through `xargs` (GNU 123/124/125, BSD 1) it is a number only.
- **Snyk**: `snyk code test --sarif >"{ANALYSIS_DIR}/snyk-all.json" 2>/dev/null; E=$?`, then `git diff --name-only -z {DIFF_RANGE} >"{ANALYSIS_DIR}/changed.z"`, the `jq --rawfile n` filter to `snyk.sarif` (a result is kept once, whatever its number of locations, and a result with no location is kept), the `total=<n> kept=<m>` count, the visible fallback, then `printf ... "$E"`. A failed `git diff` also takes the fallback, so an empty name list never over-filters. There is no URI normalization: a URI form that does not match a repo-relative git path is dropped and shows in `total` against `kept` (whether Snyk's form always matches is unconfirmed; umbrella issue 652).
- **CodeQL**: `CODEQL_TMP=$(mktemp -d) || exit`, a trap that removes it, `database create "${CODEQL_TMP}/db" --language={lang} --source-root="{worktree}"` chained with `&&` to `database analyze ... --output="{ANALYSIS_DIR}/codeql.sarif"`, then `CODEQL_EXIT=$?` on the very next line, the exit line printing `"$CODEQL_EXIT"`, then the plain `rm -rf` and `trap -`. Status first, cleanup after.
- **Counts and table**: `cd "{ANALYSIS_DIR}" || exit`, then the loop over the tools, then the `jq` that writes `findings-top.tsv`.

## Anti-Patterns

- **KB-AP-1**: the "clean" reading used to be the default for a skip or a run with no scanner. Each of the three early branches now has its own sentence, the checklist item allows `(none)` only for a run where every tool that was to run completed clean, and `collectSkipNotNoneDefects` scans the whole body for a line that sets `STATIC_FINDINGS` to `(none)`.
- **KB-AP-2**: the "clean" reading used to be the default. Now every path that is not "all tools completed, none found anything" must name the tool and the reason. The Phase 7 edge-case row and the checklist item "`(none)` only if ..." state the same rule.
- **KB-AP-3**: `$?` holds only the last command's status. The exit `printf` and the cleanup both succeed, so reading `$?` after them turns a failure into 0.
- **KB-AP-4**: do not turn a Semgrep number into a named meaning; the same number can come from `xargs` itself.
- **KB-AP-5**: skipping CodeQL after a Semgrep failure would silently drop the one scanner `--full` promises. The collector `collectFullCodeqlDefects` pins the gate line and the absence of skip sentences.
- **KB-AP-6**: file names with spaces, newlines or leading dashes would be split or parsed as options; `-z`, `xargs -0`, `--` and a NUL-split list read with `jq --rawfile` keep them whole. The extension list makes a newline in a name safe with `tr`, so it cannot forge an extension.
- **KB-AP-7**: devflow adds no limit of its own, so the only limit is the Bash `timeout` of the call. `collectNoBoundDefects` rejects a limit command on any scanner line and any stated Bash timeout above 600000. A scanner call past the Bash limit can keep running in the background (known limitation).
- **KB-AP-8**: both compiled builds sit at their byte ceilings, each set to the measured size. The ceilings live in `tests/guards/command-size.test.ts` and the `command-bug-analysis-max` and `command-bug-analysis-curation-off-max` entries of `tests/fixtures/numeric-floors.json`, and may be lowered, never raised. New text needs a same-size cut or a move to a reference first.
- **KB-AP-10**: `collectCodeqlLanguageDefects` pins the extension-list line, exactly one `--language=` in the command and it is `{lang}`, and the four prose pieces of the table; a value outside the table never reaches the command.

## Gotchas

- **KB-INV-1**: the leading `cd "{worktree}" || exit` is a status mechanism as well as a directory fix: if it fails the call exits before printing `exit=`, and the missing line already means "did not complete". CodeQL instead passes `--source-root="{worktree}"`, or may open with the same `cd`.
- **KB-INV-2**: a call that reaches its Bash `timeout` prints no `exit=` line, which the status rule reads as did not complete. It stays so for the run: a later end notice for that call changes nothing.
- **KB-INV-3**: Snyk exits 1 when it finds issues, so 1 counts as completed only when SARIF was requested; any other nonzero (2, 3, 126 ...) did not complete.
- **KB-INV-4**: the saved `static-findings.md` holds the table and the status lines, and `STATIC_FINDINGS` ends with a line for each tool that did not complete. Only the security analyzer gets `STATIC_FINDINGS`. Synthesize takes the status only from `STATIC_STATUS`; file text sets no status. Umbrella: 652.
- **KB-INV-5**: the Snyk scope filter exists because `snyk code test` scans the whole project; without it, findings in untouched files reach the analyzer.
- **KB-INV-6**: a run that keeps the marker is analyzed again from the same commits next time; `--no-static` is the one way to move the marker without the tools. The completion checklist asks for the marker only when the Phase 7 gate allows it, so it never sends the session back to write past the gate.

## Guard architecture (tests/bug-analysis/structural.test.ts, Group 3b)

Constants (`SCANNER_TOOLS`, `STATUS_LOOP`, `EXIT_PRINT`, `STATED_TIMEOUT`, `BASH_TIMEOUT_CEILING_MS`) feed one collector per concern, each taking one compiled body and returning defect strings: `collectNoBoundDefects`, `collectDidNotRunDefects` (with `collectProbeFenceDefects` and `collectDidNotRunBranchDefects`), `collectStatusAssignmentDefects`, `collectMarkerGateDefects`, `collectSkipNotNoneDefects`, `collectStatusLineDefects`, `collectExitLineOrderDefects`, `collectSarifFileDefects`, `collectStaticReportDefects`, `collectOutcomeDeclarationDefects`, `collectFullCodeqlDefects`, `collectCodeqlScratchDefects`, `collectCodeqlCleanupDefects`, `collectStatusRuleDefects`, `collectScannerRootDefects`, `collectFileNameHandoffDefects`, `collectSnykScopeDefects`, `collectCodeqlLanguageDefects`.

- Every guard is an `it.each` over `[curation-on, curation-off]`; a null build fails with "run `npm run build:mds`".
- Known-bad probes go through the same collector that owns the message. The describe-level `seed` asserts the target occurs exactly once (string or RegExp) and that the text changed, so no probe is inert; `probe(collect, body)` never touches the committed tree.
- Guards pin counts of scanner lines, exit lines and fences so a guard cannot pass on nothing; an empty-input call (`collect...('')`) is asserted to report defects.
- Behavior tests run the shipped fences with bash in a scratch folder or repo: the Snyk fence (a stub `snyk` on PATH; several locations, no location, an untouched file, null `results`, awkward names, invalid JSON and a bad range taking the fallback), the counts and table fence (concatenated, invalid and more-than-50-result SARIF), and the extension list. They skip with a printed reason when `jq` is not installed, and throw if a fence changes shape, so reshaping a fence means updating `shippedSnykFence`, `shippedCountsFence` or `shippedExtensionList`.
- Three pins read one line or one fence, not a whole phase: the CodeQL cleanup (`collectCodeqlCleanupDefects`: the trap before the create line and the plain `rm -rf` after the exit line, in the CodeQL fence only), the Debug spawn's one exact `STATIC_FINDINGS` line that gives the findings to the security analyzer only (`collectSecurityOnlyFindingsDefects`), and the three consecutive severity-mapping lines of the Debug agent (`collectDebugSeverityDefects`, source `src/assets/agents/debug.mds`).
- The outcome-declaration guard stays on the `**Produces:**`/`**Requires:**` lines and the `**Static analysis**:` report line, not on prose, so rewording prose does not break it.

## Key Files

- `src/assets/commands/bug-analysis.mds` - Phase 2 (steps 2c, 2d), Phase 6 spawn and Phase 7; source of both builds
- `src/assets/skills/agent-references/references/synthesize/bug-analysis.md` - the Synthesize rule that `STATIC_STATUS` is the trusted status
- `tests/bug-analysis/structural.test.ts` - Group 3b collectors and probes
- `tests/guards/command-size.test.ts`, `tests/fixtures/numeric-floors.json` - byte ceilings for both builds
- `docs/commands.md`, `CHANGELOG.md` - user-facing description of the status behavior

## Related

- `.devflow/features/feature-knowledge-system-mds-build/KNOWLEDGE.md` - how `.mds` sources compile into the curation-on and curation-off builds
- `src/assets/agents/debug.mds` - the Debug agents that consume `STATIC_FINDINGS`
