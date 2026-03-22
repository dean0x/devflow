### Changed
- **Init wizard**: individual feature prompts with explanatory notes replace extras multiselect
- **Init wizard**: scope-aware `.claudeignore` batch install across all discovered projects (user scope)
- **Init wizard**: project discovery via `~/.claude/history.jsonl` to find all Claude-used git repos
- **Init wizard**: managed settings sudo confirmation moved to prompt phase (before spinner)
- **Init wizard**: safe-delete prompt moved to prompt phase for uninterrupted install

### Added
- `--hud` flag for `devflow init` to explicitly enable HUD
- `discoverProjectGitRoots()` utility for finding projects from Claude history

### Removed
- Extras multiselect (`buildExtrasOptions`) — replaced by individual feature prompts
