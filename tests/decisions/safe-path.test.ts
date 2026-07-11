// tests/decisions/safe-path.test.ts
//
// Behavioral tests for the safePath utility in safe-path.cjs.
// Each assertion locks an observable contract — what safePath accepts and rejects.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const { safePath } = require(path.join(ROOT, 'scripts/hooks/lib/safe-path.cjs')) as {
  safePath: (filePath: string, allowedRoot?: string) => string;
};

describe('safePath', () => {
  describe('null-byte rejection (security boundary)', () => {
    it('throws a descriptive error when the path contains a null byte', () => {
      expect(() => safePath('/some/path\0evil')).toThrow('Invalid path: contains null byte');
    });

    it('throws when null byte appears at the start', () => {
      expect(() => safePath('\0/etc/passwd')).toThrow('Invalid path: contains null byte');
    });

    it('throws when null byte appears at the end', () => {
      expect(() => safePath('/tmp/file.txt\0')).toThrow('Invalid path: contains null byte');
    });

    it('throws before any root-escape check (null byte is caught first)', () => {
      // Even with a valid allowedRoot, null-byte rejection happens first
      expect(() => safePath('/allowed/path\0/../../../etc', '/allowed')).toThrow(
        'Invalid path: contains null byte'
      );
    });
  });

  describe('valid paths (unchanged behavior)', () => {
    it('resolves a relative path to an absolute path', () => {
      const result = safePath('some/relative/path');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('resolves an absolute path unchanged', () => {
      const result = safePath('/tmp/foo');
      expect(result).toBe('/tmp/foo');
    });

    it('accepts a path within the allowed root', () => {
      const root = '/tmp';
      const result = safePath('/tmp/subdir/file.txt', root);
      expect(result).toBe('/tmp/subdir/file.txt');
    });

    it('accepts a path equal to the allowed root', () => {
      const root = '/tmp';
      const result = safePath('/tmp', root);
      expect(result).toBe('/tmp');
    });

    it('throws when path escapes the allowed root', () => {
      expect(() => safePath('/etc/passwd', '/tmp')).toThrow('Refused path outside');
    });
  });
});
