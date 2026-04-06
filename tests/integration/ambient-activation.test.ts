import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeStreaming,
  runClaudeStreamingWithRetry,
  hasSkillInvocations,
  getSkillInvocations,
  hasRequiredSkills,
} from './helpers.js';

/**
 * Integration tests for Devflow ambient mode classification and skill loading.
 *
 * GUIDED tests use two-tier assertions:
 *   Hard: router skill loaded via Skill tool (proves non-QUICK classification — system works)
 *   Soft: specific skills match expectations (quality metric, logged but not gating)
 *
 * ORCHESTRATED tests use strict assertions (deterministic at that scope).
 *
 * Model strategy: Haiku first, Sonnet fallback.
 * Process killed ~8s after first skill detection — no waiting for completion.
 *
 * Requirements:
 * - `claude` CLI installed and authenticated
 * - Devflow skills installed (`devflow init`)
 *
 * Run: npm run test:integration (not part of `npm test` — each test is an API call)
 */
describe.skipIf(!isClaudeAvailable())('devflow classification', () => {

  // --- QUICK tier: no skills loaded ---

  it('preamble filter — single-word prompt skipped before classification', async () => {
    // "thanks" is ≤2 words — preamble's word-count filter skips it before classification runs
    const result = await runClaudeStreaming('thanks', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`preamble filter (single-word): no skills (${result.durationMs}ms)`);
  });

  it('QUICK — explore: "where is the config?" loads no skills', async () => {
    const result = await runClaudeStreaming('where is the config file?', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`QUICK explore: no skills (${result.durationMs}ms)`);
  });

  it('CHAT/QUICK — multi-word chat passes preamble but classified QUICK', async () => {
    // Passes preamble's word-count filter (>2 words) but classified CHAT/QUICK — no skills loaded
    const result = await runClaudeStreaming('sounds good, thanks for explaining that', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`CHAT/QUICK (multi-word): no skills (${result.durationMs}ms)`);
  });

  it('preamble filter — slash command prefix skipped before classification', async () => {
    // Preamble filters prompts starting with "/" — no classification or skill loading
    const result = await runClaudeStreaming('/help with something', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`preamble filter (slash command): no skills (${result.durationMs}ms)`);
  });

  // --- GUIDED tier: router must load (hard), specific skills logged (soft) ---

  it('EXPLORE/GUIDED — loads router only (no additional skills)', async () => {
    // GUIDED EXPLORE dispatches no additional skills — router instructs to spawn Skimmer + Explore agents directly
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'explain how the plugin loading system works from registration through initialization',
      (r) => hasRequiredSkills(r, ['router']),
    );

    const skills = getSkillInvocations(result);
    const nonRouter = skills.filter((s) => s !== 'router' && s !== 'devflow:router');
    console.log(`EXPLORE/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${nonRouter.length > 0 ? ` ⚠ unexpected non-router: ${nonRouter.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('IMPLEMENT/GUIDED — loads router and implementation skills', async () => {
    const expected = ['patterns', 'test-driven-development', 'research'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'add a retry mechanism with exponential backoff to the HTTP client module',
      (r) => hasRequiredSkills(r, ['router']),
    );

    const skills = getSkillInvocations(result);
    const hasExpected = hasRequiredSkills(result, expected);
    console.log(`IMPLEMENT/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasExpected ? ` ⚠ expected: ${expected.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('DEBUG/GUIDED — loads router and debug skills', async () => {
    const expected = ['test-driven-development', 'software-design', 'testing'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'fix the bug where the date formatter returns wrong timezone offset for DST transitions',
      (r) => hasRequiredSkills(r, ['router']),
    );

    const skills = getSkillInvocations(result);
    const hasExpected = hasRequiredSkills(result, expected);
    console.log(`DEBUG/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasExpected ? ` ⚠ expected: ${expected.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('PLAN/GUIDED — loads router and planning skills', async () => {
    const expected = ['test-driven-development', 'patterns', 'software-design', 'security'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'how should we design a caching layer for API responses?',
      (r) => hasRequiredSkills(r, ['router']),
    );

    const skills = getSkillInvocations(result);
    const hasExpected = hasRequiredSkills(result, expected);
    console.log(`PLAN/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasExpected ? ` ⚠ expected: ${expected.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('REVIEW/GUIDED — loads router and review skills', async () => {
    const expected = ['quality-gates', 'software-design'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'check this error handling in the authentication module',
      (r) => hasRequiredSkills(r, ['router']),
    );

    const skills = getSkillInvocations(result);
    const hasExpected = hasRequiredSkills(result, expected);
    console.log(`REVIEW/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasExpected ? ` ⚠ expected: ${expected.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  // --- ORCHESTRATED tier: strict skill assertions ---

  it('IMPLEMENT/ORCHESTRATED — loads implement, patterns', async () => {
    const required = ['implement:orch', 'patterns'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'build a multi-module authentication system with OAuth, session management, and role-based access control',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`IMPLEMENT/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('REVIEW/ORCHESTRATED — loads review', async () => {
    const required = ['review:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'do a full branch review of all changes',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`REVIEW/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('RESOLVE/ORCHESTRATED — loads resolve:orch', async () => {
    const required = ['resolve:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'resolve the review findings from the last code review',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`RESOLVE/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('EXPLORE/ORCHESTRATED — loads explore', async () => {
    const required = ['explore:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'map out the complete data flow across all hook scripts — how they interact, what triggers each, and how data passes between them',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`EXPLORE/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('DEBUG/ORCHESTRATED — loads debug:orch', async () => {
    const required = ['debug:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'the webhook processor silently drops events across three modules when the payload exceeds 1MB — debug why the size check, queue handler, and retry logic all fail to surface the error',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`DEBUG/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('PLAN/ORCHESTRATED — loads plan:orch, patterns', async () => {
    const required = ['plan:orch', 'patterns'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'design the architecture for a multi-service notification system with email, SMS, and push channels that supports user preferences and delivery guarantees',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`PLAN/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('PIPELINE/ORCHESTRATED — loads pipeline, patterns', async () => {
    const required = ['pipeline:orch', 'patterns'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'implement and review end to end the new user preferences API',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`PIPELINE/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });
});
