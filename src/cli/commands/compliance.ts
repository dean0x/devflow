/**
 * devflow compliance — Enable, disable, set, and check status of the compliance feature.
 *
 * Applies ADR-013: CLI-layer module; pure helpers in src/core/compliance.ts,
 *   I/O orchestration in src/targets/claude-code/compliance-install.ts.
 * Applies ADR-001: compliance is manifest-group (like proxy), not config.json-gated.
 * Avoids PF-009: per-artifact failures are warn-not-throw.
 * Avoids PF-015: enable/disable each converge BOTH artifacts unconditionally.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

import {
  COMPLIANCE_FRAMEWORKS,
  parseFrameworkList,
} from '../../core/compliance.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { convergeComplianceArtifacts } from '../../targets/claude-code/compliance-install.js';
import { validateRuleShadow } from '../../targets/claude-code/installer.js';
import {
  getClaudeDirectory,
  getDevFlowDirectory,
} from '../../targets/claude-code/claude-paths.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ComplianceCliAction = 'enable' | 'disable' | 'set' | 'status';

export interface ComplianceCliActionMessage {
  level: 'info' | 'success' | 'warn';
  text: string;
}

export interface ComplianceCliActionResult {
  nextState: { enabled: boolean; frameworks: string[] };
  messages: ComplianceCliActionMessage[];
}

// ── Pure resolver ──────────────────────────────────────────────────────────────

/**
 * Pure resolver: maps (currentState × action) → (nextState, messages).
 *
 * D: Pure function — no I/O, fully testable without filesystem access.
 *   The I/O layer (convergeComplianceArtifacts call, manifest write) is
 *   always the caller's responsibility.
 *
 * Semantics:
 *   enable  — restore: enabled:true, keep existing frameworks (bare --enable restores)
 *   disable — keep:   enabled:false, frameworks remembered for re-enable
 *   set     — replace: enabled:true, setFrameworks replaces exactly (zero allowed)
 *   status  — no-op:  returns current unchanged
 */
export function resolveComplianceCliAction(
  current: { enabled: boolean; frameworks: string[] },
  action: ComplianceCliAction,
  setFrameworks?: string[],
): ComplianceCliActionResult {
  switch (action) {
    case 'enable': {
      if (current.enabled) {
        return {
          nextState: current,
          messages: [{ level: 'info', text: 'Compliance already enabled' }],
        };
      }
      const fwLabel = current.frameworks.length > 0
        ? current.frameworks.join(', ')
        : 'none (generic controls only)';
      return {
        nextState: { enabled: true, frameworks: current.frameworks },
        messages: [{ level: 'success', text: `Compliance enabled (frameworks: ${fwLabel})` }],
      };
    }

    case 'disable': {
      return {
        nextState: { enabled: false, frameworks: current.frameworks },
        messages: [
          {
            level: 'success',
            text: 'Compliance disabled — artifacts removed, frameworks remembered for re-enable',
          },
        ],
      };
    }

    case 'set': {
      const frameworks = setFrameworks ?? [];
      const fwLabel = frameworks.length > 0
        ? frameworks.join(', ')
        : 'none (generic controls only)';
      return {
        nextState: { enabled: true, frameworks },
        messages: [{ level: 'success', text: `Compliance enabled (frameworks: ${fwLabel})` }],
      };
    }

    case 'status': {
      return {
        nextState: current,
        messages: [],
      };
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return { nextState: current, messages: [] };
    }
  }
}

// ── Status helpers ─────────────────────────────────────────────────────────────

/** Returns true if the compliance skill dir exists at the install target. */
async function skillInstalled(claudeDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(claudeDir, 'skills', 'devflow:compliance'));
    return true;
  } catch {
    return false;
  }
}

/** Returns the set of installed framework reference IDs from the skill dir. */
async function installedRefIds(claudeDir: string): Promise<string[]> {
  const refDir = path.join(claudeDir, 'skills', 'devflow:compliance', 'references');
  try {
    const entries = await fs.readdir(refDir);
    return entries
      .filter(e => e.endsWith('.md') && e !== 'detection.md' && e !== 'sources.md')
      .map(e => path.basename(e, '.md'));
  } catch {
    return [];
  }
}

/** Returns true if the compliance rule file exists at the install target. */
async function ruleInstalled(claudeDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(claudeDir, 'rules', 'devflow', 'compliance.md'));
    return true;
  } catch {
    return false;
  }
}

/** Returns true if a user shadow exists for the compliance rule. */
async function ruleShadowed(devflowDir: string): Promise<boolean> {
  const shadowFile = path.join(devflowDir, 'rules', 'compliance.md');
  const state = await validateRuleShadow(shadowFile);
  return state === 'valid';
}

// ── CLI action ─────────────────────────────────────────────────────────────────

interface ComplianceOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  set?: string;
}

export const complianceCommand = new Command('compliance')
  .description('Enable, disable, or configure the compliance feature')
  .option('--enable', 'Enable compliance (restores previously selected frameworks)')
  .option('--disable', 'Disable compliance (artifacts removed; frameworks remembered for re-enable)')
  .option('--status', 'Show compliance state: manifest, installed artifacts, and shadow presence')
  .option('--set <list>', 'Set active frameworks (comma-separated IDs); enables compliance. Use --set "" for zero frameworks (generic controls only)')
  .action(async (options: ComplianceOptions) => {
    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();

    const hasFlag = options.enable || options.disable || options.status || options.set !== undefined;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' Compliance ')));
      const validIds = COMPLIANCE_FRAMEWORKS.map(fw => `${fw.id} — ${fw.hint}`).join('\n  ');
      p.note(
        `${color.cyan('devflow compliance --enable')}   Enable compliance (restores prior frameworks)\n` +
        `${color.cyan('devflow compliance --disable')}  Disable compliance (frameworks remembered)\n` +
        `${color.cyan('devflow compliance --status')}   Show current state and installed artifacts\n` +
        `${color.cyan('devflow compliance --set <ids>')} Set active frameworks and enable\n\n` +
        `Valid framework IDs:\n  ${validIds}`,
        'Usage',
      );
      p.outro(color.dim('Compliance rules are stamped with the active framework labels'));
      return;
    }

    // Validate --set input before any I/O (parse-don't-validate at boundary)
    let setFrameworks: string[] | undefined;
    if (options.set !== undefined) {
      const parsed = parseFrameworkList(options.set);
      if (!parsed.ok) {
        p.log.error(parsed.error);
        process.exit(1);
      }
      setFrameworks = parsed.value;
    }

    const manifest = await readManifest(devflowDir);
    if (!manifest) {
      p.log.error('No manifest found. Run devflow init first.');
      process.exit(1);
    }

    const current = manifest.features.compliance;

    // ── Status ─────────────────────────────────────────────────────────────────
    if (options.status) {
      const enabledLabel = current.enabled ? color.green('enabled') : color.dim('disabled');
      const fwLabel = current.frameworks.length > 0
        ? current.frameworks.join(', ')
        : color.dim('none declared');

      const [skillOk, refIds, ruleOk, rulesEnabled, isRuleShadowed] = await Promise.all([
        skillInstalled(claudeDir),
        installedRefIds(claudeDir),
        ruleInstalled(claudeDir),
        Promise.resolve(manifest.features.rules),
        ruleShadowed(devflowDir),
      ]);

      // Detect framework drift: manifest says X, installed refs say Y
      const manifestSet = new Set(current.frameworks);
      const installedSet = new Set(refIds);
      const driftInstalled = refIds.filter(id => !manifestSet.has(id));
      const driftMissing = current.frameworks.filter(id => !installedSet.has(id));

      const lines: string[] = [
        `State:      ${enabledLabel}`,
        `Frameworks: ${fwLabel}`,
        '',
        `Skill:      ${skillOk ? color.green('installed') : color.dim('not installed')}`,
        `Rule:       ${ruleOk ? color.green('installed') : color.dim('not installed')}` +
          (!ruleOk && current.enabled && !rulesEnabled
            ? color.yellow(' (withheld — rules disabled)')
            : '') +
          (isRuleShadowed ? color.green(' [shadowed]') : ''),
      ];

      if (driftInstalled.length > 0 || driftMissing.length > 0) {
        lines.push('');
        lines.push(color.yellow('Artifact drift detected (run devflow compliance --enable to reconcile):'));
        if (driftInstalled.length > 0) {
          lines.push(`  Installed not in manifest: ${driftInstalled.join(', ')}`);
        }
        if (driftMissing.length > 0) {
          lines.push(`  In manifest but not installed: ${driftMissing.join(', ')}`);
        }
      }

      p.note(lines.join('\n'), 'Compliance Status');
      return;
    }

    // ── Enable / Disable / Set ─────────────────────────────────────────────────

    let action: ComplianceCliAction;
    if (options.set !== undefined) {
      action = 'set';
    } else if (options.enable) {
      // TTY: prompt for frameworks if no --set provided
      if (process.stdin.isTTY && current.frameworks.length === 0 && !options.disable) {
        // Multiselect for frameworks when enabling interactively and no prior selection
        p.note(
          COMPLIANCE_FRAMEWORKS.map(fw => `${color.cyan(fw.id)} — ${fw.hint}`).join('\n'),
          'Available Frameworks',
        );
        const selected = await p.multiselect({
          message: 'Select compliance frameworks (Enter to skip — generic controls only)',
          options: COMPLIANCE_FRAMEWORKS.map(fw => ({
            value: fw.id,
            label: fw.label,
            hint: fw.hint,
          })),
          initialValues: current.frameworks,
          required: false,
        });
        if (p.isCancel(selected)) {
          p.cancel('Cancelled');
          return;
        }
        setFrameworks = selected as string[];
        action = 'set';
      } else {
        action = 'enable';
      }
    } else {
      action = 'disable';
    }

    const resolved = resolveComplianceCliAction(current, action, setFrameworks);

    // Converge artifacts (PF-015: always converge, never short-circuit)
    await convergeComplianceArtifacts({
      claudeDir,
      devflowDir,
      enabled: resolved.nextState.enabled,
      frameworks: resolved.nextState.frameworks,
      rulesEnabled: manifest.features.rules,
      warn: (msg) => p.log.warn(msg),
    });

    // Persist to manifest
    manifest.features.compliance = resolved.nextState;
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(devflowDir, manifest);

    // Emit messages
    for (const msg of resolved.messages) {
      switch (msg.level) {
        case 'success': p.log.success(msg.text); break;
        case 'warn': p.log.warn(msg.text); break;
        default: p.log.info(msg.text); break;
      }
    }

    if (resolved.nextState.enabled && !manifest.features.rules) {
      p.log.info(
        color.dim('Note: compliance rule withheld (rules disabled) — ' +
          'run `devflow rules --enable` to install the stamped rule'),
      );
    }
  });
