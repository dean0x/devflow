# devflow-catch-up

Context restoration plugin for Claude Code. Reads development status logs to quickly get up to speed on project state.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=catch-up

# Via Claude Code (when available)
/plugin install dean0x/devflow-catch-up
```

## Usage

```
/catch-up              # Get up to speed on recent work
/catch-up --since=7d   # Last 7 days of activity
```

## What It Provides

- Recent commits and their purpose
- Open PRs and their status
- Pending issues and blockers
- Recent decisions and rationale
- Current branch state

## Components

### Command
- `/catch-up` - Review recent status updates

### Agents
- `catch-up` - Context restoration agent

### Skills
- `docs-framework` - Documentation conventions

## Output

- Summary written to `.docs/CATCH_UP.md`
- Key context points highlighted
- Actionable next steps suggested

## Requirements

Works best when paired with regular `/devlog` usage to maintain status history in `.docs/status/`.

## Related Plugins

- [devflow-devlog](../devflow-devlog) - Create status logs to catch up from
