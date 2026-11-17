import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe: how the bank-connection screens are wired to plaidConnectFlow.
 * There is no DOM environment here to run the hook or the components; the
 * decisions themselves are executed in plaidConnectFlow.test.ts. What the
 * screen does in a browser is a live check.
 *
 * Mutations that turn this file red:
 *   - the token exchange requested from a screen or a component again   -> "one place asks"
 *   - a bank-connection request built from getSupabaseBearerHeaders()   -> "no request is built from a header that may be empty"
 *   - the link-token request made before the session check              -> "the link token is asked for only with a session"
 *   - the exchange request given a time limit                           -> "the exchange has no time limit"
 *   - the public token, or anything else, written to browser storage
 *     or a cookie from these files                                      -> "no browser storage"
 *   - a log added to the files that hold the token                      -> "no log where the token is held"
 *   - the token kept in the card instead of the screen                  -> "the screen owns the exchange"
 *   - the screen's connection list no longer passed when a token is held -> "the screen owns the exchange"
 *   - the session read under a label shared with other reads            -> "its own label"
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function read(relativeToSrc: string): string {
  return readFileSync(SRC + relativeToSrc, "utf8").replace(/\r\n/g, "\n");
}

/** Comments removed, so assertions are about code and not about prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every source file under src/, tests and API routes left out. */
function clientSources(dir = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(SRC + dir)) {
    const path = dir ? `${dir}/${name}` : name;
    if (path === "app/api" || name === "__tests__") continue;
    if (statSync(SRC + path).isDirectory()) {
      found.push(...clientSources(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

const HOOK = code(read("components/plaid/usePlaidExchange.ts"));
const STATUS = code(read("components/plaid/PlaidExchangeStatus.tsx"));
const PLAID_LINK = code(read("components/plaid/PlaidLink.tsx"));
const FLOW = code(read("lib/plaidConnectFlow.ts"));
const MONEY = code(read("app/money/page.tsx"));

function between(source: string, file: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(`${file}: could not bound \`${from}\` .. \`${to}\`; re-point these anchors.`);
  }
  return source.slice(start, end);
}

describe("one place asks for each bank-connection request", () => {
  const sources = clientSources().map((path) => [path, code(read(path))] as const);
  const asking = (route: string) =>
    sources
      .filter(([, source]) => new RegExp(`fetch\\(\\s*"${route}"`).test(source))
      .map(([path]) => path);

  it("the token exchange is requested by the hook only", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(asking("/api/plaid/exchange-token")).toEqual(["components/plaid/usePlaidExchange.ts"]);
    expect(MONEY).not.toContain("exchange-token");
    expect(PLAID_LINK).not.toContain("exchange-token");
  });

  it("the link token is requested by the Link button only", () => {
    expect(asking("/api/plaid/create-link-token")).toEqual(["components/plaid/PlaidLink.tsx"]);
  });
});

describe("no request is built from a header that may be empty", () => {
  it("the connection files do not call getSupabaseBearerHeaders", () => {
    for (const [file, source] of [
      ["usePlaidExchange", HOOK],
      ["PlaidExchangeStatus", STATUS],
      ["PlaidLink", PLAID_LINK],
      ["plaidConnectFlow", FLOW],
    ] as const) {
      expect(source, file).not.toContain("getSupabaseBearerHeaders");
      expect(source, file).not.toContain("getSessionSafe");
    }
  });

  it("the link token is asked for only with a session", () => {
    const request = between(
      PLAID_LINK,
      "PlaidLink",
      "async function requestNewLinkToken(",
      "function LinkSessionRunner("
    );
    const checked = request.indexOf("if (!session.ok) {");
    const fetched = request.indexOf("fetch(");
    expect(request).toContain("linkTokenSession(");
    expect(request).toContain("await readPlaidSession({");
    expect(checked).toBeGreaterThan(-1);
    expect(fetched).toBeGreaterThan(checked);
    expect(request.slice(checked, fetched)).toMatch(
      /if \(!session\.ok\) \{\s*return \{ ok: false, message: session\.message \};\s*\}/
    );
    expect(request).toContain("Authorization: `Bearer ${session.accessToken}`");
    expect(request.split("fetch(").length - 1).toBe(1);
  });

  it("the exchange is sent with the access token the flow hands over", () => {
    const post = between(HOOK, "usePlaidExchange", "async post(", "async readConnections(");
    expect(post).toContain("Authorization: `Bearer ${accessToken}`");
    expect(HOOK).toContain("createPublicTokenHolder(liveDeps)");
  });
});

describe("the exchange request", () => {
  it("has no time limit", () => {
    const post = between(HOOK, "usePlaidExchange", "async post(", "async readConnections(");
    expect(post).not.toContain("signal");
    expect(post).not.toContain("withFetchTimeout");
    expect(HOOK).not.toContain("AbortController");
    expect(HOOK).not.toContain("setTimeout");
  });

  it("reads the session under its own label", () => {
    expect(HOOK).toContain('readSession(timeoutMs, "plaid-connect", attempt)');
    expect(PLAID_LINK).toContain('readSession(timeoutMs, "plaid-connect", attempt)');
  });
});

describe("the public token stays in memory", () => {
  it("no browser storage or cookie in the files that carry it", () => {
    for (const [file, source] of [
      ["usePlaidExchange", HOOK],
      ["PlaidExchangeStatus", STATUS],
      ["PlaidLink", PLAID_LINK],
      ["plaidConnectFlow", FLOW],
    ] as const) {
      for (const api of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
        expect(source, `${file}: ${api}`).not.toContain(api);
      }
      expect(source, file).not.toMatch(/location\.(href|hash|search)|history\.(push|replace)State/);
    }
  });

  it("no log where the token is held, and none naming it elsewhere", () => {
    expect(FLOW).not.toMatch(/console\./);
    expect(HOOK).not.toMatch(/console\./);
    expect(STATUS).not.toMatch(/console\./);
    for (const [file, source] of [
      ["PlaidLink", PLAID_LINK],
      ["money", MONEY],
    ] as const) {
      expect(source, file).not.toMatch(/console\.\w+\([^;]*publicToken/);
    }
  });

  it("the screen owns the exchange, and hands it to the card and the add button", () => {
    expect(MONEY.split("usePlaidExchange(").length - 1).toBe(1);
    const call = between(MONEY, "money", "usePlaidExchange({", "});");
    expect(call).toContain("userId,");
    expect(call).toContain("knownConnections: plaidConnections.connections,");
    expect(call).toContain("onConnected: handleExchangeConnected,");

    const cards = MONEY.match(/<ConnectBankCard[\s\S]*?\/>/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card).toContain("exchange={bankExchange}");
    }
    expect(MONEY).toMatch(
      /<AddBankButton[\s\S]*?onSuccess=\{bankExchange\.onLinkSuccess\}[\s\S]*?\/>/
    );

    // The card keeps no token and makes no request of its own.
    const card = PLAID_LINK.slice(PLAID_LINK.indexOf("export function ConnectBankCard("));
    expect(card).not.toContain("useState");
    expect(card).not.toContain("useRef");
    expect(card).not.toContain("fetch(");
    expect(card).toContain("onSuccess={exchange.onLinkSuccess}");
    expect(PLAID_LINK).not.toContain("usePlaidExchange(");

    // The list as it was when the token was received goes in with the token.
    expect(HOOK).toMatch(
      /holder\.hold\(\s*publicToken,\s*metadata\.institution,\s*latest\.current\.userId,\s*activeInstitutionIds\(latest\.current\.knownConnections\)\s*\)/
    );
  });

  it("the status block offers the retry only when the flow says the token is held", () => {
    expect(STATUS).toMatch(/\{exchange\.canRetry && \(/);
    expect(STATUS).toContain("onClick={exchange.retry}");
    expect(STATUS).toContain("Try again");
    expect(STATUS).toContain("{EXCHANGE_IN_PROGRESS_LABEL}");
  });
});
