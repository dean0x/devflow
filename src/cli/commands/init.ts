import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get home directory with proper fallback and validation
 * Priority: process.env.HOME > os.homedir()
 */
function getHomeDirectory(): string {
  const home = process.env.HOME || homedir();
  if (!home) {
    throw new Error('Unable to determine home directory. Set HOME environment variable.');
  }
  return home;
}

/**
 * Get Claude Code directory with environment variable override support
 * Priority: CLAUDE_CODE_DIR env var > ~/.claude
 */
function getClaudeDirectory(): string {
  if (process.env.CLAUDE_CODE_DIR) {
    return process.env.CLAUDE_CODE_DIR;
  }
  return path.join(getHomeDirectory(), '.claude');
}

/**
 * Get DevFlow directory with environment variable override support
 * Priority: DEVFLOW_DIR env var > ~/.devflow
 */
function getDevFlowDirectory(): string {
  if (process.env.DEVFLOW_DIR) {
    return process.env.DEVFLOW_DIR;
  }
  return path.join(getHomeDirectory(), '.devflow');
}

/**
 * Prompt user for confirmation (async)
 */
async function promptUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .option('--force', 'Override existing settings.json and CLAUDE.md (prompts for confirmation)')
  .option('-y, --yes', 'Auto-approve all prompts (use with --force)')
  .action(async (options) => {
    // Get package version
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    let version = '';
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      version = packageJson.version;
    } catch {
      version = 'unknown';
    }

    console.log(`🚀 DevFlow v${version}${options.force ? ' [--force]' : ''}\n`);

    // Get installation paths with proper validation
    let claudeDir: string;
    let devflowDir: string;

    try {
      claudeDir = getClaudeDirectory();
      devflowDir = getDevFlowDirectory();
    } catch (error) {
      console.error('❌ Path configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }

    // Check for Claude Code
    try {
      await fs.access(claudeDir);
    } catch {
      console.error(`❌ Claude Code not detected at ${claudeDir}`);
      console.error('   Install from: https://claude.com/claude-code');
      console.error('   Or set CLAUDE_CODE_DIR if installed elsewhere\n');
      process.exit(1);
    }

    // Handle --force flag prompt
    let forceOverride = false;
    if (options.force) {
      if (options.yes) {
        forceOverride = true;
      } else {
        console.log('⚠️  WARNING: Force override will replace settings.json and CLAUDE.md');
        console.log('   Backups: settings.json.backup, CLAUDE.md.backup\n');
        forceOverride = await promptUser('Proceed? (y/N): ');
        console.log();

        if (!forceOverride) {
          console.log('❌ Cancelled. Use init without --force for safe installation.\n');
          process.exit(0);
        }
      }
    }

    // Get the root directory of the devflow package
    const rootDir = path.resolve(__dirname, '../..');
    const claudeSourceDir = path.join(rootDir, 'src', 'claude');

    try {
      // Clean old DevFlow files before installing
      const commandsDevflowDir = path.join(claudeDir, 'commands', 'devflow');
      const agentsDevflowDir = path.join(claudeDir, 'agents', 'devflow');
      const devflowScriptsDir = path.join(devflowDir, 'scripts');

      // Remove old DevFlow subdirectories (not entire commands/agents folders)
      try {
        await fs.rm(commandsDevflowDir, { recursive: true, force: true });
        await fs.rm(agentsDevflowDir, { recursive: true, force: true });
        await fs.rm(devflowScriptsDir, { recursive: true, force: true });
      } catch (e) {
        // Directories might not exist on first install
      }

      // Install components silently
      await fs.mkdir(commandsDevflowDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'commands', 'devflow'), commandsDevflowDir);

      await fs.mkdir(agentsDevflowDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'agents', 'devflow'), agentsDevflowDir);

      await fs.mkdir(devflowScriptsDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'scripts'), devflowScriptsDir);

      // Make scripts executable
      const scripts = await fs.readdir(devflowScriptsDir);
      for (const script of scripts) {
        await fs.chmod(path.join(devflowScriptsDir, script), 0o755);
      }

      console.log('✓ Claude Code detected');
      console.log('✓ Installing components... (commands, agents, scripts)');

      // Install settings with smart backup
      const settingsPath = path.join(claudeDir, 'settings.json');
      const managedSettingsPath = path.join(claudeDir, 'managed-settings.json');
      const devflowSettingsPath = path.join(claudeDir, 'settings.devflow.json');
      const sourceSettingsPath = path.join(claudeSourceDir, 'settings.json');

      let settingsAction = '';

      if (forceOverride) {
        // Force override - backup existing and install
        try {
          await fs.access(settingsPath);
          await fs.rename(settingsPath, path.join(claudeDir, 'settings.json.backup'));
        } catch {
          // No existing file
        }
        await fs.copyFile(sourceSettingsPath, settingsPath);
        settingsAction = 'force-installed';
      } else {
        // Safe installation logic
        try {
          // Check if user has existing settings.json
          await fs.access(settingsPath);

          // User has settings.json - need to preserve it
          try {
            // Check if managed-settings.json already exists
            await fs.access(managedSettingsPath);

            // managed-settings.json exists - install as settings.devflow.json
            await fs.copyFile(sourceSettingsPath, devflowSettingsPath);
            settingsAction = 'saved-as-devflow';
          } catch {
            // managed-settings.json doesn't exist - safe to backup and install
            await fs.rename(settingsPath, managedSettingsPath);
            await fs.copyFile(sourceSettingsPath, settingsPath);
            settingsAction = 'backed-up';
          }
        } catch {
          // No existing settings.json - install normally
          await fs.copyFile(sourceSettingsPath, settingsPath);
          settingsAction = 'fresh-install';
        }
      }

      // Install CLAUDE.md with smart backup
      const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
      const devflowClaudeMdPath = path.join(claudeDir, 'CLAUDE.devflow.md');
      const sourceClaudeMdPath = path.join(claudeSourceDir, 'CLAUDE.md');

      let claudeMdAction = '';

      if (forceOverride) {
        // Force override - backup existing and install
        try {
          await fs.access(claudeMdPath);
          await fs.rename(claudeMdPath, path.join(claudeDir, 'CLAUDE.md.backup'));
        } catch {
          // No existing file
        }
        await fs.copyFile(sourceClaudeMdPath, claudeMdPath);
        claudeMdAction = 'force-installed';
      } else {
        // Safe installation logic
        try {
          // Check if user has existing CLAUDE.md
          await fs.access(claudeMdPath);

          // User has CLAUDE.md - install as CLAUDE.devflow.md
          await fs.copyFile(sourceClaudeMdPath, devflowClaudeMdPath);
          claudeMdAction = 'saved-as-devflow';
        } catch {
          // No existing CLAUDE.md - install normally
          await fs.copyFile(sourceClaudeMdPath, claudeMdPath);
          claudeMdAction = 'fresh-install';
        }
      }

      // Show concise status messages
      if (settingsAction === 'force-installed') {
        console.log('✓ Settings force-installed (backup: settings.json.backup)');
      } else if (settingsAction === 'backed-up') {
        console.log('✓ Settings configured');
      } else if (settingsAction === 'saved-as-devflow') {
        console.log('⚠️  Existing settings preserved → DevFlow saved to settings.devflow.json');
      } else {
        console.log('✓ Settings configured');
      }

      if (claudeMdAction === 'force-installed') {
        console.log('✓ CLAUDE.md force-installed (backup: CLAUDE.md.backup)');
      } else if (claudeMdAction === 'saved-as-devflow') {
        console.log('⚠️  Existing CLAUDE.md preserved → DevFlow saved to CLAUDE.devflow.md');
      } else {
        console.log('✓ CLAUDE.md configured');
      }

      // Create .claudeignore in git repository root
      let claudeignoreCreated = false;
      try {
        // Find git repository root
        const gitRoot = execSync('git rev-parse --show-toplevel', {
          cwd: process.cwd(),
          encoding: 'utf-8'
        }).trim();

        const claudeignorePath = path.join(gitRoot, '.claudeignore');

        // Check if .claudeignore already exists
        try {
          await fs.access(claudeignorePath);
        } catch {
          // Create comprehensive .claudeignore
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

          await fs.writeFile(claudeignorePath, claudeignoreContent, 'utf-8');
          claudeignoreCreated = true;
        }
      } catch (error) {
        // Not a git repository or other error - skip .claudeignore creation
      }

      if (claudeignoreCreated) {
        console.log('✓ .claudeignore created');
      }

      // Offer to install project documentation structure
      let docsCreated = false;
      if (!options.skipDocs) {
        const docsDir = path.join(process.cwd(), '.docs');

        try {
          await fs.mkdir(path.join(docsDir, 'status', 'compact'), { recursive: true });
          await fs.mkdir(path.join(docsDir, 'reviews'), { recursive: true });
          await fs.mkdir(path.join(docsDir, 'audits'), { recursive: true });
          docsCreated = true;
        } catch (error) {
          // .docs/ structure may already exist
        }
      }

      if (docsCreated) {
        console.log('✓ .docs/ structure ready');
      }

      console.log('\n✅ Installation complete!\n');

      // Show manual merge instructions if needed
      if (settingsAction === 'saved-as-devflow' || claudeMdAction === 'saved-as-devflow') {
        console.log('⚠️  Manual merge required:');
        if (settingsAction === 'saved-as-devflow') {
          console.log('   Settings: Merge settings.devflow.json → settings.json');
        }
        if (claudeMdAction === 'saved-as-devflow') {
          console.log('   Instructions: cp ~/.claude/CLAUDE.devflow.md ~/.claude/CLAUDE.md');
        }
        console.log();
      }

      console.log('Available commands:');
      console.log('  /catch-up         Session context and status');
      console.log('  /research         Pre-implementation planning');
      console.log('  /code-review      Comprehensive code review');
      console.log('  /commit           Intelligent atomic commits');
      console.log('  /devlog           Session documentation');
      console.log('  /debug            Systematic debugging');
      console.log('  /release          Release automation');
      console.log('  /plan-next-steps  Extract actionable tasks');
      console.log('\nDocs: npm home devflow-kit');
    } catch (error) {
      console.error('❌ Installation failed:', error);
      process.exit(1);
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