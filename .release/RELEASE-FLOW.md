# Release Flow — devflow-kit

Learned by `/release` on 2026-08-23 from: `package.json`, `.github/workflows/release.yml`,
`docs/reference/release-process.md`, `scripts/bump-version.ts`, `CHANGELOG.md`, git tags.

## Packages

- Single package: `devflow-kit` (npm), version source of truth: `package.json`
- Node >= 22, `bin: devflow`, publishes `dist/` + `src/assets/` + templates

## Version Strategy

- `semver-auto`: derive bump from conventional commits since last tag (`!`/BREAKING → major)
  Also scan squash-commit BODIES for breaking-change sections (`## Breaking Changes`) —
  PR templates document them there without the `!` marker; confirm major-vs-minor with
  the user when found (2.1.0 shipped such changes as a minor by explicit user choice)
- Tag format: `vX.Y.Z` (annotated). Release title: `vX.Y.Z`. No `v` prefix in CI input.
- Branching model: main-only, squash merges, no version PRs. CI bot commits directly to main
  (ruleset bypass). `.devflow/conventions.md` absent — heuristics above learned from history.

## Pre-release Checks

1. Clean working tree (`git status --porcelain` empty)
2. Tag `v{VERSION}` does not exist (local + CI re-checks)
3. `CHANGELOG.md` has a non-empty `## [Unreleased]` section
4. Local build + test via Validate agent (`npm run build`, `npm test`)
5. `gh` authenticated (needed to dispatch the workflow)
6. No pre-existing `## [{VERSION}]` header below a non-empty `[Unreleased]` — stale
   aborted-bump residue ships old notes (bump-version.ts fails loudly on this since 2.0.1)
7. `RELEASE_TOKEN` age via `gh secret list` — the fine-grained PAT expires silently and
   kills the run at checkout ("could not read Username"); rotate before dispatch if old

## Changelog

- Format: Keep a Changelog; `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` + compare link,
  done by `scripts/bump-version.ts` (idempotent: skips if version header already present)
- Release notes = the new version's section (up to first `---`), captured from script stdout
- CI restores a fresh `## [Unreleased]` header after the release and pushes it
- If `[Unreleased]` is empty but commits exist since the last tag (PRs merged without
  changelog entries — happened for 2.1.0), draft entries from the squash-commit bodies,
  get user approval, and land as a `docs(changelog):` commit on main before dispatch

## Build & Test

- `npm run build` = `tsc` + `build:mds`; `npm test` = `vitest run`
- Known flake: `capture-hooks.test.ts` memory-worker spawn test (teardown race) — re-run
  isolated before treating as a real failure

## Publish

**CI-driven (primary)**: dispatch the Release workflow —
`gh workflow run release.yml -f version={VERSION}`
CI then: validate semver → tag-free check → bump files → build → test → verify
`cli --version` → commit `chore: bump version to {VERSION}` → push main → tag `v{VERSION}` →
`npm publish --provenance` (tag `latest`, or prerelease channel from suffix) → GitHub release
with extracted notes → restore `[Unreleased]`.

**Manual fallback**: `docs/reference/release-process.md` § Manual Fallback.

## Post-release

- `git pull` main (CI adds 1–2 commits: version bump if needed + `[Unreleased]` restore)
- Verify: `npm view devflow-kit version`, `gh release view v{VERSION}`
- Compliance-gated extras (commit list, shipped-issue back-links): skipped unless
  `~/.claude/skills/devflow:compliance/SKILL.md` exists
