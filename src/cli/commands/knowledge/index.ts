/**
 * devflow knowledge — per-feature knowledge base management.
 * Thin router that delegates each subcommand to its own module.
 */
import { Command } from 'commander';

import { handleToggle, addKnowledgeHook, removeKnowledgeHook, hasKnowledgeHook } from './toggle.js';
import { handleList } from './list.js';
import { handleCheck } from './check.js';
import { handleCreate } from './create.js';
import { handleRefresh } from './refresh.js';
import { handleRemove } from './remove.js';

// Re-export hook utilities and sidecar helpers for callers that import from knowledge/index.js
export { addKnowledgeHook, removeKnowledgeHook, hasKnowledgeHook };
export type { SidecarData } from '../../utils/sidecar.js';
export { readSidecar } from '../../utils/sidecar.js';

export const knowledgeCommand = new Command('knowledge')
  .description('Manage per-feature knowledge bases')
  .option('--enable', 'Enable per-feature knowledge bases')
  .option('--disable', 'Disable per-feature knowledge bases')
  .option('--status', 'Show knowledge base feature status')
  .action(async (options: { enable?: boolean; disable?: boolean; status?: boolean }) => {
    await handleToggle(options);
  });

knowledgeCommand
  .command('list')
  .description('List all feature knowledge bases with staleness status')
  .action(async () => {
    await handleList();
  });

knowledgeCommand
  .command('check')
  .description('Check all knowledge bases for staleness')
  .action(async () => {
    await handleCheck();
  });

knowledgeCommand
  .command('create <slug>')
  .description('Create a new knowledge base via claude -p exploration')
  .action(async (slug: string) => {
    await handleCreate(slug);
  });

knowledgeCommand
  .command('refresh [slug]')
  .description('Refresh stale knowledge base(s). Omit slug to refresh all stale knowledge bases.')
  .action(async (slug?: string) => {
    await handleRefresh(slug);
  });

knowledgeCommand
  .command('remove <slug>')
  .description('Remove a knowledge base and its index entry')
  .action(async (slug: string) => {
    await handleRemove(slug);
  });
