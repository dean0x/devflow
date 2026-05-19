# Documentation Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20

## Issues in Your Changes (BLOCKING)

### HIGH

**README "Uninstall Options" table missing --dry-run, --plugin, --verbose flags** - `README.md:252-257`
**Confidence**: 95%
- Problem: The `uninstall` command now accepts `--dry-run`, `--plugin <names>`, and `--verbose` flags (added across this branch and prior commits), but the README's "Uninstall Options" table only documents `--scope` and `--keep-docs`. Users consulting the README will not discover these capabilities.
- Fix: Update the Uninstall Options table in README.md:
```markdown
### Uninstall Options

| Option | Description |
|--------|-------------|
| `--scope <user\|local>` | Uninstall scope (default: auto-detect) |
| `--plugin <names>` | Remove specific plugin(s), comma-separated (e.g., `implement,code-review`) |
| `--keep-docs` | Preserve .docs/ directory |
| `--dry-run` | Show what would be removed without deleting anything |
| `--verbose` | Show detailed uninstall output |
```

### MEDIUM

**CHANGELOG [Unreleased] section is empty** - `CHANGELOG.md:8-9`
**Confidence**: 85%
- Problem: This branch introduces three user-facing changes (ambient skill loading fix, classification/loading test helpers, uninstall --dry-run flag) but the [Unreleased] section of the CHANGELOG is empty. The project follows Keep a Changelog format and conventional commits. All three commits (`fix(ambient)`, `test(ambient)`, `feat(uninstall)`) warrant CHANGELOG entries before merging.
- Fix: Add entries to the [Unreleased] section:
```markdown
## [Unreleased]

### Added
- **Uninstall `--dry-run` flag** — preview what would be removed without deleting anything

### Fixed
- **Ambient skill loading** — removed `allowed-tools` restriction from `ambient-router` skill so loaded skills no longer block tool access in main session
- **Ambient hook preamble** — added explicit instruction for GUIDED/ORCHESTRATED tiers to load skills via Skill tool
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CLAUDE.md scope description slightly out of date** - `CLAUDE.md:130`
**Confidence**: 82%
- Problem: The updated line about `ambient-router` having no `allowed-tools` is accurate. However, the same bullet also says skills default to `allowed-tools: Read, Grep, Glob` without mentioning the `ambient-router` is the only skill with NO `allowed-tools` frontmatter at all (i.e., the field is entirely absent, not set to empty). This distinction matters because an empty `allowed-tools` and an absent `allowed-tools` could have different semantics depending on Claude Code's skill loader. The current phrasing "has no `allowed-tools`" is slightly ambiguous between "field is empty" and "field is missing."
- Fix: Minor wording tweak for clarity:
```
...and `ambient-router` omits `allowed-tools` entirely (unrestricted, as the main-session orchestrator)
```

**Integration test known-limitation comment references removed prerequisite** - `tests/integration/ambient-activation.test.ts:28`
**Confidence**: 80%
- Problem: The updated block comment at line 13-31 removed the old prerequisite "Ambient mode enabled (`devflow ambient --enable`)" which is correct. However, the comment still says "These tests require: `claude` CLI installed and authenticated, DevFlow skills installed (`devflow init`)" but does not mention that the ambient preamble is now injected via `--append-system-prompt` (which is the whole reason the ambient enable prerequisite was removed). The implementation detail is documented in the helper's JSDoc, but the test file's own header should note this for developers running the integration suite.
- Fix: Add a brief note:
```typescript
 * These tests require:
 * - `claude` CLI installed and authenticated
 * - DevFlow skills installed (`devflow init`)
 * - (Ambient mode NOT required — preamble is injected via --append-system-prompt)
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`formatDryRunPlan` JSDoc does not document `extras` parameter semantics** - `src/cli/commands/uninstall.ts:54-56`
**Confidence**: 80%
- Problem: The `formatDryRunPlan` function has a JSDoc that says "Pure function -- no I/O, fully testable" but does not document what `extras` represents (additional cleanup items beyond plugin assets such as `.docs/`, `.memory/`, hooks). The `assets` parameter types are self-documenting via the TypeScript signature, but `extras` is a bare `string[]` whose semantics are only clear from reading the call site.
- Fix:
```typescript
/**
 * Format a dry-run plan showing what would be removed.
 * Pure function — no I/O, fully testable.
 * @param assets - Skills, agents, and commands to remove
 * @param extras - Additional cleanup items (e.g., '.docs/', 'hooks in settings.json')
 */
```

### LOW

**README uninstall scope default says "user" but code auto-detects** - `README.md:256`
**Confidence**: 85%
- Problem: The README says `--scope <user|local>` with description "Uninstall scope (default: user)" but the actual code auto-detects installed scopes and prompts if both are found. The default is not "user" -- it's "auto-detect all."
- Fix: Change description to "Uninstall from specific scope only (default: auto-detect all)" to match the Commander help text.

## Suggestions (Lower Confidence)

- **Ambient SKILL.md NOTE block could reference CLAUDE.md** - `shared/skills/ambient-router/SKILL.md:91-93` (Confidence: 65%) -- The new NOTE about allowed-tools metadata not restricting tool access is a design decision worth cross-referencing. The CLAUDE.md key conventions section now documents this, but the SKILL.md note doesn't point readers there for the broader context.

- **Test helper AMBIENT_PREAMBLE duplicates hook script** - `tests/integration/helpers.ts:18-19` (Confidence: 70%) -- The preamble string is duplicated between the hook script (`scripts/hooks/ambient-prompt:42`) and the test helper. If the preamble text changes in one place, the other may drift. Consider extracting to a shared constant or adding a comment noting the duplication.

- **`extractLoadedSkills` may include trailing period** - `tests/integration/helpers.ts:92-95` (Confidence: 65%) -- The regex `LOADING_PATTERN` matches `loading:\s*[\w-]+(?:,\s*[\w-]+)*` which stops before a trailing period (`.`). However, the `extractLoadedSkills` function splits on comma and trims, which could include edge cases if the model outputs slightly different formatting. Test cases cover the happy path but not trailing punctuation variations.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The primary gap is the README's Uninstall Options table, which is missing three flags users need to know about (one added in this branch, two added previously). The empty CHANGELOG [Unreleased] section should also be populated before merge. The code-level documentation (JSDoc, inline comments, test headers) is generally good -- the new integration test known-limitation block comment is particularly well-written and honest about the `-p` mode limitation.
