/**
 * `devflow learning --configure` offers a project and a global scope for the
 * Learning model. D-LEARNING-MODEL-PRECEDENCE puts a `devflow agents` Learning
 * mapping between the project file and the global file, so choosing Global does
 * nothing for a user who has such a mapping. The hint has to say so, or the
 * Global option is silently ineffective for them.
 */

import { describe, it, expect } from 'vitest';
import { CONFIGURE_SCOPE_OPTIONS, learningModelOptions } from '../src/cli/commands/learning.js';
import { AGENT_CONFIG } from './fixtures/agent-config.js';

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

/**
 * `devflow learning --configure` recommends the model the Learning agent ships with
 * (D-LEARNING-SHIPPED-ROW). The recommendation is derived from the shipped row, so a
 * change of the shipped tier moves it without an edit here.
 */
describe('devflow learning --configure model options', () => {
  const recommended = (shipped: string | undefined): string[] =>
    learningModelOptions(shipped).filter(o => o.hint.startsWith('Recommended')).map(o => o.value);

  it('offers opus, sonnet and haiku, in that order', () => {
    expect(learningModelOptions('opus').map(o => o.value)).toEqual(['opus', 'sonnet', 'haiku']);
  });

  it('recommends exactly the shipped model, whichever of the three it is', () => {
    expect(recommended('opus')).toEqual(['opus']);
    expect(recommended('sonnet')).toEqual(['sonnet']);
    expect(recommended('haiku')).toEqual(['haiku']);
  });

  it('recommends nothing when the shipped model is none of the three, or unknown', () => {
    expect(recommended('gpt-5.6-sol')).toEqual([]);
    expect(recommended(undefined)).toEqual([]);
  });

  it('recommends the model of the Learning row in the agent-config table', () => {
    expect(recommended(AGENT_CONFIG.learning.model)).toEqual([AGENT_CONFIG.learning.model]);
  });

  it('keeps the wording an unrecommended option has always had', () => {
    const hints = Object.fromEntries(learningModelOptions('opus').map(o => [o.value, o.hint]));
    expect(hints).toEqual({
      opus: 'Recommended — highest quality for detection + curation judgment',
      sonnet: 'Good balance of quality and speed',
      haiku: 'Fastest, lowest cost',
    });
  });
});
