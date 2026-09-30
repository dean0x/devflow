/**
 * The `--help` text states what a switch really does (#406 items 13, 32).
 *
 *   - `init --no-compliance` removes only the rule: every install carries the
 *     compliance skill and all its framework references.
 *   - `memory|learning|knowledge --enable` sets the machine switch, which a
 *     repository's `.devflow/project.json` or `.devflow/config.json` can still
 *     narrow (D-FEATURES-NARROW-ONLY), so "every project" is qualified.
 */
import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { initCommand } from '../src/cli/commands/init.js';
import { memoryCommand } from '../src/cli/commands/memory.js';
import { learningCommand } from '../src/cli/commands/learning.js';
import { knowledgeCommand } from '../src/cli/commands/knowledge/index.js';

function optionHelp(command: Command, flag: string): string {
  const option = command.options.find(o => o.long === flag || o.flags.startsWith(flag));
  if (option === undefined) throw new Error(`${command.name()} has no ${flag} option`);
  return option.description;
}

describe('option help text', () => {
  it('init --no-compliance says only the rule is removed', () => {
    const help = optionHelp(initCommand, '--no-compliance');
    expect(help).toContain('removes the rule');
    expect(help).toContain('the skill and framework references stay installed');
    expect(help).not.toContain('artifacts removed');
  });

  it.each([
    ['memory', memoryCommand],
    ['learning', learningCommand],
    ['knowledge', knowledgeCommand],
  ])('%s --enable notes that a repository can opt out', (_name, command) => {
    expect(optionHelp(command, '--enable')).toMatch(/every project \(a repository can opt out\)$/);
  });
});
