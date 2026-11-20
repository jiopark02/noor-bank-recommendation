import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { SessionReadResult } from "../supabase-browser";
import {
  HOUSEHOLD_CARD_FETCH_TIMEOUT_MS,
  householdCardView,
  loadHouseholdCard,
  memberLineText,
  type HouseholdHttp,
  type HouseholdOutcome,
} from "../householdClient";
import { BANK_SCREEN_FETCH_TIMEOUT_MS } from "../screenFetchTimeout";

/**
 * The dashboard's household card. Its decisions (householdCardView,
 * loadHouseholdCard) are executed; the card and the dashboard page cannot
 * run here (no DOM) and are probed by source. Whether the card's load really
 * leaves the money figures' timing alone is seen on a deployment, not here.
 *
 * Mutations and the test each one turns red:
 *   a two-person household offered the invite link, or a one-person one not  -> T-D1
 *   a failed, ended, unreachable or malformed answer drawn as a household     -> T-D1
 *   a non-2xx answer whose body has a household's shape drawn as a household  -> T-D1
 *   the Manager label lost from the owner's line                              -> T-D1
 *   the card's load awaited in, or called from, the page's mount effect or
 *     the money load; the card given props, or placed inside a money branch   -> T-D2
 *   the card fetching on its own, writing browser storage, or signing out    -> T-D2
 *   the card not loading through loadHouseholdCard                           -> T-D2
 *   the card's time limit removed, or the request not aborted at the limit   -> T-D3
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(`could not bound the region between \`${from}\` and \`${to}\`; re-point these anchors.`);
  }
  return source.slice(start, end);
}

const SESSION: SessionReadResult = {
  status: "session",
  session: { access_token: "sentinel-access-token" } as Session,
};

function answer(status: number, body: Record<string, unknown>): HouseholdOutcome {
  return { kind: "answer", status, body };
}

function view(members: unknown[], invite: unknown = null, role = "owner") {
  return answer(200, { household: { role, members, invite, maxMembers: 2 } });
}

const SELF_OWNER = { self: true, role: "owner", firstName: "Sam" };
const OTHER_MEMBER = { self: false, role: "member", firstName: "Alex" };
const INVITE = { email: "invitee@example.test", expiresAt: "2026-11-21T00:00:00.000Z" };

describe("dashboard household card: what it shows", () => {
  it("T-D1 one person gets the invite link; two do not; the Manager's invite is shown", () => {
    const alone = householdCardView(view([SELF_OWNER], INVITE));
    expect(alone.kind).toBe("ready");
    if (alone.kind !== "ready") return;
    expect(alone.showInviteLink).toBe(true);
    expect(alone.invite).toEqual(INVITE);
    expect(memberLineText(alone.members[0])).toBe("You · Manager");

    const two = householdCardView(view([SELF_OWNER, OTHER_MEMBER]));
    expect(two.kind).toBe("ready");
    if (two.kind !== "ready") return;
    expect(two.showInviteLink).toBe(false);
    expect(two.invite).toBeNull();
    expect(two.members.map(memberLineText)).toEqual(["You · Manager", "Alex · Member"]);

    const asMember = householdCardView(
      view([{ self: false, role: "owner", firstName: "Alex" }, { self: true, role: "member", firstName: "Sam" }], null, "member")
    );
    expect(asMember.kind).toBe("ready");
    if (asMember.kind !== "ready") return;
    expect(asMember.members.map(memberLineText)).toEqual(["Alex · Manager", "You · Member"]);
  });

  it.each<[string, HouseholdOutcome]>([
    ["a network failure", { kind: "network" }],
    ["an ended session", { kind: "session", reason: "ended" }],
    ["an unconfirmed session", { kind: "session", reason: "unconfirmed" }],
    ["a 401", answer(401, { error: "Unauthorized" })],
    ["a 500", answer(500, { code: "SERVER_ERROR" })],
    ["a 503", answer(503, { code: "AUTH_UNAVAILABLE" })],
    ["a 200 with no household", answer(200, {})],
    ["a 200 with a bad role", answer(200, { household: { role: "admin", members: [SELF_OWNER] } })],
    ["a 200 with no members", view([])],
  ])("T-D1 %s is unavailable, never a household", (_label, outcome) => {
    expect(householdCardView(outcome)).toEqual({ kind: "unavailable" });
  });

  // The same body a 200 carries for a one-person household. The 200 control
  // below proves the body alone would be drawn, so only the status can be
  // what keeps these unavailable.
  const HOUSEHOLD_BODY = { household: { role: "owner", members: [SELF_OWNER], invite: INVITE, maxMembers: 2 } };

  it("T-D1 the household-shaped body used below is drawn when it comes with a 200", () => {
    expect(householdCardView(answer(200, HOUSEHOLD_BODY)).kind).toBe("ready");
  });

  it.each<[string, number]>([
    ["a 300", 300],
    ["a 401", 401],
    ["a 500", 500],
    ["a 503", 503],
  ])("T-D1 %s carrying a household-shaped body is unavailable, never a household", (_label, status) => {
    expect(householdCardView(answer(status, HOUSEHOLD_BODY))).toEqual({ kind: "unavailable" });
  });

  it("T-D1 a 500 carrying a household-shaped body is unavailable through the card's load too", async () => {
    const http: HouseholdHttp = async () => ({ status: 500, json: HOUSEHOLD_BODY });
    expect(await loadHouseholdCard(async () => SESSION, http)).toEqual({ kind: "unavailable" });
  });
});

describe("dashboard household card: separate from the page", () => {
  const PAGE = code(read("../../app/dashboard/page.tsx"));
  const CARD = code(read("../../app/dashboard/HouseholdCard.tsx"));

  it("T-D2 the page renders the card once, with no props, outside every money branch, and its loads never touch the household", () => {
    expect(PAGE.split("<HouseholdCard").length - 1).toBe(1);
    expect(PAGE).toContain("<HouseholdCard />");
    expect(PAGE).toContain('import HouseholdCard from "./HouseholdCard";');

    // The mount effect, the money load and the effect that starts it.
    const loads = slice(PAGE, "useEffect(() => {", "const view = decideBankView(");
    expect(loads.toLowerCase()).not.toContain("household");

    // After the Money block closes, directly in the section.
    const tail = slice(PAGE, "Open Money", "</section>");
    expect(tail).toMatch(/<\/motion\.div>\s*<HouseholdCard \/>\s*$/);
    const cardAt = PAGE.indexOf("<HouseholdCard />");
    expect(PAGE.lastIndexOf("moneyDisplay", cardAt)).toBeLessThan(PAGE.indexOf("Open Money"));
  });

  it("T-D2 the card loads through loadHouseholdCard only, with no props, no storage and no sign-out", () => {
    expect(CARD).toMatch(/^"use client";/);
    expect(CARD).toContain("export default function HouseholdCard() {");
    expect(CARD.split("loadHouseholdCard(").length - 1).toBe(1);
    const flatCard = CARD.replace(/\s+/g, " ");
    expect(flatCard).toContain(
      'void loadHouseholdCard( () => readSession(undefined, "dashboard-mount"), browserHouseholdHttp ).then((next) => { if (!cancelled) setView(next); });'
    );
    expect(CARD).not.toMatch(/\bfetch\(/);
    expect(CARD).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    expect(CARD).not.toMatch(/router|clearLocalAuthState|signOut|runSignOut|\/login/);
    expect(CARD).not.toMatch(/getSupabaseBearerHeaders|getSessionSafe/);
    expect(CARD).not.toMatch(/formatCents|Cents|\$\{?amount/i);
  });
});

describe("dashboard household card: time limit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("T-D3 an answer that never comes ends as unavailable at the limit, with the request aborted", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const http: HouseholdHttp = (_path, init) => {
      seen = init.signal;
      return new Promise(() => {});
    };
    let result: unknown = "pending";
    void loadHouseholdCard(async () => SESSION, http).then((v) => {
      result = v;
    });
    await vi.advanceTimersByTimeAsync(HOUSEHOLD_CARD_FETCH_TIMEOUT_MS - 1);
    expect(result).toBe("pending");
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ kind: "unavailable" });
    expect(seen?.aborted).toBe(true);
  });

  it("T-D3 a session read that never answers also ends at the limit, and sends nothing", async () => {
    vi.useFakeTimers();
    const http = vi.fn<HouseholdHttp>(async () => ({ status: 200, json: {} }));
    let result: unknown = "pending";
    void loadHouseholdCard(() => new Promise<SessionReadResult>(() => {}), http).then((v) => {
      result = v;
    });
    await vi.advanceTimersByTimeAsync(HOUSEHOLD_CARD_FETCH_TIMEOUT_MS);
    expect(result).toEqual({ kind: "unavailable" });
    expect(http).not.toHaveBeenCalled();
  });

  it("T-D3 an answer in time is used, and the limit is shorter than the bank screens'", async () => {
    const http: HouseholdHttp = async (path, init) => {
      expect(path).toBe("/api/household");
      expect(init.method).toBe("GET");
      expect(init.accessToken).toBe("sentinel-access-token");
      return { status: 200, json: { household: { role: "owner", members: [SELF_OWNER], invite: null, maxMembers: 2 } } };
    };
    const result = await loadHouseholdCard(async () => SESSION, http);
    expect(result.kind).toBe("ready");
    expect(HOUSEHOLD_CARD_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HOUSEHOLD_CARD_FETCH_TIMEOUT_MS).toBeLessThan(BANK_SCREEN_FETCH_TIMEOUT_MS);
  });
});
