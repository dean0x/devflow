/**
 * Behavior rule installer for the Claude Code target.
 *
 * Convergence function: installs `rules/devflow/behavior.md` when the machine switch is
 * on AND the install includes rules, and removes it in every other state.
 *
 * D-BEHAVIOR-OPT-IN: the behavior rule is feature-owned and OPT-IN. No plugin declares
 * it (FEATURE_OWNED_RULES in src/core/plugins.ts), so the plugin installer never copies
 * it; this module is its only writer. The file exists exactly when
 * `features.behavior && features.rules`, and the same function serves every caller that
 * can change either input: `devflow init`, `devflow behavior --enable/--disable` and
 * `devflow rules --enable`. A full install wipes `rules/devflow/` first, and a full
 * uninstall removes the directory, so neither needs a rule of its own.
 *
 * The copy goes through installRuleFile, so a shadow at ~/.devflow/rules/behavior.md
 * overrides the shipped text the way it does for every other rule. The shadow only
 * changes WHAT is installed; the switch still decides WHETHER.
 *
 * I/O orchestration in src/targets/; warn-not-throw for per-item failures, with the
 * `warn` callback injected so callers choose how a warning surfaces.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { installRuleFile } from './installer.js';
import { newLinkReport, refuseUnrealFolder, warnLinkReport } from './linked-folder.js';

// ── Types ──────────────────────────────────────────────────────────────────

export const BEHAVIOR_RULE_NAME = 'behavior';

export interface ConvergeBehaviorRuleOptions {
  /** Path to the Claude config dir (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** Path to the devflow config dir (e.g. ~/.devflow). */
  devflowDir: string;
  /** The machine switch, `features.behavior`. */
  enabled: boolean;
  /** Whether the install includes rules, `features.rules`. */
  rulesEnabled: boolean;
  warn: (msg: string) => void;
}

export interface ConvergeBehaviorRuleResult {
  /** True when the rule file is in place after this run. */
  installed: boolean;
  /** True when a rule file existed and this run removed it. */
  removed: boolean;
  /**
   * True when every operation attempted in this run completed without a warning.
   * Converge is warn-not-throw, so this is how a caller learns of a partial failure.
   */
  converged: boolean;
  /** The rule file, if it was a link, now a real file. What it pointed to was left as it was. */
  replacedLinks: readonly string[];
  /** `rules/devflow` or the rule file, if a link or not a folder stands there: nothing was written or removed. */
  refusedFolders: readonly string[];
}

// ── Path helpers ───────────────────────────────────────────────────────────

/** Installed behavior rule file: {claudeDir}/rules/devflow/behavior.md */
export function behaviorRulePath(claudeDir: string): string {
  return path.join(claudeDir, 'rules', 'devflow', `${BEHAVIOR_RULE_NAME}.md`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Converge the behavior rule in the Claude Code install target.
 *
 * Convergence matrix:
 *   enabled + rulesEnabled   → rule file installed (shipped text, or a valid shadow)
 *   enabled + !rulesEnabled  → rule file removed
 *   !enabled                 → rule file removed
 *
 * `rules/devflow` that is a link, or not a folder, is refused: the rule is neither written nor
 * removed there, and the folder is named in `refusedFolders` and in a warning. A rule file that is a
 * link is replaced by a real file, or unlinked on removal, and never written through.
 *
 * Never throws. A relative `claudeDir` is refused with a warning rather than resolved
 * against the working directory, because the removal arm deletes a path.
 */
export async function convergeBehaviorRule(
  opts: ConvergeBehaviorRuleOptions,
): Promise<ConvergeBehaviorRuleResult> {
  const { claudeDir, devflowDir, enabled, rulesEnabled, warn } = opts;

  const links = newLinkReport();
  const finish = (state: Pick<ConvergeBehaviorRuleResult, 'installed' | 'removed' | 'converged'>): ConvergeBehaviorRuleResult => {
    warnLinkReport(links, warn);
    return { ...state, replacedLinks: links.replacedLinks, refusedFolders: links.refusedFolders };
  };

  if (!path.isAbsolute(claudeDir)) {
    warn(`behavior: claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return finish({ installed: false, removed: false, converged: false });
  }

  const target = behaviorRulePath(claudeDir);

  // A link at the folder sends the write and the removal into another place, so the folder is proven first.
  if (await refuseUnrealFolder(links, path.dirname(target))) {
    return finish({ installed: await pathExists(target), removed: false, converged: false });
  }

  if (enabled && rulesEnabled) {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const outcome = await installRuleFile(BEHAVIOR_RULE_NAME, devflowDir, path.dirname(target), links);
      if (outcome === 'skipped') {
        warn('behavior: rule install failed — the file could not be copied');
        return finish({ installed: false, removed: false, converged: false });
      }
      if (outcome === 'source-invalid-shadow:empty-shadow-file' || outcome === 'source-invalid-shadow:not-a-file') {
        warn("behavior: the shadow is invalid — Devflow's version was installed");
        return finish({ installed: true, removed: false, converged: false });
      }
      return finish({ installed: true, removed: false, converged: true });
    } catch (err) {
      warn(`behavior: rule install failed — ${String(err)}`);
      return finish({ installed: false, removed: false, converged: false });
    }
  }

  // Off, or rules off: no rule. Probe first so the caller can report a removal;
  // absence is already the desired end state.
  if (!(await pathExists(target))) return finish({ installed: false, removed: false, converged: true });
  try {
    await fs.rm(target, { force: true });
    return finish({ installed: false, removed: true, converged: true });
  } catch (err) {
    warn(`behavior: failed to remove rule — ${String(err)}`);
    return finish({ installed: true, removed: false, converged: false });
  }
}

// ── Manifest-slice wrapper ─────────────────────────────────────────────────

/**
 * Thin wrapper around convergeBehaviorRule that takes its inputs from a manifest slice
 * in one place, so the call sites (init.ts, rules.ts, behavior.ts) do not each hand-assemble them.
 *
 * @param opts.rulesEnabledOverride - When provided, replaces manifest.features.rules as
 *   the rulesEnabled source. Used by rules.ts, where rulesEnabled reflects the actual
 *   install outcome rather than the value stored in the manifest.
 */
export async function convergeBehaviorFromManifest(opts: {
  claudeDir: string;
  devflowDir: string;
  manifest: { features: { behavior: boolean; rules: boolean } };
  warn: (msg: string) => void;
  rulesEnabledOverride?: boolean;
}): Promise<ConvergeBehaviorRuleResult> {
  const { claudeDir, devflowDir, manifest, warn, rulesEnabledOverride } = opts;
  return convergeBehaviorRule({
    claudeDir,
    devflowDir,
    enabled: manifest.features.behavior,
    rulesEnabled: rulesEnabledOverride ?? manifest.features.rules,
    warn,
  });
}
