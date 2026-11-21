import { createHash, createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  REAUTH_CODE_KEY_LABEL,
  REAUTH_CODE_TTL_SECONDS,
  REAUTH_ISSUE_LIMIT,
  REAUTH_ISSUE_WINDOW_SECONDS,
  REAUTH_MAX_ATTEMPTS,
  REAUTH_VERIFIED_WINDOW_SECONDS,
  deriveReauthCodeKey,
  generateReauthCode,
  hashReauthCode,
  requireRecentReauth,
  resolveAccountReauthMode,
  startReauth,
  verifyReauth,
  type ReauthDeps,
  type ReauthRpc,
} from "../accountReauth";
import type { BuiltEmail } from "../emailConfirmation";

/**
 * accountReauth.ts, executed with an injected rpc, mailer and log; no vi.mock.
 * The database's own decisions (limits, windows, the attempt count) are the
 * migration's; here the rpc is a recorder that answers what each test says.
 *
 * Mutations and the test each one turns red:
 *   a mode other than exactly "off" turns reauthentication off   -> A1, A2
 *   the key taken from the secret as is, or with another label   -> A3
 *   no key when the secret is unusable, still issuing or checking -> A4
 *   the hash input changed, or hashed without the key            -> A5
 *   the email sent before the row is issued, or on held / error  -> A6, A7
 *   the address taken from anything but the identity             -> A6
 *   a verify answer mapped to a pass it is not                   -> A8
 *   a gate that passes on an error, a throw or a non-boolean     -> A9
 *   the export check not used up, or the delete check used up    -> A10
 *   the code, key, hash or address in a log line or a body       -> A11
 */

const USER = "sentinel-user-id-6a1f";
const ADDRESS = "sentinel.person@example.test";
const SECRET = "sentinel-service-role-secret-0d93-not-a-real-key";
const CODE = "482913";

type Recorded = { fn: string; args: Record<string, unknown> };

function harness(options: {
  mode?: "off" | "enforce";
  key?: Buffer | null;
  answers?: Partial<Record<string, { data: unknown; error: unknown } | "throw">>;
  sendOk?: boolean;
  rpcBuildThrows?: boolean;
}) {
  const order: string[] = [];
  const rpcCalls: Recorded[] = [];
  const sent: Array<{ to: string; email: BuiltEmail }> = [];
  const logs: string[] = [];
  const rpc: ReauthRpc = async (fn, args) => {
    order.push(`rpc:${fn}`);
    rpcCalls.push({ fn, args });
    const answer = options.answers?.[fn];
    if (answer === "throw") throw new Error("sentinel-rpc-throw");
    return answer ?? { data: null, error: { code: "XX000", message: "no answer set" } };
  };
  const deps: ReauthDeps = {
    mode: options.mode ?? "enforce",
    key: options.key === undefined ? deriveReauthCodeKey(SECRET) : options.key,
    rpc: () => {
      if (options.rpcBuildThrows) throw new Error("sentinel-client-build-throw");
      return rpc;
    },
    sendCode: async (to, email) => {
      order.push("send");
      sent.push({ to, email });
      return options.sendOk ?? true;
    },
    log: (line) => logs.push(line),
    newCode: () => CODE,
  };
  return { deps, order, rpcCalls, sent, logs };
}

const IDENTITY = { id: USER, email: ADDRESS };

describe("ACCOUNT_REAUTH_MODE", () => {
  it("A1 only the exact value off turns reauthentication off", () => {
    const cases: Array<[string | undefined, "off" | "enforce"]> = [
      [undefined, "enforce"],
      ["", "enforce"],
      ["off", "off"],
      ["OFF", "enforce"],
      [" off", "enforce"],
      ["on", "enforce"],
      ["anything", "enforce"],
    ];
    for (const [raw, expected] of cases) {
      expect(resolveAccountReauthMode(raw), JSON.stringify(raw)).toBe(expected);
    }
  });

  it("A2 the gate asks the database for every value but off, and passes without asking only for off", async () => {
    const values: Array<string | undefined> = [undefined, "", "off", "OFF", " off", "on", "anything"];
    for (const raw of values) {
      const h = harness({
        mode: resolveAccountReauthMode(raw),
        answers: { account_reauth_check: { data: false, error: null } },
      });
      const result = await requireRecentReauth(h.deps, USER, "delete_account");
      if (raw === "off") {
        expect(result, JSON.stringify(raw)).toEqual({ ok: true });
        expect(h.rpcCalls, JSON.stringify(raw)).toEqual([]);
      } else {
        expect(result.ok, JSON.stringify(raw)).toBe(false);
        expect(h.rpcCalls.length, JSON.stringify(raw)).toBe(1);
      }
    }
  });
});

describe("the hash key and the hash", () => {
  it("A3 the key is HKDF-SHA256 of the secret under the fixed label, 32 bytes, not the secret itself", async () => {
    const key = deriveReauthCodeKey(SECRET);
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
    expect(REAUTH_CODE_KEY_LABEL).toBe("noor/account-reauth-code/hmac-sha256/v1");
    const { hkdfSync } = await import("crypto");
    const expected = Buffer.from(
      hkdfSync("sha256", Buffer.from(SECRET), Buffer.alloc(0), Buffer.from(REAUTH_CODE_KEY_LABEL), 32)
    );
    expect(key!.equals(expected)).toBe(true);
    const otherLabel = Buffer.from(
      hkdfSync("sha256", Buffer.from(SECRET), Buffer.alloc(0), Buffer.from("another-label"), 32)
    );
    expect(key!.equals(otherLabel)).toBe(false);
    expect(key!.toString("utf8")).not.toContain(SECRET.slice(0, 8));
    expect(deriveReauthCodeKey(SECRET)!.equals(key!)).toBe(true);
  });

  it("A4 no usable secret means no key, and then nothing is issued or verified", async () => {
    for (const secret of [undefined, "", "   "]) {
      expect(deriveReauthCodeKey(secret), JSON.stringify(secret)).toBeNull();
    }
    const h = harness({ key: null, answers: { account_reauth_issue: { data: "issued", error: null } } });
    const started = await startReauth(h.deps, IDENTITY, "delete_account");
    expect(started.status).toBe(503);
    expect(started.body.code).toBe("REAUTH_UNAVAILABLE");
    const verified = await verifyReauth(h.deps, IDENTITY, "delete_account", CODE);
    expect(verified.status).toBe(503);
    expect(verified.body.code).toBe("REAUTH_UNAVAILABLE");
    expect(h.rpcCalls).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("A5 the hash is the keyed HMAC of purpose:user_id:code, and differs from an unkeyed hash", () => {
    const key = deriveReauthCodeKey(SECRET)!;
    const hash = hashReauthCode(key, "export_data", USER, CODE);
    expect(hash).toBe(createHmac("sha256", key).update(`export_data:${USER}:${CODE}`).digest("hex"));
    expect(hash).not.toBe(createHash("sha256").update(`export_data:${USER}:${CODE}`).digest("hex"));
    expect(hash).not.toBe(hashReauthCode(key, "delete_account", USER, CODE));
    expect(hash).not.toBe(hashReauthCode(key, "export_data", "another-user", CODE));
    expect(hash).not.toBe(hashReauthCode(deriveReauthCodeKey("another-secret")!, "export_data", USER, CODE));
  });

  it("A12 the code email assumes no password, in its text and its HTML", async () => {
    const { buildReauthCodeEmail } = await import("../accountReauth");
    for (const purpose of ["delete_account", "export_data"] as const) {
      const email = buildReauthCodeEmail(CODE, purpose);
      for (const [part, body] of [
        ["text", email.text],
        ["html", email.html],
      ] as const) {
        expect(body, `${purpose} ${part}`).not.toMatch(/password/i);
        expect(body, `${purpose} ${part}`).toContain("secure your account");
        expect(body, `${purpose} ${part}`).toContain(CODE);
      }
    }
  });

  it("generates six digits", () => {
    for (let i = 0; i < 50; i++) expect(generateReauthCode()).toMatch(/^[0-9]{6}$/);
  });
});

describe("startReauth", () => {
  it("A6 issues the keyed hash with the limits as arguments, then sends the code to the identity's address", async () => {
    const h = harness({ answers: { account_reauth_issue: { data: "issued", error: null } } });
    const result = await startReauth(h.deps, IDENTITY, "delete_account");
    expect(result).toEqual({ status: 200, body: { status: "sent" } });
    expect(h.order).toEqual(["rpc:account_reauth_issue", "send"]);
    expect(h.rpcCalls[0].args).toEqual({
      p_user_id: USER,
      p_purpose: "delete_account",
      p_code_hash: hashReauthCode(h.deps.key!, "delete_account", USER, CODE),
      p_ttl_seconds: REAUTH_CODE_TTL_SECONDS,
      p_max_issues: REAUTH_ISSUE_LIMIT,
      p_window_seconds: REAUTH_ISSUE_WINDOW_SECONDS,
    });
    expect(h.sent.length).toBe(1);
    expect(h.sent[0].to).toBe(ADDRESS);
    expect(h.sent[0].email.text).toContain(CODE);
    expect(h.sent[0].email.html).toContain(CODE);
  });

  it("A7 a held, failed, thrown or unexpected issue sends nothing; a failed send is 502", async () => {
    const cases: Array<[{ data: unknown; error: unknown } | "throw", number, string]> = [
      [{ data: "held", error: null }, 429, "REAUTH_RATE_LIMITED"],
      [{ data: null, error: { code: "42501", message: "denied" } }, 503, "REAUTH_UNAVAILABLE"],
      ["throw", 503, "REAUTH_UNAVAILABLE"],
      [{ data: true, error: null }, 503, "REAUTH_UNAVAILABLE"],
    ];
    for (const [answer, status, code] of cases) {
      const h = harness({ answers: { account_reauth_issue: answer } });
      const result = await startReauth(h.deps, IDENTITY, "export_data");
      expect(result.status, code).toBe(status);
      expect(result.body.code, code).toBe(code);
      expect(h.sent, code).toEqual([]);
    }
    const built = harness({ rpcBuildThrows: true });
    expect((await startReauth(built.deps, IDENTITY, "export_data")).status).toBe(503);
    expect(built.sent).toEqual([]);

    const failing = harness({ sendOk: false, answers: { account_reauth_issue: { data: "issued", error: null } } });
    const failed = await startReauth(failing.deps, IDENTITY, "export_data");
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe("REAUTH_SEND_FAILED");
  });

  it("refuses an unknown purpose or a missing address before any rpc", async () => {
    for (const purpose of [undefined, "", "DELETE_ACCOUNT", "other", 1]) {
      const h = harness({ answers: { account_reauth_issue: { data: "issued", error: null } } });
      expect((await startReauth(h.deps, IDENTITY, purpose)).status).toBe(400);
      expect(h.rpcCalls).toEqual([]);
    }
    for (const email of [null, "", "  "]) {
      const h = harness({ answers: { account_reauth_issue: { data: "issued", error: null } } });
      expect((await startReauth(h.deps, { id: USER, email }, "delete_account")).status).toBe(409);
      expect(h.rpcCalls).toEqual([]);
      expect(h.sent).toEqual([]);
    }
  });

  it("with the mode off answers not_required and neither issues nor sends", async () => {
    const h = harness({ mode: "off", answers: { account_reauth_issue: { data: "issued", error: null } } });
    expect(await startReauth(h.deps, IDENTITY, "delete_account")).toEqual({
      status: 200,
      body: { status: "not_required" },
    });
    expect(h.rpcCalls).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe("verifyReauth", () => {
  it("A8 sends the keyed hash with the attempt limit, and maps each answer", async () => {
    const cases: Array<[{ data: unknown; error: unknown } | "throw", number, string | null]> = [
      [{ data: "verified", error: null }, 200, null],
      [{ data: "refused", error: null }, 403, "REAUTH_CODE_REJECTED"],
      [{ data: "locked", error: null }, 429, "REAUTH_LOCKED"],
      [{ data: true, error: null }, 503, "REAUTH_UNAVAILABLE"],
      [{ data: null, error: { code: "PGRST202" } }, 503, "REAUTH_UNAVAILABLE"],
      ["throw", 503, "REAUTH_UNAVAILABLE"],
    ];
    for (const [answer, status, code] of cases) {
      const h = harness({ answers: { account_reauth_verify: answer } });
      const result = await verifyReauth(h.deps, IDENTITY, "export_data", ` ${CODE} `);
      expect(result.status, JSON.stringify(answer)).toBe(status);
      if (code === null) expect(result.body).toEqual({ status: "verified" });
      else expect(result.body.code).toBe(code);
      expect(h.rpcCalls[0].args).toEqual({
        p_user_id: USER,
        p_purpose: "export_data",
        p_code_hash: hashReauthCode(h.deps.key!, "export_data", USER, CODE),
        p_max_attempts: REAUTH_MAX_ATTEMPTS,
      });
    }
  });

  it("refuses a code that is not six digits without an rpc", async () => {
    for (const code of [undefined, "", "12345", "1234567", "12a456", 482913]) {
      const h = harness({ answers: { account_reauth_verify: { data: "verified", error: null } } });
      const result = await verifyReauth(h.deps, IDENTITY, "export_data", code);
      expect(result.status, String(code)).toBe(400);
      expect(h.rpcCalls).toEqual([]);
    }
  });
});

describe("requireRecentReauth", () => {
  it("A9 passes only on a boolean true from the database", async () => {
    const cases: Array<[{ data: unknown; error: unknown } | "throw", boolean, number | null]> = [
      [{ data: true, error: null }, true, null],
      [{ data: false, error: null }, false, 403],
      [{ data: "true", error: null }, false, 503],
      [{ data: null, error: null }, false, 503],
      [{ data: true, error: { code: "42501" } }, false, 503],
      ["throw", false, 503],
    ];
    for (const [answer, ok, status] of cases) {
      const h = harness({ answers: { account_reauth_check: answer } });
      const result = await requireRecentReauth(h.deps, USER, "delete_account");
      expect(result.ok, JSON.stringify(answer)).toBe(ok);
      if (!result.ok) {
        expect(result.status).toBe(status);
        expect(result.body.code).toBe(status === 403 ? "REAUTH_REQUIRED" : "REAUTH_CHECK_UNAVAILABLE");
      }
    }
    const built = harness({ rpcBuildThrows: true });
    const result = await requireRecentReauth(built.deps, USER, "export_data");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(503);
  });

  it("A10 uses the export verification up and only reads the delete one", async () => {
    for (const [purpose, consume] of [
      ["export_data", true],
      ["delete_account", false],
    ] as const) {
      const h = harness({ answers: { account_reauth_check: { data: true, error: null } } });
      await requireRecentReauth(h.deps, USER, purpose);
      expect(h.rpcCalls).toEqual([
        {
          fn: "account_reauth_check",
          args: {
            p_user_id: USER,
            p_purpose: purpose,
            p_window_seconds: REAUTH_VERIFIED_WINDOW_SECONDS,
            p_consume: consume,
          },
        },
      ]);
    }
  });
});

describe("nothing secret leaves", () => {
  it("A11 no log line or answer carries the code, the key, the hash, the secret or the address", async () => {
    const outputs: string[] = [];
    const key = deriveReauthCodeKey(SECRET)!;
    const hashes = (["delete_account", "export_data"] as const).map((p) =>
      hashReauthCode(key, p, USER, CODE)
    );
    const answersList: Array<Partial<Record<string, { data: unknown; error: unknown } | "throw">>> = [
      { account_reauth_issue: { data: "issued", error: null }, account_reauth_verify: { data: "verified", error: null }, account_reauth_check: { data: true, error: null } },
      { account_reauth_issue: { data: "held", error: null }, account_reauth_verify: { data: "refused", error: null }, account_reauth_check: { data: false, error: null } },
      { account_reauth_issue: { data: null, error: { code: "XX000", message: `${CODE} ${ADDRESS}` } }, account_reauth_verify: "throw", account_reauth_check: "throw" },
      { account_reauth_issue: { data: "issued", error: null }, account_reauth_verify: { data: "locked", error: null }, account_reauth_check: { data: "x", error: null } },
    ];
    for (const answers of answersList) {
      for (const sendOk of [true, false]) {
        const h = harness({ answers, sendOk });
        for (const purpose of ["delete_account", "export_data"] as const) {
          outputs.push(JSON.stringify(await startReauth(h.deps, IDENTITY, purpose)));
          outputs.push(JSON.stringify(await verifyReauth(h.deps, IDENTITY, purpose, CODE)));
          outputs.push(JSON.stringify(await requireRecentReauth(h.deps, USER, purpose)));
        }
        outputs.push(...h.logs);
      }
    }
    const all = outputs.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [CODE, key.toString("hex"), key.toString("base64"), SECRET, ADDRESS, USER, ...hashes]) {
      expect(all, secret).not.toContain(secret);
    }
  });
});
