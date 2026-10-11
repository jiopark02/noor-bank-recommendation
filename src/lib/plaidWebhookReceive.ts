import type { VerificationResult } from "./plaidWebhookVerification";
import type { WebhookDecision } from "./plaidWebhook";

/**
 * One webhook request, from raw stream to response — in this order:
 *
 *   1. Plaid configured?               no  -> 503
 *   2. Body read, capped at 64 KB      over -> 413, before any hashing or parsing
 *   3. Signature verified              no  -> 401 / 503 (verifyPlaidWebhook)
 *   4. Body parsed as JSON             no  -> 200 (a retry carries the same body)
 *   5. Decision                            -> handlePlaidWebhook's status
 *
 * Nothing is parsed or acted on before step 3 passes. Hashing and every Plaid
 * call happen inside `verify`, so a request refused at steps 1–2 has caused
 * neither.
 *
 * RESPONSE BODIES ARE FIXED PER STATUS. They never carry the rejection reason,
 * the URL, a query parameter or a payload field — the reason goes to the log
 * line only. Plaid reads the status; nothing reads the body.
 */

export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export type ReceiveStatus = 200 | 400 | 401 | 413 | 500 | 503;

export type ReceiveResult = {
  status: ReceiveStatus;
  body: { received: true } | { error: string };
};

export type ReceiveInput = {
  body: ReadableStream<Uint8Array> | null;
  contentLength: string | null;
  verificationHeader: string | null;
};

export type ReceiveDeps = {
  isPlaidConfigured: () => boolean;
  verify: (rawBody: Uint8Array, header: string | null) => Promise<VerificationResult>;
  handle: (payload: unknown) => Promise<WebhookDecision>;
  log: (line: string) => void;
};

const ERROR_BODIES: Record<Exclude<ReceiveStatus, 200>, string> = {
  400: "Bad request",
  401: "Unauthorized",
  413: "Payload too large",
  500: "Internal error",
  503: "Service unavailable",
};

function respond(status: ReceiveStatus): ReceiveResult {
  if (status === 200) return { status, body: { received: true } };
  return { status, body: { error: ERROR_BODIES[status] } };
}

export type BoundedRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too_large" | "read_failed" };

/**
 * Reads a stream into memory, stopping as soon as it passes `limit` bytes.
 *
 * Content-Length is not trusted for this: it can be absent, or smaller than
 * what is actually sent. The count is of bytes received.
 */
export async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<BoundedRead> {
  if (!stream) return { ok: true, bytes: new Uint8Array(0) };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_failed" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    bytes.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  return { ok: true, bytes };
}

export async function receivePlaidWebhook(
  input: ReceiveInput,
  deps: ReceiveDeps
): Promise<ReceiveResult> {
  const reject = (status: ReceiveStatus, reason: string): ReceiveResult => {
    deps.log(`[plaid-webhook] rejected reason=${reason} status=${status}`);
    return respond(status);
  };

  try {
    if (!deps.isPlaidConfigured()) {
      return reject(503, "plaid_unconfigured");
    }

    // A declared length over the cap is refused without reading. A smaller or
    // missing one proves nothing; the reader below enforces the cap either way.
    const declared = input.contentLength === null ? NaN : Number(input.contentLength);
    if (isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
      return reject(413, "body_too_large");
    }

    const read = await readBoundedBody(input.body, MAX_WEBHOOK_BODY_BYTES);
    if (!read.ok) {
      return read.reason === "too_large"
        ? reject(413, "body_too_large")
        : reject(400, "body_unreadable");
    }

    const verification = await deps.verify(read.bytes, input.verificationHeader);
    if (!verification.ok) {
      return reject(verification.status, verification.reason);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(read.bytes).toString("utf8"));
    } catch {
      // Verified but unparseable: retrying delivers the same bytes.
      deps.log("[plaid-webhook] outcome=malformed reason=json");
      return respond(200);
    }

    const decision = await deps.handle(payload);
    return respond(decision.status);
  } catch {
    // Unexpected. Retried by Plaid; the operation is idempotent.
    deps.log("[plaid-webhook] rejected reason=unexpected status=500");
    return respond(500);
  }
}
