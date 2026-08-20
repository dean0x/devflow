/**
 * Tests for src/targets/claude-code/compliance-install.ts
 *
 * Step 1.3 — TDD: write failing tests first.
 *
 * All tests use injected tmp dirs — never real HOME.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { convergeComplianceArtifacts } from '../src/targets/claude-code/compliance-install.js';
import { COMPLIANCE_RULE_PLACEHOLDER } from '../src/core/compliance.js';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let claudeDir: string;
let devflowDir: string;

const SKILL_NAME = 'devflow:compliance';
const RULE_REL = 'rules/devflow/compliance.md';

async function skillTargetDir() {
  return path.join(claudeDir, 'skills', SKILL_NAME);
}

async function ruleTargetPath() {
  return path.join(claudeDir, RULE_REL);
}

async function listSkillFiles(): Promise<string[]> {
  const dir = await skillTargetDir();
  const allEntries: string[] = [];
  const recurse = async (d: string, rel: string) => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await recurse(path.join(d, e.name), relPath);
      } else {
        allEntries.push(relPath);
      }
    }
  };
  await recurse(dir, '');
  return allEntries.sort();
}

async function skillExists(): Promise<boolean> {
  try {
    await fs.access(await skillTargetDir());
    return true;
  } catch {
    return false;
  }
}

async function ruleExists(): Promise<boolean> {
  try {
    await fs.access(await ruleTargetPath());
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-ci-test-'));
  claudeDir = path.join(tmpDir, 'claude');
  devflowDir = path.join(tmpDir, 'devflow');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  // Pre-create target dirs the installer assumes exist
  await fs.mkdir(path.join(claudeDir, 'skills'), { recursive: true });
  await fs.mkdir(path.join(claudeDir, 'rules', 'devflow'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Step 1: Selective reference install
// ---------------------------------------------------------------------------

describe('selective reference install', () => {
  it('enable+[gdpr,soc2] → skill dir contains exactly SKILL.md, references/gdpr.md, references/soc2.md, references/detection.md, references/sources.md', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['gdpr', 'soc2'],
      rulesEnabled: true,
      warn,
    });

    expect(await skillExists()).toBe(true);
    const files = await listSkillFiles();
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/gdpr.md',
      'references/soc2.md',
      'references/sources.md',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('all six frameworks → all six ref files present plus detection+sources', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['gdpr', 'hipaa', 'pci-dss', 'soc2', 'iso-27001', 'sox'],
      rulesEnabled: true,
      warn,
    });

    const files = await listSkillFiles();
    expect(files).toContain('references/gdpr.md');
    expect(files).toContain('references/hipaa.md');
    expect(files).toContain('references/pci-dss.md');
    expect(files).toContain('references/soc2.md');
    expect(files).toContain('references/iso-27001.md');
    expect(files).toContain('references/sox.md');
    expect(files).toContain('references/detection.md');
    expect(files).toContain('references/sources.md');
    expect(files).toContain('SKILL.md');
  });

  it('zero frameworks → SKILL.md + detection.md + sources.md only (generic controls)', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: [],
      rulesEnabled: true,
      warn,
    });

    const files = await listSkillFiles();
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/sources.md',
    ]);
  });

  it('rule is installed and stamped when enabled+rulesEnabled', async () => {
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['gdpr'],
      rulesEnabled: true,
      warn: vi.fn(),
    });

    expect(await ruleExists()).toBe(true);
    const ruleContent = await fs.readFile(await ruleTargetPath(), 'utf-8');
    // Placeholder replaced by label
    expect(ruleContent).toContain('GDPR');
    expect(ruleContent).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
  });

  it('rule NOT installed when enabled+!rulesEnabled', async () => {
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['gdpr'],
      rulesEnabled: false,
      warn: vi.fn(),
    });

    expect(await skillExists()).toBe(true);
    expect(await ruleExists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 2: Recompose exactness (--set semantics, PF-011)
// ---------------------------------------------------------------------------

describe('recompose exactness (--set semantics)', () => {
  it('re-converge [gdpr,soc2] → [hipaa]: gdpr/soc2 refs gone, hipaa present, detection+sources stay', async () => {
    const warn = vi.fn();
    // Initial install with gdpr+soc2
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr', 'soc2'], rulesEnabled: false, warn,
    });

    // Re-converge with hipaa only
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['hipaa'], rulesEnabled: false, warn,
    });

    const files = await listSkillFiles();
    expect(files).not.toContain('references/gdpr.md');
    expect(files).not.toContain('references/soc2.md');
    expect(files).toContain('references/hipaa.md');
    expect(files).toContain('references/detection.md');
    expect(files).toContain('references/sources.md');
    expect(files).toContain('SKILL.md');
  });

  it('recompose does not leave stale files from prior install', async () => {
    const warn = vi.fn();
    // Install all 6
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true,
      frameworks: ['gdpr', 'hipaa', 'pci-dss', 'soc2', 'iso-27001', 'sox'],
      rulesEnabled: false, warn,
    });

    // Narrow to just sox
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['sox'], rulesEnabled: false, warn,
    });

    const files = await listSkillFiles();
    expect(files).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/sources.md',
      'references/sox.md',
    ]);
  });

  it('rule re-stamped with new frameworks on re-converge', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn,
    });

    // Re-converge with sox
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['sox'], rulesEnabled: true, warn,
    });

    const content = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(content).toContain('SOX');
    expect(content).not.toContain('GDPR');
    expect(content).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
  });
});

// ---------------------------------------------------------------------------
// Step 3: Shadow paths
// ---------------------------------------------------------------------------

describe('shadow paths', () => {
  it('skill shadow installed verbatim (shadows replace source)', async () => {
    // Create a skill shadow with custom content
    const shadowSkillDir = path.join(devflowDir, 'skills', 'compliance');
    await fs.mkdir(path.join(shadowSkillDir, 'references'), { recursive: true });
    await fs.writeFile(path.join(shadowSkillDir, 'SKILL.md'), '# Custom Shadow Skill\nCustom content.', 'utf-8');

    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn,
    });

    const installedSkillMd = await fs.readFile(
      path.join(claudeDir, 'skills', SKILL_NAME, 'SKILL.md'),
      'utf-8',
    );
    expect(installedSkillMd).toContain('Custom Shadow Skill');
  });

  it('placeholder-less rule shadow installed byte-identical (no-op stamp)', async () => {
    const shadowContent = '# Custom Rule\nNo placeholder here.';
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'compliance.md'), shadowContent, 'utf-8');

    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn,
    });

    const installed = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(installed).toBe(shadowContent);
  });

  it('placeholder-bearing rule shadow is re-stamped from shadow source', async () => {
    const shadowContent = `# Custom Rule\n- Active frameworks: ${COMPLIANCE_RULE_PLACEHOLDER} — binding.`;
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'compliance.md'), shadowContent, 'utf-8');

    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['soc2'], rulesEnabled: true, warn,
    });

    const installed = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(installed).toContain('SOC 2');
    expect(installed).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
  });
});

// ---------------------------------------------------------------------------
// Step 4: Disable path removes both artifacts
// ---------------------------------------------------------------------------

describe('disable path', () => {
  it('disabled → skill dir removed', async () => {
    // First install
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });
    expect(await skillExists()).toBe(true);

    // Now disable
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });
    expect(await skillExists()).toBe(false);
  });

  it('disabled → rule removed', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });
    expect(await ruleExists()).toBe(true);

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });
    expect(await ruleExists()).toBe(false);
  });

  it('disabled → no-op when already absent (idempotent)', async () => {
    const warn = vi.fn();
    // Never installed — should succeed silently
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn,
    });
    expect(await skillExists()).toBe(false);
    expect(await ruleExists()).toBe(false);
    // No throws, warn called 0 times (absent = no-op, not an error)
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Step 5: PF-015 no-short-circuit (avoids PF-015)
// ---------------------------------------------------------------------------

describe('PF-015: both artifacts converge unconditionally (avoids PF-015)', () => {
  it('disable: rule removed even when skill dir was already absent', async () => {
    // Only rule is present, skill dir is not
    await fs.mkdir(path.join(claudeDir, 'rules', 'devflow'), { recursive: true });
    await fs.writeFile(await ruleTargetPath(), 'rule content', 'utf-8');

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });

    // Skill was already absent: still absent
    expect(await skillExists()).toBe(false);
    // Rule was present: now removed
    expect(await ruleExists()).toBe(false);
  });

  it('disable: skill dir removed even when rule was already absent', async () => {
    // Only skill is present
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    expect(await skillExists()).toBe(true);
    expect(await ruleExists()).toBe(false);

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: false, warn: vi.fn(),
    });

    expect(await skillExists()).toBe(false);
    expect(await ruleExists()).toBe(false);
  });

  it('enable: rule installed even when skill dir install is a no-op (already matches)', async () => {
    // Install once (creates skill)
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    // Rule is absent; re-converge enabling rules too — rule must be installed
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });

    expect(await skillExists()).toBe(true);
    expect(await ruleExists()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 6: removedPreexisting — pre-existing plugin-form artifacts
// ---------------------------------------------------------------------------

describe('removedPreexisting', () => {
  it('returns false when no pre-existing compliance artifacts exist', async () => {
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });
    expect(result.removedPreexisting).toBe(false);
  });

  it('returns true and removes pre-existing skill dir when feature disabled', async () => {
    // Simulate old plugin-form install: create a skill dir as if the plugin installed it
    const skillDir = path.join(claudeDir, 'skills', SKILL_NAME);
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# old install', 'utf-8');

    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });

    expect(result.removedPreexisting).toBe(true);
    expect(await skillExists()).toBe(false);
  });

  it('returns true and removes pre-existing rule when feature disabled', async () => {
    await fs.writeFile(await ruleTargetPath(), 'old rule content', 'utf-8');

    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });

    expect(result.removedPreexisting).toBe(true);
    expect(await ruleExists()).toBe(false);
  });

  it('returns false when enabled (not a removal scenario)', async () => {
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });
    expect(result.removedPreexisting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 7: PF-009 warn-not-throw
// ---------------------------------------------------------------------------

describe('PF-009: failures warn via injected warn, never throw', () => {
  it('converge never throws even if the skill source is somehow unavailable (warn instead)', async () => {
    // This test verifies the contract: non-fatal failures use warn, not throw.
    // We test that converge resolves (doesn't reject) on a normal call.
    const warn = vi.fn();
    await expect(
      convergeComplianceArtifacts({
        claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn,
      }),
    ).resolves.not.toThrow();
  });

  it('disable path resolves (no throw) even when artifact removal has nothing to remove', async () => {
    const warn = vi.fn();
    // Nothing installed — disable is a complete no-op
    await expect(
      convergeComplianceArtifacts({
        claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: false, warn,
      }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Step 8: framework IDs are registry-validated before becoming fs paths (AC-35)
// ---------------------------------------------------------------------------

describe('AC-35: unvalidated framework IDs never reach an fs path', () => {
  // `frameworks` arrives here straight from manifest.features.compliance.frameworks
  // on the bare --enable path of init, `rules --enable` and `compliance --enable`.
  // normalizeComplianceFeature only type-checks it, so convergeComplianceArtifacts
  // itself must filter to registry IDs before any path.join.

  it('a traversal ID cannot write outside the skill dir', async () => {
    const warn = vi.fn();

    // Chosen so the copy would SUCCEED without the filter — this probe is not vacuous:
    //   src  = <assets>/skills/compliance/references/../../../rules/compliance.md  (exists)
    //   dst  = <claudeDir>/skills/devflow:compliance.tmp/references/../../../rules/compliance.md
    //        = <claudeDir>/rules/compliance.md                (parent dir exists per beforeEach)
    const traversalId = '../../../rules/compliance';
    const escapeTarget = path.join(claudeDir, 'rules', 'compliance.md');

    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['gdpr', traversalId],
      rulesEnabled: true,
      warn,
    });

    // Nothing was written outside the skill dir.
    await expect(fs.access(escapeTarget)).rejects.toThrow();

    // …and the valid part of the selection still installed normally: one bad ID in a
    // manifest must degrade to "that framework is dropped", not "no skill installed".
    expect(await skillExists()).toBe(true);
    expect(await listSkillFiles()).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/gdpr.md',
      'references/sources.md',
    ]);
  });

  it('an unknown ID is dropped and the rule is stamped without it', async () => {
    const warn = vi.fn();

    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['hipaa', 'not-a-real-framework'],
      rulesEnabled: true,
      warn,
    });

    const rule = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(rule).toContain('HIPAA');
    expect(rule).not.toContain('not-a-real-framework');
    expect(rule).not.toContain('NOT-A-REAL-FRAMEWORK');
    expect(rule).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
  });

  it('an all-unknown selection still installs the skill (generic controls)', async () => {
    const warn = vi.fn();

    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['bogus-one', 'bogus-two'],
      rulesEnabled: true,
      warn,
    });

    expect(await skillExists()).toBe(true);
    expect(await listSkillFiles()).toEqual([
      'SKILL.md',
      'references/detection.md',
      'references/sources.md',
    ]);
    const rule = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(rule).toContain('none declared — generic controls only');
  });
});
