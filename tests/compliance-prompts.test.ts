/**
 * Tests for src/cli/commands/compliance-prompts.ts
 *
 * Covers:
 *   - shouldRunComplianceStep: all 8 gate rows from the B1 table
 *   - runComplianceStep: step semantics via fake recorded IO (injectable prompts)
 *   - Shared helpers: frameworkChoices, formatFrameworkCatalogue
 *   - TP-43 (AC-37): the compiled prompts that run the compliance lens — gated on the
 *     settings line, loading only the framework references they are given
 *
 * Assertions cover concrete output values, not types, and every
 * significant branch has a test that can go red when behavior changes.
 * runComplianceStep never calls process.exit or throws — tests
 * verify the returned discriminated union drives all caller decisions.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import {
  shouldRunComplianceStep,
  runComplianceStep,
  frameworkChoices,
  formatFrameworkCatalogue,
  FRAMEWORK_SELECT_MESSAGE,
  type CompliancePromptIO,
  type PromptOutcome,
} from '../src/cli/commands/compliance-prompts.js';
import { COMPLIANCE_FRAMEWORKS } from '../src/core/compliance.js';
import { composeComplianceSkill } from '../src/core/compliance-compose.js';
import { ROOT, collectCodeSpawnSites, requireDistFile, requireDistFiles, resolveAgentSource, walkFiles } from './helpers.js';
import type { CodeSpawnSite } from './helpers.js';

// ── Fake prompt builder ────────────────────────────────────────────────────────

/**
 * Build a fake CompliancePromptIO from queued responses.
 * Responses are consumed in order; the test fails loudly if a prompt is called
 * more times than responses were queued.
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

// ── TP-43 (AC-37): the compiled lens reads the settings line, never the file set ──
//
// Every install carries all six framework references (D-COMPLIANCE-INSTALL-ALWAYS),
// so a prompt that let file presence choose frameworks would load all six on every
// machine. The chain instead runs: settings line `COMPLIANCE` → `COMPLIANCE_FRAMEWORKS`
// (and `COMPLIANCE_ACTIVE`) in the command → the spawn block → the agent loads
// `references/{id}.md` for those ids alone (D-COMPLIANCE-REPO-LENS).
//
// NOT covered: whether the model obeys the text. That is behaviour, not text; the
// S23 scenario in compliance-e2e.test.ts pins the resolver's side (a hipaa repo on a
// compliance-off machine resolves COMPLIANCE=hipaa, and hipaa.md is installed).

/** The one mapping sentence both gate hosts expand, and the two pass-through hosts carry. */
const FRAMEWORKS_SENTENCE =
  "`COMPLIANCE_FRAMEWORKS` is the settings line's `COMPLIANCE` with `generic` written `none`: `off`, `none`, or the framework ids the machine and this repository declare.";
const ACTIVE_SENTENCE = '`COMPLIANCE_ACTIVE` is `true` unless `COMPLIANCE_FRAMEWORKS` is `off`.';
const SPAWN_KEY = 'COMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}';

/**
 * Named collector: lines that let INSTALLED FILES choose the frameworks — the rule
 * install-all made false. Shared by the live sweep and the known-bad probe.
 */
function collectPresenceSelection(file: string, content: string): string[] {
  const PRESENCE = [
    /Active frameworks = the `references\/\{id\}\.md` files present/,
    /presence in the installed skill directory is the authoritative/i,
    /identified from installed `references\/\{id\}\.md` files/,
    /skills\/devflow:compliance\/SKILL\.md` exists/,
  ];
  return content.split('\n').flatMap((line, i) =>
    PRESENCE.some(re => re.test(line)) ? [`${file}:${i + 1}: ${line.trim().slice(0, 100)}`] : []);
}

/** Compiled commands that spawn Code agents, and the spawn sites each carries today. Floors: may only rise. */
const CODE_SPAWN_FLOORS: Readonly<Record<string, number>> = {
  // 9 fences (single, sequential ×2, parallel ×2, validation/alignment/qa-fix, pr-create) + the CI-fix line
  'implement.md': 10,
  // the issue-fix and validation-fix fences + the CI-fix line
  'resolve.md': 3,
  // implement, validation-fix, alignment-fix, qa-fix, review-fix and final-validation-fix templates + the merge-conflict resolver sentence
  'dynamic-build.md': 7,
};

/** The sites whose payload hands the Code agent no compliance lens — rendered for the failure message. */
function collectUnlensedSites(sites: readonly CodeSpawnSite[]): string[] {
  const LENS = /COMPLIANCE_FRAMEWORKS: \$?\{COMPLIANCE_FRAMEWORKS\}|(?:with|carries) `COMPLIANCE_FRAMEWORKS`/;
  return sites.filter(s => !LENS.test(s.payload)).map(s => `${s.file}:${s.line}`);
}

function src(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('TP-43 (AC-37): the compiled compliance lens loads only the ids the settings line resolves', () => {
  it('both gate hosts set the lens from the settings line and gate the compliance agent on COMPLIANCE_ACTIVE', () => {
    for (const host of ['code-review.md', 'plan.md']) {
      const text = requireDistFile(host);
      expect(text, `${host}: the mapping sentence`).toContain(FRAMEWORKS_SENTENCE);
      expect(text, `${host}: COMPLIANCE=off switches the lens off`).toContain(ACTIVE_SENTENCE);
      expect(text, `${host}: the lens resolves after the settings block`).toMatch(
        /\*\*Resolve the settings line\*\*[\s\S]*\*\*Set the compliance lens\*\* from that line/,
      );
    }
    expect(requireDistFile('code-review.md')).toContain('| COMPLIANCE_ACTIVE AND diff touches regulated surface | compliance |');
    expect(requireDistFile('plan.md')).toContain('| compliance | Regulatory gaps');
    expect(requireDistFile('plan.md')).toContain('(only when COMPLIANCE_ACTIVE) |');
  });

  it('the compliance Review and Design spawns carry the resolved ids', () => {
    const reviewFence = requireDistFile('code-review.md').match(/Agent\(subagent_type="Review"[\s\S]*?```/);
    expect(reviewFence?.[0]).toContain(SPAWN_KEY);
    const designFence = requireDistFile('plan.md').match(/Agent\(subagent_type="Design"\):\n"Mode: gap-analysis[\s\S]*?```/);
    expect(designFence?.[0]).toContain(SPAWN_KEY);
  });

  it('/implement and /resolve pass the lens to their Code spawns without gating on it', () => {
    for (const host of ['implement.md', 'resolve.md']) {
      const text = requireDistFile(host);
      expect(text, `${host}: the mapping sentence`).toContain(FRAMEWORKS_SENTENCE);
      expect(text, `${host}: a pass-through host never gates on the lens`).not.toContain('COMPLIANCE_ACTIVE');
    }
  });

  it('every compiled Code spawn — implementing, fix-phase, CI-fix and pr-create — carries the lens', () => {
    // Before install-all a fix-phase Code agent found the lens by checking whether the
    // compliance skill was installed; with every install carrying it, the resolved ids
    // are the only signal, and a spawn without them runs with the lens `off`.
    const sites = requireDistFiles().flatMap(f => collectCodeSpawnSites(f, requireDistFile(f)));
    for (const [host, floor] of Object.entries(CODE_SPAWN_FLOORS)) {
      const n = sites.filter(s => s.file === host).length;
      expect(n, `${host}: ${n} Code spawn site(s), floor ${floor} — the collector stopped reading them`).toBeGreaterThanOrEqual(floor);
    }
    expect(
      [...new Set(sites.map(s => s.file))].sort(),
      'a command outside the named set spawns Code agents — name it in CODE_SPAWN_FLOORS',
    ).toEqual(Object.keys(CODE_SPAWN_FLOORS).sort());
    expect(collectUnlensedSites(sites)).toEqual([]);
  });

  it('known-bad probe: a Code spawn of each shape that drops the lens is reported by the same collector', () => {
    const implement = requireDistFile('implement.md');
    // [host, live text, the lens as that shape spells it, what the spawn reads without it]
    const probes: Array<[string, string, string, string]> = [
      ['implement.md', implement, '\n   COMPLIANCE_FRAMEWORKS: {COMPLIANCE_FRAMEWORKS}"', '"'], // an indented fix-phase fence
      ['implement.md', implement, ' with `COMPLIANCE_FRAMEWORKS`', ''],                      // the CI-fix prose spawn
      ['dynamic-build.md', requireDistFile('dynamic-build.md'), '\nCOMPLIANCE_FRAMEWORKS: ${COMPLIANCE_FRAMEWORKS}', ''], // a template spawn
      ['dynamic-build.md', requireDistFile('dynamic-build.md'), ' and carries `COMPLIANCE_FRAMEWORKS`', ''],              // the merge-conflict resolver sentence
    ];
    for (const [host, real, lens, without] of probes) {
      expect(collectUnlensedSites(collectCodeSpawnSites(host, real)), `${host}: the live text is clean`).toEqual([]);
      const seeded = real.replace(lens, without);
      expect(seeded, `${host}: the seed must land (${lens.trim()})`).not.toBe(real);
      expect(collectUnlensedSites(collectCodeSpawnSites(host, seeded)), `${host}: dropping ${lens.trim()}`).toHaveLength(1);
    }
  });

  it('/dynamic-build resolves the lens before authoring and hands it to its implementing Code agent', () => {
    // The engine's Code agents lost the presence check with install-all; without the
    // ids they read an absent COMPLIANCE_FRAMEWORKS as `off` and never load the skill.
    const text = requireDistFile('dynamic-build.md');
    expect(text, 'the mapping sentence').toContain(FRAMEWORKS_SENTENCE);
    expect(text, 'a pass-through host never gates on the lens').not.toContain('COMPLIANCE_ACTIVE');
    expect(text).toMatch(/\*\*Resolve the settings line\*\*[\s\S]*\*\*Set the compliance lens\*\* from that line/);
    // Authored in as a shape-gated constant: anything but off, none or a registry-shaped id list is `off`.
    const constant = /^const COMPLIANCE_FRAMEWORKS = .*args\.complianceFrameworks.*$/m.exec(text)?.[0] ?? '';
    expect(constant, 'no COMPLIANCE_FRAMEWORKS constant in the SINGLE skeleton').not.toBe('');
    expect(constant).toContain(': "off"');
    const implement = /await phase\("implement"[\s\S]*?\{ agentType: "Code" \}/.exec(text)?.[0] ?? '';
    expect(implement, 'no implement-phase Code spawn found').not.toBe('');
    expect(implement).toContain('COMPLIANCE_FRAMEWORKS: ${COMPLIANCE_FRAMEWORKS}');
    // WAVE mode runs the same engine per ticket and must forward the constant.
    expect(text).toMatch(/runSingleTicketEngine\(\{[^\n]*complianceFrameworks: COMPLIANCE_FRAMEWORKS/);
  });

  it('the agents and skills that run the lens load references for the given ids only', () => {
    expect(resolveAgentSource('review').content).toContain('- **COMPLIANCE_FRAMEWORKS** (compliance focus)');
    expect(resolveAgentSource('review').content).toContain('Load `references/{id}.md` only for these ids.');
    expect(resolveAgentSource('design').content).toContain('Load `references/{id}.md` only for these ids.');
    expect(resolveAgentSource('code').content).toContain('load `references/{id}.md` only for the ids it lists');
    expect(src('src/assets/skills/gap-analysis/SKILL.md')).toContain('`references/{id}.md` only for the ids in `COMPLIANCE_FRAMEWORKS`');
  });

  it('a compliance-off machine\'s skill (neutral stamp) sends a hipaa lens to references/hipaa.md alone', () => {
    const { content } = composeComplianceSkill(src('src/assets/skills/compliance/SKILL.md'), [], new Map());
    expect(content).toContain('The machine declares no framework.');
    expect(content).toContain('(`COMPLIANCE_FRAMEWORKS`, this machine\'s plus the repository\'s) are the frameworks in force.');
    expect(content).toContain('Load `references/{id}.md` for each given id and no other; `none` means generic controls only.');
    // No framework is named by the neutral stamp, so nothing but the given ids points anywhere.
    for (const fw of COMPLIANCE_FRAMEWORKS) expect(content).not.toContain(`references/${fw.id}.md`);
  });

  it('no compiled command, agent or skill lets installed files choose the frameworks', () => {
    const corpus: Array<{ file: string; content: string }> = [
      ...requireDistFiles().map(f => ({ file: `dist/commands/${f}`, content: requireDistFile(f) })),
      ...walkFiles(path.join(ROOT, 'src', 'assets', 'agents'), f => f.endsWith('.md') || f.endsWith('.mds'))
        .map(f => ({ file: path.relative(ROOT, f), content: readFileSync(f, 'utf-8') })),
      ...walkFiles(path.join(ROOT, 'src', 'assets', 'skills'), f => f.endsWith('SKILL.md'))
        .map(f => ({ file: path.relative(ROOT, f), content: readFileSync(f, 'utf-8') })),
    ];
    expect(corpus.length, 'the sweep scanned nothing').toBeGreaterThan(30);
    expect(corpus.flatMap(({ file, content }) => collectPresenceSelection(file, content))).toEqual([]);
  });

  it('known-bad probe: the retired presence rules are reported by the same collector', () => {
    const seeded = [
      'Active frameworks = the `references/{id}.md` files present in the installed skill; never fabricate.',
      'File presence in the installed skill directory is the authoritative signal: if a',
      '- [ ] Active frameworks identified from installed `references/{id}.md` files; controls applied',
      'When `~/.claude/skills/devflow:compliance/SKILL.md` exists AND the task touches regulated surface',
    ].join('\n');
    expect(collectPresenceSelection('probe.md', seeded)).toHaveLength(4);
  });
});
