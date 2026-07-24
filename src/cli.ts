#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './cli/commands/init.js';
import { uninstallCommand } from './cli/commands/uninstall.js';
import { ambientCommand } from './cli/commands/ambient.js';
import { memoryCommand } from './cli/commands/memory.js';
import { skillsCommand } from './cli/commands/skills.js';
import { hudCommand } from './cli/commands/hud.js';
import { flagsCommand } from './cli/commands/flags.js';
import { knowledgeCommand } from './cli/commands/knowledge/index.js';
import { learningCommand } from './cli/commands/learning.js';
import { rulesCommand } from './cli/commands/rules.js';
import { debugCommand } from './cli/commands/debug.js';
import { securityCommand } from './cli/commands/security.js';
import { safeDeleteCommand } from './cli/commands/safe-delete.js';
import { proxyCommand } from './cli/commands/proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

program
  .name('devflow')
  .description('Agentic Development Toolkit for Claude Code\n\nEnhance your AI-assisted development with intelligent commands and workflows.')
  .version(packageJson.version, '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help information')
  .addHelpText('after', '\nExamples:\n  $ devflow init                       Install all Devflow plugins\n  $ devflow init --plugin=implement    Install specific plugin\n  $ devflow init --plugin=implement,code-review  Install multiple plugins\n  $ devflow ambient --enable           Enable always-on ambient mode\n  $ devflow memory --status            Check working memory state\n  $ devflow hud --status               Show current HUD config\n  $ devflow security --status          Check security deny list state\n  $ devflow security --disable         Remove the security deny list\n  $ devflow safe-delete --status       Check safe-delete shell function state\n  $ devflow safe-delete --enable       Install safe-delete shell function\n  $ devflow uninstall                  Remove Devflow from Claude Code\n  $ devflow --version                  Show version\n  $ devflow --help                     Show help\n\nDocumentation:\n  https://github.com/dean0x/devflow#readme');

// Register commands
program.addCommand(initCommand);
program.addCommand(uninstallCommand);
program.addCommand(ambientCommand);
program.addCommand(memoryCommand);
program.addCommand(skillsCommand);
program.addCommand(hudCommand);
program.addCommand(flagsCommand);
program.addCommand(knowledgeCommand);
program.addCommand(learningCommand);
program.addCommand(rulesCommand);
program.addCommand(debugCommand);
program.addCommand(securityCommand);
program.addCommand(safeDeleteCommand);
program.addCommand(proxyCommand);

// Handle no command (bare `devflow`) or unknown subcommand.
// When Commander sees an unrecognised first argument it does not route to any
// registered subcommand; instead the root action fires with that argument
// present in program.args. Detect that case and exit non-zero so callers
// (scripts, CI) can distinguish a typo from a successful no-op help print.
program.action(() => {
  if (program.args.length > 0) {
    program.error(`unknown command '${program.args[0]}'`);
  }
  program.help();
});

// Parse arguments
program.parse();

// Show help if no arguments
if (!process.argv.slice(2).length) {
  program.outputHelp();
}