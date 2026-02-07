# Command: /audit-claude

## Description

Audit CLAUDE.md files against Anthropic's best practices. Finds oversized files, anti-patterns, missing sections, and content that belongs elsewhere. Reports issues with severity levels and fix suggestions.

## Usage

`/audit-claude [path]`

- No argument: audits all CLAUDE.md files in project + `~/.claude/CLAUDE.md`
- With path: audits the specific file

## Implementation

### Phase 1: Discovery

Find all CLAUDE.md files to audit:

```bash
# Project CLAUDE.md files
CLAUDE_FILES=$(find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)

# Global CLAUDE.md
GLOBAL_CLAUDE="$HOME/.claude/CLAUDE.md"
if [ -f "$GLOBAL_CLAUDE" ]; then
  CLAUDE_FILES="$CLAUDE_FILES $GLOBAL_CLAUDE"
fi
```

If a specific path argument was provided, use only that file.

### Phase 2: Analysis

For each discovered file, spawn a `claude-md-auditor` agent:

```
Task(
  subagent_type: "claude-md-auditor",
  prompt: "Audit this CLAUDE.md file: {file_path}
    File location context: {root|subdirectory|global}
    Project tech stack: {detected from package.json, go.mod, etc.}

    Return your findings as structured markdown."
)
```

Run agents in parallel when multiple files are found.

### Phase 3: Report

Combine all agent outputs into a single report:

```markdown
## CLAUDE.md Audit Report

### File: ./CLAUDE.md ({line_count} lines, ~{token_estimate} tokens)

#### CRITICAL
- [{CATEGORY}] {description}. {fix suggestion}.

#### HIGH
- [{CATEGORY}] Lines {start}-{end}: {description}. {fix suggestion}.

#### MEDIUM
- [{CATEGORY}] {description}. {fix suggestion}.

#### LOW
- [{CATEGORY}] {description}. {fix suggestion}.

### Summary
- {N} Critical, {N} High, {N} Medium, {N} Low
- Estimated reducible lines: ~{N} (move to docs/reference/)
- Estimated token cost per session: ~{N} tokens
```

Present the report directly to the user. Do NOT write to `.docs/` — this is a diagnostic command.

## Output Format

Findings grouped by severity (Critical > High > Medium > Low), each with:
- **Category tag** in brackets: SIZE, MISSING, ANTI-PATTERN, STRUCTURE, CONTENT, HIERARCHY, INTEGRATION, CLAUDE-SPECIFIC
- **Line reference** when applicable
- **Explanation** of why it's an issue
- **Fix suggestion** with concrete action
