import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeStreaming,
  runClaudeStreamingWithRetry,
  hasSkillInvocations,
  hasClassification,
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
    expect(hasClassification(result)).toBe(false);
    console.log(`preamble filter (single-word): no skills (${result.durationMs}ms)`);
  });

  it('QUICK — explore: "where is the config?" loads no skills', async () => {
    const result = await runClaudeStreaming('where is the config file?', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    expect(hasClassification(result)).toBe(false);
    console.log(`QUICK explore: no skills (${result.durationMs}ms)`);
  });

  it('CHAT/QUICK — multi-word chat passes preamble but classified QUICK', async () => {
    // Passes preamble's word-count filter (>2 words) but classified CHAT/QUICK — no skills loaded
    const result = await runClaudeStreaming('sounds good, thanks for explaining that', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    expect(hasClassification(result)).toBe(false);
    console.log(`CHAT/QUICK (multi-word): no skills (${result.durationMs}ms)`);
  });

  it('preamble filter — slash command prefix skipped before classification', async () => {
    // Preamble filters prompts starting with "/" — no classification or skill loading
    const result = await runClaudeStreaming('/help with something', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    expect(hasClassification(result)).toBe(false);
    console.log(`preamble filter (slash command): no skills (${result.durationMs}ms)`);
  });

  // --- GUIDED tier: router must load (hard), specific skills logged (soft) ---

  it('EXPLORE/GUIDED — loads router and explore:guided', async () => {
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'explain how the plugin loading system works from registration through initialization',
      (r) => hasRequiredSkills(r, ['router', 'explore:guided']),
    );

    const skills = getSkillInvocations(result);
    console.log(`EXPLORE/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('IMPLEMENT/GUIDED — loads router and implement:guided', async () => {
    const soft = ['patterns', 'test-driven-development', 'dependency-research'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'add a retry mechanism with exponential backoff to the HTTP client module',
      (r) => hasRequiredSkills(r, ['router', 'implement:guided']),
    );

    const skills = getSkillInvocations(result);
    const hasSoft = hasRequiredSkills(result, soft);
    console.log(`IMPLEMENT/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasSoft ? ` ⚠ soft: ${soft.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('DEBUG/GUIDED — loads router and debug:guided', async () => {
    const soft = ['test-driven-development', 'software-design', 'testing'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'fix the bug where the date formatter returns wrong timezone offset for DST transitions',
      (r) => hasRequiredSkills(r, ['router', 'debug:guided']),
    );

    const skills = getSkillInvocations(result);
    const hasSoft = hasRequiredSkills(result, soft);
    console.log(`DEBUG/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasSoft ? ` ⚠ soft: ${soft.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('PLAN/GUIDED — loads router and plan:guided', async () => {
    const soft = ['test-driven-development', 'patterns', 'software-design', 'security', 'design-review'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'how should we design a caching layer for API responses?',
      (r) => hasRequiredSkills(r, ['router', 'plan:guided']),
    );

    const skills = getSkillInvocations(result);
    const hasSoft = hasRequiredSkills(result, soft);
    console.log(`PLAN/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasSoft ? ` ⚠ soft: ${soft.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('REVIEW/GUIDED — loads router and review:guided', async () => {
    const soft = ['quality-gates', 'software-design'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'check this error handling in the authentication module',
      (r) => hasRequiredSkills(r, ['router', 'review:guided']),
    );

    const skills = getSkillInvocations(result);
    const hasSoft = hasRequiredSkills(result, soft);
    console.log(`REVIEW/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasSoft ? ` ⚠ soft: ${soft.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('RESEARCH/GUIDED — loads router and research:guided', async () => {
    const soft = ['research-codebase'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'research what logging libraries this codebase uses and how they compare to alternatives',
      (r) => hasRequiredSkills(r, ['router', 'research:guided']),
    );
    const skills = getSkillInvocations(result);
    const hasSoft = hasRequiredSkills(result, soft);
    console.log(`RESEARCH/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasSoft ? ` ⚠ soft: ${soft.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  it('RELEASE/GUIDED — loads router and release:guided', async () => {
    const soft = ['git'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'prepare a patch release for the latest bugfix',
      (r) => hasRequiredSkills(r, ['router', 'release:guided']),
    );
    const skills = getSkillInvocations(result);
    const hasSoft = hasRequiredSkills(result, soft);
    console.log(`RELEASE/GUIDED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]${passed && !hasSoft ? ` ⚠ soft: ${soft.join(', ')}` : ''}`);
    expect(passed).toBe(true);
  });

  // --- ORCHESTRATED tier: strict skill assertions ---

  it('IMPLEMENT/ORCHESTRATED — loads implement:orch', async () => {
    const required = ['implement:orch'];
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

  it('PLAN/ORCHESTRATED — loads plan:orch', async () => {
    const required = ['plan:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'design the architecture for a multi-service notification system with email, SMS, and push channels that supports user preferences and delivery guarantees',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`PLAN/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('PIPELINE/ORCHESTRATED — loads pipeline:orch', async () => {
    const required = ['pipeline:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'implement and review end to end the new user preferences API',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );

    const skills = getSkillInvocations(result);
    console.log(`PIPELINE/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('RESEARCH/ORCHESTRATED — loads research:orch', async () => {
    const required = ['research:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'conduct a comprehensive multi-perspective research on how competing projects handle plugin architecture, including market analysis and technology comparison',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );
    const skills = getSkillInvocations(result);
    console.log(`RESEARCH/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('RELEASE/ORCHESTRATED — loads release:orch', async () => {
    const required = ['release:orch'];
    const { result, passed, attempts, model } = await runClaudeStreamingWithRetry(
      'run the full release pipeline for version 3.0.0 with changelog generation and npm publish',
      (r) => hasSkillInvocations(r) && hasRequiredSkills(r, required),
    );
    const skills = getSkillInvocations(result);
    console.log(`RELEASE/ORCHESTRATED: ${passed ? 'PASS' : 'FAIL'} (${model}, ${attempts} attempts, ${result.durationMs}ms). Skills: [${skills.join(', ')}]`);
    if (!passed) console.warn(`Expected: ${required.join(', ')}. Got: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });
});
