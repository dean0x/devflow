import { describe, it, expect } from 'vitest';
import {
  isClaudeAvailable,
  runClaudeStreaming,
  hasSkillInvocations,
  hasRequiredSkills,
} from './helpers.js';
import { HANDOFF_TEMPLATE, REMINDER_TEMPLATE } from '../fixtures/ambient-templates.js';

/**
 * Integration tests for Devflow ambient mode plan handoff.
 *
 * The preamble hook detects prompts beginning with `Implement the following plan:`
 * (Claude Code's native plan-mode handoff prefix) and injects a directive to invoke
 * devflow:implement.
 *
 * Requirements:
 * - `claude` CLI installed and authenticated
 * - Devflow installed (`devflow init`)
 *
 * Run: npm run test:integration (not part of `npm test` — each test is an API call)
 */
describe.skipIf(!isClaudeAvailable())('devflow ambient plan handoff', () => {

  it('plan handoff prompt — `Implement the following plan:` prefix triggers implement skill', async () => {
    const planPrompt = [
      'Implement the following plan:',
      '',
      '## Add rate limiting to the upload endpoint',
      '',
      '1. Add middleware',
      '2. Configure limits',
      '3. Write tests',
    ].join('\n');

    const result = await runClaudeStreaming(planPrompt, {
      timeout: 30000,
      systemPrompt: HANDOFF_TEMPLATE,
    });
    expect(hasRequiredSkills(result, ['implement'])).toBe(true);
    console.log(`plan handoff: ${result.durationMs}ms. Skills: [${result.skills.join(', ')}]`);
  });

  it('normal prompt — orchestrator reminder does not trigger a skill invocation', async () => {
    const result = await runClaudeStreaming('what does the config module do?', {
      timeout: 20000,
      // A normal prompt gets the 2-line orchestrator reminder — it must steer toward
      // delegation without auto-invoking any devflow workflow skill.
      systemPrompt: REMINDER_TEMPLATE,
    });
    expect(hasSkillInvocations(result)).toBe(false);
    console.log(`reminder prompt: ${result.durationMs}ms`);
  });

  // T-5 empirical outcome: pending live verification
  // Whether UserPromptSubmit fires for the auto-injected new-session handoff prompt
  // is unproven. The charter (SessionStart) carries a fallback bullet for that case.
});
