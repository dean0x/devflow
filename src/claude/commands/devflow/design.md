---
allowed-tools: Task
description: Create detailed implementation design with integration points and edge cases - use '/design [feature description]'
---

## Your task

Launch the `Design` sub-agent to create a detailed implementation design for: `$ARGUMENTS`

If no arguments provided, use the previous discussion context to infer the feature, or prompt the user for the feature to design.

### Design Process

The design agent will:

1. **Analyze Existing Patterns** - Study code style, architecture, and reusable components
2. **Map Integration Points** - Identify all places new feature touches existing code
3. **Handle Edge Cases** - Surface non-obvious scenarios and error conditions
4. **Avoid Duplication** - Find existing code to reuse instead of recreating
5. **Create Implementation Plan** - Step-by-step guide with file references

### Next: Present Implementation Design

After the sub-agent completes, present a concise summary to the user:

```markdown
🎨 DESIGN COMPLETE: $ARGUMENTS

## 📐 IMPLEMENTATION OVERVIEW

{High-level summary of the design}

## 🔗 INTEGRATION POINTS

{Where this connects to existing code}
- {module/file}: {what needs updating}
- {module/file}: {what needs updating}

## 🎯 CORE COMPONENTS

{New code to create}
1. {component}: {purpose and location}
2. {component}: {purpose and location}

## ⚠️ EDGE CASES HANDLED

{Non-obvious scenarios to account for}
- {scenario}: {how to handle}
- {scenario}: {how to handle}

## ♻️ CODE REUSE OPPORTUNITIES

{Existing code to leverage}
- {file:function}: {what it does, how to use}

## 📝 IMPLEMENTATION STEPS

{Ordered sequence to implement}
1. {step with file references}
2. {step with file references}

## 🧪 TESTING STRATEGY

{How to test this implementation}

📄 Full design document available from sub-agent output above
```

💡 **Usage Examples**:
- `/design user authentication with JWT`
- `/design file upload with validation`
- `/design real-time sync engine`
- `/design search with filters and pagination`

**When to use `/brainstorm` vs `/design`**:
- **Brainstorm** = "What approach should we take?" (architecture decisions)
- **Design** = "How should we implement it?" (detailed implementation plan)

**Typical workflow**:
1. `/brainstorm` - Explore approaches and make design decisions
2. `/design` - Create detailed implementation plan based on chosen approach
3. `/implement` - Execute the plan with continuous user interaction
