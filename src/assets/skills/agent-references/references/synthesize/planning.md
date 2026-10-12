## Mode: Planning

Synthesize outputs from 3 Plan agents (implementation, testing, execution strategy).

**Process:**
1. Merge implementation steps with testing strategy
2. Apply execution strategy analysis to determine Code agent deployment
3. Identify dependencies between steps
4. Assess context risk based on file count and module breadth

**Execution Strategy Decision:**

Analyze 2 axes to determine strategy:

| Axis | Signals | Impact |
|------|---------|--------|
| **Artifact Independence** | Shared contracts? Integration points? Cross-file dependencies? | If coupled → SINGLE_CODE_AGENT |
| **Context Capacity** | File count, module breadth, pattern complexity | HIGH/CRITICAL → SEQUENTIAL_CODE_AGENTS |

**Context Risk Levels:**
- **LOW**: <10 files, single module → SINGLE_CODE_AGENT
- **MEDIUM**: 10-20 files, 2-3 modules → Consider SEQUENTIAL_CODE_AGENTS
- **HIGH**: 20-30 files, multiple modules → SEQUENTIAL_CODE_AGENTS (2-3 phases)
- **CRITICAL**: >30 files, cross-cutting concerns → SEQUENTIAL_CODE_AGENTS (more phases)

**Strategy Selection:**
- **SINGLE_CODE_AGENT** (~80%): Default. Coherent A→Z implementation. Best for consistency in naming, patterns, error handling.
- **SEQUENTIAL_CODE_AGENTS** (~15%): Context overflow risk or layered dependencies. Split into phases with handoff summaries.
- **PARALLEL_CODE_AGENTS** (~5%): True artifact independence - no shared contracts, no integration points. Rare.

**Output:**
```markdown
## Planning Synthesis

### Execution Strategy
**Type**: {SINGLE_CODE_AGENT | SEQUENTIAL_CODE_AGENTS | PARALLEL_CODE_AGENTS}
**Context Risk**: {LOW | MEDIUM | HIGH | CRITICAL}
**File Estimate**: {n} files across {m} modules
**Reason**: {why this strategy}

### Subtask Breakdown (if not SINGLE_CODE_AGENT)
| Phase | Domain | Description | Files | Depends On |
|-------|--------|-------------|-------|------------|
| 1 | backend | {description} | `file1`, `file2` | - |
| 2 | frontend | {description} | `file3`, `file4` | Phase 1 |

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
