import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateShadowOverridesRegistry } from '../src/cli/utils/shadow-overrides-migration.js';

/**
 * Tests for migrateShadowOverridesRegistry.
 * Mirrors the migrateShadowOverrides tests previously in tests/init-logic.test.ts,
 * now pointing at the canonical implementation in shadow-overrides-migration.ts.
 */
describe('migrateShadowOverridesRegistry', () => {
  let tmpDir: string;
  let devflowDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shadow-registry-test-'));
    devflowDir = path.join(tmpDir, 'devflow');
    await fs.mkdir(path.join(devflowDir, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('renames old shadow directory to new name', async () => {
    const oldShadow = path.join(devflowDir, 'skills', 'core-patterns');
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), '# Custom override');

    const result = await migrateShadowOverridesRegistry(devflowDir);

    expect(result.migrated).toBe(1);
    expect(result.warnings).toEqual([]);

    // Old should be gone
    await expect(fs.access(oldShadow)).rejects.toThrow();
    // New should exist with content
    const content = await fs.readFile(
      path.join(devflowDir, 'skills', 'software-design', 'SKILL.md'),
      'utf-8',
    );
    expect(content).toBe('# Custom override');
  });

  it('warns but does not overwrite when both old and new exist', async () => {
    const oldShadow = path.join(devflowDir, 'skills', 'test-patterns');
    const newShadow = path.join(devflowDir, 'skills', 'testing');
    await fs.mkdir(oldShadow, { recursive: true });
    await fs.mkdir(newShadow, { recursive: true });
    await fs.writeFile(path.join(oldShadow, 'SKILL.md'), '# Old');
    await fs.writeFile(path.join(newShadow, 'SKILL.md'), '# New');

    const result = await migrateShadowOverridesRegistry(devflowDir);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('test-patterns'); // old name in migration test data
    expect(result.warnings[0]).toContain('testing');

    // New should be unchanged
    const content = await fs.readFile(path.join(newShadow, 'SKILL.md'), 'utf-8');
    expect(content).toBe('# New');
  });

  it('does nothing when no old shadows exist', async () => {
    const result = await migrateShadowOverridesRegistry(devflowDir);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('migrates multiple shadows in one pass', async () => {
    for (const oldName of ['core-patterns', 'security-patterns', 'frontend-design']) {
      const dir = path.join(devflowDir, 'skills', oldName);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${oldName}`);
    }

    const result = await migrateShadowOverridesRegistry(devflowDir);

    expect(result.migrated).toBe(3);
    // Verify new names exist
    for (const newName of ['software-design', 'security', 'ui-design']) {
      await expect(fs.access(path.join(devflowDir, 'skills', newName))).resolves.toBeUndefined();
    }
  });

  it('handles missing skills directory gracefully', async () => {
    // Use a devflowDir without a skills/ subdirectory
    const emptyDir = path.join(tmpDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await migrateShadowOverridesRegistry(emptyDir);

    expect(result.migrated).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('migrates exactly one shadow when multiple old names map to the same target', async () => {
    // git-safety, git-workflow, github-patterns all map to 'git'.
    // Only the first present entry should be migrated; subsequent entries must
    // warn rather than silently overwrite, regardless of Promise scheduling.
    const gitSafety = path.join(devflowDir, 'skills', 'git-safety');
    const gitWorkflow = path.join(devflowDir, 'skills', 'git-workflow');
    await fs.mkdir(gitSafety, { recursive: true });
    await fs.mkdir(gitWorkflow, { recursive: true });
    await fs.writeFile(path.join(gitSafety, 'SKILL.md'), '# git-safety override');
    await fs.writeFile(path.join(gitWorkflow, 'SKILL.md'), '# git-workflow override');

    const result = await migrateShadowOverridesRegistry(devflowDir);

    // Exactly one migration to 'git', one warning for the second entry
    expect(result.migrated).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('git');

    // 'git' target must exist
    await expect(fs.access(path.join(devflowDir, 'skills', 'git'))).resolves.toBeUndefined();

    // The migrated content must belong to whichever entry ran first (git-safety)
    const content = await fs.readFile(path.join(devflowDir, 'skills', 'git', 'SKILL.md'), 'utf-8');
    expect(content).toBe('# git-safety override');
  });

  it('is a no-op on a clean devflowDir with no old-name shadows', async () => {
    // Pre-create some new-name shadows that should not be touched
    const newShadow = path.join(devflowDir, 'skills', 'software-design');
    await fs.mkdir(newShadow, { recursive: true });
    await fs.writeFile(path.join(newShadow, 'SKILL.md'), '# User override');

    const result = await migrateShadowOverridesRegistry(devflowDir);

    expect(result.migrated).toBe(0);
    // Existing new-name shadow untouched
    const content = await fs.readFile(path.join(newShadow, 'SKILL.md'), 'utf-8');
    expect(content).toBe('# User override');
  });
});
