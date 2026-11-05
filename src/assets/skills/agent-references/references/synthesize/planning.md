## Mode: Planning

Merge the Plan outputs into one plan. When 3 Plan agents report (implementation, testing, execution strategy), Synthesize merges them. When one Plan agent runs, it applies only this file's Execution Strategy Decision and Context Risk, and reports in the order its prompt gives.

**Process:**
1. Merge implementation steps with testing strategy
2. Apply the Execution Strategy Decision
3. Identify dependencies between steps
4. Assess context risk based on file count and module breadth

**Execution Strategy Decision:**

Count the files the plan writes and its plan steps, then choose:
- **SEQUENTIAL_CODE_AGENTS**: the plan writes >= 10 files or has >= 7 steps. Split it into phases of <= 5 files and <= 6 steps each, and give the phases as the Subtask Breakdown section. Each phase hands off to the next with a summary.
- **PARALLEL_CODE_AGENTS**: only for true artifact independence: no shared contracts, no integration points.
- **SINGLE_CODE_AGENT**: every other plan. Coherent A→Z implementation.

Each phase or subtask names the AC numbers it serves.

**Output:**
```markdown
## Planning Synthesis

### Execution Strategy
**Type**: {SINGLE_CODE_AGENT | SEQUENTIAL_CODE_AGENTS | PARALLEL_CODE_AGENTS}
**Context Risk**: {LOW | MEDIUM | HIGH | CRITICAL}
**File Estimate**: {n} files across {m} modules
**Reason**: {why this strategy}

### Subtask Breakdown (if not SINGLE_CODE_AGENT)
| Phase | Domain | Description | Files | Steps | Serves | Depends On |
|-------|--------|-------------|-------|-------|--------|------------|
| 1 | backend | {description} | `file1`, `file2` | 1-3 | AC-1, AC-2 | - |
| 2 | frontend | {description} | `file3`, `file4` | 4-6 | AC-3 | Phase 1 |

### Implementation Plan
| Step | Action | Files | Callers and consumers | Must | Rung | Tests | Depends On |
|------|--------|-------|-----------------------|------|------|-------|------------|
| 1 | {action} | `file` | `caller` | {what has to hold} | {lowest rung that works} | `test_file` | - |
| 2 | {action} | `file` | `caller` | {what has to hold} | {lowest rung that works} | `test_file` | Step 1 |

### Known limits and deferrals
| Limit | Reason |
|-------|--------|
| {accepted risk, deferred or excluded item} | {one reason} |

### Complexity
{Low | Medium | High} - {reasoning}
```
