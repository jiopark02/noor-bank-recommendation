import { existsSync, readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { makeFakeClient, type FakeOptions } from "./householdFakeClient";

/**
 * GET /api/cron/prune-household-invites, executed. The real route, the real
 * pruneHouseholdInvites and the real household store run; faked are the
 * supabase module's configuration predicate and the service-role client
 * (householdFakeClient.ts).
 *
 * Mutations and the test each one turns red:
 *   the bearer check removed, or a client built before it          -> T-P1
 *   an unset or whitespace-only CRON_SECRET let through             -> T-P1
 *   the service-role check removed                                  -> T-P1
 *   a failed or malformed prune answered 200                        -> T-P2
 *   the error text or anything but the code put in the log line     -> T-P2
 *   a cron path with no GET route, or the route's maxDuration
 *     differing from the other cron routes'                         -> T-P3
 */

const SECRET = "sentinel-cron-secret-5e2a";
const SENTINEL_ERROR = "sentinel-prune-error-text-19";

const state = {
  adminConfigured: true,
  adminClientCalls: 0,
  fake: makeFakeClient(),
};

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => {
    throw new Error("the cron route must not build a server client");
  },
  createAdminClient: () => {
    state.adminClientCalls++;
    return state.fake.client;
  },
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

function setFake(options: FakeOptions): void {
  state.fake = makeFakeClient(options);
}

async function call(
  authorization: string | null
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  const { GET } = await import("../../app/api/cron/prune-household-invites/route");
  const res = await GET(
    new Request("https://noor.test/api/cron/prune-household-invites", {
      method: "GET",
      headers,
    }) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
const savedSecret = process.env.CRON_SECRET;

function consoleText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => String(a)).join(" "))
    .join("\n");
}

beforeEach(() => {
  state.adminConfigured = true;
  state.adminClientCalls = 0;
  setFake({ rpc: { household_invites_prune_expired: { data: 3, error: null } } });
  process.env.CRON_SECRET = SECRET;
  spies.push(
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {})
  );
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("prune cron: who may run it", () => {
  it.each([
    ["no header", null],
    ["a different secret", "Bearer not-the-secret"],
    ["the secret without the Bearer scheme", SECRET],
    ["an empty bearer", "Bearer "],
  ])("T-P1 %s is 401 and reaches no client", async (_label, authorization) => {
    const r = await call(authorization);
    expect(r.status).toBe(401);
    expect(state.adminClientCalls).toBe(0);
    expect(state.fake.rpcCalls).toEqual([]);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("T-P1 CRON_SECRET %s is 503 and reaches no client, even with a matching bearer", async (_label, value) => {
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    const r = await call(`Bearer ${value ?? ""}`);
    expect(r.status).toBe(503);
    expect(state.adminClientCalls).toBe(0);
    expect(state.fake.rpcCalls).toEqual([]);
  });

  it("T-P1 without the service-role key: 503 after the bearer check, and no client", async () => {
    state.adminConfigured = false;
    const r = await call(`Bearer ${SECRET}`);
    expect(r.status).toBe(503);
    expect(state.adminClientCalls).toBe(0);
    expect(state.fake.rpcCalls).toEqual([]);
  });

  it("T-P1 the right bearer runs exactly one prune call, with no arguments", async () => {
    const r = await call(`Bearer ${SECRET}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ success: true, deleted: 3 });
    expect(state.fake.rpcCalls).toEqual([["household_invites_prune_expired", {}]]);
    expect(state.fake.queries).toEqual([]);
    expect(consoleText()).toContain("[household-prune] outcome=ok deleted=3");
  });
});

describe("prune cron: failure is not success", () => {
  it.each([
    ["an error", { data: null, error: { code: "P0001", message: SENTINEL_ERROR } }, "code=P0001"],
    ["a throw", "throw" as const, "code=throw"],
    ["a non-number", { data: "3", error: null }, "code=bad_answer"],
    ["a negative count", { data: -1, error: null }, "code=bad_answer"],
    ["a fraction", { data: 1.5, error: null }, "code=bad_answer"],
  ])("T-P2 %s from the call is 500 and logs the code only", async (_label, answer, code) => {
    setFake({ rpc: { household_invites_prune_expired: answer } });
    const r = await call(`Bearer ${SECRET}`);
    expect(r.status).toBe(500);
    expect(r.json.success).toBe(false);
    const text = consoleText();
    expect(text).toContain(`[household-prune] outcome=failed ${code}`);
    expect(text).not.toContain(SENTINEL_ERROR);
    expect(text).not.toContain("sentinel-rpc-throw-text");
    expect(JSON.stringify(r.json)).not.toContain(SENTINEL_ERROR);
  });
});

describe("prune cron: scheduling", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  function routeFile(cronPath: string): string {
    return path.join(ROOT, "src/app", cronPath, "route.ts");
  }

  function maxDuration(source: string): string | null {
    const m = /export const maxDuration = (\d+);/.exec(source);
    return m ? m[1] : null;
  }

  it("T-P3 every cron path has a route exporting GET, the prune route is scheduled, and the cron routes share maxDuration", () => {
    const paths = config.crons.map((c) => c.path);
    expect(paths).toContain("/api/cron/prune-household-invites");
    const durations = new Set<string | null>();
    for (const cronPath of paths) {
      const file = routeFile(cronPath);
      expect(existsSync(file), cronPath).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, cronPath).toMatch(/export async function GET\(/);
      durations.add(maxDuration(source));
    }
    expect(durations.has(null)).toBe(false);
    expect(durations.size).toBe(1);
    const prune = config.crons.find((c) => c.path === "/api/cron/prune-household-invites");
    expect(prune?.schedule).toBe("15 * * * *");
  });
});
