# DevFlow Self-Review Plugin

Self-review workflow that runs Simplifier and Scrutinizer sequentially on your code changes.

## Installation

```bash
npx devflow-kit init --plugin=self-review
```

## Usage

```bash
# Auto-detect changed files
/self-review

# Review specific files
/self-review src/api/auth.ts src/utils/crypto.ts
```

## What It Does

1. **Simplifier** - Refines code for clarity, consistency, and maintainability
2. **Scrutinizer** - Evaluates against 9-pillar quality framework, fixes issues

## 9-Pillar Framework

| Priority | Pillars | Action |
|----------|---------|--------|
| P0 | Design, Functionality, Security | Must fix |
| P1 | Complexity, Error Handling, Tests | Should fix |
| P2 | Naming, Consistency, Documentation | Suggestions |

## When to Use

- After implementing a feature, before creating PR
- After resolving review issues
- For periodic code quality checks on recent changes
