import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';

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
 * Install or update settings.json with DevFlow configuration.
 * Prompts interactively in TTY mode when settings already exist.
 * In non-TTY mode, skips override (safe default).
 */
export async function installSettings(
  claudeDir: string,
  rootDir: string,
  devflowDir: string,
  verbose: boolean,
  teamsEnabled: boolean = false,
): Promise<void> {
  const settingsPath = path.join(claudeDir, 'settings.json');
  const sourceSettingsPath = path.join(rootDir, 'src', 'templates', 'settings.json');

  try {
    const settingsTemplate = await fs.readFile(sourceSettingsPath, 'utf-8');
    let settingsContent = substituteSettingsTemplate(settingsTemplate, devflowDir);
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
 * Install CLAUDE.md template (skip if already exists).
 */
export async function installClaudeMd(
  claudeDir: string,
  rootDir: string,
  verbose: boolean,
): Promise<void> {
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  const sourceClaudeMdPath = path.join(rootDir, 'src', 'claude', 'CLAUDE.md');

  try {
    const content = await fs.readFile(sourceClaudeMdPath, 'utf-8');
    await fs.writeFile(claudeMdPath, content, { encoding: 'utf-8', flag: 'wx' });
    if (verbose) {
      p.log.success('CLAUDE.md configured');
    }
  } catch (error: unknown) {
    if (isNodeSystemError(error) && error.code === 'EEXIST') {
      p.log.info('CLAUDE.md exists - keeping your configuration');
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
