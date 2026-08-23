/**
 * devflow flags — Manage Claude Code feature flags.
 *
 * D-P3-1: Typed flags CLI rewrite (Phase 3).
 *   - createFlagsCommand() factory — fresh Commander instance per call;
 *     used by tests; src/cli.ts consumes the flagsCommand singleton export.
 *   - Persist pipeline: stripFlags → applyFlags(stripped, record) — reuses
 *     core helpers; no hand-rolled env/setting key writes.
 *   - PF-014 (process.exit swallows async work): all error paths set
 *     process.exitCode = 1 and return; never call process.exit().
 *   - PF-015 (multi-artifact fan-out): compute record first; settings write
 *     and manifest write handled independently with their own error paths.
 *   - PF-022 (applies-on-restart): bare non-TTY invocation prints status table
 *     with a note that changes apply on restart.
 *   - PF-023 (validate at the sink): parseFlagValueInput → coerceFlagValue
 *     runs inside the core helpers before any write.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  getClaudeDirectory,
  getDevFlowDirectory,
} from '../../targets/claude-code/claude-paths.js';
import {
  FLAG_REGISTRY,
  applyFlags,
  stripFlags,
  parseFlagValueInput,
  formatFlagValue,
  neutralValueOf,
  type ClaudeCodeFlag,
  type FlagsRecord,
  type FlagsRecordValue,
} from '../../core/flags.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Look up a flag by id; null when unknown. */
function lookupFlag(id: string): ClaudeCodeFlag | null {
  return FLAG_REGISTRY.find(f => f.id === id) ?? null;
}

/**
 * Read and parse settings.json.
 * ENOENT → returns `{ content: '{}', ok: true }`.
 * Malformed JSON → returns `{ ok: false, reason: string }`.
 *
 * NEVER silently falls back to '{}' on malformed JSON — that would clobber the
 * user's settings. The caller must abort with exit code 1 on !ok (avoids PF-023).
 */
async function readSettingsSafe(
  settingsPath: string,
): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, content: '{}' };
    }
    return { ok: false, reason: `Cannot read settings.json: ${(err as Error).message}` };
  }

  try {
    JSON.parse(raw); // validate only
  } catch {
    return { ok: false, reason: 'settings.json is malformed — fix it before changing flags' };
  }
  return { ok: true, content: raw };
}

/**
 * Persist a FlagsRecord to settings.json and manifest.
 *
 * Strip-then-apply (invariant INV-1): stripFlags removes all managed keys
 * then applyFlags re-applies the full record. This keeps settings.json
 * derived unconditionally from the record, with no residual stale keys.
 *
 * PF-015: settings write and manifest write are evaluated independently.
 * Each failure is reported with its own message and exit code 1.
 * The second write is never skipped due to the first succeeding or failing.
 *
 * Returns true on success; sets process.exitCode = 1 and returns false on any
 * failure (avoids PF-014 — never calls process.exit).
 */
async function persistFlagConfig(
  claudeDir: string,
  devflowDir: string,
  settingsContent: string,
  newRecord: FlagsRecord,
): Promise<boolean> {
  // PF-015: compute the final settings content BEFORE any write.
  const stripped = stripFlags(settingsContent);
  const updatedSettings = applyFlags(stripped, newRecord);

  // Settings write — independent error path (avoids PF-015 fan-out).
  const settingsPath = path.join(claudeDir, 'settings.json');
  try {
    await writeFileAtomicExclusive(settingsPath, updatedSettings);
  } catch (err) {
    p.log.error(`Failed to write settings.json: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    // PF-015: still attempt the manifest write — evaluate each artifact independently.
    // (if settings failed but manifest would succeed, we still try manifest so the
    // record is not permanently out of sync)
  }

  // Manifest write — independent error path (avoids PF-015 fan-out).
  const manifest = await readManifest(devflowDir);
  if (manifest) {
    manifest.features.flags = newRecord;
    manifest.updatedAt = new Date().toISOString();
    try {
      await writeManifest(devflowDir, manifest);
    } catch (err) {
      p.log.error(`Failed to write manifest.json: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  return process.exitCode === 0;
}

// ─── Command factory ──────────────────────────────────────────────────────────

/** Accumulator for repeatable --set options. */
function collectSet(val: string, prev: string[]): string[] {
  return prev.concat(val);
}

/**
 * Create a fresh flags Command instance.
 *
 * Call this in tests to get a clean Commander instance per test case — avoids
 * Commander's internal option-value state leaking across tests.
 *
 * Bare invocation (no subcommand):
 *   - TTY: launches the interactive flags TUI (lazy import keeps TTY machinery
 *     out of --list/--status code paths).
 *   - non-TTY: prints status table to stdout + note to stderr + exitCode 1.
 */
export function createFlagsCommand(): Command {
  return new Command('flags')
    .description('Manage Claude Code feature flags')
    .option('--list', 'List all available flags with metadata')
    .option('--status', 'Show current flag states')
    .option('--enable <ids>', 'Enable boolean flag(s), comma-separated')
    .option('--disable <ids>', 'Disable boolean flag(s), comma-separated')
    .option(
      '--set <assignment>',
      'Set flag value (repeatable): id=value. Use "unset" as value to clear.',
      collectSet,
      [] as string[],
    )
    .option('--unset <ids>', 'Reset flag(s) to neutral (comma-separated)')
    .action(async (options: {
      list?: boolean;
      status?: boolean;
      enable?: string;
      disable?: string;
      set?: string[];
      unset?: string;
    }) => {
      const claudeDir = getClaudeDirectory();
      const devflowDir = getDevFlowDirectory();

      // ── --list ───────────────────────────────────────────────────────────────
      // Read-only: no manifest required. Content sourced from registry (PF-017 spirit).
      if (options.list) {
        p.intro(color.bgCyan(color.black(' Claude Code Flags ')));
        for (const flag of FLAG_REGISTRY) {
          const kindLabel = flag.kind === 'boolean'
            ? 'boolean'
            : flag.kind === 'enum'
              ? `enum [${(flag as import('../../core/flags.js').EnumFlagDef).values.join('|')}]`
              : flag.kind === 'number'
                ? (() => {
                    const nf = flag as import('../../core/flags.js').NumberFlagDef;
                    const parts: string[] = [];
                    if (nf.min !== undefined) parts.push(`min=${nf.min}`);
                    if (nf.max !== undefined) parts.push(`max=${nf.max}`);
                    if (nf.integer) parts.push('integer');
                    return `number${parts.length ? ' ' + parts.join(' ') : ''}`;
                  })()
                : (() => {
                    const sf = flag as import('../../core/flags.js').StringFlagDef;
                    return `string${sf.maxLength !== undefined ? ` maxLen=${sf.maxLength}` : ''}`;
                  })();
          const targetInfo = flag.target.type === 'env'
            ? `env ${flag.target.key}`
            : `setting ${flag.target.key}`;
          const defaultLabel = flag.defaultValue !== undefined && flag.defaultValue !== null
            ? String(flag.defaultValue)
            : 'unset';
          const recLabel = flag.recommended ? color.green('recommended') : color.dim('optional');
          p.log.info(
            `${color.bold(flag.id.padEnd(28))} ${recLabel.padEnd(20)} ${color.dim(kindLabel.padEnd(36))} ${color.dim(targetInfo)}`,
          );
          p.log.info(
            `  ${color.dim(flag.hint)} — default: ${color.cyan(defaultLabel)}`,
          );
        }
        return;
      }

      // ── --status ─────────────────────────────────────────────────────────────
      // Degrades gracefully when not installed (no manifest).
      if (options.status) {
        p.intro(color.bgCyan(color.black(' Claude Code Flags — Status ')));
        const manifest = await readManifest(devflowDir);
        if (!manifest) {
          p.log.warn('Devflow is not installed — run devflow init first');
          p.log.info('Showing registry defaults only:');
        }
        const record: FlagsRecord = manifest?.features.flags ?? {};

        for (const flag of FLAG_REGISTRY) {
          const value = Object.prototype.hasOwnProperty.call(record, flag.id)
            ? record[flag.id]
            : undefined;
          const displayValue = value !== undefined
            ? formatFlagValue(flag, value)
            : color.dim(`not adopted — default ${String(flag.defaultValue ?? 'unset')} applies on next devflow init`);
          p.log.info(`${flag.id.padEnd(28)} ${displayValue}`);
        }
        return;
      }

      // ── --enable ids ──────────────────────────────────────────────────────────
      if (options.enable !== undefined) {
        const ids = options.enable.split(',').map(s => s.trim()).filter(Boolean);

        // Validate all ids before any mutation
        for (const id of ids) {
          const flag = lookupFlag(id);
          if (!flag) {
            p.log.error(`Unknown flag: ${color.bold(id)}`);
            p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
            process.exitCode = 1;
            return;
          }
          if (flag.kind !== 'boolean') {
            p.log.error(`${color.bold(id)} is a ${flag.kind} flag — use ${color.bold(`--set ${id}=value`)} to set it`);
            process.exitCode = 1;
            return;
          }
        }

        // Manifest required for mutating ops (avoids settings/manifest desync)
        const manifest = await readManifest(devflowDir);
        if (!manifest) {
          p.log.error('No devflow installation found — run devflow init first');
          process.exitCode = 1;
          return;
        }

        // Read settings — abort on malformed (never silently clobber)
        const settingsPath = path.join(claudeDir, 'settings.json');
        const settingsResult = await readSettingsSafe(settingsPath);
        if (!settingsResult.ok) {
          p.log.error(settingsResult.reason);
          process.exitCode = 1;
          return;
        }

        // PF-015: compute new record before any write
        const newRecord: FlagsRecord = { ...manifest.features.flags };
        for (const id of ids) {
          newRecord[id] = true;
        }

        await persistFlagConfig(claudeDir, devflowDir, settingsResult.content, newRecord);

        if (process.exitCode === 0) {
          for (const id of ids) {
            p.log.success(`${id} enabled`);
          }
        }
        return;
      }

      // ── --disable ids ─────────────────────────────────────────────────────────
      if (options.disable !== undefined) {
        const ids = options.disable.split(',').map(s => s.trim()).filter(Boolean);

        for (const id of ids) {
          const flag = lookupFlag(id);
          if (!flag) {
            p.log.error(`Unknown flag: ${color.bold(id)}`);
            p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
            process.exitCode = 1;
            return;
          }
          if (flag.kind !== 'boolean') {
            p.log.error(`${color.bold(id)} is a ${flag.kind} flag — use ${color.bold(`--unset ${id}`)} to clear it`);
            process.exitCode = 1;
            return;
          }
        }

        const manifest = await readManifest(devflowDir);
        if (!manifest) {
          p.log.error('No devflow installation found — run devflow init first');
          process.exitCode = 1;
          return;
        }

        const settingsPath = path.join(claudeDir, 'settings.json');
        const settingsResult = await readSettingsSafe(settingsPath);
        if (!settingsResult.ok) {
          p.log.error(settingsResult.reason);
          process.exitCode = 1;
          return;
        }

        // PF-015: compute new record before any write
        const newRecord: FlagsRecord = { ...manifest.features.flags };
        for (const id of ids) {
          // false is neutral for booleans — key is deleted by applyFlags
          newRecord[id] = false;
        }

        await persistFlagConfig(claudeDir, devflowDir, settingsResult.content, newRecord);

        if (process.exitCode === 0) {
          for (const id of ids) {
            p.log.success(`${id} disabled`);
          }
        }
        return;
      }

      // ── --set id=value (repeatable) ───────────────────────────────────────────
      if (options.set && options.set.length > 0) {
        // Phase: parse and validate ALL assignments before any mutation.
        const assignments: Array<{ id: string; flag: ClaudeCodeFlag; value: FlagsRecordValue }> = [];

        for (const assignment of options.set) {
          // Split on first = only — rest is the value (e.g. spellcheck=a=b → id='spellcheck', value='a=b')
          const eqIdx = assignment.indexOf('=');
          if (eqIdx === -1) {
            p.log.error(`Invalid --set format: ${color.bold(assignment)} — expected id=value`);
            process.exitCode = 1;
            return;
          }
          const id = assignment.slice(0, eqIdx);
          const text = assignment.slice(eqIdx + 1);

          // Prototype pollution guard (applies PF-023)
          if (id === '__proto__' || id === 'constructor' || id === 'prototype') {
            p.log.error(`Unknown flag: ${color.bold(id)}`);
            process.exitCode = 1;
            return;
          }

          const flag = lookupFlag(id);
          if (!flag) {
            p.log.error(`Unknown flag: ${color.bold(id)}`);
            p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
            process.exitCode = 1;
            return;
          }

          const value = parseFlagValueInput(flag, text);
          if (value === null && text !== 'unset') {
            // parseFlagValueInput returns null both for 'unset' and for invalid values.
            // If the input isn't literally 'unset', the null means invalid.
            p.log.error(`Invalid value for ${color.bold(id)}: ${color.bold(text)}`);
            p.log.info(`Expected: ${flag.kind === 'boolean' ? 'true|false|unset' : flag.kind === 'enum' ? ((flag as import('../../core/flags.js').EnumFlagDef).values.join('|') + '|unset') : `a valid ${flag.kind} value or unset`}`);
            process.exitCode = 1;
            return;
          }

          assignments.push({ id, flag, value });
        }

        // All assignments valid — proceed to manifest + settings
        const manifest = await readManifest(devflowDir);
        if (!manifest) {
          p.log.error('No devflow installation found — run devflow init first');
          process.exitCode = 1;
          return;
        }

        const settingsPath = path.join(claudeDir, 'settings.json');
        const settingsResult = await readSettingsSafe(settingsPath);
        if (!settingsResult.ok) {
          p.log.error(settingsResult.reason);
          process.exitCode = 1;
          return;
        }

        // PF-015: compute final record before any write
        const newRecord: FlagsRecord = { ...manifest.features.flags };
        for (const { id, flag, value } of assignments) {
          // null from parseFlagValueInput for literal 'unset' → use neutral value
          newRecord[id] = value ?? neutralValueOf(flag);
        }

        await persistFlagConfig(claudeDir, devflowDir, settingsResult.content, newRecord);

        if (process.exitCode === 0) {
          for (const { id, value } of assignments) {
            const flag = lookupFlag(id)!;
            p.log.success(`${id} = ${formatFlagValue(flag, value)}`);
          }
        }
        return;
      }

      // ── --unset ids ───────────────────────────────────────────────────────────
      if (options.unset !== undefined) {
        const ids = options.unset.split(',').map(s => s.trim()).filter(Boolean);

        for (const id of ids) {
          const flag = lookupFlag(id);
          if (!flag) {
            p.log.error(`Unknown flag: ${color.bold(id)}`);
            p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
            process.exitCode = 1;
            return;
          }
        }

        const manifest = await readManifest(devflowDir);
        if (!manifest) {
          p.log.error('No devflow installation found — run devflow init first');
          process.exitCode = 1;
          return;
        }

        const settingsPath = path.join(claudeDir, 'settings.json');
        const settingsResult = await readSettingsSafe(settingsPath);
        if (!settingsResult.ok) {
          p.log.error(settingsResult.reason);
          process.exitCode = 1;
          return;
        }

        // PF-015: compute new record before any write
        const newRecord: FlagsRecord = { ...manifest.features.flags };
        for (const id of ids) {
          const flag = lookupFlag(id)!;
          newRecord[id] = neutralValueOf(flag);
        }

        await persistFlagConfig(claudeDir, devflowDir, settingsResult.content, newRecord);

        if (process.exitCode === 0) {
          for (const id of ids) {
            p.log.success(`${id} unset`);
          }
        }
        return;
      }

      // ── Bare invocation ───────────────────────────────────────────────────────
      //
      // D-P5-1: TTY path launches the interactive flags TUI via lazy import;
      // non-TTY path prints a status table + note to stderr + exitCode 1.
      const manifest = await readManifest(devflowDir);
      const record: FlagsRecord = manifest?.features.flags ?? {};

      if (process.stdout.isTTY) {
        // ── Read settings before launching TUI (needed for persist on save) ──
        const settingsPath = path.join(claudeDir, 'settings.json');
        const settingsResult = await readSettingsSafe(settingsPath);
        if (!settingsResult.ok) {
          p.log.error(settingsResult.reason);
          process.exitCode = 1;
          return;
        }

        // ── Build initial rows from registry + current record ──────────────
        const { runFlagsTui, buildFlagRows, collectFlagRecord } =
          await import('../flags-view/index.js');
        const initialRows = buildFlagRows(FLAG_REGISTRY, record);

        // ── Launch TUI ────────────────────────────────────────────────────
        const result = await runFlagsTui(initialRows);

        if (result.action === 'save') {
          const newRecord = collectFlagRecord(result.rows);
          await persistFlagConfig(claudeDir, devflowDir, settingsResult.content, newRecord);
          if (process.exitCode === 0) {
            process.stdout.write('Flags saved.\n');
          }
        } else {
          process.stdout.write('No changes made.\n');
        }
      } else {
        // non-TTY: status table to stdout, note to stderr
        for (const flag of FLAG_REGISTRY) {
          const value = Object.prototype.hasOwnProperty.call(record, flag.id)
            ? record[flag.id]
            : undefined;
          const displayValue = value !== undefined ? formatFlagValue(flag, value) : 'not adopted';
          process.stdout.write(`${flag.id.padEnd(28)} ${displayValue}\n`);
        }
        process.stderr.write('Note: interactive TUI requires a TTY. Use --enable/--disable/--set/--unset for mutations.\n');
        process.exitCode = 1;
      }
    });
}

// ─── Singleton export ─────────────────────────────────────────────────────────
//
// src/cli.ts imports this; end-to-end tests should use createFlagsCommand()
// instead to get a fresh instance per test.
export const flagsCommand = createFlagsCommand();
