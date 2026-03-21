import * as fs from 'node:fs';
import { readCache, writeCache, readCacheStale } from './cache.js';
import { getCredentials } from './credentials.js';
import type { UsageData } from './types.js';

const USAGE_CACHE_KEY = 'usage';
const USAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const USAGE_FAIL_TTL = 15 * 1000; // 15 seconds
const API_TIMEOUT = 1_500; // Must fit within 2s overall HUD timeout
const BACKOFF_CACHE_KEY = 'usage-backoff';

interface BackoffState {
  retryAfter: number;
  delay: number;
}

const DEBUG = !!process.env.DEVFLOW_HUD_DEBUG;

function debugLog(msg: string, data?: Record<string, unknown>): void {
  if (!DEBUG) return;
  const entry = { ts: new Date().toISOString(), source: 'usage-api', msg, ...data };
  fs.appendFileSync('/tmp/hud-debug.log', JSON.stringify(entry) + '\n');
}

/**
 * Fetch usage quota data from the Anthropic API.
 * Uses caching with backoff for rate limiting. Returns null on failure.
 */
export async function fetchUsageData(): Promise<UsageData | null> {
  // Check backoff
  const backoff = readCache<BackoffState>(BACKOFF_CACHE_KEY);
  if (backoff && Date.now() < backoff.retryAfter) {
    debugLog('skipped: backoff active', { retryAfter: backoff.retryAfter });
    return readCacheStale<UsageData>(USAGE_CACHE_KEY);
  }

  // Check cache
  const cached = readCache<UsageData>(USAGE_CACHE_KEY);
  if (cached) return cached;

  const creds = await getCredentials();
  if (!creds) {
    debugLog('no OAuth credentials found');
    return null;
  }
  const token = creds.accessToken;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    debugLog('fetching usage', { timeout: API_TIMEOUT });

    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
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
      debugLog('rate limited (429)', { retryAfter, delay });
      return readCacheStale<UsageData>(USAGE_CACHE_KEY);
    }

    if (!response.ok) {
      debugLog('non-200 response', { status: response.status, statusText: response.statusText });
      writeCache<UsageData | null>(USAGE_CACHE_KEY, null, USAGE_FAIL_TTL);
      return readCacheStale<UsageData>(USAGE_CACHE_KEY);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const fiveHour = body.five_hour as Record<string, unknown> | undefined;
    const sevenDay = body.seven_day as Record<string, unknown> | undefined;

    const data: UsageData = {
      fiveHourPercent:
        typeof fiveHour?.utilization === 'number'
          ? Math.round(Math.max(0, Math.min(100, fiveHour.utilization)))
          : null,
      sevenDayPercent:
        typeof sevenDay?.utilization === 'number'
          ? Math.round(Math.max(0, Math.min(100, sevenDay.utilization)))
          : null,
    };

    debugLog('usage fetched', { fiveHour: data.fiveHourPercent, sevenDay: data.sevenDayPercent });
    writeCache(USAGE_CACHE_KEY, data, USAGE_CACHE_TTL);
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('fetch failed', { error: message });
    writeCache<UsageData | null>(USAGE_CACHE_KEY, null, USAGE_FAIL_TTL);
    return readCacheStale<UsageData>(USAGE_CACHE_KEY);
  }
}
