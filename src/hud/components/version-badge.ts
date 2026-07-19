import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ComponentResult, GatherContext } from '../types.js';
import { yellow } from '../colors.js';
import { readCache, writeCache } from '../cache.js';

const VERSION_CACHE_KEY = 'version-check';
const VERSION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface VersionInfo {
  latest: string;
}

function getCurrentVersion(devflowDir: string): string | null {
  // Try manifest.json first (most reliable for installed version)
  try {
    const manifestPath = path.join(devflowDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    if (typeof manifest.version === 'string') return manifest.version;
  } catch {
    // Fall through
  }

  // Try package.json as fallback
  try {
    const pkgPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      '..',
      'package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // Fall through
  }

  return null;
}

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'npm',
      ['view', 'devflow-kit', 'version', '--json'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(typeof parsed === 'string' ? parsed : null);
        } catch {
          const trimmed = stdout.trim();
          resolve(trimmed || null);
        }
      },
    );
  });
}

function compareVersions(current: string, latest: string): number {
  const a = current.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) < (b[i] || 0)) return -1;
    if ((a[i] || 0) > (b[i] || 0)) return 1;
  }
  return 0;
}

export default async function versionBadge(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  const current = getCurrentVersion(ctx.devflowDir);
  if (!current) return null;

  // Cache only the npm registry result (expensive); current is always live
  let info = readCache<VersionInfo>(VERSION_CACHE_KEY);
  if (!info) {
    const latest = await fetchLatestVersion();
    if (latest) {
      info = { latest };
      writeCache(VERSION_CACHE_KEY, info, VERSION_CACHE_TTL);
    }
  }

  if (info && compareVersions(current, info.latest) < 0) {
    const badge = `\u2726 Devflow v${info.latest} \u00B7 update: npx devflow-kit init`;
    return { text: yellow(badge), raw: badge };
  }

  // Don't show version when up to date
  return null;
}
