/**
 * Tests for inspectCodexAuth — the Codex credential-file inspector behind
 * `devflow proxy --status`.
 *
 * Strategy: pure function over plain strings. No I/O, no fixtures on disk.
 * Assertions are on the verdict the relay would reach, not on internal shape.
 */

import { describe, it, expect } from 'vitest';
import { inspectCodexAuth } from '../src/core/codex-auth-inspect.js';

/** Build a display-decodable JWT. Signature is irrelevant — we never verify it. */
const jwt = (payload: Record<string, unknown>): string =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const ACCOUNT_ID = '70e7f41b-8c3e-4709-b9fc-53b163d8e65c';
/** 2026-08-17T18:24:42Z, matching the shape of a real Codex access token. */
const EXP_SECONDS = 1786213482;

const authFile = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    tokens: {
      id_token: jwt({ sub: 'x' }),
      access_token: jwt({ exp: EXP_SECONDS, 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT_ID } }),
      refresh_token: 'refresh-token-material',
      account_id: ACCOUNT_ID,
    },
    last_refresh: '2026-08-07T18:24:43.086Z',
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    ...over,
  });

describe('inspectCodexAuth — healthy file', () => {
  it('reports present with auth mode, account suffix, and expiry', () => {
    const state = inspectCodexAuth(authFile());
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.authMode).toBe('chatgpt');
    expect(state.accountSuffix).toBe('…d8e65c');
    expect(state.expiresAt?.toISOString()).toBe(new Date(EXP_SECONDS * 1000).toISOString());
  });

  it('falls back to the JWT account claim when account_id is absent', () => {
    const raw = authFile({
      tokens: {
        access_token: jwt({
          exp: EXP_SECONDS,
          'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT_ID },
        }),
      },
    });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.accountSuffix).toBe('…d8e65c');
  });

  it('reports auth mode "unknown" when the field is missing', () => {
    const raw = authFile({ auth_mode: undefined });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.authMode).toBe('unknown');
  });

  it('leaks no token material and no full account id', () => {
    const state = inspectCodexAuth(authFile());
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain('refresh-token-material');
    expect(serialised).not.toContain(ACCOUNT_ID);
    expect(serialised).not.toContain('eyJhbGciOiJub25lIn0');
  });
});

describe('inspectCodexAuth — expiry edge cases', () => {
  it('undefined expiry when the access token is not a JWT', () => {
    const raw = authFile({ tokens: { access_token: 'opaque-token', account_id: ACCOUNT_ID } });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.expiresAt).toBeUndefined();
  });

  it('undefined expiry when exp is not a number', () => {
    const raw = authFile({
      tokens: { access_token: jwt({ exp: 'soon' }), account_id: ACCOUNT_ID },
    });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.expiresAt).toBeUndefined();
  });

  it('undefined expiry when the JWT payload is not decodable', () => {
    const raw = authFile({
      tokens: { access_token: 'header.!!!not-base64!!!.sig', account_id: ACCOUNT_ID },
    });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.expiresAt).toBeUndefined();
  });

  it('a past expiry is still "present" — the relay refreshes it', () => {
    const raw = authFile({
      tokens: { access_token: jwt({ exp: 946684800 }), account_id: ACCOUNT_ID },
    });
    expect(inspectCodexAuth(raw).kind).toBe('present');
  });
});

describe('inspectCodexAuth — accountSuffix ellipsis is conditional', () => {
  it('prefixes ellipsis when account id is longer than 6 characters (normal UUID)', () => {
    const state = inspectCodexAuth(authFile());
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    // ACCOUNT_ID is a 36-char UUID — last 6 chars are 'd8e65c', prefixed with '…'
    expect(state.accountSuffix).toBe('…d8e65c');
  });

  it('no ellipsis when account id is exactly 6 characters — no characters were elided', () => {
    const shortId = 'abc123';
    const raw = authFile({ tokens: { access_token: jwt({ exp: EXP_SECONDS }), account_id: shortId } });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    // 6 chars ≤ ACCOUNT_SUFFIX_LENGTH — returned as-is, no false-truncation prefix
    expect(state.accountSuffix).toBe('abc123');
  });

  it('no ellipsis when account id is fewer than 6 characters', () => {
    const shortId = 'abc';
    const raw = authFile({ tokens: { access_token: jwt({ exp: EXP_SECONDS }), account_id: shortId } });
    const state = inspectCodexAuth(raw);
    expect(state.kind).toBe('present');
    if (state.kind !== 'present') return;
    expect(state.accountSuffix).toBe('abc');
  });
});

describe('inspectCodexAuth — states the relay would reject', () => {
  it('non-JSON input', () => {
    const state = inspectCodexAuth('not json at all');
    expect(state).toEqual({ kind: 'unreadable', reason: 'not valid JSON' });
  });

  it('truncated JSON', () => {
    const state = inspectCodexAuth('{"tokens": {');
    expect(state).toEqual({ kind: 'unreadable', reason: 'not valid JSON' });
  });

  it('JSON null', () => {
    expect(inspectCodexAuth('null')).toEqual({ kind: 'unreadable', reason: 'unexpected shape' });
  });

  it('JSON array', () => {
    expect(inspectCodexAuth('[]')).toEqual({ kind: 'unreadable', reason: 'unexpected shape' });
  });

  it('missing tokens object', () => {
    expect(inspectCodexAuth('{"auth_mode":"chatgpt"}')).toEqual({
      kind: 'unreadable',
      reason: 'unexpected shape',
    });
  });

  it('tokens is an array', () => {
    expect(inspectCodexAuth('{"tokens":[]}')).toEqual({
      kind: 'unreadable',
      reason: 'unexpected shape',
    });
  });

  it('missing access token', () => {
    expect(inspectCodexAuth('{"tokens":{"account_id":"abc"}}')).toEqual({
      kind: 'unreadable',
      reason: 'no access token',
    });
  });

  it('empty access token', () => {
    expect(inspectCodexAuth('{"tokens":{"access_token":"","account_id":"abc"}}')).toEqual({
      kind: 'unreadable',
      reason: 'no access token',
    });
  });

  it('no account id in field or token claim', () => {
    const raw = authFile({ tokens: { access_token: jwt({ exp: EXP_SECONDS }) } });
    expect(inspectCodexAuth(raw)).toEqual({ kind: 'unreadable', reason: 'no account id' });
  });

  it('empty account_id falls through to the claim, then fails', () => {
    const raw = authFile({ tokens: { access_token: jwt({ exp: EXP_SECONDS }), account_id: '' } });
    expect(inspectCodexAuth(raw)).toEqual({ kind: 'unreadable', reason: 'no account id' });
  });
});
