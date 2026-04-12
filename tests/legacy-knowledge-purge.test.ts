import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { purgeLegacyKnowledgeEntries } from '../src/cli/utils/legacy-knowledge-purge.js';

describe('purgeLegacyKnowledgeEntries', () => {
  let tmpDir: string;
  let memoryDir: string;
  let knowledgeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-purge-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    knowledgeDir = path.join(memoryDir, 'knowledge');
    await fs.mkdir(knowledgeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns no-op result when .memory/knowledge/ does not exist', async () => {
    const emptyMemory = path.join(tmpDir, 'no-memory');
    const result = await purgeLegacyKnowledgeEntries({ memoryDir: emptyMemory });
    expect(result.removed).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('returns no-op result when knowledge/ exists but both files are absent', async () => {
    const result = await purgeLegacyKnowledgeEntries({ memoryDir });
    expect(result.removed).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('removes ADR-002 section from decisions.md, keeps ADR-001', async () => {
    const decisionsPath = path.join(knowledgeDir, 'decisions.md');
    const content = `<!-- TL;DR: 2 decisions. Key: -->

## ADR-001: Good decision

- **Status**: accepted
- Some good content

## ADR-002: Legacy decision

- **Status**: accepted
- This should be removed
`;
    await fs.writeFile(decisionsPath, content, 'utf-8');

    const result = await purgeLegacyKnowledgeEntries({ memoryDir });

    expect(result.removed).toBe(1);
    expect(result.files).toContain(decisionsPath);

    const updated = await fs.readFile(decisionsPath, 'utf-8');
    expect(updated).toContain('ADR-001');
    expect(updated).not.toContain('ADR-002');
    // TL;DR count should be updated from 2 to 1
    expect(updated).toContain('<!-- TL;DR: 1 decisions. Key: -->');
  });

  it('removes PF-001, PF-003, PF-005 from pitfalls.md, keeps PF-002, PF-004, PF-006', async () => {
    const pitfallsPath = path.join(knowledgeDir, 'pitfalls.md');
    const content = `<!-- TL;DR: 6 pitfalls. Key: -->

## PF-001: Legacy pitfall 1

- **Status**: active
- Remove me

## PF-002: Good pitfall

- **Status**: active
- Keep me

## PF-003: Legacy pitfall 3

- **Status**: active
- Remove me

## PF-004: Good pitfall 4

- **Status**: active
- Keep me

## PF-005: Legacy pitfall 5

- **Status**: active
- Remove me

## PF-006: Good pitfall 6

- **Status**: active
- Keep me
`;
    await fs.writeFile(pitfallsPath, content, 'utf-8');

    const result = await purgeLegacyKnowledgeEntries({ memoryDir });

    expect(result.removed).toBe(3);
    expect(result.files).toContain(pitfallsPath);

    const updated = await fs.readFile(pitfallsPath, 'utf-8');
    expect(updated).toContain('PF-002');
    expect(updated).toContain('PF-004');
    expect(updated).toContain('PF-006');
    expect(updated).not.toContain('PF-001');
    expect(updated).not.toContain('PF-003');
    expect(updated).not.toContain('PF-005');
    // TL;DR count updated from 6 to 3
    expect(updated).toContain('<!-- TL;DR: 3 pitfalls. Key: -->');
  });

  it('updates TL;DR count correctly after removals', async () => {
    const decisionsPath = path.join(knowledgeDir, 'decisions.md');
    const content = `<!-- TL;DR: 3 decisions. Key: -->

## ADR-001: Keep this

- **Status**: accepted

## ADR-002: Remove this

- **Status**: accepted

## ADR-003: Keep this too

- **Status**: accepted
`;
    await fs.writeFile(decisionsPath, content, 'utf-8');

    await purgeLegacyKnowledgeEntries({ memoryDir });

    const updated = await fs.readFile(decisionsPath, 'utf-8');
    expect(updated).toContain('<!-- TL;DR: 2 decisions. Key: -->');
  });

  it('removes orphan PROJECT-PATTERNS.md if present', async () => {
    const projectPatternsPath = path.join(memoryDir, 'PROJECT-PATTERNS.md');
    await fs.writeFile(projectPatternsPath, '# Old patterns', 'utf-8');

    const result = await purgeLegacyKnowledgeEntries({ memoryDir });

    expect(result.removed).toBe(1);
    expect(result.files).toContain(projectPatternsPath);
    await expect(fs.access(projectPatternsPath)).rejects.toThrow();
  });

  it('does not fail when PROJECT-PATTERNS.md is absent', async () => {
    const result = await purgeLegacyKnowledgeEntries({ memoryDir });
    expect(result.removed).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('acquires and releases .knowledge.lock during operation', async () => {
    const decisionsPath = path.join(knowledgeDir, 'decisions.md');
    await fs.writeFile(decisionsPath, `<!-- TL;DR: 1 decisions. Key: -->

## ADR-002: Legacy

- **Status**: accepted
`, 'utf-8');

    await purgeLegacyKnowledgeEntries({ memoryDir });

    // Lock directory must be released after the call
    const lockDir = path.join(memoryDir, '.knowledge.lock');
    await expect(fs.access(lockDir)).rejects.toThrow();
  });

  it('does not modify files when no legacy entries are present', async () => {
    const decisionsPath = path.join(knowledgeDir, 'decisions.md');
    const originalContent = `<!-- TL;DR: 1 decisions. Key: -->

## ADR-001: Keep this

- **Status**: accepted
- Content
`;
    await fs.writeFile(decisionsPath, originalContent, 'utf-8');

    const result = await purgeLegacyKnowledgeEntries({ memoryDir });

    expect(result.removed).toBe(0);
    // decisions.md was not listed as modified
    expect(result.files).not.toContain(decisionsPath);
    const after = await fs.readFile(decisionsPath, 'utf-8');
    expect(after).toBe(originalContent);
  });

  it('handles both files in a single call', async () => {
    const decisionsPath = path.join(knowledgeDir, 'decisions.md');
    const pitfallsPath = path.join(knowledgeDir, 'pitfalls.md');

    await fs.writeFile(decisionsPath, `<!-- TL;DR: 1 decisions. Key: -->

## ADR-002: Remove

- **Status**: accepted
`, 'utf-8');

    await fs.writeFile(pitfallsPath, `<!-- TL;DR: 1 pitfalls. Key: -->

## PF-001: Remove

- **Status**: active
`, 'utf-8');

    const result = await purgeLegacyKnowledgeEntries({ memoryDir });

    expect(result.removed).toBe(2);
    expect(result.files).toContain(decisionsPath);
    expect(result.files).toContain(pitfallsPath);
  });
});
