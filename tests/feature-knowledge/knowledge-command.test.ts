import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import { readFileSync, rmSync } from 'fs';
import { makeTmpFeatureWorktree, cleanupTmpFeatureWorktrees, SAMPLE_INDEX } from './fixtures';

afterAll(() => cleanupTmpFeatureWorktrees());

const ROOT = path.resolve(import.meta.dirname, '../..');
const CJS_PATH = path.join(ROOT, 'scripts/hooks/lib/feature-kb.cjs');

describe('feature-kb.cjs CLI', () => {
  it('list shows entries', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = execSync(`node ${CJS_PATH} list ${tmp}`, { encoding: 'utf8' });
    const entries = JSON.parse(result);
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe('cli-commands');
    expect(entries[0].name).toBe('CLI Command System');
  });

  it('list returns empty array for missing index', () => {
    const tmp = makeTmpFeatureWorktree();
    // Remove the index file so index is missing
    try { rmSync(path.join(tmp, '.features', 'index.json')); } catch { /* ignore */ }
    const result = execSync(`node ${CJS_PATH} list ${tmp}`, { encoding: 'utf8' });
    expect(JSON.parse(result)).toEqual([]);
  });

  it('stale returns staleness for slug', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = execSync(`node ${CJS_PATH} stale ${tmp} cli-commands`, { encoding: 'utf8' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('stale');
    expect(parsed).toHaveProperty('changedFiles');
  });

  it('exits 1 with usage error on no args', () => {
    expect(() => execSync(`node ${CJS_PATH}`, { encoding: 'utf8', stdio: 'pipe' })).toThrow();
  });

  it('update-index creates entry', () => {
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    execSync(
      `node ${CJS_PATH} update-index ${tmp} --slug=payments --name="Payment Processing" --directories='["src/payments/"]' --referencedFiles='["src/payments/checkout.ts"]'`,
      { encoding: 'utf8' }
    );
    const index = JSON.parse(readFileSync(path.join(tmp, '.features', 'index.json'), 'utf8'));
    expect(index.features.payments).toBeDefined();
    expect(index.features.payments.name).toBe('Payment Processing');
  });

  it('remove deletes entry and directory', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX, { 'cli-commands': '# Test KB' });
    execSync(`node ${CJS_PATH} remove ${tmp} cli-commands`, { encoding: 'utf8' });
    const index = JSON.parse(readFileSync(path.join(tmp, '.features', 'index.json'), 'utf8'));
    expect(index.features['cli-commands']).toBeUndefined();
  });

  // T6: Unknown command and invalid worktree
  it('exits 1 for unknown subcommand', () => {
    expect(() => execSync(`node ${CJS_PATH} unknown-command /tmp`, { encoding: 'utf8', stdio: 'pipe' })).toThrow();
  });

  it('exits 1 for invalid worktree path', () => {
    expect(() => execSync(`node ${CJS_PATH} list /nonexistent/path/that/does/not/exist`, { encoding: 'utf8', stdio: 'pipe' })).toThrow();
  });

  it('find-overlapping returns overlapping slugs', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = execSync(`node ${CJS_PATH} find-overlapping ${tmp} src/cli/cli.ts`, { encoding: 'utf8' });
    const slugs = JSON.parse(result);
    expect(slugs).toContain('cli-commands');
  });

  it('find-overlapping returns empty for non-overlapping files', () => {
    const tmp = makeTmpFeatureWorktree(SAMPLE_INDEX);
    const result = execSync(`node ${CJS_PATH} find-overlapping ${tmp} src/payments/checkout.ts`, { encoding: 'utf8' });
    expect(JSON.parse(result)).toEqual([]);
  });

});
