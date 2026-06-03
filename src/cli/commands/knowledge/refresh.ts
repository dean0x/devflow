import * as p from '@clack/prompts';
import color from 'picocolors';
import { isClaudeCliAvailable } from '../../utils/cli.js';
import { runKnowledgeAgent, loadDecisionsContext } from '../../utils/knowledge-agent.js';
import { getFeatureKnowledge, exitOnInvalidSlug, getWorktreePath } from './shared.js';

export async function handleRefresh(targetSlug?: string): Promise<void> {
  p.intro(color.cyan(targetSlug ? `Refresh Knowledge Base: ${targetSlug}` : 'Refresh Stale Knowledge Bases'));

  if (targetSlug) exitOnInvalidSlug(targetSlug);

  if (!isClaudeCliAvailable()) {
    p.log.error('claude CLI not found on PATH. Install Claude Code first.');
    process.exit(1);
  }

  const worktreePath = await getWorktreePath();

  // Determine which slugs to refresh
  // Load index once and reuse across staleness check + listEntries to avoid double reads
  const index = getFeatureKnowledge().loadIndex(worktreePath);
  const kbs = getFeatureKnowledge().listEntries(worktreePath, index);

  let slugsToRefresh: string[];
  let stalenessMap: Record<string, { stale: boolean; changedFiles: string[] }> | undefined;
  if (targetSlug) {
    slugsToRefresh = [targetSlug];
  } else {
    stalenessMap = getFeatureKnowledge().checkAllStaleness(worktreePath, index);
    slugsToRefresh = Object.entries(stalenessMap)
      .filter(([, info]) => info.stale)
      .map(([s]) => s);
  }

  if (slugsToRefresh.length === 0) {
    p.log.success('No stale knowledge bases found — everything is current.');
    p.outro('');
    return;
  }

  p.log.info(`Refreshing ${slugsToRefresh.length} knowledge base${slugsToRefresh.length === 1 ? '' : 's'}: ${slugsToRefresh.join(', ')}`);

  const decisionsContext = loadDecisionsContext(worktreePath);

  for (const slug of slugsToRefresh) {
    const s = p.spinner();
    s.start(`Refreshing ${slug}...`);

    const staleInfo = stalenessMap?.[slug] ?? getFeatureKnowledge().checkStaleness(worktreePath, slug);
    const entry = kbs.find((k: { slug: string }) => k.slug === slug);
    const featureName = entry?.name ?? slug;
    const directories = entry?.directories ?? [];

    const prompt = [
      `You are the Knowledge agent refreshing a stale feature knowledge base.`,
      ``,
      `FEATURE_SLUG: ${slug}`,
      `FEATURE_NAME: ${featureName}`,
      `DIRECTORIES: ${JSON.stringify(directories)}`,
      `WORKTREE_PATH: ${worktreePath}`,
      `CHANGED_FILES: ${JSON.stringify(staleInfo.changedFiles)}`,
      `DECISIONS_CONTEXT: ${decisionsContext}`,
      ``,
      `STEP 1: Load the devflow:feature-knowledge skill using the Skill tool (skill: "devflow:feature-knowledge").`,
      `STEP 2: Read .devflow/features/${slug}/KNOWLEDGE.md to understand the existing knowledge base content and structure.`,
      `STEP 3: Read the CHANGED_FILES to understand what changed in the codebase.`,
      `STEP 4: Update the knowledge base following the skill's quality standards:`,
      `  - Maintain the correct category template structure`,
      `  - Ensure code examples follow the 3-part rule (description, inline comments, takeaways)`,
      `  - Update cross-references in the Related section using DECISIONS_CONTEXT`,
      `  - Preserve any manually added content the user edited in`,
      `  - Do NOT regenerate from scratch — update only what changed`,
      `STEP 5: Write the updated knowledge base to .devflow/features/${slug}/KNOWLEDGE.md`,
      `STEP 6: Write .devflow/features/${slug}/.refresh-result.json with:`,
      `{`,
      `  "referencedFiles": [<5-10 key files from explored directories for staleness tracking>],`,
      `  "description": "<updated one-line description starting with 'Use when'>"`,
      `}`,
    ].join('\n');

    try {
      const { result } = await runKnowledgeAgent({ worktreePath, slug, prompt, resultFileName: '.refresh-result.json' });

      getFeatureKnowledge().updateIndex(worktreePath, {
        slug,
        name: featureName,
        directories,
        referencedFiles: result.referencedFiles ?? entry?.referencedFiles ?? [],
        description: result.description,
        createdBy: 'devflow-knowledge',
      });

      s.stop(`${slug} refreshed`);
    } catch (err) {
      s.stop(`${slug} refresh failed`);
      p.log.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  p.outro('Refresh complete');
}
