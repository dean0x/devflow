import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';

const README = 'README.md';
const CLI_REFERENCE = 'docs/cli-reference.md';
const FILE_ORGANIZATION = 'docs/reference/file-organization.md';
const CHANGELOG = 'CHANGELOG.md';
const BIN_OWNER = 'src/core/tokenmeter-bin.ts';
const BIN_READER = 'src/core/tokenmeter-bin-state.ts';
const PACKAGE = '@dean0x/tokenmeter';
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');
const entry = (relPath: string): CorpusEntry => ({ relPath, content: read(relPath) });
const tree = (dir: string, accept: (file: string) => boolean): CorpusEntry[] =>
  walkFiles(join(ROOT, dir), accept).map((file) => entry(relative(ROOT, file)));

function activeRelease(changelog: string): string {
  // The bump script replaces the first heading. It does not keep an Unreleased heading.
  const heading = /^## \[(?:Unreleased|\d+\.\d+\.\d+(?:-[\w.-]+)?)\][^\r\n]*$/m.exec(changelog);
  return heading ? changelog.slice(heading.index).split(/\r?\n(?=## |---\r?$)/m, 1)[0] : '';
}

// This scan detects known source forms. It does not analyze computed strings or calls through dependencies.
const NETWORK_OR_CREDENTIAL = /['"`](?:node:)?(?:https?|http2|net|tls|dgram|dns(?:\/promises)?|undici|node-fetch|axios|got|ws)['"`]|\b(?:fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(|(?:\bauth\.json|\bcredentials\.(?:json|toml)|\.netrc)\b/;
const RETIRED_READER = /\bcodex-usage\b|\bcodexSnapshotFile\b|\bquota-latest\.json\b|\.codex[/'"`]|['"`]codex-quota['"`]/;
const RELAY_NAME = /\bsubswitch(?:\b|_)/i;
const OLD_NETWORK_CLAIM = /\bmakes? no network call\b|\blocal files only: no credential file, no network\b/i;
const UNSUPPORTED_COMMANDS = [
  /\bnpx\s+(?:-\S+\s+)*['"]?tokenmeter(?=[@\s'"`]|$)/,
  /\bnpx\s+(?:-\S+\s+)*['"]?@dean0x\/tokenmeter(?!@\d+\.\d+\.\d+(?:-[\w.-]+)?(?=[\s'"`]|$))(?=[@\s'"`]|$)/,
  /\b(?:npm|pnpm|bun)\s+(?:install|i|add)\s+(?=[^\r\n`]*\btokenmeter\b)(?:[^\r\n`]*\s)?(?:-g|--global)(?=\s|$|`)/,
  /\b(?:npm|pnpm|bun)\s+(?:-g|--global)\s+(?:install|i|add)\s+[^\r\n`]*\btokenmeter\b/,
  /\byarn\s+global\s+add\s+[^\r\n`]*\btokenmeter\b/,
  /\btokenmeter(?:@[^\s'"`]+)?['"]?\s+--version\b/,
];
const hasUnsupportedCommand = ({ content }: CorpusEntry): boolean =>
  UNSUPPORTED_COMMANDS.some((pattern) => pattern.test(content));

// These two strings are package metadata inputs, not commands or local paths.
const PACKAGE_METADATA: Readonly<Record<string, RegExp>> = {
  [BIN_OWNER]: /^const BIN_NAME = 'tokenmeter';$/m,
  [BIN_READER]: /\bjoin\('node_modules', '@dean0x', 'tokenmeter'\)/,
};

function looksUpTokenmeter({ relPath, content }: CorpusEntry): boolean {
  const metadata = PACKAGE_METADATA[relPath];
  const source = metadata ? content.replace(metadata, '') : content;
  return /['"`]tokenmeter(?=['"`\s])|\b(?:which|where|command\s+-v)\s+tokenmeter\b/.test(source);
}

const privatePath = (...parts: string[]): string => ['', ...parts].join('/');
// Pre-existing dummy paths in older tests. Do not exempt a whole file or folder prefix.
const DUMMY_PATHS: Readonly<Record<string, readonly string[]>> = {
  'tests/hud-components.test.ts': [privatePath('home', 'user', 'projects', 'my-app')],
  'tests/hud-render.test.ts': [privatePath('home', 'user', 'project'), privatePath('tmp', 'nonexistent-devflow-test-home'), privatePath('tmp', 'hud-config-home')],
  'tests/uninstall-logic.test.ts': [
    privatePath('tmp', 'devflow-d8-disjoint'), privatePath('Users', 'testuser'),
    privatePath('Users', 'testuser', '.devflow', 'skills'), privatePath('tmp', '.devflow'),
    privatePath('tmp', 'devflow-a4-test'), privatePath('tmp', 'x'),
  ],
};

function hasLocalPath({ relPath, content }: CorpusEntry): boolean {
  const paths = /(?:^|[\s'"`(=])((?:\/(?:Users|home|tmp|var\/tmp|var\/folders|private\/tmp|private\/var\/folders)\/|[A-Z]:\\+Users\\+|\.\.\/(?:devflow|tokenmeter)-)[^\s'"`),;]+)/gi;
  return [...content.matchAll(paths)].some((match) => !(DUMMY_PATHS[relPath] ?? []).includes(match[1]));
}

function expectClean(files: readonly CorpusEntry[], rejects: (file: CorpusEntry) => boolean): void {
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((file) => file.content.trim() === '').map((file) => file.relPath)).toEqual([]);
  expect(files.filter(rejects).map((file) => file.relPath)).toEqual([]);
}

function matches(rule: RegExp): (file: CorpusEntry) => boolean {
  return ({ content }) => rule.test(content);
}

const hudSources = (): CorpusEntry[] => tree('src/hud', (file) => file.endsWith('.ts'));
const newHudSources = (): CorpusEntry[] => [entry('src/hud/tokenmeter.ts'), entry(BIN_READER), entry(BIN_OWNER)];
const currentChangelog = (): CorpusEntry => ({ relPath: CHANGELOG, content: activeRelease(read(CHANGELOG)) });
const codexDocs = (): CorpusEntry[] => [entry(README), entry(CLI_REFERENCE), entry(FILE_ORGANIZATION)];

function documentedOffVersions(text: string): string[] {
  return [...text.matchAll(/\bnpx\s+@dean0x\/tokenmeter@([^\s`]+)\s+config\s+app_server\s+off(?=[\s`]|$)/g)].map((match) => match[1]);
}

function dependencyPin(): string | null {
  const pkg: unknown = JSON.parse(read('package.json'));
  if (typeof pkg !== 'object' || pkg === null || !('dependencies' in pkg)) return null;
  const deps = pkg.dependencies;
  if (typeof deps !== 'object' || deps === null || !(PACKAGE in deps)) return null;
  const version = deps[PACKAGE];
  return typeof version === 'string' ? version : null;
}

const RETIRED_FILES = ['src/hud/codex-usage.ts', 'tests/hud-codex-usage.test.ts'];
const tokenmeterTests = [
  'tests/hud-components.test.ts', 'tests/hud-installed-layout.test.ts', 'tests/hud-render.test.ts',
  'tests/hud-tokenmeter.test.ts', 'tests/installer/charter-render-wiring.test.ts', 'tests/packaging.test.ts',
  'tests/tokenmeter-bin.test.ts', 'tests/tokenmeter-contract.test.ts', 'tests/uninstall-logic.test.ts',
  'tests/guards/hud-usage-source.test.ts',
];

const existingPaths = (files: readonly string[]): string[] => files.filter((file) => existsSync(join(ROOT, file)));

describe('HUD Codex usage source', () => {
  it('does not open network connections or read credential files from the HUD or its bin modules', () => {
    const hud = hudSources();
    expect(hud.length).toBeGreaterThan(0);
    expectClean([...hud, entry(BIN_OWNER), entry(BIN_READER)], matches(NETWORK_OR_CREDENTIAL));
  });

  it('does not use PATH to find the tokenmeter executable', () => {
    expectClean(newHudSources(), looksUpTokenmeter);
    expectClean(hudSources(), looksUpTokenmeter);
  });

  it('has no Codex log reader, proxy snapshot reader, or old cache key', () => {
    expect(RETIRED_FILES.length).toBeGreaterThan(0);
    expect(existingPaths(RETIRED_FILES)).toEqual([]);
    const hud = hudSources();
    expect(hud.length).toBeGreaterThan(0);
    expectClean([...hud, entry('src/core/cache.ts'), entry(BIN_OWNER), entry(BIN_READER)], matches(RETIRED_READER));
  });

  it('names no relay package in the current docs or the new HUD sources', () => {
    expectClean([...codexDocs(), currentChangelog(), ...newHudSources()], matches(RELAY_NAME));
  });

  it('does not claim the HUD makes no network call', () => {
    expectClean(codexDocs(), matches(OLD_NETWORK_CLAIM));
  });

  it('contains no local checkout, home, or temporary path in the HUD changes', () => {
    const goldens = tree('tests/fixtures/golden', (file) => /^install-snapshot-.*\.txt$/.test(basename(file)));
    expect(goldens.length).toBeGreaterThan(0);
    expectClean([
      ...codexDocs(), currentChangelog(), ...hudSources(), ...goldens, ...tokenmeterTests.map(entry),
      ...['package.json', 'package-lock.json', 'src/core/cache.ts', 'src/core/fs-atomic.ts', BIN_OWNER, BIN_READER,
        'src/cli/commands/init.ts', 'src/cli/commands/uninstall.ts', 'src/targets/claude-code/installer.ts'].map(entry),
    ], hasLocalPath);
  });

  it('does not tell users to run or install an unscoped package', () => {
    const src = tree('src', (file) => ['', '.ts', '.js', '.cjs', '.mjs', '.sh', '.md', '.mds', '.json'].includes(extname(file)));
    const docs = tree('docs', (file) => file.endsWith('.md'));
    expect(src.length).toBeGreaterThan(0);
    expect(docs.length).toBeGreaterThan(0);
    // Empty templates are part of these trees. They have no commands to check.
    expectClean([...src, ...docs].filter((file) => file.content.trim()).concat(entry(README), currentChangelog()), hasUnsupportedCommand);
  });

  it.each([README, CLI_REFERENCE])('documents the exact package pin in the off command in %s', (file) => {
    const pin = dependencyPin();
    expect(pin).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
    expect(documentedOffVersions(read(file))).toEqual([pin]);
  });
});

describe('HUD source guard controls', () => {
  it.each([
    "import { request } from 'node:https';", "const net = require('net');", "await import('undici');",
    'await globalThis.fetch(url);', "const file = join(home, 'auth.json');",
  ])('rejects a network or credential source: %s', (line) => expect(line).toMatch(NETWORK_OR_CREDENTIAL));

  it.each([
    "execFile('tokenmeter', ['hud']);", "execFile('which', ['tokenmeter']);",
    "exec('command -v tokenmeter');", "const finder = which(\n  'tokenmeter',\n);",
  ])('rejects a PATH lookup: %s', (content) => expect(looksUpTokenmeter({ relPath: BIN_OWNER, content })).toBe(true));

  it('detects an existing path in the list of removed files', () => {
    const present = 'src/hud/tokenmeter.ts';
    expect(existingPaths([...RETIRED_FILES, present])).toEqual([present]);
  });

  it.each([
    "import { read } from './codex-usage.js';", "readFile(join(home, '.codex', 'sessions'));",
    'const snapshot = config.codexSnapshotFile;', "readFile('quota-latest.json');", "readCache(dir, 'codex-quota');",
  ])('rejects a retired reader or cache source: %s', (line) => expect(line).toMatch(RETIRED_READER));

  it.each([
    privatePath('Users', 'sample', 'checkout'), privatePath('home', 'sample', 'checkout'),
    privatePath('tmp', 'sample'), privatePath('private', 'var', 'folders', 'sample'),
    ['C:', 'Users', 'sample'].join('\\'), ['..', 'tokenmeter-sample'].join('/'),
  ])('rejects a local path: %s', (content) => expect(hasLocalPath({ relPath: README, content })).toBe(true));

  it.each([
    'npx tokenmeter hud', 'npx --yes tokenmeter@latest hud', 'npx @dean0x/tokenmeter config app_server off',
    'npx @dean0x/tokenmeter@latest hud', 'npm install -g tokenmeter', 'npm i tokenmeter --global',
    'npm --global install tokenmeter', 'yarn global add tokenmeter', 'tokenmeter --version',
  ])('rejects an unsupported command: %s', (content) => expect(hasUnsupportedCommand({ relPath: README, content })).toBe(true));

  it('extracts both versions if a second off command has a different version', () => {
    const good = `npx ${PACKAGE}@1.2.3 config app_server off`;
    const wrong = `npx ${PACKAGE}@1.2.4 config app_server off`;
    expect(documentedOffVersions(good)).toEqual(['1.2.3']);
    expect(documentedOffVersions(wrong)).not.toEqual(['1.2.3']);
    expect(documentedOffVersions('')).not.toEqual(['1.2.3']);
    expect(documentedOffVersions(`${good}\n${wrong}`)).toEqual(['1.2.3', '1.2.4']);
    expect(hasUnsupportedCommand({ relPath: README, content: good })).toBe(false);
  });

  it('rejects the old HTTP claim', () => {
    expect('The HUD makes no network call.').toMatch(OLD_NETWORK_CLAIM);
    expect('Neither devflow nor tokenmeter makes an HTTP call.').not.toMatch(OLD_NETWORK_CLAIM);
  });

  it.each(['[Unreleased]', '[4.0.0] - 2026-01-01'])('checks the current changelog entry under %s and skips history', (heading) => {
    const good = '- Devflow proxy.';
    const bad = '- The package is subswitch.';
    const current = `## ${heading}\n\n### Changed\n\n${good}\n\n---\n\n## [3.0.0] - 2025-01-01\n${bad}\n`;
    expect(activeRelease(current).trimEnd()).toBe(`## ${heading}\n\n### Changed\n\n${good}`);
    expect(activeRelease(current)).not.toMatch(RELAY_NAME);
    expect(activeRelease(current.replace(good, bad))).toMatch(RELAY_NAME);
  });
});
