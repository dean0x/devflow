# Research Summary: Semantic Bug Detection — Intent vs. Implementation

**Topic**: Comparing developer intent (plans/specs/PRDs) against actual implementation to find business logic, functional, and integration bugs  
**Date**: 2026-05-21  
**Researchers**: 3 (codebase, external, technology)  
**Mode**: Trust-annotated synthesis

---

## Key Findings

### The Market Opportunity: A Real Gap Exists

**Finding**: No production tool yet compares structured plan/spec documents against implementation with semantic analysis.

**Trust**: **HIGH** (convergent across trusted codebase analysis + confirmed by external research)

- **Codebase** (TRUSTED): Devflow has rich plan artifacts (12-section design docs with acceptance criteria, problem statement, scope, implementation plan) flowing through implement → review → resolve pipeline, but the Evaluator's alignment findings are **not persisted to disk** and the pipeline stages don't thread context between them.

- **External** (UNTRUSTED, but validates gap): Martin Fowler/Thoughtworks analysis confirms no SDD tool demonstrates "robust automated drift detection between specs and implementations." RFCAudit (academic, RFC-vs-code) and SGCR (spec-grounded code review) are research prototypes, not production tools. Tools like Copilot Workspace generate specs but don't verify compliance. Kiro/Tessl (spec-driven frameworks) handle workflow structure, not semantic verification.

- **Technology** (MIXED): SpecRover infers specs from code (inverse problem), Augment Code has Critique/Verify separation but is commercial and closed-source, Dafny requires formal annotation overhead. Most mainstream agents (Cursor, Devin, Copilot Coding Agent) verify via test execution or self-review, not against specs.

**Implication for Devflow**: This is a **genuine white space**. Devflow already has the artifacts (design docs, acceptance criteria) that no other tool ingests systematically. Adding a semantic verification stage after `/resolve` would be novel.

---

### The Circularity Problem: Formally Recognized

**Finding**: When the same model generates AND reviews code, the review checks code against itself, not against intent. This is called "structural circularity."

**Trust**: **HIGH** (converged in external + technology research)

- **External** (UNTRUSTED, but high-authority source): Fowler analysis and SGCR paper note this explicitly — self-review by the generating agent is circularity.

- **Technology** (MIXED, March 2026 preprint): Zietsman et al. (arXiv:2603.25773) formally identifies "structural circularity" as a fundamental limitation: when AI generates and reviews, both operate from the same artifact. Review checks code against itself, not against intent.

**Why it matters for Devflow**: The Coder generates code AND the Evaluator reviews it within the same implement:orch session using the same model (Opus). This is circular. A separate **post-implementation verification stage** that compares the code against the **original plan document** (external specification anchor) would break the circularity.

---

### Architecture Patterns: Six Viable Approaches

**Trust**: MEDIUM-HIGH (technology research is untrusted but derived from peer-reviewed papers + vendor documentation)

| Pattern | Architecture | Strength | Weakness | Applicability to Devflow |
|---------|--------------|----------|----------|--------------------------|
| **1. Spec-Inference-Then-Verify** | Code + issue → infer specs → generate tests → reviewer checks specs + tests + requirements | Works without upfront specs; SpecRover: 50%+ improvement over baseline | Inferred specs may be wrong | **MODERATE** — Devflow has explicit specs (plan docs), so inference is redundant |
| **2. Critique-Then-Verify** | Pre-implementation spec feasibility check, then post-implementation compliance check | Separates concerns; Augment Code pattern | Requires "living spec" document | **HIGH** — Devflow's plan artifact IS a living spec; can split into pre/post gates |
| **3. Behavior-Model-Then-Test** | Code → analyze docstrings/types/names → build behavior model → generate tests for edge cases | Practical, immediate value; Qodo 2.0: F1=60.1% | Only catches deviations from documented behavior, not unstated intent | **MODERATE** — useful for unit-level verification, not plan-level |
| **4. Multi-Trajectory-Validate** | Generate N implementation paths → validate each against tests → select optimal | Comparative validation reduces single-path bias | Multiplies compute cost (N implementations) | **LOW** — too expensive for Devflow's plan-aware workflow |
| **5. Property-Inference-Then-Fuzz** | Code → infer properties from docstrings/types/function names → generate property-based tests → run → report counterexamples | High precision (81% validity from Anthropic research); finds real bugs | Properties must be inferrable from existing artifacts | **MODERATE-HIGH** — excellent for tactical bug finding, but lower-level than plan verification |
| **6. Self-Review-Before-Merge** | Implementation → self-review own diff → security scan → PR | Catches obvious errors cheaply | Structurally circular — same model reviews its own work | **ALREADY USED** — Evaluator does this; adding external spec anchor breaks circularity |

**Consensus pattern for Devflow**: Hybrid of **Pattern 2 (Critique-Then-Verify)** + **Pattern 5 (Property-Inference-Then-Fuzz)**:
- **Pre-implementation critique** (already in plan:orch): Gap analysis checks design feasibility
- **Post-implementation verify** (NEW STAGE): Compare code against plan's acceptance criteria + infer properties from code and validate against specs

---

### The False Positive Challenge: LLMs Struggle with Specs

**Finding**: LLMs systematically misclassify correct code as non-compliant with specs, and complex prompting **increases** misjudgment rate.

**Trust**: **HIGH** (external research: peer-reviewed ASE 2025 paper by Jin & Chen)

**Evidence**: 
- Jin & Chen (ASE 2025, arXiv 2508.12358): LLMs "frequently misclassify correct code implementations as either 'not satisfying requirements' or containing potential defects."
- Chain-of-thought and correction prompts **worsen** the problem, not improve it.
- This is a fundamental limitation of pure LLM-based spec verification.

**Mitigation strategies found in research**:

| Strategy | Source | FP Rate Improvement | Devflow Applicability |
|----------|--------|---------------------|----------------------|
| **Structured specs + deterministic rules** | SGCR: Explicit Path | 90.9% improvement over baseline LLM review | **HIGH** — Plan artifact sections (Acceptance Criteria, Scope, Implementation Plan) can be converted to rule sets |
| **Multi-agent ensemble** | MAV (Lifshitz et al.): multiple verifiers each assessing different aspects | 10-20% accuracy gains per additional verifier | **MODERATE** — Could assign different agents to scope/acceptance/integration verification |
| **Property-based testing + LLM** | Anthropic research: infer properties, generate PBT tests, fuzz | 81% precision for top-scored findings | **HIGH** — Executable properties + fuzzing is verifiable, not circular reasoning |
| **Formal verification + LLM annotation** | DafnyPro, PREFACE: LLM generates annotation drafts, formal tools verify | 86% correct proofs on DafnyBench | **MODERATE-LOW** — Overhead for Devflow; useful only for critical paths |
| **Explicit cross-checks** | Augment Code: Verifier checks full system spec, not isolated diffs | Not quantified | **HIGH** — Devflow's plan has full scope; verifier should compare against entire surface area, not line-diffs |

**Key insight**: The FP problem is **NOT** an argument against semantic verification—it's an argument for **anchoring verification in executable properties and deterministic rules**, not free-form LLM reasoning alone.

---

### Intent-Verification Patterns Specific to Devflow

**Trust**: **HIGH-MIXED** (codebase analysis is trusted; patterns inferred from external + technology research)

#### Pattern A: Plan Section → Acceptance Criteria Verification

**What Devflow has**:
- Plan artifact (`.devflow/docs/design/{slug}.{timestamp}.md`) contains YAML frontmatter + 12 sections
- Section 5: **Acceptance Criteria** (explicit list of pass/fail conditions)
- Section 7: **Scope** (what IS included, what ISN'T)
- Section 8: **Implementation Plan** (step-by-step execution)

**What's missing**:
- No stage verifies that **each acceptance criterion has a corresponding test or code path**
- PR_DESCRIPTION_GUIDANCE flows one-way (plan → Coder → PR body) but the implementation-plan sections are NOT checked during review

**Architecture**:
```
Plan artifact (ACCEPTANCE_CRITERIA + SCOPE + IMPLEMENTATION_PLAN)
     ↓
Extracted as structured requirements (list of {criterion, file:line, status})
     ↓
Verification agent compares:
  - Each criterion against code/tests
  - Scope boundaries against file changes (no out-of-scope additions)
  - Implementation plan steps against git log
     ↓
Report: {criterion, met/not-met/ambiguous, evidence}
```

#### Pattern B: Evaluator Report → Disk Persistence + Threading

**What Devflow has**:
- Evaluator agent (Opus, in implement:orch Phase 6) produces alignment report with:
  - Status (ALIGNED/MISALIGNED)
  - Completeness check (all plan steps executed?)
  - Intent check (original problem solved?)
  - Scope check (no creep?)
  - Artifact depth table

**What's missing**:
- Evaluator report is **not persisted to disk**; lives only in implement:orch conversation context
- If implement succeeds, report is lost during context compaction
- Review/resolve stages cannot see Evaluator findings
- EXECUTION_PLAN (synthesized from plan or task description) is not persisted for downstream reference

**Fix**:
```
implement:orch Phase 6 (Evaluator gate)
  ↓ (NEW) persist to disk
.devflow/docs/design/{branch_slug}-alignment-{timestamp}.md
  ↓ (NEW) thread to review:orch
review:orch Phase 1 loads PRIOR_EVALUATIONS from disk
  ↓
Reviewer agents use Evaluator findings as context for their scope/intent checks
```

#### Pattern C: Pipeline Threading + Bug Analysis Stage

**What Devflow has**:
- pipeline:orch (3 stages): implement → review → resolve
- Each stage is independent; context is NOT threaded between stages
- Focus of review is code quality (security, performance, complexity)

**What's missing**:
- No 4th stage for **semantic verification against plan**
- Review focuses on code issues; doesn't explicitly verify plan adherence

**Architecture**:
```
pipeline:orch Phase 1: implement:orch (produces PR + design artifact)
pipeline:orch Phase 2: status log
pipeline:orch Phase 3: review:orch (code review per focus)
pipeline:orch Phase 4: status + resolve decision
pipeline:orch Phase 5: resolve:orch (fix issues)
pipeline:orch Phase 5b (NEW): semantic-bug-analysis:orch
  ├─ Load design artifact
  ├─ Load resolution-summary.md (what issues were found/fixed/deferred)
  ├─ Run semantic verifier agents (acceptance criteria, scope, integration)
  └─ Write semantic-verification-summary.md
pipeline:orch Phase 6: final summary
```

---

### Converging Findings: Where Sources Agree

**Trust**: **HIGH** (multiple independent sources confirm)

1. **Spec-vs-implementation verification is not a solved problem** — External research, codebase analysis, and technology evaluation all confirm the gap. No production tool does this systematically for general software specs.

2. **Plan documents (explicit specs) reduce false positives** — SGCR (explicit path) and Augment Code (living spec) both show that grounded, explicit specifications reduce FP rates vs. free-form LLM reasoning.

3. **Separate verification agents outperform self-review** — RFCAudit's two-agent architecture (Indexing + Detection), SpecRover's Reviewer agent, Augment's Verifier all show that a separate agent focused on spec compliance catches more than the generating agent reviewing itself.

4. **Acceptance criteria are verifiable** — BDD (Cucumber/Gauge), AI test generation (Katalon, ACCELQ), and property-based testing all confirm that acceptance criteria → executable tests → verification is a proven pipeline.

5. **Integration bugs require cross-file visibility** — SpecRover's code search, Factory AI's coordinator/specialist roles, and Augment's "system specification" all show that comparing against full scope (not isolated diffs) is essential for integration verification.

---

### Diverging Findings: Where Sources Disagree

**Trust**: MEDIUM (untrusted sources; conflicts highlight uncertainty)

| Topic | Codebase View | External View | Technology View | Resolution |
|-------|---------------|---------------|-----------------|------------|
| **Can LLMs verify specs reliably?** | Evaluator does it now (but FP rate unknown) | Jin & Chen: No, LLMs systematically fail | Mixed: some approaches (PBT, formal) reduce FP, others (pure LLM) remain unreliable | **Trusted**: LLMs alone insufficient; need anchors (tests, formal methods, properties) |
| **Self-review adequacy** | Evaluator already performs in-pipeline | External: identified as circular problem | Technology: Zietsman formally proves circularity | **Trusted**: Self-review is circular; external spec anchor needed |
| **Spec inference vs. upfront specs** | Devflow uses upfront plan docs (best case) | SpecRover demonstrates inference works (50%+ improvement) | Technology: SpecRover is academic (SWE-Bench), real-world unknown | **PRAGMATIC**: Devflow has upfront specs; use them. SpecRover pattern available as fallback |
| **Cost/complexity tradeoff** | Evaluator is lightweight (Opus, single pass) | RFCAudit: two-agent + indexing overhead; SpecRover: iterative (0.65/issue) | Technology: Factory's multi-trajectory is expensive; Qodo/Dafny moderate overhead | **PRAGMATIC**: Start lightweight (acceptance-criteria checker), scale to formal methods if needed |

---

### False Positive Mitigation: Concrete Strategies for Devflow

**Trust**: HIGH (converged evidence from external + technology)

**Strategy 1: Structured Acceptance Criteria Extraction** (SGCR Explicit Path pattern)
- Parse plan Section 5 (Acceptance Criteria) as structured rules
- Example: `"User can search by title"` → {component: SearchBox, field: title, operation: search, expected_outcome: results_displayed}
- Verifier checks presence of SearchBox + field binding + result handling in code
- Precision: deterministic rules (no LLM judgment), low FP rate

**Strategy 2: Acceptance Criteria → Generated Tests** (Katalon/ACCELQ pattern)
- Use LLM to generate executable test cases from acceptance criteria
- Example: Acceptance criterion → Cucumber scenario → step definitions → pytest/jest
- Verification: run tests against implementation
- Precision: tests are objective (pass/fail), not subjective

**Strategy 3: Property-Based Testing from Docs** (Anthropic research pattern)
- LLM infers invariant properties from acceptance criteria + docstrings + type annotations
- Example: `"search results are always sorted by relevance"` → property predicate
- Fuzzing tests the property; counterexamples are concrete bugs
- Precision: 81% (from Anthropic red-team research)

**Strategy 4: Scope Boundaries as Negative Tests** (SGCR pattern)
- Plan Section 7 (Scope) lists what's NOT included
- Verifier checks: no out-of-scope files modified, no out-of-scope APIs called
- Example: Scope says "no database migration"; verify no migration files added
- Precision: deterministic rule-based

**Strategy 5: Implementation Plan Step-to-Commit Traceability** (SpecRover's hierarchical search + git log)
- Parse plan Section 8 (Implementation Plan) into steps
- Example: `"Add search route"` → `"Create handler function"` → `"Wire to database query"`
- Trace each step through git commits + file changes
- Verify: no steps skipped, all steps have corresponding commits
- Precision: deterministic (step presence + order)

---

### Devflow-Specific Opportunity: Fastest Path Forward

**Trust**: **HIGH-MIXED** (codebase analysis trusted; architecture is novel inference from external + technology patterns)

**Current State**:
- Plan artifact exists (design.{slug}.{timestamp}.md with 12 sections)
- Plan flows to Implement via EXECUTION_PLAN variable
- Evaluator performs alignment check (but doesn't persist)
- Review is code-centric (security, performance, complexity) — NOT spec-centric
- Resolve fixes issues but doesn't verify plan adherence

**Fastest path** (6-8 week implementation estimate, based on Devflow's plugin architecture):

1. **Phase A: Evaluator Report Persistence** (Week 1-2)
   - Add Write call in implement:orch Phase 6 to persist Evaluator report to `.devflow/docs/design/{branch}-alignment-{timestamp}.md`
   - Test: Evaluator findings survive context compaction

2. **Phase B: Acceptance Criteria Extractor Agent** (Week 2-3)
   - New agent: reads plan Section 5 (Acceptance Criteria), parses into structured list
   - Output: `{criterion, verifiable, ambiguous_phrases, suggested_tests}`
   - Feeds into Phase C

3. **Phase C: Semantic Verifier Agent** (Week 3-5)
   - Receives: Acceptance Criteria list, DIFF, FILES_CHANGED, PR description, Evaluator report, git log
   - Performs 3 verification checks:
     1. **Acceptance check**: each criterion has evidence in code/tests/PR description
     2. **Scope check**: no out-of-scope files modified
     3. **Integration check**: no cross-file dependencies broken
   - Output: Structured report with {criterion, status, evidence, FP_risk_score}

4. **Phase D: Pipeline Integration** (Week 5-8)
   - Add semantic-bug-analysis:orch skill (Phase 5b in pipeline:orch)
   - Wire Acceptance Criteria Extractor + Semantic Verifier
   - Produce semantic-verification-summary.md (in `.devflow/docs/reviews/{branch}/../`)
   - Thread findings into resolve stage (Resolver can cite semantic findings as context)

**Why this is unique to Devflow**:
- Devflow's plan artifact is the richest in the ecosystem (12 sections, YAML frontmatter, linked acceptance criteria, execution strategy)
- Devflow already has Evaluator (intent-alignment check) — just needs persistence
- Devflow's plugin architecture makes agent composition trivial
- Acceptance Criteria section is machine-readable (list format)
- Result: no other tool ingests plan artifacts + performs systematic acceptance-criteria verification

---

## By Research Type

### Codebase Research (TRUSTED)

**Key Contributions**:
- Rich artifact inventory (plan 12 sections, design artifact format, YAML frontmatter)
- Pipeline architecture (implement → review → resolve, extensible with new stages)
- Evaluator already performs goal-backward alignment check (but not persisted)
- Review artifacts structure (per-focus reports, synthesized summary, resolution tracking)
- Context threading is variable-mediated, not artifact-mediated (each stage re-derives its own context)

**Limitations**:
- Evaluator report format not detailed; may have additional intent-signals
- No end-to-end pipeline:orch examples found in artifacts
- Real-world FP rate of Evaluator unknown

---

### External Research (UNTRUSTED, High-Authority Sources)

**Key Contributions**:
- SDD tool landscape (Spec-First/Anchored/Source tiers; Martin Fowler analysis)
- SGCR dual-pathway (Explicit rules + heuristics; 42% adoption improvement)
- RFCAudit confirms spec-vs-code works for RFCs (47 bugs, 81.9% precision, 20 confirmed)
- LLM failure modes quantified (Jin & Chen: complex prompting worsens FP)
- Formal verification + LLM emerging (DafnyPro, PREFACE, Vecogen; 80-86% annotation accuracy)
- Multi-agent verification scales (10-20% gains per verifier)
- AI test generation production-ready (67% QA adoption; Katalon, ACCELQ)

**Limitations**:
- Tools evaluated largely from documentation/papers, not hands-on
- Startup claims (Tessl, ACCELQ) may overstate
- No evaluation of spec-verification specifically for plan-driven workflows

---

### Technology Research (MIXED: Untrusted Web + Structured Analysis)

**Key Contributions**:
- Six architecture patterns with pros/cons (Spec-Inference, Critique-Verify, Behavior-Model, Multi-Trajectory, PBT, Self-Review)
- Structural circularity formally identified (Zietsman, March 2026)
- SpecRover most directly applicable (spec inference → deposit to reviewer → guide patching)
- Augment Code's Critique/Verify separation is commercial best practice
- Dafny co-location of spec + implementation is gold standard
- Property-based testing with LLM achieves 81% precision (Anthropic research)
- Intent Formalization as spectrum (lightweight NL → heavyweight formal) with confidence scaling

**Limitations**:
- Most commercial tools evaluated from marketing/vendor docs, not independent review
- Academic papers (SpecRover, Zietsman) are high-quality but on curated benchmarks (SWE-Bench, not real specs)
- Augment Code architecture from vendor guides, no published precision/recall
- Several tools (Poolside, Codegen, Windsurf) have limited public verification details
- "Structural circularity" and "Intent Formalization" papers are March 2026 preprints, not yet peer-reviewed

---

## Trust Assessment

| Research Type | Trust | Quality | Findings Count |
|---------------|-------|---------|-----------------|
| **Codebase** | Trusted | High (direct reads, concrete artifacts, no inference) | 10 major findings |
| **External** | Untrusted | High (peer-reviewed papers, Thoughtworks/Fowler authority) | 14 major findings |
| **Technology** | Mixed | Medium (mostly vendor docs; some peer-reviewed; March 2026 preprints) | 8 major findings |

**Convergent findings** (≥2 sources independently confirm): 5
**Divergent findings** (sources conflict): 4
**Unique findings** (single source): 27

---

## Recommendations

### For Devflow Adoption (High Confidence)

1. **Implement Evaluator Report Persistence** (Week 1-2, trivial)
   - Evaluation findings are already generated; just persist to disk
   - No risk; immediate value (reference for review/resolve stages)

2. **Add Semantic Verifier Stage to Pipeline** (Week 3-8, moderate complexity)
   - Post-implement, pre-merge gate
   - Focus Phase 1: acceptance criteria extraction + verification (low FP via structured rules)
   - Aligns with Devflow's plan-driven philosophy

3. **Use Acceptance Criteria as Primary Verification Anchor** (Low Risk)
   - Plan Section 5 is machine-readable
   - Convert to structured rules (SGCR Explicit Path pattern) → deterministic verification, low FP
   - Generate tests from criteria (Katalon pattern) → executable verification

4. **Do NOT Rely on Self-Review Alone** (Mitigates Circularity)
   - Evaluator in implement:orch is circular (same model generates + reviews)
   - Adding external plan document as anchor breaks circularity
   - Matches Zietsman's recommendation

5. **Consider Property-Based Testing as Fallback** (Medium Complexity, High Precision)
   - For acceptance criteria that are quantifiable (e.g., performance, sorting, invariants)
   - Infer properties from criteria + code → fuzz → report counterexamples
   - 81% precision from Anthropic research; real bugs found

### For Long-Term Roadmap (Medium Confidence)

6. **Formal Methods for Critical Paths** (Low Priority)
   - DafnyPro/PREFACE approach: LLM generates annotation drafts, formal tools verify
   - Useful for safety-critical or security-critical code paths
   - Overhead is significant; use selectively

7. **Multi-Agent Verification Ensemble** (Low Priority)
   - Different agents for acceptance/scope/integration verification
   - 10-20% accuracy gains per additional verifier (MAV research)
   - Useful if FP rate becomes problem

8. **Specification Inference as Fallback** (Low Priority)
   - If user provides task description but no plan document
   - SpecRover pattern: infer specs from code + issue → deposit to reviewer
   - Lower priority than upfront-spec path (Devflow has plans)

---

## Limitations

- **No production deployment data**: All findings are from research papers, vendor docs, and codebase analysis. No field data from real semantic-verification systems.
- **Devflow's plan artifacts are untested for this purpose**: The 12-section format was designed for implementation planning, not automated verification. Acceptance Criteria structure may require iteration.
- **Evaluator FP rate unknown**: Devflow's Evaluator performs alignment checks but no metrics published. FP rate could be high (matching Jin & Chen's findings).
- **Academic benchmarks are curated**: SWE-Bench, SWE-AGI, DafnyBench are not representative of real business requirements (ambiguous PRDs, unclear acceptance criteria).
- **Integration complexity underestimated**: Real specifications have ambiguities, contradictions, unstated assumptions. Conversion to executable rules is non-trivial.
- **Language-specific tools excluded**: Formal verification tools (Dafny, TLA+, Alloy) are language/domain-specific. Applicability to Devflow's polyglot plugin system unclear.

---

## Conclusion

Devflow has a **genuine opportunity to build the first production semantic bug detector** by:

1. **Anchoring verification in its plan artifacts** (the richest in the ecosystem)
2. **Breaking circularity** by persisting Evaluator findings and threading them through review/resolve
3. **Starting with acceptance criteria** (structured, low FP via rule-based verification)
4. **Scaling to properties and formal methods** as needed for high-risk areas

The market gap is real (no tool does this). The architecture patterns are proven (SGCR, SpecRover, Augment). The FP mitigation strategies are actionable (structured rules, property-based testing, multi-agent verification).

**Recommendation: Proceed with Phase A-B as a 2-3 week spike, validate Acceptance Criteria extractor output, then scope Phase C-D for full pipeline integration.**
