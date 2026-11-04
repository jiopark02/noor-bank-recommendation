import { describe, it, expect } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import {
  chooseConfirmedNames,
  decideConfirmResult,
  readCallbackUrl,
  storedNamesFromRow,
} from "../sessionFlow";
import { DEFAULT_FIRST_NAME } from "../defaultFirstName";

/**
 * The email-confirmation decisions behind /auth/callback, executed. Whether
 * the page uses them is probed in sessionFlowWiring.test.ts.
 *
 * Mutations and the test each one turns red:
 *   M14 a metadata fallback in the confirmed names    -> NM3 (and the wiring probe)
 *   M17 error_description carried out of the URL      -> U4
 */

const BASE = "https://noor.example/auth/callback";

describe("readCallbackUrl", () => {
  it("U1 a signup token in the fragment is a confirmation", () => {
    expect(readCallbackUrl(BASE + "#token_hash=abc%2Bdef&type=signup")).toEqual({
      kind: "confirm",
      tokenHash: "abc+def",
    });
  });

  it("U2 a token in the query is not accepted", () => {
    expect(readCallbackUrl(BASE + "?token_hash=abc&type=signup")).toEqual({ kind: "none" });
  });

  it("U3 another type, or no type, is not a confirmation", () => {
    expect(readCallbackUrl(BASE + "#token_hash=abc&type=recovery")).toEqual({ kind: "none" });
    expect(readCallbackUrl(BASE + "#token_hash=abc")).toEqual({ kind: "none" });
    expect(readCallbackUrl(BASE + "?code=xyz")).toEqual({ kind: "none" });
    expect(readCallbackUrl(BASE)).toEqual({ kind: "none" });
    expect(readCallbackUrl("not a url")).toEqual({ kind: "none" });
  });

  it("U4 an error wins, keeps only its code, and never its description", () => {
    const query = readCallbackUrl(
      BASE + "?error=access_denied&error_code=otp_expired&error_description=Visit+evil.example"
    );
    expect(query).toEqual({ kind: "url-error", code: "otp_expired" });
    expect(JSON.stringify(query)).not.toContain("evil");

    const fragment = readCallbackUrl(
      BASE + "#error=access_denied&error_description=hello&token_hash=abc&type=signup"
    );
    expect(fragment).toEqual({ kind: "url-error", code: "access_denied" });
  });

  it("U5 a code of an unexpected shape is dropped", () => {
    expect(readCallbackUrl(BASE + "?error_code=%3Cscript%3E")).toEqual({
      kind: "url-error",
      code: null,
    });
    expect(readCallbackUrl(BASE + "?error=" + "a".repeat(65))).toEqual({
      kind: "url-error",
      code: null,
    });
  });
});

describe("decideConfirmResult", () => {
  it("C1 no error with a session continues; without a session it failed", () => {
    expect(decideConfirmResult(null, true)).toBe("continue");
    expect(decideConfirmResult(null, false)).toBe("failed");
  });

  it("C2 an expired or used token is expired", () => {
    expect(decideConfirmResult(new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"), false)).toBe("expired");
    expect(decideConfirmResult(new AuthApiError("x", 403, undefined), false)).toBe("expired");
    expect(decideConfirmResult({ code: "flow_state_not_found", status: 404 }, false)).toBe("expired");
  });

  it("C3 an answer that never came is retry", () => {
    expect(decideConfirmResult(new AuthRetryableFetchError("network", 0), false)).toBe("retry");
    expect(decideConfirmResult(new AuthApiError("x", 500, "unexpected_failure"), false)).toBe("retry");
    expect(decideConfirmResult({ status: 503 }, false)).toBe("retry");
  });

  it("C4 any other refusal is failed", () => {
    expect(decideConfirmResult(new AuthApiError("x", 400, "validation_failed"), false)).toBe("failed");
    expect(decideConfirmResult({ message: "odd" }, false)).toBe("failed");
  });
});

describe("chooseConfirmedNames", () => {
  const SYNCED = { firstName: "Synced", lastName: "Name" };
  const STORED = { firstName: "Stored", lastName: "Row" };

  it("NM1 the synced names win", () => {
    expect(chooseConfirmedNames({ synced: SYNCED, stored: STORED })).toEqual(SYNCED);
  });

  it("NM2 without synced names, the stored row", () => {
    expect(chooseConfirmedNames({ synced: null, stored: STORED })).toEqual(STORED);
  });

  it("NM3 with neither, empty names, whatever else is passed", () => {
    const withMetadata = {
      synced: null,
      stored: null,
      metadata: { first_name: "Later", last_name: "Request" },
      user_metadata: { first_name: "Later", last_name: "Request" },
    } as unknown as Parameters<typeof chooseConfirmedNames>[0];
    expect(chooseConfirmedNames(withMetadata)).toEqual({ firstName: "", lastName: "" });
  });

  it("NM4 a stored row is read into the display shape, the placeholder as empty", () => {
    expect(storedNamesFromRow({ first_name: "Ann", last_name: null })).toEqual({
      firstName: "Ann",
      lastName: "",
    });
    expect(storedNamesFromRow({ first_name: DEFAULT_FIRST_NAME, last_name: "Lee" })).toEqual({
      firstName: "",
      lastName: "Lee",
    });
    expect(storedNamesFromRow(null)).toBeNull();
  });
});
