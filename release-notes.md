### Added
- **`--dry-run` flag** for `devflow uninstall` — preview removal plan without deleting anything

### Fixed
- **Ambient skill loading** — removed `allowed-tools` restriction from ambient-router so skills actually load via the Skill tool
- **Ambient hook preamble** — explicit Skill tool instruction ensures models invoke skills rather than responding directly
- **Init wizard** — hide `devflow-ambient` from plugin multiselect (auto-included via ambient prompt)
- **Working memory** — replaced broken `--resume` with transcript-based background updater
