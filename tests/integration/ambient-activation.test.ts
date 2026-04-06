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

  it('QUICK — chat: "thanks" loads no skills', async () => {
    const result = await runClaudeStreaming('thanks', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`QUICK chat: no skills (${result.durationMs}ms)`);
  });

  it('QUICK — explore: "where is the config?" loads no skills', async () => {
    const result = await runClaudeStreaming('where is the config file?', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`QUICK explore: no skills (${result.durationMs}ms)`);
  });

  // --- GUIDED tier: router must load (hard), specific skills logged (soft) ---

  it('EXPLORE/GUIDED — loads router and explore skills', async () => {
    const expected = ['explore:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'explain how the plugin loading system works from registration through initialization',
      (r) => hasRequiredSkills(r, ['router']),
    );

    const skills = getSkillInvocations(result);
    const hasExpected = hasRequiredSkills(result, expected);
    console.log(`EXPLORE/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasExpected ? ` ⚠ expected: ${expected.join(', ')}` : ''}`);
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
    const expected = ['software-design', 'testing'];
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
    const expected = ['patterns', 'software-design'];
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

  it('RESOLVE/ORCHESTRATED — loads resolve, software-design', async () => {
    const required = ['resolve:orch', 'software-design'];
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
