# Test Quality Audit Report

**Branch**: feat/add-scope-to-init
**Date**: 2025-10-24
**Time**: 12:50:00
**Auditor**: DevFlow Test Quality Agent

---

## Executive Summary

This branch introduces **298 lines** of new functionality for scope-based installation (user vs local), git root detection, and auto-detection logic for uninstallation. **CRITICAL FINDING**: The codebase has **ZERO test coverage** - no test files, no test framework, no CI validation. This represents a **BLOCKING ISSUE** for production deployment.

**Test Coverage**: 0/10 (No tests exist)
**Risk Level**: CRITICAL
**Recommendation**: **BLOCK MERGE** - Tests are mandatory for CLI tooling with filesystem operations and user data management

---

## Critical Issues

### 1. ZERO TEST COVERAGE - BLOCKING

**Severity**: CRITICAL
**Impact**: Production reliability unknown, regression risk extreme
**Files**: All (no test files exist)

**Problem**:
- No test files: `**/*.{test,spec}.{ts,js}` returns zero results
- No test framework configured (package.json: `"test": "echo \"No tests yet\" && exit 0"`)
- No CI/CD validation of new functionality
- 298 lines of critical path code (installation/uninstallation) completely untested

**Risk Scenarios**:
1. **Data Loss**: `getGitRoot()` injection validation untested - could corrupt user directories
2. **Installation Failures**: Scope selection logic untested - could install to wrong locations
3. **Silent Failures**: Error handling paths never validated
4. **Platform Issues**: Path resolution untested on Windows/Linux/macOS
5. **Edge Cases**: Git repository edge cases (nested repos, submodules, worktrees) unknown

**Recommended Action**:
```bash
# IMMEDIATE: Add test framework
npm install --save-dev jest @types/jest ts-jest

# IMMEDIATE: Configure jest
npx ts-jest config:init

# IMMEDIATE: Add test scripts to package.json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

---

### 2. Git Root Detection - No Edge Case Validation

**Severity**: CRITICAL
**Impact**: Security injection risk, path traversal vulnerability
**Files**: 
- `/workspace/devflow/src/cli/commands/init.ts` (lines 51-74)
- `/workspace/devflow/src/cli/commands/uninstall.ts` (lines 45-66)

**Problem**:
`getGitRoot()` duplicated in two files with security-critical validation but **ZERO tests**.

**Untested Edge Cases**:
```typescript
// Edge case 1: Nested git repositories
// Parent: /home/user/project/.git
// Child:  /home/user/project/subdir/.git
// Which one gets returned?

// Edge case 2: Git worktrees
// Main:     /home/user/project/.git
// Worktree: /home/user/worktree/.git
// Does detection work correctly?

// Edge case 3: Bare repositories
// git clone --bare repo.git
// Does getGitRoot() handle bare repos?

// Edge case 4: Corrupted .git directory
// .git exists but is not a valid repository
// Does execSync throw? Is error handled?

// Edge case 5: Permission denied
// .git exists but process lacks read permissions
// Does it fail gracefully?

// Edge case 6: Symlinked .git
// .git -> /some/other/location
// Does path.resolve() handle this correctly?

// Edge case 7: Git submodules
// Submodule uses .git file pointing to parent .git/modules/
// What does --show-toplevel return?
```

**Security Validation Gaps**:
```typescript
// Line 60: Injection prevention - UNTESTED
if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
  return null;
}

// Missing test: What about other injection vectors?
// - Backticks: `command`
// - Pipes: |, ||
// - Redirects: >, >>, <
// - Command substitution: $()
// - Null bytes: \0
// - Unicode escapes
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/git-detection.test.ts
import { getGitRoot } from '../init';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('getGitRoot', () => {
  describe('Valid repositories', () => {
    it('should return absolute path for valid git repo', () => {
      // Create temp git repo
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
      execSync('git init', { cwd: tempDir });
      
      const result = getGitRoot();
      expect(result).toBe(tempDir);
      expect(path.isAbsolute(result!)).toBe(true);
      
      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });

    it('should work from subdirectory', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
      execSync('git init', { cwd: tempDir });
      const subdir = path.join(tempDir, 'a', 'b', 'c');
      fs.mkdirSync(subdir, { recursive: true });
      
      // Change to subdir
      const originalCwd = process.cwd();
      process.chdir(subdir);
      
      const result = getGitRoot();
      expect(result).toBe(tempDir);
      
      // Restore
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe('Invalid scenarios', () => {
    it('should return null when not in git repo', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      
      const result = getGitRoot();
      expect(result).toBeNull();
      
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true });
    });

    it('should reject paths with newlines', () => {
      // Mock execSync to return malicious path
      jest.spyOn(require('child_process'), 'execSync')
        .mockReturnValue('/tmp/safe\n/tmp/malicious\n');
      
      const result = getGitRoot();
      expect(result).toBeNull();
    });

    it('should reject paths with semicolons', () => {
      jest.spyOn(require('child_process'), 'execSync')
        .mockReturnValue('/tmp/safe;rm -rf /');
      
      const result = getGitRoot();
      expect(result).toBeNull();
    });

    it('should reject paths with command chaining', () => {
      jest.spyOn(require('child_process'), 'execSync')
        .mockReturnValue('/tmp/safe && evil-command');
      
      const result = getGitRoot();
      expect(result).toBeNull();
    });

    it('should reject relative paths', () => {
      jest.spyOn(require('child_process'), 'execSync')
        .mockReturnValue('../../../etc/passwd');
      
      const result = getGitRoot();
      expect(result).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle nested git repositories', () => {
      // Test parent vs child repo detection
    });

    it('should handle git worktrees', () => {
      // Test worktree detection
    });

    it('should handle git submodules', () => {
      // Test submodule path resolution
    });

    it('should handle bare repositories', () => {
      // Test bare repo edge case
    });

    it('should handle symlinked .git directories', () => {
      // Test symlink resolution
    });

    it('should handle permission denied errors', () => {
      // Test permission error handling
    });
  });
});
```

---

### 3. Installation Path Logic - No Validation

**Severity**: CRITICAL
**Impact**: Data loss, wrong installation location, user confusion
**Files**: `/workspace/devflow/src/cli/commands/init.ts` (lines 81-98)

**Problem**:
`getInstallationPaths()` determines where DevFlow installs files - **NO TESTS** for this critical decision logic.

**Untested Scenarios**:
```typescript
// Scenario 1: User scope in non-git directory
// Expected: Install to ~/.claude/
// Risk: What if HOME is not set?

// Scenario 2: Local scope in non-git directory
// Expected: Throw error
// Risk: Error message quality? User confused?

// Scenario 3: Local scope in git repo
// Expected: Install to <git-root>/.claude/
// Risk: What if git root is /? (bad git config)

// Scenario 4: Nested git repos (local scope)
// Expected: Which repo gets the installation?
// Risk: User expects parent, gets child?

// Scenario 5: Environment variable overrides
// CLAUDE_CODE_DIR=/custom/path
// DEVFLOW_DIR=/custom/path
// Expected: Respect env vars
// Risk: Path validation? Security?

// Scenario 6: Path collision
// User scope already installed, now local scope
// Expected: Both can coexist
// Risk: Conflicts? Precedence?
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/installation-paths.test.ts
describe('getInstallationPaths', () => {
  describe('User scope', () => {
    it('should return home directory paths', () => {
      const paths = getInstallationPaths('user');
      expect(paths.claudeDir).toContain('.claude');
      expect(paths.devflowDir).toContain('.devflow');
      expect(path.isAbsolute(paths.claudeDir)).toBe(true);
    });

    it('should respect CLAUDE_CODE_DIR env var', () => {
      process.env.CLAUDE_CODE_DIR = '/custom/claude';
      const paths = getInstallationPaths('user');
      expect(paths.claudeDir).toBe('/custom/claude');
      delete process.env.CLAUDE_CODE_DIR;
    });

    it('should respect DEVFLOW_DIR env var', () => {
      process.env.DEVFLOW_DIR = '/custom/devflow';
      const paths = getInstallationPaths('user');
      expect(paths.devflowDir).toBe('/custom/devflow');
      delete process.env.DEVFLOW_DIR;
    });

    it('should work when HOME is not set', () => {
      const originalHome = process.env.HOME;
      delete process.env.HOME;
      
      // Should fall back to os.homedir()
      expect(() => getInstallationPaths('user')).not.toThrow();
      
      process.env.HOME = originalHome;
    });
  });

  describe('Local scope', () => {
    it('should return git root paths', () => {
      // Setup git repo
      const tempDir = setupGitRepo();
      
      const paths = getInstallationPaths('local');
      expect(paths.claudeDir).toBe(path.join(tempDir, '.claude'));
      expect(paths.devflowDir).toBe(path.join(tempDir, '.devflow'));
    });

    it('should throw error when not in git repo', () => {
      const tempDir = setupNonGitDir();
      
      expect(() => getInstallationPaths('local')).toThrow(
        'Local scope requires a git repository'
      );
    });

    it('should use nearest git repo in nested repos', () => {
      // Create parent and child repos
      const parentRepo = setupGitRepo();
      const childRepo = path.join(parentRepo, 'child');
      fs.mkdirSync(childRepo);
      execSync('git init', { cwd: childRepo });
      
      process.chdir(childRepo);
      const paths = getInstallationPaths('local');
      
      // Should use child repo, not parent
      expect(paths.claudeDir).toBe(path.join(childRepo, '.claude'));
    });
  });

  describe('Path security', () => {
    it('should reject relative paths in env vars', () => {
      process.env.CLAUDE_CODE_DIR = '../../../etc';
      
      // Should either reject or resolve to absolute
      const paths = getInstallationPaths('user');
      expect(path.isAbsolute(paths.claudeDir)).toBe(true);
    });

    it('should handle paths with special characters', () => {
      process.env.CLAUDE_CODE_DIR = '/tmp/test dir/with spaces';
      
      expect(() => getInstallationPaths('user')).not.toThrow();
    });
  });
});
```

---

### 4. Interactive Prompts - No User Input Testing

**Severity**: HIGH
**Impact**: UX broken, edge cases crash, invalid input handling
**Files**: `/workspace/devflow/src/cli/commands/init.ts` (lines 103-168)

**Problem**:
Interactive scope selection with `readline` - **NO TESTS** for user interaction logic.

**Untested User Inputs**:
```typescript
// Valid inputs
'user'     -> scope = 'user'
'local'    -> scope = 'local'  
'u'        -> scope = 'user'
'l'        -> scope = 'local'
''         -> scope = 'user' (default)

// Edge cases - UNTESTED
'USER'     -> Should work? (case insensitive)
' user '   -> Should trim?
'users'    -> Invalid? Error message quality?
'loca'     -> Typo handling?
'123'      -> How does it fail?
'\n'       -> Empty line handling?
'user\n\n' -> Multiple newlines?
EOF        -> User presses Ctrl+D?
Ctrl+C     -> Interrupt handling?

// Non-interactive mode
--scope user   -> Works
--scope local  -> Works
--scope USER   -> Should work? (regex is case insensitive)
--scope invalid -> How does it fail?
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/interactive-prompts.test.ts
describe('Scope selection prompts', () => {
  let mockStdin: any;
  
  beforeEach(() => {
    mockStdin = new MockStdin();
  });

  describe('Valid inputs', () => {
    it('should accept "user"', async () => {
      mockStdin.send('user\n');
      const scope = await promptForScope();
      expect(scope).toBe('user');
    });

    it('should accept "local"', async () => {
      mockStdin.send('local\n');
      const scope = await promptForScope();
      expect(scope).toBe('local');
    });

    it('should accept "u" shorthand', async () => {
      mockStdin.send('u\n');
      const scope = await promptForScope();
      expect(scope).toBe('user');
    });

    it('should accept "l" shorthand', async () => {
      mockStdin.send('l\n');
      const scope = await promptForScope();
      expect(scope).toBe('local');
    });

    it('should default to user on empty input', async () => {
      mockStdin.send('\n');
      const scope = await promptForScope();
      expect(scope).toBe('user');
    });

    it('should be case insensitive', async () => {
      mockStdin.send('USER\n');
      const scope = await promptForScope();
      expect(scope).toBe('user');
    });

    it('should trim whitespace', async () => {
      mockStdin.send('  local  \n');
      const scope = await promptForScope();
      expect(scope).toBe('local');
    });
  });

  describe('Invalid inputs', () => {
    it('should reject invalid scope with clear error', async () => {
      mockStdin.send('invalid\n');
      
      await expect(promptForScope()).rejects.toThrow(
        'Invalid scope. Use "user" or "local"'
      );
    });

    it('should exit with code 1 on invalid input', async () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
      mockStdin.send('badvalue\n');
      
      await promptForScope();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Non-interactive mode', () => {
    it('should accept --scope user', async () => {
      const options = { scope: 'user' };
      const scope = getScopeFromOptions(options);
      expect(scope).toBe('user');
    });

    it('should accept --scope local', async () => {
      const options = { scope: 'local' };
      const scope = getScopeFromOptions(options);
      expect(scope).toBe('local');
    });

    it('should be case insensitive in CLI arg', async () => {
      const options = { scope: 'USER' };
      const scope = getScopeFromOptions(options);
      expect(scope).toBe('user');
    });
  });

  describe('Edge cases', () => {
    it('should handle EOF (Ctrl+D)', async () => {
      mockStdin.sendEOF();
      
      // Should either default to 'user' or handle gracefully
      const scope = await promptForScope();
      expect(scope).toBeTruthy();
    });

    it('should handle interrupt (Ctrl+C)', async () => {
      mockStdin.sendInterrupt();
      
      // Should exit cleanly
      expect(process.exitCode).toBe(130); // Standard SIGINT exit code
    });
  });
});
```

---

### 5. Uninstall Auto-Detection - Logic Untested

**Severity**: HIGH
**Impact**: Uninstall may fail silently, delete wrong files, miss installations
**Files**: `/workspace/devflow/src/cli/commands/uninstall.ts` (lines 71-120)

**Problem**:
New auto-detection logic determines which scopes to uninstall - **NO TESTS** for detection accuracy.

**Untested Scenarios**:
```typescript
// Scenario 1: Only user scope installed
// Expected: Detect user, uninstall user
// Risk: Detection fails? Doesn't find it?

// Scenario 2: Only local scope installed
// Expected: Detect local, uninstall local
// Risk: Detection fails? Wrong directory?

// Scenario 3: Both scopes installed
// Expected: Detect both, ask user or uninstall both
// Risk: Only finds one? Deletes both without asking?

// Scenario 4: Neither scope installed
// Expected: Error message "No DevFlow installation found"
// Risk: Silent failure? Confusing error?

// Scenario 5: Partial installation
// Commands exist but agents missing
// Expected: Still counts as installed? Or not?
// Risk: isDevFlowInstalled() only checks commands/devflow

// Scenario 6: --scope flag overrides detection
// Expected: Only uninstall specified scope
// Risk: Ignores flag? Uninstalls both anyway?

// Scenario 7: Multiple git repos
// In nested repos, which local installation detected?
// Risk: Deletes wrong one?
```

**Current Detection Logic**:
```typescript
// Line 71-78: Detection implementation
async function isDevFlowInstalled(claudeDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(claudeDir, 'commands', 'devflow'));
    return true;
  } catch {
    return false;
  }
}

// PROBLEM: Only checks commands/devflow
// What if commands exist but other components are missing?
// Should it check all components?
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/uninstall-detection.test.ts
describe('isDevFlowInstalled', () => {
  it('should detect full installation', async () => {
    const tempDir = createFullInstallation();
    const installed = await isDevFlowInstalled(tempDir);
    expect(installed).toBe(true);
  });

  it('should detect partial installation', async () => {
    const tempDir = createPartialInstallation(); // Only commands
    const installed = await isDevFlowInstalled(tempDir);
    expect(installed).toBe(true); // Still counts
  });

  it('should return false when not installed', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    const installed = await isDevFlowInstalled(tempDir);
    expect(installed).toBe(false);
  });

  it('should handle missing directory', async () => {
    const nonexistent = '/tmp/does-not-exist-' + Date.now();
    const installed = await isDevFlowInstalled(nonexistent);
    expect(installed).toBe(false);
  });

  it('should handle permission errors', async () => {
    const tempDir = createDirectoryWithNoPermissions();
    const installed = await isDevFlowInstalled(tempDir);
    expect(installed).toBe(false);
  });
});

describe('Auto-detection logic', () => {
  it('should detect user scope only', async () => {
    setupUserInstallation();
    
    const scopes = await detectInstalledScopes();
    expect(scopes).toEqual(['user']);
  });

  it('should detect local scope only', async () => {
    setupLocalInstallation();
    
    const scopes = await detectInstalledScopes();
    expect(scopes).toEqual(['local']);
  });

  it('should detect both scopes', async () => {
    setupUserInstallation();
    setupLocalInstallation();
    
    const scopes = await detectInstalledScopes();
    expect(scopes).toEqual(['user', 'local']);
  });

  it('should error when no installation found', async () => {
    const scopes = await detectInstalledScopes();
    expect(scopes).toEqual([]);
    
    // Should trigger error message
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No DevFlow installation found')
    );
  });

  it('should respect --scope flag', async () => {
    setupUserInstallation();
    setupLocalInstallation();
    
    const scopes = await detectInstalledScopes({ scope: 'user' });
    expect(scopes).toEqual(['user']); // Only user, not local
  });
});
```

---

## High Priority Issues

### 6. File Installation Scenarios - No Integration Tests

**Severity**: HIGH
**Impact**: Installation corruption, file conflicts, data loss
**Files**: `/workspace/devflow/src/cli/commands/init.ts` (lines 213-304)

**Problem**:
File installation logic handles multiple scenarios (fresh install, existing files, overrides) - **NO INTEGRATION TESTS**.

**Untested Scenarios**:
```typescript
// settings.json scenarios
1. Fresh install (no settings.json exists)
   -> Install to settings.json
   -> UNTESTED

2. Existing settings.json (user has custom config)
   -> Install to settings.devflow.json
   -> Preserve existing settings.json
   -> UNTESTED

3. Both settings.json and settings.devflow.json exist
   -> What happens?
   -> UNTESTED

// CLAUDE.md scenarios
1. Fresh install (no CLAUDE.md exists)
   -> Install to CLAUDE.md
   -> UNTESTED

2. Existing CLAUDE.md (user has custom guide)
   -> Install to CLAUDE.devflow.md
   -> Preserve existing CLAUDE.md
   -> UNTESTED

3. Both CLAUDE.md and CLAUDE.devflow.md exist
   -> What happens?
   -> UNTESTED

// .claudeignore scenarios
1. Not in git repo
   -> Skip .claudeignore creation
   -> UNTESTED

2. In git repo, no .claudeignore
   -> Create .claudeignore
   -> UNTESTED

3. In git repo, .claudeignore exists
   -> Don't override existing
   -> UNTESTED

4. Git repo at filesystem root (/)
   -> Where does .claudeignore go?
   -> UNTESTED
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/installation-scenarios.test.ts
describe('File installation scenarios', () => {
  describe('settings.json', () => {
    it('should install settings.json on fresh install', async () => {
      const tempDir = createEmptyClaudeDir();
      
      await installSettings(tempDir);
      
      expect(fs.existsSync(path.join(tempDir, 'settings.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'settings.devflow.json'))).toBe(false);
    });

    it('should preserve existing settings.json', async () => {
      const tempDir = createClaudeDirWithSettings();
      const originalContent = fs.readFileSync(
        path.join(tempDir, 'settings.json'), 
        'utf-8'
      );
      
      await installSettings(tempDir);
      
      const newContent = fs.readFileSync(
        path.join(tempDir, 'settings.json'), 
        'utf-8'
      );
      expect(newContent).toBe(originalContent); // Unchanged
      expect(fs.existsSync(path.join(tempDir, 'settings.devflow.json'))).toBe(true);
    });

    it('should replace ~ with actual path in settings', async () => {
      const tempDir = createEmptyClaudeDir();
      
      await installSettings(tempDir);
      
      const content = fs.readFileSync(
        path.join(tempDir, 'settings.json'), 
        'utf-8'
      );
      expect(content).not.toContain('~/.devflow');
      expect(content).toContain(path.join(os.homedir(), '.devflow'));
    });
  });

  describe('CLAUDE.md', () => {
    it('should install CLAUDE.md on fresh install', async () => {
      const tempDir = createEmptyClaudeDir();
      
      await installClaudeMd(tempDir);
      
      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.devflow.md'))).toBe(false);
    });

    it('should preserve existing CLAUDE.md', async () => {
      const tempDir = createClaudeDirWithClaudeMd();
      const originalContent = fs.readFileSync(
        path.join(tempDir, 'CLAUDE.md'), 
        'utf-8'
      );
      
      await installClaudeMd(tempDir);
      
      const newContent = fs.readFileSync(
        path.join(tempDir, 'CLAUDE.md'), 
        'utf-8'
      );
      expect(newContent).toBe(originalContent); // Unchanged
      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.devflow.md'))).toBe(true);
    });
  });

  describe('.claudeignore', () => {
    it('should skip when not in git repo', async () => {
      const tempDir = createNonGitDir();
      
      await installClaudeIgnore();
      
      expect(fs.existsSync(path.join(tempDir, '.claudeignore'))).toBe(false);
    });

    it('should create in git repo when missing', async () => {
      const gitRoot = createGitRepo();
      
      await installClaudeIgnore();
      
      expect(fs.existsSync(path.join(gitRoot, '.claudeignore'))).toBe(true);
    });

    it('should preserve existing .claudeignore', async () => {
      const gitRoot = createGitRepoWithClaudeIgnore();
      const original = fs.readFileSync(
        path.join(gitRoot, '.claudeignore'), 
        'utf-8'
      );
      
      await installClaudeIgnore();
      
      const after = fs.readFileSync(
        path.join(gitRoot, '.claudeignore'), 
        'utf-8'
      );
      expect(after).toBe(original); // Unchanged
    });
  });

  describe('Component installation', () => {
    it('should clean old DevFlow files before installing', async () => {
      const tempDir = createClaudeDirWithOldDevFlow();
      
      await installComponents(tempDir);
      
      // Old files should be removed
      expect(fs.existsSync(path.join(tempDir, 'commands', 'devflow', 'old-command.md'))).toBe(false);
    });

    it('should make scripts executable', async () => {
      const tempDir = createEmptyClaudeDir();
      
      await installComponents(tempDir);
      
      const scriptPath = path.join(tempDir, '../.devflow/scripts/statusline.sh');
      const stats = fs.statSync(scriptPath);
      expect(stats.mode & 0o111).toBeTruthy(); // Executable bit set
    });
  });
});
```

---

### 7. Error Handling Paths - No Failure Testing

**Severity**: HIGH
**Impact**: Poor error messages, unclear failures, debugging difficulty
**Files**: Multiple error handling blocks throughout both files

**Problem**:
Multiple `try/catch` blocks with error messages - **NO TESTS** verify error handling quality.

**Untested Error Scenarios**:
```typescript
// init.ts error paths
1. HOME environment variable not set
   -> Line 18-21: Error message quality?
   -> UNTESTED

2. Local scope without git repo
   -> Line 91: "Local scope requires a git repository..."
   -> UNTESTED

3. Claude Code not detected (user scope)
   -> Line 192-195: Error message helpful?
   -> UNTESTED

4. Failed to create .claude directory (local scope)
   -> Line 204-206: Error message quality?
   -> UNTESTED

5. Installation failure mid-process
   -> Line 589-591: Generic error message
   -> UNTESTED

// uninstall.ts error paths
1. Cannot uninstall local scope (not in git repo)
   -> Line 135-138: Warning message quality?
   -> UNTESTED

2. Component removal failure
   -> Line 158-160: Error handling adequate?
   -> UNTESTED

3. No DevFlow installation found
   -> Line 109-111: Error message clear?
   -> UNTESTED
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/error-handling.test.ts
describe('Error handling', () => {
  describe('init command errors', () => {
    it('should show clear error when HOME not set', () => {
      delete process.env.HOME;
      jest.spyOn(os, 'homedir').mockReturnValue('');
      
      expect(() => getHomeDirectory()).toThrow(
        'Unable to determine home directory. Set HOME environment variable.'
      );
    });

    it('should show clear error for local scope without git', () => {
      const tempDir = createNonGitDir();
      
      expect(() => getInstallationPaths('local')).toThrow(
        'Local scope requires a git repository. Run "git init" first or use --scope user'
      );
    });

    it('should show clear error when Claude Code not detected', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error');
      
      await runInit({ scope: 'user' });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Claude Code not detected')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://claude.com/claude-code')
      );
    });

    it('should handle installation failure gracefully', async () => {
      jest.spyOn(fs, 'copyFile').mockRejectedValue(new Error('Disk full'));
      
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
      await runInit({ scope: 'user' });
      
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Installation failed')
      );
    });
  });

  describe('uninstall command errors', () => {
    it('should show clear error when nothing installed', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error');
      
      await runUninstall({});
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No DevFlow installation found')
      );
    });

    it('should warn when cannot uninstall local scope', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log');
      
      await runUninstall({ scope: 'local' }); // Not in git repo
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot uninstall local scope: not in a git repository')
      );
    });

    it('should continue on partial removal failure', async () => {
      jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('Permission denied'));
      
      await runUninstall({ scope: 'user' });
      
      // Should show warning but complete
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('completed with warnings')
      );
    });
  });
});
```

---

## Medium Priority Issues

### 8. Code Duplication - getGitRoot() in Two Files

**Severity**: MEDIUM
**Impact**: Maintenance burden, inconsistency risk, test duplication
**Files**: 
- `/workspace/devflow/src/cli/commands/init.ts` (lines 51-74)
- `/workspace/devflow/src/cli/commands/uninstall.ts` (lines 45-66)

**Problem**:
`getGitRoot()` is **duplicated verbatim** in two files. Changes to one won't propagate to the other.

**Risks**:
1. Bug fix in one file, forgotten in other
2. Security patch applied inconsistently
3. Test coverage for one doesn't cover the other
4. Maintenance burden doubled

**Recommended Refactoring**:
```typescript
// src/cli/utils/git.ts (NEW FILE)
import { execSync } from 'child_process';
import * as path from 'path';

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

// src/cli/commands/init.ts
import { getGitRoot } from '../utils/git';

// src/cli/commands/uninstall.ts  
import { getGitRoot } from '../utils/git';
```

**Test Benefits**:
```typescript
// src/cli/utils/__tests__/git.test.ts
// Single test file covers both use cases
describe('getGitRoot', () => {
  // All tests here
});

// 100% coverage guaranteed for both init and uninstall
```

---

### 9. Path Helper Functions Untested

**Severity**: MEDIUM
**Impact**: Environment variable handling, fallback logic, cross-platform issues
**Files**: 
- `/workspace/devflow/src/cli/commands/init.ts` (lines 17-45)
- `/workspace/devflow/src/cli/commands/uninstall.ts` (lines 11-39)

**Problem**:
Three helper functions handle critical path resolution - **NO TESTS** for environment variable logic.

**Functions**:
```typescript
getHomeDirectory()     // Lines 17-23 (init.ts)
getClaudeDirectory()   // Lines 29-34 (init.ts)
getDevFlowDirectory()  // Lines 40-45 (init.ts)
```

**Untested Logic**:
```typescript
// getHomeDirectory()
1. HOME env var set -> Use HOME
   -> UNTESTED
2. HOME not set -> Use os.homedir()
   -> UNTESTED
3. Both fail -> Throw error
   -> UNTESTED

// getClaudeDirectory()
1. CLAUDE_CODE_DIR set -> Use env var
   -> UNTESTED
2. CLAUDE_CODE_DIR not set -> Use ~/.claude
   -> UNTESTED
3. Path resolution on Windows vs Unix
   -> UNTESTED

// getDevFlowDirectory()
1. DEVFLOW_DIR set -> Use env var
   -> UNTESTED
2. DEVFLOW_DIR not set -> Use ~/.devflow
   -> UNTESTED
3. Path resolution on Windows vs Unix
   -> UNTESTED
```

**Cross-Platform Risks**:
```typescript
// Windows paths
C:\Users\name\.claude   // Should work?
C:\Users\name\.devflow  // Should work?

// Unix paths
/home/name/.claude      // Should work
/home/name/.devflow     // Should work

// macOS paths
/Users/name/.claude     // Should work
/Users/name/.devflow    // Should work

// Edge cases
// - Path with spaces
// - Path with unicode
// - Very long paths (Windows MAX_PATH limit)
// - Network drives (Windows UNC paths)
```

**Recommended Tests**:
```typescript
// src/cli/utils/__tests__/paths.test.ts
describe('Path helper functions', () => {
  describe('getHomeDirectory', () => {
    it('should use HOME env var when set', () => {
      process.env.HOME = '/custom/home';
      expect(getHomeDirectory()).toBe('/custom/home');
    });

    it('should fall back to os.homedir() when HOME not set', () => {
      delete process.env.HOME;
      const home = getHomeDirectory();
      expect(home).toBe(os.homedir());
    });

    it('should throw when both HOME and os.homedir() fail', () => {
      delete process.env.HOME;
      jest.spyOn(os, 'homedir').mockReturnValue('');
      
      expect(() => getHomeDirectory()).toThrow(
        'Unable to determine home directory'
      );
    });
  });

  describe('getClaudeDirectory', () => {
    it('should use CLAUDE_CODE_DIR when set', () => {
      process.env.CLAUDE_CODE_DIR = '/custom/claude';
      expect(getClaudeDirectory()).toBe('/custom/claude');
    });

    it('should default to ~/.claude', () => {
      delete process.env.CLAUDE_CODE_DIR;
      process.env.HOME = '/home/user';
      expect(getClaudeDirectory()).toBe('/home/user/.claude');
    });

    it('should handle paths with spaces', () => {
      process.env.CLAUDE_CODE_DIR = '/path with spaces/claude';
      expect(getClaudeDirectory()).toBe('/path with spaces/claude');
    });
  });

  describe('getDevFlowDirectory', () => {
    it('should use DEVFLOW_DIR when set', () => {
      process.env.DEVFLOW_DIR = '/custom/devflow';
      expect(getDevFlowDirectory()).toBe('/custom/devflow');
    });

    it('should default to ~/.devflow', () => {
      delete process.env.DEVFLOW_DIR;
      process.env.HOME = '/home/user';
      expect(getDevFlowDirectory()).toBe('/home/user/.devflow');
    });
  });

  describe('Cross-platform behavior', () => {
    it('should work on Windows', () => {
      // Mock Windows environment
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.HOME = 'C:\\Users\\TestUser';
      
      expect(getHomeDirectory()).toBe('C:\\Users\\TestUser');
    });

    it('should work on Unix/Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.HOME = '/home/testuser';
      
      expect(getHomeDirectory()).toBe('/home/testuser');
    });

    it('should work on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      process.env.HOME = '/Users/testuser';
      
      expect(getHomeDirectory()).toBe('/Users/testuser');
    });
  });
});
```

---

### 10. Directory Copy Logic Untested

**Severity**: MEDIUM
**Impact**: Incomplete installations, file permission issues, symlink handling
**Files**: `/workspace/devflow/src/cli/commands/init.ts` (lines 594-608)

**Problem**:
`copyDirectory()` recursively copies DevFlow components - **NO TESTS** for edge cases.

**Untested Scenarios**:
```typescript
// Scenario 1: Simple directory copy
src/claude/commands/devflow/ -> ~/.claude/commands/devflow/
-> UNTESTED

// Scenario 2: Nested directories
src/claude/commands/devflow/subdir/file.md
-> UNTESTED

// Scenario 3: Symlinks
What if source contains symlinks?
-> Follow them? Copy as symlinks? Error?
-> UNTESTED

// Scenario 4: Permission preservation
Source file is executable (0755)
-> Should destination also be 0755?
-> UNTESTED (scripts handled separately, but what about other files?)

// Scenario 5: Large files
What if a file is very large?
-> Memory issues? Streaming needed?
-> UNTESTED

// Scenario 6: Disk space
What if destination disk is full?
-> Error handling? Cleanup?
-> UNTESTED

// Scenario 7: Destination already has files
Overwrite? Merge? Error?
-> UNTESTED (cleaned before copy, but what if concurrent installs?)

// Scenario 8: Special files
What if source has devices, pipes, sockets?
-> Should they be copied? Skipped? Error?
-> UNTESTED
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/copy-directory.test.ts
describe('copyDirectory', () => {
  describe('Basic functionality', () => {
    it('should copy simple directory', async () => {
      const src = createTestDir({ 'file.txt': 'content' });
      const dest = createEmptyDir();
      
      await copyDirectory(src, dest);
      
      expect(fs.existsSync(path.join(dest, 'file.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'file.txt'), 'utf-8')).toBe('content');
    });

    it('should copy nested directories', async () => {
      const src = createTestDir({
        'a/b/c/file.txt': 'deep'
      });
      const dest = createEmptyDir();
      
      await copyDirectory(src, dest);
      
      expect(fs.existsSync(path.join(dest, 'a/b/c/file.txt'))).toBe(true);
    });

    it('should copy multiple files', async () => {
      const src = createTestDir({
        'file1.txt': 'one',
        'file2.txt': 'two',
        'file3.txt': 'three'
      });
      const dest = createEmptyDir();
      
      await copyDirectory(src, dest);
      
      expect(fs.readdirSync(dest)).toHaveLength(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty directory', async () => {
      const src = createEmptyDir();
      const dest = createEmptyDir();
      
      await copyDirectory(src, dest);
      
      expect(fs.readdirSync(dest)).toHaveLength(0);
    });

    it('should handle symlinks', async () => {
      const src = createTestDirWithSymlink();
      const dest = createEmptyDir();
      
      await copyDirectory(src, dest);
      
      // Should either follow symlink or copy as symlink
      // Document expected behavior
    });

    it('should preserve file permissions', async () => {
      const src = createTestDir({ 'script.sh': '#!/bin/bash' });
      fs.chmodSync(path.join(src, 'script.sh'), 0o755);
      const dest = createEmptyDir();
      
      await copyDirectory(src, dest);
      
      const stats = fs.statSync(path.join(dest, 'script.sh'));
      expect(stats.mode & 0o755).toBeTruthy();
    });

    it('should handle disk full error', async () => {
      const src = createTestDir({ 'file.txt': 'content' });
      const dest = createFullDisk();
      
      await expect(copyDirectory(src, dest)).rejects.toThrow(
        expect.stringMatching(/ENOSPC|disk full/i)
      );
    });

    it('should handle permission denied', async () => {
      const src = createTestDir({ 'file.txt': 'content' });
      const dest = createReadOnlyDir();
      
      await expect(copyDirectory(src, dest)).rejects.toThrow(
        expect.stringMatching(/EACCES|permission denied/i)
      );
    });
  });

  describe('Error handling', () => {
    it('should throw on nonexistent source', async () => {
      const src = '/tmp/does-not-exist-' + Date.now();
      const dest = createEmptyDir();
      
      await expect(copyDirectory(src, dest)).rejects.toThrow();
    });

    it('should create destination if missing', async () => {
      const src = createTestDir({ 'file.txt': 'content' });
      const dest = '/tmp/new-dir-' + Date.now();
      
      await copyDirectory(src, dest);
      
      expect(fs.existsSync(dest)).toBe(true);
    });
  });
});
```

---

### 11. .docs Structure Creation Untested

**Severity**: MEDIUM
**Impact**: Missing documentation directories, incorrect structure
**Files**: `/workspace/devflow/src/cli/commands/init.ts` (lines 536-552)

**Problem**:
`.docs/` directory creation with `--skip-docs` flag - **NO TESTS** for directory structure.

**Untested Logic**:
```typescript
// Scenario 1: --skip-docs flag
-> Should not create .docs/
-> UNTESTED

// Scenario 2: Default (no flag)
-> Should create .docs/ structure
-> UNTESTED

// Scenario 3: .docs/ already exists
-> Should not fail? Should skip?
-> Line 545-547: Silent catch - what if error is real?
-> UNTESTED

// Scenario 4: Permission denied
-> Error handling adequate?
-> UNTESTED

// Scenario 5: Nested directory creation
.docs/status/compact
.docs/reviews
.docs/audits/standalone
.docs/releases
-> All created correctly?
-> UNTESTED
```

**Expected Structure**:
```
.docs/
├── status/
│   └── compact/
├── reviews/
├── audits/
│   └── standalone/
└── releases/
```

**Recommended Tests**:
```typescript
// src/cli/commands/__tests__/docs-structure.test.ts
describe('.docs structure creation', () => {
  it('should create full structure without --skip-docs', async () => {
    const tempDir = createEmptyProjectDir();
    
    await runInit({ scope: 'user' }); // No --skip-docs
    
    const docsDir = path.join(tempDir, '.docs');
    expect(fs.existsSync(docsDir)).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'status/compact'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'reviews'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'audits/standalone'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'releases'))).toBe(true);
  });

  it('should skip .docs with --skip-docs flag', async () => {
    const tempDir = createEmptyProjectDir();
    
    await runInit({ scope: 'user', skipDocs: true });
    
    const docsDir = path.join(tempDir, '.docs');
    expect(fs.existsSync(docsDir)).toBe(false);
  });

  it('should handle existing .docs gracefully', async () => {
    const tempDir = createProjectWithDocs();
    
    // Should not fail or delete existing docs
    await expect(runInit({ scope: 'user' })).resolves.not.toThrow();
  });

  it('should handle permission denied', async () => {
    const tempDir = createReadOnlyProjectDir();
    
    // Should fail gracefully with clear message
    await runInit({ scope: 'user' });
    
    // Check error handling
  });
});
```

---

## Low Priority Issues

### 12. Console Output Formatting Not Validated

**Severity**: LOW
**Impact**: User experience, error message clarity, visual consistency
**Files**: Multiple console.log/error calls throughout

**Problem**:
Extensive console output for user feedback - **NO TESTS** validate formatting or message quality.

**Untested Aspects**:
```typescript
// Message clarity
1. Are error messages actionable?
2. Are success messages encouraging?
3. Are warnings noticeable?

// Visual consistency
1. Emoji usage consistent (✓, ❌, ⚠️, 📦, 📍)?
2. Indentation consistent?
3. Color usage (if any)?

// Information completeness
1. Do errors include next steps?
2. Do warnings explain implications?
3. Do success messages confirm what happened?

// Examples from code:
console.log('🚀 DevFlow v${version}\n');
console.log('✓ Claude Code detected');
console.log('⚠️  Existing settings.json preserved → DevFlow config: settings.devflow.json');
console.error('❌ Invalid scope. Use "user" or "local"\n');
```

**Recommended Tests** (Low priority, but valuable for UX):
```typescript
// src/cli/commands/__tests__/console-output.test.ts
describe('Console output quality', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  describe('Success messages', () => {
    it('should show version on init', async () => {
      await runInit({ scope: 'user' });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/🚀 DevFlow v\d+\.\d+\.\d+/)
      );
    });

    it('should confirm installation complete', async () => {
      await runInit({ scope: 'user' });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Installation complete!')
      );
    });

    it('should list available commands', async () => {
      await runInit({ scope: 'user' });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('/catch-up')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('/code-review')
      );
    });
  });

  describe('Error messages', () => {
    it('should provide actionable error for missing git', async () => {
      await runInit({ scope: 'local' }); // Not in git repo
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run "git init" first')
      );
    });

    it('should include installation URL when Claude Code missing', async () => {
      await runInit({ scope: 'user' });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://claude.com/claude-code')
      );
    });
  });

  describe('Warning messages', () => {
    it('should warn when preserving existing files', async () => {
      await runInit({ scope: 'user' }); // With existing settings.json
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/⚠️.*Existing settings.json preserved/)
      );
    });

    it('should suggest manual merge when needed', async () => {
      await runInit({ scope: 'user' }); // With existing settings.json
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Manual merge recommended')
      );
    });
  });
});
```

---

### 13. Version Display Logic Untested

**Severity**: LOW
**Impact**: Cosmetic, version display might fail silently
**Files**: `/workspace/devflow/src/cli/commands/init.ts` (lines 123-130)

**Problem**:
Version reading from package.json with fallback - **NO TESTS** for version display logic.

**Untested Scenarios**:
```typescript
// Scenario 1: package.json exists and has version
-> Display version
-> UNTESTED

// Scenario 2: package.json missing
-> Display "unknown"
-> UNTESTED

// Scenario 3: package.json malformed
-> Display "unknown"
-> UNTESTED

// Scenario 4: package.json has no version field
-> Display "unknown"? Error?
-> UNTESTED
```

**Recommended Tests**:
```typescript
describe('Version display', () => {
  it('should display version from package.json', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log');
    
    await runInit({ scope: 'user' });
    
    const packageJson = JSON.parse(
      fs.readFileSync('package.json', 'utf-8')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`v${packageJson.version}`)
    );
  });

  it('should show "unknown" when package.json missing', async () => {
    // Mock fs.readFile to fail
    jest.spyOn(fs, 'readFile').mockRejectedValue(new Error('ENOENT'));
    
    const consoleLogSpy = jest.spyOn(console, 'log');
    await runInit({ scope: 'user' });
    
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('vunknown')
    );
  });

  it('should show "unknown" when package.json malformed', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue('{ invalid json');
    
    const consoleLogSpy = jest.spyOn(console, 'log');
    await runInit({ scope: 'user' });
    
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('vunknown')
    );
  });
});
```

---

## Test Coverage Score: 0/10

**Breakdown**:
- **Unit tests**: 0/10 (none exist)
- **Integration tests**: 0/10 (none exist)
- **E2E tests**: 0/10 (none exist)
- **Edge case coverage**: 0/10 (none tested)
- **Error path coverage**: 0/10 (none tested)
- **Cross-platform coverage**: 0/10 (none tested)

---

## Recommendation: **BLOCK MERGE**

### Blocking Issues (Must Fix Before Merge)

1. **Add test framework**
   - Install Jest + TypeScript support
   - Configure test runner
   - Add test scripts to package.json

2. **Critical path coverage** (minimum 80%)
   - `getGitRoot()` - Security validation tests
   - `getInstallationPaths()` - Path resolution tests
   - Scope selection logic - User input validation tests
   - Auto-detection logic - Installation detection tests

3. **Security validation tests**
   - Git root injection prevention
   - Path traversal prevention
   - Environment variable validation

4. **Error handling tests**
   - All error messages tested
   - Exit codes validated
   - Failure scenarios covered

### High Priority (Should Fix Before Merge)

5. **Refactor code duplication**
   - Extract `getGitRoot()` to shared utility
   - Single test suite covers both uses

6. **Integration tests**
   - Full installation workflow (user scope)
   - Full installation workflow (local scope)
   - Uninstall workflow (both scopes)
   - File conflict scenarios

### Medium Priority (Can Address Post-Merge)

7. **Helper function tests**
   - Path helper functions
   - Directory copy edge cases
   - .docs structure creation

8. **Cross-platform tests**
   - Windows path handling
   - Unix/Linux path handling
   - macOS path handling

### Low Priority (Nice to Have)

9. **UX validation**
   - Console output formatting
   - Error message clarity
   - Version display

---

## Test Implementation Roadmap

### Phase 1: Foundation (BLOCKING)
```bash
# 1. Install test dependencies
npm install --save-dev jest @types/jest ts-jest

# 2. Configure Jest
npx ts-jest config:init

# 3. Update package.json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage --collectCoverageFrom='src/cli/**/*.ts'"
  }
}

# 4. Add .gitignore
coverage/
*.test.ts.snap
```

### Phase 2: Critical Path Tests (BLOCKING)
```bash
# Create test files
src/cli/utils/__tests__/git.test.ts              # getGitRoot()
src/cli/utils/__tests__/paths.test.ts            # Path helpers
src/cli/commands/__tests__/installation-paths.test.ts  # getInstallationPaths()
src/cli/commands/__tests__/interactive-prompts.test.ts # Scope selection
src/cli/commands/__tests__/uninstall-detection.test.ts # Auto-detection

# Target: 80% coverage of new functionality
```

### Phase 3: Integration Tests (HIGH PRIORITY)
```bash
# Create integration test files
src/cli/commands/__tests__/init-integration.test.ts
src/cli/commands/__tests__/uninstall-integration.test.ts
src/cli/commands/__tests__/installation-scenarios.test.ts

# Target: Full workflows tested end-to-end
```

### Phase 4: Edge Cases (MEDIUM PRIORITY)
```bash
# Create edge case test files
src/cli/commands/__tests__/copy-directory.test.ts
src/cli/commands/__tests__/docs-structure.test.ts
src/cli/commands/__tests__/error-handling.test.ts

# Target: 90%+ coverage
```

### Phase 5: UX & Polish (LOW PRIORITY)
```bash
# Create UX test files
src/cli/commands/__tests__/console-output.test.ts
src/cli/commands/__tests__/version-display.test.ts

# Target: 95%+ coverage
```

---

## Test Quality Anti-Patterns to Avoid

1. **Don't mock what you don't own**
   - Bad: Mocking entire `child_process` module
   - Good: Test with real git operations in temp directories

2. **Avoid brittle tests**
   - Bad: Exact string matching for console output
   - Good: Pattern matching with `expect.stringContaining()`

3. **Test behaviors, not implementation**
   - Bad: Testing internal variable values
   - Good: Testing observable outcomes (files created, errors thrown)

4. **Keep tests isolated**
   - Bad: Tests depend on previous test state
   - Good: Each test creates own temporary environment

5. **Make tests readable**
   - Bad: Complex setup with no comments
   - Good: Helper functions with descriptive names

---

## Example Test File Structure

```typescript
// src/cli/utils/__tests__/git.test.ts
import { getGitRoot } from '../git';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('getGitRoot', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
  });

  afterEach(() => {
    // Cleanup after each test
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Valid git repositories', () => {
    it('should return git root for valid repo', () => {
      // Arrange
      execSync('git init', { cwd: testDir });
      const originalCwd = process.cwd();
      process.chdir(testDir);

      // Act
      const result = getGitRoot();

      // Assert
      expect(result).toBe(testDir);
      expect(path.isAbsolute(result!)).toBe(true);

      // Cleanup
      process.chdir(originalCwd);
    });

    // More tests...
  });

  describe('Security validation', () => {
    it('should reject malicious paths with semicolons', () => {
      // Test injection prevention
    });

    // More security tests...
  });

  describe('Edge cases', () => {
    it('should handle nested git repositories', () => {
      // Test edge case
    });

    // More edge case tests...
  });
});
```

---

## CI/CD Integration Recommendation

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, feat/*]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Check coverage
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

---

## Summary

This branch adds **298 lines of critical functionality** with **ZERO test coverage**. The new scope-based installation system handles sensitive operations (filesystem modifications, git repository detection, user data management) without validation.

**Key Risks**:
1. Security vulnerabilities in git root detection
2. Data loss from incorrect path resolution
3. Installation failures from untested edge cases
4. Platform-specific bugs (Windows/Linux/macOS)
5. Regression risk for future changes

**Immediate Action Required**:
1. Add Jest test framework
2. Write tests for critical paths (80% coverage minimum)
3. Test security validation logic
4. Add integration tests for full workflows

**Do NOT merge** until minimum test coverage achieved. CLI tools that modify user filesystems **require comprehensive testing** before production deployment.

---

**Report Location**: `/workspace/devflow/.docs/audits/feat/add-scope-to-init/tests-report.2025-10-24_1250.md`
**Next Steps**: Implement Phase 1 and Phase 2 tests before requesting re-review
