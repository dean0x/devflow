# devflow-specify

Interactive feature specification plugin for Claude Code. Creates well-defined GitHub issues through requirements exploration and clarification.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=specify

# Via Claude Code (when available)
/plugin install dean0x/devflow-specify
```

## Usage

```
/specify [feature idea]
```

The command guides you through mandatory clarification gates:
1. **Gate 0**: Confirm understanding of feature idea
2. **Gate 1**: Validate scope and priorities after exploration
3. **Gate 2**: Confirm acceptance criteria before issue creation

## Components

### Command
- `/specify` - Interactive feature specification workflow

### Agents
- `skimmer` - Codebase orientation using skim for file/function discovery
- `synthesizer` - Combines exploration outputs into coherent summary

## Output

Creates a well-defined GitHub issue with:
- Clear title and description
- Acceptance criteria
- Technical context from codebase exploration
- Priority and scope boundaries

## Related Plugins

- [devflow-implement](../devflow-implement) - Implement the specified feature
- [devflow-code-review](../devflow-code-review) - Review the implementation
