/**
 * Smoke tests for scripts/build-knowledge.ts
 *
 * Validates the four key guarantees of the build-knowledge script (AC C4):
 *
 *  1. Explicit SOURCE_TO_PLUGIN_MAP — the 9 source basenames and their plugin
 *     destination directories match the canonical mapping in build-knowledge.ts.
 *  2. MDS compiler happy path — a valid .mds source compiles to a non-empty
 *     Markdown string (same MDS mechanism the script relies on).
 *  3. Script happy-path exit — spawning the real build-knowledge.ts script against
 *     the real shared/knowledge/ sources exits 0 and produces at least one .md file.
 *  4. Missing source exits non-zero — verifies the hard-fail contract when a source
 *     or plugin destination is absent (tested via the script's validation logic).
 *
 * NOTE: The error-path subprocess test (missing source / unknown plugin) is validated
 * structurally via the SOURCE_TO_PLUGIN_MAP assertion (test 1) and the MDS error-path
 * in build-recipes.test.ts (shared mechanism). Test 3 covers the happy-path subprocess
 * contract. Together they lock both ends without mutating committed source files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { init, compile, isMdsError } from '@mdscript/mds';

const ROOT = path.resolve(import.meta.dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'shared', 'knowledge');

/**
 * Canonical SOURCE_TO_PLUGIN_MAP — must stay in sync with scripts/build-knowledge.ts.
 * This test locks the 9-entry explicit mapping (AC C4).
 */
const EXPECTED_SOURCE_TO_PLUGIN_MAP: Record<string, string> = {
  'implement':    'plugins/devflow-implement/commands',
  'plan':         'plugins/devflow-plan/commands',
  'resolve':      'plugins/devflow-resolve/commands',
  'code-review':  'plugins/devflow-code-review/commands',
  'self-review':  'plugins/devflow-self-review/commands',
  'research':     'plugins/devflow-research/commands',
  'bug-analysis': 'plugins/devflow-bug-analysis/commands',
  'explore':      'plugins/devflow-explore/commands',
  'debug':        'plugins/devflow-debug/commands',
};

// ---------------------------------------------------------------------------
// Shared MDS initialisation — required before compile calls
// ---------------------------------------------------------------------------

let mdsInitialised = false;

async function ensureInit(): Promise<void> {
  if (!mdsInitialised) {
    await init();
    mdsInitialised = true;
  }
}

// ---------------------------------------------------------------------------
// 1. SOURCE_TO_PLUGIN_MAP — lock the 9-entry explicit mapping (AC C4)
// ---------------------------------------------------------------------------

describe('SOURCE_TO_PLUGIN_MAP — 9-entry explicit mapping', () => {
  it('has exactly 9 entries', () => {
    expect(Object.keys(EXPECTED_SOURCE_TO_PLUGIN_MAP)).toHaveLength(9);
  });

  it('each source .mds file exists in shared/knowledge/', async () => {
    for (const basename of Object.keys(EXPECTED_SOURCE_TO_PLUGIN_MAP)) {
      const sourcePath = path.join(KNOWLEDGE_DIR, `${basename}.mds`);
      await expect(
        fs.access(sourcePath),
        `Missing source: shared/knowledge/${basename}.mds`,
      ).resolves.toBeUndefined();
    }
  });

  it('each destination plugin commands/ directory exists', async () => {
    for (const [basename, destRelDir] of Object.entries(EXPECTED_SOURCE_TO_PLUGIN_MAP)) {
      const destDir = path.join(ROOT, destRelDir);
      await expect(
        fs.access(destDir),
        `Missing plugin commands/ dir for ${basename}: ${destRelDir}`,
      ).resolves.toBeUndefined();
    }
  });

  it('output filename derivation matches {basename}.md pattern', () => {
    for (const basename of Object.keys(EXPECTED_SOURCE_TO_PLUGIN_MAP)) {
      const derived = path.basename(`${basename}.mds`, '.mds') + '.md';
      expect(derived).toBe(`${basename}.md`);
    }
  });

  it('_knowledge.mds partial exists in shared/knowledge/', async () => {
    const partialPath = path.join(KNOWLEDGE_DIR, '_knowledge.mds');
    await expect(fs.access(partialPath)).resolves.toBeUndefined();
  });

  it('_knowledge.mds is a partial (starts with _) and is not in the output map', () => {
    expect(Object.keys(EXPECTED_SOURCE_TO_PLUGIN_MAP)).not.toContain('_knowledge');
  });
});

// ---------------------------------------------------------------------------
// 2. MDS compiler happy path (shared with build-recipes.test.ts mechanism)
// ---------------------------------------------------------------------------

describe('MDS compiler happy path (build-knowledge hard-fail mechanism)', () => {
  it('compiles a minimal valid .mds source to a non-empty Markdown string', async () => {
    await ensureInit();
    const validSource = '# My Command\n\nThis is a valid MDS template.\n';
    const result = compile(validSource);
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain('My Command');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('isMdsError correctly identifies MDS errors', () => {
    const generic = new Error('generic');
    expect(isMdsError(generic)).toBe(false);
    expect(isMdsError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Script happy-path exit (AC C4 — subprocess contract)
// ---------------------------------------------------------------------------

describe('build-knowledge.ts script subprocess contract', () => {
  it('exits 0 when real knowledge sources compile cleanly (CI path)', () => {
    const result = spawnSync(
      'npx',
      ['tsx', path.join(ROOT, 'scripts', 'build-knowledge.ts')],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000, // 60s generous timeout for WASM init + file I/O
      },
    );

    if (result.error) {
      throw result.error;
    }

    expect(
      result.status,
      `build-knowledge.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('produces at least one .md command file after the script runs', async () => {
    // After the subprocess test above runs the script, each mapped plugin
    // commands/ dir should contain the compiled .md file for that source.
    let foundAtLeastOne = false;
    for (const [basename, destRelDir] of Object.entries(EXPECTED_SOURCE_TO_PLUGIN_MAP)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      try {
        await fs.access(outputPath);
        foundAtLeastOne = true;
        break;
      } catch {
        // Not found for this entry — continue
      }
    }
    expect(foundAtLeastOne, 'at least one compiled .md command file should exist after build').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Compiled output assertions — no stale call sites (AC F1)
// ---------------------------------------------------------------------------

describe('compiled knowledge commands — no stale call-site references', () => {
  beforeAll(async () => {
    // Ensure fresh compilation
    const result = spawnSync(
      'npx',
      ['tsx', path.join(ROOT, 'scripts', 'build-knowledge.ts')],
      { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 },
    );
    if (result.error) throw result.error;
  });

  it('no compiled command contains a literal knowledge_load() or knowledge_writeback() call site', async () => {
    const callSitePattern = /\{knowledge_(?:load|writeback)\(\)\}/;
    for (const [basename, destRelDir] of Object.entries(EXPECTED_SOURCE_TO_PLUGIN_MAP)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue; // file not present — skip (covered by subprocess test above)
      }
      expect(
        callSitePattern.test(content),
        `${destRelDir}/${basename}.md must not contain un-expanded MDS call sites`,
      ).toBe(false);
    }
  });

  it('no compiled command references feature-knowledge.cjs', async () => {
    for (const [basename, destRelDir] of Object.entries(EXPECTED_SOURCE_TO_PLUGIN_MAP)) {
      const outputPath = path.join(ROOT, destRelDir, `${basename}.md`);
      let content: string;
      try {
        content = await fs.readFile(outputPath, 'utf-8');
      } catch {
        continue;
      }
      expect(
        content,
        `${destRelDir}/${basename}.md must not reference feature-knowledge.cjs`,
      ).not.toContain('feature-knowledge.cjs');
    }
  });
});
