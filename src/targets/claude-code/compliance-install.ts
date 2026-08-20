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
import { stampComplianceRule } from '../../core/compliance.js';
import { validateSkillShadow, validateRuleShadow } from './installer.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConvergeComplianceArtifactsOptions {
  /** Path to the Claude config dir (e.g. ~/.claude). */
  claudeDir: string;
  /** Path to the devflow config dir (e.g. ~/.devflow). */
  devflowDir: string;
  enabled: boolean;
  /** Validated framework IDs from parseFrameworkList. */
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

    // Always-present references from the canonical source
    const refSrc = path.join(canonicalSrc, 'references');
    for (const ref of ALWAYS_PRESENT_REFS) {
      await fs.copyFile(path.join(refSrc, ref), path.join(refDst, ref));
    }

    // Selected framework references from the canonical source
    for (const fw of frameworks) {
      const ref = `${fw}.md`;
      await fs.copyFile(path.join(refSrc, ref), path.join(refDst, ref));
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
      warn(`compliance: failed to remove skill dir — ${skillErr}`);
    }
    if (ruleErr !== null) {
      warn(`compliance: failed to remove rule — ${ruleErr}`);
    }

    return { removedPreexisting: skillExisted || ruleExisted };
  }

  // ── Enable path ──────────────────────────────────────────────────────────
  //
  // PF-015: installSkillDir and the rule step are independent operations.
  // An error in installSkillDir is caught internally and reported via warn,
  // so execution always continues to the rule step.

  await installSkillDir(claudeDir, devflowDir, frameworks, warn);

  if (rulesEnabled) {
    await installRuleFile(claudeDir, devflowDir, frameworks, warn);
  } else {
    // Rules disabled: remove any stale rule left from a prior enabled run.
    // Ignore ENOENT (force: true) — absence is the desired end state.
    try {
      await fs.rm(ruleTarget(claudeDir), { force: true });
    } catch { /* absent = already in desired end state */ }
  }

  return { removedPreexisting: false };
}
