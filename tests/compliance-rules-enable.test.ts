/**
 * Tests for runRulesEnable in src/cli/commands/rules.ts
 *
 * Step 1.4 — TDD: failing tests first.
 *
 * Verifies that runRulesEnable (extracted from --enable handler body) also
 * converges the compliance rule when manifest.features.compliance.enabled.
 *
 * Does NOT exercise the full init flow — tests run against tmp dirs,
 * never real HOME (avoids PF-018).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runRulesEnable } from '../src/cli/commands/rules.js';
import { writeManifest } from '../src/core/manifest.js';
import { COMPLIANCE_RULE_PLACEHOLDER } from '../src/core/compliance.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let claudeDir: string;
let devflowDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-rules-enable-'));
  claudeDir = path.join(tmpDir, 'claude');
  devflowDir = path.join(tmpDir, 'devflow');
  await fs.mkdir(path.join(claudeDir, 'rules', 'devflow'), { recursive: true });
  await fs.mkdir(path.join(claudeDir, 'skills'), { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write a manifest to the tmp devflowDir */
async function writeTestManifest(
  complianceEnabled: boolean,
  complianceFrameworks: string[] = [],
): Promise<void> {
  await writeManifest(devflowDir, {
    version: '2.0.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: {
      ambient: false,
      memory: false,
      hud: false,
      knowledge: false,
      learning: false,
      rules: true,
      proxy: false,
      flags: [],
      compliance: { enabled: complianceEnabled, frameworks: complianceFrameworks },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const ruleTarget = () => path.join(claudeDir, 'rules', 'devflow', 'compliance.md');

describe('runRulesEnable — compliance rule convergence', () => {
  it('compliance.enabled=true with frameworks → installs stamped compliance rule', async () => {
    await writeTestManifest(true, ['gdpr', 'sox']);

    await runRulesEnable(claudeDir, devflowDir);

    // Compliance rule should be present
    const ruleContent = await fs.readFile(ruleTarget(), 'utf-8');
    // Placeholder should be replaced (stamped)
    expect(ruleContent).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
    // Labels for selected frameworks should appear
    expect(ruleContent).toContain('GDPR');
    expect(ruleContent).toContain('SOX');
  });

  it('compliance.enabled=false → does NOT install compliance rule', async () => {
    await writeTestManifest(false, ['gdpr']);

    await runRulesEnable(claudeDir, devflowDir);

    // Compliance rule should NOT be present (compliance is off)
    let ruleExists = false;
    try {
      await fs.access(ruleTarget());
      ruleExists = true;
    } catch { /* ENOENT = not installed, as expected */ }

    expect(ruleExists).toBe(false);
  });

  it('compliance.enabled=true with zero frameworks → installs rule with generic stamp', async () => {
    await writeTestManifest(true, []);

    await runRulesEnable(claudeDir, devflowDir);

    const ruleContent = await fs.readFile(ruleTarget(), 'utf-8');
    // Should contain the "generic controls only" text for empty frameworks
    expect(ruleContent).toContain('none declared');
    expect(ruleContent).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
  });
});
