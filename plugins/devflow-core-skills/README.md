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
| `commit` | Staging files, creating commits | Atomic commits, message format, safety scanning |
| `pull-request` | Creating PRs, generating descriptions | PR quality, size assessment, breaking change detection |
| `test-design` | Tests written or modified | Test quality, setup complexity, behavior testing |
| `code-smell` | Features implemented, code reviewed | Anti-patterns, fake solutions, magic values |
| `input-validation` | API endpoints, external data handling | Boundary validation, parse-don't-validate |
| `typescript` | TypeScript codebases | Type safety, generics, utility types |
| `react` | React codebases | Components, hooks, state management |

## How Auto-Activation Works

Skills monitor context and activate when their trigger conditions are met. You don't need to invoke them manually - they provide guidance and enforcement automatically.

## Iron Laws

Each skill enforces a non-negotiable principle:

| Skill | Iron Law |
|-------|----------|
| `commit` | ATOMIC COMMITS OR NO COMMITS |
| `pull-request` | HONEST DESCRIPTIONS OR NO PR |
| `test-design` | COMPLEX TESTS INDICATE BAD DESIGN |
| `code-smell` | NO FAKE SOLUTIONS |
| `input-validation` | ALL EXTERNAL DATA IS HOSTILE |
| `typescript` | UNKNOWN OVER ANY |
| `react` | COMPOSITION OVER PROPS |

## Usage

No manual invocation needed. Skills activate automatically. To see what a skill enforces, check its SKILL.md file in the skills directory.

## Related Plugins

- [devflow-implement](../devflow-implement) - Implementation workflow with additional skills
- [devflow-review](../devflow-review) - Review with pattern skills
