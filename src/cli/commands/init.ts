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
    console.log('🚀 DevFlow - Agentic Development Toolkit');
    console.log('   Intelligent tools for reliable AI-assisted development\n');

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
      console.log(`🔍 Detected Claude Code at ${claudeDir} ✅\n`);
    } catch {
      console.error(`❌ Claude Code not detected at ${claudeDir}`);
      console.error('\nInstall Claude Code from: https://claude.com/claude-code');
      console.error('\nOr set CLAUDE_CODE_DIR environment variable if installed elsewhere.');
      process.exit(1);
    }

    console.log('🛠️ Installing DevFlow for Claude Code...');

    // Get the root directory of the devflow package
    const rootDir = path.resolve(__dirname, '../..');
    const claudeSourceDir = path.join(rootDir, 'src', 'claude');

    try {
      // Clean old DevFlow files before installing
      console.log('  🧹 Cleaning old DevFlow files...');
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

      // Install commands
      console.log('  📂 Installing commands...');
      await fs.mkdir(commandsDevflowDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'commands', 'devflow'), commandsDevflowDir);

      // Install sub-agents
      console.log('  🤖 Installing sub-agents...');
      await fs.mkdir(agentsDevflowDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'agents', 'devflow'), agentsDevflowDir);

      // Install scripts
      console.log('  📜 Installing scripts...');
      await fs.mkdir(devflowScriptsDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'scripts'), devflowScriptsDir);

      // Make scripts executable
      const scripts = await fs.readdir(devflowScriptsDir);
      for (const script of scripts) {
        await fs.chmod(path.join(devflowScriptsDir, script), 0o755);
      }

      // Handle --force flag
      let forceOverride = false;
      if (options.force) {
        if (options.yes) {
          console.log('  ⚠️  Force override enabled with auto-approval (-y flag)\n');
          forceOverride = true;
        } else {
          console.log('  ⚠️  WARNING: --force flag will override existing settings.json and CLAUDE.md\n');
          console.log('  This will:');
          console.log('    • Replace ~/.claude/settings.json with DevFlow settings');
          console.log('    • Replace ~/.claude/CLAUDE.md with DevFlow global instructions\n');
          forceOverride = await promptUser('  Do you want to proceed? (y/N): ');
          console.log();

          if (!forceOverride) {
            console.log('  ❌ Force override cancelled. Proceeding with safe installation.\n');
          } else {
            console.log('  ✅ Force override approved. Proceeding...\n');
          }
        }
      }

      // Install settings with smart backup
      console.log('  ⚙️ Installing settings...');
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
          console.log('  💾 Existing settings backed up to: settings.json.backup');
        } catch {
          // No existing file
        }
        await fs.copyFile(sourceSettingsPath, settingsPath);
        settingsAction = 'force-installed';
        console.log('  ✅ DevFlow settings force-installed to: settings.json');
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
            console.log('  ⚠️  Your existing settings.json is preserved');
            console.log('  📄 DevFlow settings saved to: settings.devflow.json');
          } catch {
            // managed-settings.json doesn't exist - safe to backup and install
            await fs.rename(settingsPath, managedSettingsPath);
            await fs.copyFile(sourceSettingsPath, settingsPath);
            settingsAction = 'backed-up';
            console.log('  💾 Your settings backed up to: managed-settings.json');
            console.log('  ✅ DevFlow settings installed to: settings.json');
          }
        } catch {
          // No existing settings.json - install normally
          await fs.copyFile(sourceSettingsPath, settingsPath);
          settingsAction = 'fresh-install';
          console.log('  ✅ DevFlow settings installed to: settings.json');
        }
      }

      // Install CLAUDE.md with smart backup
      console.log('  📘 Installing global CLAUDE.md...');
      const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
      const devflowClaudeMdPath = path.join(claudeDir, 'CLAUDE.devflow.md');
      const sourceClaudeMdPath = path.join(claudeSourceDir, 'CLAUDE.md');

      let claudeMdAction = '';

      if (forceOverride) {
        // Force override - backup existing and install
        try {
          await fs.access(claudeMdPath);
          await fs.rename(claudeMdPath, path.join(claudeDir, 'CLAUDE.md.backup'));
          console.log('  💾 Existing CLAUDE.md backed up to: CLAUDE.md.backup');
        } catch {
          // No existing file
        }
        await fs.copyFile(sourceClaudeMdPath, claudeMdPath);
        claudeMdAction = 'force-installed';
        console.log('  ✅ DevFlow CLAUDE.md force-installed');
      } else {
        // Safe installation logic
        try {
          // Check if user has existing CLAUDE.md
          await fs.access(claudeMdPath);

          // User has CLAUDE.md - install as CLAUDE.devflow.md
          await fs.copyFile(sourceClaudeMdPath, devflowClaudeMdPath);
          claudeMdAction = 'saved-as-devflow';
          console.log('  ⚠️  Your existing CLAUDE.md is preserved');
          console.log('  📄 DevFlow CLAUDE.md saved to: CLAUDE.devflow.md');
        } catch {
          // No existing CLAUDE.md - install normally
          await fs.copyFile(sourceClaudeMdPath, claudeMdPath);
          claudeMdAction = 'fresh-install';
          console.log('  ✅ DevFlow CLAUDE.md installed');
        }
      }

      console.log('  ✅ Claude Code installation complete\n');

      // Show settings instructions if needed
      if (settingsAction === 'saved-as-devflow') {
        console.log('⚙️  SETTINGS CONFIGURATION REQUIRED:\n');
        console.log('   Your existing settings.json was preserved because managed-settings.json');
        console.log('   already exists. DevFlow settings are in settings.devflow.json\n');
        console.log(`   To use DevFlow settings (statusline), manually merge into ${settingsPath}:`);
        console.log('   ```json');
        console.log('   {');
        console.log('     "statusLine": {');
        console.log('       "type": "command",');
        console.log(`       "command": "${path.join(devflowDir, 'scripts', 'statusline.sh')}"`);
        console.log('     }');
        console.log('   }');
        console.log('   ```\n');
      } else if (settingsAction === 'backed-up') {
        console.log('💾 SETTINGS BACKUP:\n');
        console.log(`   Your original settings saved to: ${managedSettingsPath}`);
        console.log(`   DevFlow settings now active in: ${settingsPath}`);
        console.log(`   To restore: mv ${managedSettingsPath} ${settingsPath}\n`);
      } else if (settingsAction === 'force-installed') {
        console.log('⚠️  FORCE OVERRIDE APPLIED:\n');
        console.log(`   Your original settings backed up to: ${path.join(claudeDir, 'settings.json.backup')}`);
        console.log(`   DevFlow settings now active in: ${settingsPath}\n`);
      }

      // Show CLAUDE.md instructions if needed
      if (claudeMdAction === 'saved-as-devflow') {
        console.log('📘 CLAUDE.MD CONFIGURATION REQUIRED:\n');
        console.log('   Your existing CLAUDE.md was preserved.');
        console.log(`   DevFlow global instructions are in: ${devflowClaudeMdPath}\n`);
        console.log('   To use DevFlow global instructions, manually merge into your CLAUDE.md:');
        console.log('   • Engineering Principles (Result types, DI, immutability)');
        console.log('   • Critical Anti-Patterns (NO FAKE SOLUTIONS, FAIL HONESTLY)');
        console.log('   • Code Quality Enforcement (root cause analysis)');
        console.log('   • Type Safety Best Practices (language-agnostic)');
        console.log('   • Architecture Documentation (inline docs)\n');
        console.log(`   Or replace entirely: cp ${devflowClaudeMdPath} ${claudeMdPath}\n`);
      } else if (claudeMdAction === 'fresh-install') {
        console.log('📘 CLAUDE.MD INSTALLED:\n');
        console.log(`   DevFlow global instructions active in: ${claudeMdPath}`);
        console.log('   • Language-agnostic engineering principles');
        console.log('   • Critical anti-patterns and foolishness prevention');
        console.log('   • Code quality enforcement rules\n');
      } else if (claudeMdAction === 'force-installed') {
        console.log('⚠️  CLAUDE.MD FORCE OVERRIDE APPLIED:\n');
        console.log(`   Your original CLAUDE.md backed up to: ${path.join(claudeDir, 'CLAUDE.md.backup')}`);
        console.log(`   DevFlow global instructions now active in: ${claudeMdPath}\n`);
      }

      // Create .claudeignore in git repository root
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
          console.log('🔒 Security: .claudeignore already exists (skipping)');
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
          console.log('🔒 Security: Created .claudeignore at repository root');
          console.log('   • Protects sensitive files (credentials, keys, secrets)');
          console.log('   • Reduces context pollution (node_modules, build artifacts)');
          console.log('   • Covers common patterns for all major languages\n');
        }
      } catch (error) {
        // Not a git repository or other error - skip .claudeignore creation
        console.log('ℹ️  Skipped .claudeignore (not in a git repository)\n');
      }

      // Offer to install project documentation structure
      if (!options.skipDocs) {
        console.log('📁 Project Documentation Setup\n');
        const docsDir = path.join(process.cwd(), '.docs');

        try {
          await fs.mkdir(path.join(docsDir, 'status', 'compact'), { recursive: true });
          await fs.mkdir(path.join(docsDir, 'reviews'), { recursive: true });
          await fs.mkdir(path.join(docsDir, 'audits'), { recursive: true });

          console.log('   ✅ Created .docs/ structure');
          console.log('   • .docs/status/ - Session documentation');
          console.log('   • .docs/reviews/ - Code review reports');
          console.log('   • .docs/audits/ - Security, performance, architecture audits');
        } catch (error) {
          console.log('   ⚠️ Could not create .docs/ structure (may already exist)');
        }
      }

      console.log('\n✅ DevFlow installation complete!\n');
      console.log('🎯 WHAT\'S INSTALLED:');
      console.log('  📁 Claude Code:');
      console.log(`     • Commands: ${path.join(claudeDir, 'commands')}/`);
      console.log(`     • Sub-agents: ${path.join(claudeDir, 'agents')}/`);
      console.log(`     • Scripts: ${path.join(devflowDir, 'scripts')}/`);
      console.log(`     • Settings: ${settingsPath} (statusline and model)`);
      console.log(`     • Global Instructions: ${claudeMdPath} (language-agnostic)\n`);
      console.log('📊 SMART STATUSLINE:');
      console.log('   ✅ Statusline configured');
      console.log('   • Shows project context, git status, session cost, and duration\n');
      console.log('🚀 QUICK START:');
      console.log('  1. Navigate to a project directory');
      console.log('  2. Run \'/catch-up\' to get oriented');
      console.log('  3. Use \'/pre-commit\' to review uncommitted changes');
      console.log('  4. Run \'/devlog\' to document sessions\n');
      console.log('📚 DOCUMENTATION:');
      console.log('  • Check README for comprehensive guide');
      console.log('  • Commands are self-documenting');
      console.log('  • Visit npm or GitHub for full documentation\n');
      console.log('Happy coding with DevFlow! 🚀');
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