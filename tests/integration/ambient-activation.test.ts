import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaude,
  runClaudeWithRetry,
  isQuietResponse,
  extractDepth,
  hasSkillInvocations,
  getSkillInvocations,
} from './helpers.js';

/**
 * Integration tests for ambient mode classification and skill loading.
 *
 * Uses `claude -p` with `--output-format json` to capture permission_denials,
 * which reveal Skill tool invocation attempts even when the tool isn't auto-approved.
 * This lets us verify that the model:
 *   1. Correctly classifies intent/depth
 *   2. Attempts to load the right skills via the Skill tool
 *
 * QUICK tests are deterministic (absence of classification = pass).
 * GUIDED/ORCHESTRATED tests use retry logic for non-determinism.
 *
 * Requirements:
 * - `claude` CLI installed and authenticated
 * - DevFlow skills installed (`devflow init`)
 *
 * Run: npm run test:integration (not part of `npm test` — each test is an API call)
 */
describe.skipIf(!isClaudeAvailable())('ambient classification', () => {

  // --- QUICK tier: no skills loaded, no classification output ---

  it('classifies "thanks" as QUICK (silent)', () => {
    const result = runClaude('thanks');
    expect(isQuietResponse(result.text)).toBe(true);
    expect(hasSkillInvocations(result)).toBe(false);
  });

  it('classifies "commit this" as QUICK (git op)', () => {
    const result = runClaude('commit the current changes');
    expect(isQuietResponse(result.text) || extractDepth(result.text) === 'QUICK').toBe(true);
  });

  it('classifies "where is the config?" as QUICK (explore)', () => {
    const result = runClaude('where is the config file?');
    expect(isQuietResponse(result.text)).toBe(true);
  });

  // --- GUIDED tier: skills loaded, classification stated ---

  // Note: In `-p` mode, haiku sometimes skips classification and responds directly.
  // 5 retries gives ~85% pass rate per test. In interactive mode (real usage),
  // the UserPromptSubmit hook + full session context make classification more reliable.

  it('IMPLEMENT prompt triggers skill loading', () => {
    const { result, passed, attempts } = runClaudeWithRetry(
      'create a new validation module in src/cli/utils/validation.ts with Zod schemas for CLI arguments',
      (r) => hasSkillInvocations(r),
      { maxAttempts: 5 },
    );

    const skills = getSkillInvocations(result);
    console.log(`IMPLEMENT: ${passed ? 'PASS' : 'FAIL'} after ${attempts} attempts. Skills: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('DEBUG prompt triggers skill loading', () => {
    const { result, passed, attempts } = runClaudeWithRetry(
      'fix the failing test in tests/ambient.test.ts — the preamble drift detection assertion is wrong',
      (r) => hasSkillInvocations(r),
      { maxAttempts: 5 },
    );

    const skills = getSkillInvocations(result);
    console.log(`DEBUG: ${passed ? 'PASS' : 'FAIL'} after ${attempts} attempts. Skills: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('PLAN prompt triggers skill loading', () => {
    const { result, passed, attempts } = runClaudeWithRetry(
      'how should we structure a plugin dependency system so plugins can declare requirements on other plugins?',
      (r) => hasSkillInvocations(r),
      { maxAttempts: 5 },
    );

    const skills = getSkillInvocations(result);
    console.log(`PLAN: ${passed ? 'PASS' : 'FAIL'} after ${attempts} attempts. Skills: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  it('REVIEW prompt triggers skill loading', () => {
    const { result, passed, attempts } = runClaudeWithRetry(
      'review the preamble hook script for any issues',
      (r) => hasSkillInvocations(r),
      { maxAttempts: 5 },
    );

    const skills = getSkillInvocations(result);
    console.log(`REVIEW: ${passed ? 'PASS' : 'FAIL'} after ${attempts} attempts. Skills: [${skills.join(', ')}]`);
    expect(passed).toBe(true);
  });

  // --- Skill selection accuracy ---
  // These test that ALL primary skills listed in the preamble are loaded.
  // Non-deterministic: haiku sometimes loads a subset instead of all listed skills.
  // Tracked as soft failures — if these fail consistently, the preamble wording needs work.

  it('loads all primary IMPLEMENT skills', () => {
    const { result, passed } = runClaudeWithRetry(
      'add input validation to the CLI parser in src/cli/cli.ts',
      (r) => {
        const skills = getSkillInvocations(r);
        return skills.includes('patterns')
          && skills.includes('test-driven-development')
          && skills.includes('research');
      },
      { maxAttempts: 3, timeout: 60000 },
    );

    // Soft assertion: report which skills were loaded even on failure
    const skills = getSkillInvocations(result);
    if (!passed) {
      console.warn(`Skill selection incomplete. Loaded: [${skills.join(', ')}]. Expected all of: patterns, test-driven-development, research`);
    }
    expect(passed).toBe(true);
  });
});
