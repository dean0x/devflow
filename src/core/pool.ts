/**
 * @file pool.ts
 *
 * Bounded concurrency over an array. Shared by the migration runner and the
 * curation move step, so neither imports the other for a general helper.
 */

/**
 * Process an array of items with at most `limit` concurrent Promises.
 * Returns PromiseSettledResult for every item in the original order.
 *
 * Precondition: `limit` is a positive integer. A limit below 1 (or NaN) would never
 * advance the chunk loop, so the call rejects with a RangeError before `fn` runs.
 */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`pooled: limit must be a positive integer, got ${String(limit)}`);
  }
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
