import { inspect } from "node:util";
import axios from "axios";
import { describe, it, expect } from "vitest";
import { plaidClient } from "../plaid";

/**
 * PLAID-SEC1 — the WIRING half of the guarantee.
 *
 * `plaidErrorRedaction.test.ts` proves the redactor is correct. Correct and
 * unreachable is worth nothing: the redaction is a property of the axios
 * instance passed as PlaidApi's third constructor argument, not of the Plaid
 * SDK. If that signature moves in a `plaid` upgrade, or someone writes
 * `new PlaidApi(configuration)` without the third argument, the client falls
 * back to the global axios, the interceptor silently stops running, and the
 * secret returns to the logs — with every existing test still green. This file
 * is the check that fails in that case.
 *
 * Importing `../plaid` runs that module's side effects (Configuration, the
 * axios instance, the interceptor registration, the PlaidApi construction).
 * That is the point — it is what we are asserting on. It is also offline: no
 * client method is called anywhere in this file, so no request is ever made to
 * Plaid. The interceptor's handlers are invoked directly, with local fixtures.
 *
 * IF THIS FILE FAILS, IT IS ONE OF TWO THINGS — AND ONLY ONE IS A SECURITY BUG
 * (a) A wiring regression: the third constructor argument stopped being passed
 *     or stopped being honored. That IS the leak this file exists to catch.
 * (b) An axios/plaid internal-shape change: this file reaches into undocumented
 *     internals (`client.axios`, `interceptors.response.handlers`), which a
 *     minor upgrade may rename or restructure. That is NOT a security
 *     regression — the real defense is the interceptor registered in
 *     `plaid.ts`, and it keeps running regardless of what this file can see.
 * Establish which one before treating a red build as an incident. The failure
 * modes are distinguishable: under (a) the handler list is empty or the client
 * dispatches through the global axios; under (b) the property path itself is
 * gone or is no longer an array.
 *
 * WHAT THE SENTINEL ASSERTIONS DO AND DO NOT PROVE
 * The `not.toContain(SENTINEL_*)` checks below prove that the handler installed
 * on the client routes rejections through the redactor rather than passing them
 * through — they are a wiring probe, not an end-to-end proof that no secret can
 * escape. Proving the absence of a leak across the redactor's input space
 * (nested config, odd payload shapes, frozen or exotic errors, the fail-closed
 * path) belongs to `plaidErrorRedaction.test.ts`, and stays there. Do not read
 * a green run here as "no Plaid error can leak a credential".
 */

// Fake values. Nothing here is or resembles a real credential.
const SENTINEL_SECRET = "SENTINEL_SECRET_wiring_9f21c4";
const SENTINEL_TOKEN = "SENTINEL_TOKEN_wiring_3d80ab";

type InterceptorHandler = {
  fulfilled?: ((value: unknown) => unknown) | null;
  rejected?: ((error: unknown) => unknown) | null;
};

type InspectableAxios = {
  interceptors?: {
    request?: { handlers?: Array<InterceptorHandler | null> };
    response?: { handlers?: Array<InterceptorHandler | null> };
  };
};

/** The instance the SDK will actually dispatch through (`BaseAPI.axios`). */
function getDispatchAxios(): InspectableAxios | undefined {
  return (plaidClient as unknown as { axios?: InspectableAxios }).axios;
}

/** Registered handlers, minus the null holes `eject()` leaves behind. */
function liveHandlers(
  manager: { handlers?: Array<InterceptorHandler | null> } | undefined
): InterceptorHandler[] {
  return (manager?.handlers ?? []).filter(
    (handler): handler is InterceptorHandler => handler != null
  );
}

function makeAxiosLikeError(): Error & Record<string, unknown> {
  const config: Record<string, unknown> = {
    url: "https://sandbox.plaid.com/accounts/get",
    method: "post",
    headers: { "PLAID-SECRET": SENTINEL_SECRET },
    data: JSON.stringify({ access_token: SENTINEL_TOKEN }),
  };

  const error = new Error("Request failed with status code 400") as Error &
    Record<string, unknown>;
  error.name = "AxiosError";
  error.isAxiosError = true;
  error.code = "ERR_BAD_REQUEST";
  error.config = config;
  error.request = { _header: `PLAID-SECRET: ${SENTINEL_SECRET}` };
  error.response = {
    status: 400,
    statusText: "Bad Request",
    // Same object as `error.config`, as axios's settle.js builds it.
    config,
    request: { _header: `PLAID-SECRET: ${SENTINEL_SECRET}` },
    data: { error_code: "ITEM_LOGIN_REQUIRED", request_id: "req_wiring_1" },
  };
  return error;
}

function serializeDeeply(value: unknown): string {
  let asJson = "";
  try {
    asJson = JSON.stringify(value) ?? "";
  } catch {
    asJson = "<not JSON-serializable>";
  }
  return `${inspect(value, { depth: null, showHidden: false })}\n${asJson}`;
}

describe("plaidClient wiring — the interceptor is actually installed", () => {
  it("dispatches through a dedicated axios instance, not the global one", () => {
    const dispatchAxios = getDispatchAxios();

    // Undefined here means the third constructor argument stopped being honored.
    expect(dispatchAxios).toBeDefined();
    expect(dispatchAxios).not.toBe(axios);
    expect(dispatchAxios?.interceptors?.response).toBeDefined();
  });

  it("registers exactly one response interceptor and no request interceptor", () => {
    const dispatchAxios = getDispatchAxios();

    // Exactly 1, not "at least 1": the redactor is the only response
    // interceptor today, and adding a legitimate second one (a retry, say) is
    // meant to turn this red so the addition gets reviewed against the
    // redaction guarantee rather than landing unnoticed.
    expect(liveHandlers(dispatchAxios?.interceptors?.response)).toHaveLength(1);
    // Header injection, body serialization and URL assembly must stay the SDK's.
    expect(liveHandlers(dispatchAxios?.interceptors?.request)).toHaveLength(0);
  });

  it("passes successful responses through untouched", () => {
    const [handler] = liveHandlers(
      getDispatchAxios()?.interceptors?.response
    );
    const response = { status: 200, data: { accounts: [] } };

    expect(handler.fulfilled).toBeTypeOf("function");
    expect(handler.fulfilled?.(response)).toBe(response);
  });

  it("routes rejections through the redactor and still rejects", async () => {
    const [handler] = liveHandlers(
      getDispatchAxios()?.interceptors?.response
    );
    expect(handler.rejected).toBeTypeOf("function");

    const settled = handler.rejected?.(makeAxiosLikeError());

    // It must be a rejected promise: swallowing the error, or resolving it,
    // would turn a failed Plaid call into a silent success.
    const rejection = await Promise.resolve(settled).then(
      () => {
        throw new Error("the failure handler resolved instead of rejecting");
      },
      (reason: unknown) => reason
    );

    // And the rejected value must be the redacted error — this is what proves
    // the handler installed on the client is our redactor and not a passthrough.
    const serialized = serializeDeeply(rejection);
    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
    expect((rejection as Record<string, unknown>).redacted).toBe(true);
    expect((rejection as Record<string, unknown>).request).toBeUndefined();
    // Guard against a false pass on an empty or unrelated rejection value.
    expect((rejection as Error).message).toBe(
      "Request failed with status code 400"
    );
    expect(serialized).toContain("/accounts/get");
  });
});
