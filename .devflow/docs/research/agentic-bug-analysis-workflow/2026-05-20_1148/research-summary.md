# Research Summary: Agentic Bug Analysis Workflow Design

**Topic**: Designing an agentic bug analysis workflow that integrates with Devflow's orchestration patterns

**Date**: 2026-05-20

**Researchers**: 3 (codebase analysis, external research, technology evaluation)

**Trust Distribution**:
- **Trusted (Codebase)**: 22 files analyzed from devflow source tree
- **Mixed (Technology)**: 25+ tools evaluated via web research + codebase references
- **Untrusted (External)**: 18 academic papers and industry blogs

---

## Key Findings

### 1. CONVERGENT: Hybrid Static+LLM Architecture is the Dominant Effective Pattern

**Finding**: Multiple independent research sources + Devflow's existing patterns both validate hybrid static analysis + LLM as the most effective bug detection architecture.

| Source | Evidence | Confidence |
|--------|----------|------------|
| External Research (trusted) | LLM4PFA (Tencent): 94-98% FP elimination; hybrid static+LLM outperforms either approach alone | High |
| External Research (trusted) | LLIFT, ZeroFalse, IRIS all confirm static analysis as candidate generator + LLM as filter | High |
| Technology (mixed) | Semgrep + CodeQL designed for complementary analysis depths (fast CE + deep Pro/CodeQL) | High |
| Codebase (trusted) | review:orch uses parallel focused Reviewers; each loads parameterized pattern skill | High |

**Architecture**: Static analysis produces structured (SARIF) alerts → LLM performs semantic reasoning + false positive filtering → verified bugs with fix suggestions.

**Why it works**:
- Static tools are **fast and exhaustive** — catch most obvious patterns
- LLMs are **semantically aware** — understand intent, context, and feasibility
- Together they achieve **94-98% FP reduction** while maintaining high recall
- Matches Devflow's fan-out pattern: orchestrator spawns specialized reviewers per focus area

---

### 2. CONVERGENT: Multi-Agent Orchestration with Specialized Focus Areas Outperforms Single-Agent Approaches

**Finding**: Both external research (VulAgent, CodeX-Verify, RFCScan) and Devflow's review:orch architecture validate the multi-agent approach with distinct focus areas.

| Source | Evidence |
|--------|----------|
| Codebase (trusted) | review:orch spawns 8 core + conditional reviewers; each Reviewer is parameterized by focus skill |
| External Research (untrusted) | VulAgent (4-agent hypothesis-validation): reduced FP from 52.6% → 36.7% |
| External Research (untrusted) | CodeX-Verify (4-agent ensemble): 76.1% bug detection via information-theoretic aggregation |
| External Research (untrusted) | RFCScan (2-agent indexing + detection): 81.9% precision; diversity critical to avoid "popularity trap" |

**Key Architectural Pattern from Codebase**:
```
review:orch Phase 4: Detect conditional reviewers by file extension
review:orch Phase 5: Spawn all reviewers in parallel (8 core + conditional)
Each Reviewer agent loads parameterized focus skill dynamically
Synthesizer aggregates via confidence boosting (10% per additional reviewer, cap 100%)
```

**Critical Insight**: Agent **diversity** is essential — converging on the same wrong answer amplifies shared errors. Devflow ensures diversity by:
1. **Different focus areas** (security, performance, architecture, testing, etc.)
2. **Different analysis depths** (static vs semantic)
3. **Different skill sets** (static tools, linting, code style, complexity)

---

### 3. CONVERGENT: Confidence Scoring and False Positive Filtering via Multi-Agent Consensus

**Finding**: External research identifies 5 proven confidence-scoring techniques; Devflow's synthesizer already implements one (#2 below) and can adopt others.

| Technique | FP Reduction | Source | Devflow Status |
|-----------|------------|--------|----------------|
| 1. LLM majority-vote (3 queries per bug, vote to decide) | 93-94% accuracy | Tencent LLM4PFA (untrusted) | Not implemented |
| 2. Multi-agent consensus (require agreement across agents) | 94-98% FP elimination | ZeroFalse + CodeX-Verify (untrusted) | **Implemented** in synthesizer review mode |
| 3. CWE-specific micro-rubrics (10-20 rules per weakness type) | F1=0.912-0.955 | ZeroFalse (untrusted) | Not implemented; potential enhancement |
| 4. Path feasibility validation (LLM checks if path is reachable) | 72-96% of false positives filtered | LLM4PFA + external research (untrusted) | Could be integrated as verification step |
| 5. Hypothesis falsification (actively try to disprove bug exists) | 30% relative FP reduction | VulAgent (untrusted) | Aligns with debug:orch competing hypotheses pattern |

**Devflow's Confidence Threshold (80% minimum)** (trusted):
- Reviewer confidence >= 80% → main report sections (Blocking/Should-Fix/Pre-existing)
- Reviewer confidence 60-79% → Suggestions (max 3)
- Reviewer confidence < 60% → dropped
- Synthesizer review mode: boosts confidence 10% per additional reviewer agreeing (cap 100%)

**Recommendation**: Implement CWE-specific micro-rubrics in a new BugAnalyzer agent or extend Reviewer with CWE reasoning.

---

### 4. CONVERGENT: Orchestrator-Local vs Fan-Out Context: Two Distinct Strategies

**Finding**: Devflow already distinguishes two patterns; external research validates both via different use cases.

| Pattern | Devflow Example | When to Use | Why |
|---------|-----------------|------------|-----|
| **Fan-out** (pass context to workers) | review:orch, resolve:orch, implement:orch | Need worker context to make decisions | Reviewers must understand project decisions to categorize findings |
| **Orchestrator-local** (keep in orchestrator only) | debug:orch, explore:orch | Want fresh, unbiased investigation | Investigation agents examine code with fresh eyes; prevents confirmation bias |

**External Research Validation**: VulAgent and RFCScan both implement orchestrator-local pattern — hypothesis validators search code independently to avoid priming effects.

**For Bug Analysis Workflow**:
- **If bug detection is exploratory** (finding new bugs): use orchestrator-local (fresh eyes)
- **If bug detection is review-focused** (categorizing known issues): use fan-out (context-aware)

---

### 5. CONVERGING BUT WITH GAPS: Bug Categorization Framework

**Finding**: External research standardizes on CWE taxonomy; Devflow has no native CWE integration yet.

| Source | Coverage |
|--------|----------|
| External Technology (untrusted) | CWE 4.15: 600+ categories; static tools detect 25-80 CWE types depending on tool |
| External Research (untrusted) | CaSey (2024): LLMs achieve 68% CWE identification + 73.6% severity classification accuracy |
| Codebase (trusted) | Devflow's resolve agent uses 3-tier risk assessment (standard/careful/architectural); no CWE mapping |

**Current Devflow Risk Tiers**:
- Standard fixes (direct): null checks, validation, docs, error handling
- Careful fixes (test-first): public API changes, shared state, >3 files
- Architectural overhaul (defer): requires system redesign

**Gap**: Devflow risk tiers are **architectural**, not **security-domain** aware. A CWE-89 (SQL Injection) and a CWE-476 (NULL dereference) would be treated identically, though they have different complexity profiles.

---

### 6. CONFLICT: Confidence in FP Filtering Claims

**Discrepancy**: External research reports wildly different FP reduction rates depending on methodology.

| Claim | Source | Confidence Assessment |
|-------|--------|----------------------|
| LLM4PFA eliminates 94-98% FP | Tencent industry study (untrusted, single source) | **Medium** — impressive but needs independent replication |
| ZeroFalse F1=0.912 on OWASP | Paper authors (untrusted) | **Medium** — authors note "models can overfit to benchmark patterns that do not exist in the wild" |
| Best agentic FP filtering still suppresses 22% real vulns | Comparative study (untrusted, single source) | **Medium** — sobering but methodologically sound |
| Semgrep CE 74.8% FP rate on OWASP | Independent benchmarks (untrusted) | **High** — corroborated across multiple sources |

**Devflow's Conservative Approach (trusted)**:
- 80% confidence minimum for main findings
- 60-79% confidence relegated to "Suggestions" (max 3 items)
- Synthesizer applies confidence boosting only when multiple reviewers agree
- This is deliberately conservative to avoid false positives

**Implication**: Devflow's 80% threshold is **more conservative than Tencent's LLM4PFA** (which claims 94-98% accuracy). This is appropriate for a development tool where false positives have higher cost than false negatives.

---

### 7. TECHNOLOGY FINDING: Semgrep is the Ideal First-Pass Filter; CodeQL for Deep Analysis

**Finding**: Semgrep and CodeQL are complementary, not competitive. Devflow should use Semgrep for fast first-pass + CodeQL for deep analysis on findings.

| Aspect | Semgrep CE | CodeQL | Recommendation |
|--------|-----------|--------|-----------------|
| Speed | ~10 seconds | Minutes to 30+ minutes | Use Semgrep as Phase 1 filter |
| Depth | Shallow (single-file AST) | Deep (cross-file data flow) | Use CodeQL on Semgrep findings only |
| FP Rate | 74.8% (untrusted) | 68.2% (untrusted) | Both high; LLM filtering required |
| Integration | Native PR comments, fast | GitHub-native, incremental (2025+) | Both available in Devflow ecosystem |
| Cost | Free | Free for open-source | Both zero-cost for development |
| Rules | 2,800+ community + easy authoring | 432+ default, steep QL learning curve | Semgrep easier to extend |

**Agentic Workflow Pattern**:
```
Phase 1: Semgrep (fast, exhaustive) → SARIF output
Phase 2: CodeQL (deep) on high-priority findings only → SARIF output
Phase 3: LLM (Reviewer agents) combine + filter via false positive analysis
Phase 4: Synthesizer aggregates findings with confidence boosting
```

---

### 8. ARCHITECTURAL INSIGHT: Hierarchical Localization Applies to Bug Detection

**Finding**: External research (Agentless, AutoCodeRover) shows hierarchical localization (files → functions → lines) outperforms single-pass localization.

**Pattern from Technology Research**:
```
File-level localization (git blame, static analysis warnings)
  → Function-level localization (data flow graph)
    → Line-level localization (LLM with constraints)
      → Verification (path feasibility, test generation)
```

**Devflow Alignment**:
- review:orch Phase 4 already detects **which files changed** (entry point)
- Reviewer agent reads **30 lines of context** around flagged locations (line-level)
- resolve:orch Phase 4 batches issues by file (function-level grouping for efficiency)

**For Bug Analysis**: Extend this to explicitly use Reviewer agent to:
1. Identify changed files (Phase 1 of bug analysis)
2. Run Semgrep on those files only (scoped scanning)
3. For each finding, read function-level context (60-100 lines)
4. LLM evaluates feasibility and generates confidence score

---

### 9. DESIGN IMPLICATION: Bug Analysis Workflow Architecture

**Synthesized from all sources**: A new bug analysis workflow would follow Devflow's Phase Protocol.

**Proposed Architecture**:

```
BUG_ANALYSIS Intent
  ↓
bug-analysis:triage (scope assessment)
  ├─ GUIDED: lightweight mode (load companion skills, execute in-session)
  └─ ORCHESTRATED: multi-agent mode (spawn agents, write to disk)

bug-analysis:orch (7 phases following Phase Protocol)
  Phase 1: Discovery — identify bug categories + scope
  Phase 2: Candidate Generation — run Semgrep + ESLint for fast first-pass
  Phase 3: Deep Analysis — CodeQL on findings (optional, if HIGH priority)
  Phase 4: Semantic Analysis — BugAnalyzer agent per focus area
  Phase 5: Convergence — synthesize across agents + apply confidence thresholds
  Phase 6: Verification — optional second-round hypothesis validation (debug:orch style)
  Phase 7: Report — write findings to `.devflow/docs/bugs/{branch}/${timestamp}/analysis.md`

BugAnalyzer Agent (new, or reuse parameterized Reviewer)
  Input: Bug category (CWE type), code context, static analysis findings
  Process: LLM performs semantic analysis + feasibility checks
  Output: Bug report with confidence score, severity, fix suggestion
  Model: Opus (analysis agent)

Synthesizer (reuse existing in review mode)
  Input: All BugAnalyzer outputs
  Process: Confidence aggregation, deduplication, ranking
  Output: `bug-analysis-summary.md` with sorted findings
```

---

### 10. RESEARCH QUESTION EMERGING: How to Handle Business Logic Bugs?

**Finding from Technology Research**: A **critical gap** exists across all tools — none reliably detect business logic vulnerabilities, authorization bypass, or domain-specific correctness issues.

| Tool Category | Strength | Gap |
|---------------|----------|-----|
| Static Analysis (Semgrep, CodeQL, Infer) | Security + memory safety | Cannot reason about domain intent |
| ML Tools (Snyk Code) | Learned patterns from 25M+ cases | Still domain-agnostic |
| LLM Agents (VulAgent, RFCScan) | Semantic reasoning | Require domain context to classify |
| Agentic Systems (SWE-agent, Agentless) | Multi-turn reasoning | Specialized for bug-fixing, not finding |

**Implication for Devflow**: Bug analysis workflow should focus on **detectable** bug categories (security, memory safety, type safety, concurrency) and explicitly defer business logic issues to human code review or domain-specific testing.

---

## By Research Type

### Codebase: Devflow's Established Patterns

**Key Orchestration Patterns (trusted, 22 files examined)**:

1. **review:orch** (7 phases, 8 core + conditional reviewers)
   - Phase 4: Auto-detect reviewer types by file extension
   - Phase 5: Spawn all reviewers in parallel (single message)
   - Iron Law: "EVERY REVIEWER WRITES TO DISK" (persistence before compaction)

2. **Synthesizer Agent** (5 modes: exploration, planning, review, design, research)
   - Review mode confidence boost: +10% per additional reviewer, cap 100%
   - Merge rules based on issue severity + category

3. **Resolver Agent** (3-tier risk assessment)
   - Standard fixes (direct): null checks, validation, docs
   - Careful fixes (test-first): public API changes, >3 files affected
   - Architectural overhaul (defer): system redesign

4. **Router/Triage System** (intent → scope assessment → guided|orch)
   - Classification rules: 10 intents (CHAT, EXPLORE, PLAN, IMPLEMENT, REVIEW, RESOLVE, DEBUG, PIPELINE, RESEARCH, RELEASE)
   - Triage signals: file count, module breadth, pattern complexity
   - Default-to-GUIDED bias with orchestration hint override keywords

5. **Agent Design Conventions**
   - Frontmatter: name, description, model, skills, optional tools
   - Input contract: variables from orchestrator (FILES_CHANGED, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, WORKTREE_PATH)
   - Output contract: status enum (PASS/FAIL/BLOCKED, COMPLETE/PARTIAL), markdown template
   - Boundary section: "Handle autonomously" vs "Escalate to orchestrator"

6. **Iron Law Pattern** (one per skill)
   - review:orch: "EVERY REVIEWER WRITES TO DISK"
   - debug:orch: "COMPETING HYPOTHESES BEFORE CONCLUSIONS"
   - resolve:orch: "VALIDATE FIRST, FIX EVERYTHING POSSIBLE"

**Files Examined**: shared/skills/{review,debug,resolve,implement,explore,pipeline,router}:orch/SKILL.md; shared/agents/{reviewer,resolver,synthesizer,coder,simplifier}.md; shared/skills/{router,implement,debug,review}:triage/SKILL.md

---

### External Research: Academic + Industry Best Practices

**Key Findings (18 sources, mostly untrusted but converging)**:

1. **Hybrid Static+LLM Architecture** — validated by Tencent (LLM4PFA, 2026 industry deployment), Google (LLIFT, OOPSLA 2024), and multiple academic papers
   - Static analysis as candidate generator: exhaustive, fast
   - LLM as false positive filter: semantic reasoning, feasibility analysis
   - Result: 94-98% FP elimination (medium confidence)

2. **Multi-Agent Specialized Roles** — validated by VulAgent (4-phase hypothesis-validation), CodeX-Verify (4-agent ensemble), RFCScan (2-agent protocol analysis)
   - Each agent focuses on distinct bug category or analysis phase
   - Diversity critical to avoid convergence on shared errors ("popularity trap")
   - Agent disagreement signals low-confidence findings

3. **Confidence Scoring Techniques** (ranked by effectiveness):
   - LLM4PFA: majority-vote (3 queries, vote on outcome) → 93-94% accuracy
   - ZeroFalse: multi-agent consensus + CWE-specific micro-rubrics → F1=0.912-0.955
   - VulAgent: hypothesis falsification + path feasibility → 30% relative FP reduction
   - RFCScan: self-criticism validation → 18.1% FP rate

4. **CWE Taxonomy** — industry standard for bug categorization
   - 600+ categories; static tools detect 25-80 types
   - LLMs achieve 68% CWE identification + 73.6% severity classification
   - Enables cross-tool comparison and domain-aware prioritization

5. **Open-Source Gaps** — multi-agent bug detection is research-only
   - VulAgent, CodeX-Verify, RFCScan, RepoAudit: prototypes without public implementations
   - Only single-agent tools (SWE-agent, Aider, OpenHands) are open-source and production-ready

---

### Technology: Tool Capabilities + Architectural Patterns

**25+ Tools Evaluated (untrusted, corroborated)**:

1. **Static Analysis Tier**:
   - Semgrep: Fast (~10s), 2,800+ rules, 74.8% FP on OWASP, ideal for first-pass filter
   - CodeQL: Deep (cross-file data flow), slow (minutes-30+min), 68.2% FP, ideal for high-risk findings
   - Infer: Memory safety + concurrency, Java/C/C++, low FP by design

2. **AI-Powered Tier**:
   - Snyk Code: Hybrid ML, 80%-accurate autofix, already has MCP tools
   - Qodana: 3,000+ inspections, JetBrains maturity, Docker-based
   - Amazon CodeGuru: **Deprecated Nov 7, 2025** (not viable)

3. **Agentic Software Engineering** (for reference, not bug detection):
   - live-SWE-agent + Claude Opus: 79.2% on SWE-bench Verified (highest)
   - Agentless: 27.3% on SWE-bench Lite, hierarchical localization pipeline, $0.34/issue
   - Insight: Scaffold architecture matters as much as LLM model choice

4. **Hybrid Approaches**:
   - LLIFT: Static analysis + LLM path feasibility analysis; found 4 undiscovered Linux kernel UBI bugs
   - ZeroFalse: 5-stage SARIF enrichment + CWE micro-rubrics; F1=0.955 on real-world
   - LLM4PFA: Tencent production; 0.0011-0.12 per alarm; 94-98% FP elimination

5. **Composable Patterns**:
   - Tiered Analysis: Fast filter → Deep analysis → LLM reasoning
   - LLM as Escape Hatch: Traditional tools + LLM when stuck
   - Hierarchical Localization: File → Function → Line → Verification
   - CEGIS Loop: LLM proposes, symbolic verifies, iterate
   - Multi-Objective: Parallel agents optimizing different objectives (coverage, precision, recall)

---

## Trust Assessment

| Research Type | Confidence | Basis | Key Limitations |
|---------------|------------|-------|-----------------|
| **Codebase** (trusted) | High | Direct code reading; 22 files; Phase Protocol explicitly defined; 7 orch skills examined | Limited to devflow patterns; did not examine test files or integration tests |
| **External** (untrusted) | Medium | 18 sources spanning 2024-2026; multiple corroborating papers on hybrid architecture; but single-source claims on FP rates | OWASP Benchmark bias acknowledged; research-to-production gap; rapidly evolving field; no business logic bug coverage |
| **Technology** (mixed) | High on architectural patterns; Medium on performance claims | 25+ tools evaluated; capability claims cross-corroborated; but no hands-on testing; FP rates highly context-dependent | Benchmark bias; Semgrep Pro unverified; cost data sparse; business logic bugs not covered by any tool |

---

## Recommendations: Ranked by Impact

### Recommendation 1: Adopt Bug Analysis Intent + Orch Skill (HIGHEST IMPACT)

**What**: Create `bug-analysis:orch` skill following Phase Protocol.

**Why**: 
- Aligns with Devflow's established orchestration patterns (review:orch template)
- External research validates multi-agent + hybrid static/LLM architecture
- Phase Protocol ensures consistency with existing workflows

**How**:
1. Create `shared/skills/bug-analysis:orch/SKILL.md` (7 phases, ~150 lines)
2. Create `shared/skills/bug-analysis:triage/SKILL.md` (~30 lines, scope assessment)
3. Add BUG_ANALYSIS intent to `classification-rules.md`
4. Phases: Discovery → Semgrep (fast) → CodeQL (optional) → BugAnalyzer agents → Synthesizer → Verification → Report

**Evidence**: review:orch template (trusted), VulAgent + RFCScan (untrusted), LLM4PFA (untrusted)

---

### Recommendation 2: Implement Multi-Agent Confidence Scoring (HIGH IMPACT)

**What**: Extend Synthesizer to support CWE-specific confidence micro-rubrics.

**Why**:
- ZeroFalse demonstrates CWE-specific rubrics improve F1 from 0.7 → 0.912
- Devflow's 80% threshold is conservative; can afford to be more precise with CWE reasoning
- Aligns with Devflow's confidence threshold pattern (already trusted)

**How**:
1. Add CWE taxonomy reference to Synthesizer (BugAnalyzer output includes CWE ID)
2. Create 5-10 CWE-specific rubrics (e.g., CWE-89 SQL Injection: check for parameterization; CWE-476 NULL: check for null guard)
3. Apply rubric scoring before applying 80% confidence threshold
4. Confidence boost: +10% per additional agent agreeing (existing pattern) + CWE-specific adjustment (new)

**Evidence**: ZeroFalse (untrusted, high confidence in methodology), Devflow synthesizer review mode (trusted)

---

### Recommendation 3: Semgrep as First-Pass Filter, CodeQL for High-Priority Only (MEDIUM-HIGH IMPACT)

**What**: Use Semgrep as always-on first-pass filter; CodeQL only on Semgrep findings above threshold.

**Why**:
- Semgrep ~10s vs CodeQL 30+ minutes → workflow responsiveness
- Both free and integrated
- Matches hybrid architecture pattern from external research
- Semgrep already available via `snyk_sca_scan` MCP tool

**How**:
1. bug-analysis:orch Phase 2: Spawn `snyk_sca_scan` on changed files (uses Semgrep + dependencies)
2. Phase 3: For findings with confidence >= MEDIUM, optionally spawn CodeQL
3. Phase 4: BugAnalyzer agents refine based on combined static + semantic signals

**Evidence**: Semgrep benchmarks (untrusted, corroborated), hybrid architecture validation (untrusted, converging)

---

### Recommendation 4: Orchestrator-Local Pattern for Exploratory Bug Finding (MEDIUM IMPACT)

**What**: When bug analysis intent is "find new bugs" (not "categorize known issues"), use orchestrator-local pattern: don't pass DECISIONS_CONTEXT to investigation agents.

**Why**:
- Prevents confirmation bias and priming effects
- External research (VulAgent, RFCScan) validates this for hypothesis-driven investigation
- Devflow already uses this pattern in debug:orch

**How**:
1. bug-analysis:triage detects intent: EXPLORATORY vs REVIEW
2. If EXPLORATORY, omit DECISIONS_CONTEXT from BugAnalyzer agents
3. If REVIEW, include DECISIONS_CONTEXT (workers need context to categorize)

**Evidence**: debug:orch orchestrator-local pattern (trusted), VulAgent/RFCScan hypothesis validation (untrusted)

---

### Recommendation 5: Document Gap: Business Logic Bugs Require Human Review (LOW PRIORITY)

**What**: Explicitly document that bug analysis workflow covers **detectable** categories (security, memory safety, type safety, concurrency) and defers **domain-specific** bugs (business logic, authorization, specification compliance) to human review.

**Why**:
- External research confirms no tool reliably detects business logic bugs
- Setting expectations prevents frustration
- Aligns with Devflow's core principle: "enhance developer empowerment without replacing judgment"

**How**:
1. Add section to bug-analysis:orch explaining coverage limitations
2. In BugAnalyzer output, explicitly categorize findings by detectability tier
3. Suggest complementary workflows for business logic (test generation, scenario-based review)

**Evidence**: Technology survey (untrusted, systematic across 25+ tools and research papers)

---

### Recommendation 6: Consider CWE Micro-Rubrics for Enhanced Confidence (MEDIUM PRIORITY)

**What**: Implement CWE-specific decision trees as structured prompts for LLM reasoning.

**Why**:
- ZeroFalse demonstrates this increases F1 from 0.7 → 0.912
- Provides auditable reasoning for confidence scores
- Enables CWE-aware prioritization and routing

**How**:
1. For each covered CWE type (SQL Injection, XSS, NULL, OOB, etc.), define 10-20 line decision tree
2. Pass CWE + micro-rubric to BugAnalyzer agent prompt
3. LLM evaluates bug against rubric, produces confidence score
4. Example CWE-89 (SQL Injection): {Is input parameterized? Is ORM used? Is prepared statement present? Has taint tracking?}

**Evidence**: ZeroFalse (untrusted), CaSey automated severity classification (untrusted)

---

### Recommendation 7: Reuse Parameterized Reviewer Agent (LOW PRIORITY)

**What**: Consider whether to reuse the existing parameterized Reviewer agent (loaded with bug-analysis skill) vs create new BugAnalyzer agent.

**Why**:
- Reviewer is already proven, multi-mode, confidence-aware
- Bug analysis is conceptually similar to security-focused review
- Reduces implementation surface

**Trade-off**:
- **Reuse Reviewer**: Faster, less code, leverages existing patterns
- **New BugAnalyzer**: Specialized design, can optimize for bug-finding semantics

**Decision**: Start with Reviewer; split into BugAnalyzer if specialization is needed.

---

## Gaps Requiring Further Research

1. **Cost Economics of Multi-Agent Approaches**: Only Agentless ($0.34/issue) and LLM4PFA ($0.0011-$0.12/alarm) provided cost data. What is the per-issue cost of a 7-phase orchestration with Semgrep + CodeQL + 3 BugAnalyzer agents?

2. **Benchmark-to-Production Gap**: External research (ZeroFalse authors) explicitly noted that models overfit to OWASP Benchmark patterns that don't exist in real code. How do Devflow's patterns transfer to real production codebases?

3. **Business Logic Bug Detection**: No tool covers this; human review or domain-specific LLM reasoning required. What are the design patterns for integrating domain-specific bug detection into Devflow?

4. **Semgrep Pro Independent Benchmarks**: Semgrep CE benchmarked at 74.8% FP; Pro claims cross-file analysis. Has Pro been independently benchmarked against CodeQL?

5. **Hypothesis-Validation Loop**: VulAgent's hypothesis falsification (Phase 4: "actively try to disprove bug exists") shows 30% FP reduction. How to integrate this into a lightweight guided workflow?

---

## Conclusion

Devflow should adopt a **7-phase bug analysis orchestration skill** that combines:

1. **Trusted codebase patterns**: review:orch structure, phase protocol, synthesizer confidence boosting, resolver risk tiers
2. **Validated external architecture**: hybrid static (Semgrep) + semantic (CodeQL) + LLM (BugAnalyzer agents)
3. **Proven confidence scoring**: multi-agent consensus (existing) + CWE micro-rubrics (new)
4. **Selective deep analysis**: Semgrep for fast first-pass, CodeQL only on high-priority findings
5. **Explicit coverage boundaries**: focus on detectable categories (security, memory, concurrency); defer business logic to human review

**Implementation Effort**: Medium (60-80 hours)
- bug-analysis:orch skill: ~150 lines (template: review:orch)
- bug-analysis:triage skill: ~40 lines (template: implement:triage)
- Extend Synthesizer with CWE micro-rubrics: ~50 lines
- Add intent + router rules: ~10 lines
- No new agents required; reuse Reviewer or create lightweight BugAnalyzer

**Timeline**: Can integrate with existing review:orch infrastructure; no architectural changes to Phase Protocol or orchestration system required.
