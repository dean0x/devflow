# Contributing to Devflow

Thanks for your interest in contributing to Devflow! This guide covers everything you need to get started.

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

After setup, Devflow commands (`/code-review`, `/implement`, etc.) are available in Claude Code.

## Project Structure

```
devflow/
├── src/assets/skills/   # 41 skills (single source of truth)
├── src/assets/agents/   # 17 agents (single source of truth)
├── src/assets/rules/    # 13 rules (single source of truth, flat .md files)
├── src/assets/commands/ # Command sources (.mds + 2 static .md; partials in _partials/)
├── src/assets/scripts/hooks/  # Working Memory + ambient hooks
├── src/core/            # Shared CLI logic (DEVFLOW_PLUGINS registry, paths, flags, …)
├── src/cli/             # TypeScript CLI command modules (init, list, uninstall, …)
├── src/hud/             # HUD TypeScript source
├── src/targets/claude-code/ # Claude Code install target (installer, hooks, templates)
├── scripts/             # Dev tooling (build-mds.ts, bump-version.ts)
├── tests/               # Test suite (Vitest)
└── docs/reference/      # Detailed reference docs
```

For the full file organization, see [docs/reference/file-organization.md](docs/reference/file-organization.md).

## How to Add a New Skill

1. Create `src/assets/skills/{skill-name}/SKILL.md` with frontmatter and Iron Law
2. Add the skill name to the relevant plugin entry's `skills` array in `src/core/plugins.ts`
3. Run `node dist/cli.js init` to install locally (no rebuild required for skills)

Skills are read-only (`allowed-tools: Read, Grep, Glob`) and auto-activate based on context. Target ~120-150 lines per SKILL.md with progressive disclosure to `references/` subdirectories.

## How to Add a New Agent

1. Create `src/assets/agents/{agent-name}.md` with frontmatter
2. Add the agent name to the relevant plugin entry's `agents` array in `src/core/plugins.ts`
3. Run `node dist/cli.js init` to install locally (no rebuild required for agents)

Agents target 50-150 lines depending on type (Utility 50-80, Worker 80-120).

## How to Add a New Command or Plugin

See [docs/reference/adding-commands.md](docs/reference/adding-commands.md) for the full guide. The short version:

1. Create the command as a `.mds` (or `.md`) file in `src/assets/commands/`
2. Run `npm run build:mds` to compile `.mds` → `dist/commands/`
3. Add a new plugin entry to `DEVFLOW_PLUGINS` in `src/core/plugins.ts` with the command in its `commands` array
4. Run `node dist/cli.js init` to install

## Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Run tests in watch mode
```

## Build Commands

```bash
npm run build          # Full build (TypeScript + MDS command compilation)
npm run build:cli      # TypeScript compilation only
npm run build:mds      # Compile src/assets/commands/*.mds → dist/commands/
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
