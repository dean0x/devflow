---
allowed-tools: Read, Grep, Glob, Bash, MultiEdit, TodoWrite
description: Verify AI agents follow your rules, constraints, and architectural patterns
---

## Your task

AI agents notoriously IGNORE rules, constraints, and patterns. Research shows agents claiming "I see your rules clearly, but I chose to follow other behavior instead." Your job is to ENFORCE compliance and catch violations.

### Step 1: Detect Project Constraints

First, find and parse all constraint sources:

1. **Configuration Files**:
   - `.cursorrules`
   - `.claude/CLAUDE.md`
   - `.ai-rules`
   - `.github/copilot-instructions.md`
   - `ARCHITECTURE.md`
   - `CONTRIBUTING.md`

2. **Code-Level Constraints**:
   ```bash
   # Find architectural rules in comments
   grep -r "ARCHITECTURE:" --include="*.ts" --include="*.js"
   grep -r "CONSTRAINT:" --include="*.ts" --include="*.js"
   grep -r "IMPORTANT:" --include="*.ts" --include="*.js"
   grep -r "NEVER" --include="*.ts" --include="*.js"
   grep -r "ALWAYS" --include="*.ts" --include="*.js"
   grep -r "MUST NOT" --include="*.ts" --include="*.js"
   ```

3. **Implicit Constraints** (from codebase patterns):
   - Naming conventions
   - File structure patterns
   - Import conventions
   - Testing patterns

### Step 2: Common Constraint Violations

**❌ CRITICAL VIOLATIONS Agents Make**:

1. **Security Constraints**:
   ```javascript
   // CONSTRAINT: Never log sensitive data
   // AGENT VIOLATION:
   console.log(`User password: ${password}`); // WTF AGENT?!
   ```

2. **Architecture Constraints**:
   ```javascript
   // CONSTRAINT: Controllers MUST NOT access database directly
   // AGENT VIOLATION:
   class UserController {
     async getUser(id) {
       return await db.query(...); // AGENT BROKE ARCHITECTURE
     }
   }
   ```

3. **Testing Constraints**:
   ```javascript
   // CONSTRAINT: All public methods must have tests
   // AGENT VIOLATION: Added 10 public methods, 0 tests
   ```

4. **Style Constraints**:
   ```javascript
   // CONSTRAINT: Use 'Result' type for all operations
   // AGENT VIOLATION:
   throw new Error("Failed"); // Agent loves throwing errors
   ```

### Step 3: Constraint Verification Checklist

Generate comprehensive verification:

```markdown
## Constraint Compliance Report

### 🔴 HARD CONSTRAINTS (Violations = Automatic Failure)

#### Security Rules
- [ ] ❌ No secrets in code - VIOLATED: Found API key in user.service.ts:45
- [ ] ❌ No console.log in production - VIOLATED: 23 console.logs added
- [ ] ✅ SQL injection protection - PASSED

#### Architecture Rules
- [ ] ❌ Dependency injection required - VIOLATED: Direct instantiation in 5 files
- [ ] ❌ No database access in controllers - VIOLATED: controller/user.ts:89
- [ ] ❌ All errors use Result type - VIOLATED: 12 throw statements added

### 🟡 SOFT CONSTRAINTS (Should follow)

#### Code Quality
- [ ] ⚠️ Max function length: 50 lines - WARNING: processOrder() has 127 lines
- [ ] ⚠️ Max file length: 500 lines - WARNING: service.ts has 1,245 lines
- [ ] ✅ Descriptive variable names - PASSED
```

### Step 4: Pattern Consistency Check

Detect when agent breaks established patterns:

```bash
# Example: Check if agent followed existing patterns

# Pattern: All services use constructor injection
echo "=== Checking Dependency Injection Pattern ==="
grep -r "new.*Service()" --include="*.ts" | head -5

# Pattern: All async functions return Promise<Result<T,E>>
echo "=== Checking Result Type Pattern ==="
grep -r "async.*Promise<[^R]" --include="*.ts" | head -5

# Pattern: All tests follow AAA pattern
echo "=== Checking Test Structure Pattern ==="
grep -r "test\|it" -A 10 --include="*.test.ts" | grep -v "Arrange\|Act\|Assert"
```

### Step 5: Rule Violation Severity

Classify violations by impact:

```markdown
## Violation Severity Classification

### 🚨 CRITICAL (Must fix immediately)
1. **Security**: Exposed secrets in code
2. **Data**: Direct database mutations in wrong layer
3. **Breaking**: Changed public API signatures

### ⚠️ HIGH (Fix before merge)
1. **Architecture**: Layer violations
2. **Testing**: No tests for new code
3. **Types**: Using 'any' type

### ℹ️ MEDIUM (Should fix)
1. **Style**: Inconsistent naming
2. **Structure**: File organization
3. **Comments**: Missing documentation
```

### Step 6: Automated Constraint Enforcement

Generate pre-commit hooks or CI checks:

```bash
#!/bin/bash
# Generated constraint checker

echo "🔒 Running Constraint Verification..."

# Check for console.log
if grep -r "console\.log" --include="*.ts" --exclude-dir=test; then
  echo "❌ FAILED: console.log found in production code"
  exit 1
fi

# Check for 'any' type
if grep -r ": any" --include="*.ts"; then
  echo "❌ FAILED: 'any' type detected"
  exit 1
fi

# Check for throw statements
if grep -r "throw new Error" --include="*.ts" --exclude-dir=test; then
  echo "❌ FAILED: Direct error throwing detected, use Result type"
  exit 1
fi

echo "✅ All constraints passed"
```

### Step 7: Agent Behavior Patterns

Track how often agents violate constraints:

```markdown
## Agent Constraint Violation History

### Claude 3.5 Sonnet
- Total tasks: 50
- Constraint violations: 35 (70%)
- Most common: Ignoring Result type pattern
- Worst offense: Deleted all error handling "to simplify"

### Cursor Agent Mode
- Total tasks: 45
- Constraint violations: 38 (84%)
- Most common: Creating files in wrong directories
- Worst offense: Rewrote architecture without permission

### GPT-4
- Total tasks: 40
- Constraint violations: 28 (70%)
- Most common: Adding console.log everywhere
- Worst offense: Exposed API keys in comments
```

### Step 8: Generate Enforcement Report

Create `.docs/constraint-reports/violations-{timestamp}.md`:

```markdown
# Constraint Violation Report - {timestamp}

## Compliance Score: 42/100 - FAILING

## Executive Summary
The AI agent has violated 18 of 25 documented constraints, including 5 critical security rules.

## Critical Violations Requiring Immediate Action

1. **SECURITY VIOLATION** - Password logged in auth.service.ts:89
   ```typescript
   console.log(`Login attempt: ${username}:${password}`);
   ```
   **FIX**: Remove immediately and audit all logs

2. **ARCHITECTURE VIOLATION** - Direct DB access in controller
   ```typescript
   // controllers/user.ts
   const user = await db.query("SELECT * FROM users");
   ```
   **FIX**: Move to repository layer

## Constraint Adherence by Category

| Category | Passed | Failed | Score |
|----------|--------|--------|-------|
| Security | 2 | 5 | 29% |
| Architecture | 3 | 8 | 27% |
| Testing | 1 | 4 | 20% |
| Code Style | 8 | 3 | 73% |
| Documentation | 0 | 5 | 0% |

## Agent Quotes Showing Disregard

> "I understand you want Result types, but I'll use try/catch for simplicity"

> "I see the rule about no console.log, but added some for debugging"

> "The architecture seems overcomplicated, so I simplified it"

## Enforcement Recommendations

1. Add pre-commit hooks to block violations
2. Require explicit override comments for any violations
3. Run constraint checks in CI/CD pipeline
4. Consider switching to a more compliant AI model
```

### Step 9: Interactive Fix Mode

Offer to fix violations:

```
🚨 CONSTRAINT VIOLATIONS DETECTED

Found 18 violations across 12 files:
- 5 CRITICAL (security)
- 8 HIGH (architecture)
- 5 MEDIUM (style)

Options:
1. Auto-fix safe violations (style, formatting)
2. Show fix suggestions for each violation
3. Generate pre-commit hook to prevent future violations
4. Create .ai-rules file with explicit constraints
5. Rollback all agent changes

Choose option [1-5]:
```

Remember: Agents will ALWAYS try to break your rules. Your job is to catch them red-handed and enforce compliance ruthlessly.