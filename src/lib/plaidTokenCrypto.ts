// =============================================================================
// PL1 — the single decision surface for turning a Plaid access token into a
// stored value and back.
//
// WHY THIS EXISTS
// plaid_connections.access_token used to hold a live bank credential in
// plaintext. Anyone who could read the row — a leaked service-role key, a
// Supabase console session, a database backup — held the user's bank access
// until the Plaid Item was revoked. Because createServerClient() runs as
// service-role in production, RLS is a backstop rather than the primary
// defense, so the column itself had to stop being usable.
//
// WHAT IS STORED
//   v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
// AES-256-GCM. The IV is 12 fresh random bytes per encryption, never derived
// and never reused. The 16-byte GCM auth tag is verified on decrypt, which is
// what makes a tampered or foreign ciphertext an explicit error rather than
// silent garbage.
//
// The leading `v1` is a KEY VERSION tag, not a format nicety. Note precisely
// what the tag does and does not identify: it names a key VERSION, never a key
// VALUE. Two deployments configured with different key values but the same
// version produce ciphertext that is indistinguishable by tag and mutually
// undecryptable — see the same warning on PLAID_TOKEN_ENCRYPTION_KEY in
// CLAUDE.md, which is why Production and Preview must carry the SAME value.
//
// KEY ROTATION IS NOT IMPLEMENTED. Read that literally: the tag exists so that
// rotation CAN be built later without a data migration, and nothing more. As of
// this version there is exactly one key and exactly one accepted tag —
// `loadKey()` reads a single env var, and `decryptPlaidAccessToken` rejects any
// tag that is not `VERSION` with reason "unknown_version" (see the comment on
// VERSION below, which says the same thing). A table holding two key versions
// would therefore be HALF UNREADABLE today, not readable.
//
// Introducing v2 means writing all three of these, not just bumping VERSION:
//   1. DISPATCH. decrypt must select the key from the tag it parsed, instead of
//      comparing the tag to a single constant. Encrypt keeps writing exactly
//      one version — the newest — so the reader is the only side that is
//      multi-version.
//   2. KEY SUPPLY. loadKey() must resolve a key PER VERSION (e.g. a second
//      variable, PLAID_TOKEN_ENCRYPTION_KEY_V2, with both set during the
//      rotation window). The cache is keyed on the raw env string, so it needs
//      to become per-version too or it will hand back the wrong key. Retiring a
//      version means deleting its variable only after no row carries its tag.
//   3. AAD. aadFor() currently hardcodes the module's VERSION, which is correct
//      only because decrypt accepts that one version. Once decrypt dispatches,
//      the AAD must be built from the tag the ciphertext actually carries, or
//      every v1 row fails to decrypt under a v2 build. This is the step that
//      breaks silently: it is invisible to tsc, and any test that encrypts and
//      decrypts within one version will still pass.
// Re-linking the bank is always the fallback: a row that cannot be decrypted is
// replaceable, because Plaid will issue a fresh access token.
//
// ADDITIONAL AUTHENTICATED DATA
// The AAD is `v1:<userId>`, so a ciphertext is bound to the row that owns it.
// A ciphertext copied out of user A's row and into user B's fails to decrypt
// instead of silently handing A's bank access to B. This is only worth
// anything if the userId string is byte-identical at write and at read: every
// call site derives it from getAuthenticatedUserIdFromRequest() (i.e. Supabase
// `user.id`) and applies NO trimming, casing or substitution. An AAD mismatch
// surfaces here as reason "auth_failed", which is indistinguishable from a
// wrong key — it is invisible to tsc and to the unit tests, so it is checked by
// reading the call sites, not by the type system.
//
// FAIL-CLOSED, WITHOUT EXCEPTION
// Every failure below throws. Nothing here returns "", returns the input
// unchanged, or falls back to plaintext, and there is no configuration in which
// this module lets a plaintext token reach the database or the Plaid SDK. That
// direction follows the precedents already in this repo: createAdminClient()
// throws on missing env rather than degrading to a weaker client
// (supabase.ts), redactPlaidAxiosError fails closed to a different error rather
// than handing back the original (plaidErrorRedaction.ts), and
// getPlaidChatState throws on a failed read rather than reporting a false "not
// connected" (plaidChatState.ts).
//
// NOTHING IN THIS FILE EVER PUTS A VALUE IN AN ERROR MESSAGE. Messages name the
// condition that was evaluated — never the plaintext, the ciphertext, the key,
// or the userId — mirroring the rule plaidEgressPolicy.ts applies to its own
// decision reasons. The machine-readable detail rides on `reason`.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The key version this module writes. Decrypt accepts only this version. */
const VERSION = "v1";

/** AES-256 key size, in bytes. */
const KEY_BYTES = 32;

/** GCM nonce size, in bytes. 12 is the size AES-GCM is specified around. */
const IV_BYTES = 12;

/** GCM authentication tag size, in bytes. */
const AUTH_TAG_BYTES = 16;

/**
 * Canonical base64 for exactly 32 bytes: 43 payload characters and one pad.
 * Buffer.from(s, "base64") is lenient — it skips characters it does not
 * recognise — so a mistyped key can decode to 32 bytes by accident. Matching
 * the shape first turns that into an explicit error.
 */
const KEY_FORMAT = /^[A-Za-z0-9+/]{43}=$/;

/** A version tag as the DB CHECK constraint defines it: v followed by digits. */
const VERSION_TAG_FORMAT = /^v[0-9]+$/;

/**
 * The machine-readable failure reasons. Each names the condition that was
 * evaluated, never a downstream effect.
 */
export type PlaidTokenCryptoReason =
  | "key_missing"
  | "key_format"
  | "key_length"
  | "empty_plaintext"
  | "missing_user_id"
  | "not_a_string"
  | "malformed"
  | "unknown_version"
  | "iv_length"
  | "auth_tag_length"
  | "empty_ciphertext"
  | "auth_failed";

/**
 * Marker property, and the reason `isPlaidTokenCryptoError` exists rather than
 * a bare `instanceof`.
 *
 * THE REASON IS SINGLE SOURCE OF TRUTH, NOT A BROKEN `instanceof`. An earlier
 * version of this comment claimed the guard was needed because the ES5
 * downlevel breaks `instanceof` on an Error subclass. Measured, by emitting
 * this class at --target es5 and running it:
 *
 *   ES5    + setPrototypeOf repair  ->  instanceof true    guard true
 *   ES5    without the repair       ->  instanceof FALSE   guard true
 *   ES2017 without the repair       ->  instanceof true    guard true
 *
 * So the ES5 hazard is real, but the setPrototypeOf call in the constructor
 * below already closes it — `instanceof PlaidTokenCryptoError` works here today
 * at every target. The guard is not compensating for a broken `instanceof`.
 *
 * What the guard actually buys is that the property the class SETS and the
 * property the guard READS are the same constant, so they cannot drift apart.
 * Measured too: rename MARKER while leaving a hardcoded property name on the
 * class and tsc stays clean (the guard indexes a Record<string, unknown>, so
 * there is nothing for it to catch) while the guard returns false forever. The
 * computed key `[MARKER]` is what makes that failure impossible to write.
 *
 * Secondary, and smaller: the guard does not read the prototype chain, so it
 * survives the repair above being removed by a later edit. Callers and tests
 * use the guard.
 */
const MARKER = "__isPlaidTokenCryptoError";

export class PlaidTokenCryptoError extends Error {
  readonly reason: PlaidTokenCryptoReason;
  readonly [MARKER] = true as const;

  constructor(reason: PlaidTokenCryptoReason, message: string) {
    super(message);
    this.name = "PlaidTokenCryptoError";
    this.reason = reason;
    // Load-bearing at this repo's --target es5: without it, `instanceof
    // PlaidTokenCryptoError` is false (measured — see MARKER above). Nothing in
    // this codebase relies on `instanceof` for this class, but a caller that
    // reached for it would otherwise get a silent false.
    Object.setPrototypeOf(this, PlaidTokenCryptoError.prototype);
  }
}

/** True when `error` came from this module. Prototype-chain independent. */
export function isPlaidTokenCryptoError(
  error: unknown
): error is PlaidTokenCryptoError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>)[MARKER] === true
  );
}

/**
 * Successfully parsed keys only. A failure is never cached: the env var can be
 * corrected and the deployment restarted, and caching "broken" would make the
 * first bad read sticky for the life of the process.
 *
 * Cached by the raw env string, so a test that swaps the variable does not
 * silently keep using the previous key.
 */
let cachedKeySource: string | null = null;
let cachedKey: Buffer | null = null;

/**
 * Read and validate PLAID_TOKEN_ENCRYPTION_KEY.
 *
 * Read lazily, inside the call, rather than at module load: plaidApiUtils
 * imports this module and every Plaid route imports plaidApiUtils, so a
 * top-level throw would take down routes that never touch a token. Same shape
 * as createAdminClient(), which validates its env at call time.
 *
 * The env value is trimmed before validation — that is a property of the KEY,
 * not of the AAD, so it cannot cause an encrypt/decrypt mismatch.
 */
function loadKey(): Buffer {
  const raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY;

  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PlaidTokenCryptoError(
      "key_missing",
      "PLAID_TOKEN_ENCRYPTION_KEY is not set. Plaid access tokens cannot be " +
        "encrypted or decrypted; there is deliberately no plaintext fallback."
    );
  }

  const source = raw.trim();

  if (cachedKey && cachedKeySource === source) {
    return cachedKey;
  }

  if (!KEY_FORMAT.test(source)) {
    throw new PlaidTokenCryptoError(
      "key_format",
      "PLAID_TOKEN_ENCRYPTION_KEY is not canonical base64 for a 32-byte key " +
        "(expected 43 base64 characters followed by '=')."
    );
  }

  const key = Buffer.from(source, "base64");

  // NO CURRENT PATH REACHES THIS, AND IT IS KEPT DELIBERATELY. KEY_FORMAT
  // already fixes the length at 43 payload characters plus one pad, which
  // decodes to exactly 32 bytes, so a value that passes the regex cannot fail
  // here. It stays because the two checks answer to different things: the regex
  // is about the shape a human pasted, this is about what the cipher will
  // actually be keyed with. If KEY_FORMAT is ever relaxed — to accept base64url
  // or unpadded base64, say — this is what stops a short key from reaching
  // createCipheriv, where the failure would be a raw node error instead.
  if (key.length !== KEY_BYTES) {
    throw new PlaidTokenCryptoError(
      "key_length",
      `PLAID_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes.`
    );
  }

  cachedKeySource = source;
  cachedKey = key;
  return key;
}

/**
 * Whether this deployment can handle Plaid access tokens at all.
 *
 * Mirrors isPlaidConfigured() in plaid.ts so the routes that already return 503
 * for an unconfigured Plaid can return the same 503 for an unconfigured key,
 * instead of surfacing a 500 from deep inside a loop.
 *
 * This is a nicer status code, NOT the guarantee. The guarantee is that
 * encrypt/decrypt throw regardless of whether anyone checked this first.
 */
export function isPlaidTokenCryptoConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * The AAD for a row. Includes the version so a value encrypted under v1 cannot
 * be replayed as a future v2 for the same user.
 *
 * It uses the module's VERSION rather than the tag parsed off the stored value.
 * That is correct ONLY while decrypt accepts a single version — the two are
 * always equal today, because decrypt rejects every other tag before reaching
 * here. It stops being correct the moment multi-version decrypt is added; see
 * step 3 of the rotation notes in the file header.
 */
function aadFor(userId: string): Buffer {
  return Buffer.from(`${VERSION}:${userId}`, "utf8");
}

function requireUserId(userId: string): void {
  if (typeof userId !== "string" || userId === "") {
    throw new PlaidTokenCryptoError(
      "missing_user_id",
      "A non-empty userId is required: it is the additional authenticated " +
        "data binding a ciphertext to the row that owns it."
    );
  }
}

/**
 * A stored access_token value. Deliberately a plain string alias rather than a
 * branded type: branding the CIPHERTEXT would not stop it being passed to the
 * Plaid SDK (a branded string is still assignable to string), so it would buy
 * a false sense of safety. The guarantee that ciphertext never reaches the SDK
 * is held by the read-site probe in
 * src/lib/__tests__/plaidTokenReadSites.test.ts, not by the type.
 */
export type EncryptedPlaidToken = string;

/**
 * Encrypt a Plaid access token for storage.
 *
 * @param plaintext The token as Plaid issued it.
 * @param userId    The authenticated user id, verbatim from the verified token.
 */
export function encryptPlaidAccessToken(
  plaintext: string,
  userId: string
): EncryptedPlaidToken {
  if (typeof plaintext !== "string") {
    throw new PlaidTokenCryptoError(
      "not_a_string",
      "A Plaid access token must be a string to be encrypted."
    );
  }
  if (plaintext === "") {
    throw new PlaidTokenCryptoError(
      "empty_plaintext",
      "Refusing to encrypt an empty Plaid access token: an empty token is " +
        "never a value worth storing, and storing one would hide the defect " +
        "that produced it."
    );
  }
  requireUserId(userId);

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(userId));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored access_token back into a usable Plaid token.
 *
 * Throws on every failure, including the one that matters most: a value that
 * is not in this format at all. A legacy plaintext token (`access-sandbox-...`)
 * does not parse and is rejected here rather than being handed to the Plaid SDK
 * — there is no passthrough branch, by design. The database CHECK constraint
 * `access_token ~ '^v[0-9]+:'` makes the same guarantee from the other side.
 *
 * @param stored The column value.
 * @param userId The authenticated user id, verbatim — must be byte-identical
 *               to the value passed at encryption time (see file header).
 */
export function decryptPlaidAccessToken(
  stored: string,
  userId: string
): string {
  if (typeof stored !== "string") {
    throw new PlaidTokenCryptoError(
      "not_a_string",
      "A stored Plaid access token must be a string to be decrypted."
    );
  }
  requireUserId(userId);

  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new PlaidTokenCryptoError(
      "malformed",
      "Stored Plaid access token is not in the expected " +
        "v<n>:<iv>:<authTag>:<ciphertext> form. A plaintext token is NOT " +
        "accepted here; there is no plaintext fallback."
    );
  }

  const [versionTag, ivB64, authTagB64, ciphertextB64] = parts;

  if (!VERSION_TAG_FORMAT.test(versionTag)) {
    throw new PlaidTokenCryptoError(
      "malformed",
      "Stored Plaid access token does not begin with a v<n> version tag."
    );
  }
  if (versionTag !== VERSION) {
    throw new PlaidTokenCryptoError(
      "unknown_version",
      `Stored Plaid access token carries an unsupported key version. This ` +
        `build understands ${VERSION} only.`
    );
  }

  const iv = Buffer.from(ivB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new PlaidTokenCryptoError(
      "iv_length",
      `Stored Plaid access token has a ${iv.length}-byte IV; expected ${IV_BYTES}.`
    );
  }

  const authTag = Buffer.from(authTagB64, "base64");
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new PlaidTokenCryptoError(
      "auth_tag_length",
      `Stored Plaid access token has a ${authTag.length}-byte auth tag; ` +
        `expected ${AUTH_TAG_BYTES}.`
    );
  }

  const ciphertext = Buffer.from(ciphertextB64, "base64");
  if (ciphertext.length === 0) {
    throw new PlaidTokenCryptoError(
      "empty_ciphertext",
      "Stored Plaid access token has an empty ciphertext."
    );
  }

  const key = loadKey();

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aadFor(userId));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The original error is deliberately not chained: node's GCM failure
    // message carries no useful detail, and anything we add here risks
    // describing the value. Three distinct causes land on this one reason and
    // cannot be told apart from the outside — a wrong key, a tampered
    // ciphertext, and a userId that differs from the one used at encryption.
    // That ambiguity is a property of AEAD, not an omission.
    throw new PlaidTokenCryptoError(
      "auth_failed",
      "Stored Plaid access token failed authenticated decryption. Causes are " +
        "indistinguishable by design: a wrong PLAID_TOKEN_ENCRYPTION_KEY, a " +
        "modified ciphertext, or a userId that does not match the one used to " +
        "encrypt it."
    );
  }
}
