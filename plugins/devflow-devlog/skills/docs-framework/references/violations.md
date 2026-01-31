# Documentation Framework Violations

Common violations of documentation conventions with detection patterns and fixes.

---

## Naming Convention Violations

| Violation | Bad Example | Correct Example | Fix |
|-----------|-------------|-----------------|-----|
| Wrong timestamp format | `2025-1-5` | `2025-01-05_1430` | Use `YYYY-MM-DD_HHMM` |
| Missing time in timestamp | `2025-01-05` | `2025-01-05_1430` | Include `_HHMM` suffix |
| Unsanitized branch slug | `feature/auth` | `feature-auth` | Replace `/` with `-` |
| Wrong case for artifacts | `Status-2025-01-05.md` | `2025-01-05_1430.md` | Use lowercase except special indexes |
| Wrong case for indexes | `index.md` | `INDEX.md` | UPPERCASE for special indexes |
| Files outside .docs | `docs/status.md` | `.docs/status/2025-01-05_1430.md` | Use `.docs/` root |
| Missing INDEX.md | Status files without index | Create `INDEX.md` | Every directory needs index |
| Special chars in slug | `oauth-2.0-auth` | `oauth-20-auth` | Strip non-alphanumeric except `-` |

---

## Directory Structure Violations

### Wrong: Flat Structure

```
project/
├── status-2025-01-05.md    # Wrong location
├── review-auth.md          # Missing timestamp, wrong location
└── catch_up.md             # Wrong case, wrong location
```

### Wrong: Non-standard Subdirectories

```
.docs/
├── logs/                   # Should be status/
├── reports/                # Should be reviews/{branch-slug}/
└── notes.md                # Should be in appropriate subdir
```

---

## Timestamp Violations

### Missing Leading Zeros

```bash
# WRONG
date +%Y-%m-%d_%H%M  # Could produce: 2025-1-5_930

# RIGHT
date +%Y-%m-%d_%H%M  # Always produces: 2025-01-05_0930
```

Note: `date` command handles padding, but manual timestamps often miss it.

### Wrong Separator

```bash
# WRONG
2025-01-05-1430   # Dash instead of underscore
2025/01/05_1430   # Slash in date
2025.01.05_1430   # Dot in date

# RIGHT
2025-01-05_1430   # Underscore separating date from time
```

---

## Branch Slug Violations

### Unhandled Slash

```bash
# WRONG - produces invalid filename
BRANCH_SLUG=$(git branch --show-current)
# Result: feature/auth -> invalid path

# RIGHT - sanitizes slash
BRANCH_SLUG=$(git branch --show-current | sed 's/\//-/g')
# Result: feature/auth -> feature-auth
```

### Missing Fallback

```bash
# WRONG - fails in detached HEAD
BRANCH_SLUG=$(git branch --show-current)
# Result: empty string -> broken path

# RIGHT - with fallback
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")
# Result: (detached HEAD) -> standalone
```

---

## Topic Slug Violations

### Preserving Special Characters

```bash
# WRONG - special chars break filenames
TOPIC="Bug: Can't login (v2.0)"
SLUG="Bug:-Can't-login-(v2.0)"

# RIGHT - stripped and normalized
SLUG="bug-cant-login-v20"
```

### Not Truncating Long Names

```bash
# WRONG - excessively long filename
TOPIC="This is a very long topic name that describes the entire feature..."
SLUG="this-is-a-very-long-topic-name-that-describes-the-entire-feature"

# RIGHT - truncated at 50 chars
SLUG="this-is-a-very-long-topic-name-that-describes-the"
```

---

## File Type Violations

### Wrong Case for Special Files

```bash
# WRONG
catch_up.md      # Should be CATCH_UP.md
index.md         # Should be INDEX.md
knowledge_base.md # Should be KNOWLEDGE_BASE.md

# RIGHT - UPPERCASE for special indexes
CATCH_UP.md
INDEX.md
KNOWLEDGE_BASE.md
```

### Wrong Case for Artifacts

```bash
# WRONG
Status-2025-01-05_1430.md
Security-Report.md

# RIGHT - lowercase for artifacts
2025-01-05_1430.md
security-report.2025-01-05_1430.md
```

---

## Template Usage Violations

### Missing Required Sections

```markdown
# WRONG - missing key sections

# Status Update

Did some work today.
```

```markdown
# RIGHT - all required sections

# Status Update - 2025-01-05_1430

## Session Summary
Implemented user authentication feature.

## Branch Context
- **Branch**: feat/auth
- **Base**: main
- **Status**: 3 commits ahead

## Work Completed
- Added JWT validation middleware
- Created login endpoint

## Files Changed
- `src/auth/jwt.ts` - JWT utilities
- `src/routes/login.ts` - Login endpoint

## Next Steps
- [ ] Add refresh token support
- [ ] Write integration tests
```

---

## Detection Patterns

Use these patterns to find violations:

```bash
# Find files outside .docs/
find . -name "*.md" -path "*/docs/*" ! -path "*/.docs/*"

# Find wrong timestamp format (missing underscore)
grep -r "^\d{4}-\d{2}-\d{2}[^_]" .docs/

# Find lowercase special indexes
ls .docs/**/index.md .docs/**/catch_up.md 2>/dev/null

# Find uppercase artifacts (excluding special files)
find .docs -name "*.md" | grep -v "INDEX\|CATCH_UP\|KNOWLEDGE_BASE" | xargs -I {} basename {} | grep "^[A-Z]"

# Find unsanitized branch names in paths
find .docs/reviews -type d -name "*/*" 2>/dev/null
```

---

## Quick Reference

For correct patterns and templates, see [patterns.md](patterns.md).
