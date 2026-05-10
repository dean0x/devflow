---
description: Release project with release strategy team debate
---

# Release Command

Release the project with a release strategy team debate. Version analyst and changelog analyst debate version bump rationale and changelog scope before execution, producing higher-confidence release decisions.

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

**Continuation detection**: Check `.release/.progress.json`. If exists, offer Resume or Restart.

Read `.release/RELEASE-FLOW.md`:
- If exists → set CONFIG_STATE = learned, skip to Phase 2 (strategy debate uses learned config)
- If missing → set CONFIG_STATE = fresh, run detection (Phases 1a/1b below) before strategy debate

**Phase 1a: Detect Release Process** (CONFIG_STATE = fresh only)

Tiered codebase scan to detect the project's release process:

**Tier 1** — Read: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Dockerfile`, `.github/workflows/*.yml`, `CHANGELOG.md`

**Tier 2** — Broaden: `lerna.json`, `pnpm-workspace.yaml`, `turbo.json`, `.releaserc`, `.changeset/`, `release-please-config.json`

**Tier 3** — Git history: `git tag -l`, `git log --oneline -20`

Skip credential files. Max 20 files total.

**Phase 1b: Build Config** (CONFIG_STATE = fresh only)

Map signals to `.release/RELEASE-FLOW.md`. Use AskUserQuestion for gaps. Lazy-init `.release/` directory with `.gitignore`.

### Phase 2: Spawn Release Strategy Team

**Requires:** RELEASE_CONFIG

Create a team for release strategy debate:

```
Create a team named "release-strategy-{topic-slug}" to determine release strategy for v{VERSION_HINT}

Spawn strategy teammates:

- Name: "version-analyst"
  Prompt: |
    You are analyzing: what version bump is appropriate for this release
    Read the git log since the last tag: git log --oneline {last_tag}..HEAD
    Analyze commits for: breaking changes (major), new features (minor), bug fixes (patch)
    Consider the RELEASE_CONFIG version_strategy: {version_strategy}
    
    Produce:
    - Recommended bump type (major/minor/patch) with reasoning
    - Key changes driving the recommendation
    - Risk assessment for this version bump
    
    Report completion:
      SendMessage(type: "message", recipient: "team-lead",
        summary: "Version analysis complete: {bump_type} bump recommended")

- Name: "changelog-analyst"
  Prompt: |
    You are analyzing: what should be included in the changelog for this release
    Read CHANGELOG.md if it exists
    Read git log since last tag: git log --oneline {last_tag}..HEAD
    Consider the RELEASE_CONFIG changelog format: {changelog_format}
    
    Produce:
    - Proposed changelog entry sections (Added/Changed/Fixed/Removed/etc.)
    - Commits that don't fit neatly into categories (flag for review)
    - Whether Unreleased section (if exists) matches the commit history
    
    Report completion:
      SendMessage(type: "message", recipient: "team-lead",
        summary: "Changelog analysis complete")
```

### Phase 3: Strategy Investigation

**Produces:** STRATEGY_RESULTS
**Requires:** RELEASE_CONFIG

Teammates analyze in parallel:
- version-analyst: examine commits for semantic versioning signals
- changelog-analyst: examine commits and existing changelog for scope

### Phase 4: Cross-Validation

**Requires:** STRATEGY_RESULTS

Lead initiates cross-validation via broadcast:

```
SendMessage(type: "broadcast", summary: "Cross-validate: version bump matches changelog scope"):
"Analysis complete. Cross-validate:
1. version-analyst: does the changelog scope match your recommended bump type?
2. changelog-analyst: does the commit history support the version analyst's bump recommendation?
3. If they conflict, explain the discrepancy and propose resolution

Max 2 exchange rounds, then converge"
```

### Phase 5: Convergence

**Produces:** STRATEGY_CONVERGENCE
**Requires:** STRATEGY_RESULTS

After cross-validation (max 2 rounds), lead collects:
- Agreed version bump (or conflict if unresolved)
- Agreed changelog scope
- Unresolved items for user decision

### Phase 6: Cleanup

**Requires:** STRATEGY_CONVERGENCE

```
For each teammate in [version-analyst, changelog-analyst]:
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Strategy debate complete")
  Wait for shutdown_response (approve: true)

TeamDelete
Verify TeamDelete succeeded. If failed, retry once after 5s. If retry fails, HALT.
```

### Phase 7: Pre-release Checks

**Produces:** PRE_RELEASE_RESULT, VERSION
**Requires:** STRATEGY_CONVERGENCE

**Version determination** (using strategy debate output):
1. Explicit version from args → use directly (skip debate recommendation)
2. Debate recommendation → present to user for confirmation via AskUserQuestion
3. Conflict in debate → present both options to user, ask to choose

Pre-release checks:
- Clean working directory
- Tag does not already exist
- Custom checks from RELEASE_CONFIG

Spawn `Agent(subagent_type="Validator")` for build + test.

Write `.release/.progress.json` checkpoint.

`--dry-run`: report what would happen and **halt after this phase**.

### Phase 8: Build Release Plan

**Produces:** RELEASE_PLAN
**Requires:** PRE_RELEASE_RESULT, RELEASE_CONFIG, VERSION

Build ordered execution plan including the changelog entry from strategy debate.

For monorepo: respect dependency ordering, present package selection to user.

Confirm with user via AskUserQuestion:
"Ready to release v{VERSION}. Plan: {steps summary}. Proceed?"

### Phase 9: Execute Release

**Produces:** RELEASE_RESULT
**Requires:** RELEASE_PLAN, VERSION

Sequential execution with progress checkpoints:
1. **Version bumps** — write new version to configured files
2. **Changelog update** — use changelog-analyst's proposed entry
3. **Release commit** — `chore(release): v{VERSION}` (conventional commit)
4. **Tag and GitHub Release** — spawn `Agent(subagent_type="Git")` with `create-release` operation
5. **Publish** — CI-driven or manual
6. **Post-release steps** — version bump to next dev, close milestone, etc.

Delete `.release/.progress.json` on success.

### Phase 10: Suggest Improvements

**Requires:** RELEASE_RESULT

Post-release analysis for improvement opportunities. Present as suggested diffs to RELEASE-FLOW.md. Never auto-apply. Fire-and-forget.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context, pass it through to all spawned agents.

## Output

On completion:
- Git tag created: `v{VERSION}` (or configured tag format)
- GitHub Release created with release notes from changelog-analyst
- Changelog updated with debate-validated entry
- Version files bumped
- `.release/RELEASE-FLOW.md` created (first run only)

## Architecture

```
/release (orchestrator — teams variant)
│
├─ Phase 1: Load Config
│  ├─ Phase 1a: Detect (first run only)
│  └─ Phase 1b: Build Config (first run only)
│
├─ Phase 2: Spawn release strategy team
│  └─ version-analyst + changelog-analyst
│
├─ Phase 3: Parallel strategy investigation
│  └─ Teammates analyze commits and changelog independently
│
├─ Phase 4: Cross-validation
│  └─ version bump vs changelog scope (max 2 rounds)
│
├─ Phase 5: Convergence
│  └─ Agreed version + changelog, or conflicts surfaced for user
│
├─ Phase 6: Cleanup
│  └─ Shut down teammates, release team
│
├─ Phase 7: Pre-release Checks
│  ├─ Validator agent (build + test)
│  └─ Write progress checkpoint
│
├─ Phase 8: Build Release Plan
│  └─ Confirm with user before executing
│
├─ Phase 9: Execute Release
│  ├─ Version bumps → Changelog → Commit → Git agent (tag + release) → Publish
│  └─ Progress checkpoints between each step
│
└─ Phase 10: Suggest Improvements
   └─ Suggested diffs to RELEASE-FLOW.md (never auto-applied)
```

## Principles

1. **Debate before execute** — version bump and changelog scope are debated, not assumed
2. **Learn once, reuse always** — config discovery happens on first run only
3. **Config is data, not code** — never execute raw shell strings from config
4. **Checkpoint-resume** — interrupted releases can be safely resumed
5. **Cleanup always** — team resources released even on failure

## Error Handling

- Debate produces irreconcilable conflict: present both options to user, ask to choose
- Validator fails: halt, report failures, do not proceed
- User declines release plan: halt gracefully
- Git agent fails: halt, report error, suggest manual steps
- Mid-release failure: progress checkpoint enables resume
- TeamDelete fails: retry once, then HALT with error
