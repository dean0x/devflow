# devflow-devlog

Development session logging plugin for Claude Code. Documents progress, decisions, and context for future reference.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=devlog

# Via Claude Code (when available)
/plugin install dean0x/devflow-devlog
```

## Usage

```
/devlog                    # Create status log for current session
/devlog "Added auth flow"  # Create log with summary
```

## What Gets Logged

- Current branch and recent commits
- Files changed in session
- Decisions made and rationale
- Blockers encountered
- TODOs and next steps

## Components

### Command
- `/devlog` - Document session progress

### Agents
- `devlog` - Development logging agent

### Skills
- `docs-framework` - Documentation conventions

## Output

Creates timestamped files in `.docs/status/`:
- `{timestamp}.md` - Full status log
- `compact/{timestamp}.md` - Abbreviated version
- `INDEX.md` - Updated index of all logs

## Best Practices

- Run `/devlog` at the end of each work session
- Include blockers and next steps
- Use with `/catch-up` for seamless context switching

## Related Plugins

- [devflow-catch-up](../devflow-catch-up) - Restore context from logs
