/**
 * Bump version across all Devflow files and extract release notes.
 *
 * Usage: npx tsx scripts/bump-version.ts <version>
 *
 * Updates:
 *   - package.json
 *   - package-lock.json (via npm install --package-lock-only)
 *   - 17 plugins/devflow-*\/.claude-plugin/plugin.json
 *   - .claude-plugin/marketplace.json
 *   - CHANGELOG.md ([Unreleased] → [version] - date + compare link)
 *
 * Writes extracted release notes to stdout.
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

// ── Helpers ──────────────────────────────────────────────────

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function isSemver(v: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/.test(v);
}

function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Validate input ───────────────────────────────────────────

const newVersion = process.argv[2];

if (!newVersion) {
  fail('usage: bump-version.ts <version>  (e.g. 1.3.0)');
}

if (!isSemver(newVersion)) {
  fail(`invalid semver: "${newVersion}". Use format X.Y.Z or X.Y.Z-pre.N (e.g. 1.3.0, 2.0.0-beta.1, 1.4.0-rc.1)`);
}

// ── 1. package.json ──────────────────────────────────────────

const pkgPath = join(ROOT, 'package.json');
const pkg = readJson(pkgPath) as { version: string };
const oldVersion = pkg.version;
const alreadyBumped = newVersion === oldVersion;

if (alreadyBumped) {
  process.stderr.write(`  package.json: already at ${newVersion} (skipping bump)\n`);
} else {
  pkg.version = newVersion;
  writeJson(pkgPath, pkg);
  process.stderr.write(`  package.json: ${oldVersion} → ${newVersion}\n`);

  // ── 2. package-lock.json ─────────────────────────────────────

  execSync('npm install --package-lock-only', { cwd: ROOT, stdio: 'pipe' });
  process.stderr.write(`  package-lock.json: synced\n`);

  // ── 3. Plugin plugin.json files ──────────────────────────────

  const pluginJsonPaths = execSync(
    'find plugins/devflow-*/.claude-plugin/plugin.json -type f',
    { cwd: ROOT, encoding: 'utf-8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const rel of pluginJsonPaths) {
    const abs = join(ROOT, rel);
    const pj = readJson(abs) as { version: string };
    pj.version = newVersion;
    writeJson(abs, pj);
  }
  process.stderr.write(`  plugin.json: ${pluginJsonPaths.length} plugins updated\n`);

  // ── 4. marketplace.json ──────────────────────────────────────

  const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');
  const marketplace = readJson(marketplacePath) as {
    plugins: Array<{ version: string }>;
  };

  let marketplaceCount = 0;
  for (const plugin of marketplace.plugins) {
    plugin.version = newVersion;
    marketplaceCount++;
  }
  writeJson(marketplacePath, marketplace);
  process.stderr.write(`  marketplace.json: ${marketplaceCount} entries updated\n`);
}

// ── 5. CHANGELOG.md ─────────────────────────────────────────

const changelogPath = join(ROOT, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf-8');

// Skip CHANGELOG update if version header already exists (already bumped)
const versionHeaderExists = changelog.includes(`## [${newVersion}]`);

if (versionHeaderExists) {
  process.stderr.write(`  CHANGELOG.md: already has [${newVersion}] section (skipping)\n`);
} else {
  if (!changelog.includes('## [Unreleased]')) {
    fail('CHANGELOG.md has no [Unreleased] section');
  }

  // Replace [Unreleased] header with versioned header
  changelog = changelog.replace(
    '## [Unreleased]',
    `## [${newVersion}] - ${today()}`
  );

  // Insert compare link before the old version's link reference
  const compareLinkNew = `[${newVersion}]: https://github.com/dean0x/devflow/compare/v${oldVersion}...v${newVersion}`;
  const oldVersionLink = `[${oldVersion}]:`;
  const oldLinkIdx = changelog.indexOf(oldVersionLink);

  if (oldLinkIdx !== -1) {
    changelog =
      changelog.slice(0, oldLinkIdx) +
      compareLinkNew + '\n' +
      changelog.slice(oldLinkIdx);
  } else {
    // No existing link for old version — append at end
    changelog = changelog.trimEnd() + '\n\n' + compareLinkNew + '\n';
  }

  writeFileSync(changelogPath, changelog);
  process.stderr.write(`  CHANGELOG.md: [Unreleased] → [${newVersion}] - ${today()}\n`);
}

// ── 6. Extract release notes to stdout ──────────────────────

const versionHeader = `## [${newVersion}]`;
const headerIdx = changelog.indexOf(versionHeader);

if (headerIdx === -1) {
  fail('could not find version header in CHANGELOG after update');
}

const contentStart = changelog.indexOf('\n', headerIdx) + 1;

// Find the next `---` separator which marks end of this version's notes
const separatorIdx = changelog.indexOf('\n---\n', contentStart);
let releaseNotes: string;

if (separatorIdx !== -1) {
  releaseNotes = changelog.slice(contentStart, separatorIdx).trim();
} else {
  // Fallback: find next version header
  const nextHeader = changelog.indexOf('\n## [', contentStart);
  if (nextHeader !== -1) {
    releaseNotes = changelog.slice(contentStart, nextHeader).trim();
  } else {
    releaseNotes = changelog.slice(contentStart).trim();
  }
}

// Write release notes to stdout (workflow captures this)
process.stdout.write(releaseNotes + '\n');

process.stderr.write(`\ndone. ${newVersion} bumped across all files.\n`);
