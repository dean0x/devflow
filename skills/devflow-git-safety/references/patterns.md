# Git Safety Patterns

Correct patterns for safe git operations:

## Patterns

### Sequential Operations

```bash
# Always chain git commands with &&
git add file.ts && git commit -m "message" && git push

# Never run in parallel - use sequential execution
```

### Lock Handling

```bash
# Check for and wait on locks
wait_for_lock_release() {
  while [ -f .git/index.lock ]; do
    sleep 0.1
  done
}
```

### Safe Amend

```bash
# Only amend if not pushed
if ! git log origin/$(git branch --show-current)..HEAD | grep -q .; then
  git commit --amend  # Safe - not pushed
fi
```

## Quick Reference

See [commands.md](commands.md) for complete safe command examples and [detection.md](detection.md) for sensitive file patterns.
