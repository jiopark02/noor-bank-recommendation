/**
 * toLogSafeError — what a log line that routes an external error object through
 * this helper prints in place of the object. It covers the lines that call it,
 * and only those; a line that logs an error whole is not protected by this file.
 *
 * WHY THIS EXISTS
 * `console.error("...", error)` writes every field the error carries. For the
 * SDKs this app talks to, those fields are not under our control:
 * - PostgREST returns `error` as a plain object whose `details` names the
 *   offending row. A unique violation on users.email logs
 *   `Key (email)=(<address>) already exists.` — the address, verbatim.
 * - supabase-js Auth errors can carry `originalError`: auth-js throws an
 *   AuthUnknownError holding the underlying error when an error response body
 *   is not JSON (@supabase/auth-js lib/fetch.js, handleError).
 * - Resend returns whatever its server sent back, parsed.
 * The goal is not to stop logging failures. The diagnostic fields — code,
 * status, kind — must survive. It is to stop logging everything else.
 *
 * WHAT SURVIVES
 * A strict allow-list: `code`, `message`, `status` (or Resend's `statusCode`,
 * reported as `status`) and `name`, each only when it has the expected value
 * type. Nothing else is read — not `details`, `hint`, `stack`, `cause`,
 * `originalError`, or any key an SDK adds later. A value that is not an object
 * is described by its type alone; a thrown string's content is dropped, since
 * nothing vouches for what it holds.
 *
 * WHAT IS DONE TO EVERY STRING IT RETURNS, in this order:
 * 0. The input is first cut to 2000 UTF-16 code units, at a token boundary: if
 *    the cut lands inside a run of non-delimiter characters, the whole run is
 *    dropped. The pre-cut ends on a token boundary, so it cannot leave a
 *    fragment of an address behind — however much masking later shrinks the
 *    text in front of it. (A plain cut could: once a long address before it
 *    collapses to "[email]", a half-address past position 2000 slides inside
 *    the final 500.) The cut exists because the address pattern backtracks
 *    quadratically on a long run with no "@"; a 40,000-character run took
 *    seconds. A run cannot hold a surrogate pair's halves apart, since neither
 *    half is a delimiter, so the pre-cut never splits a pair either. When
 *    dropping the run leaves nothing, the value becomes "[omitted]"; a value
 *    that was empty to begin with stays "".
 * 1. Anything shaped like an email address becomes "[email]". The pattern
 *    over-matches on purpose — `user@localhost`, `pkg@1.2.3` and the `p@host`
 *    of a connection string are replaced too — because `message` is allowed
 *    through and its text comes from someone else's server. Known miss: a
 *    quoted local part (`"a b"@x.com`).
 * 2. Control characters, line and paragraph separators, and the bidi and
 *    zero-width format characters each become one space. That guarantees no
 *    field value contains a line break or reorders on screen — and nothing
 *    more about layout: console prints an object argument through
 *    util.inspect, which may itself spread the object over several lines.
 * 3. The result is capped at 500 UTF-16 code units, never ending on the high
 *    half of a surrogate pair.
 * Masking runs before the cap so an address straddling the cut cannot survive
 * as a fragment.
 *
 * NEVER THROWS. Every caller is a log line inside a failure path; a throw here
 * would replace the failure being reported. Each field is read on its own, so
 * one throwing getter costs only that field; an object that cannot be inspected
 * at all (a revoked Proxy) is reported as `unreadable`.
 *
 * ⚠️ WHAT THIS DOES NOT DO
 * It masks addresses, not secrets. A message that quotes a credential keeps it
 * — which is why sendEmail never passes a client-construction error's message
 * through here, only its name.
 */

export type LogSafeError = {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
  /** Set only when the input was not a plain object. */
  value_type?: string;
};

const MAX_LENGTH = 500;

/** Applied before masking; see step 0 in the header. Must exceed MAX_LENGTH. */
const PRE_CAP = 2000;

/** Stands in for a value whose only token was longer than PRE_CAP. */
const OMITTED = "[omitted]";

/** The characters EMAIL_PATTERN treats as ending an address. */
const DELIMITER = /[\s"'<>()[\]{}\\,;:]/;

/** Non-delimiter runs on both sides of an "@". Deliberately loose. */
const EMAIL_PATTERN = /[^\s"'<>()[\]{}\\,;:]+@[^\s"'<>()[\]{}\\,;:]+/g;

/**
 * C0, DEL and C1; ARABIC LETTER MARK; ZWSP, ZWNJ, ZWJ, LRM, RLM; LINE and
 * PARAGRAPH SEPARATOR and the bidi embeddings and overrides; WJ and the
 * invisible operators; the bidi isolates; BOM. Escapes only — none of these may
 * appear literally in source. U+2065 is unassigned and left out.
 */
const CONTROL_PATTERN =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isDelimiter(ch: string): boolean {
  return DELIMITER.test(ch);
}

/** Cut to PRE_CAP at a token boundary. Linear: one backward walk at most. */
function preCut(value: string): string {
  if (value.length <= PRE_CAP) {
    return value;
  }
  let end = PRE_CAP;
  if (!isDelimiter(value.charAt(PRE_CAP))) {
    while (end > 0 && !isDelimiter(value.charAt(end - 1))) {
      end--;
    }
  }
  const kept = value.slice(0, end);
  return kept === "" ? OMITTED : kept;
}

function normalize(value: string): string {
  const masked = preCut(value).replace(EMAIL_PATTERN, "[email]");
  const flattened = masked.replace(CONTROL_PATTERN, " ");
  if (flattened.length <= MAX_LENGTH) {
    return flattened;
  }
  const end = isHighSurrogate(flattened.charCodeAt(MAX_LENGTH - 1))
    ? MAX_LENGTH - 1
    : MAX_LENGTH;
  return flattened.slice(0, end);
}

/** One property, or undefined if reading it throws. */
function readField(source: Record<string, unknown>, key: string): unknown {
  try {
    return source[key];
  } catch {
    return undefined;
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function toLogSafeError(error: unknown): LogSafeError {
  try {
    // Array.isArray throws on a revoked Proxy, which lands in the catch below.
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return { value_type: describeType(error) };
    }
    const source = error as Record<string, unknown>;
    const result: LogSafeError = {};

    const code = readField(source, "code");
    if (typeof code === "string") {
      const normalizedCode = normalize(code);
      if (normalizedCode !== "") result.code = normalizedCode;
    }

    const message = readField(source, "message");
    if (typeof message === "string") {
      result.message = normalize(message);
    }

    const status = readField(source, "status");
    const statusCode = readField(source, "statusCode");
    if (typeof status === "number") {
      result.status = status;
    } else if (typeof statusCode === "number") {
      result.status = statusCode;
    }

    const name = readField(source, "name");
    if (typeof name === "string") {
      result.name = normalize(name);
    }

    return result;
  } catch {
    return { value_type: "unreadable" };
  }
}
