# Release Process

A release PR sets the version and the CHANGELOG. After it merges, a `vX.Y.Z` tag push on the merged commit starts `.github/workflows/release.yml`. The workflow publishes to npm through npm trusted publishing, with provenance, and creates the GitHub release. No workflow uses a stored npm token or a personal GitHub token.

## Prerequisites (One-Time Setup)

1. **npm trusted publisher** — on npmjs.com, open `devflow-kit` → Settings → Trusted publishing, and set:
   - Provider: GitHub Actions
   - Organization or user: `dean0x`
   - Repository: `devflow`
   - Workflow filename: `release.yml`
   - Environment: empty (the jobs use no GitHub environment)

2. **npm publishing access** — after the first trusted publish, set the package publishing access to "Require two-factor authentication and disallow tokens". Revoke each old npm token that can publish `devflow-kit`. Delete the old repository Actions secrets of the dispatch release (`NPM_TOKEN`, `RELEASE_TOKEN`), and revoke the personal access token behind `RELEASE_TOKEN`.

The npm publish signs in with the workflow identity (OIDC). It needs npm 11.5.1 or newer, so the publish step runs a pinned npm 11 through `npx`. `tests/release-workflow.test.ts` keeps every workflow free of stored tokens and secrets, and keeps each action pinned to a full commit SHA.

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

## Installed Names

An install moves a file that devflow did not ship out of the devflow install folders. So the list of names that devflow shipped must stay exact. Two rules keep it exact:

- A PR that ships a new installed name adds the name to `tests/fixtures/released-shipped-names.ts`. A guard fails when the build ships a name that the fixture does not hold.
- A PR that ships a retired name again removes the name from `RETIRED_SHIPPED` in `src/core/retired-shipped-names.ts` and from the legacy list in `src/targets/claude-code/legacy.ts`, in the same PR. A guard fails when one name is in both the shipped set and the retired set.
- A name goes on a delete list (the commands, agents, rules and skill files of `RETIRED_SHIPPED`) only when a release shipped it. A guard fails when a name on a delete list is not in `tests/fixtures/released-shipped-names.ts`. Any other name, even one that a legacy list holds, is an unknown file: it moves to the backup folder and is named.

## Creating a Release

1. On a branch from main, run `npm run version:bump -- 1.3.0` (strict semver, no `v` prefix). The script:
   - sets the version in `package.json` and `package-lock.json`;
   - renames `## [Unreleased]` to `## [1.3.0] - <date>` and adds the compare link;
   - adds a new empty `## [Unreleased]` section above the new version;
   - prints the release notes.
2. Open a release PR with the title `chore(release): v1.3.0`, and merge it after CI passes.
3. Tag the merge commit of the release PR (not a later commit on main), and push the tag:

   ```bash
   git fetch origin main
   git tag -a v1.3.0 -m "Version 1.3.0" <merge commit SHA of the release PR>
   git push origin v1.3.0
   ```

The tag push starts the Release workflow. It publishes the npm package and creates the GitHub release.

## What CI Does

The tag push starts three jobs. Each job sets only the permissions that it needs.

```
verify (contents: read)
  → tag is vX.Y.Z or vX.Y.Z-pre.N
  → tagged commit is on main
  → tag version equals package.json
  → package-lock.json version equals package.json
  → CHANGELOG.md has the ## [X.Y.Z] - <date> section, and the release notes extract with no file change
  → build, npm test, npm run test:integration
  → node dist/cli.js --version equals the tag version
publish (contents: read, id-token: write), after verify
  → npm ci --ignore-scripts, no npm cache, no registry-url
  → npx -y npm@11.x publish --provenance --access public --tag <dist-tag>
github-release (contents: write), after publish
  → extract the release notes from CHANGELOG.md (bump-version.ts on the set version changes no file)
  → gh release create vX.Y.Z with the workflow token
```

A release version publishes to the `latest` dist-tag. A pre-release version publishes to its first pre-release word: `2.0.0-beta.1` goes to `beta`. A pre-release word that is not a name, such as `2.0.0-1`, goes to `next`. A tag with a `-` makes a GitHub pre-release.

## Traceability Evidence (Evidence Policy)

When the repository's evidence policy resolves `required` — `evidence` in `.devflow/project.json` on the default branch, a committed retired `.devflow/policy.json` where that project.json has no `evidence` key, a repository `compliance` key, or compliance enabled on the releasing machine — the `/release` command gathers and ships additional evidence. `/release --dry-run` gathers and shows the same evidence under either policy, without asking anything or writing a resume checkpoint.

**Last release tag** — `release-trace.cjs last-tag` picks the highest merged tag matching `^v?X.Y.Z$`, compared numerically, so a marker tag (such as `sdlc-baseline-2026-09-24`) or a prerelease tag never counts as the last release. Version analysis uses the same tag under either policy.

**Trace map** — at the end of pre-release checks, before the confirm, the Git `gather-release-evidence` operation collects the commit list and the shipped issues and runs `release-trace.cjs map`: a git-only, first-parent scan of at most 500 commits since the last tag. Each commit's full message is read (`git log --format=%B`), so a reference on a wrapped second line counts. Every commit is classified, first match wins:

| Class | Rule |
|-------|------|
| traced | a closing keyword or `Refs` plus a reference in the tracker's own grammar (a Jira or Linear key must match the configured project or team key), or, on GitHub, a merged PR that closes an issue |
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

- **CI releases bypass `/release`.** The tag-push release above runs in GitHub Actions, not through `/release`, so it gathers no evidence, asks nothing about untraced commits, and posts no back-links or release markers. Run `/release --dry-run` first when a release needs its trace.
- **No server-side enforcement.** Every evidence gate runs inside the devflow commands on the machine running them. Nothing in CI or branch protection checks the evidence policy, a test plan or a trace map: a PR opened or a release cut without devflow meets no gate.
- **No auto-merge.** Devflow never merges a PR. `check-merge-readiness` only reports READY or NOT_READY.

## Residual Races

Documented, not closed:

- **Release markers.** GitHub has no conditional update, so a milestone set on an issue between `associate-release`'s read and its write is overwritten. On Jira and Linear, when the tool offers no additive operation, the operation writes the union of the current and new values, so a version or label another writer adds between the read and the write is dropped.
- **Linear back-link dedup.** The Linear workspace cannot tell devflow which account it is, so `backlink-shipped-issues` cannot filter its dedup scan by author: every run reports `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)` and posts anyway.

## Manual Fallback

If the Release workflow is not available, publish from a maintainer machine. Use this only after the release PR merged and the tag is pushed. A manual publish has no provenance, and it needs an npm sign-in with two-factor authentication.

```bash
git fetch origin && git checkout v1.3.0
npm ci && npm run build && npm test
npm publish --tag latest
npm run version:bump -- 1.3.0 > "$TMPDIR/release-notes.md"   # changes no file on the set version
gh release create v1.3.0 --verify-tag --title "v1.3.0" --notes-file "$TMPDIR/release-notes.md"
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Tag does not match package.json | The tag is on a commit that has a different version. Delete the tag (`git push --delete origin v1.3.0 && git tag -d v1.3.0`), then tag the merged release commit. |
| Tagged commit is not on main | Tag only a commit on main, after the release PR merged. |
| package-lock.json does not match | Run `npm install --package-lock-only` in the release PR. |
| No `## [X.Y.Z] - <date>` section | Run `npm run version:bump -- X.Y.Z` in the release PR. |
| npm publish fails (404 or 403) | Check the trusted publisher on npmjs.com: user `dean0x`, repository `devflow`, workflow `release.yml`, no environment. |
| npm publish fails: version exists | The version is on npm already. Re-run only the failed `github-release` job, or release a new version. |
| CLI version mismatch | The build output does not match the tag version. Check `package.json` in the release PR. |
| GitHub release step fails | Re-run the failed `github-release` job. It does not publish again. |

## Release Checklist

- [ ] The release PR moves the `[Unreleased]` content to `## [X.Y.Z] - <date>`, with a new empty `[Unreleased]` above it
- [ ] The release PR sets the version in `package.json` and `package-lock.json`
- [ ] CI passes on the release PR, and the PR merges
- [ ] The `vX.Y.Z` tag is on the merged commit on main, and is pushed
- [x] **[auto]** The tag, the lock file, the CHANGELOG section, the build, the tests and the CLI `--version` pass
- [x] **[auto]** npm publish with provenance, to the dist-tag of the version
- [x] **[auto]** GitHub release with the CHANGELOG notes
