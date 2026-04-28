import * as p from '@clack/prompts';
import color from 'picocolors';
import { isClaudeCliAvailable } from '../../utils/cli.js';
import { runKbAgent } from '../../utils/kb-agent.js';
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
  let slugsToRefresh: string[];
  let stalenessMap: Record<string, { stale: boolean; changedFiles: string[] }> | undefined;
  if (slug) {
    slugsToRefresh = [slug];
  } else {
    stalenessMap = featureKb.checkAllStaleness(worktreePath);
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

  const kbs = featureKb.listKBs(worktreePath);

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
      ``,
      `Instructions:`,
      `- Read .features/${kbSlug}/KNOWLEDGE.md to see the existing KB content`,
      `- Read the CHANGED_FILES to understand what changed`,
      `- Update the stale sections based on changes`,
      `- Preserve any manually added content`,
      `- Do not regenerate from scratch`,
      `- Write the updated KB to .features/${kbSlug}/KNOWLEDGE.md`,
      `- Write .features/${kbSlug}/.refresh-result.json with: {"referencedFiles": [<5-10 key files from explored directories for staleness tracking>]}`,
    ].join('\n');

    try {
      const { sidecar } = await runKbAgent({ worktreePath, slug: kbSlug, prompt, sidecarName: '.refresh-result.json' });

      featureKb.updateIndex(worktreePath, {
        slug: kbSlug,
        name: featureName,
        directories: kbDirectories,
        referencedFiles: sidecar.referencedFiles ?? kbEntry?.referencedFiles ?? [],
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
