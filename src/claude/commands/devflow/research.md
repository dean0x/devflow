---
allowed-tools: Task
description: Comprehensive research workflow before implementation - use '/research [topic or feature description]'
---

## Your task

Launch the `research` sub-agent to conduct thorough research for implementing: `$ARGUMENTS`

If no arguments provided, prompt the user for the feature or topic to research.

### Research Process

The research agent will:

1. **Analyze Implementation Approaches** - Evaluate multiple solutions, trade-offs, and best practices
2. **Study Official Documentation** - Find code examples, patterns, and recommended approaches
3. **Review Codebase Patterns** - Understand existing architecture, conventions, and reusable code
4. **Design Integration Strategy** - Plan how new code integrates elegantly with existing patterns
5. **Produce Implementation Plan** - Concrete, actionable plan ready for development

### Next: Synthesize Results

After the sub-agent completes, present a concise summary to the user:

```markdown
🔬 RESEARCH COMPLETE: $ARGUMENTS

## 📊 RECOMMENDED APPROACH
{Chosen solution with rationale}

## 🏗️ INTEGRATION STRATEGY
{How it fits into existing codebase}

## 📝 IMPLEMENTATION PLAN
{Step-by-step plan with file references}

## ⚠️ CONSIDERATIONS
{Risks, trade-offs, dependencies}

## 🔗 KEY REFERENCES
{Relevant docs, examples, existing code}

📄 Full research report available from sub-agent output above
```

💡 **Usage Examples**:
- `/research authentication with JWT tokens`
- `/research add dark mode support`
- `/research implement real-time websocket notifications`
- `/research migrate from REST to GraphQL`
