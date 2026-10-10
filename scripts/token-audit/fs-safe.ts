/**
 * Symlink-refusing, size-bounded file opening for the token-audit tool.
 *
 * D-AUDIT-UNTRUSTED: the transcript tree is untrusted. A symlink is never followed (an
 * lstat check plus O_NOFOLLOW on the open, so a swap between the two cannot slip through),
 * only regular files are read, and a file over its byte cap is refused rather than read.
 */

import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { sanitizeText } from './types.js';
import type { Result } from './types.js';

export type OpenError =
  | { readonly kind: 'symlink'; readonly path: string }
  | { readonly kind: 'not-file'; readonly path: string }
  | { readonly kind: 'too-large'; readonly path: string; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'not-found'; readonly path: string }
  | { readonly kind: 'io'; readonly path: string; readonly detail: string };

const NOFOLLOW_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function describeError(err: unknown): string {
  const code = errorCode(err);
  if (code !== undefined) return sanitizeText(code, 40);
  return err instanceof Error ? sanitizeText(err.name, 40) : 'unknown error';
}

function toOpenError(path: string, err: unknown): OpenError {
  const code = errorCode(err);
  if (code === 'ENOENT') return { kind: 'not-found', path };
  if (code === 'ELOOP') return { kind: 'symlink', path };
  return { kind: 'io', path, detail: describeError(err) };
}

/** Open `path` for reading if, and only if, it is a regular non-symlink file of at most `maxBytes`. */
export async function openRegularFile(path: string, maxBytes: number): Promise<Result<FileHandle, OpenError>> {
  let handle: FileHandle | undefined;
  try {
    const link = await lstat(path);
    if (link.isSymbolicLink()) return { ok: false, error: { kind: 'symlink', path } };
    if (!link.isFile()) return { ok: false, error: { kind: 'not-file', path } };
    handle = await open(path, NOFOLLOW_FLAGS);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      return { ok: false, error: { kind: 'not-file', path } };
    }
    if (stat.size > maxBytes) {
      await handle.close();
      return { ok: false, error: { kind: 'too-large', path, bytes: stat.size, limit: maxBytes } };
    }
    return { ok: true, value: handle };
  } catch (err) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    return { ok: false, error: toOpenError(path, err) };
  }
}

/** Read a small text file whole, under the same refusals as `openRegularFile`. */
export async function readSmallText(path: string, maxBytes: number): Promise<Result<string, OpenError>> {
  const opened = await openRegularFile(path, maxBytes);
  if (!opened.ok) return opened;
  const handle = opened.value;
  try {
    const text = await handle.readFile({ encoding: 'utf8' });
    return { ok: true, value: text };
  } catch (err) {
    return { ok: false, error: { kind: 'io', path, detail: describeError(err) } };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
