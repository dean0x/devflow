# Release Process

Full runbook for creating new DevFlow Kit releases.

## 1. Prepare the Release

**Update Version** in `package.json`:
- Patch (0.1.x): Bug fixes, docs, minor tweaks, internal refactoring
- Minor (0.x.0): New features, commands, CLI options (backwards compatible)
- Major (x.0.0): Breaking changes, removed/renamed commands

**Update CHANGELOG.md:**
```markdown
## [0.1.x] - YYYY-MM-DD

### Added
- New features

### Changed
- Modified functionality

### Fixed
- Bug fixes

### Documentation
- Doc improvements

---
[0.1.x]: https://github.com/dean0x/devflow/releases/tag/v0.1.x
```

## 2. Build and Test

```bash
npm run build
node dist/cli.js --version    # Verify new version
node dist/cli.js init          # Test installation
npm pack --dry-run             # Verify package contents
```

## 3. Commit Version Bump

```bash
rm -f .git/index.lock && \
git add package.json CHANGELOG.md && \
git commit -m "chore: bump version to 0.1.x

- Update package.json to 0.1.x
- Add CHANGELOG entry for v0.1.x
- Document [summary of changes]"

git push origin main
```

## 4. Publish to npm

```bash
npm publish
npm view devflow-kit version    # Verify
```

## 5. Create Git Tag and GitHub Release

```bash
git tag -a v0.1.x -m "Version 0.1.x - [Brief Description]

- Key change 1
- Key change 2
- Key change 3"

git push origin v0.1.x
```

```bash
gh release create v0.1.x \
  --title "v0.1.x - [Release Title]" \
  --notes "$(cat <<'EOF'
# DevFlow Kit v0.1.x

[Brief description]

## Highlights
- Key improvement 1
- Key improvement 2

## Changes

### Added
- New features

### Changed
- Modified functionality

### Fixed
- Bug fixes

## Installation

\`\`\`bash
npx devflow-kit init
\`\`\`

## Links
- npm: https://www.npmjs.com/package/devflow-kit
- Changelog: https://github.com/dean0x/devflow/blob/main/CHANGELOG.md
EOF
)"
```

## 6. Verify Release

```bash
npm view devflow-kit
gh release view v0.1.x
npx devflow-kit@latest init
```

## Release Checklist

- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated
- [ ] `npm run build` succeeds
- [ ] Local testing passed
- [ ] Version bump committed and pushed
- [ ] Published to npm
- [ ] Git tag created and pushed
- [ ] GitHub release created
- [ ] npm shows correct version
- [ ] `npx devflow-kit init` works
