import type { ComponentResult, GatherContext } from '../types.js';
import { dim } from '../colors.js';
import { formatCountdown } from './usage-quota.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const BURN_FREE_FRACTION = 0.03;
const MAX_RESET_AHEAD_MS = 8 * DAY_MS;

interface WeekPoint {
  readonly usedPercent: number;
  readonly resetsAtMs: number;
}

export function parseWeekPoint(sevenDay: unknown, nowMs: number): WeekPoint | null {
  if (sevenDay === null || typeof sevenDay !== 'object' || Array.isArray(sevenDay)) return null;
  if (!('used_percentage' in sevenDay) || !('resets_at' in sevenDay)) return null;

  const { used_percentage: usedPercent, resets_at: resetsAt } = sevenDay;
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return null;
  }
  if (typeof resetsAt !== 'number') return null;
  const resetsAtMs = resetsAt * 1000;
  if (!(resetsAtMs > nowMs && resetsAtMs <= nowMs + MAX_RESET_AHEAD_MS)) return null;
  return { usedPercent, resetsAtMs };
}

/**
 * D-HUD-WEEK-FORECAST: Copy forecastFrom from tokenmeter 0.3.0.
 * The installed HUD cannot import the package. A devflow-only user has no stored Claude data.
 * D-TOKENMETER-HUD covers only the Codex client. Like usageQuota, this part uses stdin.
 * Return null unless the reset is after nowMs.
 */
export function weekForecastFrom({ usedPercent, resetsAtMs }: WeekPoint, nowMs: number) {
  if (!(resetsAtMs > nowMs)) return null;

  const elapsedMs = nowMs - (resetsAtMs - WEEK_MS);
  if (!(elapsedMs >= BURN_FREE_FRACTION * WEEK_MS)) return null;

  const burn = usedPercent / (elapsedMs / HOUR_MS);
  const atResetPct = usedPercent + burn * ((resetsAtMs - nowMs) / HOUR_MS);
  const runsOut = burn > 0 ? nowMs + ((100 - usedPercent) / burn) * HOUR_MS : Infinity;
  return { atResetPct, runsOutAtMs: runsOut <= resetsAtMs ? Math.round(runsOut) : null };
}

export function forecastPercentText(pct: number): string {
  const rounded = Math.round(pct);
  return rounded > 999 ? '>999%' : `${rounded}%`;
}

export default async function weekForecast(ctx: GatherContext): Promise<ComponentResult | null> {
  const nowMs = Date.now();
  const point = parseWeekPoint(ctx.stdin?.rate_limits?.seven_day, nowMs);
  if (!point) return null;

  const forecast = weekForecastFrom(point, nowMs);
  if (!forecast || !Number.isFinite(forecast.atResetPct)) return null;
  const { atResetPct, runsOutAtMs } = forecast;
  if (runsOutAtMs !== null && !Number.isFinite(runsOutAtMs)) return null;

  const span = runsOutAtMs !== null && runsOutAtMs > nowMs ? formatCountdown(runsOutAtMs / 1000) : '';
  const raw = `→ ${forecastPercentText(atResetPct)} by reset${span ? `, runs out in ${span}` : ''}`;
  return { text: dim(raw), raw };
}
