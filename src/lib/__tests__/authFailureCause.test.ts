import { describe, it, expect } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { classifyGetUserFailure } from "../authFailureCause";

/**
 * classifyGetUserFailure, executed against the error classes the installed
 * auth-js builds: which errors say the token was refused, and which say only
 * that Supabase Auth gave no usable answer.
 *
 * Mutations that turn this file red:
 *   - the retryable-fetch check removed                -> "no response", "gateway"
 *   - the unknown-error check removed                  -> "not JSON"
 *   - the 5xx rule removed, or its bound raised        -> "a 500 with a JSON body"
 *   - the 429 rule removed                             -> "rate limited"
 *   - a 4xx read as unreachable                        -> "refused"
 */

describe("classifyGetUserFailure", () => {
  it("no response at all is unreachable", () => {
    expect(classifyGetUserFailure(new AuthRetryableFetchError("fetch failed", 0))).toBe(
      "auth_unreachable"
    );
  });

  it.each([502, 503, 504])("a gateway %i is unreachable", (status) => {
    expect(classifyGetUserFailure(new AuthRetryableFetchError("bad gateway", status))).toBe(
      "auth_unreachable"
    );
  });

  it("an error body that was not JSON is unreachable", () => {
    expect(
      classifyGetUserFailure(new AuthUnknownError("Unexpected token <", new Error("parse")))
    ).toBe("auth_unreachable");
  });

  it("a 500 with a JSON body is unreachable", () => {
    expect(classifyGetUserFailure(new AuthApiError("internal", 500, undefined))).toBe(
      "auth_unreachable"
    );
  });

  it("rate limited is unreachable: the token was not judged", () => {
    expect(
      classifyGetUserFailure(new AuthApiError("too many", 429, "over_request_rate_limit"))
    ).toBe("auth_unreachable");
  });

  it.each([400, 401, 403, 404])("a %i is the token refused", (status) => {
    expect(classifyGetUserFailure(new AuthApiError("invalid JWT", status, "bad_jwt"))).toBe(
      "token_rejected"
    );
  });

  it("a session that no longer exists is the token refused", () => {
    expect(classifyGetUserFailure(new AuthSessionMissingError())).toBe("token_rejected");
  });

  it("an error of no known shape is the token refused", () => {
    expect(classifyGetUserFailure({ message: "invalid JWT" })).toBe("token_rejected");
    expect(classifyGetUserFailure("nope")).toBe("token_rejected");
    expect(classifyGetUserFailure(null)).toBe("token_rejected");
  });
});
