### Added
- **Version update notification** — statusline shows magenta `⬆ X.Y.Z` badge when newer devflow-kit is available (24h cached npm check, fully async)

### Fixed
- **Skimmer agent** — enforce rskim usage via `tools: ["Bash", "Read"]` platform restriction and strict sequential workflow; prevents fallback to Grep/Glob
- **Init multiselect** — remove redundant "(optional)" suffix from plugin hints
- **Init multiselect** — hide `audit-claude` plugin (not production-ready; still installable via `--plugin=audit-claude`)
- **Statusline portability** — replace macOS-only `stat -f %m` with portable `get_mtime()` helper (macOS + Linux)
