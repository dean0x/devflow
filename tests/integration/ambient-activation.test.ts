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
 * These tests require:
 * - `claude` CLI installed and authenticated
 * - Ambient mode enabled (`devflow ambient --enable`)
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
  it('classifies "add a login form" as IMPLEMENT/GUIDED', () => {
    const output = runClaude('add a login form with email and password fields');
    expect(hasClassification(output)).toBe(true);
    expect(extractIntent(output)).toBe('IMPLEMENT');
    expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
  });

  it('classifies "fix the auth error" as DEBUG/GUIDED', () => {
    const output = runClaude('fix the authentication error in the login handler');
    expect(hasClassification(output)).toBe(true);
    expect(extractIntent(output)).toBe('DEBUG');
    expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output));
  });

  // ORCHESTRATED tier — agents spawned for complex multi-file work
  it('classifies complex multi-file refactor as ORCHESTRATED', () => {
    const output = runClaude('Refactor the authentication system across the API layer, database models, and frontend components');
    expect(hasClassification(output)).toBe(true);
    expect(extractIntent(output)).toBe('IMPLEMENT');
    expect(extractDepth(output)).toBe('ORCHESTRATED');
  });

  // Skill loading verification — GUIDED should show "Loading:" marker
  it('loads skills for GUIDED classification', () => {
    const output = runClaude('add a login form with email and password fields');
    expect(hasClassification(output)).toBe(true);
    expect(hasSkillLoading(output)).toBe(true);
    const skills = extractLoadedSkills(output);
    expect(skills.length).toBeGreaterThan(0);
  });

  // Skill loading verification — ORCHESTRATED should show "Loading:" marker
  it('loads skills for ORCHESTRATED classification', () => {
    const output = runClaude('Refactor the authentication system across the API layer, database models, and frontend components');
    expect(hasClassification(output)).toBe(true);
    expect(hasSkillLoading(output)).toBe(true);
    const skills = extractLoadedSkills(output);
    expect(skills.length).toBeGreaterThan(0);
  });
});
