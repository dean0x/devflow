// Shared test fixtures for feature-kb module tests.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

export const SAMPLE_INDEX = {
  version: 1,
  features: {
    'cli-commands': {
      name: 'CLI Command System',
      description: 'Use when adding CLI subcommands, modifying plugin registration, or changing the init flow.',
      directories: ['src/cli/commands/', 'src/cli/utils/'],
      referencedFiles: ['src/cli/cli.ts', 'src/cli/plugins.ts'],
      lastUpdated: '2026-04-20T14:30:00Z',
      createdBy: 'implement',
    },
  },
};

export const SAMPLE_KB_CONTENT = `---
feature: cli-commands
name: CLI Command System
directories:
  - src/cli/commands/
  - src/cli/utils/
referencedFiles:
  - src/cli/cli.ts
  - src/cli/plugins.ts
created: 2026-04-20T14:30:00Z
updated: 2026-04-20T14:30:00Z
---

# CLI Command System

## Overview
Commander.js-based CLI with @clack/prompts for interactive UX.

## Architecture
Each command is a separate file in src/cli/commands/ exporting a Command instance.

## Key Patterns
- Commander.js option chain
- @clack/prompts for TUI dialogs

## Anti-Patterns
- Don't use inquirer (project uses @clack/prompts)

## Gotchas
- Always register new commands in cli.ts

## Key Files
- src/cli/cli.ts — command registration
- src/cli/plugins.ts — plugin registry
`;

const createdTmpDirs: string[] = [];

/**
 * Create a temporary worktree directory with optional .features/ index and KB files.
 * Returns the absolute path to the tmpdir root.
 * Directories are tracked — call `cleanupTmpFeatureWorktrees()` in afterAll.
 */
export function makeTmpFeatureWorktree(
  indexContent?: object,
  kbs?: Record<string, string>,
): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'feature-kb-test-'));
  createdTmpDirs.push(tmp);

  const featuresDir = path.join(tmp, '.features');
  mkdirSync(featuresDir, { recursive: true });

  if (indexContent) {
    writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify(indexContent, null, 2));
  }

  if (kbs) {
    for (const [slug, content] of Object.entries(kbs)) {
      const kbDir = path.join(featuresDir, slug);
      mkdirSync(kbDir, { recursive: true });
      writeFileSync(path.join(kbDir, 'KNOWLEDGE.md'), content);
    }
  }

  return tmp;
}

/**
 * Remove all temporary worktree directories created by `makeTmpFeatureWorktree`.
 * Call in `afterAll(() => cleanupTmpFeatureWorktrees())`.
 */
export function cleanupTmpFeatureWorktrees(): void {
  for (const dir of createdTmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  createdTmpDirs.length = 0;
}
