import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * PL1 — the crypto boundary for plaid_connections.access_token.
 *
 * This file carries the ENTIRE negative surface of the change. The missing-key,
 * wrong-key, tampered-ciphertext and AAD-mismatch directions are deliberately
 * not exercised against a deployment: Preview and Production share one Supabase
 * project, so a preview running without the key would be operating on the live
 * table. They are proven here or nowhere.
 *
 * WHY THE DYNAMIC IMPORT
 * plaidTokenCrypto caches the parsed key in module scope. A static import would
 * bind one module instance for the whole file, and the first test to set an env
 * var would decide the key for every test after it. `vi.resetModules()` plus a
 * fresh `await import()` per case gives each test its own module instance, so
 * the cache cannot leak between them. This is also why every test reads the
 * module through the `load()` helper rather than a top-level import.
 *
 * NO MOCKS. Nothing here is faked — this is real node:crypto against real
 * values. The module was built with no injected dependencies precisely so this
 * file would not need any, matching the preference the rest of this suite
 * states (see plaidConnectionReadSeam.test.ts on why a mock is a last resort).
 */

/** A valid key: 32 bytes, canonical base64 (43 chars + '='). */
const KEY_A = Buffer.alloc(32, 1).toString("base64");
/** A second valid key, for the wrong-key case. */
const KEY_B = Buffer.alloc(32, 2).toString("base64");

/**
 * Both ids MUST contain hex letters. An all-digit uuid makes `.toUpperCase()`
 * an identity function, which silently turns the recasing assertion below into
 * a test that proves nothing — measured: it passed decryption and failed the
 * expectation only because the call did not throw.
 */
const USER_A = "3f2a1b7c-9d4e-4a8f-b6c1-0e5d2a9f8b34";
const USER_B = "7c1d9e2f-4a6b-4c8d-9e1f-2a3b4c5d6e7f";

/** A realistically shaped Plaid sandbox token. */
const TOKEN = "access-sandbox-8ab976e6-64bc-4b38-98f7-731e7a349970";

type CryptoModule = typeof import("../plaidTokenCrypto");

/** Fresh module instance with the given key (or none). */
async function load(key?: string): Promise<CryptoModule> {
  vi.resetModules();
  if (key === undefined) {
    vi.stubEnv("PLAID_TOKEN_ENCRYPTION_KEY", "");
  } else {
    vi.stubEnv("PLAID_TOKEN_ENCRYPTION_KEY", key);
  }
  return import("../plaidTokenCrypto");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("round trip", () => {
  it("returns the exact input", async () => {
    const m = await load(KEY_A);
    const stored = m.encryptPlaidAccessToken(TOKEN, USER_A);
    expect(m.decryptPlaidAccessToken(stored, USER_A)).toBe(TOKEN);
  });

  it("survives a value with non-ASCII and colons in it", async () => {
    // The stored format is colon-delimited, so a plaintext containing colons is
    // the case that would break a naive parser. It cannot arise from Plaid, but
    // the format should not depend on that.
    const m = await load(KEY_A);
    const odd = "a:b:c:김성원:🏦";
    expect(
      m.decryptPlaidAccessToken(m.encryptPlaidAccessToken(odd, USER_A), USER_A)
    ).toBe(odd);
  });

  it("tags the stored value with the key version and four fields", async () => {
    const m = await load(KEY_A);
    const stored = m.encryptPlaidAccessToken(TOKEN, USER_A);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored.split(":")).toHaveLength(4);
    // The DB CHECK constraint added by the migration must accept what this
    // writes. Same pattern, expressed in JS.
    expect(/^v[0-9]+:/.test(stored)).toBe(true);
  });

  it("never stores the plaintext anywhere in the output", async () => {
    const m = await load(KEY_A);
    expect(m.encryptPlaidAccessToken(TOKEN, USER_A)).not.toContain(TOKEN);
  });
});

describe("IV freshness", () => {
  it("produces a different ciphertext each time, and both decrypt", async () => {
    const m = await load(KEY_A);
    const first = m.encryptPlaidAccessToken(TOKEN, USER_A);
    const second = m.encryptPlaidAccessToken(TOKEN, USER_A);

    expect(first).not.toBe(second);
    // Specifically the IV field, not just the whole string.
    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
    expect(m.decryptPlaidAccessToken(first, USER_A)).toBe(TOKEN);
    expect(m.decryptPlaidAccessToken(second, USER_A)).toBe(TOKEN);
  });
});

describe("fail-closed: no plaintext ever passes through", () => {
  it("rejects a legacy plaintext token instead of returning it", async () => {
    // THE CASE THIS WHOLE CHANGE EXISTS FOR. If decrypt ever grew a "looks like
    // plaintext, hand it back" branch, a pre-migration row would keep working
    // and the encryption would be silently optional. It must throw.
    const m = await load(KEY_A);
    expect(() => m.decryptPlaidAccessToken(TOKEN, USER_A)).toThrow();
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(TOKEN, USER_A))).toBe(
      "malformed"
    );
  });

  it("rejects an empty plaintext at encryption", async () => {
    const m = await load(KEY_A);
    expect(reasonOf(m, () => m.encryptPlaidAccessToken("", USER_A))).toBe(
      "empty_plaintext"
    );
  });

  it("rejects an empty ciphertext field", async () => {
    const m = await load(KEY_A);
    const [v, iv, tag] = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    expect(
      reasonOf(m, () => m.decryptPlaidAccessToken(`${v}:${iv}:${tag}:`, USER_A))
    ).toBe("empty_ciphertext");
  });
});

describe("tampering", () => {
  it("rejects a modified ciphertext", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[3] = flipOneBase64Char(parts[3]);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "auth_failed"
    );
  });

  it("rejects a modified auth tag", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[2] = flipOneBase64Char(parts[2]);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "auth_failed"
    );
  });

  it("rejects a modified IV", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[1] = flipOneBase64Char(parts[1]);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "auth_failed"
    );
  });

  it("rejects a truncated IV", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[1] = Buffer.alloc(8).toString("base64");
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "iv_length"
    );
  });

  it("rejects a truncated auth tag", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[2] = Buffer.alloc(8).toString("base64");
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "auth_tag_length"
    );
  });
});

describe("AAD binding to userId", () => {
  it("refuses to decrypt another user's ciphertext", async () => {
    // The row-swap defense: a ciphertext lifted out of user A's row and dropped
    // into user B's must not grant B access to A's bank.
    const m = await load(KEY_A);
    const stored = m.encryptPlaidAccessToken(TOKEN, USER_A);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(stored, USER_B))).toBe(
      "auth_failed"
    );
  });

  it("is byte-exact — a trimmed or recased userId does not decrypt", async () => {
    // This is the failure mode the implementation check in the plan is about.
    // It is invisible to tsc and would only ever appear at runtime, so it is
    // pinned here to document how unforgiving the binding is.
    const m = await load(KEY_A);
    const padded = ` ${USER_A} `;
    const stored = m.encryptPlaidAccessToken(TOKEN, padded);

    expect(m.decryptPlaidAccessToken(stored, padded)).toBe(TOKEN);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(stored, USER_A))).toBe(
      "auth_failed"
    );
    expect(
      reasonOf(m, () => m.decryptPlaidAccessToken(stored, padded.toUpperCase()))
    ).toBe("auth_failed");
  });

  it("requires a userId on both sides", async () => {
    const m = await load(KEY_A);
    expect(reasonOf(m, () => m.encryptPlaidAccessToken(TOKEN, ""))).toBe(
      "missing_user_id"
    );
    const stored = m.encryptPlaidAccessToken(TOKEN, USER_A);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(stored, ""))).toBe(
      "missing_user_id"
    );
  });
});

describe("key handling", () => {
  it("cannot decrypt what another key encrypted", async () => {
    const writer = await load(KEY_A);
    const stored = writer.encryptPlaidAccessToken(TOKEN, USER_A);

    const reader = await load(KEY_B);
    expect(reasonOf(reader, () => reader.decryptPlaidAccessToken(stored, USER_A))).toBe(
      "auth_failed"
    );
  });

  it("throws on a missing key, in both directions", async () => {
    const writer = await load(KEY_A);
    const stored = writer.encryptPlaidAccessToken(TOKEN, USER_A);

    const m = await load(undefined);
    expect(reasonOf(m, () => m.encryptPlaidAccessToken(TOKEN, USER_A))).toBe(
      "key_missing"
    );
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(stored, USER_A))).toBe(
      "key_missing"
    );
    expect(m.isPlaidTokenCryptoConfigured()).toBe(false);
  });

  it("throws on a key that is not canonical base64", async () => {
    const m = await load("not-a-real-key");
    expect(reasonOf(m, () => m.encryptPlaidAccessToken(TOKEN, USER_A))).toBe(
      "key_format"
    );
    expect(m.isPlaidTokenCryptoConfigured()).toBe(false);
  });

  it("throws on a well-formed base64 key of the wrong length", async () => {
    const m = await load(Buffer.alloc(16, 3).toString("base64"));
    expect(reasonOf(m, () => m.encryptPlaidAccessToken(TOKEN, USER_A))).toBe(
      "key_format"
    );
    expect(m.isPlaidTokenCryptoConfigured()).toBe(false);
  });

  it("tolerates surrounding whitespace on the env value", async () => {
    // A key pasted into a dashboard field can pick up a trailing newline.
    // Trimming the KEY is safe — unlike trimming a userId, it cannot cause an
    // encrypt/decrypt mismatch, because both sides trim identically.
    const m = await load(`\n  ${KEY_A}\t`);
    expect(m.isPlaidTokenCryptoConfigured()).toBe(true);
    expect(
      m.decryptPlaidAccessToken(m.encryptPlaidAccessToken(TOKEN, USER_A), USER_A)
    ).toBe(TOKEN);
  });

  it("reports configured only when the key is usable", async () => {
    expect((await load(KEY_A)).isPlaidTokenCryptoConfigured()).toBe(true);
    expect((await load("")).isPlaidTokenCryptoConfigured()).toBe(false);
  });
});

describe("version tag", () => {
  it("rejects a version this build does not understand", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[0] = "v9";
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "unknown_version"
    );
  });

  it("rejects a value with no version tag at all", async () => {
    const m = await load(KEY_A);
    const parts = m.encryptPlaidAccessToken(TOKEN, USER_A).split(":");
    parts[0] = "x1";
    expect(reasonOf(m, () => m.decryptPlaidAccessToken(parts.join(":"), USER_A))).toBe(
      "malformed"
    );
  });

  it("rejects the wrong number of fields", async () => {
    const m = await load(KEY_A);
    expect(reasonOf(m, () => m.decryptPlaidAccessToken("v1:a:b", USER_A))).toBe(
      "malformed"
    );
    expect(reasonOf(m, () => m.decryptPlaidAccessToken("v1:a:b:c:d", USER_A))).toBe(
      "malformed"
    );
  });
});

describe("errors leak nothing", () => {
  it("keeps the plaintext, the key and the userId out of every message", async () => {
    const m = await load(KEY_A);
    const stored = m.encryptPlaidAccessToken(TOKEN, USER_A);

    const messages: string[] = [];
    const collect = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        messages.push(err instanceof Error ? err.message : String(err));
      }
    };

    collect(() => m.decryptPlaidAccessToken(TOKEN, USER_A));
    collect(() => m.decryptPlaidAccessToken(stored, USER_B));
    collect(() => m.encryptPlaidAccessToken("", USER_A));
    collect(() => m.decryptPlaidAccessToken("v1:a:b", USER_A));

    expect(messages.length).toBe(4);
    for (const message of messages) {
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain(KEY_A);
      expect(message).not.toContain(USER_A);
      expect(message).not.toContain(USER_B);
      expect(message).not.toContain(stored);
    }
  });
});

describe("error identity", () => {
  it("is recognised by the guard, and does not catch unrelated errors", async () => {
    const m = await load(KEY_A);
    let caught: unknown;
    try {
      m.decryptPlaidAccessToken("nope", USER_A);
    } catch (err) {
      caught = err;
    }

    expect(m.isPlaidTokenCryptoError(caught)).toBe(true);
    expect(m.isPlaidTokenCryptoError(new Error("unrelated"))).toBe(false);
    expect(m.isPlaidTokenCryptoError(null)).toBe(false);
    expect(m.isPlaidTokenCryptoError("string")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Run `fn`, require that it threw a PlaidTokenCryptoError, and return its
 * `reason`. Asserting on the reason rather than the message is what keeps these
 * tests from pinning wording that is free to change.
 */
function reasonOf(m: CryptoModule, fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (m.isPlaidTokenCryptoError(err)) {
      return err.reason;
    }
    throw err;
  }
  throw new Error("expected the call to throw, but it returned");
}

/**
 * Change exactly one character of a base64 field, keeping it valid base64 so
 * the failure comes from the GCM tag check rather than from a decode error.
 */
function flipOneBase64Char(value: string): string {
  const index = 0;
  const replacement = value[index] === "A" ? "B" : "A";
  return replacement + value.slice(1);
}
