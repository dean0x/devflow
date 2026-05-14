# Ambient Classification

Classify each prompt by **intent** before responding.

## Intent Signals

- **CHAT**: greetings, confirmations, meta-questions, short responses
- **EXPLORE**: "what is", "where is", "find", "explain", "how does", "analyze", "analysis", "trace", "map", "tell me about", "walk through", "understand", "how is", "what happens when", "look into", "show me how"
- **PLAN**: "how should", "plan", "design", "architecture", "approach", "strategy", "propose", "suggest an approach", "best way to", "how would you", "how to approach"
- **IMPLEMENT**: "add", "create", "implement", "build", "write", "make"
- **REVIEW**: "check", "look at", "review", "is this ok", "any issues"
- **RESOLVE**: "resolve", "fix review issues", "address feedback", "fix findings"
- **DEBUG**: "fix", "bug", "broken", "failing", "error", "why does"
- **PIPELINE**: "end to end", "implement and review", "build and review", "full pipeline"
- **RESEARCH**: "research", "compare options", "evaluate alternatives", "analyze options", "what libraries", "how do others"
- **RELEASE**: "release", "publish", "version bump", "cut a release", "prepare release", "deploy", "ship it"

## QUICK Criteria

- **CHAT** intent — always QUICK
- Single-answer lookups ("where is X?")
- Git ops (commit, push, pull, branch, tag, stash, diff, status)
- Config changes, rename/comment tweaks
- 1-2 line edits with explicit target

Prefer QUICK only when the change AND target are both explicit and trivial
(e.g., "rename foo to bar in utils.ts"). Any prompt involving substantive
code changes should go through the router.

## Disambiguation

- **EXPLORE vs RESEARCH**: EXPLORE = internal understanding (codebase, architecture, flows). RESEARCH = external sources needed (web, docs, alternatives, market). "how does our auth work?" → EXPLORE. "what auth libraries exist?" → RESEARCH.
- **EXPLORE vs PLAN**: EXPLORE seeks to understand what EXISTS. PLAN designs what SHOULD BE. "analyze this architecture" → EXPLORE. "redesign this architecture" → PLAN.
- **REVIEW vs EXPLORE**: REVIEW evaluates quality/correctness. EXPLORE seeks understanding. "look at this for issues" → REVIEW. "look at how this works" → EXPLORE.
- **DEBUG vs IMPLEMENT**: DEBUG requires investigation to find root cause. "fix this typo" → IMPLEMENT. "fix this intermittent failure" → DEBUG.

## Action

Classify every message — including the first message of a session — then:

- **QUICK**: Respond directly. Do not display classification or load the router.
- **Otherwise**: Load `devflow:router` via Skill tool.
