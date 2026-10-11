/**
 * Token arithmetic for the token-audit tool: usage normalization, the cost-equivalent
 * (ce) weights and model-family pricing.
 */

import { isRecord } from './types.js';

export interface TokenCounts {
  readonly input: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  /** Cache-write tokens whose TTL the transcript did not say. */
  readonly cacheWriteUnknown: number;
  readonly cacheRead: number;
  readonly output: number;
}

/** Cost-equivalent weights, in units of one base input token. */
export const WEIGHTS = Object.freeze({
  input: 1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2.0,
  /** Unknown TTL is weighted as 5m: the cheaper, default write. */
  cacheWriteUnknown: 1.25,
  cacheRead: 0.1,
  output: 5,
});

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other';

/** Assumed relative base-input price per family. `other` is deliberately absent: it is unpriced. */
export const FAMILY_PRICE: Readonly<Record<Exclude<ModelFamily, 'other'>, number>> = Object.freeze({
  opus: 5,
  sonnet: 3,
  haiku: 1,
});

export const PRICED_FAMILIES = ['opus', 'sonnet', 'haiku'] as const;

export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  for (const family of PRICED_FAMILIES) {
    if (m.includes(family)) return family;
  }
  return 'other';
}

/** A non-negative finite whole-token count, or 0. */
function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * D-AUDIT-TTL-SPLIT: the 5m/1h split of cache-write tokens comes from
 * `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`. When the
 * `cache_creation` object is absent (or carries neither figure) the whole
 * `cache_creation_input_tokens` goes to `cacheWriteUnknown`, weighted 1.25 and reported
 * separately. When the split is present, any part of `cache_creation_input_tokens` the two
 * figures do not account for is also `unknown`, so no write token is dropped.
 *
 * Returns null when `usage` is not an object.
 */
export function normalizeUsage(usage: unknown): TokenCounts | null {
  if (!isRecord(usage)) return null;
  const total = tokenCount(usage['cache_creation_input_tokens']);
  const split = usage['cache_creation'];
  const has5m = isRecord(split) && typeof split['ephemeral_5m_input_tokens'] === 'number';
  const has1h = isRecord(split) && typeof split['ephemeral_1h_input_tokens'] === 'number';
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;
  let cacheWriteUnknown = total;
  if (isRecord(split) && (has5m || has1h)) {
    cacheWrite5m = tokenCount(split['ephemeral_5m_input_tokens']);
    cacheWrite1h = tokenCount(split['ephemeral_1h_input_tokens']);
    cacheWriteUnknown = Math.max(0, total - cacheWrite5m - cacheWrite1h);
  }
  return {
    input: tokenCount(usage['input_tokens']),
    cacheWrite5m,
    cacheWrite1h,
    cacheWriteUnknown,
    cacheRead: tokenCount(usage['cache_read_input_tokens']),
    output: tokenCount(usage['output_tokens']),
  };
}

export function cacheWriteTotal(t: TokenCounts): number {
  return t.cacheWrite5m + t.cacheWrite1h + t.cacheWriteUnknown;
}

/** Input + cache write + cache read: the context a request carried. */
export function contextSize(t: TokenCounts): number {
  return t.input + cacheWriteTotal(t) + t.cacheRead;
}

/** Cost-equivalent of the input side only (no output). */
export function inputSideCe(t: TokenCounts): number {
  return (
    t.input * WEIGHTS.input +
    t.cacheWrite5m * WEIGHTS.cacheWrite5m +
    t.cacheWrite1h * WEIGHTS.cacheWrite1h +
    t.cacheWriteUnknown * WEIGHTS.cacheWriteUnknown +
    t.cacheRead * WEIGHTS.cacheRead
  );
}

export function costEquivalent(t: TokenCounts): number {
  return inputSideCe(t) + t.output * WEIGHTS.output;
}
