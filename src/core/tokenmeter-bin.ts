import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { writeFileAtomicExclusive } from './fs-atomic.js';
import { readTokenmeterBin } from './tokenmeter-bin-state.js';

const PACKAGE_NAME = '@dean0x/tokenmeter';
const BIN_NAME = 'tokenmeter';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function binEntry(manifest: unknown, binName: string): string | null {
  if (typeof manifest !== 'object' || manifest === null || !('bin' in manifest)) return null;
  const { bin } = manifest;
  const entry = typeof bin === 'object' && bin !== null && Object.hasOwn(bin, binName)
    ? (bin as Record<string, unknown>)[binName]
    : bin;
  return typeof entry === 'string' && entry.length > 0 && !isAbsolute(entry) ? entry : null;
}

/** Resolve an npm bin without loading the package or searching PATH. */
export async function resolvePackageBin(
  pkgName: string,
  binName: string,
): Promise<Result<{ binPath: string; npxWarning: boolean }>> {
  const unavailable = { ok: false, error: 'Could not resolve the package bin.' } as const;
  try {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve(`${pkgName}/package.json`);
    const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const entry = binEntry(manifest, binName);
    if (entry === null) return unavailable;

    const packageDir = await fs.realpath(dirname(manifestPath));
    const binPath = await fs.realpath(join(packageDir, entry));
    const location = relative(packageDir, binPath);
    if (!location || isAbsolute(location) || location === '..' || location.startsWith(`..${sep}`)) {
      return unavailable;
    }
    if (!(await fs.lstat(binPath)).isFile()) return unavailable;
    return { ok: true, value: { binPath, npxWarning: binPath.split(sep).includes('_npx') } };
  } catch {
    return unavailable;
  }
}

/** Save the HUD bin path. The caller can report either error or warning without abort. */
export async function installTokenmeterState(devflowDir: string): Promise<Result<{ warning?: string }>> {
  const resolved = await resolvePackageBin(PACKAGE_NAME, BIN_NAME);
  if (!resolved.ok) {
    return { ok: false, error: 'Could not find the Codex usage tool. Reinstall devflow-kit.' };
  }
  const { binPath, npxWarning } = resolved.value;
  try {
    await writeFileAtomicExclusive(join(devflowDir, 'tokenmeter.json'), JSON.stringify({ version: 1, binPath }) + '\n', {
      exactMode: 0o600,
    });
  } catch {
    return { ok: false, error: 'Could not save the Codex usage tool path. Run devflow init again.' };
  }
  if (readTokenmeterBin(devflowDir) !== binPath) {
    return { ok: true, value: {
      warning: 'The HUD cannot use the saved Codex usage tool path. ' +
        'Reinstall devflow-kit with umask 022 or in a trusted location. Run devflow init again.',
    } };
  }
  if (npxWarning) {
    return { ok: true, value: { warning: 'Codex usage can stop if the npx cache clears. Run devflow init again.' } };
  }
  return { ok: true, value: {} };
}
