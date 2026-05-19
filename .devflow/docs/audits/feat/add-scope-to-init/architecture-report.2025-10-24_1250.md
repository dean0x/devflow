# Architecture Audit Report

**Branch**: feat/add-scope-to-init
**Date**: 2025-10-24
**Time**: 12:50
**Auditor**: DevFlow Architecture Agent

---

## Executive Summary

This branch introduces a **scope abstraction** pattern for installation paths, enabling both user-wide and project-local installations. The refactoring demonstrates **strong architectural improvements** in function decomposition, code reusability, and separation of concerns. However, **critical code duplication** remains between `init.ts` and `uninstall.ts`, violating DRY principles and creating maintenance burden.

**Overall Architecture Score: 7.5/10**

**Strengths:**
- Excellent scope abstraction design with clear separation of concerns
- Strong security validation in `getGitRoot()` function
- Improved function decomposition and single responsibility
- Removal of complex --force flag logic (80+ lines eliminated)
- Consistent path resolution pattern

**Weaknesses:**
- CRITICAL: Shared utility functions duplicated across both files
- Missing shared module for common path resolution logic
- Inconsistent function availability (init has `getInstallationPaths`, uninstall has `isDevFlowInstalled`)
- Future maintainability risk if scope logic diverges

---

## Critical Issues

### CRITICAL-001: Code Duplication - Shared Utility Functions

**Severity**: CRITICAL
**Component**: src/cli/commands/init.ts, src/cli/commands/uninstall.ts
**Pattern Violated**: DRY (Don't Repeat Yourself), Single Source of Truth

**Issue**:
Four utility functions are **identically duplicated** across both files:
1. `getHomeDirectory()` - Lines 13-23 (init), Lines 11-17 (uninstall)
2. `getClaudeDirectory()` - Lines 29-34 (init), Lines 23-28 (uninstall)
3. `getDevFlowDirectory()` - Lines 40-45 (init), Lines 34-39 (uninstall)
4. `getGitRoot()` - Lines 51-74 (init), Lines 45-66 (uninstall)

**Impact**:
- **Maintenance Burden**: Bug fixes must be applied in two places
- **Inconsistency Risk**: Functions can drift out of sync
- **Testing Overhead**: Same logic tested multiple times
- **Code Smell**: Violates fundamental architectural principle

**Evidence**:
```typescript
// init.ts lines 51-74
function getGitRoot(): string | null {
  try {
    const gitRootRaw = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'] // Isolate stderr
    }).trim();

    // Validate git root path (security: prevent injection)
    if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
      return null;
    }

    // Validate it's an absolute path
    const gitRoot = path.resolve(gitRootRaw);
    if (!path.isAbsolute(gitRoot)) {
      return null;
    }

    return gitRoot;
  } catch {
    return null;
  }
}

// uninstall.ts lines 45-66 - IDENTICAL IMPLEMENTATION
function getGitRoot(): string | null {
  try {
    const gitRootRaw = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
      return null;
    }

    const gitRoot = path.resolve(gitRootRaw);
    if (!path.isAbsolute(gitRoot)) {
      return null;
    }

    return gitRoot;
  } catch {
    return null;
  }
}
```

**Recommended Fix**:
Create shared utility module at `src/cli/utils/paths.ts`:

```typescript
// src/cli/utils/paths.ts
import { homedir } from 'os';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Get home directory with proper fallback and validation
 * Priority: process.env.HOME > os.homedir()
 */
export function getHomeDirectory(): string {
  const home = process.env.HOME || homedir();
  if (!home) {
    throw new Error('Unable to determine home directory. Set HOME environment variable.');
  }
  return home;
}

/**
 * Get Claude Code directory with environment variable override support
 * Priority: CLAUDE_CODE_DIR env var > ~/.claude
 */
export function getClaudeDirectory(): string {
  if (process.env.CLAUDE_CODE_DIR) {
    return process.env.CLAUDE_CODE_DIR;
  }
  return path.join(getHomeDirectory(), '.claude');
}

/**
 * Get DevFlow directory with environment variable override support
 * Priority: DEVFLOW_DIR env var > ~/.devflow
 */
export function getDevFlowDirectory(): string {
  if (process.env.DEVFLOW_DIR) {
    return process.env.DEVFLOW_DIR;
  }
  return path.join(getHomeDirectory(), '.devflow');
}

/**
 * Get git repository root directory
 * Returns null if not in a git repository
 */
export function getGitRoot(): string | null {
  try {
    const gitRootRaw = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Validate git root path (security: prevent injection)
    if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
      return null;
    }

    // Validate it's an absolute path
    const gitRoot = path.resolve(gitRootRaw);
    if (!path.isAbsolute(gitRoot)) {
      return null;
    }

    return gitRoot;
  } catch {
    return null;
  }
}

/**
 * Get installation paths based on scope
 * @param scope - 'user' or 'local'
 * @returns Object with claudeDir and devflowDir
 */
export function getInstallationPaths(scope: 'user' | 'local'): { claudeDir: string; devflowDir: string } {
  if (scope === 'user') {
    return {
      claudeDir: getClaudeDirectory(),
      devflowDir: getDevFlowDirectory()
    };
  } else {
    // Local scope - install to git repository root
    const gitRoot = getGitRoot();
    if (!gitRoot) {
      throw new Error('Local scope requires a git repository. Run "git init" first or use --scope user');
    }
    return {
      claudeDir: path.join(gitRoot, '.claude'),
      devflowDir: path.join(gitRoot, '.devflow')
    };
  }
}

/**
 * Check if DevFlow is installed at the given paths
 */
export async function isDevFlowInstalled(claudeDir: string): Promise<boolean> {
  try {
    const { access } = await import('fs/promises');
    await access(path.join(claudeDir, 'commands', 'devflow'));
    return true;
  } catch {
    return false;
  }
}
```

Then update both files:

```typescript
// src/cli/commands/init.ts
import { 
  getHomeDirectory, 
  getClaudeDirectory, 
  getDevFlowDirectory, 
  getGitRoot,
  getInstallationPaths 
} from '../utils/paths.js';

// Remove duplicated functions, use imports
```

```typescript
// src/cli/commands/uninstall.ts
import { 
  getHomeDirectory, 
  getClaudeDirectory, 
  getDevFlowDirectory, 
  getGitRoot,
  getInstallationPaths,
  isDevFlowInstalled 
} from '../utils/paths.js';

// Remove duplicated functions, use imports
```

**Migration Strategy**:
1. Create `src/cli/utils/paths.ts` with all shared functions
2. Add unit tests for path utility functions
3. Update `init.ts` to import from shared module
4. Update `uninstall.ts` to import from shared module
5. Remove duplicated function definitions
6. Verify all tests pass
7. Update build configuration if needed

**Estimated Effort**: 2-4 hours (including tests)

---

## High Priority Issues

### HIGH-001: Inconsistent Function Availability

**Severity**: HIGH
**Component**: src/cli/commands/init.ts, src/cli/commands/uninstall.ts
**Pattern**: Single Responsibility, Interface Segregation

**Issue**:
- `getInstallationPaths()` exists only in `init.ts` (lines 81-98)
- `isDevFlowInstalled()` exists only in `uninstall.ts` (lines 71-78)

Both functions are **general-purpose utilities** that could be useful in both contexts, but are artificially isolated.

**Impact**:
- **Code Reusability**: Cannot reuse `getInstallationPaths` in uninstall command
- **Design Inconsistency**: Related functions scattered across files
- **Future Limitation**: Adding features requires copying logic

**Current Implementation**:

```typescript
// init.ts - has getInstallationPaths but NOT isDevFlowInstalled
function getInstallationPaths(scope: 'user' | 'local'): { claudeDir: string; devflowDir: string } {
  // ... implementation
}

// uninstall.ts - has isDevFlowInstalled but NOT getInstallationPaths
async function isDevFlowInstalled(claudeDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(claudeDir, 'commands', 'devflow'));
    return true;
  } catch {
    return false;
  }
}
```

**Recommended Fix**:
Move both functions to shared `paths.ts` module (see CRITICAL-001 fix). This ensures:
- Both commands can use both utilities
- Single source of truth for scope resolution
- Easier testing and maintenance

---

### HIGH-002: Scope Logic Embedded in Multiple Places

**Severity**: HIGH
**Component**: src/cli/commands/init.ts, src/cli/commands/uninstall.ts
**Pattern**: Open/Closed Principle violation

**Issue**:
Scope-to-path resolution logic exists in multiple forms:

1. **init.ts**: `getInstallationPaths()` function (lines 81-98)
2. **uninstall.ts**: Inline scope resolution in for-loop (lines 129-142)

The uninstall command **manually reconstructs** path logic instead of reusing the abstraction:

```typescript
// uninstall.ts lines 129-142
if (scope === 'user') {
  claudeDir = getClaudeDirectory();
  devflowScriptsDir = getDevFlowDirectory();
  console.log('📍 Uninstalling user scope (~/.claude/)');
} else {
  const gitRoot = getGitRoot();
  if (!gitRoot) {
    console.log('⚠️  Cannot uninstall local scope: not in a git repository\n');
    continue;
  }
  claudeDir = path.join(gitRoot, '.claude');
  devflowScriptsDir = path.join(gitRoot, '.devflow');
  console.log('📍 Uninstalling local scope (git-root/.claude/)');
}
```

**Impact**:
- **Duplication**: Scope logic duplicated instead of calling shared function
- **Drift Risk**: If init's `getInstallationPaths` changes, uninstall won't match
- **Testability**: Must test scope resolution in multiple places

**Recommended Fix**:
Uninstall should use `getInstallationPaths()`:

```typescript
// uninstall.ts - BETTER APPROACH
for (const scope of scopesToUninstall) {
  try {
    const { claudeDir, devflowDir } = getInstallationPaths(scope);
    console.log(`📍 Uninstalling ${scope} scope`);
    console.log(`   Claude dir: ${claudeDir}`);
    console.log(`   DevFlow dir: ${devflowDir}`);
    
    // ... rest of uninstall logic
  } catch (error) {
    console.log(`⚠️  Cannot uninstall ${scope} scope: ${error.message}`);
    continue;
  }
}
```

This ensures **single source of truth** for scope-to-path mapping.

---

### HIGH-003: Git Root Resolution Duplicated for .claudeignore

**Severity**: HIGH
**Component**: src/cli/commands/init.ts (lines 308-328)
**Pattern**: DRY violation, function misuse

**Issue**:
After implementing `getGitRoot()` function, init command **re-implements identical git root resolution** for `.claudeignore` creation:

```typescript
// Lines 308-328 - DUPLICATE of getGitRoot() logic
try {
  // Find git repository root with validation
  const gitRootRaw = execSync('git rev-parse --show-toplevel', {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'] // Isolate stderr
  }).trim();

  // Validate git root path (security: prevent injection)
  if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
    throw new Error('Invalid git root path returned');
  }

  // Validate it's an absolute path
  const gitRoot = path.resolve(gitRootRaw);
  if (!path.isAbsolute(gitRoot)) {
    throw new Error('Git root must be an absolute path');
  }

  const claudeignorePath = path.join(gitRoot, '.claudeignore');
  // ...
}
```

**Why This Happened**:
This code predates the `getGitRoot()` function but was **not refactored** when the shared function was introduced.

**Impact**:
- **Code Duplication**: 20 lines of duplicated logic
- **Security Risk**: If validation bug found, must fix in two places
- **Maintenance**: Changes to git root resolution require multiple edits

**Recommended Fix**:

```typescript
// Lines 305-332 - REFACTORED
let claudeignoreCreated = false;
const gitRoot = getGitRoot();

if (gitRoot) {
  const claudeignorePath = path.join(gitRoot, '.claudeignore');

  // Check if .claudeignore already exists
  try {
    await fs.access(claudeignorePath);
  } catch {
    // Create comprehensive .claudeignore
    const claudeignoreContent = `# DevFlow .claudeignore...`;
    await fs.writeFile(claudeignorePath, claudeignoreContent, 'utf-8');
    claudeignoreCreated = true;
  }
}

if (claudeignoreCreated) {
  console.log('✓ .claudeignore created');
}
```

**Lines Saved**: 17 lines (from 25 to 8)

---

## Medium Priority Issues

### MEDIUM-001: Interactive Prompt Logic Complexity

**Severity**: MEDIUM
**Component**: src/cli/commands/init.ts (lines 139-168)
**Pattern**: Single Responsibility, Function Decomposition

**Issue**:
Scope selection logic mixes I/O, validation, and control flow in a 30-line block within the main command handler.

**Current Implementation**:
```typescript
// Lines 139-168
if (options.scope) {
  scope = options.scope.toLowerCase() as 'user' | 'local';
} else {
  // Interactive prompt for scope
  console.log('📦 Installation Scope:\n');
  console.log('  user  - Install for all projects (user-wide)');
  console.log('            └─ ~/.claude/ and ~/.devflow/');
  console.log('  local - Install for current project only');
  console.log('            └─ <git-root>/.claude/ and <git-root>/.devflow/\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('Choose scope (user/local) [user]: ', (input) => {
      rl.close();
      resolve(input.trim().toLowerCase() || 'user');
    });
  });

  if (answer === 'local' || answer === 'l') {
    scope = 'local';
  } else if (answer === 'user' || answer === 'u' || answer === '') {
    scope = 'user';
  } else {
    console.error('❌ Invalid scope. Use "user" or "local"\n');
    process.exit(1);
  }
  console.log();
}
```

**Impact**:
- **Readability**: Main command handler cluttered with UI logic
- **Testability**: Difficult to unit test scope selection independently
- **Reusability**: Cannot reuse prompt logic if needed elsewhere

**Recommended Refactor**:

```typescript
// Extract to separate function
async function promptForScope(): Promise<'user' | 'local'> {
  console.log('📦 Installation Scope:\n');
  console.log('  user  - Install for all projects (user-wide)');
  console.log('            └─ ~/.claude/ and ~/.devflow/');
  console.log('  local - Install for current project only');
  console.log('            └─ <git-root>/.claude/ and <git-root>/.devflow/\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('Choose scope (user/local) [user]: ', (input) => {
      rl.close();
      resolve(input.trim().toLowerCase() || 'user');
    });
  });

  console.log();

  // Parse answer
  if (answer === 'local' || answer === 'l') {
    return 'local';
  } else if (answer === 'user' || answer === 'u' || answer === '') {
    return 'user';
  } else {
    throw new Error('Invalid scope. Use "user" or "local"');
  }
}

// In command handler:
try {
  const scope = options.scope 
    ? (options.scope.toLowerCase() as 'user' | 'local')
    : await promptForScope();
  // ... continue
} catch (error) {
  console.error('❌', error.message);
  process.exit(1);
}
```

**Benefits**:
- Cleaner command handler
- Testable prompt logic
- Consistent error handling
- Reusable if uninstall needs confirmation

---

### MEDIUM-002: Uninstall Auto-Detection Logic Could Use getInstallationPaths

**Severity**: MEDIUM
**Component**: src/cli/commands/uninstall.ts (lines 88-120)
**Pattern**: Function Reuse, Abstraction Consistency

**Issue**:
Auto-detection manually constructs paths instead of leveraging `getInstallationPaths()`:

```typescript
// Lines 93-106
const userClaudeDir = getClaudeDirectory();
const gitRoot = getGitRoot();

if (await isDevFlowInstalled(userClaudeDir)) {
  scopesToUninstall.push('user');
}

if (gitRoot) {
  const localClaudeDir = path.join(gitRoot, '.claude');
  if (await isDevFlowInstalled(localClaudeDir)) {
    scopesToUninstall.push('local');
  }
}
```

**Recommended Approach**:

```typescript
// Auto-detect installed scopes using shared abstraction
const scopesToCheck: ('user' | 'local')[] = ['user'];

// Only check local scope if in a git repo
if (getGitRoot()) {
  scopesToCheck.push('local');
}

for (const scope of scopesToCheck) {
  try {
    const { claudeDir } = getInstallationPaths(scope);
    if (await isDevFlowInstalled(claudeDir)) {
      scopesToUninstall.push(scope);
    }
  } catch {
    // Skip scopes that can't be resolved
  }
}
```

**Benefits**:
- Uses `getInstallationPaths()` consistently
- If scope logic changes, auto-detect stays in sync
- Cleaner, more maintainable code

---

### MEDIUM-003: Missing Type Safety for Scope Parameter

**Severity**: MEDIUM
**Component**: Both files
**Pattern**: Type Safety

**Issue**:
Scope validation relies on regex and runtime checks instead of TypeScript discriminated unions:

```typescript
// Current approach
.option('--scope <type>', '...', /^(user|local)$/i)

// Then later:
scope = options.scope.toLowerCase() as 'user' | 'local';
```

**Problem**:
- Type assertion (`as 'user' | 'local'`) bypasses type checking
- Regex validation is separate from type definition
- Runtime errors instead of compile-time safety

**Recommended Improvement**:

```typescript
// Define scope type
type InstallScope = 'user' | 'local';

// Validation function with type guard
function validateScope(input: string): InstallScope {
  const normalized = input.toLowerCase();
  if (normalized === 'user' || normalized === 'local') {
    return normalized;
  }
  throw new Error(`Invalid scope: ${input}. Use "user" or "local"`);
}

// In command:
.option('--scope <type>', 'Installation scope: user (user-wide) or local (project-only)')
.action(async (options) => {
  let scope: InstallScope = 'user';
  
  if (options.scope) {
    try {
      scope = validateScope(options.scope);
    } catch (error) {
      console.error('❌', error.message);
      process.exit(1);
    }
  }
  // ... rest of logic
});
```

**Benefits**:
- No type assertions needed
- Validation logic reusable
- Better error messages
- Type-safe scope handling

---

## Low Priority Issues

### LOW-001: Inconsistent Error Handling Between Files

**Severity**: LOW
**Component**: Both files
**Pattern**: Error Handling Consistency

**Issue**:
`init.ts` uses try-catch with structured error handling:

```typescript
try {
  const paths = getInstallationPaths(scope);
  claudeDir = paths.claudeDir;
  devflowDir = paths.devflowDir;
  // ...
} catch (error) {
  console.error('❌ Path configuration error:', error instanceof Error ? error.message : error);
  process.exit(1);
}
```

`uninstall.ts` inline-handles errors in for-loop:

```typescript
if (!gitRoot) {
  console.log('⚠️  Cannot uninstall local scope: not in a git repository\n');
  continue;
}
```

**Recommendation**: Standardize on consistent error handling pattern across both files.

---

### LOW-002: Console Logging Could Be Abstracted

**Severity**: LOW
**Component**: Both files
**Pattern**: Separation of Concerns

**Issue**:
Console output scattered throughout command logic makes testing difficult and violates separation of concerns.

**Long-term Recommendation**:
Consider logger abstraction:

```typescript
// utils/logger.ts
export const logger = {
  success: (msg: string) => console.log(`✓ ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  warning: (msg: string) => console.log(`⚠️  ${msg}`),
  info: (msg: string) => console.log(`ℹ️  ${msg}`)
};
```

**Benefits**:
- Testability (can mock logger)
- Consistent formatting
- Future flexibility (log to file, etc.)

---

### LOW-003: Magic Strings for Directory Names

**Severity**: LOW
**Component**: Both files
**Pattern**: Constants and Configuration

**Issue**:
Directory names hardcoded throughout:

```typescript
path.join(claudeDir, 'commands', 'devflow')
path.join(claudeDir, 'agents', 'devflow')
path.join(claudeDir, 'skills', 'devflow')
```

**Recommendation**:
Define constants:

```typescript
// utils/constants.ts
export const DEVFLOW_NAMESPACE = 'devflow';
export const DEVFLOW_DIRS = {
  commands: 'commands',
  agents: 'agents',
  skills: 'skills',
  scripts: 'scripts'
} as const;
```

---

## Positive Architecture Patterns

### EXCELLENT: Scope Abstraction Design

**Component**: getInstallationPaths function
**Pattern**: Strategy Pattern, Dependency Inversion

The `getInstallationPaths()` function is an **excellent abstraction**:

```typescript
function getInstallationPaths(scope: 'user' | 'local'): { claudeDir: string; devflowDir: string } {
  if (scope === 'user') {
    return {
      claudeDir: getClaudeDirectory(),
      devflowDir: getDevFlowDirectory()
    };
  } else {
    const gitRoot = getGitRoot();
    if (!gitRoot) {
      throw new Error('Local scope requires a git repository. Run "git init" first or use --scope user');
    }
    return {
      claudeDir: path.join(gitRoot, '.claude'),
      devflowDir: path.join(gitRoot, '.devflow')
    };
  }
}
```

**Why This Is Excellent**:
1. **Single Responsibility**: One function, one purpose (scope → paths)
2. **Open/Closed**: Easy to add new scopes without changing callers
3. **Clear Error Handling**: Throws descriptive errors with actionable messages
4. **Type Safety**: Returns structured object, not loose strings
5. **Validation**: Checks git repo requirement for local scope

**Impact**: This pattern enables the entire feature cleanly.

---

### EXCELLENT: Security-First Git Root Validation

**Component**: getGitRoot function
**Pattern**: Input Validation, Defense in Depth

The `getGitRoot()` function demonstrates **excellent security practices**:

```typescript
// Validate git root path (security: prevent injection)
if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
  return null;
}

// Validate it's an absolute path
const gitRoot = path.resolve(gitRootRaw);
if (!path.isAbsolute(gitRoot)) {
  return null;
}
```

**Security Measures**:
1. **Command Injection Prevention**: Checks for shell metacharacters
2. **Path Validation**: Ensures absolute path
3. **Null Safety**: Returns null instead of throwing
4. **Stderr Isolation**: `stdio: ['pipe', 'pipe', 'pipe']`

**Defensive Design**: Even if git command is compromised, validation layers prevent exploitation.

---

### EXCELLENT: Removal of --force Flag Complexity

**Component**: init.ts (removed code)
**Pattern**: YAGNI (You Aren't Gonna Need It)

The branch **removed 80+ lines** of complex --force flag handling:

**Before** (main branch):
- `--force` flag with confirmation prompts
- `-y, --yes` auto-approve flag
- Complex backup logic
- Managed settings files (settings.json.backup, managed-settings.json)
- Interactive confirmation for overrides

**After** (feature branch):
- Simple: never override existing files
- Write to `.devflow` suffix if conflicts
- User manually merges if desired

**Why This Is Better**:
1. **Simpler**: Removed entire failure mode (destructive overwrites)
2. **Safer**: Never destroys user configuration
3. **Clearer**: User decides when to merge, not tool
4. **Less Code**: 80 fewer lines to maintain and test

This is **excellent architectural judgment** - removing complexity that creates risk.

---

### GOOD: Consistent Directory Structure Pattern

**Component**: Both files
**Pattern**: Data Structure Consistency

Both files use consistent directory structure pattern:

```typescript
const devflowDirectories = [
  {
    target: path.join(claudeDir, 'commands', 'devflow'),
    source: path.join(claudeSourceDir, 'commands', 'devflow'),
    name: 'commands'
  },
  // ... more entries
];
```

**Benefits**:
- Loop-based operations
- Easy to add new directory types
- Consistent naming and structure

---

## Architecture Metrics

### Code Duplication Analysis

| Category | Lines Duplicated | Files Affected | Severity |
|----------|------------------|----------------|----------|
| Path utilities | ~65 lines | init.ts, uninstall.ts | CRITICAL |
| Git root resolution (claudeignore) | ~20 lines | init.ts | HIGH |
| Scope path logic | ~15 lines | uninstall.ts | HIGH |
| **Total** | **~100 lines** | **2 files** | **CRITICAL** |

### Function Decomposition Quality

| Metric | Score | Notes |
|--------|-------|-------|
| Single Responsibility | 8/10 | Most functions focused, some command handlers too large |
| Function Size | 7/10 | Some functions exceed 30 lines (prompt logic) |
| Abstraction Level | 9/10 | Good separation between high-level and low-level operations |
| Naming Clarity | 9/10 | Excellent descriptive names (getInstallationPaths, getGitRoot) |

### Reusability Score

| Component | Reusability | Blocker |
|-----------|-------------|---------|
| getGitRoot() | 0% (duplicated) | Not in shared module |
| getInstallationPaths() | 0% (init only) | Not in shared module |
| isDevFlowInstalled() | 0% (uninstall only) | Not in shared module |
| getHomeDirectory() | 0% (duplicated) | Not in shared module |

**Current Reusability**: 0/10
**With Shared Module**: 10/10

---

## Refactoring Roadmap

### Phase 1: Critical Fixes (Immediate - Before Merge)

**Priority**: CRITICAL
**Estimated Effort**: 3-5 hours

1. **Create shared paths module** (CRITICAL-001)
   - Create `src/cli/utils/paths.ts`
   - Move all duplicated utilities
   - Export getInstallationPaths and isDevFlowInstalled
   - Add unit tests

2. **Refactor init.ts** (HIGH-003)
   - Import from shared module
   - Replace duplicate git root resolution for .claudeignore
   - Remove local function definitions

3. **Refactor uninstall.ts** (HIGH-002)
   - Import from shared module
   - Use getInstallationPaths() in uninstall loop
   - Remove local function definitions

4. **Verify integration tests pass**
   - Test user scope install/uninstall
   - Test local scope install/uninstall
   - Test auto-detection in uninstall

### Phase 2: Quality Improvements (Post-Merge)

**Priority**: HIGH-MEDIUM
**Estimated Effort**: 2-3 hours

1. **Extract prompt logic** (MEDIUM-001)
   - Create `promptForScope()` function
   - Add unit tests

2. **Add type safety** (MEDIUM-003)
   - Create `validateScope()` type guard
   - Remove type assertions

3. **Improve auto-detection** (MEDIUM-002)
   - Use getInstallationPaths() in detection loop

### Phase 3: Polish (Future)

**Priority**: LOW
**Estimated Effort**: 2-4 hours

1. **Standardize error handling** (LOW-001)
2. **Add logger abstraction** (LOW-002)
3. **Extract constants** (LOW-003)

---

## Testing Recommendations

### Unit Tests Needed

```typescript
// tests/utils/paths.test.ts
describe('Path Utilities', () => {
  describe('getGitRoot', () => {
    it('returns null when not in git repo');
    it('validates against command injection');
    it('ensures absolute paths');
    it('handles spaces in path names');
  });

  describe('getInstallationPaths', () => {
    it('returns user paths for user scope');
    it('returns local paths for local scope');
    it('throws when local scope used outside git repo');
  });

  describe('isDevFlowInstalled', () => {
    it('returns true when devflow commands exist');
    it('returns false when devflow commands missing');
  });
});
```

### Integration Tests Needed

```typescript
describe('Init Command', () => {
  it('installs to user scope when --scope user');
  it('installs to local scope when --scope local');
  it('prompts for scope when no flag provided');
  it('fails local install when not in git repo');
});

describe('Uninstall Command', () => {
  it('auto-detects user scope installation');
  it('auto-detects local scope installation');
  it('uninstalls from specific scope when --scope provided');
  it('handles multiple installations gracefully');
});
```

---

## Conclusion

This branch introduces a **valuable architectural pattern** (scope abstraction) but leaves **critical technical debt** (code duplication). The scope design is excellent and should be preserved, but shared utilities MUST be extracted before merge.

### Merge Recommendation

**APPROVED WITH CONDITIONS**

**Conditions for Merge:**
1. MUST extract shared utilities to `src/cli/utils/paths.ts` (CRITICAL-001)
2. MUST refactor .claudeignore creation to use getGitRoot() (HIGH-003)
3. SHOULD use getInstallationPaths() in uninstall (HIGH-002)
4. SHOULD add unit tests for path utilities

**Estimated Remediation Time**: 4-6 hours

**Post-Merge TODO:**
- Add comprehensive unit tests
- Extract prompt logic (MEDIUM-001)
- Improve type safety (MEDIUM-003)
- Consider logger abstraction (LOW-002)

---

## Architecture Score Breakdown

| Category | Score | Weight | Weighted Score |
|----------|-------|--------|----------------|
| Design Patterns | 9/10 | 25% | 2.25 |
| Code Organization | 5/10 | 25% | 1.25 |
| Function Decomposition | 8/10 | 20% | 1.60 |
| Reusability | 3/10 | 15% | 0.45 |
| Security | 10/10 | 10% | 1.00 |
| Testability | 6/10 | 5% | 0.30 |
| **Overall** | **7.5/10** | | **6.85/10** |

**Scoring Rationale:**
- **Design Patterns (9/10)**: Excellent scope abstraction, security-first validation
- **Code Organization (5/10)**: CRITICAL duplication penalty
- **Function Decomposition (8/10)**: Good separation, minor issues with prompt logic
- **Reusability (3/10)**: Utilities not shared, cannot be reused
- **Security (10/10)**: Excellent git root validation and input sanitization
- **Testability (6/10)**: Testable after extraction, currently difficult

---

**Report Generated**: 2025-10-24 12:50:00
**Architect**: DevFlow Architecture Agent (Claude Sonnet 4.5)
**Branch**: feat/add-scope-to-init
**Comparison**: main branch (cd06d00)
