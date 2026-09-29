/**
 * Compliance artifact installer for the Claude Code target.
 *
 * Convergence function: installs the compliance skill directory on every
 * machine and installs or removes the rule file based on the current feature state.
 *
 * D-COMPLIANCE-INSTALL-ALWAYS: the skill and all six framework references are
 * installed whatever the machine's own selection, because a repository can turn
 * the review lens on by itself (`compliance` in `.devflow/project.json`, folded
 * into the `COMPLIANCE` field of the settings line). What the machine switch still
 * owns is the RULE — the one artifact Claude Code loads into every prompt — and
 * the stamp on SKILL.md: the machine's frameworks when compliance is on, the
 * neutral zero-framework stamp when it is off. Which references a run loads is
 * decided by the ids its caller passes (D-COMPLIANCE-REPO-LENS), never by which
 * files are present.
 *
 * Applies ADR-013: I/O orchestration in src/targets/; pure helpers in src/core/.
 * Applies PF-009: warn-not-throw for per-item failures.
 * Applies PF-011: temp-sibling+rename for skill dir rewrites.
 * Applies PF-015: both artifacts converge unconditionally (no || short-circuits).
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { skillsDir, rulesDir } from '../../core/assets.js';
import { ALWAYS_PRESENT_REFS, COMPLIANCE_FRAMEWORKS, normalizeFrameworks, type ComplianceFeatureState } from '../../core/compliance.js';
import { parseComplianceFragment, composeComplianceSkill, composeComplianceRule, type ComplianceFragment } from '../../core/compliance-compose.js';
import { validateSkillShadow, validateRuleShadow } from './installer.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConvergeComplianceArtifactsOptions {
  /** Path to the Claude config dir (e.g. ~/.claude). */
  claudeDir: string;
  /** Path to the devflow config dir (e.g. ~/.devflow). */
  devflowDir: string;
  enabled: boolean;
  /**
   * Framework IDs. NOT trusted — `convergeComplianceArtifacts` re-validates them
   * against the registry before any of them becomes an fs path segment or is
   * written into an installed artifact. Callers that read the manifest
   * (`devflow init`, `devflow rules --enable`, `devflow compliance --enable`)
   * pass through `normalizeComplianceFeature`, which type-checks but cannot
   * reject unknown IDs.
   */
  frameworks: string[];
  rulesEnabled: boolean;
  warn: (msg: string) => void;
}

export interface ConvergeComplianceArtifactsResult {
  /**
   * True when a pre-existing compliance rule was found and removed during a
   * disable convergence. The skill is not part of this signal: it is installed on
   * every machine (D-COMPLIANCE-INSTALL-ALWAYS), so its presence says nothing about
   * a prior selection. Init uses this to print a legacy plugin-form upgrade notice
   * ("Compliance is now a built-in feature — re-enable with
   * `devflow compliance --enable`").
   */
  removedPreexisting: boolean;
  /**
   * True when every artifact operation attempted in this convergence run completed
   * without error. False when any warn path was taken (skill install failed,
   * rule install failed, artifact removal failed, or claudeDir is not absolute).
   *
   * PF-015: converge is warn-not-throw, so callers cannot detect partial failure
   * via a catch block. This field makes the outcome truthful: callers can surface
   * whether the install fully succeeded rather than assuming `true` after a non-throwing
   * return.
   */
  converged: boolean;
}

// ── Path helpers ───────────────────────────────────────────────────────────

/** Every registry framework id — the reference set every install carries. */
const ALL_FRAMEWORK_IDS: readonly string[] = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);

/** Installed compliance skill dir: {claudeDir}/skills/devflow:compliance/ */
function skillTarget(claudeDir: string): string {
  return path.join(claudeDir, 'skills', 'devflow:compliance');
}

/** Installed compliance rule file: {claudeDir}/rules/devflow/compliance.md */
function ruleTarget(claudeDir: string): string {
  return path.join(claudeDir, 'rules', 'devflow', 'compliance.md');
}

/** Returns true if the path exists (file or directory), false if ENOENT. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Fragment loader ────────────────────────────────────────────────────────

/**
 * Load and parse per-framework fragment files from the canonical source.
 *
 * Fragments always come from the canonical source (not user-overridable) — they carry
 * registry-owned content (mapping cells, reference blurbs, checklist items, rule bullets).
 *
 * PF-009: parse errors and unreadable files are reported via warn; the framework is
 * silently omitted from the result map (C5 in composeComplianceSkill handles the gap).
 */
async function loadComplianceFragments(
  canonicalSrc: string,
  frameworks: readonly string[],
  warn: (msg: string) => void,
): Promise<ReadonlyMap<string, ComplianceFragment>> {
  const map = new Map<string, ComplianceFragment>();
  // C7: loop bounded by frameworks array (already registry-validated by caller)
  for (const fw of frameworks) {
    const fragPath = path.join(canonicalSrc, 'frameworks', fw, 'fragment.md');
    try {
      const raw = await fs.readFile(fragPath, 'utf-8');
      const result = parseComplianceFragment(fw, raw);
      if (result.ok) {
        map.set(fw, result.value);
      } else {
        warn(`compliance: fragment "${fw}" parse error — ${result.error}`);
      }
    } catch (err) {
      warn(`compliance: fragment "${fw}" unreadable — ${String(err)}`);
    }
  }
  return map;
}

// ── Skill installer ────────────────────────────────────────────────────────

/**
 * Install the compliance skill directory (every reference).
 *
 * SKILL.md source: shadow at {devflowDir}/skills/compliance/SKILL.md (when valid),
 * otherwise canonical src/assets/skills/compliance/SKILL.md. It is composed with
 * `stampFrameworks` — the machine's selection, or none for the neutral stamp.
 *
 * Reference files installed: ALWAYS_PRESENT_REFS + one {id}.md for EVERY registry
 * framework (D-COMPLIANCE-INSTALL-ALWAYS). References always come from the canonical
 * source — framework refs are not user-overridable.
 *
 * `fragments` is loaded once by convergeComplianceArtifacts and shared with the rule
 * installer — the SKILL.md and the rule compose from the same parsed set.
 *
 * Applies PF-011: build under a .tmp sibling, remove old target, rename.
 * Applies PF-009: unexpected I/O failures are reported via warn; never thrown.
 */
async function installSkillDir(
  claudeDir: string,
  devflowDir: string,
  stampFrameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
  warn: (msg: string) => void,
): Promise<void> {
  const canonicalSrc = path.join(skillsDir(), 'compliance');
  const target = skillTarget(claudeDir);
  const tmpTarget = `${target}.tmp`;

  // Determine SKILL.md source: prefer a valid shadow, else use canonical.
  const skillShadowDir = path.join(devflowDir, 'skills', 'compliance');
  const shadowState = await validateSkillShadow(skillShadowDir);
  const skillMdSrc =
    shadowState === 'valid'
      ? path.join(skillShadowDir, 'SKILL.md')
      : path.join(canonicalSrc, 'SKILL.md');

  try {
    // Clean up any orphaned tmp from a prior crashed run (best-effort).
    await fs.rm(tmpTarget, { recursive: true, force: true });

    // Build the new directory tree under the tmp sibling (PF-011).
    const refDst = path.join(tmpTarget, 'references');
    await fs.mkdir(refDst, { recursive: true });

    // SKILL.md: compose from template (shadow or canonical) + fragments.
    // C1: a shadow without tokens passes through byte-identical.
    const templateContent = await fs.readFile(skillMdSrc, 'utf-8');
    const { content: composedSkill, warnings: skillWarnings } = composeComplianceSkill(
      templateContent,
      stampFrameworks,
      fragments,
    );
    for (const w of skillWarnings) warn(`compliance: ${w}`);
    await fs.writeFile(path.join(tmpTarget, 'SKILL.md'), composedSkill, 'utf-8');

    // Always-present reference files (detection.md, sources.md) from the canonical
    // references/ directory — these are not framework-specific.
    //
    // PF-009: each copy is isolated. A skill dir missing one reference still works;
    // aborting the whole install because one file is unreadable would take out
    // SKILL.md too. Failures warn and the remaining refs still install.
    const alwaysPresentSrc = path.join(canonicalSrc, 'references');
    for (const ref of ALWAYS_PRESENT_REFS) {
      try {
        await fs.copyFile(path.join(alwaysPresentSrc, ref), path.join(refDst, ref));
      } catch (err) {
        warn(`compliance: reference "${ref}" not installed — ${String(err)}`);
      }
    }

    // Per-framework reference files: source is frameworks/{id}/reference.md,
    // destination is references/{id}.md (installed artifact layout unchanged — C1
    // for consumers). Every registry id, whatever the machine selected: a repository
    // may declare any of them. The ids come from the static registry — no separator,
    // no traversal. C7: bounded by the registry's six entries.
    for (const fw of ALL_FRAMEWORK_IDS) {
      const srcRef = path.join(canonicalSrc, 'frameworks', fw, 'reference.md');
      const dstRef = path.join(refDst, `${fw}.md`);
      try {
        await fs.copyFile(srcRef, dstRef);
      } catch (err) {
        warn(`compliance: reference "${fw}.md" not installed — ${String(err)}`);
      }
    }

    // Atomically swap: remove old target, rename tmp into place.
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(tmpTarget, target);
  } catch (err) {
    // Clean up tmp on failure (best-effort) so no orphan is left behind.
    await fs.rm(tmpTarget, { recursive: true, force: true }).catch(() => undefined);
    warn(`compliance: skill install failed — ${String(err)}`);
  }
}

// ── Rule installer ─────────────────────────────────────────────────────────

/**
 * Install the compliance rule file, composed with per-framework bullets and stamped
 * with the active frameworks.
 *
 * Rule source: shadow at {devflowDir}/rules/compliance.md (when valid),
 * otherwise canonical src/assets/rules/compliance.md.
 *
 * composeComplianceRule() replaces ${DEVFLOW_COMPLIANCE_RULE_BULLETS} with per-framework
 * rule bullets and delegates ${DEVFLOW_COMPLIANCE_FRAMEWORKS} to stampComplianceRule
 * (AC-35, AC-36). C1: a shadow without tokens passes through byte-identical.
 *
 * `fragments` is loaded once by convergeComplianceArtifacts from the canonical skill
 * source (never the shadow — fragments are registry-owned) and shared with the skill
 * installer.
 *
 * Applies PF-009: I/O failures are reported via warn; never thrown.
 */
async function installRuleFile(
  claudeDir: string,
  devflowDir: string,
  frameworks: readonly string[],
  fragments: ReadonlyMap<string, ComplianceFragment>,
  warn: (msg: string) => void,
): Promise<void> {
  const ruleShadowFile = path.join(devflowDir, 'rules', 'compliance.md');
  const canonicalRuleSrc = path.join(rulesDir(), 'compliance.md');
  const target = ruleTarget(claudeDir);

  try {
    const shadowState = await validateRuleShadow(ruleShadowFile);
    const sourcePath = shadowState === 'valid' ? ruleShadowFile : canonicalRuleSrc;

    const templateContent = await fs.readFile(sourcePath, 'utf-8');

    const { content: composed, warnings } = composeComplianceRule(templateContent, frameworks, fragments);
    for (const w of warnings) warn(`compliance: ${w}`);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, composed, 'utf-8');
  } catch (err) {
    warn(`compliance: rule install failed — ${String(err)}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Converge compliance artifacts in the Claude Code install target.
 *
 * Convergence matrix (D-COMPLIANCE-INSTALL-ALWAYS):
 *   enabled + rulesEnabled  → skill dir (every ref, machine stamp) + stamped rule
 *   enabled + !rulesEnabled → skill dir (every ref, machine stamp); remove stale rule
 *   !enabled                → skill dir (every ref, neutral stamp); remove rule
 *
 * PF-015: both artifact operations execute unconditionally — no || short-circuits.
 * PF-011: skill dir write uses temp-sibling+rename to avoid ENOENT windows.
 *
 * D: the `warn` callback is injected (not console.warn) so callers control
 * surfacing (init log lines, test spies, etc.) — per the dependency-injection
 * principle in engineering.md.
 */
export async function convergeComplianceArtifacts(
  opts: ConvergeComplianceArtifactsOptions,
): Promise<ConvergeComplianceArtifactsResult> {
  const { claudeDir, devflowDir, enabled, frameworks, rulesEnabled, warn } = opts;

  // S78: claudeDir precondition — reliability rule: assert invariants in production code.
  // An empty or relative claudeDir would make skillTarget/ruleTarget resolve to unexpected
  // locations. Warn and bail rather than running fs.rm with a potentially wrong path.
  if (!path.isAbsolute(claudeDir)) {
    warn(`compliance: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return { removedPreexisting: false, converged: false };
  }

  // Trust boundary. `frameworks` reaches here straight from the manifest on every
  // caller's bare --enable path, and normalizeComplianceFeature only type-checks it.
  // Filtering to registry IDs here — before any path.join or stamp — is what makes
  // AC-35/AC-36 true for ALL callers rather than only the ones that happened to run
  // parseFrameworkList. Unknown IDs are dropped, never turned into a path segment.
  const safeFrameworks = normalizeFrameworks(frameworks);

  // I13: Track whether every artifact operation in this run completed without error.
  // `converged` starts true and is set false by the tracking wrapper whenever any warn
  // path is taken — including inside installSkillDir / installRuleFile (PF-009 paths).
  let converged = true;
  const trackingWarn = (msg: string): void => {
    converged = false;
    warn(msg);
  };

  // Fragments are read and parsed once per convergence and shared by both artifacts:
  // they are the same registry-owned files either way, so parsing twice would only
  // duplicate the I/O and report each malformed fragment twice. Only the stamped
  // frameworks need one — a compliance-off machine stamps none.
  const stampFrameworks = enabled ? safeFrameworks : [];
  const fragments = await loadComplianceFragments(
    path.join(skillsDir(), 'compliance'),
    stampFrameworks,
    trackingWarn,
  );

  // PF-015: the skill and the rule are independent operations. An error in
  // installSkillDir is caught internally and reported via trackingWarn, so
  // execution always continues to the rule step.
  await installSkillDir(claudeDir, devflowDir, stampFrameworks, fragments, trackingWarn);

  if (enabled && rulesEnabled) {
    await installRuleFile(claudeDir, devflowDir, safeFrameworks, fragments, trackingWarn);
    return { removedPreexisting: false, converged };
  }

  // Compliance off, or rules off: no rule. Probe first so a disable convergence
  // can report that it removed one; absence is already the desired end state.
  const ruleExisted = await pathExists(ruleTarget(claudeDir));
  if (ruleExisted) {
    try {
      await fs.rm(ruleTarget(claudeDir), { force: true });
    } catch (err) {
      trackingWarn(`compliance: failed to remove rule — ${String(err)}`);
    }
  }
  return { removedPreexisting: !enabled && ruleExisted, converged };
}

// ── Manifest-slice wrapper ─────────────────────────────────────────────────

/**
 * Thin wrapper around convergeComplianceArtifacts that extracts options from a
 * manifest slice in one place, eliminating the repeated hand-assembly at each
 * call site (init.ts, rules.ts, compliance.ts).
 *
 * @param opts.manifest - Structural type carrying only the compliance and rules
 *   feature fields. Callers that have computed their own compliance state
 *   (e.g. init.ts resolving prompt results) construct a synthetic slice;
 *   callers with a live ManifestData can pass it directly.
 * @param opts.rulesEnabledOverride - When provided, replaces
 *   manifest.features.rules as the rulesEnabled source. Used by rules.ts where
 *   rulesEnabled reflects the actual install outcome (!installFailed) rather
 *   than the value stored in the manifest.
 */
export async function convergeFromManifest(opts: {
  claudeDir: string;
  devflowDir: string;
  manifest: { features: { compliance: ComplianceFeatureState; rules: boolean } };
  warn: (msg: string) => void;
  rulesEnabledOverride?: boolean;
}): Promise<ConvergeComplianceArtifactsResult> {
  const { claudeDir, devflowDir, manifest, warn, rulesEnabledOverride } = opts;
  return convergeComplianceArtifacts({
    claudeDir,
    devflowDir,
    enabled: manifest.features.compliance.enabled,
    frameworks: manifest.features.compliance.frameworks,
    rulesEnabled: rulesEnabledOverride ?? manifest.features.rules,
    warn,
  });
}
