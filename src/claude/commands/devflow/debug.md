---
allowed-tools: Task
description: Systematic debugging workflow with issue tracking - use '/debug [issue description]'
---

## Your task

Launch the `debug` sub-agent to conduct systematic debugging for: `$ARGUMENTS`

If no arguments provided, prompt the user for the issue description.

### Debugging Process

The debug agent will:

1. **Capture the Problem** - Create debug session tracking with unique session ID
2. **Document the Issue** - Create comprehensive debug log in `.docs/debug/`
3. **Smart Investigation** - Detect issue type (error/performance/test/build) and adapt strategy
4. **Generate Hypotheses** - Create targeted, testable hypotheses based on issue type
5. **Systematic Testing** - Test each hypothesis methodically and document findings
6. **Root Cause Analysis** - Identify precise root cause with file and line references
7. **Implement Fix** - Design, implement, and verify the solution
8. **Prevention Strategy** - Document how to prevent similar issues
9. **Update Knowledge Base** - Add to searchable `.docs/debug/KNOWLEDGE_BASE.md`

### Next: Synthesize Results

After the sub-agent completes, present a concise summary to the user:

```markdown
🔍 DEBUG SESSION COMPLETE: $ARGUMENTS

## 🎯 ROOT CAUSE
{Precise description with file:line}

## ✅ SOLUTION APPLIED
{Description of fix}

## 📝 VERIFICATION
{Test results showing fix works}

## 🛡️ PREVENTION
{How to prevent similar issues}

## 📄 DOCUMENTATION
- Debug log: `.docs/debug/{SESSION_ID}.md`
- Knowledge base: `.docs/debug/KNOWLEDGE_BASE.md`

📄 Full debugging details available from sub-agent output above
```

💡 **Usage Examples**:
- `/debug "TypeError: Cannot read property 'name' of undefined"`
- `/debug tests failing after npm update`
- `/debug app crashes on startup`
- `/debug slow performance in search feature`
