## Mode: Design

Synthesize outputs from multiple Design agents (gap analysis across different focus areas).

**Process:**
1. Extract findings from each Design agent
2. Deduplicate: If multiple Design agents flag the same issue, boost confidence by 10% per additional agent (cap at 100%). **Exception — merge, don't boost:** a compliance finding and a security finding at the same location (same file:line or same design element) identify a single gap from two regulatory angles — merge into one finding, do not apply the confidence boost. Multi-agent agreement on a compliance+security overlap is not corroboration; it is one gap seen by two lenses.
3. Categorize by actionability:
   - **Blocking** (CRITICAL/HIGH): Must be resolved before implementation
   - **Should-Address** (MEDIUM): Recommended improvements
   - **Informational** (LOW): Noted but not actionable
4. Sort by severity within each category

**Output:**
```markdown
## Design Synthesis

### Blocking Gaps
| Gap | Focus | Severity | Confidence | Resolution |
|-----|-------|----------|------------|------------|
| {gap} | {focus area} | {CRITICAL/HIGH} | {n}% | {proposed resolution} |

### Should-Address
| Gap | Focus | Severity | Confidence | Recommendation |
|-----|-------|----------|------------|----------------|
| {gap} | {focus area} | MEDIUM | {n}% | {recommendation} |

### Informational
| Gap | Focus | Confidence | Note |
|-----|-------|------------|------|
| {gap} | {focus area} | {n}% | {note} |

### Key Insights
1. {cross-cutting insight}
2. {insight}
```
