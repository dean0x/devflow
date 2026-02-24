import { promises as fs, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import * as p from '@clack/prompts';
import { getManagedSettingsPath } from './paths.js';

/**
 * Type guard for Node.js system errors with error codes.
 */
interface NodeSystemError extends Error {
  code: string;
}

function isNodeSystemError(error: unknown): error is NodeSystemError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeSystemError).code === 'string'
  );
}

/**
 * Replace ${DEVFLOW_DIR} placeholders in a settings template.
 */
export function substituteSettingsTemplate(template: string, devflowDir: string): string {
  return template.replace(/\$\{DEVFLOW_DIR\}/g, devflowDir);
}

/**
 * Add Agent Teams configuration to settings JSON.
 * Sets teammateMode and CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var.
 */
export function applyTeamsConfig(settingsJson: string): string {
  const settings = JSON.parse(settingsJson);
  settings.teammateMode = 'auto';
  if (!settings.env) {
    settings.env = {};
  }
  settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove Agent Teams configuration from settings JSON.
 * Strips teammateMode and CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var.
 */
export function stripTeamsConfig(settingsJson: string): string {
  const settings = JSON.parse(settingsJson);
  delete settings.teammateMode;
  if (settings.env) {
    delete settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
    if (Object.keys(settings.env).length === 0) {
      delete settings.env;
    }
  }
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Compute which entries need appending to a .gitignore file.
 * Returns only entries not already present.
 */
export function computeGitignoreAppend(existingContent: string, entries: string[]): string[] {
  const existingLines = existingContent.split('\n').map(l => l.trim());
  return entries.filter(entry => !existingLines.includes(entry));
}

/**
 * Merge DevFlow deny entries into an existing managed settings object.
 * Preserves existing entries, deduplicates, and returns the merged JSON string.
 */
export function mergeDenyList(existingJson: string, newDenyEntries: string[]): string {
  const existing = JSON.parse(existingJson);
  const currentDeny: string[] = existing.permissions?.deny ?? [];
  const merged = [...new Set([...currentDeny, ...newDenyEntries])];
  existing.permissions = { ...existing.permissions, deny: merged };
  return JSON.stringify(existing, null, 2) + '\n';
}

/**
 * Attempt to install managed settings (security deny list) to the system path.
 * Managed settings have highest precedence in Claude Code and cannot be overridden.
 *
 * Strategy:
 * 1. Try direct write (works if running as root or directory is writable)
 * 2. If EACCES in TTY, offer to retry with sudo
 * 3. Returns true if managed settings were written, false if caller should fall back
 */
export async function installManagedSettings(
  rootDir: string,
  verbose: boolean,
): Promise<boolean> {
  let managedPath: string;
  try {
    managedPath = getManagedSettingsPath();
  } catch {
    return false; // Unsupported platform
  }

  const managedDir = path.dirname(managedPath);
  const sourceManaged = path.join(rootDir, 'src', 'templates', 'managed-settings.json');

  let newDenyEntries: string[];
  try {
    const template = JSON.parse(await fs.readFile(sourceManaged, 'utf-8'));
    newDenyEntries = template.permissions?.deny ?? [];
  } catch {
    if (verbose) {
      p.log.warn('Could not read managed settings template');
    }
    return false;
  }

  // Build the content to write (merge with existing if present)
  let content: string;
  try {
    const existing = await fs.readFile(managedPath, 'utf-8');
    content = mergeDenyList(existing, newDenyEntries);
  } catch {
    // File doesn't exist — use template as-is
    content = JSON.stringify({ permissions: { deny: newDenyEntries } }, null, 2) + '\n';
  }

  // Attempt 1: direct write
  try {
    await fs.mkdir(managedDir, { recursive: true });
    await fs.writeFile(managedPath, content, 'utf-8');
    if (verbose) {
      p.log.success(`Managed settings written to ${managedPath}`);
    }
    return true;
  } catch (error: unknown) {
    if (!isNodeSystemError(error) || error.code !== 'EACCES') {
      if (verbose) {
        p.log.warn(`Could not write managed settings: ${error}`);
      }
      return false;
    }
  }

  // Attempt 2: sudo (TTY only)
  if (!process.stdin.isTTY) {
    return false;
  }

  const confirmed = await p.confirm({
    message: `Managed settings require admin access (${managedDir}). Use sudo?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }

  try {
    execSync(`sudo mkdir -p '${managedDir}'`, { stdio: 'inherit' });
    // Write via sudo tee to avoid shell quoting issues with the JSON content
    const tmpFile = path.join(rootDir, '.managed-settings-tmp.json');
    await fs.writeFile(tmpFile, content, 'utf-8');
    execSync(`sudo cp '${tmpFile}' '${managedPath}'`, { stdio: 'inherit' });
    await fs.rm(tmpFile, { force: true });
    if (verbose) {
      p.log.success(`Managed settings written to ${managedPath} (via sudo)`);
    }
    return true;
  } catch (error) {
    if (verbose) {
      p.log.warn(`sudo write failed: ${error}`);
    }
    return false;
  }
}

/**
 * Remove DevFlow deny entries from managed settings.
 * If only DevFlow entries remain, deletes the file entirely.
 * Returns true if cleanup was performed.
 */
export async function removeManagedSettings(
  rootDir: string,
  verbose: boolean,
): Promise<boolean> {
  let managedPath: string;
  try {
    managedPath = getManagedSettingsPath();
  } catch {
    return false;
  }

  let existingContent: string;
  try {
    existingContent = await fs.readFile(managedPath, 'utf-8');
  } catch {
    return false; // File doesn't exist
  }

  // Load our deny entries to identify which to remove
  const sourceManaged = path.join(rootDir, 'src', 'templates', 'managed-settings.json');
  let devflowDenyEntries: string[];
  try {
    const template = JSON.parse(await fs.readFile(sourceManaged, 'utf-8'));
    devflowDenyEntries = template.permissions?.deny ?? [];
  } catch {
    return false;
  }

  const existing = JSON.parse(existingContent);
  const currentDeny: string[] = existing.permissions?.deny ?? [];
  const devflowSet = new Set(devflowDenyEntries);
  const remaining = currentDeny.filter(entry => !devflowSet.has(entry));

  const writeContent = (content: string): boolean => {
    try {
      execSync(`sudo tee '${managedPath}' > /dev/null`, {
        input: content,
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      return true;
    } catch {
      // Try direct write as fallback
      try {
        writeFileSync(managedPath, content, 'utf-8');
        return true;
      } catch {
        return false;
      }
    }
  };

  const deleteFile = (): boolean => {
    try {
      execSync(`sudo rm '${managedPath}'`, { stdio: 'inherit' });
      return true;
    } catch {
      try {
        unlinkSync(managedPath);
        return true;
      } catch {
        return false;
      }
    }
  };

  if (remaining.length === 0) {
    // Check if there are other keys beyond permissions.deny
    const otherKeys = Object.keys(existing).filter(k => k !== 'permissions');
    const hasOtherPermissions = existing.permissions && Object.keys(existing.permissions).filter(k => k !== 'deny').length > 0;

    if (otherKeys.length === 0 && !hasOtherPermissions) {
      if (deleteFile()) {
        if (verbose) {
          p.log.success('Managed settings file removed');
        }
        return true;
      }
    } else {
      // Keep other settings, just remove deny list
      delete existing.permissions.deny;
      if (Object.keys(existing.permissions).length === 0) {
        delete existing.permissions;
      }
      const newContent = JSON.stringify(existing, null, 2) + '\n';
      if (writeContent(newContent)) {
        if (verbose) {
          p.log.success('DevFlow deny entries removed from managed settings');
        }
        return true;
      }
    }
  } else {
    // Other entries remain — update with remaining only
    existing.permissions.deny = remaining;
    const newContent = JSON.stringify(existing, null, 2) + '\n';
    if (writeContent(newContent)) {
      if (verbose) {
        p.log.success('DevFlow deny entries removed from managed settings');
      }
      return true;
    }
  }

  if (verbose) {
    p.log.warn('Could not clean up managed settings (may need sudo)');
  }
  return false;
}

export type SecurityMode = 'managed' | 'user';

/**
 * Install or update settings.json with DevFlow configuration.
 * Prompts interactively in TTY mode when settings already exist.
 * In non-TTY mode, skips override (safe default).
 *
 * When securityMode is 'managed', the deny list goes to system-level managed
 * settings and is excluded from user settings.json. When 'user', the deny list
 * is included in settings.json (original behavior).
 */
export async function installSettings(
  claudeDir: string,
  rootDir: string,
  devflowDir: string,
  verbose: boolean,
  teamsEnabled: boolean = false,
  securityMode: SecurityMode = 'user',
): Promise<void> {
  const settingsPath = path.join(claudeDir, 'settings.json');
  const sourceSettingsPath = path.join(rootDir, 'src', 'templates', 'settings.json');

  try {
    const settingsTemplate = await fs.readFile(sourceSettingsPath, 'utf-8');
    let settingsContent = substituteSettingsTemplate(settingsTemplate, devflowDir);

    // When securityMode is 'user', inject deny list from managed-settings template
    if (securityMode === 'user') {
      const managedTemplatePath = path.join(rootDir, 'src', 'templates', 'managed-settings.json');
      try {
        const managedTemplate = JSON.parse(await fs.readFile(managedTemplatePath, 'utf-8'));
        const settings = JSON.parse(settingsContent);
        settings.permissions = managedTemplate.permissions;
        settingsContent = JSON.stringify(settings, null, 2) + '\n';
      } catch {
        if (verbose) {
          p.log.warn('Could not load security deny list — settings will be written without it');
        }
      }
    }

    if (!teamsEnabled) {
      settingsContent = stripTeamsConfig(settingsContent);
    }

    let settingsExists = false;
    try {
      await fs.access(settingsPath);
      settingsExists = true;
    } catch {
      settingsExists = false;
    }

    if (!settingsExists) {
      await fs.writeFile(settingsPath, settingsContent, 'utf-8');
      if (verbose) {
        p.log.success('Settings configured');
      }
      return;
    }

    // Settings exist — check if they already have hooks
    let hasHooks = false;
    try {
      const existing = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      hasHooks = !!existing.hooks;
    } catch { /* parse error = treat as no hooks */ }

    if (hasHooks) {
      const existing = await fs.readFile(settingsPath, 'utf-8');
      const updated = teamsEnabled
        ? applyTeamsConfig(existing)
        : stripTeamsConfig(existing);
      await fs.writeFile(settingsPath, updated, 'utf-8');
      if (verbose) {
        p.log.info(`Settings updated (teams ${teamsEnabled ? 'enabled' : 'disabled'})`);
      }
      return;
    }

    // Settings exist without hooks — prompt in TTY, warn in non-TTY
    if (process.stdin.isTTY) {
      const confirmed = await p.confirm({
        message: 'settings.json exists without hooks (Working Memory needs hooks). Override?',
        initialValue: true,
      });

      if (p.isCancel(confirmed)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }

      if (confirmed) {
        await fs.writeFile(settingsPath, settingsContent, 'utf-8');
        p.log.success('Settings overridden');
      } else {
        p.log.info('Keeping existing settings');
      }
    } else {
      p.log.warn('Settings exist without hooks. Working Memory requires hooks.');
      p.log.info('Re-run interactively to configure, or manually add hooks to settings.json');
    }
  } catch (error: unknown) {
    if (verbose) {
      p.log.warn(`Could not configure settings: ${error}`);
    }
  }
}

/**
 * Create .claudeignore in git repository root (skip if already exists).
 */
export async function installClaudeignore(
  gitRoot: string,
  rootDir: string,
  verbose: boolean,
): Promise<void> {
  const claudeignorePath = path.join(gitRoot, '.claudeignore');
  const claudeignoreTemplatePath = path.join(rootDir, 'src', 'templates', 'claudeignore.template');

  try {
    const claudeignoreContent = await fs.readFile(claudeignoreTemplatePath, 'utf-8');
    await fs.writeFile(claudeignorePath, claudeignoreContent, { encoding: 'utf-8', flag: 'wx' });
    if (verbose) {
      p.log.success('.claudeignore created');
    }
  } catch (error: unknown) {
    if (isNodeSystemError(error) && error.code === 'EEXIST') {
      // Already exists, skip silently
    } else if (verbose) {
      p.log.warn(`Could not create .claudeignore: ${error}`);
    }
  }
}

/**
 * Update .gitignore with DevFlow entries (for local scope installs).
 */
export async function updateGitignore(
  gitRoot: string,
  verbose: boolean,
): Promise<void> {
  try {
    const gitignorePath = path.join(gitRoot, '.gitignore');
    const entriesToAdd = ['.claude/', '.devflow/'];

    let gitignoreContent = '';
    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    } catch { /* doesn't exist */ }

    const linesToAdd = computeGitignoreAppend(gitignoreContent, entriesToAdd);

    if (linesToAdd.length > 0) {
      const newContent = gitignoreContent
        ? `${gitignoreContent.trimEnd()}\n\n# DevFlow local installation\n${linesToAdd.join('\n')}\n`
        : `# DevFlow local installation\n${linesToAdd.join('\n')}\n`;

      await fs.writeFile(gitignorePath, newContent, 'utf-8');
      if (verbose) {
        p.log.success('.gitignore updated');
      }
    }
  } catch (error) {
    if (verbose) {
      p.log.warn(`Could not update .gitignore: ${error instanceof Error ? error.message : error}`);
    }
  }
}

/**
 * Create .docs/ directory structure for DevFlow artifacts.
 */
export async function createDocsStructure(verbose: boolean): Promise<void> {
  const docsDir = path.join(process.cwd(), '.docs');

  try {
    await fs.mkdir(path.join(docsDir, 'status', 'compact'), { recursive: true });
    await fs.mkdir(path.join(docsDir, 'reviews'), { recursive: true });
    await fs.mkdir(path.join(docsDir, 'releases'), { recursive: true });
    if (verbose) {
      p.log.success('.docs/ structure ready');
    }
  } catch { /* may already exist */ }
}
