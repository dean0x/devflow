# Vision: Structure-Preserving TypeScript Compression

**Date:** 2025-10-04
**Status:** Active
**Owner:** DevFlow Kit

---

## Purpose

Build a **precise, reproducible, research-grade** tool for compressing TypeScript files that preserves semantic structure while removing implementation details, enabling efficient AI-assisted code analysis with measurable token reduction.

---

## Problem Statement

### The Core Issue

AI coding assistants (Claude, GPT-4, etc.) have token limits that constrain how much code they can analyze at once. Sending full implementation details wastes tokens on information that's often unnecessary for:

- Architecture analysis
- Security pattern detection
- Dependency auditing
- Type relationship understanding
- API surface review

### Current Workarounds (All Inadequate)

1. **Manual Summarization** - Time-consuming, inconsistent, lossy
2. **Regex Stripping** - Brittle, breaks on edge cases, produces invalid code
3. **Selective File Sending** - Misses important context, guesswork
4. **Abbreviated Comments** - Unreliable, requires manual effort
5. **Asking Claude to Compress** - Costs tokens to save tokens, non-deterministic

### Why This Matters for Research

As someone working in theoretical/research applications:

- **Reproducibility:** Need identical compression results across runs
- **Measurability:** Must quantify token savings accurately
- **Validation:** Need to prove compression doesn't degrade AI understanding
- **Extensibility:** Want to experiment with compression strategies
- **Transparency:** Algorithm must be inspectable and modifiable

---

## Goals

### Primary Goals (v1)

1. **Accurate Compression**
   - Preserve: Type signatures, interfaces, imports/exports, class structure
   - Strip: Function bodies, method implementations
   - Output: Valid TypeScript that type-checks

2. **Measurable Impact**
   - Report exact token counts (before/after)
   - Calculate reduction percentage
   - Support both accurate (API) and approximate (tiktoken) counting
   - Track metrics across compression runs

3. **CLI-First Experience**
   - `devflow compress <file>` - Simple, intuitive command
   - Output to stdout or file
   - Progress/status reporting
   - Exit codes for scripting

4. **Validation & Trust**
   - Compressed output must pass `tsc --noEmit`
   - Comprehensive test suite (fixtures)
   - Real-world validation (test on known projects)
   - Clear error messages

5. **Research Enablement**
   - Deterministic (same input = same output)
   - Inspectable (readable compressed output)
   - Documented algorithm
   - Extensible architecture

### Secondary Goals (v2+)

6. **Multiple Compression Levels** (Future)
   - Level 1: Strip bodies only
   - Level 2: Collapse long type definitions
   - Level 3: Summarize large object literals
   - Custom: User-defined rules

7. **Batch Compression** (Future)
   - Compress entire directories
   - Parallel processing
   - Progress bars
   - Summary reports

8. **Integration with DevFlow Commands** (Future)
   - `/pre-pr --compress` - Compress large PRs for review
   - `/audit --compress` - Architecture audits on big codebases
   - Automatic compression when file count > threshold

9. **JSX/TSX Support** (Future)
   - React/Vue component compression
   - Preserve props/types, strip render logic

10. **Quality Metrics** (Research)
    - A/B testing: Claude responses on full vs compressed
    - Measure understanding degradation (if any)
    - Publish findings on optimal compression strategies

---

## Non-Goals

### Explicitly Out of Scope

1. **Real-Time Compression** - Not an editor plugin, not for watch mode
2. **JavaScript Support (v1)** - TypeScript only initially
3. **Minification** - Not trying to reduce characters, only tokens
4. **Code Obfuscation** - Output must remain readable
5. **Semantic Compression** - Not using AI to summarize (too slow/expensive)
6. **Cross-Language Support** - TypeScript only (Python/Go/etc. are separate efforts)
7. **Production Code Generation** - Compressed code is for analysis, not execution
8. **Browser Bundles** - CLI tool only (5MB+ bundle size acceptable)
9. **Incremental Compression** - No caching, no watch mode (v1)
10. **Universal Compatibility** - Target: TypeScript 5.0+, Node.js 18+

### Intentional Limitations

- **Single-File Focus (v1):** Batch compression deferred to v2
- **No Configuration (v1):** One compression strategy, no options (simplicity first)
- **Command-Line Only:** No programmatic API initially (add when needed)
- **English Documentation Only:** No i18n for v1

---

## Success Criteria

### How We'll Know This Works

#### Phase 1: Technical Validation (Weeks 1-3)

✅ **Compression Correctness**
- [ ] Compressed output type-checks with `tsc --noEmit`
- [ ] All TypeScript features handled (generics, decorators, async, overloads)
- [ ] Idempotent (compressing twice yields same result)
- [ ] No false positives (preserves necessary structure)

✅ **Token Reduction**
- [ ] Achieves 60-80% token reduction on typical files
- [ ] Token counts accurate (validated against Anthropic API)
- [ ] Reduction is consistent across file types

✅ **Robustness**
- [ ] Test suite covers 20+ edge cases
- [ ] Works on real projects (DevFlow, TypeORM, NestJS samples)
- [ ] Graceful error handling (clear messages)

#### Phase 2: Integration Validation (Week 4)

✅ **CLI Usability**
- [ ] `devflow compress` command works in global install
- [ ] Output format is readable and useful
- [ ] Performance acceptable (< 2 seconds for 1000-line file)
- [ ] Documentation clear for users

✅ **Real-World Usage**
- [ ] Successfully compress 10 different open-source TypeScript projects
- [ ] No compression failures on valid TypeScript
- [ ] Metrics collection working

#### Phase 3: Research Validation (Future)

✅ **AI Understanding Preservation**
- [ ] A/B test: Claude answers same questions about full vs compressed code
- [ ] Measure accuracy degradation (target: < 5%)
- [ ] Identify which compressions are safe vs risky

✅ **Reproducibility**
- [ ] Published methodology
- [ ] Open dataset of compressed files
- [ ] Benchmark suite for comparison

### Failure Criteria (Stop and Pivot If...)

🚫 **Technical Failures:**
- Compression produces invalid TypeScript > 5% of the time
- Token reduction < 40% (not worth the effort)
- Performance > 10 seconds for 1000-line file
- Cannot handle common TypeScript patterns

🚫 **Research Failures:**
- Claude's understanding degraded > 20% on compressed code
- Non-deterministic output (same input ≠ same output)
- Cannot reproduce results across machines

🚫 **Practical Failures:**
- Too complex to use (requires 10+ flags)
- Too slow for interactive use
- Maintenance burden > benefit

---

## Use Cases

### Primary Use Case: Large Codebase Audits

**Scenario:** You want Claude to audit a 50-file TypeScript project for security issues.

**Problem:** Sending all 50 files exceeds token limit.

**Solution:**
```bash
# Compress entire src/ directory
devflow compress src/ --output .compressed/

# Review compressed architecture
claude "Analyze this codebase architecture" .compressed/

# Tokens used: 15K instead of 80K (81% savings)
```

**Benefit:** Fit 3-5x more code in context window.

---

### Secondary Use Case: Pre-PR Reviews

**Scenario:** You have a 30-file PR and want comprehensive review.

**Problem:** `/pre-pr` sub-agents hit token limits on large changes.

**Solution:**
```bash
# In the future (v2)
/pre-pr --compress

# DevFlow automatically compresses changed files
# Sends structure-only versions to audit sub-agents
# Full files sent only for detailed analysis when needed
```

**Benefit:** Enable thorough reviews of large PRs.

---

### Research Use Case: Compression Strategy Experiments

**Scenario:** You're researching optimal code compression for AI assistants.

**Problem:** Need reproducible, measurable compression.

**Solution:**
```bash
# Test different strategies
devflow compress file.ts --level 1 > l1.ts
devflow compress file.ts --level 2 > l2.ts

# Measure Claude's understanding on each
# Publish findings with exact compression algorithms
```

**Benefit:** Rigorous, reproducible research.

---

### Development Use Case: Token Budget Estimation

**Scenario:** Building an AI coding tool, need to estimate token costs.

**Problem:** Don't know which files to include in prompts.

**Solution:**
```bash
# Count tokens in compressed form
devflow compress src/ --dry-run --metrics

# Output:
# src/user.service.ts: 1200 → 180 tokens (85% reduction)
# src/auth.service.ts: 800 → 150 tokens (81% reduction)
# Total: 2000 → 330 tokens
```

**Benefit:** Make informed decisions about context windows.

---

## Design Principles

### 1. Correctness Over Speed

**Why:** Research requires trust in results.

**How:**
- Use official TypeScript parser (via ts-morph)
- Validate output type-checks
- Comprehensive test suite
- Accept slower performance for accuracy

**Trade-off:** Tool may take 1-2 seconds vs 100ms, but results are guaranteed correct.

---

### 2. Transparency Over Magic

**Why:** Users need to understand what's being stripped.

**How:**
- Readable compressed output (not minified)
- Clear comments indicating removed sections
- Show diff before/after
- Document algorithm openly

**Example Output:**
```typescript
export class UserService {
  constructor(private db: Database) { /* implementation removed */ }

  async getUser(id: string): Promise<User> {
    /* implementation removed */
  }
}
```

Not:
```typescript
export class UserService{constructor(private db:Database){}async getUser(id:string):Promise<User>{}}
```

---

### 3. Measurability Over Intuition

**Why:** "Seems like it saves tokens" is not good enough for research.

**How:**
- Always report exact token counts
- Use Anthropic API for accuracy
- Track metrics over time
- Provide CSV/JSON export for analysis

**Trade-off:** Requires API calls, but ensures scientific rigor.

---

### 4. Simplicity Over Features (v1)

**Why:** Scope creep kills projects.

**How:**
- One compression strategy (v1)
- No configuration files
- No plugins/extensions
- Single command interface

**Future:** Add complexity only when proven necessary.

---

### 5. Determinism Over Cleverness

**Why:** Reproducibility is critical for research.

**How:**
- No AI-based compression (non-deterministic)
- No heuristics (same input = same output)
- No randomness
- Versioned algorithm (document changes)

**Trade-off:** May miss optimization opportunities, but results are reproducible.

---

## Architecture Philosophy

### Modular Design

```
src/
  compression/
    parser.ts        # ts-morph wrapper
    compressor.ts    # Core logic
    validator.ts     # Type-checking
    metrics.ts       # Token counting

  cli/
    commands/
      compress.ts    # CLI interface

  types/
    index.ts         # Shared types
```

**Why:** Each component testable in isolation.

---

### Single Responsibility

- **Parser:** Only responsible for AST manipulation
- **Compressor:** Only responsible for stripping logic
- **Validator:** Only responsible for type-checking output
- **Metrics:** Only responsible for token counting

**Why:** Easy to test, replace, or extend individual components.

---

### Functional Core, Imperative Shell

**Core (pure functions):**
```typescript
function compress(ast: TypeScriptAST): TypeScriptAST {
  // Pure transformation
}
```

**Shell (side effects):**
```typescript
async function compressFile(path: string): Promise<void> {
  const code = await fs.readFile(path); // IO
  const ast = parse(code);
  const compressed = compress(ast); // Pure
  await fs.writeFile(output, compressed); // IO
}
```

**Why:** Core logic is testable without filesystem, API calls, etc.

---

## Quality Standards

### Code Quality

- **TypeScript Strict Mode:** No `any`, explicit return types
- **Test Coverage:** > 80% for core compression logic
- **Documentation:** Every public function has TSDoc
- **Linting:** ESLint + Prettier, no warnings

---

### User Experience

- **Error Messages:** Clear, actionable (not "Error: undefined")
- **Progress Indicators:** Show status for long operations
- **Exit Codes:** 0 = success, 1 = compression failed, 2 = validation failed
- **Helpful Output:** Include next steps in error messages

**Example:**
```
❌ Compression failed: Invalid TypeScript syntax

File: src/broken.ts
Error: Unexpected token at line 42

Fix: Ensure the input file is valid TypeScript.
Run: tsc --noEmit src/broken.ts
```

---

### Documentation Standards

- **README:** Installation, quick start, examples
- **ARCHITECTURE.md:** Design decisions, how it works
- **API.md:** Programmatic usage (future)
- **RESEARCH.md:** Published findings (future)

---

## Risk Management

### Technical Risks

**Risk:** TypeScript evolves, breaks compression logic

**Mitigation:**
- Pin TypeScript version, document compatibility
- Monitor TS roadmap
- Automated tests catch regressions

---

**Risk:** ts-morph performance issues at scale

**Mitigation:**
- Start with single-file (acceptable performance)
- Benchmark before adding batch mode
- Optimize only when proven necessary

---

**Risk:** Token counting becomes inaccurate

**Mitigation:**
- Use Anthropic API (always accurate)
- Label tiktoken as "estimated"
- Update when Anthropic releases new models

---

### Research Risks

**Risk:** Compression degrades AI understanding more than expected

**Mitigation:**
- A/B testing before declaring success
- Publish negative results if compression doesn't work
- Provide compression levels (let users choose trade-off)

---

**Risk:** Results not reproducible across environments

**Mitigation:**
- Deterministic algorithm (no randomness)
- Pin all dependencies (package-lock.json)
- Document exact versions (Node, TypeScript, ts-morph)

---

### Product Risks

**Risk:** Tool too complex for users to adopt

**Mitigation:**
- Simple CLI (`devflow compress <file>`)
- Sensible defaults (no configuration required)
- Clear documentation with examples

---

**Risk:** Maintenance burden outweighs benefits

**Mitigation:**
- Narrow scope (TypeScript only)
- Delegate complexity to ts-morph
- Comprehensive test suite (catch issues early)

---

## Metrics for Success

### Quantitative Metrics

1. **Token Reduction:** Average 60-80% across test corpus
2. **Type Validity:** 100% of compressed files type-check
3. **Performance:** < 2 seconds per 1000 lines
4. **Test Coverage:** > 80% for compression logic
5. **Real-World Usage:** Successfully compress 10+ open-source projects

---

### Qualitative Metrics

1. **Usability:** Developers can use without reading docs (intuitive CLI)
2. **Trust:** Compressed output is readable and obviously correct
3. **Transparency:** Algorithm is understandable by reading code
4. **Maintainability:** New contributors can add features confidently

---

## Future Vision (Beyond v1)

### Compression as a Research Platform

**Goal:** Make DevFlow Compress the reference implementation for code compression research.

**How:**
- Publish compression benchmark dataset
- Open-source compression strategies
- Encourage academic research
- Host compression challenges (best compression without degrading AI understanding)

---

### Integration Ecosystem

**Goal:** Compression becomes standard preprocessing for AI code tools.

**How:**
- CLI tool (done in v1)
- VS Code extension (v2)
- GitHub Action (auto-compress PR diffs)
- API for other tools to use

---

### Multi-Language Support

**Goal:** Extend compression to Python, Go, Rust, etc.

**How:**
- Abstract compression interface
- Language-specific plugins
- Shared token counting infrastructure

---

## Conclusion

This vision defines a **research-grade, CLI-first TypeScript compression tool** that prioritizes:

✅ **Correctness** - Valid TypeScript output, always
✅ **Measurability** - Exact token metrics
✅ **Transparency** - Readable, understandable algorithm
✅ **Reproducibility** - Same input = same output
✅ **Simplicity** - One command, sensible defaults

**Ready to proceed to:** Implementation planning (phased approach).

---

**Vision Status:** ✅ COMPLETE
**Alignment Check:** Does this match your research goals?
