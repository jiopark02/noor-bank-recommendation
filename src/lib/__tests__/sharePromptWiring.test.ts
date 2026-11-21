import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { SessionReadResult } from "../supabase-browser";
import {
  afterShareAnswer,
  answerShare,
  createLatestOnly,
  loadSharing,
  readSharingData,
  shareNoticeFor,
  sharePromptLines,
  sharingSettingsLines,
  sharePromptView,
  type HouseholdHttp,
} from "../householdClient";
import { HOUSEHOLD_MESSAGES, HOUSEHOLD_UI } from "../householdCopy";

/**
 * The share question and the household screen's sharing list: the client
 * decisions executed, the screens probed by source.
 *
 * Mutations and the test each one turns red:
 *   a non-2xx, a malformed body, a throw or a passed limit loaded as data   -> SP-L1
 *   loadSharing rejecting instead of answering null                        -> SP-L1
 *   answerShare sending anything but itemId and shared, or another method -> SP-A1
 *   answerShare rejecting on a throw                                       -> SP-A1
 *   a question for an answered or shared bank, or with no other member     -> SP-V1
 *   the prompt rendering, throwing or holding up the screen on a failure   -> SP-W1
 *   the prompt given props other than refreshKey, storage, or a sign-out   -> SP-W1
 *   a mount removed, doubled, or the money page changed beyond the mount
 *     and the key bump after a new bank                                    -> SP-W2
 *   the household screen's back button no longer replacing to /dashboard  -> SP-W2
 *   a refusal to reload on (no connection, no partner, household changed,
 *     invalid request) answered "Try again" without a reload              -> SP-R1
 *   a network failure, 5xx, gate 503 or session problem reloaded or
 *     given a refusal's sentence                                         -> SP-R1
 *   the refusal decided by status instead of code                         -> SP-R1
 *   a component ignoring afterShareAnswer's reload or message             -> SP-R2
 *   createLatestOnly letting an earlier request's late answer through     -> SP-S1
 *   a component applying a load without its latest-only check            -> SP-S2
 *   a notice drawn under a question about another bank                    -> SP-N1
 *   a notice dropped when nothing is asked, the member is gone or the
 *     read failed                                                         -> SP-N1
 *   a notice on its own line without the bank's name, or no fallback     -> SP-N1
 *   a component drawing its own notice text, or not drawing the lines    -> SP-N2
 *   the notice kept across a refreshKey change, or cleared by the read
 *     after an answer                                                    -> SP-N2
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n"
  );
}

const SESSION: SessionReadResult = {
  status: "session",
  session: { access_token: "sentinel-access-token" } as Session,
};

const SHARING_BODY = {
  sharing: {
    eligible: true,
    partnerFirstName: "Alex",
    connections: [
      { itemId: "item-a", institutionName: "First Bank", shared: true, answered: true },
      { itemId: "item-b", institutionName: "Second Bank", shared: false, answered: true },
      { itemId: "item-c", institutionName: "Third Bank", shared: false, answered: false },
    ],
  },
};

function httpAnswering(answer: { status: number; json: unknown } | null | "throw" | "never") {
  const calls: Array<{ path: string; method: string; body: unknown; hasSignal: boolean }> = [];
  const http: HouseholdHttp = (path, init) => {
    calls.push({ path, method: init.method, body: init.body, hasSignal: init.signal !== undefined });
    if (answer === "throw") return Promise.reject(new Error("sentinel"));
    if (answer === "never") return new Promise(() => {});
    return Promise.resolve(answer);
  };
  return { http, calls };
}

describe("loading the sharing view", () => {
  it("SP-L1 a 2xx in the view's shape is data; anything else is null, and it never rejects", async () => {
    const ok = httpAnswering({ status: 200, json: SHARING_BODY });
    const data = await loadSharing(async () => SESSION, ok.http, 1000);
    expect(data?.connections.map((c) => c.itemId)).toEqual(["item-a", "item-b", "item-c"]);
    expect(ok.calls).toEqual([
      { path: "/api/household/sharing", method: "GET", body: undefined, hasSignal: true },
    ]);

    for (const answer of [
      { status: 500, json: SHARING_BODY },
      { status: 401, json: SHARING_BODY },
      { status: 200, json: {} },
      { status: 200, json: { sharing: { eligible: "yes", connections: [] } } },
      null,
      "throw" as const,
    ]) {
      const h = httpAnswering(answer);
      await expect(loadSharing(async () => SESSION, h.http, 1000), JSON.stringify(answer)).resolves.toBeNull();
    }
    await expect(
      loadSharing(async () => {
        throw new Error("sentinel");
      }, httpAnswering({ status: 200, json: SHARING_BODY }).http, 1000)
    ).resolves.toBeNull();
  });

  it("SP-L1 an answer that never comes ends as null at the limit", async () => {
    const h = httpAnswering("never");
    await expect(loadSharing(async () => SESSION, h.http, 20)).resolves.toBeNull();
  });

  it("SP-L1 with no session nothing is sent", async () => {
    const h = httpAnswering({ status: 200, json: SHARING_BODY });
    await expect(loadSharing(async () => ({ status: "none" }), h.http, 1000)).resolves.toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("readSharingData keeps only well-formed rows and treats a blank name as none", () => {
    const data = readSharingData({
      sharing: {
        eligible: true,
        partnerFirstName: "  ",
        connections: [{ itemId: "" }, null, { itemId: "x", institutionName: 5, shared: "true" }],
      },
    });
    expect(data).toEqual({
      eligible: true,
      partnerFirstName: null,
      connections: [{ itemId: "x", institutionName: "", shared: false, answered: false }],
    });
  });
});

describe("answering", () => {
  it("SP-A1 a PUT with the item id and the setting only; a throw is a network outcome", async () => {
    const ok = httpAnswering({ status: 200, json: { shared: true } });
    const outcome = await answerShare(async () => SESSION, ok.http, "item-c", true);
    expect(outcome).toEqual({ kind: "answer", status: 200, body: { shared: true } });
    expect(ok.calls).toEqual([
      { path: "/api/household/sharing", method: "PUT", body: { itemId: "item-c", shared: true }, hasSignal: false },
    ]);
    await expect(
      answerShare(async () => SESSION, httpAnswering("throw").http, "item-c", false)
    ).resolves.toEqual({ kind: "network" });
    await expect(
      answerShare(async () => {
        throw new Error("sentinel");
      }, ok.http, "item-c", false)
    ).resolves.toEqual({ kind: "network" });
  });
});

describe("after an answer", () => {
  const answer = (status: number, body: Record<string, unknown> = {}) =>
    ({ kind: "answer", status, body }) as const;

  it("SP-R1 refusals to reload on read the view again and show their own sentence; everything else keeps the view and says Try again", () => {
    expect(afterShareAnswer(answer(200, { shared: true }))).toEqual({ reload: true, message: null });

    const toReload: Array<[number, string]> = [
      [404, "SHARE_NO_CONNECTION"],
      [409, "SHARE_NO_PARTNER"],
      [409, "HOUSEHOLD_CHANGED"],
      [400, "SHARE_INVALID_REQUEST"],
    ];
    for (const [status, code] of toReload) {
      expect(afterShareAnswer(answer(status, { code })), code).toEqual({
        reload: true,
        message: HOUSEHOLD_MESSAGES[code as keyof typeof HOUSEHOLD_MESSAGES],
      });
    }

    const TRY_AGAIN = { reload: false, message: HOUSEHOLD_UI.shareFailed };
    const others: Array<[string, Parameters<typeof afterShareAnswer>[0]]> = [
      ["network", { kind: "network" }],
      ["session ended", { kind: "session", reason: "ended" }],
      ["session unconfirmed", { kind: "session", reason: "unconfirmed" }],
      ["401", answer(401, { error: "Unauthorized" })],
      ["500", answer(500, { code: "SERVER_ERROR" })],
      ["503 admin", answer(503, { code: "ADMIN_UNCONFIGURED" })],
      ["503 auth", answer(503, { code: "AUTH_UNAVAILABLE" })],
      ["409 without a code", answer(409, {})],
      ["404 without a code", answer(404, {})],
      ["409 with an unknown code", answer(409, { code: "SOMETHING_ELSE" })],
    ];
    for (const [label, outcome] of others) {
      expect(afterShareAnswer(outcome), label).toEqual(TRY_AGAIN);
    }
  });
});

describe("only the latest load is applied", () => {
  function deferred() {
    let resolve: (value: string) => void = () => {};
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /** The components' load, with the read replaced by a deferred answer. */
  function makeScreen() {
    const latest = createLatestOnly();
    const applied: string[] = [];
    const load = async (answer: Promise<string>) => {
      const isLatest = latest.begin();
      const next = await answer;
      if (!isLatest()) return;
      applied.push(next);
    };
    return { load, applied };
  }

  it("SP-S1 an earlier load that answers after a later one is dropped; the later one is applied", async () => {
    const screen = makeScreen();
    const first = deferred();
    const second = deferred();
    const a = screen.load(first.promise);
    const b = screen.load(second.promise);
    second.resolve("after refreshKey changed");
    await b;
    first.resolve("before refreshKey changed");
    await a;
    expect(screen.applied).toEqual(["after refreshKey changed"]);
  });

  it("SP-S1 answers in order: only the last one is applied; a lone load is applied", async () => {
    const screen = makeScreen();
    const first = deferred();
    const second = deferred();
    const a = screen.load(first.promise);
    const b = screen.load(second.promise);
    first.resolve("first");
    await a;
    second.resolve("second");
    await b;
    expect(screen.applied).toEqual(["second"]);

    const lone = makeScreen();
    const only = deferred();
    const c = lone.load(only.promise);
    only.resolve("only");
    await c;
    expect(lone.applied).toEqual(["only"]);
  });

  it("SP-S1 each screen keeps its own count", () => {
    const one = createLatestOnly();
    const two = createLatestOnly();
    const check = one.begin();
    two.begin();
    expect(check()).toBe(true);
    one.begin();
    expect(check()).toBe(false);
  });
});

describe("where a notice is drawn", () => {
  const data = readSharingData(SHARING_BODY);
  const NO_CONNECTION = HOUSEHOLD_MESSAGES.SHARE_NO_CONNECTION;
  const aboutC = { itemId: "item-c", institutionName: "Third Bank", text: NO_CONNECTION };
  const aboutGone = { itemId: "item-gone", institutionName: "Gone Bank", text: NO_CONNECTION };

  it("SP-N1 the notice an answer leaves names its bank; a 2xx leaves none", () => {
    expect(shareNoticeFor({ reload: true, message: null }, "item-c", "Third Bank")).toBeNull();
    expect(shareNoticeFor({ reload: true, message: NO_CONNECTION }, "item-c", "Third Bank")).toEqual(aboutC);
  });

  it("SP-N1 the question: under it while it is about the notice's bank, otherwise alone and naming the bank", () => {
    expect(sharePromptLines(data, null)).toEqual({ view: sharePromptView(data), underQuestion: null, alone: null });

    const same = sharePromptLines(data, aboutC);
    expect(same.view.kind).toBe("ask");
    expect(same.underQuestion).toBe(NO_CONNECTION);
    expect(same.alone).toBeNull();

    // The answered bank is gone and the question is now about item-c.
    const moved = sharePromptLines(data, aboutGone);
    expect(moved.view).toMatchObject({ kind: "ask", itemId: "item-c" });
    expect(moved.underQuestion).toBeNull();
    expect(moved.alone).toBe(`Gone Bank: ${NO_CONNECTION}`);

    // Nothing left to ask, no other member, or the read failed: still drawn.
    const answered = data && { ...data, connections: data.connections.slice(0, 2) };
    const ineligible = data && { ...data, eligible: false };
    for (const [label, d] of [["nothing to ask", answered], ["not eligible", ineligible], ["read failed", null]] as const) {
      const lines = sharePromptLines(d, aboutC);
      expect(lines.view.kind, label).toBe("none");
      expect(lines.alone, label).toBe(`Third Bank: ${NO_CONNECTION}`);
    }

    expect(sharePromptLines(null, { ...aboutGone, institutionName: "" }).alone).toBe(
      `One of your banks: ${NO_CONNECTION}`
    );
  });

  it("SP-N1 the list: the notice names its bank and is drawn whatever the body is", () => {
    const named = `Third Bank: ${NO_CONNECTION}`;
    expect(sharingSettingsLines(true, data, aboutC)).toEqual({ body: "list", notice: named });
    expect(sharingSettingsLines(true, data && { ...data, eligible: false }, aboutC)).toEqual({ body: "nothing", notice: named });
    expect(sharingSettingsLines(true, null, aboutC)).toEqual({ body: "unavailable", notice: named });
    expect(sharingSettingsLines(false, null, null)).toEqual({ body: "nothing", notice: null });
    expect(sharingSettingsLines(true, data, null)).toEqual({ body: "list", notice: null });
    expect(sharingSettingsLines(true, data, { ...aboutC, institutionName: "" }).notice).toBe(
      `One of your banks: ${NO_CONNECTION}`
    );
  });
});

describe("which question", () => {
  it("SP-V1 the first bank not yet answered for this person; none without another member or a load", () => {
    const data = readSharingData(SHARING_BODY);
    expect(sharePromptView(data)).toEqual({
      kind: "ask",
      itemId: "item-c",
      institutionName: "Third Bank",
      partnerFirstName: "Alex",
    });
    expect(sharePromptView(null)).toEqual({ kind: "none" });
    expect(sharePromptView(data && { ...data, eligible: false })).toEqual({ kind: "none" });
    expect(
      sharePromptView(data && { ...data, connections: data.connections.slice(0, 2) })
    ).toEqual({ kind: "none" });
  });

  it("the question names the bank and the person, with a fallback for neither", () => {
    expect(HOUSEHOLD_UI.shareQuestion("Third Bank", "Alex")).toBe("Share Third Bank with Alex?");
    expect(HOUSEHOLD_UI.shareQuestion("", null)).toBe(
      "Share this bank with the other person in your household?"
    );
    expect(HOUSEHOLD_UI.shareExplainer("Alex")).toContain("You can change this anytime in Settings → Household.");
  });
});

describe("the screens", () => {
  const PROMPT = read("../../app/settings/household/SharePrompt.tsx");
  const CARD = read("../../app/dashboard/HouseholdCard.tsx");
  const HOUSEHOLD = read("../../app/settings/household/page.tsx");
  const ACCEPT = read("../../app/settings/household/accept/page.tsx");
  const MONEY = read("../../app/money/page.tsx");

  it("SP-W1 the prompt renders nothing until there is a question, never throws, and touches no storage or session", () => {
    expect(PROMPT).toMatch(/^"use client";/);
    expect(PROMPT).toContain("export default function SharePrompt({ refreshKey }: { refreshKey: number }) {");
    expect(PROMPT).toContain("export function SharingSettings({ refreshKey }: { refreshKey: number }) {");
    // Nothing is drawn only when there is neither a question nor a notice.
    expect(PROMPT).toContain('if (view.kind === "none" && lines.alone === null) return null;');
    expect(PROMPT).toContain('if (lines.body === "nothing" && lines.notice === null) return null;');
    expect(PROMPT).not.toMatch(/\bthrow\b/);
    expect(PROMPT).not.toMatch(/\bfetch\(/);
    expect(PROMPT).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    expect(PROMPT).not.toMatch(/useRouter|router\.|clearLocalAuthState|signOut|runSignOut|\/login/);
    expect(PROMPT).not.toMatch(/getSupabaseBearerHeaders|getSessionSafe/);
    expect(PROMPT.split("loadSharing(").length - 1).toBe(2);
    expect(PROMPT.split("answerShare(").length - 1).toBe(2);
  });

  it("SP-W2 mounted once on the card, the household screen, the joined view and money; money changes only by the mount and the key bump", () => {
    expect(CARD.split("<SharePrompt ").length - 1).toBe(1);
    expect(CARD).toContain('import SharePrompt from "@/app/settings/household/SharePrompt";');
    expect(HOUSEHOLD.split("<SharingSettings ").length - 1).toBe(1);
    expect(HOUSEHOLD).toContain("{others.length > 0 && <SharingSettings refreshKey={others.length} />}");
    expect(ACCEPT.split("<SharePrompt ").length - 1).toBe(1);
    const joined = ACCEPT.slice(ACCEPT.indexOf('{view.kind === "joined" && ('), ACCEPT.indexOf('{view.kind === "join-unconfirmed" && ('));
    expect(joined).toContain("<SharePrompt refreshKey={0} />");

    expect(MONEY.split("<SharePrompt ").length - 1).toBe(1);
    expect(MONEY).toContain("<SharePrompt refreshKey={sharePromptKey} />");
    expect(MONEY.split("sharePromptKey").length - 1).toBe(2);
    expect(MONEY.split("setSharePromptKey").length - 1).toBe(2);
    const exchange = MONEY.slice(
      MONEY.indexOf("const handleExchangeConnected = useCallback(() => {"),
      MONEY.indexOf("const bankExchange = usePlaidExchange({")
    );
    expect(exchange).toContain("setSharePromptKey((k) => k + 1);");

    // The household screen's back button stays a replace to the dashboard.
    expect(HOUSEHOLD).toContain("onClick={() => router.replace('/dashboard')}");
  });

  it("SP-R2 both components decide after an answer through afterShareAnswer only, and show its message", () => {
    const flat = PROMPT.replace(/\s+/g, " ");
    expect(flat.split("const step = afterShareAnswer(outcome); setNotice(shareNoticeFor(step, itemId, institutionName)); if (step.reload) await load();").length - 1).toBe(2);
    expect(PROMPT).not.toMatch(/\bisOk\(/);
    expect(PROMPT).not.toContain("HOUSEHOLD_UI.shareFailed");
  });

  it("SP-S2 both components apply a load only after its latest-only check", () => {
    expect(PROMPT.split("const latestRef = useRef(createLatestOnly());").length - 1).toBe(2);
    const loads = PROMPT.split("const load = useCallback(async () => {").slice(1);
    expect(loads.length).toBe(2);
    for (const rest of loads) {
      const body = rest.slice(0, rest.indexOf("}, []);"));
      const begin = body.indexOf("const isLatest = latestRef.current.begin();");
      const read = body.indexOf("await loadSharing(");
      const guard = body.indexOf("if (!mountedRef.current || !isLatest()) return;");
      const apply = body.indexOf("setData(");
      expect(begin).toBeGreaterThan(-1);
      expect(read).toBeGreaterThan(begin);
      expect(guard).toBeGreaterThan(read);
      expect(apply).toBeGreaterThan(guard);
    }
    // setData is called only inside the two loads.
    expect(PROMPT.split("setData(").length - 1).toBe(2);
  });

  it("SP-N2 both components draw a notice only through the line functions, clear it on a refreshKey change and not on the read after an answer", () => {
    expect(PROMPT).toContain("const lines = sharePromptLines(data, notice);");
    expect(PROMPT).toContain("const lines = sharingSettingsLines(loaded, data, notice);");
    expect(PROMPT).toContain("{lines.alone}");
    expect(PROMPT).toContain("{lines.underQuestion}");
    expect(PROMPT.split("{lines.notice}").length - 1).toBe(1);
    expect(PROMPT).not.toContain("shareNoticeAbout");
    expect(PROMPT).not.toMatch(/notice\.text|step\.message/);
    // The refreshKey effect clears the notice before it loads, in both.
    const flat = PROMPT.replace(/\s+/g, " ");
    expect(
      flat.split("useEffect(() => { mountedRef.current = true; setNotice(null); void load();").length - 1
    ).toBe(2);
    // The loads themselves never touch the notice.
    for (const rest of PROMPT.split("const load = useCallback(async () => {").slice(1)) {
      expect(rest.slice(0, rest.indexOf("}, []);"))).not.toContain("setNotice");
    }
  });
});
