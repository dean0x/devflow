# Release Flow — devflow-kit

Learned by `/release` on 2026-08-23 from: `package.json`, `.github/workflows/release.yml`,
`docs/reference/release-process.md`, `scripts/bump-version.ts`, `CHANGELOG.md`, git tags.

## Packages

- Single package: `devflow-kit` (npm), version source of truth: `package.json`
- Node >= 22, `bin: devflow`, publishes `dist/` + `src/assets/` + templates

## Version Strategy

- `semver-auto`: derive a PROPOSED bump from conventional commits since last tag
  (`!`/BREAKING → major). ALWAYS confirm the resulting version with the user before
  the release PR, even when derivation is unambiguous (user directive, 2026-09-02) — present
  the version explicitly, not just folded into the release-plan summary.
  Also scan squash-commit BODIES for breaking-change sections (`## Breaking Changes`) —
  PR templates document them there without the `!` marker; a section stating "None" is
  a negative declaration, not a breaking change (2.1.0 shipped real breaking changes as
  a minor by explicit user choice; 2.4.0 resolved two "None" sections as minor)
- Tag format: `vX.Y.Z` (annotated). Release title: `vX.Y.Z`. No `v` prefix in the bump input.
- Branching model: main-only, squash merges. A release PR (`chore(release): v{VERSION}`) sets
  the version and the CHANGELOG; CI does not commit to main.
  `.devflow/conventions.md` absent — heuristics above learned from history.

## Pre-release Checks

1. Clean working tree (`git status --porcelain` empty)
2. Tag `v{VERSION}` does not exist (local + CI re-checks)
3. `CHANGELOG.md` has a non-empty `## [Unreleased]` section
4. Local build + test via Validate agent (`npm run build`, `npm test`) — on a busy machine
   (load average ~9–12) the 3.1.0 run timed out in compliance-e2e, model-discovery,
   redact-secrets and eager-memory-refresh, each green alone. The release job rebuilds and
   reruns the full suite before it commits, tags or publishes anything, so a local failure
   is non-blocking when CI ran green at the release commit AND the file passes an isolated
   re-run. Load also causes non-timeout failures: the redact-secrets 2 s timing check,
   the eager-memory-refresh probe-pid ENOENT and the model-discovery live-probe asserts
   (3.5.0). queue-append and shell-hooks also time out under load
5. `gh` authenticated (needed for the release PR), and push access for the tag
6. No pre-existing `## [{VERSION}]` header below a non-empty `[Unreleased]` — stale
   aborted-bump residue ships old notes (bump-version.ts fails loudly on this since 2.0.1)
7. The npm trusted publisher of `devflow-kit` names `dean0x/devflow`, workflow
   `release.yml`, no environment (`docs/reference/release-process.md` § Prerequisites)
8. Every `(#N)` squash commit since the last tag has an `[Unreleased]` entry — #409 was
   missed in 3.0.0 and added before the release as a `docs(changelog):` commit

## Changelog

- Format: Keep a Changelog; `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` + compare link,
  done by `scripts/bump-version.ts` (idempotent: skips if version header already present)
- Release notes = the new version's section (up to first `---`), captured from script stdout
- The bump also adds a new empty `## [Unreleased]` section above the new version, in the
  release PR
- The version header date is the local date of the machine that runs the bump
- If `[Unreleased]` is empty but commits exist since the last tag (PRs merged without
  changelog entries — happened for 2.1.0), draft entries from the squash-commit bodies,
  get user approval, and land as a `docs(changelog):` commit on main before the release PR

## Build & Test

- `npm run build` = `tsc` + `build:mds`; `npm test` = `vitest run`
- Known flake: `capture-hooks.test.ts` memory-worker spawn test (teardown race) — re-run
  isolated before treating as a real failure

## Publish

**CI-driven (primary)**:
1. Release PR: `npm run version:bump -- {VERSION}` on a branch, PR `chore(release): v{VERSION}`,
   merge after CI passes
2. Tag the merged commit: `git fetch origin main && git tag -a v{VERSION} -m "Version {VERSION}" origin/main && git push origin v{VERSION}`
3. The tag push starts `release.yml`: verify (tag format, tag on main, tag = package.json =
   package-lock.json, CHANGELOG section, build, test, integration test, `cli --version`) →
   publish (npm trusted publishing, `npx -y npm@11.x publish --provenance`, tag `latest` or the
   pre-release word) → github-release (notes from CHANGELOG, `github.token` only)

**Manual fallback**: `docs/reference/release-process.md` § Manual Fallback.

## Post-release

- Verify: `npm view devflow-kit dist-tags`, `gh release view v{VERSION}` (plain
  `npm view devflow-kit version` lagged right after CI in 3.0.0)
- npm kept `latest` at the previous version for ~4 minutes after CI printed
  `+ devflow-kit@3.1.0`, even with `--prefer-online` and via the registry's
  `/-/package/devflow-kit/dist-tags` endpoint — poll the dist-tags until `latest` moves,
  then install
- The agent cannot run `npm i -g` (a permission rule denies it) — hand the user
  `! npm i -g devflow-kit@{VERSION}` to run themselves
- Evidence extras run when EVIDENCE_POLICY=required (this repo: `.devflow/project.json`
  `evidence: required`): the tag push starts CI, and CI creates the GitHub release; the Git agent only
  enriches that release with `gh release edit` and never creates a release. It
  appends `## Commits`, `## Shipped Issues` and `## Traceability exceptions` to the body
  (CHANGELOG-derived notes kept byte-for-byte, exceptions block last), back-links each
  shipped issue and adds them to a `vX.Y.Z` milestone
- Shipped Issues: only closing keywords (close/fix/resolve and their forms) ship an issue;
  `Refs #N` does not
- Commits pushed straight to main with no PR show as `untraced` in the trace map and need
  a self-attested exception (3.5.0: 4 behavior-rule commits + a PR that closes no issue)
