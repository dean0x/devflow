---
name: release:guided
description: GUIDED release — pre-release checks, git agent, report results
user-invocable: false
---

# Release (GUIDED)

Direct main-session release for GUIDED depth. Check config, validate, release, report.

1. **Check config** — Verify `.release/RELEASE-FLOW.md` exists. If missing, inform user to run a full release first (ORCHESTRATED) to discover and store the project's release process.
2. **Load git skill** — Load `devflow:git` via Skill tool.
3. **Spawn Validator** — `Agent(subagent_type="Validator")` for pre-release checks (build + test).
4. **Spawn Git agent** — `Agent(subagent_type="Git")` with `create-release` operation.
5. **Report results** — Present release outcome with tag, version, and any issues.
