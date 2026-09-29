/**
 * devflow compliance — Enable, disable, set, and check status of the compliance feature.
 *
 * Applies ADR-013: CLI-layer module; pure helpers in src/core/compliance.ts,
 *   I/O orchestration in src/targets/claude-code/compliance-install.ts.
 * Applies ADR-001: compliance is manifest-group (like proxy), not config.json-gated.
 * Avoids PF-009: per-artifact failures are warn-not-throw.
 * Avoids PF-015: enable/disable each converge BOTH artifacts unconditionally.
 * The evidence-policy lines (--status, and the --enable/--set suggestion) come
 *   from src/core/evidence-policy.ts, the seam onto the package's own resolvers;
 *   the CLI prints .devflow/project.json and never writes it (applies ADR-024).
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

import {
  COMPLIANCE_FRAMEWORKS,
  normalizeFrameworks,
  parseFrameworkList,
  type ComplianceFeatureState,
} from '../../core/compliance.js';
import { frameworkChoices, FRAMEWORK_SELECT_MESSAGE } from './compliance-prompts.js';
import { COMPLIANCE_SKILL_TOKENS } from '../../core/compliance-compose.js';
import {
  evidencePolicyStatusLine,
  evidencePolicySuggestion,
  formatEvidencePolicyUnavailable,
  loadEvidencePolicyModule,
  loadSettingsModule,
  repoComplianceStatusLines,
} from '../../core/evidence-policy.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { convergeFromManifest } from '../../targets/claude-code/compliance-install.js';
import { validateRuleShadow, validateSkillShadow } from '../../targets/claude-code/installer.js';
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
  nextState: ComplianceFeatureState;
  messages: ComplianceCliActionMessage[];
}

// ── Pure resolver ──────────────────────────────────────────────────────────────

/**
 * Pure resolver: maps (currentState × action) → (nextState, messages).
 *
 * D: Pure function — no I/O, fully testable without filesystem access.
 *   The I/O layer (convergeComplianceArtifacts call, manifest write) is
 *   always the caller's responsibility.
 *   Messages for `enable` include framework IDs drawn from `current.frameworks`
 *   as stored in the manifest, which may contain IDs not validated through
 *   `parseFrameworkList` (e.g. if the manifest was hand-edited). The `set` case
 *   receives `setFrameworks` which callers must pre-validate via parseFrameworkList.
 *   The `status` action produces no messages. The `disable` action produces no IDs.
 *
 * Semantics:
 *   enable  — restore: enabled:true, keep existing frameworks (bare --enable restores)
 *   disable — keep:   enabled:false, frameworks remembered for re-enable
 *   set     — replace: enabled:true, setFrameworks replaces exactly (zero allowed)
 *   status  — no-op:  returns current unchanged
 */
export function resolveComplianceCliAction(
  current: ComplianceFeatureState,
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
            text: 'Compliance disabled — rule removed, frameworks remembered for re-enable',
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

// ── Manifest classification ────────────────────────────────────────────────────

/**
 * The manifest framework IDs the registry does not know — a hand-edited or
 * newer-devflow manifest. Every install drops them (normalizeFrameworks), so
 * `--status` names them with the one remedy that removes them: `--set`.
 *
 * Installed reference files are no drift signal: every install carries all six
 * (D-COMPLIANCE-INSTALL-ALWAYS), whatever the manifest selects.
 */
export function unknownFrameworkIds(
  manifestFrameworks: readonly string[],
  registryIds: ReadonlySet<string>,
): string[] {
  return manifestFrameworks.filter(id => !registryIds.has(id));
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

/**
 * Returns the shadow state for the compliance skill:
 *   'none'               — no valid shadow present
 *   'shadowed'           — shadow present and contains composition tokens (composed normally)
 *   'composition-skipped'— shadow present but token-free (C1 passthrough, no per-framework sections)
 *
 * D: reported in --status so users know their shadow suppresses dynamic composition.
 */
async function skillShadowState(
  devflowDir: string,
): Promise<'none' | 'shadowed' | 'composition-skipped'> {
  const shadowDir = path.join(devflowDir, 'skills', 'compliance');
  const state = await validateSkillShadow(shadowDir);
  if (state !== 'valid') return 'none';

  try {
    const skillMd = await fs.readFile(path.join(shadowDir, 'SKILL.md'), 'utf-8');
    const hasTokens = COMPLIANCE_SKILL_TOKENS.some(tok => skillMd.includes(tok));
    return hasTokens ? 'shadowed' : 'composition-skipped';
  } catch {
    return 'none';
  }
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
  .option('--disable', 'Disable compliance (rule removed; frameworks remembered for re-enable)')
  .option('--status', 'Show compliance state: manifest, installed artifacts, shadow presence, and the evidence policy for the current repository')
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

      const rulesEnabled = manifest.features.rules;
      const [skillOk, ruleOk, isRuleShadowed, skillShadow] = await Promise.all([
        skillInstalled(claudeDir),
        ruleInstalled(claudeDir),
        ruleShadowed(devflowDir),
        skillShadowState(devflowDir),
      ]);

      const invalidIds = unknownFrameworkIds(
        current.frameworks,
        new Set(COMPLIANCE_FRAMEWORKS.map(fw => fw.id)),
      );

      // The repository's own declaration (.devflow/project.json) and, while the
      // legacy policy file is still there, the hint to migrate it. Both come from
      // the local settings resolver — one git call, no network — and add nothing
      // when the repository declares nothing (the block is then unchanged).
      const repoLines = repoComplianceStatusLines(loadSettingsModule(), { dir: process.cwd() });

      const lines: string[] = [
        `State:      ${enabledLabel}`,
        `Frameworks: ${fwLabel}`,
        ...repoLines,
        '',
        `Skill:      ${skillOk ? color.green('installed') : color.dim('not installed')}` +
          (skillShadow === 'composition-skipped'
            ? color.yellow(' [shadowed, composition skipped — per-framework sections absent]')
            : skillShadow === 'shadowed'
              ? color.green(' [shadowed]')
              : ''),
        `Rule:       ${ruleOk ? color.green('installed') : color.dim('not installed')}` +
          (!ruleOk && current.enabled && !rulesEnabled
            ? color.yellow(' (withheld — rules disabled)')
            : '') +
          (isRuleShadowed ? color.green(' [shadowed]') : ''),
        '',
        // The repository in cwd, resolved by the package's own resolver with the
        // compliance state already read above (D-POLICY-CJS-SEAM). Bounded: at most
        // two `gh` calls, each with a timeout, so offline degrades to a flagged line.
        evidencePolicyStatusLine(loadEvidencePolicyModule(), { dir: process.cwd(), compliance: current }),
      ];

      if (invalidIds.length > 0) {
        lines.push('');
        for (const id of invalidIds) {
          lines.push(color.red(`  unknown framework id in manifest (ignored): ${id} — remove with --set`));
        }
      }

      p.note(lines.join('\n'), 'Compliance Status');
      return;
    }

    // ── Enable / Disable / Set ─────────────────────────────────────────────────

    if (options.enable && options.disable) {
      p.log.error('--enable and --disable are mutually exclusive: specify only one.');
      process.exit(1);
    }

    let action: ComplianceCliAction;
    if (options.set !== undefined) {
      action = 'set';
    } else if (options.enable) {
      // TTY: prompt for frameworks if no --set provided
      if (process.stdin.isTTY && current.frameworks.length === 0) {
        // Multiselect for frameworks when enabling interactively and no prior selection
        p.note(
          COMPLIANCE_FRAMEWORKS.map(fw => `${color.cyan(fw.id)} — ${fw.hint}`).join('\n'),
          'Available Frameworks',
        );
        const selected = await p.multiselect({
          message: FRAMEWORK_SELECT_MESSAGE,
          options: frameworkChoices(),
          initialValues: current.frameworks,
          required: false,
        });
        if (p.isCancel(selected)) {
          p.cancel('Cancelled');
          return;
        }
        setFrameworks = selected;
        action = 'set';
      } else {
        action = 'enable';
      }
    } else {
      action = 'disable';
    }

    const resolved = resolveComplianceCliAction(current, action, setFrameworks);

    // Converge artifacts (PF-015: always converge, never short-circuit)
    await convergeFromManifest({
      claudeDir,
      devflowDir,
      manifest: { features: { compliance: resolved.nextState, rules: manifest.features.rules } },
      warn: (msg) => p.log.warn(msg),
    });

    // Persist to manifest — normalizeFrameworks deduplicates (e.g. --set gdpr,GDPR → [gdpr])
    manifest.features.compliance = {
      enabled: resolved.nextState.enabled,
      frameworks: normalizeFrameworks(resolved.nextState.frameworks),
    };
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

    // Suggest the team file compliance now implies. Printed, never written:
    // .devflow/project.json is team-owned (D-POLICY-NO-WRITE, applies ADR-024).
    if (resolved.nextState.enabled) {
      const policyModule = loadEvidencePolicyModule();
      const settingsModule = loadSettingsModule();
      if (!policyModule.ok) {
        p.log.warn(formatEvidencePolicyUnavailable(policyModule.error));
      } else if (!settingsModule.ok) {
        p.log.warn(formatEvidencePolicyUnavailable(settingsModule.error));
      } else {
        const suggestion = evidencePolicySuggestion(resolved.nextState, policyModule.value, settingsModule.value);
        if (suggestion !== null) p.note(suggestion, 'Evidence policy');
      }
    }
  });
