import * as fs from 'node:fs';
import * as path from 'node:path';
import { readCache, writeCache, readCacheStale } from './cache.js';
import type { UsageData } from './types.js';

const USAGE_CACHE_KEY = 'usage';
const USAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const USAGE_FAIL_TTL = 15 * 1000; // 15 seconds
const API_TIMEOUT = 15_000;
const BACKOFF_CACHE_KEY = 'usage-backoff';

interface BackoffState {
  retryAfter: number;
  delay: number;
}

function getCredentialsPath(): string {
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || '~', '.claude');
  return path.join(claudeDir, '.credentials.json');
}

function getOAuthToken(): string | null {
  try {
    const raw = fs.readFileSync(getCredentialsPath(), 'utf-8');
    const creds = JSON.parse(raw) as Record<string, unknown>;
    const oauth = creds.claudeAiOauth as Record<string, unknown> | undefined;
    return (oauth?.accessToken as string) || null;
  } catch {
    return null;
  }
}

/**
 * Fetch usage quota data from the Anthropic API.
 * Uses caching with backoff for rate limiting. Returns null on failure.
 */
export async function fetchUsageData(): Promise<UsageData | null> {
  // Check backoff
  const backoff = readCache<BackoffState>(BACKOFF_CACHE_KEY);
  if (backoff && Date.now() < backoff.retryAfter) {
    return readCacheStale<UsageData>(USAGE_CACHE_KEY);
  }

  // Check cache
  const cached = readCache<UsageData>(USAGE_CACHE_KEY);
  if (cached) return cached;

  const token = getOAuthToken();
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get('Retry-After') || '60',
        10,
      );
      const delay = Math.min(retryAfter * 1000, 5 * 60 * 1000);
      writeCache<BackoffState>(
        BACKOFF_CACHE_KEY,
        { retryAfter: Date.now() + delay, delay },
        delay,
      );
      return readCacheStale<UsageData>(USAGE_CACHE_KEY);
    }

    if (!response.ok) {
      writeCache<UsageData | null>(USAGE_CACHE_KEY, null, USAGE_FAIL_TTL);
      return readCacheStale<UsageData>(USAGE_CACHE_KEY);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const data: UsageData = {
      dailyUsagePercent:
        typeof body.daily_usage_percent === 'number'
          ? body.daily_usage_percent
          : null,
      weeklyUsagePercent:
        typeof body.weekly_usage_percent === 'number'
          ? body.weekly_usage_percent
          : null,
    };

    writeCache(USAGE_CACHE_KEY, data, USAGE_CACHE_TTL);
    return data;
  } catch {
    writeCache<UsageData | null>(USAGE_CACHE_KEY, null, USAGE_FAIL_TTL);
    return readCacheStale<UsageData>(USAGE_CACHE_KEY);
  }
}
