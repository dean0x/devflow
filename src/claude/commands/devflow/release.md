---
description: Automated release workflow with version management and publishing
allowed-tools: Task, Bash, Read, Write, Edit, Grep, Glob
---

## Your Task

Orchestrate a complete release workflow using the release sub-agent. This command guides you through creating a professional release with version management, changelog generation, building, testing, and publishing.

**Workflow**: User input → Release agent automation → User confirmations at critical steps

### Step 1: Determine Release Type

First, ask the user what type of release they want to create:

```bash
echo "🚀 DEVFLOW RELEASE AUTOMATION"
echo ""
echo "This will guide you through creating a new release."
echo ""
```

Present options to the user:

```
What type of release do you want to create?

1. **patch** - Bug fixes and maintenance (0.1.2 → 0.1.3)
2. **minor** - New features, backwards compatible (0.1.2 → 0.2.0)
3. **major** - Breaking changes (0.1.2 → 1.0.0)
4. **custom** - Specify exact version (e.g., 2.0.0-beta.1)
5. **analyze** - Analyze changes and get recommendation first

Please specify the release type (patch/minor/major/custom/analyze):
```

### Step 2: Launch Release Agent

Once the user provides input, launch the release sub-agent with the appropriate prompt:

**If user chose "analyze"**:
```
Invoke the release sub-agent with this prompt:

"Analyze the current repository state and recent commits. Execute through Step 3 (Determine New Version) and provide a recommendation for the version bump type. Show:
- Current version
- Commits since last release
- Breaking changes, features, and fixes detected
- Recommended version bump with reasoning

Stop and wait for user decision before proceeding with the release."
```

**If user chose "patch", "minor", or "major"**:
```
Invoke the release sub-agent with this prompt:

"Create a {bump_type} release. Follow the complete release workflow:
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze recent changes since last release
4. Calculate new version as {bump_type} bump
5. Generate changelog entry from commits
6. Update version files
7. Build project (if applicable)
8. Run tests (if applicable)

STOP before Step 8 (Commit Version Bump) and show me:
- Current version → New version
- Generated changelog entry
- Files that will be modified
- Build/test results

Wait for my confirmation before proceeding with commit, push, publish, and tagging."
```

**If user chose "custom"**:
```
Ask user: "Please specify the exact version number (e.g., 2.0.0-beta.1):"

Then invoke the release sub-agent with this prompt:

"Create a release with custom version {specified_version}. Follow the complete release workflow:
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze recent changes since last release
4. Use the specified version: {specified_version}
5. Generate changelog entry from commits
6. Update version files
7. Build project (if applicable)
8. Run tests (if applicable)

STOP before Step 8 (Commit Version Bump) and show me:
- Current version → New version
- Generated changelog entry
- Files that will be modified
- Build/test results

Wait for my confirmation before proceeding with commit, push, publish, and tagging."
```

### Step 3: Review and Confirm

After the release agent completes the preparation phase and stops, present the summary to the user:

```
📋 RELEASE READY FOR REVIEW

Current Version: {current_version}
New Version: {new_version}
Project Type: {project_type}

📝 Changelog Entry:
{generated_changelog}

📄 Files to be Modified:
- {version_file}
- {changelog_file}

✅ Build Status: {build_result}
✅ Test Status: {test_result}

---

The release agent will now:
1. Commit version bump
2. Push to remote
3. Publish package (if applicable)
4. Create git tag
5. Create GitHub/GitLab release (if available)

⚠️  WARNING: Steps 3-5 are PERMANENT and PUBLIC

Do you want to proceed with the release? (yes/no):
```

### Step 4: Complete Release (After Confirmation)

If user confirms, continue with the release agent:

```
Invoke the release sub-agent again with this prompt:

"Continue the release process from Step 8 (Commit Version Bump):
8. Commit version bump
9. Push to remote
10. Publish package (if applicable) - STOP and ask for confirmation before publishing
11. Create git tag
12. Create GitHub/GitLab release
13. Provide final summary

Execute these steps sequentially. Before Step 10 (publishing to package registry), STOP and explicitly ask for confirmation as this is permanent and public."
```

### Step 5: Publish Confirmation

When the agent reaches the publish step, ask for explicit confirmation:

```
⚠️  FINAL CONFIRMATION REQUIRED

The package is ready to be published to the public registry.

Project: {project_name}
Version: {new_version}
Registry: {registry_name}
Command: {publish_command}

This action is PERMANENT and IRREVERSIBLE.

Do you want to publish to the public registry? (yes/no):
```

### Step 6: Final Summary

After the release is complete, the agent will provide a final summary. Display it to the user and provide next steps:

```
The release agent will show:
- Release summary with all completed steps
- Links to package registry
- Links to GitHub/GitLab release
- Links to tag and commits
- Verification steps for the user

Next steps for you:
1. Verify package appears in registry
2. Test installation in fresh environment
3. Announce release to users/team
4. Update documentation if needed
```

## Error Handling

If the release agent encounters an error at any step:

1. **Before commit**: Changes can be rolled back easily
   ```bash
   git checkout {version_files}
   ```

2. **After commit, before push**: Can amend or reset
   ```bash
   git reset --hard HEAD~1
   ```

3. **After push, before publish**: Can remove tag and revert
   ```bash
   git tag -d {tag}
   git push origin :{tag}
   git revert HEAD
   ```

4. **After publish**: Cannot unpublish in most registries
   - npm: Can only deprecate, not unpublish after 24h
   - Document issue and create patch release

Always provide clear recovery instructions if something fails.

## Safety Features

- ✅ Verify clean working directory before starting
- ✅ Show preview of all changes before committing
- ✅ Require explicit confirmation before publishing
- ✅ Provide rollback instructions at each step
- ✅ Stop and ask before any permanent/public action
- ✅ Generate proper semantic versioning
- ✅ Run build and tests before releasing

## Quick Reference

```bash
# Standard releases
/release   # Interactive - asks for release type

# With specific type (if supported in future)
/release patch
/release minor
/release major

# Analyze first
/release analyze   # Show recommendations without releasing
```

## Notes

- The release sub-agent handles all the technical details
- This command provides the user interaction layer
- Critical steps require explicit user confirmation
- All actions are logged and can be audited
- Works with any programming language/ecosystem
