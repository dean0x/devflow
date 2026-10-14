import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  BEFORE_ALL_TIMEOUT_MS,
  createSpawnContext,
  describeSpawnContext,
  disposeSpawnContext,
  installDevflow,
  isClaudeAvailable,
  liveSkipReason,
  pickCredential,
  printLiveSkip,
  runClaudeStreaming,
  hasSkillInvocations,
  hasRequiredSkills,
  type SpawnContext,
} from './helpers.js';
import { HANDOFF_TEMPLATE, REMINDER_TEMPLATE } from '../fixtures/ambient-templates.js';

/**
 * Integration tests for Devflow ambient mode plan handoff.
 *
 * The preamble hook detects prompts beginning with `Implement the following plan:`
 * (Claude Code's native plan-mode handoff prefix) and injects a directive to invoke
 * devflow:implement.
 *
 * The session runs in a temp HOME and a temp git repository, with devflow installed into
 * that HOME by `beforeAll` and the permission mode `dontAsk` (set by `buildStreamingArgs`).
 * It never touches the developer's own ~/.claude or this checkout.
 *
 * Requirements:
 * - `claude` CLI installed
 * - CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set (a temp HOME cannot use the stored login);
 *   without one the file skips and prints why
 * - A built CLI (`npm run build`)
 *
 * Run: DEVFLOW_INTEGRATION_ALL=1 npx vitest run --config vitest.integration.config.ts \
 *        tests/integration/ambient-activation.test.ts
 * (not part of `npm test` or a plain `npm run test:integration` — each test is an API call)
 */
const credential = pickCredential(process.env);
const skipReason = liveSkipReason(credential, isClaudeAvailable());
printLiveSkip('ambient-activation', skipReason);

describe.skipIf(skipReason !== null)('devflow ambient plan handoff', () => {
  let ctx: SpawnContext;

  beforeAll(() => {
    ctx = createSpawnContext(credential);
    console.log(describeSpawnContext(ctx));
    installDevflow(ctx);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(() => {
    if (ctx !== undefined) disposeSpawnContext(ctx);
  });

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

    const result = await runClaudeStreaming(ctx, planPrompt, {
      timeout: 30000,
      systemPrompt: HANDOFF_TEMPLATE,
    });
    expect(hasRequiredSkills(result, ['implement'])).toBe(true);
    console.log(`plan handoff: ${result.durationMs}ms. Skills: [${result.skills.join(', ')}]`);
  });

  it('normal prompt — orchestrator reminder does not trigger a skill invocation', async () => {
    const result = await runClaudeStreaming(ctx, 'what does the config module do?', {
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
