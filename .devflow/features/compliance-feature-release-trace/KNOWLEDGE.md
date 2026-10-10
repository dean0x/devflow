---
feature: compliance-feature-release-trace
name: Release Evidence & Trace Map
description: "Use when changing release evidence: gather-release-evidence, release-trace.cjs, create-release notes caps, /release evidence phases. Keywords: TRACE_MAP, LAST_TAG, messageBody, TRACEABILITY_EXCEPTIONS."
category: domain-knowledge
directories:
  - src/assets/scripts/release-trace.cjs
  - src/assets/commands/release.mds
created: 2026-10-10
updated: 2026-10-10
---

# Release Evidence & Trace Map

## Rules

- **KB-AP-1** Never scan `%s` plus `%b` for references: read the whole raw message (`%B`, D-TRACE-FULL-MESSAGE), so `release-trace.cjs` and the gather step trace the same commits; `MESSAGE_LOG_FLAGS` keeps `%s` only for the exempt rules.
- **KB-AP-2** Never test the revert-body patterns against the whole message: only `messageBody(message)` feeds the revert rule, or a body-less commit whose subject quotes `This reverts commit <sha>` passes as exempt (D-TRACE-REVERT-BODY).
- **KB-AP-3** Never find the last release tag with `git describe`, which can return a non-release marker tag: use `release-trace.cjs last-tag` (the gather last-tag step, and `/release`'s `semver-auto` strategy).
- **KB-AP-4** Never accept a trace map unless the command printed `exit=0` and its first line has the pinned `TRACE ...` header shape; anything else is `TRACEABILITY: DEGRADED (trace map unavailable)` with status `INDETERMINATE`.
- **KB-AP-5** Never cut release notes mid-line or drop `TRACEABILITY_EXCEPTIONS`: drop `## Commits` first, then cut only `CHANGELOG_CONTENT` at a line boundary ending `...truncated`; the exceptions stay last.
- **KB-AP-6** Never skip the cap re-check after the scrub in `create-release`'s notes step: redaction can push a body that was exactly at the cap back over it.
- **KB-AP-7** Never let a commit message, author e-mail or path reach `release-trace.cjs` stdout or stderr (closed vocabulary, fixed reasons only), and never write a commit subject into `TRACEABILITY_EXCEPTIONS`.
- **KB-AP-8** Never resolve closing references with one call per commit: one merged-PR listing, mapped locally, with a bounded per-PR fallback.
- **KB-AP-9** Never treat a bare number as a reference under github: a keyword-anchored candidate must carry the `#`.
- **KB-AP-10** Never narrow the closing keyword set or widen the trace set on one side only: `CLOSING_KEYWORD_RE` is byte-for-byte the literal the gather references state and `TRACE_KEYWORD_RE` is that set plus `refs`; a parity test pins both, and narrowing the closing set must not turn `Refs #N` commits into traceability gaps.
- **KB-AP-11** Never let `--from` or `--key` reach git or a pattern unchecked: `--from` must pass its gate (a release tag or commit SHA, never starting with `-`) and `--key` its anchored shape, or the script exits with its input-unusable code.
- **KB-INV-1** `release-trace.cjs` makes git calls only (argv arrays, no shell, timeouts, buffer caps), runs offline, leaves stdout empty on every non-zero exit, and callers treat every non-zero exit as "no trace".
- **KB-INV-2** The `map` header counts must sum (traced + untraced + exempt = scanned); the output gate refuses a composed output that breaks it.
- **KB-INV-3** `create-release`'s primary effects (tag, push, release create) are hard failures; only the evidence enrichment degrades per D4, and a scrub failure in the notes step fails loudly rather than publish unredacted notes.
- **KB-INV-4** Release evidence and back-links key on `EVIDENCE_POLICY`, never on the compliance lens; `/release` carries no compliance gate.
- **KB-INV-5** Notes body order is `CHANGELOG_CONTENT`, an optional `## Commits` section, then `TRACEABILITY_EXCEPTIONS` verbatim last.
- **KB-INV-6** `classify()` is first-match-wins in `CLASSES` order and its terminal arm is `untraced`: an input no rule recognises must surface in the release confirm, never pass silently.
- **KB-INV-7** A release tag is the fixed `^v?X.Y.Z$` shape, so a prerelease or a marker tag is never the "last release".

## Overview

Release traceability turns "what shipped since the last release" into a closed-vocabulary trace map and a commit and issue list. Three pieces cooperate: the `/release` command (`src/assets/commands/release.mds`) decides whether evidence is gathered and what to do with gaps; the Git agent's `gather-release-evidence` and `create-release` operations (contract in `git.mds`, tracker mechanics generated per provider); and `src/assets/scripts/release-trace.cjs`, the git-only classifier both shell out to. Semantics of the surrounding ops (D4, D11, bounds) live in `.devflow/features/compliance-feature-traceability/KNOWLEDGE.md`; the compliance lens and evidence floor live in `.devflow/features/compliance-feature/KNOWLEDGE.md`.

## Release Evidence Flow

`gather-release-evidence` (input `WORKTREE_PATH`; output `COMMIT_LIST`, `SHIPPED_ISSUES`, `### TRACE_MAP`, `### Status: READY | PARTIAL | TRUNCATED | DEGRADED | INDETERMINATE`) runs steps shared by every provider's generated reference (`src/assets/mds/tracker/_common.mds`) around provider-specific resolution:

- **Last release tag** (`last_release_tag_step`, step 1a): from `WORKTREE_PATH` (else cwd) run `release-trace.cjs last-tag`. `LAST_TAG <tag>` is the tag; `LAST_TAG none` falls back to the initial-commit rule; anything else keeps step 1's tag and reports `INDETERMINATE (last release tag unresolved)`. A release tag has the fixed `^v?X.Y.Z$` shape (D-TRACE-LAST-TAG), so a prerelease or a marker tag never matches.
- **Closing references (GitHub, `_github.mds`):** a history grammar of `^#[1-9][0-9]{0,8}$`. With `gh` authenticated and the remote reachable, resolve which issues the range's merged PRs close from **one listing, never one call per commit**: the repo identity once, `TAG_DATE` (UTC, shape-gated) once, then `gh pr list --state merged --search "merged:>=$TAG_DATE" --limit 200 --json number,mergeCommit,closingIssuesReferences`. Map locally: keep a PR whose `mergeCommit.oid` is in `git rev-list {last_tag}..HEAD` or whose number a range subject names `(#N)`; keep only references whose repository equals this repo's identity (any other is `TRACEABILITY: DEGRADED (foreign issue reference {ref})`). A range subject carrying a PR marker that no listed PR covers is DEGRADED (listing did not cover the range); a listing that hits its cap is `INDETERMINATE`. If the listing fails (an older `gh` reports `Unknown JSON field`) or `TAG_DATE` fails its gate, fall back to `gh pr view N --json closingIssuesReferences` over the PR numbers in subjects, bounded, reporting the remainder as `THROTTLED ({n} not processed)` and never reporting the enrichment complete while PRs went unresolved. 4xx degrades that item, 5xx retries once, the secondary rate limit stops the enrichment.
- **Trace map** (`trace_map_step`, step 6): run `release-trace.cjs map --from {last_tag} {grammar-args}; echo "exit=$?"` and accept only `exit=0` after a first line `TRACE from:<ref> scanned:<n> traced:<n> untraced:<n> exempt:<n> unmatched:<n> bound:<ok|hit>`. Every line above `exit=0` is copied verbatim under `### TRACE_MAP`. Anything else is `DEGRADED (trace map unavailable)`, `### TRACE_MAP` is `(unavailable)`, status `INDETERMINATE`. `bound:hit` is `INDETERMINATE` (trace scan bound hit). An `INDETERMINATE` status outranks every other.
- **Bounds:** at most 100 commits and 50 issues in the evidence output, with `SCAN_BOUND` traced commits (all pinned in the git-agent tests and the script's `LIMITS`).

## release-trace.cjs

Usage: `release-trace.cjs last-tag` (prints exactly `LAST_TAG <tag>` or `LAST_TAG none`) and `release-trace.cjs map --from <ref> --grammar github|jira|linear [--key <KEY>] [--traced-file <file>]` (first-parent commits of `<from>..HEAD`; HEAD and `--from` are resolved to full SHAs once so a commit landing mid-run cannot shift the lists). Both run git in the process's working directory.

- **Classification** (`classify()`, first match wins, terminal arm `untraced`): `traced` (the SHA is in the `--traced-file` set, or `findReference` finds an issue reference), `exempt:release` (a release-commit subject, or a changelog-only change), `exempt:revert` (a `Revert "..."` subject AND a body naming what was reverted), `exempt:bot` (a `[bot]` author name with a GitHub noreply bot e-mail), else `untraced`, so an unrecognised input surfaces in the confirm instead of passing silently.
- **Keywords** (D-TRACE-KEYWORDS): the closing set (`CLOSING_KEYWORD_RE`, byte-for-byte the literal the gather references state) and the trace set (`TRACE_KEYWORD_RE`, the closing set plus `refs`) are deliberately unequal: `Refs #N` mentions an issue, so the commit is `traced`, but it never reaches `SHIPPED_ISSUES`. Both apply case-insensitively without the `u` flag, so a non-ASCII letter never folds onto an ASCII keyword letter; a parity test pins both.
- **Output** is closed-vocabulary: after the header, per listed class in the order untraced, `exempt:release`, `exempt:revert`, `exempt:bot`, newest first and capped at `LIST_CAP` lines each, `- <sha12> <class> author:<name>` (the name only if it passes `AUTHOR_RE`, else `(unprintable)`), and `- ...and <n> more` after a capped class. Traced commits are counted, never listed. The boundary re-checks every stdout line against these shapes.
- **Exit codes** (a caller treats every non-zero as "no trace"): 0 ok, 1 usage, 2 input unusable (`--from` not a release tag or commit SHA, bad `--key`, bad `--traced-file`), 3 write failed, 4 git failure (also any internal error), 5 output gate refused.
- **D-TRACE-FULL-MESSAGE.** `findReference` reads `%B`, never `%s` plus `%b`. Git folds a wrapped subject paragraph onto one `%s` line, so a keyword ending the subject's first line and a reference opening its second would read as one line under `%s`+`%b` and as two under a `%B` scan. A commit whose reference only a `%B` scan can see must be traced the same way by this script and by the mechanics step that gathers `COMMIT_LIST`, so both read `%B`. `MESSAGE_LOG_FLAGS` carries `--format=%H%x00%an%x00%ae%x00%s%x00%B%x1e` (`%s` kept alongside `%B` only for the exempt rules, which match the subject as git renders it); `tests/evidence/release-trace-parity.test.ts` pins both sides.
- **D-TRACE-REVERT-BODY.** The revert rule requires the subject AND a body line (`This reverts commit {40-hex-sha}`, or GitHub's `Reverts {owner}/{repo}#{n}`). `messageBody(message)` splits the message the way git splits a revert's generated body (skip leading blank lines, end the subject paragraph at the first blank line, return everything after it, `''` if none) and only the revert rule reads it; `findReference` still scans the full message. A commit whose subject merely quotes the sentence is `untraced`, not `exempt:revert`, by design.

## create-release

Step 1a validates the version format (semver X.Y.Z, fail loudly). Step 1b reads the `## Version Names` and `## Version PR Titles` sections of `.devflow/conventions.md` when present, for the annotated tag format and release title (defaults when absent: tag and title `v{VERSION}`); it stays inline in `git.md`, since only the `## Shipped Issues` enrichment bullet moved to the generated reference. Re-learn conventions by deleting the file.

Step 5 composes the notes body: `CHANGELOG_CONTENT` first, then an optional `## Commits` section (first 100 entries, with a final `...and {n} more commits` line when truncated), then `TRACEABILITY_EXCEPTIONS` verbatim last. The 60000-character cap degrades in two stages, in order: drop `## Commits` and note `Commit list omitted (release notes size limit)`; if still over, cut only `CHANGELOG_CONTENT` **at a line boundary**, ending `...truncated`. A mid-line cut could split a markdown fence or table row and corrupt the rendered release. Step 6 writes the notes to `$DEVFLOW_NOTES_RAW`, applies the D11 scrub to the notes pair (a non-zero exit fails the release loudly: notes with unredacted secrets must not be published), then re-applies step 5's cap, written at step 6 itself beside the scrub call rather than left implicit, before `gh release create {tag} --notes-file "$DEVFLOW_NOTES"`.

## The /release Phases

- **Phase 1c** resolves the evidence policy once; it decides everything below.
- **Phase 4** determines the version (`semver-auto` uses `last-tag`) and gathers evidence when `EVIDENCE_POLICY` is `required`, or under either policy on a dry run, keeping `COMMIT_LIST`, `SHIPPED_ISSUES`, `### TRACE_MAP` and `### Status:` as `RELEASE_EVIDENCE`. A dry run halts after this phase and writes no checkpoint.
- **Phase 5** (only under `required`) classifies the evidence: coverage unknown (no gather, unparseable output, no `TRACE` line, counts not summing, `bound:hit`, `INDETERMINATE`), untraced commits, partial (warn and continue; a tracker with no closing-reference capability always lands here) or clean. Coverage-unknown or untraced asks once, via AskUserQuestion, to **Record** self-attested exceptions (a reason in the user's words, made inert) or **Halt** before anything is committed, tagged or published. `TRACEABILITY_EXCEPTIONS` is the `## Traceability exceptions` block (`untraced` and `coverage` lines with `@login` and a UTC time, and an `Exempt (not attested)` count line); when the trace lists an exempt commit but nothing needs asking, the block is the heading and the `Exempt` line alone, because an exemption is self-asserted and printed, never hidden.
- **Phase 6** step 4 spawns `create-release`, passing `COMMIT_LIST`, `SHIPPED_ISSUES` and `TRACEABILITY_EXCEPTIONS` only under `required`; step 4b spawns `backlink-shipped-issues` and step 4c `associate-release` (non-empty `SHIPPED_ISSUES`), both degrading per D4 and never blocking the release. **Resume:** a checkpoint missing the evidence its Phase 4 gate called for is gathered again, with Phase 5's traceability step re-run, only before step 4; after step 4, report `evidence lost on resume` and continue, never block.

## Anti-Patterns

**KB-AP-1, KB-AP-2: reading the wrong slice of the message.** The two rules read different text on purpose: the reference scan reads everything (so the script and the mechanics agree), the revert exemption reads only the body (so a quoted sentence in a subject cannot forge an exemption). Do not unify them in either direction.

**KB-AP-5, KB-AP-6: truncation.** Dropping `## Commits` first and cutting only the changelog at a line boundary keeps the rendered release valid and the attested exceptions intact.

## Gotchas

**KB-AP-2: untraced is correct for a forged revert.** A subject-only `This reverts commit <sha>` is `untraced`; this is the design, not a gap.

**KB-AP-4: INDETERMINATE outranks everything.** A hit scan bound, an unresolved last tag, or an unavailable map each force `INDETERMINATE`, which the `/release` confirm treats as coverage unknown.

**KB-AP-6: exactly at the cap before the scrub is not safe.** A body sized at the cap pre-scrub can be trimmed again post-redaction.

## Key Files

- `src/assets/scripts/release-trace.cjs` - the pure git-history classifier: `classify`, `messageBody` (D-TRACE-REVERT-BODY), `findReference` (D-TRACE-FULL-MESSAGE), `MESSAGE_LOG_FLAGS`, `LIMITS`
- `src/assets/mds/tracker/_common.mds` - `last_release_tag_step`, `trace_map_step`, shared by every provider's generated gather reference
- `src/assets/mds/tracker/_github.mds` - GitHub's gather mechanics (listing, local mapping, fallback)
- `src/assets/agents/git.mds` - `gather-release-evidence`, `create-release`, `backlink-shipped-issues`, `associate-release` contracts
- `src/assets/commands/release.mds` - Phases 1c, 4, 5, 6 and the traceability exceptions block
- `tests/evidence/release-trace-parity.test.ts` - pins the script and the mechanics step in agreement on `%B`
- `tests/git-agent.test.ts` - the per-op caps and bounds

## Related

- `.devflow/features/compliance-feature-traceability/KNOWLEDGE.md` - D4, D11, comment caps and bounds, the conventions authority
- `.devflow/features/compliance-feature/KNOWLEDGE.md` - the compliance feature and the evidence-policy floor
- `.devflow/features/tracker-references/KNOWLEDGE.md` - how the gather reference is generated per provider
- `src/assets/scripts/release-trace.cjs`, `src/assets/commands/release.mds` - the code this KB describes
