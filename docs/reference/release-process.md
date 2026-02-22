# Release Process

Full runbook for creating new DevFlow Kit releases.

## 1. Prepare the Release

**Update Version** in `package.json`:
- Patch (x.y.Z): Bug fixes, docs, minor tweaks, internal refactoring
- Minor (x.Y.0): New features, commands, CLI options (backwards compatible)
- Major (X.0.0): Breaking changes, removed/renamed commands

**Update CHANGELOG.md:**
```markdown
## [x.y.z] - YYYY-MM-DD

### Added
- New features

### Changed
- Modified functionality

### Fixed
- Bug fixes

### Documentation
- Doc improvements

---
[x.y.z]: https://github.com/dean0x/devflow/releases/tag/vx.y.z
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
git add package.json package-lock.json CHANGELOG.md && \
git commit -m "chore: bump version to x.y.z

- Update package.json to x.y.z
- Add CHANGELOG entry for vx.y.z
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
git tag -a vx.y.z -m "Version x.y.z - [Brief Description]

- Key change 1
- Key change 2
- Key change 3"

git push origin vx.y.z
```

```bash
gh release create vx.y.z \
  --title "vx.y.z - [Release Title]" \
  --notes "$(cat <<'EOF'
# DevFlow Kit vx.y.z

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
gh release view vx.y.z
npx devflow-kit@latest init
```

## Release Checklist

- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated
- [ ] All plugin.json files updated to match
- [ ] marketplace.json updated to match
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `npm pack --dry-run` looks clean (no .map files, no build scripts)
- [ ] Local testing passed
- [ ] Version bump committed and pushed
- [ ] Published to npm
- [ ] Git tag created and pushed
- [ ] GitHub release created
- [ ] npm shows correct version
- [ ] `npx devflow-kit init` works
