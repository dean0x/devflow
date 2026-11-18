import { constants, promises as fs } from 'node:fs';

/** Read one regular file through links. Reject a special file or a file that exceeds the limit. */
export async function readFileBytes(
  filePath: string,
  maxBytes: number,
): Promise<Buffer | 'absent' | 'not-directory' | 'unreadable'> {
  try {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return 'absent';
      return code === 'ENOTDIR' ? 'not-directory' : 'unreadable';
    }
    if (!stat.isFile() || stat.size > maxBytes) return 'unreadable';

    // A pipe substituted after the stat must not block the open.
    const file = await fs.open(filePath, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.size > maxBytes) return 'unreadable';
      const bytes = Buffer.alloc(opened.size + 1);
      let total = 0;
      for (let pass = 0; pass < bytes.length && total < bytes.length; pass++) {
        const { bytesRead } = await file.read(bytes, total, bytes.length - total, null);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      return total > opened.size ? 'unreadable' : bytes.subarray(0, total);
    } finally {
      await file.close();
    }
  } catch {
    return 'unreadable';
  }
}
