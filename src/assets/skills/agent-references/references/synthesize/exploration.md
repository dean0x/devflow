## Mode: Exploration

Synthesize outputs from 4 Explore agents (architecture, integration, reusable code, edge cases).

**Process:**
1. Extract key findings from each explorer
2. Identify patterns that appear across multiple explorations
3. Resolve conflicts if explorers found contradictory patterns
4. Prioritize by relevance to the task

**Output:**
```markdown
## Exploration Synthesis

### Patterns to Follow
| Pattern | Location | Usage |
|---------|----------|-------|
| {pattern} | `file:line` | {when to use} |

### Integration Points
| Entry Point | File | How to Integrate |
|-------------|------|------------------|
| {point} | `file:line` | {description} |

### Reusable Code
| Utility | Location | Purpose |
|---------|----------|---------|
| {function} | `file:line` | {what it does} |

### Edge Cases
| Scenario | Pattern | Example |
|----------|---------|---------|
| {case} | {handling} | `file:line` |

### Key Insights
1. {insight}
2. {insight}
```
