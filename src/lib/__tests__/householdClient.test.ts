import { describe, expect, it, vi } from "vitest";
import type { SessionReadResult } from "../supabase-browser";
import {
  INVITE_FRAGMENT_KEY,
  acceptOutcomeUnknown,
  acceptUnknownAfterPreview,
  cancelButtonLabel,
  createButtonLabel,
  leaveConfirmLabel,
  afterAccept,
  afterLeave,
  afterPreview,
  buildInviteLink,
  householdCall,
  householdMessage,
  invitedSentence,
  memberLineText,
  readHouseholdData,
  readInviteFragment,
  type HouseholdOutcome,
} from "../householdClient";
import {
  HOUSEHOLD_CODES,
  HOUSEHOLD_MESSAGES,
  HOUSEHOLD_UI,
  SERVER_FAULT_MESSAGE,
} from "../householdCopy";

/**
 * The household screens' decisions (householdClient.ts), executed. The pages
 * themselves cannot run here (no DOM); householdPagesWiring.test.ts holds how
 * they call these.
 *
 * Mutations and the test each one turns red:
 *   a request sent with no session or an empty access token          -> T-C1
 *   the fragment read from the query, or with other keys beside it    -> T-C3
 *   a code missing from the message map, or 401 not read as ended     -> T-C6
 *   an empty first name printed, or "undefined" in a sentence          -> T-C8
 *   the link's fragment key renamed                                   -> T-C9
 *   leaving sending the person to "open the link again"               -> T-C11
 *   a failed leave dropping the token, or not showing its sentence    -> T-C11
 *   the retry's preview 404 read as "invalid" after an unknown accept -> T-C12
 *   a gate 503 or a definite 409 counted as an unknown accept         -> T-C12
 *   a preview 200 not clearing the doubt                             -> T-C12
 *   a 503 AUTH_UNAVAILABLE dropping the token or the retry           -> T-C13
 *   a progress label shown on a button whose action is not running   -> T-C14
 */

const TOKEN = "A".repeat(20) + "b".repeat(20) + "-_9";
const SESSION = {
  status: "session",
  session: { access_token: "access-1", user: { id: "u1" } },
} as unknown as SessionReadResult;
const NONE: SessionReadResult = { status: "none" };
const TIMED_OUT = { status: "unavailable", reason: "timeout", elapsedMs: 3000 } as SessionReadResult;
const EMPTY = {
  status: "session",
  session: { access_token: "", user: { id: "u1" } },
} as unknown as SessionReadResult;

function answer(status: number, body: Record<string, unknown>): HouseholdOutcome {
  return { kind: "answer", status, body };
}

function coded(status: number, code: string): HouseholdOutcome {
  return answer(status, { error: "server text", code });
}

describe("requests", () => {
  it("T-C1 no session, an unanswered read or an empty token sends nothing", async () => {
    for (const [read, reason] of [
      [NONE, "ended"],
      [TIMED_OUT, "unconfirmed"],
      [EMPTY, "unconfirmed"],
    ] as const) {
      const http = vi.fn();
      const outcome = await householdCall(read, http, "/api/household", "GET");
      expect(http).not.toHaveBeenCalled();
      expect(outcome).toEqual({ kind: "session", reason });
    }
    const http = vi.fn(async () => ({ status: 200, json: { ok: true } }));
    const outcome = await householdCall(SESSION, http, "/api/household/leave", "POST", { a: 1 });
    expect(http).toHaveBeenCalledWith("/api/household/leave", {
      method: "POST",
      accessToken: "access-1",
      body: { a: 1 },
    });
    expect(outcome).toEqual({ kind: "answer", status: 200, body: { ok: true } });
    const offline = await householdCall(SESSION, async () => null, "/api/household", "GET");
    expect(offline).toEqual({ kind: "network" });
  });

  it("T-C6 every server code has its sentence; 401 reads as an ended session; the rest is the server fault", () => {
    for (const code of Object.values(HOUSEHOLD_CODES)) {
      expect(householdMessage(coded(409, code)), code).toBe(HOUSEHOLD_MESSAGES[code]);
      expect(HOUSEHOLD_MESSAGES[code], code).toMatch(/\S/);
    }
    expect(householdMessage(answer(401, { error: "Unauthorized" }))).toBe(HOUSEHOLD_UI.sessionEnded);
    expect(householdMessage(answer(500, {}))).toBe(SERVER_FAULT_MESSAGE);
    expect(householdMessage(coded(500, "NOT_A_CODE"))).toBe(SERVER_FAULT_MESSAGE);
    expect(householdMessage(coded(400, "toString"))).toBe(SERVER_FAULT_MESSAGE);
    expect(householdMessage({ kind: "network" })).toBe(HOUSEHOLD_UI.network);
    expect(householdMessage({ kind: "session", reason: "ended" })).toBe(HOUSEHOLD_UI.sessionEnded);
    expect(householdMessage({ kind: "session", reason: "unconfirmed" })).toBe(HOUSEHOLD_UI.sessionUnconfirmed);
  });
});

describe("the invite link", () => {
  it("T-C3 only a fragment holding household_invite alone, well formed, is a token", () => {
    const base = "https://noor.test/settings/household/accept";
    expect(readInviteFragment(`${base}#household_invite=${TOKEN}`)).toBe(TOKEN);
    for (const href of [
      base,
      `${base}#`,
      `${base}?household_invite=${TOKEN}`,
      `${base}#household_invite=${TOKEN}&access_token=x`,
      `${base}#error=access_denied&household_invite=${TOKEN}`,
      `${base}#household_invite=${TOKEN}&household_invite=${TOKEN}`,
      `${base}#household_invite=short`,
      `${base}#household_invite=${TOKEN}=`,
      `${base}#code=${TOKEN}`,
      "not a url",
    ]) {
      expect(readInviteFragment(href), href).toBeNull();
    }
  });

  it("T-C9 the link puts the token in the fragment under household_invite", () => {
    expect(INVITE_FRAGMENT_KEY).toBe("household_invite");
    const link = buildInviteLink("https://noor.test", TOKEN);
    expect(link).toBe(`https://noor.test/settings/household/accept#household_invite=${TOKEN}`);
    expect(new URL(link).search).toBe("");
    expect(readInviteFragment(link)).toBe(TOKEN);
  });
});

describe("names", () => {
  it("T-C8 with no first name, the sentences and lines leave the name out", () => {
    expect(invitedSentence(null)).toBe("You've been invited to join a household.");
    expect(invitedSentence("Alex")).toBe("Alex invited you to join their household.");
    expect(memberLineText({ self: true, role: "owner", firstName: "Sam" })).toBe("You · Manager");
    expect(memberLineText({ self: false, role: "member", firstName: "Alex" })).toBe("Alex · Member");
    expect(memberLineText({ self: false, role: "owner", firstName: null })).toBe("Manager");
    expect(memberLineText({ self: false, role: "member", firstName: null })).toBe("Member");
    const data = readHouseholdData({
      household: {
        role: "member",
        members: [
          { self: true, role: "member", firstName: "Sam" },
          { self: false, role: "owner", firstName: "  " },
        ],
        invite: null,
        maxMembers: 2,
      },
    });
    expect(data?.members[1]).toEqual({ self: false, role: "owner", firstName: null });
    expect(memberLineText(data!.members[1])).toBe("Manager");
    expect(afterPreview(answer(200, { inviterFirstName: "" })).view).toEqual({
      kind: "ready",
      inviterFirstName: null,
      notice: null,
    });
    for (const text of [invitedSentence(null), memberLineText(data!.members[1])]) {
      expect(text).not.toMatch(/undefined|null/);
    }
  });
});

describe("the accept screen", () => {
  it("previews into ready, keeps the token on a retryable failure, drops it otherwise", () => {
    expect(afterPreview(answer(200, { inviterFirstName: "Alex" }))).toEqual({
      view: { kind: "ready", inviterFirstName: "Alex", notice: null },
      keepToken: true,
    });
    const refused = afterPreview(coded(404, "INVITE_UNAVAILABLE"));
    expect(refused).toEqual({
      view: { kind: "failed", message: HOUSEHOLD_MESSAGES.INVITE_UNAVAILABLE, retry: false },
      keepToken: false,
    });
    expect(afterPreview({ kind: "network" }).keepToken).toBe(true);
    expect(afterPreview(answer(503, {})).keepToken).toBe(true);
  });

  it("accept: joined drops the token, must-leave keeps it, a changed household can be retried", () => {
    expect(afterAccept(answer(200, { joined: true }), "Alex")).toEqual({
      view: { kind: "joined" },
      keepToken: false,
    });
    expect(afterAccept(coded(409, "MUST_LEAVE_FIRST"), "Alex")).toEqual({
      view: { kind: "must-leave", inviterFirstName: "Alex", error: null },
      keepToken: true,
    });
    const changed = afterAccept(coded(409, "HOUSEHOLD_CHANGED"), "Alex");
    expect(changed.keepToken).toBe(true);
    expect(changed.view).toEqual({
      kind: "failed",
      message: HOUSEHOLD_MESSAGES.HOUSEHOLD_CHANGED,
      retry: true,
    });
    for (const code of ["INVITE_UNAVAILABLE", "HOUSEHOLD_FULL", "ALREADY_MEMBER", "EMAIL_UNCONFIRMED"]) {
      expect(afterAccept(coded(409, code), null).keepToken, code).toBe(false);
    }
  });

  it("T-C11 leaving first returns to ready with the same token; a failed leave keeps the token and shows why", () => {
    const left = afterLeave(answer(200, { left: true }), "Alex");
    expect(left).toEqual({
      view: { kind: "ready", inviterFirstName: "Alex", notice: "You left your previous household." },
      keepToken: true,
    });
    expect(left.view).not.toEqual({ kind: "no-link" });
    expect(JSON.stringify(left)).not.toContain(HOUSEHOLD_UI.openLinkAgain);

    // Nobody else turned out to be in the household: nothing blocks joining.
    expect(afterLeave(coded(409, "LEAVE_SOLO"), null)).toEqual({
      view: { kind: "ready", inviterFirstName: null, notice: null },
      keepToken: true,
    });

    for (const outcome of [
      { kind: "network" } as HouseholdOutcome,
      answer(500, { error: "x", code: "SERVER_ERROR" }),
      { kind: "session", reason: "unconfirmed" } as HouseholdOutcome,
    ]) {
      const step = afterLeave(outcome, "Alex");
      expect(step.keepToken).toBe(true);
      expect(step.view).toEqual({
        kind: "must-leave",
        inviterFirstName: "Alex",
        error: householdMessage(outcome),
      });
    }

    // The copy the screen shows around this step.
    expect(HOUSEHOLD_MESSAGES.MUST_LEAVE_FIRST).toBe(
      "You're already in a household with someone else. Leave it to join this one."
    );
    expect(HOUSEHOLD_UI.leftPrevious).toBe("You left your previous household.");
  });
});

/** The accept screen's steps, run in the order the screen runs them. */
async function joinThenRetry(
  acceptAnswer: { status: number; json: unknown } | null,
  previewAnswers: Array<{ status: number; json: unknown } | null>
) {
  const accept = await householdCall(SESSION, async () => acceptAnswer, "/api/household/invite/accept", "POST", {
    token: TOKEN,
  });
  const acceptStep = afterAccept(accept, "Alex");
  let unknown = acceptOutcomeUnknown(accept);
  let step = acceptStep;
  for (const answer of previewAnswers) {
    const preview = await householdCall(SESSION, async () => answer, "/api/household/invite/preview", "POST", {
      token: TOKEN,
    });
    step = afterPreview(preview, unknown);
    unknown = acceptUnknownAfterPreview(preview, unknown);
  }
  return { acceptStep, step, unknown };
}

const GONE = { status: 404, json: { error: "x", code: "INVITE_UNAVAILABLE" } };
const STILL_THERE = { status: 200, json: { inviterFirstName: "Alex" } };
const INVALID_LINK = {
  view: { kind: "failed", message: HOUSEHOLD_MESSAGES.INVITE_UNAVAILABLE, retry: false },
  keepToken: false,
};

describe("an accept whose result is unknown", () => {
  it("T-C12 no answer to the accept, then a retry whose preview finds no invite: could not confirm, go to the household", async () => {
    for (const [label, acceptAnswer] of [
      ["network", null],
      ["a 500 with no code", { status: 500, json: {} }],
      ["a 504 from the platform", { status: 504, json: {} }],
      ["SERVER_ERROR", { status: 500, json: { error: "x", code: "SERVER_ERROR" } }],
    ] as const) {
      const { acceptStep, step, unknown } = await joinThenRetry(acceptAnswer, [GONE]);
      expect(acceptStep.keepToken, label).toBe(true);
      expect(acceptStep.view.kind, label).toBe("failed");
      expect(step, label).toEqual({ view: { kind: "join-unconfirmed" }, keepToken: false });
      expect(unknown, label).toBe(false);
    }
    expect(HOUSEHOLD_UI.joinUnconfirmed).toBe(
      "We couldn't confirm whether you joined. Check your household."
    );
    expect(HOUSEHOLD_UI.goToHousehold).toBe("Go to Household");

    // A preview that fails again keeps the doubt for the next try.
    const twice = await joinThenRetry(null, [null, GONE]);
    expect(twice.step).toEqual({ view: { kind: "join-unconfirmed" }, keepToken: false });

    // The invite is still there: the accept did not commit, and the doubt is gone.
    const notCommitted = await joinThenRetry(null, [STILL_THERE, GONE]);
    expect(notCommitted.step).toEqual(INVALID_LINK);

    // Answers that settle the accept leave a later 404 meaning what it says.
    for (const [label, acceptAnswer] of [
      ["409 HOUSEHOLD_CHANGED", { status: 409, json: { error: "x", code: "HOUSEHOLD_CHANGED" } }],
      ["503 AUTH_UNAVAILABLE", { status: 503, json: { error: "x", code: "AUTH_UNAVAILABLE" } }],
      ["503 ADMIN_UNCONFIGURED", { status: 503, json: { error: "x", code: "ADMIN_UNCONFIGURED" } }],
    ] as const) {
      const { step, unknown } = await joinThenRetry(acceptAnswer, [GONE]);
      expect(step, label).toEqual(INVALID_LINK);
      expect(unknown, label).toBe(false);
    }

    // Before any accept, the preview's 404 is the invalid-link sentence.
    expect(afterPreview(coded(404, "INVITE_UNAVAILABLE"))).toEqual(INVALID_LINK);
    expect(acceptOutcomeUnknown({ kind: "session", reason: "unconfirmed" })).toBe(false);
  });
});

describe("an auth server that gave no answer", () => {
  it("T-C13 a 503 AUTH_UNAVAILABLE keeps the token and offers a retry, with the sign-in sentence", () => {
    const outcome = coded(503, "AUTH_UNAVAILABLE");
    const sentence = HOUSEHOLD_MESSAGES.AUTH_UNAVAILABLE;
    expect(sentence).toBe("We couldn't confirm your sign-in right now. Please try again in a moment.");
    expect(householdMessage(outcome)).toBe(sentence);
    for (const step of [afterPreview(outcome), afterAccept(outcome, "Alex")]) {
      expect(step).toEqual({ view: { kind: "failed", message: sentence, retry: true }, keepToken: true });
    }
    expect(afterLeave(outcome, "Alex")).toEqual({
      view: { kind: "must-leave", inviterFirstName: "Alex", error: sentence },
      keepToken: true,
    });
    expect(householdMessage(outcome)).not.toBe(HOUSEHOLD_UI.sessionEnded);
  });
});

describe("the household screen's buttons", () => {
  it("T-C14 only the running action's button shows progress", () => {
    expect(createButtonLabel(null, false)).toBe("Create invite link");
    expect(createButtonLabel(null, true)).toBe("Create a new link");
    expect(createButtonLabel("create", true)).toBe("Creating…");
    expect(cancelButtonLabel(null)).toBe("Cancel invite");
    expect(cancelButtonLabel("cancel")).toBe("Cancelling…");
    expect(leaveConfirmLabel(null)).toBe("Leave");
    expect(leaveConfirmLabel("leave")).toBe("Leaving…");
    for (const other of ["cancel", "leave"] as const) {
      expect(createButtonLabel(other, false), other).toBe("Create invite link");
      expect(createButtonLabel(other, true), other).toBe("Create a new link");
    }
    for (const other of ["create", "leave"] as const) {
      expect(cancelButtonLabel(other), other).toBe("Cancel invite");
    }
    for (const other of ["create", "cancel"] as const) {
      expect(leaveConfirmLabel(other), other).toBe("Leave");
    }
  });
});
