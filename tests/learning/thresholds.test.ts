// tests/learning/thresholds.test.ts
// process-observations op was removed in Part A of the LLM-driven sidecar refactor
// (zero production callers). The behaviors it uniquely tested are now covered by:
//   - tests/learning/merge-observation.test.ts — id-keyed reinforce, evidence cap (D12),
//     type-collision suffix (D11), quality_ok sticky, LLM-provided fields verbatim, E1.
// This file is retained as a placeholder with a single no-op test to satisfy the test runner.

import { describe, it } from 'vitest';

describe('process-observations migration note', () => {
  it('process-observations op removed — see merge-observation.test.ts for coverage', () => {
    // All behaviors formerly tested via process-observations are covered in:
    //   tests/learning/merge-observation.test.ts
    // No additional tests needed here.
  });
});
