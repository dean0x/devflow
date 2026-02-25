# devflow-debug

Debugging workflow plugin for Claude Code. Investigates bugs using competing hypotheses with agent teams for adversarial debate.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=debug

# Via Claude Code (when available)
/plugin install dean0x/devflow-debug
```

## Prerequisites

Requires Agent Teams feature:
- Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings (included in DevFlow settings)
- Or install DevFlow with `--override-settings` to enable automatically

## Usage

```
/debug "description of bug"
/debug "login fails after session timeout"
/debug #42   (investigate from GitHub issue)
```

## How It Works

1. **Hypothesis Generation** - Analyzes the bug and generates 3-5 distinct hypotheses
2. **Team Spawning** - Creates one investigator agent per hypothesis
3. **Parallel Investigation** - Each agent independently gathers evidence
4. **Adversarial Debate** - Agents challenge each other's findings with code evidence
5. **Convergence** - Hypotheses that survive scrutiny become the root cause
6. **Report** - Root cause with confidence level, evidence, and fix recommendations

## Components

### Command
- `/debug` - Competing hypothesis debugging

### Skills
- `agent-teams` - Team coordination patterns
- `git-safety` - Safe git operations

## Output

Produces a root cause analysis report including:
- Confirmed/disproved hypothesis summary
- Key evidence with file:line references
- Debate exchanges that led to conclusion
- Recommended fix with confidence level

## When to Use

- Bugs with unclear root cause
- Issues that could have multiple explanations
- Intermittent failures where the mechanism is unknown
- Complex bugs spanning multiple systems

## Related Plugins

- [devflow-code-review](../devflow-code-review) - Code review with team-based debate
- [devflow-implement](../devflow-implement) - Implementation with team exploration
