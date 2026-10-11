import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { plaidClient } from "./plaid";
import {
  getPlaidErrorCode,
  getPlaidErrorStatus,
} from "./plaidErrorRedaction";
import { logField } from "./plaidRevocation";

/**
 * Plaid webhook signature verification.
 *
 * WHY THIS IS THE ONLY GATE
 * /api/plaid/webhook carries no Supabase session — Plaid is the caller, not a
 * user — and middleware excludes /api/ anyway. The `Plaid-Verification` JWT is
 * therefore the whole authentication of that route. Everything a webhook can
 * cause, including revoking a user's Item, sits behind verifyPlaidWebhook below.
 *
 * THE PROCEDURE (https://plaid.com/docs/api/webhooks/webhook-verification/)
 *   1. Decode the JWT header WITHOUT trusting it; refuse any alg but ES256.
 *   2. Fetch the verification key named by `kid` from Plaid.
 *   3. Verify the ES256 signature with that key.
 *   4. Refuse a payload whose `iat` is older than five minutes.
 *   5. Compare the payload's `request_body_sha256` against the SHA-256 of the
 *      RAW body bytes, in constant time. Never a re-serialization: the hash is
 *      whitespace-sensitive.
 *
 * Implemented on node:crypto rather than a JWT library, so no dependency is
 * added. The places a hand-rolled verifier usually goes wrong are pinned and
 * each has an executed test in plaidWebhookVerification.test.ts: the alg is
 * compared to one literal, the key must be an EC P-256 JWK, and nothing in the
 * payload is read before the signature has verified.
 *
 * AMPLIFICATION
 * An unauthenticated request can name any `kid`, and an unknown one makes us
 * call Plaid. Three bounds keep a forged-request flood from becoming a Plaid
 * call flood: the `kid` shape check, a negative cache for kids Plaid refused,
 * and a hard cap on key fetches per instance per rolling minute. Past the cap
 * the answer is 503 without calling Plaid — Plaid retries a 503, so a genuine
 * webhook caught behind a flood is delayed, not lost.
 */

/** The verification key as Plaid returns it (a JWK plus its lifetime). */
export type PlaidVerificationKey = {
  alg: string;
  crv: string;
  kid: string;
  kty: string;
  x: string;
  y: string;
  /** Unix seconds, or null while the key is current. */
  expired_at: number | null;
};

/**
 * What one key fetch produced.
 *
 *   rejected     Plaid refused this kid (a 4xx about the request). Cached
 *                negatively; the webhook is answered 401, which Plaid does not
 *                retry.
 *   unavailable  Anything that is not a verdict on the kid: a 5xx, a timeout,
 *                a transport failure, a 429, or our own credentials refused.
 *                Never cached; answered 503 so Plaid retries.
 */
export type KeyFetchResult =
  | { ok: true; key: PlaidVerificationKey }
  | { ok: false; kind: "rejected" | "unavailable" };

export type KeyLookupResult =
  | KeyFetchResult
  | { ok: false; kind: "rate_limited" };

export type VerificationFailureReason =
  | "missing_header"
  | "malformed"
  | "bad_alg"
  | "bad_kid"
  | "unknown_key"
  | "key_unavailable"
  | "key_fetch_limited"
  | "bad_key"
  | "key_expired"
  | "bad_signature"
  | "stale"
  | "body_hash_mismatch";

export type VerificationResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: VerificationFailureReason };

export type KeyCache = {
  get: (
    kid: string,
    fetchKey: (kid: string) => Promise<KeyFetchResult>,
    nowMs: number
  ) => Promise<KeyLookupResult>;
};

export type VerificationDeps = {
  fetchKey: (kid: string) => Promise<KeyFetchResult>;
  /** Milliseconds since the epoch. */
  now: () => number;
  cache: KeyCache;
};

export const KEY_CACHE_LIMITS = {
  /** A cached key is re-fetched after this, so a newly set expired_at is seen. */
  positiveTtlMs: 60 * 60 * 1000,
  /** A kid Plaid refused is not asked about again for this long. */
  negativeTtlMs: 5 * 60 * 1000,
  /** Per map. The oldest entry is evicted first. */
  maxEntries: 32,
  /** Key fetches allowed per instance in any rolling window below. */
  maxFetchesPerWindow: 10,
  windowMs: 60 * 1000,
};

/** Plaid's documented replay window. */
const MAX_IAT_AGE_SECONDS = 5 * 60;

const KID_SHAPE = /^[A-Za-z0-9-]{1,64}$/;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

type PositiveEntry = { key: PlaidVerificationKey; fetchedAt: number };

/** Deletes the oldest entry once a map is full. Maps iterate in insertion order. */
function evictOldest<V>(map: Map<string, V>, maxEntries: number): void {
  if (map.size < maxEntries) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
}

/**
 * A per-instance key cache with a negative cache and a fetch-rate bound.
 *
 * Module state lives for one serverless instance, which is the unit the bounds
 * are stated in. Concurrent lookups of the same kid share one fetch.
 */
export function createKeyCache(limits = KEY_CACHE_LIMITS): KeyCache {
  const positive = new Map<string, PositiveEntry>();
  const negative = new Map<string, number>(); // kid -> refused until (ms)
  const inflight = new Map<string, Promise<KeyFetchResult>>();
  let fetchTimes: number[] = [];

  return {
    async get(kid, fetchKey, nowMs) {
      const hit = positive.get(kid);
      if (hit && nowMs - hit.fetchedAt < limits.positiveTtlMs) {
        return { ok: true, key: hit.key };
      }

      const refusedUntil = negative.get(kid);
      if (refusedUntil !== undefined && nowMs < refusedUntil) {
        return { ok: false, kind: "rejected" };
      }

      const pending = inflight.get(kid);
      if (pending) return pending;

      fetchTimes = fetchTimes.filter((t) => nowMs - t < limits.windowMs);
      if (fetchTimes.length >= limits.maxFetchesPerWindow) {
        return { ok: false, kind: "rate_limited" };
      }
      fetchTimes.push(nowMs);

      // A fetchKey that throws instead of resolving is treated as unavailable:
      // never cached, answered 503.
      const request = Promise.resolve()
        .then(() => fetchKey(kid))
        .catch((): KeyFetchResult => ({ ok: false, kind: "unavailable" }))
        .then((result) => {
          if (result.ok) {
            positive.delete(kid);
            evictOldest(positive, limits.maxEntries);
            positive.set(kid, { key: result.key, fetchedAt: nowMs });
            negative.delete(kid);
          } else if (result.kind === "rejected") {
            positive.delete(kid);
            negative.delete(kid);
            evictOldest(negative, limits.maxEntries);
            negative.set(kid, nowMs + limits.negativeTtlMs);
          }
          return result;
        });
      inflight.set(kid, request);
      try {
        return await request;
      } finally {
        inflight.delete(kid);
      }
    },
  };
}

/** Decodes one base64url JWT segment as JSON. Null on any failure. */
function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8")
    );
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function fail(
  status: 401 | 503,
  reason: VerificationFailureReason
): VerificationResult {
  return { ok: false, status, reason };
}

/**
 * Verifies one webhook. Nothing in the body or the JWT payload is trusted
 * unless this returns ok.
 *
 * @param rawBody The request body exactly as received, already size-bounded.
 * @param header  The `Plaid-Verification` header value, or null.
 */
export async function verifyPlaidWebhook(
  rawBody: Uint8Array,
  header: string | null,
  deps: VerificationDeps
): Promise<VerificationResult> {
  if (!header) return fail(401, "missing_header");

  const segments = header.split(".");
  if (
    segments.length !== 3 ||
    !segments.every((segment) => BASE64URL_SEGMENT.test(segment))
  ) {
    return fail(401, "malformed");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  // Read for alg and kid only. Unsigned until step 3 below.
  const jwtHeader = decodeJsonSegment(encodedHeader);
  if (!jwtHeader) return fail(401, "malformed");
  if (jwtHeader.alg !== "ES256") return fail(401, "bad_alg");
  const kid = jwtHeader.kid;
  if (typeof kid !== "string" || !KID_SHAPE.test(kid)) {
    return fail(401, "bad_kid");
  }

  const lookup = await deps.cache.get(kid, deps.fetchKey, deps.now());
  if (!lookup.ok) {
    if (lookup.kind === "rejected") return fail(401, "unknown_key");
    if (lookup.kind === "rate_limited") return fail(503, "key_fetch_limited");
    return fail(503, "key_unavailable");
  }
  const key = lookup.key;

  if (key.kty !== "EC" || key.crv !== "P-256") return fail(401, "bad_key");
  if (
    key.expired_at !== null &&
    key.expired_at !== undefined &&
    key.expired_at * 1000 <= deps.now()
  ) {
    return fail(401, "key_expired");
  }

  let signatureValid: boolean;
  try {
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: key.x, y: key.y },
      format: "jwk",
    });
    const signature = Buffer.from(encodedSignature, "base64url");
    // ES256 in a JWS is the raw r||s concatenation, 64 bytes — not DER.
    signatureValid =
      signature.length === 64 &&
      verifySignature(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature
      );
  } catch {
    return fail(401, "bad_key");
  }
  if (!signatureValid) return fail(401, "bad_signature");

  // Signed from here on.
  const claims = decodeJsonSegment(encodedPayload);
  if (!claims) return fail(401, "malformed");

  const iat = claims.iat;
  if (
    typeof iat !== "number" ||
    !isFinite(iat) ||
    deps.now() / 1000 - iat > MAX_IAT_AGE_SECONDS
  ) {
    return fail(401, "stale");
  }

  const claimedHash = claims.request_body_sha256;
  if (typeof claimedHash !== "string" || !SHA256_HEX.test(claimedHash)) {
    return fail(401, "body_hash_mismatch");
  }
  const actualHash = createHash("sha256").update(rawBody).digest();
  if (!timingSafeEqual(actualHash, Buffer.from(claimedHash, "hex"))) {
    return fail(401, "body_hash_mismatch");
  }

  return { ok: true };
}

/**
 * Whether a failed key fetch is Plaid's verdict on the kid, or something else.
 *
 * Only a 4xx about the request is a verdict. Excluded from it, and therefore
 * answered 503 so Plaid retries: 408 and 429 (Plaid's own retryable 4xx), and
 * INVALID_API_KEYS — our credentials were refused, which says nothing about the
 * kid, and answering 401 would make Plaid drop every webhook for as long as the
 * configuration stays broken.
 */
export function classifyKeyFetchError(
  error: unknown
): "rejected" | "unavailable" {
  const status = getPlaidErrorStatus(error);
  if (status === undefined || status < 400 || status > 499) return "unavailable";
  if (status === 408 || status === 429) return "unavailable";
  if (getPlaidErrorCode(error) === "INVALID_API_KEYS") return "unavailable";
  return "rejected";
}

/** The production key fetch. Client credentials ride on the client's headers. */
export async function liveFetchVerificationKey(
  kid: string
): Promise<KeyFetchResult> {
  try {
    const response = await plaidClient.webhookVerificationKeyGet({
      key_id: kid,
    });
    const key = response?.data?.key;
    if (
      !key ||
      typeof key.x !== "string" ||
      typeof key.y !== "string" ||
      typeof key.kty !== "string" ||
      typeof key.crv !== "string"
    ) {
      console.error(
        `[plaid-webhook] key_fetch kid=${logField(kid)} failure=unexpected_shape`
      );
      return { ok: false, kind: "unavailable" };
    }
    return {
      ok: true,
      key: {
        alg: key.alg,
        crv: key.crv,
        kid: key.kid,
        kty: key.kty,
        x: key.x,
        y: key.y,
        expired_at: typeof key.expired_at === "number" ? key.expired_at : null,
      },
    };
  } catch (error) {
    // Already redacted by the plaidHttp interceptor; only allow-listed fields
    // are read here.
    const kind = classifyKeyFetchError(error);
    const status = getPlaidErrorStatus(error);
    console.error(
      `[plaid-webhook] key_fetch kid=${logField(kid)} failure=${kind} ` +
        `status=${status === undefined ? "none" : status} ` +
        `error_code=${logField(getPlaidErrorCode(error))}`
    );
    return { ok: false, kind };
  }
}

/** One cache per instance, shared by every request that instance serves. */
const liveKeyCache = createKeyCache();

export function liveVerificationDeps(): VerificationDeps {
  return {
    fetchKey: liveFetchVerificationKey,
    now: () => Date.now(),
    cache: liveKeyCache,
  };
}
