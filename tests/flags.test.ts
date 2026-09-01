import { describe, it, expect } from 'vitest';
import {
  FLAG_REGISTRY,
  // New typed exports
  getDefaultFlagsRecord,
  defaultValueOf,
  neutralValueOf,
  isNeutral,
  coerceFlagValue,
  parseFlagValueInput,
  formatFlagValue,
  effectiveDisplay,
  describeFlagKind,
  expectedInputFor,
  countActiveFlags,
  readViewMode,
  sanitizeFlagsRecord,
  migrateLegacyFlagsToRecord,
  applyFlags,
  stripFlags,
  convergeFlagsIntoSettings,
  // Kept verbatim
  VIEW_MODES,
  resolveExistingViewMode,
  resolveFinalViewMode,
  type ViewMode,
  type FlagsRecord,
  type ClaudeCodeFlag,
  type BooleanFlagDef,
  type EnumFlagDef,
  type NumberFlagDef,
  type StringFlagDef,
} from '../src/core/flags.js';
import { resolveSeedFlags } from '../src/cli/commands/init-seed.js';

// ─── Registry invariants ──────────────────────────────────────────────────────

describe('FLAG_REGISTRY — structural invariants', () => {
  it('has unique IDs', () => {
    const ids = FLAG_REGISTRY.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique env target keys (no duplicate env var keys)', () => {
    const envKeys = FLAG_REGISTRY
      .filter(f => f.target.type === 'env')
      .map(f => f.target.key);
    expect(new Set(envKeys).size).toBe(envKeys.length);
  });

  it('has unique setting target keys (no duplicate setting keys)', () => {
    const settingKeys = FLAG_REGISTRY
      .filter(f => f.target.type === 'setting')
      .map(f => f.target.key);
    expect(new Set(settingKeys).size).toBe(settingKeys.length);
  });

  it('every flag has required common fields', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(flag.id, `${flag.id}: id`).toBeTruthy();
      expect(flag.label, `${flag.id}: label`).toBeTruthy();
      expect(flag.description, `${flag.id}: description`).toBeTruthy();
      expect(flag.hint, `${flag.id}: hint`).toBeTruthy();
      expect(typeof flag.recommended, `${flag.id}: recommended`).toBe('boolean');
      expect(['boolean', 'enum', 'number', 'string'], `${flag.id}: kind`).toContain(flag.kind);
      expect(flag.target, `${flag.id}: target`).toBeDefined();
      expect(['env', 'setting'], `${flag.id}: target.type`).toContain(flag.target.type);
      expect(typeof flag.target.key, `${flag.id}: target.key`).toBe('string');
    }
  });

  it('boolean flags have valid onPayload and boolean defaultValue', () => {
    const boolFlags = FLAG_REGISTRY.filter((f): f is BooleanFlagDef => f.kind === 'boolean');
    expect(boolFlags.length).toBeGreaterThan(0);
    for (const flag of boolFlags) {
      // Env targets must use strings; setting targets may also use plain objects (D27/D-ATTR-GUARD).
      const isValidPayload =
        typeof flag.onPayload === 'string' ||
        typeof flag.onPayload === 'boolean' ||
        (flag.target.type === 'setting' &&
          typeof flag.onPayload === 'object' &&
          flag.onPayload !== null &&
          !Array.isArray(flag.onPayload));
      expect(isValidPayload, `${flag.id}: onPayload must be string, boolean, or plain object (setting targets only)`).toBe(true);
      expect(typeof flag.defaultValue, `${flag.id}: defaultValue must be boolean`).toBe('boolean');
    }
  });

  /**
   * Defense in depth. Since the BooleanFlagDef split into EnvBooleanFlagDef |
   * SettingBooleanFlagDef this is ALSO compile-enforced: an env target with an
   * object or boolean onPayload no longer typechecks. This test stays as the
   * runtime backstop for a registry entry that reaches the array through a cast.
   */
  it('env boolean flags have string onPayload (env vars are strings)', () => {
    const envBoolFlags = FLAG_REGISTRY
      .filter((f): f is BooleanFlagDef => f.kind === 'boolean' && f.target.type === 'env');
    // Non-vacuity: the filter must actually match something or the loop proves nothing.
    expect(envBoolFlags.length, 'no env boolean flags matched — assertion would be vacuous').toBeGreaterThan(0);
    for (const flag of envBoolFlags) {
      expect(
        typeof flag.onPayload,
        `${flag.id}: env boolean flag must have string onPayload`,
      ).toBe('string');
      // buildPayload writes onPayload verbatim and never consults settingDeleteGuard
      // for env targets, so a guard declared here would be a silent no-op.
      expect(
        flag.settingDeleteGuard,
        `${flag.id}: env boolean flags must not declare settingDeleteGuard (it is never honoured)`,
      ).toBeUndefined();
    }
  });

  /**
   * settingDeleteGuard is only meaningful for a payload that can differ from a
   * user's own value. Pinning it to deep-equal onPayload keeps the guard and the
   * written shape from drifting apart — a guard that no longer matches what
   * applyFlags writes would strand the key in settings.json forever.
   */
  it('settingDeleteGuard, where present, deep-equals the flag onPayload', () => {
    const guarded = FLAG_REGISTRY.filter(
      (f): f is BooleanFlagDef => f.kind === 'boolean' && f.settingDeleteGuard !== undefined,
    );
    expect(guarded.length, 'no guarded flags matched — assertion would be vacuous').toBeGreaterThan(0);
    for (const flag of guarded) {
      expect(
        flag.settingDeleteGuard,
        `${flag.id}: settingDeleteGuard must match the shape applyFlags writes`,
      ).toEqual(flag.onPayload);
    }
  });

  it('enum flags have non-empty values array', () => {
    const enumFlags = FLAG_REGISTRY.filter((f): f is EnumFlagDef => f.kind === 'enum');
    for (const flag of enumFlags) {
      expect(flag.values.length, `${flag.id}: values must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('enum flags: neutralValue is a member of values when defined', () => {
    const enumFlags = FLAG_REGISTRY.filter((f): f is EnumFlagDef => f.kind === 'enum');
    for (const flag of enumFlags) {
      if (flag.neutralValue !== undefined) {
        expect(
          flag.values,
          `${flag.id}: neutralValue '${flag.neutralValue}' must be in values`,
        ).toContain(flag.neutralValue);
      }
    }
  });

  it('enum flags: defaultValue is a member of values when defined', () => {
    const enumFlags = FLAG_REGISTRY.filter((f): f is EnumFlagDef => f.kind === 'enum');
    for (const flag of enumFlags) {
      if (flag.defaultValue !== undefined) {
        expect(
          flag.values,
          `${flag.id}: defaultValue '${flag.defaultValue}' must be in values`,
        ).toContain(flag.defaultValue);
      }
    }
  });

  it('number flags have valid bounds (min <= max when both defined)', () => {
    const numFlags = FLAG_REGISTRY.filter((f): f is NumberFlagDef => f.kind === 'number');
    for (const flag of numFlags) {
      if (flag.min !== undefined && flag.max !== undefined) {
        expect(flag.min, `${flag.id}: min must be <= max`).toBeLessThanOrEqual(flag.max);
      }
    }
  });

  it('string flags have positive maxLength when defined', () => {
    const strFlags = FLAG_REGISTRY.filter((f): f is StringFlagDef => f.kind === 'string');
    for (const flag of strFlags) {
      if (flag.maxLength !== undefined) {
        expect(flag.maxLength, `${flag.id}: maxLength must be > 0`).toBeGreaterThan(0);
      }
    }
  });

  it('every flag id is free of whitespace and control chars', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(flag.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

// ─── getDefaultFlagsRecord ────────────────────────────────────────────────────

describe('getDefaultFlagsRecord', () => {
  it('includes every registered flag ID', () => {
    const record = getDefaultFlagsRecord();
    for (const flag of FLAG_REGISTRY) {
      expect(Object.prototype.hasOwnProperty.call(record, flag.id), `missing: ${flag.id}`).toBe(true);
    }
    expect(Object.keys(record).length).toBe(FLAG_REGISTRY.length);
  });

  it('pinned default record — update intentionally when registry changes', () => {
    const record = getDefaultFlagsRecord();

    // Recommended (default ON) boolean flags
    expect(record['tui']).toBe(true);
    expect(record['tool-search']).toBe(true);
    expect(record['lsp']).toBe(true);
    expect(record['prompt-caching-1h']).toBe(true);
    expect(record['show-turn-duration']).toBe(true);
    expect(record['clear-context-on-plan']).toBe(true);
    expect(record['disable-bundled-skills']).toBe(true);
    expect(record['pin-sonnet-4-6']).toBe(true);

    // New recommended number flag
    expect(record['max-concurrent-subagents']).toBe(40);

    // Optional boolean flags (default OFF = false = neutral)
    expect(record['brief']).toBe(false);
    expect(record['thinking-summaries']).toBe(false);
    expect(record['subprocess-env-scrub']).toBe(false);
    expect(record['disable-nonessential-traffic']).toBe(false);
    expect(record['forked-subagents']).toBe(false);
    expect(record['disable-adaptive-thinking']).toBe(false);
    expect(record['always-thinking']).toBe(false);
    expect(record['disable-git-instructions']).toBe(false);
    expect(record['disable-compact']).toBe(false);
    expect(record['disable-1m-context']).toBe(false);
    expect(record['disable-autoupdater']).toBe(false);
    expect(record['agent-teams']).toBe(false);

    // New optional flags with undefined defaultValue → null
    expect(record['subagent-spawn-depth']).toBeNull();
    expect(record['workflow-size-guideline']).toBeNull();
    expect(record['default-model']).toBeNull();
    expect(record['goal-checkin-minutes']).toBeNull();
    expect(record['spellcheck']).toBeNull();

    // New optional boolean flag
    expect(record['enable-todo-tools']).toBe(false);

    // Attribution suppression flag (off by default — D27)
    expect(record['suppress-attribution']).toBe(false);

    // view-mode: default is neutralValue, so entry is 'default'
    expect(record['view-mode']).toBe('default');
  });
});

// ─── formatFlagValue — vocabulary table (CONS-H1) ────────────────────────────

describe('formatFlagValue — vocabulary table', () => {
  const boolFlag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
  const enumFlag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;    // neutralValue = 'default'
  const numFlag  = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
  const strFlag  = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;

  // D-EFFDV: formatFlagValue routes through effectiveDisplay — vocabulary updated
  // from enabled/disabled/unset to on/off/<effective-default> (never 'unset').
  it('boolean true → on', () => {
    expect(formatFlagValue(boolFlag, true)).toBe('on');
  });
  it('boolean false → off (not unset; false is neutral but still renders as off)', () => {
    expect(formatFlagValue(boolFlag, false)).toBe('off');
  });
  it('boolean null → off (boolean null treated same as false)', () => {
    expect(formatFlagValue(boolFlag, null)).toBe('off');
  });
  it('enum neutral value → effective neutral text (default for view-mode)', () => {
    expect(formatFlagValue(enumFlag, 'default')).toBe('default');
  });
  it('enum active value → string', () => {
    expect(formatFlagValue(enumFlag, 'verbose')).toBe('verbose');
  });
  it('enum null → neutralValue text (default for view-mode)', () => {
    expect(formatFlagValue(enumFlag, null)).toBe('default');
  });
  it('number null → devflow defaultValue string (40 for max-concurrent-subagents)', () => {
    expect(formatFlagValue(numFlag, null)).toBe('40');
  });
  it('number active value → string', () => {
    expect(formatFlagValue(numFlag, 40)).toBe('40');
  });
  it('string null → — (em-dash placeholder)', () => {
    expect(formatFlagValue(strFlag, null)).toBe('—');
  });
  it('string active value → string', () => {
    expect(formatFlagValue(strFlag, 'aspell')).toBe('aspell');
  });
});

// ─── defaultValueOf ───────────────────────────────────────────────────────────

describe('defaultValueOf', () => {
  it('boolean flag → flag.defaultValue (boolean)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(defaultValueOf(flag)).toBe(flag.defaultValue);
    expect(typeof defaultValueOf(flag)).toBe('boolean');
  });
  it('enum flag with defaultValue → that value', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(defaultValueOf(flag)).toBe('default');
  });
  it('number flag with defaultValue → that value', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(defaultValueOf(flag)).toBe(40);
  });
  it('number flag without defaultValue → null', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'subagent-spawn-depth')!;
    expect(defaultValueOf(flag)).toBeNull();
  });
  it('string flag without defaultValue → null', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;
    expect(defaultValueOf(flag)).toBeNull();
  });
});

// ─── neutralValueOf ───────────────────────────────────────────────────────────

describe('neutralValueOf', () => {
  it('boolean flag → false', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(neutralValueOf(flag)).toBe(false);
  });

  it('enum flag without neutralValue → null', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline')!;
    expect(neutralValueOf(flag)).toBeNull();
  });

  it('enum flag with neutralValue → that value', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(neutralValueOf(flag)).toBe('default');
  });

  it('number flag → null', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(neutralValueOf(flag)).toBeNull();
  });

  it('string flag → null', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;
    expect(neutralValueOf(flag)).toBeNull();
  });
});

// ─── isNeutral ────────────────────────────────────────────────────────────────

describe('isNeutral', () => {
  it('null is always neutral', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(isNeutral(flag, null), `${flag.id}: null`).toBe(true);
    }
  });

  it('false is neutral for boolean flags', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(isNeutral(flag, false)).toBe(true);
  });

  it('true is NOT neutral for boolean flags', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(isNeutral(flag, true)).toBe(false);
  });

  it('0 is NOT neutral for number flags (ACTIVE)', () => {
    // Number 0 is an explicit value (e.g. goal-checkin-minutes 0 = off, but still ACTIVE)
    const flag = FLAG_REGISTRY.find(f => f.id === 'goal-checkin-minutes')!;
    expect(isNeutral(flag, 0)).toBe(false);
  });

  it('neutralValue is neutral for enum flags', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(isNeutral(flag, 'default')).toBe(true);
  });

  it('non-neutral enum value is not neutral', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(isNeutral(flag, 'verbose')).toBe(false);
    expect(isNeutral(flag, 'focus')).toBe(false);
  });

  it('non-null string is not neutral for string flag', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;
    expect(isNeutral(flag, 'aspell')).toBe(false);
  });

  it('non-null number is not neutral for number flag', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(isNeutral(flag, 40)).toBe(false);
    expect(isNeutral(flag, 1)).toBe(false);
  });
});

// ─── coerceFlagValue ──────────────────────────────────────────────────────────

describe('coerceFlagValue — hostile-value sink cases', () => {
  const numFlag = (): NumberFlagDef =>
    FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents') as NumberFlagDef;
  const goalFlag = (): NumberFlagDef =>
    FLAG_REGISTRY.find(f => f.id === 'goal-checkin-minutes') as NumberFlagDef;
  const enumFlag = (): EnumFlagDef =>
    FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline') as EnumFlagDef;
  const strFlag = (): StringFlagDef =>
    FLAG_REGISTRY.find(f => f.id === 'spellcheck') as StringFlagDef;
  const boolFlag = (): BooleanFlagDef =>
    FLAG_REGISTRY.find(f => f.id === 'tui') as BooleanFlagDef;

  it('null → null (passes through)', () => {
    expect(coerceFlagValue(numFlag(), null)).toBeNull();
  });

  it('Infinity → null (hostile)', () => {
    expect(coerceFlagValue(numFlag(), Infinity)).toBeNull();
  });

  it('NaN → null (hostile)', () => {
    expect(coerceFlagValue(numFlag(), NaN)).toBeNull();
  });

  it('1e309 (overflows to Infinity) → null (hostile)', () => {
    expect(coerceFlagValue(numFlag(), 1e309)).toBeNull();
  });

  it('-Infinity → null (hostile)', () => {
    expect(coerceFlagValue(numFlag(), -Infinity)).toBeNull();
  });

  it('number below min → null (max-concurrent-subagents min: 1)', () => {
    expect(coerceFlagValue(numFlag(), 0)).toBeNull();
  });

  it('number above max → null (max-concurrent-subagents max: 100)', () => {
    expect(coerceFlagValue(numFlag(), 101)).toBeNull();
  });

  it('non-integer when integer required → null', () => {
    expect(coerceFlagValue(numFlag(), 1.5)).toBeNull();
  });

  it('valid finite integer in bounds → passes', () => {
    expect(coerceFlagValue(numFlag(), 40)).toBe(40);
    expect(coerceFlagValue(numFlag(), 1)).toBe(1);
    expect(coerceFlagValue(numFlag(), 100)).toBe(100);
  });

  it('goal-checkin-minutes: 0 passes (min: 0)', () => {
    expect(coerceFlagValue(goalFlag(), 0)).toBe(0);
  });

  it('goal-checkin-minutes: 1441 rejected (max: 1440)', () => {
    expect(coerceFlagValue(goalFlag(), 1441)).toBeNull();
  });

  it('valid enum value → passes', () => {
    expect(coerceFlagValue(enumFlag(), 'small')).toBe('small');
    expect(coerceFlagValue(enumFlag(), 'unrestricted')).toBe('unrestricted');
  });

  it('invalid enum value → null', () => {
    expect(coerceFlagValue(enumFlag(), 'huge')).toBeNull();
    expect(coerceFlagValue(enumFlag(), '')).toBeNull();
  });

  it('string within maxLength → passes (spellcheck maxLength: 256)', () => {
    expect(coerceFlagValue(strFlag(), 'aspell')).toBe('aspell');
    expect(coerceFlagValue(strFlag(), 'a'.repeat(256))).toBe('a'.repeat(256));
  });

  it('overlong string → null', () => {
    expect(coerceFlagValue(strFlag(), 'a'.repeat(257))).toBeNull();
  });

  it('control chars in string → null', () => {
    expect(coerceFlagValue(strFlag(), 'aspell\x00check')).toBeNull();
    expect(coerceFlagValue(strFlag(), 'aspell\x1fcheck')).toBeNull();
    expect(coerceFlagValue(strFlag(), 'aspell\x7fcheck')).toBeNull();
  });

  it('LF in string → null (SEC-M1: LF is a shell statement separator)', () => {
    // \x0a is LF — rejected so `spellcheck` cannot embed a second shell command
    expect(coerceFlagValue(strFlag(), 'aspell\nlist')).toBeNull();
    expect(coerceFlagValue(strFlag(), 'aspell\x0acheck')).toBeNull();
  });

  it('TAB in string → accepted (the sole documented exception)', () => {
    expect(coerceFlagValue(strFlag(), 'aspell\tlist')).toBe('aspell\tlist');
  });

  it('empty string → null (empty is UNSET, never an active value)', () => {
    expect(coerceFlagValue(strFlag(), '')).toBeNull();
  });

  it('valid boolean → passes', () => {
    expect(coerceFlagValue(boolFlag(), true)).toBe(true);
    expect(coerceFlagValue(boolFlag(), false)).toBe(false);
  });

  it('non-boolean for boolean flag → null', () => {
    expect(coerceFlagValue(boolFlag(), 'true')).toBeNull();
    expect(coerceFlagValue(boolFlag(), 1)).toBeNull();
  });

  it('non-number for number flag → null', () => {
    expect(coerceFlagValue(numFlag(), '40')).toBeNull();
  });

  it('non-string for enum flag → null', () => {
    expect(coerceFlagValue(enumFlag(), 42)).toBeNull();
  });
});

// ─── applyFlags (FlagsRecord) ─────────────────────────────────────────────────

describe('applyFlags — FlagsRecord API', () => {
  it('boolean true → applies onPayload for env flag', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'tool-search': true }));
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('boolean true → applies onPayload for setting flag (string value)', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { tui: true }));
    expect(result.tui).toBe('fullscreen');
  });

  it('boolean true → applies onPayload for setting flag (boolean value)', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'show-turn-duration': true }));
    expect(result.showTurnDuration).toBe(true);
  });

  it('boolean false (neutral) → deletes env var key', () => {
    const input = JSON.stringify({
      env: { ENABLE_TOOL_SEARCH: 'true', OTHER: 'keep' },
    }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'tool-search': false }));
    expect(result.env?.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env?.OTHER).toBe('keep');
  });

  it('boolean false (neutral) → deletes setting key', () => {
    const input = JSON.stringify({ tui: 'fullscreen', hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { tui: false }));
    expect(result.tui).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('null (neutral) → deletes env var key', () => {
    const input = JSON.stringify({
      env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '40' },
    }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'max-concurrent-subagents': null }));
    expect(result.env?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBeUndefined();
  });

  it('number flag → env gets stringified value ("40" not 40)', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'max-concurrent-subagents': 40 }));
    expect(result.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('40');
    expect(typeof result.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('string');
  });

  it('number 0 → active (writes "0" to env)', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'goal-checkin-minutes': 0 }));
    expect(result.env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES).toBe('0');
  });

  it('enum neutralValue → deletes setting key (view-mode: default removes viewMode)', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'view-mode': 'default' }));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('enum non-neutral → applies value (view-mode: verbose)', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'view-mode': 'verbose' }));
    expect(result.viewMode).toBe('verbose');
  });

  it('enum non-neutral → applies value (view-mode: focus)', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'view-mode': 'focus' }));
    expect(result.viewMode).toBe('focus');
  });

  it('spellcheck (string wrapKey) → writes {command: value} to setting key', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { spellcheck: 'aspell' }));
    expect(result.spellcheck).toEqual({ command: 'aspell' });
  });

  it('unknown flag IDs are skipped (forward compat)', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'nonexistent-future-flag': true }));
    // No effect — env or setting not created
    expect(result.env).toBeUndefined();
  });

  it('__proto__ as id is skipped (prototype pollution guard)', () => {
    const input = JSON.stringify({}, null, 2);
    // Should not throw or pollute __proto__ as an own property
    expect(() => applyFlags(input, { __proto__: true } as unknown as FlagsRecord)).not.toThrow();
    const result = JSON.parse(applyFlags(input, { __proto__: true } as unknown as FlagsRecord));
    // result['__proto__'] always resolves to Object.prototype via the prototype chain;
    // check OWN-property presence to verify no prototype pollution occurred.
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
  });

  it('env object created on demand when first env flag is applied', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'tool-search': true }));
    expect(result.env).toBeDefined();
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('env object cleaned up when all flags become neutral', () => {
    const input = JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'true' } }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'tool-search': false }));
    expect(result.env).toBeUndefined();
  });

  it('applies multiple flags at once', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, {
      'tool-search': true,
      lsp: true,
      'clear-context-on-plan': true,
    }));
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
    expect(result.env.ENABLE_LSP_TOOL).toBe('true');
    expect(result.showClearContextOnPlanAccept).toBe(true);
  });

  it('preserves existing non-flag settings', () => {
    const input = JSON.stringify({
      hooks: { Stop: [] },
      statusLine: { type: 'command' },
      env: { EXISTING_VAR: 'keep' },
    }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'tool-search': true }));
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.statusLine).toEqual({ type: 'command' });
    expect(result.env.EXISTING_VAR).toBe('keep');
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('returns unchanged JSON when empty record provided', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = applyFlags(input, {});
    expect(JSON.parse(result)).toEqual({ hooks: {} });
  });
});

// ─── stripFlags ───────────────────────────────────────────────────────────────

describe('stripFlags — covers viewMode and spellcheck', () => {
  it('removes env vars managed by flags', () => {
    const input = JSON.stringify({
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        ENABLE_LSP_TOOL: 'true',
        EXISTING_VAR: 'keep',
      },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env.ENABLE_LSP_TOOL).toBeUndefined();
    expect(result.env.EXISTING_VAR).toBe('keep');
  });

  it('removes top-level settings managed by flags', () => {
    const input = JSON.stringify({
      showClearContextOnPlanAccept: true,
      hooks: {},
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.showClearContextOnPlanAccept).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('removes string-valued setting (tui) when stripped', () => {
    const input = JSON.stringify({ tui: 'fullscreen', hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.tui).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('removes empty env object after stripping', () => {
    const input = JSON.stringify({
      hooks: {},
      env: { ENABLE_TOOL_SEARCH: 'true' },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env).toBeUndefined();
  });

  it('removes viewMode (via view-mode registry entry)', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('removes spellcheck setting when present', () => {
    const input = JSON.stringify({ spellcheck: { command: 'aspell' }, hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.spellcheck).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('removes CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS when agent-teams flag is registered', () => {
    const input = JSON.stringify({
      env: {
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CUSTOM_VAR: 'keep',
      },
    }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(result.env.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env.CUSTOM_VAR).toBe('keep');
  });

  it('strips flag-managed env keys regardless of their value', () => {
    const input = JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'false' } }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.env).toBeUndefined();
  });

  it('handles missing env object gracefully', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result).toEqual({ hooks: {} });
  });

  it('"env": [] in settings does not delete user keys (TS-M3: asPlainObject guard)', () => {
    // A malformed "env": [] (array, not object) must not match the empty-object
    // cleanup guard (Object.keys([]).length === 0 is true) and delete the env key.
    // stripFlags should leave an array env unchanged.
    const input = JSON.stringify({ env: [], hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    // Array env is not a valid env block and must survive unchanged
    expect(Array.isArray(result.env)).toBe(true);
    expect(result.hooks).toEqual({});
  });

  it('strip-then-apply is idempotent (INV-1): roundtrip preserves only non-flag settings', () => {
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);

    const withFlags = applyFlags(base, { 'tool-search': true, lsp: true, 'clear-context-on-plan': true });
    const stripped = stripFlags(withFlags);
    const result = JSON.parse(stripped);

    expect(result.env?.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(result.env?.ENABLE_LSP_TOOL).toBeUndefined();
    expect(result.showClearContextOnPlanAccept).toBeUndefined();
    expect(result.viewMode).toBeUndefined();
    expect(result.env?.CUSTOM).toBe('value');
    expect(result.hooks).toEqual({ Stop: [] });
  });

  it('roundtrip with all registered flags (full record)', () => {
    const record = getDefaultFlagsRecord();
    const base = JSON.stringify({
      hooks: { Stop: [] },
      env: { CUSTOM: 'value' },
    }, null, 2);

    const result = JSON.parse(stripFlags(applyFlags(base, record)));

    for (const flag of FLAG_REGISTRY) {
      if (flag.target.type === 'env') {
        expect(result.env?.[flag.target.key], `${flag.id}: env key`).toBeUndefined();
      } else {
        expect(result[flag.target.key], `${flag.id}: setting key`).toBeUndefined();
      }
    }
    expect(result.env?.CUSTOM).toBe('value');
    expect(result.hooks).toEqual({ Stop: [] });
  });
});

// ─── New flag: max-concurrent-subagents ──────────────────────────────────────

describe('max-concurrent-subagents flag', () => {
  it('is registered in FLAG_REGISTRY', () => {
    expect(FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')).toBeDefined();
  });

  it('is kind: number, recommended: true', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(flag.kind).toBe('number');
    expect(flag.recommended).toBe(true);
  });

  it('defaultValue: 40, min: 1, max: 100, integer: true, upstreamDefault: 20', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents') as NumberFlagDef;
    expect(flag.defaultValue).toBe(40);
    expect(flag.min).toBe(1);
    expect(flag.max).toBe(100);
    expect(flag.integer).toBe(true);
    expect(flag.upstreamDefault).toBe(20);
  });

  it('target is env CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(flag.target.type).toBe('env');
    expect(flag.target.key).toBe('CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS');
  });

  it('applyFlags writes "40" (string) to env', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'max-concurrent-subagents': 40 }));
    expect(result.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('40');
    expect(typeof result.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe('string');
  });

  it('coerceFlagValue rejects 0 (below min: 1)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(coerceFlagValue(flag, 0)).toBeNull();
  });

  it('coerceFlagValue rejects 101 (above max: 100)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(coerceFlagValue(flag, 101)).toBeNull();
  });
});

// ─── New flag: subagent-spawn-depth ──────────────────────────────────────────

describe('subagent-spawn-depth flag', () => {
  it('is registered, kind: number, recommended: false', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'subagent-spawn-depth') as NumberFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('number');
    expect(flag.recommended).toBe(false);
  });

  it('min: 1, max: 10, integer: true, upstreamDefault: 3, defaultValue: undefined', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'subagent-spawn-depth') as NumberFlagDef;
    expect(flag.min).toBe(1);
    expect(flag.max).toBe(10);
    expect(flag.integer).toBe(true);
    expect(flag.upstreamDefault).toBe(3);
    expect(flag.defaultValue).toBeUndefined();
  });

  it('target is env CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'subagent-spawn-depth')!;
    expect(flag.target.key).toBe('CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH');
  });
});

// ─── New flag: workflow-size-guideline ───────────────────────────────────────

describe('workflow-size-guideline flag', () => {
  it('is registered, kind: enum, recommended: false', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline') as EnumFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('enum');
    expect(flag.recommended).toBe(false);
  });

  it('values: small | medium | large | unrestricted', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline') as EnumFlagDef;
    expect(flag.values).toContain('small');
    expect(flag.values).toContain('medium');
    expect(flag.values).toContain('large');
    expect(flag.values).toContain('unrestricted');
  });

  it('target is setting workflowSizeGuideline', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline')!;
    expect(flag.target.type).toBe('setting');
    expect(flag.target.key).toBe('workflowSizeGuideline');
  });

  it('applyFlags writes enum value to setting', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'workflow-size-guideline': 'large' }));
    expect(result.workflowSizeGuideline).toBe('large');
  });

  it('coerceFlagValue rejects invalid value', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline')!;
    expect(coerceFlagValue(flag, 'huge')).toBeNull();
  });
});

// ─── New flag: default-model ──────────────────────────────────────────────────

describe('default-model flag', () => {
  it('is registered, kind: string, maxLength: 64', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'default-model') as StringFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('string');
    expect(flag.maxLength).toBe(64);
  });

  it('target is env ANTHROPIC_DEFAULT_MODEL', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'default-model')!;
    expect(flag.target.type).toBe('env');
    expect(flag.target.key).toBe('ANTHROPIC_DEFAULT_MODEL');
  });

  it('applyFlags writes model name to env', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'default-model': 'claude-opus-4-5' }));
    expect(result.env.ANTHROPIC_DEFAULT_MODEL).toBe('claude-opus-4-5');
  });
});

// ─── New flag: enable-todo-tools ─────────────────────────────────────────────

describe('enable-todo-tools flag', () => {
  it('is registered, kind: boolean, recommended: false', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'enable-todo-tools') as BooleanFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('boolean');
    expect(flag.recommended).toBe(false);
    expect(flag.defaultValue).toBe(false);
  });

  it('onPayload is "1" and target is env CLAUDE_CODE_ENABLE_TODO_TOOLS', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'enable-todo-tools') as BooleanFlagDef;
    expect(flag.onPayload).toBe('1');
    expect(flag.target.key).toBe('CLAUDE_CODE_ENABLE_TODO_TOOLS');
  });

  it('applyFlags writes "1" when enabled', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'enable-todo-tools': true }));
    expect(result.env.CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('1');
  });
});

// ─── New flag: goal-checkin-minutes ──────────────────────────────────────────

describe('goal-checkin-minutes flag', () => {
  it('is registered, kind: number, min: 0, max: 1440, integer: true', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'goal-checkin-minutes') as NumberFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('number');
    expect(flag.min).toBe(0);
    expect(flag.max).toBe(1440);
    expect(flag.integer).toBe(true);
    expect(flag.upstreamDefault).toBe(30);
  });

  it('target is env CLAUDE_CODE_GOAL_CHECKIN_MINUTES', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'goal-checkin-minutes')!;
    expect(flag.target.key).toBe('CLAUDE_CODE_GOAL_CHECKIN_MINUTES');
  });

  it('0 is valid (off-signal, still ACTIVE)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'goal-checkin-minutes')!;
    expect(coerceFlagValue(flag, 0)).toBe(0);
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { 'goal-checkin-minutes': 0 }));
    expect(result.env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES).toBe('0');
  });
});

// ─── New flag: spellcheck ─────────────────────────────────────────────────────

describe('spellcheck flag', () => {
  it('is registered, kind: string, wrapKey: "command", maxLength: 256', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'spellcheck') as StringFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('string');
    expect(flag.wrapKey).toBe('command');
    expect(flag.maxLength).toBe(256);
  });

  it('target is setting spellcheck', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;
    expect(flag.target.type).toBe('setting');
    expect(flag.target.key).toBe('spellcheck');
  });

  it('applyFlags writes {command: value} to setting', () => {
    const input = JSON.stringify({}, null, 2);
    const result = JSON.parse(applyFlags(input, { spellcheck: 'aspell --lang=en' }));
    expect(result.spellcheck).toEqual({ command: 'aspell --lang=en' });
  });

  it('null → spellcheck key deleted', () => {
    const input = JSON.stringify({ spellcheck: { command: 'aspell' } }, null, 2);
    const result = JSON.parse(applyFlags(input, { spellcheck: null }));
    expect(result.spellcheck).toBeUndefined();
  });
});

// ─── New flag: view-mode (fold-in) ────────────────────────────────────────────

describe('view-mode flag (fold-in of viewMode)', () => {
  it('is registered, kind: enum, neutralValue: "default"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode') as EnumFlagDef;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('enum');
    expect(flag.neutralValue).toBe('default');
    expect(flag.defaultValue).toBe('default');
  });

  it('values: default | verbose | focus', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode') as EnumFlagDef;
    expect(flag.values).toContain('default');
    expect(flag.values).toContain('verbose');
    expect(flag.values).toContain('focus');
  });

  it('target is setting viewMode', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(flag.target.type).toBe('setting');
    expect(flag.target.key).toBe('viewMode');
  });

  it('"default" (neutral) → removes viewMode key', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'view-mode': 'default' }));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('"verbose" → sets viewMode: "verbose"', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'view-mode': 'verbose' }));
    expect(result.viewMode).toBe('verbose');
  });

  it('"focus" → sets viewMode: "focus"', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyFlags(input, { 'view-mode': 'focus' }));
    expect(result.viewMode).toBe('focus');
  });

  it('stripFlags removes viewMode', () => {
    const input = JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2);
    const result = JSON.parse(stripFlags(input));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });
});

// ─── parseFlagValueInput ──────────────────────────────────────────────────────

describe('parseFlagValueInput', () => {
  it('"unset" → null for any flag', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(parseFlagValueInput(flag, 'unset')).toBeNull();
  });

  it('parses number string for number flag', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(parseFlagValueInput(flag, '40')).toBe(40);
  });

  it('parses enum value for enum flag', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline')!;
    expect(parseFlagValueInput(flag, 'large')).toBe('large');
  });

  it('parses "true"/"false" for boolean flag', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(parseFlagValueInput(flag, 'true')).toBe(true);
    expect(parseFlagValueInput(flag, 'false')).toBe(false);
  });

  it('invalid number string → null', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(parseFlagValueInput(flag, 'notanumber')).toBeNull();
  });

  it('empty string for number flag → null (empty is UNSET)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    // Number('') === 0 with bare Number(), but strict grammar rejects empty (TS-H1)
    expect(parseFlagValueInput(flag, '')).toBeNull();
  });

  it('hex literal for number flag → null (strict decimal grammar)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    // Number('0x5') === 5 with bare Number(), but hex is rejected (TS-H1)
    expect(parseFlagValueInput(flag, '0x5')).toBeNull();
    expect(parseFlagValueInput(flag, '0x28')).toBeNull();
  });

  it('exponent notation for number flag → null (strict decimal grammar)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    // Number('1e1') === 10 with bare Number(), but exponent form is rejected (TS-H1)
    expect(parseFlagValueInput(flag, '1e1')).toBeNull();
    expect(parseFlagValueInput(flag, '2E2')).toBeNull();
  });

  it('padded number input → null (strict decimal grammar)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    // Number('  3  ') === 3 with bare Number(), but whitespace is rejected (TS-H1)
    expect(parseFlagValueInput(flag, '  40  ')).toBeNull();
    expect(parseFlagValueInput(flag, ' 40')).toBeNull();
    expect(parseFlagValueInput(flag, '40 ')).toBeNull();
  });

  it('empty string for string flag → null (empty is UNSET, not active)', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'default-model')!;
    // --set default-model= with MODEL unset should not persist ANTHROPIC_DEFAULT_MODEL=''
    expect(parseFlagValueInput(flag, '')).toBeNull();
  });

  it('valid string value → passes through', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'default-model')!;
    expect(parseFlagValueInput(flag, 'claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
  });
});

// ─── countActiveFlags ─────────────────────────────────────────────────────────

describe('countActiveFlags', () => {
  it('counts non-neutral values', () => {
    const record: FlagsRecord = {
      tui: true,          // active
      brief: false,       // neutral (boolean false)
      'view-mode': 'default', // neutral (enum neutralValue)
      'max-concurrent-subagents': 40, // active
      spellcheck: null,   // neutral (null)
    };
    expect(countActiveFlags(record)).toBe(2);
  });

  it('0 in record is ACTIVE (counts it)', () => {
    const record: FlagsRecord = {
      'goal-checkin-minutes': 0, // active (0 is an explicit value)
    };
    expect(countActiveFlags(record)).toBe(1);
  });

  it('empty record → 0', () => {
    expect(countActiveFlags({})).toBe(0);
  });
});

// ─── readViewMode ─────────────────────────────────────────────────────────────

describe('readViewMode', () => {
  it('returns ViewMode from view-mode entry', () => {
    expect(readViewMode({ 'view-mode': 'verbose' })).toBe('verbose');
    expect(readViewMode({ 'view-mode': 'focus' })).toBe('focus');
    expect(readViewMode({ 'view-mode': 'default' })).toBe('default');
  });

  it('returns "default" when view-mode is absent', () => {
    expect(readViewMode({})).toBe('default');
  });

  it('returns "default" when view-mode is null or non-ViewMode', () => {
    expect(readViewMode({ 'view-mode': null })).toBe('default');
  });
});

// ─── sanitizeFlagsRecord ─────────────────────────────────────────────────────

describe('sanitizeFlagsRecord', () => {
  it('drops invalid non-null values — key absent (adopt default on next init, REL-S1 + ADR-014)', () => {
    // Invalid value (above max) is DROPPED rather than becoming null="deliberately unset"
    const record: FlagsRecord = {
      'max-concurrent-subagents': 200 as unknown as number, // above max
    };
    const sanitized = sanitizeFlagsRecord(record);
    // Key must be absent — not null — so the flag is re-adopted on next init
    expect(Object.prototype.hasOwnProperty.call(sanitized, 'max-concurrent-subagents')).toBe(false);
  });

  it('preserves explicit null (deliberately unset — ADR-014 key-presence semantics)', () => {
    const record: FlagsRecord = {
      'max-concurrent-subagents': null, // explicit null = user deliberately unset this flag
    };
    const sanitized = sanitizeFlagsRecord(record);
    expect(sanitized['max-concurrent-subagents']).toBeNull();
  });

  it('preserves valid values', () => {
    const record: FlagsRecord = {
      tui: true,
      'max-concurrent-subagents': 40,
    };
    const sanitized = sanitizeFlagsRecord(record);
    expect(sanitized['tui']).toBe(true);
    expect(sanitized['max-concurrent-subagents']).toBe(40);
  });

  it('passes through unknown ids with primitive values (forward-compat)', () => {
    const record: FlagsRecord = {
      'future-unknown-flag': true,
      'future-unknown-string': 'some-value',
      'future-unknown-null': null,
    };
    const sanitized = sanitizeFlagsRecord(record);
    expect(sanitized['future-unknown-flag']).toBe(true);
    expect(sanitized['future-unknown-string']).toBe('some-value');
    expect(sanitized['future-unknown-null']).toBeNull();
  });

  it('drops unknown ids with non-primitive values (TS-M3: no launder of objects into FlagsRecordValue)', () => {
    const record = {
      'future-unknown-object': { a: 1 } as unknown as boolean,
      'future-unknown-array': [1, 2] as unknown as boolean,
    } as FlagsRecord;
    const sanitized = sanitizeFlagsRecord(record);
    expect(Object.prototype.hasOwnProperty.call(sanitized, 'future-unknown-object')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized, 'future-unknown-array')).toBe(false);
  });
});

// ─── migrateLegacyFlagsToRecord ───────────────────────────────────────────────

describe('migrateLegacyFlagsToRecord', () => {
  it('knownIds defined: enabled flag → true', () => {
    const knownIds = ['tui', 'tool-search'];
    const record = migrateLegacyFlagsToRecord(['tui'], knownIds);
    expect(record['tui']).toBe(true);
  });

  it('knownIds defined: disabled flag (in knownIds, NOT in enabledIds) → false', () => {
    const knownIds = ['tui', 'tool-search'];
    const record = migrateLegacyFlagsToRecord(['tui'], knownIds);
    expect(record['tool-search']).toBe(false); // deliberate-disable → false
  });

  it('knownIds defined: new flag not in knownIds → NO entry (adopted on next seed)', () => {
    const knownIds = ['tui']; // tool-search is new this install
    const record = migrateLegacyFlagsToRecord(['tui'], knownIds);
    expect(Object.prototype.hasOwnProperty.call(record, 'tool-search')).toBe(false);
  });

  it('knownIds undefined: all current registry boolean flags get entries', () => {
    const record = migrateLegacyFlagsToRecord(['tui']);
    // All registry boolean flags should have entries
    for (const flag of FLAG_REGISTRY) {
      if (flag.kind === 'boolean') {
        expect(Object.prototype.hasOwnProperty.call(record, flag.id), flag.id).toBe(true);
      }
    }
  });

  it('unknown enabled IDs (not in registry) preserved as true', () => {
    const record = migrateLegacyFlagsToRecord(['tui', 'future-unknown-flag'], ['tui', 'future-unknown-flag']);
    expect(record['future-unknown-flag']).toBe(true);
  });

  it('viewMode fold: legacyViewMode "focus" → view-mode: "focus"', () => {
    const record = migrateLegacyFlagsToRecord([], [], 'focus');
    expect(record['view-mode']).toBe('focus');
  });

  it('viewMode fold: legacyViewMode "verbose" → view-mode: "verbose"', () => {
    const record = migrateLegacyFlagsToRecord([], [], 'verbose');
    expect(record['view-mode']).toBe('verbose');
  });

  it('viewMode fold: undefined legacyViewMode → view-mode: "default"', () => {
    const record = migrateLegacyFlagsToRecord([], []);
    expect(record['view-mode']).toBe('default');
  });

  it('view-mode always has an entry regardless of knownIds', () => {
    const record1 = migrateLegacyFlagsToRecord(['tui'], ['tui']); // view-mode not in knownIds
    expect(Object.prototype.hasOwnProperty.call(record1, 'view-mode')).toBe(true);
    const record2 = migrateLegacyFlagsToRecord(['tui']);
    expect(Object.prototype.hasOwnProperty.call(record2, 'view-mode')).toBe(true);
  });
});

// ─── resolveExistingViewMode ──────────────────────────────────────────────────

describe('resolveExistingViewMode', () => {
  it('returns "focus" when settings.json has viewMode: "focus"', () => {
    const input = JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2);
    expect(resolveExistingViewMode(input)).toBe('focus');
  });

  it('returns "verbose" when settings.json has viewMode: "verbose"', () => {
    const input = JSON.stringify({ viewMode: 'verbose' }, null, 2);
    expect(resolveExistingViewMode(input)).toBe('verbose');
  });

  it('returns undefined when viewMode key is absent', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    expect(resolveExistingViewMode(input)).toBeUndefined();
  });

  it('returns undefined when viewMode is "default"', () => {
    const input = JSON.stringify({ viewMode: 'default', hooks: {} }, null, 2);
    expect(resolveExistingViewMode(input)).toBeUndefined();
  });

  it('returns undefined for an unrecognised viewMode value', () => {
    const input = JSON.stringify({ viewMode: 'ultra-verbose' }, null, 2);
    expect(resolveExistingViewMode(input)).toBeUndefined();
  });

  it('returns undefined gracefully for malformed JSON (never throws)', () => {
    expect(() => resolveExistingViewMode('not-json{{{')).not.toThrow();
    expect(resolveExistingViewMode('not-json{{{')).toBeUndefined();
  });

  it('returns undefined for empty string input (never throws)', () => {
    expect(() => resolveExistingViewMode('')).not.toThrow();
    expect(resolveExistingViewMode('')).toBeUndefined();
  });
});

// ─── resolveFinalViewMode (unchanged) ────────────────────────────────────────

describe('resolveFinalViewMode', () => {
  it('explicit=true: selected "default" beats current "focus"', () => {
    expect(resolveFinalViewMode('focus', 'default', true)).toBe('default');
  });

  it('explicit=true: selected "verbose" beats current "focus"', () => {
    expect(resolveFinalViewMode('focus', 'verbose', true)).toBe('verbose');
  });

  it('explicit=true: selected "focus" is used even when current is undefined', () => {
    expect(resolveFinalViewMode(undefined, 'focus', true)).toBe('focus');
  });

  it('explicit=false: non-default current "focus" preserved', () => {
    expect(resolveFinalViewMode('focus', 'default', false)).toBe('focus');
  });

  it('explicit=false: non-default current "verbose" preserved', () => {
    expect(resolveFinalViewMode('verbose', 'default', false)).toBe('verbose');
  });

  it('explicit=false: undefined current → selected is used', () => {
    expect(resolveFinalViewMode(undefined, 'verbose', false)).toBe('verbose');
  });

  it('explicit=false: undefined current + selected "default" → "default"', () => {
    expect(resolveFinalViewMode(undefined, 'default', false)).toBe('default');
  });

  it('explicit=false: current "default" → selected wins', () => {
    expect(resolveFinalViewMode('default', 'verbose', false)).toBe('verbose');
  });
});

// ─── VIEW_MODES constant (unchanged) ─────────────────────────────────────────

describe('VIEW_MODES', () => {
  it('contains default, verbose, focus', () => {
    expect(VIEW_MODES).toContain('default');
    expect(VIEW_MODES).toContain('verbose');
    expect(VIEW_MODES).toContain('focus');
  });
});

// ─── convergeFlagsIntoSettings — SEC-M3 / ARCH-H1 / REG-H1 ──────────────────
//
// Pipeline invariant: valued flags found in settings.json that devflow does NOT
// own (absent from ownedRecord) are folded into the record before strip, so they
// survive the strip+apply pass. Whole-post-state style per PF-015.

describe('convergeFlagsIntoSettings — view-mode preservation', () => {
  const baseSettings = JSON.stringify(
    { viewMode: 'focus', hooks: {}, env: {} },
    null,
    2,
  );

  it('/focus survives when viewModeExplicit=false and record says "default"', () => {
    // Scenario: user set viewMode:'focus' via /focus (settings.json only, manifest = 'default')
    const record: FlagsRecord = { 'view-mode': 'default' };
    const { settings, record: out } = convergeFlagsIntoSettings(baseSettings, record, {
      viewModeExplicit: false,
    });
    const parsed = JSON.parse(settings) as Record<string, unknown>;
    // viewMode 'focus' is non-neutral — key must be present
    expect(parsed.viewMode, 'viewMode preserved as "focus"').toBe('focus');
    expect(out['view-mode'], 'returned record reflects "focus"').toBe('focus');
  });

  it('explicit viewModeExplicit=true: record "verbose" wins over settings "focus"', () => {
    const record: FlagsRecord = { 'view-mode': 'verbose' };
    const { settings, record: out } = convergeFlagsIntoSettings(baseSettings, record, {
      viewModeExplicit: true,
    });
    const parsed = JSON.parse(settings) as Record<string, unknown>;
    expect(parsed.viewMode, 'viewMode overridden to "verbose"').toBe('verbose');
    expect(out['view-mode']).toBe('verbose');
  });

  it('settings viewMode "default" (neutral) — key absent in output', () => {
    const settingsDefault = JSON.stringify({ hooks: {} }, null, 2);
    const record: FlagsRecord = { 'view-mode': 'default' };
    const { settings } = convergeFlagsIntoSettings(settingsDefault, record, {
      viewModeExplicit: false,
    });
    const parsed = JSON.parse(settings) as Record<string, unknown>;
    expect(parsed.viewMode, 'neutral view-mode must not add viewMode key').toBeUndefined();
  });
});

describe('convergeFlagsIntoSettings — REG-H1: hand-set managed keys survive', () => {
  // Settings.json with six hand-set managed keys that devflow now claims in the registry
  // but the OLD manifest never wrote (ownedRecord = null, simulating upgrade).
  // After convergeFlagsIntoSettings the values must be preserved.
  const makeSettings = (): string =>
    JSON.stringify(
      {
        hooks: {},
        // setting-target flags:
        spellcheck: { command: 'hunspell' },
        workflowSizeGuideline: 'large',
        // env-target flags:
        env: {
          CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '8',
          ANTHROPIC_DEFAULT_MODEL: 'claude-opus-4',
          CLAUDE_CODE_GOAL_CHECKIN_MINUTES: '15',
          CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5',
        },
      },
      null,
      2,
    );

  it('whole post-state: all six hand-set keys survive when ownedRecord=null', () => {
    // Simulate resolveSeedFlags adopting devflow defaults into the record:
    const seededRecord: FlagsRecord = {
      'max-concurrent-subagents': 40,   // registry default adopted by resolveSeedFlags
      'spellcheck': null,               // absent in old manifest → null (unset)
      'workflow-size-guideline': null,  // absent in old manifest → null (unset)
    };

    const { settings, record: out } = convergeFlagsIntoSettings(
      makeSettings(),
      seededRecord,
      {
        viewModeExplicit: false,
        ownedRecord: null,   // nothing previously owned (fresh upgrade — REG-H1 probe)
      },
    );
    const parsed = JSON.parse(settings) as {
      spellcheck?: unknown;
      workflowSizeGuideline?: unknown;
      env?: Record<string, unknown>;
      hooks?: unknown;
    };

    // spellcheck preserved with wrapKey unwrap → re-wrapped on write
    expect(parsed.spellcheck, 'spellcheck preserved').toEqual({ command: 'hunspell' });

    // workflowSizeGuideline preserved
    expect(parsed.workflowSizeGuideline, 'workflowSizeGuideline preserved').toBe('large');

    // env vars preserved
    expect(parsed.env?.['CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS'], 'concurrency stays "8"').toBe('8');
    expect(parsed.env?.['ANTHROPIC_DEFAULT_MODEL'], 'default-model preserved').toBe('claude-opus-4');
    expect(parsed.env?.['CLAUDE_CODE_GOAL_CHECKIN_MINUTES'], 'goal-checkin preserved').toBe('15');
    expect(parsed.env?.['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'], 'spawn-depth preserved').toBe('5');

    // returned record also reflects adopted values
    expect(out['max-concurrent-subagents'], 'record: concurrency is 8').toBe(8);
    expect(out['spellcheck'], 'record: spellcheck is "hunspell"').toBe('hunspell');
    expect(out['workflow-size-guideline'], 'record: workflow-size-guideline is "large"').toBe('large');
    expect(out['default-model'], 'record: default-model is "claude-opus-4"').toBe('claude-opus-4');
    expect(out['goal-checkin-minutes'], 'record: goal-checkin-minutes is 15').toBe(15);
    expect(out['subagent-spawn-depth'], 'record: subagent-spawn-depth is 5').toBe(5);
  });

  it('previously-owned value wins over settings value', () => {
    // devflow previously wrote max-concurrent-subagents: 40 — settings has '8'
    // The owned record takes precedence; fold must NOT override with '8'
    const seededRecord: FlagsRecord = { 'max-concurrent-subagents': 40 };
    const ownedRecord: FlagsRecord = { 'max-concurrent-subagents': 40 };

    const { settings, record: out } = convergeFlagsIntoSettings(
      makeSettings(),
      seededRecord,
      { viewModeExplicit: false, ownedRecord },
    );
    const parsed = JSON.parse(settings) as { env?: Record<string, unknown> };
    // devflow's owned value (40) wins — settings '8' is ignored
    expect(parsed.env?.['CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS'], 'owned 40 wins').toBe('40');
    expect(out['max-concurrent-subagents'], 'record stays 40').toBe(40);
  });

  it('uninstall full-sweep: stripFlags removes all managed keys regardless of record', () => {
    // stripFlags(json) with no second arg — full-sweep semantics must be unchanged
    const settings = makeSettings();
    const stripped = JSON.parse(stripFlags(settings)) as {
      spellcheck?: unknown;
      workflowSizeGuideline?: unknown;
      env?: Record<string, unknown>;
    };
    expect(stripped.spellcheck, 'spellcheck removed on full sweep').toBeUndefined();
    expect(stripped.workflowSizeGuideline, 'workflowSizeGuideline removed on full sweep').toBeUndefined();
    expect(stripped.env?.['CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS'], 'concurrency removed on full sweep').toBeUndefined();
    expect(stripped.env?.['ANTHROPIC_DEFAULT_MODEL'], 'default-model removed on full sweep').toBeUndefined();
    expect(stripped.env?.['CLAUDE_CODE_GOAL_CHECKIN_MINUTES'], 'goal-checkin removed on full sweep').toBeUndefined();
    expect(stripped.env?.['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'], 'spawn-depth removed on full sweep').toBeUndefined();
  });
});

// ─── applyFlags / stripFlags — non-object root guard (REL-M2) ────────────────
//
// applyFlags and stripFlags must throw a clear error (not an opaque TypeError)
// when the settings.json root is not a plain object. This is defence-in-depth
// for callers that bypass readSettingsSafe (init.ts, uninstall.ts). Applies
// PF-023: put the guard at the sink that every caller passes through.

describe('applyFlags — non-object root guard (REL-M2)', () => {
  it('throws on null root', () => {
    expect(() => applyFlags('null', {})).toThrow('applyFlags');
  });

  it('throws on array root', () => {
    expect(() => applyFlags('[]', {})).toThrow('applyFlags');
  });

  it('throws on scalar root (number)', () => {
    expect(() => applyFlags('5', {})).toThrow('applyFlags');
  });

  it('does NOT throw on a valid plain-object root', () => {
    expect(() => applyFlags('{}', {})).not.toThrow();
  });
});

describe('stripFlags — non-object root guard (REL-M2)', () => {
  it('throws on null root', () => {
    expect(() => stripFlags('null')).toThrow('stripFlags');
  });

  it('throws on array root', () => {
    expect(() => stripFlags('[]')).toThrow('stripFlags');
  });

  it('does NOT throw on a valid plain-object root', () => {
    expect(() => stripFlags('{}')).not.toThrow();
  });
});

// ─── describeFlagKind (CPLX-SF3) ─────────────────────────────────────────────
//
// Replaces the 4-level nested ternary in handleList. Exhaustive switch —
// TypeScript narrows each case so no per-kind casts are needed.

describe('describeFlagKind', () => {
  it('boolean flag → "boolean"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(describeFlagKind(flag)).toBe('boolean');
  });

  it('enum flag → "enum [small|medium|large|unrestricted]"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline')!;
    expect(describeFlagKind(flag)).toBe('enum [small|medium|large|unrestricted]');
  });

  it('enum flag with neutralValue → includes all values', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(describeFlagKind(flag)).toBe('enum [default|verbose|focus]');
  });

  it('number flag with min, max, integer → includes all constraints', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(describeFlagKind(flag)).toBe('number min=1 max=100 integer');
  });

  it('number flag with min=0 → includes min=0', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'goal-checkin-minutes')!;
    expect(describeFlagKind(flag)).toBe('number min=0 max=1440 integer');
  });

  it('number flag with no bounds (subagent-spawn-depth has bounds) → includes them', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'subagent-spawn-depth')!;
    expect(describeFlagKind(flag)).toBe('number min=1 max=10 integer');
  });

  it('string flag with maxLength → includes maxLen=', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'default-model')!;
    expect(describeFlagKind(flag)).toBe('string maxLen=64');
  });

  it('string flag with larger maxLength → correct value', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;
    expect(describeFlagKind(flag)).toBe('string maxLen=256');
  });

  it('every registry flag returns a non-empty string without throwing', () => {
    for (const flag of FLAG_REGISTRY) {
      const label = describeFlagKind(flag);
      expect(typeof label, `${flag.id}: returns string`).toBe('string');
      expect(label.length, `${flag.id}: non-empty`).toBeGreaterThan(0);
    }
  });

  it('output is byte-identical to the former ternary for all registry flags', () => {
    // Reference implementation — the ternary that describeFlagKind replaces —
    // preserved here as the ground truth for the regression comparison.
    function legacyKindLabel(flag: ClaudeCodeFlag): string {
      if (flag.kind === 'boolean') return 'boolean';
      if (flag.kind === 'enum') return `enum [${(flag as EnumFlagDef).values.join('|')}]`;
      if (flag.kind === 'number') {
        const nf = flag as NumberFlagDef;
        const parts: string[] = [];
        if (nf.min !== undefined) parts.push(`min=${nf.min}`);
        if (nf.max !== undefined) parts.push(`max=${nf.max}`);
        if (nf.integer) parts.push('integer');
        return `number${parts.length ? ' ' + parts.join(' ') : ''}`;
      }
      const sf = flag as StringFlagDef;
      return `string${sf.maxLength !== undefined ? ` maxLen=${sf.maxLength}` : ''}`;
    }

    for (const flag of FLAG_REGISTRY) {
      expect(describeFlagKind(flag), `${flag.id}: matches legacy output`).toBe(legacyKindLabel(flag));
    }
  });
});

// ─── expectedInputFor (CPLX-SF4) ─────────────────────────────────────────────
//
// Replaces the triple-nested conditional in the --set Expected: hint.
// Output must match the former inline expression for all flag kinds.

describe('expectedInputFor', () => {
  it('boolean flag → "true|false|unset"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    expect(expectedInputFor(flag)).toBe('true|false|unset');
  });

  it('enum flag → values joined by | plus "|unset"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'workflow-size-guideline')!;
    expect(expectedInputFor(flag)).toBe('small|medium|large|unrestricted|unset');
  });

  it('enum flag with neutralValue → all values included', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;
    expect(expectedInputFor(flag)).toBe('default|verbose|focus|unset');
  });

  it('number flag → "a valid number value or unset"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!;
    expect(expectedInputFor(flag)).toBe('a valid number value or unset');
  });

  it('string flag → "a valid string value or unset"', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'default-model')!;
    expect(expectedInputFor(flag)).toBe('a valid string value or unset');
  });

  it('every registry flag returns a non-empty string without throwing', () => {
    for (const flag of FLAG_REGISTRY) {
      const hint = expectedInputFor(flag);
      expect(typeof hint, `${flag.id}: returns string`).toBe('string');
      expect(hint.length, `${flag.id}: non-empty`).toBeGreaterThan(0);
    }
  });

  it('output is byte-identical to the former ternary for all registry flags', () => {
    // Reference — the three-way conditional from handleSet preserved as ground truth.
    function legacyExpected(flag: ClaudeCodeFlag): string {
      if (flag.kind === 'boolean') return 'true|false|unset';
      if (flag.kind === 'enum') return (flag as EnumFlagDef).values.join('|') + '|unset';
      return `a valid ${flag.kind} value or unset`;
    }

    for (const flag of FLAG_REGISTRY) {
      expect(expectedInputFor(flag), `${flag.id}: matches legacy output`).toBe(legacyExpected(flag));
    }
  });
});

// ─── effectiveDisplay ─────────────────────────────────────────────────────────

describe('effectiveDisplay — D-EFFDV one-definition seam', () => {
  const boolFlag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
  const enumFlag = FLAG_REGISTRY.find(f => f.id === 'view-mode')!;        // neutralValue='default'
  const numFlagD = FLAG_REGISTRY.find(f => f.id === 'max-concurrent-subagents')!; // defaultValue=40
  const numFlagU = FLAG_REGISTRY.find(f => f.id === 'subagent-spawn-depth')!;     // upstreamDefault=3, no devflow default
  const strFlag  = FLAG_REGISTRY.find(f => f.id === 'spellcheck')!;

  it('boolean true → { text: "on", isDefault: false }', () => {
    const d = effectiveDisplay(boolFlag, true);
    expect(d.text).toBe('on');
    expect(d.isDefault).toBe(false);
  });

  it('boolean false → { text: "off", isDefault: true } (false is neutral but meaningful)', () => {
    const d = effectiveDisplay(boolFlag, false);
    expect(d.text).toBe('off');
    expect(d.isDefault).toBe(true);
  });

  it('boolean null → { text: "off", isDefault: true } (same as false)', () => {
    const d = effectiveDisplay(boolFlag, null);
    expect(d.text).toBe('off');
    expect(d.isDefault).toBe(true);
  });

  it('enum active value → { text: value, isDefault: false }', () => {
    const d = effectiveDisplay(enumFlag, 'verbose');
    expect(d.text).toBe('verbose');
    expect(d.isDefault).toBe(false);
  });

  it('enum null → { text: neutralValue, isDefault: true }', () => {
    const d = effectiveDisplay(enumFlag, null);
    expect(d.text).toBe('default');
    expect(d.isDefault).toBe(true);
  });

  it('enum neutralValue → { text: neutralValue, isDefault: true }', () => {
    const d = effectiveDisplay(enumFlag, 'default');
    expect(d.text).toBe('default');
    expect(d.isDefault).toBe(true);
  });

  it('number active value → { text: String(value), isDefault: false }', () => {
    const d = effectiveDisplay(numFlagD, 20);
    expect(d.text).toBe('20');
    expect(d.isDefault).toBe(false);
  });

  it('number null with devflow defaultValue → { text: "40", isDefault: true }', () => {
    const d = effectiveDisplay(numFlagD, null);
    expect(d.text).toBe('40');
    expect(d.isDefault).toBe(true);
  });

  it('number null with upstreamDefault only → { text: String(upstreamDefault), isDefault: true }', () => {
    const d = effectiveDisplay(numFlagU, null);
    expect(d.text).toBe('3');
    expect(d.isDefault).toBe(true);
  });

  it('string active value → { text: value, isDefault: false }', () => {
    const d = effectiveDisplay(strFlag, 'aspell list');
    expect(d.text).toBe('aspell list');
    expect(d.isDefault).toBe(false);
  });

  it('string null → { text: "—", isDefault: true }', () => {
    const d = effectiveDisplay(strFlag, null);
    expect(d.text).toBe('—');
    expect(d.isDefault).toBe(true);
  });
});

// ─── blurb hard-cap registry test ────────────────────────────────────────────

describe('FLAG_REGISTRY — blurb hard-cap (D-BLURB)', () => {
  it('every flag has blurb defined and blurb.length ≤ 30', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(
        typeof flag.blurb,
        `${flag.id}: blurb must be a string`,
      ).toBe('string');
      expect(
        flag.blurb.length,
        `${flag.id}: blurb "${flag.blurb}" is ${flag.blurb.length} chars (max 30)`,
      ).toBeLessThanOrEqual(30);
    }
  });

  it('every blurb is non-empty', () => {
    for (const flag of FLAG_REGISTRY) {
      expect(flag.blurb.length, `${flag.id}: blurb must not be empty`).toBeGreaterThan(0);
    }
  });
});

// ─── persistence round-trip ───────────────────────────────────────────────────

describe('persistence round-trip: manifest write shape → resolveSeedFlags', () => {
  it('explicitly set values survive the manifest → resolveSeedFlags round-trip unchanged', () => {
    // Simulates what persistFlagConfig writes: manifest.features.flags = record.
    // The saved record is then fed to resolveSeedFlags on re-init.
    const persistedRecord: FlagsRecord = {
      tui: false,                        // boolean, non-default (default=true)
      'view-mode': 'verbose',            // enum, non-neutral
      'max-concurrent-subagents': 20,    // number, non-default
      spellcheck: 'aspell list',         // string active value
    };

    const seeded = resolveSeedFlags(persistedRecord);

    // Explicitly set values must be preserved exactly
    expect(seeded['tui']).toBe(false);
    expect(seeded['view-mode']).toBe('verbose');
    expect(seeded['max-concurrent-subagents']).toBe(20);
    expect(seeded['spellcheck']).toBe('aspell list');
  });

  it('absent flags in manifest get registry defaults on resolveSeedFlags', () => {
    // Only set one flag; all others should resolve to their registry defaults
    const persistedRecord: FlagsRecord = { tui: false };
    const seeded = resolveSeedFlags(persistedRecord);

    // lsp.defaultValue = true → seeded as true
    expect(seeded['lsp']).toBe(true);
    // subagent-spawn-depth.defaultValue = undefined → null via defaultValueOf
    expect(seeded['subagent-spawn-depth']).toBeNull();
    // view-mode.defaultValue = 'default' → seeded as 'default'
    expect(seeded['view-mode']).toBe('default');
  });

  it('null values in manifest are preserved (deliberately unset)', () => {
    const persistedRecord: FlagsRecord = {
      'subagent-spawn-depth': null,  // explicitly set to null (unset)
    };
    const seeded = resolveSeedFlags(persistedRecord);

    // null in manifest means "deliberately unset" — must be preserved as null
    expect(seeded['subagent-spawn-depth']).toBeNull();
  });
});

// ─── suppress-attribution — shape guard (D27 / D-ATTR-GUARD) ─────────────────

describe('suppress-attribution flag — shape guard (D27)', () => {
  const DEVFLOW_ATTR = { commit: '', pr: '' };

  it('applyFlags with true writes the attribution block', () => {
    const result = JSON.parse(applyFlags(JSON.stringify({}), { 'suppress-attribution': true }));
    expect(result.attribution).toEqual(DEVFLOW_ATTR);
  });

  it('applyFlags with false deletes the exact devflow attribution shape', () => {
    const input = JSON.stringify({ attribution: DEVFLOW_ATTR });
    const result = JSON.parse(applyFlags(input, { 'suppress-attribution': false }));
    expect(result.attribution).toBeUndefined();
  });

  it('applyFlags with null deletes the exact devflow attribution shape', () => {
    const input = JSON.stringify({ attribution: DEVFLOW_ATTR });
    const result = JSON.parse(applyFlags(input, { 'suppress-attribution': null }));
    expect(result.attribution).toBeUndefined();
  });

  it('applyFlags with false does NOT delete custom attribution (shape guard)', () => {
    const custom = { commit: 'My Org', pr: 'My Org' };
    const input = JSON.stringify({ attribution: custom });
    const result = JSON.parse(applyFlags(input, { 'suppress-attribution': false }));
    expect(result.attribution).toEqual(custom);
  });

  it('applyFlags with false does NOT delete string attribution (shape guard)', () => {
    const input = JSON.stringify({ attribution: 'My Org' });
    const result = JSON.parse(applyFlags(input, { 'suppress-attribution': false }));
    expect(result.attribution).toBe('My Org');
  });

  it('stripFlags deletes exact devflow attribution shape', () => {
    const input = JSON.stringify({ attribution: DEVFLOW_ATTR });
    const result = JSON.parse(stripFlags(input));
    expect(result.attribution).toBeUndefined();
  });

  it('stripFlags does NOT delete custom attribution (shape guard)', () => {
    const custom = { commit: 'My Org', pr: 'My Org' };
    const input = JSON.stringify({ attribution: custom });
    const result = JSON.parse(stripFlags(input));
    expect(result.attribution).toEqual(custom);
  });

  it('stripFlags does NOT delete string attribution', () => {
    const input = JSON.stringify({ attribution: 'My Org' });
    const result = JSON.parse(stripFlags(input));
    expect(result.attribution).toBe('My Org');
  });

  it('suppress-attribution flag entry: id=suppress-attribution, setting target, key=attribution', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'suppress-attribution')!;
    expect(flag).toBeDefined();
    expect(flag.kind).toBe('boolean');
    expect(flag.target.type).toBe('setting');
    expect(flag.target.key).toBe('attribution');
    expect(flag.recommended).toBe(false);
    expect(flag.defaultValue).toBe(false);
    if (flag.kind === 'boolean') {
      expect(flag.onPayload).toEqual(DEVFLOW_ATTR);
      expect(flag.settingDeleteGuard).toEqual(DEVFLOW_ATTR);
    }
  });

  it('blurb cap: suppress-attribution blurb is ≤ 30 chars', () => {
    const flag = FLAG_REGISTRY.find(f => f.id === 'suppress-attribution')!;
    expect(flag.blurb.length).toBeLessThanOrEqual(30);
  });
});
