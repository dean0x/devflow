### Added
- **Skill shadowing** — `devflow skills shadow <name>` copies a skill for personal overrides
  - `devflow skills unshadow <name>` restores the original
  - `devflow skills list-shadowed` shows active overrides
  - Shadowed skills are preserved during `devflow init` (not overwritten)
  - Uninstall warns about remaining shadow files
- **Cross-platform hook wrapper** — `run-hook` polyglot entry point for Windows compatibility
  - Discovers bash on Windows (Git Bash, WSL, MSYS2) via standard paths
  - All hook scripts renamed to drop `.sh` extension
- **Ambient skill injection at session start** — `session-start-memory` hook injects `ambient-router` SKILL.md directly into context
  - Eliminates the need for a Read tool call to load the ambient router
  - Only activates when ambient mode is enabled
- **Skill activation integration tests** — `vitest.integration.config.ts` + helpers for live classification tests
  - Separate `npm run test:integration` for tests requiring `claude` CLI

### Changed
- **Ambient depth labels renamed** — STANDARD→GUIDED, ESCALATE→ELEVATE for clarity
  - GUIDED: skills guide the response; ELEVATE: elevate to a full workflow
- **Hook commands use `run-hook` dispatch** — Settings template and CLI now register hooks via `run-hook <name>` instead of direct `.sh` paths
- **`devflow init` auto-upgrades hook format** — Removes old `.sh`-style hooks before re-adding, ensuring existing installs migrate seamlessly
- **Skill descriptions audited** — All 12 review-only skills updated to trigger-format (`"This skill should be used when..."`)
- **Skills architecture docs** — Added description rules section with good/bad examples
- **`chmod` skipped on Windows** — `chmodRecursive` no longer runs on `win32` platform

### Fixed
- **Ambient preamble missing skill path** — Hook now tells Claude to `Read` skills from `~/.claude/skills/<name>/SKILL.md`
- **Ambient `--status` hook path parsing** — Handles `run-hook <name>` format instead of assuming direct `.sh` path
