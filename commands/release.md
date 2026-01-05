---
description: Automated release workflow with version management and publishing
allowed-tools: Task, Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion
---

## Your Task

Orchestrate a complete release workflow using the release sub-agent. This command guides you through creating a professional release with version management, changelog generation, building, testing, and publishing.

**Workflow**: User input → Release agent automation → User confirmations at critical steps

### Step 1: Determine Release Type

Use AskUserQuestion to get the release type:

```
AskUserQuestion:
  question: "What type of release do you want to create?"
  header: "Release"
  options:
    - label: "Analyze first (Recommended)"
      description: "Analyze commits and get version bump recommendation before deciding"
    - label: "Patch (x.x.N)"
      description: "Bug fixes and maintenance only"
    - label: "Minor (x.N.0)"
      description: "New features, backwards compatible"
    - label: "Major (N.0.0)"
      description: "Breaking changes"
```

If user selects "Other" for custom version, they can specify an exact version like `2.0.0-beta.1`.

### Step 2: Launch Release Agent

Based on user's choice, launch the release sub-agent:

**If user chose "Analyze first"**:
```
Task tool with subagent_type="Release":
"Analyze the current repository state and recent commits. Execute through Step 3 (Determine New Version) and provide a recommendation for the version bump type. Show:
- Current version
- Commits since last release
- Breaking changes, features, and fixes detected
- Recommended version bump with reasoning

Stop and return results - do not proceed with the release yet."
```

After analysis, use AskUserQuestion to confirm:

```
AskUserQuestion:
  question: "Analysis complete. [SUMMARY]. Which version bump do you want?"
  header: "Version"
  options:
    - label: "[Recommended bump] (Recommended)"
      description: "Based on commit analysis"
    - label: "Patch"
      description: "Override to patch release"
    - label: "Minor"
      description: "Override to minor release"
    - label: "Major"
      description: "Override to major release"
```

**If user chose specific bump type (patch/minor/major) or custom version**:
```
Task tool with subagent_type="Release":
"Create a {bump_type} release. Follow the complete release workflow:
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze recent changes since last release
4. Calculate new version as {bump_type} bump
5. Generate changelog entry from commits
6. Update version files
7. Build project (if applicable)
8. Run tests (if applicable)

STOP before Step 8 (Commit Version Bump) and return:
- Current version → New version
- Generated changelog entry
- Files that will be modified
- Build/test results

Do not commit, push, or publish yet."
```

### Step 3: Review and Confirm

After the release agent returns preparation results, use AskUserQuestion:

```
AskUserQuestion:
  question: "Release prepared: [current] → [new]. Changelog and [N] files ready. Build: ✅ Tests: ✅. Proceed with commit and push?"
  header: "Confirm"
  options:
    - label: "Yes, commit and push"
      description: "Commit version bump and push to remote"
    - label: "No, abort release"
      description: "Discard all changes and cancel release"
```

If user confirms, proceed. If not, provide rollback:
```bash
git checkout -- {version_files} {changelog_file}
echo "Release aborted - changes discarded"
```

### Step 4: Complete Release (After Confirmation)

If user confirmed, continue with the release agent:

```
Task tool with subagent_type="Release":
"Continue the release process from Step 8 (Commit Version Bump):
8. Commit version bump
9. Push to remote

STOP before Step 10 (Publish) and return status.
Do not publish to registry yet."
```

### Step 5: Publish Confirmation

Before publishing to any package registry, use AskUserQuestion:

```
AskUserQuestion:
  question: "Pushed to remote. Publish [package]@[version] to [registry]? This is PERMANENT."
  header: "Publish"
  options:
    - label: "Yes, publish to registry"
      description: "Publish package publicly - cannot be undone"
    - label: "No, skip publishing"
      description: "Skip registry publish, still create git tag and GitHub release"
```

**If user confirms publish**:
```
Task tool with subagent_type="Release":
"Continue the release:
10. Publish package to registry
11. Create git tag
12. Create GitHub/GitLab release
13. Return final summary with all links"
```

**If user skips publish**:
```
Task tool with subagent_type="Release":
"Skip publishing. Continue with:
11. Create git tag
12. Create GitHub/GitLab release
13. Return final summary with all links

Note: Package was NOT published to registry."
```

### Step 6: Final Summary

Display the release agent's final summary:

```markdown
## Release Complete

| Step | Status |
|------|--------|
| Version bump | ✅ {old} → {new} |
| Changelog | ✅ Updated |
| Build | ✅ Passed |
| Tests | ✅ Passed |
| Commit | ✅ {commit_sha} |
| Push | ✅ origin/{branch} |
| Publish | ✅/⏭️ {registry_status} |
| Git tag | ✅ v{version} |
| Release | ✅ {release_url} |

### Links
- Package: {registry_url}
- Release: {github_release_url}
- Tag: {tag_url}

### Next Steps
1. Verify package in registry
2. Test installation: `npx {package}@{version}` or equivalent
3. Announce release to users/team
```

## Error Handling

If the release agent encounters an error at any step:

1. **Before commit**: Changes can be rolled back easily
   ```bash
   git checkout -- {version_files}
   ```

2. **After commit, before push**: Can reset
   ```bash
   git reset --hard HEAD~1
   ```

3. **After push, before publish**: Can remove tag and revert
   ```bash
   git tag -d {tag}
   git push origin :refs/tags/{tag}
   git revert HEAD
   ```

4. **After publish**: Cannot unpublish in most registries
   - npm: Can only deprecate, not unpublish after 24h
   - Document issue and create patch release

Always provide clear recovery instructions if something fails.

## Safety Features

- ✅ Interactive confirmation at each critical step using AskUserQuestion
- ✅ Verify clean working directory before starting
- ✅ Show preview of all changes before committing
- ✅ Require explicit confirmation before publishing
- ✅ Provide rollback instructions at each step
- ✅ Generate proper semantic versioning
- ✅ Run build and tests before releasing

## Quick Reference

```bash
/release   # Interactive release workflow with confirmations
```
