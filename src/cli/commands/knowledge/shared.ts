/**
 * Shared utilities and the feature-knowledge module reference for knowledge subcommands.
 * All subcommand files import from here to avoid duplication.
 */
import * as path from 'path';
import { createRequire } from 'module';
import * as p from '@clack/prompts';
import { getGitRoot } from '../../utils/git.js';
import { getDevFlowDirectory } from '../../utils/paths.js';

const _require = createRequire(import.meta.url);

export type KnowledgeIndex = { version: number; features: Record<string, unknown> } | null;
export type KnowledgeEntry = { slug: string; name: string; directories: string[]; lastUpdated: string; referencedFiles?: string[]; description?: string; createdBy?: string };

export interface FeatureKnowledgeModule {
  loadIndex: (worktreePath: string) => KnowledgeIndex;
  listEntries: (worktreePath: string, cachedIndex?: KnowledgeIndex) => KnowledgeEntry[];
  checkAllStaleness: (worktreePath: string, cachedIndex?: KnowledgeIndex) => Record<string, { stale: boolean; changedFiles: string[] }>;
  checkStaleness: (worktreePath: string, slug: string) => { stale: boolean; changedFiles: string[] };
  findOverlapping: (worktreePath: string, changedFiles: string[]) => string[];
  removeEntry: (worktreePath: string, slug: string) => void;
  validateSlug: (slug: string) => void;
  updateIndex: (worktreePath: string, entry: { slug: string; name: string; description?: string; directories: string[]; referencedFiles: string[]; createdBy?: string }, lockTimeoutMs?: number) => void;
}

let _featureKnowledge: FeatureKnowledgeModule | undefined;

export function getFeatureKnowledge(): FeatureKnowledgeModule {
  if (!_featureKnowledge) {
    _featureKnowledge = _require(
      path.join(getDevFlowDirectory(), 'scripts', 'hooks', 'lib', 'feature-knowledge.cjs'),
    );
  }
  return _featureKnowledge!;
}

/**
 * Validate a knowledge base slug and exit with an error message if invalid.
 */
export function exitOnInvalidSlug(slug: string): void {
  try {
    getFeatureKnowledge().validateSlug(slug);
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
