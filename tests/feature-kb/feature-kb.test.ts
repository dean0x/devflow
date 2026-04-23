import { describe, it, expect, afterAll } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import {
  SAMPLE_INDEX,
  SAMPLE_KB_CONTENT,
  makeTmpFeatureWorktree,
  cleanupTmpFeatureWorktrees,
} from './fixtures';

afterAll(() => cleanupTmpFeatureWorktrees());

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const {
  loadIndex,
  loadKBContent,
  checkStaleness,
  checkAllStaleness,
  updateIndex,
  markStale,
  removeEntry,
  listKBs,
} = require(path.join(ROOT, 'scripts/hooks/lib/feature-kb.cjs')) as {
  loadIndex: (worktreePath: string) => { version: number; features: Record<string, unknown> } | null;
  loadKBContent: (worktreePath: string, slug: string) => string | null;
  checkStaleness: (worktreePath: string, slug: string) => { stale: boolean; changedFiles: string[] };
  checkAllStaleness: (worktreePath: string) => Record<string, { stale: boolean; changedFiles: string[] }>;
  updateIndex: (worktreePath: string, entry: Record<string, unknown>) => void;
  markStale: (worktreePath: string, changedFiles: string[]) => string[];
  removeEntry: (worktreePath: string, slug: string) => void;
  listKBs: (worktreePath: string) => Array<{ slug: string } & Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// loadIndex
// ---------------------------------------------------------------------------

describe('loadIndex', () => {
  it('returns parsed object for valid JSON', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = loadIndex(tmp);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.features['cli-commands']).toBeDefined();
  });

  it('returns null for missing directory', () => {
    const tmp = makeTmpFeatureWorktree(); // no index written
    // Remove the .features dir to simulate completely missing
    const { rmSync } = require('fs');
    rmSync(path.join(tmp, '.features'), { recursive: true, force: true });
    expect(loadIndex(tmp)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const tmp = makeTmpFeatureWorktree();
    writeFileSync(path.join(tmp, '.features', 'index.json'), 'not-json');
    expect(loadIndex(tmp)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadKBContent
// ---------------------------------------------------------------------------

describe('loadKBContent', () => {
  it('returns content string when KNOWLEDGE.md exists', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX, { 'cli-commands': SAMPLE_KB_CONTENT });
    const content = loadKBContent(tmp, 'cli-commands');
    expect(content).not.toBeNull();
    expect(content).toContain('# CLI Command System');
  });

  it('returns null for missing KB', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    expect(loadKBContent(tmp, 'cli-commands')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkStaleness
// ---------------------------------------------------------------------------

describe('checkStaleness', () => {
  it('returns stale: false when entry is not found in index', () => {
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    const result = checkStaleness(tmp, 'nonexistent');
    expect(result.stale).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it('returns stale: false for non-git repos', () => {
    // tmp dir has no git init, so it is a non-git directory
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = checkStaleness(tmp, 'cli-commands');
    expect(result.stale).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateIndex
// ---------------------------------------------------------------------------

describe('updateIndex', () => {
  it('creates a new entry in an empty index', () => {
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    updateIndex(tmp, {
      slug: 'payments',
      name: 'Payment Processing',
      directories: ['src/payments/'],
      referencedFiles: ['src/payments/checkout.ts'],
      category: 'component-patterns',
      createdBy: 'test',
    });
    const index = loadIndex(tmp);
    expect(index!.features['payments']).toBeDefined();
    const entry = index!.features['payments'] as Record<string, unknown>;
    expect(entry.name).toBe('Payment Processing');
    expect(entry.category).toBe('component-patterns');
  });

  it('upserts an existing entry, preserving createdBy', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    updateIndex(tmp, {
      slug: 'cli-commands',
      name: 'CLI Command System Updated',
      directories: ['src/cli/'],
      referencedFiles: ['src/cli/cli.ts'],
      category: 'conventions',
    });
    const index = loadIndex(tmp);
    const entry = index!.features['cli-commands'] as Record<string, unknown>;
    expect(entry.name).toBe('CLI Command System Updated');
    expect(entry.category).toBe('conventions');
    // createdBy should be preserved from original
    expect(entry.createdBy).toBe('plan:orch');
  });

  it('sets lastUpdated to a current ISO timestamp', () => {
    const before = new Date().toISOString();
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    updateIndex(tmp, {
      slug: 'test-slug',
      name: 'Test',
      directories: [],
      referencedFiles: [],
      category: 'architecture',
    });
    const after = new Date().toISOString();
    const index = loadIndex(tmp);
    const entry = index!.features['test-slug'] as Record<string, unknown>;
    const updated = entry.lastUpdated as string;
    expect(updated >= before).toBe(true);
    expect(updated <= after).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeEntry
// ---------------------------------------------------------------------------

describe('removeEntry', () => {
  it('removes entry from index and deletes its directory', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX, { 'cli-commands': SAMPLE_KB_CONTENT });
    const kbDir = path.join(tmp, '.features', 'cli-commands');
    expect(existsSync(kbDir)).toBe(true);

    removeEntry(tmp, 'cli-commands');

    const index = loadIndex(tmp);
    expect(index!.features['cli-commands']).toBeUndefined();
    expect(existsSync(kbDir)).toBe(false);
  });

  it('is a no-op for a non-existent slug', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    // Should not throw
    expect(() => removeEntry(tmp, 'nonexistent')).not.toThrow();
    // Original entry should still exist
    const index = loadIndex(tmp);
    expect(index!.features['cli-commands']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// markStale
// ---------------------------------------------------------------------------

describe('markStale', () => {
  it('identifies KBs whose referencedFiles overlap with changed files', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const stale = markStale(tmp, ['src/cli/cli.ts', 'some/other/file.ts']);
    expect(stale).toContain('cli-commands');
  });

  it('returns empty array when no overlap', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const stale = markStale(tmp, ['src/payments/checkout.ts', 'src/unrelated.ts']);
    expect(stale).toEqual([]);
  });

  it('returns empty array for missing index', () => {
    const tmp = makeTmpFeatureWorktree();
    const stale = markStale(tmp, ['src/cli/cli.ts']);
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listKBs
// ---------------------------------------------------------------------------

describe('listKBs', () => {
  it('returns all entries with their slugs', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const entries = listKBs(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe('cli-commands');
    expect(entries[0].name).toBe('CLI Command System');
  });

  it('returns empty array for missing index', () => {
    const tmp = makeTmpFeatureWorktree();
    expect(listKBs(tmp)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkAllStaleness
// ---------------------------------------------------------------------------

describe('checkAllStaleness', () => {
  it('returns empty object for missing index', () => {
    const tmp = makeTmpFeatureWorktree();
    expect(checkAllStaleness(tmp)).toEqual({});
  });

  it('returns an entry per slug', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = checkAllStaleness(tmp);
    expect(result['cli-commands']).toBeDefined();
    expect(result['cli-commands']).toHaveProperty('stale');
    expect(result['cli-commands']).toHaveProperty('changedFiles');
  });
});
