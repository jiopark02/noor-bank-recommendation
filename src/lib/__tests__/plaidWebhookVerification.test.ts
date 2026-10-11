import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  classifyKeyFetchError,
  createKeyCache,
  verifyPlaidWebhook,
  type KeyFetchResult,
  type PlaidVerificationKey,
  type VerificationDeps,
} from "../plaidWebhookVerification";

/**
 * Plaid webhook signature verification, executed.
 *
 * Real ES256 keys from node:crypto, real signatures, an injected fetchKey and
 * clock. No network and no vi.mock. Each `it` names the change to
 * plaidWebhookVerification.ts that turns it red.
 */

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const KID = "6c5516e1-92dc-479e-a8ff-5a51992e0001";

function keyPair() {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}

const plaidPair = keyPair();
const otherPair = keyPair();

function jwkOf(publicKey: KeyObject, kid = KID): PlaidVerificationKey {
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return {
    alg: "ES256",
    crv: jwk.crv,
    kid,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
    expired_at: null,
  };
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function jwt(options: {
  body: Uint8Array;
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  privateKey?: KeyObject;
}): string {
  const header = options.header ?? { alg: "ES256", kid: KID, typ: "JWT" };
  const claims = options.claims ?? {
    iat: NOW_S,
    request_body_sha256: sha256Hex(options.body),
  };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: options.privateKey ?? plaidPair.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

const BODY = new Uint8Array(
  Buffer.from('{"webhook_type":"ITEM","webhook_code":"ERROR"}', "utf8")
);

/** A fetchKey that knows exactly the given keys and refuses every other kid. */
function deps(
  keys: Record<string, PlaidVerificationKey> = { [KID]: jwkOf(plaidPair.publicKey) },
  overrides: Partial<VerificationDeps> = {}
) {
  const fetchKey = vi.fn(
    async (kid: string): Promise<KeyFetchResult> =>
      keys[kid] ? { ok: true, key: keys[kid] } : { ok: false, kind: "rejected" }
  );
  const value: VerificationDeps = {
    fetchKey,
    now: () => NOW_MS,
    cache: createKeyCache(),
    ...overrides,
  };
  return { deps: value, fetchKey };
}

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed, fresh webhook whose body hash matches", async () => {
    // Red if: the module is removed, or any check below rejects valid input.
    const { deps: d } = deps();
    expect(await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d)).toEqual({
      ok: true,
    });
  });

  it("rejects a signature made with a different key", async () => {
    // Red if: the crypto verify result is ignored.
    const { deps: d } = deps();
    const header = jwt({ body: BODY, privateKey: otherPair.privateKey });
    expect(await verifyPlaidWebhook(BODY, header, d)).toEqual({
      ok: false,
      status: 401,
      reason: "bad_signature",
    });
  });

  it("checks the signature before reading any claim", async () => {
    // Red if: the iat check is moved ahead of signature verification (the
    // reason would come back "stale").
    const { deps: d } = deps();
    const header = jwt({
      body: BODY,
      privateKey: otherPair.privateKey,
      claims: { iat: NOW_S - 10_000, request_body_sha256: sha256Hex(BODY) },
    });
    const result = await verifyPlaidWebhook(BODY, header, d);
    expect(result).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects a body changed by one byte", async () => {
    // Red if: the body hash comparison is removed.
    const { deps: d } = deps();
    const header = jwt({ body: BODY });
    const tampered = new Uint8Array(BODY);
    tampered[tampered.length - 2] ^= 0x01;
    expect(await verifyPlaidWebhook(tampered, header, d)).toEqual({
      ok: false,
      status: 401,
      reason: "body_hash_mismatch",
    });
  });

  it("rejects iat older than five minutes, accepts exactly five", async () => {
    // Red if: the iat check is removed (first) or tightened (second).
    const { deps: d } = deps();
    const stale = jwt({
      body: BODY,
      claims: { iat: NOW_S - 301, request_body_sha256: sha256Hex(BODY) },
    });
    expect(await verifyPlaidWebhook(BODY, stale, d)).toEqual({
      ok: false,
      status: 401,
      reason: "stale",
    });
    const edge = jwt({
      body: BODY,
      claims: { iat: NOW_S - 300, request_body_sha256: sha256Hex(BODY) },
    });
    expect(await verifyPlaidWebhook(BODY, edge, d)).toEqual({ ok: true });
  });

  it("rejects iat more than five minutes in the future, accepts exactly five", async () => {
    // Red if: only the past side of the iat window is checked.
    const { deps: d } = deps();
    const future = jwt({
      body: BODY,
      claims: { iat: NOW_S + 301, request_body_sha256: sha256Hex(BODY) },
    });
    expect(await verifyPlaidWebhook(BODY, future, d)).toEqual({
      ok: false,
      status: 401,
      reason: "stale",
    });
    const edge = jwt({
      body: BODY,
      claims: { iat: NOW_S + 300, request_body_sha256: sha256Hex(BODY) },
    });
    expect(await verifyPlaidWebhook(BODY, edge, d)).toEqual({ ok: true });
  });

  it("rejects a non-numeric iat", async () => {
    // Red if: the typeof check on iat is removed.
    const { deps: d } = deps();
    const header = jwt({
      body: BODY,
      claims: { iat: String(NOW_S), request_body_sha256: sha256Hex(BODY) },
    });
    expect(await verifyPlaidWebhook(BODY, header, d)).toMatchObject({
      ok: false,
      reason: "stale",
    });
  });

  it("answers 401 unknown_key when Plaid refuses the kid", async () => {
    // Red if: a rejected fetch is mapped to 503.
    const { deps: d } = deps({});
    expect(await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d)).toEqual({
      ok: false,
      status: 401,
      reason: "unknown_key",
    });
  });

  it("answers 503 when the key fetch is unavailable, or throws", async () => {
    // Red if: the unavailable branch is removed (it would fall into 401), or a
    // throwing fetchKey escapes as an exception.
    const unavailable = deps({}, {
      fetchKey: async () => ({ ok: false, kind: "unavailable" }),
    });
    expect(
      await verifyPlaidWebhook(BODY, jwt({ body: BODY }), unavailable.deps)
    ).toEqual({ ok: false, status: 503, reason: "key_unavailable" });

    const throwing = deps({}, {
      fetchKey: async () => {
        throw new Error("network");
      },
    });
    expect(
      await verifyPlaidWebhook(BODY, jwt({ body: BODY }), throwing.deps)
    ).toEqual({ ok: false, status: 503, reason: "key_unavailable" });
  });

  it("rejects any alg but ES256 without fetching a key", async () => {
    // Red if: the alg check is removed (the fetch would happen).
    const { deps: d, fetchKey } = deps();
    for (const alg of ["HS256", "none", "ES384", "es256"]) {
      const header = jwt({ body: BODY, header: { alg, kid: KID } });
      expect(await verifyPlaidWebhook(BODY, header, d)).toEqual({
        ok: false,
        status: 401,
        reason: "bad_alg",
      });
    }
    expect(fetchKey).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty header", async () => {
    const { deps: d, fetchKey } = deps();
    expect(await verifyPlaidWebhook(BODY, null, d)).toMatchObject({
      status: 401,
      reason: "missing_header",
    });
    expect(await verifyPlaidWebhook(BODY, "", d)).toMatchObject({
      status: 401,
      reason: "missing_header",
    });
    expect(fetchKey).not.toHaveBeenCalled();
  });

  it("rejects a header that is not three base64url segments", async () => {
    const { deps: d } = deps();
    for (const header of ["a.b", "a.b.c.d", "a..c", "a.b.c=", "a+b.c.d"]) {
      expect(await verifyPlaidWebhook(BODY, header, d)).toMatchObject({
        status: 401,
        reason: "malformed",
      });
    }
  });

  it("rejects a kid outside the allowed shape without fetching", async () => {
    // Red if: the kid shape check is removed (the fetch would happen).
    const { deps: d, fetchKey } = deps();
    for (const kid of ["", "a".repeat(65), "../x", "a b", 7]) {
      const header = jwt({ body: BODY, header: { alg: "ES256", kid } });
      expect(await verifyPlaidWebhook(BODY, header, d)).toMatchObject({
        status: 401,
        reason: "bad_kid",
      });
    }
    expect(fetchKey).not.toHaveBeenCalled();
  });

  it("rejects a key whose expired_at has passed", async () => {
    // Red if: the expiry check is removed.
    const expired = { ...jwkOf(plaidPair.publicKey), expired_at: NOW_S - 1 };
    const { deps: d } = deps({ [KID]: expired });
    expect(await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d)).toEqual({
      ok: false,
      status: 401,
      reason: "key_expired",
    });
  });

  it("rejects a key that is not EC P-256", async () => {
    // Red if: the kty/crv check is removed.
    const wrongCurve = { ...jwkOf(plaidPair.publicKey), crv: "P-384" };
    const { deps: d } = deps({ [KID]: wrongCurve });
    expect(await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d)).toMatchObject({
      status: 401,
      reason: "bad_key",
    });
  });
});

describe("key cache", () => {
  it("fetches a known kid once across two webhooks", async () => {
    // Red if: the positive cache is removed.
    const { deps: d, fetchKey } = deps();
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    expect(fetchKey).toHaveBeenCalledTimes(1);
  });

  it("re-fetches a known kid after an hour", async () => {
    // Red if: the positive TTL is removed.
    let now = NOW_MS;
    const { deps: d, fetchKey } = deps(undefined, { now: () => now });
    const fresh = () =>
      jwt({
        body: BODY,
        claims: { iat: now / 1000, request_body_sha256: sha256Hex(BODY) },
      });
    await verifyPlaidWebhook(BODY, fresh(), d);
    now += 60 * 60 * 1000;
    await verifyPlaidWebhook(BODY, fresh(), d);
    expect(fetchKey).toHaveBeenCalledTimes(2);
  });

  it("asks Plaid about a refused kid once in five minutes", async () => {
    // Red if: the negative cache is removed.
    let now = NOW_MS;
    const { deps: d, fetchKey } = deps({}, { now: () => now });
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    expect(fetchKey).toHaveBeenCalledTimes(1);
    now += 5 * 60 * 1000;
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    expect(fetchKey).toHaveBeenCalledTimes(2);
  });

  it("does not cache an unavailable fetch", async () => {
    // Red if: unavailable results are cached negatively.
    const fetchKey = vi.fn(
      async (): Promise<KeyFetchResult> => ({ ok: false, kind: "unavailable" })
    );
    const d: VerificationDeps = {
      fetchKey,
      now: () => NOW_MS,
      cache: createKeyCache(),
    };
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d);
    expect(fetchKey).toHaveBeenCalledTimes(2);
  });

  it("answers the 11th distinct kid in a minute with 503 and no fetch", async () => {
    // Red if: the fetch-rate bound is removed (fetchKey would be called 11
    // times and the 11th answer would be 401 unknown_key).
    let now = NOW_MS;
    const { deps: d, fetchKey } = deps({}, { now: () => now });
    const results = [];
    for (let i = 0; i < 11; i++) {
      now += 1000;
      const header = jwt({
        body: BODY,
        header: { alg: "ES256", kid: `kid-${i}` },
      });
      results.push(await verifyPlaidWebhook(BODY, header, d));
    }
    expect(fetchKey).toHaveBeenCalledTimes(10);
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toMatchObject({ status: 401, reason: "unknown_key" });
    }
    expect(results[10]).toEqual({
      ok: false,
      status: 503,
      reason: "key_fetch_limited",
    });
  });

  it("lets fetches through again once the window has rolled", async () => {
    // Red if: the window never expires old fetch timestamps.
    let now = NOW_MS;
    const { deps: d, fetchKey } = deps({}, { now: () => now });
    for (let i = 0; i < 10; i++) {
      await verifyPlaidWebhook(
        BODY,
        jwt({ body: BODY, header: { alg: "ES256", kid: `kid-${i}` } }),
        d
      );
    }
    now += 60 * 1000;
    const result = await verifyPlaidWebhook(
      BODY,
      jwt({ body: BODY, header: { alg: "ES256", kid: "kid-late" } }),
      d
    );
    expect(result).toMatchObject({ status: 401, reason: "unknown_key" });
    expect(fetchKey).toHaveBeenCalledTimes(11);
  });

  it("still serves cached and negatively cached kids past the rate bound", async () => {
    // Red if: the rate check is moved ahead of the cache lookups.
    let now = NOW_MS;
    const { deps: d, fetchKey } = deps(undefined, { now: () => now });
    await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d); // caches KID
    for (let i = 0; i < 9; i++) {
      await verifyPlaidWebhook(
        BODY,
        jwt({ body: BODY, header: { alg: "ES256", kid: `kid-${i}` } }),
        d
      );
    }
    expect(fetchKey).toHaveBeenCalledTimes(10);
    expect(await verifyPlaidWebhook(BODY, jwt({ body: BODY }), d)).toEqual({
      ok: true,
    });
    expect(
      await verifyPlaidWebhook(
        BODY,
        jwt({ body: BODY, header: { alg: "ES256", kid: "kid-0" } }),
        d
      )
    ).toMatchObject({ status: 401, reason: "unknown_key" });
    expect(fetchKey).toHaveBeenCalledTimes(10);
  });
});

describe("classifyKeyFetchError", () => {
  const plaidError = (status: number | undefined, code?: string) => ({
    response: status === undefined ? undefined : { status, data: { error_code: code } },
  });

  it("treats a plain 4xx as Plaid's verdict on the kid", () => {
    // Red if: 4xx is mapped to unavailable.
    expect(classifyKeyFetchError(plaidError(400, "INVALID_INPUT"))).toBe("rejected");
    expect(classifyKeyFetchError(plaidError(404))).toBe("rejected");
  });

  it("treats 5xx, transport, 408, 429 and refused credentials as unavailable", () => {
    // Red if: any of these is mapped to rejected (Plaid would drop the webhook).
    expect(classifyKeyFetchError(plaidError(500))).toBe("unavailable");
    expect(classifyKeyFetchError(plaidError(undefined))).toBe("unavailable");
    expect(classifyKeyFetchError(new Error("ECONNRESET"))).toBe("unavailable");
    expect(classifyKeyFetchError(plaidError(408))).toBe("unavailable");
    expect(classifyKeyFetchError(plaidError(429))).toBe("unavailable");
    expect(classifyKeyFetchError(plaidError(400, "INVALID_API_KEYS"))).toBe(
      "unavailable"
    );
  });
});
