#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { uninstallCommand } from './commands/uninstall.js';

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
  .addHelpText('after', '\nExamples:\n  $ devflow init              Install DevFlow for Claude Code\n  $ devflow init --verbose    Install with detailed output\n  $ devflow init --skip-docs  Install without creating .docs/ structure\n  $ devflow uninstall         Remove DevFlow from Claude Code\n  $ devflow --version         Show version\n  $ devflow --help            Show help\n\nDocumentation:\n  https://github.com/dean0x/devflow#readme');

// Register commands
program.addCommand(initCommand);
program.addCommand(uninstallCommand);

// Handle no command
program.action(() => {
  program.help();
});

// Parse arguments
program.parse();

// Show help if no arguments
if (!process.argv.slice(2).length) {
  program.outputHelp();
}