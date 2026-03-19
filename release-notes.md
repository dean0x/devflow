### Added
- **Ambient agent orchestration**: ORCHESTRATED tier spawns agent pipelines for IMPLEMENT, DEBUG, PLAN intents
- **Orchestration skills**: `implementation-orchestration`, `debug-orchestration`, `plan-orchestration` for ambient agent pipelines
- **`knowledge-persistence` skill** (#145) — extraction procedure, lock protocol, loading instructions for project knowledge
- **Knowledge loading phase** (#145) — `/debug`, `/specify`, `/self-review` now load project knowledge at startup
- **Pitfall recording phase** (#145) — `/code-review`, `/resolve` record pitfalls to `.memory/knowledge/pitfalls.md`
- **Knowledge directory** (#145) — `.memory/knowledge/` with `decisions.md` (ADR-NNN, append-only) and `pitfalls.md` (area-specific gotchas)

### Changed
- **Ambient mode**: Three depth tiers (QUICK/GUIDED/ORCHESTRATED) replacing old QUICK/GUIDED/ELEVATE
- **Ambient mode**: GUIDED tier for small-scope IMPLEMENT (≤2 files), simple DEBUG, focused PLAN, and REVIEW — main session with skills + Simplifier
- **Ambient mode**: BUILD intent renamed to IMPLEMENT for clarity
- **Coder agent**: Added `test-driven-development` and `search-first` to permanent skills
- **Command phase numbering** (#145) — renumbered fractional phases to sequential integers across 12 command files

### Fixed
- **Agent metadata** (#146) — fixed `subagent_type` in debug, added missing YAML frontmatter
- **Plugin count** (#146) — corrected to "8 core + 9 optional"
- **Skills catalog** (#146) — cataloged 3 missing skills in reference
- **Debug command** (#147) — removed non-standard `name=` parameter
- **Plugin descriptions** (#147, #148) — synced across plugin.json, plugins.ts, marketplace.json
- **Simplifier agent** (#148) — added Output/Boundaries sections
- **Plugin metadata** (#148) — added homepage/repository/license/keywords to 3 plugins

### Removed
- **`/ambient` command**: Ambient mode is now hook-only. Use `devflow ambient --enable` to activate.

### Behavioral Changes
- EXPLORE intent now always classifies as QUICK (was split QUICK/GUIDED)
- Simple text edits ("Update the README") classify as QUICK (was BUILD/GUIDED)
- Debug agent budget cap removed — agents scale to investigation needs
