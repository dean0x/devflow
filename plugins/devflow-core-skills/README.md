# devflow-core-skills

Auto-activating quality enforcement skills for Claude Code. These skills activate automatically based on context to enforce best practices.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=core-skills

# Via Claude Code (when available)
/plugin install dean0x/devflow-core-skills
```

## Skills Included

| Skill | Auto-Triggers When | What It Enforces |
|-------|-------------------|------------------|
| `software-design` | Business logic, error handling | Result types, DI, immutability, workaround labeling |
| `git` | Git operations, commits, PRs, GitHub API | Sequential ops, atomic commits, PR descriptions, rate limiting |
| `testing` | Tests written or modified | Test quality, setup complexity, behavior testing, coverage |
| `boundary-validation` | API endpoints, external data handling | Boundary validation, parse-don't-validate |
| `typescript` | TypeScript codebases | Type safety, generics, utility types |
| `react` | React codebases | Components, hooks, state management |

## How Auto-Activation Works

Skills monitor context and activate when their trigger conditions are met. You don't need to invoke them manually - they provide guidance and enforcement automatically.

## Iron Laws

Each skill enforces a non-negotiable principle:

| Skill | Iron Law |
|-------|----------|
| `software-design` | NEVER THROW IN BUSINESS LOGIC |
| `git` | EVERY COMMIT TELLS AN HONEST, ATOMIC STORY |
| `testing` | TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION |
| `boundary-validation` | ALL EXTERNAL DATA IS HOSTILE |
| `typescript` | UNKNOWN OVER ANY |
| `react` | COMPOSITION OVER PROPS |

## Usage

No manual invocation needed. Skills activate automatically. To see what a skill enforces, check its SKILL.md file in the skills directory.

## Related Plugins

- [devflow-implement](../devflow-implement) - Implementation workflow with additional skills
- [devflow-code-review](../devflow-code-review) - Review with pattern skills
