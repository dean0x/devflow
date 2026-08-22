/**
 * Tests for src/cli/commands/compliance-prompts.ts
 *
 * Covers:
 *   - shouldRunComplianceStep: all 8 gate rows from the B1 table
 *   - runComplianceStep: step semantics via fake recorded IO (injectable prompts)
 *   - Shared helpers: frameworkChoices, formatFrameworkCatalogue, formatComplianceSummary
 *
 * Per PF-018: assertions cover concrete output values, not types, and every
 * significant branch has a test that can go red when behavior changes.
 * Per PF-014: runComplianceStep never calls process.exit or throws — tests
 * verify the returned discriminated union drives all caller decisions.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  shouldRunComplianceStep,
  runComplianceStep,
  frameworkChoices,
  formatFrameworkCatalogue,
  formatComplianceSummary,
  FRAMEWORK_SELECT_MESSAGE,
  type CompliancePromptIO,
  type PromptOutcome,
} from '../src/cli/commands/compliance-prompts.js';
import { COMPLIANCE_FRAMEWORKS } from '../src/core/compliance.js';

// ── Fake prompt builder ────────────────────────────────────────────────────────

/**
 * Build a fake CompliancePromptIO from queued responses.
 * Responses are consumed in order; the test fails loudly if a prompt is called
 * more times than responses were queued (PF-018: non-vacuous assertions).
 */
function makePrompts(noteFn?: (message: string, title: string) => void) {
  const selectQueue: PromptOutcome<boolean>[] = [];
  const multiselectQueue: PromptOutcome<string[]>[] = [];
  let lastMultiselectOpts: Parameters<CompliancePromptIO['multiselect']>[0] | null = null;

  const prompts: CompliancePromptIO = {
    note: noteFn ?? vi.fn(),
    select: async (): Promise<PromptOutcome<boolean>> => {
      const next = selectQueue.shift();
      if (!next) throw new Error('No select response queued — test missing a queued outcome');
      return next;
    },
    multiselect: async (opts): Promise<PromptOutcome<string[]>> => {
      lastMultiselectOpts = opts;
      const next = multiselectQueue.shift();
      if (!next) throw new Error('No multiselect response queued — test missing a queued outcome');
      return next;
    },
  };

  return { prompts, selectQueue, multiselectQueue, getLastMultiselectOpts: () => lastMultiselectOpts };
}

// ── shouldRunComplianceStep — all 8 gate rows ─────────────────────────────────

describe('shouldRunComplianceStep', () => {
  it('row 1: --recommended flag (mode=recommended, modePromptShown=false, isTTY=true) → false', () => {
    expect(shouldRunComplianceStep({
      mode: 'recommended',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(false);
  });

  it('row 2: !isTTY fallback (mode=recommended, modePromptShown=false, isTTY=false) → false', () => {
    expect(shouldRunComplianceStep({
      mode: 'recommended',
      modePromptShown: false,
      isTTY: false,
      hasCliOverride: false,
    })).toBe(false);
  });

  it('row 3: interactive mode-prompt → Recommended (modePromptShown=true, mode=recommended, isTTY=true) → true', () => {
    expect(shouldRunComplianceStep({
      mode: 'recommended',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 4: --advanced flag (mode=advanced, modePromptShown=false, isTTY=true) → true', () => {
    expect(shouldRunComplianceStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 5: re-init banner path (mode=advanced, modePromptShown=false, isTTY=true) → true', () => {
    // Same gate inputs as --advanced flag; both are mode=advanced with no prompt shown.
    expect(shouldRunComplianceStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 6: interactive mode-prompt → Advanced (mode=advanced, modePromptShown=true, isTTY=true) → true', () => {
    expect(shouldRunComplianceStep({
      mode: 'advanced',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: false,
    })).toBe(true);
  });

  it('row 7: CLI override wins (hasCliOverride=true, mode=recommended, modePromptShown=true, isTTY=true) → false', () => {
    expect(shouldRunComplianceStep({
      mode: 'recommended',
      modePromptShown: true,
      isTTY: true,
      hasCliOverride: true,
    })).toBe(false);
  });

  it('row 8: CLI override wins (hasCliOverride=true, mode=advanced, isTTY=true) → false', () => {
    expect(shouldRunComplianceStep({
      mode: 'advanced',
      modePromptShown: false,
      isTTY: true,
      hasCliOverride: true,
    })).toBe(false);
  });
});

// ── runComplianceStep — step semantics ────────────────────────────────────────

describe('runComplianceStep', () => {
  it('fresh enable + framework selection → resolved with enabled:true and selected frameworks', async () => {
    const { prompts, selectQueue, multiselectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: true });
    multiselectQueue.push({ kind: 'value', value: ['gdpr', 'hipaa'] });

    const result = await runComplianceStep({
      seed: { enabled: false, frameworks: [] },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual({ enabled: true, frameworks: ['gdpr', 'hipaa'] });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].level).toBe('success');
    expect(result.messages[0].text).toContain('gdpr, hipaa');
  });

  it('No selection skips the multiselect and returns disabled with preserved frameworks', async () => {
    const { prompts, selectQueue, multiselectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: false });
    // multiselectQueue is empty — multiselect must NOT be called when No is chosen

    const result = await runComplianceStep({
      seed: { enabled: true, frameworks: ['sox'] },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state.enabled).toBe(false);
    // Disable-keeps-frameworks: existing frameworks are preserved in the state
    expect(result.state.frameworks).toEqual(['sox']);
    expect(result.messages[0].level).toBe('info');
    expect(result.messages[0].text).toContain('devflow compliance --enable');
    // multiselectQueue was never touched — multiselect was not called
    expect(multiselectQueue).toHaveLength(0);
  });

  it('Enter-through (initialValue=true, multiselect initialValues=[gdpr]) preserves seeded values', async () => {
    const { prompts, selectQueue, multiselectQueue, getLastMultiselectOpts } = makePrompts();
    // User presses Enter — clack returns the initialValue
    selectQueue.push({ kind: 'value', value: true });
    multiselectQueue.push({ kind: 'value', value: ['gdpr'] });

    const result = await runComplianceStep({
      seed: { enabled: true, frameworks: ['gdpr'] },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual({ enabled: true, frameworks: ['gdpr'] });
    // Verify multiselect was seeded with existing frameworks
    const msOpts = getLastMultiselectOpts();
    expect(msOpts).not.toBeNull();
    expect(msOpts!.initialValues).toEqual(['gdpr']);
  });

  it('disable-keeps-frameworks: No on a seed with frameworks → state preserves the frameworks', async () => {
    const { prompts, selectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: false });

    const result = await runComplianceStep({
      seed: { enabled: true, frameworks: ['hipaa', 'pci-dss'] },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state.enabled).toBe(false);
    expect(result.state.frameworks).toEqual(['hipaa', 'pci-dss']);
  });

  it('zero-selection (Yes + empty multiselect) → message contains "generic controls only"', async () => {
    const { prompts, selectQueue, multiselectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: true });
    multiselectQueue.push({ kind: 'value', value: [] });

    const result = await runComplianceStep({
      seed: { enabled: false, frameworks: [] },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.state).toEqual({ enabled: true, frameworks: [] });
    expect(result.messages[0].text).toContain('generic controls only');
  });

  it('cancel at enable select → kind=cancelled', async () => {
    const { prompts, selectQueue } = makePrompts();
    selectQueue.push({ kind: 'cancel' });

    const result = await runComplianceStep({
      seed: { enabled: false, frameworks: [] },
      prompts,
    });

    expect(result.kind).toBe('cancelled');
  });

  it('cancel at framework multiselect → kind=cancelled', async () => {
    const { prompts, selectQueue, multiselectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: true });
    multiselectQueue.push({ kind: 'cancel' });

    const result = await runComplianceStep({
      seed: { enabled: false, frameworks: [] },
      prompts,
    });

    expect(result.kind).toBe('cancelled');
  });

  it('mutation safety: returned frameworks array does not alias seed.frameworks', async () => {
    const seedFrameworks = ['gdpr'];
    const { prompts, selectQueue, multiselectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: true });
    // multiselect returns the same reference test was about to put in seed — library may return
    // any array; the runner must defensively copy before seeding and after.
    const returnedFromMultiselect = ['gdpr', 'soc2'];
    multiselectQueue.push({ kind: 'value', value: returnedFromMultiselect });

    const result = await runComplianceStep({
      seed: { enabled: false, frameworks: seedFrameworks },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    // The returned frameworks array is the one from the multiselect response (fine)
    expect(result.state.frameworks).toEqual(['gdpr', 'soc2']);
    // Verify the seed itself was not mutated
    expect(seedFrameworks).toEqual(['gdpr']);
  });

  it('mutation safety (No path): returned frameworks array is a copy, not alias of seed.frameworks', async () => {
    const seedFrameworks = ['hipaa'];
    const { prompts, selectQueue } = makePrompts();
    selectQueue.push({ kind: 'value', value: false });

    const result = await runComplianceStep({
      seed: { enabled: true, frameworks: seedFrameworks },
      prompts,
    });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    // The returned frameworks should equal seedFrameworks in content
    expect(result.state.frameworks).toEqual(['hipaa']);
    // But must NOT be the same reference
    expect(result.state.frameworks).not.toBe(seedFrameworks);
  });

  it('note copy includes "Current setting:" as the first line', async () => {
    let capturedNote = '';
    const { prompts, selectQueue } = makePrompts((message) => { capturedNote = message; });
    selectQueue.push({ kind: 'value', value: false });

    await runComplianceStep({
      seed: { enabled: true, frameworks: ['gdpr'] },
      prompts,
    });

    expect(capturedNote).toContain('Current setting:');
    // Current setting should reflect the seed state
    expect(capturedNote).toMatch(/Current setting:.*enabled/);
  });

  it('note for disabled seed says "Current setting: disabled"', async () => {
    let capturedNote = '';
    const { prompts, selectQueue } = makePrompts((message) => { capturedNote = message; });
    selectQueue.push({ kind: 'value', value: false });

    await runComplianceStep({
      seed: { enabled: false, frameworks: [] },
      prompts,
    });

    expect(capturedNote).toContain('Current setting: disabled');
  });
});

// ── Shared helpers ─────────────────────────────────────────────────────────────

describe('frameworkChoices', () => {
  it('returns one entry per COMPLIANCE_FRAMEWORKS entry', () => {
    const choices = frameworkChoices();
    expect(choices).toHaveLength(COMPLIANCE_FRAMEWORKS.length);
  });

  it('each choice has value, label, hint from the registry', () => {
    const choices = frameworkChoices();
    for (const [i, fw] of COMPLIANCE_FRAMEWORKS.entries()) {
      expect(choices[i]).toEqual({ value: fw.id, label: fw.label, hint: fw.hint });
    }
  });

  it('FRAMEWORK_SELECT_MESSAGE is the canonical multiselect message', () => {
    expect(FRAMEWORK_SELECT_MESSAGE).toContain('Select compliance frameworks');
    expect(FRAMEWORK_SELECT_MESSAGE).toContain('Enter to skip');
  });
});

describe('formatFrameworkCatalogue', () => {
  it('includes each framework id and hint', () => {
    const catalogue = formatFrameworkCatalogue();
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      expect(catalogue).toContain(fw.id);
      expect(catalogue).toContain(fw.hint);
    }
  });

  it('uses padEnd alignment (each id padded to at least 10 chars)', () => {
    const catalogue = formatFrameworkCatalogue();
    const lines = catalogue.split('\n').slice(1); // skip header
    for (const line of lines) {
      // Expect format: "  <id padded> — <hint>"
      expect(line).toMatch(/^  \S.{8,} — /);
    }
  });
});

describe('formatComplianceSummary', () => {
  it('returns "disabled" when not enabled (regardless of frameworks)', () => {
    expect(formatComplianceSummary(false, [])).toBe('disabled');
    expect(formatComplianceSummary(false, ['gdpr'])).toBe('disabled');
  });

  it('returns "enabled (generic controls only)" when enabled with no frameworks', () => {
    expect(formatComplianceSummary(true, [])).toBe('enabled (generic controls only)');
  });

  it('returns "enabled (gdpr, soc2)" when enabled with frameworks', () => {
    expect(formatComplianceSummary(true, ['gdpr', 'soc2'])).toBe('enabled (gdpr, soc2)');
  });
});
