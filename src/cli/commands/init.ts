import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .action(async (options) => {
    console.log('🚀 DevFlow - Agentic Development Toolkit');
    console.log('   Intelligent tools for reliable AI-assisted development\n');

    // Check for Claude Code
    const claudeDir = path.join(process.env.HOME || '', '.claude');
    try {
      await fs.access(claudeDir);
      console.log('🔍 Detected Claude Code ✅\n');
    } catch {
      console.error('❌ Claude Code not detected');
      console.error('\nInstall Claude Code from: https://claude.com/claude-code');
      process.exit(1);
    }

    console.log('🛠️ Installing DevFlow for Claude Code...');

    // Get the root directory of the devflow package
    const rootDir = path.resolve(__dirname, '../..');
    const claudeSourceDir = path.join(rootDir, 'src', 'claude');

    try {
      // Clean old DevFlow files before installing
      console.log('  🧹 Cleaning old DevFlow files...');
      const commandsDir = path.join(claudeDir, 'commands');
      const agentsDir = path.join(claudeDir, 'agents');
      const devflowDir = path.join(process.env.HOME || '', '.devflow', 'scripts');

      // Remove old DevFlow commands/agents/scripts
      try {
        await fs.rm(commandsDir, { recursive: true, force: true });
        await fs.rm(agentsDir, { recursive: true, force: true });
        await fs.rm(devflowDir, { recursive: true, force: true });
      } catch (e) {
        // Directories might not exist on first install
      }

      // Install commands
      console.log('  📂 Installing commands...');
      await fs.mkdir(commandsDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'commands'), commandsDir);

      // Install sub-agents
      console.log('  🤖 Installing sub-agents...');
      await fs.mkdir(agentsDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'agents'), agentsDir);

      // Install scripts
      console.log('  📜 Installing scripts...');
      await fs.mkdir(devflowDir, { recursive: true });
      await copyDirectory(path.join(claudeSourceDir, 'scripts'), devflowDir);

      // Make scripts executable
      const scripts = await fs.readdir(devflowDir);
      for (const script of scripts) {
        await fs.chmod(path.join(devflowDir, script), 0o755);
      }

      // Install settings
      console.log('  ⚙️ Installing settings...');
      await fs.copyFile(
        path.join(claudeSourceDir, 'settings.json'),
        path.join(claudeDir, 'settings.json')
      );

      console.log('  ✅ Claude Code installation complete\n');

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
      console.log('     • Commands: ~/.claude/commands/');
      console.log('     • Sub-agents: ~/.claude/agents/');
      console.log('     • Scripts: ~/.devflow/scripts/');
      console.log('     • Settings: ~/.claude/settings.json (statusline and model)\n');
      console.log('📊 SMART STATUSLINE:');
      console.log('   ✅ Statusline configured');
      console.log('   • Shows project context, git status, session cost, and duration\n');
      console.log('🚀 QUICK START:');
      console.log('  1. Navigate to a project directory');
      console.log('  2. Run \'/catch-up\' to get oriented');
      console.log('  3. Use \'/audit-security\' or other commands to analyze code');
      console.log('  4. Run \'/note-to-future-self\' to document sessions\n');
      console.log('📚 DOCUMENTATION:');
      console.log('  • Read CLAUDE.md for comprehensive guide');
      console.log('  • Commands are self-documenting');
      console.log('  • Check README.md for quick reference\n');
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