# Adding New Commands

## Command Structure

1. Decide which plugin the command belongs to (or create a new plugin)
2. Create command in `plugins/devflow-{plugin}/commands/new-command.md`
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

4. Test locally before committing
5. Update plugin README.md with user-facing documentation
6. Update `DEVFLOW_PLUGINS` in `src/cli/plugins.ts` if creating a new plugin

## Plugin Registration

When creating a new plugin:

1. Create plugin directory: `plugins/devflow-{name}/`
2. Create `.claude-plugin/plugin.json` manifest
3. Create `commands/`, `agents/`, and `skills/` directories as needed
4. Add to `DEVFLOW_PLUGINS` array in `src/cli/plugins.ts`
5. Run `npm run build` to distribute shared assets

## Command Design Principles

- **Orchestration-only**: Commands spawn agents, never do agent work in main session
- **Actionable output**: Specific problems with file/line references, clear severity, concrete fixes
- **Context preservation**: Create historical records in `.docs/`
- **Fail-safe defaults**: Err on the side of flagging issues

## Conventions

- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Commands are installed to `~/.claude/commands/devflow/`
- Plugin-specific agents go in `plugins/devflow-{name}/agents/` (not shared)
