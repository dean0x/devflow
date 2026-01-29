# TypeScript Violations Index

This skill organizes violations by TypeScript domain. See the domain-specific files for detailed examples:

## Domain Files

| File | Domain | Key Violations |
|------|--------|----------------|
| [patterns.md](patterns.md) | Core Patterns | `any` types, missing type guards, improper generics |
| [type-guards.md](type-guards.md) | Type Guards | Unsafe casts, missing narrowing, incorrect predicates |
| [utility-types.md](utility-types.md) | Utility Types | Manual type manipulation, redundant definitions |
| [async.md](async.md) | Async Patterns | Unhandled promises, race conditions, improper error handling |

## Quick Reference

Each domain file contains both violations (❌) and correct patterns (✅).
