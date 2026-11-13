import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as screenFetch from "../screenFetchTimeout";
import { BANK_SCREEN_FETCH_TIMEOUT_MS, withFetchTimeout } from "../screenFetchTimeout";
import { MAX_TRANSACTION_PAGES, PLAID_CALL_TIMEOUT_MS } from "../plaidEngineAdapter";

/**
 * How long the bank screens wait for the finance summary, the connection list
 * and a link token (a new connection's or a re-link's).
 *
 * The helper is executed with fake timers. The pages are client pages with no
 * DOM environment here, so their wiring is checked by source probe, as in
 * moneyPageSummaryWiring.test.ts: each request to any of these routes runs inside
 * withFetchTimeout with the one shared limit, passes the signal to fetch, and
 * reads its body inside the same call, so a body that stops arriving is cut
 * too. That an aborted request ends in each screen's existing error state
 * rests on the existing catch and finally blocks; it is confirmed live only.
 *
 * Mutations that turn this file red:
 *   - the timer or the abort removed from withFetchTimeout     -> "aborts …"
 *   - clearTimeout removed                                     -> "leaves no timer …"
 *   - the limit set at or below the sum of one connection's
 *     per-call Plaid header waits, or the adapter's page or
 *     per-call limit raised without it                         -> "outlasts …"
 *   - a second screen timeout constant, or a request given
 *     its own figure                                           -> "one limit …"
 *   - `signal` dropped from a request, a request moved out of
 *     withFetchTimeout, or its body read moved out of it       -> wiring probes
 */

afterEach(() => {
  vi.useRealTimers();
});

/** A run that settles only when its signal aborts, like a fetch with no answer. */
function neverAnswers(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

describe("withFetchTimeout", () => {
  it("aborts the signal at the limit, and not before", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | null = null;
    let settled = false;
    const result = withFetchTimeout(1_000, (signal) => {
      seen = signal;
      return neverAnswers(signal);
    }).then(
      () => "resolved",
      (error: Error) => error.message
    );
    void result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    expect((seen as AbortSignal | null)?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("aborted");
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });

  it("leaves no timer behind when the run answers, or fails, first", async () => {
    vi.useFakeTimers();
    await expect(withFetchTimeout(1_000, async () => "answer")).resolves.toBe("answer");
    expect(vi.getTimerCount()).toBe(0);

    await expect(
      withFetchTimeout(1_000, async () => {
        throw new Error("refused");
      })
    ).rejects.toThrow("refused");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the screens' limit", () => {
  it("outlasts the sum of one connection's per-call Plaid header waits", () => {
    // One connection's calls run one after another: the accounts, up to the
    // page limit of transactions pages, and the recurring streams, each with
    // its wait for the response headers under the adapter's per-call limit.
    // Connections run side by side. The sum leaves out each body's time after
    // its headers, limited only per idle gap, and the route's own reads, which
    // have no limit in code.
    const longestPlaidWait = (MAX_TRANSACTION_PAGES + 2) * PLAID_CALL_TIMEOUT_MS;
    expect(BANK_SCREEN_FETCH_TIMEOUT_MS).toBeGreaterThan(longestPlaidWait);
  });

  it("one limit serves every request: the module exports no other timeout", () => {
    const timeouts = Object.keys(screenFetch).filter((name) => /TIMEOUT/.test(name));
    expect(timeouts).toEqual(["BANK_SCREEN_FETCH_TIMEOUT_MS"]);
  });
});

// ---- wiring (source probe) ---------------------------------------------------

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(relative: string): string {
  return code(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n")
  );
}

function slice(source: string, file: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(`${file}: could not bound \`${from}\` .. \`${to}\`; re-point these anchors.`);
  }
  return source.slice(start, end);
}

/**
 * In `region`, the request to `route` sits inside withFetchTimeout with the
 * shared limit, passes the signal, and its body is read before `after`, the
 * first statement past the timed call.
 */
function expectTimedRequest(
  region: string,
  label: string,
  route: string,
  bodyRead: string,
  after: string
): void {
  const timedAt = region.indexOf("withFetchTimeout(");
  const routeAt = region.indexOf(`"${route}"`);
  const afterAt = region.indexOf(after);
  expect(timedAt, `${label}: withFetchTimeout`).toBeGreaterThan(-1);
  expect(region.slice(timedAt), label).toMatch(
    /^withFetchTimeout\(\s*BANK_SCREEN_FETCH_TIMEOUT_MS,\s*async \(signal\) =>/
  );
  expect(routeAt, `${label}: request inside the timed call`).toBeGreaterThan(timedAt);
  expect(afterAt, `${label}: anchor after the timed call`).toBeGreaterThan(routeAt);

  const inside = region.slice(routeAt, afterAt);
  expect(inside, `${label}: signal passed to the request`).toMatch(/\n\s*signal,\n/);
  expect(inside, `${label}: body read inside the timed call`).toContain(bodyRead);
}

describe("the screens' requests run under the limit", () => {
  const dashboard = read("../../app/dashboard/page.tsx");
  const money = read("../../app/money/page.tsx");
  const hook = read("../../hooks/usePlaidConnections.ts");
  const plaidLink = read("../../components/plaid/PlaidLink.tsx");

  it("bank-link button: a new connection's link token", () => {
    const request = slice(
      plaidLink,
      "PlaidLink",
      "async function requestNewLinkToken(",
      "function LinkSessionRunner("
    );
    expectTimedRequest(
      request,
      "link token",
      "/api/plaid/create-link-token",
      "await response.json()",
      "if (data.success === true)"
    );
  });

  it("connections hook: a re-link's link token", () => {
    const relink = slice(hook, "hook", "const relink =", "return {\n    connections,");
    expectTimedRequest(
      relink,
      "hook relink",
      "/api/plaid/relink",
      "await response.json()",
      "if (!ok)"
    );
  });

  it("dashboard: the connection list", () => {
    const mount = slice(dashboard, "dashboard", "useEffect(() => {", "const fetchLiveMoneyData =");
    expectTimedRequest(
      mount,
      "dashboard connections",
      "/api/plaid/connections",
      "readJsonOrFail(res, CONNECTIONS_LOAD_FAILED)",
      "if (!Array.isArray(payload.connections))"
    );
  });

  it("dashboard: the finance summary", () => {
    const live = slice(dashboard, "dashboard", "const fetchLiveMoneyData =", "useEffect(() => {");
    expectTimedRequest(
      live,
      "dashboard summary",
      "/api/finance/summary",
      "readJsonOrFail(summaryRes, BANK_DATA_LOAD_FAILED)",
      "} catch (err) {"
    );
  });

  it("money: the finance summary", () => {
    const loadSummary = slice(money, "money", "const loadSummary = useCallback(", "const fetchData =");
    expectTimedRequest(
      loadSummary,
      "money summary",
      "/api/finance/summary",
      "readJsonOrFail(res, BANK_DATA_LOAD_FAILED)",
      "const parsed = parseFinanceSummaryResponse(body);"
    );
  });

  it("connections hook: the connection list, written only by the latest read", () => {
    const fetchConnections = slice(hook, "hook", "const fetchConnections =", "const disconnect =");
    expectTimedRequest(
      fetchConnections,
      "hook connections",
      "/api/plaid/connections",
      "await response.json()",
      "if (!ok)"
    );
    expect(hook).toContain("const [requestGate] = useState(createRequestGate);");
    expect(fetchConnections).toMatch(/const token = requestGate\.begin\(\);/);
    for (const write of ["setConnections(list);", "setError(\n", "setIsLoading(false);\n    }"]) {
      const at = fetchConnections.lastIndexOf(write);
      expect(at, write).toBeGreaterThan(-1);
      expect(
        fetchConnections.slice(0, at).lastIndexOf("requestGate.isCurrent(token)"),
        write
      ).toBeGreaterThan(fetchConnections.indexOf("try {"));
    }
  });

  it("no screen request carries a limit of its own", () => {
    for (const [file, source] of [
      ["dashboard", dashboard],
      ["money", money],
      ["hook", hook],
      ["PlaidLink", plaidLink],
    ] as const) {
      expect(source, file).not.toContain("new AbortController(");
      const calls = source.match(/withFetchTimeout\(\s*[^,]+,/g) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.replace(/\s+/g, ""), file).toBe("withFetchTimeout(BANK_SCREEN_FETCH_TIMEOUT_MS,");
      }
    }
  });
});
