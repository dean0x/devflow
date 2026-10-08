# Skill Catalog

Reference for companion skills loaded by commands. A command loads a companion only when its own main thread uses the skill. The orchestrating commands delegate their work to agents, which load the skills they need, so only RELEASE, whose main thread drives git, loads one before its first phase.

## Command Companion Skills

| Intent | Command | Companions |
|--------|---------|------------|
| IMPLEMENT | /implement | (none) |
| DEBUG | /debug | (none) |
| PLAN | /plan | (none) |
| REVIEW | /code-review | (none) |
| RELEASE | /release | `devflow:git` |
| EXPLORE | /explore | (none) |
| RESEARCH | /research | (none — agents load type-specific skills internally) |
| RESOLVE | /resolve | (none) |

## File-Type Conditional Skills

Commands and Code agents load language/framework skills based on files touched:

| Pattern | Skill |
|---------|-------|
| .ts, .tsx | devflow:typescript |
| .tsx, .jsx | devflow:react |
| .go | devflow:go |
| .java | devflow:java |
| .py | devflow:python |
| .rs | devflow:rust |
| CSS/UI/styling | devflow:ui-design |
| Forms/API/input | devflow:boundary-validation |
| Auth/crypto/secrets | devflow:security |

## Agent-Internal Skills

These skills are installed whenever a selected plugin owns or requires them, and are loaded by agents internally at runtime rather than by a command:

- devflow:review-methodology — Full review process (6-step, 3-category classification)
- devflow:complexity — Cyclomatic complexity, deep nesting analysis
- devflow:consistency — Naming convention, pattern deviation detection
- devflow:database — Index analysis, query optimization, migration safety
- devflow:dependencies — CVE detection, license audit, outdated packages
- devflow:documentation — Doc drift, stale comments, missing API docs
- devflow:regression — Lost functionality, broken exports, behavioral changes
- devflow:architecture — SOLID analysis, coupling detection, layering issues
- devflow:accessibility — WCAG compliance, ARIA roles, keyboard navigation
- devflow:performance — N+1 queries, memory leaks, caching opportunities
- devflow:qa — Scenario-based acceptance testing, evidence collection
- devflow:compliance — Regulatory code-level controls: GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX; used by Review agent (compliance focus, diff-driven), Design agent (gap-analysis compliance focus), and Code agent (when handed `COMPLIANCE_FRAMEWORKS` other than `off` and regulated surface detected); feature-owned, not plugin-scoped, installed on every machine with all six framework references — the lens runs from the settings line's `COMPLIANCE` (the machine's ids plus the repository's `project.json` ids), and an agent loads `references/{id}.md` only for the ids it is given. SKILL.md and the rule are dynamically composed at install time from per-framework fragment files (`frameworks/{id}/fragment.md` within the compliance skill source); each framework also has a `frameworks/{id}/reference.md` in source, installed as `references/{id}.md` in the skill directory. The source `references/` directory holds only the two always-present files (`detection.md` and `sources.md`); per-framework reference files live under `frameworks/` in source. Installed SKILL.md is stamped with the machine's selected frameworks only (a neutral stamp when compliance is off); `devflow skills shadow compliance` seeds from the shipped template so a later `--set` still stamps it. Shadow SKILL.md without composition tokens bypasses composition (C1 passthrough); flagged in `devflow compliance --status`.
