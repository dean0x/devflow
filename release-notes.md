### Added
- **EXPLORE depth classification** (GUIDED/ORCHESTRATED) with skimmer-based codebase analysis
- **`devflow:explore`** orchestration skill for ambient EXPLORE intent
- **TDD enforcement**: `test-driven-development` skill auto-loads for IMPLEMENT, PLAN, and CODER intents
- **Stale skill name detector** in tests covers all renamed/deleted skills

### Changed
- **Orchestration skills**: 7 skills renamed with `:orch` suffix — `implement:orch`, `explore:orch`, `debug:orch`, `plan:orch`, `review:orch`, `resolve:orch`, `pipeline:orch`
- **`self-review` skill** renamed to `quality-gates`
- **`ambient-router` skill** renamed to `router`
- **Preamble**: simplified to detection-only; skill mappings moved to router skill
- **Output branding**: standardized to `DevFlow: INTENT/DEPTH` across all ambient outputs
- **Integration test `hasRequiredSkills()`**: uses bounded matching instead of substring

### Removed
- **`implementation-patterns` skill** (merged into `patterns`)
- **`search-first` skill** (merged into `research`)
- **Dead `isFirstToolASkill()` function** from integration test helpers
