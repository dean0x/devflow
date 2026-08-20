/**
 * Compliance artifact installer for the Claude Code target.
 *
 * Convergence function: installs or removes the compliance skill directory
 * and rule file based on the current feature state.
 *
 * Applies ADR-013: I/O orchestration in src/targets/; pure helpers in src/core/.
 * Applies PF-009: warn-not-throw for per-item failures.
 * Applies PF-011: temp-sibling+rename for skill dir rewrites.
 * Applies PF-015: both artifacts converge unconditionally (no || short-circuits).
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { skillsDir, rulesDir } from '../../core/assets.js';
import { normalizeFrameworks, stampComplianceRule, type ComplianceFeatureState } from '../../core/compliance.js';
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
   * True when pre-existing compliance artifacts were found and removed during a
   * disable convergence. Init can use this to print a legacy plugin-form upgrade
   * notice ("Compliance is now a built-in feature — re-enable with
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

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Reference files always included regardless of the framework selection.
 * detection.md — generic detection heuristics
 * sources.md   — authoritative source index
 */
const ALWAYS_PRESENT_REFS: readonly string[] = ['detection.md', 'sources.md'];

// ── Path helpers ───────────────────────────────────────────────────────────

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

// ── Skill installer ────────────────────────────────────────────────────────

/**
 * Install the compliance skill directory (selective references).
 *
 * SKILL.md source: shadow at {devflowDir}/skills/compliance/SKILL.md (when valid),
 * otherwise canonical src/assets/skills/compliance/SKILL.md.
 *
 * Reference files installed: ALWAYS_PRESENT_REFS + one {id}.md per selected framework.
 * References always come from the canonical source — framework refs are not user-overridable.
 *
 * Applies PF-011: build under a .tmp sibling, remove old target, rename.
 * Applies PF-009: unexpected I/O failures are reported via warn; never thrown.
 */
async function installSkillDir(
  claudeDir: string,
  devflowDir: string,
  frameworks: readonly string[],
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

    // SKILL.md (shadow or canonical)
    await fs.copyFile(skillMdSrc, path.join(tmpTarget, 'SKILL.md'));

    // Reference files from the canonical source. Every ID here is a registry ID
    // (convergeComplianceArtifacts filtered them), so each is a bare basename —
    // no separator, no traversal — and resolves inside refDst.
    //
    // PF-009: each copy is isolated. A skill dir missing one reference still works;
    // aborting the whole install because one reference file is unreadable would
    // take out SKILL.md too. Failures warn and the remaining refs still install.
    const refSrc = path.join(canonicalSrc, 'references');
    for (const ref of [...ALWAYS_PRESENT_REFS, ...frameworks.map(fw => `${fw}.md`)]) {
      try {
        await fs.copyFile(path.join(refSrc, ref), path.join(refDst, ref));
      } catch (err) {
        warn(`compliance: reference "${ref}" not installed — ${String(err)}`);
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
 * Install the compliance rule file, stamped with the active frameworks.
 *
 * Rule source: shadow at {devflowDir}/rules/compliance.md (when valid),
 * otherwise canonical src/assets/rules/compliance.md.
 *
 * stampComplianceRule() replaces the ${DEVFLOW_COMPLIANCE_FRAMEWORKS} placeholder
 * with the static labels of the selected frameworks (AC-35, AC-36).
 *
 * Applies PF-009: I/O failures are reported via warn; never thrown.
 */
async function installRuleFile(
  claudeDir: string,
  devflowDir: string,
  frameworks: readonly string[],
  warn: (msg: string) => void,
): Promise<void> {
  const ruleShadowFile = path.join(devflowDir, 'rules', 'compliance.md');
  const canonicalSrc = path.join(rulesDir(), 'compliance.md');
  const target = ruleTarget(claudeDir);

  try {
    const shadowState = await validateRuleShadow(ruleShadowFile);
    const sourcePath = shadowState === 'valid' ? ruleShadowFile : canonicalSrc;

    const content = await fs.readFile(sourcePath, 'utf-8');
    const stamped = stampComplianceRule(content, frameworks);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, stamped, 'utf-8');
  } catch (err) {
    warn(`compliance: rule install failed — ${String(err)}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Converge compliance artifacts in the Claude Code install target.
 *
 * Convergence matrix:
 *   enabled + rulesEnabled  → install skill dir (selective refs) + stamped rule
 *   enabled + !rulesEnabled → install skill dir only; remove stale rule
 *   !enabled                → remove both artifacts (warn-not-throw per PF-009)
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

  // ── Disable path ─────────────────────────────────────────────────────────
  if (!enabled) {
    // Detect pre-existing artifacts BEFORE removal (to set removedPreexisting).
    const skillExisted = await pathExists(skillTarget(claudeDir));
    const ruleExisted = await pathExists(ruleTarget(claudeDir));

    // PF-015: collect results independently — one failure must not skip the other.
    let skillErr: string | null = null;
    let ruleErr: string | null = null;

    // Step 1: attempt skill dir removal
    try {
      if (skillExisted) {
        await fs.rm(skillTarget(claudeDir), { recursive: true, force: true });
      }
    } catch (err) {
      skillErr = String(err);
    }

    // Step 2: attempt rule removal (runs regardless of Step 1 outcome — PF-015)
    try {
      if (ruleExisted) {
        await fs.rm(ruleTarget(claudeDir), { force: true });
      }
    } catch (err) {
      ruleErr = String(err);
    }

    // PF-009: warn after BOTH attempts so neither failure blocks the other.
    if (skillErr !== null) {
      trackingWarn(`compliance: failed to remove skill dir — ${skillErr}`);
    }
    if (ruleErr !== null) {
      trackingWarn(`compliance: failed to remove rule — ${ruleErr}`);
    }

    return { removedPreexisting: skillExisted || ruleExisted, converged };
  }

  // ── Enable path ──────────────────────────────────────────────────────────
  //
  // PF-015: installSkillDir and the rule step are independent operations.
  // An error in installSkillDir is caught internally and reported via trackingWarn,
  // so execution always continues to the rule step.

  await installSkillDir(claudeDir, devflowDir, safeFrameworks, trackingWarn);

  if (rulesEnabled) {
    await installRuleFile(claudeDir, devflowDir, safeFrameworks, trackingWarn);
  } else {
    // Rules disabled: remove any stale rule left from a prior enabled run.
    // Ignore ENOENT (force: true) — absence is the desired end state.
    try {
      await fs.rm(ruleTarget(claudeDir), { force: true });
    } catch { /* absent = already in desired end state */ }
  }

  return { removedPreexisting: false, converged };
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
