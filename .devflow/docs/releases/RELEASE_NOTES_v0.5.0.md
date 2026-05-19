# Release 0.5.0

**Release Date:** 2025-10-24
**Previous Version:** 0.4.0
**Project Type:** nodejs

---

## Release Summary

- **Version bump:** 0.4.0 → 0.5.0
- **Commits included:** 7
- **Release type:** minor
- **Tag:** v0.5.0

---

## Changes

### Added

#### Installation Scope Support
- **Two-tier installation strategy** - Choose between user-wide and project-specific installation
  - **User scope** (default): Install to `~/.claude/` for all projects
  - **Local scope**: Install to `<git-root>/.claude/` for current project only
  - Interactive prompt with clear descriptions when `--scope` flag not provided
  - CLI flag: `devflow init --scope <user|local>`
  - Automatic .gitignore updates for local scope (excludes `.claude/` and `.devflow/`)
  - Perfect for team projects where DevFlow should be project-specific

#### Smart Uninstall with Scope Detection
- **Auto-detection of installed scopes** - Intelligently finds and removes DevFlow installations
  - Automatically detects which scopes have DevFlow installed (user and/or local)
  - Default behavior: Remove from all detected scopes
  - Manual override: `--scope <user|local>` to target specific scope
  - Clear feedback showing which scopes are being uninstalled
  - Graceful handling when no installation found

### Changed

#### Code Quality Improvements
- **Extracted shared utilities** - Eliminated code duplication between init and uninstall commands
  - Created `src/cli/utils/paths.ts` for path resolution functions
  - Created `src/cli/utils/git.ts` for git repository operations
  - Reduced duplication by ~65 lines
  - Single source of truth for path and git logic

#### Performance Optimizations
- **Eliminated redundant git detection** - Cache git root result for reuse
  - Previously called `git rev-parse` twice during installation
  - Now cached once and reused throughout installation process
  - Faster installation, especially in large repositories

### Fixed

#### CI/CD Compatibility
- **TTY detection for interactive prompts** - Prevents hanging in non-interactive environments
  - Detects when running in CI/CD pipelines, Docker containers, or automated scripts
  - Falls back to default scope (user) when no TTY available
  - Clear messaging when non-interactive environment detected
  - Explicit instructions for CI/CD usage: `devflow init --scope <user|local>`

#### Security Hardening
- **Environment variable path validation** - Prevents malicious path overrides
  - Validates `CLAUDE_CODE_DIR` and `DEVFLOW_DIR` are absolute paths
  - Warns when paths point outside user's home directory
  - Prevents path traversal attacks via environment variables
  - Security-first approach to custom path configuration

### Documentation
- **Installation Scopes section** in README with clear use cases
- **Updated CLI commands table** with scope options for init and uninstall
- **Migration guide** for existing users (scope defaults to user for compatibility)
- **.gitignore patterns** documented for local scope installations

---

## Commit History

```
7a65c1b chore: bump version to 0.5.0
361faf2 refactor: address code review issues - extract utils, fix race conditions, async operations
00ac404 refactor: simplify settings/CLAUDE.md installation - never override
89a43d9 refactor: remove "both" option from uninstall, auto-detect is default
97ce681 feat: add scope support to uninstall command
8544908 refactor: rename "global" scope to "user" for clarity
f596767 feat: add installation scope support (global vs local)
```

---

## Build & Test Results

- **Build:** Successful
- **Tests:** N/A (no test suite)

---

## Distribution

**Published to:**
- npm: https://www.npmjs.com/package/devflow-kit/v/0.5.0

**Git Repository:**
- Release: https://github.com/dean0x/devflow/releases/tag/v0.5.0
- Commits: https://github.com/dean0x/devflow/compare/v0.4.0...v0.5.0
- Changelog: https://github.com/dean0x/devflow/blob/main/CHANGELOG.md

---

## Verification Steps

1. **Registry Check:** Verify package appears in npm registry
   ```bash
   npm view devflow-kit@0.5.0
   ```

2. **Fresh Install:** Test installation in a clean environment
   ```bash
   # User scope
   npx devflow-kit@0.5.0 init

   # Local scope
   npx devflow-kit@0.5.0 init --scope local
   ```

3. **Smoke Tests:** Test basic functionality
   ```bash
   # Verify commands are available
   claude /code-review
   claude /devlog
   claude /commit

   # Test uninstall detection
   devflow uninstall
   ```

4. **Documentation:** Update any version-specific documentation
   - README references 0.5.0
   - CHANGELOG properly formatted
   - ROADMAP updated with completed features

---

## Key Features of v0.5.0

### 1. Flexible Installation Scopes
Users can now choose between:
- **User scope**: One installation for all projects (default)
- **Local scope**: Project-specific installation for teams

This makes DevFlow suitable for:
- Solo developers wanting global tools
- Teams wanting version-controlled DevFlow config
- Projects with specific DevFlow requirements

### 2. Intelligent Uninstall
The uninstall command now:
- Auto-detects which scopes have DevFlow installed
- Removes from all detected scopes by default
- Provides clear feedback on operations
- Supports manual scope targeting

### 3. Improved Code Quality
Significant refactoring work:
- Extracted shared utilities (65+ lines of duplication removed)
- Created reusable path resolution module
- Created reusable git operations module
- Better maintainability and testability

### 4. Enhanced Security
- Environment variable validation
- Path traversal attack prevention
- Absolute path requirements
- Security warnings for suspicious paths

### 5. Better CI/CD Support
- TTY detection for non-interactive environments
- Automatic fallback to user scope
- Clear instructions for automation
- No hanging in pipelines

---

## Breaking Changes

None. This release is fully backward compatible with v0.4.0.

Default scope is `user` to maintain existing behavior for current users.

---

## Migration Guide

### From v0.4.0

No action required. Existing installations continue working unchanged.

**Optional: Convert to local scope**
If you want project-specific DevFlow:
```bash
devflow uninstall --scope user
devflow init --scope local
git add .claude/ .devflow/ .gitignore
git commit -m "Add DevFlow local scope installation"
```

---

## Known Issues

None reported at release time.

---

## Next Steps

### For Users
1. Test new scope options with your workflow
2. Consider local scope for team projects
3. Report any issues on GitHub
4. Share feedback on the new features

### For Contributors
1. Review extracted utilities in `src/cli/utils/`
2. Consider additional scope-related improvements
3. Add test coverage for new functionality
4. Document advanced scope usage patterns

---

*Release notes generated by DevFlow release agent*
