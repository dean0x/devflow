# Security Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03_0155

## Issues in Your Changes (BLOCKING)

### CRITICAL

No CRITICAL issues found.

### HIGH

**Tester agent executes arbitrary Bash commands in QA scenarios without sandboxing** - `shared/agents/tester.md:44-66`
**Confidence**: 85%
- Problem: The Tester agent is instructed to "Execute the action via Bash" for each scenario (line 44, 62) and "Set up preconditions (create files, set state)" (line 63). This agent runs with `model: sonnet` and has Bash access through the `devflow:qa` skill (`allowed-tools: Read, Grep, Glob, Bash`). Since the Tester designs its own scenarios from ORIGINAL_REQUEST and EXECUTION_PLAN (potentially attacker-influenced content from a GitHub issue body), a malicious issue could induce the Tester to execute harmful commands during "scenario setup" or "precondition creation." The agent has no explicit deny list or sandboxing constraints.
- Fix: Add explicit boundary constraints to the Tester agent and QA skill restricting Bash commands to read-only operations, test runners, and curl. Example addition to tester.md Boundaries section:
```markdown
**Bash command restrictions:**
- NEVER execute destructive commands (rm -rf, sudo, eval, exec)
- NEVER write to directories outside of /tmp/devflow-tester-*
- NEVER install packages or modify system state
- ONLY run: test runners, curl, read-only file inspection, build commands
```
  Alternatively, add a `tools` frontmatter field to restrict tool access at the platform level, consistent with other agents that use the `tools` field.

### MEDIUM

**Dev server log written to predictable /tmp path** - `shared/agents/tester.md:94`
**Confidence**: 82%
- Problem: The Tester agent writes dev server output to `/tmp/devflow-tester-server.log`. On multi-user systems, this path is predictable and could be pre-created as a symlink by a local attacker (symlink attack / CWE-59), causing the dev server output to overwrite an arbitrary file. While this is a low-probability scenario in typical single-user development environments, it is a recognized pattern vulnerability.
- Fix: Use `mktemp` to create a unique temporary file instead of a hardcoded path:
```markdown
- Run in background: `LOG=$(mktemp /tmp/devflow-tester-XXXXXX.log); npm run dev > "$LOG" 2>&1 &`
```

**Tester agent reads .env files during port detection** - `shared/agents/tester.md:89`
**Confidence**: 80%
- Problem: The Tester agent is instructed to detect port from `.env` files (line 89: "Framework config: vite.config.ts (server.port), next.config.js, .env (PORT)"). Reading `.env` may inadvertently expose secrets in the agent's context window if the `.env` file contains sensitive credentials alongside PORT. While the agent only needs the PORT value, the instruction does not restrict which `.env` keys are read.
- Fix: Specify to extract only the PORT variable, not read the entire .env file:
```markdown
- `.env` file: extract only `PORT=` value via `grep ^PORT= .env | cut -d= -f2` — do not read entire .env
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shell scripts use `printf '%s\n'` but still pipe through `json_valid` and `json_extract_messages` without input sanitization** - `scripts/hooks/background-learning:2438-2450`, `scripts/hooks/background-memory-update:2460-2468`
**Confidence**: 80%
- Problem: The change from `echo` to `printf '%s\n'` is a positive improvement (prevents interpretation of escape sequences like `\n`, `-e`, `-n` in user-controlled content), but the piped data flows into `json_valid` and `json_extract_messages` which use jq or node to parse. If the transcript or LLM response contains adversarial content that exploits jq or the node JSON parser, the sanitization at the `printf` layer is insufficient. The shell scripts process session transcripts that could contain arbitrary user input.
- Fix: This is a defense-in-depth observation. The current `printf` change is a good hardening step. Consider adding input size limits before piping to json processing (e.g., `head -c 100000` to cap input size) to prevent potential resource exhaustion from oversized transcript entries.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing security issues found in reviewed files.

## Suggestions (Lower Confidence)

- **Tester agent process cleanup race condition** - `shared/agents/tester.md:103-106` (Confidence: 70%) -- The `kill $DEV_SERVER_PID` followed by `kill -- -$DEV_SERVER_PID` could fail to clean up child processes if the PID is reused between the two kill calls. Consider using process groups (`setsid`) from the start.

- **No `tools` frontmatter on Tester agent** - `shared/agents/tester.md:1-6` (Confidence: 65%) -- Other agents in the project use `tools` frontmatter to platform-restrict tool access (per CLAUDE.md conventions). The Tester agent relies on skill-level `allowed-tools` but does not declare its own `tools` restriction, which could allow broader tool access than intended if tool restrictions change.

- **QA skill `allowed-tools` includes Bash** - `shared/skills/qa/SKILL.md:4` (Confidence: 60%) -- The QA skill declares `allowed-tools: Read, Grep, Glob, Bash`. While Bash is necessary for test execution, most pattern skills in this project are read-only. The QA skill's Bash access is intentional but worth noting as it creates a wider attack surface than other skills.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The primary concern is the new Tester agent, which has Bash execution capabilities driven by dynamically-generated scenarios. While this is architecturally necessary for QA testing, the agent lacks explicit safeguards against executing destructive commands, especially when test scenarios are derived from external input (GitHub issue bodies). The shell script hardening (`echo` to `printf`) is a positive security improvement. The rename from Shepherd to Evaluator and plugin rename from frontend-design to ui-design carry no security implications. Adding explicit command restrictions to the Tester agent's Boundaries section would address the main finding.
