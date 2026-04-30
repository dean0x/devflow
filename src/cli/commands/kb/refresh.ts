import * as p from '@clack/prompts';
import color from 'picocolors';
import { isClaudeCliAvailable } from '../../utils/cli.js';
import { runKbAgent, loadKnowledgeContext } from '../../utils/kb-agent.js';
import { featureKb, exitOnInvalidSlug, getWorktreePath } from './shared.js';

export async function handleRefresh(slug?: string): Promise<void> {
  p.intro(color.cyan(slug ? `Refresh KB: ${slug}` : 'Refresh Stale KBs'));

  if (slug) exitOnInvalidSlug(slug);

  if (!isClaudeCliAvailable()) {
    p.log.error('claude CLI not found on PATH. Install Claude Code first.');
    process.exit(1);
  }

  const worktreePath = await getWorktreePath();

  // Determine which slugs to refresh
  // Load index once and reuse across staleness check + listKBs to avoid double reads
  const index = featureKb.loadIndex(worktreePath);
  const kbs = featureKb.listKBs(worktreePath, index);

  let slugsToRefresh: string[];
  let stalenessMap: Record<string, { stale: boolean; changedFiles: string[] }> | undefined;
  if (slug) {
    slugsToRefresh = [slug];
  } else {
    stalenessMap = featureKb.checkAllStaleness(worktreePath, index);
    slugsToRefresh = Object.entries(stalenessMap)
      .filter(([, info]) => info.stale)
      .map(([s]) => s);
  }

  if (slugsToRefresh.length === 0) {
    p.log.success('No stale KBs found — everything is current.');
    p.outro('');
    return;
  }

  p.log.info(`Refreshing ${slugsToRefresh.length} KB${slugsToRefresh.length === 1 ? '' : 's'}: ${slugsToRefresh.join(', ')}`);

  const knowledgeContext = loadKnowledgeContext(worktreePath);

  for (const kbSlug of slugsToRefresh) {
    const s = p.spinner();
    s.start(`Refreshing ${kbSlug}...`);

    const staleInfo = stalenessMap?.[kbSlug] ?? featureKb.checkStaleness(worktreePath, kbSlug);
    const kbEntry = kbs.find((k: { slug: string }) => k.slug === kbSlug);
    const featureName = kbEntry?.name ?? kbSlug;
    const kbDirectories = kbEntry?.directories ?? [];

    const prompt = [
      `You are the Knowledge agent refreshing a stale feature knowledge base.`,
      ``,
      `FEATURE_SLUG: ${kbSlug}`,
      `FEATURE_NAME: ${featureName}`,
      `DIRECTORIES: ${JSON.stringify(kbDirectories)}`,
      `WORKTREE_PATH: ${worktreePath}`,
      `CHANGED_FILES: ${JSON.stringify(staleInfo.changedFiles)}`,
      `KNOWLEDGE_CONTEXT: ${knowledgeContext}`,
      ``,
      `STEP 1: Load the devflow:feature-kb skill using the Skill tool (skill: "devflow:feature-kb").`,
      `STEP 2: Read .features/${kbSlug}/KNOWLEDGE.md to understand the existing KB content and structure.`,
      `STEP 3: Read the CHANGED_FILES to understand what changed in the codebase.`,
      `STEP 4: Update the KB following the skill's quality standards:`,
      `  - Maintain the correct category template structure`,
      `  - Ensure code examples follow the 3-part rule (description, inline comments, takeaways)`,
      `  - Update cross-references in the Related section using KNOWLEDGE_CONTEXT`,
      `  - Preserve any manually added content the user edited in`,
      `  - Do NOT regenerate from scratch — update only what changed`,
      `STEP 5: Write the updated KB to .features/${kbSlug}/KNOWLEDGE.md`,
      `STEP 6: Write .features/${kbSlug}/.refresh-result.json with:`,
      `{`,
      `  "referencedFiles": [<5-10 key files from explored directories for staleness tracking>],`,
      `  "description": "<updated one-line description starting with 'Use when'>"`,
      `}`,
    ].join('\n');

    try {
      const { sidecar } = await runKbAgent({ worktreePath, slug: kbSlug, prompt, sidecarName: '.refresh-result.json' });

      featureKb.updateIndex(worktreePath, {
        slug: kbSlug,
        name: featureName,
        directories: kbDirectories,
        referencedFiles: sidecar.referencedFiles ?? kbEntry?.referencedFiles ?? [],
        description: sidecar.description,
        createdBy: 'devflow-kb',
      });

      s.stop(`${kbSlug} refreshed`);
    } catch (err) {
      s.stop(`${kbSlug} refresh failed`);
      p.log.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  p.outro('Refresh complete');
}
