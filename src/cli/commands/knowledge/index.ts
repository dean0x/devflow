/**
 * devflow knowledge — per-feature knowledge base management.
 * Thin router that delegates to list (read-only) and toggle (enable/disable/status).
 *
 * The heavy CRUD subcommands (create/check/refresh/remove) are deleted — knowledge
 * bases are created automatically via write-through (knowledge_writeback MDS partial).
 */
import { Command } from 'commander';

import { handleToggle } from './toggle.js';
import { handleList } from './list.js';

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
  .description('List all feature knowledge bases')
  .action(async () => {
    await handleList();
  });
