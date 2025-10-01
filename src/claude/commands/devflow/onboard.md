---
allowed-tools: Bash, Read, Write, Grep, Glob, Task
description: Generate onboarding guide for new developers or returning to old projects
---

## Your task

Create a comprehensive onboarding guide by analyzing the project structure, dependencies, and patterns.

### Step 1: Analyze Project Structure

```bash
echo "=== PROJECT OVERVIEW ==="
echo "Project: $(basename $(pwd))"
echo "Repository: $(git remote get-url origin 2>/dev/null || echo 'No remote')"
echo ""

# Detect project type
echo "=== PROJECT TYPE DETECTION ==="
if [ -f "package.json" ]; then
    echo "✅ Node.js/JavaScript project"
    echo "  Framework: $(grep -E '"(react|vue|angular|next|nuxt|express|fastify)"' package.json | head -1 || echo 'Generic Node.js')"
elif [ -f "requirements.txt" ] || [ -f "setup.py" ]; then
    echo "✅ Python project"
    echo "  Framework: $(grep -E '(django|flask|fastapi)' requirements.txt 2>/dev/null | head -1 || echo 'Generic Python')"
elif [ -f "go.mod" ]; then
    echo "✅ Go project"
elif [ -f "Cargo.toml" ]; then
    echo "✅ Rust project"
elif [ -f "pom.xml" ] || [ -f "build.gradle" ]; then
    echo "✅ Java project"
else
    echo "ℹ️ Project type unclear - analyzing further..."
fi

echo -e "\n=== DIRECTORY STRUCTURE ==="
tree -L 2 -d 2>/dev/null || find . -type d -maxdepth 2 | head -20
```

### Step 2: Identify Key Files

```bash
echo -e "\n=== KEY FILES & ENTRY POINTS ==="

# Common entry points
for file in "index.js" "main.js" "app.js" "server.js" "main.py" "app.py" "main.go" "main.rs"; do
    find . -name "$file" -type f 2>/dev/null | head -3
done

# Configuration files
echo -e "\n=== CONFIGURATION FILES ==="
ls -la | grep -E "^-.*\.(json|yml|yaml|toml|ini|env|conf)$" | awk '{print $9}'

# Documentation
echo -e "\n=== DOCUMENTATION ==="
find . -name "README*" -o -name "CONTRIBUTING*" -o -name "*.md" -maxdepth 2 2>/dev/null | head -10
```

### Step 3: Dependencies & Setup

```bash
echo -e "\n=== DEPENDENCIES & SETUP ==="

# Package manager detection
if [ -f "package.json" ]; then
    echo "📦 Node.js dependencies:"
    echo "  Install: npm install"
    jq '.dependencies | keys[]' package.json 2>/dev/null | head -10 || echo "  (See package.json)"
elif [ -f "requirements.txt" ]; then
    echo "📦 Python dependencies:"
    echo "  Install: pip install -r requirements.txt"
    head -10 requirements.txt
elif [ -f "go.mod" ]; then
    echo "📦 Go modules:"
    echo "  Install: go mod download"
fi

# Environment variables
echo -e "\n=== ENVIRONMENT SETUP ==="
if [ -f ".env.example" ]; then
    echo "✅ Environment template found: .env.example"
    echo "  Copy to .env and configure"
else
    echo "ℹ️ No .env.example found"
fi
```

### Step 4: Development Workflow

```bash
echo -e "\n=== DEVELOPMENT SCRIPTS ==="

# Check for npm scripts
if [ -f "package.json" ]; then
    echo "Available npm scripts:"
    grep '"scripts"' -A 20 package.json | grep '":' | head -10
fi

# Check for Makefile
if [ -f "Makefile" ]; then
    echo -e "\nMakefile targets:"
    grep "^[a-zA-Z]" Makefile | head -10
fi

# Recent git activity
echo -e "\n=== RECENT DEVELOPMENT ACTIVITY ==="
git log --oneline -10
```

### Step 5: Architecture Analysis

Launch architecture audit for deeper understanding:
- Use `audit-architecture` sub-agent to analyze patterns
- Identify main components and their relationships
- Document key architectural decisions

### Step 6: Generate Onboarding Guide

Create comprehensive guide at `.docs/ONBOARDING.md`:

```markdown
# Project Onboarding Guide

## 🚀 Quick Start

### Prerequisites
- {Required tools/languages with versions}
- {Required access/credentials}

### Setup Instructions
1. Clone repository: `git clone {repo}`
2. Install dependencies: `{command}`
3. Configure environment: Copy `.env.example` to `.env`
4. Run tests: `{test command}`
5. Start development: `{dev command}`

## 📁 Project Structure

```
{project}/
├── src/           # {description}
├── tests/         # {description}
├── docs/          # {description}
└── config/        # {description}
```

## 🏗️ Architecture Overview

### Key Components
- **{Component 1}**: {Purpose and location}
- **{Component 2}**: {Purpose and location}
- **{Component 3}**: {Purpose and location}

### Data Flow
1. {How data flows through system}
2. {Key transformations}
3. {Output/storage}

## 🔧 Development Workflow

### Common Tasks
- **Add new feature**: {steps}
- **Fix a bug**: {steps}
- **Run tests**: `{command}`
- **Build for production**: `{command}`

### Git Workflow
- Branch naming: `feature/`, `fix/`, `chore/`
- Commit format: `type: description`
- PR process: {description}

## 📚 Key Concepts

### Business Logic
- {Concept 1}: {Explanation}
- {Concept 2}: {Explanation}

### Technical Patterns
- {Pattern 1}: {Where used and why}
- {Pattern 2}: {Where used and why}

## 🧪 Testing

### Running Tests
```bash
{test commands}
```

### Test Structure
- Unit tests: `{location}`
- Integration tests: `{location}`
- E2E tests: `{location}`

## 🚨 Common Issues

### Issue 1: {description}
**Solution**: {how to fix}

### Issue 2: {description}
**Solution**: {how to fix}

## 📖 Resources

### Documentation
- [README](./README.md) - Project overview
- [API Docs]({link}) - API reference
- [Contributing](./CONTRIBUTING.md) - How to contribute

### Team Resources
- Slack: {channel}
- Wiki: {link}
- Issue Tracker: {link}

## 👥 Team Contacts

- **Tech Lead**: {name/contact}
- **Product Owner**: {name/contact}
- **DevOps**: {name/contact}

---

*Generated on {DATE} | Use `/onboard` to regenerate*
```

### Step 7: Next Steps

```markdown
## 🎯 Recommended Next Steps

1. **Explore codebase**: Start with main entry point
2. **Run the application**: Follow setup instructions
3. **Make small change**: Try fixing a typo or small bug
4. **Read recent PRs**: Understand code review standards
5. **Join team channels**: Get connected with the team

💡 Tips:
- Use `/catch-up` to see recent development activity
- Use `/feature` when starting new work
- Use `/debug` when troubleshooting issues
- Use `/devlog` to document your learning
```