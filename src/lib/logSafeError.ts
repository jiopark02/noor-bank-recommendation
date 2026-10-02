/**
 * toLogSafeError — the only shape an external error object may take on its way
 * into a server log line.
 *
 * WHY THIS EXISTS
 * `console.error("...", error)` writes every field the error carries. For the
 * SDKs this app talks to, those fields are not under our control:
 * - PostgREST returns `error` as a plain object whose `details` names the
 *   offending row. A unique violation on users.email logs
 *   `Key (email)=(<address>) already exists.` — the address, verbatim.
 * - supabase-js Auth errors may carry `originalError`.
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
 * 1. Anything shaped like an email address becomes "[email]". The pattern
 *    over-matches on purpose — `user@localhost`, `pkg@1.2.3` and the `p@host`
 *    of a connection string are replaced too — because `message` is allowed
 *    through and its text comes from someone else's server. Known miss: a
 *    quoted local part (`"a b"@x.com`).
 * 2. Control characters, line and paragraph separators, and the bidi and
 *    zero-width format characters each become one space. A log line must stay
 *    one line, and must read the way it is stored.
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

function normalize(value: string): string {
  const masked = value.replace(EMAIL_PATTERN, "[email]");
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
