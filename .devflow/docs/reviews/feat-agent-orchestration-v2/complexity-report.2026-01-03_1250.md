# Complexity Audit Report

**Branch**: feat/agent-orchestration-v2
**Base**: main
**Date**: 2026-01-03 12:50:00
**Files Analyzed**: 77
**Lines Changed**: ~15,000+

---

## Issues in Your Changes (BLOCKING)

### HIGH

**[init.ts: Long Function - initCommand.action]** - `src/cli/commands/init.ts:169-750`

The `initCommand.action` async function spans approximately **580 lines**, far exceeding the recommended 50-line maximum. This creates several maintainability issues:

- **Cyclomatic Complexity**: Multiple nested if/else branches for scope handling, CLI detection, error handling, and file operations
- **Cognitive Load**: Requires tracking many variables across the entire function
- **Testability**: Difficult to unit test individual pieces of functionality

**Current Structure (simplified):**
```typescript
.action(async (options: InitOptions) => {
    // Line 169-178: Get package version
    // Line 180-241: Interactive scope prompt (~60 lines)
    // Line 243-262: Get installation paths
    // Line 264-391: Plugin installation via CLI or manual (~130 lines)
    // Line 393-466: Settings.json handling (~73 lines)
    // Line 468-483: CLAUDE.md handling
    // Line 485-689: .claudeignore content (~200 lines - embedded string)
    // Line 691-725: .gitignore handling
    // Line 727-742: .docs structure creation
    // Line 744-749: Render output
});
```

**Suggested Refactoring:**

Extract into focused functions:
```typescript
async function getPackageVersion(): Promise<string>
async function promptForScope(verbose: boolean): Promise<'user' | 'local'>
async function installViaCliOrManual(scope: string, claudeDir: string, devflowDir: string, verbose: boolean): Promise<boolean>
async function configureSettings(claudeDir: string, devflowDir: string, overrideSettings: boolean): Promise<void>
async function installClaudeMd(claudeDir: string, rootDir: string, verbose: boolean): Promise<void>
async function createClaudeignore(gitRoot: string, verbose: boolean): Promise<void>
async function updateGitignore(gitRoot: string, verbose: boolean): Promise<void>
async function createDocsStructure(skipDocs: boolean, verbose: boolean): Promise<void>
```

**Impact**: Hard to maintain, test, and debug. New contributors will struggle to understand the flow.

---

**[init.ts: Embedded .claudeignore Template]** - `src/cli/commands/init.ts:490-678`

A ~190-line string template is embedded directly in the function. This:

- Inflates function length artificially
- Makes the template hard to maintain
- Prevents reuse of the template

**Current:**
```typescript
const claudeignoreContent = `# DevFlow .claudeignore - Protects against sensitive files...
// ... 190 lines of template content ...
`;
```

**Suggested Fix:**

Move to external template file:
```typescript
// src/templates/claudeignore.template
const templatePath = path.join(rootDir, 'src', 'templates', 'claudeignore.template');
const claudeignoreContent = await fs.readFile(templatePath, 'utf-8');
```

**Impact**: MEDIUM - Reduces cognitive load and improves maintainability.

---

### MEDIUM

**[init.ts: Duplicated Root Directory Resolution]** - `src/cli/commands/init.ts:309,398`

The root directory is computed twice with identical logic:

**Lines 309 and 398:**
```typescript
const rootDir = path.resolve(__dirname, '../..');
```

**Suggested Fix:**

Compute once at the start of the function or pass as parameter:
```typescript
// Compute once at function start
const rootDir = path.resolve(__dirname, '../..');
// Use throughout
```

**Impact**: LOW - Minor code duplication, but indicates function is doing too much.

---

**[uninstall.ts: Hardcoded Skill List]** - `src/cli/commands/uninstall.ts:150-172`

A hardcoded list of 17 skills duplicates information that should come from a single source:

```typescript
const devflowSkills = [
  'devflow-core-patterns',
  'devflow-review-methodology',
  // ... 15 more skills
  'devflow-pattern-check',   // Deprecated
  'devflow-error-handling'   // Deprecated
];
```

**Suggested Fix:**

Extract to shared constant or derive from filesystem:
```typescript
// Option 1: Shared constant (src/constants/skills.ts)
import { DEVFLOW_SKILLS, DEPRECATED_SKILLS } from '../constants/skills.js';

// Option 2: Derive from filesystem
const skillsDir = path.join(rootDir, 'skills');
const devflowSkills = (await fs.readdir(skillsDir, { withFileTypes: true }))
  .filter(d => d.isDirectory() && d.name.startsWith('devflow-'))
  .map(d => d.name);
```

**Impact**: If skills are added/removed, must update both init.ts (DEVFLOW_SKILLS array on line 95-114) and uninstall.ts. Risk of drift.

---

**[statusline.sh: Moderate Nesting]** - `scripts/statusline.sh:48-76`

The context usage calculation has 3 levels of nesting:

```bash
if [ "$USAGE" != "null" ] && [ "$CONTEXT_SIZE" != "0" ]; then
    # ...calculations...
    if [ "$CURRENT_TOKENS" -gt 0 ]; then
        PERCENT=$((CURRENT_TOKENS * 100 / CONTEXT_SIZE))
        if [ "$PERCENT" -gt 80 ]; then
            # Red
        elif [ "$PERCENT" -gt 50 ]; then
            # Yellow
        else
            # Green
        fi
    fi
fi
```

**Impact**: LOW - Acceptable for shell scripts, but could be simplified with early returns.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**[init.ts: Inconsistent Error Handling]** - `src/cli/commands/init.ts`

Error handling is inconsistent across the file:

1. **Line 259-261**: Uses `process.exit(1)` with error message
2. **Line 388-390**: Uses `process.exit(1)` with error message
3. **Line 462-465**: Uses try/catch with verbose-only warning (silent failure)
4. **Line 478-482**: Uses try/catch with console.log warning
5. **Line 684-687**: Uses empty catch (silent failure)
6. **Line 721-724**: Uses verbose-only warning

**Recommendation**: Standardize error handling approach - either fail fast for all errors or provide consistent warning/recovery behavior.

---

## Pre-existing Issues (Not Blocking)

### LOW

**[General: No Unit Tests for CLI Commands]**

The `src/cli/commands/init.ts` and `src/cli/commands/uninstall.ts` files have no corresponding test files. Given the complexity of the init function, this is a risk.

**Recommendation**: Create `src/cli/commands/init.test.ts` and `src/cli/commands/uninstall.test.ts` with tests for:
- Scope detection logic
- CLI availability detection
- Settings override behavior
- Error handling paths

---

## Summary

**Your Changes:**
- HIGH: 2 (function length, embedded template)
- MEDIUM: 3 (duplicated root dir, hardcoded skills, inconsistent error handling)

**Code You Touched:**
- MEDIUM: 1 (inconsistent error handling patterns)

**Pre-existing:**
- LOW: 1 (missing tests)

**Complexity Score**: 6/10

The code is functional but has maintainability concerns. The main `initCommand.action` function is doing too much and should be decomposed into smaller, testable units.

**Merge Recommendation**: **REVIEW REQUIRED**

The code works but has maintainability debt that will compound over time. Consider:
1. Extracting the .claudeignore template to an external file (quick win)
2. Planning a follow-up PR to refactor init.ts into smaller functions

---

## Remediation Priority

**Fix before merge (recommended):**
1. Extract .claudeignore template to external file (reduces init.ts by ~190 lines)

**Fix while you're here (should fix):**
1. Consolidate duplicate `rootDir` computation
2. Consider extracting skill list to shared constant

**Future work:**
1. Decompose initCommand.action into smaller functions
2. Add unit tests for CLI commands
3. Standardize error handling patterns

---

## PR Comments: 1 review comment created (general PR comment with key findings)
