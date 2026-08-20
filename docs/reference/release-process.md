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

## Traceability Evidence (Compliance-Gated)

When the compliance skill is installed (`~/.claude/skills/devflow:compliance/SKILL.md` exists), the `/release` command gathers and ships additional evidence:

**Commit list in release notes** — `git log {last_tag}..HEAD --oneline` is collected before the release commit and passed to the Git `create-release` operation. The release notes body includes a `## Commits` section listing all commits since the last tag.

**Shipped-issue back-links** — After the release is created, the Git `backlink-shipped-issues` operation posts a `<!-- devflow:shipped v{VERSION} -->` marker-deduped comment on each issue referenced in the shipped commits (≤50 issues, 1s throttle). Running the release again for the same version is safe — the marker prevents duplicate comments.

**Conventions naming authority** — `.devflow/conventions.md` is the canonical source for version/tag/version-PR title conventions. It is written by the Git `learn-conventions` operation (which scans branch/tag/PR history to infer the project's naming patterns) and GIT-TRACKED so the team shares a single naming source. The `/release` command consults it when naming the tag and GitHub release. Re-learn conventions by deleting `.devflow/conventions.md` — the next Git `learn-conventions` call rewrites it from history.

All three behaviors degrade gracefully (D4: `TRACEABILITY: DEGRADED ({reason})`) on API or file-access failures — they never block the release.

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
