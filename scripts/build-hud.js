#!/usr/bin/env node

/**
 * Copy the compiled HUD entry point plus all of its transitive dist/
 * dependencies to scripts/hud/ (and mirrored sibling dirs under scripts/)
 * for distribution alongside scripts/hud.sh.
 *
 * The HUD can import from sibling dist/ directories (e.g.
 * `../utils/notifications-shape.js`). Copying only dist/hud/ leaves such
 * imports unresolvable at install time. Walking the import graph ensures
 * every file the HUD actually reaches at runtime is present under scripts/
 * at the same relative path, with no bundler dependency.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distRoot = path.join(__dirname, '..', 'dist');
const scriptsRoot = __dirname;
const entry = path.join(distRoot, 'hud', 'index.js');
const hudOutDir = path.join(scriptsRoot, 'hud');

if (!fs.existsSync(entry)) {
  console.warn('\u26A0 dist/hud/index.js not found \u2014 run tsc first');
  process.exit(0);
}

if (fs.existsSync(hudOutDir)) fs.rmSync(hudOutDir, { recursive: true });

// Match static and dynamic ESM imports with relative specifiers.
const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function copyFile(distPath) {
  const rel = path.relative(distRoot, distPath);
  const outPath = path.join(scriptsRoot, rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(distPath, outPath);

  // Also copy the sourcemap if present, to preserve debuggability.
  const mapPath = `${distPath}.map`;
  if (fs.existsSync(mapPath)) fs.copyFileSync(mapPath, `${outPath}.map`);
}

function collectRelativeImports(source) {
  const specs = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

const visited = new Set();
const queue = [entry];

while (queue.length > 0) {
  const current = queue.shift();
  if (visited.has(current)) continue;
  visited.add(current);

  copyFile(current);

  const source = fs.readFileSync(current, 'utf8');
  const currentDir = path.dirname(current);

  for (const spec of collectRelativeImports(source)) {
    const resolved = path.resolve(currentDir, spec);
    if (!resolved.startsWith(`${distRoot}${path.sep}`)) continue;
    if (!resolved.endsWith('.js')) continue;
    if (visited.has(resolved)) continue;
    if (!fs.existsSync(resolved)) {
      console.warn(`\u26A0 Unresolved import ${spec} from ${current}`);
      continue;
    }
    queue.push(resolved);
  }
}

// All compiled .js files use ESM syntax — Node needs this to resolve imports
// across sibling directories (e.g. hud/ importing from ../utils/).
const pkgJsonPath = path.join(scriptsRoot, 'package.json');
if (!fs.existsSync(pkgJsonPath)) {
  fs.writeFileSync(pkgJsonPath, '{"type": "module"}\n');
}

console.log(`\u2713 HUD distribution: ${visited.size} files copied to ${scriptsRoot}`);
