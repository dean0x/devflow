#!/usr/bin/env node

/**
 * Copy compiled HUD scripts from dist/hud/ to scripts/hud/
 * for distribution alongside the shell wrapper.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const src = path.join(__dirname, '..', 'dist', 'hud');
const dest = path.join(__dirname, 'hud');

// Clean destination
if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });

function copyDir(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, entry.name);
    const dp = path.join(d, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

if (fs.existsSync(src)) {
  copyDir(src, dest);
  console.log(`\u2713 HUD scripts copied to ${dest}`);
} else {
  console.warn('\u26A0 dist/hud not found \u2014 run tsc first');
}
