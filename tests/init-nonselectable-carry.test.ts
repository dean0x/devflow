import { describe, it, expect } from 'vitest';
import { applyNonSelectableCarry } from '../src/cli/commands/init-seed.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { type PluginDefinition } from '../src/core/plugins.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal plugin stubs for wiring tests that don't need the full registry. */
function makePlugin(name: string, optional = false): PluginDefinition {
  return { name, description: '', commands: [], agents: [], skills: [], rules: [], optional };
}

// Grab the real audit-claude entry from the registry (non-selectable optional plugin).
const auditClaude = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-audit-claude')!;
const implement = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-implement')!;

// ── applyNonSelectableCarry wiring ────────────────────────────────────────────

describe('applyNonSelectableCarry wiring', () => {
  // ── Gate: partial install (--plugin) skips carry ──────────────────────────

  it('isPartialInstall=true → carry gate skips, returns same list unchanged', () => {
    const list = [implement];
    const result = applyNonSelectableCarry(
      true,
      ['devflow-implement', 'devflow-audit-claude'],
      list,
      DEVFLOW_PLUGINS,
    );
    // Reference equality: same array instance returned (no carry applied)
    expect(result).toBe(list);
  });

  it('isPartialInstall=true → audit-claude NOT added even when in manifest', () => {
    const result = applyNonSelectableCarry(
      true,
      ['devflow-implement', 'devflow-audit-claude'],
      [implement],
      DEVFLOW_PLUGINS,
    );
    expect(result.map(p => p.name)).not.toContain('devflow-audit-claude');
  });

  // ── Full re-init with null manifest (fresh install / --reset) ─────────────

  it('isPartialInstall=false, manifestPlugins=null → carry empty, list unchanged', () => {
    const list = [implement];
    const result = applyNonSelectableCarry(false, null, list, DEVFLOW_PLUGINS);
    expect(result).toEqual(list);
    expect(result.map(p => p.name)).not.toContain('devflow-audit-claude');
  });

  // ── Full re-init: audit-claude in prior manifest → carried ────────────────

  it('isPartialInstall=false, audit-claude in manifest → appended to install list', () => {
    const result = applyNonSelectableCarry(
      false,
      ['devflow-implement', 'devflow-audit-claude'],
      [implement],
      DEVFLOW_PLUGINS,
    );
    expect(result.map(p => p.name)).toContain('devflow-audit-claude');
    // Original entries preserved
    expect(result.map(p => p.name)).toContain('devflow-implement');
  });

  // ── Deduplication: already-present plugin not added twice ────────────────

  it('isPartialInstall=false, audit-claude already in install list → not duplicated', () => {
    const result = applyNonSelectableCarry(
      false,
      ['devflow-implement', 'devflow-audit-claude'],
      [implement, auditClaude],
      DEVFLOW_PLUGINS,
    );
    const names = result.map(p => p.name);
    const auditCount = names.filter(n => n === 'devflow-audit-claude').length;
    expect(auditCount).toBe(1);
  });

  // ── Unknown name in manifest → safely excluded ───────────────────────────

  it('isPartialInstall=false, stale/unknown plugin name in manifest → excluded', () => {
    const result = applyNonSelectableCarry(
      false,
      ['devflow-implement', 'devflow-obsolete-2024'],
      [implement],
      DEVFLOW_PLUGINS,
    );
    expect(result.map(p => p.name)).not.toContain('devflow-obsolete-2024');
  });

  // ── Input list not mutated (immutable-return contract) ───────────────────

  it('does not mutate the pluginsToInstall argument', () => {
    const list = [implement];
    const before = [...list];
    applyNonSelectableCarry(
      false,
      ['devflow-implement', 'devflow-audit-claude'],
      list,
      DEVFLOW_PLUGINS,
    );
    expect(list).toEqual(before);
  });

  // ── Isolated stub-registry: verifies gate + merge loop independently ──────

  it('isolated registry: carries optional non-selectable plugin, skips selectable optional', () => {
    // Build a minimal registry: one selectable optional, one non-selectable optional.
    // partitionSelectablePlugins filters by presence of commands — non-selectable
    // optional plugins (like audit-claude) have no entry in the selectable buckets.
    // Use the real DEVFLOW_PLUGINS but limit manifestPlugins to known names.
    const result = applyNonSelectableCarry(
      false,
      // include a selectable optional (e.g. devflow-typescript) + audit-claude
      ['devflow-typescript', 'devflow-audit-claude', 'devflow-implement'],
      [implement],
      DEVFLOW_PLUGINS,
    );
    const names = result.map(p => p.name);
    // audit-claude is non-selectable optional → carried
    expect(names).toContain('devflow-audit-claude');
    // devflow-typescript is selectable optional → NOT carried (excluded by carry helper)
    expect(names).not.toContain('devflow-typescript');
  });
});
