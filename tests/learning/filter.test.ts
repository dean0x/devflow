// tests/learning/filter.test.ts
// Tests for the channel-based transcript filter (D1, D2).
// Validates pollution rejection, channel population, and cap behaviour.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';
import * as url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load the CJS module under test
const { extractChannels } = require(
  path.resolve(__dirname, '../../scripts/hooks/lib/transcript-filter.cjs')
) as { extractChannels: (jsonl: string) => { userSignals: string[]; dialogPairs: { prior: string; user: string }[] } };

// Helper: build a JSONL line in the transcript envelope format used by Claude Code
function line(entry: Record<string, unknown>): string {
  return JSON.stringify(entry);
}
function userMsg(text: string, extra: Record<string, unknown> = {}): string {
  return line({ type: 'user', message: { role: 'user', content: text }, ...extra });
}
function assistantMsg(text: string): string {
  return line({ type: 'assistant', message: { role: 'assistant', content: text } });
}
function userArrayMsg(items: unknown[]): string {
  return line({ type: 'user', message: { role: 'user', content: items } });
}

describe('extractChannels — pollution rejection (D2)', () => {
  it('rejects entries where isMeta is true', () => {
    const input = [
      line({ type: 'user', isMeta: true, message: { role: 'user', content: 'some user text here' } }),
      userMsg('keep this valid user message ok'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('keep this valid user message ok');
  });

  it('rejects entries with sourceToolUseID present', () => {
    const input = [
      line({ type: 'user', sourceToolUseID: 'tool-123', message: { role: 'user', content: 'hidden content here xx' } }),
      userMsg('visible user message comes through ok'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('visible user message comes through ok');
  });

  it('rejects entries with toolUseResult present', () => {
    const input = [
      line({ type: 'user', toolUseResult: { output: 'foo' }, message: { role: 'user', content: 'tool result noise' } }),
      userMsg('clean message after tool result ok'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('clean message after tool result ok');
  });

  it('rejects string user content matching <command-name> wrapper', () => {
    const input = [
      userMsg('<command-name>devflow:router</command-name> loaded context'),
      userMsg('plain user message that is fine'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('plain user message that is fine');
  });

  it('rejects string user content matching <local-command-* wrapper', () => {
    const input = [
      userMsg('<local-command-foo>bar baz content</local-command-foo>'),
      userMsg('good user message here for signals'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('good user message here for signals');
  });

  it('rejects string user content matching <system-reminder> wrapper', () => {
    const input = [
      userMsg('<system-reminder>Do not use certain tools.</system-reminder>'),
      userMsg('actual user instruction that matters'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('actual user instruction that matters');
  });

  it('rejects string user content matching <example> wrapper', () => {
    const input = [
      userMsg('<example>here is an example content block</example>'),
      userMsg('real user request text goes here'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('real user request text goes here');
  });

  it('rejects user array turn where any item is type tool_result', () => {
    const input = [
      userArrayMsg([
        { type: 'tool_result', content: 'result output data here' },
        { type: 'text', text: 'this text should also be excluded' },
      ]),
      userMsg('clean user message passes through ok'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('clean user message passes through ok');
  });

  it('excludes noisy text items from array but keeps clean items', () => {
    const input = [
      userArrayMsg([
        { type: 'text', text: '<system-reminder>injected context noise</system-reminder>' },
        { type: 'text', text: 'actual user text that is clean and valid ok' },
      ]),
      userMsg('another valid message here too'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    // First message has clean text after filtering noisy item
    expect(userSignals).toHaveLength(2);
    expect(userSignals[0]).toBe('actual user text that is clean and valid ok');
  });

  it('rejects empty user content (< 5 chars after trim)', () => {
    const input = [
      userMsg('   ok  '),  // 2 chars after trim — rejected
      userMsg('valid user text that is long enough'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0]).toBe('valid user text that is long enough');
  });

  it('rejects invalid JSON lines gracefully', () => {
    const input = [
      '{ invalid json line here }',
      userMsg('valid message is kept after bad json'),
    ].join('\n');

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
  });
});

describe('extractChannels — channel population', () => {
  it('populates USER_SIGNALS from plain user text', () => {
    const input = [
      userMsg('implement the plan, then run /self-review, then commit'),
      userMsg('squash merge the PR, pull main, delete the feature branch'),
    ].join('\n');

    const { userSignals, dialogPairs } = extractChannels(input);
    expect(userSignals).toHaveLength(2);
    expect(userSignals[0]).toContain('implement the plan');
    expect(dialogPairs).toHaveLength(0);  // no assistant turns precede these
  });

  it('populates DIALOG_PAIRS when user turn directly follows assistant turn', () => {
    const input = [
      assistantMsg("I'll add a try/catch around the Result parsing to be safe here"),
      userMsg("no — we use Result types precisely to avoid try/catch. Do not wrap."),
    ].join('\n');

    const { userSignals, dialogPairs } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(dialogPairs).toHaveLength(1);
    expect(dialogPairs[0].prior).toContain("I'll add a try/catch");
    expect(dialogPairs[0].user).toContain("we use Result types");
  });

  it('does NOT add to DIALOG_PAIRS when user follows another user (no assistant prior)', () => {
    const input = [
      userMsg('first user message about workflow steps here'),
      userMsg('second user message directly following first one'),
    ].join('\n');

    const { dialogPairs } = extractChannels(input);
    expect(dialogPairs).toHaveLength(0);
  });

  it('does NOT include DIALOG_PAIR when assistant turn has only tool-use content (rejected)', () => {
    // Assistant turn with only noisy content is filtered out — cannot be a "prior"
    const input = [
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: '<command-name>some-command</command-name>',
        },
      }),
      userMsg('user message after rejected assistant turn here ok'),
    ].join('\n');

    const { userSignals, dialogPairs } = extractChannels(input);
    // User message still appears in signals
    expect(userSignals).toHaveLength(1);
    // But no dialog pair because assistant turn was filtered
    expect(dialogPairs).toHaveLength(0);
  });

  it('builds multiple dialog pairs correctly', () => {
    const input = [
      assistantMsg("I'll update the file and amend the commit for you right now."),
      userMsg("don't amend pushed commits. Create a new one."),
      assistantMsg("Understood. I'll create a new commit with the changes needed."),
      userMsg("correct — thank you for confirming that approach"),
    ].join('\n');

    const { dialogPairs } = extractChannels(input);
    expect(dialogPairs).toHaveLength(2);
    expect(dialogPairs[0].prior).toContain("amend the commit");
    expect(dialogPairs[0].user).toContain("don't amend pushed commits");
    expect(dialogPairs[1].prior).toContain("new commit");
    expect(dialogPairs[1].user).toContain("thank you");
  });
});

describe('extractChannels — caps and limits', () => {
  it('caps text to 1200 chars per turn', () => {
    const longText = 'x'.repeat(2000);
    const input = userMsg(longText);

    const { userSignals } = extractChannels(input);
    expect(userSignals).toHaveLength(1);
    expect(userSignals[0].length).toBe(1200);
  });

  it('caps to last 80 turns when more are present', () => {
    // Create 90 user messages
    const lines: string[] = [];
    for (let i = 0; i < 90; i++) {
      lines.push(userMsg(`user message number ${i} which is valid and long enough`));
    }

    const { userSignals } = extractChannels(lines.join('\n'));
    // Should have at most 80 turns worth of signals
    expect(userSignals.length).toBeLessThanOrEqual(80);
  });

  it('handles empty input gracefully', () => {
    const { userSignals, dialogPairs } = extractChannels('');
    expect(userSignals).toHaveLength(0);
    expect(dialogPairs).toHaveLength(0);
  });

  it('handles input with only blank lines', () => {
    const { userSignals, dialogPairs } = extractChannels('\n\n\n');
    expect(userSignals).toHaveLength(0);
    expect(dialogPairs).toHaveLength(0);
  });
});
