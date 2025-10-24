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
 * Get git repository root directory
 * Returns null if not in a git repository
 */
function getGitRoot(): string | null {
  try {
    const gitRootRaw = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'] // Isolate stderr
    }).trim();

    // Validate git root path (security: prevent injection)
    if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
      return null;
    }

    // Validate it's an absolute path
    const gitRoot = path.resolve(gitRootRaw);
    if (!path.isAbsolute(gitRoot)) {
      return null;
    }

    return gitRoot;
  } catch {
    return null;
  }
}

/**
 * Get installation paths based on scope
 * @param scope - 'user' or 'local'
 * @returns Object with claudeDir and devflowDir
 */
function getInstallationPaths(scope: 'user' | 'local'): { claudeDir: string; devflowDir: string } {
  if (scope === 'user') {
    return {
      claudeDir: getClaudeDirectory(),
      devflowDir: getDevFlowDirectory()
    };
  } else {
    // Local scope - install to git repository root
    const gitRoot = getGitRoot();
    if (!gitRoot) {
      throw new Error('Local scope requires a git repository. Run "git init" first or use --scope user');
    }
    return {
      claudeDir: path.join(gitRoot, '.claude'),
      devflowDir: path.join(gitRoot, '.devflow')
    };
  }
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
  .option('--scope <type>', 'Installation scope: user (user-wide) or local (project-only)', /^(user|local)$/i)
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

    console.log(`🚀 DevFlow v${version}\n`);

    // Determine installation scope
    let scope: 'user' | 'local' = 'user'; // Default to user for backwards compatibility

    if (options.scope) {
      scope = options.scope.toLowerCase() as 'user' | 'local';
    } else {
      // Interactive prompt for scope
      console.log('📦 Installation Scope:\n');
      console.log('  user  - Install for all projects (user-wide)');
      console.log('            └─ ~/.claude/ and ~/.devflow/');
      console.log('  local - Install for current project only');
      console.log('            └─ <git-root>/.claude/ and <git-root>/.devflow/\n');

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question('Choose scope (user/local) [user]: ', (input) => {
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
      console.log();
    }

    // Get installation paths with proper validation
    let claudeDir: string;
    let devflowDir: string;

    try {
      const paths = getInstallationPaths(scope);
      claudeDir = paths.claudeDir;
      devflowDir = paths.devflowDir;

      console.log(`📍 Installation scope: ${scope}`);
      console.log(`   Claude dir: ${claudeDir}`);
      console.log(`   DevFlow dir: ${devflowDir}\n`);
    } catch (error) {
      console.error('❌ Path configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }

    // Check for Claude Code (only for user scope)
    if (scope === 'user') {
      try {
        await fs.access(claudeDir);
      } catch {
        console.error(`❌ Claude Code not detected at ${claudeDir}`);
        console.error('   Install from: https://claude.com/claude-code');
        console.error('   Or set CLAUDE_CODE_DIR if installed elsewhere\n');
        process.exit(1);
      }
      console.log('✓ Claude Code detected');
    } else {
      // Local scope - create .claude directory if it doesn't exist
      try {
        await fs.mkdir(claudeDir, { recursive: true });
        console.log('✓ Local .claude directory ready');
      } catch (error) {
        console.error(`❌ Failed to create ${claudeDir}:`, error);
        process.exit(1);
      }
    }

    // Get the root directory of the devflow package
    const rootDir = path.resolve(__dirname, '../..');
    const claudeSourceDir = path.join(rootDir, 'src', 'claude');

    try {
      // DevFlow namespace directories (single source of truth)
      const devflowDirectories = [
        {
          target: path.join(claudeDir, 'commands', 'devflow'),
          source: path.join(claudeSourceDir, 'commands', 'devflow'),
          name: 'commands'
        },
        {
          target: path.join(claudeDir, 'agents', 'devflow'),
          source: path.join(claudeSourceDir, 'agents', 'devflow'),
          name: 'agents'
        },
        {
          target: path.join(claudeDir, 'skills', 'devflow'),
          source: path.join(claudeSourceDir, 'skills', 'devflow'),
          name: 'skills'
        },
        {
          target: path.join(devflowDir, 'scripts'),
          source: path.join(claudeSourceDir, 'scripts'),
          name: 'scripts'
        }
      ];

      // Clean old DevFlow files before installing
      for (const dir of devflowDirectories) {
        try {
          await fs.rm(dir.target, { recursive: true, force: true });
        } catch (e) {
          // Directory might not exist on first install
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

      console.log('✓ Installing components... (commands, agents, skills, scripts)');

      // Install settings.json - never override existing files
      const settingsPath = path.join(claudeDir, 'settings.json');
      const devflowSettingsPath = path.join(claudeDir, 'settings.devflow.json');
      const sourceSettingsPath = path.join(claudeSourceDir, 'settings.json');

      // Read template and replace ~ with actual home directory
      const settingsTemplate = await fs.readFile(sourceSettingsPath, 'utf-8');
      const settingsContent = settingsTemplate.replace(
        /~\/\.devflow\/scripts\/statusline\.sh/g,
        path.join(devflowDir, 'scripts', 'statusline.sh')
      );

      let settingsExists = false;
      try {
        await fs.access(settingsPath);
        settingsExists = true;
        // Existing settings.json found - install as settings.devflow.json
        await fs.writeFile(devflowSettingsPath, settingsContent, 'utf-8');
        console.log('⚠️  Existing settings.json preserved → DevFlow config: settings.devflow.json');
      } catch {
        // No existing settings.json - install normally
        await fs.writeFile(settingsPath, settingsContent, 'utf-8');
        console.log('✓ Settings configured');
      }

      // Install CLAUDE.md - never override existing files
      const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
      const devflowClaudeMdPath = path.join(claudeDir, 'CLAUDE.devflow.md');
      const sourceClaudeMdPath = path.join(claudeSourceDir, 'CLAUDE.md');

      let claudeMdExists = false;
      try {
        await fs.access(claudeMdPath);
        claudeMdExists = true;
        // Existing CLAUDE.md found - install as CLAUDE.devflow.md
        await fs.copyFile(sourceClaudeMdPath, devflowClaudeMdPath);
        console.log('⚠️  Existing CLAUDE.md preserved → DevFlow guide: CLAUDE.devflow.md');
      } catch {
        // No existing CLAUDE.md - install normally
        await fs.copyFile(sourceClaudeMdPath, claudeMdPath);
        console.log('✓ CLAUDE.md configured');
      }

      // Create .claudeignore in git repository root
      let claudeignoreCreated = false;
      try {
        // Find git repository root with validation
        const gitRootRaw = execSync('git rev-parse --show-toplevel', {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'] // Isolate stderr
        }).trim();

        // Validate git root path (security: prevent injection)
        if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
          throw new Error('Invalid git root path returned');
        }

        // Validate it's an absolute path
        const gitRoot = path.resolve(gitRootRaw);
        if (!path.isAbsolute(gitRoot)) {
          throw new Error('Git root must be an absolute path');
        }

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
          await fs.mkdir(path.join(docsDir, 'audits', 'standalone'), { recursive: true });
          await fs.mkdir(path.join(docsDir, 'releases'), { recursive: true });
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
      if (settingsExists || claudeMdExists) {
        console.log('📝 Manual merge recommended:\n');
        if (settingsExists) {
          console.log('   Settings: Review settings.devflow.json and merge desired config into settings.json');
          console.log('             Key setting: statusLine configuration for DevFlow statusline\n');
        }
        if (claudeMdExists) {
          console.log('   Instructions: Review CLAUDE.devflow.md and adopt desired practices');
          console.log('                 This contains DevFlow\'s recommended development patterns\n');
        }
      }

      console.log('Available commands:');
      console.log('  /catch-up         Session context and status');
      console.log('  /research         Pre-implementation planning (manual)');
      console.log('  /debug            Systematic debugging (manual)');
      console.log('  /code-review      Comprehensive code review');
      console.log('  /commit           Intelligent atomic commits');
      console.log('  /devlog           Session documentation');
      console.log('  /release          Release automation');
      console.log('  /plan-next-steps  Extract actionable tasks');
      console.log('\nInstalled skills (auto-activate):');
      console.log('  pattern-check     Architectural pattern validation');
      console.log('  test-design       Test quality enforcement');
      console.log('  code-smell        Anti-pattern detection');
      console.log('  research          Pre-implementation planning (auto)');
      console.log('  debug             Systematic debugging (auto)');
      console.log('  input-validation  Boundary validation');
      console.log('  error-handling    Result type consistency');
      console.log('\nNote: research and debug exist as both commands (manual) and skills (auto)');
      console.log('Docs: npm home devflow-kit');
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