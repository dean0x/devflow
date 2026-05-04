import * as path from 'path';
import { promises as fs } from 'fs';
import * as p from '@clack/prompts';
import color from 'picocolors';
import type { HookMatcher, Settings } from '../../utils/hooks.js';
import { getClaudeDirectory, getDevFlowDirectory } from '../../utils/paths.js';
import { readManifest, writeManifest } from '../../utils/manifest.js';
import { getFeatureKb, getWorktreePath } from './shared.js';

const KB_HOOK_MARKER = 'session-end-kb-refresh';

/**
 * Add the KB SessionEnd hook to settings JSON.
 * Idempotent — returns unchanged JSON if hook already exists.
 */
export function addKbHook(settingsJson: string, devflowDir: string): string {
  if (hasKbHook(settingsJson)) {
    return settingsJson;
  }

  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = `${path.join(devflowDir, 'scripts', 'hooks', 'run-hook')} session-end-kb-refresh`;

  const newEntry: HookMatcher = {
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 10,
      },
    ],
  };

  if (!settings.hooks.SessionEnd) {
    settings.hooks.SessionEnd = [];
  }

  settings.hooks.SessionEnd.push(newEntry);

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the KB hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export function removeKbHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = false;

  const matchers = settings.hooks?.SessionEnd;
  if (matchers) {
    const filtered = matchers.filter(
      (m) => !m.hooks.some((h) => h.command.includes(KB_HOOK_MARKER)),
    );
    if (filtered.length < matchers.length) changed = true;
    if (filtered.length === 0) {
      delete settings.hooks!.SessionEnd;
    } else {
      settings.hooks!.SessionEnd = filtered;
    }
  }

  if (!changed) {
    return settingsJson;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the KB hook is registered in settings JSON or parsed Settings object.
 */
export function hasKbHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return settings.hooks?.SessionEnd?.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(KB_HOOK_MARKER)),
  ) ?? false;
}

/**
 * Handle the enable/disable/status toggle actions for `devflow kb`.
 */
export async function handleToggle(options: { enable?: boolean; disable?: boolean; status?: boolean }): Promise<void> {
  if (!options.enable && !options.disable && !options.status) return;

  const worktreePath = await getWorktreePath();
  const claudeDir = getClaudeDirectory();
  const devflowDir = getDevFlowDirectory();
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (options.enable) {
    p.intro(color.cyan('Enable Feature Knowledge Bases'));

    // Create .features/index.json if missing
    const featuresDir = path.join(worktreePath, '.features');
    await fs.mkdir(featuresDir, { recursive: true });
    const indexPath = path.join(featuresDir, 'index.json');
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, JSON.stringify({ version: 1, features: {} }, null, 2) + '\n');
    }

    // Remove .disabled sentinel
    try { await fs.unlink(path.join(featuresDir, '.disabled')); } catch { /* doesn't exist */ }

    // Add SessionEnd hook
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      const updated = addKbHook(content, devflowDir);
      if (updated !== content) {
        await fs.writeFile(settingsPath, updated, 'utf-8');
      }
    } catch { /* settings.json may not exist */ }

    // Update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.kb = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }

    p.log.success('Feature knowledge bases enabled');
    p.outro(`SessionEnd hook installed. Run ${color.cyan('devflow kb create <slug>')} to create a KB.`);

  } else if (options.disable) {
    p.intro(color.cyan('Disable Feature Knowledge Bases'));

    // Create .disabled sentinel
    const featuresDir = path.join(worktreePath, '.features');
    await fs.mkdir(featuresDir, { recursive: true });
    await fs.writeFile(path.join(featuresDir, '.disabled'), '', 'utf-8');

    // Remove SessionEnd hook
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      const updated = removeKbHook(content);
      if (updated !== content) {
        await fs.writeFile(settingsPath, updated, 'utf-8');
      }
    } catch { /* settings.json may not exist */ }

    // Update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.kb = false;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }

    p.log.success('Feature knowledge bases disabled');
    p.log.info('Existing KBs preserved. Manual commands (create/refresh) still work.');
    p.outro('');

  } else {
    // options.status
    p.intro(color.cyan('Feature KB Status'));

    // Check hook
    let hookPresent = false;
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      hookPresent = hasKbHook(content);
    } catch { /* settings.json may not exist */ }

    // Check sentinel
    let disabled = false;
    try {
      await fs.access(path.join(worktreePath, '.features', '.disabled'));
      disabled = true;
    } catch { /* not disabled */ }

    // Count KBs
    const kbs = getFeatureKb().listKBs(worktreePath);

    const enabled = hookPresent && !disabled;
    p.log.info(`Status: ${enabled ? color.green('enabled') : color.yellow('disabled')}`);
    p.log.info(`Hook:   ${hookPresent ? color.green('installed') : color.dim('not installed')}`);
    p.log.info(`KBs:    ${kbs.length}`);
    if (disabled) {
      p.log.info(`Sentinel: ${color.yellow('.features/.disabled present')}`);
    }
    p.outro('');
  }
}
