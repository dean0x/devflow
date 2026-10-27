/**
 * Tests for src/cli/commands/compliance.ts
 *
 * Covers:
 *   - resolveComplianceCliAction pure resolver matrix
 *   - parseFrameworkList "Commander parse pin" (error message names every valid ID)
 *   - unknownFrameworkIds invalid-ID classification
 *   - applyComplianceChange: the switch, the one converge and the fail-closed exit (#648)
 *   - the install record and the `--status` Posting line (#648)
 *
 * Init-seed compliance seeding coverage (resolveSeedFeatures, applyCliToggles,
 * resolveResetGatedInputs) lives in tests/init-seed.test.ts — compliance seeding section.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyComplianceChange,
  postingStatusLine,
  resolveComplianceCliAction,
  unknownFrameworkIds,
  type ApplyComplianceChangeResult,
} from '../src/cli/commands/compliance.js';
import {
  COMPLIANCE_FRAMEWORKS,
  parseFrameworkList,
} from '../src/core/compliance.js';
import { bothOffDir, complianceOffDir, curationOffDir, skillsDir } from '../src/core/assets.js';
import { postingStatus, readInstalledVariants } from '../src/core/installed-variants.js';
import { readManifest, type ManifestData } from '../src/core/manifest.js';
import { getManifestLockPath } from '../src/core/manifest-lock.js';

// ── resolveComplianceCliAction ────────────────────────────────────────────────

describe('resolveComplianceCliAction', () => {
  // ── enable ─────────────────────────────────────────────────────────────────

  it('enable from disabled with empty frameworks → enabled:true, frameworks preserved (empty)', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: [] },
      'enable',
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual([]);
  });

  it('enable from disabled with existing frameworks → restores all frameworks', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: ['gdpr', 'soc2'] },
      'enable',
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual(['gdpr', 'soc2']);
  });

  it('enable when already enabled → nextState unchanged, messages indicate already enabled', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['hipaa'] },
      'enable',
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual(['hipaa']);
    expect(result.messages.some(m => m.text.toLowerCase().includes('already'))).toBe(true);
  });

  // ── disable ────────────────────────────────────────────────────────────────

  it('disable from enabled → enabled:false, frameworks preserved', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['gdpr', 'sox'] },
      'disable',
    );
    expect(result.nextState.enabled).toBe(false);
    expect(result.nextState.frameworks).toEqual(['gdpr', 'sox']);
  });

  it('disable when already disabled → nextState unchanged', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: ['pci-dss'] },
      'disable',
    );
    expect(result.nextState.enabled).toBe(false);
    // frameworks preserved
    expect(result.nextState.frameworks).toEqual(['pci-dss']);
  });

  // ── set ────────────────────────────────────────────────────────────────────

  it('set replaces frameworks exactly and enables', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: [] },
      'set',
      ['gdpr', 'soc2'],
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual(['gdpr', 'soc2']);
  });

  it('set with zero frameworks → enabled:true, frameworks empty (generic controls only)', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['hipaa'] },
      'set',
      [],
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual([]);
  });

  it('set replaces prior frameworks entirely', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['gdpr', 'hipaa', 'sox'] },
      'set',
      ['pci-dss'],
    );
    expect(result.nextState.frameworks).toEqual(['pci-dss']);
  });

  // ── status ─────────────────────────────────────────────────────────────────

  it('status → nextState unchanged', () => {
    const current = { enabled: true, frameworks: ['iso-27001'] };
    const result = resolveComplianceCliAction(current, 'status');
    expect(result.nextState).toEqual(current);
  });

  it('status does not produce state change messages', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: [] },
      'status',
    );
    // status is reporting only — messages must be empty (no enable/disable/set side-effect text)
    expect(result.nextState.enabled).toBe(false);
    expect(result.messages).toHaveLength(0);
  });
});

// ── Commander parse pin: --set with unknown IDs ────────────────────────────────

describe('parseFrameworkList (Commander parse pin)', () => {
  it('rejects unknown IDs with an error naming every valid registry ID', () => {
    const result = parseFrameworkList('gdrp,hippa');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error must name every valid ID
      for (const fw of COMPLIANCE_FRAMEWORKS) {
        expect(result.error).toContain(fw.id);
      }
      // Error must name the unknown IDs submitted
      expect(result.error).toContain('gdrp');
      expect(result.error).toContain('hippa');
    }
  });

  it('accepts all 6 valid IDs', () => {
    const validIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id).join(',');
    const result = parseFrameworkList(validIds);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(COMPLIANCE_FRAMEWORKS.length);
    }
  });

  it('accepts empty input → [] (zero frameworks allowed)', () => {
    const result = parseFrameworkList('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('normalises iso27001 alias to iso-27001', () => {
    const result = parseFrameworkList('iso27001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['iso-27001']);
    }
  });
});

// ── unknownFrameworkIds — invalid-ID reporting path ──────────────────────────────
//
// Installed reference files are no drift signal any more: every install carries all
// six (D-COMPLIANCE-INSTALL-ALWAYS). The one manifest defect --status still reports is
// an ID the registry does not know.

describe('unknownFrameworkIds', () => {
  const REGISTRY = new Set(COMPLIANCE_FRAMEWORKS.map(fw => fw.id));

  it('all manifest IDs known → empty', () => {
    expect(unknownFrameworkIds(['gdpr', 'hipaa'], REGISTRY)).toEqual([]);
  });

  it('unknown ID in manifest → listed (--set required to remove)', () => {
    expect(unknownFrameworkIds(['gdpr', 'not-a-framework'], REGISTRY)).toEqual(['not-a-framework']);
  });

  it('keeps manifest order and lists every unknown ID', () => {
    expect(unknownFrameworkIds(['foo', 'gdpr', 'bar'], REGISTRY)).toEqual(['foo', 'bar']);
  });

  it('empty manifest → empty', () => {
    expect(unknownFrameworkIds([], REGISTRY)).toEqual([]);
  });
});

// ── applyComplianceChange: the switch, the converge and the fail-closed exit (#648) ──
//
// Each test builds a temp Claude dir, a temp devflow dir and a temp package root, so no real
// HOME and no real dist/ is read or written. The package holds one compliance-armed command
// (`release`) and one with both arms (`plan`); the installed copies start as the on files.

const RUNNING = '3.3.0';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };
const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (text: string): string => text.replace(ANSI, '');

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

const installedCommand = (name: string): string => path.join(claudeDir, 'commands', 'devflow', `${name}.md`);
const exists = (file: string): Promise<boolean> => fs.stat(file).then(() => true, () => false);

async function seedPackage(): Promise<void> {
  await write(path.join(pkg, 'dist', 'commands', 'plan.md'), 'plan ON\n');
  await write(path.join(curationOffDir('commands', pkg), 'plan.md'), 'plan CURATION-OFF\n');
  await write(path.join(complianceOffDir('commands', pkg), 'plan.md'), 'plan COMPLIANCE-OFF\n');
  await write(path.join(bothOffDir('commands', pkg), 'plan.md'), 'plan BOTH-OFF\n');
  await write(path.join(pkg, 'dist', 'commands', 'release.md'), 'release ON\n');
  await write(path.join(complianceOffDir('commands', pkg), 'release.md'), 'release COMPLIANCE-OFF\n');
  await write(path.join(pkg, 'dist', 'agents', 'code.md'), 'code ON\n');
  await write(path.join(curationOffDir('agents', pkg), 'code.md'), 'code CURATION-OFF\n');
  await write(path.join(skillsDir(pkg), 'apply-decisions', 'SKILL.md'), 'apply-decisions of the temp package\n');
  await write(path.join(pkg, 'dist', 'variant-axes.json'), JSON.stringify({
    version: 1,
    hosts: {
      'agents/code': { curation: true, compliance: false },
      'commands/plan': { curation: true, compliance: true },
      'commands/release': { curation: false, compliance: true },
    },
  }));
}

async function installOnFiles(): Promise<void> {
  await write(installedCommand('plan'), 'plan ON\n');
  await write(installedCommand('release'), 'release ON\n');
  await write(path.join(claudeDir, 'agents', 'devflow', 'code.md'), 'code ON\n');
}

async function manifestWith(
  compliance: { enabled: boolean; frameworks: string[] },
  version: string = RUNNING,
  extra: Record<string, unknown> = {},
): Promise<ManifestData> {
  await write(path.join(devflowDir, 'manifest.json'), JSON.stringify({
    version,
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: { ambient: false, memory: false, hud: false, knowledge: true, curation: true, learning: true, rules: false, compliance },
    installedAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...extra,
  }));
  const read = await readManifest(devflowDir);
  if (read === null) throw new Error('the seeded manifest did not read');
  return read;
}

function change(
  manifest: ManifestData,
  action: 'enable' | 'disable' | 'set',
  opts: { setFrameworks?: string[]; runningVersion?: string | null } = {},
): Promise<ApplyComplianceChangeResult> {
  return applyComplianceChange({
    claudeDir,
    devflowDir,
    manifest,
    action,
    setFrameworks: opts.setFrameworks,
    runningVersion: opts.runningVersion === undefined ? RUNNING : opts.runningVersion,
    packageRoot: pkg,
    warn,
  });
}

const recordOf = async (): Promise<unknown> => (await readManifest(devflowDir))?.installedVariants;
const complianceOf = async (): Promise<unknown> => (await readManifest(devflowDir))?.features.compliance;

describe('applyComplianceChange', () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-compliance-change-'));
    claudeDir = path.join(tmp, 'claude');
    devflowDir = path.join(tmp, 'devflow');
    pkg = path.join(tmp, 'pkg');
    warnings = [];
    await fs.mkdir(claudeDir, { recursive: true });
    await seedPackage();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('disable writes the switch, installs the compliance-off prompts and records them (TP-39)', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    await installOnFiles();

    const result = await change(manifest, 'disable');

    expect(result.exitCode).toBe(0);
    expect(result.nextState).toEqual({ enabled: false, frameworks: ['gdpr'] });
    expect(await complianceOf()).toEqual({ enabled: false, frameworks: ['gdpr'] });
    expect(await fs.readFile(installedCommand('plan'), 'utf-8')).toBe('plan COMPLIANCE-OFF\n');
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release COMPLIANCE-OFF\n');
    expect(readInstalledVariants(await recordOf()), warnings.join('\n')).toEqual({ curation: true, compliance: false });
    expect(result.messages.some(m => m.level === 'error')).toBe(false);
  });

  it('the disable message says the rule and every posting step were removed, frameworks remembered', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    await installOnFiles();

    const result = await change(manifest, 'disable');

    const text = result.messages.map(m => m.text).join('\n');
    expect(text).toContain('Compliance disabled');
    expect(text).toContain('every posting step removed');
    expect(text).toContain('frameworks remembered for re-enable');
  });

  it('enable restores the on prompts and records the compliance-on variant (TP-41)', async () => {
    const manifest = await manifestWith({ enabled: false, frameworks: ['hipaa'] }, RUNNING, { installedVariants: { curation: true, compliance: false } });
    await write(installedCommand('plan'), 'plan COMPLIANCE-OFF\n');
    await write(installedCommand('release'), 'release COMPLIANCE-OFF\n');

    const result = await change(manifest, 'enable');

    expect(result.exitCode).toBe(0);
    expect(await fs.readFile(installedCommand('plan'), 'utf-8')).toBe('plan ON\n');
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release ON\n');
    expect(readInstalledVariants(await recordOf()), warnings.join('\n')).toEqual({ curation: true, compliance: true });
  });

  it('set converges too: it enables, replaces the frameworks and installs the on prompts (TP-41)', async () => {
    const manifest = await manifestWith({ enabled: false, frameworks: [] }, RUNNING, { installedVariants: { curation: true, compliance: false } });
    await write(installedCommand('release'), 'release COMPLIANCE-OFF\n');

    const result = await change(manifest, 'set', { setFrameworks: ['gdpr', 'GDPR', 'soc2'] });

    expect(result.exitCode).toBe(0);
    expect(result.nextState).toEqual({ enabled: true, frameworks: ['gdpr', 'soc2'] });
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release ON\n');
    expect(readInstalledVariants(await recordOf()), warnings.join('\n')).toEqual({ curation: true, compliance: true });
  });

  it('a set that only changes the frameworks still converges, and reaches a missing record', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    await installOnFiles();

    const result = await change(manifest, 'set', { setFrameworks: ['hipaa'] });

    expect(result.exitCode).toBe(0);
    expect(await complianceOf()).toEqual({ enabled: true, frameworks: ['hipaa'] });
    expect(readInstalledVariants(await recordOf()), warnings.join('\n')).toEqual({ curation: true, compliance: true });
  });

  it('disable with the compliance-off tree absent exits 1, lists the files and prints no success line (TP-42)', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] }, RUNNING, { installedVariants: { curation: true, compliance: true } });
    await installOnFiles();
    await fs.rm(complianceOffDir('commands', pkg), { recursive: true });
    await fs.rm(bothOffDir('commands', pkg), { recursive: true });

    const result = await change(manifest, 'disable');

    expect(result.exitCode).toBe(1);
    const text = result.messages.map(m => m.text).join('\n');
    expect(text).toContain(installedCommand('plan'));
    expect(text).toContain(installedCommand('release'));
    expect(text).toContain('devflow init');
    expect(text).not.toContain('Compliance disabled');
    expect(result.messages.every(m => m.level === 'error')).toBe(true);
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release ON\n');
    expect(await complianceOf(), 'the switch is on disk whatever the converge did').toEqual({ enabled: false, frameworks: ['gdpr'] });
    expect(readInstalledVariants(await recordOf()), 'an unclean converge leaves the record as it stood').toEqual({ curation: true, compliance: true });
  });

  it('disable across a version skew exits 1 and says that posting steps remain installed until devflow init (TP-42)', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: [] }, '3.2.0');
    await installOnFiles();

    const result = await change(manifest, 'disable');

    expect(result.exitCode).toBe(1);
    const text = result.messages.map(m => m.text).join('\n');
    expect(text).toContain('posting steps remain installed until devflow init');
    expect(text).not.toContain('Compliance disabled');
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release ON\n');
  });

  it('disable with an unknown running version is a skew as well', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: [] });
    await installOnFiles();

    const result = await change(manifest, 'disable', { runningVersion: null });

    expect(result.exitCode).toBe(1);
    expect(result.messages.map(m => m.text).join('\n')).toContain('posting steps remain installed until devflow init');
  });

  it('enable across a version skew is a warning with exit 0: the installed prompts are the on ones', async () => {
    const manifest = await manifestWith({ enabled: false, frameworks: [] }, '3.2.0');
    await installOnFiles();

    const result = await change(manifest, 'enable');

    expect(result.exitCode).toBe(0);
    expect(result.nextState.enabled).toBe(true);
    expect(result.messages.some(m => m.level === 'warn' && m.text.includes('devflow init'))).toBe(true);
  });

  it('a compliance-off converge with no build manifest exits 1: the files that post cannot be named', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: [] });
    await installOnFiles();
    await fs.rm(path.join(pkg, 'dist', 'variant-axes.json'));

    const result = await change(manifest, 'disable');

    expect(result.exitCode).toBe(1);
    expect(result.messages.map(m => m.text).join('\n')).toContain('cannot be named');
  });

  it('never mutates the manifest it is given', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    const before = JSON.stringify(manifest);
    await installOnFiles();

    await change(manifest, 'disable');

    expect(JSON.stringify(manifest)).toBe(before);
  });

  it('known-bad probe: a manifest that cannot be written is exit 1 and changes no prompt', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: [] });
    await installOnFiles();
    await fs.rm(path.join(devflowDir, 'manifest.json'));
    await fs.rm(devflowDir, { recursive: true });
    await write(devflowDir, 'a file where the devflow dir should be\n');

    const result = await change(manifest, 'disable');

    expect(result.exitCode).toBe(1);
    expect(result.messages[0]?.text).toContain('Could not record the compliance switch');
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release ON\n');
  });

  it.skipIf(process.getuid?.() === 0)('a switch that cannot take the manifest lock writes nothing, exits 1 and prints no success line', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] }, RUNNING, { installedVariants: { curation: true, compliance: true } });
    await installOnFiles();
    // A folder that cannot hold the lock directory: the lock is refused at once.
    await fs.chmod(devflowDir, 0o555);
    const result = await change(manifest, 'disable').finally(() => fs.chmod(devflowDir, 0o755));

    expect(result.exitCode).toBe(1);
    expect(result.nextState).toEqual({ enabled: true, frameworks: ['gdpr'] });
    const text = result.messages.map(m => m.text).join('\n');
    expect(text).toContain('Could not record the compliance switch');
    expect(text).toContain('manifest lock could not be taken');
    expect(text).not.toContain('Compliance disabled');
    expect(result.messages.every(m => m.level === 'error')).toBe(true);
    expect(await complianceOf()).toEqual({ enabled: true, frameworks: ['gdpr'] });
    expect(await fs.readFile(installedCommand('release'), 'utf-8'), 'no prompt is converged').toBe('release ON\n');
  });

  it('writes the switch from a manifest read inside the lock, keeps a field another run wrote since the first read, and releases the lock', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    await installOnFiles();
    // Another devflow run turns the HUD on after this command read its manifest.
    const file = path.join(devflowDir, 'manifest.json');
    const onDisk = JSON.parse(await fs.readFile(file, 'utf-8')) as { features: Record<string, unknown> };
    await fs.writeFile(file, JSON.stringify({ ...onDisk, features: { ...onDisk.features, hud: true } }), 'utf-8');

    const result = await change(manifest, 'disable');

    expect(result.exitCode, warnings.join('\n')).toBe(0);
    const after = await readManifest(devflowDir);
    expect(after?.features.compliance).toEqual({ enabled: false, frameworks: ['gdpr'] });
    expect(after?.features.hud, 'the field written after the first read').toBe(true);
    expect(await exists(getManifestLockPath(devflowDir)), 'the switch write releases the manifest lock').toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('a disable whose rule removal fails exits 1, names the rule and prints no removed line', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    await installOnFiles();
    const ruleDir = path.join(claudeDir, 'rules', 'devflow');
    const ruleFile = path.join(ruleDir, 'compliance.md');
    await write(ruleFile, 'the stamped compliance rule\n');
    // A folder that cannot lose a file: the rule removal fails while every posting step is converged.
    await fs.chmod(ruleDir, 0o555);
    const result = await change(manifest, 'disable').finally(() => fs.chmod(ruleDir, 0o755));

    expect(result.exitCode).toBe(1);
    expect(result.messages.every(m => m.level === 'error')).toBe(true);
    const text = result.messages.map(m => m.text).join('\n');
    expect(text).toContain('compliance rule could not be removed');
    expect(text).toContain(ruleFile);
    expect(text).not.toContain('Compliance disabled');
    expect(text).not.toContain('every posting step removed');
    expect(await complianceOf(), 'the switch is on disk whatever the rule removal did').toEqual({ enabled: false, frameworks: ['gdpr'] });
    expect(await fs.readFile(installedCommand('release'), 'utf-8')).toBe('release COMPLIANCE-OFF\n');
  });

  it('a disable that removes the rule prints the removed line and exits 0', async () => {
    const manifest = await manifestWith({ enabled: true, frameworks: ['gdpr'] });
    await installOnFiles();
    const ruleFile = path.join(claudeDir, 'rules', 'devflow', 'compliance.md');
    await write(ruleFile, 'the stamped compliance rule\n');

    const result = await change(manifest, 'disable');

    expect(result.exitCode, warnings.join('\n')).toBe(0);
    expect(await exists(ruleFile)).toBe(false);
    expect(result.messages.map(m => m.text).join('\n')).toContain('every posting step removed');
  });
});

// ── The posting record and the --status Posting line (AC-31) ───────────────────

describe('readInstalledVariants, postingStatus and postingStatusLine', () => {
  const CASES: ReadonlyArray<{ readonly record: unknown; readonly enabled: boolean; readonly status: string }> = [
    { record: { curation: true, compliance: true }, enabled: true, status: 'installed' },
    { record: { curation: false, compliance: false }, enabled: false, status: 'not installed' },
    { record: { curation: true, compliance: true }, enabled: false, status: 'mismatch (run devflow init)' },
    { record: { curation: true, compliance: false }, enabled: true, status: 'mismatch (run devflow init)' },
    { record: undefined, enabled: false, status: 'unknown (run devflow init)' },
    { record: { curation: true }, enabled: true, status: 'unknown (run devflow init)' },
    { record: { curation: 'yes', compliance: true }, enabled: true, status: 'unknown (run devflow init)' },
    { record: [true, true], enabled: true, status: 'unknown (run devflow init)' },
    { record: null, enabled: false, status: 'unknown (run devflow init)' },
  ];

  for (const { record, enabled, status } of CASES) {
    it(`${JSON.stringify(record) ?? 'absent'} with compliance ${enabled ? 'on' : 'off'} reads ${status}`, () => {
      expect(postingStatus(readInstalledVariants(record), enabled)).toBe(status);
      expect(plain(postingStatusLine(record, enabled))).toBe(`Posting:    ${status}`);
    });
  }

  it('readInstalledVariants returns a fresh two-boolean record and ignores extra keys', () => {
    const raw = { curation: false, compliance: true, future: 'axis' };
    expect(readInstalledVariants(raw)).toEqual({ curation: false, compliance: true });
  });
});
