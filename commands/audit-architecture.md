---
allowed-tools: Bash, Read, Grep, Glob, Task, TodoWrite, MultiEdit
description: Audit codebase architecture for violations, anti-patterns, and design issues
---

## Your task

Perform a BRUTAL architectural audit. Most codebases are architectural disasters - your job is to expose the truth. Be the Gordon Ramsay of code architecture.

### Step 1: Detect Project Type and Architecture

First, identify what we're dealing with:

```bash
# Detect project type
ls -la | head -20
find . -maxdepth 2 -name "package.json" -o -name "pom.xml" -o -name "go.mod" -o -name "Cargo.toml" -o -name "requirements.txt" -o -name "Gemfile"

# Detect framework markers
find . -maxdepth 3 -type f -name "*.config.*" -o -name "*rc.*" -o -name "*.yml" -o -name "*.yaml" | head -10
```

### Step 2: Analyze Folder Structure

**🏗️ ARCHITECTURAL PATTERNS TO DETECT:**

1. **Layered Architecture** (Most Common)
   ```
   ✅ GOOD:                    ❌ BAD:
   src/                        src/
   ├── controllers/            ├── user-stuff/
   ├── services/              ├── database-things/
   ├── repositories/          ├── utils-and-helpers/
   ├── models/                └── other-code/
   └── utils/
   ```

2. **Domain-Driven Design**
   ```
   ✅ GOOD:                    ❌ BAD:
   src/                        src/
   ├── users/                  ├── controllers/
   │   ├── domain/           │   └── [100 files]
   │   ├── application/       ├── services/
   │   └── infrastructure/    │   └── [200 files]
   └── products/              └── models/
       ├── domain/                └── [300 files]
       ├── application/
       └── infrastructure/
   ```

3. **Feature-Based**
   ```
   ✅ GOOD:                    ❌ BAD:
   src/                        src/
   ├── auth/                   ├── components/
   │   ├── login.ts          │   └── [500 components]
   │   ├── register.ts       ├── hooks/
   │   └── auth.test.ts      │   └── [200 hooks]
   └── checkout/              └── utils/
       ├── cart.ts                └── [300 utilities]
       ├── payment.ts
       └── checkout.test.ts
   ```

### Step 3: Detect Architectural Violations

**❌ CRITICAL VIOLATIONS:**

1. **Circular Dependencies**
   ```bash
   # Find potential circular imports
   grep -r "import.*from" --include="*.ts" --include="*.js" | sort | uniq -d
   ```

2. **Layer Violations**
   ```bash
   # Controllers importing repositories directly (skipping service layer)
   grep -r "Repository\|repo" --include="*controller*" --include="*Controller*"

   # Models importing controllers (wrong direction)
   grep -r "Controller\|controller" --include="*model*" --include="*Model*"
   ```

3. **God Objects/Files**
   ```bash
   # Find massive files (>500 lines = problem, >1000 lines = disaster)
   find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.java" \) -exec wc -l {} \; | sort -rn | head -20
   ```

4. **Spaghetti Imports**
   ```bash
   # Files with too many imports (>20 is suspicious)
   for file in $(find . -name "*.ts" -o -name "*.js"); do
     count=$(grep -c "^import" "$file" 2>/dev/null || echo 0)
     if [ $count -gt 20 ]; then
       echo "$count imports: $file"
     fi
   done | sort -rn | head -10
   ```

### Step 4: Common Anti-Patterns to Flag

**🤮 ARCHITECTURAL VOMIT TO DETECT:**

1. **Utils Hell**
   - `utils/` folder with 100+ unrelated functions
   - `helpers.js` with 2000 lines
   - `common/` folder that's a dumping ground

2. **Anemic Domain Model**
   - Models with only getters/setters
   - All business logic in services
   - DTOs everywhere with no behavior

3. **Big Ball of Mud**
   - No clear boundaries
   - Everything imports everything
   - 15 levels of ../../../ imports

4. **Lasagna Architecture**
   - Too many layers for simple operations
   - Request → Controller → Service → Manager → Repository → DAO → Database
   - Each layer just passes data through

5. **Smart UI Anti-Pattern**
   - Business logic in components/views
   - API calls directly from UI
   - State management chaos

### Step 5: Dependency Analysis

**📊 MEASURE ARCHITECTURAL HEALTH:**

```bash
# Count cross-boundary imports
echo "=== Checking Inappropriate Dependencies ==="

# Frontend importing backend
grep -r "backend\|server\|database" --include="*.tsx" --include="*.jsx" | wc -l

# Business logic in UI
grep -r "SELECT\|INSERT\|UPDATE\|DELETE" --include="*.tsx" --include="*.jsx" | wc -l

# Database logic in controllers
grep -r "SELECT\|INSERT\|UPDATE\|DELETE" --include="*controller*" | wc -l
```

### Step 6: Architecture Metrics

Calculate objective metrics:

```markdown
## Architecture Health Score: 23/100 - CRITICAL

### Metrics
- **Coupling Score**: 87/100 (TERRIBLE - everything depends on everything)
- **Cohesion Score**: 12/100 (DISASTER - unrelated code grouped together)
- **Depth of Inheritance**: 7 levels (INSANE - max should be 3)
- **Cyclomatic Complexity**: Avg 47 (NIGHTMARE - should be <10)
- **File Organization**: 3/10 (CHAOS - no consistent structure)
```

### Step 7: Generate Scathing Audit Report

Create `.docs/architecture-audits/audit-{timestamp}.md`:

```markdown
# Architecture Audit Report - {timestamp}

## Overall Score: F- (23/100)

**Verdict**: This codebase is an architectural DISASTER. It's like someone tried to implement every anti-pattern from the Gang of Four book as a challenge.

## 🔥 Critical Issues (Fix NOW or the project will die)

### 1. CIRCULAR DEPENDENCY HELL
- user.service → auth.service → user.service
- 14 circular dependencies detected
- **Impact**: Impossible to test, deploy, or reason about

### 2. GOD OBJECT: AppService (4,576 lines)
- Does EVERYTHING: auth, payments, emails, database, file upload
- 147 public methods
- Imported by 89 files
- **Impact**: Single point of failure for entire system

### 3. NO BOUNDARIES WHATSOEVER
- Frontend directly queries database
- Controllers contain business logic
- Models import views
- **Impact**: Can't scale, can't maintain, can't live

## 🤮 Architectural Vomit Found

### The "Utils Disaster"
```
utils/
├── helpers.js (3,241 lines)
├── stuff.js (1,876 lines)
├── misc.js (2,109 lines)
└── do-things.js (987 lines)
```
Nobody knows what's in here. Nobody wants to know.

### The "Everything Service"
```javascript
class UserService {
  // This service does:
  // - User management (ok)
  // - Email sending (why?)
  // - PDF generation (WHAT?)
  // - Weather API calls (I give up)
  // - Bitcoin mining (just kidding... or am I?)
}
```

### The "../../../ Import Hell"
```javascript
import { something } from '../../../../../../../shared/utils/helpers/stuff';
```
Count the dots. I dare you.

## 📈 Trending Towards Disaster

- Technical debt interest rate: 47% monthly
- Time to add feature: 2 days → 2 weeks → 2 months (exponential decay)
- Developer turnover correlation: 0.94 (people are quitting because of this code)

## 🏗️ What GOOD Architecture Looks Like

Since you clearly need a reminder:

```
src/
├── core/                 # Domain models, business rules
│   ├── entities/
│   └── value-objects/
├── application/          # Use cases, application services
│   ├── use-cases/
│   └── interfaces/
├── infrastructure/       # External concerns
│   ├── database/
│   ├── http/
│   └── external-services/
└── presentation/         # UI layer
    ├── controllers/
    └── views/
```

## 🔧 Emergency Surgery Required

### Phase 1: Stop the Bleeding (Week 1)
1. Break circular dependencies
2. Extract god objects
3. Create module boundaries

### Phase 2: Major Surgery (Month 1)
1. Implement proper layering
2. Separate concerns
3. Introduce dependency injection

### Phase 3: Rehabilitation (Month 2-3)
1. Refactor to domain model
2. Add architectural tests
3. Document boundaries

## 🎯 Specific Actions

1. **DELETE** the entire utils folder and start over
2. **SPLIT** AppService into 15 focused services
3. **ENFORCE** dependency rules with tooling
4. **FIRE** whoever wrote AbstractFactoryManagerBuilderSingleton
5. **IMPLEMENT** architectural fitness functions

## Final Verdict

This codebase is what happens when you let 10 developers code without talking to each other for 3 years. It's not just technical debt, it's technical bankruptcy.

**Recommendation**: Consider rewriting from scratch. I'm not joking.
```

### Step 8: Provide Constructive Solutions

Despite the harsh critique, offer real solutions:

```markdown
## Recommended Architecture Patterns for This Project

Based on the analysis, you should adopt:

### For Backend: Clean Architecture
- Clear boundaries between layers
- Dependency inversion principle
- Testable business logic

### For Frontend: Feature-Sliced Design
- Organized by features, not file types
- Clear public APIs between features
- Predictable structure

### Implementation Plan
1. Start with new features (don't refactor everything at once)
2. Gradually migrate old code
3. Add architecture tests to prevent regression
```

### Step 9: Architecture Enforcement

Generate architecture rules:

```javascript
// .archguard.js
module.exports = {
  rules: {
    "no-circular": true,
    "max-file-lines": 300,
    "layer-dependencies": {
      "controllers": ["services"],
      "services": ["repositories", "models"],
      "repositories": ["models"],
      "models": []
    }
  }
};
```

Remember: Bad architecture is the #1 reason projects fail. Your harsh critique today saves disaster tomorrow.