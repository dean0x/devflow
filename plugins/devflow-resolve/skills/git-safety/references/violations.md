# Git Safety Violations

Common git safety violations:

## Violations

| Violation | Risk | Fix |
|-----------|------|-----|
| Parallel git commands | Index corruption | Run git commands sequentially |
| Force push to main | Lost commits | Never force push protected branches |
| Committing secrets | Security breach | Use [detection.md](detection.md) patterns |
| Amending after push | History rewrite | Create new commit instead |
| Skipping hooks | Quality bypass | Never use `--no-verify` |
| Ignoring lock files | Corruption | Wait for lock release |

## Quick Reference

See [commands.md](commands.md) for safe command patterns and [detection.md](detection.md) for sensitive file detection.
