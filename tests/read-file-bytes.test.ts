import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { readFileBytes } from '../src/core/read-file-bytes.js';

const MAX_BYTES = 5;

async function openFixture(onTestFinished: TestContext['onTestFinished']) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'read-file-bytes-'));
  onTestFinished(() => fs.rm(dir, { recursive: true }));
  const filePath = join(dir, 'file');
  await fs.writeFile(filePath, 'abc');
  const handle = await fs.open(filePath, 'r');
  onTestFinished(handle.close.bind(handle));
  vi.spyOn(fs, 'open').mockResolvedValueOnce(handle);
  return { dir, filePath, handle };
}

describe('readFileBytes', () => {
  it('closes without a read if the open handle exceeds the byte limit', async ({ onTestFinished }) => {
    const { dir, filePath, handle } = await openFixture(onTestFinished);
    const largerFile = join(dir, 'larger');
    await fs.writeFile(largerFile, 'abcdef');
    vi.spyOn(handle, 'stat').mockResolvedValueOnce(await fs.stat(largerFile));
    const read = vi.spyOn(handle, 'read');
    const close = vi.spyOn(handle, 'close');

    expect(await readFileBytes(filePath, MAX_BYTES)).toBe('unreadable');
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns unreadable if close fails after a successful read', async ({ onTestFinished }) => {
    const { filePath, handle } = await openFixture(onTestFinished);
    const read = vi.spyOn(handle, 'read');
    const close = vi.spyOn(handle, 'close').mockRejectedValueOnce(new Error('close failed'));

    expect(await readFileBytes(filePath, MAX_BYTES)).toBe('unreadable');
    expect(read).toHaveResolvedWith(expect.objectContaining({ bytesRead: 3 }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
