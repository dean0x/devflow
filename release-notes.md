### Added
- **Search-first skill** (#111) — New skill enforcing research before building custom utility code. 4-phase loop: Need Analysis → Search (via Explore subagent) → Evaluate → Decide (Adopt/Extend/Compose/Build)
- **Reviewer confidence thresholds** (#113) — Each review finding now includes a visible confidence score (0-100%). Only ≥80% findings appear in main sections; lower-confidence items go to a capped Suggestions section. Adds consolidation rules to group similar issues and skip stylistic preferences
- **Version manifest** (#91) — Tracks installed version, plugins, and features in `manifest.json`. Enables upgrade detection during `devflow init` and shows install status in `devflow list`

### Fixed
- **Synthesizer review glob** — Fixed `${REVIEW_BASE_DIR}/*-report.*.md` glob that matched zero reviewer files; now uses `${REVIEW_BASE_DIR}/*.md` with self-exclusion
