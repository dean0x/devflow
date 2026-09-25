---
description: Release project using adaptive learned configuration
---

# Release Command

Release the project using adaptive learned configuration. On first run, scans the codebase to detect the release process and stores it in `.release/RELEASE-FLOW.md`. Subsequent releases use the stored config, skipping discovery.

## Usage

```
/release v1.2.3          (explicit version)
/release patch           (bump type: patch | minor | major)
/release --dry-run       (simulate release, show plan without executing)
/release                 (interactive: ask for version)
```

## Input

`$ARGUMENTS` contains whatever follows `/release`:
- Explicit version: `v1.2.3` or `1.2.3`
- Bump type: `patch`, `minor`, `major`
- Flag: `--dry-run`
- Empty: interactive mode (will ask for version)

Parse from $ARGUMENTS:
- `VERSION`: explicit version string if present (strip leading `v`)
- `BUMP_TYPE`: `patch | minor | major` if bump type provided
- `DRY_RUN`: true if `--dry-run` present, false otherwise

## Phases

### Phase 1: Load Config

**Produces:** RELEASE_CONFIG, CONFIG_STATE (`learned` | `fresh`)

**Load Companion Skills** — Load via Skill tool: `devflow:git`. If a skill fails to load, continue without it.

**Continuation detection**: Check `.release/.progress.json`. If exists, an interrupted release is in progress. Offer user:
- **Resume**: continue from last checkpoint (skip phases already completed)
- **Restart**: clean start (delete `.release/.progress.json` and begin from Phase 1)

Read `.release/RELEASE-FLOW.md`:
- If exists → parse as structured config, set CONFIG_STATE = learned, skip to Phase 4
- If missing → set CONFIG_STATE = fresh, continue to Phase 2

### Phase 1b: Load Context

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Read `.devflow/learning/index.md`. If the file is absent or empty, set `DECISIONS_CONTEXT` to `(none)`; otherwise use the file content as `DECISIONS_CONTEXT`.

Load feature knowledge: Attempt to read `.devflow/features/index.md` (the regenerable cache). If absent or empty, glob `.devflow/features/*/KNOWLEDGE.md` and read each file's YAML frontmatter (`name`, `description`, `directories`) as the relevance surface. Pick release-relevant KBs by matching their documented area against the release context. For each selected KB, read the full `KNOWLEDGE.md` — trust current code over KB content on any mismatch. Concatenate under slug headers and set `FEATURE_KNOWLEDGE` (or `(none)` if no KBs exist or none are relevant). No `index.json`, no subprocess, no `.cjs` script.

Pass both to all subsequent agents via their input contracts.

### Phase 1c: Resolve the Evidence Policy

**Produces:** EVIDENCE_POLICY, ISSUE_REQUIRED, APPLY_CONVENTIONS, REQUIRE_NON_AUTHOR_APPROVAL

**Resolve the evidence policy once per run**, from the repository root, before any step reads the values:

```bash
node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/resolve-evidence-policy.cjs" 2>/dev/null; echo "exit=$?"
```

Accept the output only when it is exactly two lines: `exit=0` last and, before it, one line of the form `EVIDENCE_POLICY=<required|standard> SOURCE=<file|worktree|default|invalid|error> REF=<branch|none>[ WARN=<remote-unavailable|invalid-file|raised-by-compliance|pr-changes-policy>[,…]] ISSUE_REQUIRED=<true|false> APPLY_CONVENTIONS=<true|false> REQUIRE_NON_AUTHOR_APPROVAL=<true|false>` — these fields, in this order, nothing else, where `<branch>` is a branch name such as `main`. **Anything else** (a non-zero exit, no line, extra text, or a missing, reordered or unlisted field or value) ⇒ use `EVIDENCE_POLICY=required SOURCE=error REF=none ISSUE_REQUIRED=true APPLY_CONVENTIONS=true REQUIRE_NON_AUTHOR_APPROVAL=true` instead.

Set `EVIDENCE_POLICY`, `ISSUE_REQUIRED`, `APPLY_CONVENTIONS` and `REQUIRE_NON_AUTHOR_APPROVAL` from the accepted line. Pass agents only the three mechanism inputs, never `EVIDENCE_POLICY`. Report `Evidence policy: {EVIDENCE_POLICY} (source: {SOURCE})`, plus any `WARN` tokens as advisory, once in the final report.

Reuse this result for all subsequent phases: it decides whether a real release gathers and traces its evidence (Phases 4–5), passes it to the release notes (step 4), and back-links shipped issues and associates them with the release (steps 4b–4c).

### Phase 2: Detect Release Process (First Run Only)

**Produces:** RELEASE_SIGNALS
**Requires:** CONFIG_STATE = fresh

Tiered codebase scan to detect the project's release process:

**Tier 1** — Read these if they exist: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Dockerfile`, `.github/workflows/*.yml`, `CHANGELOG.md`

**Tier 2** — Broaden: monorepo indicators (`lerna.json`, `pnpm-workspace.yaml`, `turbo.json`), release tool configs (`.releaserc`, `.changeset/`, `release-please-config.json`)

**Tier 3** — Git history: `git tag -l` for tag format, `git log --oneline -20` for conventions

Skip credential files (`.env*`, `*credentials*`, `*secret*`, `*.key`). Max 20 files total.

### Phase 3: Build Config (First Run Only)

**Produces:** RELEASE_CONFIG (written to disk)
**Requires:** RELEASE_SIGNALS

Map RELEASE_SIGNALS to `.release/RELEASE-FLOW.md` with sections: Packages, Pre-release Checks, Changelog, Build & Test, Publish, Post-release.

**Conventions naming:** Consult `.devflow/conventions.md` (the naming authority written by the Git `learn-conventions` operation) for version/tag/version-PR title conventions. When the branching model uses version PRs, follow the Version PR Titles convention recorded there; compliance defaults when the file is absent. When the repo uses a main+integration branching model, ship via a version PR per the recorded convention. Re-learn by deleting `.devflow/conventions.md` — the next Git `learn-conventions` call rewrites it.

Use AskUserQuestion for any gaps that cannot be inferred.

Lazy-init `.release/` directory. Create `.release/.gitignore` with `.progress.json` and `.lock/`.

### Phase 4: Pre-release Checks

**Produces:** PRE_RELEASE_RESULT, VERSION, RELEASE_EVIDENCE
**Requires:** RELEASE_CONFIG, EVIDENCE_POLICY

**Version determination** (in order):
1. Explicit version from args → use directly
2. Bump type from args → compute from current version
3. `semver-auto` strategy → analyze commits since the last release tag: the tag that `node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/release-trace.cjs" last-tag`, run from the repository root, prints as `LAST_TAG <tag>` (`LAST_TAG none` ⇒ the initial commit) — never `git describe`, which can return a local marker tag
4. None → use AskUserQuestion

Pre-release checks:
- Clean working directory (`git status --porcelain`)
- Tag does not already exist
- Custom checks from RELEASE_CONFIG

Spawn `Agent(subagent_type="Validate")` for build + test.

**Gather release evidence** — under either policy when `DRY_RUN` is true, otherwise only when `EVIDENCE_POLICY` is `required`: spawn `Agent(subagent_type="Git")` with `gather-release-evidence` operation; pass `WORKTREE_PATH` if provided. Keep `COMMIT_LIST`, `SHIPPED_ISSUES`, `### TRACE_MAP` and `### Status:` as RELEASE_EVIDENCE. The Git agent applies its own bounds (≤100 commits, ≤50 issues, 500 traced commits) and degrades gracefully per D4.

Write `.release/.progress.json` checkpoint, with RELEASE_EVIDENCE when it was gathered.

`--dry-run`: report what would happen and, when evidence was gathered, the Phase 5 traceability arms, the untraced list and the exempt counts — never asking — then **halt after this phase**.

### Phase 5: Build Release Plan

**Produces:** RELEASE_PLAN, TRACEABILITY_EXCEPTIONS
**Requires:** PRE_RELEASE_RESULT, RELEASE_CONFIG, VERSION, RELEASE_EVIDENCE

**Traceability** (only when `EVIDENCE_POLICY` is `required`), before the confirm below. Classify RELEASE_EVIDENCE by its `### Status:` value — `READY`, `PARTIAL`, `TRUNCATED`, `DEGRADED` or `INDETERMINATE` — and by the first `### TRACE_MAP` line, `TRACE from:<ref> scanned:<n> traced:<n> untraced:<n> exempt:<n> unmatched:<n> bound:<ok|hit>`. Let *u* be its `untraced` count, and re-check traced + untraced + exempt = scanned yourself. Every arm that matches applies:

1. **Coverage unknown** — no gather ran, its output is missing or unparseable, there is no `TRACE` line, the sum does not hold, `bound:hit`, or status `INDETERMINATE`.
2. **Untraced** — *u* > 0.
3. **Partial** — status `PARTIAL`, `TRUNCATED` or `DEGRADED`: warn and continue; this arm never blocks on its own. A tracker with no closing-reference capability always lands here.
4. **Clean** — status `READY` and *u* = 0, and no arm above.

Arm 1 or 2 ⇒ ask once, via AskUserQuestion: "{u} untraced commits{, coverage unknown: {cause}}. Record self-attested traceability exceptions, or halt?", with exactly two options:
- **Record** — ask for the reason in the user's own words; if it renders empty, ask once more, then halt. Compose `TRACEABILITY_EXCEPTIONS` below and add it to `.release/.progress.json`.
- **Halt** — stop now: nothing has been committed, tagged or published.

`TRACEABILITY_EXCEPTIONS` is this block, and no commit subject is ever written into it:

```markdown
## Traceability exceptions
- `untraced` <sha12> (<author>) self-attested by @<login> at <utc>: <reason>
- `coverage` <bound-hit|trace-unavailable|gather-indeterminate|untraced-beyond-list> self-attested by @<login> at <utc>: <reason>
Exempt (not attested): release <n> · revert <n> · bot <n> — <sha12>, …
```

- One `untraced` line per listed untraced commit (≤100), its `<sha12>` and `<author>` copied from that `### TRACE_MAP` line. One `coverage` line per arm-1 cause — `bound-hit` for `bound:hit`, `gather-indeterminate` for status `INDETERMINATE`, `trace-unavailable` for any other — plus `untraced-beyond-list` when an `…and <n> more` line closes the untraced list. The `Exempt` line counts each exempt kind (its listed lines plus its `…and <n> more`) and names every listed exempt SHA.
- `@<login>` is `@` followed by the output of `gh api user --jq .login` when that output matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`. On any other output, or a failed call, it is `(login unavailable)` instead, with no `@`.
- `<utc>` is the output of `date -u +%Y-%m-%dT%H:%M:%SZ`.
- `<reason>` is the user's own words, made inert: replace every character outside printable ASCII (newlines and tabs included) with a space, remove every `<`, `>`, `` ` ``, `[`, `]`, `\`, `/`, `#`, `@`, `&` and `$`, collapse runs of spaces, trim, keep the first 200 characters, and trim again. A reason that is empty after this is no reason.

Build ordered execution plan from RELEASE_CONFIG. For monorepo: respect dependency ordering, present package selection to user.

Confirm with user via AskUserQuestion before executing:
"Ready to release v{VERSION}. Plan: {steps summary}. Proceed?"

`--dry-run`: should already be halted from Phase 4.

### Phase 6: Execute Release

**Produces:** RELEASE_RESULT
**Requires:** RELEASE_PLAN, VERSION, EVIDENCE_POLICY, RELEASE_EVIDENCE, TRACEABILITY_EXCEPTIONS

Sequential execution with progress checkpoints:
1. **Version bumps** — write new version to configured files
2. **Changelog update** — move Unreleased section to versioned entry (if configured)
3. **Release commit** — `chore(release): v{VERSION}` (conventional commit)
4. **Tag and GitHub Release** — spawn `Agent(subagent_type="Git")` with `create-release` operation (the agent reads `.devflow/conventions.md` for tag format and release title conventions; compliance defaults when absent); only when `EVIDENCE_POLICY` is `required`, also pass `COMMIT_LIST` and `SHIPPED_ISSUES` from RELEASE_EVIDENCE, and `TRACEABILITY_EXCEPTIONS` when recorded, as inputs so the agent includes them in the release notes body.
4b. **Back-link shipped issues** (only when `EVIDENCE_POLICY` is `required`) — spawn `Agent(subagent_type="Git")` with `backlink-shipped-issues` operation, passing `VERSION` and `SHIPPED_ISSUES`; posts a marker-deduped comment on each issue (bounds and throttle enforced by the operation); degrade gracefully (D4) on any API failure — never block the release
4c. **Associate shipped issues with the release** (only when `EVIDENCE_POLICY` is `required` and `SHIPPED_ISSUES` is non-empty) — spawn `Agent(subagent_type="Git")` with `associate-release` operation, passing `VERSION` and `SHIPPED_ISSUES`; it adds each issue to the release's tracker marker and never replaces another; degrade gracefully (D4) — never block the release
5. **Publish** — CI-driven (report) or manual (provide instructions)
6. **Post-release steps** — version bump to next dev

**Resume:** a checkpoint missing the RELEASE_EVIDENCE its Phase 4 gate called for is gathered again, with Phase 5's traceability step re-run, only before step 4; after step 4, report `evidence lost on resume` and continue — never block.

Delete `.release/.progress.json` on success.

### Phase 7: Suggest Improvements

**Requires:** RELEASE_RESULT

Post-release analysis for improvement opportunities. Present as suggested diffs to RELEASE-FLOW.md. Never auto-apply. Fire-and-forget.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context, pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Output

On completion:
- Git tag created: `v{VERSION}` (or configured tag format)
- GitHub Release created with release notes (with `## Traceability exceptions` last, when recorded)
- Changelog updated (if configured)
- Version files bumped
- `.release/RELEASE-FLOW.md` created (first run only)

## Architecture

```
/release (orchestrator)
│
├─ Phase 1: Load Config
│  └─ Read .release/RELEASE-FLOW.md (learned) or proceed to detect (fresh)
│
├─ Phase 1b: Load Context
│  └─ Load DECISIONS_CONTEXT and FEATURE_KNOWLEDGE for downstream agents
│
├─ Phase 2: Detect Release Process (first run only)
│  └─ Tiered scan: package.json, CI workflows, git history
│
├─ Phase 3: Build Config (first run only)
│  └─ Write .release/RELEASE-FLOW.md
│
├─ Phase 4: Pre-release Checks
│  ├─ Validate agent (build + test)
│  ├─ Git agent: gather release evidence + trace map (dry run, or evidence policy required)
│  └─ Write progress checkpoint
│
├─ Phase 5: Build Release Plan
│  ├─ Traceability: classify the trace map; record exceptions or halt (evidence policy required)
│  └─ Confirm with user before executing
│
├─ Phase 6: Execute Release
│  ├─ Version bumps → Changelog → Commit → Git agent (tag + release) → Back-link → Associate → Publish → Post-release
│  └─ Progress checkpoints between each step
│
└─ Phase 7: Suggest Improvements
   └─ Suggested diffs to RELEASE-FLOW.md (never auto-applied)
```

## Principles

1. **Learn once, reuse always** — discovery happens on first run; subsequent releases skip it
2. **Config is data, not code** — structured config fields map to pre-defined operations, never raw shell commands
3. **Checkpoint-resume** — progress file enables safe resume of interrupted releases
4. **User confirms before execution** — release plan is presented for approval before any tags or commits

## Error Handling

- Validate agent fails (build/test): halt, report failures, do not proceed
- User declines release plan: halt gracefully
- User halts at the traceability question: stop — nothing has been committed, tagged or published
- Git agent reports DEGRADED while gathering, back-linking or associating: warn and continue — never halt the release
- Git agent fails (tag/release): halt, report error, suggest manual steps
- Mid-release failure: progress checkpoint enables resume on next run
- Version file not found: halt, report which file is missing, ask user to update RELEASE-FLOW.md
