import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Type guard for Node.js system errors with error codes
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
 * Options for the init command parsed by Commander.js
 */
interface InitOptions {
  skipDocs?: boolean;
  scope?: string;
  verbose?: boolean;
  overrideSettings?: boolean;
  plugin?: string;
  list?: boolean;
}

/**
 * Plugin definition with metadata
 */
interface PluginDefinition {
  name: string;
  description: string;
  commands: string[];
  agents: string[];
  skills: string[];
}

/**
 * Available DevFlow plugins
 */
const DEVFLOW_PLUGINS: PluginDefinition[] = [
  {
    name: 'devflow-specify',
    description: 'Interactive feature specification',
    commands: ['/specify'],
    agents: ['skimmer', 'synthesizer'],
    skills: [],
  },
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow',
    commands: ['/implement'],
    agents: ['git', 'skimmer', 'synthesizer', 'coder', 'simplifier', 'scrutinizer', 'shepherd', 'validator'],
    skills: ['core-patterns', 'git-safety', 'github-patterns', 'commit', 'pull-request', 'implementation-patterns', 'codebase-navigation', 'test-design', 'code-smell', 'input-validation', 'self-review', 'typescript', 'react'],
  },
  {
    name: 'devflow-review',
    description: 'Comprehensive code review',
    commands: ['/review'],
    agents: ['git', 'reviewer', 'synthesizer'],
    skills: ['review-methodology', 'github-patterns', 'security-patterns', 'architecture-patterns', 'performance-patterns', 'complexity-patterns', 'consistency-patterns', 'regression-patterns', 'tests-patterns', 'database-patterns', 'dependencies-patterns', 'documentation-patterns'],
  },
  {
    name: 'devflow-resolve',
    description: 'Process and fix review issues',
    commands: ['/resolve'],
    agents: ['git', 'resolver', 'simplifier'],
    skills: ['core-patterns', 'git-safety', 'github-patterns', 'commit', 'implementation-patterns', 'security-patterns'],
  },
  {
    name: 'devflow-catch-up',
    description: 'Context restoration from status logs',
    commands: ['/catch-up'],
    agents: ['catch-up'],
    skills: ['docs-framework'],
  },
  {
    name: 'devflow-devlog',
    description: 'Development session logging',
    commands: ['/devlog'],
    agents: ['devlog'],
    skills: ['docs-framework'],
  },
  {
    name: 'devflow-core-skills',
    description: 'Auto-activating quality enforcement',
    commands: [],
    agents: [],
    skills: ['commit', 'pull-request', 'test-design', 'code-smell', 'input-validation', 'typescript', 'react'],
  },
];

/**
 * Check if Claude CLI is available in the system PATH
 */
function isClaudeCliAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add DevFlow marketplace to Claude CLI
 * @returns true if successful, false otherwise
 */
function addMarketplaceViaCli(): boolean {
  try {
    // Marketplace add is idempotent - safe to call multiple times
    execSync('claude plugin marketplace add dean0x/devflow', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a plugin via Claude CLI
 * @param pluginName - Name of the plugin to install (e.g., 'devflow-implement')
 * @param scope - Installation scope: 'user' or 'local'
 * @returns true if successful, false otherwise
 */
function installPluginViaCli(pluginName: string, scope: 'user' | 'local'): boolean {
  try {
    // Claude CLI uses 'project' for local scope
    const cliScope = scope === 'local' ? 'project' : 'user';
    execSync(`claude plugin install ${pluginName}@dean0x-devflow --scope ${cliScope}`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .option('--scope <type>', 'Installation scope: user or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
  .option('--override-settings', 'Override existing settings.json with DevFlow configuration')
  .option('--plugin <names>', 'Install specific plugin(s), comma-separated (e.g., implement,review)')
  .option('--list', 'List available plugins')
  .action(async (options: InitOptions) => {
    // Get package version
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    let version = '';
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      version = packageJson.version;
    } catch {
      version = 'unknown';
    }

    const verbose = options.verbose ?? false;

    // Start the CLI flow
    p.intro(color.bgCyan(color.black(` DevFlow v${version} `)));

    // Handle --list option
    if (options.list) {
      const maxNameLen = Math.max(...DEVFLOW_PLUGINS.map(p => p.name.length));
      const pluginList = DEVFLOW_PLUGINS
        .map(plugin => {
          const cmds = plugin.commands.length > 0 ? plugin.commands.join(', ') : '(skills only)';
          return `${color.cyan(plugin.name.padEnd(maxNameLen + 2))}${color.dim(plugin.description)}\n${' '.repeat(maxNameLen + 2)}${color.yellow(cmds)}`;
        })
        .join('\n\n');

      p.note(pluginList, 'Available plugins');
      p.outro(color.dim('Install with: npx devflow-kit init --plugin=<name>'));
      return;
    }

    // Parse plugin selection
    let selectedPlugins: string[] = [];
    if (options.plugin) {
      selectedPlugins = options.plugin.split(',').map(p => {
        const trimmed = p.trim();
        // Allow shorthand (e.g., "implement" -> "devflow-implement")
        return trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
      });

      // Validate plugin names
      const validNames = DEVFLOW_PLUGINS.map(p => p.name);
      const invalidPlugins = selectedPlugins.filter(p => !validNames.includes(p));
      if (invalidPlugins.length > 0) {
        p.log.error(`Unknown plugin(s): ${invalidPlugins.join(', ')}`);
        p.log.info(`Valid plugins: ${validNames.join(', ')}`);
        process.exit(1);
      }
    }

    // Determine installation scope
    let scope: 'user' | 'local' = 'user';

    if (options.scope) {
      const normalizedScope = options.scope.toLowerCase();
      if (normalizedScope !== 'user' && normalizedScope !== 'local') {
        p.log.error('Invalid scope. Use "user" or "local"');
        process.exit(1);
      }
      scope = normalizedScope;
    } else if (!process.stdin.isTTY) {
      // Non-interactive environment (CI/CD, scripts) - use default
      p.log.info('Non-interactive mode detected, using scope: user');
      scope = 'user';
    } else {
      // Interactive prompt for scope
      const selected = await p.select({
        message: 'Installation scope',
        options: [
          { value: 'user', label: 'User', hint: 'all projects (~/.claude/)' },
          { value: 'local', label: 'Local', hint: 'this project only (./.claude/)' },
        ],
      });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }

      scope = selected as 'user' | 'local';
    }

    // Get installation paths
    let claudeDir: string;
    let devflowDir: string;
    let gitRoot: string | null = null;

    try {
      const paths = await getInstallationPaths(scope);
      claudeDir = paths.claudeDir;
      devflowDir = paths.devflowDir;
      gitRoot = await getGitRoot();
    } catch (error) {
      p.log.error(`Path configuration error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Start spinner for installation
    const s = p.spinner();
    s.start('Installing components');

    // For local scope, ensure .claude directory exists
    if (scope === 'local') {
      try {
        await fs.mkdir(claudeDir, { recursive: true });
      } catch (error) {
        s.stop('Installation failed');
        p.log.error(`Failed to create ${claudeDir}: ${error}`);
        process.exit(1);
      }
    } else {
      // For user scope, check Claude Code exists
      try {
        await fs.access(claudeDir);
      } catch {
        s.stop('Installation failed');
        p.log.error(`Claude Code not detected at ${claudeDir}`);
        p.log.info('Install from: https://claude.ai/download');
        process.exit(1);
      }
    }

    // Get the root directory of the devflow package
    const rootDir = path.resolve(__dirname, '../..');
    const pluginsDir = path.join(rootDir, 'plugins');

    // Determine which plugins to install
    const pluginsToInstall = selectedPlugins.length > 0
      ? DEVFLOW_PLUGINS.filter(p => selectedPlugins.includes(p.name))
      : DEVFLOW_PLUGINS;

    // Try native Claude CLI installation first, fall back to manual copy
    const cliAvailable = isClaudeCliAvailable();
    let usedNativeCli = false;

    if (cliAvailable) {
      s.message('Adding DevFlow marketplace...');
      const marketplaceAdded = addMarketplaceViaCli();

      if (marketplaceAdded) {
        s.message('Installing plugins via Claude CLI...');
        let allInstalled = true;

        for (const plugin of pluginsToInstall) {
          const installed = installPluginViaCli(plugin.name, scope);
          if (!installed) {
            allInstalled = false;
            break;
          }
        }

        if (allInstalled) {
          usedNativeCli = true;
          s.stop('Plugins installed via Claude CLI');
        }
      }
    }

    // Fall back to manual installation if CLI failed or unavailable
    if (!usedNativeCli) {
      if (cliAvailable && verbose) {
        p.log.warn('Claude CLI installation failed, falling back to manual copy');
      }

      try {
        // Clean old DevFlow files before installing (only for full install)
        if (selectedPlugins.length === 0) {
          // Remove old monolithic structure if present
          const oldDirs = [
            path.join(claudeDir, 'commands', 'devflow'),
            path.join(claudeDir, 'agents', 'devflow'),
          ];
          for (const dir of oldDirs) {
            try {
              await fs.rm(dir, { recursive: true, force: true });
            } catch { /* ignore */ }
          }

          // Clean old skill directories that will be replaced
          const allSkills = new Set<string>();
          for (const plugin of DEVFLOW_PLUGINS) {
            for (const skill of plugin.skills) {
              allSkills.add(skill);
            }
          }
          for (const skill of allSkills) {
            try {
              await fs.rm(path.join(claudeDir, 'skills', skill), { recursive: true, force: true });
            } catch { /* ignore */ }
          }
        }

        // Install each selected plugin
        const installedCommands: string[] = [];
        const installedSkills = new Set<string>();

        for (const plugin of pluginsToInstall) {
          const pluginSourceDir = path.join(pluginsDir, plugin.name);

          // Install commands
          const commandsSource = path.join(pluginSourceDir, 'commands');
          const commandsTarget = path.join(claudeDir, 'commands', 'devflow');
          try {
            const files = await fs.readdir(commandsSource);
            if (files.length > 0) {
              await fs.mkdir(commandsTarget, { recursive: true });
              for (const file of files) {
                await fs.copyFile(
                  path.join(commandsSource, file),
                  path.join(commandsTarget, file)
                );
              }
              installedCommands.push(...plugin.commands);
            }
          } catch { /* no commands directory */ }

          // Install agents
          const agentsSource = path.join(pluginSourceDir, 'agents');
          const agentsTarget = path.join(claudeDir, 'agents', 'devflow');
          try {
            const files = await fs.readdir(agentsSource);
            if (files.length > 0) {
              await fs.mkdir(agentsTarget, { recursive: true });
              for (const file of files) {
                await fs.copyFile(
                  path.join(agentsSource, file),
                  path.join(agentsTarget, file)
                );
              }
            }
          } catch { /* no agents directory */ }

          // Install skills (flat structure for auto-discovery)
          const skillsSource = path.join(pluginSourceDir, 'skills');
          try {
            const skillDirs = await fs.readdir(skillsSource, { withFileTypes: true });
            for (const skillDir of skillDirs) {
              if (skillDir.isDirectory()) {
                const skillTarget = path.join(claudeDir, 'skills', skillDir.name);
                await copyDirectory(
                  path.join(skillsSource, skillDir.name),
                  skillTarget
                );
                installedSkills.add(skillDir.name);
              }
            }
          } catch { /* no skills directory */ }
        }

        // Install scripts (always from root scripts/ directory)
        const scriptsSource = path.join(rootDir, 'scripts');
        const scriptsTarget = path.join(devflowDir, 'scripts');
        try {
          await fs.mkdir(scriptsTarget, { recursive: true });
          await copyDirectory(scriptsSource, scriptsTarget);

          // Make scripts executable
          const scripts = await fs.readdir(scriptsTarget);
          for (const script of scripts) {
            const scriptPath = path.join(scriptsTarget, script);
            const stat = await fs.stat(scriptPath);
            if (stat.isFile()) {
              await fs.chmod(scriptPath, 0o755);
            }
          }
        } catch { /* scripts may not exist */ }

        s.stop('Components installed via file copy');
      } catch (error) {
        s.stop('Installation failed');
        p.log.error(`${error}`);
        process.exit(1);
      }
    }

    // === EXTRAS: Things plugins can't handle ===

    // 1. Install settings.json
    const settingsPath = path.join(claudeDir, 'settings.json');
    const sourceSettingsPath = path.join(rootDir, 'src', 'templates', 'settings.json');
    const overrideSettings = options.overrideSettings ?? false;

    try {
      const settingsTemplate = await fs.readFile(sourceSettingsPath, 'utf-8');
      const settingsContent = settingsTemplate.replace(/\$\{DEVFLOW_DIR\}/g, devflowDir);

      let settingsExists = false;
      try {
        await fs.access(settingsPath);
        settingsExists = true;
      } catch {
        settingsExists = false;
      }

      if (settingsExists && overrideSettings) {
        if (process.stdin.isTTY) {
          const confirmed = await p.confirm({
            message: 'settings.json exists. Override with DevFlow settings?',
            initialValue: false,
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
          await fs.writeFile(settingsPath, settingsContent, 'utf-8');
          p.log.success('Settings overridden');
        }
      } else if (settingsExists) {
        p.log.info('Settings exist - use --override-settings to replace');
      } else {
        await fs.writeFile(settingsPath, settingsContent, 'utf-8');
        if (verbose) {
          p.log.success('Settings configured');
        }
      }
    } catch (error: unknown) {
      if (verbose) {
        p.log.warn(`Could not configure settings: ${error}`);
      }
    }

    // 2. Install CLAUDE.md
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

    // 3. Create .claudeignore in git repository root
    if (gitRoot) {
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

    // 4. For local scope, update .gitignore
    if (scope === 'local' && gitRoot) {
      try {
        const gitignorePath = path.join(gitRoot, '.gitignore');
        const entriesToAdd = ['.claude/', '.devflow/'];

        let gitignoreContent = '';
        try {
          gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
        } catch { /* doesn't exist */ }

        const linesToAdd: string[] = [];
        for (const entry of entriesToAdd) {
          if (!gitignoreContent.split('\n').some(line => line.trim() === entry)) {
            linesToAdd.push(entry);
          }
        }

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

    // 5. Create .docs/ structure
    if (!options.skipDocs) {
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

    // Show installation method
    if (usedNativeCli) {
      p.log.success('Installed via Claude plugin system');
    } else {
      if (!cliAvailable) {
        p.log.info('Installed via file copy (Claude CLI not available)');
      }
    }

    // Show installed plugins and commands
    const pluginsToShow = selectedPlugins.length > 0
      ? DEVFLOW_PLUGINS.filter(p => selectedPlugins.includes(p.name))
      : DEVFLOW_PLUGINS;

    const installedCommands = pluginsToShow.flatMap(p => p.commands).filter(c => c.length > 0);
    if (installedCommands.length > 0) {
      const commandsNote = installedCommands
        .map(cmd => color.cyan(cmd))
        .join('  ');
      p.note(commandsNote, 'Available commands');
    }

    // Verbose mode: show details
    if (verbose) {
      const pluginsList = pluginsToShow
        .map(plugin => `${color.yellow(plugin.name.padEnd(24))}${color.dim(plugin.description)}`)
        .join('\n');

      p.note(pluginsList, 'Installed plugins');

      p.log.info(`Scope: ${scope}`);
      p.log.info(`Claude dir: ${claudeDir}`);
      p.log.info(`DevFlow dir: ${devflowDir}`);
    }

    p.outro(color.green('Ready! Run any command in Claude Code to get started.'));
  });

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
