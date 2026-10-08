/**
 * `devflow learning --configure` offers a project and a global scope for the
 * Learning model. D-LEARNING-MODEL-PRECEDENCE puts a `devflow agents` Learning
 * mapping between the project file and the global file, so choosing Global does
 * nothing for a user who has such a mapping. The hint has to say so, or the
 * Global option is silently ineffective for them.
 */

import { describe, it, expect } from 'vitest';
import { CONFIGURE_SCOPE_OPTIONS } from '../src/cli/commands/learning.js';

describe('devflow learning --configure scope options', () => {
  const hintOf = (value: string): string => {
    const option = CONFIGURE_SCOPE_OPTIONS.find(o => o.value === value);
    if (option === undefined) throw new Error(`no ${value} scope option`);
    return option.hint;
  };

  it('offers the project and global scopes, in that order', () => {
    expect(CONFIGURE_SCOPE_OPTIONS.map(o => o.value)).toEqual(['project', 'global']);
  });

  it('the Global hint still names the file it writes', () => {
    expect(hintOf('global')).toContain('~/.devflow/learning.json');
  });

  it('the Global hint says a devflow agents Learning mapping takes precedence over the global file', () => {
    const hint = hintOf('global');
    expect(hint).toContain('devflow agents');
    expect(hint).toMatch(/Learning mapping/);
    expect(hint).toMatch(/takes precedence/);
  });

  it('the Project hint is unchanged: a project file outranks the mapping', () => {
    expect(hintOf('project')).toBe('This project only (.devflow/learning/learning.json)');
  });
});
