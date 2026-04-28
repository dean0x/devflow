import * as p from '@clack/prompts';
import color from 'picocolors';
import { isClaudeCliAvailable } from '../../utils/cli.js';
import { runKbAgent } from '../../utils/kb-agent.js';
import { featureKb, exitOnInvalidSlug, getWorktreePath } from './shared.js';

export async function handleCreate(slug: string): Promise<void> {
  exitOnInvalidSlug(slug);
  p.intro(color.cyan(`Create Feature KB: ${slug}`));

  if (!isClaudeCliAvailable()) {
    p.log.error('claude CLI not found on PATH. Install Claude Code first.');
    process.exit(1);
  }

  const worktreePath = await getWorktreePath();

  const name = await p.text({
    message: 'Feature name (human-readable)',
    placeholder: 'e.g., CLI Command System',
    validate: (v) => (v.trim().length < 3 ? 'Name must be at least 3 characters' : undefined),
  });
  if (p.isCancel(name)) { p.cancel('Cancelled.'); return; }

  const directoriesRaw = await p.text({
    message: 'Directories (comma-separated, e.g., src/cli/commands/,src/cli/utils/)',
    placeholder: 'src/feature/',
    validate: (v) => (v.trim().length === 0 ? 'Enter at least one directory' : undefined),
  });
  if (p.isCancel(directoriesRaw)) { p.cancel('Cancelled.'); return; }

  const directories = (directoriesRaw as string).split(',').map((d) => d.trim()).filter(Boolean);
  const dirList = directories.map((d) => `"${d}"`).join(', ');

  const s = p.spinner();
  s.start('Creating KB...');

  const prompt = [
    `You are the Knowledge agent. Create a feature knowledge base for the following area:`,
    ``,
    `FEATURE_SLUG: ${slug}`,
    `FEATURE_NAME: ${name as string}`,
    `DIRECTORIES: [${dirList}]`,
    `WORKTREE_PATH: ${worktreePath}`,
    ``,
    `Follow the devflow:feature-kb skill's 4-phase process:`,
    `1. Scan the directories to identify key files and entry points`,
    `2. Extract architecture, conventions, patterns, integration points`,
    `3. Distill into actionable cross-cutting knowledge`,
    `4. Write .features/${slug}/KNOWLEDGE.md with all required sections`,
    ``,
    `After writing KNOWLEDGE.md, write .features/${slug}/.create-result.json with:`,
    `{`,
    `  "referencedFiles": [<5-10 key files from the explored directories for staleness tracking>],`,
    `  "description": "<one-line description starting with 'Use when' for relevance matching>"`,
    `}`,
    ``,
    `Create the directory if needed. Report KB_STATUS when done.`,
  ].join('\n');

  try {
    const { sidecar } = await runKbAgent({ worktreePath, slug, prompt, sidecarName: '.create-result.json' });

    featureKb.updateIndex(worktreePath, {
      slug,
      name: name as string,
      directories,
      referencedFiles: sidecar.referencedFiles ?? [],
      description: sidecar.description,
      createdBy: 'devflow-kb',
    });

    s.stop('KB created successfully');
    p.log.success(`KB written to .features/${slug}/KNOWLEDGE.md`);
  } catch (err) {
    s.stop('KB creation failed');
    p.log.error(`claude exited with error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  p.outro(`Run ${color.cyan(`devflow kb list`)} to see all KBs`);
}
