import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  MAX_WEBHOOK_BODY_BYTES,
  readBoundedBody,
  receivePlaidWebhook,
  type ReceiveDeps,
  type ReceiveInput,
} from "../plaidWebhookReceive";
import {
  createKeyCache,
  verifyPlaidWebhook,
  type KeyFetchResult,
} from "../plaidWebhookVerification";
import type { WebhookDecision } from "../plaidWebhook";

/**
 * The request pipeline, executed: size cap, then verification, then parsing,
 * then the decision, with fixed response bodies. Verification is the REAL
 * verifyPlaidWebhook over a real key, with fetchKey and the verify call itself
 * counted — hashing and every Plaid call happen only inside verify, so "verify
 * was not called" is the evidence that neither happened.
 */

const NOW_MS = 1_800_000_000_000;
const KID = "kid-1";
const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = pair.publicKey.export({ format: "jwk" }) as Record<string, string>;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedHeader(body: Uint8Array): string {
  const input = `${b64url({ alg: "ES256", kid: KID })}.${b64url({
    iat: NOW_MS / 1000,
    request_body_sha256: createHash("sha256").update(body).digest("hex"),
  })}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: pair.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

/** A stream that yields the given chunks, recording whether it was cancelled. */
function streamOf(chunks: Uint8Array[]) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled < chunks.length) {
        controller.enqueue(chunks[state.pulled++]);
      } else {
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

function harness(decision: WebhookDecision = { status: 200, outcome: "logged" }) {
  const fetchKey = vi.fn(
    async (): Promise<KeyFetchResult> => ({
      ok: true,
      key: { alg: "ES256", crv: jwk.crv, kid: KID, kty: jwk.kty, x: jwk.x, y: jwk.y, expired_at: null },
    })
  );
  const cache = createKeyCache();
  const verify = vi.fn((raw: Uint8Array, header: string | null) =>
    verifyPlaidWebhook(raw, header, { fetchKey, now: () => NOW_MS, cache })
  );
  const handle = vi.fn(async (_payload: unknown) => decision);
  const lines: string[] = [];
  const deps: ReceiveDeps = {
    isPlaidConfigured: () => true,
    verify,
    handle,
    log: (line) => lines.push(line),
  };
  return { deps, fetchKey, verify, handle, lines };
}

function input(body: Uint8Array | null, header: string | null, contentLength: string | null = null): ReceiveInput {
  return {
    body: body === null ? null : streamOf([body]).stream,
    contentLength,
    verificationHeader: header,
  };
}

const PAYLOAD = '{"webhook_type":"ITEM","webhook_code":"ERROR","environment":"sandbox"}';

describe("receivePlaidWebhook — body size cap", () => {
  it("answers 413 for 64 KB + 1 byte with no verification, hashing or Plaid call", async () => {
    // Red if: the reader's cap is removed (verify would run and answer 401
    // body_hash_mismatch or 200).
    const h = harness();
    const oversized = new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1).fill(0x20);
    // No Content-Length: the bounded reader alone must refuse it, and the
    // signature over this exact body is valid, so nothing else would.
    const result = await receivePlaidWebhook(
      input(oversized, signedHeader(oversized)),
      h.deps
    );
    expect(result).toEqual({ status: 413, body: { error: "Payload too large" } });
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.fetchKey).not.toHaveBeenCalled();
    expect(h.handle).not.toHaveBeenCalled();
    expect(h.lines).toEqual(["[plaid-webhook] rejected reason=body_too_large status=413"]);
  });

  it("refuses an oversized body sent in chunks under a smaller Content-Length", async () => {
    // Red if: the reader trusts the declared length instead of counting bytes.
    const h = harness();
    const chunk = new Uint8Array(40 * 1024).fill(0x20);
    const { stream, state } = streamOf([chunk, chunk, chunk]);
    const result = await receivePlaidWebhook(
      { body: stream, contentLength: "10", verificationHeader: "x" },
      h.deps
    );
    expect(result.status).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("refuses a declared Content-Length over the cap without reading", async () => {
    const h = harness();
    const { stream } = streamOf([bytes(PAYLOAD)]);
    const result = await receivePlaidWebhook(
      { body: stream, contentLength: String(MAX_WEBHOOK_BODY_BYTES + 1), verificationHeader: "x" },
      h.deps
    );
    expect(result.status).toBe(413);
    // No reader was ever taken. (`pulled` cannot show this: a ReadableStream
    // pulls its first chunk at construction.)
    expect(stream.locked).toBe(false);
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("accepts a body of exactly 64 KB", async () => {
    // Red if: the cap is off by one in the other direction.
    const h = harness();
    const body = new Uint8Array(MAX_WEBHOOK_BODY_BYTES).fill(0x20);
    body.set(bytes(PAYLOAD), 0);
    const result = await receivePlaidWebhook(input(body, signedHeader(body)), h.deps);
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(h.verify).toHaveBeenCalledTimes(1);
  });
});

describe("receivePlaidWebhook — order and responses", () => {
  it("hands a verified, parsed payload to the decision", async () => {
    const h = harness();
    const body = bytes(PAYLOAD);
    const result = await receivePlaidWebhook(input(body, signedHeader(body)), h.deps);
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(h.handle).toHaveBeenCalledWith(JSON.parse(PAYLOAD));
  });

  it("never reaches the decision when verification fails", async () => {
    // Red if: handle is called before or regardless of verify's verdict.
    const h = harness();
    const body = bytes(PAYLOAD);
    const other = bytes(PAYLOAD.replace("ERROR", "LOGIN_REPAIRED"));
    const result = await receivePlaidWebhook(input(body, signedHeader(other)), h.deps);
    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(h.handle).not.toHaveBeenCalled();
    expect(h.lines).toEqual([
      "[plaid-webhook] rejected reason=body_hash_mismatch status=401",
    ]);
  });

  it("answers 503 without reading or verifying when Plaid is not configured", async () => {
    const h = harness();
    h.deps.isPlaidConfigured = () => false;
    const body = bytes(PAYLOAD);
    const result = await receivePlaidWebhook(input(body, signedHeader(body)), h.deps);
    expect(result).toEqual({ status: 503, body: { error: "Service unavailable" } });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("answers 200 for a verified body that is not JSON", async () => {
    const h = harness();
    const body = bytes("not json");
    const result = await receivePlaidWebhook(input(body, signedHeader(body)), h.deps);
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("returns the decision's status with a fixed body", async () => {
    for (const [status, error] of [
      [500, "Internal error"],
      [503, "Service unavailable"],
    ] as const) {
      const h = harness({ status, outcome: "lookup_failed" });
      const body = bytes(PAYLOAD);
      const result = await receivePlaidWebhook(input(body, signedHeader(body)), h.deps);
      expect(result).toEqual({ status, body: { error } });
    }
  });

  it("answers 500 when something throws", async () => {
    const h = harness();
    h.deps.handle = async () => {
      throw new Error("boom https://x.test/?secret=1");
    };
    const body = bytes(PAYLOAD);
    const result = await receivePlaidWebhook(input(body, signedHeader(body)), h.deps);
    expect(result).toEqual({ status: 500, body: { error: "Internal error" } });
    expect(h.lines.join("\n")).not.toContain("secret");
  });

  it("never echoes the reason or any request content in a response body", async () => {
    // Red if: a response body includes the reason or a payload field.
    const cases: Array<[Uint8Array | null, string | null]> = [
      [bytes(PAYLOAD), null],
      [bytes(PAYLOAD), "a.b.c"],
      [bytes(PAYLOAD), signedHeader(bytes("other"))],
    ];
    for (const [body, header] of cases) {
      const h = harness();
      const result = await receivePlaidWebhook(input(body, header), h.deps);
      expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    }
  });
});

describe("readBoundedBody", () => {
  it("reassembles chunks byte for byte", async () => {
    const { stream } = streamOf([bytes("ab"), bytes("c"), bytes("def")]);
    const result = await readBoundedBody(stream, 6);
    expect(result.ok && Buffer.from(result.bytes).toString()).toBe("abcdef");
  });

  it("treats a missing body as empty", async () => {
    const result = await readBoundedBody(null, 10);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });

  it("reports a stream error as read_failed", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("aborted"));
      },
    });
    expect(await readBoundedBody(stream, 10)).toEqual({ ok: false, reason: "read_failed" });
  });
});
