import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('knowledge agent', () => {
  const content = readFileSync(path.join(ROOT, 'shared/agents/knowledge.md'), 'utf8');

  it('has correct model', () => { expect(content).toContain('model: sonnet'); });
  it('has feature-kb skill', () => { expect(content).toContain('devflow:feature-kb'); });
  it('has worktree-support skill', () => { expect(content).toContain('devflow:worktree-support'); });
  it('has required tools', () => {
    expect(content).toContain('Read');
    expect(content).toContain('Grep');
    expect(content).toContain('Glob');
    expect(content).toContain('Write');
  });
  it('documents input contract', () => {
    expect(content).toContain('FEATURE_SLUG');
    expect(content).toContain('FEATURE_NAME');
    expect(content).toContain('EXPLORATION_OUTPUTS');
    expect(content).toContain('DIRECTORIES');
    expect(content).toContain('KNOWLEDGE_CONTEXT');
  });
  it('constrains writes to .features/', () => {
    expect(content).toContain('.features/');
    expect(content).toContain('Boundaries');
  });
});
