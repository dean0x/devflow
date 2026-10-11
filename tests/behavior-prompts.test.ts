/**
 * The behavior wizard step (D-BEHAVIOR-OPT-IN): a pure gate and a step runner over the
 * shared prompt-IO seam. The step is Advanced-only, like external model routing; the
 * Recommended path and every non-TTY path carry the seeded value unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldRunBehaviorStep,
  runBehaviorStep,
  buildClackBehaviorPrompts,
} from '../src/cli/commands/behavior-prompts.js';
import type { WizardPromptIO, PromptOutcome } from '../src/cli/commands/prompt-io.js';

function fakePrompts(answer: PromptOutcome<boolean>): { io: WizardPromptIO; notes: Array<{ message: string; title: string }>; seenInitial: boolean[] } {
  const notes: Array<{ message: string; title: string }> = [];
  const seenInitial: boolean[] = [];
  return {
    notes,
    seenInitial,
    io: {
      note: (message, title) => { notes.push({ message, title }); },
      select: async (opts) => {
        seenInitial.push(opts.initialValue);
        return answer;
      },
    },
  };
}

describe('shouldRunBehaviorStep (pure gate)', () => {
  const base = { isTTY: true, hasCliOverride: false, rulesEnabled: true };

  it('runs on an interactive terminal with rules on and no flag', () => {
    expect(shouldRunBehaviorStep(base)).toBe(true);
  });

  it('does not run without a terminal', () => {
    expect(shouldRunBehaviorStep({ ...base, isTTY: false })).toBe(false);
  });

  it('does not run when --behavior or --no-behavior was passed', () => {
    expect(shouldRunBehaviorStep({ ...base, hasCliOverride: true })).toBe(false);
  });

  it('does not run when rules are off, because the rule cannot install', () => {
    expect(shouldRunBehaviorStep({ ...base, rulesEnabled: false })).toBe(false);
  });
});

describe('runBehaviorStep', () => {
  it('defaults the prompt to No on a fresh machine (seed false)', async () => {
    const { io, seenInitial } = fakePrompts({ kind: 'value', value: false });
    const outcome = await runBehaviorStep({ seed: false, prompts: io });
    expect(seenInitial).toEqual([false]);
    expect(outcome).toMatchObject({ kind: 'resolved', enabled: false });
  });

  it('seeds the prompt from the recorded value on re-init (seed true)', async () => {
    const { io, seenInitial } = fakePrompts({ kind: 'value', value: true });
    const outcome = await runBehaviorStep({ seed: true, prompts: io });
    expect(seenInitial).toEqual([true]);
    expect(outcome).toMatchObject({ kind: 'resolved', enabled: true });
  });

  it('returns the answer, and a message that names the way to change it later', async () => {
    const yes = await runBehaviorStep({ seed: false, prompts: fakePrompts({ kind: 'value', value: true }).io });
    expect(yes.kind).toBe('resolved');
    if (yes.kind === 'resolved') {
      expect(yes.enabled).toBe(true);
      expect(yes.messages.map(m => m.text).join('\n')).toMatch(/enabled/i);
    }
    const no = await runBehaviorStep({ seed: true, prompts: fakePrompts({ kind: 'value', value: false }).io });
    if (no.kind === 'resolved') {
      expect(no.enabled).toBe(false);
      expect(no.messages.map(m => m.text).join('\n')).toContain('devflow behavior --enable');
    }
  });

  it('shows one note that states what the rule does', async () => {
    const { io, notes } = fakePrompts({ kind: 'value', value: false });
    await runBehaviorStep({ seed: false, prompts: io });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Behavior');
    expect(notes[0].message).toContain('ASD-STE100');
  });

  it('reports a cancel without exiting or throwing', async () => {
    const outcome = await runBehaviorStep({ seed: false, prompts: fakePrompts({ kind: 'cancel' }).io });
    expect(outcome).toEqual({ kind: 'cancelled' });
  });
});

describe('buildClackBehaviorPrompts', () => {
  it('returns the shared note and select adapters', () => {
    const io = buildClackBehaviorPrompts();
    expect(typeof io.note).toBe('function');
    expect(typeof io.select).toBe('function');
  });
});
