import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A FAILED PLAID CALL, THROUGH REAL AXIOS — the redaction end to end.
 *
 * Every other Plaid error test builds an axios-shaped error by hand and hands it
 * to the redactor or to the interceptor's handler directly. That copies axios's
 * error shape instead of exercising it: if a future axios changed the
 * AxiosError fields, the `error.config === error.response.config` aliasing,
 * the "Request failed with status code N" message, or where the response
 * interceptor sees the error, those tests would stay green.
 *
 * This file calls a real SDK method on the real `plaidClient` and lets axios
 * send it over its real Node http adapter to a loopback server that answers
 * 400 with a Plaid error body. Nothing in axios is stubbed: the adapter, settle(),
 * the AxiosError and the response interceptor installed in plaid.ts all run as
 * they do in production. Only the destination differs — the client's
 * `configuration.basePath`, which the SDK reads on every call, points at
 * 127.0.0.1 for the duration of each test.
 *
 * WHY THE MODULE IS IMPORTED FRESH. plaid.ts reads PLAID_CLIENT_ID and
 * PLAID_SECRET at import into the Configuration's headers. A static import
 * would bake in whatever the environment held at load — usually "" — and the
 * "no secret in the error" assertions below would pass without a secret ever
 * being sent. The server records what it actually received, and the
 * precondition test asserts the sentinels arrived.
 *
 * WHY THE PROXY VARIABLES ARE CLEARED. axios's http adapter honours
 * HTTP(S)_PROXY / NO_PROXY from the environment. A proxy set on a CI runner or
 * a developer machine could send the request somewhere other than loopback.
 *
 * WHAT IT DOES NOT PROVE. Anything about TLS, redirects, or a live Plaid
 * response; the loopback server is plain HTTP and answers once.
 */

// Fake values. Nothing here is or resembles a real credential.
const SENTINEL_CLIENT = "SENTINEL_CLIENT_pipeline_51c0e7";
const SENTINEL_SECRET = "SENTINEL_SECRET_pipeline_a84d2f";
const SENTINEL_TOKEN = "SENTINEL_TOKEN_pipeline_06be93";

const KEYS = [
  "PLAID_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;
const PROXY_KEYS = KEYS.slice(3);

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

type ReceivedRequest = {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
};

type MutableConfiguration = { basePath?: string };

/** Same deep serialization as plaidClientWiring.test.ts. */
function serializeDeeply(value: unknown): string {
  let asJson = "";
  try {
    asJson = JSON.stringify(value) ?? "";
  } catch {
    asJson = "<not JSON-serializable>";
  }
  return `${inspect(value, { depth: null, showHidden: false })}\n${asJson}`;
}

let original: Record<string, string | undefined> = {};
let plaid: typeof import("../plaid");
let redaction: typeof import("../plaidErrorRedaction");
let configuration: MutableConfiguration | undefined;
let savedBasePath: string | undefined;
let server: Server | undefined;
let received: ReceivedRequest[] = [];

beforeEach(async () => {
  original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_KEYS) setEnv(key, undefined);
  setEnv("PLAID_ENV", "sandbox");
  setEnv("PLAID_CLIENT_ID", SENTINEL_CLIENT);
  setEnv("PLAID_SECRET", SENTINEL_SECRET);

  received = [];
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error_type: "ITEM_ERROR",
          error_code: "ITEM_LOGIN_REQUIRED",
          request_id: "req-1",
        })
      );
    });
  });
  await new Promise<void>((resolve) =>
    server?.listen(0, "127.0.0.1", () => resolve())
  );
  const { port } = server.address() as AddressInfo;

  vi.resetModules();
  plaid = await import("../plaid");
  redaction = await import("../plaidErrorRedaction");

  configuration = (
    plaid.plaidClient as unknown as { configuration: MutableConfiguration }
  ).configuration;
  savedBasePath = configuration.basePath;
  configuration.basePath = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
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

/** Calls the SDK and returns the rejection; a resolution fails the test. */
async function rejectionOfAccountsGet(): Promise<unknown> {
  return plaid.plaidClient.accountsGet({ access_token: SENTINEL_TOKEN }).then(
    () => {
      throw new Error("the Plaid call resolved instead of rejecting");
    },
    (reason: unknown) => reason
  );
}

describe("a failed Plaid call through real axios", () => {
  it("delivered the sentinels to the loopback server (precondition)", async () => {
    await rejectionOfAccountsGet();

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/accounts/get");
    expect(request.headers["plaid-secret"]).toBe(SENTINEL_SECRET);
    expect(request.headers["plaid-client-id"]).toBe(SENTINEL_CLIENT);
    expect(request.body).toContain(SENTINEL_TOKEN);
  });

  it("rejects with axios's own message, redacted", async () => {
    const error = (await rejectionOfAccountsGet()) as Error &
      Record<string, unknown>;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Request failed with status code 400");
    expect(error.redacted).toBe(true);
    expect(error.request).toBeUndefined();
    expect(
      (error.plaidDiagnostics as Record<string, unknown> | undefined)
        ?.error_code
    ).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("keeps the fields callers judge on", async () => {
    const error = await rejectionOfAccountsGet();

    expect(redaction.getPlaidErrorCode(error)).toBe("ITEM_LOGIN_REQUIRED");
    expect(redaction.getPlaidErrorStatus(error)).toBe(400);
  });

  it("carries no credential, including through AxiosError.toJSON()", async () => {
    const error = (await rejectionOfAccountsGet()) as {
      toJSON?: () => unknown;
    };

    const serialized = serializeDeeply(error);
    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain(SENTINEL_CLIENT);
    expect(serialized).not.toContain(SENTINEL_TOKEN);

    expect(error.toJSON).toBeTypeOf("function");
    const asJson = JSON.stringify(error.toJSON?.());
    expect(asJson).not.toContain(SENTINEL_SECRET);
    expect(asJson).not.toContain(SENTINEL_CLIENT);
    expect(asJson).not.toContain(SENTINEL_TOKEN);
  });
});
