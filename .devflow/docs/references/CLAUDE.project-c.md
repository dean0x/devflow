# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudine is an MCP (Model Context Protocol) server designed for dedicated servers that acts as a sidekick to Claude, enabling task delegation to background Claude Code instances. It features automatic scaling based on system resources, with no artificial worker limits - spawning as many Claude Code instances as the server can handle.

## Core Architecture

### Event-Driven Architecture (v0.2.1)

Claudine uses a **fully event-driven architecture** with centralized EventBus coordination:

```typescript
// All components communicate through events, not direct method calls
eventBus.emit('TaskDelegated', { task });
eventBus.emit('TaskQueued', { taskId, task });
eventBus.emit('WorkerSpawned', { workerId, taskId });
```

### MCP Server Implementation
- Claudine operates as an MCP server that Claude can connect to via the Model Context Protocol
- Enables Claude to delegate tasks to background Claude Code instances for parallel task execution
- All operations are event-driven with no direct state management

### Key Components

**Event-Driven Core**:
1. **EventBus (InMemoryEventBus)** - Central coordination hub for all system events
2. **Event Handlers** - Specialized handlers that respond to specific events:
   - `PersistenceHandler` - Database operations
   - `QueueHandler` - Task queue management
   - `WorkerHandler` - Worker lifecycle management
   - `OutputHandler` - Output capture and logs

**Business Logic**:
3. **TaskManager (TaskManagerService)** - Pure event emitter, no direct state management
4. **Autoscaling Manager** - Event-driven worker scaling based on resources
5. **Recovery Manager** - Restores interrupted tasks via events on startup
6. **WorktreeManager** - Git worktree isolation with branch-based task execution
7. **GitHubIntegration** - Automatic PR creation and management

**Infrastructure**:
8. **Task Queue (PriorityTaskQueue)** - FIFO with priority support (P0/P1/P2)
9. **Worker Pool (EventDrivenWorkerPool)** - Event-based worker lifecycle
10. **Process Spawner (ClaudeProcessSpawner)** - Proper stdin handling (`stdio: ['ignore', 'pipe', 'pipe']`)
11. **Output Capture (BufferedOutputCapture)** - Event-driven output management
12. **Task Repository (SQLiteTaskRepository)** - Persistent task storage with WAL mode
13. **MCP Adapter** - Handles JSON-RPC requests from Claude Code
14. **Retry Utilities** - Exponential backoff for transient failures

## Development Setup

### Prerequisites
- Node.js 20.0.0+ (TypeScript implementation)
- Claude Code CLI installed (`claude` command available)
- SQLite3 (for task persistence)

### Initial Setup
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Running the MCP Server
```bash
# Start the MCP server
claudine mcp start

# Or run built files directly
node dist/cli.js mcp start
```

### Testing
```bash
# Run tests
npm test

# With coverage
npm run test:coverage
```

### Development Mode
```bash
# Run in development with auto-reload
npm run dev

# Direct task testing (New in v0.2.1)
claudine delegate "echo hello world"
claudine status
claudine logs <task-id>
```

## MCP Integration

When implementing MCP tools for Claudine, follow these patterns:

1. **Tool Registration**: All tools use PascalCase naming (DelegateTask, TaskStatus, etc.)
2. **Task Delegation**: DelegateTask accepts specifications with priority levels
3. **Status Monitoring**: TaskStatus and ListTasks provide task status and health info
4. **Result Retrieval**: TaskLogs and TaskMetrics fetch results from tasks

## Task Specification Format

Tasks submitted to Claudine should follow this structure:
```json
{
  "prompt": "claude-code command or instruction",
  "priority": "P0|P1|P2",
  "timeout": 300000,
  "maxOutputBuffer": 10485760,
  "workingDirectory": "/path/to/work/in",
  "useWorktree": true,
  "worktreeCleanup": "auto|keep|delete",
  "mergeStrategy": "pr|auto|manual|patch",
  "branchName": "custom-branch-name",
  "baseBranch": "main",
  "autoCommit": true,
  "pushToRemote": true,
  "prTitle": "Custom PR title",
  "prBody": "Custom PR description"
}
```

## Testing MCP Server

Use the MCP Inspector or Claude Code to test the server:
1. Configure Claude Code MCP settings (~/.config/claude/mcp_servers.json)
2. Test tool invocations (DelegateTask, TaskStatus, CancelTask, etc.)
3. Verify background instance delegation and management

## CLI Usage

### MCP Server Commands
```bash
# Start the MCP server
claudine mcp start

# Start the MCP server
claudine mcp start
```

### Direct Task Commands (Available in v0.2.1)
- `claudine delegate <task>` - ✅ Delegate a task to background Claude Code instance
- `claudine status [task-id]` - ✅ Check task status (all tasks if no ID provided)
- `claudine logs <task-id> [--tail N]` - ✅ Get task output and logs with optional tail
- `claudine cancel <task-id> [reason]` - ✅ Cancel a running task

### CLI Examples (Working Now)
```bash
# Delegate a simple task
claudine delegate "analyze the codebase and find all TODO comments"

# Check status of all tasks
claudine status

# Check status of specific task
claudine status task-abc123

# Get logs from completed task
claudine logs task-abc123 [--tail 100]

# Cancel a running task
claudine cancel task-abc123 [reason]
```

## Engineering Principles

**IMPORTANT**: Follow these principles strictly when implementing features:

1. **Always use Result types** - Never throw errors in business logic
2. **Inject dependencies** - Makes testing trivial
3. **Compose with pipes** - Readable, maintainable chains
4. **Immutable by default** - No mutations, return new objects
5. **Type everything** - No any types, explicit returns
6. **Test behaviors, not implementation** - Focus on integration tests
7. **Resource cleanup** - Always use try/finally or "using" pattern
8. **Structured logging** - JSON logs with context
9. **Validate at boundaries** - Parse, don't validate (Zod schemas)
10. **Performance matters** - Measure, benchmark, optimize

### Code Example (Good)
```typescript
// Result type instead of throwing
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Dependency injection
class TaskManager {
  constructor(
    private readonly processSpawner: ProcessSpawner,
    private readonly resourceMonitor: ResourceMonitor,
    private readonly logger: Logger
  ) {}
}

// Composable functions with pipes
const processTask = pipe(
  validateInput,
  checkResources,
  spawnWorker,
  captureOutput,
  handleResult
);

// Immutable updates
const updateTask = (task: Task, update: Partial<Task>): Task => ({
  ...task,
  ...update,
  updatedAt: Date.now()
});
```

## Important Considerations

1. **Dedicated Server Focus**: Claudine is designed for dedicated servers with ample resources, not constrained cloud environments
2. **Autoscaling by Default**: No configuration needed - automatically uses all available system resources
3. **Resource Management**: Maintains 20% CPU headroom and 1GB RAM reserve for system stability
4. **Error Handling**: Use Result types, never throw in business logic
5. **Queue Persistence**: ✅ **IMPLEMENTED** - SQLite-based persistent task queue with recovery
6. **Security**: Validate all task inputs at boundaries using Zod
7. **Logging**: Structured JSON logging with context
8. **No Worker Limits**: Unlike traditional approaches, we spawn as many workers as the system can handle
9. **Testing**: Focus on integration tests that verify behaviors
10. **Performance**: Measure and optimize critical paths

## Current Architecture (v0.2.1)

### Implemented Components
- **Event-Driven Architecture**: EventBus with specialized event handlers
- **Task Persistence**: SQLite database with WAL mode and recovery
- **CLI Interface**: Direct task management commands
- **Process Handling**: Proper stdin management (`stdio: ['ignore', 'pipe', 'pipe']`)
- **Autoscaling Manager**: Event-driven worker pool based on system resources
- **Recovery Manager**: Event-based task restoration on startup
- **Configuration System**: Environment-based configuration with validation
- **Output Management**: Event-driven buffered capture with file overflow
- **Resource Monitoring**: Real-time CPU/memory tracking with event emission


## Release Process

### Automated Release Workflow (v0.2.1+)

**IMPORTANT**: Releases are now fully automated via CI/CD with required manual release notes.

### Pre-release Checklist
1. **Clean up workspace**
   - Remove test files (*.txt, test_*.py, etc.)
   - Ensure no temporary files are committed

2. **Update version in package.json**
   ```bash
   # Update version manually in package.json
   npm version patch --no-git-tag-version  # for bug fixes (0.1.1 -> 0.1.2)
   npm version minor --no-git-tag-version  # for new features (0.1.1 -> 0.2.0)
   npm version major --no-git-tag-version  # for breaking changes (0.1.1 -> 1.0.0)
   ```

3. **Create release notes file** (REQUIRED)
   ```bash
   # Create release notes file matching version
   touch RELEASE_NOTES_v0.2.2.md
   
   # Add comprehensive release notes:
   # - Major features
   # - Bug fixes  
   # - Breaking changes
   # - Migration instructions
   ```

4. **Test everything**
   ```bash
   npm run build
   npm test
   ```

### Release Steps (Fully Automated)

1. **Create Pull Request**
   ```bash
   # Commit version bump and release notes
   git add package.json RELEASE_NOTES_v0.2.2.md
   git commit -m "chore: prepare v0.2.2 release"
   
   # Push branch and create PR
   git push origin feature/your-branch
   gh pr create --title "Release v0.2.2" --body "See RELEASE_NOTES_v0.2.2.md"
   ```

2. **Merge PR to main** - **This triggers full automation:**

   **CI automatically performs:**
   ✅ **Version detection** - Compares package.json vs published npm version  
   ✅ **Release notes validation** - **FAILS if RELEASE_NOTES_v{version}.md missing**  
   ✅ **NPM publishing** - Publishes to npm registry with public access  
   ✅ **Git tag creation** - Creates and pushes v{version} tag  
   ✅ **GitHub release** - Creates release using manual release notes  

### Release Validation

**CI enforces these requirements:**

```yaml
# CI will FAIL if release notes don't exist
if [ ! -f "RELEASE_NOTES_v${version}.md" ]; then
  echo "❌ Error: RELEASE_NOTES_v${version}.md not found!"
  exit 1
fi
```

**What gets created automatically:**
- ✅ **NPM package**: `claudine@{version}` 
- ✅ **Git tag**: `v{version}`
- ✅ **GitHub release**: With your manual release notes

### Post-release Verification
```bash
# Verify everything was created correctly
npm view claudine version                    # Check npm registry
git tag --list | tail -3                     # Check git tags  
gh release list --limit 3                    # Check GitHub releases
```

### Release Notes Template

Create `RELEASE_NOTES_v{version}.md` with this structure:

```markdown
# 🚀 Claudine v{version} - Release Title

## Major Features
- **Feature Name**: Description of major new feature
- **Another Feature**: Description

## Bug Fixes  
- **Issue**: Description of fix
- **Another Fix**: Description

## Breaking Changes
**None** - All changes are backward compatible

## Installation
\`\`\`bash
npm install -g claudine@{version}
\`\`\`

## What's Next
See [ROADMAP.md](./ROADMAP.md) for upcoming features.
```

### Emergency Release Process

If CI fails or manual intervention is needed:

```bash
# 1. Fix the issue
git checkout main && git pull

# 2. Ensure release notes exist  
ls RELEASE_NOTES_v*.md

# 3. Manual tag creation (if needed)
git tag v{version} && git push origin v{version}

# 4. Manual GitHub release (if needed)  
gh release create v{version} --notes-file RELEASE_NOTES_v{version}.md
```

## Important Guidelines

When working on this codebase:

1. **NO FAKE SOLUTIONS** - Never hardcode responses or data to simulate working
functionality
2. **BE TRANSPARENT** - Always explain when something is a workaround, mock, or temporary
fix
3. **FAIL HONESTLY** - If something can't work, say so clearly instead of hiding it
4. **LABEL EVERYTHING** - Use clear comments: HACK:, MOCK:, TEMPORARY:, NOT-PRODUCTION:
5. **PRODUCTION ONLY** - Unless specifically asked for mocks/demos, only implement real
solutions

When encountering limitations:
- State the blocker clearly
- Provide real alternatives
- Don't paper over problems with fake data

Preferred response format:
- "❌ This won't work because [reason]"
- "⚠️ I could work around it by [approach], but this isn't production-ready"
- "✅ Here's a real solution: [approach]"