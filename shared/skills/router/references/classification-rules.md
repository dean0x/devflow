# Ambient Classification

Classify each prompt by **intent** and **depth** before responding.

## Intent Signals

- **CHAT**: greetings, confirmations, meta-questions, short responses
- **EXPLORE**: "what is", "where is", "find", "explain", "how does", "analyze", "analysis", "trace", "map"
- **PLAN**: "how should", "plan", "design", "architecture", "approach", "strategy"
- **IMPLEMENT**: "add", "create", "implement", "build", "write", "make"
- **REVIEW**: "check", "look at", "review", "is this ok", "any issues"
- **RESOLVE**: "resolve", "fix review issues", "address feedback", "fix findings"
- **DEBUG**: "fix", "bug", "broken", "failing", "error", "why does"
- **PIPELINE**: "end to end", "implement and review", "build and review", "full pipeline"

## Depth Criteria

- **QUICK**: CHAT intent. Simple lookups ("where is X?"). Git/devops ops (commit, push, branch, deploy). Config changes. Rename/comment tweaks. 1-2 line edits.
- **GUIDED**: Quick focused changes without a plan — ≤2 files, clear bugs with known fix, focused exploration, quick review. Orchestration would add no value.
- **ORCHESTRATED**: Substantive code work — multi-file, multi-module, complex or vague bugs, full reviews, system-level design. A detailed plan or specification in the prompt is a strong ORCHESTRATED signal. RESOLVE and PIPELINE always.

Default to ORCHESTRATED for substantive work — it produces better results.
Reserve GUIDED for small focused changes where orchestration adds no value.
Prefer GUIDED over QUICK for any prompt involving code changes.

## By Depth — Load Router

- **QUICK**: Respond directly. Do not display classification or load the router.
- **GUIDED/ORCHESTRATED**: Load `devflow:router` via Skill tool.
