import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractBatchMessages,
  encodeCwdForClaude,
} from '../src/cli/utils/background-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'extract-test-'));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createMockFilterModule(tmpDir: string): string {
  const modulePath = path.join(tmpDir, 'mock-transcript-filter.cjs');
  fs.writeFileSync(
    modulePath,
    `
module.exports.extractChannels = function extractChannels(content) {
  const lines = content.split('\\n').filter(Boolean);
  const userSignals = [];
  const dialogPairs = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'signal') userSignals.push(entry.text);
      if (entry.type === 'pair') dialogPairs.push({ prior: entry.prior, user: entry.user });
    } catch {}
  }
  return { userSignals, dialogPairs };
};
`,
    'utf-8',
  );
  return modulePath;
}

// ---------------------------------------------------------------------------
// extractBatchMessages
// ---------------------------------------------------------------------------

const TEST_CWD = '/test/project';

describe('extractBatchMessages', () => {
  let tmpDir: string;
  let originalHome: string | undefined;
  let filterModulePath: string;
  let batchFile: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
    filterModulePath = createMockFilterModule(tmpDir);
    batchFile = path.join(tmpDir, 'batch-ids');
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupTranscript(sessionId: string, lines: object[]): void {
    const encoded = encodeCwdForClaude(TEST_CWD);
    const projectsDir = path.join(tmpDir, '.claude', 'projects', encoded);
    const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    writeFile(path.join(projectsDir, `${sessionId}.jsonl`), content);
  }

  it('extracts signals from a single valid session', async () => {
    setupTranscript('sess-1', [
      { type: 'signal', text: 'hello' },
      { type: 'signal', text: 'world' },
    ]);
    writeFile(batchFile, 'sess-1\n');

    const result = await extractBatchMessages(batchFile, TEST_CWD, filterModulePath);
    expect(result.userSignals).toEqual(['hello', 'world']);
    expect(result.dialogPairs).toEqual([]);
  });

  it('merges results from multiple sessions', async () => {
    setupTranscript('sess-1', [{ type: 'signal', text: 'from-1' }]);
    setupTranscript('sess-2', [
      { type: 'signal', text: 'from-2' },
      { type: 'pair', prior: 'p', user: 'u' },
    ]);
    writeFile(batchFile, 'sess-1\nsess-2\n');

    const result = await extractBatchMessages(batchFile, TEST_CWD, filterModulePath);
    expect(result.userSignals).toEqual(['from-1', 'from-2']);
    expect(result.dialogPairs).toEqual([{ prior: 'p', user: 'u' }]);
  });

  it('skips missing transcripts silently and returns empty', async () => {
    writeFile(batchFile, 'nonexistent-session\n');

    const result = await extractBatchMessages(batchFile, TEST_CWD, filterModulePath);
    expect(result.userSignals).toEqual([]);
    expect(result.dialogPairs).toEqual([]);
  });

  it('returns empty arrays for empty batch IDs file', async () => {
    writeFile(batchFile, '\n\n');

    const result = await extractBatchMessages(batchFile, TEST_CWD, filterModulePath);
    expect(result.userSignals).toEqual([]);
    expect(result.dialogPairs).toEqual([]);
  });

  it('throws when batch IDs file is missing', async () => {
    await expect(
      extractBatchMessages(path.join(tmpDir, 'no-such-file'), TEST_CWD, filterModulePath),
    ).rejects.toThrow();
  });

  it('returns only valid session data when mixed with missing transcripts', async () => {
    setupTranscript('valid-sess', [{ type: 'signal', text: 'ok' }]);
    writeFile(batchFile, 'missing-sess\nvalid-sess\nalso-missing\n');

    const result = await extractBatchMessages(batchFile, TEST_CWD, filterModulePath);
    expect(result.userSignals).toEqual(['ok']);
    expect(result.dialogPairs).toEqual([]);
  });

  it('handles empty lines and trailing whitespace in batch IDs file', async () => {
    setupTranscript('sess-a', [{ type: 'signal', text: 'a' }]);
    writeFile(batchFile, '\n  sess-a  \n\n  \n');

    const result = await extractBatchMessages(batchFile, TEST_CWD, filterModulePath);
    expect(result.userSignals).toEqual(['a']);
  });
});
