/**
 * Tests for the shared wizard predicate in src/cli/commands/prompt-io.ts.
 *
 * `shouldRunPromptedWizardStep` is the one gate table for a wizard step that runs on the
 * Advanced path and on a Recommended path the user chose in the Setup-mode prompt. It keys
 * on `modePromptShown`, never on the mode name, so `--recommended` and the non-TTY fallback
 * keep their promptless contract. The table below covers every row the compliance, tracker
 * and gate-level docs list, plus the one combination none of them lists (a CLI override on
 * the non-TTY fallback).
 */
import { describe, it, expect } from 'vitest';
import { shouldRunPromptedWizardStep } from '../src/cli/commands/prompt-io.js';

describe('shouldRunPromptedWizardStep', () => {
  const rows: Array<{
    name: string;
    input: Parameters<typeof shouldRunPromptedWizardStep>[0];
    expected: boolean;
  }> = [
    {
      name: '--recommended flag (mode=recommended, modePromptShown=false, isTTY=true)',
      input: { mode: 'recommended', modePromptShown: false, isTTY: true, hasCliOverride: false },
      expected: false,
    },
    {
      name: '!isTTY fallback (mode=recommended, modePromptShown=false, isTTY=false)',
      input: { mode: 'recommended', modePromptShown: false, isTTY: false, hasCliOverride: false },
      expected: false,
    },
    {
      name: 'interactive mode-prompt → Recommended (modePromptShown=true)',
      input: { mode: 'recommended', modePromptShown: true, isTTY: true, hasCliOverride: false },
      expected: true,
    },
    {
      name: '--advanced flag / re-init banner path (mode=advanced, modePromptShown=false)',
      input: { mode: 'advanced', modePromptShown: false, isTTY: true, hasCliOverride: false },
      expected: true,
    },
    {
      name: 'interactive mode-prompt → Advanced (modePromptShown=true)',
      input: { mode: 'advanced', modePromptShown: true, isTTY: true, hasCliOverride: false },
      expected: true,
    },
    {
      name: 'a CLI override on the Recommended path',
      input: { mode: 'recommended', modePromptShown: true, isTTY: true, hasCliOverride: true },
      expected: false,
    },
    {
      name: 'a CLI override on the Advanced path',
      input: { mode: 'advanced', modePromptShown: false, isTTY: true, hasCliOverride: true },
      expected: false,
    },
    {
      name: 'a CLI override on the non-TTY fallback',
      input: { mode: 'recommended', modePromptShown: false, isTTY: false, hasCliOverride: true },
      expected: false,
    },
  ];

  it('has exactly 8 rows', () => {
    expect(rows).toHaveLength(8);
  });

  for (const row of rows) {
    it(`${row.name} → ${row.expected}`, () => {
      expect(shouldRunPromptedWizardStep(row.input)).toBe(row.expected);
    });
  }

  it('answers false on a non-TTY run for every mode and prompt state, without a CLI override', () => {
    for (const mode of ['recommended', 'advanced'] as const) {
      for (const modePromptShown of [false, true]) {
        expect(
          shouldRunPromptedWizardStep({ mode, modePromptShown, isTTY: false, hasCliOverride: false }),
        ).toBe(false);
      }
    }
  });
});
