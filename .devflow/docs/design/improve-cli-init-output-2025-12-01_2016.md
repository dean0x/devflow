# Implementation Design: Improve CLI Init Output (GitHub Issue #21)

**Created**: 2025-12-01
**Author**: Design Agent
**Status**: Ready for Implementation
**Target File**: `/workspace/devflow/src/cli/commands/init.ts`

---

## Overview

Refactor the `devflow init` CLI output to be professional and user-focused. The current output is overwhelming and mixes user-facing information with technical implementation details. This design provides a clean, command-focused output with an optional `--verbose` flag for detailed information.

---

## Existing Patterns Analysis

### Current Output Structure

The current `init.ts` produces output in these categories:

1. **Header** (line 60): `🚀 DevFlow v${version}\n`
2. **Scope Selection** (lines 71-102): Interactive prompt or auto-detect message
3. **Path Information** (lines 119-121): Technical paths displayed
4. **Detection Status** (lines 137, 142): Claude Code / directory status
5. **Component Installation** (line 229): Status per component
6. **Config File Status** (lines 247-275): settings.json, CLAUDE.md handling
7. **File Creation Status** (lines 490-544): .claudeignore, .gitignore, .docs
8. **Success Message** (line 547): `✅ Installation complete!`
9. **Manual Merge Instructions** (lines 551-559): If existing configs found
10. **Command List** (lines 562-575): All commands with descriptions
11. **Skills List** (lines 576-583): All skills with descriptions
12. **Notes** (lines 584-585): Dual-mode pattern, docs link

### Code Patterns in Use

- **Error Handling**: Direct `try/catch` with `process.exit(1)` for fatal errors
- **Dependency Injection**: None - direct function calls
- **Testing**: No tests currently exist (`"test": "echo \"No tests yet\" && exit 0"`)
- **Validation**: Runtime type guards (`isNodeSystemError`)
- **CLI Framework**: Commander.js with `.option()` for flags

### File Structure Convention

```
src/cli/
├── cli.ts                 # CLI entry point
├── commands/
│   ├── init.ts           # Installation command (target file)
│   └── uninstall.ts      # Uninstallation command
└── utils/
    ├── git.ts            # Git utilities
    └── paths.ts          # Path utilities
```

### Naming Conventions

- Functions: camelCase (`getInstallationPaths`, `copyDirectory`)
- Interfaces: PascalCase (`NodeSystemError`)
- Constants: camelCase (no constants currently)
- Options: kebab-case (`--skip-docs`, `--scope`)

---

## Integration Points

### 1. Entry Points

- **CLI Entry**: `cli.ts:28` - `program.addCommand(initCommand)`
- **Command Export**: `init.ts:45` - `export const initCommand = new Command('init')`

### 2. Data Flow

**Inputs**:
- `options.skipDocs: boolean` - Skip .docs creation
- `options.scope: 'user' | 'local' | undefined` - Installation scope
- `options.verbose: boolean` - NEW: Show detailed output

**Outputs**:
- Console output (stdout/stderr)
- File system changes (commands, agents, skills, scripts, configs)
- Exit codes (0 for success, 1 for failure)

### 3. Dependencies

**Internal**:
- `getInstallationPaths(scope)` from `../utils/paths.js`
- `getGitRoot()` from `../utils/git.js`

**External**:
- `commander` - CLI framework
- `fs.promises` - File operations
- `readline` - Interactive prompts

### 4. Side Effects

**Files Created/Modified**:
- `~/.claude/commands/devflow/*` - Command files
- `~/.claude/agents/devflow/*` - Agent files  
- `~/.claude/skills/*` - Skill directories
- `~/.devflow/scripts/*` - Script files
- `~/.claude/settings.json` - Settings (or settings.devflow.json)
- `~/.claude/CLAUDE.md` - Instructions (or CLAUDE.devflow.md)
- `<git-root>/.claudeignore` - Ignore patterns
- `<git-root>/.gitignore` - Git ignore (local scope only)
- `<cwd>/.docs/*` - Documentation structure

### 5. Configuration

**Existing Options**:
- `--skip-docs` - Boolean flag
- `--scope <type>` - String with regex validation

**New Option**:
- `--verbose` or `-V` - Boolean flag (SHORT: -V to avoid conflict with -v/--version)

### 6. Error Conditions

Current error exits at:
- Line 99-101: Invalid scope selection
- Line 123-125: Path configuration error
- Line 132-136: Claude Code not detected (user scope)
- Line 143-146: Failed to create local .claude directory
- Line 587-589: General installation failure

---

## Edge Cases to Handle

### 1. Invalid Input

**Scenario**: User provides invalid scope via CLI
**Handling**: Commander.js regex validation rejects invalid values (existing pattern)
**Code reference**: `init.ts:48` - regex `/^(user|local)$/i`

### 2. Missing Dependencies

**Scenario**: Claude Code not installed (user scope)
**Current Handling**: Error message with installation link (lines 132-135)
**New Handling**: Same error in verbose mode; cleaner error in default mode

### 3. Existing Configuration Files

**Scenario**: settings.json or CLAUDE.md already exist
**Current Handling**: Creates `.devflow.json` / `.devflow.md` alternatives
**New Handling**: 
- Default mode: Silent (file created, no noise)
- Verbose mode: Show preservation message and merge instructions

### 4. Partial Installation Failure

**Scenario**: Some components install, others fail
**Current Handling**: Continues with other components, shows final error
**New Handling**: 
- Default mode: Clean error message with suggestion to retry
- Verbose mode: Show which components failed

### 5. Non-Interactive Environment (CI/CD)

**Scenario**: Running in CI where stdin is not TTY
**Current Handling**: Uses default scope with message (lines 70-73)
**New Handling**:
- Default mode: Silent use of default scope
- Verbose mode: Show CI detection message

### 6. Not in Git Repository

**Scenario**: Local scope requested but not in git repo
**Current Handling**: Error with suggestion (line 87-88 in paths.ts)
**New Handling**: Same, but cleaner error message

---

## Code Reuse Opportunities

### Existing Utilities to Leverage

**1. `getInstallationPaths(scope)`**
- **Location**: `/workspace/devflow/src/cli/utils/paths.ts:77`
- **Purpose**: Get claude and devflow directories based on scope
- **Usage**: Already used at line 112
- **Why reuse**: Consistent path resolution

**2. `getGitRoot()`**
- **Location**: `/workspace/devflow/src/cli/utils/git.ts:16`
- **Purpose**: Find git repository root
- **Usage**: Already used at line 117
- **Why reuse**: Security-validated git detection

**3. `isNodeSystemError(error)`**
- **Location**: `/workspace/devflow/src/cli/commands/init.ts:20`
- **Purpose**: Type guard for Node.js errors with codes
- **Usage**: Used for EEXIST detection (line 249, 271)
- **Why reuse**: Safe error code checking

**4. `copyDirectory(src, dest)`**
- **Location**: `/workspace/devflow/src/cli/commands/init.ts:592`
- **Purpose**: Recursive directory copy
- **Usage**: Line 219
- **Why reuse**: Existing tested function

### Patterns to Follow

**1. Commander Option Pattern**
- **Example**: `init.ts:47-48`
- **Usage**: `.option('--verbose', 'Show detailed installation output')`
- **Benefit**: Consistent with existing options

**2. Error Exit Pattern**
- **Example**: `init.ts:99-101`
- **Usage**: `console.error('...'); process.exit(1);`
- **Benefit**: Consistent error handling

---

## Core Components to Create

### 1. Output Configuration Type

**Location**: `/workspace/devflow/src/cli/commands/init.ts` (top of file, after imports)

**Purpose**: Define output verbosity configuration

**Interface**:
```typescript
interface OutputConfig {
  verbose: boolean;
}
```

### 2. Output Helper Functions

**Location**: `/workspace/devflow/src/cli/commands/init.ts` (after type definitions)

**Purpose**: Conditional logging based on verbosity

**Interface**:
```typescript
/**
 * Log message only in verbose mode
 */
function logVerbose(config: OutputConfig, message: string): void {
  if (config.verbose) {
    console.log(message);
  }
}

/**
 * Log error (always shown)
 */
function logError(message: string): void {
  console.error(message);
}
```

**Implementation Notes**:
- Keep functions simple and pure
- Errors are always visible regardless of verbosity
- Success status follows different rules (see below)

### 3. Command List Constant

**Location**: `/workspace/devflow/src/cli/commands/init.ts` (after imports)

**Purpose**: Centralized command definitions for consistent display

**Interface**:
```typescript
const DEVFLOW_COMMANDS = [
  { name: '/catch-up', description: 'Get up to speed on project state' },
  { name: '/brainstorm', description: 'Explore design decisions' },
  { name: '/design', description: 'Create implementation plan' },
  { name: '/plan', description: 'Triage issues from discussion' },
  { name: '/breakdown', description: 'Break down tasks quickly' },
  { name: '/run', description: 'Interactive implementation' },
  { name: '/code-review', description: 'Comprehensive code review' },
  { name: '/commit', description: 'Smart atomic commits' },
  { name: '/pull-request', description: 'Create PR with description' },
  { name: '/release', description: 'Automated releases' },
  { name: '/devlog', description: 'Document session progress' },
  { name: '/debug', description: 'Systematic debugging' },
  { name: '/resolve-comments', description: 'Address PR review feedback' },
] as const;
```

**Implementation Notes**:
- Use `as const` for type safety
- Descriptions are user-friendly (not technical)
- Order follows typical workflow progression

### 4. Skills List Constant (verbose only)

**Location**: `/workspace/devflow/src/cli/commands/init.ts` (after DEVFLOW_COMMANDS)

**Purpose**: Skills information for verbose output only

**Interface**:
```typescript
const DEVFLOW_SKILLS = [
  { name: 'pattern-check', description: 'Architectural pattern validation' },
  { name: 'test-design', description: 'Test quality enforcement' },
  { name: 'code-smell', description: 'Anti-pattern detection' },
  { name: 'research', description: 'Pre-implementation planning' },
  { name: 'debug', description: 'Systematic debugging (auto)' },
  { name: 'input-validation', description: 'Boundary validation' },
  { name: 'error-handling', description: 'Result type consistency' },
] as const;
```

### 5. Output Rendering Functions

**Location**: `/workspace/devflow/src/cli/commands/init.ts` (after constants)

**Purpose**: Render clean vs verbose output

**Interface**:
```typescript
/**
 * Render clean success output (default mode)
 */
function renderCleanOutput(version: string): void {
  console.log(`\n✓ DevFlow v${version} installed\n`);
  console.log('Commands available:');
  
  const maxNameLen = Math.max(...DEVFLOW_COMMANDS.map(c => c.name.length));
  for (const cmd of DEVFLOW_COMMANDS) {
    console.log(`  ${cmd.name.padEnd(maxNameLen + 2)}${cmd.description}`);
  }
  
  console.log('\nRun any command in Claude Code to get started.');
  console.log('\nDocs: https://github.com/dean0x/devflow');
}

/**
 * Render verbose success output (--verbose mode)
 * Includes skills, merge instructions, technical details
 */
function renderVerboseOutput(
  version: string,
  scope: 'user' | 'local',
  claudeDir: string,
  devflowDir: string,
  settingsExists: boolean,
  claudeMdExists: boolean,
  claudeignoreCreated: boolean,
  gitignoreUpdated: boolean,
  docsCreated: boolean
): void {
  // Full verbose output with all details
}
```

**Implementation Notes**:
- Clean output is always same format
- Verbose output includes all current information
- Use padEnd for aligned columns

---

## Implementation Steps

### Step 1: Add --verbose Option

**Modify**: `/workspace/devflow/src/cli/commands/init.ts:45-48`

**What to do**:
- Add `.option('--verbose', 'Show detailed installation output')` 
- Use `-V` as short option if desired (but may conflict, test first)

**Code snippet**:
```typescript
export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .option('--scope <type>', 'Installation scope: user (user-wide) or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
  .action(async (options) => {
```

**Verification**:
- [ ] `devflow init --help` shows --verbose option
- [ ] `devflow init --verbose` runs without error

---

### Step 2: Add Constants for Commands and Skills

**Modify**: `/workspace/devflow/src/cli/commands/init.ts` (after imports, before type guard)

**What to do**:
- Add DEVFLOW_COMMANDS constant
- Add DEVFLOW_SKILLS constant

**Code snippet**:
```typescript
const DEVFLOW_COMMANDS = [
  { name: '/catch-up', description: 'Get up to speed on project state' },
  { name: '/brainstorm', description: 'Explore design decisions' },
  { name: '/design', description: 'Create implementation plan' },
  { name: '/plan', description: 'Triage issues from discussion' },
  { name: '/breakdown', description: 'Break down tasks quickly' },
  { name: '/run', description: 'Interactive implementation' },
  { name: '/code-review', description: 'Comprehensive code review' },
  { name: '/commit', description: 'Smart atomic commits' },
  { name: '/pull-request', description: 'Create PR with description' },
  { name: '/release', description: 'Automated releases' },
  { name: '/devlog', description: 'Document session progress' },
  { name: '/debug', description: 'Systematic debugging' },
  { name: '/resolve-comments', description: 'Address PR feedback' },
] as const;

const DEVFLOW_SKILLS = [
  { name: 'pattern-check', description: 'Architectural pattern validation' },
  { name: 'test-design', description: 'Test quality enforcement' },
  { name: 'code-smell', description: 'Anti-pattern detection' },
  { name: 'research', description: 'Pre-implementation planning' },
  { name: 'debug', description: 'Systematic debugging (auto)' },
  { name: 'input-validation', description: 'Boundary validation' },
  { name: 'error-handling', description: 'Result type consistency' },
] as const;
```

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] Constants are properly typed

---

### Step 3: Create Output Rendering Functions

**Modify**: `/workspace/devflow/src/cli/commands/init.ts` (after promptUser function)

**What to do**:
- Add renderCleanOutput function
- Add renderVerboseOutput function

**Code snippet**:
```typescript
/**
 * Render clean success output (default mode)
 */
function renderCleanOutput(version: string): void {
  console.log(`\n✓ DevFlow v${version} installed\n`);
  console.log('Commands available:');
  
  const maxNameLen = Math.max(...DEVFLOW_COMMANDS.map(c => c.name.length));
  for (const cmd of DEVFLOW_COMMANDS) {
    console.log(`  ${cmd.name.padEnd(maxNameLen + 2)}${cmd.description}`);
  }
  
  console.log('\nRun any command in Claude Code to get started.');
  console.log('\nDocs: https://github.com/dean0x/devflow');
}

interface VerboseOutputParams {
  version: string;
  scope: 'user' | 'local';
  claudeDir: string;
  devflowDir: string;
  settingsExists: boolean;
  claudeMdExists: boolean;
  claudeignoreCreated: boolean;
  gitignoreUpdated: boolean;
  docsCreated: boolean;
}

/**
 * Render verbose success output (--verbose mode)
 */
function renderVerboseOutput(params: VerboseOutputParams): void {
  const { 
    version, scope, claudeDir, devflowDir,
    settingsExists, claudeMdExists,
    claudeignoreCreated, gitignoreUpdated, docsCreated 
  } = params;
  
  console.log(`\n✅ DevFlow v${version} installed successfully!\n`);
  
  // Installation details
  console.log(`📍 Installation scope: ${scope}`);
  console.log(`   Claude dir: ${claudeDir}`);
  console.log(`   DevFlow dir: ${devflowDir}\n`);
  
  // Component status
  console.log('Installed components:');
  console.log('  ✓ Commands');
  console.log('  ✓ Agents');
  console.log('  ✓ Skills');
  console.log('  ✓ Scripts');
  
  if (claudeignoreCreated) console.log('  ✓ .claudeignore');
  if (gitignoreUpdated) console.log('  ✓ .gitignore updated');
  if (docsCreated) console.log('  ✓ .docs/ structure');
  
  // Config file status
  if (settingsExists) {
    console.log('\n⚠️  Existing settings.json preserved');
    console.log('   DevFlow config saved to: settings.devflow.json');
    console.log('   Merge recommendation: Review and copy statusLine config');
  }
  
  if (claudeMdExists) {
    console.log('\n⚠️  Existing CLAUDE.md preserved');
    console.log('   DevFlow guide saved to: CLAUDE.devflow.md');
    console.log('   Contains recommended development patterns');
  }
  
  // Commands list
  console.log('\nAvailable commands:');
  const maxNameLen = Math.max(...DEVFLOW_COMMANDS.map(c => c.name.length));
  for (const cmd of DEVFLOW_COMMANDS) {
    console.log(`  ${cmd.name.padEnd(maxNameLen + 2)}${cmd.description}`);
  }
  
  // Skills list
  console.log('\nInstalled skills (auto-activate):');
  const maxSkillLen = Math.max(...DEVFLOW_SKILLS.map(s => s.name.length));
  for (const skill of DEVFLOW_SKILLS) {
    console.log(`  ${skill.name.padEnd(maxSkillLen + 2)}${skill.description}`);
  }
  
  console.log('\nNote: debug exists as both command (manual) and skill (auto)');
  console.log('\nDocs: https://github.com/dean0x/devflow');
}
```

**Verification**:
- [ ] TypeScript compiles without errors
- [ ] Functions produce expected output format

---

### Step 4: Refactor Output in Main Action

**Modify**: `/workspace/devflow/src/cli/commands/init.ts:49-589`

**What to do**:
- Extract verbose flag: `const verbose = options.verbose ?? false`
- Track state for verbose output (settingsExists, claudeMdExists, etc.)
- Remove inline console.log statements for progress (verbose only)
- Remove final command/skill output section
- Call appropriate render function at end

**Key changes**:

1. **Remove header output** (line 60):
   - Verbose: Keep `🚀 DevFlow v${version}\n`
   - Default: Remove (shown in final output instead)

2. **Scope selection output** (lines 71-102):
   - Verbose: Keep interactive prompt messages
   - Default: Silent scope selection (use defaults or prompt without explanation)

3. **Path information** (lines 119-121):
   - Verbose: Keep technical paths
   - Default: Remove

4. **Detection status** (lines 137, 142):
   - Verbose: Keep checkmarks
   - Default: Remove (only show errors)

5. **Component installation** (line 229):
   - Verbose: Keep
   - Default: Remove

6. **Config file warnings** (lines 253, 275):
   - Verbose: Keep warnings
   - Default: Silent (tracked in state)

7. **File creation status** (lines 490, 520, 544):
   - Verbose: Keep
   - Default: Remove

8. **Final output** (lines 547-585):
   - Replace entirely with render function call

**Code snippet for end of action**:
```typescript
// Replace lines 547-585 with:
if (verbose) {
  renderVerboseOutput({
    version,
    scope,
    claudeDir,
    devflowDir,
    settingsExists,
    claudeMdExists,
    claudeignoreCreated,
    gitignoreUpdated,
    docsCreated,
  });
} else {
  renderCleanOutput(version);
}
```

**Verification**:
- [ ] Default output matches proposed clean format
- [ ] Verbose output shows all previous information
- [ ] Error messages still visible in both modes

---

### Step 5: Refactor Progress Output to be Verbose-Only

**Modify**: Throughout `/workspace/devflow/src/cli/commands/init.ts` action body

**What to do**:
- Wrap progress `console.log` calls in verbose check
- Keep all `console.error` calls unconditional
- Track boolean state for verbose output params

**Specific changes**:

```typescript
// Line 60 - Header
if (verbose) {
  console.log(`🚀 DevFlow v${version}\n`);
}

// Lines 71-72 - CI/CD detection
if (verbose) {
  console.log('📦 Non-interactive environment detected, using default scope: user');
  console.log('   To specify scope in CI/CD, use: devflow init --scope <user|local>\n');
}

// Lines 76-80 - Scope prompt (keep interactive part, wrap explanation)
if (verbose) {
  console.log('📦 Installation Scope:\n');
  console.log('  user  - Install for all projects (user-wide)');
  // ... rest of explanation
}
// Note: The actual readline question should remain for interactivity

// Lines 119-121 - Path info
if (verbose) {
  console.log(`📍 Installation scope: ${scope}`);
  console.log(`   Claude dir: ${claudeDir}`);
  console.log(`   DevFlow dir: ${devflowDir}\n`);
}

// Line 137 - Claude Code detected
if (verbose) {
  console.log('✓ Claude Code detected');
}

// Line 142 - Local directory ready
if (verbose) {
  console.log('✓ Local .claude directory ready');
}

// Line 229 - Components installed
if (verbose) {
  console.log('✓ Installing components... (commands, agents, skills, scripts)');
}

// Lines 247, 253 - Settings handling
if (!settingsExists) {
  if (verbose) console.log('✓ Settings configured');
} else {
  // Track for later
  if (verbose) console.log('⚠️  Existing settings.json preserved → DevFlow config: settings.devflow.json');
}

// Lines 269, 275 - CLAUDE.md handling (same pattern)

// Lines 490, 520, 544 - File creation (wrap in verbose)
```

**Verification**:
- [ ] Default mode produces NO progress output
- [ ] Verbose mode produces all progress output
- [ ] Errors still visible in both modes

---

### Step 6: Handle Scope Prompt for Non-Verbose

**Modify**: `/workspace/devflow/src/cli/commands/init.ts:68-102`

**What to do**:
- In non-verbose mode, use simpler prompt without explanation
- Keep interactive functionality

**Code snippet**:
```typescript
if (!process.stdin.isTTY) {
  // Non-interactive environment - use default silently
  if (verbose) {
    console.log('📦 Non-interactive environment detected, using default scope: user');
    console.log('   To specify scope in CI/CD, use: devflow init --scope <user|local>\n');
  }
  scope = 'user';
} else {
  // Interactive prompt
  if (verbose) {
    console.log('📦 Installation Scope:\n');
    console.log('  user  - Install for all projects (user-wide)');
    console.log('            └─ ~/.claude/ and ~/.devflow/');
    console.log('  local - Install for current project only');
    console.log('            └─ <git-root>/.claude/ and <git-root>/.devflow/\n');
  }

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
  // ... rest of validation
}
```

**Verification**:
- [ ] Interactive prompt still works in both modes
- [ ] Verbose shows explanation, default does not

---

### Step 7: Track State Variables for Verbose Output

**Modify**: `/workspace/devflow/src/cli/commands/init.ts` (within action)

**What to do**:
- Ensure all state variables are initialized
- Update them during installation process

**Code snippet**:
```typescript
// Near start of action body (after path resolution)
let settingsExists = false;
let claudeMdExists = false;
let claudeignoreCreated = false;
let gitignoreUpdated = false;
let docsCreated = false;

// These are already tracked at lines 251, 272, 482, etc.
// Just ensure they're declared at proper scope
```

**Verification**:
- [ ] All state variables properly scoped
- [ ] No undefined references

---

### Step 8: Update Help Text

**Modify**: `/workspace/devflow/src/cli/cli.ts:25`

**What to do**:
- Ensure help text mentions --verbose option in examples

**Code snippet**:
```typescript
.addHelpText('after', '\nExamples:\n  $ devflow init           Install DevFlow for Claude Code\n  $ devflow init --verbose     Show detailed installation output\n  $ devflow init --skip-docs   Install without creating .docs/ structure\n  $ devflow uninstall      Remove DevFlow from Claude Code\n  $ devflow --version      Show version\n  $ devflow --help         Show help\n\nDocumentation:\n  https://github.com/dean0x/devflow#readme');
```

**Verification**:
- [ ] `devflow --help` shows --verbose in examples

---

### Final Step: Integration Testing

**What to test**:
- [ ] Happy path (default): `devflow init` produces clean output
- [ ] Happy path (verbose): `devflow init --verbose` produces detailed output
- [ ] Edge case: Existing settings.json - no warning in default, warning in verbose
- [ ] Edge case: Existing CLAUDE.md - same behavior
- [ ] Edge case: CI/CD environment - silent default scope selection
- [ ] Error case: Claude Code not detected - error visible in both modes
- [ ] Error case: Invalid scope - error visible in both modes

**Test commands**:
```bash
# Build
npm run build

# Test default output
node dist/cli.js init --skip-docs

# Test verbose output
node dist/cli.js init --verbose --skip-docs

# Verify help
node dist/cli.js init --help
```

---

## Testing Strategy

**Test Framework**: None currently (manual testing)

### Manual Test Cases

1. **Clean install (default mode)**
   - Expected: Single success message, command list, docs link
   - No progress messages, no technical details

2. **Clean install (verbose mode)**
   - Expected: All progress messages, paths, component status
   - Skills list, merge instructions if applicable

3. **Install with existing configs (default mode)**
   - Expected: Clean success, no merge warnings
   - .devflow.json/.devflow.md files created silently

4. **Install with existing configs (verbose mode)**
   - Expected: Merge warnings with instructions

5. **Error scenarios**
   - Expected: Errors visible in both modes

### Recommended: Add Unit Tests

Future improvement - add test file:
- **Location**: `/workspace/devflow/src/cli/commands/__tests__/init.test.ts`
- **Test Cases**: Output functions with mock console

---

## Scope Boundaries

### In Scope
- Refactoring output format for `devflow init`
- Adding `--verbose` flag
- Creating clean default output
- Preserving all current functionality in verbose mode
- Centralizing command/skill lists as constants

### Out of Scope (Future Work)
- Adding unit tests for CLI
- Refactoring to Result types (would require larger change)
- Dependency injection pattern (not needed for CLI)
- Changing uninstall command output
- Adding color/styling to output (could be future enhancement)
- Progress spinners or animations

### Assumptions
- Commander.js continues to be the CLI framework
- No breaking changes to existing functionality
- Verbose flag follows standard CLI conventions
- Users primarily care about commands, not internals

---

## Implementation Checklist

- [ ] Add `--verbose` option to initCommand
- [ ] Add DEVFLOW_COMMANDS constant
- [ ] Add DEVFLOW_SKILLS constant
- [ ] Create renderCleanOutput function
- [ ] Create renderVerboseOutput function
- [ ] Wrap progress logs in verbose checks
- [ ] Update scope prompt for non-verbose
- [ ] Track state variables for verbose output
- [ ] Update help text examples
- [ ] Build and test manually
- [ ] Verify default output matches proposed format
- [ ] Verify verbose output preserves all current info
- [ ] Verify errors visible in both modes

---

## Summary

This design transforms the `devflow init` output from an overwhelming wall of technical information into a clean, professional, command-focused experience. Users see what matters: what was installed and how to use it. Technical details remain available via `--verbose` for debugging and advanced users.

Key benefits:
1. **User-focused** - Commands first, not implementation details
2. **Professional** - Clean, consistent formatting
3. **Actionable** - Clear next steps
4. **Backwards compatible** - `--verbose` preserves all current behavior
5. **Maintainable** - Centralized constants for commands/skills

Full design saved to: `/workspace/devflow/.docs/design/improve-cli-init-output-2025-12-01_2016.md`
