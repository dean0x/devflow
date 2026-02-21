# Contributing to DevFlow

Thanks for your interest in contributing to DevFlow! This guide covers everything you need to get started.

## Prerequisites

- **Node.js 18+** ([download](https://nodejs.org/))
- **Claude Code** ([download](https://claude.ai/download))
- **Git**

## Development Setup

```bash
git clone https://github.com/dean0x/devflow.git
cd devflow
npm install
npm run build
node dist/cli.js init
```

After setup, DevFlow commands (`/review`, `/implement`, etc.) are available in Claude Code.

## Project Structure

```
devflow/
├── shared/skills/       # 24 skills (single source of truth)
├── shared/agents/       # 10 shared agents (single source of truth)
├── plugins/devflow-*/   # 10 self-contained plugins
├── scripts/hooks/       # Working Memory hooks
├── src/cli/             # TypeScript CLI (init, list, uninstall)
├── tests/               # Test suite (Vitest)
└── docs/reference/      # Detailed reference docs
```

For the full file organization, see [docs/reference/file-organization.md](docs/reference/file-organization.md).

## How to Add a New Skill

1. Create `shared/skills/{skill-name}/SKILL.md` with frontmatter and Iron Law
2. Add the skill name to the relevant plugin's `skills` array in `src/cli/plugins.ts`
3. Run `npm run build` to distribute the skill to plugin directories
4. Run `node dist/cli.js init` to install locally

Skills are read-only (`allowed-tools: Read, Grep, Glob`) and auto-activate based on context. Target ~120-150 lines per SKILL.md with progressive disclosure to `references/` subdirectories.

## How to Add a New Agent

1. Create `shared/agents/{agent-name}.md` with frontmatter
2. Add the agent name to the relevant plugin's `agents` array in `src/cli/plugins.ts`
3. Run `npm run build` to distribute the agent to plugin directories
4. Run `node dist/cli.js init` to install locally

Agents target 50-150 lines depending on type (Utility 50-80, Worker 80-120).

## How to Add a New Command or Plugin

See [docs/reference/adding-commands.md](docs/reference/adding-commands.md) for the full guide. The short version:

1. Create a plugin directory under `plugins/devflow-{name}/`
2. Add a `plugin.json` manifest declaring commands, agents, and skills
3. Create command files in `plugins/devflow-{name}/commands/`
4. Register the plugin in `DEVFLOW_PLUGINS` in `src/cli/plugins.ts`
5. `npm run build && node dist/cli.js init`

## Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Run tests in watch mode
```

## Build Commands

```bash
npm run build          # Full build (TypeScript + skill/agent distribution)
npm run build:cli      # TypeScript compilation only
npm run build:plugins  # Skill/agent distribution only
```

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `test:` — Adding or updating tests
- `chore:` — Build process, tooling, or auxiliary changes

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes with tests
4. Run `npm run build && npm test` to verify
5. Submit a PR against `main`

Keep PRs focused on a single concern. Include a clear description of what changed and why.

## Code of Conduct

Be respectful, constructive, and collaborative. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
