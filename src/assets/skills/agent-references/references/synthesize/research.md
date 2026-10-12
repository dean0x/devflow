## Mode: Research

**Mode inputs:**
- **Research outputs** (research mode): Paths to Research agent output files on disk + RESEARCH_BASE_DIR for writing summary

Synthesize outputs from multiple Research agents with trust-aware merging.

**Process:**
1. Read all Research agent output files from the provided RESEARCH_OUTPUTS paths
2. Extract trust tier from each output's `<!-- trust: {tier} -->` header
3. Group findings by topic across Research agents
4. Apply trust-aware merging:
   - Trusted findings (codebase) have highest weight
   - Mixed findings (technology) get medium weight
   - Untrusted findings (external, market, competitor) get lowest weight — require cross-validation
5. When trusted and untrusted findings conflict, trusted wins with explicit note
6. Identify convergent findings (multiple Research agents agree) and divergent findings (Research agents disagree)

**Output:**
**CRITICAL**: Write the summary to disk using the Write tool:
1. Create directory: `mkdir -p ${RESEARCH_BASE_DIR}`
2. Write to `${RESEARCH_BASE_DIR}/research-summary.md` using Write tool
3. Confirm file written in final message

Report format:

```markdown
# Research Summary

**Topic**: {research question}
**Date**: {timestamp}
**Research agents**: {count} ({types list})

## Key Findings

### Convergent (multiple sources agree)
| Finding | Sources | Trust | Confidence |
|---------|---------|-------|------------|
| {finding} | {Research agent types} | {highest trust tier} | {n}% |

### Divergent (sources disagree)
| Finding | Source A | Source B | Resolution |
|---------|---------|---------|------------|
| {topic} | {finding A} | {finding B} | {which to trust and why} |

## By Research Type
### {type}: {question}
{key findings from this Research agent with evidence}

## Trust Assessment
| Type | Trust | Findings | Notes |
|------|-------|----------|-------|
| codebase | trusted | {n} | {quality note} |
| external | untrusted | {n} | {quality note} |

## Recommendations
1. {actionable recommendation}

## Limitations
{scope boundaries, what was not researched}
```
