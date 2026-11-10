import { inspect } from "node:util";
import { CanceledError } from "axios";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * getPlaidChatState takes an optional AbortSignal and hands it to the two
 * kinds of call it makes: the plaid_connections read and each Plaid accounts
 * call. The chat route passes one so that a read it has stopped waiting for is
 * cancelled, not left running.
 *
 * The signal is a per-call option. Without one, both calls are made exactly
 * as they were before the option existed.
 *
 * Only the server-client factory, the Plaid client and the token decrypt are
 * faked. vi.mock replaces each module for every importer in this file's graph.
 *
 * After the signal is aborted, the connections not yet read are left alone,
 * and the one cancelled call is logged by its message only: the request
 * config a cancel error carries, with the Plaid secret and the access token
 * in it, never reaches a log line. That holds here without the Plaid client's
 * own redaction, which this file replaces with a fake.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * That PostgREST or the Plaid SDK stops the request when the signal aborts.
 * It holds that the signal reaches them. It also does not run the real Plaid
 * client, so it says nothing about what its interceptor does to a cancel
 * error (plaidAxiosPipeline.test.ts and plaidErrorRedaction.test.ts cover
 * that interceptor).
 */

const { createServerClientMock, accountsGetMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  accountsGetMock: vi.fn(),
}));

vi.mock("../supabase", () => ({
  createServerClient: createServerClientMock,
}));

vi.mock("../plaid", () => ({
  plaidClient: { accountsGet: accountsGetMock },
  isPlaidConfigured: () => true,
}));

vi.mock("../plaidTokenCrypto", () => ({
  decryptPlaidAccessToken: (stored: string) => `plain:${stored}`,
}));

import { getPlaidChatState } from "../plaidChatState";

const ROWS = [
  { institution_name: "Test Bank", status: "active", access_token: "v1:a" },
  { institution_name: "Second Bank", status: "active", access_token: "v1:b" },
];

/**
 * supabase.from(...).select(...).eq(...).order(...) -> a query that answers
 * `result` when awaited, with or without .abortSignal(signal) after it.
 */
function clientResolving(result: { data: unknown; error: unknown }) {
  const abortSignal = vi.fn(() => Promise.resolve(result));
  const query = Object.assign(Promise.resolve(result), { abortSignal });
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => query);
  return { client: { from: vi.fn(() => builder) }, abortSignal };
}

function accountsResponse() {
  return {
    data: {
      accounts: [
        {
          name: "Everyday Checking",
          type: "depository",
          subtype: "checking",
          balances: { current: 812.34, available: 790.12, iso_currency_code: "USD" },
        },
      ],
    },
  };
}

describe("getPlaidChatState — the optional signal", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    accountsGetMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("without a signal, the connection read and the accounts calls take no extra option", async () => {
    const stub = clientResolving({ data: ROWS, error: null });
    createServerClientMock.mockReturnValue(stub.client);
    accountsGetMock.mockResolvedValue(accountsResponse());

    const state = await getPlaidChatState("user_1", { depth: "balances" });

    expect(stub.abortSignal).not.toHaveBeenCalled();
    expect(accountsGetMock.mock.calls).toEqual([
      [{ access_token: "plain:v1:a" }],
      [{ access_token: "plain:v1:b" }],
    ]);
    expect(state.accounts).toHaveLength(2);
  });

  it("with a signal, the connection read is given it", async () => {
    const stub = clientResolving({ data: [], error: null });
    createServerClientMock.mockReturnValue(stub.client);
    const { signal } = new AbortController();

    await getPlaidChatState("user_1", { depth: "connection", signal });

    expect(stub.abortSignal.mock.calls).toEqual([[signal]]);
    expect(accountsGetMock).not.toHaveBeenCalled();
  });

  it("with a signal, every accounts call is given it as a request option", async () => {
    const stub = clientResolving({ data: ROWS, error: null });
    createServerClientMock.mockReturnValue(stub.client);
    accountsGetMock.mockResolvedValue(accountsResponse());
    const { signal } = new AbortController();

    await getPlaidChatState("user_1", { depth: "balances", signal });

    expect(accountsGetMock.mock.calls).toEqual([
      [{ access_token: "plain:v1:a" }, { signal }],
      [{ access_token: "plain:v1:b" }, { signal }],
    ]);
  });

  it("a cancelled connection read throws, like any other failed read", async () => {
    const stub = clientResolving({
      data: null,
      error: { message: "AbortError: This operation was aborted" },
    });
    createServerClientMock.mockReturnValue(stub.client);
    const { signal } = new AbortController();

    await expect(
      getPlaidChatState("user_1", { depth: "connection", signal })
    ).rejects.toThrow("failed to read plaid_connections");
  });

});

describe("getPlaidChatState — after the signal is aborted", () => {
  const SECRET_MARKER = "PLAID-SECRET-MARKER";
  const TOKEN_MARKER = "ACCESS-TOKEN-MARKER";

  /**
   * The error axios rejects with when a request is cancelled, as it is before
   * the Plaid client's interceptor has touched it: it carries the request
   * config, with the secret in a header and the access token in the body.
   */
  function cancelError(): CanceledError<unknown> {
    return new CanceledError(null, {
      url: "https://sandbox.plaid.com/accounts/get",
      method: "post",
      headers: { "PLAID-CLIENT-ID": "client", "PLAID-SECRET": SECRET_MARKER },
      data: JSON.stringify({ access_token: TOKEN_MARKER }),
    } as never);
  }

  /** Every console call, each argument rendered in full depth. */
  function consoleText(): string {
    const parts: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      for (const args of vi.mocked(console[method]).mock.calls) {
        for (const arg of args) {
          parts.push(typeof arg === "string" ? arg : inspect(arg, { depth: 20 }));
          try {
            parts.push(JSON.stringify(arg) ?? "");
          } catch {
            // Not serializable: the inspect above already rendered it.
          }
        }
      }
    }
    return parts.join("\n");
  }

  beforeEach(() => {
    createServerClientMock.mockReset();
    accountsGetMock.mockReset();
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the fixture carries both markers, so their absence below means something", () => {
    const rendered = inspect(cancelError(), { depth: 20 });
    expect(rendered).toContain(SECRET_MARKER);
    expect(rendered).toContain(TOKEN_MARKER);
  });

  it("a cancelled accounts call logs one line, with no request config, secret or access token", async () => {
    const stub = clientResolving({ data: ROWS, error: null });
    createServerClientMock.mockReturnValue(stub.client);
    const controller = new AbortController();
    accountsGetMock.mockImplementation(async () => {
      controller.abort();
      throw cancelError();
    });

    await getPlaidChatState("user_1", {
      depth: "balances",
      signal: controller.signal,
    });

    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ["[plaid-state] accountsGet failed for a connection; skipping it:", "canceled"],
    ]);
    const logged = consoleText();
    expect(logged).not.toContain(SECRET_MARKER);
    expect(logged).not.toContain(TOKEN_MARKER);
    expect(logged).not.toContain("headers");
  });

  it("the connections after the cancelled one are not read", async () => {
    const stub = clientResolving({ data: ROWS, error: null });
    createServerClientMock.mockReturnValue(stub.client);
    const controller = new AbortController();
    accountsGetMock.mockImplementation(async () => {
      controller.abort();
      throw cancelError();
    });

    const state = await getPlaidChatState("user_1", {
      depth: "balances",
      signal: controller.signal,
    });

    expect(accountsGetMock).toHaveBeenCalledTimes(1);
    // Why a caller that cancels must not use the result: the state says
    // "connected" with no accounts. The chat route has already left through
    // the deadline by then (chatRouteDeadline.test.ts).
    expect(state.connected).toBe(true);
    expect(state.accounts).toEqual([]);
  });

  it("a signal aborted before the accounts read makes no accounts call and logs nothing", async () => {
    const stub = clientResolving({ data: ROWS, error: null });
    createServerClientMock.mockReturnValue(stub.client);
    const controller = new AbortController();
    controller.abort();

    await getPlaidChatState("user_1", {
      depth: "balances",
      signal: controller.signal,
    });

    expect(accountsGetMock).not.toHaveBeenCalled();
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
  });

  it("without a signal, a failed connection is still skipped and the next one read", async () => {
    const stub = clientResolving({ data: ROWS, error: null });
    createServerClientMock.mockReturnValue(stub.client);
    accountsGetMock
      .mockRejectedValueOnce(cancelError())
      .mockResolvedValueOnce(accountsResponse());

    const state = await getPlaidChatState("user_1", { depth: "balances" });

    expect(accountsGetMock).toHaveBeenCalledTimes(2);
    expect(state.accounts).toHaveLength(1);
    expect(consoleText()).not.toContain(SECRET_MARKER);
    expect(consoleText()).not.toContain(TOKEN_MARKER);
  });
});
