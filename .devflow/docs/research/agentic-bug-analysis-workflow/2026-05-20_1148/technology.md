<!-- trust: mixed -->
# Technology Evaluation: Automated/AI-Powered Bug Detection and Code Analysis Tools

**Date**: 2026-05-20
**Trust**: mixed (web research: untrusted, codebase references: trusted)
**Candidates Evaluated**: 25+ tools across 6 categories

---

## 1. Static Analysis Tools

### 1.1 CodeQL (GitHub)

| Dimension | Details |
|-----------|---------|
| **Detection Approach** | Semantic analysis; compiles source into relational database (AST + data flow graph + control flow graph); queries via QL (Datalog-derived declarative language) |
| **Bug Categories** | Security vulnerabilities (OWASP Top 10), taint tracking, injection flaws, data flow violations; ~318 default security queries expandable to 432+ |
| **False Positive Rate** | 68.2% FP rate on OWASP Benchmark v1.2 (2,740 Java test cases); F1=74.4%, Precision=60.3% ([Konvu 2026 comparison](https://konvu.com/compare/semgrep-vs-codeql)) |
| **Integration** | Native GitHub Actions one-click setup; CLI for any CI; incremental analysis added September 2025; Copilot Autofix generates AI-powered suggestions |
| **Languages** | ~12 deeply supported (Java, C/C++, C#, Python, JavaScript, TypeScript, Go, Ruby, Swift, Kotlin); no PHP |
| **Performance** | Minutes to 30+ minutes scan time; ~450MB memory; database construction required |
| **Strengths** | Deepest semantic analysis; cross-function/cross-file data flow; strong for complex multi-step vulnerability patterns; GitHub-native ecosystem |
| **Weaknesses** | Steep QL learning curve (hours to days for production queries); slow scans; requires buildable environment; limited language coverage; high FP rate |
| **Agentic Workflow Fit** | Best as a deep-analysis oracle invoked selectively on high-risk files; too slow for continuous agent loops; results could feed LLM reasoning as structured evidence |

**Sources**: [Konvu Semgrep vs CodeQL 2026](https://konvu.com/compare/semgrep-vs-codeql), [Semgrep official comparison](https://semgrep.dev/docs/faq/comparisons/codeql), [Rafter comparison](https://rafter.so/blog/static-code-analysis-tools-comparison)

---

### 1.2 Semgrep

| Dimension | Details |
|-----------|---------|
| **Detection Approach** | AST-based pattern matching via tree-sitter parsers; YAML rules resembling target syntax; metavariables + ellipsis operators; CE: intraprocedural only; Pro: cross-file/cross-function |
| **Bug Categories** | Security, correctness, performance anti-patterns; 2,800+ community rules + proprietary Pro rules; custom rules writable in minutes |
| **False Positive Rate** | 74.8% FP rate on OWASP Benchmark (CE only); F1=69.4%, Precision=56.3%; Pro Engine unverified in independent benchmarks |
| **Integration** | CLI-agnostic (GitHub, GitLab, Jenkins, Bitbucket, CircleCI, Azure); `semgrep ci` for diff-aware scanning; Managed Scans mode; native PR comments with autofix |
| **Languages** | 35+ (including PHP, Terraform, IaC platforms); many at experimental level |
| **Performance** | ~10 seconds median scan; ~150MB memory |
| **Strengths** | Extremely fast; easy rule authoring (45 seconds for simple rules); broad language coverage; diff-aware CI scanning; large rule ecosystem |
| **Weaknesses** | CE limited to single-file analysis; high FP rate without Pro cross-file analysis; December 2024 license change pushed features behind paywall (spawned Opengrep fork January 2025) |
| **Agentic Workflow Fit** | Ideal as fast first-pass filter in agent pipeline; rules can be dynamically selected per file type; results structured as SARIF for downstream LLM consumption; fast enough for per-commit scanning |

**Note**: EASE 2024 research found that "missing rules, not analysis engine limitations, cause most false negatives" -- custom rules achieved 44.7% detection vs 38.8% baseline.

**Sources**: [Konvu comparison](https://konvu.com/compare/semgrep-vs-codeql), [DEV Community comparison](https://dev.to/rahulxsingh/semgrep-vs-codeql-lightweight-patterns-vs-semantic-analysis-for-sast-2026-412k), [Semgrep docs](https://semgrep.dev/docs/faq/comparisons/codeql)

---

### 1.3 Infer (Meta)

| Dimension | Details |
|-----------|---------|
| **Detection Approach** | Separation logic + bi-abduction; compositional analysis (examines procedures independently); incremental analysis on code changes |
| **Bug Categories** | Null pointer exceptions, memory safety (buffer overflows, use-after-free), resource leaks, concurrency race conditions, missing lock guards, annotation reachability violations |
| **False Positive Rate** | Not independently benchmarked on OWASP; Meta reported developers fixing >1000 bugs/month by 2015; designed for low FP via compositional analysis |
| **Integration** | CLI tool; CI integration; incremental diff-based analysis; automated code review comments at Meta |
| **Languages** | Java, C, C++, Objective-C (primarily Android/iOS) |
| **Performance** | Fast incremental analysis on diffs; full scan slower but compositional approach scales well |
| **Strengths** | Mathematically grounded (separation logic); excellent at memory safety and concurrency bugs; scales to enormous codebases (Meta-scale); incremental analysis |
| **Weaknesses** | Narrow language support; no JavaScript/TypeScript/Python; steep theoretical barrier to extending; smaller community than Semgrep/CodeQL |
| **Agentic Workflow Fit** | Specialized oracle for memory safety and concurrency in C/C++/Java; results highly trustworthy due to formal foundations; could feed high-confidence signals to LLM reasoning layer |

**Sources**: [Wikipedia - Infer Static Analyzer](https://en.wikipedia.org/wiki/Infer_Static_Analyzer), [ACM - Scaling Static Analyses at Facebook](https://cacm.acm.org/research/scaling-static-analyses-at-facebook/)

---

### 1.4 SpotBugs / ESLint / Pylint

| Tool | Approach | Bug Categories | Integration | Agentic Fit |
|------|----------|---------------|-------------|-------------|
| **SpotBugs** | Bytecode analysis (Java); pattern-based bug detection | ~400+ bug patterns: correctness, bad practice, performance, multithreading, security | Maven/Gradle plugin, CI integration, IDE plugins | Fast Java-specific oracle; structured XML/SARIF output parseable by agents |
| **ESLint** | AST-based rule matching (JavaScript/TypeScript); plugin ecosystem | Code quality, possible errors, best practices; `eslint-plugin-security` for security; `no-unsafe-*` rules | CLI, IDE integration, CI/CD; `.eslintrc` config | Already ubiquitous in JS projects; agent can dynamically enable/disable rule sets; fast per-file analysis |
| **Pylint** | AST analysis (Python); type inference; convention checking | Errors, warnings, refactoring suggestions, convention violations; ~200+ checks | CLI, IDE integration, CI/CD | Python-specific first-pass; structured JSON output; limited security coverage compared to Bandit |

**Sources**: [Qodo blog - 10 Best Code Analysis Tools 2026](https://www.qodo.ai/blog/code-analysis-tools/), [JetBrains Qodana linters](https://www.jetbrains.com/help/qodana/linters.html)

---

## 2. AI-Powered Analysis Tools

### 2.1 Snyk Code (DeepCode AI)

| Dimension | Details |
|-----------|---------|
| **Detection Approach** | Hybrid symbolic + generative AI; multiple fine-tuned ML models (not single-model); trained on 25M+ data flow cases from permissively licensed OSS with verified fixes |
| **Bug Categories** | Security vulnerabilities, code quality issues, tech debt; 19+ languages; OWASP Top 10 coverage |
| **False Positive Rate** | Claims 80%-accurate security autofixes; ML approach produces "low false positive rate" per independent comparison; MTTR reduction of 84%+ |
| **Integration** | IDE plugins (real-time), CLI, CI/CD integration, PR scanning, Snyk Agent Fix for automated remediation |
| **Strengths** | Fast scanning; low FP due to ML approach; automated fix suggestions; context-aware risk scoring; doesn't use customer data for training |
| **Weaknesses** | Commercial product; ML model opacity (less auditable than rule-based tools); accuracy claims not independently verified on standard benchmarks |
| **Agentic Workflow Fit** | Strong as an automated fix-suggestion generator; API could be invoked by agent to get both detection + remediation; Snyk MCP tools already available for integration |

**Sources**: [Snyk DeepCode AI](https://snyk.io/platform/deepcode-ai/), [Rafter comparison](https://rafter.so/blog/static-code-analysis-tools-comparison)

---

### 2.2 Qodana (JetBrains)

| Dimension | Details |
|-----------|---------|
| **Detection Approach** | Reuses JetBrains IDE inspection engines; 3,000+ inspections; deep analysis for JVM languages |
| **Bug Categories** | Code quality, bug detection, security, code smells, dead code, type errors; integrates ESLint for JS |
| **False Positive Rate** | Not independently benchmarked; inherits JetBrains inspection accuracy (mature, well-tuned) |
| **Integration** | CLI (`qodana-cli`), CI/CD (GitHub Actions, GitLab CI, Jenkins), Docker-based; cloud dashboard |
| **Languages** | 14 linters: Java, Kotlin, Groovy, JS/TS, PHP, Python, C#, Ruby, C++, Go, Rust, Android |
| **Strengths** | Broadest inspection count (3,000+); leverages decades of JetBrains IDE inspection maturity; good language breadth |
| **Weaknesses** | Heavy Docker-based setup; commercial licensing for full features; not as fast as Semgrep for CI |
| **Agentic Workflow Fit** | Comprehensive baseline scanner; structured SARIF output; could serve as "linter of linters" aggregating multiple language-specific checks; Docker requirement adds complexity for agent orchestration |

**Sources**: [JetBrains Qodana](https://www.jetbrains.com/qodana/), [CodeRabbit vs Qodana](https://dev.to/rahulxsingh/coderabbit-vs-qodana-ai-code-review-vs-jetbrains-static-analysis-521j), [Qodana linters](https://www.jetbrains.com/help/qodana/linters.html)

---

### 2.3 Amazon CodeGuru

| Dimension | Details |
|-----------|---------|
| **Detection Approach** | ML-powered; trained on Amazon internal codebase + open source; pattern recognition for performance and security |
| **Bug Categories** | Security vulnerabilities, resource leaks, concurrency issues, incorrect input validation, OWASP Top 10, AWS best practices |
| **Status** | **Deprecated as of November 7, 2025** -- new repository associations cannot be created in CodeGuru Reviewer |
| **Agentic Workflow Fit** | Not viable for new integrations due to deprecation |

**Sources**: [scmGalaxy - Top 10 AI Bug Detection Tools 2025](https://www.scmgalaxy.com/tutorials/top-10-ai-bug-detection-tools-in-2025-features-pros-cons-comparison/)

---

## 3. Agentic Software Engineering Frameworks

### 3.1 SWE-agent / live-SWE-agent

| Dimension | Details |
|-----------|---------|
| **Approach** | Agent-based; LLM interacts with executable environment for multiple turns; makes changes, runs tests, determines when to stop autonomously |
| **Performance** | live-SWE-agent + Claude Opus 4.5: **79.2%** on SWE-bench Verified (top score as of May 2026) |
| **Architecture** | Custom Agent-Computer Interface (ACI) providing file viewing, editing, searching, and terminal access; environment-based interaction loop |
| **Strengths** | Highest benchmark performance; real-time environment interaction; autonomous multi-step reasoning |
| **Weaknesses** | High compute cost per issue; environment setup overhead; performance heavily dependent on underlying LLM |
| **Bug Detection Relevance** | Primarily a bug-fixing agent, not a bug-finding tool; demonstrates that agent scaffolding architecture significantly impacts performance |

**Sources**: [CodeSOTA SWE-bench Leaderboard](https://www.codesota.com/browse/agentic/swe-bench), [SWE-EVO paper](https://arxiv.org/html/2512.18470v5)

---

### 3.2 Agentless (UIUC)

| Dimension | Details |
|-----------|---------|
| **Approach** | Workflow-based (not agent-based); pre-defined pipeline: hierarchical localization -> repair -> patch validation |
| **Performance** | 27.3% on SWE-bench Lite (best open-source at time of release); ~$0.34 per issue average cost |
| **Architecture** | Three phases: (1) Hierarchical fault localization (files -> classes/functions -> edit locations); (2) Multiple candidate patch generation in diff format; (3) Regression test selection + reproduction test generation |
| **Strengths** | Simple, reproducible, low cost; no environment interaction needed; transparent pipeline; competitive with complex agent systems |
| **Weaknesses** | Lower ceiling than agent-based approaches; rigid pipeline limits adaptability; dependent on LLM localization accuracy |
| **Bug Detection Relevance** | Hierarchical localization approach is directly applicable to bug detection -- the same locate-then-analyze pipeline works for finding bugs, not just fixing them |

**Sources**: [Agentless GitHub](https://github.com/OpenAutoCoder/Agentless), [Hugging Face paper page](https://huggingface.co/papers/2407.01489), [Agentless paper](https://arxiv.org/pdf/2407.01489)

---

### 3.3 AutoCodeRover

| Dimension | Details |
|-----------|---------|
| **Approach** | Hybrid; combines LLMs with AST-based code search; program structure-aware navigation |
| **Performance** | 19% on SWE-bench (August 2024); early entrant that demonstrated AST-aware search value |
| **Architecture** | LLM + sophisticated AST-based search for code navigation; uses program structure to guide localization |
| **Strengths** | AST-awareness reduces hallucination in code navigation; structured search over unstructured grep |
| **Weaknesses** | Superseded by newer approaches; lower benchmark scores |
| **Bug Detection Relevance** | AST-based search combined with LLM reasoning is a pattern applicable to bug detection -- structure-aware navigation prevents the LLM from getting lost in large codebases |

**Sources**: [SWE-EVO paper](https://arxiv.org/html/2512.18470v5)

---

### 3.4 Aider

| Dimension | Details |
|-----------|---------|
| **Approach** | Terminal-based AI pair programming; git-native (every edit is a commit) |
| **Stats** | 39K GitHub stars; 4.1M installs; 15B tokens/week |
| **Architecture** | Local git integration; supports GPT-4, Claude 3.5+; whole-file and diff-based editing modes |
| **Strengths** | Git-native workflow; lightweight; broad model support; mature ecosystem |
| **Weaknesses** | Interactive pair programming tool, not autonomous bug detection; requires human in the loop |
| **Bug Detection Relevance** | Interaction patterns (edit-test-commit loop) inform how an agentic workflow should structure its repair cycle |

**Sources**: [Aider on bestaiagents.ai](https://bestaiagents.ai/agent/aider), [MorphLLM comparison](https://www.morphllm.com/ai-coding-agent)

---

### 3.5 Devin (Cognition AI)

| Dimension | Details |
|-----------|---------|
| **Approach** | Autonomous AI software engineer; agent-native cloud IDE; multiple parallel instances |
| **Performance** | PR merge rate improved from 34% to 67% over 2025; security vulnerability remediation in 1.5 min average vs 30 min human |
| **Strengths** | Full environment access (terminal, editor, browser); parallel execution; strong at routine bug fixes and security patches |
| **Weaknesses** | Commercial/proprietary; early benchmarks showed 13.86% autonomous fix rate; opaque internals |
| **Bug Detection Relevance** | Demonstrates viability of autonomous bug fixing at scale; parallel agent execution pattern is applicable to multi-file bug detection |

**Sources**: [DeployHQ Devin Guide](https://www.deployhq.com/guides/devin), [MightyBot comparison](https://mightybot.ai/blog/coding-ai-agents-for-accelerating-engineering-workflows/)

---

## 4. Research Tools and Approaches

### 4.1 OSS-Fuzz + LLM Target Generation (Google)

| Dimension | Details |
|-----------|---------|
| **Approach** | LLM generates fuzz targets for under-tested code; iterative fix loop for compilation errors |
| **Results** | 14/31 projects successfully compiled new targets with coverage improvements; TinyXML2: 31% coverage improvement (38% -> 69%); rediscovered CVE-2022-3602 in OpenSSL |
| **Architecture** | 5-step: target identification (Fuzz Introspector) -> prompt engineering -> build/compilation -> quality metrics -> iterative fixing |
| **Strengths** | Scales fuzzing coverage to under-tested code; automated; finds real CVEs |
| **Weaknesses** | GPT-4 correctly generates ~40% of drivers; remaining have errors requiring iteration; C/C++ focused |
| **Bug Detection Relevance** | Demonstrates LLM-guided test generation for bug finding; the identify-undercover-fuzz pattern is generalizable beyond fuzzing |

**Sources**: [OSS-Fuzz LLM target generation](https://google.github.io/oss-fuzz/research/llms/target_generation/), [oss-fuzz-gen GitHub](https://github.com/google/oss-fuzz-gen)

---

### 4.2 Sapienz (Meta)

| Dimension | Details |
|-----------|---------|
| **Approach** | Multi-objective search-based testing for Android; combines random fuzzing, systematic exploration, and search-based optimization |
| **Results** | Found 558 unique crashes across top 1,000 Google Play apps |
| **Strengths** | Automated UI exploration; minimizes test length while maximizing coverage and fault revelation |
| **Weaknesses** | Android-specific; not a general-purpose bug detection tool |
| **Bug Detection Relevance** | Multi-objective optimization (minimize effort, maximize coverage + fault finding) is a transferable principle for agentic workflows |

**Sources**: [Sapienz ACM paper](https://dl.acm.org/doi/10.1145/2931037.2931054), [ResearchGate](https://www.researchgate.net/publication/305026862_Sapienz_multi-objective_automated_testing_for_Android_applications)

---

### 4.3 CodaMosa

| Dimension | Details |
|-----------|---------|
| **Approach** | Hybrid search-based testing + LLM; when coverage plateau is reached, LLM generates seed inputs to overcome it |
| **Architecture** | Extends Pynguin (Python test generation); monitors coverage progress; triggers LLM assistance at stall points |
| **Strengths** | Intelligent LLM invocation only when needed (not continuous); addresses the coverage plateau problem |
| **Bug Detection Relevance** | "LLM as escape hatch" pattern -- use traditional tools until stuck, then invoke LLM -- is highly efficient and applicable to bug detection workflows |

**Sources**: [LLM4SoftwareTesting GitHub](https://github.com/LLM-Testing/LLM4SoftwareTesting), [Automated test generation + LLM + search](https://arxiv.org/html/2509.01616)

---

## 5. Hybrid LLM + Static Analysis Approaches

### 5.1 LLIFT (LLM-Integrated Static Analysis)

| Dimension | Details |
|-----------|---------|
| **Approach** | Synergizes static analysis with LLMs; post-constraint guidance; focuses on use-before-initialization (UBI) bugs in Linux kernel |
| **Results** | Found 4 previously undiscovered UBI bugs in mainstream Linux kernel (acknowledged by Linux community) |
| **Architecture** | Static analysis identifies potential bugs -> LLM performs path feasibility analysis with constraint guidance -> filters false positives |
| **Published** | OOPSLA 2024 (ACM Programming Languages) |
| **Bug Detection Relevance** | Pioneering example of static analysis as "bug candidate generator" + LLM as "false positive filter" -- the architecture is directly applicable |

**Sources**: [LLIFT paper at SPLASH 2024](https://2024.splashcon.org/details/splash-2024-oopsla/18/Enhancing-Static-Analysis-for-Practical-Bug-Detection-An-LLM-Integrated-Approach), [ACM DL](https://dl.acm.org/doi/10.1145/3649828)

---

### 5.2 ZeroFalse

| Dimension | Details |
|-----------|---------|
| **Approach** | Treats SARIF alerts as structured contracts; enriches with contextual evidence; LLM adjudication with CWE-specific micro-rubrics |
| **Results** | OWASP Benchmark: grok-4 F1=0.912, Precision~0.98, Recall~0.85; OpenVuln real-world: gpt-5 F1=0.955, Precision=1.0, Recall=0.914 |
| **Architecture** | 5-stage: Canonicalization -> Contextual Enrichment -> CWE-Specialized Prompting -> Code Context Extraction -> LLM Assessment |
| **Key Finding** | "Models can overfit to benchmark patterns that do not exist in the wild" -- OWASP vs real-world performance divergence is significant |
| **Bug Detection Relevance** | CWE-specific micro-rubrics (10-20 declarative rules per weakness) are a proven technique for structured LLM reasoning about bugs |

**Sources**: [ZeroFalse paper](https://arxiv.org/html/2510.02534)

---

### 5.3 LLM4PFA (Tencent Industrial Study)

| Dimension | Details |
|-----------|---------|
| **Approach** | LLM + static analysis path feasibility analysis; tested at Tencent on real enterprise codebase |
| **Results** | Eliminates 94-98% of false positives with high recall; Accuracy 0.93-0.94; Precision 0.83-0.93; Recall 0.75-0.88 |
| **Cost** | $0.0011-$0.12 per alarm; 2.1-109.5 seconds per alarm; orders-of-magnitude savings vs manual review |
| **Bug Types Tested** | Null Pointer Dereference (NPD), Out-of-Bounds (OOB), Divide-by-Zero (DBZ) |
| **Key Finding** | Performance varies by bug type: DBZ best, NPD most challenging due to "complex cascaded constraints" |
| **LLM Weaknesses Identified** | Limited long-context reasoning; difficulty with complex cascaded constraints; insufficient understanding of specialized syntax |

**Sources**: [arXiv paper](https://arxiv.org/html/2601.18844v1)

---

### 5.4 IRIS (Neuro-Symbolic)

| Dimension | Details |
|-----------|---------|
| **Approach** | Neuro-symbolic; GPT-4 + static analysis |
| **Results** | Identified 55 vulnerabilities vs CodeQL's 27 on CWE-Bench-Java; reduced false discovery rate by 5 percentage points |
| **Bug Detection Relevance** | Demonstrates that LLM + static analysis finds 2x more vulnerabilities than static analysis alone |

**Sources**: [Ranger Hybrid AI Models](https://www.ranger.net/post/hybrid-ai-models-bug-detection-00b29)

---

### 5.5 Emerging Hybrid Architectures

Three architectural patterns are emerging in the hybrid space:

| Pattern | Description | Example |
|---------|-------------|---------|
| **CEGIS Loop** | LLM proposes fix, symbolic engine verifies, counterexamples refine next attempt | LLM-C (GPT-5.1 + Java PathFinder): 85.7% branch coverage vs 62.3% traditional |
| **RAG-augmented Analysis** | Rule-based static analysis results fed into LLM inputs, grounding reasoning with constraints | Buglens: 7x precision improvement over raw LLM |
| **Gated Merging** | Separate neural nets process different features (semantic structure, complexity metrics) with learned weight fusion | ConSynergy: concurrency-aware slicing + CoT + SMT verification |

**Sources**: [Ranger Hybrid AI Models](https://www.ranger.net/post/hybrid-ai-models-bug-detection-00b29), [Springer: Automatic Bug Detection with LLMs and AI Agents](https://link.springer.com/chapter/10.1007/978-3-032-03705-3_11)

---

## 6. Bug Categorization Frameworks

### 6.1 CWE (Common Weakness Enumeration)

| Dimension | Details |
|-----------|---------|
| **Structure** | 600+ categories organized in three levels: Pillars (high-level groupings), Classes (broad error categories), Bases (specific coding flaws) |
| **Version** | CWE 4.15 (July 2024) |
| **Static Analysis Coverage** | Detected issues cluster around 25-80 CWE types; tools rarely cover the full taxonomy |
| **Usage** | SAST/DAST tools report findings using CWE IDs; enables cross-tool comparison; standard for vulnerability classification |
| **Agentic Workflow Fit** | CWE IDs provide a universal vocabulary for bug categorization across tools; agent can use CWE taxonomy to route bugs to appropriate analyzers |

**Top CWE Categories for Static Analysis**:
- CWE-79: Cross-site Scripting (XSS)
- CWE-89: SQL Injection
- CWE-476: NULL Pointer Dereference
- CWE-787: Out-of-bounds Write
- CWE-416: Use After Free
- CWE-190: Integer Overflow
- CWE-22: Path Traversal
- CWE-798: Hard-coded Credentials

**Sources**: [CWE Overview - EmergentMind](https://www.emergentmind.com/topics/common-weakness-enumeration-cwe), [Wikipedia - CWE](https://en.wikipedia.org/wiki/Common_Weakness_Enumeration), [Parasoft CWE](https://www.parasoft.com/blog/what-is-cwe/)

---

## 7. Cross-Tool Comparison Matrix

### Detection Approach Comparison

| Tool | Approach | Speed | Depth | FP Rate |
|------|----------|-------|-------|---------|
| Semgrep | AST pattern matching | Very fast (~10s) | Shallow (CE) / Medium (Pro) | High (74.8% CE) |
| CodeQL | Semantic DB queries | Slow (minutes-30min) | Deep (cross-file data flow) | High (68.2%) |
| Infer | Separation logic | Fast (incremental) | Deep (compositional) | Low (by design) |
| Snyk Code | Hybrid ML | Fast | Medium | Low (ML-tuned) |
| Qodana | IDE inspections | Medium | Medium-Deep | Medium |
| SpotBugs | Bytecode analysis | Fast | Medium (Java-only) | Medium |

### Bug Category Coverage Matrix

| Bug Category | CodeQL | Semgrep | Infer | Snyk | ESLint | Pylint |
|-------------|--------|---------|-------|------|--------|--------|
| Injection (SQLi, XSS) | Yes | Yes | No | Yes | Partial | No |
| Null/Undef References | Yes | Partial | Yes | Yes | Partial | Yes |
| Memory Safety | Yes (C/C++) | No | Yes | Partial | N/A | N/A |
| Resource Leaks | Yes | Partial | Yes | Yes | No | No |
| Concurrency/Race | Partial | No | Yes | No | No | No |
| Auth/Access Control | Partial | Yes (rules) | No | Yes | No | No |
| Business Logic | No | No | No | No | No | No |
| Code Quality | No | Yes | No | Yes | Yes | Yes |

### Agentic Workflow Suitability

| Tool | API Available | SARIF Output | Diff-Aware | Cost per Scan | Agent-Friendly |
|------|-------------|-------------|------------|--------------|----------------|
| Semgrep | CLI + API | Yes | Yes | Free (CE) | High |
| CodeQL | CLI + GitHub API | Yes | Yes (2025+) | Free (OSS) | Medium (slow) |
| Infer | CLI | Custom | Yes | Free | Medium |
| Snyk Code | CLI + API + MCP | Yes | Yes | Freemium | High |
| Qodana | CLI + API | Yes | No | Freemium | Medium |

---

## 8. Composable Agentic Workflow Patterns

Based on the research, five compositional patterns emerge for agentic bug detection:

### Pattern 1: Tiered Analysis Pipeline
```
Fast Filter (Semgrep/ESLint, ~10s)
  -> Candidates with SARIF metadata
    -> Deep Analysis (CodeQL/Infer, minutes)
      -> High-confidence findings
        -> LLM Reasoning (false positive filtering)
          -> Verified bugs with fix suggestions
```
**Evidence**: ZeroFalse's 5-stage pipeline + Tencent's LLM4PFA achieving 94-98% FP elimination

### Pattern 2: LLM as Escape Hatch
```
Traditional Analysis runs continuously
  -> When coverage plateaus or FP rate is high
    -> LLM invoked with structured context
      -> CWE-specific micro-rubrics guide reasoning
```
**Evidence**: CodaMosa pattern; Buglens 7x precision improvement

### Pattern 3: Hierarchical Localization
```
File-level localization (AST search / git blame)
  -> Function-level localization (data flow analysis)
    -> Line-level localization (LLM with constraints)
      -> Candidate patch generation + validation
```
**Evidence**: Agentless 3-phase approach; AutoCodeRover AST-aware search

### Pattern 4: CEGIS Verification Loop
```
LLM proposes bug hypothesis
  -> Symbolic/static engine verifies feasibility
    -> If counterexample found, refine hypothesis
      -> Iterate until convergence or budget exhausted
```
**Evidence**: LLM-C achieving 85.7% branch coverage; IRIS finding 2x vulnerabilities

### Pattern 5: Multi-Objective Optimization
```
Multiple analysis agents in parallel
  -> Each optimizes different objective (coverage, fault density, precision)
    -> Pareto-optimal selection of findings
      -> Human review of highest-value findings only
```
**Evidence**: Sapienz multi-objective approach; SWE-bench showing scaffold architecture matters as much as model

---

## Confidence Assessment

| Finding | Confidence | Basis |
|---------|-----------|-------|
| Semgrep fastest for CI integration (~10s) | High | Multiple independent sources, consistent benchmarks (untrusted, corroborated) |
| CodeQL deepest semantic analysis | High | Multiple independent sources, OWASP benchmark data (untrusted, corroborated) |
| Hybrid LLM+SA eliminates 94-98% FP | Medium | Single industrial study at Tencent; not independently replicated (untrusted, single source) |
| ZeroFalse F1=0.912-0.955 | Medium | Single paper; OWASP vs real-world gap noted by authors themselves (untrusted, self-reported) |
| IRIS finds 2x vulnerabilities vs CodeQL | Medium | Single study on CWE-Bench-Java (untrusted, single source) |
| live-SWE-agent 79.2% on SWE-bench Verified | High | Public leaderboard with reproducible results (untrusted, verified methodology) |
| Agentless localization pipeline effective at $0.34/issue | High | Open-source, reproducible, widely cited (untrusted, corroborated) |
| Amazon CodeGuru deprecated Nov 2025 | High | First-party deprecation notice (untrusted, authoritative) |
| CWE coverage clusters around 25-80 types | Medium | Research observation, not a formal study (untrusted, single source) |
| Agent scaffold matters as much as LLM model | High | SWE-bench leaderboard shows same model varies by scaffold (untrusted, empirical evidence) |

---

## Limitations

1. **Benchmark bias**: OWASP Benchmark and SWE-bench are the most-cited benchmarks, but ZeroFalse authors explicitly noted that "models can overfit to benchmark patterns that do not exist in the wild" -- real-world performance may differ significantly
2. **Semgrep Pro unverified**: Independent benchmarks tested only Semgrep CE (open source); the commercial Pro Engine with cross-file analysis has not been independently benchmarked against CodeQL
3. **Cost data sparse**: Only Agentless ($0.34/issue) and LLM4PFA ($0.0011-$0.12/alarm) provided concrete cost data; most tools lack published per-scan economics
4. **False positive rates context-dependent**: Reported FP rates vary enormously by codebase, language, and rule configuration; the 68-75% rates from OWASP Benchmark may not reflect real-world usage with tuned rules
5. **Recency**: Some tool evaluations are from 2024-2025; the hybrid LLM+SA field is evolving rapidly (monthly new papers)
6. **No hands-on evaluation**: All tool capabilities reported from documentation and third-party benchmarks, not from direct testing
7. **Business logic bugs**: No tool in any category reliably detects business logic vulnerabilities, authorization bypass, or domain-specific correctness issues -- this remains a gap that only human review or domain-specific LLM reasoning can address
8. **CodaMosa and Sapienz details sparse**: Limited public benchmarks for these research tools compared to the commercial and SWE-bench-focused tools
