/**
 * Compliance feature e2e scenarios (S1–S18).
 *
 * Each scenario drives `node dist/cli.js` against an isolated temp HOME so no
 * developer files are touched. Per PF-018: $HOME/.claude is seeded before any
 * init invocation (unseeded → "Claude Code not detected" → vacuous pass).
 * Per PF-015: assertions check WHOLE end-states (file sets, file content),
 * never per-step booleans.
 *
 * Skipped:
 *   S13 — Advanced-mode init requires TTY for the wizard; non-interactive driver
 *          cannot feed keystrokes. The seeding layer (resolveInitSeed) is covered
 *          by tests/init-seed.test.ts and tests/compliance-cli.test.ts.
 *
 * Guard: all tests skip when dist/cli.js is absent (no silent vacuous pass).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(import.meta.dirname, '..', 'dist', 'cli.js');

// Guard: skip when dist/cli.js not built (PF-018 — non-vacuous corpus)
const distExists = await fs.access(CLI).then(() => true).catch(() => false);

// ── Shared helper ─────────────────────────────────────────────────────────────

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function makeRunner(tmpHome: string, devflowDir: string) {
  return function runCli(...args: string[]): RunResult {
    const result = spawnSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      timeout: 60000,
      env: {
        ...process.env,
        HOME: tmpHome,
        DEVFLOW_DIR: devflowDir,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        // Suppress interactive mode in non-TTY
        CI: '1',
      },
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}

// ── Fixture: dir listing ──────────────────────────────────────────────────────

/** List relative paths under a directory, recursively. Returns [] if absent. */
async function listDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(current, e.name), r);
      } else {
        results.push(r);
      }
    }
  }
  await walk(dir, '');
  return results.sort();
}

/** Read JSON manifest from devflowDir. Throws if absent. */
async function readManifest(devflowDir: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

// ── S1 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S1: fresh init --recommended → disabled compliance manifest', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s1-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    // PF-018: seed .claude so init doesn't bail with "Claude Code not detected"
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S1: manifest has compliance {enabled:false, frameworks:[]} and no artifacts', async () => {
    const result = run('init', '--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: false, frameworks: [] });

    // No compliance artifacts installed (convergeComplianceArtifacts removes them when disabled)
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md'))).rejects.toThrow();
  });
});

// ── S2 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S2: compliance --set gdpr,soc2 → artifacts installed', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s2-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    // Setup: init to create manifest
    const initResult = run('init', '--recommended');
    expect(initResult.status, `init failed:\n${initResult.stderr}`).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S2: skill dir has exactly the expected files; rule is stamped with GDPR, SOC 2', async () => {
    const result = run('compliance', '--set', 'gdpr,soc2');
    expect(result.status, `compliance --set failed:\n${result.stderr}`).toBe(0);

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    const skillDir = path.join(claudeDir, 'skills', COMPLIANCE_SKILL);
    const files = await listDir(skillDir);
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/gdpr.md',
      'references/soc2.md',
      'references/sources.md',
    ]);

    const ruleContent = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleContent).toContain('GDPR, SOC 2');

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: true, frameworks: ['gdpr', 'soc2'] });
  });
});

// ── S3 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S3: from S2 state + --set hipaa → skill updated, rule stamped HIPAA only', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s3-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S3: skill dir has exactly hipaa+always-present refs; rule stamped HIPAA only', async () => {
    const result = run('compliance', '--set', 'hipaa');
    expect(result.status, `compliance --set hipaa failed:\n${result.stderr}`).toBe(0);

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    const skillDir = path.join(claudeDir, 'skills', COMPLIANCE_SKILL);
    const files = await listDir(skillDir);
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/hipaa.md',
      'references/sources.md',
    ]);

    const ruleContent = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleContent).toContain('HIPAA');
    expect(ruleContent).not.toContain('GDPR');
    expect(ruleContent).not.toContain('SOC 2');

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: true, frameworks: ['hipaa'] });
  });
});

// ── S4 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S4: from S3 state + --disable → artifacts gone, frameworks remembered', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s4-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'hipaa').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S4: --disable removes artifacts; manifest.frameworks still lists hipaa', async () => {
    const result = run('compliance', '--disable');
    expect(result.status, `compliance --disable failed:\n${result.stderr}`).toBe(0);

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md'))).rejects.toThrow();

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: false, frameworks: ['hipaa'] });
  });
});

// ── S5 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S5: from S4 state + --enable → hipaa restored exactly', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s5-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'hipaa').status).toBe(0);
    expect(run('compliance', '--disable').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S5: --enable restores hipaa artifacts exactly', async () => {
    const result = run('compliance', '--enable');
    expect(result.status, `compliance --enable failed:\n${result.stderr}`).toBe(0);

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    const skillDir = path.join(claudeDir, 'skills', COMPLIANCE_SKILL);
    const files = await listDir(skillDir);
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/hipaa.md',
      'references/sources.md',
    ]);

    const ruleContent = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleContent).toContain('HIPAA');

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: true, frameworks: ['hipaa'] });
  });
});

// ── S6 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S6: from S2 state + rules --disable → skill present, rule absent', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s6-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S6: rules --disable removes rules dir; skill dir still present', async () => {
    const result = run('rules', '--disable');
    expect(result.status, `rules --disable failed:\n${result.stderr}`).toBe(0);

    // Skill must still be present
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(
      fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL)),
      'compliance skill must survive rules --disable',
    ).resolves.not.toThrow();

    // Rule must be gone (rules dir removed)
    await expect(
      fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md')),
      'compliance rule must be gone after rules --disable',
    ).rejects.toThrow();

    // Status output should mention rule withheld
    const statusResult = run('compliance', '--status');
    expect(statusResult.status).toBe(0);
    expect(statusResult.stdout + statusResult.stderr).toMatch(/withheld|rules disabled/i);
  });
});

// ── S7 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S7: from S6 state + rules --enable → compliance rule restored with GDPR, SOC 2', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s7-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
    expect(run('rules', '--disable').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S7: rules --enable restores compliance rule stamped GDPR, SOC 2', async () => {
    const result = run('rules', '--enable');
    expect(result.status, `rules --enable failed:\n${result.stderr}`).toBe(0);

    const ruleContent = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleContent).toContain('GDPR, SOC 2');
  });
});

// ── S8 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S8: rules off + compliance --set pci-dss → skill yes, rule no', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s8-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('rules', '--disable').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S8: compliance --set pci-dss installs skill but no rule (rules disabled)', async () => {
    const result = run('compliance', '--set', 'pci-dss');
    expect(result.status, `compliance --set pci-dss failed:\n${result.stderr}`).toBe(0);

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(
      fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL)),
      'compliance skill must be installed',
    ).resolves.not.toThrow();

    await expect(
      fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md')),
      'compliance rule must NOT be installed (rules disabled)',
    ).rejects.toThrow();
  });
});

// ── S9 ────────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S9: from S2 state + full init → artifacts survive sweep+converge', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s9-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S9: full init after enable leaves compliance artifacts intact', async () => {
    const result = run('init', '--recommended');
    expect(result.status, `second init failed:\n${result.stderr}`).toBe(0);

    // End-state must match S2: skill installed with gdpr+soc2 refs
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    const skillDir = path.join(claudeDir, 'skills', COMPLIANCE_SKILL);
    const files = await listDir(skillDir);
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/gdpr.md',
      'references/soc2.md',
      'references/sources.md',
    ]);

    const ruleContent = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleContent).toContain('GDPR, SOC 2');
  });
});

// ── S10 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S10: from S2 state + init --plugin=devflow-code-review → compliance preserved', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s10-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S10: partial init --plugin=devflow-code-review preserves compliance artifacts', async () => {
    const result = run('init', '--plugin=devflow-code-review');
    expect(result.status, `partial init failed:\n${result.stderr}`).toBe(0);

    // compliance artifacts must be present (convergeComplianceArtifacts re-materializes)
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    const skillDir = path.join(claudeDir, 'skills', COMPLIANCE_SKILL);
    const files = await listDir(skillDir);
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/gdpr.md',
      'references/soc2.md',
      'references/sources.md',
    ]);
  });
});

// ── S11 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S11: legacy manifest with devflow-compliance → pruned on init', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s11-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S11-notice: full init with legacy devflow-compliance manifest emits migration notice', async () => {
    // Craft a legacy manifest that includes devflow-compliance as a plugin.
    const legacyManifest = {
      version: '2.0.0',
      scope: 'user',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plugins: ['devflow-core-skills', 'devflow-implement', 'devflow-compliance'],
      features: {
        ambient: false,
        memory: false,
        learning: false,
        knowledge: false,
        hud: false,
        rules: false,
        proxy: false,
        compliance: { enabled: false, frameworks: [] },
      },
    };
    await fs.writeFile(
      path.join(devflowDir, 'manifest.json'),
      JSON.stringify(legacyManifest, null, 2),
      'utf-8',
    );

    // Run a FULL init (no --plugin flag) — this triggers the legacy plugin detection notice.
    const result = run('init', '--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    // The output must contain the migration notice explaining that compliance moved from
    // a plugin to a built-in feature (printed only when existingManifest.plugins includes
    // 'devflow-compliance'). Combine stdout+stderr — clack directs log messages to stdout
    // but non-TTY CI environments may buffer differently.
    expect(
      result.stdout + result.stderr,
      'output must contain the legacy plugin migration notice',
    ).toContain('Compliance has moved from a plugin to a built-in feature');
  });

  it('S11: devflow-compliance in manifest.plugins is pruned by DELETED_PLUGIN_NAMES on init', async () => {
    // Craft a legacy manifest that includes devflow-compliance as a plugin.
    // Must include `version` and `scope` — readManifest returns null without them,
    // which collapses seed.features.compliance to FEATURE_DEFAULTS (disabled).
    const legacyManifest = {
      version: '2.0.0',
      scope: 'user',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plugins: ['devflow-core-skills', 'devflow-implement', 'devflow-compliance'],
      features: {
        ambient: true,
        memory: true,
        learning: true,
        knowledge: true,
        hud: true,
        rules: true,
        proxy: false,
        compliance: { enabled: true, frameworks: ['gdpr'] },
      },
    };
    await fs.writeFile(
      path.join(devflowDir, 'manifest.json'),
      JSON.stringify(legacyManifest, null, 2),
      'utf-8',
    );

    // Run init (partial reinstall of devflow-implement to trigger resolvePluginList)
    const result = run('init', '--plugin=devflow-implement');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    // devflow-compliance must be pruned from manifest.plugins (DELETED_PLUGIN_NAMES filter)
    const manifest = await readManifest(devflowDir);
    const plugins = (manifest as Record<string, unknown>).plugins as string[];
    expect(plugins).not.toContain('devflow-compliance');

    // Compliance artifacts converged per feature state (enabled:true, frameworks:[gdpr])
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(
      fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL)),
      'compliance skill must be installed (feature.compliance.enabled=true)',
    ).resolves.not.toThrow();
  });
});

// ── S12 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S12: from S2 state + init --reset → compliance off, artifacts gone', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s12-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S12: init --reset resets compliance to disabled and removes artifacts', async () => {
    const result = run('init', '--reset');
    expect(result.status, `init --reset failed:\n${result.stderr}`).toBe(0);

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: false, frameworks: [] });

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md'))).rejects.toThrow();
  });
});

// ── S13: SKIPPED (TTY limitation) ─────────────────────────────────────────────
// S13 requires an interactive TTY to drive the Advanced wizard. The seeding layer
// (resolveInitSeed + applyCliToggles + resolveSeedFeatures compliance passthrough)
// is covered by tests/init-seed.test.ts and tests/compliance-cli.test.ts.

// ── S14 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S14: from S2 state + uninstall --plugin=devflow-plan → compliance retained', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s14-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S14: uninstalling devflow-plan leaves compliance skill intact', async () => {
    const result = run('uninstall', '--plugin=devflow-plan');
    expect(result.status, `uninstall failed:\n${result.stderr}`).toBe(0);

    // compliance skill must be intact (sweepDevflowNamespaces unions FEATURE_OWNED_SKILLS)
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(
      fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL)),
      'compliance skill must survive selective uninstall of another plugin',
    ).resolves.not.toThrow();
  });
});

// ── S15 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S15: from S2 state + bare compliance decoy + full uninstall', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s15-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr,soc2').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S15: full uninstall removes prefixed compliance skill but spares bare decoy', async () => {
    // Plant a bare 'compliance' dir (simulates a foreign skill from another tool)
    const bareDecoy = path.join(claudeDir, 'skills', 'compliance');
    await fs.mkdir(bareDecoy, { recursive: true });
    const sentinel = 'sentinel-compliance-bare-decoy';
    await fs.writeFile(path.join(bareDecoy, 'SKILL.md'), sentinel, 'utf-8');

    // Run full uninstall (non-TTY in CI mode; scope: user)
    run('uninstall', '--scope=user');
    // Accept any exit code — uninstall may warn about missing dirs but still clean up.
    // Just verify the file-system end-state.

    // Prefixed devflow:compliance must be removed
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(
      fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL)),
      'prefixed devflow:compliance must be removed by full uninstall',
    ).rejects.toThrow();

    // Bare compliance/ decoy must survive (foreign dir — not in LEGACY_SKILL_NAMES)
    const survived = await fs.readFile(path.join(bareDecoy, 'SKILL.md'), 'utf-8');
    expect(
      survived,
      'bare compliance/ decoy (foreign dir) must not be deleted by full uninstall',
    ).toBe(sentinel);
  });
});

// ── S16 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S16: shadowed skill + rule shadow + --set gdpr → shadow SKILL.md verbatim', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s16-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S16: compliance --set uses shadow SKILL.md verbatim; rule from shadow (no placeholder)', async () => {
    // Create skill shadow (no devflow: prefix in shadow dir, per shadow convention)
    const shadowSkillDir = path.join(devflowDir, 'skills', 'compliance');
    await fs.mkdir(shadowSkillDir, { recursive: true });
    const customSkillContent = '# Custom Compliance Skill — shadowed';
    await fs.writeFile(path.join(shadowSkillDir, 'SKILL.md'), customSkillContent, 'utf-8');

    // Create rule shadow without placeholder (static content)
    const shadowRuleDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowRuleDir, { recursive: true });
    const customRuleContent = '# Custom Compliance Rule — no placeholder';
    await fs.writeFile(path.join(shadowRuleDir, 'compliance.md'), customRuleContent, 'utf-8');

    const result = run('compliance', '--set', 'gdpr');
    expect(result.status, `compliance --set failed:\n${result.stderr}`).toBe(0);

    // SKILL.md must be the shadow version verbatim
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    const installedSkillMd = await fs.readFile(
      path.join(claudeDir, 'skills', COMPLIANCE_SKILL, 'SKILL.md'),
      'utf-8',
    );
    expect(installedSkillMd).toBe(customSkillContent);

    // Rule must be the shadow version (no placeholder stamping since no placeholder)
    const installedRule = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(installedRule).toBe(customRuleContent);
  });
});

// ── S16b ──────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S16b: rule shadow WITH placeholder → shadow stamped on --set and rules --enable', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s16b-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S16b: shadow rule with placeholder is stamped on --set gdpr AND on rules --enable', async () => {
    const shadowRuleDir = path.join(devflowDir, 'rules');
    await fs.mkdir(shadowRuleDir, { recursive: true });
    // Shadow uses the CURRENT template form: just the bare placeholder with no surrounding
    // clause. stampComplianceRule replaces only the placeholder; any prose around it is
    // template/shadow-owned. The old form ("...${PLACEHOLDER} — controls binding.") would
    // double the trailing clause once stamped.
    const shadowRuleWithPlaceholder =
      '# Custom rule\n- ${DEVFLOW_COMPLIANCE_FRAMEWORKS}';
    await fs.writeFile(path.join(shadowRuleDir, 'compliance.md'), shadowRuleWithPlaceholder, 'utf-8');

    // --set gdpr: should stamp the shadow content with the full GDPR sentence
    const result = run('compliance', '--set', 'gdpr');
    expect(result.status, `compliance --set failed:\n${result.stderr}`).toBe(0);

    const ruleAfterSet = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleAfterSet).toContain('Active frameworks: GDPR — their controls are binding.');
    expect(ruleAfterSet).not.toContain('${DEVFLOW_COMPLIANCE_FRAMEWORKS}');

    // rules --enable should also re-stamp (runRulesEnable converges compliance)
    expect(run('rules', '--disable').status).toBe(0);
    const result2 = run('rules', '--enable');
    expect(result2.status, `rules --enable failed:\n${result2.stderr}`).toBe(0);

    const ruleAfterEnable = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleAfterEnable).toContain('Active frameworks: GDPR — their controls are binding.');
    expect(ruleAfterEnable).not.toContain('${DEVFLOW_COMPLIANCE_FRAMEWORKS}');
  });
});

// ── S17 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S17: invalid framework IDs → non-zero exit, disk unchanged', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s17-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S17: --set gdrp,hippa exits non-zero and leaves no artifacts on disk', async () => {
    const result = run('compliance', '--set', 'gdrp,hippa');
    expect(result.status, 'invalid IDs must produce non-zero exit').not.toBe(0);

    // Error output must mention valid IDs
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/gdpr|hipaa/i);

    // No artifacts on disk (command must fail before writing any files)
    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md'))).rejects.toThrow();

    // Manifest unchanged (enabled:false, frameworks:[])
    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: false, frameworks: [] });
  });
});

// ── S18 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S18: fresh non-TTY --enable with no prior frameworks → generic-only', () => {
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s18-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    expect(run('init', '--recommended').status).toBe(0);
    // Do NOT set any frameworks — fresh state with frameworks:[]
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S18: non-TTY --enable with no frameworks → generic-only rule', async () => {
    // spawnSync is non-TTY by definition, so --enable skips the multiselect
    const result = run('compliance', '--enable');
    expect(result.status, `compliance --enable failed:\n${result.stderr}`).toBe(0);

    const COMPLIANCE_SKILL = ['devflow', 'compliance'].join(':');
    await expect(
      fs.access(path.join(claudeDir, 'skills', COMPLIANCE_SKILL)),
      'compliance skill must be installed',
    ).resolves.not.toThrow();

    const ruleContent = await fs.readFile(
      path.join(claudeDir, 'rules', 'devflow', 'compliance.md'),
      'utf-8',
    );
    expect(ruleContent).toContain('none declared');

    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    expect(features.compliance).toEqual({ enabled: true, frameworks: [] });
  });
});

// ── S19 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S19: manifest writeback deduplicates frameworks', () => {
  // normalizeFrameworks is applied at manifest writeback time so that a hand-edited
  // or migrated manifest with duplicate framework IDs is cleaned up on the next init.
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s19-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S19: init with duplicate frameworks in seed manifest writes deduplicated manifest', async () => {
    // Write a manifest with duplicate framework IDs — simulates a hand-edited manifest
    // or migration artifact that normalizeFrameworks.dedup must clean up.
    const legacyManifest = {
      version: '2.0.0',
      scope: 'user',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plugins: ['devflow-core-skills', 'devflow-implement'],
      features: {
        ambient: false,
        memory: false,
        learning: false,
        knowledge: false,
        hud: false,
        rules: false,
        proxy: false,
        compliance: { enabled: true, frameworks: ['gdpr', 'soc2', 'gdpr', 'gdpr'] },
      },
    };
    await fs.writeFile(
      path.join(devflowDir, 'manifest.json'),
      JSON.stringify(legacyManifest, null, 2),
      'utf-8',
    );

    // Run full init — manifest writeback applies normalizeFrameworks
    const result = run('init', '--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    // The written manifest.features.compliance.frameworks must have no duplicates
    const manifest = await readManifest(devflowDir);
    const features = (manifest as Record<string, unknown>).features as Record<string, unknown>;
    const compliance = features.compliance as { enabled: boolean; frameworks: string[] };
    expect(compliance.enabled).toBe(true);
    // After dedup: ['gdpr', 'soc2'] — each appears exactly once, insertion order preserved
    expect(compliance.frameworks).toEqual(['gdpr', 'soc2']);
  });
});

// ── S20 ───────────────────────────────────────────────────────────────────────
describe.skipIf(!distExists)('S20: compliance sweep suppression conditional on enabled+converge', () => {
  // Verifies that the filteredSweepReport correctly surfaces or suppresses the
  // compliance skill orphan depending on whether compliance is enabled (and converge
  // succeeded) vs. disabled. The sweep always finds the compliance skill as an orphan
  // (it is excluded from knownNames by design); converge re-materializes it when
  // enabled or removes it when disabled.
  let tmpHome: string;
  let devflowDir: string;
  let claudeDir: string;
  let run: ReturnType<typeof makeRunner>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-s20-'));
    devflowDir = path.join(tmpHome, '.devflow');
    claudeDir = path.join(tmpHome, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    run = makeRunner(tmpHome, devflowDir);
    // Base state: init with compliance enabled (gdpr)
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr').status).toBe(0);
  });

  afterEach(async () => { await fs.rm(tmpHome, { recursive: true, force: true }); });

  it('S20a: re-init with compliance still enabled does NOT surface compliance in sweep report', async () => {
    // Compliance skill swept by orphan sweep, then re-installed by converge.
    // Suppress condition (enabled && convergeSucceeded = true) → not surfaced.
    const result = run('init', '--recommended');
    expect(result.status, `second init failed:\n${result.stderr}`).toBe(0);

    const combined = result.stdout + result.stderr;
    // The orphan message pattern is "skill compliance" — must not appear when suppressed.
    expect(combined).not.toMatch(/skill compliance/);
    // Compliance skill must still be present (converge re-materialized it).
    await expect(
      fs.access(path.join(claudeDir, 'skills', 'devflow:compliance')),
      'compliance skill must survive re-init with compliance enabled',
    ).resolves.not.toThrow();
  });

  it('S20b: re-init with --no-compliance surfaces compliance in sweep report', async () => {
    // Compliance skill swept by orphan sweep; converge removes it (disabled).
    // Fixture state: enabled = false (--no-compliance). Predicate: !(false && ...) = true → orphan surfaced.
    const result = run('init', '--no-compliance');
    expect(result.status, `init --no-compliance failed:\n${result.stderr}`).toBe(0);

    const combined = result.stdout + result.stderr;
    // The orphan message pattern is "skill compliance" — must appear when not suppressed.
    expect(combined).toMatch(/skill compliance/);
    // Compliance skill must be gone.
    let exists = false;
    try { await fs.access(path.join(claudeDir, 'skills', 'devflow:compliance')); exists = true; } catch {}
    expect(exists, 'compliance skill must be removed after --no-compliance').toBe(false);
  });
});
