import { describe, it, expect, afterAll } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, rmdirSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
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
  findOverlapping,
  removeEntry,
  listKBs,
  validateSlug,
} = require(path.join(ROOT, 'scripts/hooks/lib/feature-kb.cjs')) as {
  loadIndex: (worktreePath: string) => { version: number; features: Record<string, unknown> } | null;
  loadKBContent: (worktreePath: string, slug: string) => string | null;
  checkStaleness: (worktreePath: string, slug: string) => { stale: boolean; changedFiles: string[] };
  checkAllStaleness: (worktreePath: string) => Record<string, { stale: boolean; changedFiles: string[] }>;
  updateIndex: (worktreePath: string, entry: Record<string, unknown>, lockTimeoutMs?: number) => void;
  findOverlapping: (worktreePath: string, changedFiles: string[]) => string[];
  removeEntry: (worktreePath: string, slug: string, lockTimeoutMs?: number) => void;
  listKBs: (worktreePath: string) => Array<{ slug: string } & Record<string, unknown>>;
  validateSlug: (slug: string) => void;
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
// checkStaleness (positive — git repo)
// ---------------------------------------------------------------------------

// T2: Positive staleness detection in a real git repo
describe('checkStaleness (positive — git repo)', () => {
  it('detects stale KB when referenced file changed after lastUpdated', () => {
    const tmp = makeTmpFeatureWorktree();
    // Remove auto-created .features dir — we'll set it up after git init
    rmSync(path.join(tmp, '.features'), { recursive: true, force: true });

    // Initialize git repo with initial commit
    execSync('git init', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmp, stdio: 'pipe' });

    // Create a tracked file and commit it
    const srcDir = path.join(tmp, 'src', 'cli');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(path.join(srcDir, 'cli.ts'), 'export const v = 1;');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmp, stdio: 'pipe' });

    // Set lastUpdated to just before now
    const lastUpdated = new Date(Date.now() - 5000).toISOString();

    // Create the index with a KB that references src/cli/cli.ts
    const featuresDir = path.join(tmp, '.features');
    mkdirSync(featuresDir, { recursive: true });
    const index = {
      version: 1,
      features: {
        'my-feature': {
          name: 'My Feature',
          description: '',
          directories: ['src/cli/'],
          referencedFiles: ['src/cli/cli.ts'],
          category: 'test',
          lastUpdated,
          createdBy: 'test',
        },
      },
    };
    writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify(index, null, 2));

    // Modify the file and commit
    writeFileSync(path.join(srcDir, 'cli.ts'), 'export const v = 2;');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "update cli.ts"', { cwd: tmp, stdio: 'pipe' });

    const result = checkStaleness(tmp, 'my-feature');
    expect(result.stale).toBe(true);
    expect(result.changedFiles).toContain('src/cli/cli.ts');
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
    expect(index).not.toBeNull();
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
    expect(index).not.toBeNull();
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
    expect(index).not.toBeNull();
    const entry = index!.features['test-slug'] as Record<string, unknown>;
    const updated = entry.lastUpdated as string;
    expect(updated >= before).toBe(true);
    expect(updated <= after).toBe(true);
  });

  // T1: Lock failure
  it('throws when lock cannot be acquired within timeout', () => {
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    const lockPath = path.join(tmp, '.features', '.kb.lock');
    // Pre-create lock directory to simulate a held lock
    mkdirSync(lockPath);

    expect(() => updateIndex(tmp, {
      slug: 'test-lock',
      name: 'Test',
      directories: [],
      referencedFiles: [],
      category: 'test',
    }, 200)).toThrow(/lock/i);

    // Lock dir should still exist (not cleaned up by our failed attempt)
    expect(existsSync(lockPath)).toBe(true);
    // Clean up
    rmdirSync(lockPath);
  });

  // T4: Creates missing .features/ directory
  it('creates .features/ directory if missing', () => {
    const tmp = makeTmpFeatureWorktree();
    // Remove the .features dir
    rmSync(path.join(tmp, '.features'), { recursive: true, force: true });
    expect(existsSync(path.join(tmp, '.features'))).toBe(false);

    updateIndex(tmp, {
      slug: 'new-feature',
      name: 'New Feature',
      directories: ['src/new/'],
      referencedFiles: ['src/new/index.ts'],
      category: 'component-patterns',
    });

    expect(existsSync(path.join(tmp, '.features'))).toBe(true);
    const index = loadIndex(tmp);
    expect(index).not.toBeNull();
    expect(index!.features['new-feature']).toBeDefined();
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
    expect(index).not.toBeNull();
    expect(index!.features['cli-commands']).toBeUndefined();
    expect(existsSync(kbDir)).toBe(false);
  });

  it('is a no-op for a non-existent slug', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    // Should not throw
    expect(() => removeEntry(tmp, 'nonexistent')).not.toThrow();
    // Original entry should still exist
    const index = loadIndex(tmp);
    expect(index).not.toBeNull();
    expect(index!.features['cli-commands']).toBeDefined();
  });

  // T5: No-op when .features/ directory is missing
  it('is a no-op when .features/ directory does not exist', () => {
    const tmp = makeTmpFeatureWorktree();
    rmSync(path.join(tmp, '.features'), { recursive: true, force: true });
    expect(existsSync(path.join(tmp, '.features'))).toBe(false);

    // Should not throw
    expect(() => removeEntry(tmp, 'nonexistent')).not.toThrow();
  });

  it('preserves corrupt index.json on remove instead of overwriting', () => {
    const tmp = makeTmpFeatureWorktree();
    writeFileSync(path.join(tmp, '.features', 'index.json'), 'not-valid-json');
    removeEntry(tmp, 'nonexistent');
    const raw = readFileSync(path.join(tmp, '.features', 'index.json'), 'utf8');
    expect(raw).toBe('not-valid-json');
  });
});

// ---------------------------------------------------------------------------
// findOverlapping
// ---------------------------------------------------------------------------

describe('findOverlapping', () => {
  it('identifies KBs whose referencedFiles overlap with changed files', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const overlapping = findOverlapping(tmp, ['src/cli/cli.ts', 'some/other/file.ts']);
    expect(overlapping).toContain('cli-commands');
  });

  it('returns empty array when no overlap', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const overlapping = findOverlapping(tmp, ['src/payments/checkout.ts', 'src/unrelated.ts']);
    expect(overlapping).toEqual([]);
  });

  it('returns empty array for missing index', () => {
    const tmp = makeTmpFeatureWorktree();
    const overlapping = findOverlapping(tmp, ['src/cli/cli.ts']);
    expect(overlapping).toEqual([]);
  });

  it('does not match on common prefix without directory boundary', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    // 'src/cli' should NOT match 'src/clitools/foo.ts' (no dir boundary)
    const overlapping = findOverlapping(tmp, ['src/clitools/foo.ts']);
    expect(overlapping).not.toContain('cli-commands');
  });

  // T3: Directory boundary matching
  // referencedFiles uses no trailing slash so the startsWith(ref + '/') logic
  // in findOverlapping correctly matches nested files while rejecting
  // files that merely share a prefix (e.g. src/client vs src/cli).
  it('matches files under a referenced directory prefix', () => {
    const index = {
      version: 1,
      features: {
        'cli-feature': {
          name: 'CLI',
          description: '',
          directories: ['src/cli/'],
          referencedFiles: ['src/cli'],
          category: 'test',
          lastUpdated: new Date().toISOString(),
          createdBy: 'test',
        },
      },
    };
    const tmp = makeTmpFeatureWorktree(index);

    // File under the directory prefix — should match (src/cli is a prefix of src/cli/deep/file.ts)
    expect(findOverlapping(tmp, ['src/cli/deep/file.ts'])).toContain('cli-feature');

    // File NOT under the directory but sharing prefix — should NOT match
    // (src/cli is NOT a prefix of src/client.ts since there's no / after cli)
    expect(findOverlapping(tmp, ['src/client.ts'])).toEqual([]);
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

// ---------------------------------------------------------------------------
// validateSlug
// ---------------------------------------------------------------------------

describe('validateSlug', () => {
  it('accepts valid kebab-case slugs', () => {
    expect(() => validateSlug('cli-commands')).not.toThrow();
    expect(() => validateSlug('payments')).not.toThrow();
    expect(() => validateSlug('my-feature-123')).not.toThrow();
    expect(() => validateSlug('a')).not.toThrow();
  });

  it('rejects path traversal attempts', () => {
    expect(() => validateSlug('../etc')).toThrow(/must not contain/);
    expect(() => validateSlug('../../dangerous')).toThrow(/must not contain/);
    expect(() => validateSlug('foo/../bar')).toThrow(/must not contain/);
  });

  it('rejects slugs with slashes', () => {
    expect(() => validateSlug('foo/bar')).toThrow(/must not contain/);
    expect(() => validateSlug('foo\\bar')).toThrow(/must not contain/);
  });

  it('rejects slugs starting with a dot', () => {
    expect(() => validateSlug('.hidden')).toThrow(/must not start with/);
  });

  it('rejects non-kebab-case slugs', () => {
    expect(() => validateSlug('MyFeature')).toThrow(/kebab-case/);
    expect(() => validateSlug('my_feature')).toThrow(/kebab-case/);
    expect(() => validateSlug('MY-FEATURE')).toThrow(/kebab-case/);
    expect(() => validateSlug('')).toThrow(/non-empty/);
  });

  it('rejects empty and non-string values', () => {
    expect(() => validateSlug('')).toThrow();
    // @ts-expect-error testing runtime behavior
    expect(() => validateSlug(null)).toThrow();
    // @ts-expect-error testing runtime behavior
    expect(() => validateSlug(undefined)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CLI: stale-slugs subcommand
// ---------------------------------------------------------------------------

const FEATURE_KB_CJS = path.join(ROOT, 'scripts/hooks/lib/feature-kb.cjs');

describe('CLI stale-slugs', () => {
  it('outputs nothing for non-stale index (non-git repo)', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    // Non-git repo → checkAllStaleness returns stale: false for everything
    const output = execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs', tmp], { encoding: 'utf8' });
    expect(output.trim()).toBe('');
  });

  it('outputs stale slugs one per line for a git repo with changes', () => {
    const tmp = makeTmpFeatureWorktree();
    // Remove auto-created .features dir — we'll set it up after git init
    rmSync(path.join(tmp, '.features'), { recursive: true, force: true });

    execSync('git init', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmp, stdio: 'pipe' });

    const srcDir = path.join(tmp, 'src', 'cli');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(path.join(srcDir, 'cli.ts'), 'export const v = 1;');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmp, stdio: 'pipe' });

    const lastUpdated = new Date(Date.now() - 5000).toISOString();
    const featuresDir = path.join(tmp, '.features');
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify({
      version: 1,
      features: {
        'stale-feature': {
          name: 'Stale Feature',
          description: '',
          directories: ['src/cli/'],
          referencedFiles: ['src/cli/cli.ts'],
          category: 'test',
          lastUpdated,
          createdBy: 'test',
        },
      },
    }, null, 2));

    // Modify the referenced file and commit after lastUpdated
    writeFileSync(path.join(srcDir, 'cli.ts'), 'export const v = 2;');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "update cli.ts"', { cwd: tmp, stdio: 'pipe' });

    const output = execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs', tmp], { encoding: 'utf8' });
    expect(output.trim().split('\n')).toContain('stale-feature');
  });

  it('exits non-zero and prints usage when worktree argument is missing', () => {
    let threw = false;
    try {
      execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
      threw = true;
      expect((e as NodeJS.ErrnoException & { status?: number }).status).toBe(1);
    }
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI: refresh-context subcommand
// ---------------------------------------------------------------------------

describe('CLI refresh-context', () => {
  it('outputs tab-separated metadata for an existing KB entry', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const output = execFileSync('node', [FEATURE_KB_CJS, 'refresh-context', tmp, 'cli-commands'], { encoding: 'utf8' });
    const parts = output.trim().split('\t');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('CLI Command System');           // name
    expect(JSON.parse(parts[1])).toBeInstanceOf(Array);   // directories JSON
    expect(parts[2]).toBe('component-patterns');           // category
    expect(JSON.parse(parts[3])).toBeInstanceOf(Array);   // changed files JSON
  });

  it('exits non-zero when slug is missing', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    let threw = false;
    try {
      execFileSync('node', [FEATURE_KB_CJS, 'refresh-context', tmp], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
      threw = true;
      expect((e as NodeJS.ErrnoException & { status?: number }).status).toBe(1);
    }
    expect(threw).toBe(true);
  });

  it('exits non-zero when slug is not found in index', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    let threw = false;
    try {
      execFileSync('node', [FEATURE_KB_CJS, 'refresh-context', tmp, 'nonexistent'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
      threw = true;
      expect((e as NodeJS.ErrnoException & { status?: number }).status).toBe(1);
    }
    expect(threw).toBe(true);
  });

  it('exits non-zero for invalid slug (path traversal)', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    let threw = false;
    try {
      execFileSync('node', [FEATURE_KB_CJS, 'refresh-context', tmp, '../etc'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: unknown) {
      threw = true;
      expect((e as NodeJS.ErrnoException & { status?: number }).status).toBe(1);
    }
    expect(threw).toBe(true);
  });
});
