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

Spawn `Agent(subagent_type="Validator")` for build + test.

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
3. **Release commit** — `chore(release): v{VERSION}` (conventional commit)
4. **Tag and GitHub Release** — spawn `Agent(subagent_type="Git")` with `create-release` operation
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
├─ Phase 2: Detect Release Process (first run only)
│  └─ Tiered scan: package.json, CI workflows, git history
│
├─ Phase 3: Build Config (first run only)
│  └─ Write .release/RELEASE-FLOW.md
│
├─ Phase 4: Pre-release Checks
│  ├─ Validator agent (build + test)
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

- Validator fails (build/test): halt, report failures, do not proceed
- User declines release plan: halt gracefully
- Git agent fails (tag/release): halt, report error, suggest manual steps
- Mid-release failure: progress checkpoint enables resume on next run
- Version file not found: halt, report which file is missing, ask user to update RELEASE-FLOW.md
