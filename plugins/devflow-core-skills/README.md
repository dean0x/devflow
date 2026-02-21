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
| `core-patterns` | Business logic, error handling | Result types, DI, immutability, workaround labeling |
| `git-workflow` | Staging files, creating commits, PRs | Atomic commits, message format, PR descriptions |
| `test-patterns` | Tests written or modified | Test quality, setup complexity, behavior testing, coverage |
| `input-validation` | API endpoints, external data handling | Boundary validation, parse-don't-validate |
| `typescript` | TypeScript codebases | Type safety, generics, utility types |
| `react` | React codebases | Components, hooks, state management |

## How Auto-Activation Works

Skills monitor context and activate when their trigger conditions are met. You don't need to invoke them manually - they provide guidance and enforcement automatically.

## Iron Laws

Each skill enforces a non-negotiable principle:

| Skill | Iron Law |
|-------|----------|
| `core-patterns` | NEVER THROW IN BUSINESS LOGIC |
| `git-workflow` | ATOMIC COMMITS WITH HONEST DESCRIPTIONS |
| `test-patterns` | TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION |
| `input-validation` | ALL EXTERNAL DATA IS HOSTILE |
| `typescript` | UNKNOWN OVER ANY |
| `react` | COMPOSITION OVER PROPS |

## Usage

No manual invocation needed. Skills activate automatically. To see what a skill enforces, check its SKILL.md file in the skills directory.

## Related Plugins

- [devflow-implement](../devflow-implement) - Implementation workflow with additional skills
- [devflow-review](../devflow-review) - Review with pattern skills
