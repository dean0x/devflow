/**
 * devflow knowledge list — list feature knowledge bases.
 *
 * Reads .devflow/features/index.md directly (write-through cache), or falls back
 * to globbing KNOWLEDGE.md frontmatter when index.md is absent or empty. Freshness
 * comes from verify-against-code at read time in the consuming workflow.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getGitRoot } from '../../../core/git.js';
import { getFeaturesDir } from '../../../core/project-paths.js';

/**
 * A lightweight entry parsed from either index.md lines or KNOWLEDGE.md frontmatter.
 */
interface KbEntry {
  slug: string;
  areas: string;
  description: string;
}

/**
 * Parse entries from index.md lines.
 * Line format: `- **{slug}** — {areas} — {Use-when description}`
 */
function parseIndexMd(content: string): KbEntry[] {
  const entries: KbEntry[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^-\s+\*\*([^*]+)\*\*\s+—\s+([^—]+)\s+—\s+(.+)$/);
    if (m) {
      entries.push({ slug: m[1].trim(), areas: m[2].trim(), description: m[3].trim() });
    }
  }
  return entries;
}

/**
 * Parse the slug and description from a KNOWLEDGE.md file's YAML frontmatter.
 * Returns null when frontmatter is absent or unparseable.
 */
function parseFrontmatter(content: string): { slug: string; name: string; description: string; directories: string[] } | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const get = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : '';
  };
  const getArr = (key: string): string[] => {
    const m = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]+)\\]`, 'm'));
    if (!m) return [];
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  };
  const slug = get('feature');
  const name = get('name');
  const description = get('description');
  const directories = getArr('directories');
  if (!slug) return null;
  return { slug, name, description, directories };
}

/**
 * Resolve the git root for the current directory, falling back to cwd.
 */
async function getWorktreePath(): Promise<string> {
  return (await getGitRoot()) ?? process.cwd();
}

export async function handleList(): Promise<void> {
  p.intro(color.cyan('Feature Knowledge Bases'));

  const worktreePath = await getWorktreePath();
  const featuresDir = getFeaturesDir(worktreePath);
  const indexMdPath = path.join(featuresDir, 'index.md');

  let entries: KbEntry[] = [];

  // Try index.md cache first
  try {
    const indexContent = await fs.readFile(indexMdPath, 'utf-8');
    entries = parseIndexMd(indexContent);
  } catch {
    /* index.md absent — fall through to frontmatter glob */
  }

  // Fallback: glob features/*/KNOWLEDGE.md and parse frontmatter
  if (entries.length === 0) {
    try {
      const slugDirs = await fs.readdir(featuresDir, { withFileTypes: true });
      for (const dirent of slugDirs) {
        if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
        const kbPath = path.join(featuresDir, dirent.name, 'KNOWLEDGE.md');
        try {
          const kbContent = await fs.readFile(kbPath, 'utf-8');
          const fm = parseFrontmatter(kbContent);
          if (fm) {
            entries.push({
              slug: fm.slug,
              areas: fm.directories.join(', ') || dirent.name,
              description: fm.description || fm.name,
            });
          }
        } catch { /* KNOWLEDGE.md absent or unreadable — skip */ }
      }
    } catch { /* featuresDir absent — no KBs */ }
  }

  if (entries.length === 0) {
    p.log.info(
      'No feature knowledge bases found. Knowledge bases are created automatically ' +
      'when workflows (implement, resolve, self-review, explore, debug) detect documented area changes.',
    );
    p.outro('');
    return;
  }

  p.log.info(`Found ${entries.length} feature knowledge base${entries.length === 1 ? '' : 's'} in ${color.dim(worktreePath)}`);
  console.log('');

  for (const entry of entries) {
    console.log(`  ${color.bold(entry.slug)}`);
    console.log(`    areas:      ${color.dim(entry.areas)}`);
    console.log(`    use when:   ${color.dim(entry.description)}`);
    console.log('');
  }

  p.outro('');
}
