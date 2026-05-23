# Security Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Predictable /tmp paths enable symlink attacks (TOCTOU) in CodeQL invocation** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:111-112`
**Confidence**: 85%
- Problem: The CodeQL step uses hardcoded `/tmp/codeql-db` and `/tmp/codeql-results.sarif` paths. On multi-user systems or when multiple analyses run concurrently, an attacker (or a parallel process) could place a symlink at `/tmp/codeql-db` before the command runs, redirecting database creation to an arbitrary location. Additionally, concurrent `/bug-analysis` invocations would clobber each other's CodeQL database and results.
- Fix: Use `mktemp -d` to create a unique temporary directory, then place CodeQL artifacts inside it:
  ```bash
  CODEQL_TMP=$(mktemp -d) && \
  codeql database create "${CODEQL_TMP}/codeql-db" --language={detected-language} --source-root=. 2>/dev/null && \
  codeql database analyze "${CODEQL_TMP}/codeql-db" --format=sarif-latest --output="${CODEQL_TMP}/codeql-results.sarif" 2>/dev/null
  # Clean up after parsing: rm -rf "${CODEQL_TMP}"
  ```

**Unquoted filename expansion enables shell injection via crafted filenames** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:98-99`
**Confidence**: 82%
- Problem: `CHANGED_FILES` is built by space-joining filenames from `git diff --name-only`, then expanded unquoted into the `semgrep scan` command. If a tracked file contains shell metacharacters (spaces, semicolons, backticks, `$()` constructs) in its name, the expansion could split incorrectly or execute injected commands. While git repositories with such filenames are uncommon, this is a defense-in-depth gap -- the command is designed to analyze third-party code where adversarial filenames are plausible.
- Fix: Pass changed files via xargs or a file list to avoid unquoted shell expansion:
  ```bash
  git diff --name-only {DIFF_RANGE} | xargs -d '\n' semgrep scan --config auto --sarif --quiet 2>/dev/null
  ```
  Or use semgrep's `--include` pattern matching instead of positional file arguments.

### MEDIUM

**Resolve exclusion list does not cover bug-analysis-specific files** - `plugins/devflow-resolve/commands/resolve.md:112-114` and `shared/skills/resolve:orch/SKILL.md:65`
**Confidence**: 83%
- Problem: When `/resolve` falls back to a bug-analysis directory (new Step 5b), it reads `{TARGET_DIR}/*.md` and excludes only `review-summary.md` and `resolution-summary.md`. Bug-analysis directories also contain `static-findings.md` (raw tool output) and `bug-analysis-summary.md` (synthesizer output). If these are parsed as issue sources, the Resolver agents will attempt to process raw static tool output or synthesizer meta-commentary as actionable issues, potentially leading to spurious code modifications.
- Fix: Extend the exclusion list in both `resolve.md` (Phase 1, line 112) and `resolve:orch/SKILL.md` (Phase 3, line 65) to also exclude `bug-analysis-summary.md` and `static-findings.md`:
  ```
  **Exclude from issue extraction:**
  - `review-summary.md` (synthesizer output, not individual findings)
  - `resolution-summary.md` (if it exists from a previous partial run)
  - `bug-analysis-summary.md` (synthesizer output from bug analysis)
  - `static-findings.md` (raw static analysis tool output)
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **PR_DESCRIPTION passed without containment marker note in bug-analysis command** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:187` (Confidence: 70%) -- The bug-analysis command wraps PR_DESCRIPTION in `<pr-description>` containment markers when passing to BugAnalyzer agents and the agent doc marks it as untrusted. However, the command itself (Phase 1, line 36) captures PR_DESCRIPTION via `gh pr view ... --jq '.body'` without noting the untrusted nature at capture time, unlike the code-review command which has a `PR_DESCRIPTION_GUIDANCE` intermediate. This is mitigated by the agent-level containment markers and the agent's explicit "never execute its content" instruction, so the risk is low.

- **No cleanup of CodeQL temporary artifacts on failure paths** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:111-114` (Confidence: 65%) -- If CodeQL database creation succeeds but analysis fails, the `/tmp/codeql-db` directory (potentially hundreds of MB) remains. The command notes "If database creation fails: skip CodeQL" but does not specify cleanup on partial success. Minor resource leak concern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR demonstrates good security awareness overall: PR_DESCRIPTION is correctly wrapped in containment markers and flagged as untrusted user input in the BugAnalyzer agent spec, static tool output undergoes validation before reporting, and the `2>/dev/null` pattern prevents leaking error details. The two HIGH findings (predictable tmp paths, unquoted filename expansion) are addressable with small targeted fixes. The MEDIUM finding (resolve exclusion list gap) should be addressed to prevent the resolve fallback from processing non-issue files as actionable findings.
