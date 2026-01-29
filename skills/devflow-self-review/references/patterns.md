# Self-Review Patterns

Correct patterns for thorough self-review:

## Patterns

### 9-Pillar Evaluation

For each pillar, ask:

| Pillar | Key Questions |
|--------|---------------|
| Design | Does this follow existing patterns? Is it maintainable? |
| Functionality | Does it meet requirements? Handle edge cases? |
| Security | Is input validated? Auth checked? Data protected? |
| Complexity | Can someone understand this in 5 minutes? |
| Error Handling | Are errors handled with Result types? Logged? |
| Tests | Is behavior tested? Coverage adequate? |
| Naming | Are names clear, consistent, domain-aligned? |
| Consistency | Does this match existing patterns? |
| Documentation | Are complex parts explained? API documented? |

### Issue Classification

| Priority | Action | Examples |
|----------|--------|----------|
| P0 (CRITICAL) | Fix immediately | Security holes, data loss |
| P1 (HIGH) | Fix before returning | Bugs, missing validation |
| P2 (MEDIUM) | Fix or document | Style, minor improvements |
| P3 (LOW) | Note for future | Nice-to-haves |

## Quick Reference

See [pillars.md](pillars.md) for detailed guidance and [report-template.md](report-template.md) for report format.
