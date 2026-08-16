/**
 * Codex credential-file inspection for `devflow proxy --status`.
 *
 * applies ADR-013: pure core-layer module — no Claude Code adapter concerns and
 *   no presentation (colour/format lives with the other CLI formatters).
 *
 * WHY THIS EXISTS RATHER THAN IMPORTING THE ROUTING RUNTIME
 * The routing runtime validates this same file and exposes an equivalent
 * inspector, but it ships no package `exports` map and no `main`, so the only
 * way to reach it is a deep path into its build output. That would pin us to an
 * internal layout across an exact-pinned dependency bump. The subset below is
 * small enough to re-derive, so we own it.
 *
 * WHAT AN EXPIRED ACCESS TOKEN MEANS: nothing actionable. The relay refreshes
 * proactively inside a two-minute margin and reactively on a 401, using the
 * refresh token in this same file. Expiry is therefore reported as information,
 * never as a warning — warning on it would fire on a perfectly healthy install.
 * The genuinely actionable states are `absent` and `unreadable`: the relay
 * rejects a malformed file outright, so every request 401s while a naive
 * existence check still reports "present".
 *
 * SECURITY: the JWT payload is decoded for display only — never signature-checked
 * and never trusted for an authorisation decision. No token material is returned
 * from this module; the account id is truncated to a short suffix so status output
 * cannot leak a full identifier into a terminal, screenshot, or bug report.
 */

/** What `devflow proxy --status` can truthfully say about the Codex credential file. */
export type CodexAuthState =
  | { kind: 'absent' }
  | { kind: 'unreadable'; reason: string }
  | {
      kind: 'present';
      /** `chatgpt`, `apikey`, or `unknown` when the file omits it. */
      authMode: string;
      /**
       * Trailing up-to-6 characters of the account id.
       * Prefixed with '…' only when the id was longer than 6 characters (i.e. characters
       * were actually elided). For ids of 6 characters or fewer the value is returned
       * as-is without a prefix — an ellipsis on a non-truncated id would falsely imply
       * more characters were hidden.
       */
      accountSuffix: string;
      /** Access-token expiry, or undefined when the token carries no decodable `exp`. */
      expiresAt: Date | undefined;
    };

/** Number of trailing account-id characters kept for display. */
const ACCOUNT_SUFFIX_LENGTH = 6;

/**
 * Decode a JWT payload without verifying its signature.
 *
 * Display-only (see module header). Returns undefined for anything that is not a
 * three-part token with a base64url-encoded JSON object payload.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined || payload === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Extract the `exp` claim as a Date. Undefined when absent or non-numeric. */
function jwtExpiry(token: string): Date | undefined {
  const exp = decodeJwtPayload(token)?.['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000) : undefined;
}

/** Extract the ChatGPT account id from the OpenAI auth claim. Undefined when absent. */
function jwtAccountId(token: string): string | undefined {
  const claim = decodeJwtPayload(token)?.['https://api.openai.com/auth'];
  if (typeof claim !== 'object' || claim === null || Array.isArray(claim)) return undefined;
  const accountId = (claim as Record<string, unknown>)['chatgpt_account_id'];
  return typeof accountId === 'string' && accountId !== '' ? accountId : undefined;
}

/**
 * Inspect the raw contents of `~/.codex/auth.json`.
 *
 * Every failure mode the relay would reject at request time is surfaced here as
 * `unreadable` with a reason, so status reports the same verdict the relay would
 * reach rather than merely confirming the file exists.
 *
 * @param raw  File contents. Pass the string; callers own the I/O and the
 *             `absent` case (an unreadable path is not the same as a bad file).
 */
export function inspectCodexAuth(raw: string): CodexAuthState {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'unreadable', reason: 'not valid JSON' };
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { kind: 'unreadable', reason: 'unexpected shape' };
  }

  const tokens = (json as Record<string, unknown>)['tokens'];
  if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
    return { kind: 'unreadable', reason: 'unexpected shape' };
  }

  const accessToken = (tokens as Record<string, unknown>)['access_token'];
  if (typeof accessToken !== 'string' || accessToken === '') {
    return { kind: 'unreadable', reason: 'no access token' };
  }

  // Mirrors the relay's resolution order: the explicit field wins, the token claim
  // is the fallback. Neither present is a hard failure there, so it is one here too.
  const storedAccountId = (tokens as Record<string, unknown>)['account_id'];
  const accountId =
    typeof storedAccountId === 'string' && storedAccountId !== ''
      ? storedAccountId
      : jwtAccountId(accessToken);
  if (accountId === undefined) {
    return { kind: 'unreadable', reason: 'no account id' };
  }

  const rawAuthMode = (json as Record<string, unknown>)['auth_mode'];
  const authMode = typeof rawAuthMode === 'string' && rawAuthMode !== '' ? rawAuthMode : 'unknown';

  return {
    kind: 'present',
    authMode,
    accountSuffix:
      accountId.length > ACCOUNT_SUFFIX_LENGTH
        ? `…${accountId.slice(-ACCOUNT_SUFFIX_LENGTH)}`
        : accountId,
    expiresAt: jwtExpiry(accessToken),
  };
}
