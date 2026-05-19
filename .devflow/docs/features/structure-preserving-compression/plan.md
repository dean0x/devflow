# Implementation Plan: Structure-Preserving TypeScript Compression

**Date:** 2025-10-04
**Status:** Active
**Timeline:** 4 weeks (phased approach)
**Risk Level:** Medium (new feature, AST manipulation)

---

## Overview

Build `devflow compress` command using AST-based TypeScript compression over 4 phases:

1. **Phase 0:** Foundation & Setup (Week 1)
2. **Phase 1:** Core Compression (Week 2)
3. **Phase 2:** Validation & Testing (Week 3)
4. **Phase 3:** CLI Integration & Polish (Week 4)

Each phase has **concrete deliverables** and **success gates** before proceeding.

---

## Phase 0: Foundation & Setup

**Duration:** Week 1 (5-7 days)
**Goal:** Establish infrastructure for compression work
**Risk:** Low (mostly setup)

---

### Tasks

#### 0.1: Project Structure

**Create directory structure:**
```
src/
  compression/          # New directory
    __tests__/            # Test files
      fixtures/             # TypeScript test files
      parser.test.ts
      compressor.test.ts
      validator.test.ts
      metrics.test.ts
    parser.ts             # ts-morph wrapper
    compressor.ts         # Core compression logic
    validator.ts          # Type-checking validation
    metrics.ts            # Token counting
    types.ts              # Shared interfaces
    index.ts              # Public API
  cli/
    commands/
      compress.ts         # CLI command (Phase 3)
```

**Acceptance:** Directory structure exists, empty files created.

---

#### 0.2: Dependencies

**Install required packages:**
```bash
npm install ts-morph
npm install @anthropic-ai/sdk  # For token counting
npm install tiktoken            # For approximate counting

# Dev dependencies
npm install --save-dev @types/node
npm install --save-dev jest @types/jest ts-jest
```

**Update package.json:**
```json
{
  "scripts": {
    "test:compression": "jest src/compression",
    "test:compression:watch": "jest src/compression --watch"
  }
}
```

**Acceptance:** Dependencies installed, `npm install` succeeds.

---

#### 0.3: Type Definitions

**Create `src/compression/types.ts`:**
```typescript
export interface CompressionOptions {
  /**
   * Preserve comments in output (default: true)
   */
  preserveComments?: boolean;

  /**
   * Preserve all type information (default: true, non-configurable v1)
   */
  preserveTypes?: boolean;

  /**
   * Strip function/method bodies (default: true, non-configurable v1)
   */
  stripBodies?: boolean;
}

export interface CompressionResult {
  /**
   * Compressed TypeScript code
   */
  compressed: string;

  /**
   * Original token count
   */
  originalTokens: number;

  /**
   * Compressed token count
   */
  compressedTokens: number;

  /**
   * Reduction percentage (0-100)
   */
  reductionPercent: number;

  /**
   * Warnings encountered during compression
   */
  warnings: string[];

  /**
   * Whether output is valid TypeScript (type-checks)
   */
  isValid: boolean;
}

export interface TokenCounter {
  /**
   * Count tokens in text
   */
  count(text: string): Promise<number>;

  /**
   * Whether this counter is accurate or approximate
   */
  isAccurate: boolean;

  /**
   * Name of the counter (for metrics)
   */
  name: string;
}
```

**Acceptance:** Types compile, no errors.

---

#### 0.4: Test Fixtures

**Create test fixtures in `src/compression/__tests__/fixtures/`:**

1. **simple-function.ts** - Basic function
```typescript
export function add(a: number, b: number): number {
  return a + b;
}
```

2. **class-with-methods.ts** - Class with methods
```typescript
export class Calculator {
  private history: number[] = [];

  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(result);
    return result;
  }

  getHistory(): number[] {
    return [...this.history];
  }
}
```

3. **generics.ts** - Generic types
```typescript
export function identity<T>(value: T): T {
  return value;
}

export class Container<T> {
  constructor(private value: T) {}

  get(): T {
    return this.value;
  }
}
```

4. **async-await.ts** - Async functions
```typescript
export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}
```

5. **decorators.ts** - Decorators
```typescript
export function Injectable() {
  return function(target: any) {
    // decorator logic
  };
}

@Injectable()
export class UserService {
  getUsers() {
    return [];
  }
}
```

6. **overloads.ts** - Function overloads
```typescript
export function process(value: string): string;
export function process(value: number): number;
export function process(value: string | number): string | number {
  if (typeof value === 'string') {
    return value.toUpperCase();
  }
  return value * 2;
}
```

7. **complex-types.ts** - Complex type definitions
```typescript
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface User {
  id: string;
  name: string;
  roles: ('admin' | 'user')[];
}
```

8. **imports-exports.ts** - Import/export patterns
```typescript
import { readFile } from 'fs/promises';
import type { User } from './types';

export { readFile };
export type { User };
export const VERSION = '1.0.0';
```

**Acceptance:** 8+ fixture files created, all valid TypeScript.

---

#### 0.5: Jest Configuration

**Create `jest.config.compression.js`:**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/compression/**/*.test.ts'],
  collectCoverageFrom: [
    'src/compression/**/*.ts',
    '!src/compression/**/*.test.ts',
    '!src/compression/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

**Acceptance:** `npm run test:compression` runs (even with 0 tests).

---

### Phase 0 Deliverables

- [ ] Directory structure created
- [ ] Dependencies installed
- [ ] Type definitions complete
- [ ] 8+ test fixtures created
- [ ] Jest configured for compression tests
- [ ] All fixtures type-check with `tsc --noEmit`

**Success Gate:** Can run `npm run test:compression` and `tsc --noEmit` on fixtures.

---

## Phase 1: Core Compression

**Duration:** Week 2 (5-7 days)
**Goal:** Implement compression logic with ts-morph
**Risk:** Medium (AST manipulation complexity)

---

### Tasks

#### 1.1: Parser Implementation

**Create `src/compression/parser.ts`:**

```typescript
import { Project, SourceFile } from 'ts-morph';

export class TypeScriptParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // Latest
        module: 99, // ESNext
      },
    });
  }

  /**
   * Parse TypeScript code into AST
   */
  parse(code: string, fileName: string = 'temp.ts'): SourceFile {
    return this.project.createSourceFile(fileName, code, {
      overwrite: true,
    });
  }

  /**
   * Get text from source file
   */
  getText(sourceFile: SourceFile): string {
    return sourceFile.getFullText();
  }

  /**
   * Type-check source file
   */
  typeCheck(sourceFile: SourceFile): string[] {
    const diagnostics = sourceFile.getPreEmitDiagnostics();
    return diagnostics.map(d => d.getMessageText().toString());
  }
}
```

**Test (`parser.test.ts`):**
```typescript
describe('TypeScriptParser', () => {
  it('parses valid TypeScript', () => {
    const parser = new TypeScriptParser();
    const sourceFile = parser.parse('const x = 1;');
    expect(sourceFile).toBeDefined();
  });

  it('detects type errors', () => {
    const parser = new TypeScriptParser();
    const sourceFile = parser.parse('const x: number = "string";');
    const errors = parser.typeCheck(sourceFile);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

**Acceptance:** Parser can load and type-check TypeScript code.

---

#### 1.2: Compressor Core Logic

**Create `src/compression/compressor.ts`:**

```typescript
import { SourceFile, SyntaxKind, Node } from 'ts-morph';
import { CompressionOptions } from './types';

export class TypeScriptCompressor {
  compress(
    sourceFile: SourceFile,
    options: CompressionOptions = {}
  ): SourceFile {
    const {
      stripBodies = true,
      preserveComments = true,
      preserveTypes = true,
    } = options;

    if (!stripBodies) {
      return sourceFile; // No compression
    }

    // Strip function bodies
    sourceFile.getFunctions().forEach(fn => {
      this.stripFunctionBody(fn);
    });

    // Strip method bodies in classes
    sourceFile.getClasses().forEach(cls => {
      cls.getMethods().forEach(method => {
        this.stripMethodBody(method);
      });

      cls.getConstructors().forEach(ctor => {
        this.stripConstructorBody(ctor);
      });
    });

    // Strip arrow function bodies
    sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach(arrow => {
      this.stripArrowFunctionBody(arrow);
    });

    return sourceFile;
  }

  private stripFunctionBody(fn: any): void {
    // Preserve signature, replace body
    const signature = this.getFunctionSignature(fn);
    if (fn.getBody()) {
      fn.setBodyText('/* implementation removed */');
    }
  }

  private stripMethodBody(method: any): void {
    if (method.getBody()) {
      method.setBodyText('/* implementation removed */');
    }
  }

  private stripConstructorBody(ctor: any): void {
    if (ctor.getBody()) {
      ctor.setBodyText('/* implementation removed */');
    }
  }

  private stripArrowFunctionBody(arrow: any): void {
    if (arrow.getBody()?.getKind() === SyntaxKind.Block) {
      arrow.setBodyText('/* implementation removed */');
    }
    // Leave expression bodies (single-line arrows) intact for now
  }

  private getFunctionSignature(fn: any): string {
    // Helper to extract signature (for logging/debugging)
    return fn.getText().split('{')[0].trim();
  }
}
```

**Test (`compressor.test.ts`):**
```typescript
import { readFileSync } from 'fs';
import { TypeScriptParser } from '../parser';
import { TypeScriptCompressor } from '../compressor';

describe('TypeScriptCompressor', () => {
  let parser: TypeScriptParser;
  let compressor: TypeScriptCompressor;

  beforeEach(() => {
    parser = new TypeScriptParser();
    compressor = new TypeScriptCompressor();
  });

  it('strips function bodies', () => {
    const code = readFileSync(
      __dirname + '/fixtures/simple-function.ts',
      'utf-8'
    );
    const sourceFile = parser.parse(code);
    const compressed = compressor.compress(sourceFile);
    const output = parser.getText(compressed);

    expect(output).toContain('function add');
    expect(output).toContain('number');
    expect(output).not.toContain('return a + b');
    expect(output).toContain('/* implementation removed */');
  });

  it('strips class method bodies', () => {
    const code = readFileSync(
      __dirname + '/fixtures/class-with-methods.ts',
      'utf-8'
    );
    const sourceFile = parser.parse(code);
    const compressed = compressor.compress(sourceFile);
    const output = parser.getText(compressed);

    expect(output).toContain('class Calculator');
    expect(output).toContain('add(a: number, b: number): number');
    expect(output).not.toContain('this.history.push');
  });

  it('preserves generics', () => {
    const code = readFileSync(
      __dirname + '/fixtures/generics.ts',
      'utf-8'
    );
    const sourceFile = parser.parse(code);
    const compressed = compressor.compress(sourceFile);
    const output = parser.getText(compressed);

    expect(output).toContain('<T>');
    expect(output).toContain('Container<T>');
  });

  it('handles async functions', () => {
    const code = readFileSync(
      __dirname + '/fixtures/async-await.ts',
      'utf-8'
    );
    const sourceFile = parser.parse(code);
    const compressed = compressor.compress(sourceFile);
    const output = parser.getText(compressed);

    expect(output).toContain('async function fetchUser');
    expect(output).toContain('Promise<User>');
    expect(output).not.toContain('await fetch');
  });
});
```

**Acceptance:** Core compression works on basic fixtures, tests pass.

---

#### 1.3: Validator Implementation

**Create `src/compression/validator.ts`:**

```typescript
import { TypeScriptParser } from './parser';
import { SourceFile } from 'ts-morph';

export class TypeScriptValidator {
  private parser: TypeScriptParser;

  constructor() {
    this.parser = new TypeScriptParser();
  }

  /**
   * Validate that compressed code is valid TypeScript
   */
  validate(code: string): { isValid: boolean; errors: string[] } {
    try {
      const sourceFile = this.parser.parse(code);
      const errors = this.parser.typeCheck(sourceFile);

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
}
```

**Test (`validator.test.ts`):**
```typescript
describe('TypeScriptValidator', () => {
  it('validates correct TypeScript', () => {
    const validator = new TypeScriptValidator();
    const result = validator.validate('const x: number = 1;');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects type errors', () => {
    const validator = new TypeScriptValidator();
    const result = validator.validate('const x: number = "string";');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
```

**Acceptance:** Validator detects valid/invalid TypeScript correctly.

---

#### 1.4: Token Counting (Approximate)

**Create `src/compression/metrics.ts`:**

```typescript
import { encoding_for_model } from 'tiktoken';
import Anthropic from '@anthropic-ai/sdk';
import { TokenCounter } from './types';

export class TiktokenCounter implements TokenCounter {
  name = 'tiktoken (GPT-4)';
  isAccurate = false;
  private encoder = encoding_for_model('gpt-4');

  async count(text: string): Promise<number> {
    const tokens = this.encoder.encode(text);
    return tokens.length;
  }

  dispose(): void {
    this.encoder.free();
  }
}

export class AnthropicCounter implements TokenCounter {
  name = 'Anthropic (Claude)';
  isAccurate = true;
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async count(text: string): Promise<number> {
    try {
      const response = await this.client.messages.count_tokens({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: text }],
      });
      return response.input_tokens;
    } catch (error) {
      throw new Error(
        `Anthropic token counting failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export function createTokenCounter(
  accurate: boolean = false
): TokenCounter {
  if (accurate) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY required for accurate token counting'
      );
    }
    return new AnthropicCounter();
  }
  return new TiktokenCounter();
}
```

**Test (`metrics.test.ts`):**
```typescript
describe('Token Counting', () => {
  describe('TiktokenCounter', () => {
    it('counts tokens approximately', async () => {
      const counter = new TiktokenCounter();
      const tokens = await counter.count('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10); // Sanity check
      counter.dispose();
    });
  });

  describe('AnthropicCounter', () => {
    it.skip('counts tokens accurately (requires API key)', async () => {
      // Skip in CI, run manually with API key
      const counter = new AnthropicCounter();
      const tokens = await counter.count('Hello, Claude!');
      expect(tokens).toBeGreaterThan(0);
    });
  });
});
```

**Acceptance:** Token counting works (tiktoken tested, Anthropic manual).

---

### Phase 1 Deliverables

- [ ] Parser implemented and tested
- [ ] Compressor strips function/method bodies
- [ ] Validator type-checks compressed output
- [ ] Token counting (tiktoken) works
- [ ] All tests pass
- [ ] Test coverage > 70%

**Success Gate:** Can compress all 8 fixtures without errors.

---

## Phase 2: Validation & Robustness

**Duration:** Week 3 (5-7 days)
**Goal:** Handle edge cases, validate on real projects
**Risk:** High (edge cases are unpredictable)

---

### Tasks

#### 2.1: Edge Case Handling

**Add support for:**

1. **Function Overloads** - Preserve all signatures
2. **Decorators** - Keep decorator syntax
3. **Namespaces** - Preserve structure, strip bodies
4. **Enums** - Keep entirely (no bodies to strip)
5. **Type Guards** - Preserve predicate signatures
6. **Arrow Functions with Expressions** - Handle correctly
7. **Getters/Setters** - Strip bodies, keep signatures
8. **Abstract Classes** - Preserve abstract methods

**Update `compressor.ts` with additional logic.**

**Add fixtures for each edge case.**

**Acceptance:** All edge case fixtures compress correctly.

---

#### 2.2: Real-World Testing

**Test on actual TypeScript projects:**

1. **DevFlow itself** - Compress `src/` directory files
2. **TypeORM** - Clone and compress sample files
3. **NestJS** - Compress example controllers/services

**Create test:**
```typescript
describe('Real-World Projects', () => {
  it('compresses DevFlow files', () => {
    const files = glob.sync('src/**/*.ts');
    files.forEach(file => {
      const code = readFileSync(file, 'utf-8');
      const result = compressFile(code);
      expect(result.isValid).toBe(true);
    });
  });
});
```

**Acceptance:** Successfully compress 10+ real-world files.

---

#### 2.3: Error Handling

**Graceful failures:**

1. Invalid TypeScript input
2. Unsupported syntax
3. API key missing (for Anthropic counter)
4. File read/write errors

**Add error types:**
```typescript
export class CompressionError extends Error {
  constructor(message: string, public file?: string, public line?: number) {
    super(message);
  }
}
```

**Test error scenarios:**
```typescript
it('throws helpful error on invalid TypeScript', () => {
  expect(() => compress('const x = ')).toThrow(CompressionError);
});
```

**Acceptance:** All error paths have tests, messages are clear.

---

#### 2.4: Integration Test

**Create end-to-end test:**

```typescript
describe('End-to-End Compression', () => {
  it('compresses, validates, and measures tokens', async () => {
    const code = readFileSync('fixtures/class-with-methods.ts', 'utf-8');

    // Compress
    const parser = new TypeScriptParser();
    const compressor = new TypeScriptCompressor();
    const sourceFile = parser.parse(code);
    const compressed = compressor.compress(sourceFile);
    const output = parser.getText(compressed);

    // Validate
    const validator = new TypeScriptValidator();
    const validation = validator.validate(output);
    expect(validation.isValid).toBe(true);

    // Measure
    const counter = createTokenCounter(false);
    const originalTokens = await counter.count(code);
    const compressedTokens = await counter.count(output);

    expect(compressedTokens).toBeLessThan(originalTokens);

    const reduction =
      ((originalTokens - compressedTokens) / originalTokens) * 100;
    expect(reduction).toBeGreaterThan(40); // At least 40% reduction
  });
});
```

**Acceptance:** End-to-end test passes on all fixtures.

---

#### 2.5: Metrics Collection

**Add compression summary:**

```typescript
export interface CompressionSummary {
  filesProcessed: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  averageReduction: number;
  validationErrors: number;
}
```

**Acceptance:** Can generate summary report.

---

### Phase 2 Deliverables

- [ ] All edge cases handled
- [ ] Real-world projects compress successfully
- [ ] Error handling comprehensive
- [ ] End-to-end integration test passes
- [ ] Metrics collection implemented
- [ ] Test coverage > 80%

**Success Gate:** Can compress 10+ real-world TypeScript files with 0 failures.

---

## Phase 3: CLI Integration & Polish

**Duration:** Week 4 (5-7 days)
**Goal:** Ship `devflow compress` command
**Risk:** Low (core logic done)

---

### Tasks

#### 3.1: CLI Command Implementation

**Create `src/cli/commands/compress.ts`:**

```typescript
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { TypeScriptParser } from '../../compression/parser';
import { TypeScriptCompressor } from '../../compression/compressor';
import { TypeScriptValidator } from '../../compression/validator';
import { createTokenCounter } from '../../compression/metrics';
import { CompressionResult } from '../../compression/types';

export const compressCommand = new Command('compress')
  .description('Compress TypeScript file using structure-preserving AST manipulation')
  .argument('<file>', 'TypeScript file to compress')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--accurate', 'Use Anthropic API for accurate token counting (requires ANTHROPIC_API_KEY)')
  .option('--metrics', 'Show compression metrics')
  .option('--validate', 'Validate compressed output type-checks', true)
  .action(async (file: string, options) => {
    try {
      // Read input
      const code = readFileSync(file, 'utf-8');

      // Compress
      const parser = new TypeScriptParser();
      const compressor = new TypeScriptCompressor();
      const sourceFile = parser.parse(code, file);
      const compressed = compressor.compress(sourceFile);
      const output = parser.getText(compressed);

      // Validate
      if (options.validate) {
        const validator = new TypeScriptValidator();
        const validation = validator.validate(output);
        if (!validation.isValid) {
          console.error('❌ Validation failed:');
          validation.errors.forEach(err => console.error(`  ${err}`));
          process.exit(2);
        }
      }

      // Metrics
      if (options.metrics || options.accurate) {
        const counter = createTokenCounter(options.accurate);
        const originalTokens = await counter.count(code);
        const compressedTokens = await counter.count(output);
        const reduction =
          ((originalTokens - compressedTokens) / originalTokens) * 100;

        console.error(`\n📊 Compression Metrics (${counter.name}):`);
        console.error(`  Original:    ${originalTokens} tokens`);
        console.error(`  Compressed:  ${compressedTokens} tokens`);
        console.error(`  Reduction:   ${reduction.toFixed(1)}%\n`);
      }

      // Output
      if (options.output) {
        writeFileSync(options.output, output);
        console.error(`✅ Compressed: ${file} → ${options.output}`);
      } else {
        console.log(output);
      }
    } catch (error) {
      console.error(
        `❌ Compression failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });
```

**Update `src/cli/cli.ts`:**
```typescript
import { compressCommand } from './commands/compress';

program.addCommand(compressCommand);
```

**Acceptance:** `devflow compress <file>` works locally.

---

#### 3.2: Documentation

**Update `README.md`:**

Add section:
```markdown
## Commands

### `devflow compress <file>`

Compress TypeScript files using structure-preserving AST manipulation.

**Usage:**
\`\`\`bash
# Compress to stdout
devflow compress src/user.service.ts

# Compress to file
devflow compress src/user.service.ts -o compressed.ts

# Show metrics (approximate)
devflow compress src/user.service.ts --metrics

# Accurate metrics (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=sk-...
devflow compress src/user.service.ts --accurate --metrics
\`\`\`

**What it does:**
- Preserves: Type signatures, interfaces, imports/exports, class structure
- Removes: Function bodies, method implementations
- Output: Valid TypeScript that type-checks

**Typical token reduction:** 60-80%
```

**Create `docs/COMPRESSION.md`:**

Detailed documentation:
- How compression works
- When to use it
- Limitations
- Examples
- Token counting methods

**Acceptance:** Documentation is clear and complete.

---

#### 3.3: Global Installation Test

**Test workflow:**

```bash
# Build
npm run build

# Install globally (test)
npm link

# Test command
devflow compress test/fixtures/simple-function.ts

# Verify output
devflow compress test/fixtures/simple-function.ts --metrics

# Cleanup
npm unlink
```

**Acceptance:** Global install works, command accessible.

---

#### 3.4: Examples & Demos

**Create `examples/compression/`:**

1. **before.ts** - Original TypeScript file
2. **after.ts** - Compressed version
3. **comparison.md** - Side-by-side comparison with metrics

**Acceptance:** Examples demonstrate value clearly.

---

#### 3.5: Performance Benchmarking

**Create benchmark script:**

```typescript
// scripts/benchmark-compression.ts
const files = [
  { name: 'Small', lines: 100, path: 'fixtures/small.ts' },
  { name: 'Medium', lines: 500, path: 'fixtures/medium.ts' },
  { name: 'Large', lines: 2000, path: 'fixtures/large.ts' },
];

files.forEach(({ name, path }) => {
  const start = Date.now();
  compress(readFileSync(path, 'utf-8'));
  const end = Date.now();
  console.log(`${name}: ${end - start}ms`);
});
```

**Document performance expectations:**
- Small files (< 200 lines): < 100ms
- Medium files (500-1000 lines): 200-500ms
- Large files (2000+ lines): 1-2 seconds

**Acceptance:** Performance meets expectations, documented.

---

### Phase 3 Deliverables

- [ ] `devflow compress` command works
- [ ] Documentation complete (README, COMPRESSION.md)
- [ ] Global installation tested
- [ ] Examples created
- [ ] Performance benchmarked and documented
- [ ] All acceptance criteria met

**Success Gate:** Can publish npm package with working `devflow compress` command.

---

## Post-Implementation: Validation Phase

**After Phase 3, before declaring success:**

### Real-World Validation Checklist

- [ ] Compress DevFlow's own `src/` directory (all files)
- [ ] Compress 3 open-source TypeScript projects
- [ ] A/B test: Ask Claude questions about full vs compressed code
- [ ] Measure actual token savings on 20+ files
- [ ] Collect validation metrics (% that type-check)

### Quality Gates

- [ ] **Correctness:** 100% of valid inputs produce valid outputs
- [ ] **Token Reduction:** Average 60-80% across test corpus
- [ ] **Type Validity:** 100% of outputs type-check
- [ ] **Performance:** < 2 seconds for 1000-line files
- [ ] **Test Coverage:** > 80% for compression module

### Documentation Gates

- [ ] Installation instructions tested
- [ ] Examples run successfully
- [ ] API documentation complete
- [ ] Troubleshooting guide written
- [ ] Known limitations documented

---

## Risk Mitigation Plan

### If Phase 1 Takes Too Long

**Fallback:** Ship regex-based compression (labeled "experimental")
**Timeline:** 2 days instead of 7
**Trade-off:** Lower quality, but demonstrates value

---

### If Token Reduction < 40%

**Action:** Investigate why, add more aggressive stripping
**Options:**
- Strip more comments
- Collapse type definitions
- Remove unnecessary whitespace

---

### If Type-Checking Fails > 5%

**Action:** STOP, fix compression logic
**Cannot ship:** Broken compression is worse than no compression

---

### If Performance Too Slow

**Action:** Optimize or document limitations
**Options:**
- Cache parsed ASTs
- Add progress indicators
- Document max file size

---

## Success Metrics (Post-Launch)

**Week 1-2 after launch:**
- [ ] 10+ GitHub stars
- [ ] 100+ npm downloads
- [ ] 0 critical bugs reported
- [ ] 3+ community issues/questions

**Month 1:**
- [ ] 500+ npm downloads
- [ ] Used in 3+ projects (telemetry or GitHub searches)
- [ ] 1+ external contribution (PR or issue)

**Month 3:**
- [ ] 1000+ npm downloads
- [ ] Featured in 1+ blog post/article
- [ ] Research findings published (compression effectiveness)

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 0 | Week 1 | Foundation (structure, fixtures, tests) |
| Phase 1 | Week 2 | Core compression (parser, compressor, validator, metrics) |
| Phase 2 | Week 3 | Edge cases, real-world validation, robustness |
| Phase 3 | Week 4 | CLI integration, documentation, polish |
| **Total** | **4 weeks** | **Shippable `devflow compress` command** |

---

## Next Immediate Steps

**RIGHT NOW (today):**

1. Create Phase 0 directory structure
2. Install dependencies (`ts-morph`, `tiktoken`, `@anthropic-ai/sdk`)
3. Create `types.ts` with interfaces
4. Create first 3 test fixtures

**This Week (Phase 0):**

5. Complete all 8 test fixtures
6. Set up Jest configuration
7. Verify fixtures type-check
8. Write Phase 0 summary report

**Gates Before Phase 1:**
- All fixtures created and valid
- Dependencies installed
- Test infrastructure working
- User (you) approves Phase 0 completion

---

## Open Questions (Decide Before Starting)

1. **Token Counter Priority:** Start with tiktoken (fast), add Anthropic later? Or both from start?
   - **Recommendation:** Both from start (different use cases)

2. **Comments Handling:** Preserve all comments? Strip all? Selective?
   - **Recommendation:** Preserve (v1), add `--strip-comments` flag (v2)

3. **Output Format:** Pretty-printed or minimal whitespace?
   - **Recommendation:** Pretty-printed (readability > size)

4. **Error on Invalid Input:** Fail hard or skip invalid files?
   - **Recommendation:** Fail hard (research requires correctness)

5. **Default Token Counter:** tiktoken or require API key?
   - **Recommendation:** tiktoken default, `--accurate` for Anthropic

---

## Conclusion

This plan provides a **realistic, phased approach** to building structure-preserving TypeScript compression:

✅ **Concrete milestones** - Each phase has clear deliverables
✅ **Success gates** - Can't proceed without meeting criteria
✅ **Risk mitigation** - Fallback plans for each phase
✅ **Quality focus** - 80% test coverage, validation at every step
✅ **Research-ready** - Measurable, reproducible, transparent

**Estimated Total Effort:** 80-100 hours over 4 weeks (20-25 hours/week)

**Ready to begin:** Phase 0 tasks are well-defined and achievable.

---

**Plan Status:** ✅ COMPLETE
**Approval Needed:** User confirmation to proceed with Phase 0
