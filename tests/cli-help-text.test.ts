/**
 * The `--help` text states what a switch really does (#406 items 13, 32).
 *
 *   - `init --no-compliance` removes only the rule: every install carries the
 *     compliance skill and all its framework references.
 *   - `memory|curation|knowledge --enable` sets the machine switch, which a
 *     repository's `.devflow/project.json` or `.devflow/config.json` can still
 *     narrow (D-FEATURES-NARROW-ONLY), so "every project" is qualified.
 */
import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { initCommand } from '../src/cli/commands/init.js';
import { memoryCommand } from '../src/cli/commands/memory.js';
import { curationCommand } from '../src/cli/commands/curation.js';
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
    ['curation', curationCommand],
    ['knowledge', knowledgeCommand],
  ])('%s --enable notes that a repository can opt out', (_name, command) => {
    expect(optionHelp(command, '--enable')).toMatch(/every project \(a repository can opt out\)$/);
  });
});

describe('curation help text (#529)', () => {
  it('is registered as curation, with no alias', () => {
    expect(curationCommand.name()).toBe('curation');
    expect(curationCommand.aliases()).toEqual([]);
  });

  it('names no other feature word in the command text, its options or the full help', () => {
    const text = [
      curationCommand.description(),
      ...curationCommand.options.map(o => `${o.flags} ${o.description}`),
      curationCommand.helpInformation(),
    ].join('\n');
    expect(text).not.toMatch(/learning/i);
  });

  it('--configure names the tuning file it writes, curation.json', () => {
    expect(optionHelp(curationCommand, '--configure')).toContain('curation.json');
  });

  it('every option still has help text', () => {
    for (const option of curationCommand.options) {
      expect(option.description, option.flags).not.toBe('');
    }
  });
});
