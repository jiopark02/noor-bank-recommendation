import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/chat with bank data another household member shares, executed.
 *
 * The route, the prompt builder, the egress policy, the household-turn check
 * and the shared block builder run for real. Faked: authentication, the admin
 * client, the usage ledger, LLM call logging, the crisis count, OpenRouter
 * (fetch, whose request body is captured), the user's own bank read, the
 * shared list and read (plaidChatState), and the memory module's session,
 * save and lookup functions, each scripted per call. The memory module's
 * error classes are the real ones.
 *
 * Mutations and the test each one turns red:
 *   the switch not checked, or read with trimming or case folding       -> T14
 *   the one-line notice or anything else added when nothing is shared   -> T15
 *   the household-shared channel not raising the user's read to
 *     balances, or the shared block not added                           -> T16
 *   the shared data read on a turn that is not about the household      -> T17
 *   a turn that carried shared data saved through saveMessages          -> T18
 *   the sources saved other than the read's own list                    -> T19
 *   sharing that ended answered 200 with the reply, or looked up by id  -> T20
 *   the move to a new session not saving through saveSharedTurn with
 *     the same ids and sources                                          -> T21
 *   a busy save looked up by id, or answered other than SAVE_FAILED     -> T22
 *   the shared list read under AI_PLAID_STATE=off                       -> T23
 *   a greeting reading the shared data                                  -> T24
 *   a session already marked not treated as a household turn            -> T25
 *
 * WHAT THIS FILE DOES NOT PROVE
 * What the database function decides (chatSharedTurnSaveMigrationProbe and
 * live checks), what the shared read returns (chatSharedState.test.ts), or
 * what saveSharedTurn sends (aiMemorySaveSharedTurn.test.ts).
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000002";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SHARED_HEADING = "## What a household member shares with this user";
const NOTICE_HEADING = "## Household sharing";
const OWN_HEADING = "## What you can see this turn";

const LIST = {
  connections: [
    {
      ownerUserId: OWNER,
      connectionId: 7001,
      row: { access_token: "stored", item_id: "item-1", institution_name: "Heron Bank" },
    },
  ],
  firstNames: { [OWNER]: "Alex" } as Record<string, string | null>,
};

const READ = {
  state: {
    owners: [
      {
        firstName: "Alex",
        connections: [
          { institution: "Heron Bank", status: "active" as const, read: "read" as const },
          { institution: "Quokka CU", status: "active" as const, read: "not_read" as const },
        ],
        accounts: [
          {
            label: "Joint Checking",
            kind: "checking",
            balanceStatus: "known" as const,
            current: 1500,
            currency: "USD",
          },
        ],
      },
    ],
  },
  sources: [
    { ownerUserId: OWNER, connectionId: 7001 },
    { ownerUserId: OWNER, connectionId: 7002 },
  ],
};

type SaveStep = "ok" | "closed" | "ended" | "busy";

const state = {
  memory: true,
  list: LIST as typeof LIST | "fail",
  read: READ as typeof READ | "fail",
  marked: null as string | null | "fail",
  sharedSaves: [] as SaveStep[],
};

const seen = {
  own: [] as Array<{ depth: string }>,
  lists: [] as string[],
  reads: [] as Array<{ userId: string; list: unknown }>,
  marks: [] as Array<[string, string]>,
  saveMessages: [] as Array<{ sessionId: string; ids?: { user: string; assistant: string } }>,
  sharedSaves: [] as Array<{
    sessionId: string;
    userId: string;
    sources: unknown;
    ids: { user: string; assistant: string };
  }>,
  lookups: 0,
  sessionReads: 0,
};

function chain(result: { data: unknown; error: null }): unknown {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (onFulfilled: (v: unknown) => unknown, onRejected: (r: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected);
        }
        return () => builder;
      },
    }
  );
  return builder;
}

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async () => ({ allowed: true, limit: null, retryAt: null }),
  settleChatUsage: async () => undefined,
}));

vi.mock("@/lib/crisisNoticeTally", () => ({
  recordCrisisNotice: async () => undefined,
}));

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => USER_ID,
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({ from: () => chain({ data: null, error: null }) }),
  isSupabaseAdminConfigured: () => true,
  isSupabaseConfigured: () => false,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async () => undefined,
}));

vi.mock("@/lib/aiMemory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiMemory")>();
  return {
    SessionClosedError: actual.SessionClosedError,
    SharedSourceEndedError: actual.SharedSourceEndedError,
    SharedTurnBusyError: actual.SharedTurnBusyError,
    isSessionClosedError: actual.isSessionClosedError,
    isAiMemoryEnabled: () => state.memory,
    getOrCreateActiveSession: async () => {
      seen.sessionReads += 1;
      return { id: seen.sessionReads === 1 ? SESSION_A : SESSION_B };
    },
    getActiveSession: async () => ({ id: SESSION_A }),
    buildMemoryContext: async () => ({ facts: [], recentSummaries: [], activeSessionId: SESSION_A }),
    formatMemoryForPrompt: () => "",
    getSessionMessages: async () => [],
    getEarliestSharedSourceTime: async (sessionId: string, userId: string) => {
      seen.marks.push([sessionId, userId]);
      if (state.marked === "fail") throw new Error("mark read failed");
      return state.marked;
    },
    saveMessages: async (
      sessionId: string,
      _userId: string,
      _pair: unknown,
      options?: { ids?: { user: string; assistant: string } }
    ) => {
      seen.saveMessages.push({ sessionId, ids: options?.ids });
      return {};
    },
    saveSharedTurn: async (
      sessionId: string,
      userId: string,
      _pair: unknown,
      sources: unknown,
      options: { ids: { user: string; assistant: string } }
    ) => {
      seen.sharedSaves.push({ sessionId, userId, sources, ids: options.ids });
      const step = state.sharedSaves.shift() ?? "ok";
      if (step === "closed") throw new actual.SessionClosedError();
      if (step === "ended") throw new actual.SharedSourceEndedError();
      if (step === "busy") throw new actual.SharedTurnBusyError();
    },
    findSavedTurn: async () => {
      seen.lookups += 1;
      return null;
    },
  };
});

vi.mock("@/lib/plaidChatState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plaidChatState")>();
  return {
    SharedChatReadError: actual.SharedChatReadError,
    getPlaidChatState: async (_userId: string, opts: { depth: string }) => {
      seen.own.push({ depth: opts.depth });
      return {
        depth: opts.depth,
        connected: true,
        connections: [
          opts.depth === "balances"
            ? { institution: "Own Bank", status: "active", read: "read" }
            : { institution: "Own Bank", status: "active" },
        ],
        accounts:
          opts.depth === "balances"
            ? [{ label: "Own Checking", kind: "checking", balanceStatus: "known", current: 20, currency: "USD" }]
            : undefined,
      };
    },
    listSharedForChat: async (userId: string) => {
      seen.lists.push(userId);
      if (state.list === "fail") throw new actual.SharedChatReadError("list", "42501");
      return state.list;
    },
    readSharedForChat: async (userId: string, list: unknown) => {
      seen.reads.push({ userId, list });
      if (state.read === "fail") throw new actual.SharedChatReadError("recheck", "57014");
      return state.read;
    },
  };
});

let bodies: string[] = [];
let infoLines: unknown[][] = [];
let warnLines: unknown[][] = [];
let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

beforeEach(() => {
  state.memory = true;
  state.list = LIST;
  state.read = READ;
  state.marked = null;
  state.sharedSaves = [];
  seen.own = [];
  seen.lists = [];
  seen.reads = [];
  seen.marks = [];
  seen.saveMessages = [];
  seen.sharedSaves = [];
  seen.lookups = 0;
  seen.sessionReads = 0;
  bodies = [];
  infoLines = [];
  warnLines = [];
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-fake");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
  vi.stubEnv("OPENROUTER_SIMPLE_MODEL", "");
  vi.stubEnv("OPENROUTER_COMPLEX_MODEL", "");
  vi.stubEnv("AI_PLAID_STATE", "connection");
  vi.stubEnv("AI_SUPABASE_READ_ENABLED", "");
  vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "");
  vi.stubEnv("AI_HOUSEHOLD_SHARED_STATE", "on");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body);
      bodies.push(body);
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model: (JSON.parse(body) as { model: string }).model,
          choices: [{ message: { content: "assistant reply" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    infoLines.push(args);
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnLines.push(args);
  });
  for (const method of ["log", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function post(text: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await POST(
    new Request("https://noor.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function systemMessage(body: string): string {
  return (JSON.parse(body) as { messages: Array<{ role: string; content: string }> }).messages[0]
    .content;
}

function sharedLines(): unknown[][] {
  return infoLines.filter((args) => String(args[0]).indexOf("[chat-shared]") === 0);
}

const HOUSEHOLD = "Can my partner and I afford a bigger apartment?";
const GENERAL = "What is an index fund?";

async function bodyWithSwitch(value: string | undefined, text: string): Promise<string> {
  if (value === undefined) vi.stubEnv("AI_HOUSEHOLD_SHARED_STATE", undefined as unknown as string);
  else vi.stubEnv("AI_HOUSEHOLD_SHARED_STATE", value);
  bodies = [];
  expect((await post(text)).status).toBe(200);
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

describe("the switch (T14)", () => {
  it.each(["", "off", "ON", " on", "on ", "true"])(
    "AI_HOUSEHOLD_SHARED_STATE=%j reads nothing shared and sends the request it sends unset",
    async (value) => {
      const unset = await bodyWithSwitch(undefined, HOUSEHOLD);
      const other = await bodyWithSwitch(value, HOUSEHOLD);
      expect(other).toBe(unset);
      expect(seen.lists).toEqual([]);
      expect(seen.reads).toEqual([]);
      expect(seen.marks).toEqual([]);
      expect(seen.sharedSaves).toEqual([]);
      expect(seen.saveMessages).toHaveLength(2);
      expect(systemMessage(other)).not.toContain(SHARED_HEADING);
      expect(systemMessage(other)).not.toContain(NOTICE_HEADING);
      expect(sharedLines()).toEqual([]);
    }
  );
});

describe("nothing shared (T15)", () => {
  it.each([HOUSEHOLD, GENERAL, "hi", "What does Alex have?"])(
    "with the switch on and nothing shared, %j sends the request it sends with the switch unset",
    async (text) => {
      state.list = { connections: [], firstNames: {} };
      const unset = await bodyWithSwitch(undefined, text);
      const on = await bodyWithSwitch("on", text);
      expect(on).toBe(unset);
      // Not only equal to the unset request: neither shared-data section is
      // in it, whatever the unset request carries.
      expect(on).not.toContain(NOTICE_HEADING);
      expect(on).not.toContain("## What a household member shares");
      expect(seen.lists).toEqual([USER_ID]);
      expect(seen.reads).toEqual([]);
      expect(seen.marks).toEqual([]);
      expect(seen.sharedSaves).toEqual([]);
    }
  );
});

describe("a household turn (T16, T18, T19)", () => {
  it("T16 reads the user's balances and the shared data, and adds the shared block after the user's own", async () => {
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    expect(seen.own).toEqual([{ depth: "balances" }]);
    expect(seen.reads).toEqual([{ userId: USER_ID, list: LIST }]);
    const system = systemMessage(bodies[0]);
    const own = system.indexOf(OWN_HEADING);
    const shared = system.indexOf(SHARED_HEADING);
    expect(own).toBeGreaterThan(-1);
    expect(shared).toBeGreaterThan(own);
    expect(system).toContain("Shared by Alex:");
    expect(system).toContain("- Joint Checking (checking): balance $1,500.00 USD");
    expect(system).not.toContain(NOTICE_HEADING);
  });

  it("T18 saves through saveSharedTurn only, with ids the route chose", async () => {
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    expect(res.json.sessionId).toBe(SESSION_A);
    expect(seen.saveMessages).toEqual([]);
    expect(seen.sharedSaves).toHaveLength(1);
    expect(seen.sharedSaves[0].sessionId).toBe(SESSION_A);
    expect(seen.sharedSaves[0].userId).toBe(USER_ID);
    expect(seen.sharedSaves[0].ids.user).toMatch(UUID_V4);
    expect(seen.sharedSaves[0].ids.assistant).toMatch(UUID_V4);
  });

  it("T19 records every connection the block names, a bank not read included", async () => {
    await post(HOUSEHOLD);
    expect(seen.sharedSaves[0].sources).toEqual(READ.sources);
  });

  it("the sharing member's first name alone makes a household turn", async () => {
    await post("Does Alex have enough saved?");
    expect(seen.reads).toHaveLength(1);
    expect(seen.sharedSaves).toHaveLength(1);
  });

  it("writes one [chat-shared] line of counts and flags only", async () => {
    await post(HOUSEHOLD);
    expect(sharedLines()).toEqual([
      [
        "[chat-shared] listed=%d household=%s marked=%s allowed=%s sources=%d notice=%d",
        1,
        true,
        false,
        true,
        2,
        0,
      ],
    ]);
    const text = JSON.stringify([...infoLines, ...warnLines]);
    for (const fragment of ["Alex", "Heron", "Joint Checking", "1500", OWNER]) {
      expect(text).not.toContain(fragment);
    }
  });

  it("with memory off, the shared block is sent and nothing is saved", async () => {
    state.memory = false;
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    expect(systemMessage(bodies[0])).toContain(SHARED_HEADING);
    expect(seen.marks).toEqual([]);
    expect(seen.sharedSaves).toEqual([]);
    expect(seen.saveMessages).toEqual([]);
  });
});

describe("a turn that is not about the household (T17)", () => {
  it("reads nothing shared, adds the one-line notice, saves as before, and counts the notice", async () => {
    const res = await post(GENERAL);
    expect(res.status).toBe(200);
    expect(seen.reads).toEqual([]);
    expect(seen.own).toEqual([{ depth: "connection" }]);
    const system = systemMessage(bodies[0]);
    expect(system).toContain(NOTICE_HEADING);
    expect(system).not.toContain(SHARED_HEADING);
    expect(system).not.toContain("Alex");
    expect(system).not.toContain("Heron");
    expect(seen.sharedSaves).toEqual([]);
    expect(seen.saveMessages).toHaveLength(1);
    const lines = sharedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0][lines[0].length - 1]).toBe(1);
  });

  it.each(["we need to save more", "can you tell us about budgets", "we're behind on rent"])(
    "%j alone is not about the household",
    async (text) => {
      await post(text);
      expect(seen.reads).toEqual([]);
      expect(systemMessage(bodies[0])).toContain(NOTICE_HEADING);
    }
  );
});

describe("saving when the save is refused (T20, T21, T22)", () => {
  it("T20 sharing that ended: 409 SHARED_DATA_ENDED, no reply, no lookup by id", async () => {
    state.sharedSaves = ["ended"];
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({
      error: "Could not save your conversation. Please try sending your message again.",
      code: "SHARED_DATA_ENDED",
    });
    expect(seen.lookups).toBe(0);
    expect(seen.sharedSaves).toHaveLength(1);
  });

  it("T21 a closed session: saved again through saveSharedTurn in the open session, same ids and sources", async () => {
    state.sharedSaves = ["closed", "ok"];
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    expect(res.json.sessionId).toBe(SESSION_B);
    expect(seen.sharedSaves.map((s) => s.sessionId)).toEqual([SESSION_A, SESSION_B]);
    expect(seen.sharedSaves[1].ids).toEqual(seen.sharedSaves[0].ids);
    expect(seen.sharedSaves[1].sources).toEqual(seen.sharedSaves[0].sources);
    expect(seen.saveMessages).toEqual([]);
  });

  it("T22 busy twice (as saveSharedTurn reports it): 500 SAVE_FAILED with no lookup by id", async () => {
    state.sharedSaves = ["busy"];
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({
      error: "Could not save your conversation. Please try sending your message again.",
      code: "SAVE_FAILED",
    });
    expect(seen.lookups).toBe(0);
    expect(seen.sharedSaves).toHaveLength(1);
  });
});

describe("what closes the shared data (T23, T24)", () => {
  it("T23 AI_PLAID_STATE=off: nothing of the user's or the member's is read, and no notice", async () => {
    vi.stubEnv("AI_PLAID_STATE", "off");
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    expect(seen.lists).toEqual([]);
    expect(seen.own).toEqual([]);
    expect(seen.reads).toEqual([]);
    const system = systemMessage(bodies[0]);
    expect(system).not.toContain(SHARED_HEADING);
    expect(system).not.toContain(NOTICE_HEADING);
    expect(sharedLines()).toEqual([]);
  });

  it("T24 a greeting reads nothing shared, even in a marked session, and gets the notice", async () => {
    state.marked = "2026-11-20 10:00:00.123456+00";
    await post("hi");
    expect(seen.reads).toEqual([]);
    expect(seen.own).toEqual([{ depth: "connection" }]);
    expect(systemMessage(bodies[0])).toContain(NOTICE_HEADING);
    expect(seen.sharedSaves).toEqual([]);
  });
});

describe("a session already marked (T25)", () => {
  it("is a household turn whatever the message says, and is saved through saveSharedTurn", async () => {
    state.marked = "2026-11-20 10:00:00.123456+00";
    await post(GENERAL);
    expect(seen.marks).toEqual([[SESSION_A, USER_ID]]);
    expect(seen.reads).toHaveLength(1);
    expect(systemMessage(bodies[0])).toContain(SHARED_HEADING);
    expect(seen.sharedSaves).toHaveLength(1);
  });

  it("a mark that cannot be read counts as unmarked: the words decide", async () => {
    state.marked = "fail";
    await post(GENERAL);
    expect(seen.reads).toEqual([]);
    expect(systemMessage(bodies[0])).toContain(NOTICE_HEADING);
    expect(warnLines).toContainEqual(["[chat-shared] outcome=mark_read_failed"]);
  });
});

describe("failed reads of what is shared", () => {
  it("a failed list adds nothing, not even the notice, and saves as before", async () => {
    state.list = "fail";
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    const system = systemMessage(bodies[0]);
    expect(system).not.toContain(SHARED_HEADING);
    expect(system).not.toContain(NOTICE_HEADING);
    expect(seen.reads).toEqual([]);
    expect(seen.saveMessages).toHaveLength(1);
    expect(warnLines).toContainEqual(["[chat-shared] outcome=list_failed code=%s", "list:42501"]);
  });

  it("a failed read adds the notice instead of the block, the user's own block unchanged, and saves as before", async () => {
    state.read = "fail";
    const res = await post(HOUSEHOLD);
    expect(res.status).toBe(200);
    const system = systemMessage(bodies[0]);
    expect(system).toContain(OWN_HEADING);
    expect(system).toContain("Own Checking");
    expect(system).not.toContain(SHARED_HEADING);
    expect(system).toContain(NOTICE_HEADING);
    expect(seen.sharedSaves).toEqual([]);
    expect(seen.saveMessages).toHaveLength(1);
    expect(warnLines).toContainEqual(["[chat-shared] outcome=read_failed code=%s", "recheck:57014"]);
  });
});
