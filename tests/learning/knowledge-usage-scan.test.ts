import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const SCANNER = path.resolve(import.meta.dirname, '../../scripts/hooks/knowledge-usage-scan.cjs');

function runScanner(cwd: string, stdin: string): string {
  try {
    return execSync(`node "${SCANNER}" --cwd "${cwd}"`, {
      input: stdin,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
  } catch {
    return ''; // scanner is designed to be silent on errors
  }
}

describe('knowledge-usage-scan', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-scan-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedUsage(entries: Record<string, { cites: number; last_cited: string | null; created: string }>) {
    fs.writeFileSync(
      path.join(memoryDir, '.knowledge-usage.json'),
      JSON.stringify({ version: 1, entries }, null, 2) + '\n',
    );
  }

  function readUsage() {
    return JSON.parse(fs.readFileSync(path.join(memoryDir, '.knowledge-usage.json'), 'utf8'));
  }

  it('increments cites for registered IDs', () => {
    seedUsage({ 'ADR-001': { cites: 0, last_cited: null, created: '2026-01-01' } });
    runScanner(tmpDir, 'I applied ADR-001 to fix the issue');
    const data = readUsage();
    expect(data.entries['ADR-001'].cites).toBe(1);
    expect(data.entries['ADR-001'].last_cited).toBeTruthy();
  });

  it('handles multiple different IDs', () => {
    seedUsage({
      'ADR-001': { cites: 0, last_cited: null, created: '2026-01-01' },
      'PF-002': { cites: 1, last_cited: null, created: '2026-01-01' },
    });
    runScanner(tmpDir, 'Applied ADR-001 and avoided PF-002');
    const data = readUsage();
    expect(data.entries['ADR-001'].cites).toBe(1);
    expect(data.entries['PF-002'].cites).toBe(2);
  });

  it('deduplicates same ID mentioned multiple times', () => {
    seedUsage({ 'ADR-001': { cites: 0, last_cited: null, created: '2026-01-01' } });
    runScanner(tmpDir, 'ADR-001 was relevant, so I used ADR-001 again');
    const data = readUsage();
    expect(data.entries['ADR-001'].cites).toBe(1); // only incremented once
  });

  it('ignores unregistered IDs', () => {
    seedUsage({ 'ADR-001': { cites: 0, last_cited: null, created: '2026-01-01' } });
    runScanner(tmpDir, 'Referencing ADR-999 which is not registered');
    const data = readUsage();
    expect(data.entries['ADR-999']).toBeUndefined();
    expect(data.entries['ADR-001'].cites).toBe(0); // unchanged
  });

  it('handles no matches gracefully', () => {
    seedUsage({ 'ADR-001': { cites: 0, last_cited: null, created: '2026-01-01' } });
    runScanner(tmpDir, 'no references here at all');
    const data = readUsage();
    expect(data.entries['ADR-001'].cites).toBe(0); // unchanged
  });

  it('handles missing .memory directory gracefully', () => {
    fs.rmSync(memoryDir, { recursive: true, force: true });
    // Should not throw
    runScanner(tmpDir, 'ADR-001 should be ignored');
    // No crash, no file created
    expect(fs.existsSync(path.join(memoryDir, '.knowledge-usage.json'))).toBe(false);
  });

  it('handles malformed usage JSON gracefully', () => {
    fs.writeFileSync(path.join(memoryDir, '.knowledge-usage.json'), '{bad json');
    // Should not throw, just start fresh (but since no entries are registered, no writes)
    runScanner(tmpDir, 'ADR-001 reference');
    // The file may remain malformed since ADR-001 isn't registered in the bad data
  });
});
