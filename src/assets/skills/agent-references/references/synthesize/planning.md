## Mode: Planning

Synthesize outputs from 3 Plan agents (implementation, testing, execution strategy).

**Process:**
1. Merge implementation steps with testing strategy
2. Apply execution strategy analysis to determine Code agent deployment
3. Identify dependencies between steps
4. Assess context risk based on file count and module breadth

**Execution Strategy Decision:**

Count the files the plan writes and its plan steps, then choose:
- **SEQUENTIAL_CODE_AGENTS**: the plan writes >= 10 files or has >= 7 steps. Split it into phases of <= 5 files and <= 6 steps each. Each phase hands off to the next with a summary.
- **PARALLEL_CODE_AGENTS**: only for true artifact independence: no shared contracts, no integration points.
- **SINGLE_CODE_AGENT**: every other plan. Coherent A→Z implementation.

**Output:**
```markdown
## Planning Synthesis

### Execution Strategy
**Type**: {SINGLE_CODE_AGENT | SEQUENTIAL_CODE_AGENTS | PARALLEL_CODE_AGENTS}
**Context Risk**: {LOW | MEDIUM | HIGH | CRITICAL}
**File Estimate**: {n} files across {m} modules
**Reason**: {why this strategy}

### Subtask Breakdown (if not SINGLE_CODE_AGENT)
| Phase | Domain | Description | Files | Steps | Depends On |
|-------|--------|-------------|-------|-------|------------|
| 1 | backend | {description} | `file1`, `file2` | 1-3 | - |
| 2 | frontend | {description} | `file3`, `file4` | 4-6 | Phase 1 |

### Implementation Plan
| Step | Action | Files | Tests | Depends On |
|------|--------|-------|-------|------------|
| 1 | {action} | `file` | `test_file` | - |
| 2 | {action} | `file` | `test_file` | Step 1 |

### Risk Assessment
| Risk | Mitigation |
|------|------------|
| {issue} | {approach} |

### Complexity
{Low | Medium | High} - {reasoning}
```
