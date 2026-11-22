import * as fs from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

const MAX_STATE_BYTES = 4 * 1024;
const PACKAGE_PATH = `${sep}${join('node_modules', '@dean0x', 'tokenmeter')}${sep}`;

type PathStat = Pick<fs.Stats, 'uid' | 'mode' | 'isFile' | 'isDirectory'>;
interface BinReadDeps {
  readonly lstat?: (path: string) => PathStat;
}

function readState(file: string, uid: number): unknown {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  const fd = fs.openSync(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_STATE_BYTES) return null;
    // The extra byte detects growth after fstat.
    const buf = Buffer.alloc(MAX_STATE_BYTES + 1);
    let length = 0;
    for (let reads = 0; reads < buf.length; reads++) {
      const count = fs.readSync(fd, buf, length, buf.length - length, length);
      if (count === 0) break;
      length += count;
      if (length > MAX_STATE_BYTES) return null;
    }
    return JSON.parse(buf.toString('utf8', 0, length));
  } finally {
    fs.closeSync(fd);
  }
}

function parseBinPath(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  if (!('version' in state) || state.version !== 1 || !('binPath' in state)) return null;
  const { binPath } = state;
  if (typeof binPath !== 'string' || !isAbsolute(binPath) || normalize(binPath) !== binPath) return null;
  return binPath;
}

function isTrusted(stat: PathStat, uid: number): boolean {
  return (stat.uid === uid || stat.uid === 0) && (stat.mode & 0o022) === 0;
}

/** D-TOKENMETER-BIN-TRUST: Check the saved path again before each HUD spawn. */
export function readTokenmeterBin(devflowDir: string, deps: BinReadDeps = {}): string | null {
  const uid = process.getuid?.();
  if (uid === undefined || !fs.constants.O_NOFOLLOW) return null;
  const lstat = deps.lstat ?? fs.lstatSync;
  try {
    const binPath = parseBinPath(readState(join(devflowDir, 'tokenmeter.json'), uid));
    if (binPath === null) return null;
    const start = binPath.lastIndexOf(PACKAGE_PATH);
    if (start < 0 || fs.realpathSync(binPath) !== binPath) return null;

    const bin = lstat(binPath);
    if (!bin.isFile() || !isTrusted(bin, uid)) return null;

    const packageDir = binPath.slice(0, start + PACKAGE_PATH.length - 1);
    const scopeDir = dirname(packageDir);
    const dirs = new Set([dirname(scopeDir), scopeDir, packageDir, join(packageDir, 'bin'), join(packageDir, 'dist')]);
    // Check all directories on the bin path inside the package, including nested bins.
    const packageParents = dirname(binPath).slice(packageDir.length).split(sep).filter(Boolean);
    let parent = packageDir;
    for (const part of packageParents) {
      parent = join(parent, part);
      dirs.add(parent);
    }
    for (const dir of dirs) {
      const stat = lstat(dir);
      if (!stat.isDirectory() || !isTrusted(stat, uid)) return null;
    }
    return binPath;
  } catch {
    return null;
  }
}
