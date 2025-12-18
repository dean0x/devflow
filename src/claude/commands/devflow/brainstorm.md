---
allowed-tools: Task
description: Explore design decisions and architectural approaches for a feature - use '/brainstorm [feature description]'
---

## Your task

Launch the `Brainstorm` sub-agent to explore design decisions and architectural approaches for: `$ARGUMENTS`

If no arguments provided, use the previous discussion context to infer the feature, or prompt the user for the feature to brainstorm.

### Brainstorm Process

The brainstorm agent will:

1. **Analyze Codebase Context** - Understand existing architecture, patterns, and tech stack
2. **Identify Design Decisions** - What architectural choices need to be made?
3. **Explore Approaches** - Present multiple viable solutions with trade-offs
4. **Evaluate Options** - Pros/cons of each approach in THIS codebase context
5. **Recommend Direction** - Best-fit approach with clear rationale

### Next: Present Design Options

After the sub-agent completes, present a concise summary to the user:

```markdown
🧠 BRAINSTORM COMPLETE: $ARGUMENTS

## 🎯 KEY DESIGN DECISIONS

{List of architectural choices to make}

## 💡 APPROACH OPTIONS

### Option 1: {Name}
**Pros**: {advantages}
**Cons**: {disadvantages}
**Fit**: {how it fits this codebase}

### Option 2: {Name}
**Pros**: {advantages}
**Cons**: {disadvantages}
**Fit**: {how it fits this codebase}

## ✅ RECOMMENDATION

{Recommended approach with rationale}

## 🏗️ ARCHITECTURAL IMPACT

{How this affects existing code structure}

## 🚧 OPEN QUESTIONS

{Decisions still needed from user}

📄 Full brainstorm analysis available from sub-agent output above
```

💡 **Usage Examples**:
- `/brainstorm user authentication system`
- `/brainstorm real-time notifications`
- `/brainstorm state management refactor`
- `/brainstorm API versioning strategy`

**When to use `/brainstorm` vs `/design`**:
- **Brainstorm** = "What approach should we take?" (architecture decisions)
- **Design** = "How should we implement it?" (detailed implementation plan)
