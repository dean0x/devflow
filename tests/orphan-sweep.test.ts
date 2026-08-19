import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sweepOrphanedAssets, mdFileName, mdEntryName } from '../src/core/orphan-sweep.js';

/**
 * Direct unit coverage for the shared registry-diff sweep helper.
 *
 * The helper is the single deletion primitive behind both the install pipeline
 * (installer.ts: skills, commands, agents) and the uninstall pipeline
 * (uninstall.ts: agents, commands). Its failure modes are all silent by design
 * (avoids PF-009), so they must be pinned here rather than inferred from the
 * two call sites.
 *
 * Every test asserts on a NON-EMPTY corpus, or explicitly asserts the returned
 * scanned count to prove the sweep was not vacuous (avoids PF-018).
 */
describe('sweepOrphanedAssets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-orphan-sweep-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const stripMd = (entry: string): string | null =>
    entry.endsWith('.md') ? entry.slice(0, -'.md'.length) : null;

  it('removes entries whose registry name is absent and keeps the rest', async () => {
    await fs.writeFile(path.join(dir, 'known.md'), 'keep', 'utf-8');
    await fs.writeFile(path.join(dir, 'retired.md'), 'drop', 'utf-8');

    const result = await sweepOrphanedAssets(dir, new Set(['known']), stripMd);

    // Non-vacuity: both entries matched the predicate and were actually examined.
    expect(result.scanned).toBe(2);
    await expect(fs.access(path.join(dir, 'known.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dir, 'retired.md'))).rejects.toThrow();
  });

  it('leaves entries the predicate rejects completely untouched', async () => {
    // A bare (pre-namespace) skill dir stands in for anything the predicate skips:
    // the sweep must never remove it, whatever the registry says (avoids PF-012).
    await fs.mkdir(path.join(dir, 'bare-skill'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.txt'), 'not an asset', 'utf-8');
    await fs.writeFile(path.join(dir, 'retired.md'), 'drop', 'utf-8');

    const result = await sweepOrphanedAssets(dir, new Set<string>(), stripMd);

    // Only retired.md matched the predicate — the other two were never candidates.
    expect(result.scanned).toBe(1);
    await expect(fs.access(path.join(dir, 'bare-skill'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dir, 'README.txt'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dir, 'retired.md'))).rejects.toThrow();
  });

  it('removes a directory entry recursively when the predicate accepts it', async () => {
    // Skills install as prefixed DIRECTORIES, not files — rm must recurse.
    // A neutral prefix stands in for the real namespace: the prefix is supplied by
    // the caller's predicate, so the helper's behaviour does not depend on it.
    const prefix = 'ns:';
    const orphanSkill = path.join(dir, `${prefix}retired-skill`);
    await fs.mkdir(orphanSkill, { recursive: true });
    await fs.writeFile(path.join(orphanSkill, 'SKILL.md'), '# retired', 'utf-8');

    const result = await sweepOrphanedAssets(
      dir,
      new Set(['live-skill']),
      (entry) => entry.startsWith(prefix) ? entry.slice(prefix.length) : null,
    );

    expect(result.scanned).toBe(1);
    await expect(fs.access(orphanSkill)).rejects.toThrow();
  });

  it('an EMPTY registry does not make the sweep skip work (guards accidental short-circuit)', async () => {
    await fs.writeFile(path.join(dir, 'a.md'), 'x', 'utf-8');
    await fs.writeFile(path.join(dir, 'b.md'), 'x', 'utf-8');

    const result = await sweepOrphanedAssets(dir, new Set<string>(), stripMd);

    expect(result.scanned).toBe(2);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('PF-013 / PF-009: a MISSING directory is a no-op, not an error', async () => {
    // Fresh-project cold path — none of the install directories exist yet.
    const missing = path.join(dir, 'never-created');
    await expect(
      sweepOrphanedAssets(missing, new Set(['anything']), stripMd),
    ).resolves.toMatchObject({ scanned: 0, removed: [], failed: [] });
    // The sweep must not create the directory it was pointed at (never writes).
    await expect(fs.access(missing)).rejects.toThrow();
  });

  // A failing rm must degrade silently rather than propagate — one unguarded throw
  // out of this helper would abort the entire install fan-out (avoids PF-009).
  // Enforced by making the sweep directory unwritable, so readdir succeeds and every
  // rm fails with EACCES. Not meaningful on Windows or as root.
  const canRevokeWrite = process.platform !== 'win32' && process.getuid?.() !== 0;

  it.skipIf(!canRevokeWrite)('PF-009: an rm that fails with EACCES is swallowed, not propagated', async () => {
    await fs.writeFile(path.join(dir, 'retired-a.md'), 'x', 'utf-8');
    await fs.writeFile(path.join(dir, 'retired-b.md'), 'x', 'utf-8');
    await fs.chmod(dir, 0o500); // r-x: readdir works, unlink does not

    try {
      const result = await sweepOrphanedAssets(dir, new Set<string>(), stripMd);

      // Non-vacuity: both entries were examined and both removals were attempted.
      expect(result.scanned).toBe(2);
      // The removals failed, so the entries are still there — proving the rm really
      // did fail and the resolved promise is not a false negative.
      await fs.chmod(dir, 0o700);
      expect((await fs.readdir(dir)).sort()).toEqual(['retired-a.md', 'retired-b.md']);
    } finally {
      await fs.chmod(dir, 0o700);
    }
  });

  it('PF-009: the sweep never rejects even when the path is a FILE, not a directory', async () => {
    const filePath = path.join(dir, 'not-a-directory');
    await fs.writeFile(filePath, 'x', 'utf-8');

    // readdir on a file throws ENOTDIR — the helper must swallow it and report 0.
    await expect(
      sweepOrphanedAssets(filePath, new Set(['anything']), stripMd),
    ).resolves.toMatchObject({ scanned: 0, removed: [], failed: [] });
    // ...and must not have removed the file it could not read.
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('result.removed contains the registry name of each swept entry', async () => {
    await fs.writeFile(path.join(dir, 'known.md'), 'keep', 'utf-8');
    await fs.writeFile(path.join(dir, 'retired.md'), 'drop', 'utf-8');

    const result = await sweepOrphanedAssets(dir, new Set(['known']), stripMd);

    expect(result.removed).toContain('retired');
    expect(result.removed).not.toContain('known');
  });

  it('result.failed is empty when all removals succeed', async () => {
    await fs.writeFile(path.join(dir, 'orphan.md'), 'drop', 'utf-8');

    const result = await sweepOrphanedAssets(dir, new Set<string>(), stripMd);

    expect(result.failed).toEqual([]);
    expect(result.removed).toEqual(['orphan']);
  });

  it.skipIf(!canRevokeWrite)('PF-009: result.failed records per-item rm failures by registry name', async () => {
    await fs.writeFile(path.join(dir, 'retired-a.md'), 'x', 'utf-8');
    await fs.writeFile(path.join(dir, 'retired-b.md'), 'x', 'utf-8');
    await fs.chmod(dir, 0o500);

    try {
      const result = await sweepOrphanedAssets(dir, new Set<string>(), stripMd);

      // Both entries failed — neither appears in removed.
      expect(result.failed).toHaveLength(2);
      expect(result.failed.map(f => f.name).sort()).toEqual(['retired-a', 'retired-b']);
      expect(result.removed).toEqual([]);
    } finally {
      await fs.chmod(dir, 0o700);
    }
  });
});

describe('mdFileName / mdEntryName', () => {
  it('mdFileName converts a name to a .md filename', () => {
    expect(mdFileName('code')).toBe('code.md');
    expect(mdFileName('review')).toBe('review.md');
    expect(mdFileName('my-agent')).toBe('my-agent.md');
  });

  it('mdEntryName strips .md extension from a filename', () => {
    expect(mdEntryName('code.md')).toBe('code');
    expect(mdEntryName('review.md')).toBe('review');
  });

  it('mdEntryName returns null for non-.md entries', () => {
    expect(mdEntryName('code')).toBeNull();
    expect(mdEntryName('code.ts')).toBeNull();
    expect(mdEntryName('SKILL.md.bak')).toBeNull();
    expect(mdEntryName('.md')).toBe('');  // edge: empty name
  });

  it('mdEntryName(mdFileName(name)) === name for any valid name (inverse pair)', () => {
    for (const name of ['code', 'review', 'my-agent', 'knowledge']) {
      expect(mdEntryName(mdFileName(name))).toBe(name);
    }
  });
});
