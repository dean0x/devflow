# Session Management and Cleanup

## Team Lifecycle

```
1. Lead creates team
2. Lead spawns teammates
3. Teammates work independently
4. Debate rounds (teammates message directly)
5. Lead collects consensus
6. Lead shuts down teammates
7. Lead calls cleanup
8. Lead verifies no orphans
```

---

## Cleanup Rules

### Lead Responsibilities

1. **Always call cleanup** - Even if team work was interrupted or errored
2. **Shut down teammates first** - Before calling cleanup
3. **Verify completion** - Check that no orphaned sessions remain

### Error Handling

If a teammate errors or hangs:
1. Send shutdown message to the teammate
2. Wait briefly for graceful shutdown
3. Proceed with cleanup for remaining team
4. Report the failed teammate in final output

### Orphan Detection

After cleanup, verify:
- No tmux sessions from the team remain (split-pane mode)
- No background processes from teammates
- Team config at `~/.claude/teams/{team-name}/` is cleaned up

---

## Known Limitations

| Limitation | Mitigation |
|-----------|------------|
| No session resumption for teammates | Start fresh; don't rely on teammate state persistence |
| One team per session | Queue team work sequentially if needed |
| Task status may lag | Use direct messages for time-sensitive coordination |
| No nested teams | Teammates cannot spawn sub-teams; keep hierarchy flat |
| Split-pane requires tmux/iTerm2 | Fall back to in-process mode if unavailable |

---

## Cost Management

### Token Optimization

| Strategy | Savings |
|----------|---------|
| Use haiku for validation teammates | ~70% per validation agent |
| Limit debate to 2 rounds | Prevents runaway token usage |
| Size teams to task (don't over-spawn) | Fewer agents = fewer tokens |
| Shut down teammates promptly | No idle token consumption |

### When NOT to Use Teams

- Simple, single-focus tasks (use regular subagent)
- Tasks requiring sequential dependency (no parallelism benefit)
- Cost-sensitive operations where subagent is sufficient
- Tasks where debate adds no value (e.g., formatting, simple fixes)

---

## Sequential Team Transition Protocol

Commands that create multiple teams (e.g., `/implement`, `/specify`) MUST follow this 4-step protocol between teams. Skipping steps causes silent failures due to the one-team-per-session constraint.

```
Step 1: SHUTDOWN — Send shutdown_request to each teammate by name
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Phase complete")
  Wait for each shutdown_response (approve: true)

Step 2: DELETE — Remove team resources
  TeamDelete

Step 3: VERIFY — Confirm cleanup succeeded
  If TeamDelete returned success → proceed
  If TeamDelete failed → retry once after 5s
  If retry fails → HALT and report to user:
    "Team cleanup failed for {team-name}. Cannot create next team."

Step 4: CREATE — Only now create the next team
  TeamCreate(team_name: "{next-team-name}")
```

### Failure Modes

| Failure | Action |
|---------|--------|
| Teammate ignores shutdown_request | Wait 30s, then proceed to TeamDelete (force cleanup) |
| TeamDelete fails | Retry once after 5s delay |
| TeamDelete retry fails | HALT execution, report to user |
| TeamCreate fails after successful delete | Retry once; if fails, fall back to parallel Task() subagents |
