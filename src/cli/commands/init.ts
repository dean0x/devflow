import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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
}

/**
 * Command definition with name and user-friendly description
 */
interface CommandDefinition {
  name: string;
  description: string;
}

/**
 * DevFlow commands with user-friendly descriptions.
 */
const DEVFLOW_COMMANDS: CommandDefinition[] = [
  { name: '/specify', description: 'Specify a feature interactively' },
  { name: '/implement', description: 'Execute single task lifecycle' },
  { name: '/review', description: 'Comprehensive code review' },
  { name: '/resolve', description: 'Process and fix review issues' },
  { name: '/catch-up', description: 'Get up to speed on project state' },
  { name: '/devlog', description: 'Document session progress' },
];

/**
 * DevFlow skills with descriptions.
 * Displayed only in verbose mode to show auto-activating capabilities.
 */
const DEVFLOW_SKILLS: CommandDefinition[] = [
  // Tier 1: Foundation Skills (shared by agents)
  { name: 'devflow-core-patterns', description: 'Result types, DI, immutability' },
  { name: 'devflow-review-methodology', description: '6-step review process' },
  { name: 'devflow-docs-framework', description: 'Documentation conventions' },
  { name: 'devflow-git-safety', description: 'Git operations & safety' },
  { name: 'devflow-github-patterns', description: 'GitHub API, rate limits, issues' },
  { name: 'devflow-implementation-patterns', description: 'CRUD, API, events, config' },
  { name: 'devflow-codebase-navigation', description: 'Exploration & pattern discovery' },
  // Tier 2: Specialized Skills (user-facing, auto-activate)
  { name: 'devflow-test-design', description: 'Test quality enforcement' },
  { name: 'devflow-code-smell', description: 'Anti-pattern detection' },
  { name: 'devflow-commit', description: 'Atomic commits & message format' },
  { name: 'devflow-pull-request', description: 'PR quality & descriptions' },
  { name: 'devflow-input-validation', description: 'Boundary validation' },
  { name: 'devflow-self-review', description: '9-pillar self-review framework' },
  // Tier 3: Domain-Specific Skills
  { name: 'devflow-typescript', description: 'TypeScript patterns & idioms' },
  { name: 'devflow-react', description: 'React components & hooks' },
  // Review Pattern Skills (used by Reviewer agent)
  { name: 'devflow-architecture-patterns', description: 'Architecture & design patterns' },
  { name: 'devflow-complexity-patterns', description: 'Complexity & maintainability' },
  { name: 'devflow-consistency-patterns', description: 'Code consistency & style' },
  { name: 'devflow-database-patterns', description: 'Database design & queries' },
  { name: 'devflow-dependencies-patterns', description: 'Dependency management' },
  { name: 'devflow-documentation-patterns', description: 'Documentation quality' },
  { name: 'devflow-performance-patterns', description: 'Performance optimization' },
  { name: 'devflow-regression-patterns', description: 'Regression detection' },
  { name: 'devflow-security-patterns', description: 'Security vulnerabilities' },
  { name: 'devflow-tests-patterns', description: 'Test quality & coverage' },
];

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .option('--scope <type>', 'Installation scope: user or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
  .option('--override-settings', 'Override existing settings.json with DevFlow configuration')
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

    try {
      // DevFlow directories to copy
      const devflowDirectories = [
        { target: path.join(claudeDir, 'commands', 'devflow'), source: path.join(rootDir, 'commands'), name: 'commands' },
        { target: path.join(claudeDir, 'agents', 'devflow'), source: path.join(rootDir, 'agents'), name: 'agents' },
        { target: path.join(claudeDir, 'skills'), source: path.join(rootDir, 'skills'), name: 'skills' },
        { target: path.join(devflowDir, 'scripts'), source: path.join(rootDir, 'scripts'), name: 'scripts' }
      ];

      // Clean old DevFlow files before installing
      for (const dir of devflowDirectories) {
        if (dir.name === 'skills') {
          // Remove old devflow/ subdirectory if it exists
          const oldSkillsDir = path.join(claudeDir, 'skills', 'devflow');
          try {
            await fs.rm(oldSkillsDir, { recursive: true, force: true });
          } catch { /* ignore */ }

          // Remove individual skill directories
          try {
            const skillEntries = await fs.readdir(dir.source, { withFileTypes: true });
            for (const entry of skillEntries) {
              if (entry.isDirectory()) {
                const skillTarget = path.join(dir.target, entry.name);
                try {
                  await fs.rm(skillTarget, { recursive: true, force: true });
                } catch { /* ignore */ }
              }
            }
          } catch { /* ignore */ }
        } else {
          try {
            await fs.rm(dir.target, { recursive: true, force: true });
          } catch { /* ignore */ }
        }
      }

      // Install all DevFlow components
      for (const dir of devflowDirectories) {
        await fs.mkdir(dir.target, { recursive: true });
        await copyDirectory(dir.source, dir.target);
      }

      // Make scripts executable
      const scriptsDir = devflowDirectories.find(d => d.name === 'scripts')!.target;
      const scripts = await fs.readdir(scriptsDir);
      for (const script of scripts) {
        await fs.chmod(path.join(scriptsDir, script), 0o755);
      }

      s.stop('Components installed');
    } catch (error) {
      s.stop('Installation failed');
      p.log.error(`${error}`);
      process.exit(1);
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

    // Show available commands
    const maxLen = Math.max(...DEVFLOW_COMMANDS.map(c => c.name.length));
    const commandsList = DEVFLOW_COMMANDS
      .map(cmd => `${color.cyan(cmd.name.padEnd(maxLen + 2))}${color.dim(cmd.description)}`)
      .join('\n');

    p.note(commandsList, 'Available commands');

    // Verbose mode: show skills
    if (verbose) {
      const skillsList = DEVFLOW_SKILLS
        .map(skill => `${color.yellow(skill.name.padEnd(28))}${color.dim(skill.description)}`)
        .join('\n');

      p.note(skillsList, 'Installed skills (auto-activate)');

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
