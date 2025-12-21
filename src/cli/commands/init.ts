import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';
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
 * Check if Claude CLI is available
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
 * Install plugin using Claude CLI
 */
function installPluginViaCli(scope: 'user' | 'local'): boolean {
  try {
    // Map our scope names to Claude CLI scope names
    const cliScope = scope === 'local' ? 'project' : 'user';
    execSync(`claude plugin install devflow --scope ${cliScope}`, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Options for the init command parsed by Commander.js
 */
interface InitOptions {
  skipDocs?: boolean;
  scope?: string;
  verbose?: boolean;
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
  { name: '/breakdown', description: 'Break down tasks quickly' },
  { name: '/swarm', description: 'Execute single task lifecycle' },
  { name: '/implement', description: 'Interactive implementation' },
  { name: '/review', description: 'Comprehensive code review' },
  { name: '/debug', description: 'Systematic debugging' },
  { name: '/resolve-comments', description: 'Address PR feedback' },
  { name: '/commit', description: 'Smart atomic commits' },
  { name: '/pull-request', description: 'Create PR with description' },
  { name: '/release', description: 'Automated releases' },
  { name: '/catch-up', description: 'Get up to speed on project state' },
  { name: '/devlog', description: 'Document session progress' },
];

/**
 * DevFlow skills with descriptions.
 * Displayed only in verbose mode to show auto-activating capabilities.
 */
const DEVFLOW_SKILLS: CommandDefinition[] = [
  { name: 'pattern-check', description: 'Architectural pattern validation' },
  { name: 'test-design', description: 'Test quality enforcement' },
  { name: 'code-smell', description: 'Anti-pattern detection' },
  { name: 'research', description: 'Pre-implementation exploration' },
  { name: 'debug', description: 'Systematic debugging (auto)' },
  { name: 'input-validation', description: 'Boundary validation' },
  { name: 'error-handling', description: 'Result type consistency' },
  { name: 'worktree', description: 'Parallel development isolation' },
];

/**
 * Render clean, minimal output for default (non-verbose) mode.
 */
function renderCleanOutput(version: string, usedCli: boolean): void {
  console.log(`\n✓ DevFlow v${version} installed${usedCli ? ' (via Claude CLI)' : ''}\n`);
  console.log('Commands available:');

  const maxLen = Math.max(...DEVFLOW_COMMANDS.map(c => c.name.length));
  for (const cmd of DEVFLOW_COMMANDS) {
    const padding = ' '.repeat(maxLen - cmd.name.length + 2);
    console.log(`  ${cmd.name}${padding}${cmd.description}`);
  }

  console.log('\nRun any command in Claude Code to get started.');
  console.log('\nDocs: https://github.com/dean0x/devflow');
}

/**
 * Render detailed output for verbose mode.
 */
function renderVerboseOutput(
  version: string,
  usedCli: boolean,
  scope: 'user' | 'local',
  claudeDir: string,
  devflowDir: string
): void {
  console.log(`\n✅ DevFlow v${version} installed${usedCli ? ' (via Claude CLI)' : ''}!\n`);

  console.log(`📍 Installation scope: ${scope}`);
  console.log(`   Claude dir: ${claudeDir}`);
  console.log(`   DevFlow dir: ${devflowDir}\n`);

  console.log('Available commands:');
  for (const cmd of DEVFLOW_COMMANDS) {
    console.log(`  ${cmd.name.padEnd(18)}${cmd.description}`);
  }

  console.log('\nInstalled skills (auto-activate):');
  for (const skill of DEVFLOW_SKILLS) {
    console.log(`  ${skill.name.padEnd(18)}${skill.description}`);
  }

  console.log('\nNote: debug exists as both command (manual) and skill (auto)');
  console.log('Docs: https://github.com/dean0x/devflow');
}

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .option('--scope <type>', 'Installation scope: user or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
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

    if (verbose) {
      console.log(`🚀 DevFlow v${version}\n`);
    }

    // Determine installation scope
    let scope: 'user' | 'local' = 'user';

    if (options.scope) {
      const normalizedScope = options.scope.toLowerCase();
      if (normalizedScope !== 'user' && normalizedScope !== 'local') {
        console.error('❌ Invalid scope. Use "user" or "local"\n');
        process.exit(1);
      }
      scope = normalizedScope;
    } else if (!process.stdin.isTTY) {
      // Non-interactive environment (CI/CD, scripts) - use default
      if (verbose) {
        console.log('📦 Non-interactive environment detected, using default scope: user');
        console.log('   To specify scope in CI/CD, use: devflow init --scope <user|local>\n');
      }
      scope = 'user';
    } else {
      // Interactive prompt for scope
      if (verbose) {
        console.log('📦 Installation Scope:\n');
        console.log('  user  - Install for all projects (user-wide)');
        console.log('            └─ ~/.claude/ and ~/.devflow/');
        console.log('  local - Install for current project only');
        console.log('            └─ <git-root>/.claude/ and <git-root>/.devflow/\n');
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const prompt = verbose
        ? 'Choose scope (user/local) [user]: '
        : 'Install scope - user (all projects) or local (this project only) [user]: ';

      const answer = await new Promise<string>((resolve) => {
        rl.question(prompt, (input) => {
          rl.close();
          resolve(input.trim().toLowerCase() || 'user');
        });
      });

      if (answer === 'local' || answer === 'l') {
        scope = 'local';
      } else if (answer === 'user' || answer === 'u' || answer === '') {
        scope = 'user';
      } else {
        console.error('❌ Invalid scope. Use "user" or "local"\n');
        process.exit(1);
      }

      if (verbose) {
        console.log();
      }
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

      if (verbose) {
        console.log(`📍 Installation scope: ${scope}`);
        console.log(`   Claude dir: ${claudeDir}`);
        console.log(`   DevFlow dir: ${devflowDir}\n`);
      }
    } catch (error) {
      console.error('❌ Path configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }

    // Try to install plugin via Claude CLI first
    let usedCli = false;
    const cliAvailable = isClaudeCliAvailable();

    if (cliAvailable) {
      if (verbose) {
        console.log('🔌 Installing plugin via Claude CLI...');
      }
      usedCli = installPluginViaCli(scope);
      if (!usedCli && verbose) {
        console.log('⚠️  Claude CLI install failed, falling back to manual copy');
      }
    } else if (verbose) {
      console.log('ℹ️  Claude CLI not available, using manual installation');
    }

    // If CLI install failed or unavailable, do manual copy
    if (!usedCli) {
      // For local scope, ensure .claude directory exists
      if (scope === 'local') {
        try {
          await fs.mkdir(claudeDir, { recursive: true });
          if (verbose) {
            console.log('✓ Local .claude directory ready');
          }
        } catch (error) {
          console.error(`❌ Failed to create ${claudeDir}:`, error);
          process.exit(1);
        }
      } else {
        // For user scope, check Claude Code exists
        try {
          await fs.access(claudeDir);
          if (verbose) {
            console.log('✓ Claude Code detected');
          }
        } catch {
          console.error(`❌ Claude Code not detected at ${claudeDir}`);
          console.error('   Install from: https://claude.com/claude-code\n');
          process.exit(1);
        }
      }

      // Get the root directory of the devflow package
      // __dirname is dist/commands/, so go up 2 levels to package root
      const rootDir = path.resolve(__dirname, '../..');

      try {
        // DevFlow directories to copy
        const devflowDirectories = [
          {
            target: path.join(claudeDir, 'commands', 'devflow'),
            source: path.join(rootDir, 'commands'),
            name: 'commands'
          },
          {
            target: path.join(claudeDir, 'agents', 'devflow'),
            source: path.join(rootDir, 'agents'),
            name: 'agents'
          },
          {
            target: path.join(claudeDir, 'skills'),
            source: path.join(rootDir, 'skills'),
            name: 'skills'
          },
          {
            target: path.join(devflowDir, 'scripts'),
            source: path.join(rootDir, 'scripts'),
            name: 'scripts'
          }
        ];

        // Clean old DevFlow files before installing
        for (const dir of devflowDirectories) {
          if (dir.name === 'skills') {
            // Remove old devflow/ subdirectory if it exists
            const oldSkillsDir = path.join(claudeDir, 'skills', 'devflow');
            try {
              await fs.rm(oldSkillsDir, { recursive: true, force: true });
            } catch {
              // Directory might not exist
            }

            // Remove individual skill directories
            try {
              const skillEntries = await fs.readdir(dir.source, { withFileTypes: true });
              for (const entry of skillEntries) {
                if (entry.isDirectory()) {
                  const skillTarget = path.join(dir.target, entry.name);
                  try {
                    await fs.rm(skillTarget, { recursive: true, force: true });
                  } catch {
                    // Skill might not exist
                  }
                }
              }
            } catch {
              // Source directory might not exist
            }
          } else {
            try {
              await fs.rm(dir.target, { recursive: true, force: true });
            } catch {
              // Directory might not exist on first install
            }
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

        if (verbose) {
          console.log('✓ Components installed (commands, agents, skills, scripts)');
        }
      } catch (error) {
        console.error('❌ Installation failed:', error);
        process.exit(1);
      }
    }

    // === EXTRAS: Things plugins can't handle ===

    // Get the root directory for templates
    // __dirname is dist/commands/, so go up 2 levels to package root
    const rootDir = path.resolve(__dirname, '../..');

    // 1. Install settings.json with statusLine (plugins can't configure settings)
    const settingsPath = path.join(claudeDir, 'settings.json');
    const sourceSettingsPath = path.join(rootDir, 'src', 'templates', 'settings.json');

    try {
      const settingsTemplate = await fs.readFile(sourceSettingsPath, 'utf-8');
      const settingsContent = settingsTemplate.replace(
        /\$\{DEVFLOW_DIR\}/g,
        devflowDir
      );

      // Only create if doesn't exist (atomic exclusive create)
      await fs.writeFile(settingsPath, settingsContent, { encoding: 'utf-8', flag: 'wx' });
      if (verbose) {
        console.log('✓ StatusLine configured');
      }
    } catch (error: unknown) {
      if (isNodeSystemError(error) && error.code === 'EEXIST') {
        console.log('⚠️  Existing settings.json found - statusLine not configured');
        console.log('   To enable DevFlow statusLine, add to your settings.json:');
        console.log(`   "statusLine": { "type": "command", "command": "${devflowDir}/scripts/statusline.sh" }\n`);
      } else if (verbose) {
        console.log('⚠️  Could not configure statusLine:', error);
      }
    }

    // 2. Install CLAUDE.md (plugins can't install arbitrary files)
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    const sourceClaudeMdPath = path.join(rootDir, 'src', 'claude', 'CLAUDE.md');

    try {
      const content = await fs.readFile(sourceClaudeMdPath, 'utf-8');
      await fs.writeFile(claudeMdPath, content, { encoding: 'utf-8', flag: 'wx' });
      if (verbose) {
        console.log('✓ CLAUDE.md configured');
      }
    } catch (error: unknown) {
      if (isNodeSystemError(error) && error.code === 'EEXIST') {
        console.log('⚠️  Existing CLAUDE.md found - DevFlow instructions not added');
        console.log('   Review DevFlow patterns at: https://github.com/dean0x/devflow\n');
      }
    }

    // 3. Create .claudeignore in git repository root
    if (gitRoot) {
      const claudeignorePath = path.join(gitRoot, '.claudeignore');

      try {
        const claudeignoreContent = `# DevFlow .claudeignore - Protects against sensitive files and context pollution
# Generated by DevFlow - Edit as needed for your project

# === SECURITY: Sensitive Files ===
# Environment and secrets
.env
.env.*
.env.local
.env.*.local
*.env
.envrc

# Credentials and keys
*.key
*.pem
*.p12
*.pfx
*.cer
*.crt
*.der
id_rsa
id_dsa
id_ecdsa
id_ed25519
*.ppk
*_rsa
*_dsa
*secret*
*password*
*credential*
credentials.json
secrets.json
secrets.yaml
secrets.yml

# Cloud provider credentials
.aws/credentials
.aws/config
.gcp/credentials.json
.azure/credentials

# Package manager credentials
.npmrc
.pypirc
.gem/credentials
pip.conf

# Database
*.sql
*.db
*.sqlite
*.sqlite3

# === DEPENDENCIES & BUILD ===
# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.pnpm-store/

# Python
__pycache__/
*.py[cod]
*$py.class
.Python
env/
venv/
ENV/
.venv/
pip-log.txt
pip-delete-this-directory.txt
.eggs/
*.egg-info/
dist/
build/
*.whl

# Ruby
vendor/bundle/
.bundle/

# Go
vendor/
go.sum

# Rust
target/
Cargo.lock

# Java
target/
*.class
*.jar
*.war

# PHP
vendor/
composer.lock

# === BUILD ARTIFACTS ===
dist/
build/
out/
.next/
.nuxt/
.output/
.vite/
.cache/
.parcel-cache/
.turbo/
*.tsbuildinfo

# === LOGS & TEMP FILES ===
logs/
*.log
*.tmp
*.temp
*.swp
*.swo
*~
.DS_Store
Thumbs.db
*.bak
*.orig
*.rej
.cache

# === VERSION CONTROL ===
.git/
.svn/
.hg/
.gitignore

# === IDE & EDITORS ===
.vscode/
.idea/
*.sublime-*
*.code-workspace
.project
.classpath
.settings/

# === TEST COVERAGE ===
coverage/
.nyc_output/
htmlcov/
.coverage
.pytest_cache/
.tox/

# === OS-SPECIFIC ===
.DS_Store
.AppleDouble
.LSOverride
Thumbs.db
ehthumbs.db
Desktop.ini

# === MEDIA & LARGE FILES ===
*.mp4
*.avi
*.mov
*.wmv
*.flv
*.mp3
*.wav
*.zip
*.tar.gz
*.rar
*.7z
*.dmg
*.iso

# === DOCUMENTATION BUILD ===
site/
_site/
.docusaurus/
.vuepress/dist/

# === LOCK FILES (usually not needed for AI context) ===
package-lock.json
yarn.lock
pnpm-lock.yaml
Gemfile.lock
poetry.lock
Pipfile.lock
`;

        await fs.writeFile(claudeignorePath, claudeignoreContent, { encoding: 'utf-8', flag: 'wx' });
        if (verbose) {
          console.log('✓ .claudeignore created');
        }
      } catch (error: unknown) {
        if (isNodeSystemError(error) && error.code === 'EEXIST') {
          // Already exists, skip
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
        } catch {
          // .gitignore doesn't exist
        }

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
            console.log('✓ .gitignore updated (excluded .claude/ and .devflow/)');
          }
        }
      } catch (error) {
        if (verbose) {
          console.warn('⚠️  Could not update .gitignore:', error instanceof Error ? error.message : error);
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
          console.log('✓ .docs/ structure ready');
        }
      } catch {
        // .docs/ structure may already exist
      }
    }

    // Render final output
    if (verbose) {
      renderVerboseOutput(version, usedCli, scope, claudeDir, devflowDir);
    } else {
      renderCleanOutput(version, usedCli);
    }
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
