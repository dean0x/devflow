# DevFlow Kit v0.3.3 Release Notes

**Release Date**: 2025-10-19
**Release Type**: Minor
**Git Tag**: v0.3.3
**npm Version**: 0.3.3

## Overview

This release introduces comprehensive release automation capabilities and establishes DevFlow as a complete release management toolkit for any programming language or ecosystem.

## Highlights

### Universal Release Automation Agent

**Multi-Language Support**
- Automatic detection and handling for Node.js, Rust, Python, Go, Ruby, PHP, Java (Maven/Gradle), Swift, and generic projects
- Project-specific version file management
- Ecosystem-appropriate build and test commands
- Registry-specific publication workflows

**Intelligent Versioning**
- Analyzes commit history to suggest appropriate version bumps (major/minor/patch)
- Detects breaking changes from commit messages
- Identifies new features and bug fixes
- Categorizes commits by conventional commit types

**Automated Changelog**
- Generates structured changelog entries from git commit messages
- Follows Keep a Changelog format
- Organizes changes by type (Added, Changed, Fixed)
- Preserves existing changelog entries

**Safe Workflows**
- Comprehensive pre-publish verification
- Build testing before publication
- Test execution validation
- Rollback instructions for failures

### Professional Release Management

**Quality Gates**
- Enforces clean working directory before starting
- Validates successful builds before proceeding
- Requires passing tests for publication
- Verifies git tag creation and pushing

**Platform Integration**
- Native support for GitHub release creation via `gh` CLI
- GitLab release creation via `glab` CLI
- Automatic release note generation
- Links to commits, comparisons, and changelogs

**Package Publishing**
- npm (Node.js)
- crates.io (Rust)
- PyPI (Python)
- RubyGems (Ruby)
- Packagist (PHP)
- Maven Central (Java)
- And more...

**Error Recovery**
- Clear rollback instructions for each failure point
- Step-by-step recovery guidance
- Safe abort procedures
- Version file restoration

### Developer Experience Improvements

**Project Detection**
- Automatically identifies project type from manifest files
- Locates version files (package.json, Cargo.toml, etc.)
- Detects existing changelog files
- Discovers build and test commands

**Version Bump Suggestions**
- Analyzes breaking changes for major bumps
- Identifies new features for minor bumps
- Recognizes bug fixes for patch bumps
- Provides clear rationale for suggestions

**Change Analysis**
- Counts commits since last release
- Categorizes changes by type
- Highlights significant modifications
- Warns about missing changes

**Release Verification**
- Post-publish verification checklist
- Registry publication confirmation
- Tag and commit verification
- Next steps guidance

## Changes

### Added

**Commands**
- New `/release` command for guided release automation
- Interactive version selection (patch/minor/major/custom)
- Automated changelog generation
- Pre-publish verification workflow

**Agent**
- Dedicated release automation specialist agent
- Universal release workflow supporting 10+ ecosystems
- Automatic project type detection
- Intelligent semantic versioning
- Quality gates and safety checks
- Platform-specific release creation
- Comprehensive error recovery

**Documentation**
- Release automation workflow (13 stages)
- Project detection and configuration guide
- Safety rules and quality gates
- Error recovery procedures
- Multi-language support matrix

### Changed

**Architecture**
- Enhanced agent architecture documentation
- Improved error handling patterns
- Clarified token optimization strategies
- Refined separation of concerns

**Error Handling**
- More specific error messages
- Context-aware failure recovery
- Progressive rollback instructions
- Safer default behaviors

### Documentation

**Enhancements**
- Comprehensive release workflow documentation
- Step-by-step release process guide
- Multi-language ecosystem support
- Safety and quality gate documentation
- Error recovery playbooks

## Breaking Changes

None. This release is fully backward compatible with v0.3.2.

## Upgrade Instructions

### From v0.3.x

No changes required. Simply update to the latest version:

```bash
npx devflow-kit@latest init
```

### New Installation

```bash
npx devflow-kit init
```

## Usage Examples

### Basic Release

```bash
/release
```

The agent will:
1. Detect your project type
2. Analyze changes since last release
3. Suggest version bump
4. Generate changelog
5. Run tests and build
6. Guide publication
7. Create tags and releases

### Custom Version

When prompted, select "custom" and specify exact version:
```
New version will be: 1.2.3
```

### Patch Release

For bug fixes only:
```
Version bump type: patch
Current: 0.3.2 -> New: 0.3.3
```

## Testing

All release automation workflows have been tested with:
- Node.js projects (package.json)
- Multi-language project detection
- Version bump calculations
- Changelog generation
- Git operations
- Platform release creation

## Known Issues

None identified in this release.

## Migration Guide

No migration required. All existing functionality preserved.

## Links

- **npm Package**: https://www.npmjs.com/package/devflow-kit
- **GitHub Release**: https://github.com/dean0x/devflow/releases/tag/v0.3.3
- **Git Tag**: https://github.com/dean0x/devflow/tree/v0.3.3
- **Changelog**: https://github.com/dean0x/devflow/blob/main/CHANGELOG.md
- **Previous Release**: https://github.com/dean0x/devflow/releases/tag/v0.3.2
- **Documentation**: https://github.com/dean0x/devflow#readme

## Contributors

- Dean (dean0x) - Release automation implementation
- Claude Code - Development assistance and agent design

## Release Checklist

- [x] Version bumped in package.json (0.3.2 -> 0.3.3)
- [x] CHANGELOG.md updated with all changes
- [x] Code built successfully
- [x] Local testing completed
- [x] Version bump committed and pushed
- [x] Published to npm successfully
- [x] Git tag v0.3.3 created and pushed
- [x] GitHub release created with detailed notes
- [x] npm shows correct version
- [x] Release notes saved to .docs/releases/
- [x] Documentation verified and aligned

## Next Steps

1. Monitor npm download statistics
2. Gather user feedback on release automation
3. Consider additional language ecosystem support
4. Enhance changelog generation with PR links
5. Add release announcement automation

---

**Full Changelog**: https://github.com/dean0x/devflow/compare/v0.3.2...v0.3.3
