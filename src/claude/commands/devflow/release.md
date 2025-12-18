---
description: Automated release workflow with version management and publishing
---

Create a new release with version management, changelog, and publishing.

## Usage

```
/release           # Interactive - asks for release type
/release patch     # Bug fixes (0.1.2 → 0.1.3)
/release minor     # New features (0.1.2 → 0.2.0)
/release major     # Breaking changes (0.1.2 → 1.0.0)
/release analyze   # Recommend version bump based on commits
```

---

## Your Task

Invoke the `Release` agent:

```
Task(subagent_type="Release"):

"Create a ${RELEASE_TYPE:-interactive} release.

If release type not specified, analyze commits and recommend version bump.

Execute the release workflow:
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze commits since last release
4. Calculate new version (or use specified type)
5. Generate changelog entry
6. Update version files
7. Build and test
8. [CHECKPOINT] Show preview, get user confirmation
9. Commit version bump
10. Push to remote
11. [CHECKPOINT] Confirm before publishing (permanent/public)
12. Publish to registry (if applicable)
13. Create git tag
14. Create GitHub release

Safety requirements:
- Show all changes before committing
- Require explicit confirmation before publishing
- Provide rollback instructions at each step

Report back with:
- Version: old → new
- Changelog entry
- Published locations (npm, GitHub release, etc.)
- Verification steps"
```

If user specifies "analyze", stop after showing recommendation and wait for decision.
