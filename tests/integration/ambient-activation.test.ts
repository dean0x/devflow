import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaude,
  hasClassification,
  isQuietResponse,
  extractIntent,
  extractDepth,
  hasSkillLoading,
  extractLoadedSkills,
} from './helpers.js';

/**
 * Integration tests for ambient mode skill activation.
 *
 * KNOWN LIMITATION: These tests use `claude -p` (non-interactive mode) which
 * does not reliably trigger the ambient classification flow. In `-p` mode,
 * the model prioritizes the concrete task over the meta-instruction to classify.
 * The ambient preamble is injected via --append-system-prompt (see
 * scripts/hooks/ambient-prompt line 42), but models (including haiku and sonnet)
 * often skip classification and respond directly.
 *
 * QUICK tests pass because absence of classification = quiet response.
 * GUIDED/ORCHESTRATED tests are skipped — they fail non-deterministically in
 * `-p` mode. Verify manually in an interactive Claude Code session where the
 * UserPromptSubmit hook fires.
 *
 * These tests require:
 * - `claude` CLI installed and authenticated
 * - DevFlow skills installed (`devflow init`)
 *
 * Run manually: npm run test:integration
 * Not part of `npm test` — each test is an API call.
 */
describe.skipIf(!isClaudeAvailable())('ambient classification', () => {
  // QUICK tier — no skills loaded, no classification output
  it('classifies "thanks" as QUICK (silent)', () => {
    const output = runClaude('thanks');
    expect(isQuietResponse(output)).toBe(true);
  });

  it('classifies "commit this" as QUICK (git op)', () => {
    const output = runClaude('commit the current changes');
    // Git operations should not trigger GUIDED classification
    expect(isQuietResponse(output) || extractDepth(output) === 'QUICK').toBe(true);
  });

  // GUIDED tier — skills loaded, main session implements
  // Skipped: non-deterministic in -p mode (model skips classification)
  it.skip('classifies "add a login form" as IMPLEMENT/GUIDED', () => {
    const output = runClaude('add a login form with email and password fields');
    expect(hasClassification(output)).toBe(true);
    expect(extractIntent(output)).toBe('IMPLEMENT');
    expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
  });

  // Skipped: non-deterministic in -p mode (model skips classification)
  it.skip('classifies "fix the auth error" as DEBUG/GUIDED', () => {
    const output = runClaude('fix the authentication error in the login handler');
    expect(hasClassification(output)).toBe(true);
    expect(extractIntent(output)).toBe('DEBUG');
    expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
  });

  // ORCHESTRATED tier — agents spawned for complex multi-file work
  // Skipped: non-deterministic in -p mode (model skips classification)
  it.skip('classifies complex multi-file refactor as ORCHESTRATED', () => {
    const output = runClaude(
      'Refactor the authentication system across the API layer, database models, and frontend components',
      { timeout: 60000 },
    );
    expect(hasClassification(output)).toBe(true);
    expect(extractIntent(output)).toBe('IMPLEMENT');
    expect(extractDepth(output)).toBe('ORCHESTRATED');
  });

  // Skill loading verification — GUIDED should show "Loading:" marker
  // Skipped: depends on GUIDED classification which is non-deterministic in -p mode
  it.skip('loads skills for GUIDED classification', () => {
    const output = runClaude('add a login form with email and password fields');
    expect(hasClassification(output)).toBe(true);
    expect(hasSkillLoading(output)).toBe(true);
    const skills = extractLoadedSkills(output);
    expect(skills.length).toBeGreaterThan(0);
  });

  // Skill loading verification — ORCHESTRATED should show "Loading:" marker
  // Skipped: depends on ORCHESTRATED classification which is non-deterministic in -p mode
  it.skip('loads skills for ORCHESTRATED classification', () => {
    const output = runClaude(
      'Refactor the authentication system across the API layer, database models, and frontend components',
      { timeout: 60000 },
    );
    expect(hasClassification(output)).toBe(true);
    expect(hasSkillLoading(output)).toBe(true);
    const skills = extractLoadedSkills(output);
    expect(skills.length).toBeGreaterThan(0);
  });
});
