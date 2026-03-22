### Added
- **Configurable HUD** replacing bash statusline — 14 components, on/off model (#155)
- **HUD components**: directory, git branch, ahead/behind, diff stats, release info, worktree count, model, context usage, version badge, session duration, session cost, usage quota, todo progress, config counts
- **`--hud-only` flag** for standalone HUD install
- **`--no-hud` flag** to skip HUD during init
- **`devflow hud` command** (--status, --enable, --disable, --detail, --no-detail)
- **Version upgrade notification**: `✦ Devflow vX.Y.Z · update: npx devflow-kit init` (yellow, always visible even when HUD disabled)
- **Skill shadowing docs** and HUD options added to README (#156)
- **Simplifier agent** — 8 structured slop detection categories (#120)
- **Scrutinizer agent** — stub detection patterns with reference file (#121)
- **Shepherd agent** — goal-backward verification, artifact depth checking, stub type, re-verification (#124)

### Changed
- Init flow: HUD preset picker (5 options) → simple yes/no confirm
- `--disable` keeps statusLine registered (version badge still renders)
- Manifest `features.hud` field: `string|false` → `boolean`

### Fixed
- HUD base branch detection matching raw commit hashes from reflog (#156)
- HUD comparing main vs main (0/0 always) — now compares against origin/main

### Removed
- HUD preset system (minimal/classic/standard/full)
- `--configure`, `--preset`, `--hud <preset>` flags
- `speed`, `tool-activity`, `agent-activity` components
