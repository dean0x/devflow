# Adding New Commands

## Command Structure

1. Decide which plugin the command belongs to (or create a new plugin)
2. Create the command source in `src/assets/commands/`:
   - Use `.mds` for commands that import MDS partials (most commands)
   - Use `.md` for simple static commands with no partials
3. Follow this template:

```markdown
# Command: /new-command

## Description
Brief description of what the command does.

## Usage
`/new-command [arguments]`

## Implementation
[Bash script or instructions for AI agent]

## Output Format
[Description of expected output]
```

4. If using `.mds`, run `npm run build:mds` to compile to `dist/commands/`
5. Add the command name to the plugin entry's `commands` array in DEVFLOW_PLUGINS (`src/core/plugins.ts`)
6. Run `node dist/cli.js init` to install locally
7. Test with the slash command

## Plugin Registration

When creating a new plugin:

1. Add a new entry to `DEVFLOW_PLUGINS` in `src/core/plugins.ts` with `name`, `description`, `commands`, `agents`, `skills`, `rules`, and `optional` fields
2. Create command source files in `src/assets/commands/` as needed
3. Create agent files in `src/assets/agents/` as needed
4. Run `npm run build && node dist/cli.js init`

## Command Design Principles

- **Orchestration-only**: Commands spawn agents, never do agent work in main session
- **Actionable output**: Specific problems with file/line references, clear severity, concrete fixes
- **Context preservation**: Create historical records in `.devflow/docs/`
- **Fail-safe defaults**: Err on the side of flagging issues

## Conventions

- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Commands are installed to `~/.claude/commands/devflow/` from `dist/commands/`
- All agents (shared and plugin-specific) live in `src/assets/agents/`
