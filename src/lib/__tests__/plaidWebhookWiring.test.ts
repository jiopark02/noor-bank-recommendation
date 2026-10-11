import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe for the webhook wiring.
 *
 * The routes cannot be executed offline, so this file proves only what their
 * TEXT says: that the webhook route hands the request to the tested pipeline,
 * never touches the request URL, and wires the live dependencies the tests
 * assume; and that the cross-user item_id read in plaidApiUtils.ts keeps its
 * item_id filter and two-row limit. (The create-link-token probe lives in
 * plaidWebhookConfig.test.ts.) The
 * behaviour behind that wiring is executed in plaidWebhookReceive.test.ts,
 * plaidWebhook.test.ts and plaidWebhookVerification.test.ts. Whether a deployed
 * Item actually receives webhooks is a live check, not something this file can
 * see.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTE = code(read("../../app/api/plaid/webhook/route.ts"));
const RECEIVE = code(read("../plaidWebhookReceive.ts"));
const HANDLER = code(read("../plaidWebhook.ts"));
const VERIFY = code(read("../plaidWebhookVerification.ts"));
const API_UTILS = code(read("../plaidApiUtils.ts"));

/** The body of one exported async function, up to the next top-level export. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) return "";
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("/api/plaid/webhook wiring", () => {
  it("passes the raw stream to the pipeline and never parses it itself", () => {
    // Red if: the route reads request.json()/text() (the hash would be over a
    // re-serialization) or bypasses receivePlaidWebhook.
    expect(ROUTE).toContain("receivePlaidWebhook(");
    expect(ROUTE).toContain("body: request.body");
    expect(ROUTE).not.toMatch(/request\.(json|text|arrayBuffer|formData)\(/);
  });

  it("verifies with the live verification deps and decides with the live revocation", () => {
    expect(ROUTE).toMatch(/verifyPlaidWebhook\(rawBody, header, liveVerificationDeps\(\)\)/);
    expect(ROUTE).toContain("handlePlaidWebhook(payload");
    expect(ROUTE).toContain("revokeAndDeleteConnection(userId, connection, liveRevocationDeps())");
    expect(ROUTE).toContain("lookupByItemId: getPlaidConnectionsByItemIdAcrossUsers");
    expect(ROUTE).toContain("plaidEnvironment: PLAID_ENVIRONMENT");
    expect(ROUTE).toContain('request.headers.get("plaid-verification")');
  });

  it("verify is called before handle inside the pipeline", () => {
    // Executed in plaidWebhookReceive.test.ts; this pins the source order too.
    const verifyAt = RECEIVE.indexOf("deps.verify(");
    const parseAt = RECEIVE.indexOf("JSON.parse(");
    const handleAt = RECEIVE.indexOf("deps.handle(");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(verifyAt);
    expect(handleAt).toBeGreaterThan(parseAt);
  });

  it("never reads the request URL or its query string", () => {
    // Red if: request.url, nextUrl or searchParams appear in the route or any
    // webhook module (the Preview URL carries a bypass secret).
    for (const source of [ROUTE, RECEIVE, HANDLER, VERIFY]) {
      expect(source).not.toMatch(/request\.url|nextUrl|searchParams/);
      expect(source).not.toContain("new_webhook_url");
    }
  });
});

describe("cross-user item_id read", () => {
  it("filters by item_id and reads at most two rows", () => {
    // Red if: the item_id filter or the two-row limit is removed or changed.
    // This is the one plaid_connections read without a user_id filter, so the
    // item_id filter is its whole scope, and the second row is what lets the
    // handler see an ambiguous Item instead of acting on the first one.
    const body = functionBody(API_UTILS, "getPlaidConnectionsByItemIdAcrossUsers");
    expect(body).not.toBe("");
    expect(body).toContain('.eq("item_id", itemId)');
    expect(body).toContain(".limit(2)");
    expect(body).not.toContain(".maybeSingle(");
    expect(body).not.toContain(".single(");
  });
});
