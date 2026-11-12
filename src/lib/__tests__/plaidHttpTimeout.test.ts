import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Plaid client's time limits, through real axios.
 *
 * Same harness as plaidAxiosPipeline.test.ts: the real `plaidClient`, imported
 * fresh, sends over axios's real Node http adapter to a loopback server; only
 * the client's `configuration.basePath` is pointed at 127.0.0.1. The loopback
 * server here answers slowly instead of with an error.
 *
 * WHY THE INSTANCE DEFAULT IS LOWERED. Waiting out the real default would make
 * each case take that long. Each case that needs it sets the instance's
 * `defaults.timeout` to a few tens of milliseconds and the server answers
 * later than that, so "the default applies" and "a per-call option overrides
 * it" are both observable in well under a second. The real value is asserted
 * separately, against the exported constant.
 *
 * Mutations that turn this file red:
 *   - the timeout removed from axios.create() in plaid.ts      -> "instance default"
 *   - the SDK no longer dispatching through the instance       -> "default applies"
 *   - per-call options no longer reaching axios (SDK upgrade)  -> "per-call option overrides"
 *   - `{ timeout: 0 }` removed from the itemRemove call        -> "itemRemove has no limit"
 *   - a statusless key-fetch failure classified as `rejected`  -> "webhook key fetch"
 *
 * What it does not prove: anything about TLS, a live Plaid response time, or
 * the platform's function time limit.
 */

const SENTINEL_CLIENT = "SENTINEL_CLIENT_timeout_7a12c0";
const SENTINEL_SECRET = "SENTINEL_SECRET_timeout_c93e51";
const SENTINEL_TOKEN = "SENTINEL_TOKEN_timeout_42fd08";

/** Lowered instance default for the cases that wait it out. */
const SHORT_DEFAULT_MS = 50;
/** How long the slow server waits before answering: well past SHORT_DEFAULT_MS. */
const SLOW_ANSWER_MS = 300;

const KEYS = [
  "PLAID_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "npm_config_proxy",
  "npm_config_http_proxy",
  "npm_config_https_proxy",
] as const;
const PROXY_KEYS = KEYS.slice(3);

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

type MutableConfiguration = { basePath?: string };
type InstanceDefaults = { defaults: { timeout?: unknown } };
type Responder = (req: IncomingMessage, res: ServerResponse) => void;

/** A success body for whichever endpoint was called. */
function successBody(url: string | undefined): unknown {
  switch (url) {
    case "/item/remove":
      return { request_id: "req-remove" };
    case "/webhook_verification_key/get":
      return {
        key: {
          alg: "ES256",
          crv: "P-256",
          kid: "kid-1",
          kty: "EC",
          use: "sig",
          x: "x-coordinate",
          y: "y-coordinate",
          created_at: 1,
          expired_at: null,
        },
        request_id: "req-key",
      };
    default:
      return { accounts: [], item: {}, request_id: "req-accounts" };
  }
}

let original: Record<string, string | undefined> = {};
let plaid: typeof import("../plaid");
let configuration: MutableConfiguration | undefined;
let savedBasePath: string | undefined;
let server: Server | undefined;
let pendingAnswers: Array<ReturnType<typeof setTimeout>> = [];
let answerDelayMs = 0;

function instance(): InstanceDefaults {
  return (plaid.plaidClient as unknown as { axios: InstanceDefaults }).axios;
}

beforeEach(async () => {
  original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_KEYS) setEnv(key, undefined);
  setEnv("PLAID_ENV", "sandbox");
  setEnv("PLAID_CLIENT_ID", SENTINEL_CLIENT);
  setEnv("PLAID_SECRET", SENTINEL_SECRET);

  pendingAnswers = [];
  answerDelayMs = SLOW_ANSWER_MS;
  const respond: Responder = (req, res) => {
    pendingAnswers.push(
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(successBody(req.url)));
      }, answerDelayMs)
    );
  };
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => respond(req, res));
  });
  const listening = server;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    listening.once("error", onError);
    listening.listen(0, "127.0.0.1", () => {
      listening.off("error", onError);
      resolve();
    });
  });
  const { port } = listening.address() as AddressInfo;

  vi.resetModules();
  plaid = await import("../plaid");

  configuration = (
    plaid.plaidClient as unknown as { configuration: MutableConfiguration }
  ).configuration;
  savedBasePath = configuration.basePath;
  configuration.basePath = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const timer of pendingAnswers) clearTimeout(timer);
  pendingAnswers = [];
  if (configuration) configuration.basePath = savedBasePath;
  configuration = undefined;
  if (server) {
    const closing = server;
    server = undefined;
    closing.closeAllConnections();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  for (const key of KEYS) setEnv(key, original[key]);
  vi.resetModules();
});

describe("instance default", () => {
  it("the client's axios instance carries the exported default, and it is a real limit", () => {
    // Red if: the timeout is removed from axios.create(), or set to another value.
    expect(plaid.PLAID_HTTP_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(instance().defaults.timeout).toBe(plaid.PLAID_HTTP_DEFAULT_TIMEOUT_MS);
  });
});

describe("default applies", () => {
  it("a call with no option of its own is cut at the instance default, redacted", async () => {
    // Red if: the SDK stops dispatching through this instance, or the
    // interceptor no longer sees the timeout rejection.
    instance().defaults.timeout = SHORT_DEFAULT_MS;

    const error = (await plaid.plaidClient
      .accountsGet({ access_token: SENTINEL_TOKEN })
      .then(
        () => {
          throw new Error("the Plaid call resolved instead of timing out");
        },
        (reason: unknown) => reason
      )) as Error & Record<string, unknown>;

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ECONNABORTED");
    expect(error.redacted).toBe(true);
    expect(
      (error.plaidDiagnostics as Record<string, unknown> | undefined)?.code
    ).toBe("ECONNABORTED");
    const serialized = `${inspect(error, { depth: null })}\n${JSON.stringify(error)}`;
    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain(SENTINEL_CLIENT);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
  });
});

describe("per-call option overrides the instance default", () => {
  it("{ timeout: 0 } on the call waits past the default and resolves", async () => {
    // Red if: per-call options stop reaching axios's request config.
    instance().defaults.timeout = SHORT_DEFAULT_MS;
    const response = await plaid.plaidClient.accountsGet(
      { access_token: SENTINEL_TOKEN },
      { timeout: 0 }
    );
    expect(response.data.request_id).toBe("req-accounts");
  });

  it("a longer per-call timeout also waits past the default and resolves", async () => {
    instance().defaults.timeout = SHORT_DEFAULT_MS;
    const response = await plaid.plaidClient.accountsGet(
      { access_token: SENTINEL_TOKEN },
      { timeout: SLOW_ANSWER_MS * 5 }
    );
    expect(response.data.request_id).toBe("req-accounts");
  });
});

describe("itemRemove has no limit", () => {
  it("the production itemRemove waits past the instance default and resolves", async () => {
    // Red if: `{ timeout: 0 }` is removed from the itemRemove call in
    // liveRevocationDeps(), so the default applies to a revocation.
    instance().defaults.timeout = SHORT_DEFAULT_MS;
    const { liveRevocationDeps } = await import("../plaidRevocation");
    await expect(liveRevocationDeps().itemRemove(SENTINEL_TOKEN)).resolves.toBe(
      "req-remove"
    );
  });
});

describe("webhook key fetch", () => {
  it("a key fetch cut at the default is `unavailable` (answered 503), never cached as a verdict", async () => {
    // Red if: a failure with no HTTP status is classified as `rejected`.
    instance().defaults.timeout = SHORT_DEFAULT_MS;
    const { liveFetchVerificationKey } = await import("../plaidWebhookVerification");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(liveFetchVerificationKey("kid-1")).resolves.toEqual({
        ok: false,
        kind: "unavailable",
      });
    } finally {
      errors.mockRestore();
    }
  });

  it("the same slow server inside the real default answers a key (control)", async () => {
    // Shows the case above failed on time, not on the response.
    const { liveFetchVerificationKey } = await import("../plaidWebhookVerification");
    const result = await liveFetchVerificationKey("kid-1");
    expect(result.ok).toBe(true);
  });
});
