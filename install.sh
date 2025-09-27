#!/bin/bash

# DevFlow Installation Script
# Installs commands and configuration to Claude Code global context

set -e

echo "🚀 Installing DevFlow - Agentic Development Toolkit"
echo ""

# Check if we're in the right directory
if [ ! -f "CLAUDE.md" ] || [ ! -d "commands" ]; then
    echo "❌ Error: Run this script from the devflow directory"
    echo "   Make sure CLAUDE.md and commands/ directory exist"
    exit 1
fi

# Create Claude Code directories if they don't exist
echo "📁 Creating Claude Code directories..."
mkdir -p ~/.claude/{commands,projects}

# Backup existing configuration if it exists
if [ -f ~/.claude/settings.json ]; then
    echo "💾 Backing up existing settings.json..."
    cp ~/.claude/settings.json ~/.claude/settings.json.backup.$(date +%Y%m%d_%H%M%S)
fi

if [ -f ~/.claude/statusline.sh ]; then
    echo "💾 Backing up existing statusline.sh..."
    cp ~/.claude/statusline.sh ~/.claude/statusline.sh.backup.$(date +%Y%m%d_%H%M%S)
fi

# Copy commands
echo "📋 Installing commands..."
command_count=$(find commands -name "*.md" | wc -l)
cp -r commands/* ~/.claude/commands/
echo "   ✅ Installed $command_count commands"

# Copy configuration files
echo "⚙️ Installing configuration..."
cp config/settings.json ~/.claude/settings.json
echo "   ✅ Installed settings.json"

cp config/statusline.sh ~/.claude/statusline.sh
chmod +x ~/.claude/statusline.sh
echo "   ✅ Installed statusline.sh"

# Create project documentation structure
echo "📚 Setting up project documentation..."
mkdir -p .docs/{status/compact,reviews,audits,rollbacks,architecture-audits,security-audits,performance-audits,dependency-audits,complexity-audits,database-audits,constraint-reports,test-audits}
echo "   ✅ Created .docs structure"

# Verify installation
echo ""
echo "🔍 Verifying installation..."

# Check commands are accessible
commands_installed=$(find ~/.claude/commands -name "*.md" | wc -l)
echo "   ✅ Commands installed: $commands_installed"

# Check statusline is executable
if [ -x ~/.claude/statusline.sh ]; then
    echo "   ✅ Statusline script is executable"
else
    echo "   ❌ Statusline script is not executable"
fi

# Check settings file exists
if [ -f ~/.claude/settings.json ]; then
    echo "   ✅ Settings file installed"
else
    echo "   ❌ Settings file missing"
fi

echo ""
echo "🎉 DevFlow installation complete!"
echo ""
echo "🚀 Quick Start:"
echo "   /catch-up              # Review recent work"
echo "   /audit-architecture    # Analyze codebase"
echo "   /note-to-future-self   # Document session"
echo ""
echo "📖 Commands Available:"
echo "   Audit Suite:"
echo "     /audit-tests         # Verify test quality"
echo "     /audit-security      # Security analysis"
echo "     /audit-performance   # Performance review"
echo "     /audit-dependencies  # Package analysis"
echo "     /audit-complexity    # Code complexity"
echo "     /audit-database      # Database review"
echo "     /audit-architecture  # Structural analysis"
echo ""
echo "   AI Agent Management:"
echo "     /agent-review        # Verify AI work"
echo "     /rollback            # Undo AI changes"
echo "     /constraint-check    # Check compliance"
echo "     /code-review         # Comprehensive review"
echo ""
echo "   Session Management:"
echo "     /catch-up            # Start session"
echo "     /note-to-future-self # End session"
echo ""
echo "💡 Pro Tips:"
echo "   • Use /catch-up when starting work"
echo "   • Run /agent-review after AI makes changes"
echo "   • Document progress with /note-to-future-self"
echo "   • Check statusline for real-time context"
echo ""
echo "📚 Documentation:"
echo "   • Read CLAUDE.md for comprehensive guide"
echo "   • Check README.md for quick reference"
echo "   • Commands are self-documenting"
echo ""

# Check if we need to recommend restart
if [ -n "$CLAUDE_SESSION" ] || [ -n "$CLAUDE_CODE_SESSION" ]; then
    echo "🔄 Restart Claude Code to activate the new statusline"
fi

echo "Happy coding with DevFlow! 🚀"