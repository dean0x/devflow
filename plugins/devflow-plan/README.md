# devflow-plan

Unified design planning plugin. Combines requirements discovery, gap analysis, implementation planning, and design review into a single workflow that produces a machine-readable design artifact.

## Commands

| Command | Description |
|---------|-------------|
| `/plan <description>` | Plan a feature from description |
| `/plan #42` | Plan from a GitHub issue |
| `/plan #12 #15 #18` | Plan across multiple issues |
| `/plan` | Plan from conversation context |

## Agents

| Agent | Purpose |
|-------|---------|
| `git` | Fetch GitHub issues (single and batch) |
| `skimmer` | Codebase orientation |
| `synthesizer` | Combines exploration, gap analysis, and planning outputs |
| `designer` | Gap analysis and design review (mode-driven) |

## Workflow

17-phase pipeline organized in 7 blocks:

1. **Requirements Discovery** — Orient, explore requirements, synthesize
2. **Gap Analysis** — Parallel analysis across completeness, architecture, security, performance
3. **Scope Approval** — Mandatory gate to validate scope and gap resolutions
4. **Implementation Design** — Explore implementation, plan steps and tests
5. **Design Review** — Anti-pattern detection in the implementation plan
6. **Plan Approval** — Mandatory gate to confirm plan and accept design review findings
7. **Output** — Write design artifact, optionally create GitHub issue

## Output

Design artifacts written to `.docs/design/` with YAML frontmatter consumable by `/implement`.

## Next Step

```
/implement {artifact-path}
/implement #{issue-number}
```
