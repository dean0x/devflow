/**
 * scan-in-code — code scanning is the Code agent's step, conditional on the session having a
 * scanning tool, and no reviewing agent repeats it.
 *
 * Decisions recorded here:
 *
 *  - D-SCAN-IN-CODE   tests/fixtures/agent-config.ts (MCP_DENY_AGENTS) holds the tool half:
 *                     Harden and Polish deny `mcp__*`, so neither can reach a scanner.
 *                     This file holds the body half, in the COMPILED prompts a session loads:
 *                       - Each Code variant (Code, Fix, Refactor) carries one `Security scan (conditional)` block that scans only
 *                         when the session offers a code-scanning tool, scans each changed file
 *                         once by absolute path before the final commit, scans the narrowest
 *                         common directory once when more than 10 files changed, and reports
 *                         `Security scan: unavailable` when there is no tool;
 *                       - that block names no scanner product or tool identifier, because
 *                         which scanner a session has is the session's business;
 *                       - Harden and Polish each carry the one line that says scanning
 *                         runs in the Code agent and not there.
 *
 * Code and Harden are generator hosts, so their prompt exists only as compiled output, in a
 * curation-on and a curation-off variant. Polish is hand-authored and read as installed.
 *
 * Every arm runs through a named collector, and each known-bad probe feeds the same collector a
 * mutated body, so a collector that stopped seeing a defect fails its own probe instead of
 * passing the guard vacuously.
 *
 * What a green run does NOT prove
 * -------------------------------
 * - It proves the prompts carry the block and the line. It does not prove an agent follows them,
 *   or that a scanner is reachable in a session that claims one.
 * - The vendor check is a denylist of known product names. A product it does not list passes; the
 *   list grows when a new scanner appears.
 * - It reads the compiled files under dist/, so a green run follows `npm run build`.
 */

import { describe, it, expect } from 'vitest';

import { CODE_AGENT_TYPES, codeSlugOf, resolveAgentSource, resolveCurationOffSource, splitFrontmatter } from '../helpers.js';

// ---------------------------------------------------------------------------
// The pinned text
// ---------------------------------------------------------------------------

const BLOCK_OPENER = '**Security scan (conditional):**';

/** The sentence that makes the scan conditional; the block must lead with it. */
const CONDITIONAL_CLAUSE = 'Only when this session offers a code-scanning tool.';

/** The clauses after it, each named for the failure message. */
const SCAN_CLAUSES: ReadonlyArray<{ readonly name: string; readonly phrase: string }> = [
  {
    name: 'each changed file once, by absolute path, before the final commit',
    phrase: 'Before your final commit, scan each file you changed once, by absolute path',
  },
  {
    name: 'more than 10 changed files: one scan of the narrowest common directory',
    phrase: 'With more than 10 changed files, scan their narrowest common directory once instead.',
  },
  {
    name: 'no scanning tool: skip the scan and report it unavailable',
    phrase: 'With no code-scanning tool, skip the scan and report `Security scan: unavailable`.',
  },
];

/** The line a reviewing agent carries in place of a scan. */
const NO_SCAN_LINE = 'Code-scanning runs in the Code agent; do not scan here.';

/** Known scanner products. The block names a capability, never one of these. */
const SCANNER_PRODUCTS: readonly string[] = [
  'Snyk',
  'Semgrep',
  'CodeQL',
  'SonarQube',
  'SonarCloud',
  'Checkmarx',
  'Veracode',
  'Fortify',
  'Coverity',
];

/** An MCP tool identifier names a server, which is a vendor choice. */
const TOOL_IDENTIFIER = /\bmcp__/;

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/** Every line of `body` that opens the scan block. */
function collectScanBlocks(body: string): string[] {
  return body.split('\n').filter(line => line.trimStart().startsWith(BLOCK_OPENER));
}

/**
 * Every way a Code prompt departs from its scan block: the block absent or repeated, a missing
 * condition or clause, or a scanner product or tool identifier named inside it. A missing block
 * is a defect on its own, so a read that finds nothing never reports the absence checks clean.
 */
function collectScanBlockDefects(body: string): string[] {
  const blocks = collectScanBlocks(body);
  if (blocks.length !== 1) {
    return [`carries the "${BLOCK_OPENER}" block ${blocks.length} times, expected once`];
  }
  const text = blocks[0].trimStart().slice(BLOCK_OPENER.length).trimStart();
  const out: string[] = [];

  if (!text.startsWith(CONDITIONAL_CLAUSE)) {
    out.push(`does not lead with the condition "${CONDITIONAL_CLAUSE}"`);
  }
  for (const { name, phrase } of SCAN_CLAUSES) {
    if (!text.includes(phrase)) out.push(`lacks the clause: ${name}`);
  }
  for (const product of SCANNER_PRODUCTS) {
    if (new RegExp(`\\b${product}\\b`, 'i').test(text)) out.push(`names the scanner product "${product}"`);
  }
  if (TOOL_IDENTIFIER.test(text)) out.push('names an MCP tool identifier');
  return out;
}

/** Every way a reviewing agent's body departs from carrying the no-scan line exactly once. */
function collectNoScanLineDefects(body: string): string[] {
  const count = body.split('\n').filter(line => line === NO_SCAN_LINE).length;
  return count === 1 ? [] : [`carries the line "${NO_SCAN_LINE}" ${count} times, expected once`];
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** The body of a prompt, frontmatter removed so a description cannot satisfy a body check. */
function bodyOf(text: string, where: string): string {
  const split = splitFrontmatter(text);
  if (!split) throw new Error(`${where} has no frontmatter block`);
  return split.body;
}

/** The curation-off variant of an agent; absent means the build did not run. */
function curationOffBody(name: string): string {
  const text = resolveCurationOffSource('agents', name);
  if (text === null) {
    throw new Error(`dist/curation-off/agents/${name}.md is absent — run \`npm run build\` first`);
  }
  return bodyOf(text, `dist/curation-off/agents/${name}.md`);
}

function agentBody(name: string): string {
  return bodyOf(resolveAgentSource(name).content, name);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('Code carries one conditional, vendor-neutral scan block (D-SCAN-IN-CODE)', () => {
  it('reads the compiled Code prompt, not a source fallback', () => {
    expect(resolveAgentSource('code').origin).toBe('dist');
  });

  // D-CODE-VARIANTS: the block lives in the shared partial's commit step, so every variant keeps it (AC-306).
  it('the curation-on prompt of each Code variant holds the block', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(collectScanBlockDefects(agentBody(codeSlugOf(agentType))), agentType).toEqual([]);
    }
  });

  it('the curation-off prompt of each Code variant holds the same block', () => {
    for (const agentType of CODE_AGENT_TYPES) {
      expect(collectScanBlockDefects(curationOffBody(codeSlugOf(agentType))), agentType).toEqual([]);
    }
  });

  describe('known-bad probes: one mutation makes the collector report', () => {
    const body = agentBody('code');
    const block = collectScanBlocks(body)[0];

    /** The real body with the block line replaced by `replacement`. */
    const withBlock = (replacement: string): string => body.replace(block, () => replacement);

    it('the unmutated body reports nothing, so each probe below is the mutation alone', () => {
      expect(block).toBeDefined();
      expect(collectScanBlockDefects(body)).toEqual([]);
    });

    it('a body with no block reports it absent', () => {
      expect(collectScanBlockDefects(withBlock(''))).toHaveLength(1);
      expect(collectScanBlockDefects('')).toHaveLength(1);
    });

    it('a body with the block twice reports it', () => {
      expect(collectScanBlockDefects(withBlock(`${block}\n${block}`))).toHaveLength(1);
    });

    it('an unconditional block reports the missing condition', () => {
      const unconditional = block.replace(CONDITIONAL_CLAUSE, 'Always.');
      expect(collectScanBlockDefects(withBlock(unconditional))).toEqual([
        `does not lead with the condition "${CONDITIONAL_CLAUSE}"`,
      ]);
    });

    it('a block without the absolute-path-before-commit clause reports it', () => {
      const bad = block.replace('by absolute path', 'by relative path');
      expect(collectScanBlockDefects(withBlock(bad))).toEqual([
        `lacks the clause: ${SCAN_CLAUSES[0].name}`,
      ]);
    });

    it('a block with a different file cap reports the cap clause', () => {
      const bad = block.replace('more than 10 changed files', 'more than 20 changed files');
      expect(collectScanBlockDefects(withBlock(bad))).toEqual([
        `lacks the clause: ${SCAN_CLAUSES[1].name}`,
      ]);
    });

    it('a block with no unavailable fallback reports it', () => {
      const bad = block.replace('`Security scan: unavailable`', 'nothing');
      expect(collectScanBlockDefects(withBlock(bad))).toEqual([
        `lacks the clause: ${SCAN_CLAUSES[2].name}`,
      ]);
    });

    it.each(SCANNER_PRODUCTS)('a block naming %s reports the product', product => {
      const bad = block.replace('a code-scanning tool', `the ${product} tool`);
      expect(collectScanBlockDefects(withBlock(bad)).some(d => d.includes(`"${product}"`))).toBe(true);
    });

    it('a block naming a scanner in lower case still reports it', () => {
      const bad = `${block} Prefer snyk.`;
      expect(collectScanBlockDefects(withBlock(bad))).toEqual(['names the scanner product "Snyk"']);
    });

    it('a block naming an MCP tool identifier reports it', () => {
      const bad = `${block} Use mcp__scanner__scan.`;
      expect(collectScanBlockDefects(withBlock(bad))).toEqual(['names an MCP tool identifier']);
    });

    it('a vendor named outside the block is not the block\'s defect', () => {
      expect(collectScanBlockDefects(`${body}\nSee the Snyk docs.\n`)).toEqual([]);
    });
  });
});

describe('Harden and Polish say scanning runs in the Code agent (D-SCAN-IN-CODE)', () => {
  it('Harden, curation-on and curation-off, carries the line once', () => {
    expect(resolveAgentSource('harden').origin).toBe('dist');
    expect(collectNoScanLineDefects(agentBody('harden'))).toEqual([]);
    expect(collectNoScanLineDefects(curationOffBody('harden'))).toEqual([]);
  });

  it('Polish carries the line once', () => {
    expect(collectNoScanLineDefects(agentBody('polish'))).toEqual([]);
  });

  describe('known-bad probes: one mutation makes the collector report', () => {
    const body = agentBody('harden');

    it('a body without the line reports it', () => {
      expect(collectNoScanLineDefects(body.replace(NO_SCAN_LINE, ''))).toHaveLength(1);
      expect(collectNoScanLineDefects('')).toHaveLength(1);
    });

    it('a reworded line reports it', () => {
      expect(collectNoScanLineDefects(body.replace(NO_SCAN_LINE, 'Code scanning runs in the Code agent.'))).toHaveLength(1);
    });

    it('a line carried twice reports it', () => {
      expect(collectNoScanLineDefects(`${body}\n${NO_SCAN_LINE}\n`)).toHaveLength(1);
    });

    it('the line only inside a longer line does not count', () => {
      expect(collectNoScanLineDefects(body.replace(NO_SCAN_LINE, `- ${NO_SCAN_LINE}`))).toHaveLength(1);
    });
  });
});
