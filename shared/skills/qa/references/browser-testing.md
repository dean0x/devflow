# Browser Testing Procedures

Detailed procedures for dev server lifecycle and browser scenario execution in QA.

---

## Dev Server Lifecycle

When web-facing changes detected, manage a dev server for browser testing:

### 1. Check for Already Running Server

Before starting anything, check if a dev server is already running:
- `lsof -i :3000 -i :5173 -i :8080 -i :4200 -i :8000 -t 2>/dev/null`
- If a server is already running on the expected port: USE IT (do not start another)
- Record whether server was pre-existing (skip cleanup if so)

### 2. Discover Server Command (if no running server)

Read `package.json` (or equivalent) to find the dev server command:
- Check `scripts.dev`, `scripts.start`, `scripts.serve` (in that order)
- For Python: look for `manage.py`, Flask/FastAPI entry points
- For Go: check `Makefile` or `go run` targets
- If no dev script found: skip browser scenarios, report "No dev server script — browser scenarios skipped"

### 3. Detect Port

Determine port from (in order):
- Framework config: `vite.config.ts` (server.port), `next.config.js`
- `.env` file: extract only `PORT` — `grep ^PORT= .env | cut -d= -f2` (do NOT read entire .env)
- Script definition: parse `--port` flags in the dev script
- Defaults by framework: Next.js→3000, Vite→5173, CRA→3000, Django→8000, Go→8080

### 4. Start Server (if not already running)

- Create a unique log file: `SERVER_LOG=$(mktemp /tmp/devflow-tester-XXXXXX.log)`
- Run in background: `npm run dev > "$SERVER_LOG" 2>&1 &`
- Record PID: `DEV_SERVER_PID=$!`
- Poll for readiness: `curl -s -o /dev/null -w "%{http_code}" http://localhost:{port}/`
- Retry up to 15 times, 2s intervals (30s max)
- If timeout: kill server, skip browser scenarios, report "Dev server did not become ready within 30s"

### 5. Run Browser Scenarios

(See Browser Execution section below)

### 6. Cleanup (only for servers WE started)

- Kill dev server: `kill $DEV_SERVER_PID 2>/dev/null`
- Kill process group: `kill -- -$DEV_SERVER_PID 2>/dev/null || true`
- Remove log file: `rm -f "$SERVER_LOG"`
- NEVER kill a pre-existing server

---

## Browser Execution

Requires: Chrome MCP tools available + dev server running.

1. Check Chrome availability: attempt `mcp__claude-in-chrome__tabs_context_mcp`
   - If unavailable: skip browser scenarios, note "Chrome MCP tools not available"
   - If available: create a new tab with `mcp__claude-in-chrome__tabs_create_mcp`

2. For each browser scenario:
   a. Navigate: `mcp__claude-in-chrome__navigate` to the relevant page
   b. Read content: `mcp__claude-in-chrome__get_page_text` or `mcp__claude-in-chrome__read_page`
   c. Find elements: `mcp__claude-in-chrome__find` for buttons, forms, text
   d. Interact: `mcp__claude-in-chrome__form_input` for form fields
   e. Assert via JS: `mcp__claude-in-chrome__javascript_tool` for state checks
   f. Check console: `mcp__claude-in-chrome__read_console_messages` for errors
   g. Record evidence from each step

3. After all browser scenarios: close the tab created in step 1

---

## Bash Execution Constraints

When executing scenarios via Bash, these constraints are mandatory:

**NEVER execute:**
- Destructive filesystem commands: `rm -rf`, `rmdir`, `truncate`, `shred`
- Privilege escalation: `sudo`, `su`, `chown`, `chmod` on system directories
- Code injection vectors: `eval`, `exec`, shell substitution on untrusted input
- Package management: `npm install -g`, `pip install`, `brew install`, `apt-get`
- Network exfiltration: outbound curl/wget to external hosts not under test

**ONLY run:**
- Test runners: `npm test`, `pytest`, `go test`, `cargo test`, `jest`, `mocha`
- Build commands: `npm run build`, `go build`, `cargo build`
- Read-only file inspection: `cat`, `ls`, `diff`, `head`, `tail`, `grep`
- Readiness checks: `curl` to `localhost` only, `lsof`, `pg_isready`, `redis-cli ping`
- Process management for servers WE started: `kill $DEV_SERVER_PID`

**Filesystem writes restricted to:**
- Temporary files created via `mktemp` in `/tmp/devflow-tester-*`
- Project test directories (e.g., `__tests__/fixtures/`, `test/data/`)
