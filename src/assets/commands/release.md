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

### Phase 1c: Resolve Compliance Context

**Produces:** COMPLIANCE_SKILL_INSTALLED

**Resolve `COMPLIANCE_SKILL_INSTALLED` once per run:** Check whether `~/.claude/skills/devflow:compliance/SKILL.md` exists (one file-existence check, read-only, silent). Reuse this result for all subsequent phases. The compliance gate determines whether release evidence is gathered and shipped-issue back-links are posted.

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

**Produces:** PRE_RELEASE_RESULT, VERSION
**Requires:** RELEASE_CONFIG

**Version determination** (in order):
1. Explicit version from args → use directly
2. Bump type from args → compute from current version
3. `semver-auto` strategy → analyze commits since last tag
4. None → use AskUserQuestion

Pre-release checks:
- Clean working directory (`git status --porcelain`)
- Tag does not already exist
- Custom checks from RELEASE_CONFIG

Spawn `Agent(subagent_type="Validate")` for build + test.

Write `.release/.progress.json` checkpoint.

`--dry-run`: report what would happen and **halt after this phase**.

### Phase 5: Build Release Plan

**Produces:** RELEASE_PLAN
**Requires:** PRE_RELEASE_RESULT, RELEASE_CONFIG, VERSION

Build ordered execution plan from RELEASE_CONFIG. For monorepo: respect dependency ordering, present package selection to user.

Confirm with user via AskUserQuestion before executing:
"Ready to release v{VERSION}. Plan: {steps summary}. Proceed?"

`--dry-run`: should already be halted from Phase 4.

### Phase 6: Execute Release

**Produces:** RELEASE_RESULT
**Requires:** RELEASE_PLAN, VERSION

Sequential execution with progress checkpoints:
1. **Version bumps** — write new version to configured files
2. **Changelog update** — move Unreleased section to versioned entry (if configured)
2b. **Gather release evidence** (compliance-gated: only when COMPLIANCE_SKILL_INSTALLED) — spawn `Agent(subagent_type="Git")` with `gather-release-evidence` operation; pass `WORKTREE_PATH` if provided. Consume the returned `COMMIT_LIST` and `SHIPPED_ISSUES` for use in steps 4 and 4b. The Git agent applies bounds (≤100 commits, ≤50 issues) and degrades gracefully per D4.
3. **Release commit** — `chore(release): v{VERSION}` (conventional commit)
4. **Tag and GitHub Release** — spawn `Agent(subagent_type="Git")` with `create-release` operation (the agent reads `.devflow/conventions.md` for tag format and release title conventions; compliance defaults when absent); when COMPLIANCE_SKILL_INSTALLED, also pass `COMMIT_LIST` and `SHIPPED_ISSUES` as inputs so the agent includes them in the release notes body.
4b. **Back-link shipped issues** (compliance-gated: only when COMPLIANCE_SKILL_INSTALLED) — spawn `Agent(subagent_type="Git")` with `backlink-shipped-issues` operation, passing `VERSION` and `SHIPPED_ISSUES`; posts `<!-- devflow:shipped v{VERSION} -->` marker-deduped comment on each issue (≤50 issues, 1s throttle); degrade gracefully (D4) on any API failure — never block the release
5. **Publish** — CI-driven (report) or manual (provide instructions)
6. **Post-release steps** — version bump to next dev, close milestone, etc.

Delete `.release/.progress.json` on success.

### Phase 7: Suggest Improvements

**Requires:** RELEASE_RESULT

Post-release analysis for improvement opportunities. Present as suggested diffs to RELEASE-FLOW.md. Never auto-apply. Fire-and-forget.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context, pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Output

On completion:
- Git tag created: `v{VERSION}` (or configured tag format)
- GitHub Release created with release notes
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
│  └─ Write progress checkpoint
│
├─ Phase 5: Build Release Plan
│  └─ Confirm with user before executing
│
├─ Phase 6: Execute Release
│  ├─ Version bumps → Changelog → Commit → Git agent (tag + release) → Publish → Post-release
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
- Git agent fails (tag/release): halt, report error, suggest manual steps
- Mid-release failure: progress checkpoint enables resume on next run
- Version file not found: halt, report which file is missing, ask user to update RELEASE-FLOW.md
