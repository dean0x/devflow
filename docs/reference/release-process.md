# Release Process

One-click releases via GitHub Actions. The developer chooses the version; CI handles everything else.

## Prerequisites (One-Time Setup)

1. **Create npm access token** — npmjs.com → Access Tokens → Granular Access Token
   - Package: `devflow-kit` only
   - Permissions: Read and Write
   - Expiration: No expiration (recommended for CI)

2. **Add GitHub secret** — Repo Settings → Secrets → Actions → `NPM_TOKEN`

3. **Allow CI to push to main** — Repo Settings → Rules → Rulesets → add "GitHub Actions" to bypass actors

## During Development

Update `CHANGELOG.md` `[Unreleased]` section in each PR:

```markdown
## [Unreleased]

### Added
- New feature description

### Fixed
- Bug fix description

---
```

## Creating a Release

1. Go to **GitHub Actions** → **Release** workflow
2. Click **Run workflow**
3. Enter version (e.g., `1.3.0`) — strict semver, no `v` prefix
4. Click **Run workflow**

Done. npm package, git tag, and GitHub release are all created automatically.

## What CI Does

```
validate version format
  → check tag doesn't exist
  → check [Unreleased] section exists
  → bump version in package.json + CHANGELOG.md
  → sync package-lock.json
  → build
  → test
  → verify CLI --version output
  → commit "chore: bump version to X.Y.Z"
  → push to main
  → create + push git tag vX.Y.Z
  → npm publish --provenance
  → create GitHub release with extracted notes
  → restore [Unreleased] section + commit + push
```

## Traceability Evidence (Evidence Policy)

When the repository's evidence policy resolves `required` — `.devflow/policy.json` on the default branch, or compliance enabled on the releasing machine — the `/release` command gathers and ships additional evidence. `/release --dry-run` gathers and shows the same evidence under either policy, without asking anything or writing a resume checkpoint.

**Last release tag** — `release-trace.cjs last-tag` picks the highest merged tag matching `^v?X.Y.Z$`, compared numerically, so a marker tag (such as `sdlc-baseline-2026-09-24`) or a prerelease tag never counts as the last release. Version analysis uses the same tag under either policy.

**Trace map** — at the end of pre-release checks, before the confirm, the Git `gather-release-evidence` operation collects the commit list and the shipped issues and runs `release-trace.cjs map`: a git-only, first-parent scan of at most 500 commits since the last tag. Each commit's full message is read (`git log --format=%B`), so a reference on a wrapped second line counts. Every commit is classified, first match wins:

| Class | Rule |
|-------|------|
| traced | a closing keyword plus a reference in the tracker's own grammar (a Jira or Linear key must match the configured project or team key), or, on GitHub, a merged PR that closes an issue |
| exempt: release | a strict `chore(release): vX.Y.Z` subject, or a commit that touches only `CHANGELOG.md` |
| exempt: revert | a revert subject backed by body evidence |
| exempt: bot | a `[bot]` author name **and** a GitHub noreply bot email, read without `.mailmap` |
| untraced | everything else |

**Exceptions or halt** — untraced commits, or unknown coverage (the 500-commit bound hit, the trace unavailable, or the gather indeterminate), trigger one question: record self-attested traceability exceptions, or halt before anything is committed or tagged. Recorded exceptions are appended last to the release notes under `## Traceability exceptions`, scrubbed (D11) with them, and never dropped by the size cap. Exempt commits are always listed there, since an exemption is self-asserted. Jira and Linear have no closing-reference capability, so their gather never reports `READY`: it lands on the partial arm, which warns and never blocks on its own.

**Commit list in release notes** — the release notes body includes a `## Commits` section with the first 100 commits since the last tag. Notes over 60,000 characters drop `## Commits` first, then cut the changelog at a line boundary ending `…truncated`; the size is re-checked after the secret scrub.

**Shipped-issue back-links** — after the release is created, the Git `backlink-shipped-issues` operation posts a marker-deduped comment on each shipped issue (≤50 issues, 1s throttle). Running the release again for the same version is safe — the marker prevents duplicate comments.

**Release association** — the Git `associate-release` operation then adds each shipped issue to the release's tracker marker named `v{VERSION}`: a GitHub milestone, a Jira fixVersion or a Linear label. It adds and never replaces: on GitHub, an issue already on another milestone keeps it.

**Conventions naming authority** — `.devflow/conventions.md` is the canonical source for version/tag/version-PR title conventions. It is written by the Git `learn-conventions` operation (which scans branch/tag/PR history to infer the project's naming patterns) when a `required` policy first needs it, and GIT-TRACKED so the team shares a single naming source. The `/release` command consults it, when present, for the tag and GitHub release names. Re-learn conventions by deleting `.devflow/conventions.md` — the next Git `learn-conventions` call rewrites it from history.

The tag push and the release create are hard failures. The commit list, back-links and release association degrade gracefully (D4: `TRACEABILITY: DEGRADED ({reason})`) on API or file-access failures — they never block the release.

## Out of Scope

- **CI releases bypass `/release`.** The `workflow_dispatch` release above runs in GitHub Actions, not through `/release`, so it gathers no evidence, asks nothing about untraced commits, and posts no back-links or release markers. Run `/release --dry-run` first when a release needs its trace.
- **No server-side enforcement.** Every evidence gate runs inside the devflow commands on the machine running them. Nothing in CI or branch protection checks the evidence policy, a test plan or a trace map: a PR opened or a release cut without devflow meets no gate.
- **No auto-merge.** Devflow never merges a PR. `check-merge-readiness` only reports READY or NOT_READY, and `/dynamic-build` opens the wave PR but never merges it.

## Residual Races

Documented, not closed:

- **Release markers.** GitHub has no conditional update, so a milestone set on an issue between `associate-release`'s read and its write is overwritten. On Jira and Linear, when the tool offers no additive operation, the operation writes the union of the current and new values, so a version or label another writer adds between the read and the write is dropped.
- **Linear back-link dedup.** The Linear workspace cannot tell devflow which account it is, so `backlink-shipped-issues` cannot filter its dedup scan by author: every run reports `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)` and posts anyway.

## Manual Fallback

If CI is unavailable, release manually:

```bash
# 1. Bump all version files
npm run version:bump -- 1.3.0 > release-notes.md

# 2. Build and test
npm run build && npm test

# 3. Commit and push
git add -A
git commit -m "chore: bump version to 1.3.0"
git push origin main

# 4. Tag
git tag -a v1.3.0 -m "Version 1.3.0"
git push origin v1.3.0

# 5. Publish
npm publish

# 6. GitHub release
gh release create v1.3.0 --title "v1.3.0" --notes-file release-notes.md

# 7. Restore [Unreleased]
# Add back the [Unreleased] section above the new version in CHANGELOG.md
git add CHANGELOG.md
git commit -m "chore: restore [Unreleased] section"
git push origin main
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Tag already exists" | Tag was created but release failed. Delete tag: `git push --delete origin v1.3.0 && git tag -d v1.3.0`, then re-run. |
| "No [Unreleased] section" | CHANGELOG.md is missing the `## [Unreleased]` header. Add it manually above the latest version. |
| npm publish fails (401) | `NPM_TOKEN` secret expired or missing. Generate a new token and update the secret. |
| npm publish fails (403) | Token doesn't have write access to `devflow-kit`. Regenerate with correct package scope. |
| CLI version mismatch | Build output doesn't match expected version. Check that `package.json` was updated correctly. |
| Push to main rejected | GitHub Actions bot not in ruleset bypass list. Update branch protection rules. |

## Release Checklist

Items marked with **[auto]** are handled by CI:

- [ ] CHANGELOG.md `[Unreleased]` section has content
- [x] **[auto]** Version bumped in package.json
- [x] **[auto]** package-lock.json synced
- [x] **[auto]** CHANGELOG.md dated and linked
- [x] **[auto]** Build succeeds
- [x] **[auto]** Tests pass
- [x] **[auto]** CLI `--version` matches
- [x] **[auto]** Committed and pushed to main
- [x] **[auto]** Git tag created
- [x] **[auto]** Published to npm with provenance
- [x] **[auto]** GitHub release created
- [x] **[auto]** `[Unreleased]` section restored
