import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeStreaming,
  hasSkillInvocations,
  hasRequiredSkills,
} from './helpers.js';

/**
 * Integration tests for Devflow ambient mode plan detection.
 *
 * The preamble hook detects structured plans (## Goal + ## Steps + ## Files)
 * and injects a directive to invoke devflow:implement.
 *
 * Requirements:
 * - `claude` CLI installed and authenticated
 * - Devflow installed (`devflow init`)
 *
 * Run: npm run test:integration (not part of `npm test` — each test is an API call)
 */
describe.skipIf(!isClaudeAvailable())('devflow plan detection', () => {

  it('plan handoff prompt — all three markers triggers implement skill', async () => {
    const planPrompt = `
## Goal
Add rate limiting to the upload endpoint.

## Steps
1. Add middleware
2. Configure limits
3. Write tests

## Files
- src/middleware/rate-limit.ts
- tests/rate-limit.test.ts
    `.trim();

    const result = await runClaudeStreaming(planPrompt, {
      timeout: 30000,
      systemPrompt: 'EXECUTION_PLAN detected. Invoke `devflow:implement` via the Skill tool to execute this plan.',
    });
    expect(hasRequiredSkills(result, ['implement'])).toBe(true);
    console.log(`plan detection: ${result.durationMs}ms. Skills: [${result.skills.join(', ')}]`);
  });

  it('normal prompt — hook outputs nothing, no skills loaded', async () => {
    const result = await runClaudeStreaming('what does the config module do?', {
      timeout: 20000,
      systemPrompt: false,
    });
    // No preamble injection for a normal prompt
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`non-plan prompt: ${result.durationMs}ms`);
  });

  it('partial markers — missing ## Files, no hook output', async () => {
    const partialPlan = `
## Goal
Add rate limiting.

## Steps
1. Add middleware
    `.trim();

    const result = await runClaudeStreaming(partialPlan, {
      timeout: 20000,
      systemPrompt: false,
    });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`partial markers: ${result.durationMs}ms`);
  });
});
