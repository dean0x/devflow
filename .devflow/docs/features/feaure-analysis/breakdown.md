

Here's the clean version.

---

## What We're Building

| Priority | # | Feature | Effort | Wave |
|----------|---|---------|--------|------|
| 1 | #113 | Reviewer Confidence Thresholds (>80% filter) | Small | 1 |
| 2 | #91 | Version Manifest for Upgrades | Small | 1 |
| 3 | #111 | Search-First Skill | Small | 1 |
| 4 | #99 | Persistent Project Knowledge (ADRs, patterns, pitfalls) | Medium | 2 |
| 5 | #108 | `/gap-analysis` + `/plan` Commands | Large | 3 |
| 6 | NEW | Continuous Learning / Instinct System | Large | 4 |
| 7 | #98 | PreToolUse Hook Enforcement | Medium | 5 |
| 8 | #110 | PostToolUse Quality Hooks (format, typecheck) | Medium | 5 |
| 9 | #112 | Stack-Specific CLAUDE.md Templates | Medium | 5 |
| 10 | NEW | Model Profiles (quality/balanced/budget) | Medium | 5 |
| 11 | NEW | Health Check Command (`/health`) | Small | 5 |

---

## What We're Deferring

| # | Feature | Effort | Why Defer |
|---|---------|--------|-----------|
| #27 | Shepherd Hooks | Large | Hooks API still evolving |
| #100 | Multi-Perspective Planning | Small-Med | Uncertain ROI, adds tokens |
| #101 | Elicitation Techniques for /specify | Small | /specify works fine as-is |
| #109 | Context Modes (dev/research/review) | Small | Third dimension, marginal gain |
| #103 | Dispatch Gating via File Markers | Small | Depends on #98; problem not yet hit |
| #92 | Rollback on Partial Install | Medium | Install is idempotent; failures rare |
| NEW | Decision Preservation (Locked/Flexible) | Medium | Adds ceremony to /specify flow |
| NEW | Checkpoint-Driven Workflows | Medium | Nice but complex plumbing |
| NEW | De-Sloppify Simplifier Categories | Small | Do when we touch Simplifier next |
| NEW | Stub Detection for Scrutinizer | Small | Scrutinizer already catches most |
| NEW | Wave-Based Parallel Execution | Medium | Complex; validate need first |
| NEW | `/quick` Command | Medium | Validate the gap exists first |
| NEW | Goal-Backward Verification | Medium | Defer with #27 |

---

## What We're Closing

| # | Feature | Reason |
|---|---------|--------|
| #107 | Harness Alpha Research Report | Informational — all ideas tracked individually now |
| #114 | Anvil Research Report | Same — all ideas tracked individually |
| #89 | Settings.json Concurrent Write Protection | Theoretical race; never reported |
| #90 | Skill Namespace Prefix | Premature; no ecosystem conflict exists |
| #102 | Lore Engine / Narrative UX | Cosmetic; zero impact on quality |
| #6 | Symlink Attack Prevention | Requires pre-positioned local attacker |
| #7 | Security Warnings During Install | Marginal value for a dev tool |
| #8 | Script Integrity Verification | Post-install tampering needs compromised FS |
| #9 | Cryptographic Script Signing | Massive effort, advanced threat model |
| #10 | Sandboxed Script Execution | Research-only, theoretical risk |
| NEW | Multi-IDE Adapter Layer | Premature |
| NEW | Session Aliasing/Management | CLI sugar, not a differentiator |
| NEW | Cost Tracking | Claude Code itself may add this |
| NEW | Package Manager Detection | Windows-specific edge case |
| NEW | Bridge Files for Inter-Hook Comms | Pattern, not a feature — use when needed |
| NEW | Eval-Driven Development Metrics | Academic; unclear practical value |
| NEW | Hook Profile Gating | Premature without richer hook ecosystem |
| NEW | Iterative Retrieval for Subagents | Over-engineering current model |
| NEW | Persistent Codemaps | High maintenance burden |
| NEW | Security Audit Command | Overkill for current user base |
| NEW | Per-Task Atomic Commits | Too granular; noisy git history |
| NEW | Session Handoff Files | WORKING-MEMORY.md already does this |

---

## Keeping As-Is

| # | Feature | Status |
|---|---------|--------|
| #23 | Tech Debt Backlog | Living document — stays open, not a standalone task |

---

## Wave Plan

| Wave | Issues | Theme | Parallelizable |
|------|--------|-------|----------------|
| **1** | #113, #91, #111 | Quick wins — confidence filter, version tracking, search-first | Yes, all 3 independent |
| **2** | #99 | Persistent knowledge — foundation for learning | No, solo |
| **3** | #108 | `/gap-analysis` + `/plan` — biggest workflow feature | No, solo (large) |
| **4** | NEW (learning system) | Continuous learning — builds on #99 | No, solo (large) |
| **5** | #98, #110, #112, model profiles, /health | Hook enforcement + templates + utilities | Partially — #98 and #110 are independent; #112, profiles, /health are independent |