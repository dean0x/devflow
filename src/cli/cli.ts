#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('devflow')
  .description('Agentic Development Toolkit for Claude Code')
  .version('1.0.0');

// Register commands
program.addCommand(initCommand);

program.parse();