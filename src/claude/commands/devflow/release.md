---
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
description: Comprehensive release preparation with versioning and changelog
---

## Your task

Prepare a production release with proper versioning, changelog generation, and safety checks.

### Step 1: Pre-Release Checks

```bash
echo "=== PRE-RELEASE CHECKLIST ==="

# Ensure on main/master branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
    echo "⚠️ Not on main/master branch. Switch to production branch first."
    exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet HEAD; then
    echo "❌ Uncommitted changes detected. Commit or stash before release."
    exit 1
fi

# Pull latest changes
git pull origin $CURRENT_BRANCH

# Run test suite
echo -e "\n=== RUNNING TESTS ==="
npm test || { echo "❌ Tests failed. Fix before release."; exit 1; }

echo "✅ Pre-release checks passed"
```

### Step 2: Determine Version Bump

```bash
# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | cut -d'"' -f4)
echo "Current version: $CURRENT_VERSION"

# Analyze commits since last tag to suggest version bump
echo -e "\n=== COMMITS SINCE LAST RELEASE ==="
git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD")..HEAD --oneline

echo -e "\nSuggested version bump:"
echo "  - PATCH (x.x.X): Bug fixes only"
echo "  - MINOR (x.X.0): New features, backward compatible"
echo "  - MAJOR (X.0.0): Breaking changes"
```

### Step 3: Generate Changelog

Create changelog from recent commits:

```markdown
# Changelog - Version {NEW_VERSION}

## Release Date: {DATE}

### 🚀 Features
{Features from commits with feat: prefix}
- {Feature description} (#PR)

### 🐛 Bug Fixes
{Fixes from commits with fix: prefix}
- {Fix description} (#PR)

### 🔧 Improvements
{Refactoring and improvements}
- {Improvement description}

### 📝 Documentation
{Documentation updates}
- {Doc update description}

### ⚠️ Breaking Changes
{Any breaking changes - only for major version}
- {Breaking change description}

### Contributors
{List of contributors for this release}

---
[Full Changelog](link-to-compare)
```

Save to `CHANGELOG.md` (append to existing).

### Step 4: Update Version

```bash
# Update package.json version (for Node.js projects)
npm version {patch|minor|major} --no-git-tag-version

# Or update version file for other languages
# Python: update __version__ in __init__.py
# Go: update version constant
# Ruby: update version.rb
```

### Step 5: Security & Dependency Audit

Launch security audit before release:
- Use `audit-security` sub-agent
- Check for vulnerable dependencies
- Ensure no sensitive data in code

```bash
# Node.js security audit
npm audit || echo "⚠️ Review security vulnerabilities"

# Check for secrets
grep -r "api[_-]key\|password\|secret\|token" --include="*.js" --include="*.env*" . || echo "✅ No obvious secrets"
```

### Step 6: Build & Validate

```bash
echo "=== BUILD RELEASE ==="

# Clean and build
rm -rf dist/ build/ 2>/dev/null
npm run build || echo "ℹ️ No build step"

# Validate build output
if [ -d "dist" ] || [ -d "build" ]; then
    echo "✅ Build successful"
    ls -la dist/ 2>/dev/null || ls -la build/ 2>/dev/null
else
    echo "ℹ️ No build artifacts"
fi
```

### Step 7: Create Release Commit

```bash
# Stage all release changes
git add -A

# Create release commit
git commit -m "chore: release v{NEW_VERSION}

- {Summary of major changes}
- See CHANGELOG.md for full details"

# Create annotated tag
git tag -a "v{NEW_VERSION}" -m "Release version {NEW_VERSION}

{Brief summary of release highlights}"

echo "✅ Release commit and tag created"
```

### Step 8: Release Checklist

```markdown
## Release v{NEW_VERSION} - Final Checklist

### Pre-Push
- [ ] All tests passing
- [ ] Version bumped appropriately
- [ ] CHANGELOG.md updated
- [ ] No security vulnerabilities
- [ ] Documentation updated
- [ ] Build successful

### Push & Publish
```bash
# Push commit and tags
git push origin main
git push origin --tags

# Publish package (if applicable)
npm publish  # for npm packages
# or deploy to production
```

### Post-Release
- [ ] Create GitHub release from tag
- [ ] Announce to team/users
- [ ] Update project boards
- [ ] Monitor for issues
- [ ] Plan next release

### Rollback Plan
If issues found:
```bash
git revert {release-commit}
git tag -d v{NEW_VERSION}
git push origin --delete v{NEW_VERSION}
```
```

Save release notes to `.docs/releases/v{NEW_VERSION}.md`