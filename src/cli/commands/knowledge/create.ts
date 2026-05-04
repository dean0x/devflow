import * as p from '@clack/prompts';
import color from 'picocolors';
import { isClaudeCliAvailable } from '../../utils/cli.js';
import { runKnowledgeAgent, loadDecisionsContext } from '../../utils/knowledge-agent.js';
import { getFeatureKnowledge, exitOnInvalidSlug, getWorktreePath } from './shared.js';

export async function handleCreate(slug: string): Promise<void> {
  exitOnInvalidSlug(slug);
  p.intro(color.cyan(`Create Feature Knowledge Base: ${slug}`));

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
  s.start('Creating knowledge base...');

  const decisionsContext = loadDecisionsContext(worktreePath);

  const prompt = [
    `You are the Knowledge agent. Create a feature knowledge base for the following area:`,
    ``,
    `FEATURE_SLUG: ${slug}`,
    `FEATURE_NAME: ${name as string}`,
    `DIRECTORIES: [${dirList}]`,
    `WORKTREE_PATH: ${worktreePath}`,
    `DECISIONS_CONTEXT: ${decisionsContext}`,
    ``,
    `STEP 1: Load the devflow:feature-knowledge skill using the Skill tool (skill: "devflow:feature-knowledge").`,
    `STEP 2: Read .features/index.json (if it exists) to see what other knowledge bases exist for cross-referencing.`,
    `STEP 3: Execute the skill's 4-phase process (Scan → Extract → Distill → Forge) exactly as specified.`,
    `  - You have no pre-computed exploration outputs — perform your own exploration in Phase 1 (Scan) and Phase 2 (Extract).`,
    `  - Use DECISIONS_CONTEXT to cross-reference ADR/PF entries in the Related section.`,
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
    const { sidecar } = await runKnowledgeAgent({ worktreePath, slug, prompt, sidecarName: '.create-result.json' });

    getFeatureKnowledge().updateIndex(worktreePath, {
      slug,
      name: name as string,
      directories,
      referencedFiles: sidecar.referencedFiles ?? [],
      description: sidecar.description,
      createdBy: 'devflow-knowledge',
    });

    s.stop('Knowledge base created successfully');
    p.log.success(`Knowledge base written to .features/${slug}/KNOWLEDGE.md`);
  } catch (err) {
    s.stop('Knowledge base creation failed');
    p.log.error(`claude exited with error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  p.outro(`Run ${color.cyan(`devflow knowledge list`)} to see all knowledge bases`);
}
