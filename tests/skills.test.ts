import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { hasShadow, listShadowed } from '../src/cli/commands/skills.js';

describe('hasShadow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no shadow exists', async () => {
    const result = await hasShadow('core-patterns', tmpDir);
    expect(result).toBe(false);
  });

  it('returns true when shadow directory exists', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'core-patterns'), { recursive: true });
    const result = await hasShadow('core-patterns', tmpDir);
    expect(result).toBe(true);
  });

  it('returns false when shadow is a file not a directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'skills', 'core-patterns'), 'not a dir');
    const result = await hasShadow('core-patterns', tmpDir);
    expect(result).toBe(false);
  });
});

describe('listShadowed', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no shadows exist', async () => {
    const result = await listShadowed(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when skills directory does not exist', async () => {
    const result = await listShadowed(tmpDir);
    expect(result).toEqual([]);
  });

  it('lists all shadowed skill directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'core-patterns'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'skills', 'test-patterns'), { recursive: true });

    const result = await listShadowed(tmpDir);
    expect(result).toHaveLength(2);
    expect(result).toContain('core-patterns');
    expect(result).toContain('test-patterns');
  });

  it('ignores files in skills directory (only lists directories)', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'core-patterns'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'skills', '.DS_Store'), '');

    const result = await listShadowed(tmpDir);
    expect(result).toEqual(['core-patterns']);
  });
});
