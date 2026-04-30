/**
 * Shared utilities and the feature-kb module reference for kb subcommands.
 * All subcommand files import from here to avoid duplication.
 */
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import { getGitRoot } from '../../utils/git.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _require = createRequire(import.meta.url);

export type KbIndex = { version: number; features: Record<string, unknown> } | null;
export type KbEntry = { slug: string; name: string; directories: string[]; lastUpdated: string; referencedFiles?: string[]; description?: string; createdBy?: string };

export interface FeatureKbModule {
  loadIndex: (worktreePath: string) => KbIndex;
  listKBs: (worktreePath: string, cachedIndex?: KbIndex) => KbEntry[];
  checkAllStaleness: (worktreePath: string, cachedIndex?: KbIndex) => Record<string, { stale: boolean; changedFiles: string[] }>;
  checkStaleness: (worktreePath: string, slug: string) => { stale: boolean; changedFiles: string[] };
  findOverlapping: (worktreePath: string, changedFiles: string[]) => string[];
  removeEntry: (worktreePath: string, slug: string) => void;
  validateSlug: (slug: string) => void;
  updateIndex: (worktreePath: string, entry: { slug: string; name: string; description?: string; directories: string[]; referencedFiles: string[]; createdBy?: string }, lockTimeoutMs?: number) => void;
}

// dist/cli/commands/kb/*.js → ../../../../ → project root (where scripts/ lives)
export const featureKb: FeatureKbModule = _require(
  path.join(__dirname, '..', '..', '..', '..', 'scripts', 'hooks', 'lib', 'feature-kb.cjs')
);

/**
 * Validate a KB slug and exit with an error message if invalid.
 */
export function exitOnInvalidSlug(slug: string): void {
  try {
    featureKb.validateSlug(slug);
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Get the git root for the current directory, or cwd if not in a git repo.
 */
export async function getWorktreePath(): Promise<string> {
  return (await getGitRoot()) ?? process.cwd();
}
