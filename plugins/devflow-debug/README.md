# devflow-debug

Debugging workflow plugin for Claude Code. Investigates bugs using competing hypotheses for adversarial debate.

## Installation

```bash
# Via Devflow CLI
npx devflow-kit init --plugin=debug

# Via Claude Code (when available)
/plugin install dean0x/devflow-debug
```

## Usage

```
/debug "description of bug"
/debug "login fails after session timeout"
/debug #42   (investigate from GitHub issue)
```

## How It Works

1. **Hypothesis Generation** - Analyzes the bug and generates 3-5 distinct hypotheses
2. **Investigation Spawning** - Creates one investigator agent per hypothesis
3. **Parallel Investigation** - Each agent independently gathers evidence
4. **Adversarial Evaluation** - Competing hypotheses are weighed against each other's evidence by the orchestrator
5. **Convergence** - Hypotheses that survive scrutiny become the root cause
6. **Report** - Root cause with confidence level, evidence, and fix recommendations

## Components

### Command
- `/debug` - Competing hypothesis debugging

### Skills
- `git` - Git safety, commits, GitHub API

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

- [devflow-code-review](../devflow-code-review) - Comprehensive code review
- [devflow-implement](../devflow-implement) - Implementation with quality gates
