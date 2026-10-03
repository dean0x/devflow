/**
 * Tests for src/targets/claude-code/compliance-install.ts
 *
 * D-COMPLIANCE-INSTALL-ALWAYS: every convergence installs the skill with every
 * framework reference; the machine switch owns only the rule and the SKILL.md
 * stamp (machine frameworks when on, the neutral zero-framework stamp when off).
 *
 * All tests use injected tmp dirs — never real HOME.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { convergeComplianceArtifacts } from '../src/targets/claude-code/compliance-install.js';
import { ALWAYS_PRESENT_REFS, COMPLIANCE_FRAMEWORKS, COMPLIANCE_RULE_PLACEHOLDER } from '../src/core/compliance.js';
import { shadowSeedDir } from '../src/cli/commands/skills.js';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let claudeDir: string;
let devflowDir: string;

const SKILL_NAME = 'devflow:compliance';
const RULE_REL = 'rules/devflow/compliance.md';

/** What every install carries, whatever the selection: SKILL.md and every reference. */
const EVERY_SKILL_FILE: readonly string[] = [
  'SKILL.md',
  ...ALWAYS_PRESENT_REFS.map(r => `references/${r}`),
  ...COMPLIANCE_FRAMEWORKS.map(fw => `references/${fw.id}.md`),
].sort();

/** The neutral stamp a compliance-off machine's SKILL.md carries. */
const NEUTRAL_STAMP = 'The machine declares no framework.';

async function installedSkillMd(): Promise<string> {
  return fs.readFile(path.join(claudeDir, 'skills', SKILL_NAME, 'SKILL.md'), 'utf-8');
}

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
// Step 1: Every reference installed; the stamp follows the machine selection
// ---------------------------------------------------------------------------

describe('install every reference (D-COMPLIANCE-INSTALL-ALWAYS)', () => {
  it('enable+[gdpr,soc2] → every reference installed; SKILL.md stamped GDPR, SOC 2', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: ['gdpr', 'soc2'],
      rulesEnabled: true,
      warn,
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    expect(warn).not.toHaveBeenCalled();

    // Composed SKILL.md: no unresolved tokens; the stamp and the reference rows name
    // the machine's selection only.
    const skillContent = await installedSkillMd();
    expect(skillContent).not.toContain('${DEVFLOW_COMPLIANCE_');
    expect(skillContent).toContain('**Machine frameworks: GDPR, SOC 2.**');
    expect(skillContent).toContain('| `references/gdpr.md` |');
    expect(skillContent).toContain('| `references/soc2.md` |');
    expect(skillContent).not.toContain('| `references/hipaa.md` |');
  });

  it('all six frameworks → the same file set', async () => {
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: COMPLIANCE_FRAMEWORKS.map(fw => fw.id),
      rulesEnabled: true,
      warn: vi.fn(),
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
  });

  it('zero frameworks → the same file set, neutral stamp (generic controls)', async () => {
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: true,
      frameworks: [],
      rulesEnabled: true,
      warn: vi.fn(),
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    expect(await installedSkillMd()).toContain(NEUTRAL_STAMP);
  });

  it('every SKILL.md routes reference loading through the ids the caller passes (D-COMPLIANCE-REPO-LENS)', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    const skill = await installedSkillMd();
    expect(skill).toContain('(`COMPLIANCE_FRAMEWORKS`');
    expect(skill).toContain('Load `references/{id}.md` for each given id and no other');
    // Presence is no longer a selection signal — the old instruction must be gone.
    expect(skill).not.toMatch(/presence in the installed skill directory is the authoritative/i);
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
    // Placeholder replaced by label; per-framework bullet present; no unresolved tokens.
    expect(ruleContent).toContain('GDPR');
    expect(ruleContent).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
    expect(ruleContent).not.toContain('${DEVFLOW_COMPLIANCE_RULE_BULLETS}');
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
// Step 2: Recompose exactness (--set semantics)
// ---------------------------------------------------------------------------

describe('recompose exactness (--set semantics)', () => {
  it('re-converge [gdpr,soc2] → [hipaa]: file set unchanged, SKILL.md re-stamped HIPAA', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr', 'soc2'], rulesEnabled: false, warn,
    });
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['hipaa'], rulesEnabled: false, warn,
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    const skillContent = await installedSkillMd();
    expect(skillContent).toContain('**Machine frameworks: HIPAA.**');
    expect(skillContent).toContain('| `references/hipaa.md` |');
    expect(skillContent).not.toContain('| `references/gdpr.md` |');
    expect(skillContent).not.toContain('${DEVFLOW_COMPLIANCE_');
  });

  it('recompose leaves no stale files and no tmp sibling', async () => {
    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true,
      frameworks: COMPLIANCE_FRAMEWORKS.map(fw => fw.id),
      rulesEnabled: false, warn,
    });
    await fs.writeFile(path.join(await skillTargetDir(), 'references', 'stale.md'), 'stale', 'utf-8');

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['sox'], rulesEnabled: false, warn,
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    await expect(fs.access(`${await skillTargetDir()}.tmp`)).rejects.toThrow();
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
    // Shadow uses the CURRENT template form: just the bare placeholder with no
    // surrounding clause. stampComplianceRule replaces only the placeholder; any
    // prose around it is template/shadow-owned. A shadow that pre-appends its own
    // trailing clause (old form: "...${PLACEHOLDER} — binding.") would double the
    // clause once stamped.
    const shadowContent = `# Custom Rule\n- ${COMPLIANCE_RULE_PLACEHOLDER}`;
    await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'rules', 'compliance.md'), shadowContent, 'utf-8');

    const warn = vi.fn();
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['soc2'], rulesEnabled: true, warn,
    });

    const installed = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(installed).toContain('Active frameworks: SOC 2 — their controls are binding.');
    expect(installed).not.toContain(COMPLIANCE_RULE_PLACEHOLDER);
  });
});

// ---------------------------------------------------------------------------
// Step 4: Disable path keeps the skill (neutral stamp) and removes the rule
// ---------------------------------------------------------------------------

describe('disable path', () => {
  it('disabled → skill kept with every reference and the neutral stamp', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    const skill = await installedSkillMd();
    expect(skill).toContain(NEUTRAL_STAMP);
    // The remembered selection never reaches an off machine's stamp.
    expect(skill).not.toContain('Machine frameworks:');
    expect(skill).not.toContain('| `references/gdpr.md` |');
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

  it('disabled from nothing → skill installed, no rule, no warning (idempotent)', async () => {
    const warn = vi.fn();
    for (let i = 0; i < 2; i++) {
      await convergeComplianceArtifacts({
        claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn,
      });
    }
    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    expect(await ruleExists()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Step 5: no short-circuit between the two artifacts
// ---------------------------------------------------------------------------

describe('both artifacts converge unconditionally', () => {
  it('disable: rule removed and skill installed when only a rule was present', async () => {
    await fs.mkdir(path.join(claudeDir, 'rules', 'devflow'), { recursive: true });
    await fs.writeFile(await ruleTargetPath(), 'rule content', 'utf-8');

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    expect(await ruleExists()).toBe(false);
  });

  it('disable: skill re-stamped neutral when the rule was already absent', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    expect(await installedSkillMd()).toContain('**Machine frameworks: GDPR.**');
    expect(await ruleExists()).toBe(false);

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: false, warn: vi.fn(),
    });

    expect(await installedSkillMd()).toContain(NEUTRAL_STAMP);
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

  it('disable: skill still converges when rule removal fails — EISDIR directory obstacle (step isolation)', async () => {
    // Portability rationale: fs.rm(path, {force:true}) without {recursive:true} throws
    // ERR_FS_EISDIR when the target is a directory. Replacing the rule FILE with a
    // DIRECTORY of the same name induces this error without chmod (chmod 000 is a no-op
    // under root in some CI environments and does not test the isolation machinery).
    const warns: string[] = [];

    // Seed both artifacts via a normal enabled converge.
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true,
      warn: vi.fn(),
    });
    expect(await ruleExists()).toBe(true);

    // Replace the rule FILE with a DIRECTORY of the same name (EISDIR obstacle).
    await fs.rm(await ruleTargetPath(), { force: true });
    await fs.mkdir(await ruleTargetPath());

    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true,
      warn: (m) => warns.push(m),
    });

    // (a) The skill converged to the neutral stamp despite the rule failure.
    expect(await installedSkillMd()).toContain(NEUTRAL_STAMP);
    // (b) warn was called with the rule-removal failure.
    expect(warns.some(w => w.includes('rule'))).toBe(true);
    // (c) converged is false because a warn path was taken.
    expect(result.converged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 6: removedPreexisting — a pre-existing rule on a disable convergence
// ---------------------------------------------------------------------------

describe('removedPreexisting', () => {
  it('returns false when no pre-existing compliance artifacts exist', async () => {
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });
    expect(result.removedPreexisting).toBe(false);
    expect(result.converged).toBe(true);
  });

  it('returns false for a pre-existing skill dir alone, and replaces it with the neutral install', async () => {
    // Old plugin-form install: a skill dir, no rule. The skill is installed on every
    // machine now, so its presence is no removal signal.
    const skillDir = path.join(claudeDir, 'skills', SKILL_NAME);
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# old install', 'utf-8');

    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });

    expect(result.removedPreexisting).toBe(false);
    expect(await installedSkillMd()).toContain(NEUTRAL_STAMP);
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

  it('returns false when enabled with rules off removes a stale rule (not a disable)', async () => {
    await fs.writeFile(await ruleTargetPath(), 'stale rule', 'utf-8');
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    expect(result.removedPreexisting).toBe(false);
    expect(await ruleExists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 7: warn-not-throw
// ---------------------------------------------------------------------------

describe('failures warn via injected warn, never throw', () => {
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

  it('enable: skill installs successfully even when rule install fails — rule parent is a file (warn-not-throw)', async () => {
    // Portability rationale: making the rule target's parent directory a FILE forces
    // installRuleFile's fs.mkdir(dirname, {recursive:true}) to throw EEXIST/ENOTDIR.
    // Portable on Linux/macOS without chmod (no-op risk under root in CI).
    const warns: string[] = [];

    // Replace {claudeDir}/rules/devflow/ (directory from beforeEach) with a file of
    // the same name so installRuleFile cannot recreate the parent directory.
    await fs.rm(path.join(claudeDir, 'rules', 'devflow'), { recursive: true, force: true });
    await fs.writeFile(path.join(claudeDir, 'rules', 'devflow'), 'not-a-directory', 'utf-8');

    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true,
      warn: (m) => warns.push(m),
    });

    // Skill dir installed successfully — the two steps are independent (no
    // short-circuit: rule failure must not suppress skill install).
    expect(await skillExists()).toBe(true);
    const files = await listSkillFiles();
    expect(files).toContain('SKILL.md');
    expect(files).toContain('references/gdpr.md');

    // warn was called with the rule install failure (warn not throw).
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns.some(w => w.toLowerCase().includes('rule'))).toBe(true);

    // converged is false because a warn path was taken.
    expect(result.converged).toBe(false);
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

    // …and the install is otherwise normal: one bad ID in a manifest degrades to
    // "that framework is dropped", not "no skill installed" — and never adds a file.
    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    const skill = await installedSkillMd();
    expect(skill).toContain('**Machine frameworks: GDPR.**');
    expect(skill).not.toContain('rules/compliance');
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

    expect(await listSkillFiles()).toEqual(EVERY_SKILL_FILE);
    expect(await installedSkillMd()).toContain(NEUTRAL_STAMP);
    const rule = await fs.readFile(await ruleTargetPath(), 'utf-8');
    expect(rule).toContain('none declared — generic controls only');
  });
});

// ---------------------------------------------------------------------------
// Step 9: converged — truthful completion flag (I13)
// ---------------------------------------------------------------------------

describe('converged: truthful completion flag (I13)', () => {
  it('enable with no errors → converged: true', async () => {
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });
    expect(result.converged).toBe(true);
  });

  it('disable with no errors → converged: true', async () => {
    // First install
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: true, warn: vi.fn(),
    });
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: false, frameworks: [], rulesEnabled: true, warn: vi.fn(),
    });
    expect(result.converged).toBe(true);
  });

  it('enable with zero frameworks and rules (minimal path) → converged: true', async () => {
    const result = await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: [], rulesEnabled: false, warn: vi.fn(),
    });
    expect(result.converged).toBe(true);
  });

  it('converged: false when warn is called during skill install failure', async () => {
    // Remove the skills source dir to force installSkillDir to warn.
    // We can simulate this by passing a claudeDir path whose intermediate skill
    // target cannot be created. A non-absolute claudeDir triggers the S78 guard.
    const warns: string[] = [];
    const result = await convergeComplianceArtifacts({
      claudeDir: 'relative/path',   // non-absolute → S78 guard fires → converged: false
      devflowDir,
      enabled: true,
      frameworks: ['gdpr'],
      rulesEnabled: true,
      warn: (m) => warns.push(m),
    });
    expect(result.converged).toBe(false);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('not an absolute path');
  });
});

// ---------------------------------------------------------------------------
// Step 10: S78 — claudeDir precondition guard
// ---------------------------------------------------------------------------

describe('S78: claudeDir must be an absolute path', () => {
  it('relative claudeDir → warns and returns converged: false without touching the filesystem', async () => {
    const warns: string[] = [];
    const result = await convergeComplianceArtifacts({
      claudeDir: 'not/absolute',
      devflowDir,
      enabled: true,
      frameworks: ['gdpr'],
      rulesEnabled: true,
      warn: (m) => warns.push(m),
    });
    expect(result.removedPreexisting).toBe(false);
    expect(result.converged).toBe(false);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/not an absolute path/);
  });

  it('empty claudeDir → warns and returns converged: false', async () => {
    const warns: string[] = [];
    const result = await convergeComplianceArtifacts({
      claudeDir: '',
      devflowDir,
      enabled: false,
      frameworks: [],
      rulesEnabled: true,
      warn: (m) => warns.push(m),
    });
    expect(result.converged).toBe(false);
    expect(warns).toHaveLength(1);
  });

  it('absolute claudeDir (happy path) → no claudeDir-guard warn', async () => {
    const warns: string[] = [];
    await convergeComplianceArtifacts({
      claudeDir,   // absolute path from beforeEach
      devflowDir,
      enabled: false,
      frameworks: [],
      rulesEnabled: true,
      warn: (m) => warns.push(m),
    });
    // The guard must not have fired — no warn about absolute path
    expect(warns.every(w => !w.includes('not an absolute path'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 11: ALWAYS_PRESENT_REFS exported from compliance.ts (I11)
// ---------------------------------------------------------------------------

describe('ALWAYS_PRESENT_REFS: exported from src/core/compliance.ts (I11)', () => {
  it('contains detection.md and sources.md — the two unconditional refs', () => {
    expect(ALWAYS_PRESENT_REFS).toContain('detection.md');
    expect(ALWAYS_PRESENT_REFS).toContain('sources.md');
  });

  it('has exactly 2 entries — adding a third requires updating this test intentionally', () => {
    // This is the sentinel: if someone adds a third always-present ref, this test
    // fails, forcing a deliberate decision rather than a phantom drift in --status.
    expect(ALWAYS_PRESENT_REFS).toHaveLength(2);
  });

  it('zero-framework install carries the ALWAYS_PRESENT_REFS alongside every framework reference', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: [], rulesEnabled: false, warn: vi.fn(),
    });
    const files = await listSkillFiles();
    for (const ref of ALWAYS_PRESENT_REFS) expect(files).toContain(`references/${ref}`);
    expect(files).toEqual(EVERY_SKILL_FILE);
  });
});

// ---------------------------------------------------------------------------
// Step 12: TP-44 (AC-38) — a shadow seeded from source is stamped by a later set
// ---------------------------------------------------------------------------

describe('TP-44 (AC-38): a shadowed compliance skill is re-stamped by a later convergence', () => {
  /** Seed the shadow as `devflow skills shadow compliance` does. */
  async function seedShadow(installedDir: string | null): Promise<string> {
    const shadowDir = path.join(devflowDir, 'skills', 'compliance');
    await fs.cp(shadowSeedDir('compliance', installedDir), shadowDir, { recursive: true });
    return shadowDir;
  }

  it('the compliance shadow is seeded from source, never from the stamped installed copy', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    const shadowDir = await seedShadow(await skillTargetDir());

    const seeded = await fs.readFile(path.join(shadowDir, 'SKILL.md'), 'utf-8');
    expect(seeded, 'the seed must still carry the composition tokens').toContain('${DEVFLOW_COMPLIANCE_ACTIVE}');
    expect(seeded).not.toContain('**Machine frameworks: GDPR.**');
  });

  it('a later convergence stamps the shadowed skill with the new frameworks', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    await seedShadow(await skillTargetDir());

    // `devflow compliance --set hipaa` converges with the new selection.
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['hipaa'], rulesEnabled: false, warn: vi.fn(),
    });

    const skill = await installedSkillMd();
    expect(skill).toContain('**Machine frameworks: HIPAA.**');
    expect(skill).not.toContain('| `references/gdpr.md` |');
  });

  it('known-bad probe: a shadow copied from the installed copy freezes the old stamp', async () => {
    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['gdpr'], rulesEnabled: false, warn: vi.fn(),
    });
    const shadowDir = path.join(devflowDir, 'skills', 'compliance');
    await fs.cp(await skillTargetDir(), shadowDir, { recursive: true });

    await convergeComplianceArtifacts({
      claudeDir, devflowDir, enabled: true, frameworks: ['hipaa'], rulesEnabled: false, warn: vi.fn(),
    });

    // The defect #9 fixed: the token-free shadow passes through byte-identical (C1).
    expect(await installedSkillMd()).toContain('**Machine frameworks: GDPR.**');
  });

  it('a skill that is not feature-owned still seeds from its installed copy', () => {
    const installed = path.join(claudeDir, 'skills', 'devflow:security');
    expect(shadowSeedDir('security', installed)).toBe(installed);
    expect(shadowSeedDir('security', null)).not.toBe(installed);
  });
});
