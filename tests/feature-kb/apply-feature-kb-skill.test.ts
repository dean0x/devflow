import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('feature-kb skill', () => {
  const content = readFileSync(path.join(ROOT, 'shared/skills/feature-kb/SKILL.md'), 'utf8');

  it('has iron law', () => { expect(content).toContain('## Iron Law'); });
  it('has 4-phase process', () => {
    expect(content).toContain('### Phase 1: Scan');
    expect(content).toContain('### Phase 2: Extract');
    expect(content).toContain('### Phase 3: Distill');
    expect(content).toContain('### Phase 4: Forge');
  });
  it('has quality self-checks', () => { expect(content).toContain('## Quality Self-Checks'); });
  it('has KB format template with required sections', () => {
    expect(content).toContain('## Overview');
    expect(content).toContain('## Anti-Patterns');
    expect(content).toContain('## Gotchas');
    expect(content).toContain('## Key Files');
    expect(content).toContain('## Related');
  });
  it('has category templates', () => {
    expect(content).toContain('**Architecture:**');
    expect(content).toContain('**Conventions:**');
    expect(content).toContain('**Component Patterns:**');
    expect(content).toContain('**Domain Knowledge:**');
    expect(content).toContain('**Lessons Learned:**');
  });
  it('has code example rules', () => {
    expect(content).toContain('Rules for Code Examples');
  });
  it('has worked example', () => {
    expect(content).toContain('## Worked Example');
  });
});

describe('apply-feature-kb skill', () => {
  const content = readFileSync(path.join(ROOT, 'shared/skills/apply-feature-kb/SKILL.md'), 'utf8');

  it('has iron law', () => { expect(content).toContain('## Iron Law'); });
  it('has 3-step algorithm', () => {
    expect(content).toContain('### Step 1: Read the KB');
    expect(content).toContain('### Step 2: Apply to Current Task');
    expect(content).toContain('### Step 3: Supplement as Needed');
  });
  it('has skip guard', () => { expect(content).toContain('## Skip Guard'); });
  it('has staleness handling', () => { expect(content).toContain('## Staleness Handling'); });
  it('references (none) skip', () => { expect(content).toContain('(none)'); });
});
